// @vitest-environment jsdom
import{createHash,randomUUID}from'node:crypto';
import{EventEmitter}from'node:events';
import{chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync}from'node:fs';
import{join}from'node:path';
import{setTimeout as delay}from'node:timers/promises';
import{useSyncExternalStore}from'react';
import{act,cleanup,render,screen,waitFor}from'@testing-library/react';
import userEvent from'@testing-library/user-event';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import type{IpcMain,IpcMainInvokeEvent}from'electron';
import{FileService}from'@main/core/files/file-service';
import{FileRootsService}from'@main/core/files/roots';
import{FileRecoveryStore}from'@main/core/files/recovery-store';
import{NativeFileBroker}from'@main/core/files/native-broker';
import{createFileController}from'@main/core/files/controller';
import{registerRPCRouter}from'@shared/ipc/rpc';
import{FileBreadcrumb}from'./breadcrumb';
import{FileWorkspaceStore}from'./workspace-store';
import type{FileClient}from'./file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('./terminal-context/context',()=>({useFileTerminalContext:()=>null}));
// Unrelated OS application discovery is outside these breadcrumb-list cases.
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{applications:async()=>({id:'unrelated-app-fixture',apps:[]})}},events:{on:()=>()=>undefined}}));
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const until=async(fn:()=>boolean)=>{const end=Date.now()+7000;while(!fn()){if(Date.now()>end)throw Error('Breadcrumb native operation did not settle');await delay(5)}};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('E01/E02 actual registered RPC/native breadcrumb directories',()=>{
 let base:string,root:string,deep:string,denied:string,empty:string,files:Map<string,string>,broker:NativeFileBroker,service:FileService,store:FileWorkspaceStore,paths:string[],hold:string|null,slots:{path:string;before:string;after?:string;delivered:boolean;release():void}[];
 const parts=['层级01','same','same','层级04','same'],prefixes=parts.map((_,i)=>parts.slice(0,i+1).join('/'));
 beforeEach(async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});base=mkdtempSync('/private/tmp/willyou-breadcrumb-native-');root=join(base,'project');mkdirSync(root);mkdirSync(join(base,'userdata'));files=new Map();
  for(const[i,path]of prefixes.entries()){mkdirSync(join(root,path));files.set(path+'/level-'+(i+1)+'.txt','Marker '+path+'\n')}
  deep=prefixes.at(-1)!;empty=deep+'/empty';denied=deep+'/denied';mkdirSync(join(root,empty));mkdirSync(join(root,denied));files.set(deep+'/leaf.txt','Leaf content\n');files.set(denied+'/permission-child.txt','Permission child\n');for(const[path,text]of files)writeFileSync(join(root,path),text);
  broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);const projectId=randomUUID(),sourceId=randomUUID(),resolver={sources:()=>[{kind:'project-directory'as const,id:sourceId,path:root,label:'Own breadcrumb root',projectId}]};service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  const frame={processId:193,routingId:293},sender=Object.assign(new EventEmitter(),{id:93,mainFrame:frame,isDestroyed:()=>false,send:()=>{}}),event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===sender)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);
  paths=[];hold=null;slots=[];const api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>{const output=await handlers.get('files.'+key)!(event,...args);if(key==='list'){const path=(args[0]as{relativePath:string}).relativePath;paths.push(path);if(path===hold){let release!:()=>void;const gate=new Promise<void>(r=>release=r),slot={path,before:hash(output),after:undefined as string|undefined,delivered:false,release};slots.push(slot);await gate;slot.after=hash(output);slot.delivered=true;expect(slot.after).toBe(slot.before)}}return output}})as FileClient;
  store=new FileWorkspaceStore({kind:'project',projectId},api,null,null);await store.initialize();await store.open(store.treeRoot!,deep+'/leaf.txt',true);
  function View(){useSyncExternalStore(store.subscribe,store.snapshot);return <FileBreadcrumb store={store} run={work=>{void work()}}/>}render(<View/>);
 });
 afterEach(async()=>{cleanup();for(const slot of slots)slot.release();chmodSync(join(root,denied),0o700);store.dispose();service.closeOwner('93:193:293');await service.watcher.dispose();await until(()=>broker.activeProcesses===0);broker.dispose();for(const[path,text]of files)expect(readFileSync(join(root,path),'utf8')).toBe(text);vi.unstubAllGlobals();rmSync(base,{recursive:true,force:true})});
 const crumb=(path:string)=>document.querySelector<HTMLButtonElement>('.fw-breadcrumb button[title='+JSON.stringify(join(root,path))+']')!;
 const popup=()=>document.querySelector('.fw-breadcrumb-popup')!;
 const listed=(path:string)=>document.querySelector<HTMLButtonElement>('.fw-breadcrumb-popup .fw-breadcrumb-list button[title='+JSON.stringify(join(root,path))+']');
 it('E01 every one of five same-named ancestors lists and opens only its exact native-relative directory',async()=>{
  const user=userEvent.setup();
  for(const[i,path]of prefixes.entries()){await user.click(crumb(path));await waitFor(()=>expect(listed(path+'/level-'+(i+1)+'.txt')).not.toBeNull());expect(popup().querySelector('.fw-breadcrumb-location span')?.getAttribute('title')).toBe(join(root,path));for(const e of popup().querySelectorAll<HTMLButtonElement>('.fw-breadcrumb-list button'))expect(e.title.startsWith(join(root,path)+'/')).toBe(true);expect(paths).toContain(path);await user.keyboard('{Escape}')}
  await user.click(crumb(prefixes[2]));await user.click(await screen.findByRole('button',{name:'level-3.txt'}));await waitFor(()=>{expect(store.active?.route.relativePath).toBe(prefixes[2]+'/level-3.txt');expect(store.active?.buffer?.raw).toBe('Marker '+prefixes[2]+'\n')});
 });
 it('E02 genuine old native success cannot leak old entries into another ancestor after a loading popup closes',async()=>{
  const user=userEvent.setup();await user.click(crumb(deep));await waitFor(()=>expect(listed(deep+'/leaf.txt')).not.toBeNull());hold=empty;await user.click(listed(empty)!);await waitFor(()=>expect(slots).toHaveLength(1));expect(popup().querySelector('[role=status]')?.textContent).toContain('正在读取目录');expect(popup().querySelectorAll('.fw-breadcrumb-list button')).toHaveLength(0);await user.keyboard('{Escape}');await user.click(crumb(prefixes[1]));await waitFor(()=>expect(listed(prefixes[1]+'/level-2.txt')).not.toBeNull());const before=popup().textContent;await act(async()=>{slots[0].release();await until(()=>slots[0].delivered)});expect(popup().textContent).toBe(before);expect(slots[0].after).toBe(slots[0].before);
 });
 it('E02 empty and actual chmod permission errors stay distinct, and real retry removes the error after chmod recovery',async()=>{
  expect(process.getuid?.()).not.toBe(0);const user=userEvent.setup();await user.click(crumb(deep));await waitFor(()=>expect(listed(empty)).not.toBeNull());await user.click(listed(empty)!);await waitFor(()=>expect(popup().querySelector('[role=status]')?.textContent).toBe('此目录为空'));await user.keyboard('{Escape}');chmodSync(join(root,denied),0);await user.click(crumb(deep));await user.click(listed(denied)!);await waitFor(()=>expect(popup().querySelector('[role=alert]')?.textContent).toContain('PERMISSION'));expect(popup().querySelectorAll('.fw-breadcrumb-list button')).toHaveLength(0);chmodSync(join(root,denied),0o700);await user.click(screen.getByRole('button',{name:'重试'}));await waitFor(()=>expect(listed(denied+'/permission-child.txt')).not.toBeNull());expect(popup().querySelector('[role=alert]')).toBeNull();
 });
});
