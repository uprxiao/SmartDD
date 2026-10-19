// @vitest-environment jsdom
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { createHash,webcrypto } from 'node:crypto';
import type { OfficePagesResult } from '@shared/file-office-pages';
import type { FileBuffer } from '../file-buffer';
import { FileOfficePagesPreview } from './pages-preview';
const api=vi.hoisted(()=>({openOfficePages:vi.fn(),officePagesChunk:vi.fn(),releaseOfficePages:vi.fn(),destroy:vi.fn(),create:vi.fn()}));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
vi.mock('../pdf/engine',()=>({createPdfSession:api.create}));
vi.mock('../pdf/page',()=>({PdfCanvasPage:({number,thumbnail}:{number:number;thumbnail:boolean})=><div data-testid={thumbnail?`thumb-${number}`:`page-${number}`}>页面 {number}</div>}));
const bytes=Buffer.from('%PDF-synthetic-pages'),hash=createHash('sha256').update(bytes).digest('hex');
const buffer=(format='pptx',source='a')=>({file:{ref:{id:source},revision:{hash:source}},content:{kind:'office',format},pdfPosition:{page:1,zoom:100,initialized:true}}) as unknown as FileBuffer;
const result=(format='pptx',source='a'):OfficePagesResult=>({id:'preview',sourceHash:source,info:{kind:format as 'docx'|'pptx',signed:false,externalLinks:0,hasRevisions:false,slides:format==='pptx'?[{id:'256',title:'第一页',notes:'中文备注😀',hidden:false},{id:'257',title:'第二页',notes:'第二页备注',hidden:true}]:[]},bytes:bytes.length,hash,pages:2,elapsedMs:1,warnings:[]});
beforeEach(()=>{
  vi.clearAllMocks();vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  api.openOfficePages.mockImplementation(async(input)=>({...result('pptx',input.baseHash),id:input.id}));api.officePagesChunk.mockResolvedValue(bytes.toString('base64'));api.releaseOfficePages.mockResolvedValue(undefined);api.destroy.mockResolvedValue(undefined);
  api.create.mockResolvedValue({ready:Promise.resolve({numPages:2,getPage:async()=>({getViewport:()=>({width:680,height:450})})}),run:(promise:Promise<unknown>)=>promise,destroy:api.destroy});
});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
describe('real-data Office page preview interactions (PDF/native mocked)',()=>{
  it('explains static PPTX animation/transition limits without adding them to DOCX',async()=>{
    const preview=render(<FileOfficePagesPreview buffer={buffer()}/>);await screen.findByTestId('page-1');
    expect(screen.getByRole('note').textContent).toBe('当前显示静态幻灯片；动画和切换效果不会播放。');
    preview.unmount();api.openOfficePages.mockResolvedValue(result('docx'));
    render(<FileOfficePagesPreview buffer={buffer('docx')}/>);await screen.findByTestId('page-1');expect(screen.queryByRole('note')).toBeNull();
  });
  it('maps slide rail, grid and notes to source pages, and applies navigation/zoom shortcuts',async()=>{
    const value=buffer();render(<FileOfficePagesPreview buffer={value}/>);await screen.findByText('中文备注😀');
    fireEvent.click(screen.getByRole('button',{name:'幻灯片 2'}));expect(screen.getByText('第二页备注')).toBeTruthy();expect(screen.getByTestId('page-2')).toBeTruthy();
    const view=screen.getByRole('region',{name:'PPTX 文档预览'});
    fireEvent.keyDown(view,{key:'ArrowLeft'});expect(screen.getByTestId('page-1')).toBeTruthy();
    fireEvent.keyDown(view,{key:'1',metaKey:true,altKey:true});expect(screen.getByRole('button',{name:'网格幻灯片 2'})).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole('button',{name:'网格幻灯片 2'}));expect(screen.getByTestId('page-2')).toBeTruthy();
    fireEvent.keyDown(view,{key:'+',metaKey:true,shiftKey:true});expect(value.pdfPosition.zoom).toBe(110);
    fireEvent.keyDown(view,{key:'0',metaKey:true});expect(value.pdfPosition.zoom).toBe(100);
    fireEvent.keyDown(view,{key:'+',isComposing:true});expect(value.pdfPosition.zoom).toBe(100);
  });
  it('honours W11/W12 modifiers, repeat and focused input guards with 10-point bounded zoom',async()=>{
    const value=buffer();render(<FileOfficePagesPreview buffer={value}/>);await screen.findByText('中文备注😀');const view=screen.getByRole('region',{name:'PPTX 文档预览'});
    for(const event of [{key:'+'},{key:'+',metaKey:true,ctrlKey:true},{key:'+',metaKey:true,repeat:true},{key:'+',metaKey:true,isComposing:true},{key:'+',metaKey:true,altKey:true}])fireEvent.keyDown(view,event);
    expect(value.pdfPosition.zoom).toBe(100);
    for(const patch of [{shiftKey:true},{repeat:true},{ctrlKey:true},{isComposing:true}])fireEvent.keyDown(view,{key:'1',code:'Digit1',metaKey:true,altKey:true,...patch});
    expect(screen.queryByRole('button',{name:'网格幻灯片 1'})).toBeNull();
    const input=document.createElement('textarea');view.append(input);input.focus();fireEvent.keyDown(input,{key:'1',metaKey:true,altKey:true});fireEvent.keyDown(input,{key:'+',metaKey:true});expect(value.pdfPosition.zoom).toBe(100);input.remove();
    for(let index=0;index<50;index++)fireEvent.keyDown(view,{key:'+',ctrlKey:true});expect(value.pdfPosition.zoom).toBe(500);
    for(let index=0;index<50;index++)fireEvent.keyDown(view,{key:'-',ctrlKey:true});expect(value.pdfPosition.zoom).toBe(25);
    fireEvent.keyDown(view,{key:'1',code:'Digit1',metaKey:true,altKey:true});expect(screen.getByRole('button',{name:'网格幻灯片 1'})).toBeTruthy();expect(document.activeElement).toBe(view);
  });
  it('uses the approved DOCX host without slide navigation, grid or notes controls',async()=>{
    api.openOfficePages.mockResolvedValue(result('docx'));render(<FileOfficePagesPreview buffer={buffer('docx')}/>);await screen.findByTestId('page-1');
    expect(screen.queryByRole('button',{name:'网格视图'})).toBeNull();expect(screen.queryByRole('navigation')).toBeNull();expect(screen.queryByText('演讲者备注')).toBeNull();
    expect(screen.getByRole('button',{name:'文档缩放'})).toBeTruthy();
  });
  it('does not publish a late cancelled render and retries with a fresh request identity',async()=>{
    let finish!:(value:OfficePagesResult)=>void;api.openOfficePages.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<FileOfficePagesPreview buffer={buffer()}/>);fireEvent.click(screen.getByRole('button',{name:'取消'}));await screen.findByText('已取消预览');
    await act(async()=>finish(result()));expect(api.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'重新预览'}));await screen.findByText('中文备注😀');
    expect(api.openOfficePages.mock.calls[0][0].id).not.toBe(api.openOfficePages.mock.calls[1][0].id);
  });
  it('rejects corrupt chunks before PDF parsing and displays diagnostics as inert text',async()=>{
    api.officePagesChunk.mockResolvedValue(Buffer.alloc(bytes.length,1).toString('base64'));render(<FileOfficePagesPreview buffer={buffer()}/>);
    await screen.findByRole('alert');expect(screen.getByText('Office 页面内容校验失败')).toBeTruthy();expect(api.create).not.toHaveBeenCalled();
    api.openOfficePages.mockRejectedValueOnce(new Error('<img src=x onerror=evil()>'));
    fireEvent.click(screen.getByRole('button',{name:'重新预览'}));await screen.findByText('<img src=x onerror=evil()>');expect(document.querySelector('img')).toBeNull();
  });
  it('releases the old renderer and request when the source revision changes',async()=>{
    const view=render(<FileOfficePagesPreview buffer={buffer()}/>);await screen.findByText('中文备注😀');const id=api.openOfficePages.mock.calls[0][0].id;
    view.rerender(<FileOfficePagesPreview buffer={buffer('pptx','b')}/>);await waitFor(()=>expect(api.openOfficePages).toHaveBeenCalledTimes(2));await screen.findByText('中文备注😀');
    expect(api.releaseOfficePages).toHaveBeenCalledWith(id);expect(api.destroy).toHaveBeenCalled();view.unmount();expect(api.releaseOfficePages.mock.calls.length).toBe(2);
  });
});
