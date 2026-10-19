// @vitest-environment jsdom
import{randomUUID}from'node:crypto';
import{EventEmitter}from'node:events';
import{mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync}from'node:fs';
import{join}from'node:path';
import{setTimeout as delay}from'node:timers/promises';
import{act,cleanup,renderHook}from'@testing-library/react';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import type{IpcMain,IpcMainInvokeEvent}from'electron';
import type{FileRoot,FileSearchRequest,FileSearchResult,FileSearchProgress}from'@shared/files';
import{fileSearchEvent}from'@shared/events';
import{registerRPCRouter}from'@shared/ipc/rpc';
import{FileService}from'@main/core/files/file-service';
import{FileRootsService}from'@main/core/files/roots';
import{FileRecoveryStore}from'@main/core/files/recovery-store';
import{NativeFileBroker}from'@main/core/files/native-broker';
import{createFileController}from'@main/core/files/controller';
import{rankFileCandidates}from'./file-fuzzy-model.mjs';
import{useFileSearch}from'./file-search';
const transport=vi.hoisted(()=>({invoke:null as null|((method:string,...args:unknown[])=>Promise<unknown>),on:null as null|((name:string,callback:(value:unknown)=>void)=>()=>void)}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{startSearchSession:(...args:unknown[])=>transport.invoke!('startSearchSession',...args),cancelSearch:(...args:unknown[])=>transport.invoke!('cancelSearch',...args)}},events:{on:(event:{name:string},callback:(value:unknown)=>void)=>transport.on!(event.name,callback)}}));
const until=async(fn:()=>boolean)=>{const end=performance.now()+6000;while(!fn()){if(performance.now()>end)throw Error('Native search race did not settle');await act(async()=>{await delay(5)})}};
// Matching is not under test here: this small async fixture adapter uses the
// real ranking model on simple literal-prefix fixture paths. A runs real Worker.
let workerCount=0;
class RankingAdapter{
 onmessage:((event:{data:{ranked:unknown[]}})=>void)|null=null;disposed=false;
 constructor(){workerCount++}
 postMessage(input:{paths:string[];query:string}){queueMicrotask(()=>{if(!this.disposed)this.onmessage?.({data:{ranked:rankFileCandidates(input.query,input.paths.filter(p=>p.toLowerCase().includes(input.query.toLowerCase())).map(path=>({path})))}})})}
 terminate(){this.disposed=true}
}
type Slot={request:FileSearchRequest;result:FileSearchResult;at:number;release():void};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('C06/C07/C08/C16 production hook, original RPC and real native searches',()=>{
 let base:string,a:string,b:string,service:FileService,broker:NativeFileBroker,roots:FileRoot[],slots:Slot[],hold:((input:FileSearchRequest)=>boolean),requests:{input:FileSearchRequest;at:number}[],cancels:string[],notifications:FileSearchProgress[];
 let sender:EventEmitter&{id:number;mainFrame:object;isDestroyed():boolean;send(channel:string,value:unknown):void};
 let invoke:(method:string,...args:unknown[])=>Promise<unknown>;
 beforeEach(async()=>{
  vi.useRealTimers();workerCount=0;vi.stubGlobal('Worker',RankingAdapter);base=mkdtempSync('/private/tmp/willyou-search-race-integration-');a=join(base,'A');b=join(base,'B');for(const p of[a,b,join(base,'userdata')])mkdirSync(p);
  writeFileSync(join(a,'a-Only.txt'),'only a\n');writeFileSync(join(a,'ab-Only.txt'),'only ab\n');writeFileSync(join(a,'abc-A.txt'),'Root A abc content\n');writeFileSync(join(b,'abc-B.txt'),'Root B abc content\n');
  broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);const resolver={sources:()=>[{kind:'project-directory'as const,id:'A',path:a,label:'A',projectId:'race'},{kind:'project-directory'as const,id:'B',path:b,label:'B',projectId:'race'}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  slots=[];requests=[];cancels=[];notifications=[];hold=()=>false;
  const frame={processId:188,routingId:288};sender=Object.assign(new EventEmitter(),{id:88,mainFrame:frame,isDestroyed:()=>false,send:(channel:string,value:unknown)=>{if(channel===fileSearchEvent.name)notifications.push(structuredClone(value)as FileSearchProgress);sender.emit(channel,structuredClone(value))}});
  const event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>candidate.sender===sender)}, {handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);
  invoke=async(method,...args)=>{const result=await handlers.get('files.'+method)!(event,...args);return result};
  transport.invoke=async(method,...args)=>{if(method==='cancelSearch'){cancels.push(String(args[0]));return invoke(method,...args)}if(method==='startSearchSession'){const input=args[0]as FileSearchRequest;requests.push({input,at:Date.now()});const wait=hold(input),result=await invoke(method,...args)as FileSearchResult;if(wait){let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve});slots.push({request:input,result,at:Date.now(),release});await gate;}return result;}return invoke(method,...args)};
  transport.on=(name,callback)=>{sender.on(name,callback);return()=>{sender.off(name,callback)}};roots=(await invoke('roots',{kind:'project',projectId:'race'})as{roots:FileRoot[]}).roots;
 });
 afterEach(async()=>{cleanup();slots?.forEach(s=>s.release());vi.useRealTimers();service?.closeOwner('88:188:288');if(service)await until(()=>!service.searcher.activeRequests&&!broker.activeProcesses);expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);await service?.watcher.dispose();broker?.dispose();expect(readFileSync(join(a,'abc-A.txt'),'utf8')).toBe('Root A abc content\n');expect(readFileSync(join(b,'abc-B.txt'),'utf8')).toBe('Root B abc content\n');rmSync(base,{recursive:true,force:true});vi.unstubAllGlobals()});
 it('C06 exact50ms queries accept only abc when real successes return abc,a,ab',async()=>{
  hold=()=>true;vi.useFakeTimers({toFake:['setTimeout','clearTimeout','Date']});vi.setSystemTime(0);
  const hook=renderHook(({query}:{query:string})=>useFileSearch(roots[0],'name',query),{initialProps:{query:'a'}});
  await act(async()=>{await vi.advanceTimersByTimeAsync(49)});expect(requests).toHaveLength(0);await act(async()=>{await vi.advanceTimersByTimeAsync(1)});await until(()=>slots.length===1);
  hook.rerender({query:'ab'});await act(async()=>{await vi.advanceTimersByTimeAsync(50)});await until(()=>slots.length===2);hook.rerender({query:'abc'});await act(async()=>{await vi.advanceTimersByTimeAsync(50)});await until(()=>slots.length===3);
  expect(requests.map(x=>[x.input.query,x.at])).toEqual([['a',50],['ab',100],['abc',150]]);expect(new Set(requests.map(x=>x.input.id)).size).toBe(3);
  await act(async()=>slots[2].release());await until(()=>hook.result.current.phase==='done');expect(hook.result.current.names.map(x=>x.path)).toEqual(['abc-A.txt']);const id=hook.result.current.result!.id;
  for(const s of[slots[0],slots[1]]){await act(async()=>{s.release();await Promise.resolve()});expect(hook.result.current.result!.id).toBe(id);expect(hook.result.current.names.map(x=>x.path)).toEqual(['abc-A.txt'])}
  expect(cancels).toEqual(expect.arrayContaining([slots[0].request.id,slots[1].request.id]));expect(workerCount).toBe(1);hook.unmount();
 });
 it.each(['name','content']as const)('C07 %s clear cancels original request and ignores its late success/progress',async kind=>{
  hold=()=>true;const hook=renderHook(({query}:{query:string})=>useFileSearch(roots[0],kind,query),{initialProps:{query:'abc'}});await until(()=>slots.length===1);const s=slots[0],old=notifications.find(n=>n.id===s.request.id);hook.rerender({query:''});expect(hook.result.current.phase).toBe('idle');expect(hook.result.current.names).toEqual([]);expect(hook.result.current.rows).toEqual([]);await until(()=>cancels.includes(s.request.id));expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);
  await act(async()=>{s.release();if(old)sender.send(fileSearchEvent.name,old);await Promise.resolve()});expect(hook.result.current.phase).toBe('idle');expect(hook.result.current.rows).toEqual([]);expect(hook.result.current.names).toEqual([]);expect(workerCount).toBe(0);hook.unmount();
 });
 it.each(['name','content']as const)('C08 %s root A cannot update root B with the same query',async kind=>{
  hold=input=>input.root.lease===roots[0].lease;const hook=renderHook(({root}:{root:FileRoot})=>useFileSearch(root,kind,'abc'),{initialProps:{root:roots[0]}});await until(()=>slots.length===1);const s=slots[0],old=notifications.find(n=>n.id===s.request.id);hook.rerender({root:roots[1]});await until(()=>hook.result.current.phase==='done');const current=hook.result.current.result!.id;expect(current).not.toBe(s.request.id);expect(kind==='name'?hook.result.current.names.map(x=>x.path):hook.result.current.rows.map(x=>x.relativePath)).toEqual(['abc-B.txt']);
  await act(async()=>{s.release();if(old)sender.send(fileSearchEvent.name,old);await Promise.resolve()});expect(hook.result.current.result!.id).toBe(current);expect(kind==='name'?hook.result.current.names.map(x=>x.path):hook.result.current.rows.map(x=>x.relativePath)).toEqual(['abc-B.txt']);expect(cancels).toContain(s.request.id);hook.unmount();
 });
 it('C16 twenty real pending mount/unmount cycles leave zero jobs,processes or renderer IPC listeners',async()=>{
  hold=()=>true;
  for(let i=0;i<20;i++){const hook=renderHook(()=>useFileSearch(roots[0],'name','abc'));await until(()=>slots.length===i+1);const s=slots[i];expect(sender.listenerCount(fileSearchEvent.name)).toBe(1);hook.unmount();await until(()=>cancels.includes(s.request.id));expect(sender.listenerCount(fileSearchEvent.name)).toBe(0);await act(async()=>{s.release();await Promise.resolve()});expect(service.searcher.activeRequests).toBe(0);expect(broker.activeProcesses).toBe(0)}
  expect(new Set(slots.map(x=>x.request.id)).size).toBe(20);expect(workerCount).toBe(0);expect(cancels).toHaveLength(20);
 });
});
