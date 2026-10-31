import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot, FileScope } from '@shared/files';
import type { SavedFileWorkspace, WorkspacePersistence } from '@shared/file-workspace';
import { FileWorkspaceStore, fileWorkspaceFor, prepareFileWorkspaceClose } from './workspace-store';
import { FileBuffer, type FileClient } from './file-buffer';
import { fileViewerChoice } from './viewer-choice';

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

describe('session close preserves files until the terminal exit receipt', () => {
  it('prepares and persists without removing a single tab, then closes only the captured scope', async () => {
    const f = setup(state(['one.txt', 'two.txt'])); await f.store.initialize();
    const tabs = [...f.store.tabs];
    const preparation = await f.store.prepareSessionClose('save');
    expect(f.store.tabs).toEqual(tabs); expect(f.api.closeScope).not.toHaveBeenCalled();
    expect(f.api.closeDocument).not.toHaveBeenCalled(); expect(f.saved()?.routes).toHaveLength(2);
    await preparation.commit();
    expect(f.api.closeScope).toHaveBeenCalledExactlyOnceWith(scope);
    expect(f.api.closeDocument).toHaveBeenCalledTimes(2);
  });
  it('keeps the same editor, draft and routes after an unsuccessful save', async () => {
    const f = setup(state(['draft.txt'])); await f.store.initialize();
    const tab = f.store.active!, buffer = tab.buffer!, before = buffer.draftId;
    const transaction = buffer.editor!.update({ changes: { from: 0, to: 4, insert: 'UNSAVED' } });
    buffer.acceptTransactions(transaction.state, [transaction]);
    vi.spyOn(buffer, 'prepareClose').mockResolvedValueOnce(false);
    await expect(f.store.prepareSessionClose('save')).rejects.toMatchObject({ canDiscard: true });
    expect(f.store.active).toBe(tab); expect(tab.buffer).toBe(buffer); expect(buffer.raw).toBe('UNSAVED');
    expect(buffer.draftId).toBe(before); expect(buffer.dirty).toBe(true);
    expect(f.api.closeDocument).not.toHaveBeenCalled(); expect(f.api.closeScope).not.toHaveBeenCalled();
  });
  it('refuses a stale close after a replacement buffer or a new edit arrives', async () => {
    const f = setup(state(['same.txt'])); await f.store.initialize();
    const preparation = await f.store.prepareSessionClose('save');
    const old = f.store.active!.buffer!, replacement = new FileBuffer(f.document('same.txt'), f.api as unknown as FileClient, () => undefined);
    f.documents.set(replacement.file.ref.id, replacement.file);
    f.store.active!.buffer = replacement;
    await expect(preparation.commit()).rejects.toThrow('文件内容已改变');
    expect(f.api.closeScope).not.toHaveBeenCalled(); old.dispose();
    await replacement.load();
    const second = await f.store.prepareSessionClose('save');
    replacement.version++;
    await expect(second.commit()).rejects.toThrow('文件内容已改变');
    expect(f.api.closeScope).not.toHaveBeenCalled();
  });
  it('retains the whole workspace on persistence or scope-release failure', async () => {
    const f = setup(state(['kept.txt'])); await f.store.initialize();
    await f.store.flushPersistence(); f.store.setFilter('changed');
    f.persistence.save.mockRejectedValueOnce(new Error('workspace disk full'));
    await expect(f.store.prepareSessionClose('save')).rejects.toThrow('workspace disk full');
    expect(f.api.closeScope).not.toHaveBeenCalled();
    const preparation = await f.store.prepareSessionClose('save');
    f.api.closeScope.mockRejectedValueOnce(new Error('release refused'));
    await expect(preparation.commit()).rejects.toThrow('release refused');
    expect(f.store.active?.route.relativePath).toBe('kept.txt');
    expect(f.api.closeDocument).not.toHaveBeenCalled(); preparation.cancel();
  });
  it('passes only explicit discard to the buffer and does not remove recovery material itself', async () => {
    const f = setup(state(['conflict.txt'])); await f.store.initialize();
    const buffer = f.store.active!.buffer!, prepare = vi.spyOn(buffer, 'prepareClose').mockResolvedValue(true);
    buffer.saveReceipt = { state: 'conflict', recoveryId: 'protected-material' } as unknown as NonNullable<typeof buffer.saveReceipt>;
    const preparation = await f.store.prepareSessionClose('discard');
    expect(prepare).toHaveBeenCalledExactlyOnceWith('discard');
    expect(buffer.saveReceipt?.recoveryId).toBe('protected-material');
    expect(f.api.closeScope).not.toHaveBeenCalled(); preparation.cancel();
  });
  it('evicts exactly the closed task cache and obtains a fresh store when reopened', async () => {
    const invoke = vi.fn(async () => undefined);
    vi.stubGlobal('window', { electronAPI: { invoke, eventOn: () => () => undefined } });
    const own = { kind: 'task' as const, taskId: randomUUID() }, other = { kind: 'task' as const, taskId: randomUUID() };
    const before = fileWorkspaceFor(own), unaffected = fileWorkspaceFor(other);
    const preparation = await prepareFileWorkspaceClose(own, 'save');
    expect(fileWorkspaceFor(own)).toBe(before); expect(fileWorkspaceFor(other)).toBe(unaffected);
    await preparation.commit(); const reopened = fileWorkspaceFor(own);
    expect(reopened).not.toBe(before); expect(fileWorkspaceFor(other)).toBe(unaffected);
    expect(invoke).toHaveBeenCalledExactlyOnceWith('files.closeScope', own);
    await (await prepareFileWorkspaceClose(own, 'save')).commit();
    await (await prepareFileWorkspaceClose(other, 'save')).commit();
  });
  it('does not start a second save or recreate listeners when a committed view unmounts', async () => {
    vi.stubGlobal('window', { electronAPI: { eventOn: vi.fn(() => () => undefined) } });
    const f = setup(state(['once.txt'])); await f.store.initialize(); f.store.roots = { roots: [], unavailable: [] };
    const detach = f.store.attach(), prepare = vi.spyOn(f.store.active!.buffer!, 'prepareClose');
    const closing = await f.store.prepareSessionClose('save'); await closing.commit();
    detach(); f.store.attach()(); await f.store.flushDetachedViews();
    expect(prepare).toHaveBeenCalledOnce(); expect(f.api.closeScope).toHaveBeenCalledOnce();
    expect(window.electronAPI.eventOn).toHaveBeenCalledOnce();
  });
});

describe('G071 one-based location intent', () => {
  it('reuses the ordinary tab, ref and editor while locating a CRLF source point', async () => {
    const f = setup(), raw = '# Original\r\n\r\n第二行🙂 column target\r\nTail\r\n';
    f.api.read.mockImplementation(async ref => ({ document: f.documents.get(ref.id)!, base64: Buffer.from(raw).toString('base64') }));
    await f.store.initialize(); await f.store.open(root, 'location.md', true);
    const tab = f.store.active!, buffer = tab.buffer!, editor = buffer.editor, ref = buffer.file.ref;
    await f.store.open(root, 'location.md', true, { line: 3, column: 3 });
    expect(f.store.active).toBe(tab); expect(f.store.tabs).toHaveLength(1);
    expect(buffer.editor).toBe(editor); expect(buffer.file.ref).toBe(ref); expect(f.api.open).toHaveBeenCalledTimes(1);
    expect(buffer.reveal).toEqual({ from: 14, to: 14 }); expect(buffer.raw).toBe(raw); expect(buffer.dirty).toBe(false);
    expect(f.api.checkpoint).not.toHaveBeenCalled();
  });
  it('uses UTF-16 columns and bounds source locations without changing CRLF text', async () => {
    const f = setup(), raw = 'x\r\na🙂bc\r\nlast\r\n';
    f.api.read.mockImplementation(async ref => ({ document: f.documents.get(ref.id)!, base64: Buffer.from(raw).toString('base64') }));
    await f.store.initialize(); await f.store.open(root, 'location.csv', true, { line: 2, column: 4 });
    const buffer = f.store.active!.buffer!;
    expect(buffer.reveal).toEqual({ from: 5, to: 5 });
    await f.store.open(root, 'location.csv', true, { line: 999, column: 999 });
    expect(buffer.reveal).toEqual({ from: buffer.editor!.doc.length, to: buffer.editor!.doc.length });
    expect(buffer.raw).toBe(raw); expect(buffer.dirty).toBe(false); expect(f.api.checkpoint).not.toHaveBeenCalled();
  });
  it('does not deliver an old open hint to a different tab selected during the read', async () => {
    const f = setup(); await f.store.initialize();
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    f.api.read.mockImplementation(async ref => { const document = f.documents.get(ref.id)!; if (document.name === 'slow.txt') await gate; return { document, base64: Buffer.from('first\r\nsecond\r\n').toString('base64') }; });
    const opening = f.store.open(root, 'slow.txt', true, { line: 2, column: 3 });
    await vi.waitFor(() => expect(f.api.read).toHaveBeenCalledTimes(1));
    await f.store.open(root, 'current.txt', true); const current = f.store.active!;
    release(); await opening;
    expect(f.store.active).toBe(current); expect(current.buffer!.reveal).toBeNull();
    expect(f.store.tabs.find(tab => tab.route.relativePath === 'slow.txt')!.buffer!.reveal).toBeNull();
    expect(current.buffer!.raw).toBe('first\r\nsecond\r\n'); expect(f.api.checkpoint).not.toHaveBeenCalled();
  });
});

describe('G074 explicit viewer intent ownership', () => {
  const configuration = () => ({ adapters: [{ id: 'readonly-text', name: 'Readonly', enabled: true, suffixes: ['.md'], sources: ['project-directory'], provider: { kind: 'local-resource', writable: false } }], preferred: {} });
  it('cancels a delayed choice when another tab becomes active', async () => {
    const f = setup(); await f.store.initialize();
    await f.store.open(root, 'A.md', true); const a = f.store.active!;
    await f.store.open(root, 'B.md', true); const b = f.store.active!;
    let release!: (value: ReturnType<typeof configuration>) => void;
    const lookup = vi.fn(() => new Promise<ReturnType<typeof configuration>>(resolve => { release = resolve; }));
    Object.assign(f.api, { viewerConfiguration: lookup });
    const choosing = f.store.open(root, 'A.md', true, { fileViewer: 'readonly-text' });
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    f.store.activate(b.id); release(configuration()); await choosing;
    expect(f.store.active).toBe(b);
    expect(fileViewerChoice(a.buffer!)).toBeUndefined(); expect(fileViewerChoice(b.buffer!)).toBeUndefined();
    expect(f.api.open).toHaveBeenCalledTimes(2); expect(f.api.checkpoint).not.toHaveBeenCalled();
  });
  it('preserves editing started while the viewer configuration is in flight', async () => {
    const f = setup(); await f.store.initialize(); await f.store.open(root, 'A.md', true);
    const tab = f.store.active!, buffer = tab.buffer!, ref = buffer.file.ref;
    let release!: (value: ReturnType<typeof configuration>) => void;
    const lookup = vi.fn(() => new Promise<ReturnType<typeof configuration>>(resolve => { release = resolve; }));
    Object.assign(f.api, { viewerConfiguration: lookup });
    const choosing = f.store.open(root, 'A.md', true, { fileViewer: 'readonly-text' });
    const outcome = choosing.then(() => null, error => error);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
    const transaction = buffer.editor!.update({ changes: { from: 0, insert: 'UNSAVED ' } });
    buffer.acceptTransactions(transaction.state, [transaction]); release(configuration());
    expect(await outcome).toBeInstanceOf(Error);
    expect(f.store.active).toBe(tab); expect(buffer.file.ref).toBe(ref); expect(buffer.raw).toBe('UNSAVED BASE');
    expect(buffer.dirty).toBe(true); expect(fileViewerChoice(buffer)).toBeUndefined(); expect(f.api.open).toHaveBeenCalledTimes(1);
  });
  it('rejects an unavailable explicit target before opening or activating another document', async () => {
    const f = setup(); Object.assign(f.api, { viewerConfiguration: vi.fn(async () => configuration()) });
    await f.store.initialize(); await f.store.open(root, 'B.md', true); const b = f.store.active!;
    await expect(f.store.open(root, 'A.md', true, { fileViewer: 'missing-viewer' })).rejects.toThrow();
    expect(f.store.active).toBe(b); expect(f.store.tabs).toEqual([b]);
    expect(f.api.open).toHaveBeenCalledTimes(1); expect(fileViewerChoice(b.buffer!)).toBeUndefined();
  });
  it('combines the existing default viewer hint with an exact CRLF source point', async () => {
    const f = setup(), raw = 'first\r\n中文🙂 target\r\nlast\r\n';
    f.api.read.mockImplementation(async ref => ({ document: f.documents.get(ref.id)!, base64: Buffer.from(raw).toString('base64') }));
    await f.store.initialize(); await f.store.open(root, 'A.md', true);
    const tab = f.store.active!, buffer = tab.buffer!, editor = buffer.editor, ref = buffer.file.ref;
    await f.store.open(root, 'A.md', true, { fileViewer: 'default', line: 2, column: 5 });
    expect(fileViewerChoice(buffer)).toBeNull(); expect(buffer.reveal).toEqual({ from: 10, to: 10 });
    expect(f.store.active).toBe(tab); expect(f.store.tabs).toEqual([tab]); expect(buffer.editor).toBe(editor); expect(buffer.file.ref).toBe(ref);
    expect(buffer.raw).toBe(raw); expect(buffer.dirty).toBe(false); expect(f.api.checkpoint).not.toHaveBeenCalled();
  });
});

it.each([false, true])('D22 U: duplicate restore aliases merge canonically in either completion order, foreign host stays a placeholder (%s)', async reverse => {
  const inner = { ...root, sourceId: 'inner', path: '/fixture/nested', canonicalPath: '/fixture/nested', lease: randomUUID() }, a = route('nested/a.txt'), b = { ...route('a.txt'), sourceId: inner.sourceId, sourcePath: inner.path }, foreign = { ...a, hostId: 'foreign-host' };
  const saved = { ...state([]), routes: [a, b, foreign], active: b }, f = setup(saved); f.api.roots.mockResolvedValue({ roots: [root, inner], unavailable: [] });
  let first!: () => void, second!: () => void; const gates = [new Promise<void>(done => { first = done; }), new Promise<void>(done => { second = done; })]; let calls = 0;
  f.api.open.mockImplementation(async request => { const index = calls++; await gates[index]; const doc = { ...f.document(request.relativePath), documentKey: 'local:same-inode', absolutePath: '/fixture/nested/a.txt' }; f.documents.set(doc.ref.id, doc); return doc; });
  const loading = f.store.initialize(); await vi.waitFor(() => expect(calls).toBe(2));
  if (reverse) second(); else first(); await vi.waitFor(() => expect(f.store.tabs.filter(x => !!x.buffer)).toHaveLength(1));
  if (reverse) first(); else second(); await loading;
  expect(f.store.tabs).toHaveLength(2); const local = f.store.tabs.find(x => !!x.buffer)!, remote = f.store.tabs.find(x => x.route.hostId)!;
  expect(local.buffer!.raw).toBe('BASE'); expect(remote.buffer).toBeNull(); expect(remote.error).toMatch(/本机|不支持/); expect(f.store.active).toBe(local); expect(f.api.open).toHaveBeenCalledTimes(2);
});

it.each(['missing registration', 'changed path', 'restored with late metadata'])('D24 U: placeholder retry handles %s without substituting the healthy tree root', async scenario => {
  const missing = { ...route('A.txt'), sourceId: 'missing', sourcePath: '/gone' }, saved = { ...state(['B.txt']), routes: [missing, route('B.txt')], active: missing, treeSource: `${root.source}:${root.sourceId}:${root.path}` }, f = setup(saved);
  const recovered = { ...root, sourceId: 'missing', path: scenario === 'changed path' ? '/other' : '/gone', canonicalPath: scenario === 'changed path' ? '/other' : '/gone', lease: randomUUID() };
  const retry = vi.fn(async () => { if (scenario === 'missing registration') throw Error('Original registration missing'); return { roots: [recovered], unavailable: [] }; }); Object.assign(f.api, { retryRoot: retry, releaseRoot: vi.fn(async () => undefined) });
  await f.store.initialize(); const a = f.store.tabs[0], b = f.store.tabs[1], healthyRef = b.buffer!.file.ref; expect(a.buffer).toBeNull(); expect(f.store.active).toBe(a);
  let release!: () => void; const gate = new Promise<void>(done => { release = done; });
  if (scenario === 'restored with late metadata') f.api.open.mockImplementation(async request => { const file = { ...f.document(request.relativePath), absolutePath: '/gone/A.txt', ref: { id: randomUUID(), lease: recovered.lease, generation: recovered.generation } }; f.documents.set(file.ref.id, file); await gate; return file; });
  const loading = f.store.retryTab(a.id);
  if (scenario === 'restored with late metadata') {
    await vi.waitFor(() => expect(f.api.open.mock.calls.some(([input]) => input.lease === recovered.lease)).toBe(true)); f.store.activate(b.id); f.store.selectRoot(root); const edit = b.buffer!.editor!.update({ changes: { from: 0, to: b.buffer!.editor!.doc.length, insert: 'B MANUAL DRAFT' } }); b.buffer!.acceptTransactions(edit.state, [edit]); release();
  }
  await loading; expect(retry).toHaveBeenCalledTimes(1); expect(b.buffer!.file.ref).toBe(healthyRef); expect(f.store.treeRoot).toBe(root); expect(a.route).toEqual(missing);
  if (scenario === 'restored with late metadata') { expect(f.store.active).toBe(b); expect(b.buffer!.raw).toBe('B MANUAL DRAFT'); expect(b.buffer!.dirty).toBe(true); expect(a.buffer!.file.ref.lease).toBe(recovered.lease); }
  else { expect(a.buffer).toBeNull(); expect(a.error).toContain('原目录'); expect(f.api.open).toHaveBeenCalledTimes(1); }
});

describe('workspace restoration and durable route acknowledgement', () => {
  it.each(['allowed', 'blocked', 'rejected'] as const)('D11 a late %s close answer belongs only to its original buffer instance', async answer => {
    const f = setup(); await f.store.initialize(); await f.store.open(root, 'a.txt', true); const tab = f.store.active!, old = tab.buffer!;
    const transaction = old.editor!.update({ changes: { from: 0, insert: 'OLD ' } }); old.acceptTransactions(transaction.state, [transaction]);
    let resolve!: (value: boolean) => void, reject!: (error: Error) => void;
    vi.spyOn(old, 'prepareClose').mockImplementation(() => new Promise<boolean>((a, b) => { resolve = a; reject = b; }));
    const closing = f.store.close(tab.id), file = await f.api.open({ lease: root.lease, generation: root.generation, relativePath: 'a.txt' });
    const replacement = new FileBuffer(file, f.api as unknown as FileClient, () => {}); await replacement.load();
    const newEdit = replacement.editor!.update({ changes: { from: 0, insert: 'NEW ' } }); replacement.acceptTransactions(newEdit.state, [newEdit]); tab.buffer = replacement;
    if (answer === 'rejected') reject(new Error('Old context failed')); else resolve(answer === 'allowed');
    expect(await closing).toBe('stale'); expect(f.store.active).toBe(tab); expect(tab.buffer).toBe(replacement); expect(tab.error).toBe(''); expect(replacement.raw).toBe('NEW BASE'); old.dispose();
  });
  it('D15 hidden directory layout survives a workspace restart while legacy records default visible', async () => {
    const f = setup(state(['a.txt'])); await f.store.initialize();
    f.store.setTreeVisible(false); await f.store.flushPersistence();
    expect(f.saved()!).toMatchObject({ treeVisible: false });
    const restored = setup(f.saved()); await restored.store.initialize();
    expect(restored.store).toMatchObject({ treeVisible: false });
    const legacy = setup(state(['a.txt'])); await legacy.store.initialize(); expect(legacy.store).toMatchObject({ treeVisible: true });
  });
  it('D07 dragging the first fixed tab onto the last restores both directions without changing active identity', async () => {
    const f = setup(state(['a.txt', 'b.txt', 'c.txt'])); await f.store.initialize();
    const [a, b, c] = f.store.tabs; f.store.activate(b.id);
    f.store.reorder(a.id, c.id);
    expect(f.store.tabs).toEqual([b, c, a]); expect(f.store.active).toBe(b);
    f.store.reorder(a.id, b.id);
    expect(f.store.tabs).toEqual([a, b, c]); expect(f.store.active).toBe(b);
    await f.store.flushPersistence(); expect(f.saved()!.routes.map(route => route.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt']);
  });
  it('D17 delayed successful restoration cannot replace the user selection opened meanwhile', async () => {
    const f = setup(state(['a.txt', 'b.txt'])), original = f.api.open.getMockImplementation()!;
    const held = new Map<string, () => void>();
    f.api.open.mockImplementation(async request => {
      const value = await original(request);
      if (request.relativePath !== 'c.txt') await new Promise<void>(resolve => held.set(request.relativePath, resolve));
      return value;
    });
    const initializing = f.store.initialize();
    for (let i = 0; held.size < 2 && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 1));
    expect(held.size).toBe(2); await f.store.open(root, 'c.txt', true); const selected = f.store.active!;
    held.get('b.txt')!(); held.get('a.txt')!(); await initializing;
    expect(f.store.active).toBe(selected); expect(selected.buffer!.raw).toBe('BASE');
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(f.store.tabs.every(tab => tab.buffer?.raw === 'BASE')).toBe(true);
  });
  it('D12 reopens closed routes at their original indices in reverse close order', async () => {
    const f = setup(state(['a.txt', 'b.txt', 'c.txt', 'd.txt'])); await f.store.initialize();
    await f.store.close(f.store.tabs[1].id); await f.store.close(f.store.tabs[1].id);
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['a.txt', 'd.txt']);
    await f.store.restoreClosed();
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['a.txt', 'c.txt', 'd.txt']);
    expect(f.store.active!.route.relativePath).toBe('c.txt');
    await f.store.restoreClosed();
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt', 'd.txt']);
    expect(f.store.active!.route.relativePath).toBe('b.txt');
  });
  it('D12 does not duplicate or reorder an already-open route when undoing its old close', async () => {
    const f = setup(state(['a.txt', 'b.txt', 'c.txt'])); await f.store.initialize();
    await f.store.close(f.store.tabs[1].id); await f.store.open(root, 'b.txt', true);
    const live = f.store.active!, order = [...f.store.tabs]; await f.store.restoreClosed();
    expect(f.store.tabs).toEqual(order); expect(f.store.active).toBe(live);
    expect(f.store.tabs).toHaveLength(3); expect(f.store.canRestoreClosed).toBe(false);
  });
  it('D12 a failed reopen retains an identifiable error tab at the original position', async () => {
    const f = setup(state(['a.txt', 'b.txt', 'c.txt'])); await f.store.initialize();
    await f.store.close(f.store.tabs[1].id); f.api.open.mockRejectedValueOnce(new Error('MISSING deleted b.txt'));
    await f.store.restoreClosed();
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(f.store.active!.error).toContain('MISSING deleted b.txt'); expect(f.store.active!.buffer).toBeNull();
  });
  it('D12 an unavailable original root retains its route and index instead of opening another root', async () => {
    const f = setup(state(['a.txt', 'b.txt', 'c.txt'])); await f.store.initialize();
    await f.store.close(f.store.tabs[1].id); f.store.roots = { roots: [], unavailable: [] };
    await f.store.restoreClosed();
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    expect(f.store.active!.route.sourcePath).toBe('/fixture'); expect(f.store.active!.error).toContain('原目录来源当前不可用');
  });
  it('D12 an already reopened route stays unique when its root becomes unavailable before undo', async () => {
    const f = setup(state(['a.txt', 'b.txt'])); await f.store.initialize();
    await f.store.close(f.store.tabs[1].id); await f.store.open(root, 'b.txt', true);
    const live = f.store.active!; f.store.roots = { roots: [], unavailable: [] };
    await f.store.restoreClosed();
    expect(f.store.tabs.filter(tab => tab.route.relativePath === 'b.txt')).toEqual([live]);
    expect(f.store.active).toBe(live);
  });
  it('D13 closing 26 fixed files retains exactly the latest 25 recoverable routes', async () => {
    const names = Array.from({ length: 26 }, (_, i) => `file-${i}.txt`), f = setup(state(names)); await f.store.initialize();
    for (const name of names) await f.store.close(f.store.tabs.find(tab => tab.route.relativePath === name)!.id);
    const reopened: string[] = [];
    while (f.store.canRestoreClosed) { await f.store.restoreClosed(); reopened.push(f.store.active!.route.relativePath); }
    expect(reopened).toEqual(names.slice(1).reverse()); expect(f.store.tabs).toHaveLength(25);
    expect(f.store.tabs.some(tab => tab.route.relativePath === names[0])).toBe(false);
  });
  it('H01 coalesces a pending failed-open retry and releases its late capability after closing the tab', async () => {
    const f = setup(); await f.store.initialize(); f.api.open.mockRejectedValueOnce(new Error('Open failed'));
    await f.store.open(root, 'retry.txt', true); const tab = f.store.active!; expect(tab.buffer).toBeNull();
    let deliver!: (value: FileDocument) => void;
    f.api.open.mockImplementationOnce(() => new Promise<FileDocument>(resolve => { deliver = resolve; }));
    const retry = f.store.retryTab(tab.id); await f.store.retryTab(tab.id); f.store.activate(tab.id); await f.store.open(root, 'retry.txt');
    expect(f.api.open).toHaveBeenCalledTimes(2); expect(f.store.tabs).toHaveLength(1);
    expect(await f.store.close(tab.id)).toBe('closed'); const late = f.document('retry.txt'); deliver(late); await retry;
    expect(f.store.tabs).toHaveLength(0); expect(f.api.closeDocument).toHaveBeenCalledWith(late.ref);
  });
  it('H01 cannot redirect a failed-open retry into an unavailable root', async () => {
    const f = setup(); await f.store.initialize(); f.api.open.mockRejectedValueOnce(new Error('Open failed'));
    await f.store.open(root, 'retry.txt', true); const tab = f.store.active!; f.store.roots = { roots: [], unavailable: [] };
    await f.store.retryTab(tab.id); expect(tab.buffer).toBeNull(); expect(tab.error).toContain('原目录来源当前不可用');
    expect(f.api.open).toHaveBeenCalledTimes(1); expect(tab.route.sourcePath).toBe('/fixture');
  });
  it('restores the closed PDF page/zoom on a fresh capability and preserves an already-open reader', async () => {
    const f = setup(); await f.store.initialize(); await f.store.open(root, 'reader.pdf', true);
    const first = f.store.active!, ref = first.buffer!.file.ref;
    Object.assign(first.buffer!.pdfPosition, { page: 3, zoom: 150, initialized: true });
    await f.store.close(first.id); await f.store.restoreClosed();
    expect(f.store.active!.buffer!.file.ref.id).not.toBe(ref.id);
    expect(f.api.closeDocument).toHaveBeenCalledWith(ref);
    expect(f.store.active!.buffer!.pdfPosition).toEqual({ page: 3, zoom: 150, initialized: true });
    const live = f.store.active!; await f.store.open(root, 'reader.pdf');
    expect(f.store.active).toBe(live); expect(f.store.tabs).toHaveLength(1);
  });
  it('serializes PDF restore hints without capabilities and restores them after a workspace reload', async () => {
    const f = setup(); await f.store.initialize(); await f.store.open(root, 'reader.pdf');
    Object.assign(f.store.active!.buffer!.pdfPosition, { page: 3, zoom: 150, initialized: true });
    f.store.pin(f.store.active!.id); await f.store.flushPersistence();
    expect(f.saved()!.routes[0]).toMatchObject({ relativePath: 'reader.pdf', pdf: { page: 3, zoom: 150 } });
    expect(JSON.stringify(f.saved())).not.toMatch(/lease|willyou-assets|canvas|password/);
    const next = setup(f.saved()); await next.store.initialize();
    expect(next.store.active!.buffer!.pdfPosition).toEqual({ page: 3, zoom: 150, initialized: true });
    const legacy = setup(state(['reader.pdf'])); await legacy.store.initialize();
    expect(legacy.store.active!.buffer!.pdfPosition).toEqual({ page: 1, zoom: 100, initialized: false });
  });
  it('notifies and persists PDF navigation changes but ignores unchanged, invalid and disposed reader updates', async () => {
    const f = setup(); await f.store.initialize(); await f.store.open(root, 'reader.pdf', true);
    const buffer = f.store.active!.buffer!, changed = vi.fn(), detach = f.store.subscribe(changed);
    buffer.updatePdfPosition({ page: 3, zoom: 150, initialized: true }); await f.store.flushPersistence();
    expect(f.saved()!.routes[0].pdf).toEqual({ page: 3, zoom: 150 }); const before = changed.mock.calls.length;
    buffer.updatePdfPosition({ page: 3, zoom: 150, initialized: true });
    buffer.updatePdfPosition({ page: NaN, zoom: Infinity }); expect(changed).toHaveBeenCalledTimes(before);
    await f.store.close(f.store.active!.id); const after = changed.mock.calls.length;
    buffer.updatePdfPosition({ page: 8 }); expect(changed).toHaveBeenCalledTimes(after); detach();
  });
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
