import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { subscribe, type SubscribeCallback } from '@parcel/watcher';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { FileError, type FileWatchUpdate } from '@shared/files';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { OfficePackage } from '@main/core/files/office/package';
import { OfficeWorkbook } from '@main/core/files/office/workbook';
import { OfficeParser } from '@main/core/files/office/parser';
import { decodeOfficeDraft } from '@main/core/files/office/draft';
import { FileWatchService } from '@main/core/files/watch-service';
import { FileBuffer } from '../file-buffer';
import { FileOfficePreview } from './preview';

const api = vi.hoisted(() => Object.fromEntries(['openOffice', 'closeOffice', 'editOffice', 'checkpointOffice', 'saveOffice', 'recalculateOffice', 'officeCell', 'drafts', 'refresh', 'resolveDraft', 'closeDocument'].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const until = async (condition: () => boolean) => { const end = Date.now() + 10000; while (!condition()) { if (Date.now() > end) throw new Error('J06 real IO did not settle'); await delay(5); } };
let work = '', worker = '', fixtureIndex = 0; const rows: unknown[] = [], cleanups: (() => Promise<void>)[] = [];
class FaultBroker extends NativeFileBroker {
  rejectCheckpoint = false; loseCheckpointReceipt = false; operations: string[] = []; checkpoints: Record<string, unknown>[] = [];
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    this.operations.push(String(input.operation));
    if (input.operation === 'checkpoint') this.checkpoints.push(structuredClone(input));
    if (input.operation === 'checkpoint' && this.rejectCheckpoint) throw new FileError('IO', 'J06 injected checkpoint storage failure');
    const result=await super.request<T>(input, options);
    if (input.operation === 'checkpoint' && this.loseCheckpointReceipt) { this.loseCheckpointReceipt=false; throw new FileError('IO','J08 injected lost durable checkpoint receipt'); }
    return result;
  }
}
beforeAll(() => {
  work = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-j06-'))); worker = join(work, 'office.cjs');
  if (process.env.SMARTDD_OFFICE_ACCEPTANCE_APP) { worker=join(process.env.SMARTDD_OFFICE_ACCEPTANCE_APP,'Contents/Resources/app.asar/out/main/m9-office-document.js'); return; }
  const require = createRequire(import.meta.url), build = createRequire(require.resolve('electron-vite/package.json'))('esbuild');
  build.buildSync({ entryPoints: [resolve('src/main/core/files/office/worker.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: worker, alias: { '@shared': resolve('src/shared') } });
});
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); vi.useRealTimers(); vi.resetAllMocks(); });
afterAll(() => { if (process.env.SMARTDD_J06_EVIDENCE) writeFileSync(process.env.SMARTDD_J06_EVIDENCE, JSON.stringify({ caseIds: ['M9-T-J06','M9-T-J08'], completedAt: new Date().toISOString(), rows }, null, 2) + '\n'); rmSync(work, { recursive: true, force: true }); });
async function fixture(options: { readonly?: boolean; name?: string; bytes?: Buffer } = {}) {
  const directory = join(work, String(++fixtureIndex)), project = join(directory, 'project'), userdata = join(directory, 'userdata'); mkdirSync(project, { recursive: true }); mkdirSync(userdata);
  const bytes = options.bytes ?? readFileSync('docs/里程碑/M9_文件浏览工作区/验收/证据/predev-office/final/rich-source.xlsx'), name = options.name ?? 'state.xlsx', path = join(project, name); writeFileSync(path, bytes); if (options.readonly) chmodSync(path, 0o444);
  const broker = new FaultBroker(process.env.SMARTDD_M9_FILE_BROKER!), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'j06', path: project, label: 'J06 synthetic fixture', projectId: 'j06' }] };
  // No calculation engine configured: exercise the production cached fallback,
  // rather than providing fake calculated cells or a fabricated save receipt.
  const recovery = new FileRecoveryStore(broker, userdata, resolver), service = new FileService(new FileRootsService(resolver, broker), broker, recovery, undefined, undefined, undefined, undefined, worker);
  const owner = 'j06', root = (await service.openScope(owner, { kind: 'project', projectId: owner })).roots[0], file = await service.open(owner, { lease: root.lease, generation: root.generation, relativePath: name });
  api.openOffice.mockImplementation(input => service.office.open(owner, input)); api.closeOffice.mockImplementation(async id => service.office.close(owner, id)); api.editOffice.mockImplementation(input => service.office.edit(owner, input)); api.checkpointOffice.mockImplementation(input => service.office.checkpoint(owner, input)); api.saveOffice.mockImplementation(input => service.office.save(owner, input)); api.recalculateOffice.mockImplementation(input => service.office.recalculate(owner, input)); api.officeCell.mockImplementation(input => service.office.cell(owner, input)); api.drafts.mockImplementation(async ref => service.drafts(owner, ref)); api.refresh.mockImplementation(ref => service.refresh(owner, ref)); api.resolveDraft.mockImplementation(input => service.resolveDraft(owner, input)); api.closeDocument.mockImplementation(async ref => service.closeDocument(owner, ref));
  const buffer = new FileBuffer(file, api as unknown as ConstructorParameters<typeof FileBuffer>[1], () => undefined), office = buffer.getOffice();
  cleanups.push(async () => { buffer.dispose(); await until(() => broker.activeProcesses === 0); service.closeOwner(owner); await service.watcher.dispose(); broker.dispose(); });
  const state = () => ({ loadState: buffer.loadState, busy: office.busy, editable: office.editable, dirty: buffer.dirty, conflict: buffer.conflict, loadError: buffer.loadError, saveError: buffer.saveError, draftError: buffer.draftError, calculation: office.result?.calculation ?? null, diskHash: sha(readFileSync(path)), revision: buffer.baseHash, html: renderToStaticMarkup(<FileOfficePreview buffer={buffer} />) });
  return { buffer, office, service, broker, owner, root, file, path, bytes, state };
}
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('J08 production XLSX failure matrix', () => {
  it.each(['before-write','lost-receipt'] as const)('retries a transient checkpoint after exactly 1000ms: %s',async failure=>{
    const f=await fixture();await f.office.load();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    f.broker.rejectCheckpoint=failure==='before-write';f.broker.loseCheckpointReceipt=failure==='lost-receipt';
    f.office.setPending({sheetId:'1',row:0,column:0,text:'checkpoint retry 中文'},'Label');
    await vi.advanceTimersByTimeAsync(500);await until(()=>!f.office.busy && Boolean(f.buffer.draftError));
    expect(f.broker.checkpoints).toHaveLength(1);const problem=f.buffer.draftError;
    f.broker.rejectCheckpoint=false;
    await vi.advanceTimersByTimeAsync(999);expect(f.broker.checkpoints).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);await until(()=>f.broker.checkpoints.length===2 && !f.office.busy && !f.buffer.draftError);
    expect(f.broker.checkpoints[1]).toEqual(f.broker.checkpoints[0]);expect(api.saveOffice).not.toHaveBeenCalled();expect(sha(readFileSync(f.path))).toBe(sha(f.bytes));
    const recovered=await f.service.readDraft(f.owner,f.file.ref,f.buffer.draftId),draft=decodeOfficeDraft(Buffer.from(recovered.base64,'base64'));
    expect(draft.pending?.text).toBe('checkpoint retry 中文');expect(new OfficeWorkbook(await OfficePackage.read(draft.bytes)).cell('1',0,0).value).toBe('Label');
    expect(await f.office.save()).toBe(true);expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(f.path))).cell('1',0,0).value).toBe('checkpoint retry 中文');
    rows.push({caseId:'M9-T-J08',branch:`checkpoint/${failure}`,problem,retryMs:1000,sameCheckpointPayload:true,draftHash:recovered.hash,sourceWrites:f.broker.operations.filter(x=>x==='save').length,final:f.state()});
  });
  it('retains an unapplied update and durable raw input when append/edit fails, then explicitly recovers once',async()=>{
    const f=await fixture();await f.office.load();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    f.office.setPending({sheetId:'1',row:0,column:0,text:'append retained 🙂'},'Label');
    api.editOffice.mockRejectedValueOnce(new FileError('IO','J08 injected edit dispatch failure'));
    expect(await f.office.save()).toBe(false);const failed=f.state();expect(failed.saveError).toContain('edit dispatch failure');expect(f.office.pending?.text).toBe('append retained 🙂');expect(f.office.result!.state.version).toBe(0);
    const recovered=await f.service.readDraft(f.owner,f.file.ref,f.buffer.draftId),draft=decodeOfficeDraft(Buffer.from(recovered.base64,'base64'));
    expect(draft.pending?.text).toBe('append retained 🙂');expect(failed.diskHash).toBe(sha(f.bytes));
    await vi.advanceTimersByTimeAsync(30000);expect(api.editOffice).toHaveBeenCalledTimes(1);expect(api.saveOffice).not.toHaveBeenCalled();expect(f.office.busy).toBe(false);
    expect(await f.office.save()).toBe(true);expect(f.office.result!.state.version).toBe(1);expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(f.path))).cell('1',0,0).value).toBe('append retained 🙂');
    rows.push({caseId:'M9-T-J08',branch:'append/expected-version edit dispatch failure',failed,draftHash:recovered.hash,sourceWrites:f.broker.operations.filter(x=>x==='save').length,final:f.state(),boundary:'Only the first edit RPC dispatch throws; recovery uses the real Worker and native persistence.'});
  });
  it.each(['stale','too-large'] as const)('preserves the model and draft when materialization reports %s',async failure=>{
    const f=await fixture();await f.office.load();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    expect(await f.office.editCell({sheetId:'1',row:0,column:0,text:`materialize ${failure}`})).toBe(true);
    api.saveOffice.mockImplementationOnce(async input=>{
      if(failure==='stale')return f.service.office.save(f.owner,{...input,version:input.version-1});
      const fault=vi.spyOn(OfficeParser.prototype,'materialize').mockRejectedValueOnce(new FileError('TOO_LARGE','J08 injected materialized package exceeds 40 MiB'));
      try{return await f.service.office.save(f.owner,input);}finally{fault.mockRestore();}
    });
    expect(await f.office.save()).toBe(false);const failed=f.state();expect(failed.saveError).toContain(failure==='stale'?'版本':'40 MiB');expect(failed.dirty).toBe(true);expect(failed.diskHash).toBe(sha(f.bytes));expect(f.office.result!.state.version).toBe(1);
    const recovered=await f.service.readDraft(f.owner,f.file.ref,f.buffer.draftId),draft=decodeOfficeDraft(Buffer.from(recovered.base64,'base64'));
    expect(new OfficeWorkbook(await OfficePackage.read(draft.bytes)).cell('1',0,0).value).toBe(`materialize ${failure}`);
    await vi.advanceTimersByTimeAsync(500);await f.office.checkpoint();await vi.advanceTimersByTimeAsync(29500);
    expect(api.saveOffice).toHaveBeenCalledTimes(1);expect(f.broker.operations.filter(x=>x==='save')).toHaveLength(0);expect(f.office.busy).toBe(false);
    expect(await f.office.save()).toBe(true);expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(f.path))).cell('1',0,0).value).toBe(`materialize ${failure}`);
    rows.push({caseId:'M9-T-J08',branch:`materialize/${failure}`,failed,draftHash:recovered.hash,sourceWrites:f.broker.operations.filter(x=>x==='save').length,final:f.state(),boundary:failure==='stale'?'Real Worker receives a stale expected version.':'Explicit TOO_LARGE injected at parser materialization boundary; this tests failure handling, not generation of a >40 MiB workbook.'});
  });
  it('degrades a disconnected native subscription to snapshots, detects a real external XLSX change and retains local edits',async()=>{
    const f=await fixture();await f.office.load();vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});
    f.office.setPending({sheetId:'1',row:0,column:0,text:'local during disconnect'},'Label');await f.office.checkpoint();
    let nativeCallback!:SubscribeCallback,unsubscribed=0;const events:FileWatchUpdate[]=[];
    const watcher=new FileWatchService(f.service.roots,f.broker,f.service.recovery,async(path,callback)=>{
      nativeCallback=callback;const connection=await subscribe(path,callback,{backend:'fs-events'});
      return {unsubscribe:async()=>{unsubscribed++;await connection.unsubscribe();}};
    });
    try {
      watcher.start(f.owner,f.service.roots.require(f.owner,f.root),[''],[f.file.relativePath],event=>events.push(event));
      await until(()=>events.some(event=>event.coverage==='native'));
      await vi.advanceTimersByTimeAsync(0);await until(()=>events.some(event=>event.coverage==='native' && !event.resyncRequired));
      nativeCallback(new Error('J08 injected native subscription disconnect'),[]);
      expect(events.at(-1)).toMatchObject({coverage:'poll',resyncRequired:true});expect(events.at(-1)!.message).toContain('原生监听不可用');
      const {editOfficeCell}=await import('@main/core/files/office/cell-edit'),external=editOfficeCell(await OfficePackage.read(f.bytes),{sheetId:'1',row:0,column:0,text:'external during disconnect'});
      writeFileSync(f.path,await external.packageData.bytes());const externalHash=sha(readFileSync(f.path));
      await vi.advanceTimersByTimeAsync(100);await until(()=>events.some(event=>event.coverage==='poll' && event.changed));
      await f.office.refresh();expect(f.buffer.conflict).toBe(true);expect(f.office.pending?.text).toBe('local during disconnect');expect(await f.office.save()).toBe(false);
      await f.office.checkpoint();expect(f.buffer.draftError).toBe('');expect(sha(readFileSync(f.path))).toBe(externalHash);expect(f.broker.operations.filter(x=>x==='save')).toHaveLength(0);
      // Losing the root lease also reports a distinct problem. A retained
      // local model can checkpoint, but cannot commit through that old lease.
      f.service.roots.closeOwner(f.owner);expect(events.at(-1)).toMatchObject({coverage:'none',resyncRequired:true});expect(events.at(-1)!.message).toContain('来源已失效');
      await f.office.refresh();expect(f.buffer.loadError).toContain('授权已失效');await f.office.checkpoint();
      expect(f.office.dirty).toBe(true);expect(f.service.office.activeDocuments).toBe(1);
      await watcher.dispose();expect(watcher.resourceCounts).toEqual({roots:0,consumers:0,timers:0,stopping:0});expect(unsubscribed).toBe(1);
      rows.push({caseId:'M9-T-J08',branch:'subscription disconnect/poll rescan/root revocation',events,externalHash,unsubscribed,resources:watcher.resourceCounts,final:f.state(),boundary:'The native subscription is real; one callback error is injected. Subsequent filesystem change is detected by production broker snapshots; renderer refresh is explicitly dispatched as by its watch consumer. No App GUI.'});
    }finally{await watcher.dispose();}
  },15000);
});
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('J06 real XLSX session states and independent problems', () => {
  it('pauses failed cached-mode autosaves after real permission removal while retaining edits for explicit retry', async () => {
    const f = await fixture(); await f.office.load();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.office.setPending({ sheetId: '1', row: 0, column: 0, text: 'retained after permission change' }, 'Label');
    chmodSync(f.path, 0o444);
    await vi.advanceTimersByTimeAsync(3000); await until(() => !f.office.busy && Boolean(f.buffer.saveError));
    expect(api.saveOffice).toHaveBeenCalledTimes(1); expect(f.buffer.saveReceipt?.state).toBe('failed');
    const failure = f.buffer.saveError; expect(failure).toContain('只读');
    await vi.advanceTimersByTimeAsync(500); await f.office.checkpoint();
    await vi.advanceTimersByTimeAsync(29500); expect(api.saveOffice).toHaveBeenCalledTimes(1);
    f.office.setPending({ sheetId: '1', row: 0, column: 0, text: 'new local after failure' }, 'retained after permission change');
    await vi.advanceTimersByTimeAsync(500); await f.office.checkpoint();
    await vi.advanceTimersByTimeAsync(29500); await until(() => !f.office.busy);
    expect(api.saveOffice).toHaveBeenCalledTimes(1); expect(f.buffer.saveError).toBe(failure); expect(f.buffer.dirty).toBe(true);
    expect(sha(readFileSync(f.path))).toBe(sha(f.bytes)); expect(f.broker.operations.filter(value => value === 'save')).toHaveLength(0);
    chmodSync(f.path, 0o644); expect(await f.office.save(), JSON.stringify({error:f.buffer.saveError,receipt:f.buffer.saveReceipt,editable:f.office.editable,dirty:f.buffer.dirty})).toBe(true);
    expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(f.path))).cell('1', 0, 0).value).toBe('new local after failure');
    expect(f.buffer.dirty).toBe(false); expect(f.broker.operations.filter(value => value === 'save')).toHaveLength(1);
    rows.push({ branch: 'DEV055 cached autosave/real permission failure/explicit recovery', attemptedBeforeRetry: 1, nativeWritesBeforeRetry: 0, elapsedAfterFailureMs: 60000, errorRetainedWhileEditing: true, nativeWritesAfterRetry: 1, final: f.state() });
  });
  it('exposes starting then live cached fallback, and a fresh source reload without writing the original', async () => {
    const f = await fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    api.openOffice.mockImplementationOnce(async input => { await gate; return f.service.office.open(f.owner, input); });
    const loading = f.office.load(), starting = f.state(); expect(starting.loadState).toBe('loading'); expect(starting.editable).toBe(false); expect(starting.html).toContain('正在读取工作簿'); expect(starting.html).toContain('readOnly=""'); release(); await loading;
    const live = f.state(); expect(live.loadState).toBe('ready'); expect(live.editable).toBe(true); expect(live.calculation?.state).toBe('cached'); expect(live.html).toContain(live.calculation!.message!); expect(live.diskHash).toBe(sha(f.bytes));
    const { editOfficeCell } = await import('@main/core/files/office/cell-edit'); const candidate = editOfficeCell(await OfficePackage.read(f.bytes), { sheetId: '1', row: 0, column: 0, text: 'external fresh' }); writeFileSync(f.path, await candidate.packageData.bytes());
    let refreshRelease!: () => void; const refreshGate = new Promise<void>(resolve => { refreshRelease = resolve; });
    api.openOffice.mockImplementationOnce(async input => { await refreshGate; return f.service.office.open(f.owner, input); });
    const refreshing = f.office.refresh(); await until(() => f.buffer.loadState === 'loading'); const duringRefresh = f.state(); expect(duringRefresh.editable).toBe(false); expect(duringRefresh.html).toContain('正在读取工作簿'); refreshRelease(); await refreshing;
    expect(await f.office.client!.text('1', 0, 0)).toBe('external fresh'); expect(f.broker.operations.filter(value => value === 'save')).toEqual([]); rows.push({ branch: 'starting/live/refreshing/fallback', starting, live, duringRefresh, refreshed: f.state(), boundary: 'Opening/reopening response is gated before real service dispatch; cached state uses actual absence of native calculation configuration. Render assertions use production React server render, not App GUI.' });
  });
  it('blocks manual edits for a genuinely read-only source and refuses the corresponding service mutation', async () => {
    const f = await fixture({ readonly: true }); await f.office.load(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const before = f.state(); expect(before.loadState).toBe('ready'); expect(before.editable).toBe(false); expect(before.html).toContain('只读'); expect(before.html).not.toContain('保存工作簿');
    f.office.setPending({ sheetId: '1', row: 0, column: 0, text: 'must not edit' }, 'Label'); expect(f.office.pending).toBeNull();
    await expect(f.service.office.edit(f.owner, { id: f.office.client!.id, version: 0, edit: { sheetId: '1', row: 0, column: 0, text: 'must not edit' } })).rejects.toMatchObject({ code: 'PERMISSION' });
    expect(sha(readFileSync(f.path))).toBe(sha(f.bytes)); expect(f.office.dirty).toBe(false); rows.push({ branch: 'blocked/read-only', before, after: f.state(), mutationCode: 'PERMISSION' });
  });
  it('keeps a live model, local candidate and unchanged source when checkpoint persistence fails, then recovers', async () => {
    const f = await fixture(); await f.office.load(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); f.office.setPending({ sheetId: '1', row: 0, column: 0, text: 'retained candidate' }, 'Label'); f.broker.rejectCheckpoint = true;
    expect(await f.office.save()).toBe(false); const failed = f.state(); expect(failed.loadState).toBe('ready'); expect(failed.saveError).toContain('checkpoint storage failure'); expect(failed.dirty).toBe(true); expect(failed.diskHash).toBe(sha(f.bytes)); expect(f.broker.operations.filter(value => value === 'save')).toEqual([]);
    f.broker.rejectCheckpoint = false; expect(await f.office.save()).toBe(true); expect(new OfficeWorkbook(await OfficePackage.read(readFileSync(f.path))).cell('1', 0, 0).value).toBe('retained candidate'); expect(f.buffer.dirty).toBe(false); rows.push({ branch: 'persistence-failure/recovery', failed, recovered: f.state(), boundary: 'One native checkpoint dispatch explicitly injected IO failure; actual edit Worker, retry checkpoint and source save use production services/native broker. No fake success receipt.' });
  });
  it('retains local dirty content and a distinct conflict problem after an actual external source change', async () => {
    const f = await fixture(); await f.office.load(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); f.office.setPending({ sheetId: '1', row: 0, column: 0, text: 'local candidate' }, 'Label');
    const { editOfficeCell } = await import('@main/core/files/office/cell-edit'); const candidate = editOfficeCell(await OfficePackage.read(f.bytes), { sheetId: '1', row: 0, column: 0, text: 'external candidate' }); writeFileSync(f.path, await candidate.packageData.bytes()); const before = sha(readFileSync(f.path));
    expect(await f.office.save()).toBe(false); expect(f.buffer.saveReceipt?.state).toBe('conflict'); expect(f.buffer.conflict).toBe(true); expect(f.buffer.loadState).toBe('ready'); expect(f.buffer.dirty).toBe(true); expect(await f.office.client!.text('1', 0, 0)).toBe('local candidate'); expect(sha(readFileSync(f.path))).toBe(before); rows.push({ branch: 'conflict', observed: f.state(), sourceSaveCount: f.broker.operations.filter(value => value === 'save').length });
  });
  it.each(['unsupported', 'too-large'] as const)('retains the source and visible %s error with no writable model', async problem => {
    const f = await fixture(problem === 'unsupported' ? { name: 'unsupported.docx' } : { bytes: Buffer.alloc(40 * 1024 * 1024 + 1, 0) }); await f.office.load(); const failed = f.state();
    expect(failed.loadState).toBe('error'); expect(failed.editable).toBe(false); expect(failed.loadError).toContain(problem === 'unsupported' ? '类型' : '40 MiB'); expect(failed.html).toContain(failed.loadError); expect(failed.html).toContain('readOnly=""');
    f.office.setPending({ sheetId: '1', row: 0, column: 0, text: 'blocked' }, ''); expect(f.office.pending).toBeNull(); await f.office.refresh(); expect(f.buffer.loadError).toBe(failed.loadError); expect(sha(readFileSync(f.path))).toBe(sha(f.bytes)); expect(f.broker.operations.filter(value => value === 'save')).toEqual([]); rows.push({ branch: problem, failed, afterUnchangedRefresh: f.state() });
  });
});
