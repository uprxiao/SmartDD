// @vitest-environment jsdom
import {EventEmitter} from 'node:events';
import {chmodSync,copyFileSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {act,cleanup,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import type {FileSearchResult} from '@shared/files';
import {registerRPCRouter} from '@shared/ipc/rpc';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {createFileController} from '@main/core/files/controller';
import {FileWorkspaceStore} from './workspace-store';
import type {FileClient} from './file-buffer';
import {rankFileCandidates} from './file-fuzzy-model.mjs';
import {useFileSearch} from './file-search';

const transport=vi.hoisted(()=>({invoke:null as null|((method:string,...args:unknown[])=>Promise<unknown>),on:null as null|((name:string,callback:(value:unknown)=>void)=>()=>void)}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{startSearchSession:(...args:unknown[])=>transport.invoke!('startSearchSession',...args),cancelSearch:(...args:unknown[])=>transport.invoke!('cancelSearch',...args)}},events:{on:(event:{name:string},callback:(value:unknown)=>void)=>transport.on!(event.name,callback)}}));
// Literal synthetic names isolate the production state/store/native contracts.
// The packaged A tests separately use the unmodified fuzzy Worker.
class RankingAdapter{
 onmessage:((event:{data:{ranked:unknown[]}})=>void)|null=null;disposed=false;
 postMessage(input:{paths:string[];query:string}){queueMicrotask(()=>{if(!this.disposed)this.onmessage?.({data:{ranked:rankFileCandidates(input.query,input.paths.filter(p=>p.toLowerCase().includes(input.query.toLowerCase())).map(path=>({path})))}})})}
 terminate(){this.disposed=true}
}
const until=async(fn:()=>boolean,timeout=7000)=>{const end=performance.now()+timeout;while(!fn()){if(performance.now()>end)throw Error('Real search failure did not settle');await act(async()=>{await delay(10)})}};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('C12/C15 original RPC, search state and workspace with native files',()=>{
 let base:string,root:string,gates:string,service:FileService,broker:NativeFileBroker,store:FileWorkspaceStore;
 let invoke:(method:string,...args:unknown[])=>Promise<unknown>;
 let responses:FileSearchResult[];
 beforeEach(async()=>{
  vi.stubGlobal('Worker',RankingAdapter);base=mkdtempSync('/private/tmp/willyou-search-failure-integration-');root=join(base,'project');gates=join(base,'gates');for(const p of[root,gates,join(base,'userdata')])mkdirSync(p);
  for(const name of['sentinel.txt','victim-delete.txt','victim-rename.txt','TimeoutMatch.txt'])writeFileSync(join(root,name),'ORIGINAL '+name+'\n');
  const wrapper=join(base,'broker.py');copyFileSync(resolve('scripts/files/search-timeout-broker.py'),wrapper);chmodSync(wrapper,0o755);writeFileSync(join(base,'broker.json'),JSON.stringify({root,gates,nativeBroker:process.env.SMARTDD_M9_FILE_BROKER,log:join(base,'native.jsonl')}));
  broker=new NativeFileBroker(wrapper);const resolver={sources:()=>[{kind:'project-directory'as const,id:'A',path:root,label:'A',projectId:'failures'}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  const frame={processId:189,routingId:289},sender=Object.assign(new EventEmitter(),{id:89,mainFrame:frame,isDestroyed:()=>false,send:(channel:string,value:unknown)=>sender.emit(channel,structuredClone(value))}),event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent;
  const handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===sender)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);
  invoke=async(method,...args)=>handlers.get('files.'+method)!(event,...args);responses=[];
  transport.invoke=async(method,...args)=>{const result=await invoke(method,...args);if(method==='startSearchSession')responses.push(result as FileSearchResult);return result};transport.on=(name,callback)=>{sender.on(name,callback);return()=>sender.off(name,callback)};
  const api=new Proxy({},{get:(_target,key:string)=>(...args:unknown[])=>invoke(key,...args)})as FileClient;store=new FileWorkspaceStore({kind:'project',projectId:'failures'},api,null,null);await store.initialize();expect(store.treeRoot?.path).toBe(root);
 });
 afterEach(async()=>{cleanup();chmodSync(root,0o755);store?.dispose();service?.closeOwner('89:189:289');await until(()=>!service.searcher.activeRequests&&!broker.activeProcesses);await service.watcher.dispose();broker.dispose();expect(readFileSync(join(root,'sentinel.txt'),'utf8')).toBe('ORIGINAL sentinel.txt\n');rmSync(base,{recursive:true,force:true});vi.unstubAllGlobals()});
 it('C12 empty native matches complete successfully without an error',async()=>{
  const h=renderHook(()=>useFileSearch(store.treeRoot,'name','NO_MATCH_987'));await until(()=>h.result.current.phase==='done');expect(h.result.current.names).toEqual([]);expect(h.result.current.error).toBe('');expect(responses).toHaveLength(1);expect(responses[0].paths).toHaveLength(4);h.unmount();
 });
 it('C12 genuine root permission error remains an error and retry succeeds after chmod restore',async()=>{
  chmodSync(root,0o000);const h=renderHook(()=>useFileSearch(store.treeRoot,'name','TimeoutMatch'));await until(()=>h.result.current.phase==='error');expect(h.result.current.error).toMatch(/PERMISSION|权限|Permission denied/);expect(h.result.current.names).toEqual([]);expect(h.result.current.result).toBeNull();expect(responses).toHaveLength(0);
  chmodSync(root,0o755);await act(async()=>h.result.current.retry());await until(()=>h.result.current.phase==='done');expect(h.result.current.names.map(x=>x.path)).toEqual(['TimeoutMatch.txt']);expect(h.result.current.error).toBe('');h.unmount();
 });
 it('C12 real unchanged main timeout kills a withheld genuine success and retry starts a fresh native job',async()=>{
  writeFileSync(join(gates,'timeout.arm'),'armed');const h=renderHook(()=>useFileSearch(store.treeRoot,'name','TimeoutMatch'));await until(()=>h.result.current.phase==='error',20000);expect(h.result.current.error).toMatch(/TIMEOUT|超时/);expect(h.result.current.result).toBeNull();expect(responses).toHaveLength(0);
  const rows=readFileSync(join(base,'native.jsonl'),'utf8').trim().split('\n').map(x=>JSON.parse(x));expect(rows.find(x=>x.event==='waiting')?.nativeExit).toBe(0);expect(rows.some(x=>x.held&&x.event==='cancelled')).toBe(true);expect(rows.some(x=>x.held&&x.event==='delivered')).toBe(false);expect(broker.activeProcesses).toBe(0);expect(service.searcher.activeRequests).toBe(0);
  await act(async()=>h.result.current.retry());await until(()=>h.result.current.phase==='done');expect(h.result.current.names.map(x=>x.path)).toEqual(['TimeoutMatch.txt']);expect(responses).toHaveLength(1);h.unmount();
 },25000);
 it.each(['delete','rename']as const)('C15 selected cached %s result revalidates on open and never chooses its neighbor',async action=>{
  await store.open(store.treeRoot!,'sentinel.txt',true);const sentinel=store.active!;expect(sentinel.buffer?.raw).toBe('ORIGINAL sentinel.txt\n');
  const h=renderHook(()=>useFileSearch(store.treeRoot,'name','victim'));await until(()=>h.result.current.phase==='done');expect(h.result.current.names).toHaveLength(2);const name='victim-'+action+'.txt',selected=h.result.current.names.find(x=>x.path===name)!;expect(selected).toBeTruthy();
  if(action==='delete')unlinkSync(join(root,name));else renameSync(join(root,name),join(root,'renamed.txt'));
  expect(h.result.current.names.find(x=>x.path===name)).toBe(selected);await store.open(store.treeRoot!,selected.path);
  expect(store.active!.route.relativePath).toBe(name);expect(store.active!.buffer).toBeNull();expect(store.active!.error).toMatch(/MISSING|不存在|找不到|deleted/);expect(store.tabs).toContain(sentinel);expect(sentinel.buffer?.raw).toBe('ORIGINAL sentinel.txt\n');
  if(action==='rename'){await store.open(store.treeRoot!,'renamed.txt');expect(store.active!.route.relativePath).toBe('renamed.txt');expect(store.active!.buffer?.raw).toBe('ORIGINAL victim-rename.txt\n')}
  expect(responses).toHaveLength(1);h.unmount();
 });
});
