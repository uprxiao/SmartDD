import { join } from 'node:path';
import { FileError,type FileRef } from '@shared/files';
import { OFFICE_LIMITS,officeOpenSchema } from '@shared/file-office';
import type { OfficePagesOpenInput,OfficePagesResult,DocxSourceResult } from '@shared/file-office-pages';
import type { OfficeSource } from './service';
import { OfficePagesParser } from './pages-parser';
import type { LibreOfficeEngine } from './libreoffice-engine';
import { fileHeavyJobs,type FileHeavyJobs } from '../heavy-jobs';

interface Job { owner:string; id:string; source:OfficeSource; abort:AbortController; invalidate():void; parser?:OfficePagesParser; bytes?:Uint8Array }
/** Source-scoped previews: caller supplies a trusted FileRef, never bytes or a
 * path. OOXML is preflighted in a Worker before fixed native layout runs. */
export class FileOfficePagesService {
  private readonly jobs=new Map<string,Job>();
  private readonly cancelled=new Map<string,number>();
  private disposed=false;
  constructor(private readonly resolve:(owner:string,ref:FileRef)=>OfficeSource,private readonly engine?:Pick<LibreOfficeEngine,'render'|'dispose'>,private readonly workerPath=join(__dirname,'m9-office-pages.js'),private readonly queue:FileHeavyJobs=fileHeavyJobs){}
  get activeDocuments(){return this.jobs.size;}
  private key(owner:string,id:string){return `${owner}/${id}`;}
  /** Legacy DOCX uses the original, validated OOXML, not the native PDF
   * projection. The same owner/revision/lifetime and bounded Worker apply. */
  async openDocx(owner:string,raw:OfficePagesOpenInput):Promise<DocxSourceResult>{
    const input=officeOpenSchema.parse(raw),key=this.key(owner,input.id);
    for(const [id,until] of this.cancelled)if(until<Date.now())this.cancelled.delete(id);
    if(this.disposed||this.cancelled.has(key))throw new FileError('CANCELLED','DOCX 预览已取消');
    if(this.jobs.has(key))throw new FileError('IDEMPOTENCY','Office 页面预览编号已使用');
    if(this.jobs.size>=OFFICE_LIMITS.sessions)throw new FileError('TOO_LARGE','Office 页面预览数量已达上限');
    const source=this.resolve(owner,input.ref);source.assert();
    if(source.signal.aborted)throw new FileError('CANCELLED','DOCX 来源已关闭');
    if(source.hash!==input.baseHash)throw new FileError('CHANGED','DOCX 文档版本已改变');
    if(!/\.docx$/i.test(source.name))throw new FileError('UNSUPPORTED','此入口只接受 DOCX');
    if(!Number.isSafeInteger(source.size)||source.size<1||source.size>OFFICE_LIMITS.inputBytes)throw new FileError('TOO_LARGE','DOCX 文档为空或超过 40 MiB');
    const abort=new AbortController(),job:Job={owner,id:input.id,source,abort,invalidate:()=>this.release(owner,input.id)};
    this.jobs.set(key,job);source.signal.addEventListener('abort',job.invalidate,{once:true});
    const signal=AbortSignal.any([abort.signal,source.signal]);
    const assert=()=>{if(signal.aborted||this.jobs.get(key)!==job)throw new FileError('CANCELLED','DOCX 预览已取消');source.assert();};
    try {
      return await this.queue.run(signal,async()=>{
        let timeout=false;const timer=setTimeout(()=>{timeout=true;this.release(owner,input.id);},OFFICE_LIMITS.parseMs);
        try {
          assert();const bytes=new Uint8Array(source.size);
          for(let offset=0;offset<bytes.length;offset+=1024*1024){
            const length=Math.min(1024*1024,bytes.length-offset);assert();const part=await source.read(offset,length,signal);assert();
            if(part.length!==length)throw new FileError('CHANGED','DOCX 文档读取不完整');bytes.set(part,offset);
          }
          job.parser=new OfficePagesParser(this.workerPath);const info=await job.parser.inspect(bytes,source.hash,signal);assert();
          if(info.kind!=='docx')throw new FileError('INVALID_INPUT','DOCX 扩展名与内容不一致');
          // Final native identity check after ZIP/XML validation.
          const probe=await source.read(0,1,signal);assert();
          if(probe.length!==1||probe[0]!==bytes[0])throw new FileError('CHANGED','DOCX 文档在解析期间改变');
          job.bytes=bytes;return {id:input.id,sourceHash:source.hash,bytes:bytes.length,info};
        } catch(error){if(timeout)throw new FileError('TIMEOUT','DOCX 读取或解析超过 15 秒');throw error;}
        finally {clearTimeout(timer);job.parser?.close();job.parser=undefined;}
      });
    } catch(error){const cancelled=signal.aborted;this.release(owner,input.id);if(cancelled&&!(error instanceof FileError))throw new FileError('CANCELLED','DOCX 预览已取消');throw error;}
  }
  async open(owner:string,raw:OfficePagesOpenInput):Promise<OfficePagesResult>{
    const input=officeOpenSchema.parse(raw),key=this.key(owner,input.id);
    for(const [id,until] of this.cancelled)if(until<Date.now())this.cancelled.delete(id);
    if(this.disposed||this.cancelled.has(key))throw new FileError('CANCELLED','Office 页面预览已取消');
    if(!this.engine)throw new FileError('UNSUPPORTED','本平台尚未提供 Office 文档排版组件');
    if(this.jobs.has(key))throw new FileError('IDEMPOTENCY','Office 页面预览编号已使用');
    if(this.jobs.size>=OFFICE_LIMITS.sessions)throw new FileError('TOO_LARGE','Office 页面预览数量已达上限');
    const source=this.resolve(owner,input.ref);source.assert();
    if(source.signal.aborted)throw new FileError('CANCELLED','Office 文档来源已关闭');
    if(source.hash!==input.baseHash)throw new FileError('CHANGED','Office 文档版本已改变');
    const format=/\.(docx|pptx)$/i.exec(source.name)?.[1].toLowerCase();
    if(format!=='docx'&&format!=='pptx')throw new FileError('UNSUPPORTED','此入口只接受 DOCX 和 PPTX');
    if(!Number.isSafeInteger(source.size)||source.size<1||source.size>OFFICE_LIMITS.inputBytes)throw new FileError('TOO_LARGE','Office 文档为空或超过 40 MiB');
    const abort=new AbortController(),job:Job={owner,id:input.id,source,abort,invalidate:()=>this.release(owner,input.id)};
    this.jobs.set(key,job);source.signal.addEventListener('abort',job.invalidate,{once:true});
    const signal=AbortSignal.any([abort.signal,source.signal]);
    const assert=()=>{if(signal.aborted||this.jobs.get(key)!==job)throw new FileError('CANCELLED','Office 页面预览已取消');source.assert();};
    try {
      const {bytes,info,previewBytes}=await this.queue.run(signal,async()=>{
        let timeout=false;const timer=setTimeout(()=>{timeout=true;this.release(owner,input.id);},OFFICE_LIMITS.parseMs);
        try {
          assert();const bytes=new Uint8Array(source.size);
          for(let offset=0;offset<bytes.length;offset+=1024*1024){
            assert();const length=Math.min(1024*1024,bytes.length-offset),chunk=await source.read(offset,length,signal);assert();
            if(chunk.length!==length)throw new FileError('CHANGED','Office 文档读取不完整');bytes.set(chunk,offset);
          }
          job.parser=new OfficePagesParser(this.workerPath);const {info,previewBytes}=await job.parser.prepare(bytes,source.hash,signal);assert();
          if(info.kind!==format)throw new FileError('INVALID_INPUT','Office 文件扩展名与实际内容不一致');
          return {bytes,info,previewBytes};
        } catch(error){if(timeout)throw new FileError('TIMEOUT','Office 文档读取或解析超过 15 秒');throw error;}
        finally {clearTimeout(timer);job.parser?.close();job.parser=undefined;}
      });
      // Native rendering owns the same shared queue; release the parse slot first.
      assert();const output=await this.engine.render(previewBytes??bytes,format,signal);assert();
      // Recheck native file identity/mtime/ctime after slow layout. A watcher
      // event need not have reached the renderer yet for an obsolete PDF to fail.
      const probe=await source.read(0,1,signal);assert();
      if(probe.length!==1||probe[0]!==bytes[0])throw new FileError('CHANGED','Office 文档在排版期间已改变');
      if(info.kind==='pptx'&&output.pages!==info.slides.length)throw new FileError('IO','幻灯片预览页数与源文件不一致，请重试');
      job.bytes=output.bytes;
      const warnings:string[]=[];
      if(info.externalLinks)warnings.push('外部链接保持隔离，预览使用文档内已有内容。');
      if(info.signed)warnings.push('此文档包含数字签名，原文件保持不变。');
      return {id:input.id,sourceHash:source.hash,info,hash:output.hash,bytes:output.bytes.length,pages:output.pages,elapsedMs:output.elapsedMs,warnings};
    } catch(error){this.release(owner,input.id);throw error;}
  }
  chunk(owner:string,id:string,offset:number,length:number):string {
    const job=this.jobs.get(this.key(owner,id));
    if(!job?.bytes||job.abort.signal.aborted)throw new FileError('UNTRUSTED','Office 页面预览已关闭或不属于此窗口');
    job.source.assert();
    if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(length)||length<1||length>1024*1024||offset+length>job.bytes.length)throw new FileError('INVALID_INPUT','Office 页面读取范围无效');
    return Buffer.from(job.bytes.subarray(offset,offset+length)).toString('base64');
  }
  release(owner:string,id:string):void {
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id))return;
    const key=this.key(owner,id);if(this.cancelled.size>=2048)this.cancelled.delete(this.cancelled.keys().next().value!);this.cancelled.set(key,Date.now()+60000);
    const job=this.jobs.get(key);if(!job)return;
    this.jobs.delete(key);job.abort.abort();job.parser?.close();job.source.signal.removeEventListener('abort',job.invalidate);job.bytes=undefined;
  }
  closeOwner(owner:string){for(const job of this.jobs.values())if(job.owner===owner)this.release(owner,job.id);}
  dispose(){this.disposed=true;for(const job of this.jobs.values())this.release(job.owner,job.id);this.engine?.dispose();}
}
