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
// Static reference: saved V35 w_ key handler 5905-5912 and E_ submit/blur
// 5935-5945 call commitFormulaInput without navigation. Tab/ShiftTab are
// native focus movement; jsdom requires the explicit blur below (I/U only).
// This is a new source version; the earlier 14/26/5/4 test sources stay intact.
describe('W20 formula bar original controller selection contract v2',()=>{
 const endings=[
  {name:'Enter',key:'Enter'},
  {name:'MetaEnter',key:'Enter',metaKey:true},
  {name:'CtrlEnterMac',key:'Enter',ctrlKey:true},
  {name:'Tab-native-blur',key:'Tab'},
  {name:'ShiftTab-native-blur',key:'Tab',shiftKey:true},
 ];
 it.each([false,true].flatMap(multiple=>endings.map(ending=>({multiple,...ending}))))('$name keeps $multiple original selection and only edits active B2',async({multiple,name,...ending})=>{
  const f=buffer('W20-formula-v2-'+multiple+name,true);
  render(<Preview buffer={f}/>);
  await screen.findByRole('gridcell',{name:'Label'});
  const cell=(row:number,column:number)=>document.querySelector(`[data-office-row="${row}"][data-office-column="${column}"]`)!;
  await waitFor(()=>expect(cell(2,2)).not.toBeNull());
  fireEvent.click(cell(1,1));
  if(multiple)fireEvent.click(cell(2,2),{shiftKey:true});
  const address=multiple?'B2:C3':'B2';
  await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe(address));
  const read=(row:number,column:number)=>clients[0].document.workbook.cell('1',row,column);
  const untouched=[[2,1],[1,2],[2,2]].map(([r,c])=>({r,c,value:read(r,c).value,formula:read(r,c).formula?.text}));
  fireEvent.click(screen.getByRole('button',{name:'Insert function'}));
  const input=screen.getByLabelText('公式栏');
  expect(document.activeElement).toBe(input);
  fireEvent.change(input,{target:{value:'31'}});
  fireEvent.keyDown(input,ending);
  if(ending.key==='Tab')fireEvent.blur(input);
  await waitFor(()=>expect(read(1,1).value).toBe('31'));
  await act(async()=>{});
  expect(screen.getByLabelText('当前选区').textContent).toBe(address);
  expect(screen.queryByRole('textbox',{name:'编辑 B2'})).toBeNull();
  for(const {r,c,value,formula} of untouched){expect(read(r,c).value).toBe(value);expect(read(r,c).formula?.text).toBe(formula);}
 });
});
