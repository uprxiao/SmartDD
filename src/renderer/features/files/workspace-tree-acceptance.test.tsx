// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileEntry, FileRoot } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
import { WorkspaceTree } from './workspace-tree';

// Preserve the production tree, store and Base UI context trigger. Only the
// native file API is isolated, so first-click rerenders and delayed opens are real.
vi.mock('@renderer/lib/ipc', () => ({
  rpc: { files: { applications: vi.fn(async () => ({ id: 'fixture', apps: [], preferredUnavailable: false })) } },
  events: { on: vi.fn(() => () => undefined) },
}));

const observations: unknown[] = [], stores: FileWorkspaceStore[] = [];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; };
function fixture(delayed: 'none' | 'open' | 'read', nested = false) {
  const gate = deferred(), root: FileRoot = { source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', lease: randomUUID(), generation: 1, label: 'Fixture', identity: { device: '1', inode: '2' } };
  const documents = new Map<string, FileDocument>();
  const entries: FileEntry[] = [
    { name: 'folder', relativePath: 'folder', kind: 'directory', symbolicLink: false, identity: { device: '1', inode: 'folder' }, size: 0 },
    { name: 'A.txt', relativePath: 'A.txt', kind: 'file', symbolicLink: false, identity: { device: '1', inode: 'A' }, size: 5 },
    { name: 'B.txt', relativePath: 'B.txt', kind: 'file', symbolicLink: false, identity: { device: '1', inode: 'B' }, size: 5 },
  ];
  const api = {
    roots: vi.fn(async () => ({ roots: [root], unavailable: [] })),
    list: vi.fn(async ({ relativePath }: { relativePath: string }) => relativePath === 'folder' && nested ? [{ ...entries[1], name: 'child.txt', relativePath: 'folder/child.txt' }] : relativePath ? [] : entries),
    open: vi.fn(async ({ relativePath }: { relativePath: string }) => {
      if (delayed === 'open' && relativePath === 'B.txt') await gate.promise;
      const file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, name: relativePath, relativePath, absolutePath: `/fixture/${relativePath}`, documentKey: `local:1:${relativePath}`, writable: true, revision: { device: '1', inode: relativePath, size: 5, hash: createHash('sha256').update('BASE\n').digest('hex'), modifiedNs: '1', changedNs: '1' } };
      documents.set(file.ref.id, file); return file;
    }),
    read: vi.fn(async ({ id }: { id: string }) => { const file = documents.get(id)!; if (delayed === 'read' && file.name === 'B.txt') await gate.promise; return { document: file, base64: Buffer.from('BASE\n').toString('base64') }; }),
    refresh: vi.fn(async ({ id }: { id: string }) => documents.get(id)!),
    drafts: vi.fn(async () => []), closeDocument: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: randomUUID() }, api as unknown as FileClient, null, null); stores.push(store);
  return { store, root, api, gate };
}
function Tree({ store }: { store: FileWorkspaceStore }) {
  useSyncExternalStore(store.subscribe, store.snapshot);
  return <WorkspaceTree store={store} run={(work) => { void work(); }} />;
}
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); stores.splice(0).forEach((store) => store.dispose()); vi.unstubAllGlobals(); });
afterAll(() => {
  if (process.env.SMARTDD_M9_TREE_CLICK_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_TREE_CLICK_EVIDENCE, JSON.stringify({
    observedAt: new Date().toISOString(), level: 'Production WorkspaceTree + FileWorkspaceStore + Base UI ContextMenuTrigger in jsdom; native file API isolated; real user-event click/dblclick sequence, no AX input or native App.', observations,
  }, null, 2) + '\n');
});

describe('Y20 tree keyboard anchor, toggle-only selection and ARIA position', () => {
  const selected = () => screen.getAllByRole('treeitem').filter(e => e.getAttribute('aria-selected') === 'true').map(e => e.textContent);
  async function focus(name: string) { await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name }))); }
  it('starts an unanchored Shift range at the actual focused middle row', async () => {
    const f=fixture('none'); await f.store.initialize(); render(<Tree store={f.store}/>); const user=userEvent.setup();
    await user.tab(); await user.keyboard('{ArrowDown}'); await focus('folder'); await user.keyboard('{ArrowDown}'); await focus('A.txt');
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}'); await focus('B.txt'); expect(selected()).toEqual(['A.txt','B.txt']);
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}'); await focus('A.txt'); expect(selected()).toEqual(['A.txt']);
  });
  it('uses the focused row after an anchor becomes invisible in a collapsed directory', async () => {
    const f=fixture('none',true); await f.store.initialize(); render(<Tree store={f.store}/>); const user=userEvent.setup();
    await user.click(screen.getByRole('treeitem',{name:'folder'})); await user.click(await screen.findByRole('treeitem',{name:'child.txt'}));
    await user.keyboard('{ArrowLeft}'); await focus('folder'); await user.keyboard('{ArrowLeft}'); await waitFor(()=>expect(screen.queryByRole('treeitem',{name:'child.txt'})).toBeNull());
    await user.keyboard('{ArrowDown}'); await focus('A.txt'); await user.keyboard('{Shift>}{ArrowDown}{/Shift}'); await focus('B.txt'); expect(selected()).toEqual(['A.txt','B.txt']);
  });
  it.each(['Meta','Control'])('%s+Space toggles the selected first file without opening another file', async modifier => {
    const f=fixture('none'); await f.store.initialize(); render(<Tree store={f.store}/>); const user=userEvent.setup();
    await user.click(screen.getByRole('treeitem',{name:'B.txt'})); await waitFor(()=>expect(f.store.active?.buffer?.loadState).toBe('ready')); const before=f.api.open.mock.calls.length;
    await user.keyboard('{ArrowUp}'); await focus('A.txt'); await user.keyboard(`{${modifier}>} {/${modifier}}`); expect(selected()).toEqual(['A.txt','B.txt']);
    await user.keyboard('{ArrowDown}'); await focus('B.txt'); await user.keyboard(`{${modifier}>} {/${modifier}}`); expect(selected()).toEqual(['A.txt']);
    expect(f.api.open).toHaveBeenCalledTimes(before); expect(f.store.active?.route.relativePath).toBe('B.txt');
  });
  it('describes same-parent positions, visible select-all including folders and one tree tab stop', async () => {
    const f=fixture('none',true); await f.store.initialize(); render(<Tree store={f.store}/>); const user=userEvent.setup();
    const tree=screen.getByRole('tree',{name:'文件目录'}); expect(tree.getAttribute('aria-multiselectable')).toBe('true');
    await user.click(screen.getByRole('treeitem',{name:'folder'})); await screen.findByRole('treeitem',{name:'child.txt'});
    for(const [name,level,pos,size] of [['folder',1,1,3],['child.txt',2,1,1],['A.txt',1,2,3],['B.txt',1,3,3]] as const){const e=screen.getByRole('treeitem',{name});expect([e.getAttribute('aria-level'),e.getAttribute('aria-posinset'),e.getAttribute('aria-setsize')]).toEqual([String(level),String(pos),String(size)]);}
    await user.keyboard('{Meta>}a{/Meta}'); expect(selected()).toEqual(['folder','child.txt','A.txt','B.txt']); expect(screen.getAllByRole('treeitem').filter(e=>e.tabIndex===0)).toHaveLength(1);
    await user.keyboard('{Control>}a{/Control}'); expect(selected()).toEqual(['folder','child.txt','A.txt','B.txt']); expect(screen.getAllByRole('treeitem').filter(e=>e.tabIndex===0)).toHaveLength(1);
  });
});

describe('B18 production tree first-double-click diagnostic', () => {
  it.each(['none', 'open', 'read'] as const)('pins a never-opened B on its first double click with %s delivery delay', async (delayed) => {
    const f = fixture(delayed); await f.store.initialize(); render(<Tree store={f.store} />); const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: 'A.txt' }));
    expect(f.store.active?.route.relativePath).toBe('A.txt'); expect(f.store.active?.pinned).toBe(false);
    const before = screen.getByRole('treeitem', { name: 'B.txt' }), events: { type: string; detail: number }[] = [];
    for (const type of ['mousedown', 'mouseup', 'click', 'dblclick']) before.addEventListener(type, (event) => events.push({ type: event.type, detail: (event as MouseEvent).detail }));
    await user.dblClick(before);
    expect(screen.getByRole('treeitem', { name: 'B.txt' })).toBe(before);
    expect(f.store.tabs).toHaveLength(1); expect(f.store.active?.route.relativePath).toBe('B.txt'); expect(f.store.active?.pinned).toBe(true);
    expect(events.filter((event) => event.type === 'click').map((event) => event.detail)).toEqual([1, 2]);
    expect(events.filter((event) => event.type === 'dblclick')).toEqual([{ type: 'dblclick', detail: 2 }]);
    await act(async () => { f.gate.resolve(); });
    await waitFor(() => expect(f.store.active?.buffer?.loadState).toBe('ready'));
    expect(f.store.tabs).toHaveLength(1); expect(f.store.active?.pinned).toBe(true);
    expect(f.api.open.mock.calls.filter(([request]) => request.relativePath === 'B.txt')).toHaveLength(1);
    await user.click(screen.getByRole('treeitem', { name: 'folder' }));
    expect(f.store.currentExpanded).toContain('folder'); expect(f.store.active?.route.relativePath).toBe('B.txt');
    await user.click(screen.getByRole('treeitem', { name: 'folder' }));
    expect(f.store.currentExpanded).not.toContain('folder'); expect(f.store.active?.pinned).toBe(true);
    observations.push({ delayed, events, sameTreeNodeAfterFirstClickAndDoubleClick: true, tabs: f.store.tabs.map((tab) => ({ path: tab.route.relativePath, pinned: tab.pinned })), opensOfB: f.api.open.mock.calls.filter(([request]) => request.relativePath === 'B.txt').length, directoryOnlyToggled: true });
  });
});
