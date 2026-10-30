import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';
import { runBundledMigrations } from '@main/db/migrations';
import { FileWorkspacePersistence } from '@main/core/files/workspace-persistence';
import { FileSourceResolver } from '@main/core/files/sources';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileScope } from '@shared/files';
import type { FileRoute, SavedFileWorkspace, WorkspacePersistence } from '@shared/file-workspace';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
const scope = { kind: 'project' as const, projectId: 'm07-local-boundary' };
const key = `fileWorkspace.v1:project:${scope.projectId}`;
const evidence: Record<string, unknown> = { caseId: 'M9-T-M07', layer: 'I; real SQLite/source resolver/native broker/store; no App GUI', runs: [] };
const rows = evidence.runs as Record<string, unknown>[];
let fixture: string, sqlite: Database.Database, files: FileService, broker: NativeFileBroker, persistence: FileWorkspacePersistence;
let queries: string[];
const stores: FileWorkspaceStore[] = [];
function workspace(owner: string) {
  const api = {
    roots: async () => files.openScope(owner, scope), list: (request: Parameters<FileClient['list']>[0]) => files.list(owner, request),
    open: vi.fn((request: Parameters<FileClient['open']>[0]) => files.open(owner, request)),
    read: (ref: Parameters<FileClient['read']>[0]) => files.read(owner, ref), refresh: (ref: Parameters<FileClient['refresh']>[0]) => files.refresh(owner, ref),
    drafts: async (ref: Parameters<FileClient['drafts']>[0]) => files.drafts(owner, ref),
    closeDocument: async (ref: Parameters<FileClient['closeDocument']>[0]) => files.closeDocument(owner, ref), closeScope: async () => files.closeScope(owner, scope),
  };
  const storage: WorkspacePersistence = { load: async () => persistence.load(scope), save: async (_scope, value) => persistence.save(scope, value) };
  const store = new FileWorkspaceStore(scope, api as unknown as FileClient, null, storage); stores.push(store); return { store, api };
}
const raw = () => (sqlite.prepare('SELECT value FROM app_settings WHERE key=?').get(key) as { value: string }).value;
const route = (): FileRoute => ({ source: 'project-directory', sourceId: 'local', sourcePath: join(fixture, 'root'), relativePath: 'hello.txt', mode: 'source' });
const state = (routes: FileRoute[]): SavedFileWorkspace => ({ schemaVersion: 1, routes, active: routes[0] ?? null, treeSource: null, expanded: {}, collapsedRoots: [], filters: {}, treeWidth: 250 });
function seed(value: unknown) { sqlite.prepare('INSERT OR REPLACE INTO app_settings(key,value,updated_at) VALUES(?,?,?)').run(key, JSON.stringify(value), 1); }

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_NONLOCAL_APP)('M07 existing SSH is never a file root authority', () => {
  beforeEach(() => {
    const resources = join(process.env.SMARTDD_NONLOCAL_APP!, 'Contents/Resources'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
    const DatabaseClass = packagedRequire('better-sqlite3') as typeof Database;
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-m07-'))); mkdirSync(join(fixture, 'root')); mkdirSync(join(fixture, 'userdata'));
    writeFileSync(join(fixture, 'root/hello.txt'), 'Local root remains available 中文🙂\n');
    queries = []; sqlite = new DatabaseClass(join(fixture, 'workspace.sqlite'), { verbose: sql => queries.push(String(sql)) }); runBundledMigrations(sqlite);
    const db = drizzle(sqlite, { schema }), times = { createdAt: 1, updatedAt: 1 };
    db.insert(schema.projects).values({ id: scope.projectId, name: 'M07 synthetic', ...times }).run();
    db.insert(schema.projectDirs).values([{ id: 'local', projectId: scope.projectId, label: 'local', path: join(fixture, 'root'), ...times }, { id: 'remote', projectId: scope.projectId, label: 'remote', path: 'ssh://fixture.invalid/remote', ...times }]).run();
    db.insert(schema.projectServers).values({ id: 'ssh-fixture', projectId: scope.projectId, env: 'test', host: 'fixture.invalid', username: 'synthetic', authType: 'password', appRoot: join(fixture, 'root'), ...times }).run();
    db.insert(schema.appSecrets).values({ key: 'ssh:fixture:password', secret: 'synthetic-not-a-real-secret' }).run();
    persistence = new FileWorkspacePersistence(db); broker = new NativeFileBroker(join(resources, 'native/willyou-files'));
    const resolver = new FileSourceResolver(db); files = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(fixture, 'userdata'), resolver));
    queries.length = 0;
    evidence.runtime = { app: process.env.SMARTDD_NONLOCAL_APP, nativeSha256: createHash('sha256').update(readFileSync(join(resources, 'native/willyou-files'))).digest('hex'), platform: process.platform, arch: process.arch };
  });
  afterEach(async () => { for (const store of stores.splice(0)) store.dispose(); if (files) await files.watcher.dispose(); broker?.dispose(); if (sqlite?.open) sqlite.close(); if (fixture) rmSync(fixture, { recursive: true, force: true }); });

  it('rejects a remote root explicitly while opening the local one without querying configured SSH or secrets', async () => {
    const request = vi.spyOn(broker, 'request'), roots = await files.openScope('local-window', scope);
    expect(roots.roots.map(root => root.sourceId)).toEqual(['local']);
    expect(roots.unavailable).toEqual([expect.objectContaining({ sourceId: 'remote', reason: expect.stringContaining('本期不支持远程工作区') })]);
    const file = await files.open('local-window', { lease: roots.roots[0].lease, generation: roots.roots[0].generation, relativePath: 'hello.txt' });
    expect(Buffer.from((await files.read('local-window', file.ref)).base64, 'base64').toString()).toContain('Local root remains available');
    expect(queries.filter(sql => /^select/i.test(sql))).not.toEqual(expect.arrayContaining([expect.stringMatching(/project_servers|app_secrets/i)]));
    expect(request.mock.calls.some(([input]) => JSON.stringify(input).includes('ssh://'))).toBe(false);
    rows.push({ scenario: 'configured-ssh-and-local-root', rootIds: roots.roots.map(root => root.sourceId), unavailable: roots.unavailable, sourceSelects: queries.filter(sql => /^select/i.test(sql)), result: 'passed' });
  });

  it('rejects nonlocal host and remotePath inputs before revoking an existing local capability', async () => {
    const roots = await files.openScope('same-window', scope), root = roots.roots[0], request = vi.spyOn(broker, 'request');
    request.mockClear();
    for (const hint of [{ hostId: 'ssh-fixture' }, { remotePath: join(fixture, 'root') }, { hostId: 'local', remotePath: '/remote' }]) {
      await expect(Promise.resolve().then(() => files.openScope('same-window', { ...scope, ...hint } as FileScope))).rejects.toMatchObject({ code: 'UNSUPPORTED', message: expect.stringContaining('本期不支持远程工作区') });
    }
    expect(request).not.toHaveBeenCalled();
    expect((await files.list('same-window', { lease: root.lease, generation: root.generation, relativePath: '' })).some(entry => entry.name === 'hello.txt')).toBe(true);
    rows.push({ scenario: 'host-and-remotePath-injection', rejected: 3, existingLocalCapabilityStillWorks: true, result: 'passed' });
  });

  it('restores same-path nonlocal historical descriptors as unavailable without deleting them or blocking the local tab', async () => {
    const local = route(), remote = { ...local, hostId: 'ssh-fixture' }, remotePath = { ...local, remotePath: local.sourcePath }, remoteUri = { ...local, sourcePath: 'ssh://fixture.invalid/remote' };
    seed(state([remote, remotePath, remoteUri, local]));
    const { store, api } = workspace('restored'); await store.initialize(); await store.flushPersistence();
    expect(store.error).toBe(''); expect(store.roots.roots).toHaveLength(1); expect(store.tabs).toHaveLength(4);
    for (const tab of store.tabs.slice(0, 3)) { expect(tab.buffer).toBeNull(); expect(tab.error).toContain('本期不支持远程工作区'); expect(tab.loading).toBe(false); }
    expect(store.tabs[3].buffer?.raw).toContain('Local root remains available'); expect(api.open).toHaveBeenCalledTimes(1);
    expect(JSON.parse(raw()).routes).toEqual([remote, remotePath, remoteUri, local]);
    rows.push({ scenario: 'historical-host-isolation', persisted: JSON.parse(raw()), errors: store.tabs.slice(0, 3).map(tab => tab.error), localReadCalls: api.open.mock.calls.length, result: 'passed' });
  });

  it('retains an unrecognized schema verbatim without granting access, then retries a corrected descriptor', async () => {
    seed({ ...state([route()]), futureRemoteSchema: { hostId: 'ssh-fixture', remotePath: '/remote' } }); const before = raw();
    const { store } = workspace('unrecognized-history'); await store.initialize();
    expect(store.treeRoot).toBeNull(); expect(store.error).toContain('原记录仍保留'); expect(store.tabs).toEqual([]);
    await store.flushPersistence(); expect(raw()).toBe(before);
    const preservedHash = createHash('sha256').update(raw()).digest('hex');
    // Unknown schema retains the established L12 fail-closed contract. Only
    // valid known historical nonlocal descriptors may restore alongside local.
    seed(state([route()])); await store.initialize(); await store.flushPersistence();
    expect(store.treeRoot?.sourceId).toBe('local'); expect(store.active?.buffer?.raw).toContain('Local root remains available');
    rows.push({ scenario: 'unknown-schema-preserved', beforeHash: createHash('sha256').update(before).digest('hex'), preservedHash, retryLocalRootUsable: true, result: 'passed' });
  });
});
afterAll(() => { if (process.env.SMARTDD_NONLOCAL_EVIDENCE) writeFileSync(process.env.SMARTDD_NONLOCAL_EVIDENCE, JSON.stringify(evidence, null, 2) + '\n'); });
