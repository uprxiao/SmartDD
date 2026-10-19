// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { FileBuffer } from '../file-buffer';
import type { PptxEditState,PptxSaveResult } from '@shared/file-pptx';
const api=vi.hoisted(()=>Object.fromEntries(['openPptx','closePptx','editPptx','pptxHistory','checkpointPptx','savePptx','restorePptx','rebasePptx','drafts','refresh','resolveDraft','closeDocument'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const file={ref:{id:'document',lease:'root',generation:1},name:'slides.pptx',relativePath:'slides.pptx',absolutePath:'/synthetic/slides.pptx',documentKey:'local:1:2',revision:{hash:'base',device:'1',inode:'2',size:100,modifiedNs:'1',changedNs:'1'},writable:true};
const state=(version=0,dirty=false,notes='original'):PptxEditState=>({version,dirty,canUndo:version>0,canRedo:false,protected:false,info:{kind:'pptx',signed:false,externalLinks:0,hasRevisions:false,slides:[{id:'256',title:'Title',hidden:false,notes,elements:[{id:'2',name:'Title',kind:'text',hidden:false,text:'original text'}]}]}});
let buffer:FileBuffer,current:PptxEditState;
const saved=(input:{opId:string;draftId:string;bufferVersion:number}):PptxSaveResult=>({state:{...current,dirty:false},receipt:{opId:input.opId,bufferVersion:input.bufferVersion,state:'saved',revision:{...file.revision,hash:`saved-${input.bufferVersion}`}},checkpoint:{draftId:input.draftId,bufferVersion:input.bufferVersion,hash:`draft-${input.bufferVersion}`}});
beforeEach(async()=>{
  vi.resetAllMocks();current=state();
  api.openPptx.mockImplementation(async input=>({id:input.id,sourceHash:'base',state:state()}));api.drafts.mockResolvedValue([]);api.closePptx.mockResolvedValue(undefined);api.closeDocument.mockResolvedValue(undefined);
  api.editPptx.mockImplementation(async input=>{expect(input.version).toBe(current.version);current={...current,version:current.version+1,dirty:true,canUndo:true,info:{...current.info,slides:current.info.slides.map(slide=>slide.id!==input.action.slideId?slide:{...slide,...(input.action.type==='notes'?{notes:input.action.text}:{}),elements:slide.elements?.map(element=>input.action.type==='element-text'&&element.id===input.action.elementId?{...element,text:input.action.text}:element)})}};return current;});
  api.checkpointPptx.mockImplementation(async input=>({draftId:input.draftId,bufferVersion:input.bufferVersion,hash:`draft-${input.bufferVersion}`}));
  api.savePptx.mockImplementation(async input=>saved(input));api.resolveDraft.mockResolvedValue({resolved:true});api.refresh.mockResolvedValue(structuredClone(file));api.rebasePptx.mockResolvedValue(structuredClone(file));
  buffer=new FileBuffer(structuredClone(file),api as never,()=>undefined);await buffer.load();
});
afterEach(()=>{buffer.dispose();vi.useRealTimers();});
describe('PPTX buffer actual ownership and 500ms save policy (RPC mocked)',()=>{
  it('DEV158 drains an in-flight checkpoint before applying the only restored-write-permission notification',async()=>{
    const pptx=buffer.pptx!;pptx.pauseAutosave();pptx.setNotes('256','retained latest','original',0);buffer.file.writable=false;let deliver!:(value:unknown)=>void;
    api.checkpointPptx.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const checkpoint=pptx.checkpoint();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    api.refresh.mockResolvedValue(structuredClone(file));const refreshing=pptx.refresh();deliver({draftId:buffer.draftId,bufferVersion:1,hash:'draft-1'});await checkpoint;await refreshing;
    expect(api.refresh).toHaveBeenCalledTimes(1);expect(buffer.file.writable).toBe(true);expect(pptx.editable).toBe(true);expect(pptx.pending?.text).toBe('retained latest');expect(api.closePptx).not.toHaveBeenCalled();
  });
  it('DEV158 retains conflict when local notes changed and reverted while an external stat was in flight',async()=>{
    const pptx=buffer.pptx!,id=pptx.id;pptx.pauseAutosave();let deliver!:(value:typeof file)=>void;api.refresh.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const refreshing=pptx.refresh();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    pptx.setNotes('256','temporary','original',0);pptx.setNotes('256','original','original',0);expect(buffer.dirty).toBe(false);deliver({...file,revision:{...file.revision,hash:'external'}});await refreshing;
    expect(buffer.conflict).toBe(true);expect(pptx.id).toBe(id);expect(buffer.baseHash).toBe('base');expect(api.closePptx).not.toHaveBeenCalled();
  });
  it('DEV158 does not silently reload unresolved disk conflict after pending notes are cancelled',async()=>{
    const pptx=buffer.pptx!,id=pptx.id;pptx.pauseAutosave();api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'external'}});pptx.setNotes('256','temporary','original',0);await pptx.refresh();pptx.setNotes('256','original','original',0);expect(buffer.conflict).toBe(true);expect(buffer.dirty).toBe(false);await pptx.refresh();expect(pptx.id).toBe(id);expect(buffer.baseHash).toBe('base');expect(api.closePptx).not.toHaveBeenCalled();
  });
  it('DEV158 rescans an old stat crossing its own successful native save instead of rolling back baseline',async()=>{
    const pptx=buffer.pptx!,id=pptx.id;pptx.pauseAutosave();let deliver!:(value:typeof file)=>void;api.refresh.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const refreshing=pptx.refresh();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    pptx.setNotes('256','saved latest','original',0);expect(await buffer.save()).toBe(true);const hash=buffer.baseHash;api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash}});deliver(file);await refreshing;expect(buffer.baseHash).toBe(hash);expect(buffer.conflict).toBe(false);expect(pptx.id).toBe(id);expect(api.closePptx).not.toHaveBeenCalled();
  });
  it('DEV158 ignores old stat metadata after explicit Use Disk installs a newer document owner',async()=>{
    const pptx=buffer.pptx!;pptx.pauseAutosave();let deliver!:(value:typeof file)=>void;api.refresh.mockImplementationOnce(()=>new Promise(resolve=>{deliver=resolve;}));const refreshing=pptx.refresh();await vi.waitFor(()=>expect(deliver).toBeTypeOf('function'));
    api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'latest-disk'}});expect(await pptx.useDisk()).toBe(true);const id=pptx.id;deliver({...file,revision:{...file.revision,hash:'old-disk'}});await refreshing;expect(buffer.baseHash).toBe('latest-disk');expect(pptx.id).toBe(id);expect(api.closePptx).toHaveBeenCalledTimes(1);
  });
  it('checkpoints invalid chart data before validation, retains it on failure and sends corrected numeric data',async()=>{
    const pptx=buffer.pptx!;current.info.slides[0].elements!.push({id:'3',name:'Chart',kind:'chart',hidden:false,chart:{type:'bar',values:[9,4],editableValues:true}});pptx.result!.state=current;
    expect(pptx.beginChartValues('256','3')).toBe(true);pptx.setChartValues('256','3','12,','9,4');
    expect(await pptx.flush()).toBe(false);expect(api.editPptx).not.toHaveBeenCalled();expect(api.checkpointPptx.mock.calls[0][0].pending).toMatchObject({chartValues:true,text:'12,'});expect(pptx.pendingFor('256','3',undefined,true)?.text).toBe('12,');
    pptx.setChartValues('256','3','12,6','9,4');expect(await pptx.finishElementText({slideId:'256',elementId:'3',chartValues:true})).toBe(true);
    expect(api.editPptx.mock.calls[0][0].action).toEqual({type:'chart-values',slideId:'256',elementId:'3',values:[12,6]});expect(pptx.pending).toBeNull();expect(pptx.elementEditing).toBeNull();
  });
  it('restores chart input separately from object text and keeps composition and Escape scoped to that input',async()=>{
    const pptx=buffer.pptx!,pending=[{slideId:'256',elementId:'2',text:'object'},{slideId:'256',elementId:'2',chartValues:true,text:'5,候选,'}];
    api.restorePptx.mockResolvedValue({state:current,pending,baseHash:'base',bufferVersion:8,hash:'draft'});await buffer.restoreDraft('chart-draft');
    expect(pptx.elementEditing).toEqual({slideId:'256',elementId:'2',chartValues:true});expect(pptx.pendingFor('256','2')?.text).toBe('object');expect(pptx.pendingFor('256','2',undefined,true)?.text).toBe('5,候选,');
    pptx.setComposing(true);expect(await pptx.flush()).toBe(false);expect(pptx.cancelElementText()).toBe(false);pptx.setComposing(false);expect(pptx.cancelElementText()).toBe(true);expect(pptx.pendingInputs).toEqual([pending[0]]);
  });
  it('isolates cell input targets across blur, checkpoints them before mutation and restores the active cell',async()=>{
    const pptx=buffer.pptx!,cells=Array.from({length:2},(_,row)=>Array.from({length:2},(_,column)=>({row,column,text:`${row}:${column}`,textStyle:{},rowSpan:1,columnSpan:1,horizontalMerge:false,verticalMerge:false})));
    current.info.slides[0].elements!.push({id:'3',name:'Table',kind:'table',hidden:false,table:{cells,widths:[100,100],heights:[30,30],headerRow:false,headerColumn:false,explicitGrid:true}});pptx.result!.state=current;
    expect(pptx.beginTableText('256','3',{row:0,column:0})).toBe(true);pptx.setTableText('256','3',{row:0,column:0},'first','0:0');
    const flushing=pptx.flush({slideId:'256',elementId:'3',cell:{row:0,column:0}});
    expect(pptx.beginTableText('256','3',{row:0,column:1})).toBe(true);pptx.setTableText('256','3',{row:0,column:1},'second','0:1');pptx.setNotes('256','notes','original');
    expect(await flushing).toBe(true);expect(api.editPptx.mock.calls.map(([input])=>input.action)).toEqual([{type:'table-cell',slideId:'256',elementId:'3',row:0,column:0,text:'first'}]);
    expect(pptx.pendingFor('256','3',{row:0,column:0})).toBeUndefined();expect(pptx.pendingFor('256','3',{row:0,column:1})?.text).toBe('second');expect(api.checkpointPptx.mock.calls[0][0].pending).toHaveLength(3);
    const pending=[{slideId:'256',text:'恢复备注'},{slideId:'256',elementId:'3',cell:{row:1,column:1},text:'候选\ud800'}];
    api.restorePptx.mockResolvedValue({state:current,pending,baseHash:'base',bufferVersion:9,hash:'draft'});await buffer.restoreDraft('recovered-cell');
    expect(pptx.selection).toEqual({slideId:'256',elementId:'3',cell:{row:1,column:1}});expect(pptx.elementEditing).toEqual(pptx.selection);expect(pptx.pendingInputs).toEqual(pending);
    pptx.setComposing(true);expect(pptx.cancelElementText()).toBe(false);expect(await pptx.flush()).toBe(false);pptx.setComposing(false);expect(pptx.cancelElementText()).toBe(true);expect(pptx.pendingInputs).toEqual([pending[0]]);
  });
  it('keeps notes and object text separate when a blur flush is queued before focus changes',async()=>{
    const pptx=buffer.pptx!;pptx.setNotes('256','new notes','original');
    const flushing=pptx.flush({slideId:'256'});
    pptx.beginElementText('256','2');pptx.setElementText('256','2','new object','original text');
    expect(await flushing).toBe(true);expect(current.info.slides[0].notes).toBe('new notes');
    expect(current.info.slides[0].elements![0].text).toBe('original text');expect(pptx.pendingFor('256','2')?.text).toBe('new object');
    expect(pptx.pendingFor('256')).toBeUndefined();expect(api.checkpointPptx.mock.calls[0][0].pending).toHaveLength(2);
    expect(await pptx.finishElementText({slideId:'256',elementId:'2'})).toBe(true);expect(await buffer.save()).toBe(true);
    expect(current.info.slides[0].notes).toBe('new notes');expect(current.info.slides[0].elements![0].text).toBe('new object');
    expect(api.editPptx.mock.calls.map(([input])=>input.action.type)).toEqual(['notes','element-text']);
  });
  it('holds active object text in recovery until blur/save and Escape cancels only uncommitted input',async()=>{
    vi.useFakeTimers();const pptx=buffer.pptx!;
    expect(pptx.beginElementText('256','2')).toBe(true);pptx.setElementText('256','2','first','original text');
    await vi.advanceTimersByTimeAsync(1000);expect(api.checkpointPptx).toHaveBeenCalled();expect(api.editPptx).not.toHaveBeenCalled();expect(api.savePptx).not.toHaveBeenCalled();
    expect(await buffer.save()).toBe(true);expect(pptx.elementEditing?.elementId).toBe('2');
    pptx.setElementText('256','2','second','first',1);expect(pptx.cancelElementText()).toBe(true);
    expect(pptx.pending).toBeNull();expect(pptx.result!.state.info.slides[0].elements![0].text).toBe('first');expect(buffer.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);expect(api.savePptx).toHaveBeenCalledTimes(1);
  });
  it('keeps the latest object and note keystrokes during an older object mutation',async()=>{
    let complete!:(value:PptxEditState)=>void;const pptx=buffer.pptx!;
    api.editPptx.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    pptx.setElementText('256','2','old edit','original text');const saving=buffer.save();await vi.waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(1));
    pptx.setElementText('256','2','new edit','original text',0);pptx.setNotes('256','new notes','original',0);
    current={...state(1,true),info:{...current.info,slides:[{...current.info.slides[0],elements:[{...current.info.slides[0].elements![0],text:'old edit'}]}]}};complete(current);
    expect(await saving).toBe(false);expect(pptx.pendingInputs).toHaveLength(2);expect(api.savePptx).not.toHaveBeenCalled();
    expect(await buffer.save()).toBe(true);expect(current.info.slides[0].notes).toBe('new notes');expect(current.info.slides[0].elements![0].text).toBe('new edit');
  });
  it('restores multiple targets and protects composition from Escape, structure changes and close',async()=>{
    const pending=[{slideId:'256',text:'恢复备注'},{slideId:'256',elementId:'2',text:'恢复文字'}];
    api.restorePptx.mockResolvedValue({state:state(1,true),pending,baseHash:'base',bufferVersion:9,hash:'draft'});
    await buffer.restoreDraft('recovered');const pptx=buffer.pptx!;
    expect(pptx.pendingInputs).toEqual(pending);expect(pptx.selection).toEqual({slideId:'256',elementId:'2'});expect(pptx.elementEditing).toEqual(pptx.selection);
    pptx.setComposing(true);expect(pptx.cancelElementText()).toBe(false);expect(await pptx.action({type:'duplicate',slideId:'256'})).toBe(false);expect(await buffer.prepareClose('save')).toBe(false);
    expect(api.editPptx).not.toHaveBeenCalled();expect(pptx.pendingInputs).toEqual(pending);
  });
  it('keeps all raw targets after checkpoint failure and does not mutate the document',async()=>{
    const pptx=buffer.pptx!;pptx.setNotes('256','notes','original');pptx.setElementText('256','2','text','original text');
    api.checkpointPptx.mockRejectedValueOnce(new Error('recovery disk full'));
    expect(await pptx.flush()).toBe(false);expect(pptx.pendingInputs).toHaveLength(2);expect(api.editPptx).not.toHaveBeenCalled();expect(buffer.saveError).toContain('disk full');
    expect(await buffer.save()).toBe(true);expect(pptx.pendingInputs).toHaveLength(0);
  });
  it('persists pending notes before validation and saves after 500ms, preserving later input',async()=>{
    vi.useFakeTimers();buffer.pptx!.setNotes('256','edited','original',0);
    await vi.advanceTimersByTimeAsync(499);expect(api.savePptx).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);expect(api.savePptx).toHaveBeenCalledTimes(1);expect(buffer.dirty).toBe(false);
    expect(api.checkpointPptx.mock.calls[0][0].pending.text).toBe('edited');
    expect(api.checkpointPptx.mock.invocationCallOrder[0]).toBeLessThan(api.editPptx.mock.invocationCallOrder[0]);
  });
  it('checkpoints composing text without committing it and resumes when composition ends',async()=>{
    vi.useFakeTimers();const pptx=buffer.pptx!;pptx.setComposing(true);pptx.setNotes('256','zhongwen','original');
    await vi.advanceTimersByTimeAsync(1000);expect(api.checkpointPptx).toHaveBeenCalled();expect(api.editPptx).not.toHaveBeenCalled();expect(await buffer.prepareClose('save')).toBe(false);
    pptx.setNotes('256','中文输入法','original');pptx.setComposing(false);await vi.advanceTimersByTimeAsync(500);
    expect(api.editPptx.mock.calls[0][0].action.text).toBe('中文输入法');expect(buffer.dirty).toBe(false);
  });
  it('rejects an image selected for a stale document revision before flushing or mutating',async()=>{
    const pptx=buffer.pptx!,image={mime:'image/png' as const,base64:'iVBORw0KGgo='};
    expect(await pptx.action({type:'image-insert',slideId:'256',image},{id:pptx.id!,version:99})).toBe(false);
    expect(buffer.saveError).toContain('选图期间文档已改变');expect(api.editPptx).not.toHaveBeenCalled();
    expect(await pptx.action({type:'image-insert',slideId:'256',image},{id:'another-document',version:0})).toBe(false);expect(api.editPptx).not.toHaveBeenCalled();
  });
  it('freezes autosave on failure while continuing recovery, then permits explicit retry',async()=>{
    vi.useFakeTimers();api.savePptx.mockRejectedValueOnce(new Error('disk full'));buffer.pptx!.setNotes('256','first','original');
    await vi.advanceTimersByTimeAsync(500);expect(buffer.saveError).toContain('disk full');expect(buffer.dirty).toBe(true);
    buffer.pptx!.setNotes('256','second','first',1);await vi.advanceTimersByTimeAsync(3000);
    expect(api.savePptx).toHaveBeenCalledTimes(1);expect(api.checkpointPptx.mock.calls.at(-1)![0].pending.text).toBe('second');
    expect(await buffer.save()).toBe(true);expect(api.savePptx).toHaveBeenCalledTimes(2);
  });
  it('does not clear a reverting keystroke typed during the preceding mutation RPC',async()=>{
    let complete!:(value:PptxEditState)=>void;api.editPptx.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
    const pptx=buffer.pptx!;pptx.setNotes('256','first','original',0);const saving=buffer.save();
    await vi.waitFor(()=>expect(api.editPptx).toHaveBeenCalledTimes(1));
    pptx.setNotes('256','original','original',0);current=state(1,true,'first');complete(current);expect(await saving).toBe(false);
    expect(pptx.pending?.text).toBe('original');expect(buffer.dirty).toBe(true);
    expect(await buffer.save()).toBe(true);expect(api.editPptx.mock.calls[1][0].action.text).toBe('original');
  });
  it('does not clear new input arriving while an older save is in flight',async()=>{
    let finish!:(value:PptxSaveResult)=>void;api.savePptx.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pptx=buffer.pptx!;pptx.setNotes('256','first','original');const saving=buffer.save();
    await vi.waitFor(()=>expect(api.savePptx).toHaveBeenCalledTimes(1));const input=api.savePptx.mock.calls[0][0],receipt=saved(input);
    pptx.setNotes('256','newer','first',1);finish(receipt);expect(await saving).toBe(false);
    expect(buffer.dirty).toBe(true);expect(pptx.pending?.text).toBe('newer');expect(buffer.baseHash).toBe(receipt.receipt.revision!.hash);
    expect(await buffer.save()).toBe(true);
  });
  it('requires an explicit conflict resolution and rebases before preserving local content',async()=>{
    buffer.pptx!.setNotes('256','local','original');api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'outside'}});
    await buffer.refresh();expect(buffer.conflict).toBe(true);expect(buffer.pptx!.pending?.text).toBe('local');expect(await buffer.save()).toBe(false);
    api.rebasePptx.mockResolvedValue({...file,revision:{...file.revision,hash:'outside'}});expect(await buffer.keepLocal()).toBe(true);expect(api.rebasePptx).toHaveBeenCalledTimes(1);expect(buffer.conflict).toBe(false);
  });
  it('retains restored draft input, navigation and conflict when its baseline is old',async()=>{
    api.restorePptx.mockResolvedValue({state:state(1,true,'snapshot'),pending:{slideId:'256',text:'恢复输入'},baseHash:'old',bufferVersion:9,hash:'draft'});api.refresh.mockResolvedValue({...file,revision:{...file.revision,hash:'outside'}});
    await buffer.restoreDraft('recovered');expect(buffer.pptx!.pending?.text).toBe('恢复输入');expect(buffer.draftId).toBe('recovered');expect(buffer.conflict).toBe(true);expect(buffer.pptx!.editing).toBe(true);expect(buffer.pdfPosition.page).toBe(1);
    expect(await buffer.prepareClose('save')).toBe(false);expect(api.savePptx).not.toHaveBeenCalled();
  });
  it('preserves an open failure across focus refresh and retries with a fresh document id',async()=>{
    api.openPptx.mockRejectedValueOnce(new Error('[TOO_LARGE] active limit'));const id=buffer.pptx!.id;await buffer.pptx!.reload();expect(buffer.loadState).toBe('error');
    await buffer.refresh();expect(buffer.loadError).toBe('active limit');await buffer.pptx!.reload();expect(buffer.loadState).toBe('ready');expect(buffer.pptx!.id).not.toBe(id);
  });
  it('keeps stable page selection when another slide is copied or deleted and restores view history',async()=>{
    const first=current.info.slides[0],second={...first,id:'257',notes:'second'};
    current={...current,info:{...current.info,slides:[first,second]}};buffer.pptx!.result!.state=current;buffer.pdfPosition.page=2;buffer.pdfPosition.zoom=150;
    const past:PptxEditState[]=[],future:PptxEditState[]=[];
    api.editPptx.mockImplementation(async({version,action})=>{
      expect(version).toBe(current.version);past.push(current);future.length=0;
      const slides=[...current.info.slides],index=slides.findIndex(slide=>slide.id===action.slideId);
      if(action.type==='duplicate')slides.splice(index+1,0,{...slides[index],id:'258'});
      else if(action.type==='add')slides.push({...first,id:'259',notes:''});
      else if(action.type==='delete')slides.splice(index,1);
      current={...current,version:version+1,dirty:true,canUndo:true,canRedo:false,info:{...current.info,slides}};return current;
    });
    api.pptxHistory.mockImplementation(async({version,direction})=>{
      const from=direction==='undo'?past:future,to=direction==='undo'?future:past,next=from.pop()!;to.push(current);
      current={...next,version:version+1,canUndo:past.length>0,canRedo:future.length>0};return current;
    });
    const pptx=buffer.pptx!;
    expect(await pptx.action({type:'duplicate',slideId:'256'})).toBe(true);expect(buffer.pdfPosition.page).toBe(3);
    expect(await pptx.action({type:'delete',slideId:'258'})).toBe(true);expect(buffer.pdfPosition.page).toBe(2);
    expect(await pptx.action({type:'delete',slideId:'257'})).toBe(true);expect(buffer.pdfPosition.page).toBe(1);
    buffer.pdfPosition.zoom=75;await pptx.history('undo');expect(buffer.pdfPosition).toMatchObject({page:2,zoom:150});
    await pptx.history('redo');expect(buffer.pdfPosition).toMatchObject({page:1,zoom:150});
    expect(await pptx.action({type:'add',slideId:'256'})).toBe(true);expect(buffer.pdfPosition.page).toBe(2);expect(pptx.result!.state.info.slides[1].id).toBe('259');
    await pptx.history('undo');expect(buffer.pdfPosition.page).toBe(1);await pptx.history('redo');expect(buffer.pdfPosition.page).toBe(2);
  });
  it('flushes pending notes before structure edits and leaves both untouched when composition or validation blocks',async()=>{
    const pptx=buffer.pptx!;pptx.setComposing(true);pptx.setNotes('256','中文候选','original');
    expect(await pptx.action({type:'duplicate',slideId:'256'})).toBe(false);expect(api.editPptx).not.toHaveBeenCalled();
    pptx.setComposing(false);api.editPptx.mockRejectedValueOnce(new Error('备注格式尚未支持'));
    expect(await pptx.action({type:'delete',slideId:'256'})).toBe(false);expect(pptx.pending?.text).toBe('中文候选');expect(buffer.saveError).toContain('备注格式');
    expect(await pptx.action({type:'duplicate',slideId:'256'})).toBe(true);
    expect(api.editPptx.mock.calls.map(([input])=>input.action.type)).toEqual(['notes','notes','duplicate']);expect(pptx.pending).toBeNull();
  });
});
