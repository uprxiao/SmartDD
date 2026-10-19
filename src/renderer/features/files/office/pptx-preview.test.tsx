// @vitest-environment jsdom
import { useLayoutEffect,useReducer } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { createHash,webcrypto } from 'node:crypto';
import { PPTX_PRESETS } from '@shared/file-pptx-elements';
import type { PptxEditState } from '@shared/file-pptx';
import { FileBuffer } from '../file-buffer';
import { FileOfficePagesPreview } from './pages-preview';
const api=vi.hoisted(()=>Object.fromEntries(['openPptx','closePptx','editPptx','pptxHistory','checkpointPptx','savePptx','drafts','resolveDraft','closeDocument','renderPptx','pptxChunk','cancelPptxRender','createPdf','destroyPdf','openOfficePages'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
vi.mock('../pdf/engine',()=>({createPdfSession:api.createPdf}));
vi.mock('../pdf/page',()=>({PdfCanvasPage:({number,thumbnail}:{number:number;thumbnail:boolean})=><div data-testid={thumbnail?`thumb-${number}`:`page-${number}`}>页面 {number}</div>}));
const bytes=Buffer.from('%PDF-pptx-edit'),hash=createHash('sha256').update(bytes).digest('hex');
const file={ref:{id:'document',lease:'root',generation:1},name:'slides.pptx',relativePath:'slides.pptx',absolutePath:'/synthetic/slides.pptx',documentKey:'local:1:2',revision:{hash:'base',device:'1',inode:'2',size:100,modifiedNs:'1',changedNs:'1'},writable:true};
let buffer:FileBuffer,current:PptxEditState,notify:()=>void;
function Host(){const [,refresh]=useReducer(n=>n+1,0);useLayoutEffect(()=>{notify=refresh;return()=>{notify=()=>undefined;};},[]);return <FileOfficePagesPreview buffer={buffer}/>;}
beforeEach(async()=>{
  vi.resetAllMocks();notify=()=>undefined;vi.stubGlobal('crypto',webcrypto);vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});
  current={version:0,dirty:false,canUndo:false,canRedo:false,protected:false,info:{kind:'pptx',signed:false,externalLinks:0,hasRevisions:false,width:680,height:450,slides:[{id:'256',title:'Title',notes:'原备注😀',hidden:false,background:'#ffffff',elements:[{id:'2',name:'Title object',kind:'text',hidden:false,text:'对象原文',box:{x:36,y:20,width:300,height:80,rotation:0,flipH:false,flipV:false}}]},{id:'257',title:'Second',notes:'第二页',hidden:false}]}};
  api.openPptx.mockImplementation(async input=>({id:input.id,sourceHash:'base',state:current}));api.drafts.mockResolvedValue([]);api.closePptx.mockResolvedValue(undefined);api.closeDocument.mockResolvedValue(undefined);api.resolveDraft.mockResolvedValue({resolved:true});
  api.editPptx.mockImplementation(async({version,action})=>{expect(version).toBe(current.version);current={...current,version:version+1,dirty:true,canUndo:true,info:{...current.info,slides:current.info.slides.map(slide=>slide.id!==action.slideId?slide:{...slide,...(action.type==='notes'?{notes:action.text}:action.type==='hidden'?{hidden:action.hidden}:action.type==='background'?{background:action.color}:{elements:action.type==='chart-insert'?[...(slide.elements??[]),{id:'5',name:'Inserted chart',kind:'chart',hidden:false,chart:{type:action.chartType,values:[3,5,2],editableValues:true,options:{hasAxes:true,axes:false,gridLines:false,legend:false}},box:{x:90,y:95,width:200,height:140,rotation:0,flipH:false,flipV:false}}]:action.type==='insert-element'?[...(slide.elements??[]),{id:'3',name:'Inserted',kind:action.kind,hidden:false,text:'new',box:{x:90,y:95,width:280,height:70,rotation:0,flipH:false,flipV:false}}]:action.type==='element-delete'?slide.elements?.filter(element=>element.id!==action.elementId):slide.elements?.map(element=>element.id!==action.elementId?element:action.type==='chart-options'?{...element,chart:{...element.chart!,options:{...element.chart!.options!,...action.patch}}}:action.type==='chart-type'?{...element,chart:{...element.chart!,type:action.chartType,options:{...element.chart!.options!,hasAxes:action.chartType!=='pie'}}}:action.type==='element-text'?{...element,text:action.text}:action.type==='element-transform'?{...element,box:{...element.box,...action.patch}}:action.type==='element-appearance'?{...element,appearance:{...element.appearance,...action.patch},...(action.patch.shape?{preset:PPTX_PRESETS[action.patch.shape as keyof typeof PPTX_PRESETS]}:{})}:action.type==='element-format'?{...element,textStyle:{...element.textStyle,...action.patch.font,...(action.patch.align?{align:action.patch.align}:{}),...(action.patch.list?{list:action.patch.list}:{})}}:element)})})}};return current;});
  api.checkpointPptx.mockImplementation(async input=>({draftId:input.draftId,bufferVersion:input.bufferVersion,hash:'draft'}));
  api.savePptx.mockImplementation(async input=>({state:{...current,dirty:false},receipt:{state:'saved',opId:input.opId,bufferVersion:input.bufferVersion,revision:{...file.revision,hash:'saved'}},checkpoint:{draftId:input.draftId,bufferVersion:input.bufferVersion,hash:'draft'}}));
  api.renderPptx.mockImplementation(async input=>({id:input.requestId,version:input.version,sourceHash:'snapshot',info:current.info,bytes:bytes.length,hash,pages:2,elapsedMs:1,warnings:[]}));api.pptxChunk.mockResolvedValue(bytes.toString('base64'));api.cancelPptxRender.mockResolvedValue(undefined);api.destroyPdf.mockResolvedValue(undefined);
  api.createPdf.mockResolvedValue({ready:Promise.resolve({numPages:2,getPage:async()=>({getViewport:()=>({width:680,height:450})})}),run:(promise:Promise<unknown>)=>promise,destroy:api.destroyPdf});
  buffer=new FileBuffer(structuredClone(file),api as never,()=>notify());await buffer.load();
});
afterEach(()=>{cleanup();buffer.dispose();vi.unstubAllGlobals();vi.useRealTimers();});
describe('PPTX production edit controls (RPC and PDF layout mocked)',()=>{
  it.each([['object','metaKey'],['object','ctrlKey'],['notes','metaKey'],['notes','ctrlKey']] as const)('DEV155 saves a focused %s via %s without blur or repeat writes',async(target,modifier)=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));
    if(target==='object')fireEvent.doubleClick(screen.getByRole('button',{name:'text 对象 Title object'}));
    const input=await screen.findByRole('textbox',{name:target==='object'?'幻灯片对象文本':'演讲者备注'}) as HTMLTextAreaElement;
    input.focus();fireEvent.change(input,{target:{value:'V1 focus 中文🙂'}});expect(buffer.dirty).toBe(true);const save=vi.spyOn(buffer,'save');
    fireEvent.keyDown(input,{key:'s',[modifier]:true});expect(save).toHaveBeenCalledTimes(1);await waitFor(()=>expect(api.savePptx).toHaveBeenCalledTimes(1));await waitFor(()=>expect(buffer.dirty).toBe(false));
    expect(document.activeElement).toBe(input);expect(input.value).toBe('V1 focus 中文🙂');
    fireEvent.blur(input);await act(async()=>{await buffer.pptx!.finishInput();});
    expect(buffer.dirty).toBe(false);expect(api.savePptx).toHaveBeenCalledTimes(1);expect(api.editPptx).toHaveBeenCalledTimes(1);
  });
  it('DEV155 save shortcut respects composing, repeat, modifiers and read-only capability',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));const notes=screen.getByRole('textbox',{name:'演讲者备注'});
    notes.focus();fireEvent.change(notes,{target:{value:'retained'}});
    for(const patch of [{repeat:true},{isComposing:true},{keyCode:229},{altKey:true},{shiftKey:true},{ctrlKey:true}])fireEvent.keyDown(notes,{key:'s',metaKey:true,...patch});
    await act(async()=>{await Promise.resolve();});expect(api.savePptx).not.toHaveBeenCalled();
    buffer.pptx!.setComposing(true);fireEvent.keyDown(notes,{key:'s',metaKey:true});buffer.pptx!.setComposing(false);buffer.file={...buffer.file,writable:false};fireEvent.keyDown(notes,{key:'s',metaKey:true});
    await act(async()=>{await Promise.resolve();});expect(api.savePptx).not.toHaveBeenCalled();expect(buffer.dirty).toBe(true);
  });
  it('shows unsupported chart preview feedback without a fabricated page or closing the retained document',async()=>{
    const message='暂不支持此文档中的图表预览（漏斗图）。文档内容已保留，可使用其他应用打开。';
    api.renderPptx.mockRejectedValueOnce(new Error(message));render(<Host/>);
    await screen.findByText(message);expect(screen.queryByTestId('page-1')).toBeNull();expect(api.createPdf).not.toHaveBeenCalled();
    expect(api.closePptx).not.toHaveBeenCalled();expect(buffer.pptx!.result!.state.info.slides[0].notes).toBe('原备注😀');expect(buffer.pptx!.result!.state.dirty).toBe(false);
  });
  it('keeps the chart data field active during composition without opening an object text overlay',async()=>{
    current.info.slides[0].elements!.push({id:'4',name:'Chart',kind:'chart',hidden:false,box:{x:90,y:95,width:280,height:150,rotation:0,flipH:false,flipV:false},chart:{type:'bar',values:[9,4],editableValues:true,options:{hasAxes:true,axes:true,gridLines:false,legend:false}}});
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'chart 对象 Chart'}));fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const input=screen.getByRole('textbox',{name:'图表数据'}) as HTMLInputElement;
    act(()=>input.focus());fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'15,候选,'}});
    expect(input.disabled).toBe(false);expect(input.closest('fieldset:disabled')).toBeNull();expect(document.activeElement).toBe(input);expect(screen.queryByRole('textbox',{name:'幻灯片对象文本'})).toBeNull();
    expect((screen.getByRole('checkbox',{name:'图例'}) as HTMLInputElement).disabled).toBe(true);
    fireEvent.keyDown(input,{key:'Enter',isComposing:true});fireEvent.keyDown(input,{key:'Escape',keyCode:229});expect(api.editPptx).not.toHaveBeenCalled();expect(input.value).toBe('15,候选,');
    fireEvent.compositionEnd(input);fireEvent.change(input,{target:{value:'15,6'}});fireEvent.keyDown(input,{key:'Escape'});
    await waitFor(()=>expect(input.value).toBe('9,4'));expect(api.editPptx).not.toHaveBeenCalled();expect(buffer.pptx!.elementEditing).toBeNull();
    fireEvent.click(screen.getByRole('checkbox',{name:'图例'}));await waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(1));expect(api.editPptx.mock.calls[0][0].action).toEqual({type:'chart-options',slideId:'256',elementId:'4',patch:{legend:true}});
  });
  it('inserts and selects a real chart action, opens its approved fields and routes type changes to that object',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'插入图表'}));
    const type=await screen.findByRole('combobox',{name:'图表类型'});expect((screen.getByRole('textbox',{name:'图表数据'}) as HTMLInputElement).value).toBe('3,5,2');
    expect(buffer.pptx!.selection).toEqual({slideId:'256',elementId:'5'});expect(api.editPptx.mock.calls[0][0].action).toEqual({type:'chart-insert',slideId:'256',chartType:'bar'});await screen.findByTestId('page-1');
    fireEvent.change(type,{target:{value:'pie'}});await waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(2));expect(api.editPptx.mock.calls[1][0].action).toEqual({type:'chart-type',slideId:'256',elementId:'5',chartType:'pie'});
    await waitFor(()=>expect((screen.getByRole('checkbox',{name:'坐标轴'}) as HTMLInputElement).disabled).toBe(true));
  });
  it('routes table insertion/header controls and keeps pointer input inside the table editor',async()=>{
    const cells=[['Label','Value'],['A','3'],['B','5']].map((row,r)=>row.map((text,column)=>({row:r,column,text,textStyle:{},rowSpan:1,columnSpan:1,horizontalMerge:false,verticalMerge:false})));
    current.info.slides[0].elements!.push({id:'6',name:'Test table',kind:'table',hidden:false,box:{x:20,y:90,width:200,height:250,rotation:0,flipH:false,flipV:false},table:{widths:[100,100],heights:[0,0,0],cells,headerRow:false,headerColumn:false,explicitGrid:false}});
    api.renderPptx.mockImplementation(async input=>({id:input.requestId,version:input.version,sourceHash:'snapshot',info:current.info,bytes:bytes.length,hash,pages:2,elapsedMs:1,warnings:[],tableLayout:[{slideId:'256',elementId:'6',cells:cells.flat().map(cell=>({row:cell.row,column:cell.column,points:[[20+cell.column*100,90+cell.row*20],[120+cell.column*100,90+cell.row*20],[120+cell.column*100,110+cell.row*20],[20+cell.column*100,110+cell.row*20]]}))}]}));
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.doubleClick(screen.getByRole('gridcell',{name:'幻灯片表格 1:1'}));
    const input=await screen.findByRole('textbox',{name:'编辑幻灯片表格 1:1'});fireEvent.change(input,{target:{value:'未提交输入'}});fireEvent.pointerDown(input,{button:0});await act(async()=>{await Promise.resolve();});
    expect(api.editPptx).not.toHaveBeenCalled();expect(buffer.pptx!.elementEditing?.cell).toEqual({row:0,column:0});expect(screen.getByRole('textbox',{name:'编辑幻灯片表格 1:1'})).toBe(input);
    fireEvent.keyDown(input,{key:'Escape'});fireEvent.click(screen.getByRole('button',{name:'格式'}));expect((screen.getByLabelText('对象height') as HTMLInputElement).value).toBe('80');fireEvent.click(screen.getByRole('checkbox',{name:'首行标题'}));
    await waitFor(()=>expect(api.editPptx.mock.calls.at(-1)![0].action).toEqual({type:'table-flags',slideId:'256',elementId:'6',patch:{headerRow:true}}));await screen.findByTestId('page-1');
    fireEvent.click(screen.getByRole('button',{name:'插入表格'}));await waitFor(()=>expect(api.editPptx.mock.calls.at(-1)![0].action).toEqual({type:'insert-element',slideId:'256',kind:'table'}));
  });
  it('edits a source object independently from notes and retains its focused input across page regeneration',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');expect(screen.queryByRole('button',{name:'text 对象 Title object'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.doubleClick(screen.getByRole('button',{name:'text 对象 Title object'}));
    const input=await screen.findByRole('textbox',{name:'幻灯片对象文本'}) as HTMLTextAreaElement;
    expect(input.value).toBe('对象原文');fireEvent.change(input,{target:{value:'对象中文😀\n第二行'}});
    expect((screen.getByRole('textbox',{name:'演讲者备注'}) as HTMLTextAreaElement).value).toBe('原备注😀');
    await act(async()=>{expect(await buffer.save()).toBe(true);});await screen.findByTestId('page-1');
    expect(screen.getByRole('textbox',{name:'幻灯片对象文本'})).toBe(input);expect(document.activeElement).toBe(input);expect(input.value).toBe('对象中文😀\n第二行');
    expect(api.editPptx.mock.calls[0][0].action).toEqual({type:'element-text',slideId:'256',elementId:'2',text:'对象中文😀\n第二行'});
    fireEvent.change(input,{target:{value:'取消这次未提交输入'}});fireEvent.keyDown(input,{key:'Escape'});
    await waitFor(()=>expect(screen.queryByRole('textbox',{name:'幻灯片对象文本'})).toBeNull());expect(current.info.slides[0].elements![0].text).toBe('对象中文😀\n第二行');expect(buffer.pptx!.pending).toBeNull();
  });
  it('retains object composition and selection when navigation and shortcuts are attempted',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.doubleClick(screen.getByRole('button',{name:'text 对象 Title object'}));
    const input=await screen.findByRole('textbox',{name:'幻灯片对象文本'});fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'zhongwen'}});
    fireEvent.keyDown(input,{key:'Escape',isComposing:true});fireEvent.keyDown(input,{key:'f',metaKey:true,shiftKey:true,isComposing:true});fireEvent.click(screen.getByRole('button',{name:'幻灯片 2'}));
    await act(async()=>{await Promise.resolve();});expect(buffer.pdfPosition.page).toBe(1);expect(screen.getByRole('textbox',{name:'幻灯片对象文本'})).toBe(input);expect(api.editPptx).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:'中文'}});fireEvent.compositionEnd(input);fireEvent.click(screen.getByRole('button',{name:'幻灯片 2'}));
    await waitFor(()=>expect(buffer.pdfPosition.page).toBe(2));expect(current.info.slides[0].elements![0].text).toBe('中文');expect(current.info.slides[0].notes).toBe('原备注😀');
  });
  it('selects inserted objects and commits a complete position value once using real document units',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'插入文本框'}));
    await waitFor(()=>expect(buffer.pptx!.selection?.elementId).toBe('3'));await screen.findByTestId('page-1');
    const x=screen.getByLabelText('对象x');expect((x as HTMLInputElement).value).toBe('120');
    fireEvent.focus(x);fireEvent.change(x,{target:{value:'160'}});expect(api.editPptx).toHaveBeenCalledTimes(1);fireEvent.keyDown(x,{key:'Enter'});
    await waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(2));fireEvent.blur(x);
    expect(api.editPptx.mock.calls[1][0].action).toEqual({type:'element-transform',slideId:'256',elementId:'3',patch:{x:120}});
    await screen.findByTestId('page-1');expect(api.editPptx).toHaveBeenCalledTimes(2);expect(buffer.pptx!.selection?.elementId).toBe('3');
    fireEvent.keyDown(screen.getByRole('button',{name:'text 对象 Inserted'}),{key:'f',metaKey:true,shiftKey:true});
    await waitFor(()=>expect(api.editPptx.mock.calls.at(-1)![0].action).toEqual({type:'element-layer',slideId:'256',elementId:'3',direction:'front'}));
  });
  it('shows inherited text properties honestly and edits font, point size, emphasis and paragraph format',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'text 对象 Title object'}));fireEvent.click(screen.getByRole('button',{name:'格式'}));
    expect((screen.getByLabelText('对象字体') as HTMLSelectElement).value).toBe('');expect((screen.getByLabelText('对象fontSize') as HTMLInputElement).value).toBe('');
    fireEvent.change(screen.getByLabelText('对象字体'),{target:{value:'Arial'}});await waitFor(()=>expect(current.info.slides[0].elements![0].textStyle?.family).toBe('Arial'));await screen.findByTestId('page-1');
    const size=screen.getByLabelText('对象fontSize');fireEvent.focus(size);fireEvent.change(size,{target:{value:'32'}});fireEvent.blur(size);
    await waitFor(()=>expect(current.info.slides[0].elements![0].textStyle?.points).toBe(24));await screen.findByTestId('page-1');
    fireEvent.click(screen.getByRole('button',{name:'加粗'}));await waitFor(()=>expect(screen.getByRole('button',{name:'加粗'}).getAttribute('aria-pressed')).toBe('true'));await screen.findByTestId('page-1');
    fireEvent.change(screen.getByLabelText('段落列表'),{target:{value:'bullet'}});await waitFor(()=>expect(current.info.slides[0].elements![0].textStyle?.list).toBe('bullet'));await screen.findByTestId('page-1');
    fireEvent.change(screen.getByLabelText('对象文本对齐'),{target:{value:'center'}});await waitFor(()=>expect(current.info.slides[0].elements![0].textStyle?.align).toBe('center'));
    expect(current.info.slides[0].elements![0].text).toBe('对象原文');expect(current.info.slides[0].notes).toBe('原备注😀');
    expect(api.editPptx.mock.calls.map(([input])=>input.action.type)).toEqual(Array(5).fill('element-format'));
  });
  it('edits source appearance through the selected object and commits a color once after its picker finishes',async()=>{
    const object=current.info.slides[0].elements![0];object.kind='shape';object.preset='rect';object.appearance={fill:'#ffffff',border:false,shadow:false};
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'shape 对象 Title object'}));fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const color=screen.getByLabelText('对象填充');fireEvent.focus(color);fireEvent.input(color,{target:{value:'#aa0000'}});expect(api.editPptx).not.toHaveBeenCalled();
    fireEvent.change(color,{target:{value:'#123456'}});fireEvent.blur(color);await waitFor(()=>expect(current.info.slides[0].elements![0].appearance?.fill).toBe('#123456'));await screen.findByTestId('page-1');expect(api.editPptx).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('checkbox',{name:'对象边框'}));await screen.findByLabelText('边框样式');await screen.findByTestId('page-1');
    fireEvent.change(screen.getByLabelText('边框样式'),{target:{value:'dotted'}});await waitFor(()=>expect(current.info.slides[0].elements![0].appearance?.borderStyle).toBe('dotted'));await screen.findByTestId('page-1');
    fireEvent.click(screen.getByRole('checkbox',{name:'对象阴影'}));await waitFor(()=>expect(current.info.slides[0].elements![0].appearance?.shadow).toBe(true));await screen.findByTestId('page-1');
    fireEvent.change(screen.getByLabelText('形状类型'),{target:{value:'triangle'}});await waitFor(()=>expect(current.info.slides[0].elements![0].preset).toBe('triangle'));
    expect(api.editPptx.mock.calls.map(([input])=>input.action.type)).toEqual(Array(5).fill('element-appearance'));expect(current.info.slides[0].elements![0].text).toBe('对象原文');
  });
  it('deletes the selected object only outside inputs, composition and modified/repeated keys, then returns focus to the page',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.doubleClick(screen.getByRole('button',{name:'text 对象 Title object'}));
    const input=await screen.findByRole('textbox',{name:'幻灯片对象文本'}),root=screen.getByRole('region',{name:'PPTX 文档预览'});
    fireEvent.keyDown(input,{key:'Delete'});fireEvent.keyDown(input,{key:'Backspace'});fireEvent.compositionStart(input);fireEvent.keyDown(root,{key:'Delete'});expect(api.editPptx).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);fireEvent.keyDown(input,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('textbox',{name:'幻灯片对象文本'})).toBeNull());
    for(const modifiers of [{repeat:true},{metaKey:true},{ctrlKey:true},{altKey:true},{shiftKey:true},{isComposing:true},{keyCode:229}])fireEvent.keyDown(root,{key:'Delete',...modifiers});expect(api.editPptx).not.toHaveBeenCalled();
    fireEvent.keyDown(root,{key:'Backspace'});await waitFor(()=>expect(screen.queryByRole('button',{name:'text 对象 Title object'})).toBeNull());expect(api.editPptx).toHaveBeenCalledTimes(1);expect(api.editPptx.mock.calls[0][0].action).toEqual({type:'element-delete',slideId:'256',elementId:'2'});expect(document.activeElement).toBe(root);
  });
  it('keeps an object and its selection after a refused delete from the context menu',async()=>{
    api.editPptx.mockRejectedValueOnce(new Error('动画引用尚未适配'));
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));
    const object=screen.getByRole('button',{name:'text 对象 Title object'});fireEvent.contextMenu(object,{clientX:150,clientY:120});
    fireEvent.click(await screen.findByRole('menuitem',{name:/删除/}));await waitFor(()=>expect(buffer.saveError).toContain('动画引用尚未适配')); // Workspace shell renders the error strip.
    expect(screen.getByRole('button',{name:'text 对象 Title object'}).getAttribute('aria-pressed')).toBe('true');expect(current.info.slides[0].elements).toHaveLength(1);
  });
  it('keeps the clicked format control available while textarea blur is committing its previous input',async()=>{
    const edit=api.editPptx.getMockImplementation()!;let finish!:()=>void;
    api.editPptx.mockImplementationOnce(input=>new Promise(resolve=>{finish=()=>resolve(edit(input));}));
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'格式'}));fireEvent.doubleClick(screen.getByRole('button',{name:'text 对象 Title object'}));
    const input=await screen.findByRole('textbox',{name:'幻灯片对象文本'});fireEvent.change(input,{target:{value:'文字先提交'}});fireEvent.blur(input);
    await waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(1));const bold=screen.getByRole('button',{name:'加粗'});
    expect(bold.closest('fieldset')!.disabled).toBe(false);fireEvent.click(bold);await act(async()=>finish());
    await waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(2));expect(current.info.slides[0].elements![0]).toMatchObject({text:'文字先提交',textStyle:{bold:true}});
  });
  it('starts with read-only notes, saves edits and keeps the same focused textarea while PDF regenerates',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');const notes=screen.getByRole('textbox',{name:'演讲者备注'}) as HTMLTextAreaElement;
    expect(notes.readOnly).toBe(true);fireEvent.click(screen.getByRole('button',{name:'编辑'}));expect(notes.readOnly).toBe(false);
    notes.focus();fireEvent.change(notes,{target:{value:'中文编辑😀\n第二行'}});
    await act(async()=>{expect(await buffer.save()).toBe(true);});await screen.findByTestId('page-1');
    expect(screen.getByRole('textbox',{name:'演讲者备注'})).toBe(notes);expect(document.activeElement).toBe(notes);expect(notes.value).toBe('中文编辑😀\n第二行');
    expect(api.savePptx).toHaveBeenCalledTimes(1);expect(api.renderPptx.mock.calls.at(-1)![0].version).toBe(1);expect(api.openOfficePages).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'完成编辑'}));await waitFor(()=>expect(notes.readOnly).toBe(true));
  });
  it('does not navigate away from a composing note and protects presentation shortcuts inside the input',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));const notes=screen.getByRole('textbox',{name:'演讲者备注'});
    notes.focus();fireEvent.compositionStart(notes);fireEvent.change(notes,{target:{value:'zhongwen'}});fireEvent.click(screen.getByRole('button',{name:'幻灯片 2'}));
    await act(async()=>{await Promise.resolve();});expect(buffer.pdfPosition.page).toBe(1);expect(api.editPptx).not.toHaveBeenCalled();
    fireEvent.keyDown(notes,{key:'1',metaKey:true,altKey:true,isComposing:true});expect(screen.queryByRole('button',{name:'网格幻灯片 1'})).toBeNull();
    fireEvent.compositionEnd(notes,{data:'中文'});fireEvent.change(notes,{target:{value:'中文'}});fireEvent.click(screen.getByRole('button',{name:'幻灯片 2'}));
    await waitFor(()=>expect(buffer.pdfPosition.page).toBe(2));expect(api.editPptx.mock.calls.at(-1)![0].action.text).toBe('中文');
  });
  it('changes background only after final native color change and provides real visibility action',async()=>{
    render(<Host/>);await screen.findByTestId('page-1');fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const input=screen.getByLabelText('幻灯片背景');fireEvent.focus(input);fireEvent.input(input,{target:{value:'#123456'}});expect(api.editPptx).not.toHaveBeenCalled();
    fireEvent.change(input,{target:{value:'#123456'}});await waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(1));expect(api.editPptx.mock.calls[0][0].action).toEqual({type:'background',slideId:'256',color:'#123456'});
    await screen.findByTestId('page-1');fireEvent.contextMenu(screen.getByRole('button',{name:'幻灯片 1'}),{button:2,clientX:20,clientY:20});
    fireEvent.click(await screen.findByRole('menuitem',{name:'隐藏'}));await waitFor(()=>expect(current.info.slides[0].hidden).toBe(true));
    expect(screen.getByText('1 · 隐藏')).toBeTruthy();
  });
  it('keeps document data after cancelling a page projection and does not close it on view unmount',async()=>{
    api.renderPptx.mockImplementationOnce(()=>new Promise(()=>undefined));const view=render(<Host/>);await screen.findByText('正在排版文档…');
    fireEvent.click(screen.getByRole('button',{name:'取消'}));await screen.findByText('已取消预览');expect(api.cancelPptxRender).toHaveBeenCalled();expect(buffer.pptx?.result?.state.info.slides).toHaveLength(2);
    fireEvent.click(screen.getByRole('button',{name:'重新预览'}));await screen.findByTestId('page-1');view.unmount();expect(api.closePptx).not.toHaveBeenCalled();expect(api.cancelPptxRender.mock.calls.length).toBeGreaterThan(1);
  });
  it('retries a model open failure without invoking layout on an unready document',async()=>{
    api.openPptx.mockRejectedValueOnce(new Error('文档数量已达上限'));await buffer.pptx!.reload();render(<Host/>);
    await screen.findByText('文档数量已达上限');expect(api.renderPptx).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'重新预览'}));await screen.findByTestId('page-1');expect(buffer.loadState).toBe('ready');expect(api.openPptx).toHaveBeenCalledTimes(3);
  });
  it('uses the approved add and context actions, retains the selected identity and disables deletion of the last slide',async()=>{
    let sequence=258;
    api.editPptx.mockImplementation(async({version,action})=>{
      const slides=[...current.info.slides],index=slides.findIndex(slide=>slide.id===action.slideId);
      if(action.type==='add')slides.push({id:String(sequence++),title:'New',notes:'',hidden:false});
      else if(action.type==='duplicate')slides.splice(index+1,0,{...slides[index],id:String(sequence++)});
      else if(action.type==='delete')slides.splice(index,1);
      current={...current,version:version+1,dirty:true,canUndo:true,info:{...current.info,slides}};return current;
    });
    api.renderPptx.mockImplementation(async input=>({id:input.requestId,version:input.version,sourceHash:'snapshot',info:current.info,bytes:bytes.length,hash,pages:current.info.slides.length,elapsedMs:1,warnings:[]}));
    api.createPdf.mockImplementation(async()=>({ready:Promise.resolve({numPages:current.info.slides.length,getPage:async()=>({getViewport:()=>({width:680,height:450})})}),run:(promise:Promise<unknown>)=>promise,destroy:api.destroyPdf}));
    render(<Host/>);await screen.findByTestId('page-1');expect(screen.queryByRole('button',{name:'添加幻灯片'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'编辑'}));fireEvent.click(screen.getByRole('button',{name:'添加幻灯片'}));
    await screen.findByTestId('page-3');expect(screen.getByRole('button',{name:'幻灯片 3'}).getAttribute('aria-current')).toBe('page');
    fireEvent.keyDown(screen.getByRole('button',{name:'幻灯片 1'}),{key:'F10',shiftKey:true});
    fireEvent.click(await screen.findByRole('menuitem',{name:'复制幻灯片'}));await screen.findByTestId('page-4');expect(buffer.pdfPosition.page).toBe(4);
    fireEvent.contextMenu(screen.getByRole('button',{name:'幻灯片 4'}),{button:2,clientX:20,clientY:20});fireEvent.click(await screen.findByRole('menuitem',{name:'删除'}));
    await screen.findByTestId('page-1');expect(buffer.pdfPosition.page).toBe(1);expect(screen.queryByRole('button',{name:'幻灯片 4'})).toBeNull();
    for(const number of [3,2]){
      fireEvent.contextMenu(screen.getByRole('button',{name:`幻灯片 ${number}`}),{button:2,clientX:20,clientY:20});fireEvent.click(await screen.findByRole('menuitem',{name:'删除'}));
      await waitFor(()=>expect(current.info.slides).toHaveLength(number-1));await screen.findByTestId('page-1');
    }
    fireEvent.contextMenu(screen.getByRole('button',{name:'幻灯片 1'}),{button:2,clientX:20,clientY:20});
    expect((await screen.findByRole('menuitem',{name:'删除'})).getAttribute('aria-disabled')).toBe('true');
    expect(api.editPptx.mock.calls.map(([input])=>input.action.type)).toEqual(['add','duplicate','delete','delete','delete']);
  });
});
