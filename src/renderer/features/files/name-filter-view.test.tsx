// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileRoot } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { FileNameFilter } from './search-panel';
const mocked = vi.hoisted(() => ({ phase: 'done', calls: [] as { root: string; query: string }[], names: new Map<string, unknown[]>() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => undefined } }));
vi.mock('./file-search', () => ({ useFileSearch: (root: FileRoot | null, _kind: string, query: string) => { mocked.calls.push({ root: root?.label ?? '', query }); return { phase: mocked.phase, names: mocked.phase === 'done' ? mocked.names.get(root?.label ?? '') ?? [] : [], rows: [], slow: false, error: '', result: null, retry: vi.fn() }; } }));
const stores: FileWorkspaceStore[] = [];
beforeEach(() => {
  mocked.phase = 'done'; mocked.calls = []; mocked.names.clear();
  for (const [label, prefix] of [['A', 'foo'], ['B', 'bar']]) mocked.names.set(label, Array.from({ length: 100 }, (_, i) => ({ path: prefix + '-' + String(i).padStart(3, '0') + '.txt', file_name: prefix + '-' + String(i).padStart(3, '0') + '.txt', fragments: [], score: 1 })));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this.classList.contains('fw-name-results') ? 140 : 0; });
});
afterEach(() => { cleanup(); stores.splice(0).forEach(s => s.dispose()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function fixture() {
  const roots: FileRoot[] = ['A', 'B'].map(label => ({ source: 'project-directory', sourceId: label, path: '/' + label, canonicalPath: '/' + label, label, lease: randomUUID(), generation: 1, identity: { device: '1', inode: label } }));
  const api = { roots: async () => ({ roots, unavailable: [] }), list: async () => [], closeScope: async () => undefined };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'name-view' }, api as unknown as FileClient, null, null); stores.push(store); await store.initialize();
  store.setFilter('foo'); store.nameSearchViews.set(roots[0].lease, { query: 'foo', top: 126, cursor: 4 }); store.scroll.set(roots[0].lease, 56);
  store.selectRoot(roots[1]); store.setFilter('bar'); store.nameSearchViews.set(roots[1].lease, { query: 'bar', top: 84, cursor: 3 }); store.scroll.set(roots[1].lease, 28); store.selectRoot(roots[0]);
  function Harness() { useSyncExternalStore(store.subscribe, store.snapshot); return <><input aria-label="Outside focus" /><FileNameFilter store={store}><div data-testid="ordinary-tree">{store.treeRoot?.label}</div></FileNameFilter></>; }
  const view = render(<Harness />); return { store, roots, view, Harness };
}
it('restores each root filter viewport/cursor without a transient request using the other root query', async () => {
  const f = await fixture(); expect(screen.getByRole('listbox').scrollTop).toBe(126); expect(screen.getByRole('option', { selected: true }).title).toBe('/A/foo-004.txt');
  fireEvent.scroll(screen.getByRole('listbox'), { target: { scrollTop: 252 } });
  act(() => f.store.selectRoot(f.roots[1])); await waitFor(() => expect(screen.getByRole('listbox').scrollTop).toBe(84)); expect((screen.getByLabelText('筛选文件') as HTMLInputElement).value).toBe('bar'); expect(screen.getByRole('option', { selected: true }).title).toBe('/B/bar-003.txt');
  act(() => f.store.selectRoot(f.roots[0])); expect(screen.getByRole('listbox').scrollTop).toBe(252); expect(screen.getByRole('option', { selected: true }).title).toBe('/A/foo-004.txt');
  expect(mocked.calls.some(x => x.root === 'B' && x.query === 'foo')).toBe(false); expect(f.store.scroll.get(f.roots[0].lease)).toBe(56); expect(f.store.scroll.get(f.roots[1].lease)).toBe(28);
});
it('waits for slow results before restoring, while wheel input supersedes the pending viewport', async () => {
  mocked.phase = 'waiting'; const f = await fixture(); expect(screen.getByRole('listbox').scrollTop).toBe(0); expect(f.store.nameSearchViews.get(f.roots[0].lease)?.top).toBe(126);
  fireEvent.wheel(screen.getByRole('listbox'), { deltaY: 30 }); mocked.phase = 'done'; f.view.rerender(<f.Harness />);
  expect(screen.getByRole('listbox').scrollTop).toBe(0); expect(f.store.nameSearchViews.get(f.roots[0].lease)?.top).toBe(0);
});
it('restores after delayed results without moving external focus', async () => {
  mocked.phase = 'waiting'; const f = await fixture(), external = screen.getByLabelText('Outside focus'); external.focus(); mocked.phase = 'done'; f.view.rerender(<f.Harness />);
  expect(screen.getByRole('listbox').scrollTop).toBe(126); expect(document.activeElement).toBe(external);
});
it('resets a new query and its cursor, and clearing it leaves the ordinary tree viewport intact', async () => {
  const f = await fixture(); fireEvent.change(screen.getByLabelText('筛选文件'), { target: { value: 'foo-new' } });
  expect(screen.getByRole('listbox').scrollTop).toBe(0); expect(f.store.nameSearchViews.get(f.roots[0].lease)).toEqual({ query: 'foo-new', top: 0, cursor: 0 });
  fireEvent.click(screen.getByLabelText('清除文件筛选')); expect(screen.getByTestId('ordinary-tree').textContent).toBe('A'); expect(f.store.scroll.get(f.roots[0].lease)).toBe(56); expect(f.store.scroll.get(f.roots[1].lease)).toBe(28);
});
