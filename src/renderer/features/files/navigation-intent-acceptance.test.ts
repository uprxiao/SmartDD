import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
import { chooseFileViewer, fileViewerChoice } from './viewer-choice';

vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => {} } }));
const stores: FileWorkspaceStore[] = [];
afterEach(() => stores.splice(0).forEach(store => store.dispose()));
const raw = '# First\r\n中文🙂 second\r\nThird\r\nLast\r\n';
function fixture() {
  const root: FileRoot = { source: 'project-directory', sourceId: 'navigation', path: '/fixture', canonicalPath: '/fixture', lease: randomUUID(), generation: 1, label: 'Navigation fixture', identity: { device: '1', inode: '2' } };
  const files = new Map<string, FileDocument>();
  const api = {
    roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []),
    open: vi.fn(async (input: { relativePath: string; readOnly?: boolean }) => {
      const name = input.relativePath, file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, name, relativePath: name, absolutePath: '/fixture/' + name, documentKey: name,
        writable: !input.readOnly, revision: { device: '1', inode: name, size: Buffer.byteLength(raw), hash: createHash('sha256').update(raw).digest('hex'), modifiedNs: '1', changedNs: '1' },
        content: name.endsWith('.pdf') ? { kind: 'pdf', mime: 'application/pdf', basis: 'extension' } : { kind: 'text', basis: 'sample' } };
      files.set(file.ref.id, file); return file;
    }),
    read: vi.fn(async (ref: { id: string }) => ({ document: files.get(ref.id)!, base64: Buffer.from(raw).toString('base64') })),
    refresh: vi.fn(async (ref: { id: string }) => files.get(ref.id)!), drafts: vi.fn(async () => []), save: vi.fn(), checkpoint: vi.fn(),
    viewerConfiguration: vi.fn(), closeDocument: vi.fn(async () => {}), closeScope: vi.fn(async () => {}),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: randomUUID() }, api as unknown as FileClient, null, null); stores.push(store);
  return { root, api, store };
}

// Existing local Store/FileBuffer integration. Source transport is isolated;
// these tests do not claim an originating artifact/title App caller or PDF UI.
it('a fresh Markdown preview title selects readonly review without renaming or rewriting its source', async () => {
  const { root, api, store } = fixture(); await store.initialize();
  await store.open(root, 'target.md', true, { filePreviewTitle: 'Review 中文🙂' } as never);
  const buffer = store.active!.buffer!;
  expect(buffer.navigationView).toBe('review'); expect(buffer.editable).toBe(false);
  expect(Reflect.get(buffer, 'previewTitle')).toBe('Review 中文🙂'); expect(buffer.file.name).toBe('target.md'); expect(buffer.raw).toBe(raw);
  expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});

it.each(['md', 'csv', 'pdf'])('title alone reuses an existing %s viewer and physical document', async suffix => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.' + suffix, true);
  const tab = store.active!, buffer = tab.buffer!, editor = buffer.editor, mode = buffer.mode, ref = buffer.file.ref;
  await store.open(root, 'target.' + suffix, true, { filePreviewTitle: 'New title' } as never);
  expect(store.active).toBe(tab); expect(tab.buffer).toBe(buffer); expect(buffer.file.ref).toBe(ref); expect(buffer.editor).toBe(editor);
  expect(buffer.mode).toBe(mode); expect(buffer.navigationView).toBeNull(); expect(Reflect.get(buffer, 'previewTitle')).toBeNull();
  expect(api.open).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});

it.each(['csv', 'pdf'])('a fresh %s title takes its mapped artifact instead of forcing text review', async suffix => {
  const { root, store } = fixture(); await store.initialize();
  await store.open(root, 'target.' + suffix, true, { filePreviewTitle: 'Fallback-only title' } as never);
  const buffer = store.active!.buffer!; expect(buffer.mode).toBe('document'); expect(buffer.navigationView).toBeNull(); expect(Reflect.get(buffer, 'previewTitle')).toBeNull();
});

it.each(['md', 'csv', 'pdf'])('title plus a point keeps %s in readonly review with the same ref and exact text location', async suffix => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.' + suffix, true);
  const tab = store.active!, buffer = tab.buffer!, ref = buffer.file.ref;
  await store.open(root, 'target.' + suffix, true, { line: 2, column: 3, filePreviewTitle: 'Located review' } as never);
  expect(store.active).toBe(tab); expect(buffer.file.ref).toBe(ref); expect(buffer.navigationView).toBe('review'); expect(buffer.editable).toBe(false);
  expect(Reflect.get(buffer, 'previewTitle')).toBe('Located review');
  if (suffix !== 'pdf') { expect(buffer.raw).toBe(raw); expect(buffer.reveal).toEqual({ from: 10, to: 10 }); }
  else { expect(buffer.editor).toBeNull(); expect(buffer.reveal).toBeNull(); }
  expect(api.open).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});

it('explicit CSV artifact intent reuses a buffer, preserves its authority and queues the typed range before a view mounts', async () => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.csv', true);
  const tab = store.active!, buffer = tab.buffer!, ref = buffer.file.ref, editor = buffer.editor, source = buffer.source;
  chooseFileViewer(buffer, 'remembered-viewer');
  const target = { artifactKind: 'workbook', sheet: 'target.csv', range: 'B2:C3' };
  await store.open(root, 'target.csv', true, { artifactNavigationTarget: target, line: 3, endLine: 4 } as never);
  expect(store.active).toBe(tab); expect(buffer.file.ref).toBe(ref); expect(buffer.editor).toBe(editor); expect(buffer.source).toBe(source);
  expect(buffer.mode).toBe('document'); expect(buffer.navigationView).toBeNull(); expect(buffer.file.writable).toBe(true); expect(buffer.raw).toBe(raw);
  expect(Reflect.get(buffer, 'artifactView')).toBe(true); expect(Reflect.get(buffer, 'artifactNavigation')!.target).toEqual(target);
  expect(fileViewerChoice(buffer)).toBe('remembered-viewer');
  await store.open(root, 'target.csv', true); expect(Reflect.get(buffer, 'artifactNavigation')).toBeNull(); expect(Reflect.get(buffer, 'artifactView')).toBe(false);
  expect(fileViewerChoice(buffer)).toBe('remembered-viewer'); expect(api.open).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});

it.each(['pdf', 'tex'])('queues a real document-page target for the existing %s document view', async suffix => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.' + suffix, true); const tab = store.active!, buffer = tab.buffer!;
  await store.open(root, 'target.' + suffix, true, { artifactNavigationTarget: { artifactKind: 'document', pageNumber: 3 } } as never);
  expect(store.active).toBe(tab); expect(buffer.mode).toBe('document'); expect(buffer.navigationView).toBeNull();
  expect(Reflect.get(buffer, 'artifactNavigation')!.target).toEqual({ artifactKind: 'document', pageNumber: 3 });
  expect(api.open).toHaveBeenCalledTimes(1); expect(api.save).not.toHaveBeenCalled();
});

it('rejects malformed or unsupported target shapes and explicit-viewer conflicts before changing an existing tab', async () => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.csv', true); const tab = store.active!, buffer = tab.buffer!;
  for (const artifactNavigationTarget of [true, { key: 'not-a-target' }, { artifactKind: 'document', pageNumber: 0 }, { artifactKind: 'workbook', sheet: 'other.csv', range: 'A1' }, { artifactKind: 'workbook', sheet: 'target.csv', objectId: 'not-supported' }]) {
    await expect(store.open(root, 'target.csv', true, { artifactNavigationTarget } as never)).rejects.toThrow();
    expect(store.active).toBe(tab); expect(tab.buffer).toBe(buffer); expect(buffer.mode).toBe('source');
  }
  await expect(store.open(root, 'target.csv', true, { fileViewer: 'explicit-adapter', filePreviewTitle: 'Review' } as never)).rejects.toThrow();
  expect(api.viewerConfiguration).not.toHaveBeenCalled(); expect(api.open).toHaveBeenCalledTimes(1);
});

it('protects a dirty source before moving it into a title review or artifact pane', async () => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.csv', true); const buffer = store.active!.buffer!; buffer.pauseAutosave();
  const tx = buffer.editor!.update({ changes: { from: 0, insert: 'LOCAL ' } }); buffer.acceptTransactions(tx.state, [tx]);
  for (const options of [{ line: 2, filePreviewTitle: 'Review' }, { artifactNavigationTarget: { artifactKind: 'workbook', sheet: 'target.csv', range: 'A1' } }]) await expect(store.open(root, 'target.csv', true, options as never)).rejects.toThrow(/保存/);
  expect(buffer.mode).toBe('source'); expect(buffer.navigationView).toBeNull(); expect(buffer.raw).toBe('LOCAL ' + raw); expect(buffer.dirty).toBe(true); expect(api.save).not.toHaveBeenCalled();
});

it('keeps ordinary and two readonly source identities separate when a source supplies a display target', async () => {
  const { root, api, store } = fixture(); await store.initialize(); await store.open(root, 'target.csv', true);
  const ordinary = store.active!, source = ordinary.buffer!.source;
  await store.openAttachment(root, 'target.csv', { key: 'source-A' }, { artifactNavigationTarget: { artifactKind: 'workbook', sheet: 'target.csv', range: 'A1' } });
  const a = store.active!;
  await store.openAttachment(root, 'target.csv', { key: 'source-B' }); const b = store.active!;
  expect(store.tabs).toHaveLength(3); expect(new Set(store.tabs.map(tab => tab.buffer!.file.ref.id)).size).toBe(3);
  for (const tab of [a, b]) { expect(tab.buffer!.file.writable).toBe(false); expect(tab.buffer!.editable).toBe(false); }
  expect(a.buffer!.artifactNavigation?.target).toEqual({ artifactKind: 'workbook', sheet: 'target.csv', range: 'A1' });
  await a.buffer!.refresh(); expect(a.buffer!.file.writable).toBe(false);
  await store.open(root, 'target.csv', true, { line: 2 }); expect(store.active).toBe(ordinary); expect(ordinary.buffer!.source).toBe(source); expect(ordinary.buffer!.file.writable).toBe(true);
  expect(api.open).toHaveBeenCalledTimes(3); expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});

it('does not publish an older target after a newer navigation wins while the old file is loading', async () => {
  const { root, api, store } = fixture(); await store.initialize();
  const load = api.open.getMockImplementation()!, oldFile = await load({ relativePath: 'target.csv' });
  let resolve!: (file: FileDocument) => void;
  api.open.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const older = store.open(root, 'target.csv', true, { artifactNavigationTarget: { artifactKind: 'workbook', sheet: 'target.csv', range: 'B2:C3' } });
  await store.open(root, 'newer.md', true); const newer = store.active;
  resolve(oldFile); await older;
  expect(store.active).toBe(newer); expect(store.active!.buffer!.file.name).toBe('newer.md');
  expect(store.tabs.find(tab => tab.route.relativePath === 'target.csv')!.buffer!.artifactNavigation).toBeNull();
  expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
});
