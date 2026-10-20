import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { LocalMailContent } from '@shared/application-mail';
import { mailSourceRefSchema,type MailSourceRef } from '@shared/application-mail-data';
import { applicationResourceRefSchema,type ApplicationResourceRef } from '@shared/application-data';
import type { WorkspaceAttachmentReferences } from './workspace-attachment-references';
import { mailReplyContent,mailReplyHeaders } from './mail-reply-content';
import { draftContentSchema, type MailDraft, type MailDraftContent } from '@shared/mail-drafts';
import type { MailDraftDataView } from '@shared/application-data';
import type { ApplicationDataHost, ApplicationDataBinding } from './application-adapter-registry';
import type { HostToolOperation } from './tool-service';
import type { RunContext } from './run-registry';
import type { MailDraftService } from './mail-draft-service';
import type { MailBlobStore } from './mail-blob-store';
import type { ApplicationSelectionService } from './selection-service';
import { ApplicationExecutionContexts, type ApplicationExecutionContext } from './execution-context';
import { ApplicationDataResources } from './data-resources';
import { canonicalJson } from './manifest';
import { PackageConfigViews } from './package-config-views';
const listSchema=z.object({cursor:z.string().max(8192).nullable().optional(),limit:z.number().int().min(1).max(200).default(50)}).strict();
const getSchema=z.object({draftId:z.uuid(),revision:z.number().int().positive().optional()}).strict();
const createSchema=z.object({content:draftContentSchema}).strict();
const updateSchema=z.object({draftId:z.uuid(),expectedRevision:z.number().int().positive(),content:draftContentSchema}).strict();
const copySchema=z.object({draftId:z.uuid(),expectedRevision:z.number().int().positive()}).strict();
const replySchema=z.object({reference:mailSourceRefSchema,mode:z.enum(['reply','reply-all']),senderConnectionId:z.uuid().nullable(),text:z.string().max(131072),html:z.string().max(131072).nullable().optional()}).strict();
const safeMetadata=z.string().min(1).refine(value=>!/[\x00-\x1f\x7f]/.test(value));
const importSchema=z.object({source:z.discriminatedUnion('kind',[z.object({kind:z.literal('resource'),resource:applicationResourceRefSchema,filename:safeMetadata.max(1024),contentType:safeMetadata.max(200)}).strict(),z.object({kind:z.literal('workspace-file'),referenceId:z.uuid(),expectedHash:z.string().regex(/^[a-f0-9]{64}$/),filename:safeMetadata.max(1024),contentType:safeMetadata.max(200)}).strict()])}).strict();
const cursorSchema=z.object({schema:z.literal(1),projectId:z.string(),updatedAt:z.iso.datetime(),id:z.uuid()}).strict();
const methods=new Set(['mail.draft.list','mail.draft.get','mail.draft.create','mail.draft.update','mail.draft.copy','mail.resource.read','mail.reply.create','mail.attachment.import']);
/** One backend for UI and supported Agent drafts. It stores no copy of a mail cache. */
export class MailDraftDataService implements ApplicationDataHost {
  private readonly views:PackageConfigViews;
  constructor(private readonly contexts:ApplicationExecutionContexts,private readonly resources:ApplicationDataResources,private readonly drafts:MailDraftService,private readonly blobs:MailBlobStore,private readonly selections:ApplicationSelectionService,private readonly options:{readSource?:(context:ApplicationExecutionContext,reference:MailSourceRef)=>Promise<LocalMailContent>;readResource?:(context:ApplicationExecutionContext,resource:ApplicationResourceRef)=>Promise<Uint8Array>;workspace?:WorkspaceAttachmentReferences}={}){
    this.views=new PackageConfigViews(contexts);
    resources.registerProvider({kind:'mail-draft-v1',appId:'mail',contractMajor:1,permission:'mail.draft',read:async(context,backing)=>{
      const revision=Number(backing.objectRevision);if(!Number.isInteger(revision)||revision<1||!['text','html'].includes(backing.part))throw new ApplicationError('INVALID_INPUT','草稿正文修订或字段无效');
      const draft=this.drafts.get(this.contexts.actor(context),backing.objectId,revision),body=backing.part==='text'?draft.content.text:draft.content.html;
      if(body===null)throw new ApplicationError('NOT_FOUND','该草稿修订没有HTML正文');return Buffer.from(body,'utf8');
    }});
    resources.registerProvider({kind:'mail-blob-v1',appId:'mail',contractMajor:1,permission:'mail.draft',read:async(context,backing)=>{
      const actor=this.contexts.actor(context),attachment=this.blobs.get(actor,backing.objectId);if(attachment.contentHash!==backing.objectRevision||backing.part!=='attachment')throw new ApplicationError('HASH_MISMATCH','附件业务身份与原修订不同');return this.blobs.read(actor,attachment.id);
    }});
  }
  authorize(context:RunContext,binding:Readonly<ApplicationDataBinding>):void{
    const selected=context.snapshot.packages.find(p=>p.appId==='mail'&&p.packageHash===binding.packageHash);
    if(!selected||!selected.allowedOperations.includes(binding.permission))throw new ApplicationError('SCOPE_DENIED','原会话未选用该邮件动作');this.selections.requireApplicationEnabled(context.run.projectId,'mail');
  }
  resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>):HostToolOperation{
    if(version!==1||binding.appId!=='mail'||!methods.has(method))throw new ApplicationError('CAPABILITY_UNAVAILABLE','该业务Data API尚未接入当前宿主');
    const semantics=['mail.draft.create','mail.draft.update','mail.draft.copy','mail.reply.create','mail.attachment.import'].includes(method)?'write' as const:'read' as const;
    return{semantics,retry:'never',authorize:context=>this.authorize(context,binding),authorizeReceipt:(context,operationId)=>this.contexts.assertAgentReceipt(context,binding,operationId),execute:(context,args,operation)=>this.contexts.withAgent(context,binding,operation,semantics,scope=>this.execute(scope,method,args))};
  }
  async view(context:ApplicationExecutionContext,draft:MailDraft):Promise<MailDraftDataView>{
    const text=await this.resources.register(context,{kind:'mail-draft-v1',objectId:draft.id,objectRevision:String(draft.revision),part:'text'},'text/plain;charset=utf-8',Buffer.from(draft.content.text));
    const html=draft.content.html===null?null:await this.resources.register(context,{kind:'mail-draft-v1',objectId:draft.id,objectRevision:String(draft.revision),part:'html'},'text/html;charset=utf-8',Buffer.from(draft.content.html));
    return{id:draft.id,revision:draft.revision,state:draft.state,contentHash:draft.contentHash,content:{...draft.content,text,html},attachments:draft.attachments.map(({id,filename,contentType,size,contentHash})=>({id,filename,contentType,size,contentHash})),activeIntentId:draft.activeIntentId,lastExecutionId:draft.lastExecutionId,sourceTaskId:draft.sourceTaskId,copiedFromDraftId:draft.copiedFromDraftId,createdAt:draft.createdAt,updatedAt:draft.updatedAt};
  }
  private async source(context:ApplicationExecutionContext,content:MailDraftContent,previous?:MailDraftContent):Promise<void>{
    if(content.mode==='new'&&(content.sourceMessageRef||content.inReplyTo||content.references.length))throw new ApplicationError('INVALID_INPUT','新邮件不能伪造回复关联，请依据原邮件创建回复');
    if(content.mode!=='new'&&!content.sourceMessageRef)throw new ApplicationError('INVALID_INPUT','回复草稿必须保留明确的原邮件来源');
    const unchanged=previous&&canonicalJson(content.sourceMessageRef)===canonicalJson(previous.sourceMessageRef);
    if(unchanged){if(content.sourceMessageRef&&(content.inReplyTo!==previous.inReplyTo||canonicalJson(content.references)!==canonicalJson(previous.references)))throw new ApplicationError('INVALID_INPUT','原回复关联头不能在保留同一来源时改写');return;}
    if(content.sourceMessageRef){
      if(!this.options.readSource)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原邮件来源验证尚未接入');
      const source=await this.options.readSource(context,content.sourceMessageRef as MailSourceRef);
      if(content.mode!=='new'){const headers=mailReplyHeaders(source);if(content.inReplyTo!==headers.inReplyTo||canonicalJson(content.references)!==canonicalJson(headers.references))throw new ApplicationError('INVALID_INPUT','回复关联头与原邮件不符，请先依据原邮件创建回复');}
    }
  }
  async execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>{
    if(method==='mail.resource.read')return this.resources.read(context,input);
    const actor=this.contexts.actor(context);
    if(method==='mail.reply.create'){
      const value=replySchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','回复创建字段无效');if(!this.options.readSource)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原邮件来源读取尚未接入');
      const source=await this.options.readSource(context,value.data.reference),sender=await this.contexts.draftSender(context,value.data.senderConnectionId);
      const senderConfig=sender?this.views.get(context,sender):null;if(senderConfig&&senderConfig.kind!=='smtp')throw new ApplicationError('CONFIG_INCOMPATIBLE','当前发件身份不是SMTP');
      const content=mailReplyContent(source,value.data,sender&&senderConfig?.kind==='smtp'?{id:sender.id,address:senderConfig.fromAddress}:null);
      return{draft:await this.view(context,await this.drafts.create(actor,{operationId:context.operationId,content}))};
    }
    if(method==='mail.attachment.import'){
      const value=importSchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','附件导入字段无效');const source=value.data.source;
      if(source.kind==='resource'&&!this.options.readResource||source.kind==='workspace-file'&&!this.options.workspace)throw new ApplicationError('CAPABILITY_UNAVAILABLE','附件来源尚未接入');
      if(source.kind==='resource'&&source.resource.size>25*1024*1024)throw new ApplicationError('TOO_LARGE','附件不能超过25MiB');
      const bytes=source.kind==='resource'?await this.options.readResource!(context,source.resource):await this.options.workspace!.read(context,source.referenceId,source.expectedHash);
      this.contexts.require(context,'mail.draft');const {id,filename,contentType,size,contentHash}=await this.blobs.save(actor,{operationId:context.operationId,filename:source.filename,contentType:source.contentType},bytes,context.signal);
      return{attachment:{id,filename,contentType,size,contentHash}};
    }
    if(method==='mail.draft.list'){
      const value=listSchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','草稿列表参数无效');let cursor:{updatedAt:string;id:string}|undefined;
      if(value.data.cursor)try{const parsed=cursorSchema.parse(JSON.parse(Buffer.from(value.data.cursor,'base64url').toString('utf8')));if(parsed.projectId!==actor.projectId)throw new Error();cursor={updatedAt:parsed.updatedAt,id:parsed.id};}catch{throw new ApplicationError('INVALID_INPUT','草稿游标不属于当前项目或格式无效');}
      const page=this.drafts.list(actor,value.data.limit,cursor);return{items:page.items.map(({id,revision,state,subject,attachmentCount,createdAt,updatedAt})=>({id,revision,state,subject,attachmentCount,createdAt,updatedAt})),nextCursor:page.nextCursor?Buffer.from(canonicalJson({schema:1,projectId:actor.projectId,...page.nextCursor})).toString('base64url'):null};
    }
    if(method==='mail.draft.get'){const value=getSchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','草稿读取参数无效');return{draft:await this.view(context,this.drafts.get(actor,value.data.draftId,value.data.revision))};}
    if(method==='mail.draft.create'){const value=createSchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','草稿创建字段无效');await this.source(context,value.data.content);return{draft:await this.view(context,await this.drafts.create(actor,{operationId:context.operationId,content:value.data.content}))};}
    if(method==='mail.draft.update'){const value=updateSchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','草稿更新字段无效');const prior=this.drafts.get(actor,value.data.draftId);await this.source(context,value.data.content,prior.content);return{draft:await this.view(context,await this.drafts.update(actor,{...value.data,operationId:context.operationId}))};}
    if(method==='mail.draft.copy'){const value=copySchema.safeParse(input);if(!value.success)throw new ApplicationError('INVALID_INPUT','草稿复制参数无效');return{draft:await this.view(context,await this.drafts.copyAsNew(actor,value.data.draftId,value.data.expectedRevision,context.operationId))};}
    throw new ApplicationError('CAPABILITY_UNAVAILABLE','该邮件业务方法尚未接入');
  }
}
