// @vitest-environment jsdom
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {FileBuffer} from '@renderer/features/files/file-buffer';
import {FilePdfPreview} from '@renderer/features/files/pdf/preview';
import {FileTerminalContextProvider} from '@renderer/features/files/terminal-context/context';
import {disposers,fixture} from './fixture';
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
// Explicit component boundary: real FileBuffer/provider/viewer, isolated decoder and canvas only.
vi.mock('@renderer/features/files/pdf/engine',()=>({createPdfSession:async()=>({ready:Promise.resolve({numPages:3,getPage:async()=>({getViewport:()=>({width:612,height:792})}),getOutline:async()=>null}),run:(value:unknown)=>Promise.resolve(value),destroy:async()=>undefined})}));
vi.mock('@renderer/features/files/pdf/page',()=>({PdfCanvasPage:({number,thumbnail,children,onPointerDown,onPointerMove,onPointerUp,onMouseUp}:any)=><article data-page={number} data-testid={thumbnail?'pdf-thumb':'pdf-body'} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onMouseUp={onMouseUp}><div className="textLayer"><span>Own PDF selectable text</span></div>{children}</article>}));
beforeEach(()=>{vi.stubGlobal('ResizeObserver',class{observe(){}unobserve(){}disconnect(){}});vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(800);vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(600);HTMLElement.prototype.scrollIntoView??=()=>{};});
afterEach(()=>{cleanup();for(const d of disposers.splice(0).reverse())d();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(enabled:boolean,batch:boolean,review=false){const f=fixture();f.root.capabilities={pdfAnnotations:enabled,pdfAnnotationBatching:batch};const buffer=new FileBuffer(f.file,f.api as never,()=>undefined);disposers.push(()=>buffer.dispose());const workspace:any={treeRoot:f.root,snapshot:()=>0};const view=render(<FileTerminalContextProvider workspace={workspace}><FilePdfPreview buffer={buffer} review={review} loadData={async()=>new Uint8Array([37,80,68,70])}/></FileTerminalContextProvider>);await waitFor(()=>expect(view.container.querySelector('[data-testid=pdf-body]')).not.toBeNull());return{...f,...view,buffer};}
describe('G049 T12 actual mounted PDF conditional comment entry, decoder/canvas isolated',()=>{
 it.each([false,true])('issued annotations=true/batch=%s exposes a real comment-mode control',async batch=>{const f=await mount(true,batch);const button=screen.queryByRole('button',{name:/^PDF 评论$/});expect(button,'Ready actual PDF lacks the approved comment entry').not.toBeNull();expect(button!.hasAttribute('disabled')).toBe(false);fireEvent.click(button!);expect(button!.getAttribute('aria-pressed')).toBe('true');expect(f.buffer.file).toBe(f.file);expect(f.api.terminalInsert).not.toHaveBeenCalled();});
 it.each([false,true])('issued annotations=false/batch=%s has no comment or draft control',async batch=>{const f=await mount(false,batch);expect(screen.queryByRole('button',{name:/^PDF 评论$/})).toBeNull();expect(screen.queryByLabelText('PDF 评论编辑器')).toBeNull();expect(f.api.open).not.toHaveBeenCalled();expect(f.api.terminalInsert).not.toHaveBeenCalled();});
 it.each([false,true])('review=true suppresses comments even with issued annotations=true/batch=%s',async batch=>{const f=await mount(true,batch,true);expect(screen.queryByRole('button',{name:/^PDF 评论$/})).toBeNull();expect(screen.queryByLabelText('PDF 评论编辑器')).toBeNull();expect(f.api.terminalInsert).not.toHaveBeenCalled();});
});
