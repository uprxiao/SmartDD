// @vitest-environment jsdom
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
import { WorkspaceTree } from './workspace-tree';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'fixture', apps: [], preferredUnavailable: false })) } }, events: { on: vi.fn(() => () => undefined) } }));
const observations: unknown[]=[];
function Tree({store}:{store:FileWorkspaceStore}) {useSyncExternalStore(store.subscribe,store.snapshot);return <WorkspaceTree store={store} run={work=>{void work();}}/>;}
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('B06/B07/B13 real filesystem failure and large-directory integration',()=>{
  let base:string,project:string,service:FileService,broker:NativeFileBroker,store:FileWorkspaceStore;
  let beforeRead:(()=>Promise<void>)|undefined,release:(()=>void)|undefined;
  beforeEach(async()=>{
    base=realpathSync(mkdtempSync('/private/tmp/willyou-tree-failures-'));project=join(base,'project');mkdirSync(project);mkdirSync(join(base,'userdata'));mkdirSync(join(project,'restricted'));mkdirSync(join(project,'many'));
    writeFileSync(join(project,'A.txt'),'previous A content');writeFileSync(join(project,'B.txt'),'new B content');writeFileSync(join(project,'restricted/child.txt'),'readable after restore');
    const second=join(base,'second');mkdirSync(second);writeFileSync(join(second,'A.txt'),'second A');writeFileSync(join(second,'B.txt'),'second B');
    for(const root of [project,second]) {
      for(const name of ['one','two','three']){mkdirSync(join(root,name));writeFileSync(join(root,name,'child.txt'),`${root}/${name}`);}
      // Scroll restoration needs genuine overflow in the 400px substitute
      // viewport; a cached offset for a shorter tree is correctly clamped.
      for(let i=0;i<12;i++)writeFileSync(join(root,`z-tail-${i}.txt`),'Viewport overflow fixture');
    }
    broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);beforeRead=undefined;release=undefined;
    const request=broker.request.bind(broker);
    broker.request=async<T,>(input:Record<string,unknown>,options?:BrokerOptions):Promise<T>=>{if(input.operation==='read' && input.relativePath==='B.txt')await beforeRead?.();return request<T>(input,options);};
    const resolver={sources:()=>[project,second].map((path,index)=>({kind:'project-directory' as const,id:`tree-failures-${index}`,path,label:'Synthetic tree failures',projectId:'tree-failures'}))};
    service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
    const api={roots:(scope:FileScope)=>service.openScope('tree-failures',scope),list:(input:PathRequest)=>service.list('tree-failures',input),open:(input:PathRequest)=>service.open('tree-failures',input),read:(ref:FileRef)=>service.read('tree-failures',ref),refresh:(ref:FileRef)=>service.refresh('tree-failures',ref),drafts:(ref:FileRef)=>service.drafts('tree-failures',ref),closeDocument:async(ref:FileRef)=>service.closeDocument('tree-failures',ref),closeScope:async(scope:FileScope)=>service.closeScope('tree-failures',scope)};
    store=new FileWorkspaceStore({kind:'project',projectId:'tree-failures'},api as unknown as FileClient,null,null);
    vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(400);
    vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
    await store.initialize();render(<Tree store={store}/>);
  });
  afterEach(async()=>{release?.();cleanup();store?.dispose();service?.closeOwner('tree-failures');await service?.watcher.dispose();broker?.dispose();vi.unstubAllGlobals();vi.restoreAllMocks();if(base){chmodSync(join(project,'restricted'),0o755);rmSync(base,{recursive:true,force:true});}});
  afterAll(()=>{if(process.env.SMARTDD_TREE_FAILURE_EVIDENCE)writeFileSync(process.env.SMARTDD_TREE_FAILURE_EVIDENCE,JSON.stringify({at:new Date().toISOString(),layer:'I: real native filesystem + FileService + FileWorkspaceStore + React tree in jsdom; no prototype or App A claim',broker:process.env.SMARTDD_M9_FILE_BROKER,observations},null,2)+'\n');});
  it('B06 confines a real permission failure to its node and retries once without duplicating children',async()=>{
    chmodSync(join(project,'restricted'),0o000);const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'restricted'}));
    const alert=await screen.findByRole('alert');expect(alert.textContent).toContain('读取失败');expect(alert.getAttribute('title')).toBeTruthy();expect(screen.queryByRole('treeitem',{name:'child.txt'})).toBeNull();
    await user.click(screen.getByRole('treeitem',{name:'A.txt'}));await waitFor(()=>expect(store.active?.buffer?.raw).toBe('previous A content'));
    chmodSync(join(project,'restricted'),0o755);await user.click(screen.getByRole('button',{name:'重试'}));await screen.findByRole('treeitem',{name:'child.txt'});
    expect(screen.getAllByRole('treeitem',{name:'child.txt'})).toHaveLength(1);expect(screen.queryByRole('alert')).toBeNull();expect(readFileSync(join(project,'restricted/child.txt'),'utf8')).toBe('readable after restore');
    observations.push({caseId:'M9-T-B06',permissionModes:['000','755'],siblingReadable:true,childInstances:1,sourceUnchanged:true});
  });
  it('B07 deletes the selected file before the real read and never displays the previous buffer',async()=>{
    const user=userEvent.setup();await user.click(screen.getByRole('treeitem',{name:'A.txt'}));await waitFor(()=>expect(store.active?.buffer?.raw).toBe('previous A content'));
    let entered=false;const gate=new Promise<void>(done=>{release=done;});beforeRead=async()=>{entered=true;await gate;};
    await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await waitFor(()=>expect(entered).toBe(true));
    unlinkSync(join(project,'B.txt'));release!();await waitFor(()=>expect(store.active?.buffer?.loadState).toBe('error'));
    expect(store.active?.route.relativePath).toBe('B.txt');expect(store.active?.buffer?.raw).toBe('');expect(store.active?.buffer?.loadError).toBeTruthy();
    const error=store.active!.buffer!.loadError;await act(async()=>{await store.refresh();});expect(screen.queryByRole('treeitem',{name:'B.txt'})).toBeNull();
    expect(screen.getAllByRole('treeitem').filter(node=>node.tabIndex===0)).toHaveLength(1);
    await act(async()=>{await store.close(store.activeId!);});expect(store.active).toBeNull();expect(readFileSync(join(project,'A.txt'),'utf8')).toBe('previous A content');
    observations.push({caseId:'M9-T-B07',error,deletedBeforeNativeRead:true,staleContentShown:false,treeRemovedMissing:true,tabClosable:true});
  });
  it('B12 restores independent selection, focus, expanded paths, filter and scroll for each real root',async()=>{
    const [a,b]=store.roots.roots,user=userEvent.setup();
    for(const name of ['one','two','three'])await user.click(screen.getByRole('treeitem',{name}));
    await waitFor(()=>expect(screen.getAllByRole('treeitem',{name:'child.txt'})).toHaveLength(3));
    await user.click(screen.getByRole('treeitem',{name:'A.txt'}));await user.keyboard('{Meta>}');await user.click(screen.getByRole('treeitem',{name:'B.txt'}));await user.keyboard('{/Meta}');
    await waitFor(()=>expect(store.active?.buffer?.raw).toBe('previous A content'));
    fireEvent.focus(screen.getByRole('treeitem',{name:'B.txt'}));act(()=>store.setFilter('foo'));fireEvent.scroll(screen.getByRole('tree'),{target:{scrollTop:56}});
    await act(async()=>{store.selectRoot(b);await store.list(b,'');});
    expect(store.filter).toBe('');expect(store.currentExpanded).toEqual([]);expect(screen.getAllByRole('treeitem').filter(node=>node.getAttribute('aria-selected')==='true')).toHaveLength(0);
    fireEvent.click(screen.getByRole('treeitem',{name:'B.txt'}),{metaKey:true});fireEvent.focus(screen.getByRole('treeitem',{name:'A.txt'}));act(()=>store.setFilter('bar'));fireEvent.scroll(screen.getByRole('tree'),{target:{scrollTop:28}});
    await act(async()=>{store.selectRoot(a);await store.list(a,'');});
    expect(store.filter).toBe('foo');expect(store.currentExpanded).toEqual(['one','two','three']);expect(screen.getByRole('tree').scrollTop).toBe(56);
    expect(['A.txt','B.txt'].map(name=>screen.getByRole('treeitem',{name}).getAttribute('aria-selected'))).toEqual(['true','true']);expect(screen.getByRole('treeitem',{name:'B.txt'}).tabIndex).toBe(0);
    await act(async()=>{store.selectRoot(b);await store.list(b,'');});
    expect(store.filter).toBe('bar');expect(store.currentExpanded).toEqual([]);expect(screen.getByRole('tree').scrollTop).toBe(28);expect(screen.getByRole('treeitem',{name:'B.txt'}).getAttribute('aria-selected')).toBe('true');expect(screen.getByRole('treeitem',{name:'A.txt'}).getAttribute('aria-selected')).toBe('false');expect(screen.getByRole('treeitem',{name:'A.txt'}).tabIndex).toBe(0);
    observations.push({caseId:'M9-T-B12',roots:2,restored:{a:{selected:['A.txt','B.txt'],focused:'B.txt',expanded:['one','two','three'],query:'foo',scrollTop:56},b:{selected:['B.txt'],focused:'A.txt',expanded:[],query:'bar',scrollTop:28}},boundary:'Actual native roots/store/tree; filter state checked in store, full filter UI and App remain unverified.'});
  });
  it('B11 cancels old-root focus callbacks and restores scroll after a delayed remount without stealing new-root focus',async()=>{
    const [a,b]=store.roots.roots;await store.list(b,'');const callbacks:FrameRequestCallback[]=[];
    vi.spyOn(globalThis,'requestAnimationFrame').mockImplementation(callback=>{callbacks.push(callback);return callbacks.length;});const cancel=vi.spyOn(globalThis,'cancelAnimationFrame').mockImplementation(()=>{});
    const old=screen.getByRole('treeitem',{name:'A.txt'});fireEvent.focus(old);fireEvent.keyDown(old,{key:'End'});expect(callbacks).toHaveLength(1);
    await act(async()=>{store.selectRoot(b);await store.list(b,'');});const fresh=screen.getByRole('treeitem',{name:'A.txt'});act(()=>fresh.focus());act(()=>callbacks[0](0));
    expect(document.activeElement).toBe(fresh);expect(cancel).toHaveBeenCalledWith(1);
    fireEvent.scroll(screen.getByRole('tree'),{target:{scrollTop:28}});cleanup();
    const callbacksBefore=callbacks.length;render(<Tree store={store}/>);expect(screen.getByRole('tree').scrollTop).toBe(28);expect(callbacks).toHaveLength(callbacksBefore);
    const current=screen.getByRole('treeitem',{name:'A.txt'});fireEvent.keyDown(current,{key:'End'});cleanup();expect(cancel).toHaveBeenCalledWith(2);act(()=>callbacks[1](0));expect(callbacks).toHaveLength(2);
    observations.push({caseId:'M9-T-B11',oldLease:a.lease,newLease:b.lease,lateFocusIgnored:true,remountScrollTop:28,callbacksScheduled:2,callbacksCancelled:[1,2],boundary:'Deterministic delayed RAF callbacks; component tree/native roots, no real App focus claim.'});
  });
  it.each([10000,10001])('B13 lists all %i files and keeps rendered rows bounded at the first, middle and last position',async count=>{
    for(let i=0;i<count;i++)writeFileSync(join(project,'many',`item-${String(i).padStart(5,'0')}.txt`),`fixture ${i}`);
    const user=userEvent.setup(),heapBefore=process.memoryUsage().heapUsed,start=performance.now();await user.click(screen.getByRole('treeitem',{name:'many'}));
    await waitFor(()=>expect(store.directories.get(store.directoryKey(store.treeRoot!,'many'))?.state).toBe('ready'),{timeout:10000});
    const listedMs=performance.now()-start,state=store.directories.get(store.directoryKey(store.treeRoot!,'many'))!;expect(state.state==='ready' && state.entries.length).toBe(count);
    if(state.state!=='ready')throw new Error('Directory did not finish');
    const roster=state.entries.map(entry=>entry.relativePath);expect(new Set(roster).size).toBe(count);
    for(let i=0;i<count;i++)expect(roster[i]).toBe(`many/item-${String(i).padStart(5,'0')}.txt`);
    const tree=screen.getByRole('tree'),rows:number[]=[];
    for(const top of [0,Math.floor(count/2)*28,(count-8)*28]){fireEvent.scroll(tree,{target:{scrollTop:top}});const visible=screen.getAllByRole('treeitem');rows.push(visible.length);expect(visible.length).toBeLessThanOrEqual(30);}
    const last=`item-${String(count-1).padStart(5,'0')}.txt`;await user.click(screen.getByRole('treeitem',{name:last}));await waitFor(()=>expect(store.active?.buffer?.raw).toBe(`fixture ${count-1}`));
    observations.push({caseId:'M9-T-B13',count,returned:state.entries.length,uniqueExactRoster:roster.length,renderedRows:rows,listedMs,heapDeltaBytes:process.memoryUsage().heapUsed-heapBefore,lastFile:last,exactTailText:store.active!.buffer!.raw,boundary:'jsdom timings/Node heap are diagnostics, not native App scroll latency or renderer-memory budget acceptance.'});
  },20000);
});
