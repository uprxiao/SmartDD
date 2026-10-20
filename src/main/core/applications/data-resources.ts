import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import { applicationResourceReadSchema,applicationResourceRefSchema, type ApplicationResourceRef, type ApplicationResourceChunk } from '@shared/application-data';
import type { ApplicationId } from '@shared/application-connections';
import type { ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import { digest } from './manifest';
import { ApplicationExecutionContexts, type ApplicationExecutionContext } from './execution-context';

export interface ApplicationResourceBacking {kind:string;objectId:string;objectRevision:string;part:string}
interface ResourceRow {resource_id:string;project_id:string;app_id:ApplicationId;backing_kind:string;object_id:string;object_revision:string;part:string;data_contract_major:number;permission:string;content_hash:string;byte_size:number;media_type:string;minted_package_hash:string;minted_operation_id:string;created_at:string}
export interface ApplicationResourceProvider {
  kind:string;appId:ApplicationId;contractMajor:1;permission:string;
  read(context:ApplicationExecutionContext,backing:Readonly<ApplicationResourceBacking>):Promise<Uint8Array>;
}
const backingSchema=z.object({kind:z.string().regex(/^[a-z][a-z0-9-]{0,79}$/),objectId:z.string().min(1).max(512),objectRevision:z.string().min(1).max(256),part:z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/)}).strict();
/** Durable business references contain no body bytes and no arbitrary filesystem paths.
 * Rebuildable mail resources belong to the separate quota-controlled mail cache, not this table.
 */
export class ApplicationDataResources {
  private readonly providers=new Map<string,ApplicationResourceProvider>();
  constructor(readonly store:ResourceStore,private readonly contexts:ApplicationExecutionContexts){}
  registerProvider(provider:ApplicationResourceProvider):void{
    if(this.providers.has(provider.kind)||!backingSchema.shape.kind.safeParse(provider.kind).success)throw new ApplicationError('VERSION_CONFLICT','业务资源提供方身份重复或无效');this.providers.set(provider.kind,provider);
  }
  private provider(context:ApplicationExecutionContext,kind:string):ApplicationResourceProvider{
    const provider=this.providers.get(kind);
    if(!provider||provider.appId!==context.appId)throw new ApplicationError('HOST_INCOMPATIBLE','当前宿主不支持该业务资源契约');this.contexts.require(context,provider.permission);return provider;
  }
  async register(context:ApplicationExecutionContext,input:ApplicationResourceBacking,mediaType:string,bytes:Uint8Array):Promise<ApplicationResourceRef>{
    const parsed=backingSchema.safeParse(input);if(!parsed.success||!(bytes instanceof Uint8Array)||!mediaType||mediaType.length>200||/[\x00-\x1f\x7f]/.test(mediaType))throw new ApplicationError('INVALID_INPUT','业务资源引用字段无效');
    const backing=parsed.data,provider=this.provider(context,backing.kind),actor=this.contexts.actor(context,provider.permission),hash=digest(bytes),size=bytes.byteLength;
    return withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      this.contexts.require(context,provider.permission);
      const old=this.store.sqlite.prepare('SELECT * FROM application_data_resources WHERE project_id=? AND app_id=? AND backing_kind=? AND object_id=? AND object_revision=? AND part=? AND data_contract_major=?').get(actor.projectId,context.appId,backing.kind,backing.objectId,backing.objectRevision,backing.part,provider.contractMajor) as ResourceRow|undefined;
      if(old){if(old.content_hash!==hash||old.byte_size!==size||old.media_type!==mediaType||old.permission!==provider.permission)throw new ApplicationError('HASH_MISMATCH','同一业务修订已有其他资源内容，未覆盖原引用');return{id:old.resource_id,revision:old.content_hash,mediaType:old.media_type,size:old.byte_size};}
      const id=randomUUID();this.store.sqlite.prepare('INSERT INTO application_data_resources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(id,actor.projectId,context.appId,backing.kind,backing.objectId,backing.objectRevision,backing.part,provider.contractMajor,provider.permission,hash,size,mediaType,context.packageHash,context.operationId,new Date().toISOString());return{id,revision:hash,mediaType,size};
    }).immediate());
  }
  async read(context:ApplicationExecutionContext,input:unknown):Promise<ApplicationResourceChunk>{
    const parsed=applicationResourceReadSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','资源引用或读取范围无效');
    const value=parsed.data,bytes=await this.bytes(context,value.resource,Number.MAX_SAFE_INTEGER);
    if(value.offset>bytes.length)throw new ApplicationError('INVALID_INPUT','资源读取位置超出原内容');
    const chunk=bytes.subarray(value.offset,Math.min(bytes.length,value.offset+value.length));let encoding:'utf8'|'base64'='base64',data=chunk.toString('base64');
    if(value.resource.mediaType.startsWith('text/')||value.resource.mediaType==='application/json')try{data=new TextDecoder('utf-8',{fatal:true}).decode(chunk);encoding='utf8';}catch{/* Split UTF-8 bytes remain lossless in base64. */}
    const next=value.offset+chunk.length,eof=next===bytes.length;return{resourceId:value.resource.id,revision:value.resource.revision,offset:value.offset,length:chunk.length,encoding,data,nextOffset:eof?null:next,eof};
  }
  /** Internal host copy path; model/UI resources remain bounded chunks. */
  async bytes(context:ApplicationExecutionContext,input:ApplicationResourceRef,limit:number):Promise<Buffer>{
    const parsed=applicationResourceRefSchema.safeParse(input);if(!parsed.success||!Number.isSafeInteger(limit)||limit<0)throw new ApplicationError('INVALID_INPUT','业务资源或复制预算无效');const resource=parsed.data;
    this.contexts.assertActive(context);if(context.scopeKind!=='project'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','业务资源需要有效项目');
    const row=this.store.sqlite.prepare('SELECT * FROM application_data_resources WHERE resource_id=? AND project_id=? AND app_id=?').get(resource.id,context.projectId,context.appId) as ResourceRow|undefined;
    if(!row)throw new ApplicationError('NOT_FOUND','当前项目没有此业务资源');const provider=this.provider(context,row.backing_kind);
    if(row.data_contract_major!==provider.contractMajor||row.permission!==provider.permission)throw new ApplicationError('HOST_INCOMPATIBLE','原业务资源读取契约尚不兼容');
    if(row.content_hash!==resource.revision||row.byte_size!==resource.size||row.media_type!==resource.mediaType)throw new ApplicationError('HASH_MISMATCH','资源引用不能替换原内容修订或类型');
    if(row.byte_size>limit)throw new ApplicationError('TOO_LARGE','业务资源超过附件导入预算');
    const bytes=Buffer.from(await provider.read(context,{kind:row.backing_kind,objectId:row.object_id,objectRevision:row.object_revision,part:row.part}));
    this.contexts.require(context,provider.permission);
    if(bytes.length!==row.byte_size||digest(bytes)!==row.content_hash)throw new ApplicationError('HASH_MISMATCH','原业务资源缺失或内容已变化');
    return bytes;
  }

}
