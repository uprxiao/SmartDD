// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import type { ViewerConfiguration, ViewerOpenInput, ViewerSession } from '@shared/file-viewer';
const viewer = vi.hoisted(() => ({ configuration: vi.fn(), open: vi.fn(), close: vi.fn(), status: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { viewerConfiguration: viewer.configuration, openViewer: viewer.open, closeViewer: viewer.close, viewerStatus: viewer.status } }, events: { on: () => () => {} } }));
import { FileBuffer, type FileClient } from '../file-buffer';
import { FileWorkspaceStore } from '../workspace-store';
import { McpViewerSlot } from './viewer';
import { chooseFileViewer, fileViewerChoice } from '../viewer-choice';
const raw = '# Heading\r\n\r\n中文🙂 prefix NEEDLE suffix\r\n';
const digest = createHash('sha256').update(raw).digest('hex');
const config: ViewerConfiguration = { adapters: [{ id: 'readonly-text', name: 'Unit readonly adapter', enabled: true, suffixes: ['.md'], sources: ['project-directory'], provider: { kind: 'local-resource', writable: false } }], preferred: { '.md': 'readonly-text' } };
const buffers: FileBuffer[] = [], stores: FileWorkspaceStore[] = [], caches: QueryClient[] = [];
function fixture(name = 'route.md') {
  const root: FileRoot = { source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', label: 'Fixture', lease: randomUUID(), generation: 1, identity: { device: '1', inode: '2' } };
  const file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, documentKey: randomUUID(), name, relativePath: name, absolutePath: '/fixture/' + name, writable: true, revision: { device: '1', inode: '3', hash: digest, size: Buffer.byteLength(raw), modifiedNs: '1', changedNs: '1' } };
  const api = { roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []), open: vi.fn(async () => file), read: vi.fn(async () => ({ document: file, base64: Buffer.from(raw).toString('base64') })), refresh: vi.fn(async () => file), drafts: vi.fn(async () => []), readDraft: vi.fn(), resolveDraft: vi.fn(), checkpoint: vi.fn(), save: vi.fn(), closeDocument: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined) };
  const buffer = new FileBuffer(file, api, vi.fn()); buffers.push(buffer);
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'fixture' }, api as unknown as FileClient, null, null); stores.push(store);
  return { buffer, store, root, api };
}
function mount(buffer: FileBuffer) {
  const cache = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); caches.push(cache);
  return render(<QueryClientProvider client={cache}><McpViewerSlot buffer={buffer} source="project-directory"><div data-testid="builtin">Builtin source editor</div></McpViewerSlot></QueryClientProvider>);
}
async function resource() { await waitFor(() => expect(document.querySelector('pre')?.textContent).toBe(raw)); expect(screen.queryByTestId('builtin')).toBeNull(); }
beforeEach(() => {
  vi.clearAllMocks(); viewer.configuration.mockResolvedValue(structuredClone(config)); viewer.close.mockResolvedValue(undefined);
  viewer.status.mockImplementation(async (id: string) => ({ id, invalidated: false, droppedNotifications: 0 }));
  viewer.open.mockImplementation(async (input: ViewerOpenInput): Promise<ViewerSession> => ({ id: input.id, adapterId: input.adapterId, uri: 'fixture://exact-resource', generation: 1, writable: false, presentation: 'resource', subscribed: false, resource: { uri: 'fixture://exact-resource', mimeType: 'text/markdown', bytes: Buffer.byteLength(raw), base64: Buffer.from(raw).toString('base64'), etag: digest } }));
});
afterEach(() => { cleanup(); stores.splice(0).forEach(s => s.dispose()); buffers.splice(0).forEach(b => b.dispose()); caches.splice(0).forEach(c => c.clear()); });
describe('source navigation with a preferred readonly viewer (U: RPC resource boundary isolated)', () => {
  it('ordinary load and refresh retain the preferred adapter and source bytes', async () => {
    const f = fixture(); await f.buffer.load(); mount(f.buffer); await resource(); await act(() => f.buffer.refresh()); await resource();
    expect(f.buffer.raw).toBe(raw); expect(f.buffer.dirty).toBe(false); expect(f.api.save).not.toHaveBeenCalled();
  });
  it('an accepted source range reveals builtin content without replacing the document or changing CRLF/UTF16 offsets', async () => {
    const f = fixture(); await f.buffer.load(); mount(f.buffer); await resource(); const editor = f.buffer.editor, ref = f.buffer.file.ref;
    act(() => f.buffer.revealSourceRange(raw.indexOf('NEEDLE'), raw.indexOf('NEEDLE') + 6));
    await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull()); expect(document.querySelector('pre')).toBeNull();
    expect(f.buffer.reveal).toEqual({ from: raw.replace(/\r\n/g, '\n').indexOf('NEEDLE'), to: raw.replace(/\r\n/g, '\n').indexOf('NEEDLE') + 6 });
    expect(f.buffer.editor).toBe(editor); expect(f.buffer.file.ref).toBe(ref); expect(f.buffer.raw).toBe(raw); expect(f.buffer.dirty).toBe(false);
    await waitFor(() => expect(viewer.close).toHaveBeenCalledWith(viewer.open.mock.calls[0][0].id));
  });
  it('an explicit source/document mode switch reveals the chosen builtin mode on the existing tab', async () => {
    const f = fixture(); await f.store.initialize(); await f.store.open(f.root, 'route.md'); const tab = f.store.active!, buffer = tab.buffer!; mount(buffer); await resource();
    await act(() => f.store.setMode(buffer, 'source'));
    await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull()); expect(buffer.mode).toBe('source'); expect(tab.route.mode).toBe('source'); expect(f.store.active).toBe(tab); expect(f.store.tabs).toHaveLength(1); expect(f.api.open).toHaveBeenCalledTimes(1);
  });
  it('a failed guarded mode save keeps the prior adapter/mode and the unsaved source', async () => {
    const f = fixture(); await f.store.initialize(); await f.store.open(f.root, 'route.md'); const buffer = f.store.active!.buffer!; mount(buffer); await resource();
    const tx = buffer.editor!.update({ changes: { from: 0, insert: 'LOCAL ' } }); buffer.acceptTransactions(tx.state, [tx]); vi.spyOn(buffer, 'save').mockResolvedValue(false); buffer.saveError = 'save denied';
    await act(async () => { await expect(f.store.setMode(buffer, 'source')).rejects.toThrow('save denied'); }); await resource();
    expect(buffer.mode).toBe('document'); expect(buffer.raw).toBe('LOCAL ' + raw); expect(buffer.dirty).toBe(true);
  });
  it('a later manual adapter or automatic choice supersedes navigation without changing the registered preference', async () => {
    const f = fixture(); await f.buffer.load(); mount(f.buffer); await resource();
    act(() => f.buffer.revealSourceRange(0, 0)); await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull());
    act(() => chooseFileViewer(f.buffer, 'readonly-text')); await resource();
    act(() => chooseFileViewer(f.buffer, undefined)); await resource(); expect(fileViewerChoice(f.buffer)).toBeUndefined();
    act(() => f.buffer.revealSourceRange(0, 0)); await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull());
    expect(await viewer.configuration()).toEqual(config); expect(f.api.save).not.toHaveBeenCalled(); expect(f.buffer.raw).toBe(raw);
  });
  it('a clean explicit request for the current document mode also reveals the builtin view', async () => {
    const f = fixture(); await f.store.initialize(); await f.store.open(f.root, 'route.md'); const buffer = f.store.active!.buffer!; mount(buffer); await resource();
    await act(() => f.store.setMode(buffer, 'document')); await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull()); expect(buffer.mode).toBe('document'); expect(f.api.save).not.toHaveBeenCalled();
  });
  it('choice remains attached to one physical buffer across view remounts, while another file keeps its default', async () => {
    const a = fixture(), b = fixture(); await a.buffer.load(); await b.buffer.load(); const view = mount(a.buffer); await resource();
    act(() => a.buffer.revealSourceRange(0, 0)); await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull()); view.unmount();
    const remounted = mount(a.buffer); await waitFor(() => expect(screen.queryByTestId('builtin')).not.toBeNull()); remounted.unmount();
    mount(b.buffer); await resource(); expect(fileViewerChoice(a.buffer)).toBeNull(); expect(fileViewerChoice(b.buffer)).toBeUndefined(); expect(b.buffer.reveal).toBeNull();
  });
  it.each(['html', 'csv', 'tex'])('a validated %s search location selects the source mode so its range cannot stay behind a rendered preview', async extension => {
    const name = 'route.' + extension, f = fixture(name); await f.store.initialize(); await f.store.open(f.root, name); const tab = f.store.active!, buffer = tab.buffer!, editor = buffer.editor;
    await f.store.setMode(buffer, 'document'); expect(buffer.mode).toBe('document'); const from = raw.indexOf('NEEDLE');
    await f.store.openSearchRow(f.root, { relativePath: name, revision: buffer.file.revision, line: 3, rawOffset: from, text: 'NEEDLE', ranges: [{ from: 0, to: 6 }], rangesTruncated: false });
    expect(buffer.mode).toBe('source'); expect(tab.route.mode).toBe('source'); expect(fileViewerChoice(buffer)).toBeNull(); expect(buffer.editor).toBe(editor); expect(buffer.raw).toBe(raw); expect(f.store.tabs).toEqual([tab]); expect(f.api.open).toHaveBeenCalledTimes(1); expect(f.api.save).not.toHaveBeenCalled();
  });
});
