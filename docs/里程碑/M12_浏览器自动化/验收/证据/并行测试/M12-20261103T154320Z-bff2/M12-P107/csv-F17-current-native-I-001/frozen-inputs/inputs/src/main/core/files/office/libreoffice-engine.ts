import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FileError } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';
import type { NativeFileBroker, RootDescriptor } from '../native-broker';
import { FileEngineWorkspaces } from '../engine-workspaces';
import { fileHeavyJobs, type FileHeavyJobs } from '../heavy-jobs';
import { libreOfficeResources } from './libreoffice-resources';
import type { OfficeEngineConfiguration } from './engine';

const resultSchema=z.discriminatedUnion('state',[
  z.object({state:z.literal('failed'),message:z.string().max(4096),diagnostic:z.string().max(65536)}).strict(),
  z.object({state:z.literal('ready'),base64:z.string().max(Math.ceil(OFFICE_LIMITS.outputBytes/3)*4),hash:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().min(5).max(OFFICE_LIMITS.outputBytes),pages:z.number().int().min(0).max(2000),elapsedMs:z.number().int().nonnegative(),peakRssBytes:z.number().int().nonnegative().max(1024*1024*1024),diagnostic:z.string().max(65536)}).strict(),
]);
export type OfficeRenderNativeResult=z.infer<typeof resultSchema>;
export interface OfficeRenderResult {bytes:Uint8Array;hash:string;pages:number;elapsedMs:number;peakRssBytes:number;diagnostic:string}

/** A validated document Worker supplies the original/candidate package bytes.
 * Layout is a disposable PDF projection, never an OOXML save candidate. */
export class LibreOfficeEngine {
  private readonly workspaces:FileEngineWorkspaces;
  private readonly jobs=new Set<AbortController>();
  private disposed=false;
  constructor(private readonly broker:NativeFileBroker,private readonly configuration:OfficeEngineConfiguration,private readonly queue:FileHeavyJobs=fileHeavyJobs){
    this.workspaces=new FileEngineWorkspaces(configuration.userData,broker,'office');
  }
  async render(bytes:Uint8Array,format:'docx'|'pptx',signal:AbortSignal):Promise<OfficeRenderResult>{
    return this.project(bytes,format,signal,false);
  }
  /** Opaque marker polygons only. The returned SVG must stay in the document
   * Worker; it is never HTML, a UI asset, or an editable file candidate. */
  async renderTableLayout(bytes:Uint8Array,signal:AbortSignal):Promise<Omit<OfficeRenderResult,'pages'>>{
    const {pages:_,...result}=await this.project(bytes,'pptx',signal,true);return result;
  }
  private async project(bytes:Uint8Array,format:'docx'|'pptx',signal:AbortSignal,tableLayout:boolean):Promise<OfficeRenderResult>{
    if(this.disposed || signal.aborted)throw new FileError('CANCELLED','Office 文档排版已取消');
    if(!bytes.length || bytes.length>OFFICE_LIMITS.inputBytes)throw new FileError('TOO_LARGE','Office 文档为空或超过 40 MiB');
    if(format!=='docx' && format!=='pptx')throw new FileError('UNSUPPORTED','当前排版入口仅接受 DOCX 和 PPTX');
    const snapshot=Buffer.from(bytes),inputHash=createHash('sha256').update(snapshot).digest('hex');
    const abort=new AbortController(),combined=AbortSignal.any([signal,abort.signal]);this.jobs.add(abort);
    try {
      return await this.queue.run(combined,async()=>{
        let job:RootDescriptor|undefined;
        const timer=setTimeout(()=>abort.abort(new FileError('TIMEOUT','Office 引擎准备与排版超过 60 秒')),60000);
        try {
          const resources=await libreOfficeResources(this.configuration.directory,this.configuration.packagePath,combined);combined.throwIfAborted();
          job=await this.workspaces.create();combined.throwIfAborted();
          const raw=await this.broker.request({operation:'office-render',job,...resources,format,...(tableLayout?{tableLayout:true}:{}),base64:snapshot.toString('base64'),hash:inputHash},{signal:combined,timeoutMs:30000});
          combined.throwIfAborted();const result=resultSchema.safeParse(raw);
          if(!result.success)throw new FileError('IO','Office 文档排版回执无效');
          if(result.data.state==='failed')throw new FileError('INVALID_INPUT',`${result.data.message}\n${result.data.diagnostic.slice(-16384)}`);
          const output=Buffer.from(result.data.base64,'base64');
          if(output.length!==result.data.bytes || output.subarray(0,5).toString()!==(tableLayout?'<?xml':'%PDF-') || (tableLayout?result.data.pages!==0:result.data.pages<1) || createHash('sha256').update(output).digest('hex')!==result.data.hash)throw new FileError('IO','Office 文档预览校验失败');
          return {bytes:output,hash:result.data.hash,pages:result.data.pages,elapsedMs:result.data.elapsedMs,peakRssBytes:result.data.peakRssBytes,diagnostic:result.data.diagnostic};
        } finally {clearTimeout(timer);if(job)await this.workspaces.clean(job);}
      });
    } catch(error){
      if(abort.signal.reason instanceof FileError)throw abort.signal.reason;
      if(combined.aborted)throw new FileError('CANCELLED','Office 文档排版已取消');
      throw error;
    } finally {this.jobs.delete(abort);}
  }
  dispose():void{this.disposed=true;for(const job of this.jobs)job.abort();}
}
