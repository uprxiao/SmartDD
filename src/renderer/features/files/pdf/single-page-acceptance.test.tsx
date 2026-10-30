// @vitest-environment jsdom
import {act,cleanup,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {FileDocument} from '@shared/files';
import {FileBuffer} from '../file-buffer';
import {FilePdfPreview} from './preview';
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:{}}}));
vi.mock('./page',()=>({PdfCanvasPage:({number,thumbnail,review,zoom}:{number:number;thumbnail?:boolean;review?:boolean;zoom:number})=><article data-page={number} data-thumbnail={String(Boolean(thumbnail))} data-review={String(Boolean(review))} data-zoom={zoom}/> }));
vi.mock('./engine',()=>({createPdfSession:async(data:Uint8Array)=>({ready:Promise.resolve({numPages:data[0],getPage:async()=>({getViewport:()=>({width:612,height:792})}),getOutline:async()=>null}),run:(promise:Promise<unknown>)=>promise,destroy:async()=>undefined})}));
const buffers:FileBuffer[]=[];
beforeEach(()=>{vi.spyOn(HTMLElement.prototype,'clientHeight','get').mockReturnValue(800);vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockReturnValue(600);vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});});
afterEach(()=>{cleanup();for(const buffer of buffers.splice(0))buffer.dispose();vi.restoreAllMocks();vi.unstubAllGlobals();});
function props(pages:number,review:boolean){const file={name:pages+'.pdf',ref:{id:crypto.randomUUID()},revision:{hash:crypto.randomUUID()},content:{kind:'pdf'}} as unknown as FileDocument,buffer=new FileBuffer(file,{closeDocument:async()=>undefined}as never,()=>{});buffers.push(buffer);return{buffer,review,loadData:async()=>new Uint8Array([pages])};}
async function ready(total:number,review:boolean){await waitFor(()=>expect(document.querySelector('.fw-pdf-main')).not.toBeNull());await act(async()=>{await new Promise<void>(done=>requestAnimationFrame(()=>done()))});expect(document.querySelector('.fw-pdf-status,.fw-pdf-pager')?.textContent).toContain('1 / '+total);expect(document.querySelectorAll('.fw-pdf-scroll [data-page]')).toHaveLength(review?1:total);}
it.each([false,true])('T09 keeps single-page %s navigation absent, then restores multi-page navigation without stale totals',async(review)=>{
  // The renderer host/FileBuffer are real. Decoder/canvas are explicitly
  // isolated so this is conditional-host integration,not binary PDF or App A.
  const host=render(<FilePdfPreview {...props(1,review)}/>);await ready(1,review);expect(screen.queryByLabelText('PDF 页面缩略图')).toBeNull();expect(screen.queryByLabelText('上一页')).toBeNull();expect(screen.queryByLabelText('下一页')).toBeNull();
  host.rerender(<FilePdfPreview {...props(3,review)}/>);await ready(3,review);
  if(review){expect(screen.queryByLabelText('PDF 页面缩略图')).toBeNull();expect((screen.getByLabelText('上一页')as HTMLButtonElement).disabled).toBe(true);expect((screen.getByLabelText('下一页')as HTMLButtonElement).disabled).toBe(false);expect(document.querySelector('[data-page]')?.getAttribute('data-review')).toBe('true');}
  else{expect(screen.getByLabelText('PDF 页面缩略图')).toBeTruthy();expect(screen.queryByLabelText('上一页')).toBeNull();expect(screen.queryByLabelText('下一页')).toBeNull();}
  host.rerender(<FilePdfPreview {...props(1,review)}/>);await ready(1,review);expect(screen.queryByLabelText('PDF 页面缩略图')).toBeNull();expect(screen.queryByLabelText('上一页')).toBeNull();expect(screen.queryByLabelText('下一页')).toBeNull();expect(document.querySelector('.fw-pdf')?.textContent).not.toContain('/ 3');
});
it('T11 review fits the current container after resizing without changing the saved artifact zoom',async()=>{
  let width=600,resize:()=>void=()=>{};
  vi.spyOn(HTMLElement.prototype,'clientWidth','get').mockImplementation(()=>width);
  vi.stubGlobal('ResizeObserver',class{constructor(callback:()=>void){resize=callback}observe(){resize()}disconnect(){}});
  const p=props(3,true);p.buffer.pdfPosition={page:1,zoom:150,initialized:true};render(<FilePdfPreview {...p}/>);await ready(3,true);
  const zoom=()=>Number(document.querySelector('.fw-pdf-scroll [data-page]')?.getAttribute('data-zoom'));
  expect(612*(96/72)*zoom()/100).toBeCloseTo(556,4);
  act(()=>{width=420;resize()});await waitFor(()=>expect(612*(96/72)*zoom()/100).toBeCloseTo(376,4));
  expect(p.buffer.pdfPosition.zoom).toBe(150);
});
