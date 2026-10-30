import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot, FileScope } from '@shared/files';
import type { SavedFileWorkspace, WorkspacePersistence } from '@shared/file-workspace';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';

const scope = { kind: 'project' as const, projectId: 'fixture' };
const root: FileRoot = { source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', lease: randomUUID(), generation: 1, label: 'Fixture', identity: { device: '1', inode: '2' } };
const route = (name: string) => ({ source: root.source, sourceId: root.sourceId, sourcePath: root.path, relativePath: name, mode: 'document' as const });
const state = (names: string[]): SavedFileWorkspace => ({ schemaVersion: 1, routes: names.map(route), active: names.length ? route(names.at(-1)!) : null, treeSource: null, expanded: {}, collapsedRoots: [], filters: {}, treeWidth: 250 });
const stores: FileWorkspaceStore[] = [];
function setup(saved: SavedFileWorkspace | null = null, legacy: SavedFileWorkspace | null = null) {
  let persisted = saved;
  const persistence = { load: vi.fn(async () => persisted), save: vi.fn(async (_scope: FileScope, value: SavedFileWorkspace) => { persisted = structuredClone(value); }) } satisfies WorkspacePersistence;
  const storage = { getItem: vi.fn(() => legacy ? JSON.stringify(legacy) : null), setItem: vi.fn() };
  const document = (name: string): FileDocument => ({ ref: { id: randomUUID(), lease: root.lease, generation: 1 }, documentKey: `local:${name}`, name, relativePath: name, absolutePath: `/fixture/${name}`, writable: true, revision: { device: '1', inode: name, hash: 'a'.repeat(64), size: 4, modifiedNs: '1', changedNs: '1' } });
  const documents = new Map<string, FileDocument>();
  const api = {
    roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []),
    open: vi.fn(async (request) => { const value = document(request.relativePath); documents.set(value.ref.id, value); return value; }),
    read: vi.fn(async (ref) => ({ document: documents.get(ref.id)!, base64: Buffer.from('BASE').toString('base64') })),
    refresh: vi.fn(async (ref) => documents.get(ref.id)!), drafts: vi.fn(async () => []),
    checkpoint: vi.fn(async (input) => ({ draftId: input.draftId, bufferVersion: input.bufferVersion, hash: 'b'.repeat(64) })),
    closeDocument: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined),
  };
  const store = new FileWorkspaceStore(scope, api as unknown as FileClient, storage, persistence); stores.push(store);
  return { store, persistence, storage, api, documents, document, saved: () => persisted };
}
afterEach(() => { stores.splice(0).forEach(store => store.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('workspace restoration and durable route acknowledgement', () => {
  it('reloads a changed attachment MIME on a new readonly reference while retaining its tab and latest callbacks', async () => {
    const f = setup(); await f.store.initialize();
    f.api.open.mockImplementation(async request => {
      const mimeType = request.attachment?.mimeType;
      const file: FileDocument = { ...f.document(request.relativePath), writable: false, content: { kind: 'text', basis: 'sample' }, attachment: { mimeType, textKind: mimeType === 'text/markdown' ? 'markdown' : 'text' } };
      f.documents.set(file.ref.id, file); return file;
    });
    const oldDownload = vi.fn(async () => {}), latestDownload = vi.fn(async () => {});
    await f.store.openAttachment(root, 'no-extension', { key: 'host', mimeType: 'text/markdown', onDownload: oldDownload });
    const tab = f.store.active!, oldBuffer = tab.buffer!, oldRef = oldBuffer.file.ref; expect(oldBuffer.textPresentation).toBe('markdown');
    await f.store.openAttachment(root, 'no-extension', { key: 'host', mimeType: 'text/plain', onDownload: latestDownload });
    expect(f.store.active).toBe(tab); expect(tab.buffer).not.toBe(oldBuffer); expect(tab.buffer!.textPresentation).toBe('source'); expect(tab.buffer!.editable).toBe(false);
    expect(f.api.closeDocument).toHaveBeenCalledWith(oldRef); expect(f.api.open).toHaveBeenLastCalledWith({ lease: root.lease, generation: root.generation, relativePath: 'no-extension', readOnly: true, attachment: { mimeType: 'text/plain' } });
    await f.store.downloadAttachment(tab.id); expect(latestDownload).toHaveBeenCalledTimes(1); expect(oldDownload).not.toHaveBeenCalled();
    await f.store.flushPersistence(); expect(f.saved()?.routes).toEqual([]); expect(f.saved()?.active).toBeNull(); expect(JSON.stringify(f.saved())).not.toMatch(/mimeType|text\/plain|host/);
  });
  it('releases a late old attachment open instead of replacing the current MIME presentation', async () => {
    const f = setup(); await f.store.initialize(); let release!: (value: FileDocument) => void;
    const old: FileDocument = { ...f.document('no-extension'), writable: false, content: { kind: 'text', basis: 'sample' }, attachment: { mimeType: 'text/markdown', textKind: 'markdown' } };
    const current: FileDocument = { ...f.document('no-extension'), writable: false, content: { kind: 'text', basis: 'sample' }, attachment: { mimeType: 'text/plain', textKind: 'text' } };
    f.documents.set(old.ref.id, old); f.documents.set(current.ref.id, current);
    f.api.open.mockImplementationOnce(() => new Promise<FileDocument>(resolve => { release = resolve; })).mockResolvedValueOnce(current);
    const stale = f.store.openAttachment(root, 'no-extension', { key: 'host', mimeType: 'text/markdown' });
    await f.store.openAttachment(root, 'no-extension', { key: 'host', mimeType: 'text/plain' });
    const buffer = f.store.active!.buffer!; release(old); await stale;
    expect(f.store.active!.buffer).toBe(buffer); expect(buffer.file.ref).toEqual(current.ref); expect(buffer.textPresentation).toBe('source'); expect(f.api.closeDocument).toHaveBeenCalledWith(old.ref); expect(f.api.read).not.toHaveBeenCalledWith(old.ref);
  });
  it('uses main-process persistence with the actual production RPC namespace proxy', async () => {
    const invoke = vi.fn(async (channel: string, ...args: unknown[]) => channel === 'files.workspaceSnapshot' ? { state: null, revision: 0 } : channel === 'files.saveWorkspace' ? { state: args[1], revision: 1, accepted: true } : channel === 'files.roots' ? { roots: [], unavailable: [] } : undefined);
    vi.stubGlobal('window', { electronAPI: { invoke, eventOn: () => () => undefined } });
    const store = new FileWorkspaceStore(scope); stores.push(store); await store.initialize(); await store.flushPersistence();
    expect(invoke).toHaveBeenCalledWith('files.workspaceSnapshot', scope);
    expect(invoke).toHaveBeenCalledWith('files.saveWorkspace', scope, expect.objectContaining({ schemaVersion: 1, routes: [] }), 0, expect.any(String));
  });
  it('migrates a legacy snapshot once and prefers committed state over a stale browser copy', async () => {
    const first = setup(null, state(['old.txt'])); await first.store.initialize(); await first.store.flushPersistence();
    expect(first.saved()?.routes.map(item => item.relativePath)).toEqual(['old.txt']); expect(first.storage.setItem).not.toHaveBeenCalled();
    const second = setup(state(['committed.txt']), state(['stale.txt'])); await second.store.initialize(); await second.store.flushPersistence();
    expect(second.store.active?.route.relativePath).toBe('committed.txt'); expect(second.storage.getItem).not.toHaveBeenCalled();
  });
  it('pins a dirty preview and waits for route commit after independently writing its draft', async () => {
    vi.useFakeTimers(); const f = setup(); await f.store.initialize(); await f.store.flushPersistence();
    await f.store.open(root, 'draft.txt'); await f.store.flushPersistence(); expect(f.saved()?.routes).toEqual([]);
    let release!: () => void; f.persistence.save.mockImplementationOnce(async (_scope, value) => { await new Promise<void>(resolve => { release = resolve; }); expect(value.routes.map(item => item.relativePath)).toEqual(['draft.txt']); });
    const buffer = f.store.active!.buffer!, change = buffer.editor!.update({ changes: { from: 0, to: 4, insert: 'EDIT' } });
    buffer.acceptTransactions(change.state, [change]); const checkpoint = buffer.checkpoint(); let finished = false; void checkpoint.then(() => { finished = true; });
    await vi.advanceTimersByTimeAsync(0); expect(f.store.active!.pinned).toBe(true); expect(f.api.checkpoint).toHaveBeenCalledTimes(1); expect(finished).toBe(false);
    release(); await checkpoint; expect(finished).toBe(true);
  });
  it('keeps memory and shows a failed commit, then retries the same snapshot successfully', async () => {
    const f = setup(); await f.store.initialize(); await f.store.flushPersistence();
    f.persistence.save.mockRejectedValueOnce(new Error('fixture disk full')); f.store.setFilter('last edit');
    await expect(f.store.flushPersistence()).rejects.toThrow('fixture disk full');
    expect(f.store.filter).toBe('last edit'); expect(f.store.persistenceError).toContain('fixture disk full');
    await f.store.flushPersistence(); expect(f.store.persistenceError).toBe(''); expect(Object.values(f.saved()!.filters)).toEqual(['last edit']);
  });
  it('does not replace unreadable committed state with a legacy fallback or empty state', async () => {
    const f = setup(null, state(['legacy.txt'])); f.persistence.load.mockRejectedValueOnce(new Error('corrupt record'));
    await f.store.initialize(); expect(f.store.error).toContain('corrupt record'); expect(f.storage.getItem).not.toHaveBeenCalled(); expect(f.persistence.save).not.toHaveBeenCalled();
    await f.store.initialize(); await f.store.flushPersistence(); expect(f.store.active?.route.relativePath).toBe('legacy.txt');
  });
  it('serializes immutable state snapshots so a late write cannot overwrite a newer filter', async () => {
    const f = setup(); await f.store.initialize(); await f.store.flushPersistence();
    const seen: string[] = []; let release!: () => void;
    f.persistence.save.mockImplementationOnce(async (_scope, value) => { await new Promise<void>(resolve => { release = resolve; }); seen.push(Object.values(value.filters)[0]); });
    f.persistence.save.mockImplementationOnce(async (_scope, value) => { seen.push(Object.values(value.filters)[0]); });
    f.store.setFilter('first'); await Promise.resolve(); await Promise.resolve(); f.store.setFilter('second');
    release(); await f.store.flushPersistence(); expect(seen).toEqual(['first', 'second']);
  });
});
