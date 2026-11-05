// @vitest-environment jsdom
import {EventEmitter} from 'node:events';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import {registerRPCRouter} from '@shared/ipc/rpc';
import {FileService} from '@main/core/files/file-service';
import {FileRootsService} from '@main/core/files/roots';
import {FileRecoveryStore} from '@main/core/files/recovery-store';
import {NativeFileBroker} from '@main/core/files/native-broker';
import {createFileController} from '@main/core/files/controller';
import {FileWorkspaceStore} from './workspace-store';
import type {FileClient} from './file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}},events:{on:()=>()=>{}}}));
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('D04/D06/D12/D13 workspace lifecycle with original RPC/native',()=>{
 let base:string,a:string,b:string,service:FileService,broker:NativeFileBroker,store:FileWorkspaceStore;
 beforeEach(async()=>{
  base=mkdtempSync('/private/tmp/willyou-tab-lifecycle-integration-');a=join(base,'A');b=join(base,'B');for(const p of[a,b,join(base,'userdata')])mkdirSync(p);
  for(const p of[a,b])for(const name of['a.txt','b.txt','c.txt','d.txt','same.txt',...Array.from({length:26},(_,i)=>'file-'+i+'.txt')])writeFileSync(join(p,name),(p===a?'A ':'B ')+name+'\n');
  broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);const resolver={sources:()=>[a,b].map((path,i)=>({kind:'project-directory'as const,id:i?'B':'A',path,label:i?'B':'A',projectId:'tabs'}))};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  const frame={processId:190,routingId:290},sender=Object.assign(new EventEmitter(),{id:90,mainFrame:frame,isDestroyed:()=>false,send:()=>{}}),event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();
  registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===sender)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);
  const api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>handlers.get('files.'+key)!(event,...args)})as FileClient;store=new FileWorkspaceStore({kind:'project',projectId:'tabs'},api,null,null);await store.initialize();expect(store.roots.roots).toHaveLength(2);
 });
 afterEach(async()=>{store.dispose();service.closeOwner('90:190:290');await service.watcher.dispose();broker.dispose();expect(readFileSync(join(a,'d.txt'),'utf8')).toBe('A d.txt\n');rmSync(base,{recursive:true,force:true})});
 const names=()=>store.tabs.map(tab=>tab.route.relativePath);
 it('D04 same basename in two roots has different documents and independent drafts',async()=>{
  await store.open(store.roots.roots[0],'same.txt',true);const left=store.active!.buffer!,l=left.editor!.update({changes:{from:0,insert:'LOCAL-A '}});left.acceptTransactions(l.state,[l]);
  await store.open(store.roots.roots[1],'same.txt',true);const right=store.active!.buffer!;expect(right.raw).toBe('B same.txt\n');const r=right.editor!.update({changes:{from:0,insert:'LOCAL-B '}});right.acceptTransactions(r.state,[r]);
  expect(left.file.documentKey).not.toBe(right.file.documentKey);expect(left.raw).toBe('LOCAL-A A same.txt\n');expect(right.raw).toBe('LOCAL-B B same.txt\n');expect(store.tabs).toHaveLength(2);await left.save();await right.save();
 });
 it('D06 an edited preview is pinned before another preview can replace it',async()=>{
  await store.open(store.roots.roots[0],'a.txt');const original=store.active!;expect(original.pinned).toBe(false);const tr=original.buffer!.editor!.update({changes:{from:0,insert:'RETAINED '}});original.buffer!.acceptTransactions(tr.state,[tr]);expect(original.pinned).toBe(true);
  await store.open(store.roots.roots[0],'b.txt');expect(store.tabs).toContain(original);expect(original.buffer!.raw).toBe('RETAINED A a.txt\n');expect(store.active!.buffer!.raw).toBe('A b.txt\n');await original.buffer!.save();
 });
 it('D12 native closed documents reopen at original indices and stack order with fresh references',async()=>{
  for(const name of['a.txt','b.txt','c.txt','d.txt'])await store.open(store.roots.roots[0],name,true);const old=store.tabs[1].buffer!.file.ref.id;
  await store.close(store.tabs[1].id);await store.close(store.tabs[1].id);await store.restoreClosed();expect(names()).toEqual(['a.txt','c.txt','d.txt']);await store.restoreClosed();expect(names()).toEqual(['a.txt','b.txt','c.txt','d.txt']);expect(store.active!.buffer!.raw).toBe('A b.txt\n');expect(store.active!.buffer!.file.ref.id).not.toBe(old);
 });
 it('D12 native missing reopen keeps an identifiable error route at its original index',async()=>{
  for(const name of['a.txt','b.txt','c.txt'])await store.open(store.roots.roots[0],name,true);await store.close(store.tabs[1].id);unlinkSync(join(a,'b.txt'));await store.restoreClosed();expect(names()).toEqual(['a.txt','b.txt','c.txt']);expect(store.active!.route.relativePath).toBe('b.txt');expect(store.active!.error).toMatch(/MISSING/);expect(store.active!.buffer).toBeNull();
 });
 it('D13 exactly latest25 of26 native documents can be reopened',async()=>{
  const files=Array.from({length:26},(_,i)=>'file-'+i+'.txt');for(const name of files)await store.open(store.roots.roots[0],name,true);for(const name of files)await store.close(store.tabs.find(tab=>tab.route.relativePath===name)!.id);
  const restored=[];while(store.canRestoreClosed){await store.restoreClosed();restored.push(store.active!.route.relativePath);expect(store.active!.buffer!.raw).toBe('A '+restored.at(-1)+'\n')}
  expect(restored).toEqual(files.slice(1).reverse());expect(store.tabs).toHaveLength(25);expect(names()).not.toContain('file-0.txt');
 });
});
