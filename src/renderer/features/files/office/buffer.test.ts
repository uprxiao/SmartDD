// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { FileBuffer } from '../file-buffer';
import { OfficeClient } from './client';
import type { OfficeEditState,OfficeSaveResult } from '@shared/file-office';
const api=vi.hoisted(()=>Object.fromEntries(['saveOfficeLossyCopy','openOffice','closeOffice','drafts','editOffice','checkpointOffice','saveOffice','recalculateOffice','officeHistory','officeSheet','editOfficeRange','refresh','rebaseOffice','resolveDraft','restoreOffice','closeDocument'].map(name=>[name,vi.fn()])));
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
describe('text-box pending input joins durable workbook state',()=>{
  it('checkpoints uncommitted text under readonly host and blocks callbacks from the previous host generation',async()=>{
    buffer.pauseAutosave();const office=buffer.office!,writer=office.writer,edit={sheetId:'1',objectId:'a'.repeat(64),text:'raw 中文\nhello'};
    expect(writer.setDrawingText(edit,'',0)).toBe(true);expect(office.dirty).toBe(true);
    expect(await office.setWorkbookHost({source:{kind:'local'},isEditing:false,manualEditUiEnabled:false})).toBe(true);
    expect(api.checkpointOffice.mock.calls.at(-1)![0].pendingDrawing).toEqual(edit);expect(office.pendingDrawing).toEqual(edit);
    expect(writer.setDrawingText({...edit,text:'stale callback'},'',0)).toBe(false);expect(office.pendingDrawing).toEqual(edit);expect(api.editOfficeRange).not.toHaveBeenCalled();
  });
  it('keeps newer text when an older flush finishes, then flushes it once before the successful save',async()=>{
    buffer.pauseAutosave();const office=buffer.office!,edit={sheetId:'1',objectId:'b'.repeat(64),text:'first'};let finish!:(value:unknown)=>void;
    api.editOfficeRange.mockImplementationOnce(input=>{expect(input.action.text).toBe('first');return new Promise(done=>{finish=done;});});
    office.writer.setDrawingText(edit,'',0);const saving=office.save();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    office.writer.setDrawingText({...edit,text:'second'},'',0);version=1;finish({state:state(1,true),calculation:{state:'ready'}});
    expect(await saving).toBe(false);expect(office.pendingDrawing?.text).toBe('second');expect(api.saveOffice).not.toHaveBeenCalled();
    api.editOfficeRange.mockImplementationOnce(async input=>{expect(input.version).toBe(1);expect(input.action.text).toBe('second');version=2;return{state:state(2,true),calculation:{state:'ready'}};});
    expect(await office.save()).toBe(true);expect(office.pendingDrawing).toBeNull();expect(api.editOfficeRange).toHaveBeenCalledTimes(2);expect(api.saveOffice).toHaveBeenCalledTimes(1);
  });
});
describe('workbook source ownership and independent controls',()=>{
  it('keeps the current clean undo version and redo history when the same controller changes host key',async()=>{
    buffer.pauseAutosave();const office=buffer.office!,client=office.client!,old=office.writer;
    expect(await old.editCell({sheetId:'1',row:0,column:0,text:'first edit'})).toBe(true);
    api.officeHistory.mockImplementationOnce(async input=>{
      expect(input.version).toBe(version);expect(input.direction).toBe('undo');
      return {state:{...state(++version),canUndo:false,canRedo:true},calculation:{state:'ready'}};
    });
    await old.history('undo');const current=office.result!;
    expect(current.state.version).toBe(2);expect(current.state.canRedo).toBe(true);expect(office.dirty).toBe(false);
    expect(await office.setWorkbookHost({source:{kind:'artifactDocument',key:'same-controller-new-host',phase:'live',controller:client},manualEditUiEnabled:true})).toBe(true);
    await office.load();expect(office.client).toBe(client);expect(office.result?.state).toEqual(current.state);
    expect(await old.editCell({sheetId:'1',row:0,column:0,text:'revoked callback'})).toBe(false);
    expect(api.editOffice).toHaveBeenCalledTimes(1);
    expect(await office.writer.editCell({sheetId:'1',row:0,column:0,text:'new host edit'})).toBe(true);
    expect(api.editOffice.mock.calls[1][0].version).toBe(2);expect(office.result?.state.version).toBe(3);
    expect(api.openOffice).toHaveBeenCalledTimes(1);expect(api.closeOffice).not.toHaveBeenCalled();expect(api.saveOffice).not.toHaveBeenCalled();
  });
  it('revokes old callbacks while retaining live cell edits without manual formatting',async()=>{
    const office=buffer.office!,old=office.writer;
    expect(await office.setWorkbookHost({source:{kind:'local'},isEditing:true,manualEditUiEnabled:false})).toBe(true);
    expect(office.editable).toBe(true);expect(office.editingControls).toBe(false);expect(office.artifactSearchEnabled).toBe(false);
    expect(await old.editCell({sheetId:'1',row:0,column:0,text:'stale'})).toBe(false);expect(api.editOffice).not.toHaveBeenCalled();
    expect(await office.writer.rangeAction({type:'format',sheetId:'1',range:{firstRow:0,lastRow:0,firstColumn:0,lastColumn:0},format:{font:{bold:true}}})).toBe(false);
    expect(await office.writer.editCell({sheetId:'1',row:0,column:0,text:'actual live cell'})).toBe(true);
    expect(api.editOffice).toHaveBeenCalledTimes(1);expect(office.dirty).toBe(true);
  });
  it('retains pending input and checkpoints it when the current view becomes readonly',async()=>{
    const office=buffer.office!;
    office.setPending({sheetId:'1',row:0,column:0,text:'=unfinished 中文'},'');
    const pending=structuredClone(office.pending);
    expect(await office.setWorkbookHost({source:{kind:'local'},isEditing:false,manualEditUiEnabled:true})).toBe(true);
    expect(office.editable).toBe(false);expect(office.editingControls).toBe(false);expect(office.pending).toEqual(pending);expect(office.dirty).toBe(true);
    expect(api.checkpointOffice).toHaveBeenCalledTimes(1);expect(api.checkpointOffice.mock.calls[0][0].pending).toEqual(pending);expect(api.saveOffice).not.toHaveBeenCalled();
    expect(await office.writer.editCell({sheetId:'1',row:0,column:0,text:'readonly'})).toBe(false);
    expect(await office.setWorkbookHost({source:{kind:'local'},isEditing:true,manualEditUiEnabled:true})).toBe(true);expect(office.pending).toEqual(pending);
  });
  it('settles an in-flight write before refusing adoption that would discard its dirty owner',async()=>{
    const office=buffer.office!,oldWriter=office.writer;
    let reply!:(value:unknown)=>void;api.editOffice.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));
    const writing=oldWriter.editCell({sheetId:'1',row:0,column:0,text:'old owner preserved'});
    await vi.waitFor(()=>expect(reply).toBeTypeOf('function'));
    const other=new OfficeClient(file.ref,'base');await other.ready;
    const adopting=office.setWorkbookHost({source:{kind:'artifactDocument',key:'B',phase:'live',controller:other},manualEditUiEnabled:true});
    expect(office.editable).toBe(false);expect(await oldWriter.editCell({sheetId:'1',row:0,column:0,text:'must not start'})).toBe(false);
    reply({state:state(1,true),calculation:{state:'ready'}});
    expect(await writing).toBe(true);expect(await adopting).toBe(false);expect(office.result?.state.version).toBe(1);expect(office.dirty).toBe(true);expect(office.sourceState).toBe('live');expect(buffer.saveError).toContain('来源未切换');expect(api.editOffice).toHaveBeenCalledTimes(1);other.close();
  });
  it('does not publish a held ready result after a clean source replacement',async()=>{
    const office=buffer.office!;let ready!:(value:unknown)=>void;
    api.openOffice.mockImplementationOnce(()=>new Promise(resolve=>{ready=resolve;}));
    const loading=office.reload();await vi.waitFor(()=>expect(ready).toBeTypeOf('function'));const old=office.client!;
    api.openOffice.mockResolvedValueOnce({id:'B',hash:'base',workbook,state:state(7),calculation:{state:'ready'}});
    const other=new OfficeClient(file.ref,'base');await other.ready;
    expect(await office.setWorkbookHost({source:{kind:'artifactDocument',key:'B',phase:'live',controller:other},manualEditUiEnabled:true})).toBe(true);await office.load();
    ready({id:'A',hash:'base',workbook,state:state(),calculation:{state:'ready'}});await loading;
    expect(office.client).toBe(other);expect(office.result?.state.version).toBe(7);expect(office.editable).toBe(true);expect(office.editingControls).toBe(true);expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(1);
  });
});
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
  it('DEV156 retains an external conflict when raw input changed and reverted while stat was in flight',async()=>{
    const office=buffer.office!,client=office.client;let deliver!:(value:typeof file)=>void;
    api.refresh.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const refreshing=office.refresh();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    office.setPending({sheetId:'1',row:0,column:0,text:'temporary'},'base',0);office.setPending({sheetId:'1',row:0,column:0,text:'base'},'base',0);expect(buffer.dirty).toBe(false);
    deliver({...file,revision:{...file.revision,hash:'external'}});await refreshing;
    expect(buffer.conflict).toBe(true);expect(office.client).toBe(client);expect(buffer.baseHash).toBe('base');expect(api.closeOffice).not.toHaveBeenCalled();
  });
  it('DEV156 cannot silently adopt disk on a repeated refresh after cancelling pending input in an unresolved conflict',async()=>{
    const office=buffer.office!,client=office.client;api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'external'}});
    office.setPending({sheetId:'1',row:0,column:0,text:'temporary'},'base',0);await office.refresh();office.cancelPending();expect(buffer.conflict).toBe(true);expect(buffer.dirty).toBe(false);
    await office.refresh();expect(office.client).toBe(client);expect(buffer.baseHash).toBe('base');expect(api.closeOffice).not.toHaveBeenCalled();
  });
  it('DEV156 drains an in-flight local edit before handling an external refresh instead of dropping the only notification',async()=>{
    const office=buffer.office!,client=office.client;let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
    api.editOffice.mockImplementationOnce(async()=>{await gate;return{state:state(1,true),calculation:{state:'cached'}};});api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'external'}});
    const editing=office.editCell({sheetId:'1',row:0,column:0,text:'local'});await vi.waitFor(()=>expect(api.editOffice).toHaveBeenCalledTimes(1));const refreshing=office.refresh();release();expect(await editing).toBe(true);await refreshing;
    expect(api.refresh).toHaveBeenCalledTimes(1);expect(buffer.conflict).toBe(true);expect(buffer.dirty).toBe(true);expect(office.client).toBe(client);
  });
  it('DEV156 ignores an older stat reply after an explicit use-disk installed another client',async()=>{
    const office=buffer.office!;let deliver!:(value:typeof file)=>void;api.refresh.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const refreshing=office.refresh();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'latest-disk'}});expect(await office.useDisk()).toBe(true);const adopted=office.client;expect(buffer.baseHash).toBe('latest-disk');
    deliver({...file,revision:{...file.revision,hash:'older-disk'}});await refreshing;expect(buffer.baseHash).toBe('latest-disk');expect(office.client).toBe(adopted);expect(buffer.conflict).toBe(false);
  });
  it('DEV156 rescans after an own save changed the baseline rather than turning an older stat into a false conflict',async()=>{
    const office=buffer.office!,client=office.client;let deliver!:(value:typeof file)=>void;api.refresh.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const refreshing=office.refresh();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    office.setPending({sheetId:'1',row:0,column:0,text:'own-save'},'base',0);expect(await buffer.save()).toBe(true);const saved=buffer.baseHash;api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:saved}});
    deliver(file);await refreshing;expect(buffer.baseHash).toBe(saved);expect(buffer.conflict).toBe(false);expect(office.client).toBe(client);expect(api.closeOffice).not.toHaveBeenCalled();
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

describe('Y13 renderer original-save and lossy-copy separation (RPC adapters)',()=>{
  for(const outcome of ['cancelled','saved']as const)it(`retains dirty and original failed receipt after explicit ${outcome} copy`,async()=>{
    const model=buffer.office!;model.pauseAutosave();model.setPending({sheetId:'1',row:0,column:0,text:'Y13 unsaved'},'');
    const failure={token:crypto.randomUUID(),version:1,total:1,issues:[{kind:'missing'as const,part:'customXml/vbaProject.bin',message:'非预期缺失'}]};
    api.saveOffice.mockImplementation(async input=>({...saved(input),state:state(input.version,true),calculation:{state:'ready'},receipt:{opId:input.opId,bufferVersion:input.bufferVersion,state:'failed',message:'保真校验失败'},fidelity:failure}));
    expect(await buffer.save()).toBe(false);expect(buffer.dirty).toBe(true);expect(model.fidelity).toEqual(failure);expect(model.canCopyLossy).toBe(true);
    const originalReceipt=buffer.saveReceipt,originalFile=structuredClone(buffer.file);api.saveOfficeLossyCopy.mockResolvedValue(outcome==='saved'?{state:'saved',path:'/synthetic/lossy.xlsx',hash:'copy-only'}:{state:'cancelled'});
    await model.saveLossyCopy();expect(api.saveOfficeLossyCopy).toHaveBeenCalledWith({kind:'xlsx',id:model.client!.id,token:failure.token});expect(buffer.dirty).toBe(true);expect(buffer.saveReceipt).toBe(originalReceipt);expect(buffer.file).toEqual(originalFile);expect(buffer.baseHash).toBe('base');expect(api.resolveDraft).not.toHaveBeenCalled();expect(model.copyNotice).toContain(outcome==='saved'?'原件未保存':'已取消');
    model.setPending({sheetId:'1',row:0,column:0,text:'Y13 unsaved'},'');expect(model.fidelity).toBeUndefined();await model.saveLossyCopy();expect(api.saveOfficeLossyCopy).toHaveBeenCalledTimes(1);
  });
  it('shows an undurable draft failure while retaining its model and blocking automatic original retry',async()=>{
    vi.useFakeTimers();const model=buffer.office!;model.setPending({sheetId:'1',row:0,column:0,text:'Y13 unsaved'},'');
    api.saveOffice.mockImplementation(async input=>({...saved(input),state:state(input.version,true),calculation:{state:'ready'},checkpoint:undefined,draftError:'草稿未确认写入磁盘',receipt:{opId:input.opId,bufferVersion:input.bufferVersion,state:'failed',message:'保真校验失败'},fidelity:{token:crypto.randomUUID(),version:1,total:1,issues:[{kind:'changed',part:'layout.xml',message:'无关内容改写'}]}}));
    expect(await buffer.save()).toBe(false);expect(buffer.dirty).toBe(true);expect(buffer.draftError).toContain('未确认');await vi.advanceTimersByTimeAsync(30000);expect(api.saveOffice).toHaveBeenCalledTimes(1);expect(buffer.dirty).toBe(true);
  });
});
