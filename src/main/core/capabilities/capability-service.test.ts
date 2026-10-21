import {parseDocument} from 'yaml';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseInput, ProjectDetail } from '@shared/projects';
import { runBundledMigrations } from '../../db/migrations';
import * as schema from '../../db/schema';
import { planLaunchEnv } from '../../launch-env';
import { PtyManager } from '../../pty-manager';
import { SecretsStore } from '../../secrets';
import { ProjectService } from '../projects/project-service';
import { BUNDLED_SKILLS, treeHash } from './assets';
import { CapabilityService, RUNTIME_ISOLATION, type PreparedRuntime, type ManagedCapabilityPlacement } from './capability-service';
import { readOwnedTree, writeOwnedTree } from './files';
import { projectSkillName, standardNativeSkillName } from '../applications/session-projector';

let tmp: string;
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let projects: ProjectService;
let secrets: SecretsStore;
let svc: CapabilityService;
let a: ProjectDetail;
let b: ProjectDetail;
const services: CapabilityService[] = [];
const dbInput = (password: string, over: Partial<DatabaseInput> = {}): DatabaseInput => ({ env: 'test', label: 'primary', aliases: [], vendor: 'postgres', host: '127.0.0.1', port: 5432, database: 'alpha', schema: 'custom', username: 'tester', accessLevel: 'readonly', isDefault: true, note: '', password, ...over });
const filesIn = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? filesIn(p) : [p]; });

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'smartdd-m4-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  runBundledMigrations(sqlite);
  db = drizzle(sqlite, { schema });
  secrets = new SecretsStore(db, { isAvailable: () => true, encrypt: (s) => Buffer.from([...s].reverse().join('')), decrypt: (b) => [...b.toString()].reverse().join('') });
  projects = new ProjectService(db, secrets);
  for (const name of ['alpha', 'beta', 'home']) mkdirSync(join(tmp, name));
  mkdirSync(join(tmp, 'alpha', '.svn'));
  writeFileSync(join(tmp, 'alpha', 'keep.txt'), 'working copy');
  a = projects.createProject({ name: 'Alpha', aliases: ['A'], description: '', rulesPath: null }, [{ label: '', path: join(tmp, 'alpha') }]);
  b = projects.createProject({ name: 'Beta', aliases: ['B'], description: '', rulesPath: null }, [{ label: '', path: join(tmp, 'beta') }]);
  svc = new CapabilityService({ db, projects, secrets, userData: join(tmp, 'data') });
  services.push(svc);
});
afterEach(() => { services.splice(0).forEach((s) => s.dispose()); sqlite.close(); rmSync(tmp, { recursive: true, force: true }); });

function prepare(project = a, runner: 'claude' | 'codex' = 'claude', previous?: PreparedRuntime['snapshot'], service = svc) {
  return service.prepare({ projectId: project.id, taskId: 'task', runner, cwd: project.dirs[0].path, home: join(tmp, 'home'), profileArgs: [], previous });
}
function runGuard(run: PreparedRuntime, changes: Record<string, string | undefined> = {}) {
  const wrapped = run.wrap('/usr/bin/printf', ['RUNNER_REACHED']);
  const env = { PATH: process.env.PATH, HOME: join(tmp, 'home'), ...run.env, ...changes };
  return spawnSync(wrapped.command, wrapped.args, { env, encoding: 'utf8', timeout: 5000 });
}

describe('project runtime projection', () => {
  it('projects only the selected project, no raw credentials on disk/argv, with a matching config version', () => {
    const da = projects.createDatabase(a.id, dbInput('alpha-password'));
    projects.createDatabase(b.id, dbInput('beta-password', { database: 'beta' }));
    const runA = prepare(a);
    const runB = prepare(b);
    expect(Object.values(runA.env)).toContain('alpha-password');
    expect(Object.values(runA.env)).not.toContain('beta-password');
    expect(Object.values(runB.env)).toContain('beta-password');
    expect(Object.values(runB.env)).not.toContain('alpha-password');
    const cfg = JSON.parse(readFileSync(runA.env.PROJECT_DB_CONFIG, 'utf8'));
    expect(cfg.projects).toHaveLength(1);
    expect(cfg.projects[0].databases[0]).toMatchObject({ resourceId: da.id, schema: 'custom', type: 'postgres' });
    expect(cfg.configVersion).toBe(projects.getProject(a.id).configVersion);
    expect(cfg.configHash).toBe(runA.snapshot.configHash);
    const content = filesIn(join(tmp, 'data')).map((f) => readFileSync(f, 'utf8')).join('\n');
    expect(content).not.toContain('alpha-password');
    expect(content).not.toContain('beta-password');
    expect(JSON.stringify(runA.snapshot) + JSON.stringify(runA.wrap('claude', []))).not.toContain('alpha-password');
    expect(statSync(runA.env.PROJECT_DB_CONFIG).mode & 0o777).toBe(0o600);
    expect(filesIn(join(tmp, 'alpha')).map((f) => f.slice(join(tmp, 'alpha').length))).toEqual(['/keep.txt']);
  });

  it('disabled skills do not resolve or inject their resource secrets', () => {
    projects.createDatabase(a.id, dbInput('alpha-password'));
    svc.setEnabled(a.id, 'project-db-diagnostics', false);
    const run = prepare();
    expect(run.env.PROJECT_DB_CONFIG).toBeUndefined();
    expect(Object.values(run.env)).not.toContain('alpha-password');
    expect(svc.list(a.id).find((s) => s.id === 'project-db-diagnostics')?.enabled).toBe(false);
    expect(svc.list(b.id).every((s) => s.enabled)).toBe(true);
  });

  it('fails before launch for a missing required secret, without falling back to other projects', () => {
    projects.createDatabase(a.id, dbInput('unused', { password: undefined }));
    projects.createDatabase(b.id, dbInput('beta-password'));
    expect(() => prepare()).toThrow('缺少凭据');
  });

  it('maps compatible database vendors to transport, preserving vendor metadata', () => {
    projects.createDatabase(a.id, dbInput('pw', { vendor: 'panweidb' }));
    const run = prepare();
    expect(JSON.parse(readFileSync(run.env.PROJECT_DB_CONFIG, 'utf8')).projects[0].databases[0]).toMatchObject({ type: 'postgres', vendor: 'panweidb' });
  });

  it('uses references for SSH password, key passphrase and separate sudo credentials', () => {
    const key = join(tmp, 'id_key'); writeFileSync(key, 'key fixture');
    projects.createServer(a.id, { env: 'test', label: 'web', aliases: [], host: '127.0.0.1', port: 22, username: 'deploy', authType: 'key', privateKeyPath: key, defaultRoot: true, sudoPolicy: 'separate', appRoot: '/app', logsPath: '/log/app.log', note: '', password: 'unused-login-password', passphrase: 'key-passphrase', sudoPassword: 'sudo-password' });
    const run = prepare();
    expect(Object.values(run.env)).not.toContain('unused-login-password');
    expect(Object.values(run.env)).toEqual(expect.arrayContaining(['key-passphrase', 'sudo-password']));
    const server = JSON.parse(readFileSync(run.env.REMOTE_SERVERS_CONFIG, 'utf8')).servers[0];
    expect(server).toMatchObject({ authType: 'key', privateKeyPath: key, sudoPolicy: 'separate' });
    expect(server.password).toBeUndefined();
    expect(server.sudoPassword).toBeUndefined();
    expect(server.deployments.app.modules.app.logs.primary).toBe('/log/app.log');
  });

  it('retains skill versions for old tasks across upgrades, but refreshes resource config per run', () => {
    const old = prepare();
    const bundles = BUNDLED_SKILLS.map((s) => { const files = { ...s.files, 'SKILL.md': s.files['SKILL.md'] + '\nUpgrade fixture\n' }; return { ...s, files, version: '2.0.0', hash: treeHash(files) }; });
    const next = new CapabilityService({ db, projects, secrets, userData: join(tmp, 'data'), bundles }); services.push(next);
    expect(next.list().every((s) => s.updateAvailable)).toBe(true);
    for (const skill of bundles) next.upgrade(skill.id);
    projects.createDatabase(a.id, dbInput('new-password'));
    const resumed = prepare(a, 'claude', old.snapshot, next);
    const fresh = prepare(a, 'claude', undefined, next);
    expect(resumed.snapshot.skills.every((s) => s.version === '1.0.0')).toBe(true);
    expect(fresh.snapshot.skills.every((s) => s.version === '2.0.0')).toBe(true);
    expect(next.list().every((s) => s.versions.length === 2)).toBe(true);
    expect(resumed.snapshot.configVersion).toBeGreaterThan(old.snapshot.configVersion);
    old.release();
    expect(existsSync(old.snapshot.manifestPath)).toBe(false);
    expect(existsSync(resumed.snapshot.manifestPath)).toBe(true);
  });

  it('projects Codex into its own versioned names and disables inactive versions for each session', () => {
    const first = prepare(a, 'codex');
    svc.setEnabled(b.id, 'project-db-diagnostics', false);
    const second = prepare(b, 'codex');
    const path = first.snapshot.skills.find((s) => s.skillId === 'project-db-diagnostics')!.path;
    expect(path).toContain('/home/.agents/skills/smartdd-');
    expect(second.args.find((s) => s.startsWith('skills.config='))).toContain(`path=${JSON.stringify(path)},enabled=false`);
    expect(first.args.find((s) => s.startsWith('skills.config='))).toContain(`path=${JSON.stringify(path)},enabled=true`);
  });

  it('does not overwrite a user directory at the intended Codex projection path', () => {
    const skill = BUNDLED_SKILLS[0];
    const path = join(tmp, 'home', '.agents', 'skills', `smartdd-${skill.id}-${skill.hash.slice(0, 16)}`);
    mkdirSync(path, { recursive: true }); writeFileSync(join(path, 'SKILL.md'), 'user contents');
    expect(() => prepare(a, 'codex')).toThrow('用户内容');
    expect(readFileSync(join(path, 'SKILL.md'), 'utf8')).toBe('user contents');
  });

  it('backs up and reports changed owned projection contents, leaving the change intact', () => {
    const run = prepare(a, 'codex');
    const path = run.snapshot.skills[0].path;
    writeFileSync(path, 'local change');
    expect(() => prepare(a, 'codex')).toThrow(/差异：.*SKILL.md.*备份/);
    expect(readFileSync(path, 'utf8')).toBe('local change');
    expect(filesIn(join(tmp, 'data', 'capabilities', 'conflicts')).some((f) => readFileSync(f, 'utf8') === 'local change')).toBe(true);
  });
});

describe('terminal self-check and MCP', () => {
  it('executes the runner only after checks pass', () => {
    const run = prepare(); const result = runGuard(run);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('RUNNER_REACHED');
    expect(run.check()?.status).toBe('passed');
    expect(run.snapshot.skills.every((s) => s.loaded === 'unverified')).toBe(true);
  });

  it.each(['missing env', 'bad config', 'bad manifest', 'missing dependency'])('blocks runner on %s', (kind) => {
    const run = prepare();
    const changes: Record<string, string | undefined> = {};
    if (kind === 'missing env') changes.SMARTDD_PROJECT_ID = undefined;
    if (kind === 'bad config') writeFileSync(run.env.PROJECT_DB_CONFIG, '{}');
    if (kind === 'bad manifest') writeFileSync(run.snapshot.manifestPath, '{}');
    if (kind === 'missing dependency') {
      // Import shadowing verifies the real child import failure, without uninstalling any module.
      const moduleRoot = join(tmp, 'bad-modules'); mkdirSync(moduleRoot);
      writeFileSync(join(moduleRoot, 'pymysql.py'), 'raise ImportError("dummy secret in dependency failure")');
      projects.createDatabase(b.id, dbInput('dummy-secret', { vendor: 'mysql' }));
      const withDb = prepare(b);
      const result = runGuard(withDb, { PYTHONPATH: moduleRoot });
      expect(result.status).toBe(78); expect(result.stdout).not.toContain('RUNNER_REACHED');
      expect(withDb.check()?.issues).toContain('missing_dependency:pymysql');
      expect(result.stderr).not.toContain('dummy secret');
      return;
    }
    const result = runGuard(run, changes);
    expect(result.status).toBe(78); expect(result.stdout).not.toContain('RUNNER_REACHED');
    expect(run.check()?.status).toBe('failed');
  });

  it('actual PTY restores this project after rc files and strips another project’s inherited variables', async () => {
    writeFileSync(join(tmp, 'home', '.zshrc'), 'export SMARTDD_STALE_PASSWORD=from-rc\nexport PROJECT_DB_CONFIG=/wrong/from/rc\n');
    const run = prepare();
    const ptys = new PtyManager();
    const plan = planLaunchEnv({ HOME: join(tmp, 'home'), ZDOTDIR: join(tmp, 'home'), PATH: process.env.PATH!, SMARTDD_OLD_PASSWORD: 'old' }, run.env, RUNTIME_ISOLATION);
    const wrapped = run.wrap('python3', ['-c', 'import os; assert "SMARTDD_OLD_PASSWORD" not in os.environ; assert "SMARTDD_STALE_PASSWORD" not in os.environ; assert os.environ["PROJECT_DB_CONFIG"] != "/wrong/from/rc"; print("CHILD_SCOPE_OK")']);
    const outcome = await new Promise<{ code: number; out: string }>((resolve, reject) => {
      let out = ''; const timer = setTimeout(() => { ptys.killAll(); reject(new Error('PTY timeout')); }, 8000);
      ptys.on('data', (_id, data) => { out += data; });
      ptys.on('exit', (_id, code) => { clearTimeout(timer); resolve({ code, out }); });
      try { ptys.spawn({ ...wrapped, cwd: a.dirs[0].path, env: plan.env, scriptArgs: plan.scriptArgs }); } catch (e) { clearTimeout(timer); reject(e); }
    });
    expect(outcome.code, outcome.out).toBe(0); expect(outcome.out).toContain('CHILD_SCOPE_OK');
    expect(run.check()?.status).toBe('passed');
  }, 10_000);

  it('answers MCP initialize/tools/list/tools/call using only public current-project context', () => {
    projects.createDatabase(a.id, dbInput('never-in-mcp'));
    const run = prepare();
    const mcp = JSON.parse(readFileSync(join(dirname(run.snapshot.manifestPath), 'mcp.json'), 'utf8')).mcpServers[run.snapshot.mcp[0].name];
    const requests = [{ id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } }, { method: 'notifications/initialized' }, { id: 2, method: 'tools/list' }, { id: 3, method: 'tools/call', params: { name: 'project_context' } }];
    const result = spawnSync(mcp.command, mcp.args, { input: requests.map((r) => JSON.stringify({ jsonrpc: '2.0', ...r })).join('\n') + '\n', encoding: 'utf8', timeout: 5000 });
    expect(result.status, result.stderr).toBe(0);
    const replies = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(replies).toHaveLength(3);
    expect(replies[1].result.tools[0].name).toBe('project_context');
    const context = JSON.parse(replies[2].result.content[0].text);
    expect(context.projectId).toBe(a.id); expect(context.configVersion).toBe(projects.getProject(a.id).configVersion);
    expect(result.stdout).not.toContain('never-in-mcp'); expect(result.stdout).not.toContain(b.id);
  });
});

function managedPlacement(service = svc): ManagedCapabilityPlacement {
  const skills = service.selection(a.id), projections: ManagedCapabilityPlacement['projections'] = {};
  for (const skill of skills) {
    const source = readOwnedTree(join(tmp,'data/capabilities/packages',skill.skillId,skill.hash)), nativeName = standardNativeSkillName(skill.skillId,skill.hash), files = Object.fromEntries(Object.entries(source).map(([path,text]) => [path,path === 'SKILL.md' ? projectSkillName(Buffer.from(text),nativeName) : Buffer.from(text)])), root = join(tmp,'stable-capabilities',nativeName);
    writeOwnedTree(root,Object.fromEntries(Object.entries(files).map(([path,bytes]) => [path,bytes.toString('utf8')])),join(tmp,'conflicts')); projections[skill.versionId] = { path: join(root,'SKILL.md'),nativeName,files };
  }
  return { runId: randomUUID(),runtimeHash: service.runtimeIdentity().hash,mcpName: 'smartdd_project_original_name',skills,projections };
}
describe('M10 managed placement through the existing production project runtime', () => {
  it.each(['claude','codex'] as const)('uses fixed complete paths for %s without writing discovery directories or replacing user overrides', runner => {
    const placement = managedPlacement(), home = join(tmp,'home'), userConfig = join(home,'user-config.txt'); writeFileSync(userConfig,'existing user configuration');
    const run = svc.prepare({ projectId: a.id,taskId: 'task',runner,cwd: a.dirs[0].path,home,profileArgs: ['-c','skills.config=[{path="user",enabled=true}]'],managed: placement });
    expect(run.snapshot.runId).toBe(placement.runId); expect(run.snapshot.mcp[0].name).toBe(placement.mcpName); expect(run.args).toEqual([]); expect(existsSync(join(home,'.agents'))).toBe(false); expect(readFileSync(userConfig,'utf8')).toBe('existing user configuration');
    const context = JSON.parse(readFileSync(run.env.SMARTDD_PROJECT_CONTEXT,'utf8')); expect(context.skills.map((s: { path: string }) => s.path)).toEqual(placement.skills.map(s => placement.projections[s.versionId].path));
    const manifest = JSON.parse(readFileSync(run.snapshot.manifestPath,'utf8')); for (const p of Object.values(placement.projections)) expect(Object.keys(manifest.files)).toContain(p.path); expect(runGuard(run).stdout).toContain('RUNNER_REACHED'); expect(run.check()?.status).toBe('passed');
    run.release(); for (const p of Object.values(placement.projections)) expect(existsSync(p.path)).toBe(true);
  });
  it('does not let ordinary service disposal remove managed transient files before an owned exit releases them', () => {
    const placement = managedPlacement(), run = svc.prepare({ projectId: a.id,taskId: 'task',runner: 'claude',cwd: a.dirs[0].path,home: join(tmp,'home'),profileArgs: [],managed: placement }); svc.dispose(); expect(existsSync(run.snapshot.manifestPath)).toBe(true); run.release(); expect(existsSync(run.snapshot.manifestPath)).toBe(false); expect(existsSync(Object.values(placement.projections)[0].path)).toBe(true);
  });
  it('rejects incomplete or changed projected standard bytes before a native launch', () => {
    const placement = managedPlacement(), first = Object.values(placement.projections)[0]; writeFileSync(first.path,'changed'); expect(() => svc.prepare({ projectId: a.id,taskId: 'task',runner: 'claude',cwd: a.dirs[0].path,home: join(tmp,'home'),profileArgs: [],managed: placement })).toThrow('投影内容不同');
  });
  it('uses the recorded legacy runtime hash rather than the current bundled default', () => {
    const placement = managedPlacement(), original = svc.runtimeIdentity(), scripts = readOwnedTree(original.path), oldFiles = { ...scripts,'legacy-fixture-version.txt': 'controlled retained legacy code variant' }, oldHash = treeHash(oldFiles), root = join(tmp,'data/capabilities/runtime',oldHash); writeOwnedTree(root,oldFiles,join(tmp,'conflicts')); placement.runtimeHash = oldHash;
    const run = svc.prepare({ projectId: a.id,taskId: 'task',runner: 'claude',cwd: a.dirs[0].path,home: join(tmp,'home'),profileArgs: [],managed: placement }); expect(run.wrap('/usr/bin/printf',['x']).args[0]).toContain(oldHash); expect(run.wrap('/usr/bin/printf',['x']).args[0]).not.toContain(original.hash); expect(runGuard(run).stdout).toContain('RUNNER_REACHED');
  });
  it('preserves an already-recorded MCP name when an unmanaged legacy task resumes under a new run ID', () => {
    const first = prepare(), oldName = first.snapshot.mcp[0].name; first.release(); const second = prepare(a,'claude',first.snapshot); expect(second.snapshot.runId).not.toBe(first.snapshot.runId); expect(second.snapshot.mcp[0].name).toBe(oldName); expect(Object.keys(JSON.parse(readFileSync(join(dirname(second.snapshot.manifestPath),'mcp.json'),'utf8')).mcpServers)).toEqual([oldName]);
  });
});


function originalManagedPlacement(){
 const placement=managedPlacement();for(const skill of placement.skills){const source=readOwnedTree(join(tmp,'data/capabilities/packages',skill.skillId,skill.hash)),front=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source['SKILL.md'])!,nativeName=parseDocument(front[1]).get('name') as string,dir=join(tmp,'original-static',skill.skillId);writeOwnedTree(dir,source,join(tmp,'conflicts'));placement.projections[skill.versionId]={path:join(dir,'SKILL.md'),nativeName,format:'legacy-tree-v1',files:Object.fromEntries(Object.entries(source).map(([p,t])=>[p,Buffer.from(t)]))};}return placement;
}
describe('M4 original complete source placement',()=>{
 it.each(['claude','codex'] as const)('keeps original %s Skill bytes and names while building a new current-policy transient context',runner=>{
  const placement=originalManagedPlacement(),before=Object.values(placement.projections).map(p=>readFileSync(p.path)),run=svc.prepare({projectId:a.id,taskId:'task',runner,cwd:a.dirs[0].path,home:join(tmp,'home'),profileArgs:[],managed:placement});expect(run.snapshot.skills.map(s=>s.path)).toEqual(Object.values(placement.projections).map(p=>p.path));Object.values(placement.projections).forEach((p,i)=>{expect(readFileSync(p.path)).toEqual(before[i]);expect(p.files['SKILL.md']).toEqual(before[i]);});expect(runGuard(run).stdout).toContain('RUNNER_REACHED');run.release();
 });
 it.each(['name','bytes'] as const)('rejects altered original projection %s without rewriting the source or target',kind=>{
  const placement=originalManagedPlacement(),p=Object.values(placement.projections)[0],bytes=readFileSync(p.path);if(kind==='name')p.nativeName='different-original-name';else p.files={...p.files,'SKILL.md':Buffer.from('different original bytes')};expect(()=>svc.prepare({projectId:a.id,taskId:'task',runner:'claude',cwd:a.dirs[0].path,home:join(tmp,'home'),profileArgs:[],managed:placement})).toThrow(kind==='name'?'名称':'内容不同');expect(readFileSync(p.path)).toEqual(bytes);
 });
});
