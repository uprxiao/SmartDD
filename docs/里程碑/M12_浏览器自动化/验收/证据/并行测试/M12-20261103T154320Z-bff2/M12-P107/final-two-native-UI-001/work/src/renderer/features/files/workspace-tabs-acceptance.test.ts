import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { openDbClient } from '@main/db/client';
import { runBundledMigrations } from '@main/db/migrations';
import { FileService } from '@main/core/files/file-service';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { FileRootsService } from '@main/core/files/roots';
import { FileWorkspacePersistence } from '@main/core/files/workspace-persistence';
import type { SavedFileWorkspace } from '@shared/file-workspace';
import type { FileDocument, FileRef } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';

const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
const scope = { kind: 'project' as const, projectId: 'tabs-acceptance' };
const observations: Record<string, unknown>[] = [];
const cleanups: (() => Promise<void>)[] = [];

async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-tabs-acceptance-')));
  const project = join(directory, 'project'), userdata = join(directory, 'userdata'), dbPath = join(directory, 'settings.sqlite');
  mkdirSync(project); mkdirSync(userdata);
  for (const name of ['A.txt', 'B.txt', 'C.txt']) writeFileSync(join(project, name), `Fixture ${name}\n`);
  const originalFiles = () => ['A.txt', 'B.txt', 'C.txt'].map(name => ({ name, hash: hash(readFileSync(join(project, name))), inode: String(statSync(join(project, name), { bigint: true }).ino) }));
  const before = originalFiles();
  const database = openDbClient(dbPath); runBundledMigrations(database.sqlite); database.close();
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
  const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'fixture-root', path: project, label: 'Tab fixtures', projectId: scope.projectId }] };
  const sessions: { store: FileWorkspaceStore; close(): void }[] = [];
  const makeSession = async (options: { started?: (store: FileWorkspaceStore) => void; afterOpen?: (path: string, file: FileDocument) => Promise<void> } = {}) => {
    const owner = `frame-${sessions.length}`, client = openDbClient(dbPath), persistence = new FileWorkspacePersistence(client.db);
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
    const closedRefs: string[] = [], openedPaths: string[] = [];
    const api = {
      roots: (input) => service.openScope(owner, input), list: (input) => service.list(owner, input),
      retryRoot: (input) => service.roots.retry(owner, input),
      open: async (input) => { openedPaths.push(input.relativePath); const file = await service.open(owner, input); await options.afterOpen?.(input.relativePath, file); return file; },
      read: (ref) => service.read(owner, ref), refresh: (ref) => service.refresh(owner, ref),
      drafts: async (ref) => service.drafts(owner, ref), readDraft: (ref, id) => service.readDraft(owner, ref, id),
      checkpoint: (input) => service.checkpoint(owner, input), save: (input) => service.save(owner, input),
      resolveDraft: (input) => service.resolveDraft(owner, input),
      closeDocument: async (ref) => { service.closeDocument(owner, ref); closedRefs.push(ref.id); },
      closeScope: async (input) => service.closeScope(owner, input),
    } satisfies Pick<FileClient, 'roots' | 'retryRoot' | 'list' | 'open' | 'read' | 'refresh' | 'drafts' | 'readDraft' | 'checkpoint' | 'save' | 'resolveDraft' | 'closeDocument' | 'closeScope'>;
    const store = new FileWorkspaceStore(scope, api as FileClient, null, {
      load: async input => persistence.load(input), save: async (input, value) => persistence.save(input, value),
    });
    let closed = false;
    const session = { store, service, owner, closedRefs, openedPaths, close: () => {
      if (closed) return; closed = true; store.dispose(); service.closeOwner(owner); client.close();
    } };
    sessions.push(session); options.started?.(store); await store.initialize(); expect(store.error).toBe(''); await store.flushPersistence();
    return session;
  };
  const committed = (): SavedFileWorkspace => {
    const independent = openDbClient(dbPath);
    try {
      const row = independent.sqlite.prepare('SELECT value FROM app_settings WHERE key = ?').get('fileWorkspace.v1:project:tabs-acceptance') as { value: string };
      return JSON.parse(row.value);
    } finally { independent.close(); }
  };
  cleanups.push(async () => {
    for (const session of sessions) { await session.store.flushPersistence().catch(() => undefined); session.close(); }
    const deadline = Date.now() + 5000;
    while (broker.activeProcesses && Date.now() < deadline) await delay(2);
    expect(originalFiles()).toEqual(before); broker.dispose(); rmSync(directory, { recursive: true, force: true });
  });
  return { makeSession, committed, files: before, project };
}

async function assertReleased(session: Awaited<ReturnType<Awaited<ReturnType<typeof fixture>>['makeSession']>>, ref: FileRef) {
  expect(session.closedRefs).toContain(ref.id);
  await expect(session.service.read(session.owner, ref)).rejects.toThrow('UNTRUSTED');
}

afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
afterAll(() => {
  if (process.env.SMARTDD_M9_TABS_ACCEPTANCE_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_TABS_ACCEPTANCE_EVIDENCE, JSON.stringify({
    observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    executable: process.env.SMARTDD_M9_FILE_BROKER, executableSha256: hash(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)),
    level: 'Production FileWorkspaceStore → FileService/packaged native broker and FileWorkspacePersistence/real SQLite; independent SQLite connection and source file hash/inode checks. No GUI, DOM focus, terminal or Electron IPC transport claim.', observations,
  }, null, 2) + '\n');
});

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9 file tab production integration acceptance', () => {
  it('D07 reorders both directions and restores persisted order/active from independent SQLite/native sessions', async () => {
    const f = await fixture(), first = await f.makeSession(), { store } = first;
    for (const name of ['A.txt', 'B.txt', 'C.txt']) await store.open(store.roots.roots[0], name, true);
    const [a, b, c] = store.tabs; store.activate(b.id); store.reorder(a.id, c.id); await store.flushPersistence();
    expect(f.committed().routes.map(route => route.relativePath)).toEqual(['B.txt', 'C.txt', 'A.txt']); expect(store.active).toBe(b);
    store.reorder(a.id, b.id); await store.flushPersistence(); first.close();
    const restored = await f.makeSession(); expect(restored.store.tabs.map(tab => tab.route.relativePath)).toEqual(['A.txt', 'B.txt', 'C.txt']); expect(restored.store.active!.route.relativePath).toBe('B.txt');
    observations.push({ case: 'M9-T-D07', committed: f.committed(), active: 'B.txt', freshSourceFiles: f.files });
  });
  it('D15 restores fixed order/active/layout on fresh native capabilities without storing temporary identities', async () => {
    const f = await fixture(), first = await f.makeSession(), { store } = first;
    for (const name of ['A.txt', 'B.txt', 'C.txt']) await store.open(store.roots.roots[0], name, true);
    const oldLease = store.treeRoot!.lease; store.activate(store.tabs[1].id); store.setTreeWidth(333); store.setTreeVisible(false); store.setFilter('B'); await store.flushPersistence();
    const committed = f.committed(); expect(JSON.stringify(committed)).not.toMatch(/lease|blob:|willyou-assets/); first.close();
    const restored = await f.makeSession(); expect(restored.store.tabs.map(tab => tab.route.relativePath)).toEqual(['A.txt', 'B.txt', 'C.txt']); expect(restored.store.active!.route.relativePath).toBe('B.txt'); expect(restored.store.treeWidth).toBe(333); expect(restored.store.treeVisible).toBe(false); expect(restored.store.filter).toBe('B'); expect(restored.store.treeRoot!.lease).not.toBe(oldLease);
    observations.push({ case: 'M9-T-D15', committed, temporaryLeaseChanged: true, treeWidth: restored.store.treeWidth });
  });
  it('D16 a deleted persisted route survives restart as a retryable error and loads only recreated target', async () => {
    const f = await fixture(), path = join(f.project, 'missing.txt'); writeFileSync(path, 'Before deletion\n');
    const first = await f.makeSession(); await first.store.open(first.store.roots.roots[0], 'A.txt', true); await first.store.open(first.store.roots.roots[0], 'missing.txt', true); await first.store.flushPersistence(); first.close(); unlinkSync(path);
    const restored = await f.makeSession(), tab = restored.store.active!; expect(tab.route.relativePath).toBe('missing.txt'); expect(tab.buffer).toBeNull(); expect(tab.error).toMatch(/MISSING/); expect(restored.store.tabs).toHaveLength(2);
    writeFileSync(path, 'Recovered exact route\n'); await restored.store.retryTab(tab.id); expect(restored.store.active).toBe(tab); expect(tab.buffer!.raw).toBe('Recovered exact route\n');
    observations.push({ case: 'M9-T-D16', state: 'missing-file', committed: f.committed(), retriedExactRoute: true });
  });
  it('D16 an unavailable persisted root retains its exact route until explicitly retried', async () => {
    const f = await fixture(), first = await f.makeSession(); await first.store.open(first.store.roots.roots[0], 'A.txt', true); await first.store.flushPersistence(); const source = first.store.roots.roots[0]; first.close();
    const moved = f.project + '-unavailable'; renameSync(f.project, moved);
    let restored: Awaited<ReturnType<typeof f.makeSession>>;
    try { restored = await f.makeSession(); expect(restored.store.active!.route.sourcePath).toBe(f.project); expect(restored.store.active!.route.relativePath).toBe('A.txt'); expect(restored.store.active!.buffer).toBeNull(); expect(restored.store.active!.error).toContain('原目录来源当前不可用'); expect(restored.store.roots.unavailable).toHaveLength(1); }
    finally { renameSync(moved, f.project); }
    await restored!.store.retryUnavailableRoot(source.sourceId, source.source); expect(restored!.store.active!.buffer!.raw).toBe('Fixture A.txt\n');
    observations.push({ case: 'M9-T-D16', state: 'unavailable-root', retainedRoot: f.project, retriedExactRoute: true });
  });
  it('D17 real native restoration successes delivered after user opens C never replace the user active route', async () => {
    const f = await fixture(), first = await f.makeSession(); for (const name of ['A.txt', 'B.txt']) await first.store.open(first.store.roots.roots[0], name, true); await first.store.flushPersistence(); first.close();
    let store!: FileWorkspaceStore; const held = new Map<string, { file: FileDocument; release(): void }>();
    const initializing = f.makeSession({ started: value => { store = value; }, afterOpen: async (path, file) => { if (path !== 'C.txt') await new Promise<void>(release => held.set(path, { file, release })); } });
    const deadline = Date.now() + 5000; while (held.size < 2 && Date.now() < deadline) await delay(5);
    try {
      expect(held.size).toBe(2); await store.open(store.roots.roots[0], 'C.txt', true); const selected = store.active!;
      held.get('B.txt')!.release(); held.get('A.txt')!.release(); await initializing;
      expect(store.active).toBe(selected); expect(selected.buffer!.raw).toBe('Fixture C.txt\n'); expect(store.tabs.map(tab => tab.buffer!.raw)).toEqual(['Fixture A.txt\n', 'Fixture B.txt\n', 'Fixture C.txt\n']);
      observations.push({ case: 'M9-T-D17', delayedNativeRefs: [...held.values()].map(slot => slot.file.ref), active: 'C.txt', unchangedSourceFiles: f.files });
    } finally { for (const slot of held.values()) slot.release(); await initializing; }
  });
  it.skipIf(!process.env.SMARTDD_PDF_PROJECT)('F14 commits and restores PDF reading hints through native capabilities and independent SQLite sessions', async () => {
    const f = await fixture(), path = join(f.project, 'reader.pdf');
    copyFileSync(join(process.env.SMARTDD_PDF_PROJECT!, 'normal.pdf'), path); const original = readFileSync(path);
    const session = await f.makeSession(), { store } = session;
    await store.open(store.roots.roots[0], 'reader.pdf', true); const first = store.active!, ref = first.buffer!.file.ref;
    expect(first.buffer!.content.kind).toBe('pdf');
    first.buffer!.updatePdfPosition({ page: 3, zoom: 150, initialized: true });
    await store.close(first.id); await assertReleased(session, ref); await store.restoreClosed();
    expect(store.active!.buffer!.pdfPosition).toEqual({ page: 3, zoom: 150, initialized: true });
    await store.flushPersistence(); const committed = f.committed(); expect(committed.routes[0].pdf).toEqual({ page: 3, zoom: 150 });
    session.close(); const restored = await f.makeSession();
    expect(restored.store.active!.buffer!.pdfPosition).toEqual({ page: 3, zoom: 150, initialized: true });
    expect(restored.store.active!.buffer!.file.ref).not.toEqual(ref); expect(readFileSync(path)).toEqual(original);
    observations.push({ case: 'M9-T-F14', committed, sourceSha256: hash(original), originalCapabilityReleased: true, freshCapabilityAndReaderRestored: true });
  });
  it('M9-T-D01 replaces clean preview A with B, releases A capability, and does not persist previews as fixed routes', async () => {
    const f = await fixture(), session = await f.makeSession(), { store } = session, root = store.roots.roots[0];
    await store.open(root, 'A.txt'); const a = store.active!, aBuffer = a.buffer!;
    expect(a.pinned).toBe(false); expect(aBuffer.dirty).toBe(false);
    await store.open(root, 'B.txt'); await store.flushPersistence();
    expect(store.tabs).toHaveLength(1); expect(store.active?.route.relativePath).toBe('B.txt'); expect(store.active?.pinned).toBe(false);
    expect(store.tabs).not.toContain(a); await assertReleased(session, aBuffer.file.ref);
    const ignored = aBuffer.editor!.update({ changes: { from: 0, insert: 'late edit' } }); aBuffer.acceptTransactions(ignored.state, [ignored]);
    expect(aBuffer.raw).toBe('Fixture A.txt\n');
    const committed = f.committed(); expect(committed.routes).toEqual([]); expect(committed.active?.relativePath).toBe('B.txt');
    session.close(); const restored = await f.makeSession(); expect(restored.store.tabs).toEqual([]); expect(restored.store.activeId).toBeNull();
    observations.push({ case: 'M9-T-D01', committed, closedRefs: session.closedRefs, restoredTabs: 0, files: f.files });
  });

  it.each(['M9-T-D02', 'M9-T-D03'])('%s preserves the one pinned A while B occupies the preview slot and restores only A', async (caseId) => {
    const f = await fixture(), session = await f.makeSession(), { store } = session, root = store.roots.roots[0];
    await store.open(root, 'A.txt'); const a = store.active!, buffer = a.buffer!;
    await store.open(root, 'A.txt', true); expect(store.active).toBe(a); expect(a.pinned).toBe(true); expect(a.buffer).toBe(buffer);
    if (caseId === 'M9-T-D03') { await store.open(root, 'A.txt'); expect(store.active).toBe(a); expect(a.pinned).toBe(true); }
    await store.open(root, 'B.txt'); await store.flushPersistence();
    expect(store.tabs.map(tab => [tab.route.relativePath, tab.pinned])).toEqual([['A.txt', true], ['B.txt', false]]);
    expect(store.tabs.filter(tab => tab.route.relativePath === 'A.txt')).toEqual([a]); expect(session.openedPaths).toEqual(['A.txt', 'B.txt']);
    const committed = f.committed(); expect(committed.routes.map(route => route.relativePath)).toEqual(['A.txt']);
    session.close(); const restored = await f.makeSession();
    expect(restored.store.tabs.map(tab => [tab.route.relativePath, tab.pinned])).toEqual([['A.txt', true]]);
    expect(restored.store.active?.route.relativePath).toBe('A.txt'); expect(restored.store.active?.buffer?.raw).toBe('Fixture A.txt\n');
    observations.push({ case: caseId, committed, openedPaths: session.openedPaths, restoredActive: restored.store.active?.route.relativePath, files: f.files });
  });

  it.each(['M9-T-D08', 'M9-T-D09'])('%s closes the requested tab, releases its capability, and persists a valid adjacent/current active route', async (caseId) => {
    const f = await fixture(), session = await f.makeSession(), { store } = session, root = store.roots.roots[0];
    for (const path of ['A.txt', 'B.txt', 'C.txt']) await store.open(root, path, true);
    const [a, b, c] = store.tabs; store.activate(b.id); const bEditor = b.buffer!.editor;
    const target = caseId === 'M9-T-D08' ? c : b;
    expect(await store.close(target.id)).toBe('closed'); await store.flushPersistence(); await assertReleased(session, target.buffer!.file.ref);
    const expectedActive = caseId === 'M9-T-D08' ? b : c;
    expect(store.active).toBe(expectedActive); expect(store.tabs).toContain(expectedActive); expect(store.activeId).toBe(expectedActive.id);
    expect(store.tabs).toEqual([a, expectedActive]);
    if (caseId === 'M9-T-D08') { expect(b.buffer!.editor).toBe(bEditor); expect(await session.service.read(session.owner, b.buffer!.file.ref)).toMatchObject({ base64: Buffer.from('Fixture B.txt\n').toString('base64') }); }
    const committed = f.committed(); expect(committed.active?.relativePath).toBe(expectedActive.route.relativePath);
    expect(committed.routes.map(route => route.relativePath)).toEqual(store.tabs.map(tab => tab.route.relativePath));
    session.close(); const restored = await f.makeSession();
    expect(restored.store.active?.route.relativePath).toBe(expectedActive.route.relativePath); expect(restored.store.tabs).toContain(restored.store.active);
    observations.push({ case: caseId, committed, released: target.route.relativePath, restoredActive: restored.store.active?.route.relativePath, files: f.files, boundary: 'DOM focus and terminal isolation require separate P/A observations.' });
  });
});
