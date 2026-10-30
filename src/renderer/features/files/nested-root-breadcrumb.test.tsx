// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { useSyncExternalStore } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot, PathRequest } from '@shared/files';
import { FileBreadcrumb } from './breadcrumb';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
const mocked = vi.hoisted(() => ({ add: vi.fn(async () => undefined), openWebLink: vi.fn(async () => undefined) }));
vi.mock('./terminal-context/context', () => ({ useFileTerminalContext: () => ({ add: mocked.add }) }));
vi.mock('@renderer/lib/ipc', () => ({ events: { on: () => () => undefined }, rpc: { files: { applications: async () => ({ id: 'none', apps: [] }), openWebLink: mocked.openWebLink } } }));
const stores: FileWorkspaceStore[] = [];
afterEach(() => { cleanup(); stores.splice(0).forEach(s => s.dispose()); vi.clearAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const root = (path: string, label: string): FileRoot => ({ source: 'project-directory', sourceId: label, path, canonicalPath: path, label, lease: randomUUID(), generation: 1, identity: { device: '1', inode: label } });
  const outer = root('/a', 'Outer'), inner = root('/a/b', 'Inner'), documents = new Map<string, FileDocument>();
  const api = {
    roots: async () => ({ roots: [outer, inner], unavailable: [] }),
    list: vi.fn(async (input: PathRequest) => input.relativePath === 'b' ? [{ name: 'a.md', relativePath: 'b/a.md', kind: 'file', identity: { device: '1', inode: 'a.md' } }] : []),
    open: vi.fn(async (input: PathRequest) => { const file: FileDocument = { ref: { id: randomUUID(), lease: input.lease, generation: 1 }, documentKey: 'local:1:' + input.relativePath, name: input.relativePath.split('/').at(-1)!, relativePath: input.relativePath, absolutePath: '/a/' + input.relativePath, writable: true, revision: { device: '1', inode: input.relativePath, hash: 'a'.repeat(64), size: 5, modifiedNs: '1', changedNs: '1' } }; documents.set(file.ref.id, file); return file; }),
    read: async (ref: { id: string }) => ({ document: documents.get(ref.id)!, base64: btoa('BASE\n') }), refresh: async (ref: { id: string }) => documents.get(ref.id)!, drafts: async () => [], closeDocument: async () => undefined, closeScope: async () => undefined,
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'fixture' }, api as unknown as FileClient, null, null); stores.push(store); await store.initialize(); await store.open(outer, 'b/x.txt', true); store.selectRoot(inner);
  const failures: unknown[] = [], repository = { id: 'repo', head: 'a'.repeat(40), prefix: '', webBase: 'https://github.com/fixture/repo' };
  function View() { useSyncExternalStore(store.subscribe, store.snapshot); return <FileBreadcrumb store={store} repository={repository} run={work => { void work().catch(e => failures.push(e)); }} />; }
  render(<View />); return { store, outer, inner, api, failures };
}
it('shows the longest root but lists and opens breadcrumbs through the issuing route, bounded at the display root', async () => {
  const f = await fixture(), user = userEvent.setup();
  expect(screen.queryByRole('button', { name: 'Outer' })).toBeNull(); expect(screen.getByRole('button', { name: 'x.txt' }).title).toBe('/a/b/x.txt');
  await user.click(screen.getByRole('button', { name: 'Inner' }));
  await user.click(await screen.findByRole('button', { name: 'a.md' }));
  await waitFor(() => expect(f.store.active!.route.relativePath).toBe('b/a.md'));
  expect(f.api.list).toHaveBeenCalledWith(expect.objectContaining({ lease: f.outer.lease, relativePath: 'b' }));
  expect(f.api.open).toHaveBeenLastCalledWith(expect.objectContaining({ lease: f.outer.lease, relativePath: 'b/a.md' })); expect(f.store.treeRoot).toBe(f.inner);
  await user.click(screen.getByRole('button', { name: 'Inner' })); await waitFor(() => expect(document.querySelector('.fw-breadcrumb-popup .fw-breadcrumb-location')?.textContent).toBe('Inner'));
  expect(screen.queryByRole('button', { name: '上级目录' })).toBeNull(); expect(f.failures).toEqual([]);
});
it('keeps display-relative copies, source-relative Git links and current-tree terminal references distinct', async () => {
  const f = await fixture(), user = userEvent.setup(), sink = vi.spyOn(navigator.clipboard, 'writeText'), button = screen.getByRole('button', { name: 'x.txt' });
  fireEvent.contextMenu(button); await user.click(await screen.findByRole('menuitem', { name: '复制相对路径' })); expect(sink).toHaveBeenLastCalledWith('x.txt');
  fireEvent.contextMenu(button); await user.click(await screen.findByRole('menuitem', { name: '添加到终端引用' }));
  expect(mocked.add).toHaveBeenLastCalledWith({ lease: f.inner.lease, generation: 1, relativePath: 'x.txt' }, f.store.active!.buffer!.file.revision);
  fireEvent.contextMenu(button); await user.click(await screen.findByRole('menuitem', { name: '在 GitHub 中打开' }));
  expect(mocked.openWebLink).toHaveBeenLastCalledWith(`https://github.com/fixture/repo/blob/${'a'.repeat(40)}/b/x.txt`); expect(f.failures).toEqual([]);
});
