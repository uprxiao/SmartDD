import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
import type { SavedFileWorkspace, WorkspacePersistence } from '@shared/file-workspace';
import { chooseFileViewer, fileViewerChoice } from './viewer-choice';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => {} } }));
const stores: FileWorkspaceStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.dispose()));
const raw = '# Heading\r\nSecond\r\n中文🙂 tail\r\nLast line\r\n';
function fixture(persistence: WorkspacePersistence | null = null) {
  const root: FileRoot = { source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', label: 'Fixture', lease: randomUUID(), generation: 1, identity: { device: '1', inode: '2' } };
  const files = new Map<string, FileDocument>();
  const file = (name: string) => {
    if (!files.has(name)) files.set(name, { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, documentKey: randomUUID(), name, relativePath: name, absolutePath: '/fixture/' + name, writable: true, revision: { device: '1', inode: name, hash: createHash('sha256').update(raw).digest('hex'), size: Buffer.byteLength(raw), modifiedNs: '1', changedNs: '1' }, ...(name.endsWith('.pdf') ? { content: { kind: 'pdf' as const, mime: 'application/pdf', basis: 'extension' as const } } : {}) });
    return files.get(name)!;
  };
  const api = { roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []), open: vi.fn(async ({ relativePath }: { relativePath: string }) => file(relativePath)), related: vi.fn(async (_ref: unknown, path: string) => file(path)), read: vi.fn(async (ref: { id: string }) => ({ document: [...files.values()].find(f => f.ref.id === ref.id)!, base64: Buffer.from(raw).toString('base64') })), refresh: vi.fn(async (ref: { id: string }) => [...files.values()].find(f => f.ref.id === ref.id)!), drafts: vi.fn(async () => []), checkpoint: vi.fn(), save: vi.fn(), closeDocument: vi.fn(async () => {}), closeScope: vi.fn(async () => {}) };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'fixture' }, api as unknown as FileClient, null, persistence); stores.push(store);
  return { root, file, api, store };
}
// Real workspace/FileBuffer/CRLF offsets, isolated file capability transport.
// These are controller checks, not native I, PDF decoding or real App A.
it.each(['md', 'csv'])('existing %s range opens readonly source, preserves both endpoints and restores ordinary editing', async suffix => {
  const { store, root, api } = fixture(); await store.initialize();
  await store.open(root, 'target.' + suffix, true); const tab = store.active!, buffer = tab.buffer!, editor = buffer.editor, ref = buffer.file.ref;
  await store.open(root, 'target.' + suffix, true, { line: 3, column: 2, endLine: 4 });
  expect(Reflect.get(buffer, 'navigationView')).toBe('review'); expect(buffer.editable).toBe(false);
  const normalized = raw.replaceAll('\r\n', '\n');
  expect(buffer.reveal).toEqual({ from: normalized.indexOf('中文') + 1, to: normalized.indexOf('Last line') + 9 });
  expect(store.active).toBe(tab); expect(buffer.editor).toBe(editor); expect(buffer.file.ref).toBe(ref); expect(buffer.raw).toBe(raw); expect(buffer.dirty).toBe(false);
  await store.open(root, 'target.' + suffix, true); expect(buffer.editable).toBe(true); expect(Reflect.get(buffer, 'navigationView')).toBeNull();
  expect(api.open).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});
it('navigation temporarily bypasses a manual viewer without losing it on an ordinary reopen', async () => {
  const { store, root } = fixture(); await store.initialize(); await store.open(root, 'target.md', true); const buffer = store.active!.buffer!;
  chooseFileViewer(buffer, 'my-adapter');
  await store.open(root, 'target.md', true, { line: 3, endLine: 4 }); expect(fileViewerChoice(buffer)).toBe('my-adapter');
  await store.open(root, 'target.md', true); expect(fileViewerChoice(buffer)).toBe('my-adapter'); expect(Reflect.get(buffer, 'navigationView')).toBeNull();
});
it('restores readonly navigation intent on a fresh capability and clears it on explicit mode selection', async () => {
  let saved: SavedFileWorkspace | null = null;
  const persistence: WorkspacePersistence = { load: async () => structuredClone(saved), save: async (_scope, state) => { saved = structuredClone(state); } };
  const a = fixture(persistence); await a.store.initialize(); await a.store.open(a.root, 'target.md', true, { line: 3, endLine: 4 }); const previous = a.store.active!.buffer!;
  await a.store.flushPersistence(); a.store.dispose();
  const b = fixture(persistence); await b.store.initialize(); const tab = b.store.active!, buffer = tab.buffer!, editor = buffer.editor;
  expect(buffer.file.ref.lease).not.toBe(previous.file.ref.lease); expect(buffer.editable).toBe(false); expect(Reflect.get(buffer, 'navigationView')).toBe('review'); expect(buffer.raw).toBe(raw);
  await b.store.setMode(buffer, buffer.mode); expect(buffer.editable).toBe(true); expect(Reflect.get(buffer, 'navigationView')).toBeNull(); expect(buffer.editor).toBe(editor);
  await b.store.flushPersistence(); expect(saved!.routes[0]).not.toHaveProperty('navigationView');
});
it('real related-link path carries range hints after resolving the trusted document', async () => {
  const { store, root, api } = fixture(); await store.initialize(); await store.open(root, 'source.md', true); const source = store.active!.buffer!;
  await store.openRelated(source, 'target.csv#L3C2-L4');
  expect(api.related).toHaveBeenCalledWith(source.file.ref, 'target.csv');
  expect(store.active!.route.relativePath).toBe('target.csv'); expect(Reflect.get(store.active!.buffer!, 'navigationView')).toBe('review'); expect(store.active!.buffer!.editable).toBe(false);
});
it('PDF point and range choose review without inventing a PDF binary source caret', async () => {
  const { store, root } = fixture(); await store.initialize();
  for (const options of [{ line: 3 }, { line: 3, endLine: 4 }]) {
    await store.open(root, 'target.pdf', true, options); const buffer = store.active!.buffer!;
    expect(Reflect.get(buffer, 'navigationView')).toBe('review'); expect(buffer.editor).toBeNull(); expect(buffer.reveal).toBeNull();
  }
});
it('a range request protects an existing dirty draft instead of making it unsaveable', async () => {
  const { store, root, api } = fixture(); await store.initialize(); await store.open(root, 'target.md', true); const buffer = store.active!.buffer!; buffer.pauseAutosave();
  const tx = buffer.editor!.update({ changes: { from: 0, insert: 'LOCAL ' } }); buffer.acceptTransactions(tx.state, [tx]);
  await expect(store.open(root, 'target.md', true, { line: 3, endLine: 4 })).rejects.toThrow(/保存/);
  expect(buffer.editable).toBe(true); expect(buffer.raw).toBe('LOCAL ' + raw); expect(buffer.dirty).toBe(true); expect(api.save).not.toHaveBeenCalled();
});
it('a late related-path resolution cannot steal focus from a later user navigation', async () => {
  const { store, root, api, file } = fixture(); await store.initialize(); await store.open(root, 'source.md', true); const source = store.active!.buffer!;
  let resolve!: (doc: FileDocument) => void; api.related.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const pending = store.openRelated(source, 'target.md#L3-L4'); await store.open(root, 'newer.md', true); const newer = store.active;
  resolve(file('target.md')); await pending; expect(store.active).toBe(newer); expect(store.tabs.some(t => t.route.relativePath === 'target.md')).toBe(false);
  expect(api.closeDocument).toHaveBeenCalledWith(file('target.md').ref);
});
