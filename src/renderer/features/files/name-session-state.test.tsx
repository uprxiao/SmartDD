// @vitest-environment jsdom
import {randomUUID} from 'node:crypto';
import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {FileRoot,FileSearchRequest} from '@shared/files';
import {useFileSearch} from './file-search';
const bridge=vi.hoisted(()=>({requests:[] as FileSearchRequest[]}));
vi.mock('@renderer/lib/ipc',()=>({events:{on:()=>()=>undefined},rpc:{files:{startSearchSession:async(input:FileSearchRequest)=>{bridge.requests.push(input);return{id:input.id,kind:'name',paths:['one.txt','two.txt'],rows:[],limited:false,searched:2,skipped:0,issues:[]}},cancelSearch:async()=>undefined}}}));
const root:FileRoot={lease:randomUUID(),generation:1,source:'project-directory',sourceId:'root',path:'/synthetic',canonicalPath:'/synthetic',identity:{device:'1',inode:'2'},label:'Synthetic'};
class Peer{
 static instances:Peer[]=[];onmessage:((e:{data:unknown})=>void)|null=null;onerror:(()=>void)|null=null;input?:{paths:string[];query:string;sessionId?:string};terminated=false;
 constructor(){Peer.instances.push(this);}postMessage(input:Peer['input']){this.input=input;}terminate(){this.terminated=true;}
}
beforeEach(()=>{Peer.instances=[];bridge.requests=[];vi.stubGlobal('Worker',Peer);});afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const packet=(sessionId:string,stage:'updated'|'completed',paths:string[])=>({sessionId,stage,ranked:paths.map(path=>({path,file_name:path,score:1,fragments:[],indices:[],matched:true})),total:paths.length,limit:5000,truncated:false});
async function worker(index=0){await waitFor(()=>expect(Peer.instances.length).toBeGreaterThan(index));return Peer.instances[index];}
it('C09 update snapshots replace instead of appending, and only completion ends this Worker',async()=>{
 const hook=renderHook(()=>useFileSearch(root,'name','one')),peer=await worker(),id=bridge.requests[0].id;
 await act(async()=>peer.onmessage!({data:packet(id,'updated',['one.txt'])}));expect(hook.result.current.phase).toBe('partial');expect(peer.terminated).toBe(false);
 await act(async()=>peer.onmessage!({data:packet(id,'updated',['one.txt','two.txt'])}));expect(hook.result.current.names.map(x=>x.path)).toEqual(['one.txt','two.txt']);expect(peer.terminated).toBe(false);
 await act(async()=>peer.onmessage!({data:packet(id,'completed',['two.txt','one.txt'])}));expect(hook.result.current.phase).toBe('done');expect(hook.result.current.names.map(x=>x.path)).toEqual(['two.txt','one.txt']);expect(peer.terminated).toBe(true);
});
it('C09 a foreign completion cannot finish the current session; final empty snapshot is authoritative',async()=>{
 const hook=renderHook(()=>useFileSearch(root,'name','one')),peer=await worker(),id=bridge.requests[0].id;
 await act(async()=>peer.onmessage!({data:packet(randomUUID(),'completed',['foreign.txt'])}));expect(hook.result.current.phase).toBe('searching');expect(peer.terminated).toBe(false);
 await act(async()=>peer.onmessage!({data:packet(id,'updated',['one.txt'])}));expect(hook.result.current.names).toHaveLength(1);
 await act(async()=>peer.onmessage!({data:packet(id,'completed',[])}));expect(hook.result.current.phase).toBe('done');expect(hook.result.current.names).toHaveLength(0);
});
it('C09 updates and completion captured before switching roots/query cannot affect the new session',async()=>{
 const hook=renderHook(({query,scope}:{query:string;scope:FileRoot})=>useFileSearch(scope,'name',query),{initialProps:{query:'one',scope:root}}),old=await worker(),deliver=old.onmessage!;
 hook.rerender({query:'two',scope:{...root,lease:randomUUID(),generation:2}});const next=await worker(1),id=bridge.requests[1].id;
 await act(async()=>deliver({data:packet(bridge.requests[0].id,'completed',['old.txt'])}));expect(old.terminated).toBe(true);expect(next.terminated).toBe(false);expect(hook.result.current.names).toHaveLength(0);
 await act(async()=>next.onmessage!({data:packet(id,'updated',['two.txt'])}));expect(hook.result.current.phase).toBe('partial');expect(hook.result.current.names.map(x=>x.path)).toEqual(['two.txt']);
});
it('C09 duplicate paths are invalid and late updates after completion are ignored',async()=>{
 const hook=renderHook(()=>useFileSearch(root,'name','one')),peer=await worker(),id=bridge.requests[0].id;
 await act(async()=>peer.onmessage!({data:packet(id,'updated',['one.txt','one.txt'])}));expect(hook.result.current.phase).toBe('error');expect(hook.result.current.names).toHaveLength(0);expect(peer.terminated).toBe(true);
 await act(async()=>peer.onmessage!({data:packet(id,'completed',['old.txt'])}));expect(hook.result.current.phase).toBe('error');
});
