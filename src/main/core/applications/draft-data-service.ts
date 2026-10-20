import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
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
const listSchema=z.object({cursor:z.string().max(8192).nullable().optional(),limit:z.number().int().min(1).max(200).default(50)}).strict();
const getSchema=z.object({draftId:z.uuid(),revision:z.number().int().positive().optional()}).strict();
const createSchema=z.object({content:draftContentSchema}).strict();
const updateSchema=z.object({draftId:z.uuid(),expectedRevision:z.number().int().positive(),content:draftContentSchema}).strict();
const copySchema=z.object({draftId:z.uuid(),expectedRevision:z.number().int().positive()}).strict();
const cursorSchema=z.object({schema:z.literal(1),projectId:z.string(),updatedAt:z.iso.datetime(),id:z.uuid()}).strict();
const methods=new Set(['mail.draft.list','mail.draft.get','mail.draft.create','mail.draft.update','mail.draft.copy','mail.resource.read']);
/** One backend for UI and supported Agent drafts. It stores no copy of a mail cache. */
export class MailDraftDataService implements ApplicationDataHost {
  constructor(private readonly contexts:ApplicationExecutionContexts,private readonly resources:ApplicationDataResources,private readonly drafts:MailDraftService,private readonly blobs:MailBlobStore,private readonly selections:ApplicationSelectionService,private readonly options:{verifyNewSource?:(context:ApplicationExecutionContext,content:MailDraftContent)=>Promise<void>}={}){
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
    const semantics=['mail.draft.create','mail.draft.update','mail.draft.copy'].includes(method)?'write' as const:'read' as const;
    return{semantics,retry:'never',authorize:context=>this.authorize(context,binding),authorizeReceipt:(context,operationId)=>this.contexts.assertAgentReceipt(context,binding,operationId),execute:(context,args,operation)=>this.contexts.withAgent(context,binding,operation,semantics,scope=>this.execute(scope,method,args))};
  }
  async view(context:ApplicationExecutionContext,draft:MailDraft):Promise<MailDraftDataView>{
    const text=await this.resources.register(context,{kind:'mail-draft-v1',objectId:draft.id,objectRevision:String(draft.revision),part:'text'},'text/plain;charset=utf-8',Buffer.from(draft.content.text));
    const html=draft.content.html===null?null:await this.resources.register(context,{kind:'mail-draft-v1',objectId:draft.id,objectRevision:String(draft.revision),part:'html'},'text/html;charset=utf-8',Buffer.from(draft.content.html));
    return{id:draft.id,revision:draft.revision,state:draft.state,contentHash:draft.contentHash,content:{...draft.content,text,html},attachments:draft.attachments.map(({id,filename,contentType,size,contentHash})=>({id,filename,contentType,size,contentHash})),activeIntentId:draft.activeIntentId,lastExecutionId:draft.lastExecutionId,sourceTaskId:draft.sourceTaskId,copiedFromDraftId:draft.copiedFromDraftId,createdAt:draft.createdAt,updatedAt:draft.updatedAt};
  }
  private async source(context:ApplicationExecutionContext,content:MailDraftContent,previous?:MailDraftContent):Promise<void>{
    const unchanged=previous&&content.mode===previous.mode&&canonicalJson(content.sourceMessageRef)===canonicalJson(previous.sourceMessageRef);if(unchanged)return;
    if(content.mode!=='new'&&!content.sourceMessageRef)throw new ApplicationError('INVALID_INPUT','回复草稿必须保留明确的原邮件来源');
    if(content.sourceMessageRef){if(!this.options.verifyNewSource)throw new ApplicationError('CAPABILITY_UNAVAILABLE','原邮件来源验证尚未接入，未创建虚构回复');await this.options.verifyNewSource(context,content);}
  }
  async execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<unknown>{
    if(method==='mail.resource.read')return this.resources.read(context,input);
    const actor=this.contexts.actor(context);
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
