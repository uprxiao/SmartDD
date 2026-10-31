// @vitest-environment jsdom
import {randomUUID} from 'node:crypto';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {FileDocument} from '@shared/files';
import {FileBuffer} from '@renderer/features/files/file-buffer';
import {FilePdfPreview} from '@renderer/features/files/pdf/preview';
import {FileTerminalContextProvider,TerminalReferenceTray,useFileTerminalContext} from '@renderer/features/files/terminal-context/context';
import {registerFileTerminal,type FileTerminalContextStore} from '@renderer/features/files/terminal-context/store';

const bridge=vi.hoisted(()=>({files:{} as Record<string,unknown>}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:bridge.files}}));
// Only PDF decoder/canvas are isolated. The mock spreads the real page event
// prop contract and children; comments, Provider, FileBuffer, Store and Tray
// execute unmodified production code. DOM geometry and PointerEvent are below.
vi.mock('@renderer/features/files/pdf/engine',()=>({createPdfSession:async()=>({ready:Promise.resolve({numPages:3,getPage:async()=>({getViewport:()=>({width:300,height:400})}),getOutline:async()=>null}),run:(value:unknown)=>Promise.resolve(value),destroy:async()=>undefined})}));
vi.mock('@renderer/features/files/pdf/page',()=>({PdfCanvasPage:({number,thumbnail,children,articleProps}:any)=><article {...articleProps} className="fw-pdf-page" data-page={number} data-testid={thumbnail?'pdf-thumb':'pdf-body'}><div className="textLayer"><span>合成 PDF 第一段</span><span> 第二段🙂</span></div>{children}</article>}));

const dispose:Array<()=>void>=[];
const originalRangeRects=Object.getOwnPropertyDescriptor(Range.prototype,'getClientRects');
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(yes=>{resolve=yes;});return{promise,resolve};}
function rect(left:number,top:number,width:number,height:number){return new DOMRect(left,top,width,height);}
beforeEach(()=>{
 vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});
 class ComponentPointerEvent extends MouseEvent {pointerId:number;constructor(type:string,options:PointerEventInit={}){super(type,options);this.pointerId=options.pointerId??1;}}
 vi.stubGlobal('PointerEvent',ComponentPointerEvent);
 vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(800);
 vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(600);
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.matches('article[data-testid="pdf-body"]'))return rect(100,50+(Number(this.dataset.page)-1)*650,400,600);
  return rect(0,0,1000,2000);
 });
 // jsdom does not lay out DOM ranges. The actual selection/range/node identity
 // remains real; only its two browser layout boxes are a declared fixture.
 Object.defineProperty(Range.prototype,'getClientRects',{configurable:true,value:function(){return [rect(150,200,100,20),rect(150,220,150,20)];}});
});
afterEach(()=>{cleanup();window.getSelection()?.removeAllRanges();for(const fn of dispose.splice(0).reverse())fn();vi.restoreAllMocks();if(originalRangeRects)Object.defineProperty(Range.prototype,'getClientRects',originalRangeRects);else Reflect.deleteProperty(Range.prototype,'getClientRects');vi.unstubAllGlobals();for(const key of Object.keys(bridge.files))delete bridge.files[key];});

async function mount(batch=false){
 const root:any={lease:randomUUID(),generation:1,source:'task-cwd',sourceId:'g051-task',path:'/tmp/g051-project',canonicalPath:'/tmp/g051-project',label:'Own G051 PDF root',identity:{device:'1',inode:'2'},capabilities:{pdfAnnotations:true,pdfAnnotationBatching:batch}};
 const file:FileDocument={ref:{id:randomUUID(),lease:root.lease,generation:1},documentKey:'local:1:3',name:'组件评论🙂.pdf',relativePath:'组件评论🙂.pdf',absolutePath:'/tmp/g051-project/组件评论🙂.pdf',writable:false,revision:{device:'1',inode:'3',size:64,hash:'a'.repeat(64),modifiedNs:'1',changedNs:'1'},content:{kind:'pdf',mime:'application/pdf'}as never};
 const opened:FileDocument[]=[];
 const fresh=():FileDocument=>{const copy={...file,ref:{...file.ref,id:randomUUID()}};opened.push(copy);return copy;};
 const api={open:vi.fn(async()=>fresh()),closeDocument:vi.fn(async()=>undefined),refresh:vi.fn(async()=>file),terminalBind:vi.fn(async()=>({id:randomUUID(),taskId:'g051-task',ptyId:'g051-pty',lease:root.lease,generation:1})),terminalRelease:vi.fn(async()=>undefined),terminalPrepare:vi.fn(async()=>({id:randomUUID(),relativePath:file.relativePath,revision:file.revision,identity:{device:'1',inode:'3'}})),terminalInsert:vi.fn(async(input:any)=>({operationId:input.operationId,state:'inserted' as const,characters:40,removed:0,replaced:0,truncated:0,stale:[],bracketed:false}))};
 Object.assign(bridge.files,api);
 const target={taskId:'g051-task',ptyId:'g051-pty',focus:vi.fn()};dispose.push(registerFileTerminal(target));
 const buffer=new FileBuffer(file,api as never,()=>undefined);dispose.push(()=>buffer.dispose());
 const workspace:any={treeRoot:root,snapshot:()=>0};let store:FileTerminalContextStore|null=null;
 function Probe(){store=useFileTerminalContext();return null;}
 const view=render(<FileTerminalContextProvider workspace={workspace}><Probe/><FilePdfPreview buffer={buffer} loadData={async()=>new Uint8Array([37,80,68,70])}/><TerminalReferenceTray/></FileTerminalContextProvider>);
 await waitFor(()=>expect(view.container.querySelector('article[data-testid="pdf-body"][data-page="2"]')).not.toBeNull());
 return{root,file,api,buffer,view,opened,fresh,target,get store(){if(!store)throw Error('Actual Provider store missing');return store;}};
}
function page(number=1){const el=document.querySelector<HTMLElement>(`article[data-testid="pdf-body"][data-page="${number}"]`);if(!el)throw Error('Missing mounted page '+number);return el;}
function mode(){fireEvent.click(screen.getByRole('button',{name:/^PDF 评论$/}));}
function region(number=1,from=[150,200],to=[300,500]){const el=page(number),top=(number-1)*650;fireEvent.pointerDown(el,{pointerId:1,button:0,clientX:from[0],clientY:from[1]+top});fireEvent.pointerMove(el,{pointerId:1,button:0,clientX:to[0],clientY:to[1]+top});fireEvent.pointerUp(el,{pointerId:1,button:0,clientX:to[0],clientY:to[1]+top});}
function draft(){return screen.getByRole('dialog',{name:'PDF 评论草稿'});}
function write(body:string){fireEvent.change(within(draft()).getByRole('textbox',{name:'PDF 评论内容'}),{target:{value:body}});}
function save(batch=false){fireEvent.click(within(draft()).getByRole('button',{name:batch?'添加评论':'加入终端引用'}));}
function tray(){return screen.getByRole('region',{name:'终端引用'});}
function batchPanel(){return screen.getByRole('region',{name:'PDF 评论批处理'});}
function insert(){fireEvent.click(within(tray()).getByRole('button',{name:'插入到终端输入'}));}
const anchor={x:.125,y:.25,width:.375,height:.5};

describe('G051 T12/T13 actual PDF comments to real reference tray (component boundary)',()=>{
 it('region pointer interaction retains page/anchor/body and requires explicit tray insertion',async()=>{
  const f=await mount();mode();region(2);expect(draft().textContent).toContain('第 2 页评论');write('核对第二页区域🙂');save();
  await waitFor(()=>expect(f.store.references).toHaveLength(1));
  expect(f.store.references[0].selection).toMatchObject({pdf:{page:2,anchor},text:'',comment:'核对第二页区域🙂'});
  expect(f.store.references[0].selection).not.toHaveProperty('range');expect(tray().textContent).toContain(f.file.relativePath);expect(tray().textContent).toContain('第 2 页');
  expect(within(tray()).getByText(/核对第二页区域🙂/).textContent).not.toMatch(/:L\d/);expect(f.api.terminalInsert).not.toHaveBeenCalled();
  insert();await waitFor(()=>expect(f.api.terminalInsert).toHaveBeenCalledTimes(1));
  expect(f.api.terminalInsert.mock.calls[0][0]).toMatchObject({kind:'context',references:[{kind:'pdf-comment',pdf:{page:2,anchor},text:'',comment:'核对第二页区域🙂'}]});
  expect(f.api.terminalInsert.mock.calls[0][0].references[0]).not.toHaveProperty('range');expect(f.buffer.file).toBe(f.file);expect(f.buffer.dirty).toBe(false);
 });

 it('real DOM text Range creates context, with selected text included only by the tray UI option',async()=>{
  const f=await mount();mode();const spans=page().querySelectorAll('.textLayer span');const range=document.createRange();range.setStart(spans[0].firstChild!,0);range.setEnd(spans[1].firstChild!,spans[1].textContent!.length);const selected=range.toString();window.getSelection()!.addRange(range);fireEvent.mouseUp(spans[1]);
  expect(within(draft()).getByText(selected)).toBeTruthy();write('请检查选中文字');save();await waitFor(()=>expect(f.store.references).toHaveLength(1));
  expect(f.store.references[0].selection).toMatchObject({pdf:{page:1,anchor:{x:.125,y:.25,width:.375,height:.066667}},text:selected,comment:'请检查选中文字'});
  expect(within(tray()).getByText(/请检查选中文字/).textContent).not.toContain(selected);fireEvent.click(within(tray()).getByRole('checkbox',{name:'包含选中文本'}));expect(tray().querySelector('pre')!.textContent).toContain(selected);
  expect(f.api.terminalInsert).not.toHaveBeenCalled();insert();await waitFor(()=>expect(f.api.terminalInsert).toHaveBeenCalledTimes(1));expect(f.api.terminalInsert.mock.calls[0][0]).toMatchObject({includeText:true,references:[{kind:'pdf-comment',text:selected,comment:'请检查选中文字'}]});
 });

 it('two page batch captures become visible atomically only after the second actual API capture completes',async()=>{
  const f=await mount(true);const gate=deferred<FileDocument>();f.api.open.mockImplementationOnce(async()=>f.fresh()).mockImplementationOnce(()=>gate.promise);
  mode();region(1);write('第一页评论');save(true);region(2,[200,260],[340,440]);write('第二页评论');save(true);
  expect(batchPanel().textContent).toContain('2 条评论');expect(f.api.open).not.toHaveBeenCalled();expect(f.store.references).toHaveLength(0);
  fireEvent.click(within(batchPanel()).getByRole('button',{name:'加入终端引用'}));await waitFor(()=>expect(f.api.open).toHaveBeenCalledTimes(2));expect(f.store.references).toHaveLength(0);expect(screen.queryByRole('region',{name:'终端引用'})).toBeNull();expect(f.api.terminalInsert).not.toHaveBeenCalled();
  await act(async()=>{gate.resolve(f.fresh());await gate.promise;});await waitFor(()=>expect(f.store.references).toHaveLength(2));expect(f.store.references.map(ref=>ref.selection)).toMatchObject([{pdf:{page:1,anchor},comment:'第一页评论'},{pdf:{page:2,anchor:{x:.25,y:.35,width:.35,height:.3}},comment:'第二页评论'}]);
  expect(batchPanel().textContent).not.toContain('2 条评论');expect(f.api.terminalInsert).not.toHaveBeenCalled();insert();await waitFor(()=>expect(f.api.terminalInsert).toHaveBeenCalledTimes(1));expect(f.api.terminalInsert.mock.calls[0][0].references.map((r:any)=>r.pdf.page)).toEqual([1,2]);
 });

 it('empty and explicitly cancelled drafts do not capture a file or deliver terminal input',async()=>{
  const f=await mount();mode();region(1,[150,200],[151,201]);expect(draft().textContent).toContain('第 1 页');expect(within(draft()).getByRole('button',{name:'加入终端引用'}).hasAttribute('disabled')).toBe(true);write('   ');expect(within(draft()).getByRole('button',{name:'加入终端引用'}).hasAttribute('disabled')).toBe(true);
  write('明确取消的评论');fireEvent.click(within(draft()).getByRole('button',{name:'取消 PDF 评论'}));expect(screen.queryByRole('dialog',{name:'PDF 评论草稿'})).toBeNull();expect(f.store.references).toHaveLength(0);expect(f.api.open).not.toHaveBeenCalled();expect(f.api.terminalInsert).not.toHaveBeenCalled();
 });

 it('failed addition retains the exact draft and succeeds only after an explicit retry',async()=>{
  const f=await mount();f.api.open.mockRejectedValueOnce(new Error('G051 explicit capture refusal'));mode();region(2);write('失败后必须保留🙂');save();
  await waitFor(()=>expect(screen.getAllByRole('status').some(el=>el.textContent?.includes('G051 explicit capture refusal'))).toBe(true));expect((within(draft()).getByRole('textbox',{name:'PDF 评论内容'})as HTMLTextAreaElement).value).toBe('失败后必须保留🙂');expect(f.store.references).toHaveLength(0);expect(f.api.open).toHaveBeenCalledTimes(1);expect(f.api.terminalInsert).not.toHaveBeenCalled();
  save();await waitFor(()=>expect(f.store.references).toHaveLength(1));expect(f.api.open).toHaveBeenCalledTimes(2);expect(f.store.references[0].selection).toMatchObject({pdf:{page:2,anchor},comment:'失败后必须保留🙂'});expect(screen.queryByRole('dialog',{name:'PDF 评论草稿'})).toBeNull();expect(f.api.terminalInsert).not.toHaveBeenCalled();
 });

 it('batch second-capture refusal rolls back the first reference while preserving comments for explicit retry',async()=>{
  const f=await mount(true);f.api.open.mockImplementationOnce(async()=>f.fresh()).mockRejectedValueOnce(new Error('G051 second capture refusal'));mode();region(1);write('保留评论一');save(true);region(2);write('保留评论二');save(true);fireEvent.click(within(batchPanel()).getByRole('button',{name:'加入终端引用'}));
  await waitFor(()=>expect(screen.getAllByRole('status').some(el=>el.textContent?.includes('G051 second capture refusal'))).toBe(true));expect(f.store.references).toHaveLength(0);expect(f.api.closeDocument).toHaveBeenCalledWith(f.opened[0].ref);expect(batchPanel().textContent).toContain('2 条评论');expect(screen.getAllByRole('button',{name:/^PDF 评论 [12]$/})).toHaveLength(2);expect(f.api.terminalInsert).not.toHaveBeenCalled();
  fireEvent.click(within(batchPanel()).getByRole('button',{name:'加入终端引用'}));await waitFor(()=>expect(f.store.references).toHaveLength(2));expect(f.api.open).toHaveBeenCalledTimes(4);expect(f.store.references.map(ref=>ref.selection?.comment)).toEqual(['保留评论一','保留评论二']);expect(f.api.terminalInsert).not.toHaveBeenCalled();
 });

 it('IME/229 Escape is ignored and ordinary dirty Escape preserves the active draft until explicit cancellation',async()=>{
  const f=await mount();mode();region();const textbox=within(draft()).getByRole('textbox',{name:'PDF 评论内容'});fireEvent.keyDown(textbox,{key:'Escape',keyCode:229});expect(draft()).toBeTruthy();write('不能静默丢弃的草稿');fireEvent.keyDown(textbox,{key:'Escape',isComposing:true});expect(screen.getAllByRole('status').some(el=>el.textContent?.includes('评论草稿已保留'))).toBe(false);fireEvent.keyDown(textbox,{key:'Escape'});expect(screen.getAllByRole('status').some(el=>el.textContent?.includes('评论草稿已保留'))).toBe(true);expect((textbox as HTMLTextAreaElement).value).toBe('不能静默丢弃的草稿');
  fireEvent.click(within(draft()).getByRole('button',{name:'取消 PDF 评论'}));fireEvent.keyDown(page(),{key:'Escape'});expect(screen.getByRole('button',{name:/^PDF 评论$/}).getAttribute('aria-pressed')).toBe('false');expect(f.api.open).not.toHaveBeenCalled();expect(f.api.terminalInsert).not.toHaveBeenCalled();
 });

 it('tray refusal retains the queued comment; explicit retry becomes unknown at the real acknowledgement deadline and duplicate click never resends',async()=>{
  const f=await mount();mode();region(2);write('投递失败保留');save();await waitFor(()=>expect(f.store.references).toHaveLength(1));f.api.terminalInsert.mockImplementationOnce(async(input:any)=>({operationId:input.operationId,state:'failed',message:'G051 explicit terminal refusal'}as never));
  insert();insert();await waitFor(()=>expect(f.store.state).toBe('failed'));expect(f.api.terminalInsert).toHaveBeenCalledTimes(1);expect(f.store.references).toHaveLength(1);expect(tray().textContent).toContain('G051 explicit terminal refusal');
  const pending=deferred<any>();f.api.terminalInsert.mockImplementationOnce(()=>pending.promise);insert();await waitFor(()=>expect(f.api.terminalInsert).toHaveBeenCalledTimes(2));await waitFor(()=>expect(f.store.state).toBe('unknown'),{timeout:2200});expect(tray().textContent).toContain('不会自动重发');expect(f.store.references).toHaveLength(1);const button=within(tray()).getByRole('button',{name:'插入到终端输入'});expect(button.hasAttribute('disabled')).toBe(true);fireEvent.click(button);expect(f.api.terminalInsert).toHaveBeenCalledTimes(2);
  const operationId=f.api.terminalInsert.mock.calls[1][0].operationId;await act(async()=>{pending.resolve({operationId,state:'inserted',characters:40,removed:0,replaced:0,truncated:0,stale:[],bracketed:false});await pending.promise;});await waitFor(()=>expect(f.store.references).toHaveLength(0));expect(f.api.terminalInsert).toHaveBeenCalledTimes(2);
 });
});
