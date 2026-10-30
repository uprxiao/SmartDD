import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@main/db/schema';
import { runBundledMigrations } from '@main/db/migrations';
import { FileWorkspacePersistence } from '@main/core/files/workspace-persistence';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore, recoveryProjectKey } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { createFileController } from '@main/core/files/controller';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { fileWorkspaceEvent } from '@shared/events';
import { fileWorkspaceSchema, type FileRoute, type SavedFileWorkspace, type WorkspacePersistence } from '@shared/file-workspace';
import type { FileRoot } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const scope = { kind: 'project' as const, projectId: 'lifecycle-acceptance' };
const key = `fileWorkspace.v1:project:${scope.projectId}`;
const output: Record<string, unknown> = { cases: ['M9-T-L11', 'M9-T-L12', 'M9-T-L13'], startedAt: new Date().toISOString(), runs: [] };
let fixture: string, executable: string, DatabaseClass: typeof Database;
const connections: Database.Database[] = [], brokers: NativeFileBroker[] = [], services: FileService[] = [], stores: FileWorkspaceStore[] = [];
const rows = output.runs as Record<string, unknown>[];
function database() {
  const sqlite = new DatabaseClass(join(fixture, 'workspace.sqlite'));
  sqlite.pragma('journal_mode = WAL'); sqlite.pragma('busy_timeout = 5000'); sqlite.pragma('foreign_keys = ON');
  connections.push(sqlite); runBundledMigrations(sqlite);
  return { sqlite, persistence: new FileWorkspacePersistence(drizzle(sqlite, { schema })) };
}
function service() {
  const broker = new NativeFileBroker(executable); brokers.push(broker);
  const resolver = { sources: () => ['one', 'two'].map(id => ({ kind: 'project-directory' as const, id, path: join(fixture, id), label: id, projectId: scope.projectId })) };
  const recovery = new FileRecoveryStore(broker, join(fixture, 'userdata'), resolver);
  const files = new FileService(new FileRootsService(resolver, broker), broker, recovery); services.push(files);
  return { broker, recovery, files };
}
function workspace(owner: string, files: FileService, persistence: FileWorkspacePersistence) {
  const adapter = {
    load: vi.fn(async () => persistence.load(scope)),
    save: vi.fn(async (_scope, value) => persistence.save(scope, value)),
  } satisfies WorkspacePersistence;
  const api = {
    roots: vi.fn(async () => files.openScope(owner, scope)),
    list: vi.fn((request) => files.list(owner, request)), open: vi.fn((request) => files.open(owner, request)),
    read: vi.fn((ref) => files.read(owner, ref)), refresh: vi.fn((ref) => files.refresh(owner, ref)),
    drafts: vi.fn(async (ref) => files.drafts(owner, ref)), readDraft: vi.fn((ref, id) => files.readDraft(owner, ref, id)),
    checkpoint: vi.fn((request) => files.checkpoint(owner, request)), save: vi.fn((request) => files.save(owner, request)),
    resolveDraft: vi.fn((request) => files.resolveDraft(owner, request)),
    closeDocument: vi.fn(async (ref) => files.closeDocument(owner, ref)), closeScope: vi.fn(async () => files.closeScope(owner, scope)),
  };
  const store = new FileWorkspaceStore(scope, api as unknown as FileClient, null, adapter); stores.push(store);
  return { store, api, adapter };
}
const route = (relativePath: string, sourceId = 'one', mode: 'document' | 'source' = 'document'): FileRoute => ({ source: 'project-directory', sourceId, sourcePath: join(fixture, sourceId), relativePath, mode });
const state = (routes: FileRoute[]): SavedFileWorkspace => ({ schemaVersion: 1, routes, active: routes[0] ?? null, treeSource: null, expanded: {}, collapsedRoots: [], filters: {}, treeWidth: 250 });
const names = (store: FileWorkspaceStore) => store.tabs.map(tab => tab.route.relativePath);
const raw = (sqlite: Database.Database) => (sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string }).value;
const rootKey = (root: FileRoot) => `${root.source}:${root.sourceId}:${root.path}`;
function forbiddenPaths(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return typeof value === 'function' || typeof value === 'string' && value.startsWith('blob:') ? [prefix] : [];
  return Object.entries(value).flatMap(([key, child]) => /^(?:lease|rootLease|watchId|requestId|blobURL|objectURL|editor|editorState)$/i.test(key) ? [`${prefix}.${key}`] : forbiddenPaths(child, `${prefix}.${key}`));
}
const until = async (condition: () => boolean) => {
  const end = Date.now() + 5000;
  while (!condition()) { if (Date.now() > end) throw new Error('workspace state did not settle'); await new Promise(resolve => setTimeout(resolve, 5)); }
};
function rpcWindows(files: FileService, persistence: FileWorkspacePersistence) {
  class Sender extends EventEmitter {
    mainFrame: { processId: number; routingId: number }; destroyed = false;
    constructor(readonly id: number) { super(); this.mainFrame = { processId: id + 1000, routingId: id + 2000 }; }
    isDestroyed = () => this.destroyed;
    send = vi.fn((channel: string, value: unknown) => this.emit(channel, structuredClone(value)));
  }
  const senders = new Set<Sender>(), handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
  registerRPCRouter({ files: createFileController(files, event => senders.has(event.sender as unknown as Sender), persistence) }, { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler) } as unknown as IpcMain);
  return (id: number, ownScope = scope as import('@shared/files').FileScope) => {
    const sender = new Sender(id); senders.add(sender);
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    const invoke = vi.fn(async (method: string, ...args: unknown[]) => handlers.get(`files.${method}`)!(event, ...args));
    const api = new Proxy({}, { get: (_target, key) => (...args: unknown[]) => invoke(String(key), ...args) }) as FileClient;
    const adapter: WorkspacePersistence = { load: input => api.workspace(input), snapshot: input => api.workspaceSnapshot(input), commit: (input, value, revision, id) => api.saveWorkspace(input, value, revision, id), subscribe: listener => { sender.on(fileWorkspaceEvent.name, listener); return () => { sender.off(fileWorkspaceEvent.name, listener); }; } };
    const store = new FileWorkspaceStore(ownScope, api, null, adapter); stores.push(store);
    return { store, sender, invoke, event, api, rawInvoke: (context: IpcMainInvokeEvent, method: string, ...args: unknown[]) => handlers.get(`files.${method}`)!(context, ...args) };
  };
}

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_LIFECYCLE_APP)('M9 lifecycle persistence production SQLite/store/broker integration', () => {
  beforeEach(() => {
    const resources = join(process.env.SMARTDD_LIFECYCLE_APP!, 'Contents/Resources'), packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
    DatabaseClass = packagedRequire('better-sqlite3'); executable = join(resources, 'native/willyou-files');
    const originalFs = packagedRequire('original-fs') as typeof import('node:fs');
    output.resources = { package: process.env.SMARTDD_LIFECYCLE_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(executable)), sqliteVersion: packagedRequire('better-sqlite3/package.json').version, platform: process.platform, arch: process.arch };
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-lifecycle-')));
    for (const name of ['one', 'two', 'two/sub', 'userdata']) mkdirSync(join(fixture, name));
    writeFileSync(join(fixture, 'one/a.md'), '# A original\n'); writeFileSync(join(fixture, 'one/b.csv'), 'name,value\nB,2\n'); writeFileSync(join(fixture, 'one/preview.txt'), 'Clean preview\n');
    writeFileSync(join(fixture, 'one/icon.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><path d="M0 0"/></svg>');
  });
  afterEach(async () => {
    stores.splice(0).forEach(store => store.dispose());
    for (const files of services.splice(0)) await files.watcher.dispose();
    brokers.splice(0).forEach(broker => broker.dispose());
    connections.splice(0).forEach(sqlite => { if (sqlite.open) sqlite.close(); });
    if (fixture) rmSync(fixture, { recursive: true, force: true });
  });

  it('L11: a committed second-window snapshot reaches the already open first window without echo writes', async () => {
    const firstDb = database(), secondDb = database(), { files } = service();
    firstDb.persistence.save(scope, state([route('a.md')]));
    const makeWindow = rpcWindows(files, firstDb.persistence), first = makeWindow(11), second = makeWindow(12), other = makeWindow(13, { kind: 'task', taskId: 'other-scope' });
    await first.store.initialize(); await first.store.flushPersistence();
    await second.store.initialize(); await second.store.flushPersistence();
    await other.store.initialize(); await other.store.flushPersistence();
    const writes = () => first.invoke.mock.calls.filter(([method]) => method === 'saveWorkspace').length;
    const initialWrites = writes(), firstBuffer = first.store.active!.buffer, otherEvents = other.sender.send.mock.calls.length;
    await first.store.flushPersistence(); await first.store.flushPersistence();
    expect(writes()).toBe(initialWrites);
    await second.store.open(second.store.roots.roots[0], 'b.csv', true); await second.store.flushPersistence();
    await until(() => first.store.tabs.some(tab => tab.route.relativePath === 'b.csv' && tab.buffer?.loadState === 'ready'));
    const event = first.sender.send.mock.calls.filter(([channel]) => channel === fileWorkspaceEvent.name).at(-1)![1];
    first.sender.send(fileWorkspaceEvent.name, event); first.sender.send(fileWorkspaceEvent.name, { ...(event as object), revision: 1 });
    expect(first.store.tabs.find(tab => tab.route.relativePath === 'a.md')?.buffer).toBe(firstBuffer);
    expect(first.store.tabs).toHaveLength(2); expect(other.sender.send.mock.calls).toHaveLength(otherEvents);
    expect(first.store.roots.roots[0].lease).not.toBe(second.store.roots.roots[0].lease);
    const record = { case: 'M9-T-L11', sample: 'registered RPC / exact-scope broadcast / own-duplicate-old echo', databaseRoutes: secondDb.persistence.load(scope)!.routes.map(item => item.relativePath), firstWindowRoutes: names(first.store), secondWindowRoutes: names(second.store), writesBefore: initialWrites, writesAfter: writes(), bufferIdentityRetained: first.store.tabs.find(tab => tab.route.relativePath === 'a.md')?.buffer === firstBuffer, otherScopeEventsAdded: other.sender.send.mock.calls.length - otherEvents, revisions: first.sender.send.mock.calls.map(([, value]) => (value as { revision: number }).revision), pass: true };
    rows.push(record);
    expect(record.firstWindowRoutes).toEqual(record.secondWindowRoutes);
    expect(writes()).toBe(initialWrites);
    expect(() => first.rawInvoke({ ...first.event, senderFrame: {} } as IpcMainInvokeEvent, 'workspaceSnapshot', scope)).toThrow('UNTRUSTED');
    first.sender.emit('render-process-gone'); const count = first.sender.send.mock.calls.length;
    second.store.setFilter('after-first-window-gone'); await second.store.flushPersistence();
    expect(first.sender.send.mock.calls).toHaveLength(count); first.store.dispose(); expect(first.sender.listenerCount(fileWorkspaceEvent.name)).toBe(0);
  });

  it('L11: stale CAS returns the latest snapshot, does not write, and keeps revisions monotonic in the same millisecond', () => {
    const first = database(), second = database(), original = state([route('a.md')]);
    const zero = first.persistence.snapshot(scope); expect(zero).toEqual({ state: null, revision: 0 });
    const time = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const a = first.persistence.commit(scope, original, 0), b = second.persistence.commit(scope, state([route('b.csv')]), a.revision);
      const stale = first.persistence.commit(scope, original, a.revision), same = second.persistence.commit(scope, b.state!, b.revision);
      expect(a.revision).toBe(1000); expect(b.revision).toBe(1001); expect(stale).toEqual({ ...b, accepted: false }); expect(same).toEqual(b);
      expect(first.persistence.load(scope)).toEqual(b.state); expect(() => first.persistence.commit(scope, original, -1)).toThrow('INVALID_INPUT');
      rows.push({ case: 'M9-T-L11', sample: 'two SQLite connections / stale CAS / monotonic timestamp', initialRevision: a.revision, secondRevision: b.revision, staleAccepted: stale.accepted, noOpRevision: same.revision, pass: true });
    } finally { time.mockRestore(); }
  });

  it('L11: a remote layout cannot remove local dirty data or selection; explicit retry uses CAS without saving the file', async () => {
    const db = database(), { files } = service(); db.persistence.save(scope, state([route('a.md')]));
    const makeWindow = rpcWindows(files, db.persistence), first = makeWindow(21), second = makeWindow(22);
    await first.store.initialize(); await first.store.flushPersistence(); await second.store.initialize(); await second.store.flushPersistence();
    const tab = first.store.active!, buffer = tab.buffer!, sourcePath = join(fixture, 'one/a.md'), original = sha(readFileSync(sourcePath));
    const change = buffer.editor!.update({ changes: { from: 0, insert: 'LOCAL ' }, selection: { anchor: 6 } }); buffer.acceptTransactions(change.state, [change]);
    await second.store.close(second.store.active!.id); await second.store.flushPersistence();
    await until(() => first.store.persistenceConflict);
    expect(first.store.active).toBe(tab); expect(tab.buffer).toBe(buffer); expect(buffer.raw).toBe('LOCAL # A original\n'); expect(buffer.editor!.selection.main.head).toBe(6);
    await expect(first.store.reloadPersistence()).rejects.toThrow('请先处理'); await expect(first.store.flushPersistence()).rejects.toThrow('另一窗口');
    await first.store.retryPersistence();
    expect(first.store.persistenceConflict).toBe(false); expect(db.persistence.load(scope)!.routes.map(route => route.relativePath)).toEqual(['a.md']);
    expect(buffer.dirty).toBe(true); expect(sha(readFileSync(sourcePath))).toBe(original);
    rows.push({ case: 'M9-T-L11', sample: 'remote removal / local dirty + selection / explicit layout-only retry', activeIdentityRetained: first.store.active === tab, dirtyText: buffer.raw, selection: buffer.editor!.selection.main.head, sourceHashUnchanged: sha(readFileSync(sourcePath)) === original, pass: true });
  });

  it('L11: keeps a chosen active file and preview while applying order and initializes an existing SVG source buffer', async () => {
    const db = database(), { files } = service(); db.persistence.save(scope, state([route('a.md'), route('icon.svg')]));
    const makeWindow = rpcWindows(files, db.persistence), first = makeWindow(31), second = makeWindow(32);
    await first.store.initialize(); await first.store.flushPersistence(); await second.store.initialize(); await second.store.flushPersistence();
    const a = first.store.tabs[0], svg = first.store.tabs[1], svgBuffer = svg.buffer!;
    expect(svgBuffer.editor).toBeNull();
    await first.store.open(first.store.roots.roots[0], 'preview.txt'); const preview = first.store.active!;
    first.store.activate(a.id); await first.store.flushPersistence();
    second.store.reorder(second.store.tabs[1].id, second.store.tabs[0].id); await second.store.setMode(second.store.tabs[0].buffer!, 'source'); await second.store.flushPersistence();
    await until(() => svgBuffer.editor !== null);
    expect(first.store.tabs.map(tab => tab.route.relativePath)).toEqual(['icon.svg', 'a.md', 'preview.txt']);
    expect(first.store.active).toBe(a); expect(first.store.tabs[0].buffer).toBe(svgBuffer); expect(first.store.tabs[2]).toBe(preview);
    expect(svgBuffer.mode).toBe('source'); expect(svgBuffer.raw).toContain('<svg'); expect(preview.pinned).toBe(false);
    await second.store.close(second.store.tabs.find(tab => tab.route.relativePath === 'a.md')!.id); await second.store.flushPersistence();
    await until(() => first.store.persistenceConflict); expect(first.store.active).toBe(a);
    await first.store.reloadPersistence(); expect(names(first.store)).toEqual(['icon.svg', 'preview.txt']); expect(first.store.active).toBe(svg); expect(first.store.persistenceConflict).toBe(false);
    rows.push({ case: 'M9-T-L11', sample: 'clean active/preview preserved; existing SVG source initialization; explicit reread after active deletion', svgEditor: svgBuffer.editor !== null, svgBufferIdentityRetained: first.store.tabs[0].buffer === svgBuffer, routesAfterExplicitReload: names(first.store), pass: true });
  });

  it('L11: protects a real in-flight file save and a separately checkpointed unresolved recovery draft', async () => {
    const db = database(), { files } = service(); db.persistence.save(scope, state([route('a.md')]));
    const makeWindow = rpcWindows(files, db.persistence), first = makeWindow(41), second = makeWindow(42);
    await first.store.initialize(); await first.store.flushPersistence(); await second.store.initialize(); await second.store.flushPersistence();
    const buffer = first.store.active!.buffer!;
    const change = buffer.editor!.update({ changes: { from: 0, insert: 'SAVED ' } }); buffer.acceptTransactions(change.state, [change]);
    let release!: () => void, entered = false;
    const save = files.save.bind(files), gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(files, 'save').mockImplementationOnce(async (owner, input) => { entered = true; await gate; return save(owner, input); });
    const saving = buffer.save();
    try {
      await until(() => entered); expect(buffer.saving).toBe(true);
      second.store.setTreeWidth(381); await second.store.flushPersistence(); await until(() => first.store.persistenceConflict);
      await expect(first.store.reloadPersistence()).rejects.toThrow('请先处理'); expect(first.store.active!.buffer).toBe(buffer);
    } finally { release(); spy.mockRestore(); }
    expect(await saving).toBe(true); expect(buffer.raw).toBe('SAVED # A original\n');
    await first.store.reloadPersistence(); expect(first.store.treeWidth).toBe(381);
    const draftId = randomUUID();
    await first.api.checkpoint({ ref: buffer.file.ref, draftId, bufferVersion: 10, baseHash: buffer.file.revision.hash, base64: Buffer.from('Unresolved private recovery\n').toString('base64'), encoding: 'utf-8', bom: false });
    await buffer.load(); expect(buffer.draftOptions.map(item => item.id)).toContain(draftId); expect(buffer.dirty).toBe(false);
    second.store.setTreeWidth(410); await second.store.flushPersistence(); await until(() => first.store.persistenceConflict);
    await expect(first.store.reloadPersistence()).rejects.toThrow('请先处理'); expect(first.store.treeWidth).toBe(381);
    expect(buffer.draftOptions.map(item => item.id)).toContain(draftId);
    rows.push({ case: 'M9-T-L11', sample: 'public service save response held / pending real recovery draft', inFlightSaveProtected: true, unresolvedDraftProtected: true, treeWidthHeld: first.store.treeWidth, pass: true });
  });

  it('L11: a delayed own commit acknowledgement cannot authorize a stale queued layout over a newer writer', async () => {
    const db = database(), { files } = service(); db.persistence.save(scope, state([route('a.md')]));
    const makeWindow = rpcWindows(files, db.persistence), first = makeWindow(51), second = makeWindow(52);
    await first.store.initialize(); await first.store.flushPersistence(); await second.store.initialize(); await second.store.flushPersistence();
    const original = first.invoke.getMockImplementation()!; let release!: () => void, paused = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    first.invoke.mockImplementation(async (method, ...args) => { const result = await original(method, ...args); if (method === 'saveWorkspace' && !paused) { paused = true; await gate; } return result; });
    first.store.setFilter('first committed'); await until(() => paused);
    first.store.setFilter('local queued after old acknowledgement');
    second.store.setFilter('newer remote'); await second.store.flushPersistence(); release();
    await expect(first.store.flushPersistence()).rejects.toThrow('另一窗口');
    expect(first.store.filter).toBe('local queued after old acknowledgement'); expect(Object.values(db.persistence.load(scope)!.filters)).toEqual(['newer remote']);
    const source = sha(readFileSync(join(fixture, 'one/a.md')));
    await first.store.retryPersistence(); expect(Object.values(db.persistence.load(scope)!.filters)).toEqual(['local queued after old acknowledgement']);
    expect(sha(readFileSync(join(fixture, 'one/a.md')))).toBe(source);
    rows.push({ case: 'M9-T-L11', sample: 'delayed own acknowledgement + queued local layout + newer remote CAS', staleQueuedWriteRejected: true, explicitRetry: first.store.filter, sourceUnchanged: true, pass: true });
  });

  it('L11: explicit reread cannot replace a user selection made while the reply is in flight', async () => {
    const db = database(), { files } = service(); db.persistence.save(scope, state([route('a.md'), route('b.csv')]));
    const makeWindow = rpcWindows(files, db.persistence), first = makeWindow(61), second = makeWindow(62);
    await first.store.initialize(); await first.store.flushPersistence(); await second.store.initialize(); await second.store.flushPersistence();
    first.store.activate(first.store.tabs[0].id); await first.store.flushPersistence();
    await second.store.close(second.store.tabs[0].id); await second.store.flushPersistence(); await until(() => first.store.persistenceConflict);
    const original = first.invoke.getMockImplementation()!; let release!: () => void, paused = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    first.invoke.mockImplementation(async (method, ...args) => { const result = await original(method, ...args); if (method === 'workspaceSnapshot') { paused = true; await gate; } return result; });
    const reread = first.store.reloadPersistence(); await until(() => paused);
    const selected = first.store.tabs[1]; first.store.activate(selected.id); release();
    await expect(reread).rejects.toThrow('读取期间当前标签已改变'); expect(first.store.active).toBe(selected); expect(names(first.store)).toEqual(['a.md', 'b.csv']);
    rows.push({ case: 'M9-T-L11', sample: 'explicit reread response held / user selection guard', selected: selected.route.relativePath, localRoutesPreserved: names(first.store), pass: true });
  });

  it('L11: closeScope only removes that subscription and main-frame navigation removes the remaining subscriptions', async () => {
    const db = database(), { files } = service(), makeWindow = rpcWindows(files, db.persistence), first = makeWindow(71), second = makeWindow(72);
    const task = { kind: 'task' as const, taskId: 'other' }, layout = state([route('a.md')]);
    await first.api.workspaceSnapshot(scope); await first.api.workspaceSnapshot(task); await second.api.workspaceSnapshot(scope); await second.api.workspaceSnapshot(task);
    await first.api.closeScope(scope);
    await second.api.saveWorkspace(scope, layout, 0, randomUUID()); expect(first.sender.send.mock.calls).toHaveLength(0);
    await second.api.saveWorkspace(task, layout, 0, randomUUID()); expect(first.sender.send.mock.calls).toHaveLength(1);
    first.sender.emit('did-start-navigation', {}, 'about:blank', false, true);
    const current = await second.api.workspaceSnapshot(task); await second.api.saveWorkspace(task, { ...layout, treeWidth: 301 }, current.revision, randomUUID());
    expect(first.sender.send.mock.calls).toHaveLength(1);
    expect(() => second.rawInvoke({ ...second.event, senderFrame: {} } as IpcMainInvokeEvent, 'saveWorkspace', scope, layout, 0, randomUUID())).toThrow('UNTRUSTED');
    rows.push({ case: 'M9-T-L11', sample: 'closeScope isolation / main-frame navigation / subframe write rejection', deliveryCounts: { afterProjectClose: 0, remainingTask: 1, afterNavigation: 1 }, pass: true });
  });

  it('L12: rejects unknown/unsafe snapshots intact and restores safe duplicate/active/unavailable routes', async () => {
    const db = database(), { files } = service(), good = state([route('a.md')]);
    const invalid = [
      { name: 'unknown-schema-version', value: { ...good, schemaVersion: 999 } },
      { name: 'unknown-payload-version', value: { ...good, payloadVersion: 999 } },
      ...['../escape', '/etc/hosts', 'sub/../a.md', 'a\0.md'].map(relativePath => ({ name: `unsafe-path-${JSON.stringify(relativePath)}`, value: { ...good, routes: [{ ...route('a.md'), relativePath }] } })),
      { name: 'capability-in-route', value: { ...good, routes: [{ ...route('a.md'), lease: randomUUID(), generation: 99 }] } },
    ];
    for (const [index, sample] of invalid.entries()) {
      db.persistence.save(scope, good);
      expect(() => db.persistence.save(scope, sample.value as never)).toThrow(); expect(db.persistence.load(scope)).toEqual(good);
      const value = JSON.stringify(sample.value);
      db.sqlite.prepare('UPDATE app_settings SET value = ? WHERE key = ?').run(value, key);
      const current = workspace(`invalid-${index}`, files, db.persistence); await current.store.initialize();
      const record: Record<string, unknown> = { case: 'M9-T-L12', sample: sample.name, error: current.store.error, loading: current.store.loading, rootsCalls: current.api.roots.mock.calls.length, openCalls: current.api.open.mock.calls.length, dbUnchanged: raw(db.sqlite) === value, pass: false }; rows.push(record);
      expect(current.store.error).toContain('原记录仍保留'); expect(current.store.loading).toBe(false);
      expect(current.api.roots).not.toHaveBeenCalled(); expect(current.api.open).not.toHaveBeenCalled(); expect(raw(db.sqlite)).toBe(value);
      db.persistence.save(scope, good); await current.store.initialize(); await current.store.flushPersistence();
      expect(current.store.error).toBe(''); expect(current.store.active?.buffer?.raw).toBe('# A original\n');
      record.retryRestored = names(current.store); record.pass = true; current.store.dispose();
    }
    const cases = [
      { name: 'duplicate-tabs', value: state([route('a.md'), route('a.md')]), expected: ['a.md'], active: 'a.md' },
      { name: 'invalid-active', value: { ...state([route('a.md'), route('b.csv')]), active: route('absent.txt') }, expected: ['a.md', 'b.csv'], active: 'a.md' },
      { name: 'source-path-changed', value: state([{ ...route('a.md'), sourcePath: '/untrusted/unregistered' }]), expected: ['a.md'], active: 'a.md' },
    ];
    for (const [index, sample] of cases.entries()) {
      db.persistence.save(scope, sample.value); const current = workspace(`legal-${index}`, files, db.persistence);
      await current.store.initialize(); await current.store.flushPersistence();
      const record = { case: 'M9-T-L12', sample: sample.name, routes: names(current.store), active: current.store.active?.route.relativePath, tabError: current.store.active?.error, openCalls: current.api.open.mock.calls.length, newLease: current.store.active?.buffer?.file.ref.lease, pass: false }; rows.push(record);
      expect(names(current.store)).toEqual(sample.expected); expect(current.store.active?.route.relativePath).toBe(sample.active);
      expect(current.store.loading).toBe(false); expect(current.store.error).toBe('');
      if (sample.name === 'source-path-changed') { expect(current.api.open).not.toHaveBeenCalled(); expect(current.store.active?.error).toContain('原目录来源当前不可用'); }
      else expect(current.store.tabs.every(tab => tab.buffer?.loadState === 'ready')).toBe(true);
      record.pass = true; current.store.dispose();
    }
  });

  it('L13: persists only approved ordered routes/layout and independently recovers private draft bytes with fresh capabilities', async () => {
    const db = database(), before = service(), first = workspace('before', before.files, db.persistence);
    await first.store.initialize(); const root = first.store.roots.roots[0], tree = first.store.roots.roots[1];
    await first.store.open(root, 'a.md', true); await first.store.open(root, 'b.csv', true);
    const a = first.store.tabs[0], b = first.store.tabs[1];
    first.store.reorder(b.id, a.id); first.store.activate(a.id); first.store.selectRoot(tree);
    first.store.toggleDirectory('sub'); first.store.setFilter('needle'); first.store.toggleRoot(); first.store.setTreeWidth(317);
    first.store.scroll.set(a.id, 123); first.store.subscribe(() => undefined);
    await first.store.flushPersistence();
    const persisted = JSON.parse(raw(db.sqlite)), originalLease = a.buffer!.file.ref.lease;
    expect(persisted).toEqual({ schemaVersion: 1, routes: [route('b.csv', 'one', 'source'), route('a.md')], active: route('a.md'), treeSource: rootKey(tree), expanded: { [rootKey(root)]: [], [rootKey(tree)]: ['sub'] }, collapsedRoots: [rootKey(tree)], filters: { [rootKey(tree)]: 'needle' }, treeWidth: 317, treeVisible: true });
    expect(fileWorkspaceSchema.parse(persisted)).toEqual(persisted); expect(forbiddenPaths(persisted)).toEqual([]);
    const draftId = randomUUID(), draft = Buffer.from('# Private unsaved draft 中文\n'), sourcePath = join(fixture, 'one/a.md'), beforeHash = sha(readFileSync(sourcePath));
    const receipt = await before.files.checkpoint('before', { ref: a.buffer!.file.ref, draftId, bufferVersion: 7, baseHash: beforeHash, base64: draft.toString('base64'), encoding: 'utf-8', bom: false });
    const recoveryDirectory = join(before.recovery.descriptor().path, recoveryProjectKey(scope.projectId), draftId), journal = JSON.parse(readFileSync(join(recoveryDirectory, 'journal.json'), 'utf8'));
    expect(forbiddenPaths(journal)).toEqual([]); expect(readFileSync(join(recoveryDirectory, journal.draftLeaf))).toEqual(draft);
    expect(journal).toMatchObject({ kind: 'checkpoint', state: 'dirty', bufferVersion: 7, draftHash: sha(draft), baseHash: beforeHash });
    expect(raw(db.sqlite)).not.toContain(draftId); expect(raw(db.sqlite)).not.toContain(draft.toString()); expect(raw(db.sqlite)).not.toContain(originalLease);
    first.store.dispose(); before.files.closeOwner('before'); await before.files.watcher.dispose(); before.broker.dispose(); db.sqlite.close();
    const reopenedDb = database(), after = service(), reopened = workspace('after', after.files, reopenedDb.persistence);
    await reopened.store.initialize(); await reopened.store.flushPersistence();
    expect(names(reopened.store)).toEqual(['b.csv', 'a.md']); expect(reopened.store.active?.route.relativePath).toBe('a.md');
    expect(reopened.store.activeRoot?.sourceId).toBe('one'); expect(reopened.store.treeRoot?.sourceId).toBe('two');
    expect(reopened.store.tabs.map(tab => tab.buffer?.mode)).toEqual(['source', 'document']);
    expect(reopened.store.currentExpanded).toEqual(['sub']); expect(reopened.store.filter).toBe('needle'); expect(reopened.store.rootExpanded).toBe(false); expect(reopened.store.treeWidth).toBe(317);
    const reopenedBuffer = reopened.store.active!.buffer!;
    expect(reopenedBuffer.file.ref.lease).not.toBe(originalLease); expect(reopenedBuffer.raw).toBe('# A original\n');
    expect(reopenedBuffer.draftOptions.map(item => item.id)).toContain(draftId);
    const restored = await after.files.readDraft('after', reopenedBuffer.file.ref, draftId);
    expect(Buffer.from(restored.base64, 'base64')).toEqual(draft); expect(restored.hash).toBe(receipt.hash);
    expect(sha(readFileSync(sourcePath))).toBe(beforeHash);
    rows.push({ case: 'M9-T-L13', persisted, journal, forbiddenRouteFields: forbiddenPaths(persisted), forbiddenJournalFields: forbiddenPaths(journal), originalLease, reopenedLease: reopenedBuffer.file.ref.lease, restoredDraftSha256: restored.hash, sourceBeforeSha256: beforeHash, sourceAfterSha256: sha(readFileSync(sourcePath)), routesAfterRestart: names(reopened.store), activeSource: reopened.store.activeRoot?.sourceId, treeSource: reopened.store.treeRoot?.sourceId, restartBoundary: 'new SQLite connection, broker process, recovery store, FileService, workspace store; not App GUI restart', pass: true });
  });
});

afterAll(() => {
  if (process.env.SMARTDD_LIFECYCLE_EVIDENCE) { mkdirSync(dirname(process.env.SMARTDD_LIFECYCLE_EVIDENCE), { recursive: true }); writeFileSync(process.env.SMARTDD_LIFECYCLE_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); }
});
