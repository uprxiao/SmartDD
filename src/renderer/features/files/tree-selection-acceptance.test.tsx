// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: async () => ({ id: 'selection', apps: [], preferredUnavailable: false }) } }, events: { on: () => () => undefined } }));
const observations: unknown[] = [];
function Tree({ store }: { store: FileWorkspaceStore }) { useSyncExternalStore(store.subscribe, store.snapshot); return <WorkspaceTree store={store} run={work => { void work(); }} />; }
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('B22 native tree selection host contract', () => {
  let base: string, project: string, service: FileService, broker: NativeFileBroker, store: FileWorkspaceStore, opens: string[];
  let rootDelivery: { entered: boolean; promise: Promise<void>; release(): void } | undefined;
  const source = { 'A.txt': 'Selection A\n', 'B.txt': 'Selection B\n', 'C.txt': 'Selection C\n', 'folder/child.txt': 'Selection child\n' };
  let before: Record<string, { hash: string; inode: string; mtimeNs: string }>;
  const fingerprint = () => Object.fromEntries(Object.keys(source).map(p => { const path = join(project, p), s = statSync(path, { bigint: true }); return [p, { hash: createHash('sha256').update(readFileSync(path)).digest('hex'), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }]; }));
  beforeEach(async () => {
    base = realpathSync(mkdtempSync('/private/tmp/willyou-tree-selection-native-')); project = join(base, 'project');
    for (const p of [project, join(project, 'folder'), join(base, 'userdata')]) mkdirSync(p);
    for (const [p, text] of Object.entries(source)) writeFileSync(join(project, p), text);
    before = fingerprint(); opens = []; rootDelivery = undefined; broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'selection', path: project, label: 'B22 native selection', projectId: 'selection' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
    const api = { roots: (scope: FileScope) => service.openScope('selection', scope), list: async (input: PathRequest) => { const result = await service.list('selection', input); const held = rootDelivery; if (held && input.relativePath === '') { held.entered = true; await held.promise; } return result; }, open: (input: PathRequest) => { opens.push(input.relativePath); return service.open('selection', input); }, read: (ref: FileRef) => service.read('selection', ref), refresh: (ref: FileRef) => service.refresh('selection', ref), drafts: (ref: FileRef) => service.drafts('selection', ref), closeDocument: async (ref: FileRef) => service.closeDocument('selection', ref), closeScope: async (scope: FileScope) => service.closeScope('selection', scope) };
    store = new FileWorkspaceStore({ kind: 'project', projectId: 'selection' }, api as unknown as FileClient, null, null);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    await store.initialize(); render(<Tree store={store} />);
  });
  afterEach(async () => { rootDelivery?.release(); cleanup(); store?.dispose(); service?.closeOwner('selection'); await service?.watcher.dispose(); broker?.dispose(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (base) { expect(fingerprint()).toEqual(before); rmSync(base, { recursive: true, force: true }); } });
  afterAll(() => { if (process.env.SMARTDD_TREE_SELECTION_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_SELECTION_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), caseId: 'M9-T-B22', layer: 'I: production tree/store/FileService + real packaged native filesystem; component user-event inputs and jsdom geometry, no actual App claim. Open observations are passive calls into the original native service, no result replacement.', broker: process.env.SMARTDD_M9_FILE_BROKER, observations }, null, 2) + '\n'); });
  const selected = () => screen.getAllByRole('treeitem').filter(e => e.getAttribute('aria-selected') === 'true').map(e => e.textContent);
  const state = () => ({ selected: selected(), focused: document.activeElement?.textContent, active: store.active?.route.relativePath, opens: [...opens] });
  async function active(path: string) { await waitFor(() => expect(store.active?.route.relativePath).toBe(path)); await waitFor(() => expect(store.active?.buffer?.raw).toBe(source[path as keyof typeof source])); expect(store.tabs).toHaveLength(1); }

  it('B17 keeps confirmed row identity and reversible Tab order through an actual pending native refresh', async () => {
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await active('B.txt');
    const original=screen.getByRole('treeitem',{name:'B.txt'}),beforeOpens=opens.length,outside=document.createElement('button');outside.textContent='After tree';document.body.append(outside);
    let release!:()=>void;rootDelivery={entered:false,promise:new Promise<void>(done=>{release=done;}),release:()=>release()};let loading!:Promise<void>;
    try{
      act(()=>{loading=store.list(store.treeRoot!,'',true);});await waitFor(()=>expect(rootDelivery!.entered).toBe(true));
      expect(screen.getByRole('treeitem',{name:'B.txt'})).toBe(original);expect(screen.getByRole('tree').getAttribute('aria-busy')).toBe('true');
      await user.tab();expect(document.activeElement).toBe(outside);await user.tab({shift:true});expect(document.activeElement).toBe(original);
      await act(async()=>{rootDelivery!.release();await loading;});expect(screen.getByRole('treeitem',{name:'B.txt'})).toBe(original);expect(screen.getByRole('tree').getAttribute('aria-busy')).toBe('false');expect(document.activeElement).toBe(original);expect(opens).toHaveLength(beforeOpens);
      observations.push({caseId:'M9-T-B17',scenario:'actual native refresh retains confirmed DOM row,explicit busy state and reversible Tab without extra open',confirmedRowIdentityPreserved:true,tabReturnSameNode:true,sourceUnchanged:fingerprint()});
    }finally{rootDelivery?.release();outside.remove();}
  });

  it('B17 ArrowRight uses newly visible children rather than an older keyboard snapshot during native refresh', async () => {
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'folder'}));await screen.findByRole('treeitem',{name:'child.txt'});
    fireEvent.keyDown(screen.getByRole('treeitem',{name:'folder'}),{key:'ArrowLeft'});expect(screen.queryByRole('treeitem',{name:'child.txt'})).toBeNull();
    let release!:()=>void;rootDelivery={entered:false,promise:new Promise<void>(done=>{release=done;}),release:()=>release()};let loading!:Promise<void>;
    act(()=>{loading=store.list(store.treeRoot!,'',true);});await waitFor(()=>expect(rootDelivery!.entered).toBe(true));
    fireEvent.keyDown(screen.getByRole('treeitem',{name:'folder'}),{key:'ArrowRight'});await screen.findByRole('treeitem',{name:'child.txt'});
    fireEvent.keyDown(screen.getByRole('treeitem',{name:'folder'}),{key:'ArrowRight'});await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'child.txt'})));
    await act(async()=>{rootDelivery!.release();await loading;});expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'child.txt'}));expect(opens).toHaveLength(0);
    observations.push({caseId:'M9-T-B17',scenario:'actual root refresh plus directory expansion uses current confirmed child keyboard order',noUnexpectedOpen:true});
  });
  it('B17 never presents confirmed cached rows as successful after an actual native permission failure', async () => {
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await active('B.txt');
    const mode=statSync(project).mode&0o7777;
    try{chmodSync(project,0);await act(async()=>{await store.list(store.treeRoot!,'',true);});
      expect(screen.queryByRole('treeitem',{name:'B.txt'})).toBeNull();expect(screen.getByRole('alert').textContent).toContain('读取失败');expect(screen.getByRole('tree').getAttribute('aria-busy')).toBe('false');
      observations.push({caseId:'M9-T-B17',scenario:'actual chmod000/native read failure replaces cached rows with explicit error,not stale success',error:screen.getByRole('alert').textContent});
    }finally{chmodSync(project,mode);}
    await user.click(screen.getByRole('button',{name:'重试'}));await screen.findByRole('treeitem',{name:'B.txt'});expect(store.active?.buffer?.raw).toBe(source['B.txt']);expect(screen.queryByRole('alert')).toBeNull();
  });

  it('B17 Enter pins the opened file once and Space keeps that file while opening a separate preview', async () => {
    const user=userEvent.setup(),open=vi.spyOn(store,'open');
    await user.click(screen.getByRole('treeitem',{name:'folder'}));await screen.findByRole('treeitem',{name:'child.txt'});
    await user.keyboard('{ArrowLeft}');await waitFor(()=>expect(screen.queryByRole('treeitem',{name:'child.txt'})).toBeNull());
    await user.keyboard('{ArrowDown}');await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'A.txt'})));
    await user.keyboard('{Enter}');await active('A.txt');expect(store.active!.pinned).toBe(true);
    expect(open.mock.calls.map(c=>[c[1],c[2]])).toEqual([['A.txt',true]]);
    await user.keyboard('{ArrowDown}');await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'B.txt'})));
    await user.keyboard(' ');await waitFor(()=>expect(store.active?.buffer?.raw).toBe(source['B.txt']));
    expect(store.tabs.map(t=>[t.route.relativePath,t.pinned])).toEqual([['A.txt',true],['B.txt',false]]);
    expect(open.mock.calls.map(c=>[c[1],c[2]])).toEqual([['A.txt',true],['B.txt',false]]);
    observations.push({caseId:'M9-T-B17',scenario:'Enter pins once; Space opens one independent preview without replacing pinned file',tabs:store.tabs.map(t=>({path:t.route.relativePath,pinned:t.pinned})),opens:open.mock.calls.map(c=>[c[1],c[2]]),sourceUnchanged:fingerprint()});
  });

  it('range/toggle selection opens only its first file and preserves the focused row and selected range', async () => {
    const user = userEvent.setup(); await user.click(screen.getByRole('treeitem', { name: 'C.txt' })); await active('C.txt');
    const beforeRange = opens.length; await user.keyboard('{Shift>}'); await user.click(screen.getByRole('treeitem', { name: 'A.txt' })); await user.keyboard('{/Shift}');
    await active('A.txt'); expect(selected()).toEqual(['A.txt', 'B.txt', 'C.txt']); expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'A.txt' })); expect(opens.slice(beforeRange)).toEqual(['A.txt']);
    const range = state(), beforeToggle = opens.length;
    await user.keyboard('{Meta>}'); await user.click(screen.getByRole('treeitem', { name: 'A.txt' })); await user.keyboard('{/Meta}');
    await active('B.txt'); expect(selected()).toEqual(['B.txt', 'C.txt']); expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'A.txt' })); expect(opens.slice(beforeToggle)).toEqual(['B.txt']);
    const toggledFirst = state(); await user.keyboard('{Control>}'); await user.click(screen.getByRole('treeitem', { name: 'C.txt' })); await user.keyboard('{/Control}');
    await active('B.txt'); expect(selected()).toEqual(['B.txt']); expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'C.txt' }));
    await user.keyboard('{Meta>} {/Meta}'); await active('B.txt'); expect(selected()).toEqual(['B.txt', 'C.txt']);
    await user.keyboard('{Control>} {/Control}'); await active('B.txt'); expect(selected()).toEqual(['B.txt']);
    const beforeEmpty = opens.length; await user.keyboard('{Meta>}'); await user.click(screen.getByRole('treeitem', { name: 'B.txt' })); await user.keyboard('{/Meta}');
    expect(selected()).toEqual([]); expect(opens).toHaveLength(beforeEmpty); await active('B.txt'); const empty = state();
    observations.push({ scenario: 'range, Meta/Control click, Meta/Control Space and empty selection', range, toggledFirst, empty, final: state(), sourceUnchanged: fingerprint() });
  });

  it('Shift arrows and select-all keep focus separate; only the first visible file opens, never a directory or batch', async () => {
    const user = userEvent.setup(); await user.click(screen.getByRole('treeitem', { name: 'B.txt' })); await active('B.txt');
    const beforeArrow = opens.length; await user.keyboard('{ArrowDown}'); await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'C.txt' })));
    expect(selected()).toEqual(['B.txt']); expect(opens).toHaveLength(beforeArrow);
    await user.keyboard('{Shift>}{ArrowUp}{ArrowUp}{/Shift}'); await active('A.txt'); expect(selected()).toEqual(['A.txt', 'B.txt']); expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'A.txt' }));
    const range = state(); await user.keyboard('{Meta>}a{/Meta}'); await active('A.txt'); expect(selected()).toEqual(['folder', 'A.txt', 'B.txt', 'C.txt']);
    await user.keyboard('{ArrowDown}'); await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'B.txt' })));
    const beforeSpace = opens.length; await user.keyboard(' '); await active('B.txt'); expect(selected()).toEqual(['B.txt']); expect(opens.slice(beforeSpace)).toEqual(['B.txt']);
    await user.click(screen.getByRole('treeitem', { name: 'folder' })); await screen.findByRole('treeitem', { name: 'child.txt' });
    const beforeAll = opens.length; await user.keyboard('{Control>}a{/Control}'); await active('folder/child.txt');
    expect(selected()).toEqual(['folder', 'child.txt', 'A.txt', 'B.txt', 'C.txt']); expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'folder' })); expect(opens.slice(beforeAll)).toEqual(['folder/child.txt']);
    expect(opens).not.toContain('folder'); expect(screen.queryByText('批量删除')).toBeNull();
    observations.push({ scenario: 'Shift arrow, visible select-all, native Space activation', range, final: state(), sourceUnchanged: fingerprint() });
  });

  it('keeps the latest keyboard focus target and original rows when native refresh crosses a pending animation frame', async () => {
    const user = userEvent.setup(); await user.click(screen.getByRole('treeitem', { name: 'B.txt' })); await active('B.txt');
    const callbacks: FrameRequestCallback[] = []; vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => { callbacks.push(callback); return callbacks.length; });
    fireEvent.keyDown(screen.getByRole('treeitem', { name: 'B.txt' }), { key: 'ArrowUp', shiftKey: true });
    expect(store.treeViews.get(store.treeRoot!.lease)?.focused).toBe('A.txt'); expect(document.activeElement).toBe(screen.getByRole('treeitem', { name: 'B.txt' }));
    expect(callbacks).toHaveLength(1); let release!: () => void;
    rootDelivery = { entered: false, promise: new Promise<void>(done => { release = done; }), release: () => release() };
    let loading!: Promise<void>; act(() => { loading = store.list(store.treeRoot!, '', true); }); await waitFor(() => expect(rootDelivery!.entered).toBe(true));
    const originalA=screen.getByRole('treeitem',{name:'A.txt'});expect(screen.getByRole('tree').getAttribute('aria-busy')).toBe('true');act(() => callbacks[0](0));
    await act(async () => { rootDelivery!.release(); await loading; }); await active('A.txt');
    expect(document.activeElement).toBe(originalA);expect(screen.getByRole('treeitem',{name:'A.txt'})).toBe(originalA);expect(selected()).toEqual(['A.txt', 'B.txt']);
    observations.push({ scenario: 'native refresh crosses pending keyboard focus', frameDeliveredDuringOriginalRefresh: true,confirmedRowIdentityRetained:true,originalNativeListResultHeldOnlyAfterIO: true, final: state(), sourceUnchanged: fingerprint() });
  });

  it('Y20 keeps keyboard ownership on the same confirmed row throughout native refresh', async () => {
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await active('B.txt');
    let release!:()=>void;rootDelivery={entered:false,promise:new Promise<void>(done=>{release=done;}),release:()=>release()};
    let loading!:Promise<void>;act(()=>{loading=store.list(store.treeRoot!,'',true);});await waitFor(()=>expect(rootDelivery!.entered).toBe(true));
    const originalB=screen.getByRole('treeitem',{name:'B.txt'});expect(document.activeElement).toBe(originalB);expect(screen.getByRole('tree').getAttribute('aria-busy')).toBe('true');
    await user.keyboard('{Shift>}{ArrowUp}{/Shift}');expect(store.treeViews.get(store.treeRoot!.lease)?.focused).toBe('A.txt');
    await act(async()=>{rootDelivery!.release();await loading;});await active('A.txt');
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'A.txt'})));expect(selected()).toEqual(['A.txt','B.txt']);
    observations.push({scenario:'Y20 real native refresh retains the original focused row and accepts next Shift arrow before original IO reply release',confirmedRowIdentityRetained:screen.getByRole('treeitem',{name:'B.txt'})===originalB,final:state()});
  });
  it('Y20 does not restore a refreshed row over the user moving focus outside the tree', async () => {
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await active('B.txt');
    let release!:()=>void;rootDelivery={entered:false,promise:new Promise<void>(done=>{release=done;}),release:()=>release()};
    let loading!:Promise<void>;act(()=>{loading=store.list(store.treeRoot!,'',true);});await waitFor(()=>expect(rootDelivery!.entered).toBe(true));
    const outside=document.createElement('button');outside.textContent='Outside focus choice';document.body.append(outside);
    try{await user.click(outside);await act(async()=>{rootDelivery!.release();await loading;});expect(document.activeElement).toBe(outside);}
    finally{outside.remove();}
    observations.push({scenario:'Y20 native refresh never restores over explicit outside focus choice'});
  });
  it('Y20 invalidates an older focus frame when a second key targets another row during native refresh',async()=>{
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await active('B.txt');
    const callbacks:FrameRequestCallback[]=[];vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(fn=>{callbacks.push(fn);return callbacks.length;});
    fireEvent.keyDown(screen.getByRole('treeitem',{name:'B.txt'}),{key:'ArrowUp',shiftKey:true});expect(callbacks).toHaveLength(1);
    let release!:()=>void;rootDelivery={entered:false,promise:new Promise<void>(done=>{release=done;}),release:()=>release()};let loading!:Promise<void>;
    act(()=>{loading=store.list(store.treeRoot!,'',true);});await waitFor(()=>expect(rootDelivery!.entered).toBe(true));
    fireEvent.keyDown(screen.getByRole('treeitem',{name:'B.txt'}),{key:'ArrowDown',shiftKey:true});expect(store.treeViews.get(store.treeRoot!.lease)?.focused).toBe('B.txt');
    await act(async()=>{rootDelivery!.release();await loading;});act(()=>callbacks[0](0));
    expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'B.txt'}));expect(selected()).toEqual(['B.txt']);
    observations.push({scenario:'Y20 deliberately late prior focus frame cannot supersede a newer key received by the owned loading tree'});
  });
  it('Y20 reveals a distant confirmed keyboard target while native directory refresh is pending',async()=>{
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(84);
    for(let i=0;i<20;i++)writeFileSync(join(project,`Z${String(i).padStart(2,'0')}.txt`),'Distant target\n');
    await act(async()=>{await store.list(store.treeRoot!,'',true);});const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await active('B.txt');
    let release!:()=>void;rootDelivery={entered:false,promise:new Promise<void>(done=>{release=done;}),release:()=>release()};let loading!:Promise<void>;
    act(()=>{loading=store.list(store.treeRoot!,'',true);});await waitFor(()=>expect(rootDelivery!.entered).toBe(true));fireEvent.keyDown(screen.getByRole('treeitem',{name:'B.txt'}),{key:'End'});
    await act(async()=>{rootDelivery!.release();await loading;});await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('treeitem',{name:'Z19.txt'})));
    expect(screen.getByRole('tree').scrollTop).toBe(24*28-84);observations.push({scenario:'Y20 End received during actual native refresh reveals and focuses distant fresh row',scrollTop:screen.getByRole('tree').scrollTop});
  });
});
