import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AddressInfo } from 'node:net';
import { Server, utils, type Connection } from 'ssh2';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { initialTransferDraft, selectTransferProfiles, type TransferPreview } from '@shared/project-transfer';
import { openDbClient, type DbClient } from '../../db/client';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { SecretsStore } from '../../secrets';
import { AiProfileService } from '../ai/ai-profile-service';
import { ProjectService } from './project-service';
import { ProjectTransferService, transferFilename } from './transfer-service';
import { decryptProject, encryptProject } from './transfer-format';
import { transferFixture } from './transfer-fixtures';
import { generateSshTestKey } from '../../test-ssh-keys';
import { SSH_TEST_COMMAND, testSsh } from '../connections/ssh-tester';

let root: string;
const clients: DbClient[] = [], services: ProjectTransferService[] = [];
let clock: number;
function setup(name: string, checkpoint?: ConstructorParameters<typeof ProjectTransferService>[0]['checkpoint']) {
  const home = join(root, name); mkdirSync(home, { recursive: true });
  const client = openDbClient(join(home, 'test.db')); clients.push(client); runBundledMigrations(client.sqlite);
  const cipher = { available: true, failAfter: Infinity, writes: 0 };
  const secrets = new SecretsStore(client.db, { isAvailable: () => cipher.available,
    encrypt: plain => { if (++cipher.writes > cipher.failAfter) throw Error('synthetic failure'); return Buffer.from(`${name}:${plain}`); },
    decrypt: bytes => { if (!bytes.toString().startsWith(`${name}:`)) throw Error('wrong receiver cipher'); return bytes.toString().slice(name.length + 1); },
  });
  const projects = new ProjectService(client.db, secrets, () => clock, () => svc.keys.cleanup());
  const profiles = new AiProfileService(client.db, secrets);
  const svc = new ProjectTransferService({ db: client.db, secrets, projects, profiles, userData: home, appVersion: '0.0.4', env: () => ({ PATH: '/bin:/usr/bin' }), now: () => clock, checkpoint });
  services.push(svc); svc.recover();
  return { svc, projects, profiles, secrets, cipher, client, home };
}
const folder = (name: string) => { const p = join(root, name); mkdirSync(p, { recursive: true }); return p; };
async function unlock(svc: ProjectTransferService, p = transferFixture(), owner = 1) {
  const path = join(root, `${randomUUID()}.willyou`); writeFileSync(path, await encryptProject(p, '12345678'));
  const file = svc.choose(owner, path); return svc.unlock(owner, file.fileToken, '12345678');
}
function ready(svc: ProjectTransferService, preview: TransferPreview, name: string = randomUUID(), owner = 1) {
  const draft = initialTransferDraft(preview); draft.name = name;
  for (const d of draft.directories) { d.localPath = folder(randomUUID()); svc.allowDirectory(owner, preview.token, d.localPath); }
  return draft;
}
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'willyou-m8-')); clock = Date.now(); });
afterEach(() => { services.splice(0).forEach(s => s.disposeAll()); clients.splice(0).forEach(c => c.close()); rmSync(root, { recursive: true, force: true }); });

describe('M8 real SQLite transfer services', () => {
  it('I01/D07/S01 imports atomically with new ids, receiver encryption, no tasks or old default changes', async () => {
    const a = setup('A'), b = setup('B');
    const preview = await unlock(a.svc), draft = ready(a.svc, preview);
    const result = a.svc.commit(1, preview.token, randomUUID(), draft);
    expect(result.counts).toEqual({ directories: 1, databases: 1, servers: 1, profiles: 0 });
    const project = a.projects.getProject(result.projectId); expect(project.configVersion).toBe(1); expect(project.databases[0].lastTest).toBeNull();
    expect(a.client.sqlite.prepare('SELECT COUNT(*) n FROM tasks').get()).toEqual({ n: 0 });
    const path = join(root, 'out.willyou'); await a.svc.exportTo(path, result.projectId, [], [], '12345678');
    const raw = readFileSync(path); expect(raw.toString()).not.toContain('synthetic');
    const parsed = await decryptProject(raw, '12345678'); expect(parsed.profiles).toEqual([]); expect(parsed.servers[0].appRoot).toBe('/remote/project');
    const file = b.svc.choose(7, path), p = await b.svc.unlock(7, file.fileToken, '12345678');
    const r = b.svc.commit(7, p.token, randomUUID(), ready(b.svc, p, 'Receiver', 7));
    expect(r.projectId).not.toBe(result.projectId);
    const receiver = b.projects.getProject(r.projectId);
    expect(receiver.databases[0].id).not.toBe(project.databases[0].id);
    expect(receiver.servers[0].id).not.toBe(project.servers[0].id);
    expect(receiver.dirs[0].id).not.toBe(project.dirs[0].id);
    expect(b.svc.snapshot(r.projectId, [], []).credentials).toEqual({
      [`db-${receiver.databases[0].id}`]: { password: 'synthetic-db-password' },
      [`server-${receiver.servers[0].id}`]: { password: 'synthetic-ssh-password', sudoPassword: 'synthetic-sudo-password' },
    });
    const rowsA = a.client.sqlite.prepare('SELECT secret FROM app_secrets').all(), rowsB = b.client.sqlite.prepare('SELECT secret FROM app_secrets').all(); expect(rowsA).not.toEqual(rowsB);
    expect(a.projects.getProject(result.projectId)).toEqual(project);
  });
  it('D09/D10/S02 imports only selected profiles without replacing defaults and permits missing CLI', async () => {
    const a = setup('A'); a.profiles.create({ name: '测试配置', runner: 'claude', executable: null, env: [], args: [], color: null, isDefault: true });
    const original = a.profiles.defaultProfileId(); const p = await unlock(a.svc);
    const d = selectTransferProfiles(ready(a.svc, p), p, ['ai-1']);
    const r = a.svc.commit(1, p.token, randomUUID(), d);
    expect(r.profileIds).toHaveLength(1); expect(r.warnings).toHaveLength(1); expect(a.profiles.defaultProfileId()).toBe(original);
    const imported = a.profiles.get(r.profileIds[0]); expect(imported.name).toBe('测试配置（导入）'); expect(imported.check).toBeNull(); expect(imported.isDefault).toBe(false);
    expect(() => a.profiles.resolve(imported.id)).toThrow('尚未配置');
    expect(a.profiles.resolve(imported.id, true).env.ANTHROPIC_API_KEY).toBe('synthetic-token-m8');
    a.profiles.recordCheck(imported.id, { category: 'ok', source: 'manual', message: 'synthetic manual test', ms: 1 });
    expect(a.profiles.resolve(imported.id).env.ANTHROPIC_API_KEY).toBe('synthetic-token-m8');
  });
  it('D02/D03/D04 requires an explicitly picked local directory or available source and rejects conflicts/symlinks', async () => {
    const a = setup('A'), fixture = transferFixture(); fixture.directories[0].path = folder('source');
    const p = await unlock(a.svc, fixture), d = initialTransferDraft(p);
    expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false);
    d.directories[0].localPath = fixture.directories[0].path; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false);
    d.directories[0].mode = 'source'; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(true);
    a.projects.createProject({ name: 'Occupied', aliases: [], description: '', rulesPath: null }, [{ label: '', path: fixture.directories[0].path }]);
    expect(a.svc.validateDraft(1, p.token, d).issues[0].message).toContain('使用');
    const alias = join(root, 'alias'); symlinkSync(fixture.directories[0].path, alias); a.svc.allowDirectory(1, p.token, alias); d.directories[0] = { ref: 'dir-1', mode: 'local', localPath: alias }; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false);
    d.directories[0].localPath = folder('valid'); a.svc.allowDirectory(1, p.token, d.directories[0].localPath); expect(a.svc.validateDraft(1, p.token, d).valid).toBe(true);
    rmSync(d.directories[0].localPath, { recursive: true }); expect(() => a.svc.commit(1, p.token, randomUUID(), d)).toThrow('目录'); expect(a.projects.listProjects()).toHaveLength(1);
  });
  it('D01/D05/D08 rechecks names, requires zero-source main folder, and clears unavailable rules', async () => {
    const a = setup('A'), fixture = transferFixture(); fixture.directories = []; fixture.project.rulesPath = '/missing/AGENTS.md';
    a.projects.createProject({ ...fixture.project, name: fixture.project.name });
    const p = await unlock(a.svc, fixture); expect(p.suggestedName).toBe('迁移项目（导入）'); expect(p.directories).toHaveLength(1); expect(p.directories[0].sourcePath).toBe('');
    const d = ready(a.svc, p); expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false); d.rulesPath = null;
    d.name = fixture.project.name; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false); d.name = p.suggestedName;
    const r = a.svc.commit(1, p.token, randomUUID(), d); expect(a.projects.getProject(r.projectId).dirs[0].isDefault).toBe(true);
  });
  it('D03 rejects duplicate realpaths within the same package, then accepts distinct mappings', async () => {
    const a = setup('duplicate-directories'), f = transferFixture();
    f.directories.push({ ref: 'dir-2', label: 'Web', path: '/source/web', isDefault: false });
    const p = await unlock(a.svc, f), d = ready(a.svc, p), distinct = d.directories[1].localPath!;
    d.directories[1].localPath = d.directories[0].localPath;
    expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false);
    const alias = join(root, 'same-package-alias'); symlinkSync(d.directories[0].localPath!, alias);
    a.svc.allowDirectory(1, p.token, alias); d.directories[1].localPath = alias;
    expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false);
    d.directories[1].localPath = distinct; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(true);
  });
  it('D06 preserves the second directory/default DB and all resource associations', async () => {
    const a = setup('default-relations'), f = transferFixture();
    f.directories[0].isDefault = false; f.directories.push({ ref: 'dir-2', label: '真正主目录', path: '/source/default', isDefault: true });
    f.databases[0].isDefault = false;
    f.databases.push({ ...f.databases[0], ref: 'db-2', label: '默认数据库', env: 'test', isDefault: true }); f.credentials['db-2'] = { password: 'second-password' };
    const p = await unlock(a.svc, f), d = ready(a.svc, p), r = a.svc.commit(1, p.token, randomUUID(), d), saved = a.projects.getProject(r.projectId);
    expect(saved.dirs.find(row => row.isDefault)?.label).toBe('真正主目录');
    expect(saved.dirs.find(row => row.isDefault)?.path).toBe(d.directories[1].localPath);
    const database = saved.databases.find(row => row.isDefault)!; expect(database.label).toBe('默认数据库');
    expect(a.secrets.get(`db:${database.id}:password`)).toBe('second-password');
    expect(saved.aliases).toEqual(f.project.aliases); expect(saved.description).toBe(f.project.description); expect(saved.configVersion).toBe(1);
    for (const resource of [...saved.dirs, ...saved.databases, ...saved.servers]) expect(resource.projectId).toBe(saved.id);
    expect(a.svc.snapshot(saved.id, [], []).capabilities).toEqual(f.capabilities);
  });
  it('S03 retains same-as-login sudo and selected secret/non-secret AI env through a full snapshot', async () => {
    const a = setup('sudo-login'), f = transferFixture(); f.servers[0].sudoPolicy = 'same-as-login'; delete f.credentials['ssh-1'].sudoPassword;
    const p = await unlock(a.svc, f), d = selectTransferProfiles(ready(a.svc, p), p, ['ai-1']), r = a.svc.commit(1, p.token, randomUUID(), d);
    const s = a.svc.snapshot(r.projectId, r.profileIds, []);
    expect(s.servers[0].sudoPolicy).toBe('same-as-login'); expect(s.servers[0].defaultRoot).toBe(true);
    expect(s.credentials[s.servers[0].ref]).toEqual({ password: 'synthetic-ssh-password' });
    expect(s.credentials[s.profiles[0].ref].env).toEqual({ ANTHROPIC_API_KEY: 'synthetic-token-m8' });
    expect(s.profiles[0].env.find(e => e.name === 'MODEL')).toEqual({ name: 'MODEL', secret: false, value: 'synthetic' });
    expect(a.profiles.defaultProfileId()).toBeNull();
  });
  it('F07 returns a committed receipt on identical retry, rejects changed selection and survives reopening', async () => {
    const a = setup('A'), p = await unlock(a.svc), d = ready(a.svc, p), requestId = randomUUID();
    const r = a.svc.commit(1, p.token, requestId, d); expect(a.svc.commit(1, p.token, requestId, d)).toEqual(r);
    expect(() => a.svc.commit(1, p.token, requestId, { ...d, name: 'changed' })).toThrow('已提交');
    const b = setup('A'); expect(b.svc.getResult(requestId)).toEqual(r); expect(b.projects.listProjects()).toHaveLength(1);
  });
  it('I07/F06 binds tokens to their window, disposes and expires previews', async () => {
    const a = setup('A'), p = await unlock(a.svc), d = ready(a.svc, p);
    expect(() => a.svc.validateDraft(2, p.token, d)).toThrow('失效');
    clock += 600_001; expect(() => a.svc.validateDraft(1, p.token, d)).toThrow('失效');
    const p2 = await unlock(a.svc); a.svc.disposeOwner(1); expect(() => a.svc.validateDraft(1, p2.token, initialTransferDraft(p2))).toThrow('失效'); expect(a.projects.listProjects()).toEqual([]);
  });
  it('I07 expires a selected encrypted file before starting a busy unlock', async () => {
    const a = setup('file-expiry'), path = join(root, 'expired.willyou'); writeFileSync(path, await encryptProject(transferFixture(), '12345678'));
    const file = a.svc.choose(1, path); clock += 600_001;
    await expect(a.svc.exclusive(1, () => a.svc.unlock(1, file.fileToken, '12345678'))).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    expect(a.projects.listProjects()).toEqual([]);
  });
  it('F01/F03 rolls back rows and all secrets when encryption fails mid-transaction, then retries', async () => {
    const a = setup('A'), p = await unlock(a.svc), d = ready(a.svc, p); a.cipher.failAfter = 1;
    expect(() => a.svc.commit(1, p.token, randomUUID(), d)).toThrow('回滚');
    expect(a.projects.listProjects()).toEqual([]); expect(a.client.sqlite.prepare('SELECT COUNT(*) n FROM app_secrets').get()).toEqual({ n: 0 });
    a.cipher.failAfter = Infinity; expect(a.svc.commit(1, p.token, randomUUID(), d).projectId).toBeTruthy();
  });
  it.each(['journal', 'key-staged', 'key-renamed', 'keys', 'rows', 'secrets'] as const)('S03/F02/F03 cleans key files on failure at %s and preserves existing data', async phase => {
    let failure = true;
    const a = setup('A', p => { if (p === phase && failure) throw Error('injected'); }), f = transferFixture();
    f.servers[0].authType = 'key'; f.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.from('synthetic-private-key').toString('base64') }, passphrase: 'synthetic-key-password', sudoPassword: 'synthetic-sudo' };
    const p = await unlock(a.svc, f), d = ready(a.svc, p), requestId = randomUUID();
    expect(() => a.svc.commit(1, p.token, requestId, d)).toThrow(); expect(a.projects.listProjects()).toEqual([]);
    expect(readdirSync(a.svc.keys.root)).toEqual(['journals']); expect(readdirSync(a.svc.keys.journals)).toEqual([]);
    failure = false; const r = a.svc.commit(1, p.token, requestId, d), key = a.projects.getProject(r.projectId).servers[0].privateKeyPath!;
    expect(readFileSync(key, 'utf8')).toBe('synthetic-private-key'); expect(statSync(key).mode & 0o777).toBe(0o600); expect(statSync(join(key, '..')).mode & 0o777).toBe(0o700);
    a.projects.deleteProject(r.projectId, { deleteSecrets: true }); expect(existsSync(key)).toBe(false);
  });
  it('F04 recovers interrupted key staging without a receipt and keeps unrelated external keys', () => {
    const a = setup('A'), request = randomUUID(), sid = randomUUID(), external = join(root, 'external-key'); writeFileSync(external, 'external');
    a.svc.keys.begin(request, [sid]); a.svc.keys.write(request, sid, Buffer.from('synthetic-private-key'));
    a.svc.recover(); expect(existsSync(a.svc.keys.path(sid))).toBe(false); expect(readFileSync(external, 'utf8')).toBe('external');
  });
  it('F04/F07 recovers an already committed import without duplicating or removing keys', async () => {
    let crash = true; const a = setup('A', phase => { if (phase === 'committed' && crash) throw Error('response lost'); });
    const f = transferFixture(); f.servers[0].authType = 'key'; f.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.from('synthetic-private-key').toString('base64') }, sudoPassword: 'sudo' };
    const p = await unlock(a.svc, f), d = ready(a.svc, p), request = randomUUID(); expect(() => a.svc.commit(1, p.token, request, d)).toThrow('已提交');
    crash = false; a.svc.recover(); const r = a.svc.getResult(request)!; expect(existsSync(a.projects.getProject(r.projectId).servers[0].privateKeyPath!)).toBe(true); expect(a.projects.listProjects()).toHaveLength(1); expect(readdirSync(a.svc.keys.journals)).toEqual([]);
  });
  it('E04 requires explicit empty-password confirmation and never skips missing credentials', async () => {
    const a = setup('A'), p = await unlock(a.svc), r = a.svc.commit(1, p.token, randomUUID(), ready(a.svc, p));
    const db = a.projects.getProject(r.projectId).databases[0]; a.secrets.delete(`db:${db.id}:password`);
    const info = a.svc.describeExport(r.projectId, []); expect(info.missing).toEqual([{ ref: `db-${db.id}`, label: '测试库', kind: '密码', allowEmpty: true }]);
    expect(() => a.svc.snapshot(r.projectId, [], [])).toThrow('补齐');
    const snapshot = a.svc.snapshot(r.projectId, [], [`db-${db.id}`]); expect(snapshot.credentials[`db-${db.id}`].password).toBe('');
    a.cipher.available = false; expect(() => a.svc.snapshot(r.projectId, [], [`db-${db.id}`])).toThrow('安全存储');
  });
  it('E06 preserves existing destination and removes temporary ciphertext on write failure', async () => {
    let fail = true; const a = setup('A', phase => { if (phase === 'export-write' && fail) throw Error('disk fault'); });
    const p = await unlock(a.svc), r = a.svc.commit(1, p.token, randomUUID(), ready(a.svc, p)), path = join(root, 'previous.willyou'); writeFileSync(path, 'previous');
    await expect(a.svc.exportTo(path, r.projectId, [], [], '12345678')).rejects.toThrow('保存'); expect(readFileSync(path, 'utf8')).toBe('previous'); expect(readdirSync(root).some(n => n.endsWith('.tmp'))).toBe(false);
    fail = false; await a.svc.exportTo(path, r.projectId, [], [], '12345678'); expect((await decryptProject(readFileSync(path), '12345678')).project.name).toBe(r.name);
    expect(transferFilename('a/b:c', new Date('2026-10-16'))).toBe('a_b_c-2026-10-16.willyou');
  });
  it('S02/S03 restores a real encrypted SSH key and authenticates only after an explicit connection test', async () => {
    const key = generateSshTestKey('synthetic-passphrase'), host = generateSshTestKey();
    const pub = utils.parseKey(key.public); if (pub instanceof Error) throw pub;
    const commands: string[] = [], clients: Connection[] = [];
    const server = new Server({ hostKeys: [host.private] }, client => {
      clients.push(client); client.on('error', () => {});
      client.on('authentication', ctx => ctx.method === 'publickey' && ctx.key.data.equals(pub.getPublicSSH()) ? ctx.accept() : ctx.reject());
      client.on('ready', () => client.on('session', accept => accept().on('exec', (acceptCommand, _reject, info) => { commands.push(info.command); const stream = acceptCommand(); stream.write('m8-isolated\ntester\n'); stream.exit(0); stream.end(); })));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    try {
      const f = transferFixture(); f.servers[0].authType = 'key'; f.servers[0].port = (server.address() as AddressInfo).port;
      f.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.from(key.private).toString('base64') }, passphrase: 'synthetic-passphrase', sudoPassword: 'synthetic-sudo' };
      const a = setup('key-receiver'), p = await unlock(a.svc, f), r = a.svc.commit(1, p.token, randomUUID(), ready(a.svc, p));
      expect(commands).toEqual([]);
      const ssh = a.projects.getProject(r.projectId).servers[0];
      const result = await testSsh({ ...ssh, password: '', passphrase: a.secrets.get(`server:${ssh.id}:passphrase`)! }, 3000);
      expect(result.ok).toBe(true); expect(commands).toEqual([SSH_TEST_COMMAND]);
      expect(a.secrets.get(`server:${ssh.id}:sudo`)).toBe('synthetic-sudo');
      expect(readFileSync(ssh.privateKeyPath!, 'utf8')).toBe(key.private);
    } finally { clients.forEach(c => c.end()); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('S04 refuses an import when safeStorage is unavailable, then succeeds after it recovers', async () => {
    const a = setup('storage'), p = await unlock(a.svc), d = ready(a.svc, p);
    a.cipher.available = false;
    expect(() => a.svc.commit(1, p.token, randomUUID(), d)).toThrow('安全存储');
    expect(a.projects.listProjects()).toEqual([]); expect(a.client.db.select().from(schema.appSecrets).all()).toEqual([]);
    a.cipher.available = true; expect(a.svc.commit(1, p.token, randomUUID(), d).counts.profiles).toBe(0);
  });
  it('E07 exports one consistent selected project snapshot and never includes task history or another project', async () => {
    let change: (() => void) | undefined;
    const a = setup('snapshot', phase => { if (phase === 'snapshot') change?.(); });
    const p = await unlock(a.svc), r = a.svc.commit(1, p.token, randomUUID(), ready(a.svc, p));
    a.projects.createProject({ name: 'not-in-export', aliases: [], description: 'unrelated', rulesPath: null });
    const db = a.projects.getProject(r.projectId).databases[0];
    change = () => { a.client.db.update(schema.projectDatabases).set({ host: 'changed.invalid' }).where(eq(schema.projectDatabases.id, db.id)).run(); };
    const f = a.svc.snapshot(r.projectId, [], []);
    expect(f.databases[0].host).toBe('127.0.0.1'); expect(a.projects.getProject(r.projectId).databases[0].host).toBe('changed.invalid');
    expect(JSON.stringify(f)).not.toContain('not-in-export'); expect(f).not.toHaveProperty('tasks'); expect(f).not.toHaveProperty('sessions');
  });
  it('F04/S05 rejects parallel operations and discards a decrypt result if its window closes', async () => {
    const a = setup('cancel'), path = join(root, 'file.willyou'); writeFileSync(path, await encryptProject(transferFixture(), '12345678'));
    const file = a.svc.choose(1, path); const pending = a.svc.exclusive(1, () => a.svc.unlock(1, file.fileToken, '12345678'));
    await expect(a.svc.exclusive(1, async () => 'duplicate')).rejects.toMatchObject({ code: 'BUSY' });
    a.svc.disposeOwner(1); await expect(pending).rejects.toMatchObject({ code: 'PREVIEW_EXPIRED' });
    expect(a.projects.listProjects()).toEqual([]);
  });
  it('D06/D09 imports only one of two AI configurations, never makes the first imported profile the default', async () => {
    const a = setup('profiles'), f = transferFixture();
    f.profiles.push({ ...f.profiles[0], ref: 'ai-2', name: 'Other', executable: '/bin/cat', env: [] });
    const p = await unlock(a.svc, f), d = selectTransferProfiles(ready(a.svc, p), p, ['ai-2']);
    const r = a.svc.commit(1, p.token, randomUUID(), d);
    expect(a.profiles.list()).toHaveLength(1); expect(a.profiles.defaultProfileId()).toBeNull();
    expect(a.profiles.resolve(r.profileIds[0]).command).toBe('/bin/cat');
    expect(a.client.db.select().from(schema.appSecrets).all().some(s => s.key.startsWith('ai:'))).toBe(false);
    expect(a.svc.snapshot(r.projectId, [], []).capabilities).toEqual(f.capabilities);
  });
  it('F05/F07 allows a second copy only with an independent name and unoccupied mapped directory', async () => {
    const a = setup('copies');
    const p = await unlock(a.svc), d = ready(a.svc, p, 'Original'); const r = a.svc.commit(1, p.token, randomUUID(), d);
    const original = a.projects.getProject(r.projectId), p2 = await unlock(a.svc), d2 = ready(a.svc, p2, 'Second');
    a.projects.createProject({ name: 'Late conflict', aliases: [], description: '', rulesPath: null }, [{ label: '', path: d2.directories[0].localPath! }]);
    expect(() => a.svc.commit(1, p2.token, randomUUID(), d2)).toThrow('使用');
    d2.directories[0].localPath = folder('new-independent'); a.svc.allowDirectory(1, p2.token, d2.directories[0].localPath);
    a.svc.commit(1, p2.token, randomUUID(), d2); expect(a.projects.getProject(r.projectId)).toEqual(original);
  });
  it('D01/D03 archives free names and directory identities; duplicate long names remain bounded', async () => {
    const a = setup('names'), f = transferFixture(); f.project.name = '名'.repeat(100); f.directories[0].path = folder('source');
    const original = a.projects.createProject({ ...f.project }, [{ path: f.directories[0].path, label: '主目录' }]);
    const p = await unlock(a.svc, f); expect(p.suggestedName.length).toBeLessThanOrEqual(100); expect(p.suggestedName).not.toBe(f.project.name);
    const d = initialTransferDraft(p); d.directories[0].mode = 'source'; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(false);
    a.client.db.update(schema.projects).set({ archivedAt: clock }).where(eq(schema.projects.id, original.id)).run();
    d.name = f.project.name; expect(a.svc.validateDraft(1, p.token, d).valid).toBe(true);
    a.svc.commit(1, p.token, randomUUID(), d); expect(a.projects.listProjects()).toHaveLength(1);
  });
  it('D06/S07 preserves zero default DB, empty passwords and a key without a passphrase', async () => {
    const a = setup('empty'), f = transferFixture(); f.databases[0].isDefault = false; f.credentials['db-1'].password = '';
    f.servers[0].authType = 'key'; f.servers[0].sudoPolicy = 'none'; f.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.from('synthetic-key').toString('base64') } };
    const p = await unlock(a.svc, f), r = a.svc.commit(1, p.token, randomUUID(), ready(a.svc, p)); const saved = a.projects.getProject(r.projectId);
    expect(saved.databases[0].isDefault).toBe(false); expect(a.secrets.get(`db:${saved.databases[0].id}:password`)).toBe(''); expect(saved.servers[0].hasPassphrase).toBe(false);
    expect(() => a.svc.snapshot(r.projectId, [], [])).not.toThrow();
  });
  it('D10 rejects unknown/duplicate profile refs and rolls back selected AI secrets before a single retry', async () => {
    let fail = true; const a = setup('ai-rollback', phase => { if (phase === 'secrets' && fail) throw Error('fail after AI'); });
    const p = await unlock(a.svc), d = selectTransferProfiles(ready(a.svc, p), p, ['ai-1']);
    for (const refs of [['unknown'], ['ai-1', 'ai-1']]) expect(() => a.svc.commit(1, p.token, randomUUID(), { ...d, selectedProfileRefs: refs })).toThrow();
    const request = randomUUID(); expect(() => a.svc.commit(1, p.token, request, d)).toThrow('回滚');
    expect(a.profiles.list()).toEqual([]); expect(a.client.db.select().from(schema.appSecrets).all()).toEqual([]);
    fail = false; const r = a.svc.commit(1, p.token, request, d); expect(a.svc.commit(1, p.token, request, d)).toEqual(r); expect(a.profiles.list()).toHaveLength(1);
  });
  it('D07 keeps an imported command blocked through metadata edits and clears it when explicitly configured', async () => {
    const a = setup('pending'), p = await unlock(a.svc), d = selectTransferProfiles(ready(a.svc, p), p, ['ai-1']);
    const r = a.svc.commit(1, p.token, randomUUID(), d), profile = a.profiles.get(r.profileIds[0]);
    const fields = { name: profile.name, runner: profile.runner, executable: profile.executable, args: profile.args, env: profile.env.map(e => ({ ...e, value: e.secret ? undefined : e.value })), color: profile.color, isDefault: profile.isDefault };
    a.profiles.update(profile.id, { ...fields, name: 'Renamed' }); expect(() => a.profiles.resolve(profile.id)).toThrow('尚未配置');
    a.profiles.update(profile.id, { ...fields, executable: '/bin/cat' }); expect(a.profiles.resolve(profile.id).command).toBe('/bin/cat');
  });
  it('E03 exports only selected AI secrets, excludes unselected profiles, and leaves the original default unchanged', async () => {
    const a = setup('export-profile'), p = await unlock(a.svc), r = a.svc.commit(1, p.token, randomUUID(), selectTransferProfiles(ready(a.svc, p), p, ['ai-1']));
    const other = a.profiles.create({ name: 'Existing default', runner: 'codex', executable: null, args: [], env: [{ name: 'OPENAI_API_KEY', secret: true, value: 'other-token' }], color: null, isDefault: true });
    const path = join(root, 'selected.willyou');
    await a.svc.exportTo(path, r.projectId, [r.profileIds[0]], [], '12345678');
    const parsed = await decryptProject(readFileSync(path), '12345678');
    expect(parsed.profiles).toHaveLength(1); expect(parsed.profiles[0].name).toBe('测试配置');
    expect(parsed.credentials[parsed.profiles[0].ref].env).toEqual({ ANTHROPIC_API_KEY: 'synthetic-token-m8' });
    expect(parsed.profiles[0].env.find(e => e.name === 'ANTHROPIC_API_KEY')?.value).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('other-token'); expect(JSON.stringify(parsed)).not.toContain('Existing default');
    expect(a.profiles.defaultProfileId()).toBe(other.id);
    await a.svc.exportTo(path, r.projectId, [], [], '12345678');
    const without = await decryptProject(readFileSync(path), '12345678');
    expect(without.profiles).toEqual([]); expect(Object.keys(without.credentials).some(ref => ref.startsWith('ai-'))).toBe(false);
  });
  it('F08 preserves referenced and external keys; unreadable ownership remains registered for recovery', async () => {
    const a = setup('key-lifecycle'), f = transferFixture(); f.servers[0].authType = 'key'; f.servers[0].sudoPolicy = 'none';
    f.credentials['ssh-1'] = { privateKey: { encoding: 'base64', data: Buffer.from('owned-key').toString('base64') } };
    const p = await unlock(a.svc, f), r = a.svc.commit(1, p.token, randomUUID(), ready(a.svc, p));
    const server = a.projects.getProject(r.projectId).servers[0], key = server.privateKeyPath!;
    a.svc.keys.cleanup(); expect(existsSync(key)).toBe(true);
    const marker = join(key, '..', '.willyou-owned.json'); chmodSync(marker, 0o000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try { a.projects.deleteServer(server.id, { deleteSecrets: true }); }
    finally { chmodSync(marker, 0o600); warn.mockRestore(); }
    expect(existsSync(key)).toBe(true); expect(a.client.db.select().from(schema.importedKeys).all()).toHaveLength(1);
    a.svc.recover(); expect(existsSync(key)).toBe(false); expect(a.client.db.select().from(schema.importedKeys).all()).toEqual([]);
    const external = join(root, 'external-key'); writeFileSync(external, 'external');
    const created = a.projects.createServer(r.projectId, { ...f.servers[0], privateKeyPath: external });
    a.projects.deleteServer(created.id, { deleteSecrets: true }); expect(readFileSync(external, 'utf8')).toBe('external');
    const p2 = await unlock(a.svc, f), r2 = a.svc.commit(1, p2.token, randomUUID(), ready(a.svc, p2));
    const replaced = a.projects.getProject(r2.projectId).servers[0], replacedKey = replaced.privateKeyPath!;
    a.projects.updateServer(replaced.id, { ...f.servers[0], privateKeyPath: external });
    expect(existsSync(replacedKey)).toBe(false); expect(readFileSync(external, 'utf8')).toBe('external');
  });
});
