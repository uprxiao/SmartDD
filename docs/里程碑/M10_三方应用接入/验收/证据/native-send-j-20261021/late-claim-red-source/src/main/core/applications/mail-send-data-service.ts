import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { ApplicationResourceRef } from '@shared/application-data';
import type { MailSendIntent } from '@shared/mail-execution';
import type { ApplicationDataBinding,ApplicationDataHost } from './application-adapter-registry';
import type { HostToolOperation } from './tool-service';
import { ApplicationExecutionContexts,type ApplicationExecutionContext,type ApplicationUiSender } from './execution-context';
import { ApplicationDataResources } from './data-resources';
import { MailUserAuthorizations } from './mail-user-authorizations';
import type { MailExecutionService } from './mail-execution-service';
import { PackageConfigViews } from './package-config-views';
import { canonicalJson } from './manifest';
const prepareSchema=z.object({draftId:z.uuid(),expectedRevision:z.number().int().positive(),expectedContentHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const getSchema=z.object({intentId:z.uuid()}).strict();
const executeSchema=getSchema.extend({expectedReviewHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const methods=new Set(['mail.send.prepare','mail.send.get','mail.send.cancel','mail.send.execute']);
export type {MailSendData} from '@shared/mail-execution';
import type {MailSendData} from '@shared/mail-execution';
export class MailSendDataService implements ApplicationDataHost {
 private readonly views:PackageConfigViews;
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly resources:ApplicationDataResources,private readonly engine:()=>Promise<MailExecutionService>,readonly authorizations:MailUserAuthorizations){
  this.views=new PackageConfigViews(contexts);resources.registerProvider({kind:'mail-send-review-v1',appId:'mail',contractMajor:1,permission:'mail.draft',read:async(context,backing)=>{
   const intent=(await this.engine()).get(this.contexts.sendActor(context,context.allowedOperations.includes('mail.send')?'mail.send':'mail.draft'),backing.objectId);if(backing.part!=='review'||!intent.review||intent.reviewHash!==backing.objectRevision)throw new ApplicationError('HASH_MISMATCH','原发送审阅修订不同');return Buffer.from(canonicalJson(intent.review));
  }});
 }
 resolve(version:1,method:string,binding:Readonly<ApplicationDataBinding>):HostToolOperation{
  if(version!==1||binding.appId!=='mail'||!methods.has(method))throw new ApplicationError('CAPABILITY_UNAVAILABLE','发送方法不属于当前宿主契约');const semantics=method==='mail.send.get'?'read' as const:'write' as const;
  return{semantics,retry:'never',authorize:run=>{const selected=run.snapshot.packages.find(pack=>pack.appId==='mail'&&pack.packageHash===binding.packageHash);if(!selected?.allowedOperations.includes(binding.permission))throw new ApplicationError('SCOPE_DENIED','原运行未选用本次发送动作');},authorizeReceipt:(run,id)=>this.contexts.assertAgentReceipt(run,binding,id),execute:(run,args,operation)=>this.contexts.withAgent(run,binding,operation,semantics,context=>this.execute(context,method,args))};
 }
 private async preflight(context:ApplicationExecutionContext){const connection=await this.contexts.sendConnection(context),view=this.views.get(context,connection);if(view.kind!=='smtp')throw new ApplicationError('CONFIG_INCOMPATIBLE','当前原包不能使用此发件配置');}
 async view(context:ApplicationExecutionContext,intent:MailSendIntent):Promise<MailSendData>{
  await this.contexts.subject(context,'mail-send',intent.id);await this.contexts.subject(context,'mail-draft',intent.draftId);
  let review:ApplicationResourceRef|null=null;if(intent.review&&intent.reviewHash)review=await this.resources.register(context,{kind:'mail-send-review-v1',objectId:intent.id,objectRevision:intent.reviewHash,part:'review'},'application/json',Buffer.from(canonicalJson(intent.review)));
  return{id:intent.id,draftId:intent.draftId,draftRevision:intent.draftRevision,state:intent.state,reviewHash:intent.reviewHash,review,authorized:intent.authorized&&this.authorizations.hasLive(intent),executionId:intent.executionId,result:intent.result,errorCode:intent.errorCode,createdAt:intent.createdAt,updatedAt:intent.updatedAt};
 }
 async execute(context:ApplicationExecutionContext,method:string,input:unknown):Promise<{intent:MailSendData}>{
  if(!methods.has(method))throw new ApplicationError('CAPABILITY_UNAVAILABLE','发送方法不属于当前宿主契约');const permission=method==='mail.send.prepare'||method==='mail.send.execute'?'mail.send':'mail.draft',actor=this.contexts.sendActor(context,permission),engine=await this.engine();let intent:MailSendIntent;
  if(method==='mail.send.prepare'){const parsed=prepareSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','发送准备字段无效');await this.preflight(context);intent=await engine.prepare(actor,{...parsed.data,operationId:context.operationId},context.signal);const ref=await this.authorizations.tryNative(context,intent);if(ref)intent=await engine.authorize(actor,intent.id,ref);}
  else if(method==='mail.send.execute'){
   const parsed=executeSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','发送执行字段无效');intent=engine.get(actor,parsed.data.intentId);if(intent.reviewHash!==parsed.data.expectedReviewHash)throw new ApplicationError('INTENT_STALE','发送审阅内容已变化');
   if(!intent.executionId){await this.preflight(context);if(!intent.authorized||this.authorizations.needsNativeRefresh(intent)){const ref=await this.authorizations.tryNative(context,intent);if(ref)intent=await engine.authorize(actor,intent.id,ref);}if(!intent.authorized)throw new ApplicationError('AUTHORIZATION_REQUIRED','本次具体邮件尚无可核验的用户授权，请审阅原意图或核对明确用户指令来源');await this.authorizations.revalidateNative(context,intent);}
   intent=await engine.execute(actor,intent.id,context.signal);
  }else{const parsed=getSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','发送记录字段无效');intent=method==='mail.send.get'?engine.get(actor,parsed.data.intentId):await engine.cancel(actor,parsed.data.intentId);}
  return{intent:await this.view(context,intent)};
 }
 async review(context:ApplicationExecutionContext,sender:ApplicationUiSender,id:string){if(!z.uuid().safeParse(id).success)throw new ApplicationError('INVALID_INPUT','发送意图编号无效');const intent=(await this.engine()).get(this.contexts.sendActor(context,'mail.draft'),id),display=this.authorizations.present(context,sender,intent);return{intent:await this.view(context,intent),...display};}
 async confirm(context:ApplicationExecutionContext,sender:ApplicationUiSender,input:unknown){const id=z.object({intentId:z.uuid()}).passthrough().parse(input).intentId,engine=await this.engine(),actor=this.contexts.sendActor(context),intent=engine.get(actor,id);await this.preflight(context);const ref=await this.authorizations.confirm(context,sender,intent,input);return{intent:await this.view(context,await engine.authorize(actor,id,ref))};}
}
