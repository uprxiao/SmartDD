import { randomUUID } from 'node:crypto';
import { ApplicationError } from '@shared/applications';
import { fileActionTargetSchema,FileError } from '@shared/files';
import type { FileService } from '../files/file-service';
import type { TerminalFileSource } from '../files/terminal-context';
import { digest } from './manifest';
import { ApplicationExecutionContexts,type ApplicationExecutionContext,type ApplicationUiSender } from './execution-context';
interface Reference {projectId:string;source:TerminalFileSource;expiresAt:number}
/** Ephemeral, host-minted file capabilities; durable imports never keep ambient source paths. */
export class WorkspaceAttachmentReferences {
 private readonly references=new Map<string,Reference>();
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly files?:FileService,private readonly now=Date.now){}
 async capture(context:ApplicationExecutionContext,sender:ApplicationUiSender,input:unknown):Promise<{referenceId:string;expectedHash:string;size:number;relativePath:string}>{
  this.contexts.require(context,'mail.draft');if(!this.files)throw new ApplicationError('CAPABILITY_UNAVAILABLE','文件工作区尚未接入附件引用');if(context.callerKind!=='ui'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','文件引用必须由当前项目的真实页面选择');
  const target=fileActionTargetSchema.safeParse(input);if(!target.success)throw new ApplicationError('INVALID_INPUT','请选择当前文件工作区中的文件');
  const owner=`${sender.sender.id}:${sender.senderFrame!.processId}:${sender.senderFrame!.routingId}`;
  try{
   const root=this.files.roots.require(owner,target.data.kind==='document'?target.data.ref:target.data.path);if(root.projectId!==context.projectId)throw new ApplicationError('SCOPE_DENIED','文件根不属于当前项目');
   const source=await this.files.terminalSource(owner,target.data);this.contexts.require(context,'mail.draft');source.assert();if(source.revision.size>25*1024*1024)throw new ApplicationError('TOO_LARGE','单个附件不能超过25MiB');
   for(const [id,value] of this.references)if(value.expiresAt<=this.now()||value.source.signal.aborted)this.references.delete(id);
   if(this.references.size>=256)throw new ApplicationError('RESOURCE_BUSY','当前附件引用已满，请稍后重新选择');
   const referenceId=randomUUID();this.references.set(referenceId,{projectId:context.projectId,source,expiresAt:this.now()+600000});return{referenceId,expectedHash:source.revision.hash,size:source.revision.size,relativePath:source.relativePath};
  }catch(error){throw this.safe(error);}
 }
 async read(context:ApplicationExecutionContext,id:string,expectedHash:string):Promise<Buffer>{
  this.contexts.require(context,'mail.draft');const reference=this.references.get(id);
  if(!reference||reference.projectId!==context.projectId||reference.expiresAt<=this.now())throw new ApplicationError('SCOPE_DENIED','附件引用已失效或不属于当前项目，请重新选择文件');
  const source=reference.source;if(source.revision.hash!==expectedHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','附件引用摘要与选择时不同，请重新选择');
  try{
   source.assert();const bytes=Buffer.alloc(source.revision.size);
   for(let offset=0;offset<bytes.length;offset+=1024*1024){this.contexts.require(context,'mail.draft');source.assert();const part=await source.read(offset,Math.min(1024*1024,bytes.length-offset),context.signal);if(part.length!==Math.min(1024*1024,bytes.length-offset))throw new ApplicationError('RESOURCE_STATE_CHANGED','附件文件读取不完整');Buffer.from(part).copy(bytes,offset);}
   const current=await source.inspect();source.assert();this.contexts.require(context,'mail.draft');
   if(current.hash!==expectedHash||current.size!==source.revision.size||digest(bytes)!==expectedHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','附件文件在复制期间变化');return bytes;
  }catch(error){throw this.safe(error);}
 }
 private safe(error:unknown):ApplicationError{if(error instanceof ApplicationError)return error;if(error instanceof FileError)return new ApplicationError(error.code==='CANCELLED'?'CANCELED':['CHANGED','STALE_ROOT','MISSING'].includes(error.code)?'RESOURCE_STATE_CHANGED':error.code==='TOO_LARGE'?'TOO_LARGE':'SCOPE_DENIED','附件来源不可用、已改变或授权已失效，请重新选择');return new ApplicationError('SOURCE_UNAVAILABLE','附件来源读取未完成');}
 dispose(){this.references.clear();}
}
