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
import {XLSX_DRAWING_PREVIEW_NOTICE} from '@shared/office-preview-notices.mjs';

const api = vi.hoisted(() => ({ create: vi.fn(),drafts:vi.fn(),refresh:vi.fn(),editOffice:vi.fn(),officeSheet:vi.fn(),editOfficeRange:vi.fn(),officeHistory:vi.fn(),checkpointOffice:vi.fn(),saveOffice:vi.fn(),recalculateOffice:vi.fn(),resolveDraft:vi.fn() }));
vi.mock('./client', () => ({ OfficeClient: class { constructor() { return api.create(); } } }));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const clients: ReturnType<typeof client>[] = [];
const buffers:FileBuffer[]=[],listeners=new Map<FileBuffer,()=>void>();
function client(document: OfficeDocument) {
  const model=document.workbook, id:string=`test-office-${clients.length}`;
  return { id,document,ready: Promise.resolve({ id, hash: 'hash', workbook: model.info,state:document.state(),calculation:{state:'ready' as const} }), window: vi.fn(async (id, rows: number[], columns: number[]) => document.workbook.window(id, rows[0], columns[0], rows.length, columns.length, rows, columns)), cell: vi.fn(async (id, row, column) => document.workbook.cellText(id, row, column, 0, 16384)), text:vi.fn(async(id,row,column)=>{const cell=document.workbook.cell(id,row,column);return cell.formula ? `=${cell.formula.text}` : cell.value;}),range:vi.fn(async(id,range)=>readOfficeRange(document.workbook,id,range,false)),drawingImage:vi.fn(async(sheetId,objectId,mediaHash)=>document.workbook.drawingImage(sheetId,objectId,mediaHash)),copyRange:vi.fn(async()=>undefined),copy: vi.fn(async () => undefined), close: vi.fn(), async retire() { this.close(); } };
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
describe('real workbook projection in the React view (IPC boundary isolated)', () => {
  it('displays original picture bytes and selects the floating image without applying cell tools',async()=>{
    const file=await OfficePackage.read(readFileSync('src/main/core/files/office/__fixtures__/ordinary-drawing.xlsx')),before=file.hashes(),documentModel=new OfficeDocument(file);
    api.create.mockImplementation(()=>{const value=client(documentModel);clients.push(value);return value;});
    const createObjectURL=vi.fn((_blob:Blob|MediaSource)=> 'blob:owned-picture'),revokeObjectURL=vi.fn(),OriginalURL=URL;
    vi.stubGlobal('URL',class extends OriginalURL {static createObjectURL=createObjectURL;static revokeObjectURL=revokeObjectURL;});
    const host=buffer('W24-picture-selection',true),view=render(<Preview buffer={host}/>);
    const picture=await screen.findByRole('img',{name:'Public teal square'}),button=screen.getByRole('button',{name:'选择图片 Public teal square'});
    expect(picture.getAttribute('src')).toBe('blob:owned-picture');expect((createObjectURL.mock.calls[0][0] as Blob).size).toBe(73);expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('image/png');
    // The fixture's D2:F6 anchor must line up with the independently painted
    // grid. Absolute widths vary with the declared compatible font metric.
    const from=window.document.querySelector('[data-office-row="1"][data-office-column="3"]') as HTMLElement,to=window.document.querySelector('[data-office-row="5"][data-office-column="5"]') as HTMLElement;
    expect(button.style.left).toBe(from.style.left);expect(button.style.top).toBe((from.closest('[role="row"]') as HTMLElement).style.top);
    expect(parseFloat(button.style.width)).toBe(parseFloat(to.style.left)-parseFloat(from.style.left));
    expect(parseFloat(button.style.height)).toBe(parseFloat((to.closest('[role="row"]') as HTMLElement).style.top)-parseFloat((from.closest('[role="row"]') as HTMLElement).style.top));
    expect(screen.queryByText(XLSX_DRAWING_PREVIEW_NOTICE)).toBeNull();
    fireEvent.click(button);await waitFor(()=>expect(button.getAttribute('aria-pressed')).toBe('true'));
    expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).readOnly).toBe(true);expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('button',{name:'格式'}) as HTMLButtonElement).disabled).toBe(true);expect((screen.getByRole('button',{name:'Insert function'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(button,{key:'Delete'});fireEvent.keyDown(button,{key:'c',metaKey:true});fireEvent.keyDown(button,{key:'ContextMenu'});
    expect(api.editOfficeRange).not.toHaveBeenCalled();expect(api.editOffice).not.toHaveBeenCalled();expect(clients[0].copyRange).not.toHaveBeenCalled();expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull();
    expect(documentModel.workbook.packageData.hashes()).toEqual(before);expect(documentModel.state()).toMatchObject({version:0,dirty:false});
    fireEvent.keyDown(button,{key:'Escape'});await waitFor(()=>expect(button.getAttribute('aria-pressed')).toBe('false'));
    fireEvent.click(window.document.querySelector('[data-office-row="1"][data-office-column="1"]')!);
    await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('42'));
    expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).readOnly).toBe(false);expect(clients[0].drawingImage).toHaveBeenCalledTimes(1);
    view.unmount();expect(revokeObjectURL).toHaveBeenCalledWith('blob:owned-picture');
  });

  it('does not create a picture URL from a media response arriving after the view unmounts',async()=>{
    const file=await OfficePackage.read(readFileSync('src/main/core/files/office/__fixtures__/ordinary-drawing.xlsx')),model=new OfficeDocument(file),image=model.workbook.window('1',0,0,6,6).objects![0];
    expect(image.kind).toBe('image');if(image.kind!=='image')throw new Error('expected original picture');
    let finish!:(value:unknown)=>void;
    api.create.mockImplementation(()=>{const value=client(model);value.drawingImage.mockImplementation(()=>new Promise(done=>{finish=done;}) as never);clients.push(value);return value;});
    const createObjectURL=vi.fn((_blob:Blob|MediaSource)=> 'blob:late-picture'),revokeObjectURL=vi.fn(),OriginalURL=URL;
    vi.stubGlobal('URL',class extends OriginalURL {static createObjectURL=createObjectURL;static revokeObjectURL=revokeObjectURL;});
    const view=render(<Preview buffer={buffer('W24-picture-late',true)}/>);
    await waitFor(()=>expect(clients[0]?.drawingImage).toHaveBeenCalledTimes(1));view.unmount();
    await act(async()=>{finish(model.workbook.drawingImage('1',image.id,image.media.sha256));});
    expect(createObjectURL).not.toHaveBeenCalled();expect(revokeObjectURL).not.toHaveBeenCalled();expect(model.state()).toMatchObject({version:0,dirty:false});
  });
  it('W24 shows the real current-sheet drawing limitation without hiding cells or leaking it onto another sheet',async()=>{
    const host=buffer('W24-drawing-warning');render(<Preview buffer={host}/>);
    await screen.findByRole('gridcell',{name:'Label'});
    expect(await screen.findByText(XLSX_DRAWING_PREVIEW_NOTICE)).not.toBeNull();
    const before=clients[0].document.workbook.packageData.hashes();
    fireEvent.click(screen.getByRole('button',{name:'Calc'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Calc'}).getAttribute('aria-current')).toBe('page'));
    await waitFor(()=>expect(screen.queryByText(XLSX_DRAWING_PREVIEW_NOTICE)).toBeNull());
    expect(clients[0].document.workbook.packageData.hashes()).toEqual(before);
    expect(host.dirty).toBe(false);
    expect(api.editOffice).not.toHaveBeenCalled();expect(api.editOfficeRange).not.toHaveBeenCalled();expect(api.saveOffice).not.toHaveBeenCalled();
  });
  it.each(['metaKey','ctrlKey','altKey'].flatMap(modifier=>[{key:'/',code:'Slash'},{key:'ContextMenu',code:'ContextMenu'},{key:'F10',code:'F10',shiftKey:true}].map(input=>({...input,modifier}))))('W25 yields $modifier+$key without opening tools or changing source',async input=>{
    const host=buffer('W25-modifier-'+input.modifier+input.key,true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});const grid=screen.getByRole('grid'),before=clients[0].document.workbook.packageData.hashes();grid.focus();fireEvent.keyDown(grid,{...input,[input.modifier]:true});await act(async()=>{});
    expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull();expect(screen.queryByRole('textbox',{name:'编辑 A1'})).toBeNull();expect(clients[0].document.workbook.packageData.hashes()).toEqual(before);expect(host.dirty).toBe(false);expect(api.editOffice).not.toHaveBeenCalled();expect(api.editOfficeRange).not.toHaveBeenCalled();
  });
  it.each([false,true])('W25 Escape collapses the range to its active anchor without edits (writable=%s)',async writable=>{
    const host=buffer('W25-range-escape-'+writable,writable);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});const grid=screen.getByRole('grid'),at=(r:number,c:number)=>document.querySelector(`[data-office-row="${r}"][data-office-column="${c}"]`)!;
    await waitFor(()=>expect(at(1,1)).not.toBeNull());fireEvent.click(at(1,1));fireEvent.keyDown(grid,{key:'ArrowUp',shiftKey:true});fireEvent.keyDown(grid,{key:'ArrowLeft',shiftKey:true});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1:B2'));const before=clients[0].document.workbook.packageData.hashes();
    fireEvent.keyDown(grid,{key:'Escape'});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B2'));expect(document.querySelectorAll('[role=gridcell][aria-selected=true]')).toHaveLength(1);expect(host.office!.view).toMatchObject({row:1,column:1,endRow:1,endColumn:1});expect(clients[0].document.workbook.packageData.hashes()).toEqual(before);expect(host.dirty).toBe(false);expect(api.editOfficeRange).not.toHaveBeenCalled();
  });
  it('W25 dismisses an open menu before a second Escape collapses the same range',async()=>{
    const host=buffer('W25-menu-escape-order',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});const grid=screen.getByRole('grid');fireEvent.keyDown(grid,{key:'ArrowRight',shiftKey:true});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1:B1'));
    fireEvent.keyDown(grid,{key:'ContextMenu'});const menu=await screen.findByRole('menu',{name:'单元格操作'});fireEvent.keyDown(within(menu).getAllByRole('menuitem')[0],{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull());expect(screen.getByLabelText('当前选区').textContent).toBe('A1:B1');
    fireEvent.keyDown(grid,{key:'Escape'});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1'));expect(host.dirty).toBe(false);expect(api.editOffice).not.toHaveBeenCalled();
  });

  it.each([{key:'/',code:'Slash'},{key:'ContextMenu',code:'ContextMenu'},{key:'F10',code:'F10',shiftKey:true}])('W25 opens real range tools for $key without typing into the active cell',async input=>{
    const host=buffer('W25-menu-'+input.key,true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const grid=screen.getByRole('grid');grid.focus();fireEvent.keyDown(grid,input);
    const menu=await screen.findByRole('menu',{name:'单元格操作'}),items=within(menu).getAllByRole('menuitem');expect(items.map(e=>e.textContent)).toEqual(['向下填充','向右填充','合并单元格','取消合并','适应列宽','适应行高','清除内容','清除格式','全部清除']);
    expect(screen.queryByRole('textbox',{name:'编辑 A1'})).toBeNull();expect(clients[0].document.workbook.cell('1',0,0).value).toBe('Label');expect(host.office!.pending).toBeNull();
    fireEvent.keyDown(items[0],{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull());
  });
  it('W25 readonly tools and ordinary typing/deletion never mutate the workbook',async()=>{
    const host=buffer('W25-readonly');render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});const grid=screen.getByRole('grid'),before=clients[0].document.workbook.packageData.hashes();
    for(const input of [{key:'/',code:'Slash'},{key:'ContextMenu'},{key:'F10',shiftKey:true},{key:'x'},{key:'Delete'}])fireEvent.keyDown(grid,input);
    await act(async()=>{});expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull();expect(screen.queryByRole('textbox',{name:'编辑 A1'})).toBeNull();expect(host.dirty).toBe(false);expect(clients[0].document.workbook.packageData.hashes()).toEqual(before);expect(api.editOffice).not.toHaveBeenCalled();expect(api.editOfficeRange).not.toHaveBeenCalled();
  });
  it('W25 leaves slash in an active formula draft and keeps Escape cancellation local to that input',async()=>{
    const host=buffer('W25-formula',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});const formula=screen.getByLabelText('公式栏');
    fireEvent.focus(formula);fireEvent.keyDown(formula,{key:'/',code:'Slash'});fireEvent.change(formula,{target:{value:'/'}});expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull();expect((formula as HTMLTextAreaElement).value).toBe('/');expect(clients[0].document.workbook.cell('1',0,0).value).toBe('Label');
    fireEvent.keyDown(formula,{key:'Escape'});await waitFor(()=>expect((formula as HTMLTextAreaElement).value).toBe('Label'));expect(host.dirty).toBe(false);expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull();
  });

  it('W19 keeps the readonly address label, formula and function action inert while selecting a range and another sheet', async () => {
    render(<Preview buffer={buffer('W19-readonly')} />); await screen.findByRole('gridcell', { name: 'Label' });
    const address = screen.getByLabelText('当前选区'); expect(address.tagName).toBe('SPAN'); expect(address.querySelector('input,textarea')).toBeNull();
    fireEvent.click(document.querySelector('[data-office-row="1"][data-office-column="1"]')!, { shiftKey: true });
    await waitFor(() => expect(address.textContent).toBe('A1:B2'));
    const formula = screen.getByLabelText('公式栏') as HTMLTextAreaElement;
    expect(formula.readOnly).toBe(true); expect((screen.getByRole('button', { name: 'Insert function' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'F2' }); expect(screen.queryByRole('textbox', { name: /^编辑 / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Calc' })); await waitFor(() => expect(screen.getByRole('button', { name: 'Calc' }).getAttribute('aria-current')).toBe('page'));
    expect(api.editOffice).not.toHaveBeenCalled(); expect(api.officeSheet).not.toHaveBeenCalled(); expect(api.saveOffice).not.toHaveBeenCalled();
  });
  it('W23 blocks pointer and keyboard structure menus while a real queued sheet mutation is pending', async () => {
    const host = buffer('W23-busy', true); render(<Preview buffer={host} />); await screen.findByRole('gridcell', { name: 'Label' });
    const mutate = api.officeSheet.getMockImplementation()!; let release!: () => void;
    api.officeSheet.mockImplementationOnce(async input => { await new Promise<void>(done => { release = done; }); return mutate(input); });
    fireEvent.click(screen.getByRole('button', { name: '新增工作表' })); await waitFor(() => expect(release).toBeTypeOf('function'));
    expect(host.office!.busy).toBe(true);
    await waitFor(() => expect((screen.getByRole('button', { name: '新增工作表' }) as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByRole('button', { name: 'Data' }) as HTMLButtonElement).draggable).toBe(false);
    fireEvent.doubleClick(screen.getByRole('button', { name: 'Data' })); fireEvent.click(screen.getByRole('button', { name: '新增工作表' }));
    expect(screen.queryByRole('dialog', { name: '重命名工作表' })).toBeNull();
    fireEvent.contextMenu(screen.getByRole('button', { name: 'Data' })); fireEvent.keyDown(screen.getByRole('button', { name: 'Data' }), { key: 'F10', shiftKey: true });
    expect(screen.queryByRole('menu', { name: '工作表操作' })).toBeNull(); expect(api.officeSheet).toHaveBeenCalledTimes(1);
    await act(async () => release()); await screen.findByRole('button', { name: 'Sheet1' });
    expect(host.office!.busy).toBe(false); expect(clients[0].document.workbook.info.sheets).toHaveLength(4);
  });
  it('DEV156 reloads the selected formula text and editing capability after a clean external refresh finishes opening',async()=>{
    const host=buffer('external-clean',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).readOnly).toBe(false));
    const create=api.create.getMockImplementation()!;let deliver!:()=>void;
    api.create.mockImplementationOnce(()=>{const value=create(),ready=value.ready;value.ready=new Promise(resolve=>{deliver=()=>{void ready.then(resolve);};});return value;});
    api.refresh.mockResolvedValue({...host.file,revision:{...host.file.revision,hash:'external-clean-new'}});
    let refreshing!:Promise<void>;await act(async()=>{refreshing=host.refresh();});await waitFor(()=>expect(deliver).toBeTypeOf('function'));
    expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).readOnly).toBe(true);
    await act(async()=>{deliver();await refreshing;});
    await waitFor(()=>{const input=screen.getByLabelText('公式栏') as HTMLTextAreaElement;expect(input.value).toBe('Label');expect(input.readOnly).toBe(false);});
    expect(host.dirty).toBe(false);expect(host.conflict).toBe(false);expect(clients[0].close).toHaveBeenCalledTimes(1);expect(clients[1].cell).toHaveBeenCalled();
  });
  it('keeps RGB intermediate input local and commits the final color once, before save',async()=>{
    const host=buffer('color-picker',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const color=screen.getByLabelText('单元格文字颜色') as HTMLInputElement;
    fireEvent.focus(color);
    for(const value of ['#010000','#120000','#b40000'])fireEvent.input(color,{target:{value}});
    expect(color.value).toBe('#b40000');expect(color.matches(':disabled')).toBe(false);expect(api.editOfficeRange).not.toHaveBeenCalled();
    fireEvent.change(color,{target:{value:'#b40000'}});
    await waitFor(()=>expect(api.editOfficeRange).toHaveBeenCalledTimes(1));
    expect(api.editOfficeRange.mock.calls[0][0].action.format).toEqual({font:{color:'#b40000'}});
    fireEvent.blur(color);await act(()=>host.save());
    expect(api.editOfficeRange).toHaveBeenCalledTimes(1);expect(host.dirty).toBe(false);
    const page=clients[0].document.workbook.window('1',0,0,1,1);
    expect(page.styles[page.cells[0].style].font?.color?.toLowerCase()).toBe('#b40000');
    fireEvent.focus(color);fireEvent.input(color,{target:{value:'#00ff00'}});
    fireEvent.input(color,{target:{value:'#b40000'}});fireEvent.change(color);fireEvent.blur(color);
    expect(api.editOfficeRange).toHaveBeenCalledTimes(1);expect(host.dirty).toBe(false);
  });
  it('opens the newly selected cell with F2 while its formula-bar read is delayed',async()=>{
    const host=buffer('cell-read-race',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const at=(row:number)=>document.querySelector(`[data-office-row="${row}"][data-office-column="1"]`)!;
    await waitFor(()=>expect(at(2)).not.toBeNull());fireEvent.click(at(2));
    await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('4'));
    const current=clients[0],originalRead=current.cell.getMockImplementation()!;
    let release!:(value:ReturnType<OfficeWorkbook['cellText']>)=>void;
    current.cell.mockImplementation((id,row,column)=>row===1 && column===1 ? new Promise(resolve=>{release=resolve;}) : originalRead(id,row,column));
    fireEvent.keyDown(screen.getByRole('grid'),{key:'ArrowUp'});
    await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B2'));
    expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).not.toBe('4');
    fireEvent.keyDown(screen.getByRole('grid'),{key:'F2'});
    const input=await screen.findByRole('textbox',{name:'编辑 B2'});
    expect((input as HTMLInputElement).value).toBe('3');
    await act(async()=>release(current.document.workbook.cellText('1',1,1,0,16384)));
    expect((screen.getByRole('textbox',{name:'编辑 B2'}) as HTMLInputElement).value).toBe('3');
    fireEvent.keyDown(input,{key:'Escape'});
    expect(current.document.workbook.cell('1',1,1).value).toBe('3');expect(current.document.workbook.cell('1',2,1).value).toBe('4');
    expect(api.editOffice).not.toHaveBeenCalled();
  });
  it('keeps a quota failure visible after focus refresh and reloads the grid once capacity is available',async()=>{
    const create=api.create.getMockImplementation()!;
    let available=false;
    api.create.mockImplementation(()=>available ? create() : {id:'quota-failure',ready:Promise.reject(new Error('[TOO_LARGE] Office 活动文档数量已达上限')),close:vi.fn()});
    const host=buffer('quota',true);api.refresh.mockResolvedValue(host.file);
    render(<Preview buffer={host}/>);
    await screen.findByText('Office 活动文档数量已达上限');
    await act(()=>host.refresh());
    expect(screen.getByText('Office 活动文档数量已达上限')).toBeTruthy();
    expect(screen.queryByText('正在读取工作簿…')).toBeNull();
    available=true;fireEvent.click(screen.getByRole('button',{name:'重新加载'}));
    await screen.findByRole('gridcell',{name:'Label'});
    expect(screen.queryByText('Office 活动文档数量已达上限')).toBeNull();
  });
  it('inserts actual controls for the selected cells through the inspector and removes the whole closure on undo',async()=>{
    const host=buffer('insert-checkbox',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const at=(row:number)=>document.querySelector(`[data-office-row="${row}"][data-office-column="1"]`)!;
    await waitFor(()=>expect(at(1)).not.toBeNull());fireEvent.click(at(1));fireEvent.click(at(2),{shiftKey:true});fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const insert=await screen.findByRole('button',{name:'插入复选框'});await waitFor(()=>expect((insert as HTMLButtonElement).disabled).toBe(false));fireEvent.click(insert);
    const first=await screen.findByRole('checkbox',{name:'B2 复选框'}) as HTMLInputElement;await screen.findByRole('checkbox',{name:'B3 复选框'});expect(first.checked).toBe(false);expect(at(1).textContent).toBe('');
    fireEvent.click(first);await waitFor(()=>expect(first.checked).toBe(true));expect(clients[0].document.workbook.cell('1',1,1).value).toBe('TRUE');
    await waitFor(()=>expect((screen.getByRole('button',{name:'撤销表格编辑'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect((screen.getByRole('checkbox',{name:'B2 复选框'}) as HTMLInputElement).checked).toBe(false));
    await waitFor(()=>expect((screen.getByRole('button',{name:'撤销表格编辑'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(at(1)?.textContent).toBe('3'));expect(screen.queryByRole('checkbox',{name:'B2 复选框'})).toBeNull();
  });
  it('toggles an anchored form checkbox after flushing other input, then saves and undoes the synchronized state',async()=>{
    const source=await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/checkbox/checkbox.xlsx'));
    api.create.mockImplementation(()=>{const value=client(new OfficeDocument(source));clients.push(value);return value;});
    const host=buffer('checkbox',true);render(<Preview buffer={host}/>);
    const checkbox=await screen.findByRole('checkbox',{name:'M9 checkbox'}) as HTMLInputElement;expect(checkbox.checked).toBe(true);expect(checkbox.closest('label')?.style.top).not.toBe('0px');
    const cell=document.querySelector('[data-office-row="0"][data-office-column="0"]')!;fireEvent.doubleClick(cell);const input=await screen.findByRole('textbox',{name:'编辑 A1'});fireEvent.change(input,{target:{value:'pending label'}});
    fireEvent.click(checkbox);await waitFor(()=>expect(checkbox.checked).toBe(false));expect(clients[0].document.workbook.cell('1',0,0).value).toBe('pending label');expect(clients[0].document.workbook.cell('1',1,1).value).toBe('FALSE');
    expect(api.editOffice.mock.calls.map(([request])=>[request.version,request.edit.text])).toEqual([[0,'pending label'],[1,'FALSE']]);
    await waitFor(()=>expect((screen.getByRole('button',{name:'保存工作簿'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'保存工作簿'}));await waitFor(()=>expect(host.dirty).toBe(false));
    fireEvent.keyDown(checkbox,{key:'z',metaKey:true});await waitFor(()=>expect((screen.getByRole('checkbox',{name:'M9 checkbox'}) as HTMLInputElement).checked).toBe(true));expect(clients[0].document.workbook.cell('1',0,0).value).toBe('pending label');
  });
  it('preserves invalid pending formula input when a checkbox cannot proceed and disables read-only controls',async()=>{
    const source=await OfficePackage.read(readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/checkbox/checkbox.xlsx'));
    api.create.mockImplementation(()=>{const value=client(new OfficeDocument(source));clients.push(value);return value;});
    const host=buffer('checkbox-invalid',true),view=render(<Preview buffer={host}/>);const checkbox=await screen.findByRole('checkbox',{name:'M9 checkbox'}) as HTMLInputElement;
    fireEvent.doubleClick(document.querySelector('[data-office-row="0"][data-office-column="0"]')!);const input=await screen.findByRole('textbox',{name:'编辑 A1'});fireEvent.change(input,{target:{value:'='}});fireEvent.click(checkbox);
    await waitFor(()=>expect(host.saveError).toContain('公式为空'));expect(checkbox.checked).toBe(true);expect(host.getOffice().pending?.text).toBe('=');expect(clients[0].document.workbook.packageData.hashes()).toEqual(source.hashes());
    view.unmount();render(<Preview buffer={buffer('checkbox-readonly')}/>);expect((await screen.findByRole('checkbox',{name:'M9 checkbox'}) as HTMLInputElement).disabled).toBe(true);
  });
  it('applies a dynamic threshold through the inspector, retains base fill and restores the condition through undo',async()=>{
    const host=buffer('conditional',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const at=()=>document.querySelector('[data-office-row="1"][data-office-column="1"]') as HTMLElement;await waitFor(()=>expect(at()).not.toBeNull());fireEvent.click(at());fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const threshold=await screen.findByRole('spinbutton',{name:'条件填充阈值'});await waitFor(()=>expect((threshold as HTMLInputElement).disabled).toBe(false));fireEvent.focus(threshold);fireEvent.change(threshold,{target:{value:'2'}});fireEvent.keyDown(threshold,{key:'Enter'});
    await waitFor(()=>expect(at().style.backgroundColor).toBe('rgb(255, 240, 200)'));expect(clients[0].document.workbook.cell('1',1,1).conditional?.threshold).toBe(2);
    fireEvent.doubleClick(at());const edit=await screen.findByRole('textbox',{name:'编辑 B2'});fireEvent.change(edit,{target:{value:'1'}});fireEvent.keyDown(edit,{key:'Enter'});await waitFor(()=>expect(at().style.backgroundColor).not.toBe('rgb(255, 240, 200)'));
    fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(at().style.backgroundColor).toBe('rgb(255, 240, 200)'));
    const clear=screen.getByRole('spinbutton',{name:'条件填充阈值'});await waitFor(()=>expect((clear as HTMLInputElement).disabled).toBe(false));fireEvent.focus(clear);fireEvent.change(clear,{target:{value:''}});fireEvent.keyDown(clear,{key:'Enter'});await waitFor(()=>expect(clients[0].document.workbook.cell('1',1,1).conditional).toBeUndefined());await waitFor(()=>expect(at().style.backgroundColor).not.toBe('rgb(255, 240, 200)'));
  });
  it('keeps rejected validated input available for correction, then permits text after explicitly removing the rule',async()=>{
    const host=buffer('validation',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const at=()=>document.querySelector('[data-office-row="1"][data-office-column="1"]')!;await waitFor(()=>expect(at()).not.toBeNull());fireEvent.click(at());fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const validation=await screen.findByRole('combobox',{name:'数据验证'});await waitFor(()=>expect((validation as HTMLSelectElement).disabled).toBe(false));fireEvent.change(validation,{target:{value:'number'}});
    await waitFor(()=>expect(clients[0].document.workbook.cell('1',1,1).validation).toBe('number'));fireEvent.doubleClick(at());
    const edit=await screen.findByRole('textbox',{name:'编辑 B2'});fireEvent.change(edit,{target:{value:'rejected text'}});fireEvent.keyDown(edit,{key:'Enter'});
    await waitFor(()=>expect(host.saveError).toContain('仅接受'));expect(clients[0].document.workbook.cell('1',1,1).value).toBe('3');expect((edit as HTMLInputElement).value).toBe('rejected text');expect(host.getOffice().pending?.text).toBe('rejected text');
    fireEvent.keyDown(edit,{key:'Escape'});fireEvent.change(screen.getByRole('combobox',{name:'数据验证'}),{target:{value:'none'}});await waitFor(()=>expect(clients[0].document.workbook.cell('1',1,1).validation).toBeUndefined());
    fireEvent.doubleClick(at());const retry=await screen.findByRole('textbox',{name:'编辑 B2'});fireEvent.change(retry,{target:{value:'allowed text'}});fireEvent.keyDown(retry,{key:'Enter'});await waitFor(()=>expect(clients[0].document.workbook.cell('1',1,1).value).toBe('allowed text'));
  });
  it('flushes active text before fit, preserves it on a measurement failure and restores dimensions on undo after retry',async()=>{
    let reject=true;
    api.editOfficeRange.mockImplementation(async input=>{
      const current=clients.find(client=>client.id===input.id)!.document;
      if(reject)throw new Error('本机缺少字体；原尺寸保留');
      const plan=prepareOfficeFit(current.workbook,input.action),measured={digitWidth:7,lineHeight:22,items:plan.input.items.map(()=>({width:147,height:27})),fonts:['isolated metrics']};
      const candidate=await current.prepareRange(input.version,input.action,measured);return {state:current.commitRange(input.version,candidate.token),calculation:{state:'ready'}};
    });
    const host=buffer('fit',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect(document.querySelector('[data-office-row="1"][data-office-column="1"]')).not.toBeNull());
    const cell=document.querySelector('[data-office-row="1"][data-office-column="1"]')!;fireEvent.doubleClick(cell);
    const edit=await screen.findByRole('textbox',{name:'编辑 B2'});fireEvent.change(edit,{target:{value:'input before fit'}});fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const fit=await screen.findByRole('button',{name:'适应列宽'});await waitFor(()=>expect((fit as HTMLButtonElement).disabled).toBe(false));fireEvent.click(fit);
    await waitFor(()=>expect(host.saveError).toContain('缺少字体'));expect(clients[0].document.workbook.cell('1',1,1).value).toBe('input before fit');expect(host.dirty).toBe(true);expect(api.editOfficeRange).toHaveBeenCalledWith(expect.objectContaining({version:1,action:expect.objectContaining({type:'fit',axis:'column'})}));
    const before=clients[0].document.workbook.info.sheets[0].columnSizes;reject=false;await waitFor(()=>expect((fit as HTMLButtonElement).disabled).toBe(false));fireEvent.click(fit);
    await waitFor(()=>expect(clients[0].document.workbook.info.sheets[0].columnSizes.find(c=>c.first===1)?.pixels).toBe(147));
    fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(clients[0].document.workbook.info.sheets[0].columnSizes).toEqual(before));expect(clients[0].document.workbook.cell('1',1,1).value).toBe('input before fit');
  });
  it('formats the selected range in the real model, retains values on save and preserves native input undo in the inspector',async()=>{
    const host=buffer('format',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const at=(row:number,column:number)=>document.querySelector(`[data-office-row="${row}"][data-office-column="${column}"]`)!;
    await waitFor(()=>expect(at(1,1)).not.toBeNull());fireEvent.click(at(1,1));fireEvent.click(at(2,1),{shiftKey:true});fireEvent.click(screen.getByRole('button',{name:'格式'}));
    const bold=await screen.findByRole('button',{name:'加粗'});await waitFor(()=>expect((bold as HTMLButtonElement).disabled).toBe(false));fireEvent.click(bold);
    await waitFor(()=>expect(bold.getAttribute('aria-pressed')).toBe('true'));
    const size=screen.getByRole('spinbutton',{name:'单元格字号'});fireEvent.focus(size);fireEvent.change(size,{target:{value:'20'}});fireEvent.keyDown(size,{key:'Enter'});
    await waitFor(()=>expect(clients[0].document.workbook.styles.get(clients[0].document.workbook.cell('1',1,1).style).font?.points).toBe(15));
    await waitFor(()=>expect((size as HTMLInputElement).disabled).toBe(false));
    fireEvent.keyDown(size,{key:'z',metaKey:true});expect(api.officeHistory).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('combobox',{name:'数值格式'}),{target:{value:'currency'}});
    await waitFor(()=>expect(at(1,1).textContent).toBe('¥3.00'));expect(at(2,1).textContent).toBe('¥4.00');
    expect(clients[0].document.workbook.cell('1',1,1).value).toBe('3');expect(clients[0].document.workbook.cell('1',0,0).style).toBe(0);
    await waitFor(()=>expect((screen.getByRole('button',{name:'保存工作簿'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'保存工作簿'}));await waitFor(()=>expect(host.dirty).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'关闭格式面板'}));expect(screen.queryByLabelText('单元格格式')).toBeNull();expect(document.activeElement).toBe(screen.getByRole('grid'));
  });
  it('selects a complete range, copies/statistics via the model and restores the range with atomic fill undo/redo',async()=>{
    const host=buffer('range',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const at=(row:number,column:number)=>document.querySelector(`[data-office-row="${row}"][data-office-column="${column}"]`)!;
    await waitFor(()=>expect(at(1,1)).not.toBeNull());fireEvent.click(at(1,1));await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B2'));
    fireEvent.click(at(2,1),{shiftKey:true});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B2:B3'));
    await waitFor(()=>expect(screen.getByLabelText('选区统计').textContent).toContain('合计 7'));
    fireEvent.keyDown(screen.getByRole('grid'),{key:'c',metaKey:true});expect(clients[0].copyRange).toHaveBeenCalledWith('1',{firstRow:1,lastRow:2,firstColumn:1,lastColumn:1});
    fireEvent.contextMenu(at(2,1));fireEvent.click(await screen.findByRole('menuitem',{name:'向下填充'}));
    await waitFor(()=>expect(clients[0].document.workbook.cell('1',2,1).value).toBe('3'));
    fireEvent.click(at(0,0));await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1'));
    fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B2:B3'));
    expect(clients[0].document.workbook.cell('1',2,1).value).toBe('4');
    fireEvent.click(screen.getByRole('button',{name:'重做表格编辑'}));await waitFor(()=>expect(clients[0].document.workbook.cell('1',2,1).value).toBe('3'));
    await waitFor(()=>expect(document.querySelectorAll('[role=gridcell][aria-selected=true]')).toHaveLength(2));
  });
  it('extends keyboard selection, merges without dropping values and unmerges from its complete region',async()=>{
    render(<Preview buffer={buffer('merge',true)}/>);await screen.findByRole('gridcell',{name:'Label'});const grid=screen.getByRole('grid');
    fireEvent.keyDown(grid,{key:'ArrowRight',shiftKey:true});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1:B1'));
    fireEvent.keyDown(grid,{key:'ContextMenu'});fireEvent.click(await screen.findByRole('menuitem',{name:'合并单元格'}));
    await waitFor(()=>expect(document.querySelector('[data-office-row="0"][data-office-column="0"]')?.getAttribute('aria-colspan')).toBe('2'));
    expect(clients[0].document.workbook.cell('1',0,1).value).toBe('Value');
    fireEvent.keyDown(grid,{key:'F10',shiftKey:true});fireEvent.click(await screen.findByRole('menuitem',{name:'取消合并'}));
    await waitFor(()=>expect(document.querySelector('[data-office-row="0"][data-office-column="1"]')).not.toBeNull());
  });
  it('drags a range through the grid and keeps it after the release click',async()=>{
    render(<Preview buffer={buffer('drag',true)}/>);await screen.findByRole('gridcell',{name:'Label'});
    const grid=screen.getByRole('grid');await waitFor(()=>expect(document.querySelector('[data-office-row="1"][data-office-column="1"]')).not.toBeNull());
    // jsdom lacks PointerEvent; construct the actual pointer fields explicitly.
    const pointer=(target:Element,type:string,x:number,y:number)=>{const event=new MouseEvent(type,{bubbles:true,cancelable:true,clientX:x,clientY:y,button:0});Object.defineProperty(event,'pointerId',{value:1});fireEvent(target,event);};
    const a=document.querySelector('[data-office-row="0"][data-office-column="0"]')!;
    vi.spyOn(grid,'getBoundingClientRect').mockReturnValue({x:0,y:0,left:0,top:0,right:500,bottom:420,width:500,height:420,toJSON(){}});
    pointer(a,'pointerdown',45,35);await act(async()=>{});pointer(grid,'pointermove',110,80);pointer(grid,'pointerup',110,80);fireEvent.click(a);
    await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1:B3'));
    expect(document.querySelectorAll('[role=gridcell][aria-selected=true]')).toHaveLength(6);
  });
  it('keeps invalid formula input and its original selection when right-click tries to prepare a different range',async()=>{
    const host=buffer('pending-menu',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).readOnly).toBe(false));
    fireEvent.change(screen.getByLabelText('公式栏'),{target:{value:'='}});
    await waitFor(()=>expect(document.querySelector('[data-office-row="2"][data-office-column="1"]')).not.toBeNull());fireEvent.contextMenu(document.querySelector('[data-office-row="2"][data-office-column="1"]')!);
    await waitFor(()=>expect(host.saveError).toContain('公式'));expect(screen.queryByRole('menu',{name:'单元格操作'})).toBeNull();
    expect(screen.getByLabelText('当前选区').textContent).toBe('A1');expect(host.office!.pending?.text).toBe('=');expect(api.editOfficeRange).not.toHaveBeenCalled();
  });
  it('restores the deleted active sheet and range on undo, then restores the fallback sheet on redo',async()=>{
    const host=buffer('history-sheet',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    const grid=screen.getByRole('grid');fireEvent.keyDown(grid,{key:'ArrowDown',shiftKey:true});await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A1:A2'));
    fireEvent.contextMenu(screen.getByRole('button',{name:'Data'}));fireEvent.click(await screen.findByRole('menuitem',{name:'删除'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Calc'}).getAttribute('aria-current')).toBe('page'));
    fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Data'}).getAttribute('aria-current')).toBe('page'));
    expect(screen.getByLabelText('当前选区').textContent).toBe('A1:A2');
    fireEvent.click(screen.getByRole('button',{name:'重做表格编辑'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Data'})).toBeNull());
    await waitFor(()=>{expect(screen.getByRole('button',{name:'Calc'}).getAttribute('aria-current')).toBe('page');expect(screen.getByLabelText('当前选区').textContent).toBe('A1');});
  });
  it('opens the sheet menu by mouse and keyboard, renames its target and keeps a different active sheet after deletion',async()=>{
    const host=buffer('sheet-menu',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    fireEvent.contextMenu(screen.getByRole('button',{name:'Spare'}));fireEvent.click(await screen.findByRole('menuitem',{name:'查看工作表'}));
    await waitFor(()=>expect(screen.getByRole('button',{name:'Spare'}).getAttribute('aria-current')).toBe('page'));
    fireEvent.keyDown(screen.getByRole('button',{name:'Spare'}),{key:'F10',shiftKey:true});fireEvent.click(await screen.findByRole('menuitem',{name:'重命名'}));
    const name=await screen.findByRole('textbox',{name:'工作表新名称'});fireEvent.change(name,{target:{value:'Extra'}});fireEvent.submit(name.closest('form')!);
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());await screen.findByRole('button',{name:'Extra'});
    fireEvent.contextMenu(screen.getByRole('button',{name:'Data'}));fireEvent.click(await screen.findByRole('menuitem',{name:'删除'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Data'})).toBeNull());
    expect(screen.getByRole('button',{name:'Extra'}).getAttribute('aria-current')).toBe('page');expect(clients[0].document.workbook.cell('2',1,1).formula?.text).toBe('#REF!+#REF!');
    fireEvent.contextMenu(screen.getByRole('button',{name:'Extra'}));fireEvent.click(await screen.findByRole('menuitem',{name:'删除'}));
    await waitFor(()=>expect(screen.queryByRole('button',{name:'Extra'})).toBeNull());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Calc'}).getAttribute('aria-current')).toBe('page'));
    fireEvent.contextMenu(screen.getByRole('button',{name:'Calc'}));const remove=await screen.findByRole('menuitem',{name:'删除'});
    expect(remove.getAttribute('aria-disabled')).toBe('true');fireEvent.click(remove);expect(clients[0].document.workbook.info.sheets).toHaveLength(1);
  });
  it('keeps sheet selection available while a readonly source suppresses structure actions and menus',async()=>{
    render(<Preview buffer={buffer('sheet-readonly')}/>);await screen.findByRole('gridcell',{name:'Label'});
    expect((screen.getByRole('button',{name:'新增工作表'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'Data'}) as HTMLButtonElement).draggable).toBe(false);
    fireEvent.doubleClick(screen.getByRole('button',{name:'Data'})); fireEvent.click(screen.getByRole('button',{name:'新增工作表'}));
    expect(screen.queryByRole('dialog',{name:'重命名工作表'})).toBeNull(); expect(api.officeSheet).not.toHaveBeenCalled();
    const target=screen.getByRole('button',{name:'Calc'});fireEvent.contextMenu(target);fireEvent.keyDown(target,{key:'ContextMenu'});fireEvent.doubleClick(target);
    expect(screen.queryByRole('menu',{name:'工作表操作'})).toBeNull();expect(screen.queryByRole('dialog')).toBeNull();expect(api.officeSheet).not.toHaveBeenCalled();
    fireEvent.click(target);await waitFor(()=>expect(target.getAttribute('aria-current')).toBe('page'));
  });
  it('keeps rename errors and composition text in the modal, then applies a valid name without changing sheet identity',async()=>{
    const host=buffer('rename',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    fireEvent.doubleClick(screen.getByRole('button',{name:'Data'}));const input=await screen.findByRole('textbox',{name:'工作表新名称'});
    fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'中文'}});fireEvent.submit(input.closest('form')!);
    expect(api.officeSheet).not.toHaveBeenCalled();fireEvent.compositionEnd(input);
    fireEvent.change(input,{target:{value:'Calc'}});fireEvent.submit(input.closest('form')!);await screen.findByText('已有同名工作表');
    expect(screen.getByRole('textbox',{name:'工作表新名称'})).toBe(input);expect(host.dirty).toBe(false);
    fireEvent.change(input,{target:{value:'中文工作表'}});fireEvent.submit(input.closest('form')!);
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(screen.getByRole('button',{name:'中文工作表'}).getAttribute('aria-current')).toBe('page');
    expect(clients[0].document.workbook.info.sheets[0].id).toBe('1');expect(host.saveError).toBe('');expect(host.dirty).toBe(true);
  });
  it('flushes input before adding a sheet, preserves selection on reorder and falls back after undo removes the active sheet',async()=>{
    const host=buffer('sheets',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('Label'));
    fireEvent.change(screen.getByLabelText('公式栏'),{target:{value:'Before new sheet'}});
    fireEvent.click(screen.getByRole('button',{name:'新增工作表'}));
    const added=await screen.findByRole('button',{name:'Sheet1'});await waitFor(()=>expect(added.getAttribute('aria-current')).toBe('page'));
    expect(clients[0].document.workbook.cell('1',0,0).value).toBe('Before new sheet');
    const dataTransfer={effectAllowed:'',dropEffect:'',setData:vi.fn()};
    fireEvent.dragStart(added,{dataTransfer});fireEvent.dragOver(screen.getByRole('button',{name:'Data'}),{dataTransfer});fireEvent.drop(screen.getByRole('button',{name:'Data'}),{dataTransfer});
    await waitFor(()=>expect(clients[0].document.workbook.info.sheets[0].name).toBe('Sheet1'));expect(added.getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(clients[0].document.workbook.info.sheets.at(-1)?.name).toBe('Sheet1'));
    fireEvent.click(screen.getByRole('button',{name:'撤销表格编辑'}));await waitFor(()=>expect(screen.queryByRole('button',{name:'Sheet1'})).toBeNull());
    await waitFor(()=>expect(screen.getByRole('button',{name:'Data'}).getAttribute('aria-current')).toBe('page'));expect(host.dirty).toBe(true);
  });
  it('edits inside a cell, commits once on Enter and moves with Tab/Shift+Tab',async()=>{
    render(<Preview buffer={buffer('editable',true)}/>); await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect(document.querySelector('[role=gridcell][aria-rowindex="3"][aria-colindex="3"]')).not.toBeNull());
    const target=document.querySelector('[role=gridcell][aria-rowindex="3"][aria-colindex="3"]')!;
    fireEvent.click(target); await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('3'));
    fireEvent.doubleClick(target); const input=await screen.findByRole('textbox',{name:'编辑 B2'});
    fireEvent.change(input,{target:{value:'12'}}); fireEvent.keyDown(input,{key:'Enter'});
    await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B3'));
    expect(api.editOffice).toHaveBeenCalledTimes(1); expect(clients[0].document.workbook.cell('1',1,1).value).toBe('12');
    fireEvent.keyDown(screen.getByRole('grid'),{key:'Tab',shiftKey:true}); await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('A3'));
    fireEvent.keyDown(screen.getByRole('grid'),{key:'Tab'}); await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('B3'));
  });
  it('keeps the focused editor after save and preserves typing back to its pre-save value',async()=>{
    const host=buffer('save-inline',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect(document.querySelector('[role=gridcell][aria-rowindex="3"][aria-colindex="3"]')).not.toBeNull());
    fireEvent.doubleClick(document.querySelector('[role=gridcell][aria-rowindex="3"][aria-colindex="3"]')!);
    const input=await screen.findByRole('textbox',{name:'编辑 B2'});
    fireEvent.change(input,{target:{value:'12'}}); fireEvent.keyDown(input,{key:'s',metaKey:true});
    await waitFor(()=>expect(host.dirty).toBe(false)); expect((input as HTMLInputElement).value).toBe('12');expect(document.activeElement).toBe(input);
    fireEvent.change(input,{target:{value:'3'}});expect(host.dirty).toBe(true);fireEvent.keyDown(input,{key:'Tab'});
    await waitFor(()=>expect(screen.getByLabelText('当前选区').textContent).toBe('C2'));
    expect(clients[0].document.workbook.cell('1',1,1).value).toBe('3');expect(api.editOffice).toHaveBeenCalledTimes(2);
  });
  it('does not commit composition keystrokes and retains rejected input until Escape',async()=>{
    const host=buffer('composition',true);render(<Preview buffer={host}/>);await screen.findByRole('gridcell',{name:'Label'});
    await waitFor(()=>expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('Label'));
    fireEvent.keyDown(screen.getByRole('grid'),{key:'F2'});const input=await screen.findByRole('textbox',{name:'编辑 A1'});
    fireEvent.compositionStart(input);fireEvent.change(input,{target:{value:'中文'}});fireEvent.keyDown(input,{key:'Enter',isComposing:true});
    expect(api.editOffice).not.toHaveBeenCalled();expect(screen.getByLabelText('当前选区').textContent).toBe('A1');
    fireEvent.compositionEnd(input);fireEvent.change(input,{target:{value:'='}});fireEvent.keyDown(input,{key:'Enter'});
    await waitFor(()=>expect(host.saveError).toContain('公式'));expect(screen.getByRole('textbox',{name:'编辑 A1'})).toBe(input);expect(host.office!.pending?.text).toBe('=');
    fireEvent.keyDown(input,{key:'Escape'});await waitFor(()=>expect(screen.queryByRole('textbox',{name:'编辑 A1'})).toBeNull());
    expect(host.dirty).toBe(false);expect(clients[0].document.workbook.cell('1',0,0).value).toBe('Label');
  });
  it('shows actual sheets, values and shared formulas, with an inert readonly formula bar', async () => {
    render(<Preview buffer={buffer()} />); await screen.findByRole('gridcell',{name:'Label'});
    fireEvent.click(screen.getByRole('button', { name: 'Calc' }));
    await waitFor(() => expect(clients[0].window.mock.calls.some((args) => args[0] === '2')).toBe(true));
    await waitFor(() => expect(document.querySelector('[role=gridcell][aria-rowindex="13"][aria-colindex="3"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[role=gridcell][aria-rowindex="13"][aria-colindex="3"]')!);
    await waitFor(() => expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).value).toBe('=Data!B3*2'));
    expect((screen.getByLabelText('公式栏') as HTMLTextAreaElement).readOnly).toBe(true); expect((screen.getByRole('button', { name: 'Insert function' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '复制完整单元格内容' })); expect(clients[0].copy).toHaveBeenCalledWith('2', 11, 1);
    expect(document.querySelectorAll('[role=gridcell]').length).toBeLessThanOrEqual(4000);
    expect([...document.querySelectorAll('[role=gridcell]')].every((cell) => cell.parentElement?.getAttribute('role') === 'row')).toBe(true);
  });
  it('supports end/home navigation and suppresses navigation during composition', async () => {
    render(<Preview buffer={buffer()} />); await screen.findByRole('gridcell',{name:'Label'});
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'End', ctrlKey: true });
    await waitFor(() => expect(screen.getByLabelText('当前选区').textContent).toBe('B3'));
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Home', ctrlKey: true, isComposing: true }); expect(screen.getByLabelText('当前选区').textContent).toBe('B3');
    fireEvent.keyDown(screen.getByRole('grid'), { key: 'Home', metaKey: true }); await waitFor(() => expect(screen.getByLabelText('当前选区').textContent).toBe('A1'));
  });
  it('retains unmounted document sessions and ignores a late old viewport response', async () => {
    const first=buffer(), view = render(<Preview buffer={first} />); await screen.findByRole('gridcell',{name:'Label'});
    let finish!: (value: ReturnType<OfficeWorkbook['window']>) => void;
    clients[0].window.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    fireEvent.scroll(screen.getByRole('grid'), { target: { scrollTop: 200 } }); await waitFor(() => expect(finish).toBeTypeOf('function'));
    view.rerender(<Preview buffer={buffer('two')} />); await screen.findByRole('gridcell',{name:'Label'});
    await act(async () => finish({ sheetId: '1', startRow: 0, startColumn: 0, rows: 1, columns: 1, rowIndices: [0], columnIndices: [0], merges: [], styles: {}, cells: [{ address: 'A1', row: 0, column: 0, type: 'string', value: 'STALE', display: 'STALE', style: 0, truncated: false }] }));
    expect(screen.queryByText('STALE')).toBeNull(); expect(clients[0].close).not.toHaveBeenCalled(); first.dispose(); expect(clients[0].close).toHaveBeenCalled();
  });
  it('reports parse failure and can load a fresh session after retry', async () => {
    api.create.mockImplementationOnce(() => ({ ready: Promise.reject(new Error('测试损坏工作簿')), close: vi.fn() }));
    const host=buffer();api.refresh.mockResolvedValue(host.file);
    render(<Preview buffer={host} />); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '重新加载' })); await screen.findByRole('gridcell',{name:'Label'});
  });
});
