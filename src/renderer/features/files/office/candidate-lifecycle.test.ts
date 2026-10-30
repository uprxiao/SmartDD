// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {FileBuffer} from '../file-buffer';

const api=vi.hoisted(()=>Object.fromEntries(['openOffice','closeOffice','drafts','refresh','officeCell','officeWindow','closeDocument','resolveDraft','editOffice','saveOffice','reconnectOffice','checkpointOffice'].map(name=>[name,vi.fn()])));
vi.mock('@renderer/lib/ipc',()=>({rpc:{files:api}}));
const workbook={kind:'xlsx' as const,sheets:[{id:'1',name:'Data',hidden:'visible' as const,rows:10,columns:10,protected:false,defaultRowHeight:20,defaultColumnWidth:80,rowSizes:[],columnSizes:[]}],date1904:false,signed:false,externalLinks:0,protected:false};
const file=()=>({ref:{id:crypto.randomUUID(),lease:crypto.randomUUID(),generation:1},name:'source.xlsx',relativePath:'source.xlsx',absolutePath:'/synthetic/source.xlsx',documentKey:'local:1:2',revision:{hash:'a'.repeat(64),device:'1',inode:'2',size:100,modifiedNs:'1',changedNs:'1'},writable:true,sourceReadOnly:false});
const receipt=(id:string,hash='a'.repeat(64))=>({id,hash,workbook,state:{version:0,dirty:false,canUndo:false,canRedo:false,workbook},calculation:{state:'ready'}});
let buffer:FileBuffer|undefined;
afterEach(()=>{buffer?.dispose();buffer=undefined;vi.restoreAllMocks();});
async function setup(){
  vi.resetAllMocks();const document=file();
  api.openOffice.mockImplementation(async input=>receipt(input.id,input.baseHash));
  api.closeOffice.mockResolvedValue(undefined);api.closeDocument.mockResolvedValue(undefined);api.resolveDraft.mockResolvedValue({resolved:true});
  api.drafts.mockResolvedValue([]);api.refresh.mockImplementation(async()=>document);
  api.officeCell.mockResolvedValue({address:'A1',text:'Label',formula:false,start:0,end:5,total:5});
  api.officeWindow.mockResolvedValue({sheetId:'1',cells:[]});
  buffer=new FileBuffer(document,api as never,()=>undefined);await buffer.load();buffer.pauseAutosave();return buffer;
}

it('keeps the authorized last-good reader after parse failure and retries the original hash after repair',async()=>{
  const b=await setup(),office=b.office!,old=office.client!,writer=office.writer,model=office.result;
  const bad={...b.file,revision:{...b.file.revision,hash:'b'.repeat(64)}};
  api.refresh.mockResolvedValue(bad);api.openOffice.mockRejectedValueOnce(new Error('Malformed OOXML'));
  await b.refresh();
  expect(office.result).toBe(model);expect(office.client).toBe(old);expect(b.baseHash).toBe('a'.repeat(64));
  expect(office.sourceState).toBe('fallback');expect(office.editable).toBe(false);expect(await old.text('1',0,0)).toBe('Label');
  expect(await writer.editCell({sheetId:'1',row:0,column:0,text:'stale'})).toBe(false);expect(api.editOffice).not.toHaveBeenCalled();
  api.refresh.mockResolvedValue({...bad,revision:{...bad.revision,hash:'a'.repeat(64)}});
  await b.refresh();
  expect(office.sourceState).toBe('live');expect(office.editable).toBe(true);expect(office.client).not.toBe(old);
  expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(1);
  expect(await writer.save()).toBe(false);expect(api.saveOffice).not.toHaveBeenCalled();
});

it('does not open an extra candidate when a mounted preview asks to load during fallback authorization',async()=>{
  const b=await setup(),office=b.office!,old=office.client!;
  const bad={...b.file,revision:{...b.file.revision,hash:'b'.repeat(64)}};
  let authorize!:(value:unknown)=>void;
  api.refresh.mockResolvedValueOnce(bad).mockImplementationOnce(()=>new Promise(resolve=>{authorize=resolve;}));
  api.openOffice.mockRejectedValueOnce(new Error('Malformed OOXML'));
  const refreshing=b.refresh();await vi.waitFor(()=>expect(authorize).toBeTypeOf('function'));
  await office.load();expect(api.openOffice).toHaveBeenCalledTimes(2);
  authorize(bad);await refreshing;
  expect(office.client).toBe(old);expect(office.sourceState).toBe('fallback');expect(office.editable).toBe(false);
  expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(0);
});

it('uses the actual repaired native revision when explicit retry happens before its watch event',async()=>{
  const b=await setup(),office=b.office!,old=office.client!;
  const bad={...b.file,revision:{...b.file.revision,hash:'b'.repeat(64)}};
  api.refresh.mockResolvedValue(bad);api.openOffice.mockRejectedValueOnce(new Error('Malformed OOXML'));
  await b.refresh();expect(office.sourceState).toBe('fallback');expect(b.file.revision.hash).toBe('b'.repeat(64));
  const repaired={...bad,revision:{...bad.revision,hash:'c'.repeat(64)}};
  api.refresh.mockResolvedValue(repaired);
  api.openOffice.mockImplementationOnce(async input=>{
    expect(input.baseHash).toBe(repaired.revision.hash);return receipt(input.id,input.baseHash);
  });
  await office.reload();
  expect(office.client).not.toBe(old);expect(office.sourceState).toBe('live');expect(office.editable).toBe(true);
  expect(b.baseHash).toBe(repaired.revision.hash);expect(office.result?.hash).toBe(repaired.revision.hash);
  expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(1);
});

it('does not expose a cached model as fallback after its actual native authorization fails',async()=>{
  const b=await setup(),office=b.office!,writer=office.writer;
  api.refresh.mockResolvedValueOnce({...b.file,revision:{...b.file.revision,hash:'b'.repeat(64)}}).mockRejectedValueOnce(new Error('STALE_ROOT'));
  api.openOffice.mockRejectedValueOnce(new Error('Malformed OOXML'));
  await b.refresh();
  expect(office.sourceState).toBe('blocked');expect(office.editable).toBe(false);expect(b.loadError).toContain('STALE_ROOT');
  expect(await writer.save()).toBe(false);expect(api.saveOffice).not.toHaveBeenCalled();
});

it('retires an old model only after its already-issued read settles and rejects subsequent old reads',async()=>{
  const b=await setup(),office=b.office!,old=office.client!;
  let finish!:(value:unknown)=>void;
  api.officeWindow.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const reading=old.window('1',[0],[0]);
  await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  await office.reload();
  expect(office.sourceState).toBe('live');expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(0);
  await expect(old.cell('1',0,0)).rejects.toThrow('已关闭');
  finish({sheetId:'1',cells:[]});await expect(reading).resolves.toMatchObject({sheetId:'1'});
  await vi.waitFor(()=>expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(1));
});

it('retains the new model lifetime when its source is withdrawn after a committed reconnect reply',async()=>{
  const b=await setup(),office=b.office!,oldRef=b.file.ref,client=office.client!,writer=office.writer;
  b.invalidateSource('original root unavailable');
  const source=(office as unknown as {hostOptions:{source:{kind:string;phase?:string;controller?:unknown}}}).hostOptions.source;
  expect(source.kind).toBe('artifactDocument');expect(source.phase).toBe('blocked');expect(source.controller).toBeUndefined();
  const next={...b.file,ref:{id:crypto.randomUUID(),lease:crypto.randomUUID(),generation:2}};
  api.reconnectOffice.mockImplementation(async()=>({document:next,baseHash:b.baseHash,state:office.result!.state,calculation:office.result!.calculation}));
  api.refresh.mockRejectedValueOnce(new Error('new root withdrawn'));
  await expect(b.reconnectSource(next)).rejects.toThrow('new root withdrawn');
  expect(b.file.ref).toEqual(next.ref);expect(office.client).toBe(client);expect(office.sourceState).toBe('blocked');expect(office.editable).toBe(false);
  expect(api.closeDocument.mock.calls.map(([ref])=>ref.id)).toContain(oldRef.id);
  expect(api.closeDocument.mock.calls.map(([ref])=>ref.id)).not.toContain(next.ref.id);
  expect(await writer.save()).toBe(false);expect(api.saveOffice).not.toHaveBeenCalled();
});

it('returns an explicitly supplied artifact host to live only after its replacement controller is ready',async()=>{
  const b=await setup(),office=b.office!;
  expect(await office.setWorkbookHost({source:{kind:'artifactDocument',key:'independent-host',phase:'live',controller:office.client!},manualEditUiEnabled:true})).toBe(true);
  await office.load();
  const old=office.client;await office.reload();
  expect(office.client).not.toBe(old);expect(office.sourceState).toBe('live');expect(office.editable).toBe(true);
});

it('keeps fallback readonly after an existing local caller adjusts its controls',async()=>{
  const b=await setup(),office=b.office!;
  expect(await office.setWorkbookHost({source:{kind:'local'},isEditing:true,manualEditUiEnabled:false})).toBe(true);
  api.refresh.mockResolvedValue({...b.file,revision:{...b.file.revision,hash:'b'.repeat(64)}});
  api.openOffice.mockRejectedValueOnce(new Error('Malformed OOXML'));
  await b.refresh();
  expect(office.sourceState).toBe('fallback');expect(office.editable).toBe(false);
  expect(await office.writer.editCell({sheetId:'1',row:0,column:0,text:'must not write'})).toBe(false);expect(api.editOffice).not.toHaveBeenCalled();
});

it('releases the earlier retained reader when a source is renewed after interruption during candidate loading',async()=>{
  const b=await setup(),office=b.office!,old=office.client!;
  let finish!:(value:unknown)=>void;
  api.openOffice.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
  const replacing=office.reload();await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
  const candidate=office.client!;b.invalidateSource('root withdrawn while opening');finish(receipt(candidate.id));await replacing;
  const next={...b.file,ref:{id:crypto.randomUUID(),lease:crypto.randomUUID(),generation:2}};
  api.reconnectOffice.mockImplementation(async()=>({document:next,baseHash:b.baseHash,state:office.result!.state,calculation:office.result!.calculation}));api.refresh.mockResolvedValue(next);
  await b.reconnectSource(next);
  expect(office.client).toBe(candidate);expect(office.sourceState).toBe('live');expect(candidate.owns(next.ref)).toBe(true);
  expect(api.closeOffice.mock.calls.filter(([id])=>id===old.id)).toHaveLength(1);await expect(old.text('1',0,0)).rejects.toThrow('已关闭');
});
