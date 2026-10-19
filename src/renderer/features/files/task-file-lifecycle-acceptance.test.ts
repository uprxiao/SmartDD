// @vitest-environment jsdom
import {createHash,randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import {openDbClient} from '@main/db/client';
import {runBundledMigrations} from '@main/db/migrations';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {FileWorkspacePersistence} from '@main/core/files/workspace-persistence';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {createFileController} from '@main/core/files/controller';
import {registerRPCRouter} from '@shared/ipc/rpc';
import {fileWorkspaceEvent} from '@shared/events';
import type {FileScope,FileSaveReceipt} from '@shared/files';
import {FileWorkspaceStore} from './workspace-store';
import {FileBuffer,type FileClient} from './file-buffer';
const transport=vi.hoisted(()=>({on:null as null|((name:string,callback:(body:unknown)=>void)=>()=>void)}));
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}},events:{on:(event:{name:string},callback:(body:unknown)=>void)=>transport.on!(event.name,callback)}}));
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const until=async(fn:()=>boolean)=>{const end=Date.now()+7000;while(!fn()){if(Date.now()>end)throw Error('Native task-file lifecycle did not settle');await delay(5)}};
type Slot={method:string;path?:string;output:unknown;before:string;after?:string;released:boolean;release():void};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('D10/D11/D18 registered RPC/native/SQLite task file lifecycle',()=>{
 let base:string,project:string,broker:NativeFileBroker,service:FileService,db:ReturnType<typeof openDbClient>,persistence:FileWorkspacePersistence,api:FileClient,stores:FileWorkspaceStore[],slots:Slot[],holdOpen:Set<string>,holdSave:boolean,task1Lease:string,allowedA:string|undefined;
 let one:FileScope,two:FileScope,sender:EventEmitter;
 beforeEach(async()=>{
  base=mkdtempSync('/private/tmp/willyou-task-file-integration-');project=join(base,'project');mkdirSync(project);mkdirSync(join(base,'userdata'));for(const name of['A.txt','B.txt','C.txt'])writeFileSync(join(project,name),'Original '+name+'\n');
  one={kind:'task',taskId:randomUUID()};two={kind:'task',taskId:randomUUID()};broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);const projectId=randomUUID(),resolver={sources:(scope:FileScope)=>[{kind:scope.kind==='task'?'task-cwd'as const:'project-directory'as const,id:scope.kind==='task'?scope.taskId:scope.projectId,path:project,label:'Task snapshot',projectId}]};
  service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));db=openDbClient(join(base,'settings.sqlite'));runBundledMigrations(db.sqlite);persistence=new FileWorkspacePersistence(db.db);
  const frame={processId:192,routingId:292},owner=Object.assign(new EventEmitter(),{id:92,mainFrame:frame,isDestroyed:()=>false,send:(name:string,body:unknown)=>owner.emit(name,structuredClone(body))});sender=owner;
  const event={sender:owner,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===owner,persistence)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);
  stores=[];slots=[];holdOpen=new Set();holdSave=false;task1Lease='';allowedA=undefined;
  api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>{
   const output=await handlers.get('files.'+key)!(event,...args);
   if(key==='roots'&&(args[0]as FileScope).kind==='task'&&(args[0]as{taskId:string}).taskId===(one as{taskId:string}).taskId)task1Lease=(output as{roots:{lease:string}[]}).roots[0].lease;
   const input=args[0]as{relativePath?:string;lease?:string};const held=key==='open'&&holdOpen.has(input.relativePath??'')&&input.lease===task1Lease||key==='save'&&holdSave;
   if(held){if(key==='save')holdSave=false;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),slot:Slot={method:key,path:input.relativePath,output,before:hash(output),released:false,release};slots.push(slot);await gate;slot.released=true;slot.after=hash(output);expect(slot.after).toBe(slot.before)}
   return output;
  }})as FileClient;
  transport.on=(name,callback)=>{sender.on(name,callback);return()=>sender.off(name,callback)};
 });
 afterEach(async()=>{
  for(const slot of slots)slot.release();for(const store of stores)await store.flushPersistence().catch(()=>{});for(const store of stores)store.dispose();service.closeOwner('92:192:292');await service.watcher.dispose();await until(()=>broker.activeProcesses===0);broker.dispose();expect(sender.listenerCount(fileWorkspaceEvent.name)).toBe(0);for(const name of['A.txt','B.txt','C.txt'])expect(readFileSync(join(project,name),'utf8')).toBe(name==='A.txt'&&allowedA?allowedA:'Original '+name+'\n');db.close();rmSync(base,{recursive:true,force:true});
 });
 function make(scope:FileScope){const store=new FileWorkspaceStore(scope,api,null,{load:input=>api.workspace(input),snapshot:input=>api.workspaceSnapshot(input),commit:(input,state,revision,mutationId)=>api.saveWorkspace(input,state,revision,mutationId),subscribe:callback=>{const listener=(body:unknown)=>callback(body as Parameters<typeof callback>[0]);sender.on(fileWorkspaceEvent.name,listener);return()=>sender.off(fileWorkspaceEvent.name,listener)}});stores.push(store);return store}
 it('D10 closing the last document releases only its reference and retains scope/root and empty active state',async()=>{
  const store=make(one);await store.initialize();const root=store.treeRoot!;await store.open(root,'A.txt',true);const ref=store.active!.buffer!.file.ref;expect(await store.close(store.active!.id)).toBe('closed');expect(store.tabs).toEqual([]);expect(store.activeId).toBeNull();expect(store.treeRoot).toBe(root);await expect(api.read(ref)).rejects.toThrow(/UNTRUSTED/);expect((await api.list({lease:root.lease,generation:root.generation,relativePath:''})).map(entry=>entry.name)).toContain('A.txt');await store.flushPersistence();expect(persistence.snapshot(one).state!.routes).toEqual([]);
 });
 it('D11 original native save delivered after real buffer replacement cannot close or clear the new independent native draft',async()=>{
  const store=make(one);await store.initialize();const root=store.treeRoot!;await store.open(root,'A.txt',true);const tab=store.active!,old=tab.buffer!,edit=old.editor!.update({changes:{from:0,to:old.editor!.doc.length,insert:'Old saved content\n'}});old.acceptTransactions(edit.state,[edit]);allowedA='Old saved content\n';holdSave=true;const closing=store.close(tab.id);await until(()=>slots.some(slot=>slot.method==='save'));const slot=slots.find(slot=>slot.method==='save')!;expect((slot.output as FileSaveReceipt).state).toBe('saved');expect(readFileSync(join(project,'A.txt'),'utf8')).toBe(allowedA);
  const replacement=new FileBuffer(await api.open({lease:root.lease,generation:root.generation,relativePath:'A.txt'}),api,()=>{});await replacement.load();tab.buffer=replacement;old.dispose();const next=replacement.editor!.update({changes:{from:0,to:replacement.editor!.doc.length,insert:'NEW independent draft\n'}});replacement.acceptTransactions(next.state,[next]);const checkpoint=await replacement.checkpoint();if(!checkpoint)throw Error('Expected an independent dirty checkpoint');
  slot.release();expect(await closing).toBe('stale');expect(store.active).toBe(tab);expect(tab.buffer).toBe(replacement);expect(tab.error).toBe('');expect(replacement.raw).toBe('NEW independent draft\n');expect(replacement.dirty).toBe(true);expect((await api.drafts(replacement.file.ref)).some(draft=>draft.id===checkpoint.draftId)).toBe(true);expect(Buffer.from((await api.readDraft(replacement.file.ref,checkpoint.draftId)).base64,'base64').toString()).toBe('NEW independent draft\n');expect(readFileSync(join(project,'A.txt'),'utf8')).toBe(allowedA);
 });
 it('D18 same owner/shared events and SQLite keep T2 isolated from delayed successful T1 restoration across view disconnect/reconnect',async()=>{
  const warm=make(one);await warm.initialize();for(const name of['A.txt','B.txt'])await warm.open(warm.treeRoot!,name,true);await warm.flushPersistence();warm.dispose();
  holdOpen=new Set(['A.txt','B.txt']);const first=make(one),initializing=first.initialize(),detachFirst=first.attach();await until(()=>slots.filter(slot=>slot.method==='open').length===2);detachFirst();
  const second=make(two);await second.initialize();const detachSecond=second.attach();await second.open(second.treeRoot!,'C.txt',true);second.setFilter('T2-owned-query');await second.flushPersistence();const c=second.active!,before=persistence.snapshot(two);
  for(const slot of slots.slice().reverse())slot.release();await initializing;await first.flushPersistence();expect(second.active).toBe(c);expect(second.active!.buffer!.raw).toBe('Original C.txt\n');expect(second.tabs.map(tab=>tab.route.relativePath)).toEqual(['C.txt']);expect(persistence.snapshot(two)).toEqual(before);
  detachSecond();const reconnect=first.attach();expect(first.tabs.map(tab=>tab.route.relativePath)).toEqual(['A.txt','B.txt']);expect(first.active!.route.relativePath).toBe('B.txt');expect(first.tabs.map(tab=>tab.buffer!.raw)).toEqual(['Original A.txt\n','Original B.txt\n']);expect(slots.every(slot=>slot.released&&slot.before===slot.after)).toBe(true);reconnect();
 });
});
