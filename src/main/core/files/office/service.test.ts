import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FileError, type FileRef } from '@shared/files';
import { FileHeavyJobs } from '../heavy-jobs';
import { FileOfficeService, type OfficeSource } from './service';

describe('Office production session lifecycle', () => {
  let directory: string, worker: string, bytes: Buffer, hash: string;
  beforeAll(() => {
    directory = mkdtempSync(join(tmpdir(), 'willyou-office-service-')); worker = join(directory, 'office.cjs');
    const require = createRequire(import.meta.url), build = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
    build.buildSync({ entryPoints: [resolve('src/main/core/files/office/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
    bytes = readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'); hash = createHash('sha256').update(bytes).digest('hex');
  });
  afterAll(() => rmSync(directory, { recursive: true, force: true }));
  const ref = (): FileRef => ({ id: randomUUID(), lease: randomUUID(), generation: 1 });
  const source = (extra: Partial<OfficeSource> = {}): OfficeSource => ({ name: 'real-fixture.xlsx', hash, size: bytes.length, signal: new AbortController().signal, assert() {}, read: async (offset, length) => bytes.subarray(offset, offset + length), ...extra });
  it('runs drawing insertion through the real Worker transaction, owner/permission gates and complete undo/redo',async()=>{
    let writable=true;const service=new FileOfficeService(()=>source({writable}),worker,new FileHeavyJobs()),id=randomUUID();
    const range={firstRow:1,lastRow:1,firstColumn:1,lastColumn:1},action={type:'drawing-insert' as const,sheetId:'1',range,drawing:{kind:'shape' as const,shape:'diamond' as const}};
    const view=()=>service.window('owner',{id,sheetId:'1',row:0,column:0,rows:6,columns:6});
    try{
      await service.open('owner',{id,ref:ref(),baseHash:hash});const before=await view();
      await expect(service.rangeAction('foreign',{id,version:0,action})).rejects.toThrow('不属于');
      writable=false;await expect(service.rangeAction('owner',{id,version:0,action})).rejects.toThrow('只读');writable=true;
      const changed=await service.rangeAction('owner',{id,version:0,action});expect(changed.state.version).toBe(1);expect(changed.state.canUndo).toBe(true);
      const after=await view();expect(after.objects?.filter(value=>value.kind==='shape')).toHaveLength((before.objects?.filter(value=>value.kind==='shape').length??0)+1);
      expect(after.objects?.at(-1)).toMatchObject({kind:'shape',shape:{geometry:'diamond'}});expect(after.cells).toEqual(before.cells);
      await expect(service.rangeAction('owner',{id,version:0,action})).rejects.toThrow('版本');
      await service.history('owner',{id,version:1,direction:'undo'});expect((await view()).objects).toEqual(before.objects);
      await service.history('owner',{id,version:2,direction:'redo'});expect((await view()).objects).toEqual(after.objects);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    }finally{service.dispose();expect(service.activeDocuments).toBe(0);}
  });
  it('rejects forged renderer image receipts and missing decoder before changing the Worker version',async()=>{
    const service=new FileOfficeService(()=>source(),worker,new FileHeavyJobs()),id=randomUUID();
    const action={type:'drawing-insert' as const,sheetId:'1',range:{firstRow:0,lastRow:0,firstColumn:0,lastColumn:0},drawing:{kind:'image' as const,image:{mime:'image/png' as const,base64:'iVBORw0KGgo='}}};
    try{
      await service.open('owner',{id,ref:ref(),baseHash:hash});
      await expect(service.rangeAction('owner',{id,version:0,action:{...action,imageReceipt:{hash:'0'.repeat(64),width:2,height:2}}} as never)).rejects.toThrow();
      await expect(service.rangeAction('owner',{id,version:0,action})).rejects.toThrow('解码器不可用');
      const applied=await service.rangeAction('owner',{id,version:0,action:{...action,drawing:{kind:'shape',shape:'rect'}}});expect(applied.state.version).toBe(1);
    }finally{service.dispose();}
  });
  it('uses current source permissions without replacing the retained workbook model', async () => {
    let writable = false;
    const service = new FileOfficeService(() => source({ writable }), worker, new FileHeavyJobs()), id = randomUUID();
    try {
      await service.open('owner', { id, ref: ref(), baseHash: hash });
      const edit = { sheetId: '1', row: 0, column: 0, text: 'restored permission' };
      await expect(service.edit('owner', { id, version: 0, edit })).rejects.toMatchObject({ code: 'PERMISSION' });
      writable = true;
      const changed = await service.edit('owner', { id, version: 0, edit });
      expect(changed.state.canUndo).toBe(true);
      expect(changed.state.dirty).toBe(true);
      writable = false;
      await expect(service.edit('owner', { id, version: changed.state.version, edit: { ...edit, text: 'denied edit' } })).rejects.toMatchObject({ code: 'PERMISSION' });
      await expect(service.history('owner', { id, version: changed.state.version, direction: 'undo' })).rejects.toMatchObject({ code: 'PERMISSION' });
      await expect(service.save('owner', { id, version: changed.state.version, draftId: randomUUID(), bufferVersion: 1, opId: randomUUID() })).rejects.toMatchObject({ code: 'PERMISSION' });
      expect((await service.cell('owner', { id, sheetId: '1', row: 0, column: 0, start: 0, length: 256 })).text).toBe(edit.text);
      writable = true;
      const restored = await service.history('owner', { id, version: changed.state.version, direction: 'undo' });
      expect(restored.state.dirty).toBe(false);
      expect((await service.cell('owner', { id, sheetId: '1', row: 0, column: 0, start: 0, length: 256 })).text).toBe('Label');
      expect(service.activeDocuments).toBe(1);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(hash);
    } finally { service.dispose(); }
  });
  it('serves real cells only to their owning session and keeps separate document generations until closed', async () => {
    const service = new FileOfficeService(() => source(), worker, new FileHeavyJobs()), id = randomUUID(), second = randomUUID();
    try {
      expect((await service.open('one', { id, ref: ref(), baseHash: hash })).workbook.sheets).toHaveLength(3);
      const request = { id, sheetId: '1', row: 1, column: 1, start: 0, length: 100 };
      await expect(service.cell('two', request)).rejects.toThrow('不属于');
      expect((await service.cell('one', request)).text).toBe('3');
      service.close('two', id); expect((await service.cell('one', request)).text).toBe('3');
      await service.open('one', { id: second, ref: ref(), baseHash: hash });
      expect((await service.cell('one', request)).text).toBe('3'); expect(service.activeDocuments).toBe(2);
      service.close('one',id); await expect(service.cell('one',request)).rejects.toThrow('已关闭'); expect(service.activeDocuments).toBe(1);
      service.closeOwner('one'); expect(service.activeDocuments).toBe(0);
    } finally { service.dispose(); }
  });
  it('honours close-before-open while retaining ready local models after source revocation', async () => {
    const abort = new AbortController(); let changed = false;
    const service = new FileOfficeService(() => source({ signal: abort.signal, assert: () => { if (changed) throw new FileError('CHANGED', 'synthetic changed revision'); } }), worker, new FileHeavyJobs());
    try {
      const closed = randomUUID(); service.close('owner', closed);
      await expect(service.open('owner', { id: closed, ref: ref(), baseHash: hash })).rejects.toThrow('取消');
      const first = randomUUID(); await service.open('owner', { id: first, ref: ref(), baseHash: hash }); changed = true;
      expect((await service.cell('owner', { id: first, sheetId: '1', row: 0, column: 0, start: 0, length: 1 })).text).toBe('L'); expect(service.activeDocuments).toBe(1);
      await expect(service.open('owner',{id:randomUUID(),ref:ref(),baseHash:hash})).rejects.toThrow('changed revision');
      changed = false; abort.abort(); expect(service.activeDocuments).toBe(1);
      expect((await service.cell('owner', { id: first, sheetId: '1', row: 0, column: 0, start: 0, length: 1 })).text).toBe('L');
    } finally { service.dispose(); }
  });
  it('scopes range mutations and preserves the version when native formula validation fails',async()=>{
    let reject=true,validations=0;
    const engine={async calculate():Promise<never>{throw new FileError('UNSUPPORTED','isolated calculation');},async validateFormulas(){validations++;if(reject)throw new FileError('INVALID_INPUT','synthetic range syntax rejected');},async recover(){},dispose(){}};
    const service=new FileOfficeService(()=>source(),worker,new FileHeavyJobs(),engine),id=randomUUID(),range={firstRow:1,lastRow:1,firstColumn:1,lastColumn:2},action={type:'fill' as const,direction:'right' as const,sheetId:'2',range};
    try {
      await service.open('owner',{id,ref:ref(),baseHash:hash});
      await expect(service.range('foreign',{id,sheetId:'2',range,text:true})).rejects.toThrow('不属于');
      await expect(service.rangeAction('foreign',{id,version:0,action})).rejects.toThrow('不属于');
      await expect(service.rangeAction('owner',{id,version:0,action})).rejects.toThrow('syntax rejected');
      expect(validations).toBe(1);expect((await service.cell('owner',{id,sheetId:'2',row:1,column:2,start:0,length:100})).text).toBe('');
      reject=false;const applied=await service.rangeAction('owner',{id,version:0,action});expect(applied.state.version).toBe(1);
      expect((await service.range('owner',{id,sheetId:'2',range,text:true})).text).toBe('=Data!$B$2+Data!B3\t=Data!$B$2+Data!C3');
      await expect(service.rangeAction('owner',{id,version:0,action})).rejects.toThrow('版本');
      expect((await service.history('owner',{id,version:1,direction:'undo'})).state.dirty).toBe(false);
    } finally {service.dispose();}
    const readonly=new FileOfficeService(()=>source({writable:false}),worker,new FileHeavyJobs());
    try {await readonly.open('owner',{id,ref:ref(),baseHash:hash});await expect(readonly.rangeAction('owner',{id,version:0,action})).rejects.toThrow('只读');}
    finally {readonly.dispose();}
  });
  it('rejects formula range edits if validation is unavailable but still permits bounded value operations',async()=>{
    const service=new FileOfficeService(()=>source(),worker,new FileHeavyJobs()),id=randomUUID(),range={firstRow:1,lastRow:2,firstColumn:1,lastColumn:1};
    try {
      await service.open('owner',{id,ref:ref(),baseHash:hash});
      await expect(service.rangeAction('owner',{id,version:0,action:{type:'fill',direction:'down',sheetId:'2',range}})).rejects.toThrow('公式校验暂不可用');
      const applied=await service.rangeAction('owner',{id,version:0,action:{type:'fill',direction:'down',sheetId:'1',range}});expect(applied.state.version).toBe(1);
      expect((await service.range('owner',{id,sheetId:'1',range,text:true})).text).toBe('3\n3');
    } finally {service.dispose();}
  });
  it('scopes structural mutations to the owner, read/write capability and current model version',async()=>{
    const service=new FileOfficeService(()=>source(),worker,new FileHeavyJobs()),id=randomUUID();
    try {
      await service.open('owner',{id,ref:ref(),baseHash:hash});
      await expect(service.sheetAction('foreign',{id,version:0,action:{type:'add'}})).rejects.toThrow('不属于');
      const added=await service.sheetAction('owner',{id,version:0,action:{type:'add'}});expect(added.state.workbook.sheets).toHaveLength(4);
      await expect(service.sheetAction('owner',{id,version:0,action:{type:'move',sheetId:added.sheetId,index:0}})).rejects.toThrow('版本已改变');
      const moved=await service.sheetAction('owner',{id,version:1,action:{type:'move',sheetId:added.sheetId,index:0}});expect(moved.state.workbook.sheets[0].id).toBe(added.sheetId);
    } finally {service.dispose();}
    const readonly=new FileOfficeService(()=>source({writable:false}),worker,new FileHeavyJobs());
    try {await readonly.open('owner',{id,ref:ref(),baseHash:hash});await expect(readonly.sheetAction('owner',{id,version:0,action:{type:'add'}})).rejects.toThrow('只读');}
    finally {readonly.dispose();}
  });
  it('cancels queued parsing without starting a reader and rejects incomplete/mismatched input', async () => {
    const jobs = new FileHeavyJobs(); let finish!: () => void, reads = 0;
    const holding = jobs.run(new AbortController().signal, () => new Promise<void>((resolve) => { finish = resolve; }));
    await Promise.resolve();
    const service = new FileOfficeService(() => source({ read: async () => { reads++; return bytes; } }), worker, jobs), id = randomUUID();
    try {
      const request = service.open('owner', { id, ref: ref(), baseHash: hash }); service.close('owner', id);
      await expect(request).rejects.toThrow('取消'); expect(reads).toBe(0);
    } finally { finish(); await holding; service.dispose(); }
    const incomplete = new FileOfficeService(() => source({ read: async () => bytes.subarray(0, -1) }), worker, new FileHeavyJobs());
    try { await expect(incomplete.open('owner', { id: randomUUID(), ref: ref(), baseHash: hash })).rejects.toThrow('不完整'); expect(incomplete.activeDocuments).toBe(0); }
    finally { incomplete.dispose(); }
    const mismatch = new FileOfficeService(() => source(), worker, new FileHeavyJobs());
    try { await expect(mismatch.open('owner', { id: randomUUID(), ref: ref(), baseHash: '0'.repeat(64) })).rejects.toThrow('版本已改变'); }
    finally { mismatch.dispose(); }
  });
  it('drops a parser that crashes after open, but keeps a session after an ordinary invalid cell request', async () => {
    const crashWorker = join(directory, 'crash-after-open.cjs');
    writeFileSync(crashWorker, "const {parentPort}=require('node:worker_threads'); parentPort.on('message',m=>{if(m.method==='open')parentPort.postMessage({id:m.id,result:{kind:'xlsx',sheets:[]}});else if(m.method==='state')parentPort.postMessage({id:m.id,result:{version:0,dirty:false}});else process.exit(7);});");
    const crash = new FileOfficeService(() => source(), crashWorker, new FileHeavyJobs()), id = randomUUID();
    try {
      await crash.open('one', { id, ref: ref(), baseHash: hash });
      await expect(crash.cell('one', { id, sheetId: '1', row: 0, column: 0, start: 0, length: 1 })).rejects.toThrow('退出');
      expect(crash.activeDocuments).toBe(0);
    } finally { crash.dispose(); }
    const healthy = new FileOfficeService(() => source(), worker, new FileHeavyJobs());
    try {
      await healthy.open('one', { id, ref: ref(), baseHash: hash });
      await expect(healthy.cell('one', { id, sheetId: 'missing', row: 0, column: 0, start: 0, length: 1 })).rejects.toThrow('不存在');
      expect(healthy.activeDocuments).toBe(1);
      expect((await healthy.cell('one', { id, sheetId: '1', row: 0, column: 0, start: 0, length: 100 })).text).toBe('Label');
    } finally { healthy.dispose(); }
  });
  it('exposes a calculation failure as cached data and cancels an in-flight result when its source is revoked', async () => {
    const signal = new AbortController(), engine = { async calculate(): Promise<never> { throw new FileError('UNSUPPORTED', 'synthetic unsupported formula'); }, async recover() {}, dispose() {} };
    const fallback = new FileOfficeService(() => source(), worker, new FileHeavyJobs(), engine), id = randomUUID();
    try {
      const result = await fallback.open('one', { id, ref: ref(), baseHash: hash });
      expect(result.calculation?.state).toBe('cached'); expect(result.calculation?.message).toContain('unsupported formula');
      expect((await fallback.cell('one', { id, sheetId: '2', row: 1, column: 1, start: 0, length: 100 })).text).toBe('=Data!$B$2+Data!B3');
    } finally { fallback.dispose(); }
    let started!: () => void; const entered = new Promise<void>((resolve) => { started = resolve; });
    const delayed = { ...engine, calculate: async (_bytes: Uint8Array, cancel: AbortSignal): Promise<never> => { started(); return new Promise((_resolve, reject) => cancel.addEventListener('abort', () => reject(new FileError('CANCELLED', 'synthetic cancellation')), { once: true })); } };
    const service = new FileOfficeService(() => source({ signal: signal.signal }), worker, new FileHeavyJobs(), delayed);
    try {
      const result = service.open('one', { id, ref: ref(), baseHash: hash }); await entered; signal.abort();
      await expect(result).rejects.toMatchObject({ code: 'CANCELLED' }); expect(service.activeDocuments).toBe(0);
    } finally { service.dispose(); }
  });
});
