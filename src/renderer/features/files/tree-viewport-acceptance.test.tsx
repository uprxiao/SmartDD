// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState, useSyncExternalStore } from 'react';
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
const fixtures: { cleanup(): Promise<void> }[] = [], evidence: unknown[] = [];
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
async function fixture(initialHeight = 300, warm = true) {
  const base = realpathSync(mkdtempSync('/private/tmp/willyou-tree-viewport-')), a = join(base, 'A'), b = join(base, 'B');
  for (const path of [a, b, join(base, 'userdata'), join(a, 'many'), join(a, 'sticky'), join(a, 'sticky/alpha'), join(a, 'sticky/alpha/beta'), join(a, 'sticky/alpha/beta/gamma')]) mkdirSync(path);
  for (let i = 0; i < 300; i++) writeFileSync(join(a, 'many', `item-${String(i).padStart(3, '0')}.txt`), `Many ${i}\n`);
  for (let i = 0; i < 50; i++) writeFileSync(join(a, 'sticky/alpha/beta/gamma', `item-${String(i).padStart(3, '0')}.txt`), `Sticky ${i}\n`);
  writeFileSync(join(b, 'b.txt'), 'Root B\n');
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [a, b].map((path, i) => ({ kind: 'project-directory' as const, id: 'root-' + i, path, label: 'Root ' + i, projectId: 'viewport' })) };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
  const entered = gate(), release = gate(), rootGate = { entered: gate(), release: gate(), held: false }; let held = !warm;
  const api = { roots: (scope: FileScope) => service.openScope('viewport', scope), list: async (input: DirectoryListRequest) => { const result = await service.list('viewport', input); if (held && input.relativePath === 'many') { held = false; entered.resolve(); await release.promise; } if (rootGate.held && input.relativePath === '') { rootGate.held = false; rootGate.entered.resolve(); await rootGate.release.promise; } return result; }, cancelResource: async (id: string) => service.cancelResource('viewport', id), open: vi.fn((input: PathRequest) => service.open('viewport', input)), read: (ref: FileRef) => service.read('viewport', ref), refresh: (ref: FileRef) => service.refresh('viewport', ref), drafts: (ref: FileRef) => service.drafts('viewport', ref), closeDocument: async (ref: FileRef) => service.closeDocument('viewport', ref), closeScope: async (scope: FileScope) => service.closeScope('viewport', scope), watch: async () => null, stopWatch: async () => undefined };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'viewport' }, api as unknown as FileClient, null, null); await store.initialize(); const root = store.treeRoot!;
  if (warm) await store.list(root, 'many'); store.toggleDirectory('many'); store.scroll.set(root.lease, 2800);
  let height = initialHeight; const tops = new WeakMap<HTMLElement, number>(), resizes: { callback(): void; disconnected: boolean }[] = [];
  const scrollDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTop');
  Object.defineProperty(HTMLElement.prototype, 'scrollTop', { configurable: true, get(this: HTMLElement) { return tops.get(this) ?? 0; }, set(this: HTMLElement, value: number) { const size = parseFloat(this.querySelector<HTMLElement>('.fw-tree-virtual')?.style.height ?? '0') || 0; tops.set(this, height > 0 ? Math.max(0, Math.min(value, size - height)) : 0); } });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('fw-tree-scroll') ? height : 0; });
  vi.stubGlobal('ResizeObserver', class { entry: { callback(): void; disconnected: boolean }; constructor(callback: () => void) { this.entry = { callback, disconnected: false }; resizes.push(this.entry); } observe() {} unobserve() {} disconnect() { this.entry.disconnected = true; } });
  function View() { const [count, setCount] = useState(0); useSyncExternalStore(store.subscribe, store.snapshot); return <><button onClick={() => setCount(n => n + 1)}>Unrelated render {count}</button><WorkspaceTree store={store} run={work => { void work(); }} /></>; }
  const renderTree = () => render(<View />); renderTree();
  const f = { base, a, b, store, service, api, root, entered, release, rootGate, renderTree, resizes, resize: (next: number, includeDisconnected = false) => { height = next; act(() => resizes.filter(x => includeDisconnected || !x.disconnected).forEach(x => x.callback())); }, cleanup: async () => { release.resolve(); rootGate.release.resolve(); cleanup(); store.dispose(); service.closeOwner('viewport'); await service.watcher.dispose(); broker.dispose(); if (scrollDescriptor) Object.defineProperty(HTMLElement.prototype, 'scrollTop', scrollDescriptor); else delete (HTMLElement.prototype as unknown as { scrollTop?: number }).scrollTop; rmSync(base, { recursive: true, force: true }); } }; fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.SMARTDD_TREE_VIEWPORT_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_VIEWPORT_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), native: process.env.SMARTDD_M9_FILE_BROKER, sha256: createHash('sha256').update(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)).digest('hex'), boundary: 'I: actual FileService/native roots/list/read and renderer tree/store. Only viewport geometry/scroll clamping/ResizeObserver are deterministic layout substitutes; actual normal and CSS-delayed packaged App checks are separate.', evidence }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('tree viewport lifecycle and sticky ancestors', () => {
  it('B10 preserves viewport, expanded selection and native DOM row keys across unrelated parent renders', async () => {
    const f = await fixture(); fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 2800 } });
    fireEvent.click(screen.getByRole('treeitem', { name: 'item-100.txt' })); await waitFor(() => expect(f.store.active?.buffer?.raw).toBe('Many 100\n')); fireEvent.click(screen.getByRole('treeitem', { name: 'item-101.txt' }), { metaKey: true });
    const before = screen.getAllByRole('treeitem'), selected = f.store.treeViews.get(f.root.lease)!.selected;
    fireEvent.click(screen.getByRole('button', { name: 'Unrelated render 0' })); expect(screen.getByRole('tree').scrollTop).toBe(2800); expect(f.store.currentExpanded).toEqual(['many']); expect(f.store.treeViews.get(f.root.lease)!.selected).toEqual(selected); expect(selected).toHaveLength(2);
    const after = screen.getAllByRole('treeitem'); expect(after).toEqual(before); expect(after.length).toBeLessThan(35); evidence.push({ case: 'B10', scrollTop: 2800, selected, stableNodes: after.length, sameNativeNodes: true });
  });
  it('B11 waits for a real visible viewport instead of consuming a clamped zero restore', async () => {
    const f = await fixture(0); fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); expect(f.store.scroll.get(f.root.lease)).toBe(2800);
    f.resize(300); await waitFor(() => expect(screen.getByRole('tree').scrollTop).toBe(2800)); expect(f.store.scroll.get(f.root.lease)).toBe(2800); evidence.push({ case: 'B11 hidden viewport', preservedPending: 2800, visibleRestore: 2800 });
  });
  it('B11 waits for delayed real directory rows, and user wheel supersedes a pending restore', async () => {
    const f = await fixture(300, false); await f.entered.promise; fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); expect(f.store.scroll.get(f.root.lease)).toBe(2800);
    fireEvent.wheel(screen.getByRole('tree'), { deltaY: 50 }); f.release.resolve(); await waitFor(() => expect(f.store.directories.get(f.store.directoryKey(f.root, 'many'))?.state).toBe('ready'));
    expect(screen.getByRole('tree').scrollTop).toBe(0); expect(f.store.scroll.get(f.root.lease)).toBe(0); evidence.push({ case: 'B11 delayed rows/manual wheel', realResultRetained: true, userPositionKept: 0 });
  });
  it('B11 restores after delayed native directory completion without a resize', async () => {
    const f = await fixture(300, false); await f.entered.promise; fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); f.release.resolve();
    await waitFor(() => expect(screen.getByRole('tree').scrollTop).toBe(2800)); expect(f.store.scroll.get(f.root.lease)).toBe(2800); evidence.push({ case: 'B11 delayed native completion', restored: 2800, resizeRequired: false });
  });
  it('B11 gives an explicit file reveal priority over a hidden ordinary restore', async () => {
    const f = await fixture(0); await act(async () => { await f.store.open(f.root, 'many/item-000.txt', true); }); f.resize(300);
    await waitFor(() => expect(f.store.treeReveal).toBeNull()); expect(screen.getByRole('tree').scrollTop).toBe(0); expect(f.store.scroll.get(f.root.lease)).toBe(0); expect(f.store.treeViews.get(f.root.lease)?.selected).toEqual(['many/item-000.txt']);
    evidence.push({ case: 'B11 explicit reveal supersedes restore', ordinary: 2800, explicit: 0 });
  });
  it('B11 stops on unmount; a late observer cannot scroll a new root and no frame polling is scheduled', async () => {
    const f = await fixture(0), frames = vi.spyOn(globalThis, 'requestAnimationFrame'); cleanup(); expect(f.resizes.some(x => x.disconnected)).toBe(true);
    const next = f.store.roots.roots[1]; await act(async () => { f.store.selectRoot(next); await f.store.list(next, ''); }); f.renderTree(); f.resize(300, true);
    expect(screen.getByRole('tree').scrollTop).toBe(0); expect(frames).not.toHaveBeenCalled(); expect(f.store.scroll.get(f.root.lease)).toBe(2800); evidence.push({ case: 'B11 unmount', oldRoot: f.root.lease, nextRoot: next.lease, lateObserverIgnored: true, framePolling: 0 });
  });
  it('B16 displays the last three sticky ancestors and activates the exact underlying folder', async () => {
    const f = await fixture(), paths = ['sticky', 'sticky/alpha', 'sticky/alpha/beta', 'sticky/alpha/beta/gamma']; act(() => f.store.toggleDirectory('many')); for (const path of paths) { act(() => f.store.toggleDirectory(path)); await act(async () => { await f.store.list(f.root, path); }); }
    const path = 'sticky/alpha/beta/gamma/item-049.txt'; await act(async () => { await f.store.open(f.root, path, true); }); await waitFor(() => expect(f.store.treeReveal).toBeNull());
    const sticky = document.querySelector('.fw-sticky-folders')!; expect(sticky.textContent).toBe('alphabetagamma'); fireEvent.click([...sticky.querySelectorAll('button')].find(x => x.textContent === 'beta')!);
    const beta = await screen.findByRole('treeitem', { name: 'beta' }); await waitFor(() => expect(document.activeElement).toBe(beta)); fireEvent.keyDown(beta, { key: 'ArrowLeft' }); expect(f.store.currentExpanded).not.toContain('sticky/alpha/beta'); expect(f.store.currentExpanded).toContain('sticky/alpha'); expect(screen.queryByRole('treeitem', { name: 'gamma' })).toBeNull();
    fireEvent.keyDown(beta, { key: 'ArrowRight' }); expect(f.store.currentExpanded).toContain('sticky/alpha/beta'); act(() => f.store.activate(f.store.activeId!)); await waitFor(() => expect(document.querySelector('.fw-sticky-folders')?.textContent).toBe('alphabetagamma'));
    expect(f.store.active!.buffer!.raw).toBe('Sticky 49\n'); expect(f.api.open).toHaveBeenCalledTimes(1); evidence.push({ case: 'B16', sticky: ['alpha', 'beta', 'gamma'], exactFocusedPath: 'sticky/alpha/beta', collapseAndReopen: true, currentDocumentUnchanged: true });
  });
  it.each([false, true])('B16 restores a focused folder removed by native refresh; later user focus wins (%s)', async external => {
    const f = await fixture(); fireEvent.scroll(screen.getByRole('tree'), { target: { scrollTop: 0 } }); const folder = screen.getByRole('treeitem', { name: 'many' }); act(() => folder.focus()); f.rootGate.held = true;
    let loading!: Promise<void>; act(() => { loading = f.store.list(f.root, '', true); }); await f.rootGate.entered.promise; expect(screen.queryByRole('treeitem', { name: 'many' })).toBeNull();
    const outside = screen.getByRole('button', { name: 'Unrelated render 0' }); if (external) { fireEvent.pointerDown(outside); act(() => outside.focus()); }
    await act(async () => { f.rootGate.release.resolve(); await loading; }); const restored = screen.getByRole('treeitem', { name: 'many' }); expect(document.activeElement).toBe(external ? outside : restored);
    evidence.push({ case: 'B16 native refresh focus', externalUserIntent: external, exactFolderRestored: !external, externalFocusPreserved: external });
  });
  it.each([false, true])('B10 retains the viewport across native refresh and its browser clamp; later wheel intent wins (%s)', async userScroll => {
    const f = await fixture(), tree = screen.getByRole('tree'); fireEvent.scroll(tree, { target: { scrollTop: 2800 } });
    f.rootGate.held = true; let loading!: Promise<void>; act(() => { loading = f.store.list(f.root, '', true); }); await f.rootGate.entered.promise;
    // jsdom does not perform the browser's layout clamp when the virtual
    // list becomes one loading row. Reproduce that observed native event.
    fireEvent.scroll(tree, { target: { scrollTop: 0 } });
    if (userScroll) { fireEvent.wheel(tree, { deltaY: -2800 }); fireEvent.scroll(tree, { target: { scrollTop: 0 } }); }
    await act(async () => { f.rootGate.release.resolve(); await loading; });
    expect(tree.scrollTop).toBe(userScroll ? 0 : 2800); expect(f.store.scroll.get(f.root.lease)).toBe(userScroll ? 0 : 2800);
    evidence.push({ case: 'B10 native refresh viewport', userScroll, browserClampDuringLoading: 0, restored: tree.scrollTop, boundary: 'Genuine native list held after IO; browser layout clamp is the existing jsdom geometry substitute, actual App wheel evidence is separate.' });
  });
});
