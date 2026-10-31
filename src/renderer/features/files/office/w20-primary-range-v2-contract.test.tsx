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
// v2: formula bar submit does not promise a grid-focus target; original raw v1 retained.
describe('W20 Mac primary Enter original range identity v2',()=>{
 it.each(['inline','formula'].flatMap(host=>['31','=A1'].map(text=>({host,text}))))('$host MetaEnter $text preserves original B2:C3 range and exact target set',async({host,text})=>{
  const f=buffer('W20-primary-range-'+host+text,true);render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});const target=document.querySelector('[data-office-row="1"][data-office-column="1"]')!,end=document.querySelector('[data-office-row="2"][data-office-column="2"]')!;await waitFor(()=>expect(end).not.toBeNull());fireEvent.click(target);fireEvent.click(end,{shiftKey:true});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B2:C3'));
  let input:HTMLElement;if(host==='inline'){fireEvent.keyDown(screen.getByRole('grid'),{key:'F2'});input=await screen.findByRole('textbox',{name:'编辑 B2'});}else{fireEvent.click(screen.getByRole('button',{name:'Insert function'}));input=screen.getByLabelText('公式栏');}
  fireEvent.change(input,{target:{value:text}});fireEvent.keyDown(input,{key:'Enter',metaKey:true});const read=(row:number,column:number)=>{const c=clients[0].document.workbook.cell('1',row,column);return text.startsWith('=')?c.formula?.text:c.value;};await waitFor(()=>expect(read(1,1)).toBe(text.startsWith('=')?text.slice(1):text));await act(async()=>{});expect(screen.getByLabelText('当前选区').textContent).toBe('B2:C3');expect(screen.queryByRole('textbox',{name:'编辑 B2'})).toBeNull();if(host==='inline')expect(document.activeElement).toBe(screen.getByRole('grid'));
  if(host==='inline'){for(const r of [1,2])for(const c of [1,2])expect(read(r,c)).toBe(text.startsWith('=')?text.slice(1):text);}else{expect(clients[0].document.workbook.cell('1',2,1).value).toBe('4');expect(clients[0].document.workbook.cell('1',1,2).value).toBe('');expect(clients[0].document.workbook.cell('1',2,2).value).toBe('');}
 });
});
