import { join } from 'node:path';
import { z } from 'zod';
import { FileError, type FileRef, type FileDocument, type FileCheckpointInput, type FileCheckpointReceipt, type FileSaveInput, type FileSaveReceipt, type FileDraftResolution } from '@shared/files';
import { OFFICE_LIMITS, officeOpenSchema, officeWindowSchema, officeCellSchema, type OfficeOpenInput, type OfficeWindowInput, type OfficeCellInput, type OfficeOpenResult } from '@shared/file-office';
import { fileHeavyJobs, type FileHeavyJobs } from '../heavy-jobs';
import { OfficeParser } from './parser';
import type { OfficeCalculationEngine } from './engine';
import { officeEditSchema, officeHistorySchema, officeCheckpointSchema, officeSaveSchema, officeRestoreSchema, officeRecalculateSchema, type OfficeEditInput, type OfficeHistoryInput, type OfficeCheckpointInput, type OfficeSaveInput, type OfficeRestoreInput, type OfficeRecalculateInput, type OfficeMutationResult, type OfficeSaveResult, type OfficeCalculationState } from '@shared/file-office';
import { encodeOfficeDraft, decodeOfficeDraft } from './draft';
import { parseOfficeCellInput } from './cell-edit';
import { officeSheetSchema, type OfficeSheetInput, type OfficeSheetResult } from '@shared/file-office';
import { officeRangeInputSchema,officeRangeReadSchema,type OfficeRangeInput,type OfficeRangeReadInput } from '@shared/file-office';
import type {OfficeMeasureResult} from '@shared/office-measure';
import { OfficeSaveReplay } from './save-replay';

export interface OfficeSource {
  name: string; hash: string; size: number; signal: AbortSignal;
  writable?:boolean;
  lifetime?:AbortSignal;
  assert(): void;
  read(offset: number, length: number, signal: AbortSignal): Promise<Uint8Array>;
}
export interface OfficePersistence {
  checkpoint(owner:string, input:FileCheckpointInput):Promise<FileCheckpointReceipt>;
  save(owner:string, input:FileSaveInput):Promise<FileSaveReceipt>;
  resolveDraft(owner:string, input:FileDraftResolution):Promise<{resolved:boolean}>;
  readDraft(owner:string, ref:FileRef, id:string):Promise<{base64:string; baseHash:string; bufferVersion:number; hash:string; encoding?:string}>;
  refresh(owner:string, ref:FileRef):Promise<FileDocument>;
}
interface Document { owner: string; id: string; ref:FileRef; baseHash:string; source: OfficeSource; abort: AbortController; parser?: OfficeParser; releaseSource(): void; ready: boolean; queue:Promise<unknown>; calculation?:OfficeCalculationState; saves:OfficeSaveReplay }
/** Window + document identity scoped. No renderer bytes, disk path or executable
 * crosses this interface. Views can unmount without losing edits or history. */
export class FileOfficeService {
  private readonly documents = new Map<string, Document>();
  private readonly cancelled = new Map<string, number>();
  constructor(private readonly resolve: (owner: string, ref: FileRef) => OfficeSource, private readonly workerPath = join(__dirname, 'm9-office-document.js'), private readonly jobs: FileHeavyJobs = fileHeavyJobs, private readonly engine?: Pick<OfficeCalculationEngine, 'calculate' | 'recover' | 'dispose'> & Partial<Pick<OfficeCalculationEngine,'validateFormulas'|'measure'>>, private readonly persistence?:OfficePersistence) {}
  recover(): Promise<void> { return this.engine?.recover() ?? Promise.resolve(); }
  get activeDocuments(): number { return this.documents.size; }
  async open(owner: string, raw: OfficeOpenInput): Promise<OfficeOpenResult> {
    const input = officeOpenSchema.parse(raw); this.prune();
    if (this.cancelled.has(`${owner}/${input.id}`)) throw new FileError('CANCELLED', 'Office 文档打开已取消');
    const source = this.resolve(owner, input.ref); source.assert();
    if (source.signal.aborted) throw new FileError('CANCELLED', 'Office 来源已关闭');
    if (source.hash !== input.baseHash) throw new FileError('CHANGED', 'Office 文件版本已改变');
    if (!/\.xls[xm]$/i.test(source.name)) throw new FileError('UNSUPPORTED', '此 Office 类型的文档模型仍在接入');
    if (source.size > OFFICE_LIMITS.inputBytes) throw new FileError('TOO_LARGE', 'Office 文件超过 40 MiB');
    if (this.documents.has(`${owner}/${input.id}`)) throw new FileError('IDEMPOTENCY', 'Office 文档编号已使用');
    if (this.documents.size >= OFFICE_LIMITS.sessions) throw new FileError('TOO_LARGE', 'Office 活动文档数量已达上限');
    const abort = new AbortController();
    const closed=()=>this.drop(record);
    const record: Document = { owner, id: input.id, ref:input.ref, baseHash:source.hash, source, abort, releaseSource: () => {source.signal.removeEventListener('abort', invalidated);source.lifetime?.removeEventListener('abort',closed);}, ready: false, queue:Promise.resolve(), saves:new OfficeSaveReplay() };
    // Ready local models must survive a disconnected source so they can still
    // checkpoint. Opening and native calculation use the source cancellation.
    const invalidated = () => { if (!record.ready) this.drop(record); }; source.signal.addEventListener('abort', invalidated, { once: true });
    source.lifetime?.addEventListener('abort',closed,{once:true});
    this.documents.set(`${owner}/${input.id}`, record);
    try {
      let workbook = await this.jobs.run(abort.signal, async () => {
        let timedOut = false;
        const timer = setTimeout(() => { timedOut = true; this.drop(record); }, OFFICE_LIMITS.parseMs);
        try {
          this.require(owner, input.id, false);
          const bytes = new Uint8Array(source.size);
          for (let offset = 0; offset < bytes.length; offset += 1024 * 1024) {
            this.require(owner, input.id, false);
            const length = Math.min(1024 * 1024, bytes.length - offset), chunk = await source.read(offset, length, abort.signal);
            this.require(owner, input.id, false);
            if (chunk.length !== length) throw new FileError('CHANGED', 'Office 文件读取不完整');
            bytes.set(chunk, offset);
          }
          record.parser = new OfficeParser(this.workerPath);
          const result = await record.parser.open(bytes, source.hash, abort.signal);
          this.require(owner, input.id, false); return result;
        } catch (error) { if (timedOut) throw new FileError('TIMEOUT', 'Office 文件读取或解析超过 15 秒'); throw error; }
        finally { clearTimeout(timer); }
      });
      if(this.engine?.measure && workbook.normalFont) {
        try {
          const metric=await this.engine.measure({normalFont:workbook.normalFont,items:[]},abort.signal);this.require(owner,input.id,false);
          workbook=await record.parser!.fontMetric({digitWidth:metric.digitWidth,measured:true},abort.signal);
        } catch(error) {
          this.require(owner,input.id,false);
          workbook=await record.parser!.fontMetric({digitWidth:7,measured:false,message:`列宽显示采用兼容尺寸：${error instanceof Error ? error.message.slice(0,350) : '字体测量暂不可用'}`},abort.signal);
        }
      }
      let calculation: OfficeOpenResult['calculation'] = { state: 'cached', message: workbook.kind === 'xlsm' ? '此工作簿显示文件中的缓存；不执行宏。' : '公式显示文件中的缓存。' };
      if (this.engine && workbook.kind === 'xlsx') {
        try {
          const candidate = await this.jobs.run(abort.signal, () => record.parser!.prepareCalculation(abort.signal));
          this.require(owner, input.id, false);
          if (candidate) {
            // The native engine acquires this same queue itself. Do not hold a
            // parse slot while waiting for it, otherwise the queue deadlocks.
            const output = await this.engine.calculate(candidate.bytes, abort.signal); this.require(owner, input.id, false);
            if (output.formulas !== candidate.formulas) throw new FileError('INVALID_INPUT', '计算回执公式数量不一致');
            workbook = await this.jobs.run(abort.signal, () => record.parser!.applyCalculation(output.bytes, candidate.hash, abort.signal));
          }
          calculation = { state: 'ready' };
        } catch (error) {
          this.require(owner, input.id, false);
          calculation = { state: 'cached', message: `公式未刷新，显示文件中的缓存：${error instanceof Error ? error.message.slice(0, 400) : '计算失败'}` };
        }
      }
      this.require(owner, input.id, false); record.ready = true; record.calculation = calculation;
      return { id: input.id, hash: source.hash, workbook, calculation, state:await record.parser!.state(abort.signal) };
    } catch (error) { this.drop(record); throw error; }
  }
  async window(owner: string, raw: OfficeWindowInput) {
    const input = officeWindowSchema.parse(raw), record = this.require(owner, input.id);
    try {
      const result = await record.parser!.window(input.sheetId, input.row, input.column, input.rows, input.columns, record.abort.signal, input.rowIndices, input.columnIndices);
      this.require(owner, input.id); return result;
    } catch (error) { this.failedRequest(record, error); throw error; }
  }
  async cell(owner: string, raw: OfficeCellInput) {
    const input = officeCellSchema.parse(raw), record = this.require(owner, input.id);
    try {
      const result = await record.parser!.cell(input.sheetId, input.row, input.column, input.start, input.length, record.abort.signal);
      this.require(owner, input.id); return result;
    } catch (error) { this.failedRequest(record, error); throw error; }
  }
  private serialize<T>(record:Document, run:()=>Promise<T>):Promise<T> {
    const result = record.queue.catch(()=>undefined).then(()=>{ this.require(record.owner,record.id); return run(); });
    record.queue = result; return result;
  }
  async edit(owner:string, raw:OfficeEditInput):Promise<OfficeMutationResult> {
    const input=officeEditSchema.parse(raw), record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      if (record.source.writable === false) throw new FileError('PERMISSION','此文件为只读');
      const before=await record.parser!.state(record.abort.signal);
      if (before.version !== input.version) throw new FileError('CHANGED','工作簿编辑版本已改变');
      const parsed=parseOfficeCellInput(input.edit.text);
      if (parsed.type === 'formula') {
        const sheetIndex=before.workbook.sheets.findIndex(sheet=>sheet.id === input.edit.sheetId);
        if (sheetIndex<0) throw new FileError('CHANGED','工作表已不存在');
        if (!this.engine?.validateFormulas) throw new FileError('UNSUPPORTED','公式校验暂不可用，输入仍保留');
        const snapshot=await this.jobs.run(record.abort.signal,()=>record.parser!.materialize(input.version,record.abort.signal));
        await this.engine.validateFormulas(snapshot.bytes,[{sheetIndex,row:input.edit.row,formula:parsed.value}],record.abort.signal);
        this.require(owner,input.id);
      }
      const state=await this.jobs.run(record.abort.signal,()=>record.parser!.edit(input.version,input.edit,record.abort.signal));
      this.require(owner,input.id);
      if (state.version !== before.version) record.calculation={state:'cached',message:'输入已修改，公式结果等待重新计算。'};
      return {state,calculation:record.calculation};
    });
  }
  async history(owner:string, raw:OfficeHistoryInput):Promise<OfficeMutationResult> {
    const input=officeHistorySchema.parse(raw), record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const state=await this.jobs.run(record.abort.signal,()=>record.parser!.history(input.version,input.direction,record.abort.signal));
      this.require(owner,input.id); record.calculation={state:'cached',message:'已恢复编辑历史；公式结果可重新计算。'};
      return {state,calculation:record.calculation};
    });
  }
  async sheetAction(owner:string,raw:OfficeSheetInput):Promise<OfficeSheetResult> {
    const input=officeSheetSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      if (record.source.writable === false) throw new FileError('PERMISSION','此文件为只读');
      const before=await record.parser!.state(record.abort.signal);
      const result=await this.jobs.run(record.abort.signal,()=>record.parser!.sheetAction(input.version,input.action,record.abort.signal));
      this.require(owner,input.id);
      if (result.state.version !== before.version) record.calculation={state:'cached',message:'工作表结构已修改，公式结果等待重新计算。'};
      return {...result,calculation:record.calculation};
    });
  }
  async range(owner:string,raw:OfficeRangeReadInput) {
    const input=officeRangeReadSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,()=>this.jobs.run(record.abort.signal,()=>record.parser!.range(input.sheetId,input.range,input.text,record.abort.signal)));
  }
  async rangeAction(owner:string,raw:OfficeRangeInput):Promise<OfficeMutationResult> {
    const input=officeRangeInputSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      if(record.source.writable === false)throw new FileError('PERMISSION','此文件为只读');
      let measured:OfficeMeasureResult|undefined;
      if(input.action.type==='fit') {
        if(!this.engine?.measure)throw new FileError('UNSUPPORTED','字体测量暂不可用，原尺寸保留');
        const state=await record.parser!.state(record.abort.signal);
        if(state.version!==input.version)throw new FileError('CHANGED','工作簿编辑版本已改变');
        if(!state.workbook.normalFont)throw new FileError('UNSUPPORTED','工作簿缺少默认字体信息');
        const metric=await this.engine.measure({normalFont:state.workbook.normalFont,items:[]},record.abort.signal);this.require(owner,input.id);
        await record.parser!.fontMetric({digitWidth:metric.digitWidth,measured:true},record.abort.signal);
        const request=await this.jobs.run(record.abort.signal,()=>record.parser!.prepareFit(input.version,input.action,record.abort.signal));
        measured=await this.engine.measure(request,record.abort.signal);this.require(owner,input.id);
        if(measured.digitWidth!==metric.digitWidth)throw new FileError('CHANGED','测量期间字体发生变化，请重试');
      }
      const candidate=await this.jobs.run(record.abort.signal,()=>record.parser!.prepareRange(input.version,input.action,record.abort.signal,measured));
      try {
        if(candidate.formulas.length) {
          if(!this.engine?.validateFormulas || !candidate.bytes)throw new FileError('UNSUPPORTED','公式校验暂不可用，选区修改尚未应用');
          await this.engine.validateFormulas(candidate.bytes,candidate.formulas,record.abort.signal);this.require(owner,input.id);
        }
        const state=await this.jobs.run(record.abort.signal,()=>record.parser!.commitRange(input.version,candidate.token,record.abort.signal));this.require(owner,input.id);
        if(state.version !== input.version && !(input.action.type === 'conditional' || input.action.type === 'validation' || input.action.type === 'fit' || input.action.type === 'format' || input.action.type === 'merge' || input.action.type === 'unmerge' || input.action.type === 'clear' && input.action.mode === 'format'))record.calculation={state:'cached',message:'选区内容已修改，公式结果等待重新计算。'};
        return {state,calculation:record.calculation};
      } finally {await record.parser!.cancelRange(candidate.token,record.abort.signal).catch(()=>undefined);}
    });
  }
  async recalculate(owner:string, raw:OfficeRecalculateInput):Promise<OfficeMutationResult> {
    const input=officeRecalculateSchema.parse(raw), record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const state=await record.parser!.state(record.abort.signal);
      if (state.version !== input.version) throw new FileError('CHANGED','工作簿编辑版本已改变');
      if (this.engine && state.workbook.kind === 'xlsx') {
        try {
          record.source.assert();
          const candidate=await this.jobs.run(record.abort.signal,()=>record.parser!.prepareCalculation(record.abort.signal));
          if (candidate) {
            const result=await this.engine.calculate(candidate.bytes,AbortSignal.any([record.abort.signal,record.source.signal])); this.require(owner,input.id); record.source.assert();
            if (result.formulas !== candidate.formulas) throw new FileError('INVALID_INPUT','计算回执公式数量不一致');
            await this.jobs.run(record.abort.signal,()=>record.parser!.applyCalculation(result.bytes,candidate.hash,record.abort.signal));
          }
          record.calculation={state:'ready'};
        } catch(error) {
          // An engine timeout/failure must not destroy a dirty document Worker.
          // A failed parser will reject the state request below; its durable
          // recovery checkpoint remains available through the normal UI.
          this.require(owner,input.id);
          record.calculation={state:'cached',message:`公式未刷新，修改仍保留：${error instanceof Error ? error.message.slice(0,400) : '计算失败'}`};
        }
      }
      return {state:await record.parser!.state(record.abort.signal),calculation:record.calculation};
    });
  }
  private storage():OfficePersistence { if (!this.persistence) throw new FileError('UNSUPPORTED','Office 持久化服务不可用'); return this.persistence; }
  private async checkpointRecord(record:Document,input:OfficeCheckpointInput,bytes?:Uint8Array):Promise<FileCheckpointReceipt> {
    const snapshot=bytes ?? (await record.parser!.materialize(input.version,record.abort.signal)).bytes;
    return this.storage().checkpoint(record.owner,{ref:record.ref,draftId:input.draftId,bufferVersion:input.bufferVersion,baseHash:record.baseHash,base64:encodeOfficeDraft(snapshot,input.pending).toString('base64'),encoding:'ooxml-draft',bom:false});
  }
  async checkpoint(owner:string, raw:OfficeCheckpointInput):Promise<FileCheckpointReceipt> {
    const input=officeCheckpointSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,()=>this.checkpointRecord(record,input));
  }
  async save(owner:string, raw:OfficeSaveInput):Promise<OfficeSaveResult> {
    const input=officeSaveSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const replay=record.saves.get(input);
      if (replay) return {state:await record.parser!.state(record.abort.signal),calculation:record.calculation,...replay};
      if (record.source.writable === false) throw new FileError('PERMISSION','此文件为只读');
      const snapshot=await this.jobs.run(record.abort.signal,()=>record.parser!.materialize(input.version,record.abort.signal));
      const checkpoint=await this.checkpointRecord(record,input,snapshot.bytes);
      this.require(owner,input.id); record.source.assert();
      // A restored draft can predate input validation. Independently validate
      // changed formulas before the source commit; untouched unsupported source
      // formulas remain byte-preserved and do not block unrelated value edits.
      const formulas=await record.parser!.validationFormulas(input.version,record.abort.signal);
      if (formulas.length) {
        if (!this.engine?.validateFormulas) throw new FileError('UNSUPPORTED','公式校验暂不可用，草稿仍保留');
        await this.engine.validateFormulas(snapshot.bytes,formulas,AbortSignal.any([record.abort.signal,record.source.signal]));
        this.require(owner,input.id); record.source.assert();
      }
      const receipt=await this.storage().save(owner,{ref:record.ref,opId:input.opId,bufferVersion:input.bufferVersion,baseHash:record.baseHash,base64:Buffer.from(snapshot.bytes).toString('base64')});
      this.require(owner,input.id);
      let draftError:string|undefined;
      if (receipt.state === 'saved' && receipt.revision) {
        if (receipt.revision.hash !== snapshot.hash) throw new FileError('IO','Office 保存结果与候选哈希不一致；请核对恢复记录');
        record.baseHash=receipt.revision.hash;
        await record.parser!.acknowledge(input.version,snapshot.hash,record.abort.signal);
        try {
          const result=await this.storage().resolveDraft(owner,{ref:record.ref,draftId:input.draftId,bufferVersion:input.bufferVersion,hash:checkpoint.hash,savedHash:snapshot.hash,action:'saved',saveOpId:input.opId});
          if (!result.resolved) draftError='文件已保存，较新的草稿仍保留。';
        } catch(error) { draftError=`文件已保存，草稿记录仍保留：${error instanceof Error ? error.message : String(error)}`; }
      }
      const outcome={receipt,checkpoint,...(draftError ? {draftError} : {})};
      record.saves.remember(input,outcome);
      return {state:await record.parser!.state(record.abort.signal),calculation:record.calculation,...outcome};
    });
  }
  async restore(owner:string, raw:OfficeRestoreInput) {
    const input=officeRestoreSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const recovered=await this.storage().readDraft(owner,record.ref,input.draftId);
      if (recovered.encoding !== 'ooxml-draft') throw new FileError('INVALID_INPUT','此草稿不是 Office 文档');
      const draft=decodeOfficeDraft(Buffer.from(recovered.base64,'base64'));
      const state=await this.jobs.run(record.abort.signal,()=>record.parser!.restore(input.version,draft.bytes,record.abort.signal));
      this.require(owner,input.id); record.baseHash=recovered.baseHash; record.calculation={state:'cached',message:'已恢复草稿，公式结果可重新计算。'};
      return {state,calculation:record.calculation,baseHash:recovered.baseHash,bufferVersion:recovered.bufferVersion,hash:recovered.hash,pending:draft.pending};
    });
  }
  async rebase(owner:string,raw:OfficeRecalculateInput):Promise<FileDocument> {
    const input=officeRecalculateSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      if ((await record.parser!.state(record.abort.signal)).version !== input.version) throw new FileError('CHANGED','工作簿编辑版本已改变');
      const document=await this.storage().refresh(owner,record.ref); this.require(owner,input.id);
      record.baseHash=document.revision.hash; record.source.writable=document.writable; return document;
    });
  }
  close(owner: string, id: string): void {
    z.string().uuid().parse(id); this.prune(); this.cancelled.set(`${owner}/${id}`, Date.now() + 60_000);
    const record = this.documents.get(`${owner}/${id}`); if (record) this.drop(record);
  }
  closeOwner(owner: string): void {
    for (const record of [...this.documents.values()]) if (record.owner === owner) this.drop(record);
    for (const key of this.cancelled.keys()) if (key.startsWith(`${owner}/`)) this.cancelled.delete(key);
  }
  dispose(): void { for (const record of [...this.documents.values()]) this.drop(record); this.cancelled.clear(); this.engine?.dispose(); }
  private require(owner: string, id: string, ready = true): Document {
    const record = this.documents.get(`${owner}/${id}`);
    if (!record || record.id !== id || record.abort.signal.aborted) throw new FileError('CANCELLED', 'Office 文档实例已关闭或不属于当前窗口');
    if (!record.ready) try { record.source.assert(); } catch (error) { this.drop(record); throw error; }
    if (ready && !record.ready) throw new FileError('UNTRUSTED', 'Office 文档尚未加载完成');
    return record;
  }
  private drop(record: Document): void {
    if (record.abort.signal.aborted) return; record.abort.abort(); record.releaseSource(); record.parser?.close();
    if (this.documents.get(`${record.owner}/${record.id}`) === record) this.documents.delete(`${record.owner}/${record.id}`);
  }
  private failedRequest(record: Document, error: unknown): void {
    if (error instanceof FileError && ['IO', 'TIMEOUT', 'CANCELLED'].includes(error.code)) this.drop(record);
  }
  private prune(): void {
    for (const [key, deadline] of this.cancelled) if (deadline < Date.now()) this.cancelled.delete(key);
    while (this.cancelled.size >= 2048) this.cancelled.delete(this.cancelled.keys().next().value!);
  }
}
