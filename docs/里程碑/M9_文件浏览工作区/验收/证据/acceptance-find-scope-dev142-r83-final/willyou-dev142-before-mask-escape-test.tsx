// @vitest-environment jsdom
import{randomUUID}from'node:crypto';
import{EventEmitter}from'node:events';
import{chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync}from'node:fs';
import{dirname,join}from'node:path';
import{setTimeout as delay}from'node:timers/promises';
import{useState,useSyncExternalStore}from'react';
import{EditorView}from'@codemirror/view';
import{isolateHistory}from'@codemirror/commands';
import{act,cleanup,fireEvent,render,screen}from'@testing-library/react';
import{afterEach,beforeEach,describe,expect,it,vi}from'vitest';
import type{IpcMain,IpcMainInvokeEvent}from'electron';
import{FileService}from'@main/core/files/file-service';
import{FileRootsService}from'@main/core/files/roots';
import{FileRecoveryStore}from'@main/core/files/recovery-store';
import{NativeFileBroker,type BrokerOptions}from'@main/core/files/native-broker';
import{createFileController}from'@main/core/files/controller';
import{registerRPCRouter}from'@shared/ipc/rpc';
import{FileWorkspaceStore}from'./workspace-store';
import{FileTextEditor}from'./text-editor';
import{FileContentSearch}from'./search-panel';
import{fileSearchEvent}from'@shared/events';
import type{FileSearchRequest,FileSearchResult,FileSearchProgress}from'@shared/files';
import type{FileClient}from'./file-buffer';
vi.mock('electron',()=>({BrowserWindow:{},dialog:{},shell:{}}));
const transport=vi.hoisted(()=>({invoke:null as null|((method:string,...args:unknown[])=>Promise<unknown>),on:null as null|((name:string,callback:(value:unknown)=>void)=>()=>void)}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:new Proxy({},{get:(_t,key)=> (...args:unknown[])=>transport.invoke!(String(key),...args)})},events:{on:(event:{name:string},callback:(value:unknown)=>void)=>transport.on!(event.name,callback)}}));
// Syntax/Markdown painting needs a real Worker/browser and is covered in A.
vi.mock('./code/editor',()=>({codeHighlight:()=>[]}));vi.mock('./markdown/editor',()=>({markdownEditor:()=>[]}));
const originalScrollIntoView=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'scrollIntoView');
const until=async(fn:()=>boolean)=>{const end=Date.now()+7000;while(!fn()){if(Date.now()>end)throw Error('Native file Find did not settle');await delay(5)}};
const texts={'甲/同名.ts':'\ufeff开头😀\r\n中文🙂 before 定位Token after\r\nTail甲','乙/同名.ts':'\ufeff首行乙\r\n前缀😀🙂 定位Token 末尾\r\nTail乙','visible.txt':'coverageToken visible\n','blocked.txt':'coverageToken blocked\n','denied/inside.txt':'coverageToken directory\n','change.txt':'changeToken original\n','delete.txt':'deleteToken original\n'};
describe.skipIf(process.platform!=='darwin'||!process.env.SMARTDD_M9_FILE_BROKER)('R05/R06/R12 content dialog→registered RPC→native filesystem',()=>{
 let base:string,root:string,expected:Map<string,string>,notifications:FileSearchProgress[],replay:((value:FileSearchProgress)=>void),responses:FileSearchResult[],requests:FileSearchRequest[],store:FileWorkspaceStore,service:FileService,broker:NativeFileBroker,calls:string[],api:FileClient;
 beforeEach(async()=>{
  Object.defineProperty(HTMLElement.prototype,'scrollIntoView',{configurable:true,value:()=>undefined});
  vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});Object.defineProperties(Range.prototype,{getClientRects:{configurable:true,value:()=>[]},getBoundingClientRect:{configurable:true,value:()=>new DOMRect()}});
  base=mkdtempSync('/private/tmp/willyou-content-native-');root=join(base,'project');mkdirSync(root);mkdirSync(join(base,'userdata'));expected=new Map(Object.entries(texts));responses=[];requests=[];notifications=[];for(const[name,text]of expected){mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),text)}writeFileSync(join(base,'outside.txt'),'outsideOnlyToken duringToken');symlinkSync(join(base,'outside.txt'),join(root,'outside-link.txt'));
  const projectId=randomUUID(),sourceId=randomUUID(),resolver={sources:()=>[{kind:'project-directory'as const,id:sourceId,path:root,label:'Own content search source',projectId}]};broker=new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);service=new FileService(new FileRootsService(resolver,broker),broker,new FileRecoveryStore(broker,join(base,'userdata'),resolver));
  const frame={processId:194,routingId:294},sender=Object.assign(new EventEmitter(),{id:94,mainFrame:frame,isDestroyed:()=>false,send:(channel:string,value:unknown)=>{if(channel===fileSearchEvent.name)notifications.push(structuredClone(value)as FileSearchProgress);sender.emit(channel,structuredClone(value))}}),event={sender,senderFrame:frame}as unknown as IpcMainInvokeEvent,handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();registerRPCRouter({files:createFileController(service,candidate=>(candidate.sender as unknown)===sender)},{handle:(name:string,fn:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,fn)}as unknown as IpcMain);calls=[];api=new Proxy({},{get:(_target,key:string)=>async(...args:unknown[])=>{calls.push(key);if(key==='startSearchSession')requests.push(args[0]as FileSearchRequest);const result=await handlers.get('files.'+key)!(event,...args);if(key==='startSearchSession')responses.push(result as FileSearchResult);return result}})as FileClient;replay=value=>{sender.emit(fileSearchEvent.name,structuredClone(value))};transport.invoke=(method,...args)=>(api as unknown as Record<string,(...a:unknown[])=>Promise<unknown>>)[method](...args);transport.on=(name,callback)=>{sender.on(name,callback);return()=>{sender.off(name,callback)}};store=new FileWorkspaceStore({kind:'project',projectId},api,null,null);await store.initialize();
 });
 afterEach(async()=>{cleanup();store.dispose();service.closeOwner('94:194:294');await service.watcher.dispose();await until(()=>broker.activeProcesses===0);broker.dispose();chmodSync(join(root,'blocked.txt'),0o644);chmodSync(join(root,'denied'),0o755);for(const[name,text]of expected)expect(readFileSync(join(root,name),'utf8')).toBe(text);expect(readFileSync(join(base,'outside.txt'),'utf8')).toBe('outsideOnlyToken duringToken');if(originalScrollIntoView)Object.defineProperty(HTMLElement.prototype,'scrollIntoView',originalScrollIntoView);else Reflect.deleteProperty(HTMLElement.prototype,'scrollIntoView');vi.unstubAllGlobals();rmSync(base,{recursive:true,force:true})});

 function view(){function Host(){useSyncExternalStore(store.subscribe,store.snapshot);const[shown,setShown]=useState(true),buffer=store.active?.buffer;return <>{shown&&<FileContentSearch store={store} onClose={()=>setShown(false)}/>} {buffer?.editor&&<FileTextEditor buffer={buffer} wrap={false}/>}</>}return render(<Host/>)}
 const query=()=>screen.getByRole('textbox',{name:'全文搜索内容'}),mask=()=>screen.getByRole('combobox',{name:'搜索文件掩码'}),rows=()=>[...document.querySelectorAll<HTMLElement>('.fw-search-results [role=option]')];
 async function search(value:string,pattern=''){const before=requests.length;fireEvent.change(mask(),{target:{value:pattern}});fireEvent.change(query(),{target:{value}});await until(()=>requests.length>before&&responses.at(-1)?.id===requests.at(-1)?.id&&requests.at(-1)?.query===value);await act(async()=>{await delay(1)})}
 it.each([99,100,101])('R05 real %i rows have exact UI/native cap and no101st streamed row',async total=>{
  writeFileSync(join(root,'cap.txt'),'capToken\n'.repeat(total));expected.set('cap.txt','capToken\n'.repeat(total));view();await search('capToken','cap.txt');expect(rows()).toHaveLength(Math.min(total,100));expect(responses.at(-1)!.limited).toBe(total>100);expect(document.querySelector('.fw-search-dialog')!.textContent!.includes('显示前 100')).toBe(total>100);expect(responses.at(-1)!.rows).toHaveLength(Math.min(total,100));expect(calls.filter(x=>x==='save')).toEqual([]);
 });
 it('R06 same basenames in unexpanded CJK directories open by click/Enter at exact emoji/BOM/CRLF-aware source range',async()=>{
  for(const method of['click','Enter']){const mounted=view();await search('定位Token','*.ts');expect(rows()).toHaveLength(2);const index=method==='click'?0:1,row=responses.at(-1)!.rows[index],selected=rows()[index];expect(selected.textContent).toContain(row.relativePath);expect(new Set(responses.at(-1)!.rows.map(r=>r.relativePath)).size).toBe(2);if(method==='click')fireEvent.click(selected);else{fireEvent.keyDown(query(),{key:'ArrowDown'});fireEvent.keyDown(query(),{key:'Enter'})}await until(()=>!document.querySelector('[role=dialog]')&&!!document.querySelector('.cm-editor'));const editor=EditorView.findFromDOM(document.querySelector('.cm-editor')as HTMLElement)!;await until(()=>editor.state.sliceDoc(editor.state.selection.main.from,editor.state.selection.main.to)==='定位Token');expect(store.active!.route.relativePath).toBe(row.relativePath);const raw=expected.get(row.relativePath)!,normalized=raw.replace(/^\ufeff/,'').replace(/\r\n?/g,'\n');expect(editor.state.doc.toString()).toBe(normalized);expect(editor.state.selection.main.from).toBe(normalized.indexOf('定位Token'));expect(row.line).toBe(2);expect(store.active!.buffer!.dirty).toBe(false);mounted.unmount()}
 });
 it('R12 native permission issues and outside symlinks are bounded; changed/deleted hits are revalidated instead of locating obsolete bytes',async()=>{
  chmodSync(join(root,'blocked.txt'),0);chmodSync(join(root,'denied'),0);const mounted=view();await search('coverageToken');expect(responses.at(-1)!.rows.map(r=>r.relativePath)).toEqual(['visible.txt']);expect(responses.at(-1)!.skipped).toBeGreaterThanOrEqual(2);expect(responses.at(-1)!.issues.map(i=>i.path)).toEqual(expect.arrayContaining(['blocked.txt','denied']));expect(document.querySelector('.fw-search-dialog')!.textContent).toContain('项未搜索');await search('outsideOnlyToken duringToken');expect(rows()).toHaveLength(0);expect(responses.at(-1)!.rows).toEqual([]);
  await search('changeToken');const old=responses.at(-1)!.rows[0];writeFileSync(join(root,'change.txt'),'NEW independent source\n');expected.set('change.txt','NEW independent source\n');fireEvent.click(rows()[0]);await until(()=>!!screen.queryByRole('alert'));expect(screen.getByRole('alert').textContent).toContain('搜索后已改变');expect(document.querySelector('[role=dialog]')).not.toBeNull();expect(store.active!.buffer!.raw).toBe('NEW independent source\n');expect(store.active!.buffer!.file.revision.hash).not.toBe(old.revision.hash);await search('deleteToken');unlinkSync(join(root,'delete.txt'));expected.delete('delete.txt');fireEvent.click(rows()[0]);await until(()=>!!screen.queryByRole('alert'));expect(screen.getByRole('alert').textContent).toContain('无法作为文本定位');expect(document.querySelector('[role=dialog]')).not.toBeNull();expect(existsSync(join(root,'delete.txt'))).toBe(false);expect(calls.filter(x=>x==='save')).toEqual([]);mounted.unmount();
 });
 it('R12 real files changed/deleted/replaced by an outside symlink after native enumeration are read afresh or reported, never searched through the alias',async()=>{
  for(const name of['during-change.txt','during-delete.txt','during-swap.txt']){writeFileSync(join(root,name),'duringToken old\n');expected.set(name,'duringToken old\n')}
  let mutate=true;const original=broker.request.bind(broker);vi.spyOn(broker,'request').mockImplementation(async<T,>(input:Record<string,unknown>,options:BrokerOptions={})=>{const result=await original<T>(input,options);if(mutate&&input.operation==='walk'){mutate=false;writeFileSync(join(root,'during-change.txt'),'中文😀 duringToken current\n');expected.set('during-change.txt','中文😀 duringToken current\n');unlinkSync(join(root,'during-delete.txt'));expected.delete('during-delete.txt');unlinkSync(join(root,'during-swap.txt'));symlinkSync(join(base,'outside.txt'),join(root,'during-swap.txt'));expected.delete('during-swap.txt')}return result});
  view();await search('duringToken');const result=responses.at(-1)!;expect(result.rows.map(r=>[r.relativePath,r.text])).toEqual([['during-change.txt','中文😀 duringToken current']]);expect(result.skipped).toBe(2);expect(result.issues.map(x=>x.path)).toEqual(expect.arrayContaining(['during-delete.txt','during-swap.txt']));expect(document.querySelector('.fw-search-dialog')!.textContent).toContain('2 项未搜索');expect(readFileSync(join(base,'outside.txt'),'utf8')).toBe('outsideOnlyToken duringToken');
 });

 it('R05 a genuine current-session row delivered after the authoritative native result never duplicates its completed UI rows',async()=>{
  writeFileSync(join(root,'late.txt'),'lateToken\n'.repeat(99));expected.set('late.txt','lateToken\n'.repeat(99));view();await search('lateToken','late.txt');expect(rows()).toHaveLength(99);const result=responses.at(-1)!,event=notifications.find(x=>x.id===result.id)!;expect(event).toBeTruthy();await act(async()=>{replay(event);await Promise.resolve()});expect(rows()).toHaveLength(99);expect(new Set(rows().map(x=>x.textContent)).size).toBe(99);
 });

 it('R04 actual native match/done/error states mark busy and wait exactly500ms before the loading indicator',async()=>{
  const queued:FileSearchProgress[]=[],originalOn=transport.on!,originalInvoke=transport.invoke!;let receive:((value:unknown)=>void)|undefined,release!:()=>void;
  const gate=new Promise<void>(done=>release=done);transport.on=(name,callback)=>originalOn(name,value=>{if(name===fileSearchEvent.name){queued.push(structuredClone(value)as FileSearchProgress);receive=callback}else callback(value)});
  transport.invoke=async(method,...args)=>{const result=await originalInvoke(method,...args);if(method==='startSearchSession')await gate;return result};
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
  try{
   view();const busy=()=>document.querySelector('[aria-label="全文搜索结果"]')!.getAttribute('aria-busy');expect(busy()).toBe('false');fireEvent.change(query(),{target:{value:'定位Token'}});expect(busy()).toBe('true');
   await act(async()=>vi.advanceTimersByTimeAsync(49));expect(requests).toHaveLength(0);await act(async()=>vi.advanceTimersByTimeAsync(1));await until(()=>responses.length===1&&queued.length===2);
   await act(async()=>vi.advanceTimersByTimeAsync(449));expect(screen.queryByText('正在搜索…')).toBeNull();expect(rows()).toHaveLength(0);expect(busy()).toBe('true');await act(async()=>vi.advanceTimersByTimeAsync(1));expect(screen.getByText('正在搜索…')).toBeTruthy();
   await act(async()=>receive!(queued[0]));expect(rows()).toHaveLength(1);expect(busy()).toBe('true');await act(async()=>receive!(queued[1]));expect(rows()).toHaveLength(2);
   await act(async()=>{release();await Promise.resolve()});await until(()=>busy()==='false');expect(rows()).toHaveLength(2);expect(screen.queryByText('正在搜索…')).toBeNull();
   chmodSync(root,0);fireEvent.change(query(),{target:{value:'real permission failure'}});await act(async()=>vi.advanceTimersByTimeAsync(50));await until(()=>!!screen.queryByRole('alert'));expect(screen.getByRole('alert').textContent).toMatch(/PERMISSION|Permission denied|权限/);expect(screen.queryByText('没有匹配结果')).toBeNull();expect(busy()).toBe('false');
  }finally{release();chmodSync(root,0o755);vi.useRealTimers()}
 });

 it('R09 plain arrows traverse results then history and restore the unsent draft before Enter opens; Escape closes',async()=>{
  let mounted=view();await search('history-one');fireEvent.keyDown(query(),{key:'Enter'});await search('history-two');fireEvent.keyDown(query(),{key:'Enter'});await search('定位Token','*.ts');
  const selected=()=>rows().findIndex(row=>row.getAttribute('aria-selected')==='true');fireEvent.keyDown(query(),{key:'ArrowDown'});expect(selected()).toBe(1);fireEvent.keyDown(query(),{key:'ArrowUp'});expect(selected()).toBe(0);
  const count=requests.length;fireEvent.keyDown(query(),{key:'ArrowUp'});expect((query()as HTMLInputElement).value).toBe('history-two');fireEvent.keyDown(query(),{key:'ArrowUp'});expect((query()as HTMLInputElement).value).toBe('history-one');fireEvent.keyDown(query(),{key:'ArrowDown'});expect((query()as HTMLInputElement).value).toBe('history-two');fireEvent.keyDown(query(),{key:'ArrowDown'});expect((query()as HTMLInputElement).value).toBe('定位Token');
  await until(()=>requests.length>count&&responses.at(-1)?.id===requests.at(-1)?.id&&requests.at(-1)?.query==='定位Token');await act(async()=>delay(1));expect(rows()).toHaveLength(2);fireEvent.keyDown(query(),{key:'Enter'});await until(()=>!document.querySelector('[role=dialog]'));const editor=store.active!.buffer!.editor!;expect(editor.sliceDoc(editor.selection.main.from,editor.selection.main.to)).toBe('定位Token');mounted.unmount();
  mounted=view();fireEvent.keyDown(query(),{key:'Escape'});await until(()=>!document.querySelector('[role=dialog]'));mounted.unmount();
 });

 it('R10 mask history arrows stay outside result navigation and Enter remembers only the chosen mask then focuses query',async()=>{
  view();await search('定位Token','*.ts');fireEvent.keyDown(query(),{key:'ArrowDown'});expect(rows()[1].getAttribute('aria-selected')).toBe('true');(mask()as HTMLInputElement).focus();
  const bubbled=vi.fn();document.addEventListener('keydown',bubbled);try{fireEvent.keyDown(mask(),{key:'ArrowDown'});fireEvent.keyDown(mask(),{key:'ArrowUp'});expect(bubbled).not.toHaveBeenCalled();expect(rows()[1].getAttribute('aria-selected')).toBe('true');fireEvent.keyDown(mask(),{key:'Enter'});expect(document.activeElement).toBe(query());expect(document.querySelector('[role=dialog]')).not.toBeNull();expect(store.active).toBeFalsy();expect([...document.querySelectorAll('#m9-mask-history option')].map(x=>x.getAttribute('value'))).toContain('*.ts')}finally{document.removeEventListener('keydown',bubbled)}
  await search('定位Token','  *.txt  ');fireEvent.keyDown(mask(),{key:'Enter'});expect(document.activeElement).toBe(query());expect([...document.querySelectorAll('#m9-mask-history option')].map(x=>x.getAttribute('value'))).toEqual(['*.txt','*.ts']);expect(store.active).toBeFalsy();
  await search('定位Token','');(mask()as HTMLInputElement).focus();fireEvent.keyDown(mask(),{key:'ArrowDown'});expect((mask()as HTMLInputElement).value).toBe('*.txt');fireEvent.keyDown(mask(),{key:'ArrowDown'});expect((mask()as HTMLInputElement).value).toBe('*.ts');fireEvent.keyDown(mask(),{key:'ArrowUp'});expect((mask()as HTMLInputElement).value).toBe('*.txt');fireEvent.keyDown(mask(),{key:'Enter'});expect(document.activeElement).toBe(query());expect(document.querySelector('[role=dialog]')).not.toBeNull();expect(store.active).toBeFalsy();
 });

});
