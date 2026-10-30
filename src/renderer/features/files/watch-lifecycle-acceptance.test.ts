import{randomUUID}from'node:crypto';
import{afterEach,describe,expect,it,vi}from'vitest';
import type{FileRoot,FileWatchUpdate}from'@shared/files';
import type{FileClient}from'./file-buffer';
import{FileWorkspaceStore}from'./workspace-store';
const listeners=vi.hoisted(()=>new Set<(value:unknown)=>void>());
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}},events:{on:(_event:unknown,callback:(value:unknown)=>void)=>{listeners.add(callback);return()=>listeners.delete(callback)}}}));
const stores:FileWorkspaceStore[]=[];
afterEach(()=>{stores.splice(0).forEach(s=>s.dispose());expect(listeners.size).toBe(0)});
const until=async(fn:()=>boolean)=>{for(let i=0;i<100&&!fn();i++)await new Promise(r=>setTimeout(r,1));expect(fn()).toBe(true)};
function fixture(){const root:FileRoot={source:'project-directory',sourceId:'root',path:'/synthetic',canonicalPath:'/synthetic',label:'Unit source',lease:randomUUID(),generation:1,identity:{device:'1',inode:'2'}},update:FileWatchUpdate={id:randomUUID(),lease:root.lease,generation:1,sequence:1,coverage:'native',changed:false,resyncRequired:true};let finish!:(x:FileWatchUpdate)=>void;const api={roots:vi.fn(async()=>({roots:[root],unavailable:[]})),list:vi.fn(async()=>[]),watch:vi.fn(()=>new Promise<FileWatchUpdate>(done=>finish=done)),stopWatch:vi.fn(async()=>undefined),closeScope:vi.fn(async()=>undefined)},store=new FileWorkspaceStore({kind:'project',projectId:randomUUID()},api as unknown as FileClient,null,null);stores.push(store);return{store,api,root,update,finish:()=>finish(update)}}
describe('watch view membership and delayed acknowledgements',()=>{
 it('L01 two attached views share membership until the last view leaves',async()=>{const f=fixture();await f.store.initialize();const a=f.store.attach(),b=f.store.attach();expect(f.api.watch).toHaveBeenCalledTimes(1);f.finish();await until(()=>f.store.watchStates.size===1);a();expect(f.api.stopWatch).not.toHaveBeenCalled();expect(listeners.size).toBe(1);b();b();expect(f.api.stopWatch).toHaveBeenCalledExactlyOnceWith(f.update.id);expect(f.store.watchStates.size).toBe(0);expect(listeners.size).toBe(0)});
 it('L02 unmount before watch acknowledgement compensates by stopping the late ID once',async()=>{const f=fixture();await f.store.initialize();const leave=f.store.attach();leave();leave();expect(f.api.stopWatch).not.toHaveBeenCalled();f.finish();await until(()=>f.api.stopWatch.mock.calls.length===1);expect(f.api.stopWatch).toHaveBeenCalledExactlyOnceWith(f.update.id);expect(f.store.watchStates.size).toBe(0);expect(listeners.size).toBe(0)});
 it('L07 ready acknowledgement resyncs after a progress event was delivered before the watch ID was known',async()=>{const f=fixture();await f.store.initialize();const leave=f.store.attach(),baseline=f.api.list.mock.calls.length;for(const callback of listeners)callback({...f.update,sequence:2,changed:true});expect(f.store.watchStates.size).toBe(0);f.finish();await until(()=>f.api.list.mock.calls.length>baseline);expect(f.store.watchStates.get(f.root.lease)).toMatchObject({id:f.update.id,resyncRequired:true});leave()});
});
