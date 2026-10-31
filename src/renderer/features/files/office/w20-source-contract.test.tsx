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
// v2 resolves formula submit/blur with archived E_/w_; old26 source/result retained.
describe('W20 source-audited editing contract v2 (real OOXML model; isolated IPC)',()=>{
 const at=()=>document.querySelector('[data-office-row="1"][data-office-column="1"]')!;
 async function editor(host:string,instance:string){
  const f=buffer(instance,true);render(<Preview buffer={f}/>);await screen.findByRole('gridcell',{name:'Label'});await waitFor(()=>expect(at()).not.toBeNull());fireEvent.click(at());await waitFor(()=>expect((screen.getByLabelText('公式栏')as HTMLTextAreaElement).value).toBe('3'));
  if(host==='inline'){fireEvent.doubleClick(at());return{f,input:await screen.findByRole('textbox',{name:'编辑 B2'})};}
  fireEvent.click(screen.getByRole('button',{name:'Insert function'}));const input=screen.getByLabelText('公式栏');expect(document.activeElement).toBe(input);expect((input as HTMLTextAreaElement).value).toBe('3');expect(api.editOffice).not.toHaveBeenCalled();return{f,input};
 }
 const arrows=[{key:'ArrowUp',address:'B1'},{key:'ArrowDown',address:'B3'},{key:'ArrowLeft',address:'A2'},{key:'ArrowRight',address:'C2'}];
 it.each(arrows)('inline nonformula $key commits once and selects $address',async({key,address})=>{
  const {input}=await editor('inline','W20-number-'+key);fireEvent.change(input,{target:{value:'31'}});fireEvent.keyDown(input,{key});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe(address));expect(api.editOffice).toHaveBeenCalledTimes(1);expect(clients[0].document.workbook.cell('1',1,1).value).toBe('31');expect(screen.queryByRole('textbox',{name:'编辑 B2'})).toBeNull();expect(document.activeElement).toBe(screen.getByRole('grid'));
 });
 it.each(['inline','formula'].flatMap(host=>arrows.map(x=>({host,key:x.key}))))('$host formula $key keeps the same pending editor for caret/reference editing',async({host,key})=>{
  const {f,input}=await editor(host,'W20-formula-'+host+key);fireEvent.change(input,{target:{value:'=B2+1'}});fireEvent.keyDown(input,{key});await act(async()=>{});expect(screen.getByLabelText('当前选区').textContent).toBe('B2');expect(api.editOffice).not.toHaveBeenCalled();expect(f.office!.pending?.text).toBe('=B2+1');expect(input.isConnected).toBe(true);expect((input as HTMLInputElement).value).toBe('=B2+1');
 });
 it.each(['inline','formula'].flatMap(host=>[{key:'Enter',address:'B3'},{key:'Tab',address:'C2'},{key:'Tab',shiftKey:true,address:'A2'}].map(x=>({host,...x}))))('$host $key shift=$shiftKey submits once',async({host,key,address,shiftKey})=>{
  const {input}=await editor(host,'W20-finish-'+host+key+!!shiftKey);fireEvent.change(input,{target:{value:'31'}});fireEvent.keyDown(input,{key,shiftKey});if(host==='formula'&&key==='Tab')fireEvent.blur(input);await waitFor(()=>expect(clients[0].document.workbook.cell('1',1,1).value).toBe('31'));await act(async()=>{});expect(screen.getByLabelText('当前选区').textContent).toBe(host==='formula'?'B2':address);expect(api.editOffice).toHaveBeenCalledTimes(1);
 });
 it.each(['inline','formula'])('%s Escape cancels pending input and retains the selected cell',async host=>{
  const {f,input}=await editor(host,'W20-cancel-'+host);fireEvent.change(input,{target:{value:'cancel candidate'}});fireEvent.keyDown(input,{key:'Escape'});await act(async()=>{});expect(screen.getByLabelText('当前选区').textContent).toBe('B2');expect(f.office!.pending).toBeNull();expect(api.editOffice).not.toHaveBeenCalled();expect(clients[0].document.workbook.cell('1',1,1).value).toBe('3');if(host==='inline')expect(document.activeElement).toBe(screen.getByRole('grid'));
 });
 it.each(['inline','formula'].flatMap(host=>['native-composing','key229','model-composing'].map(guard=>({host,guard}))))('$host $guard yields all completion keys without truncating pending text',async({host,guard})=>{
  const {f,input}=await editor(host,'W20-compose-'+host+guard);fireEvent.change(input,{target:{value:'中文候选🙂'}});if(guard==='model-composing')fireEvent.compositionStart(input);
  for(const key of ['Enter','Tab','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape'])fireEvent.keyDown(input,{key,...(guard==='native-composing'?{isComposing:true}:guard==='key229'?{keyCode:229}:{})});
  fireEvent.keyDown(input,{key:'Enter',metaKey:true,...(guard==='native-composing'?{isComposing:true}:guard==='key229'?{keyCode:229}:{})});await act(async()=>{});expect(screen.getByLabelText('当前选区').textContent).toBe('B2');expect(f.office!.pending?.text).toBe('中文候选🙂');expect((input as HTMLInputElement).value).toBe('中文候选🙂');expect(api.editOffice).not.toHaveBeenCalled();if(guard==='model-composing')fireEvent.compositionEnd(input);
 });
});
