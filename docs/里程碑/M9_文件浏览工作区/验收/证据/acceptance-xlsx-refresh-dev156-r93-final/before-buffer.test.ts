// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { FileBuffer } from '../file-buffer';
import type { OfficeEditState,OfficeSaveResult } from '@shared/file-office';
const api=vi.hoisted(()=>Object.fromEntries(['openOffice','closeOffice','drafts','editOffice','checkpointOffice','saveOffice','recalculateOffice','officeHistory','officeSheet','editOfficeRange','refresh','rebaseOffice','resolveDraft','restoreOffice','closeDocument'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const workbook={kind:'xlsx' as const,sheets:[{id:'1',name:'Sheet',hidden:'visible' as const,rows:10,columns:10,protected:false,defaultRowHeight:20,defaultColumnWidth:80,rowSizes:[],columnSizes:[]}],date1904:false,signed:false,externalLinks:0,protected:false};
const state=(version=0,dirty=false):OfficeEditState=>({version,dirty,canUndo:version>0,canRedo:false,workbook});
const file={ref:{id:'document',lease:'root',generation:1},name:'book.xlsx',relativePath:'book.xlsx',absolutePath:'/synthetic/book.xlsx',documentKey:'local:1:2',revision:{hash:'base',device:'1',inode:'2',size:100,modifiedNs:'1',changedNs:'1'},writable:true};
let buffer:FileBuffer,version:number;
const saved=(input:{opId:string;draftId:string;version:number;bufferVersion:number}):OfficeSaveResult=>({state:state(input.version),calculation:{state:'ready'},receipt:{opId:input.opId,bufferVersion:input.bufferVersion,state:'saved',revision:{...file.revision,hash:`saved-${input.bufferVersion}`,inode:'3'}},checkpoint:{draftId:input.draftId,bufferVersion:input.bufferVersion,hash:`draft-${input.bufferVersion}`}});
beforeEach(async()=>{
  vi.resetAllMocks(); version=0;
  api.openOffice.mockResolvedValue({id:'office',hash:'base',workbook,state:state(),calculation:{state:'ready'}});
  api.drafts.mockResolvedValue([]); api.closeOffice.mockResolvedValue(undefined); api.closeDocument.mockResolvedValue(undefined);
  api.editOffice.mockImplementation(async input=>{expect(input.version).toBe(version);return {state:state(++version,true),calculation:{state:'ready'}};});
  api.checkpointOffice.mockImplementation(async input=>({draftId:input.draftId,bufferVersion:input.bufferVersion,hash:`draft-${input.bufferVersion}`}));
  api.saveOffice.mockImplementation(async input=>saved(input)); api.resolveDraft.mockResolvedValue({resolved:true});
  api.refresh.mockResolvedValue(file); api.rebaseOffice.mockResolvedValue(file);
  buffer=new FileBuffer(structuredClone(file),api as never,()=>undefined); await buffer.load();
});
afterEach(()=>{buffer.dispose();vi.useRealTimers();});
describe('Office buffer save/close and pending input',()=>{
  it('retries a transient checkpoint once at 1000ms and cancels it on close',async()=>{
    vi.useFakeTimers();
    api.checkpointOffice.mockRejectedValueOnce(new Error("Error invoking remote method 'files.checkpointOffice': FileError: [IO] temporary storage failure"));
    buffer.office!.setPending({sheetId:'1',row:0,column:0,text:'recoverable'},'');
    await vi.advanceTimersByTimeAsync(500);expect(api.checkpointOffice).toHaveBeenCalledTimes(1);expect(buffer.draftError).toContain('temporary storage failure');
    await vi.advanceTimersByTimeAsync(999);expect(api.checkpointOffice).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);expect(api.checkpointOffice).toHaveBeenCalledTimes(2);expect(buffer.draftError).toBe('');
    expect(api.checkpointOffice.mock.calls[1][0]).toEqual(api.checkpointOffice.mock.calls[0][0]);expect(api.saveOffice).not.toHaveBeenCalled();
    api.checkpointOffice.mockRejectedValueOnce(new Error('[IO] interrupted storage'));
    buffer.office!.setPending({sheetId:'1',row:0,column:0,text:'close before retry'},'');
    await vi.advanceTimersByTimeAsync(500);expect(api.checkpointOffice).toHaveBeenCalledTimes(3);
    buffer.dispose();await vi.advanceTimersByTimeAsync(30000);expect(api.checkpointOffice).toHaveBeenCalledTimes(3);
  });
  it.each(['IO','CHANGED','TOO_LARGE','CONFLICT','UNTRUSTED','TIMEOUT'])('bounds checkpoint retries for %s and leaves pending input intact',async(code)=>{
    vi.useFakeTimers();
    api.checkpointOffice.mockRejectedValue(new Error(`[${code}] retained failure`));
    buffer.office!.setPending({sheetId:'1',row:0,column:0,text:'uncommitted 中文'},'');
    await vi.advanceTimersByTimeAsync(2499);
    expect(api.checkpointOffice).toHaveBeenCalledTimes(code==='IO'?2:1);expect(buffer.draftError).toBe('retained failure');
    expect(buffer.office!.busy).toBe(false);expect(buffer.office!.pending?.text).toBe('uncommitted 中文');expect(api.saveOffice).not.toHaveBeenCalled();
    // The one scheduled autosave may attempt a checkpoint, but must then stop.
    await vi.advanceTimersByTimeAsync(30000);const attempts=api.checkpointOffice.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30000);expect(api.checkpointOffice).toHaveBeenCalledTimes(attempts);expect(buffer.dirty).toBe(true);
  });
  it('does not endlessly retry a failed cached-mode save and permits explicit recovery',async()=>{
    vi.useFakeTimers();
    api.editOffice.mockImplementation(async input=>({state:state(++version,true),calculation:{state:'cached',message:'offline calculation'}}));
    api.recalculateOffice.mockImplementation(async()=>({state:state(version,true),calculation:{state:'cached',message:'offline calculation'}}));
    api.saveOffice.mockImplementation(async input=>({...saved(input),state:state(version,true),calculation:{state:'cached'},receipt:{opId:input.opId,bufferVersion:input.bufferVersion,state:'failed',message:'storage quota'}}));
    buffer.office!.setPending({sheetId:'1',row:0,column:0,text:'retained local'},'');
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.saveOffice).toHaveBeenCalledTimes(1);expect(buffer.dirty).toBe(true);expect(buffer.saveError).toBe('storage quota');
    buffer.office!.setPending({sheetId:'1',row:0,column:0,text:'new retained local'},'retained local');
    await vi.advanceTimersByTimeAsync(30000);
    expect(api.saveOffice).toHaveBeenCalledTimes(1);expect(buffer.saveError).toBe('storage quota');expect(buffer.office!.pending?.text).toBe('new retained local');
    api.saveOffice.mockImplementation(async input=>saved(input));
    expect(await buffer.save()).toBe(true);expect(buffer.dirty).toBe(false);expect(api.saveOffice).toHaveBeenCalledTimes(2);
  });
  it('retains an open failure across focus refresh and recovers only after a successful explicit reload',async()=>{
    const office=buffer.office!;
    api.openOffice.mockRejectedValueOnce(new Error('[TOO_LARGE] Office 活动文档数量已达上限'));
    await office.reload();
    expect(buffer.loadState).toBe('error');
    expect(buffer.loadError).toBe('Office 活动文档数量已达上限');
    await office.refresh();
    expect(buffer.loadError).toBe('Office 活动文档数量已达上限');
    api.refresh.mockRejectedValueOnce(new Error('temporary stat failure'));
    await office.refresh();expect(buffer.loadError).toBe('temporary stat failure');
    await office.refresh();expect(buffer.loadError).toBe('Office 活动文档数量已达上限');
    expect(api.openOffice).toHaveBeenCalledTimes(2);
    await office.reload();
    expect(buffer.loadState).toBe('ready');expect(buffer.loadError).toBe('');
    expect(office.result?.workbook).toEqual(workbook);
  });
  it('does not add view-history entries for rejected or unchanged range operations',async()=>{
    const office=buffer.office!,range={firstRow:1,lastRow:2,firstColumn:1,lastColumn:1};
    office.view={sheetId:'1',row:1,column:1,endRow:2,endColumn:1,zoom:150};
    api.editOfficeRange.mockResolvedValueOnce({state:state(1,true),calculation:{state:'ready'}});
    expect(await office.rangeAction({type:'fill',direction:'down',sheetId:'1',range})).toBe(true);
    office.view={sheetId:'1',row:4,column:3,endRow:4,endColumn:3,zoom:100};
    api.editOfficeRange.mockRejectedValueOnce(new Error('synthetic rejected range'));
    expect(await office.rangeAction({type:'clear',mode:'contents',sheetId:'1',range})).toBe(false);expect(office.view.row).toBe(4);
    api.editOfficeRange.mockResolvedValueOnce({state:state(1,true),calculation:{state:'ready'}});
    expect(await office.rangeAction({type:'unmerge',sheetId:'1',range})).toBe(true);
    api.officeHistory.mockResolvedValueOnce({state:{...state(2),canUndo:false,canRedo:true},calculation:{state:'ready'}});
    await office.history('undo');expect(office.view).toEqual({sheetId:'1',row:1,column:1,endRow:2,endColumn:1,zoom:150});
    expect(office.viewRevision).toBe(1);
  });

  it('treats input matching an old mounted editor baseline as a new edit after saving',async()=>{
    const office=buffer.office!; office.setPending({sheetId:'1',row:0,column:0,text:'10'},'3',0);
    expect(await buffer.save()).toBe(true); expect(buffer.dirty).toBe(false);
    office.setPending({sheetId:'1',row:0,column:0,text:'3'},'3',0);
    expect(buffer.dirty).toBe(true); expect(await buffer.save()).toBe(true);
    expect(api.editOffice.mock.calls.map(call=>call[0].edit.text)).toEqual(['10','3']);
  });
  it('retains the durable content checkpoint when the route commit fails, then retries route persistence',async()=>{
    const ensure=vi.spyOn(buffer,'ensureRecoveryRoute').mockRejectedValueOnce(new Error('route disk full'));
    buffer.office!.setPending({sheetId:'1',row:0,column:0,text:'='},'');
    await expect(buffer.checkpoint()).rejects.toThrow('route disk full'); expect(api.checkpointOffice).toHaveBeenCalledTimes(1); expect(buffer.dirty).toBe(true);
    ensure.mockResolvedValue(undefined); await buffer.checkpoint();
    expect(ensure).toHaveBeenCalledTimes(2); expect(api.checkpointOffice).toHaveBeenCalledTimes(1);
  });
  it('checkpoints incomplete formula text and refuses to close after a rejected edit without losing input',async()=>{
    const office=buffer.office!; office.setPending({sheetId:'1',row:0,column:0,text:'=SUM('},'');
    api.editOffice.mockRejectedValue(new Error('测试公式无效'));
    expect(await buffer.prepareClose('save')).toBe(false); expect(buffer.dirty).toBe(true); expect(office.pending?.text).toBe('=SUM('); expect(api.saveOffice).not.toHaveBeenCalled();
    expect(api.checkpointOffice.mock.calls[0][0].pending.text).toBe('=SUM(');
    expect(api.checkpointOffice.mock.invocationCallOrder[0]).toBeLessThan(api.editOffice.mock.invocationCallOrder[0]);
  });
  it('flushes pending input once and an older save acknowledgement cannot clear newly typed text',async()=>{
    const office=buffer.office!;office.setPending({sheetId:'1',row:1,column:1,text:'10'},'3');
    let finish!:(value:OfficeSaveResult)=>void,input!:Parameters<typeof saved>[0];
    api.saveOffice.mockImplementationOnce(value=>{input=value;return new Promise(resolve=>{finish=resolve;});});
    const saving=buffer.save(); await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    office.setPending({sheetId:'1',row:1,column:1,text:'20'},'10'); finish(saved(input));
    expect(await saving).toBe(false); expect(buffer.dirty).toBe(true); expect(office.pending?.text).toBe('20');
    expect(await buffer.save()).toBe(true); expect(buffer.dirty).toBe(false);
    expect(api.editOffice.mock.calls.map(call=>call[0].edit.text)).toEqual(['10','20']);
    await office.flush(); await buffer.save(); expect(api.editOffice).toHaveBeenCalledTimes(2); expect(api.saveOffice).toHaveBeenCalledTimes(2);
  });
  it('preserves the system composition buffer and allows explicit discard without writing the document',async()=>{
    const office=buffer.office!;office.setPending({sheetId:'1',row:0,column:0,text:'中文输入中'},''); office.composing=true;
    await buffer.checkpoint(); expect(await buffer.save()).toBe(false); expect(api.editOffice).not.toHaveBeenCalled();
    expect(await buffer.prepareClose('discard')).toBe(true); expect(api.resolveDraft).toHaveBeenCalled(); expect(api.saveOffice).not.toHaveBeenCalled();
  });
  it('keeps dirty state on external refresh and only rebases after the keep-local action',async()=>{
    const office=buffer.office!,newFile={...file,revision:{...file.revision,hash:'external'}};
    office.setPending({sheetId:'1',row:0,column:0,text:'mine'},'base');api.refresh.mockResolvedValue(newFile);api.rebaseOffice.mockResolvedValue(newFile);
    await buffer.refresh();expect(buffer.conflict).toBe(true);expect(office.pending?.text).toBe('mine');expect(api.closeOffice).not.toHaveBeenCalled();
    expect(await buffer.save()).toBe(false);expect(api.saveOffice).not.toHaveBeenCalled();
    expect(await buffer.keepLocal()).toBe(true);expect(api.rebaseOffice).toHaveBeenCalledTimes(1);expect(buffer.conflict).toBe(false);
  });
  it('restores the uncommitted formula and detects a different on-disk baseline',async()=>{
    api.restoreOffice.mockResolvedValue({state:state(1,true),calculation:{state:'cached'},baseHash:'old-base',bufferVersion:10,hash:'draft',pending:{sheetId:'1',row:4,column:2,text:'=SUM('}});
    await buffer.restoreDraft('restored');expect(buffer.office!.pending?.text).toBe('=SUM(');expect(buffer.office!.view).toMatchObject({sheetId:'1',row:4,column:2});
    expect(buffer.conflict).toBe(true);expect(buffer.baseHash).toBe('old-base');expect(buffer.dirty).toBe(true);
  });
  it('honours keep-local even after the temporary input is cancelled back to the local baseline',async()=>{
    const office=buffer.office!,newFile={...file,revision:{...file.revision,hash:'external'}};
    office.setPending({sheetId:'1',row:0,column:0,text:'='},'base');api.refresh.mockResolvedValue(newFile);api.rebaseOffice.mockResolvedValue(newFile);
    await buffer.refresh();office.cancelPending();expect(buffer.conflict).toBe(true);
    expect(await buffer.keepLocal()).toBe(true);expect(api.editOffice).not.toHaveBeenCalled();expect(api.saveOffice).toHaveBeenCalledTimes(1);
  });
});
