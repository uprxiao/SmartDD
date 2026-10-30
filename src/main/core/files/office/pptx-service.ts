import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { FileError,type FileRef,type FileDocument,type FileCheckpointReceipt } from '@shared/files';
import { OFFICE_LIMITS,officeOpenSchema,type OfficeOpenInput } from '@shared/file-office';
import { pptxEditSchema,pptxHistorySchema,pptxCheckpointSchema,pptxSaveSchema,pptxRestoreSchema,pptxVersionSchema,pptxRenderSchema,type PptxEditInput,type PptxHistoryInput,type PptxCheckpointInput,type PptxSaveInput,type PptxRestoreInput,type PptxVersionInput,type PptxRenderInput,type PptxEditState,type PptxOpenResult,type PptxSaveResult,type PptxRenderResult } from '@shared/file-pptx';
import { fileHeavyJobs,type FileHeavyJobs } from '../heavy-jobs';
import type { OfficeSource,OfficePersistence } from './service';
import type { LibreOfficeEngine } from './libreoffice-engine';
import { PptxParser } from './pptx-parser';
import { encodePptxDraft,decodePptxDraft } from './pptx-draft';
import { pptxImageBytes,pptxImageReceiptSchema,type PptxImageReceipt,type PptxImageDecoder } from './pptx-image';
import { OfficeSaveReplay } from './save-replay';
import { OfficeBlockedCandidate } from './blocked-candidate';
import { pptxPlaceholderImage } from './pptx-placeholder';

interface Preview {id:string;version:number;abort:AbortController;bytes?:Uint8Array}
interface Document {
  owner:string;id:string;ref:FileRef;source:OfficeSource;baseHash:string;
  abort:AbortController;ready:boolean;parser?:PptxParser;queue:Promise<unknown>;
  releaseSource():void;preview?:Preview;
  saves:OfficeSaveReplay;blocked:OfficeBlockedCandidate;
}

/** FileBuffer lifetime, source identity and save snapshots are independent of
 * mounted PDF views. Layout runs on private candidates and never writes OOXML. */
export class FilePptxService {
  private readonly documents=new Map<string,Document>();
  private readonly cancelled=new Map<string,number>();
  private readonly cancelledPreviews=new Map<string,number>();
  private disposed=false;
  constructor(
    private readonly resolve:(owner:string,ref:FileRef)=>OfficeSource,
    private readonly persistence:OfficePersistence,
    private readonly engine?:Pick<LibreOfficeEngine,'render'>&Partial<Pick<LibreOfficeEngine,'renderTableLayout'>>,
    private readonly workerPath=join(__dirname,'m9-pptx-document.js'),
    private readonly jobs:FileHeavyJobs=fileHeavyJobs,
    private readonly decodeImage?:PptxImageDecoder,
  ){}
  get activeDocuments(){return this.documents.size;}
  private key(owner:string,id:string){return `${owner}/${id}`;}
  private remember(map:Map<string,number>,key:string){
    for(const [id,until] of map)if(until<Date.now())map.delete(id);
    if(map.size>=2048)map.delete(map.keys().next().value!);map.set(key,Date.now()+60000);
  }
  async open(owner:string,raw:OfficeOpenInput):Promise<PptxOpenResult>{
    const input=officeOpenSchema.parse(raw),key=this.key(owner,input.id);
    if(this.disposed||(this.cancelled.get(key)??0)>Date.now())throw new FileError('CANCELLED','演示文稿打开已取消');
    if(this.documents.has(key))throw new FileError('IDEMPOTENCY','演示文稿实例已使用');
    if(this.documents.size>=OFFICE_LIMITS.sessions)throw new FileError('TOO_LARGE','演示文稿活动文档数量已达上限');
    const source=this.resolve(owner,input.ref);source.assert();
    if(source.signal.aborted||source.lifetime?.aborted)throw new FileError('CANCELLED','演示文稿来源已关闭');
    if(source.hash!==input.baseHash)throw new FileError('CHANGED','演示文稿版本已改变');
    if(!/\.pptx$/i.test(source.name))throw new FileError('UNSUPPORTED','此入口只接受 PPTX');
    if(!Number.isSafeInteger(source.size)||source.size<1||source.size>OFFICE_LIMITS.inputBytes)throw new FileError('TOO_LARGE','演示文稿为空或超过 40 MiB');
    const abort=new AbortController(),closed=()=>this.drop(record),invalidated=()=>{if(!record.ready)this.drop(record);};
    const record:Document={owner,id:input.id,ref:input.ref,source,baseHash:source.hash,abort,ready:false,queue:Promise.resolve(),saves:new OfficeSaveReplay(),blocked:new OfficeBlockedCandidate(),releaseSource(){source.signal.removeEventListener('abort',invalidated);source.lifetime?.removeEventListener('abort',closed);}};
    this.documents.set(key,record);source.signal.addEventListener('abort',invalidated,{once:true});source.lifetime?.addEventListener('abort',closed,{once:true});
    try{
      const state=await this.jobs.run(abort.signal,async()=>{
        let timedOut=false;const timer=setTimeout(()=>{timedOut=true;this.drop(record);},OFFICE_LIMITS.parseMs);
        try{
          this.require(owner,input.id,false);const bytes=new Uint8Array(source.size);
          for(let offset=0;offset<bytes.length;offset+=1024*1024){
            const length=Math.min(1024*1024,bytes.length-offset),chunk=await source.read(offset,length,abort.signal);this.require(owner,input.id,false);
            if(chunk.length!==length)throw new FileError('CHANGED','演示文稿读取不完整');bytes.set(chunk,offset);
          }
          record.parser=new PptxParser(this.workerPath);const result=await record.parser.open(bytes,source.hash,abort.signal);
          this.require(owner,input.id,false);return result;
        }catch(error){if(timedOut)throw new FileError('TIMEOUT','演示文稿读取或解析超过 15 秒');throw error;}
        finally{clearTimeout(timer);}
      });
      this.require(owner,input.id,false);record.ready=true;return {id:input.id,sourceHash:source.hash,state};
    }catch(error){this.drop(record);throw error;}
  }
  private require(owner:string,id:string,ready=true):Document{
    const record=this.documents.get(this.key(owner,id));
    if(!record||record.abort.signal.aborted)throw new FileError('CANCELLED','演示文稿已关闭或不属于当前窗口');
    if(!record.ready)record.source.assert();
    if(ready&&!record.ready)throw new FileError('UNTRUSTED','演示文稿尚未就绪');return record;
  }
  private serialize<T>(record:Document,operation:()=>Promise<T>):Promise<T>{
    const result=record.queue.catch(()=>undefined).then(()=>{this.require(record.owner,record.id);return operation();}).catch(error=>{
      // A dead Worker cannot retain a usable model. Release its quota; durable
      // recovery remains in FileService, while ordinary rejected edits survive.
      if(record.parser?.isClosed)this.drop(record);throw error;
    });record.queue=result;return result;
  }
  private async writable(record:Document){
    // Re-read the current issued capability after native metadata refresh.
    if(this.resolve(record.owner,record.ref).writable===false)throw new FileError('PERMISSION','此文件为只读');
    const state=await record.parser!.state(record.abort.signal);
    if(state.info.signed)throw new FileError('UNSUPPORTED','此文档包含数字签名，编辑前需确认签名处理');
    if(state.protected)throw new FileError('PERMISSION','演示文稿有修改保护');
    return state;
  }
  async edit(owner:string,raw:PptxEditInput):Promise<PptxEditState>{
    const input=pptxEditSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const current=await this.writable(record);
      if(current.version!==input.version)throw new FileError('CHANGED','演示文稿编辑版本已改变');
      let image:PptxImageReceipt|undefined;
      if(input.action.type==='image-insert'||input.action.type==='image-replace'||input.action.type==='image-placeholder'){
        if(!this.decodeImage)throw new FileError('UNSUPPORTED','本机图片解码器不可用，未改变演示文稿');
        const source=input.action.type==='image-placeholder'?pptxPlaceholderImage():input.action.image,bytes=pptxImageBytes(source);
        const dimensions=await this.jobs.run(record.abort.signal,()=>this.decodeImage!(source,record.abort.signal));
        this.require(owner,input.id);
        image=pptxImageReceiptSchema.parse({...dimensions,hash:createHash('sha256').update(bytes).digest('hex')});
        await this.writable(record);
      }
      const state=await this.jobs.run(record.abort.signal,()=>record.parser!.edit(input.version,input.action,record.abort.signal,image));
      this.require(owner,input.id);if(state.version!==input.version)this.dropPreview(record);return state;
    });
  }
  async history(owner:string,raw:PptxHistoryInput):Promise<PptxEditState>{
    const input=pptxHistorySchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      await this.writable(record);
      const state=await this.jobs.run(record.abort.signal,()=>record.parser!.history(input.version,input.direction,record.abort.signal));
      this.require(owner,input.id);if(state.version!==input.version)this.dropPreview(record);return state;
    });
  }
  private async checkpointRecord(record:Document,input:PptxCheckpointInput,bytes?:Uint8Array):Promise<FileCheckpointReceipt>{
    const materialized=await this.jobs.run(record.abort.signal,()=>record.parser!.materialize(input.version,record.abort.signal));
    const snapshot=bytes??materialized.bytes;
    const report=await this.jobs.run(record.abort.signal,()=>record.parser!.verify(input.version,snapshot,materialized.hash,record.abort.signal));
    if(report.total)throw new FileError('IO','草稿保真校验失败，当前修改仍保留在内存；原件未改变');
    this.require(record.owner,record.id);
    return this.persistence.checkpoint(record.owner,{ref:record.ref,draftId:input.draftId,bufferVersion:input.bufferVersion,baseHash:record.baseHash,base64:encodePptxDraft(snapshot,input.pending).toString('base64'),encoding:'ooxml-draft',bom:false});
  }
  checkpoint(owner:string,raw:PptxCheckpointInput):Promise<FileCheckpointReceipt>{
    const input=pptxCheckpointSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,()=>this.checkpointRecord(record,input));
  }
  save(owner:string,raw:PptxSaveInput):Promise<PptxSaveResult>{
    const input=pptxSaveSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const replay=record.saves.get(input);
      if(replay)return {state:await record.parser!.state(record.abort.signal),...replay};
      await this.writable(record);
      const snapshot=await this.jobs.run(record.abort.signal,()=>record.parser!.materialize(input.version,record.abort.signal));
      const fidelity=await this.jobs.run(record.abort.signal,()=>record.parser!.verify(input.version,snapshot.bytes,snapshot.hash,record.abort.signal));
      this.require(owner,input.id);
      if(fidelity.total){
        const failure=record.blocked.block(input.version,snapshot.bytes,fidelity);
        let checkpoint:FileCheckpointReceipt|undefined,draftError:string|undefined;
        try{checkpoint=await this.checkpointRecord(record,input);}
        catch(error){draftError=`当前修改仍保留在内存，草稿未确认写入磁盘：${error instanceof Error?error.message:String(error)}`;}
        this.require(owner,input.id);
        const receipt={opId:input.opId,bufferVersion:input.bufferVersion,state:'failed' as const,message:'保真校验失败，已阻止覆盖原文件；请核对差异。'};
        const outcome={receipt,checkpoint,draftError,fidelity:failure};record.saves.remember(input,outcome);
        return {state:await record.parser!.state(record.abort.signal),...outcome};
      }
      record.blocked.clear();
      const checkpoint=await this.checkpointRecord(record,input,snapshot.bytes);
      this.require(owner,input.id);record.source.assert();
      const receipt=await this.persistence.save(owner,{ref:record.ref,opId:input.opId,bufferVersion:input.bufferVersion,baseHash:record.baseHash,base64:Buffer.from(snapshot.bytes).toString('base64')});
      this.require(owner,input.id);let draftError:string|undefined;
      if(receipt.state==='saved'&&receipt.revision){
        if(receipt.revision.hash!==snapshot.hash)throw new FileError('IO','演示文稿保存回执与候选不一致；草稿仍保留');
        record.baseHash=receipt.revision.hash;await record.parser!.acknowledge(input.version,snapshot.hash,record.abort.signal);
        try{
          const resolution=await this.persistence.resolveDraft(owner,{ref:record.ref,draftId:input.draftId,bufferVersion:input.bufferVersion,hash:checkpoint.hash,savedHash:snapshot.hash,action:'saved',saveOpId:input.opId});
          if(!resolution.resolved)draftError='文件已保存，较新的草稿仍保留。';
        }catch(error){draftError=`文件已保存，草稿记录仍保留：${error instanceof Error?error.message:String(error)}`;}
      }
      const outcome={receipt,checkpoint,...(draftError?{draftError}:{})};
      record.saves.remember(input,outcome);
      return {state:await record.parser!.state(record.abort.signal),...outcome};
    });
  }
  async lossyCandidate(owner:string,id:string,token:string){
    const record=this.require(owner,id);
    return this.serialize(record,async()=>{
      const state=await record.parser!.state(record.abort.signal);this.require(owner,id);record.source.assert();
      return {ref:record.ref,baseHash:record.baseHash,bytes:record.blocked.select(token,state.version)};
    });
  }
  restore(owner:string,raw:PptxRestoreInput){
    const input=pptxRestoreSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      const recovered=await this.persistence.readDraft(owner,record.ref,input.draftId);
      if(recovered.encoding!=='ooxml-draft')throw new FileError('INVALID_INPUT','此草稿不是演示文稿');
      const draft=decodePptxDraft(Buffer.from(recovered.base64,'base64'));
      const state=await this.jobs.run(record.abort.signal,()=>record.parser!.restore(input.version,draft.bytes,record.abort.signal));
      this.require(owner,input.id);this.dropPreview(record);record.baseHash=recovered.baseHash;
      return {state,baseHash:recovered.baseHash,bufferVersion:recovered.bufferVersion,hash:recovered.hash,pending:draft.pending};
    });
  }
  rebase(owner:string,raw:PptxVersionInput):Promise<FileDocument>{
    const input=pptxVersionSchema.parse(raw),record=this.require(owner,input.id);
    return this.serialize(record,async()=>{
      if((await record.parser!.state(record.abort.signal)).version!==input.version)throw new FileError('CHANGED','演示文稿编辑版本已改变');
      const file=await this.persistence.refresh(owner,record.ref);this.require(owner,input.id);
      record.baseHash=file.revision.hash;record.source.writable=file.writable;record.blocked.clear();return file;
    });
  }
  async render(owner:string,raw:PptxRenderInput):Promise<PptxRenderResult>{
    const input=pptxRenderSchema.parse(raw),record=this.require(owner,input.id),key=`${owner}/${input.id}/${input.requestId}`;
    if(!this.engine)throw new FileError('UNSUPPORTED','本平台尚未提供演示文稿排版组件');
    if((this.cancelledPreviews.get(key)??0)>Date.now())throw new FileError('CANCELLED','演示文稿预览已取消');
    this.remember(this.cancelledPreviews,key);this.dropPreview(record);
    const preview:Preview={id:input.requestId,version:input.version,abort:new AbortController()};record.preview=preview;
    const signal=AbortSignal.any([preview.abort.signal,record.abort.signal]);
    const assert=()=>{this.require(owner,input.id);if(signal.aborted||record.preview!==preview)throw new FileError('CANCELLED','演示文稿预览已取消');};
    try{
      const {snapshot,state,projection}=await this.serialize(record,async()=>{
        assert();const snapshot=await this.jobs.run(signal,()=>record.parser!.materialize(input.version,record.abort.signal)),state=await record.parser!.state(record.abort.signal);assert();
        if(state.version!==input.version)throw new FileError('CHANGED','演示文稿编辑版本已改变');
        const projection=state.info.unsupportedCharts?.length?await this.jobs.run(signal,()=>record.parser!.previewSource(input.version,record.abort.signal)):snapshot;assert();return {snapshot,state,projection};
      });
      const output=await this.engine.render(projection.bytes,'pptx',signal);assert();
      let tableLayout:PptxRenderResult['tableLayout'],tableLayoutError:string|undefined,layoutElapsed=0;
      if(state.info.slides.some(slide=>slide.elements?.some(element=>element.table&&!element.hidden))){
        try{
          if(!this.engine.renderTableLayout)throw new FileError('UNSUPPORTED','此环境尚未提供表格单元格定位组件');
          // Cancelling a projection must not terminate the retained document
          // Worker (and its unsaved history). Queue/native work uses the preview
          // signal; a started bounded Worker operation uses document lifetime.
          const candidate=await this.jobs.run(signal,()=>record.parser!.tableLayoutSource(input.version,record.abort.signal));assert();
          if(candidate){
            const vector=await this.engine.renderTableLayout(candidate.bytes,signal);assert();layoutElapsed=vector.elapsedMs;
            tableLayout=await this.jobs.run(signal,()=>record.parser!.tableLayout(input.version,vector.bytes,record.abort.signal));assert();
          }else tableLayout=[];
        }catch(error){assert();if(!(error instanceof FileError)||error.code!=='UNSUPPORTED')throw error;tableLayoutError=error.message;}
      }
      if((await record.parser!.state(record.abort.signal)).version!==input.version)throw new FileError('CHANGED','演示文稿在排版期间已改变');assert();
      if(output.pages!==state.info.slides.length)throw new FileError('IO','幻灯片预览页数与编辑内容不一致');
      preview.bytes=output.bytes;
      return {id:input.requestId,version:input.version,sourceHash:snapshot.hash,info:state.info,hash:output.hash,bytes:output.bytes.length,pages:output.pages,elapsedMs:output.elapsedMs+layoutElapsed,...(tableLayout?{tableLayout}:{}),...(tableLayoutError?{tableLayoutError}:{}),warnings:[...(state.info.externalLinks?['外部链接保持隔离，预览使用文档内已有内容。']:[]),...(state.info.signed?['此文档包含数字签名，原文件保持不变。']:[]),...(tableLayoutError?[tableLayoutError]:[])]};
    }catch(error){if(record.preview===preview)this.dropPreview(record);throw error;}
  }
  chunk(owner:string,id:string,requestId:string,offset:number,length:number):string{
    const record=this.require(owner,id),preview=record.preview;
    if(!preview?.bytes||preview.id!==requestId||preview.abort.signal.aborted)throw new FileError('CANCELLED','演示文稿预览已过期或不属于此窗口');
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>1024*1024||offset+length>preview.bytes.length)throw new FileError('INVALID_INPUT','演示文稿页面读取范围无效');
    return Buffer.from(preview.bytes.subarray(offset,offset+length)).toString('base64');
  }
  cancelRender(owner:string,id:string,requestId:string):void{
    z.string().uuid().parse(id);z.string().uuid().parse(requestId);this.remember(this.cancelledPreviews,`${owner}/${id}/${requestId}`);
    const record=this.documents.get(this.key(owner,id));if(record?.preview?.id===requestId)this.dropPreview(record);
  }
  private dropPreview(record:Document){record.preview?.abort.abort();record.preview=undefined;}
  close(owner:string,id:string){z.string().uuid().parse(id);this.remember(this.cancelled,this.key(owner,id));const record=this.documents.get(this.key(owner,id));if(record)this.drop(record);}
  closeOwner(owner:string){for(const record of this.documents.values())if(record.owner===owner)this.drop(record);}
  dispose(){this.disposed=true;for(const record of this.documents.values())this.drop(record);this.cancelled.clear();this.cancelledPreviews.clear();}
  private drop(record:Document){
    if(record.abort.signal.aborted)return;this.dropPreview(record);record.abort.abort();record.releaseSource();record.parser?.close();this.documents.delete(this.key(record.owner,record.id));
  }
}
