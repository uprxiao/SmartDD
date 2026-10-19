// @vitest-environment jsdom
import { useLayoutEffect,useReducer,useRef } from 'react';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { afterEach,beforeEach,describe,it,expect,vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import type { PptxTableLayout } from '@shared/file-pptx-table';
import { OfficePackage } from '../../../../main/core/files/office/package';
import { PptxDocument } from '../../../../main/core/files/office/pptx-document';
import { FileBuffer } from '../file-buffer';
import { PptxObjects } from './pptx-objects';
const api=vi.hoisted(()=>Object.fromEntries(['openPptx','closePptx','editPptx','pptxHistory','checkpointPptx','savePptx','drafts','resolveDraft','closeDocument'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
let buffer:FileBuffer,model:PptxDocument,notify:()=>void,tableId:string,layout:PptxTableLayout;
const file={ref:{id:'document',lease:'root',generation:1},name:'table.pptx',relativePath:'table.pptx',absolutePath:'/synthetic/table.pptx',documentKey:'local:1:2',revision:{hash:'base',device:'1',inode:'2',size:100,modifiedNs:'1',changedNs:'1'},writable:true};
function Host({ready=true,enabled=true}:{ready?:boolean;enabled?:boolean}){const [,refresh]=useReducer(n=>n+1,0),root=useRef<HTMLElement>(null);useLayoutEffect(()=>{notify=refresh;return()=>{notify=()=>undefined;};},[]);return <section ref={root} tabIndex={0} aria-label="slide"><PptxObjects pptx={buffer.pptx!} slide={buffer.pptx!.result!.state.info.slides[0]} zoom={75} enabled={enabled} container={root} tableLayout={ready?[layout]:undefined}/></section>;}
beforeEach(async()=>{
  vi.resetAllMocks();vi.stubGlobal('crypto',webcrypto);notify=()=>undefined;
  model=new PptxDocument(await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-edited.pptx')));
  const table=model.state().info.slides[0].elements!.find(element=>element.table)!;tableId=table.id;
  // Measured geometry is supplied here, not a renderer/visual assertion. The
  // real native export route is covered separately by the opt-in native suite.
  layout={slideId:'256',elementId:tableId,cells:table.table!.cells.flat().map(cell=>({row:cell.row,column:cell.column,points:[[36+cell.column*324,94+cell.row*24],[360+cell.column*324,94+cell.row*24],[360+cell.column*324,118+cell.row*24],[36+cell.column*324,118+cell.row*24]]}))};
  api.openPptx.mockImplementation(async input=>({id:input.id,sourceHash:'base',state:model.state()}));api.drafts.mockResolvedValue([]);api.closePptx.mockResolvedValue(undefined);api.closeDocument.mockResolvedValue(undefined);api.resolveDraft.mockResolvedValue({resolved:true});
  api.editPptx.mockImplementation(async input=>model.edit(input.version,input.action));api.pptxHistory.mockImplementation(async input=>model.history(input.version,input.direction));
  api.checkpointPptx.mockImplementation(async input=>({draftId:input.draftId,bufferVersion:input.bufferVersion,hash:'draft'}));
  api.savePptx.mockImplementation(async input=>{const snapshot=await model.materialize(input.version);return {state:model.acknowledge(input.version,snapshot.hash),receipt:{state:'saved',opId:input.opId,bufferVersion:input.bufferVersion,revision:{...file.revision,hash:snapshot.hash}},checkpoint:{draftId:input.draftId,bufferVersion:input.bufferVersion,hash:'draft'}};});
  buffer=new FileBuffer(structuredClone(file),api as never,()=>notify());await buffer.load();
});
afterEach(()=>{cleanup();buffer.dispose();vi.unstubAllGlobals();});
const cell=(r:number,c:number)=>screen.getByRole('gridcell',{name:`幻灯片表格 ${r}:${c}`});
const values=()=>model.state().info.slides[0].elements!.find(element=>element.id===tableId)!.table!.cells.map(row=>row.map(cell=>cell.text));
describe('PPTX table UI with actual source edits and supplied layout',()=>{
  it('offers keyboard entry before selecting a table and returns through cell/object/page Escape states',async()=>{
    render(<Host/>);const grid=screen.getByRole('grid');expect(grid.tabIndex).toBe(0);act(()=>grid.focus());await waitFor(()=>expect(buffer.pptx!.selection?.elementId).toBe(tableId));
    fireEvent.keyDown(grid,{key:'Enter'});const input=await screen.findByRole('textbox',{name:'编辑幻灯片表格 1:1'});fireEvent.keyDown(input,{key:'Escape'});await waitFor(()=>expect(document.activeElement).toBe(cell(1,1)));
    fireEvent.keyDown(cell(1,1),{key:'Escape'});await waitFor(()=>expect(document.activeElement).toBe(grid));fireEvent.keyDown(grid,{key:'Escape'});await waitFor(()=>expect(buffer.pptx!.selection).toBeNull());expect(document.activeElement).toBe(screen.getByRole('region',{name:'slide'}));
  });
  it('uses native-sized cells, supports range selection/clear and restores the real source in one undo',async()=>{
    render(<Host/>);expect(cell(1,1).style.height).toBe('24px');expect(cell(1,1).style.left).toBe('36px');
    fireEvent.click(cell(1,1));await waitFor(()=>expect(buffer.pptx!.selection?.cell).toEqual({row:0,column:0}));
    fireEvent.keyDown(cell(1,1),{key:'ArrowDown',shiftKey:true});await waitFor(()=>expect(document.activeElement).toBe(cell(2,1)));
    expect(cell(1,1).getAttribute('aria-selected')).toBe('true');expect(cell(2,1).getAttribute('aria-selected')).toBe('true');expect(cell(1,2).getAttribute('aria-selected')).toBe('false');
    fireEvent.keyDown(cell(2,1),{key:'Delete'});await waitFor(()=>expect(values()).toEqual([['','Value'],['','TABLE_EDITED'],['B','UNCHANGED_CELL']]));expect(api.editPptx).toHaveBeenCalledOnce();
    await act(async()=>buffer.pptx!.history('undo'));expect(values()).toEqual([['Label','Value'],['A','TABLE_EDITED'],['B','UNCHANGED_CELL']]);
  });
  it('selects all cells only in table state and clears cell content without deleting the object',async()=>{
    render(<Host/>);fireEvent.click(cell(2,2));await waitFor(()=>expect(buffer.pptx!.selection?.cell).toEqual({row:1,column:1}));
    fireEvent.keyDown(cell(2,2),{key:'a',metaKey:true});expect(screen.getAllByRole('gridcell').every(node=>node.getAttribute('aria-selected')==='true')).toBe(true);
    fireEvent.keyDown(cell(2,2),{key:'Backspace'});await waitFor(()=>expect(values().flat()).toEqual(Array(6).fill('')));expect(api.editPptx.mock.calls[0][0].action.type).toBe('table-clear');
  });
  it('keeps the live textarea through layout replacement and isolates composition, notes and cancellation',async()=>{
    const notes=model.state().info.slides[0].notes,view=render(<Host/>);fireEvent.doubleClick(cell(1,1));const input=await screen.findByRole('textbox',{name:'编辑幻灯片表格 1:1'}) as HTMLTextAreaElement;
    fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'候选😀'}});fireEvent.keyDown(input,{key:'Escape',isComposing:true});fireEvent.click(cell(2,2));
    expect(buffer.pptx!.elementEditing?.cell).toEqual({row:0,column:0});expect(api.editPptx).not.toHaveBeenCalled();
    view.rerender(<Host ready={false}/>);expect(screen.getByRole('textbox',{name:'编辑幻灯片表格 1:1'})).toBe(input);expect(document.activeElement).toBe(input);
    fireEvent.compositionEnd(input);await act(async()=>{expect(await buffer.save()).toBe(true);});expect(values()[0][0]).toBe('候选😀');expect(model.state().info.slides[0].notes).toBe(notes);
    view.rerender(<Host/>);expect(screen.getByRole('textbox',{name:'编辑幻灯片表格 1:1'})).toBe(input);
    fireEvent.change(input,{target:{value:'取消这次输入'}});fireEvent.keyDown(input,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('textbox',{name:'编辑幻灯片表格 1:1'})).toBeNull());expect(values()[0][0]).toBe('候选😀');expect(buffer.pptx!.pending).toBeNull();expect(document.activeElement).toBe(cell(1,1));
    fireEvent.keyDown(cell(1,1),{key:'Escape'});await waitFor(()=>expect(buffer.pptx!.selection?.cell).toBeUndefined());expect(buffer.pptx!.selection?.elementId).toBe(tableId);
  });
  it('commits Enter/Tab before moving cells and keeps arrow keys inside the live text input',async()=>{
    render(<Host/>);fireEvent.doubleClick(cell(1,1));let input=await screen.findByRole('textbox',{name:'编辑幻灯片表格 1:1'});
    fireEvent.change(input,{target:{value:'First'}});fireEvent.keyDown(input,{key:'ArrowRight'});expect(api.editPptx).not.toHaveBeenCalled();fireEvent.keyDown(input,{key:'Tab'});
    await waitFor(()=>expect(document.activeElement).toBe(cell(1,2)));expect(values()[0][0]).toBe('First');fireEvent.keyDown(cell(1,2),{key:'F2'});input=await screen.findByRole('textbox',{name:'编辑幻灯片表格 1:2'});
    fireEvent.change(input,{target:{value:'Second'}});fireEvent.keyDown(input,{key:'Enter'});await waitFor(()=>expect(document.activeElement).toBe(cell(2,2)));expect(values()[0][1]).toBe('Second');
    fireEvent.keyDown(cell(2,2),{key:'Tab',shiftKey:true});await waitFor(()=>expect(document.activeElement).toBe(cell(2,1)));
  });
  it('retains selection and original cells after a refused clear, and blocks stale geometry and read-only edits',async()=>{
    const view=render(<Host/>);fireEvent.click(cell(1,1));await waitFor(()=>expect(buffer.pptx!.selection?.cell).toEqual({row:0,column:0}));api.editPptx.mockRejectedValueOnce(new Error('表格单元格包含域'));
    fireEvent.keyDown(cell(1,1),{key:'Delete'});await waitFor(()=>expect(buffer.saveError).toContain('包含域'));expect(values()[0][0]).toBe('Label');expect(cell(1,1).getAttribute('aria-selected')).toBe('true');
    view.rerender(<Host ready={false}/>);fireEvent.keyDown(cell(1,1),{key:'Delete'});fireEvent.doubleClick(cell(1,1));expect(api.editPptx).toHaveBeenCalledOnce();expect(screen.queryByRole('textbox',{name:'编辑幻灯片表格 1:1'})).toBeNull();
    view.rerender(<Host enabled={false}/>);fireEvent.keyDown(cell(1,1),{key:'Delete'});fireEvent.keyDown(cell(1,1),{key:'F2'});await act(async()=>{await Promise.resolve();});expect(api.editPptx).toHaveBeenCalledOnce();expect(screen.queryByRole('textbox',{name:'编辑幻灯片表格 1:1'})).toBeNull();
  });
});
