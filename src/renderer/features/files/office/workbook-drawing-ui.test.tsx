// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect,useReducer } from 'react';
import { FileBuffer } from '../file-buffer';
import { OfficePackage } from '@main/core/files/office/package';
import { OfficeWorkbook } from '@main/core/files/office/workbook';
import { OfficeDocument } from '@main/core/files/office/document';
import { readOfficeRange } from '@main/core/files/office/range';
import { prepareOfficeFit } from '@main/core/files/office/fit-edit';
import { FileOfficePreview } from './preview';

const api = vi.hoisted(() => ({ create: vi.fn(),drafts:vi.fn(),refresh:vi.fn(),editOffice:vi.fn(),officeSheet:vi.fn(),editOfficeRange:vi.fn(),officeHistory:vi.fn(),checkpointOffice:vi.fn(),saveOffice:vi.fn(),recalculateOffice:vi.fn(),resolveDraft:vi.fn() }));
vi.mock('./client', () => ({ OfficeClient: class { constructor() { return api.create(); } } }));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const clients: ReturnType<typeof client>[] = [];
const buffers:FileBuffer[]=[],listeners=new Map<FileBuffer,()=>void>();
function client(document: OfficeDocument) {
  const model=document.workbook, id:string=`test-office-${clients.length}`;
  return { id,document,ready: Promise.resolve({ id, hash: 'hash', workbook: model.info,state:document.state(),calculation:{state:'ready' as const} }), window: vi.fn(async (id, rows: number[], columns: number[]) => document.workbook.window(id, rows[0], columns[0], rows.length, columns.length, rows, columns)), cell: vi.fn(async (id, row, column) => document.workbook.cellText(id, row, column, 0, 16384)), text:vi.fn(async(id,row,column)=>{const cell=document.workbook.cell(id,row,column);return cell.formula ? `=${cell.formula.text}` : cell.value;}),range:vi.fn(async(id,range)=>readOfficeRange(document.workbook,id,range,false)),copyRange:vi.fn(async()=>undefined),copy: vi.fn(async () => undefined), close: vi.fn() };
}
const buffer = (instance = 'one',writable=false) => {
  const value=new FileBuffer({name:'real-fixture.xlsx',writable,revision:{hash:instance},ref:{id:instance}} as FileBuffer['file'],{closeDocument:async()=>undefined} as never,()=>listeners.get(value)?.());
  buffers.push(value); return value;
};
function Preview({buffer}:{buffer:FileBuffer}) {
  const [,update]=useReducer((value:number)=>value+1,0);
  useEffect(()=>{listeners.set(buffer,update);return()=>{listeners.delete(buffer);};},[buffer]);
  return <FileOfficePreview buffer={buffer}/>;
}
beforeEach(async () => {
  vi.resetAllMocks(); clients.length = 0; api.drafts.mockResolvedValue([]);
  vi.stubGlobal('ResizeObserver', class { constructor(private readonly callback: (entries:Partial<ResizeObserverEntry>[]) => void) {} observe(element: HTMLElement) { if(element.classList.contains('fw-office-viewport'))Object.defineProperties(element, { clientWidth: { configurable: true, value: 500 }, clientHeight: { configurable: true, value: 420 } }); this.callback([{target:element,contentRect:element.getBoundingClientRect()}]); } unobserve() {} disconnect() {} });
  const original = await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'));
  api.create.mockImplementation(() => { const value = client(new OfficeDocument(original)); clients.push(value); return value; });
  const doc=(id:string)=>clients.find(client=>client.id === id)!.document;
  api.editOffice.mockImplementation(async input=>({state:doc(input.id).edit(input.version,input.edit),calculation:{state:'ready'}}));
  api.officeSheet.mockImplementation(async input=>({...doc(input.id).sheetAction(input.version,input.action),calculation:{state:'ready'}}));
  api.editOfficeRange.mockImplementation(async input=>{const current=doc(input.id),candidate=await current.prepareRange(input.version,input.action);return {state:current.commitRange(input.version,candidate.token),calculation:{state:'ready'}};});
  api.officeHistory.mockImplementation(async input=>({state:doc(input.id).undo(input.version,input.direction),calculation:{state:'ready'}}));
  api.checkpointOffice.mockImplementation(async input=>({draftId:input.draftId,bufferVersion:input.bufferVersion,hash:'checkpoint'}));
  api.resolveDraft.mockResolvedValue({resolved:true});
  api.saveOffice.mockImplementation(async input=>{const current=doc(input.id),snapshot=await current.materialize(input.version);return {state:current.acknowledge(input.version,snapshot.hash),calculation:{state:'ready'},receipt:{state:'saved',opId:input.opId,bufferVersion:input.bufferVersion,revision:{hash:snapshot.hash,device:'1',inode:'2',size:snapshot.bytes.length,modifiedNs:'1',changedNs:'1'}},checkpoint:{draftId:input.draftId,bufferVersion:input.bufferVersion,hash:'checkpoint'}};});
});
afterEach(() => { cleanup(); for(const buffer of buffers)buffer.dispose(); buffers.length=0; listeners.clear(); vi.unstubAllGlobals(); });
describe('workbook drawing UI with the real document transaction (isolated IPC)',()=>{
 it('places a real text box before typing, checkpoints raw input and saves while keeping the focused editor',async()=>{
  const f=buffer('drawing-text-save',true);f.pauseAutosave();render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});
  fireEvent.click(screen.getByRole('button',{name:'插入工作簿文本框'}));const placement=await screen.findByRole('region',{name:'放置文本框'});expect(api.editOfficeRange).not.toHaveBeenCalled();
  fireEvent.keyDown(placement,{key:'Enter'});const input=await screen.findByRole('textbox',{name:'编辑工作簿文本框'});
  expect(api.editOfficeRange.mock.calls[0][0].action).toMatchObject({type:'drawing-insert',drawing:{kind:'text',autoSize:true,frame:{x:176,y:168.5,width:112,height:56}}});
  fireEvent.change(input,{target:{value:'文本框 & 中文\nhello 😀'}});expect(f.office!.pendingDrawing?.text).toBe('文本框 & 中文\nhello 😀');
  await act(()=>f.office!.checkpoint());expect(api.checkpointOffice.mock.calls.at(-1)![0].pendingDrawing.text).toBe('文本框 & 中文\nhello 😀');
  expect(clients[0].document.workbook.window('1',0,0,1,1).objects?.flatMap(value=>value.kind==='shape'&&value.shape?.textBox?[value.shape.text]:[])[0]).toBe('');
  fireEvent.keyDown(input,{key:'s',metaKey:true});await waitFor(()=>expect(f.dirty).toBe(false));expect(document.activeElement).toBe(input);expect(input.isConnected).toBe(true);
  const current=clients[0].document,roundtrip=await OfficePackage.read((await current.materialize(current.state().version)).bytes),object=new OfficeWorkbook(roundtrip).window('1',0,0,1,1).objects?.find(value=>value.kind==='shape'&&value.shape?.textBox);
  expect(object).toMatchObject({shape:{text:'文本框 & 中文\nhello 😀'}});expect(current.workbook.cell('1',1,1).value).toBe('3');
 });
 it('retains text input across view unmount and yields completion keys during composition, then commits the same object',async()=>{
  const f=buffer('drawing-text-unmount',true);f.pauseAutosave();const view=render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});
  fireEvent.click(screen.getByRole('button',{name:'插入工作簿文本框'}));fireEvent.keyDown(await screen.findByRole('region',{name:'放置文本框'}),{key:'Enter'});
  const input=await screen.findByRole('textbox',{name:'编辑工作簿文本框'});fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'保留中的中文'}});
  fireEvent.keyDown(input,{key:'Enter',metaKey:true,isComposing:true});expect(screen.getByRole('textbox',{name:'编辑工作簿文本框'})).toBe(input);expect(api.editOfficeRange).toHaveBeenCalledTimes(1);
  fireEvent.compositionEnd(input);const identity=f.office!.pendingDrawing!.objectId;view.unmount();expect(f.dirty).toBe(true);expect(f.office!.pendingDrawing?.text).toBe('保留中的中文');
  render(<Preview buffer={f}/>);const restored=await screen.findByRole('textbox',{name:'编辑工作簿文本框'});expect((restored as HTMLTextAreaElement).value).toBe('保留中的中文');
  fireEvent.keyDown(restored,{key:'Enter',metaKey:true});await waitFor(()=>expect(screen.queryByRole('textbox',{name:'编辑工作簿文本框'})).toBeNull());expect(f.office!.pendingDrawing).toBeNull();
  const object=clients[0].document.workbook.window('1',0,0,1,1).objects?.find(value=>value.id===identity);expect(object).toMatchObject({shape:{text:'保留中的中文'}});
 });
 it('cancels placement without changing the model or creating a pending text edit',async()=>{
  const f=buffer('drawing-text-cancel',true);render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});
  fireEvent.click(screen.getByRole('button',{name:'插入工作簿文本框'}));fireEvent.keyDown(await screen.findByRole('region',{name:'放置文本框'}),{key:'Escape'});
  expect(screen.queryByRole('region',{name:'放置文本框'})).toBeNull();expect(api.editOfficeRange).not.toHaveBeenCalled();expect(f.office!.pendingDrawing).toBeNull();expect(f.dirty).toBe(false);
 });
 it('inserts a shape through the menu, selects its new real identity and preserves cells across undo/redo and materialization',async()=>{
  const f=buffer('drawing-shape',true);render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});
  const before=clients[0].document.workbook.packageData.hashes();
  fireEvent.click(screen.getByRole('button',{name:'插入工作簿形状'}));fireEvent.click(await screen.findByRole('menuitem',{name:'菱形'}));
  const shape=await screen.findByRole('button',{name:/选择形状 Shape/});await waitFor(()=>expect(shape.getAttribute('aria-pressed')).toBe('true'));
  expect(screen.getByRole('button',{name:'格式'}).hasAttribute('disabled')).toBe(true);expect(clients[0].document.workbook.cell('1',1,1).value).toBe('3');
  fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(screen.queryByRole('button',{name:/选择形状 Shape/})).toBeNull());
  expect(clients[0].document.workbook.packageData.hashes()).toEqual(before);
  fireEvent.click(screen.getByRole('button',{name:'重做表格编辑'}));await screen.findByRole('button',{name:/选择形状 Shape/});
  const current=clients[0].document,roundtrip=await OfficePackage.read((await current.materialize(current.state().version)).bytes);
  expect(new OfficeWorkbook(roundtrip).window('1',0,0,6,6).objects?.some(value=>value.kind==='shape'&&value.shape?.geometry==='diamond')).toBe(true);
 });
 it('disables insertion for a readonly source and never issues an edit',async()=>{
  const f=buffer('drawing-readonly');render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});
  for(const name of ['插入工作簿形状','插入工作簿图表','插入工作簿图片'])expect(screen.queryByRole('button',{name})).toBeNull();
  expect(api.editOfficeRange).not.toHaveBeenCalled();
 });
});
