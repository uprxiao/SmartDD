// @vitest-environment jsdom
import{randomUUID}from'node:crypto';
import{EventEmitter}from'node:events';
import{chmodSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync}from'node:fs';
import{join}from'node:path';
import{setTimeout as delay}from'node:timers/promises';
import{useSyncExternalStore}from'react';
import{EditorView}from'@codemirror/view';
import{EditorSelection}from'@codemirror/state';
import{isolateHistory}from'@codemirror/commands';
import{act,cleanup,fireEvent,render,screen}from'@testing-library/react';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import type{IpcMain,IpcMainInvokeEvent}from'electron';
import{FileService}from'@main/core/files/file-service';
import{FileRootsService}from'@main/core/files/roots';
import{FileRecoveryStore}from'@main/core/files/recovery-store';
import{NativeFileBroker}from'@main/core/files/native-broker';
import{createFileController}from'@main/core/files/controller';
import{registerRPCRouter}from'@shared/ipc/rpc';
import{FileWorkspaceStore}from'./workspace-store';
import{FileTextEditor}from'./text-editor';
import{fileFindState}from'./text-find-state';
import type{FileClient}from'./file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}},events:{on:()=>()=>undefined}}));
// Syntax/Markdown painting needs a real Worker/browser and is covered in A.
vi.mock('./code/editor',()=>({codeHighlight:()=>[]}));vi.mock('./markdown/editor',()=>({markdownEditor:()=>[]}));
const until=async(fn:()=>boolean)=>{const end=Date.now()+7000;while(!fn()){if(Date.now()>end)throw Error('Native line navigation did not settle');await delay(5)}};
const texts={'twenty.txt':Array.from({length:20},(_,i)=>'Line '+(i+1)+' 中文🙂').join('\r\n'),'empty.txt':'','other.txt':'Other\nTail','readonly.txt':'First\nSecond','long.txt':Array.from({length:300},(_,i)=>'Line '+(i+1)+' '+('long '.repeat(50))).join('\n')};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('R15/R16/R17 real editor→registered RPC→native line navigation',()=>{
 let base:string,root:string,store:FileWorkspaceStore,service:FileService,broker:NativeFileBroker,calls:string[],api:FileClient;
 beforeEach(async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});
  base=mkdtempSync('/private/tmp/willyou-line-native-');root=join(base,'project');mkdirSync(root);mkdirSync(join(base,'userdata'));for(const[name,text]of Object.entries(texts))writeFileSync(join(root,name),text);
  chmodSync(join(root,'readonly.txt'),0o444);
  const projectId=randomUUID(),sourceId=randomUUID(),resolver={sources:()=>[{kind:'project-directory'as const,id:sourceId,path:root,label:'Own line navigation source',projectId}]};broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  const frame={processId:194,routingId:294},sender=Object.assign(new EventEmitter(),{id:94,mainFrame:frame,isDestroyed:()=>false,send:()=>{}}),event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===sender)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);calls=[];api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>{calls.push(key);return handlers.get('files.'+key)!(event,...args)}})as FileClient;store=new FileWorkspaceStore({kind:'project',projectId},api,null,null);await store.initialize();
 });
 afterEach(async()=>{cleanup();store.dispose();service.closeOwner('94:194:294');await service.watcher.dispose();await until(()=>broker.activeProcesses===0);broker.dispose();for(const[name,text]of Object.entries(texts))expect(readFileSync(join(root,name),'utf8')).toBe(text);expect(calls.filter(name=>name==='search'||name==='startSearchSession')).toEqual([]);vi.unstubAllGlobals();rmSync(base,{recursive:true,force:true})});

 const editor=()=>EditorView.findFromDOM(document.querySelector('.cm-editor')as HTMLElement)!;
 const input=()=>screen.getByRole('textbox',{name:'行号'});
 const openLine=()=>fireEvent.click(screen.getByRole('button',{name:'跳转到行'}));
 const preview=(value:string)=>fireEvent.change(input(),{target:{value}});
 const line=()=>editor().state.doc.lineAt(editor().state.selection.main.head).number;
 async function open(name:string){await store.open(store.treeRoot!,name,true);store.active!.buffer!.pauseAutosave();function View(){useSyncExternalStore(store.subscribe,store.snapshot);const buffer=store.active?.buffer;return buffer?.editor?<FileTextEditor buffer={buffer} wrap={false}/>:null}return render(<View/>)}
 it('R15 original native CRLF/empty/read-only files use exact positive, negative and clamped lines without writes or rereads',async()=>{
  const mounted=await open('twenty.txt'),reads=calls.filter(x=>x==='read').length;
  for(const[value,expected]of[['1',1],['20',20],['21',20],['-1',20],['-20',1],['-21',1]]as const){openLine();preview(value);expect(line()).toBe(expected);fireEvent.keyDown(input(),{key:'Enter'});expect(editor().hasFocus).toBe(true)}
  expect(calls.filter(x=>x==='read')).toHaveLength(reads);expect(store.active!.buffer!.dirty).toBe(false);mounted.unmount();
  for(const[name,target,expected]of[['empty.txt','1',1],['readonly.txt','-1',2]]as const){const view=await open(name);if(name==='readonly.txt')expect(store.active!.buffer!.editable).toBe(false);openLine();preview(target);fireEvent.keyDown(input(),{key:'Enter'});expect(line()).toBe(expected);expect(store.active!.buffer!.dirty).toBe(false);view.unmount()}
  expect(calls.filter(x=>x==='save'||x==='checkpoint')).toEqual([]);
 });
 it('R16 invalid inputs remain focused and visible without navigating; trimmed safe integer commits',async()=>{
  await open('twenty.txt');act(()=>editor().dispatch({selection:{anchor:7}}));openLine();
  for(const value of['0','1.5','abc','9007199254740992',' ']){preview(value);fireEvent.keyDown(input(),{key:'Enter'});expect(input().getAttribute('aria-invalid')).toBe('true');expect(screen.getByRole('alert').textContent).toMatch(/整数/);expect(document.activeElement).toBe(input());expect(editor().state.selection.main.head).toBe(7)}
  preview(' 7 ');expect(input().getAttribute('aria-invalid')).toBe('false');fireEvent.keyDown(input(),{key:'Enter'});expect(line()).toBe(7);expect(editor().hasFocus).toBe(true);expect(calls.filter(x=>x==='save'||x==='checkpoint')).toEqual([]);
 });
 it('R17 full selection and both scroll axes restore on Escape/close, Enter commits and another native file never receives old preview state',async()=>{
  await open('long.txt');const first=store.active!.buffer!;act(()=>editor().dispatch({selection:EditorSelection.single(1000,990)}));editor().scrollDOM.scrollTop=321;editor().scrollDOM.scrollLeft=47;const original=editor().state.selection;
  for(const close of['Escape','button']){openLine();preview('200');editor().scrollDOM.scrollTop=500;editor().scrollDOM.scrollLeft=0;if(close==='Escape')fireEvent.keyDown(input(),{key:'Escape'});else fireEvent.click(screen.getByRole('button',{name:'关闭跳行'}));expect(editor().state.selection.eq(original)).toBe(true);expect(editor().scrollDOM.scrollTop).toBe(321);expect(editor().scrollDOM.scrollLeft).toBe(47)}
  openLine();preview('200');fireEvent.keyDown(input(),{key:'Enter'});const committed=first.editor!.selection;openLine();preview('290');await act(async()=>{await store.open(store.treeRoot!,'other.txt',true)});expect(screen.queryByRole('textbox',{name:'行号'})).toBeNull();expect(editor().state.doc.toString()).toBe(texts['other.txt']);expect(editor().state.selection.main.head).toBe(0);expect(first.editor!.selection.eq(committed)).toBe(true);expect(first.dirty).toBe(false);expect(calls.filter(x=>x==='save'||x==='checkpoint')).toEqual([]);
 });
});
