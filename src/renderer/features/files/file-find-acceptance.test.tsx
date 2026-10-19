// @vitest-environment jsdom
import{randomUUID}from'node:crypto';
import{EventEmitter}from'node:events';
import{mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync}from'node:fs';
import{join}from'node:path';
import{setTimeout as delay}from'node:timers/promises';
import{useSyncExternalStore}from'react';
import{EditorView}from'@codemirror/view';
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
const until=async(fn:()=>boolean)=>{const end=Date.now()+7000;while(!fn()){if(Date.now()>end)throw Error('Native file Find did not settle');await delay(5)}};
const texts={'plain.txt':'First needle\r\nSecond NEEDLE\r\nThird needle\r\n','document.md':'# Find\n\nFirst needle.\n\nSecond NEEDLE.\n\nThird needle.\n',...Object.fromEntries([998,999,1000].map(n=>['count-'+n+'.txt','word\n'.repeat(n)]))};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('R13/R14/R19 real editor→registered RPC→native file Find',()=>{
 let base:string,root:string,store:FileWorkspaceStore,service:FileService,broker:NativeFileBroker,calls:string[],api:FileClient;
 beforeEach(async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});
  base=mkdtempSync('/private/tmp/willyou-find-native-');root=join(base,'project');mkdirSync(root);mkdirSync(join(base,'userdata'));for(const[name,text]of Object.entries(texts))writeFileSync(join(root,name),text);
  const projectId=randomUUID(),sourceId=randomUUID(),resolver={sources:()=>[{kind:'project-directory'as const,id:sourceId,path:root,label:'Own file Find source',projectId}]};broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  const frame={processId:194,routingId:294},sender=Object.assign(new EventEmitter(),{id:94,mainFrame:frame,isDestroyed:()=>false,send:()=>{}}),event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===sender)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);calls=[];api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>{calls.push(key);return handlers.get('files.'+key)!(event,...args)}})as FileClient;store=new FileWorkspaceStore({kind:'project',projectId},api,null,null);await store.initialize();
 });
 afterEach(async()=>{cleanup();store.dispose();service.closeOwner('94:194:294');await service.watcher.dispose();await until(()=>broker.activeProcesses===0);broker.dispose();for(const[name,text]of Object.entries(texts))expect(readFileSync(join(root,name),'utf8')).toBe(text);expect(calls.filter(name=>name==='search'||name==='startSearchSession')).toEqual([]);vi.unstubAllGlobals();rmSync(base,{recursive:true,force:true})});
 const editor=()=>EditorView.findFromDOM(document.querySelector('.cm-editor')as HTMLElement)!;
 const count=()=>document.querySelector('.fw-find>span')?.textContent;
 const button=(name:string)=>screen.getByRole('button',{name});
 const find=(query:string)=>{fireEvent.keyDown(editor().contentDOM,{key:'f',code:'KeyF',metaKey:true});fireEvent.change(screen.getByRole('textbox',{name:'在文件中查找'}),{target:{value:query}})};
 async function open(name:string,markdown=false){await store.open(store.treeRoot!,name,true);store.active!.buffer!.pauseAutosave();function View(){useSyncExternalStore(store.subscribe,store.snapshot);return <FileTextEditor buffer={store.active!.buffer!} wrap={false} markdown={markdown}/>}return render(<View/>)}
 it('R13 real disk source and Markdown modes use current-file literal ranges, highlight selection, no-results and close/reopen only',async()=>{
  for(const[name,markdown]of[['plain.txt',false],['document.md',true],['document.md',false]]as const){const mounted=await open(name,markdown);find('needle');expect(count()).toBe('1/3');expect(editor().state.sliceDoc(editor().state.selection.main.from,editor().state.selection.main.to)).toBe('needle');fireEvent.click(button('下一个匹配'));expect(count()).toBe('2/3');expect(editor().state.sliceDoc(editor().state.selection.main.from,editor().state.selection.main.to)).toBe('NEEDLE');fireEvent.click(button('上一个匹配'));expect(count()).toBe('1/3');find('missing');expect(count()).toBe('0/0');expect((button('下一个匹配')as HTMLButtonElement).disabled).toBe(true);fireEvent.click(button('关闭查找'));expect(editor().hasFocus).toBe(true);expect(editor().state.field(fileFindState).matches).toEqual([]);find('needle');expect(count()).toBe('1/3');expect(store.active!.buffer!.dirty).toBe(false);mounted.unmount()}
 });
 it('R14 actual native draft contains edited source while Find recounts the dirty state and undo, never old disk bytes',async()=>{
  await open('plain.txt');find('needle');const buffer=store.active!.buffer!,reads=calls.filter(x=>x==='read').length,original=editor().state.doc.toString(),added=original+'Added needle\n';act(()=>editor().dispatch({changes:{from:0,to:editor().state.doc.length,insert:added},selection:{anchor:added.length},userEvent:'input.type',annotations:isolateHistory.of('full')}));expect(count()).toBe('1/4');expect(editor().state.selection.main.head).toBe(added.length);const checkpoint=await buffer.checkpoint();expect(checkpoint).not.toBeNull();expect(Buffer.from((await api.readDraft(buffer.file.ref,checkpoint!.draftId)).base64,'base64').toString()).toBe(buffer.raw);expect(buffer.dirty).toBe(true);
  act(()=>editor().dispatch({changes:{from:0,to:editor().state.doc.length,insert:'none\n'},userEvent:'delete.selection',annotations:isolateHistory.of('full')}));expect(count()).toBe('0/0');fireEvent.click(button('撤销'));expect(count()).toBe('1/4');fireEvent.click(button('撤销'));expect(count()).toBe('1/3');expect(buffer.raw).toBe(texts['plain.txt']);expect(calls.filter(x=>x==='read')).toHaveLength(reads);
 });
 it('R19 native998/999/1000 content has exact limits, valid current ranges and recomputes after removing the last extra match',async()=>{
  for(const total of[998,999,1000]){const mounted=await open('count-'+total+'.txt');find('word');const visible=Math.min(total,999),suffix=total>999?'+':'';expect(count()).toBe(`1/${visible}${suffix}`);fireEvent.click(button('上一个匹配'));expect(count()).toBe(`${visible}/${visible}${suffix}`);expect(editor().state.selection.main.from).toBe((visible-1)*5);fireEvent.click(button('下一个匹配'));expect(count()).toBe(`1/${visible}${suffix}`);if(total===1000){act(()=>editor().dispatch({changes:{from:4995,to:5000},userEvent:'delete.selection'}));expect(count()).toBe('1/999');fireEvent.click(button('撤销'));expect(count()).toBe('1/999+')}mounted.unmount()}
 });
 it('R20 Markdown/source/plain host exposes only query, previous/next, count and close; regex-like text stays literal',async()=>{
  for(const[name,markdown]of[['plain.txt',false],['document.md',true],['document.md',false]]as const){const mounted=await open(name,markdown);find('needle');const bar=document.querySelector('.fw-find')!;expect([...bar.querySelectorAll('button')].map(e=>e.getAttribute('aria-label'))).toEqual(['上一个匹配','下一个匹配','关闭查找']);expect(bar.querySelectorAll('input')).toHaveLength(1);expect(bar.querySelectorAll('select,textarea,[role=checkbox],[role=switch]')).toHaveLength(0);expect(count()).toBe('1/3');find('n.edle');expect(count()).toBe('0/0');find('needle');expect(count()).toBe('1/3');fireEvent.click(button('关闭查找'));expect(document.querySelector('.fw-find')).toBeNull();expect(store.active!.buffer!.dirty).toBe(false);mounted.unmount()}
  expect(calls.filter(x=>x==='save'||x==='checkpoint')).toEqual([]);
 });

});
