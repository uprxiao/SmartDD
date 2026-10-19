// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { DirectoryListRequest, FileRef, FileScope, PathRequest } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: async () => ({ id: 'none', apps: [], preferredUnavailable: false }) } }, events: { on: () => () => undefined } }));
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
async function fixture(height = 140) {
  const base = realpathSync(mkdtempSync('/private/tmp/willyou-tree-reveal-')), project = join(base, 'project'), second = join(base, 'second');
  for (const path of [project, second, join(base, 'userdata'), join(project, 'level1'), join(project, 'level1/level2')]) mkdirSync(path);
  for (let i = 0; i < 80; i++) mkdirSync(join(project, 'aaa-' + String(i).padStart(3, '0')));
  const target = 'level1/level2/a.txt', source = 'first\nreveal needle 中文🙂\nlast\n'; writeFileSync(join(project, target), source); writeFileSync(join(second, 'b.txt'), 'Second root\n');
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [project, second].map((path, i) => ({ kind: 'project-directory' as const, id: 'root-' + i, label: 'Root ' + i, path, projectId: 'reveal' })) };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
  const holds: { path: string; before: boolean; entered: ReturnType<typeof gate>; release: ReturnType<typeof gate>; used: boolean }[] = [], lists: DirectoryListRequest[] = [];
  const hold = (path: string, before = false) => { const h = { path, before, entered: gate(), release: gate(), used: false }; holds.push(h); return h; };
  const api = {
    roots: (scope: FileScope) => service.openScope('reveal', scope),
    list: async (input: DirectoryListRequest) => { lists.push(input); const h = holds.find(h => !h.used && h.path === input.relativePath); if (h) { h.used = true; if (h.before) { h.entered.resolve(); await h.release.promise; } } const result = await service.list('reveal', input); if (h && !h.before) { h.entered.resolve(); await h.release.promise; } return result; },
    cancelResource: async (id: string) => service.cancelResource('reveal', id),
    open: vi.fn((input: PathRequest) => service.open('reveal', input)), read: (ref: FileRef) => service.read('reveal', ref), refresh: (ref: FileRef) => service.refresh('reveal', ref), drafts: (ref: FileRef) => service.drafts('reveal', ref),
    closeDocument: async (ref: FileRef) => service.closeDocument('reveal', ref), closeScope: async (scope: FileScope) => service.closeScope('reveal', scope), watch: async () => null, stopWatch: async () => undefined,
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'reveal' }, api as unknown as FileClient, null, null); await store.initialize();
  let viewport = height; const resizes: (() => void)[] = [];
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('fw-tree-scroll') ? viewport : 0; });
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resizes.push(callback); } observe() {} disconnect() {} unobserve() {} });
  function View() { useSyncExternalStore(store.subscribe, store.snapshot); return <><input aria-label="Outside editor focus" /><WorkspaceTree store={store} run={work => { void work(); }} /></>; }
  render(<View />);
  const search = async () => { const root = store.roots.roots[0], result = await service.searcher.search('reveal', { id: randomUUID(), root: { lease: root.lease, generation: root.generation }, kind: 'content', query: 'reveal needle', mask: '' }, () => undefined); expect(result.rows).toHaveLength(1); return result.rows![0]; };
  const f = { base, project, source, target, store, service, hold, api, lists, search, resize: (height: number) => { viewport = height; act(() => resizes.forEach(callback => callback())); }, cleanup: async () => { holds.forEach(h => h.release.resolve()); cleanup(); store.dispose(); service.closeOwner('reveal'); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); } }; fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_TREE_REVEAL_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_REVEAL_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), native: process.env.SMARTDD_M9_FILE_BROKER, sha256: createHash('sha256').update(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)).digest('hex'), boundary: 'I: actual issued roots, native content search/list/read, FileService, renderer store and tree in jsdom. Only viewport dimensions/ResizeObserver and unrelated opener discovery are isolated. Directory gates retain native IO; no actual App/pixel/focus claim.', rows }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('one-shot current file tree reveal', () => {
  it('B09 opens a real search row, expands ancestors, selects and reveals the file without focusing the tree', async () => {
    const f = await fixture(), row = await f.search(), input = screen.getByLabelText('Outside editor focus'); input.focus();
    expect(f.store.currentExpanded).toEqual([]); expect(screen.queryByRole('treeitem', { name: 'a.txt' })).toBeNull();
    await act(async () => { await f.store.openSearchRow(f.store.treeRoot!, row); });
    const target = await screen.findByRole('treeitem', { name: 'a.txt' }); await waitFor(() => expect(target.getAttribute('aria-selected')).toBe('true'));
    expect(f.store.currentExpanded).toEqual(['level1', 'level1/level2']); expect(screen.getByRole('tree').scrollTop).toBeGreaterThan(1800); expect(document.activeElement).toBe(input); expect(f.store.active!.buffer!.raw).toBe(f.source);
    expect(f.api.open).toHaveBeenCalledTimes(1); expect(f.api.open).toHaveBeenCalledWith(expect.objectContaining({ relativePath: f.target })); expect(f.store.treeReveal).toBeNull();
    expect(f.lists.map(x => x.relativePath)).toEqual(['', 'level1', 'level1/level2']); expect(readFileSync(join(f.project, f.target), 'utf8')).toBe(f.source);
    rows.push({ case: 'B09', searchRow: row, ancestors: f.store.currentExpanded, selected: target.getAttribute('aria-selected'), scrollTop: screen.getByRole('tree').scrollTop, unchangedExternalFocus: true, openPaths: f.api.open.mock.calls.map(x => x[0].relativePath) });
  });
  it('does not consume a reveal in a hidden viewport; resizing visible completes it once', async () => {
    const f = await fixture(0), row = await f.search(); await act(async () => { await f.store.openSearchRow(f.store.treeRoot!, row); });
    await waitFor(() => expect(f.store.directories.get(f.store.directoryKey(f.store.treeRoot!, 'level1/level2'))?.state).toBe('ready'));
    expect(f.store.treeReveal).not.toBeNull(); expect(screen.getByRole('tree').scrollTop).toBe(0); f.resize(140);
    await waitFor(() => expect(f.store.treeReveal).toBeNull()); expect(screen.getByRole('tree').scrollTop).toBeGreaterThan(1800);
    rows.push({ case: 'hidden viewport', deferredUntilVisible: true, finalScroll: screen.getByRole('tree').scrollTop });
  });
  it('wheel browsing supersedes a delayed native directory result and later refresh does not pull the user back', async () => {
    const f = await fixture(), held = f.hold('level1'), row = await f.search(); await act(async () => { await f.store.openSearchRow(f.store.treeRoot!, row); }); await held.entered.promise;
    fireEvent.wheel(screen.getByRole('tree'), { deltaY: -80 }); fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); held.release.resolve();
    await waitFor(() => expect(f.store.directories.get(f.store.directoryKey(f.store.treeRoot!, 'level1/level2'))?.state).toBe('ready'));
    expect(f.store.treeReveal).toBeNull(); expect(screen.getByRole('tree').scrollTop).toBe(0); await act(async () => { await f.store.refresh(); }); expect(screen.getByRole('tree').scrollTop).toBe(0);
    rows.push({ case: 'manual wheel', lateNativeResultRetained: true, viewportKept: 0, refreshDidNotReveal: true });
  });
  it('folding the root while its reveal is pending keeps it folded after late IO', async () => {
    const f = await fixture(), held = f.hold('level1'), row = await f.search(); await act(async () => { await f.store.openSearchRow(f.store.treeRoot!, row); }); await held.entered.promise;
    act(() => f.store.toggleRoot()); held.release.resolve(); await act(async () => { await Promise.resolve(); });
    expect(f.store.rootExpanded).toBe(false); expect(f.store.treeReveal).toBeNull(); expect(f.store.active!.buffer!.raw).toBe(f.source);
    rows.push({ case: 'root collapse', collapsedAfterLateIO: true, ownBufferRetained: true });
  });
  it('never treats a directory replacing the target as a file to select or open', async () => {
    const f = await fixture(), held = f.hold('level1/level2', true), row = await f.search(); await act(async () => { await f.store.openSearchRow(f.store.treeRoot!, row); }); await held.entered.promise;
    unlinkSync(join(f.project, f.target)); mkdirSync(join(f.project, f.target)); held.release.resolve(); await waitFor(() => expect(f.store.treeReveal).toBeNull());
    expect(f.store.treeViews.get(f.store.treeRoot!.lease)?.selected ?? []).not.toContain(f.target); expect(f.api.open).toHaveBeenCalledTimes(1); expect(f.store.tabs).toHaveLength(1);
    rows.push({ case: 'target became directory', noDirectoryFileOpen: true, noFalseSelection: true });
  });
  it('an explicit repeat activation reveals again, while passive refresh does not', async () => {
    const f = await fixture(), row = await f.search(); await act(async () => { await f.store.openSearchRow(f.store.treeRoot!, row); }); await waitFor(() => expect(f.store.treeReveal).toBeNull());
    act(() => f.store.toggleDirectory('level1')); fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); const id = f.store.activeId!;
    act(() => f.store.activate(id)); await waitFor(() => expect(screen.getByRole('tree').scrollTop).toBeGreaterThan(1800)); expect(f.store.currentExpanded).toContain('level1');
    fireEvent.wheel(screen.getByRole('tree'), { deltaY: -5000 }); fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); await act(async () => { await f.store.refresh(); }); expect(screen.getByRole('tree').scrollTop).toBe(0);
    rows.push({ case: 'repeat activation', repeatReveal: true, refreshViewportKept: true });
  });
});
