import { createHash } from 'node:crypto';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS, officeFormulaValidationSchema, type OfficeFormulaValidation } from '@shared/file-office';
import type { NativeFileBroker, RootDescriptor } from '../native-broker';
import { FileEngineWorkspaces } from '../engine-workspaces';
import { fileHeavyJobs, type FileHeavyJobs } from '../heavy-jobs';
import { officeEngineResources } from './engine-resources';
import {officeMeasureInputSchema,officeMeasureResultSchema,type OfficeMeasureInput,type OfficeMeasureResult} from '@shared/office-measure';

export interface OfficeEngineConfiguration { directory: string; userData: string; packagePath?: string }
export interface OfficeCalculationResult { bytes: Uint8Array; hash: string; formulas: number; elapsedMs: number; peakRssBytes: number; diagnostic: string }
export type OfficeNativeResult = { state: 'failed'; diagnostic: string; message: string } | { state: 'validated'; hash:string; formulas:number; elapsedMs:number; peakRssBytes:number; diagnostic:string } | { state: 'ready'; base64: string; hash: string; bytes: number; formulas: number; elapsedMs: number; peakRssBytes: number; diagnostic: string };

/** The document Worker owns package validation and later cache transplant.
 * This service owns only the fixed engine, its queue, process and private files. */
export class OfficeCalculationEngine {
  private readonly workspaces: FileEngineWorkspaces;
  private readonly jobs = new Set<AbortController>();
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private readonly broker: NativeFileBroker, private readonly configuration: OfficeEngineConfiguration, private readonly queue: FileHeavyJobs = fileHeavyJobs) {
    this.workspaces = new FileEngineWorkspaces(configuration.userData, broker, 'office');
  }
  async recover(): Promise<void> {
    if (this.disposed) return;
    clearTimeout(this.recoveryTimer);
    const report = await this.workspaces.recover();
    if (report.issues.length) console.warn('[files/office] Temporary objects retained after identity/type check:', report.issues);
    if (report.busy.length && !this.disposed) { this.recoveryTimer = setTimeout(() => { void this.recover().catch((error) => console.warn('[files/office] Cleanup pending:', error)); }, 15_000); this.recoveryTimer.unref(); }
  }
  async calculate(bytes: Uint8Array, signal: AbortSignal): Promise<OfficeCalculationResult> {
    const result=await this.run(bytes,signal);
    if (result.state !== 'ready') throw new FileError('IO','Office 计算回执类型错误');
    const output=Buffer.from(result.base64,'base64');
    if (!output.length || output.length>OFFICE_LIMITS.outputBytes || output.length !== result.bytes || createHash('sha256').update(output).digest('hex') !== result.hash || !Number.isSafeInteger(result.formulas) || result.formulas<0) throw new FileError('IO','Office 计算回执校验失败');
    return {bytes:output,hash:result.hash,formulas:result.formulas,elapsedMs:result.elapsedMs,peakRssBytes:result.peakRssBytes,diagnostic:result.diagnostic};
  }
  async validateFormulas(bytes:Uint8Array, formulas:OfficeFormulaValidation[], signal:AbortSignal):Promise<void> {
    if (!formulas.length || formulas.length>OFFICE_LIMITS.validationFormulas) throw new FileError('TOO_LARGE','公式校验数量超过预算');
    const checked=formulas.map(value=>officeFormulaValidationSchema.parse(value));
    if (Buffer.byteLength(JSON.stringify(checked),'utf8')>OFFICE_LIMITS.validationBytes) throw new FileError('TOO_LARGE','公式校验文字超过预算');
    const result=await this.run(bytes,signal,checked);
    if (result.state !== 'validated' || result.formulas !== checked.length || result.hash !== createHash('sha256').update(bytes).digest('hex')) throw new FileError('IO','Office 公式校验回执不匹配');
  }
  async measure(raw:OfficeMeasureInput,signal:AbortSignal):Promise<OfficeMeasureResult> {
    if(this.disposed || signal.aborted)throw new FileError('CANCELLED','字体测量已取消');
    const input=officeMeasureInputSchema.parse(raw);
    if(Buffer.byteLength(JSON.stringify(input),'utf8')>8*1024*1024)throw new FileError('TOO_LARGE','字体测量请求超过 8 MiB');
    const abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]);this.jobs.add(abort);
    try {
      return await this.queue.run(combined,async()=>{
        const result=officeMeasureResultSchema.parse(await this.broker.request({operation:'office-measure',...input},{signal:combined,timeoutMs:10000}));
        if(result.items.length!==input.items.length)throw new FileError('IO','字体测量回执数量不一致');combined.throwIfAborted();return result;
      });
    } finally {this.jobs.delete(abort);}
  }
  private async run(bytes:Uint8Array, signal:AbortSignal, formulas?:OfficeFormulaValidation[]):Promise<Exclude<OfficeNativeResult,{state:'failed'}>> {
    if (this.disposed || signal.aborted) throw new FileError('CANCELLED', 'Office 计算已取消');
    if (!bytes.length || bytes.length > OFFICE_LIMITS.inputBytes) throw new FileError('TOO_LARGE', 'Office 计算候选为空或超过 40 MiB');
    const abort = new AbortController(), combined = AbortSignal.any([signal, abort.signal]); this.jobs.add(abort);
    try {
      return await this.queue.run(combined, async () => {
        let job: RootDescriptor | undefined;
        const timer = setTimeout(() => abort.abort(new FileError('TIMEOUT', 'Office 引擎准备及计算超过 60 秒')), 60_000);
        try {
          const resources = await officeEngineResources(this.configuration.directory, this.configuration.packagePath, combined); combined.throwIfAborted();
          job = await this.workspaces.create(); combined.throwIfAborted();
          const result = await this.broker.request<OfficeNativeResult>({ operation: formulas ? 'office-validate' : 'office-calculate', job, ...resources, base64: Buffer.from(bytes).toString('base64'), hash: createHash('sha256').update(bytes).digest('hex'), ...(formulas ? {formulas} : {}) }, { signal: combined, timeoutMs: OFFICE_LIMITS.formulaMs + 10_000 });
          combined.throwIfAborted();
          if (result.state === 'failed') throw new FileError('INVALID_INPUT', `${result.message}\n${result.diagnostic.slice(-16384)}`);
          return result;
        } finally { clearTimeout(timer); if (job) await this.workspaces.clean(job); }
      });
    } catch (error) {
      if (abort.signal.reason instanceof FileError) throw abort.signal.reason;
      if (combined.aborted) throw new FileError('CANCELLED', 'Office 计算已取消');
      throw error;
    } finally { this.jobs.delete(abort); }
  }
  dispose(): void { this.disposed = true; clearTimeout(this.recoveryTimer); for (const job of this.jobs) job.abort(); }
}
