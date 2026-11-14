import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {mailUnknownConfirmationSchema,mailUnknownVerificationSchema,type MailUnknownReview,type MailUnknownVerification} from '@shared/mail-unknown';
import type {MailDraft} from '@shared/mail-drafts';
import type {ApplicationActivityDetail} from '@shared/application-activity';
import type {ApplicationExecutionContext,ApplicationExecutionContexts,ApplicationUiSender} from './execution-context';
import type {MailDraftService} from './mail-draft-service';
import {canonicalJson,digest} from './manifest';
import {withResourceLock} from './resource-lock';

interface Display {sender:ApplicationUiSender['sender'];frame:ApplicationUiSender['senderFrame'];review:MailUnknownReview;expiresAt:number;copyOperationId:string;policyHash:string}
const recordSchema=z.object({kind:z.literal('unknown-verification'),schema:z.literal(1),verification:mailUnknownVerificationSchema}).strict();

/** UI-only append-only observations. Original SMTP evidence remains immutable. */
export class MailUnknownVerifications {
 private readonly displays=new Map<string,Display>();private closed=false;
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly drafts:MailDraftService,private readonly history:(projectId:string,draft:MailDraft)=>ApplicationActivityDetail|null,private readonly policyStamp:(projectId:string)=>unknown,private readonly now=()=>Date.now()){}
 private require(context:ApplicationExecutionContext,action?:string){
  this.contexts.require(context,'mail.draft');
  if(this.closed||context.callerKind!=='ui'||context.appId!=='mail'||!context.projectId||action&&context.action!==action)throw new ApplicationError('SCOPE_DENIED','核实结果必须来自当前项目的真实邮件界面');
 }
 private snapshot(context:ApplicationExecutionContext,executionId:string):MailUnknownReview{
  this.require(context);if(!z.uuid().safeParse(executionId).success)throw new ApplicationError('INVALID_INPUT','原发送执行编号无效');
  const row=this.contexts.store.sqlite.prepare('SELECT e.draft_id,e.draft_revision,e.intent_id,e.review_hash,e.state,i.review_json,i.review_hash AS intent_review_hash FROM mail_send_executions e JOIN mail_send_intents i ON i.id=e.intent_id AND i.project_id=e.project_id WHERE e.id=? AND e.project_id=?').get(executionId,context.projectId) as {draft_id:string;draft_revision:number;intent_id:string;review_hash:string;state:string;review_json:string;intent_review_hash:string}|undefined;
  if(!row)throw new ApplicationError('NOT_FOUND','当前项目没有此发送执行');
  const draft=this.drafts.get(this.contexts.actor(context),row.draft_id),history=this.history(context.projectId!,draft);
  if(draft.revision!==row.draft_revision||draft.state!=='unknown'||draft.lastExecutionId!==executionId||draft.activeIntentId||row.state!=='unknown'||history?.item.send?.executionId!==executionId||history.item.state!=='unknown'||!history.send)throw new ApplicationError('REVISION_CONFLICT','原发送结果或草稿修订已变化，请重新打开');
  let review:{rawHash:string};try{review=JSON.parse(row.review_json);if(digest(canonicalJson(review))!==row.review_hash||row.review_hash!==row.intent_review_hash||!/^[a-f0-9]{64}$/.test(review.rawHash))throw Error();}catch{throw new ApplicationError('HASH_MISMATCH','原发送审阅损坏');}
  const target={projectId:context.projectId!,draftId:draft.id,draftRevision:draft.revision,contentHash:draft.contentHash,executionId,intentId:row.intent_id,reviewHash:row.review_hash,rawHash:review.rawHash,state:'unknown' as const,messageId:history.send.messageId,fromAddress:history.send.fromAddress};
  return {...target,verificationHash:digest(canonicalJson(target))};
 }
 private decode(json:string):MailUnknownVerification{
  try{const {verification}=recordSchema.parse(JSON.parse(json)),{recordHash,...body}=verification;
   if(recordHash!==digest(canonicalJson(body)))throw Error();return verification;
  }catch{throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','人工核实记录损坏，未替换原发送结果');}
 }
 private records(projectId:string):MailUnknownVerification[]{
  return (this.contexts.store.sqlite.prepare("SELECT operation_id,draft_id,result_json FROM mail_draft_mutations WHERE project_id=? AND request_hash LIKE 'mail-unknown-v1:%'").all(projectId) as {operation_id:string;draft_id:string;result_json:string}[]).map(row=>{const value=this.decode(row.result_json);if(value.id!==row.operation_id||value.review.projectId!==projectId||value.review.draftId!==row.draft_id)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','人工核实登记与原项目不符');return value;});
 }
 private existing(context:ApplicationExecutionContext,executionId:string):MailUnknownVerification|null{
  const values=this.records(context.projectId!).filter(v=>v.review.executionId===executionId);
  if(values.length>1)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','同一原发送存在冲突核实记录');
  const value=values[0];if(!value)return null;return this.checked(context,value);
 }
 private checked(context:ApplicationExecutionContext,value:MailUnknownVerification){
  if(canonicalJson(value.review)!==canonicalJson(this.snapshot(context,value.review.executionId)))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','人工核实与原发送身份不符');
  return value;
 }
 forDraft(context:ApplicationExecutionContext,draft:MailDraft):MailUnknownVerification|null{
  this.require(context);if(!draft.lastExecutionId)return null;const matches=this.records(context.projectId!).filter(v=>v.review.executionId===draft.lastExecutionId&&v.review.draftId===draft.id&&v.review.draftRevision===draft.revision);
  return matches.length?this.existing(context,draft.lastExecutionId):null;
 }
 sentDraftIds(context:ApplicationExecutionContext):string[]{
  this.require(context);return this.records(context.projectId!).filter(v=>v.decision==='sent').map(v=>{
   return this.checked(context,v).review.draftId;
  });
 }
 present(context:ApplicationExecutionContext,sender:ApplicationUiSender,executionId:string){
  this.require(context,'ui.mail.unknown.review');const review=this.snapshot(context,executionId);
  if(this.existing(context,executionId))throw new ApplicationError('REVISION_CONFLICT','原发送结果已经人工核实');
  for(const [id,d] of this.displays)if(d.expiresAt<=this.now())this.displays.delete(id);
  if(this.displays.size>=256)throw new ApplicationError('RESOURCE_BUSY','核实窗口过多，请关闭后重试');
  if(!sender.senderFrame)throw new ApplicationError('SCOPE_DENIED','核实窗口缺少真实页面身份');
  const displayReceiptId=randomUUID();this.displays.set(displayReceiptId,{sender:sender.sender,frame:sender.senderFrame,review,expiresAt:this.now()+600000,copyOperationId:randomUUID(),policyHash:digest(canonicalJson(this.policyStamp(context.projectId!)))});return{displayReceiptId,review};
 }
 async confirm(context:ApplicationExecutionContext,sender:ApplicationUiSender,input:unknown){
  this.require(context,'ui.mail.unknown.confirm');if(context.semantics!=='write')throw new ApplicationError('SCOPE_DENIED','人工核实需要明确的界面写操作');
  const parsed=mailUnknownConfirmationSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','请明确核实本次原发送结果');
  const args=parsed.data,requestHash='mail-unknown-v1:'+digest(canonicalJson({method:'unknown-verification',...args,projectId:context.projectId})),db=this.contexts.store.sqlite;
  const prior=db.prepare('SELECT request_hash,result_json FROM mail_draft_mutations WHERE project_id=? AND operation_id=?').get(context.projectId,args.operationId) as {request_hash:string;result_json:string}|undefined;
  if(prior){if(prior.request_hash!==requestHash)throw new ApplicationError('REVISION_CONFLICT','核实操作编号已用于其他决定');const verification=this.decode(prior.result_json);this.existing(context,verification.review.executionId);return{verification,draft:verification.copiedDraftId?this.drafts.get(this.contexts.actor(context),verification.copiedDraftId):null};}
  const display=this.displays.get(args.displayReceiptId);
  if(!display||display.sender!==sender.sender||display.frame!==sender.senderFrame||display.review.projectId!==context.projectId||display.review.executionId!==args.executionId||display.review.verificationHash!==args.expectedVerificationHash||display.expiresAt<=this.now()||display.policyHash!==digest(canonicalJson(this.policyStamp(context.projectId!))))throw new ApplicationError('AUTHORIZATION_REQUIRED','请在当前窗口核对原邮件后明确选择');
  const actor=this.contexts.actor(context),copy=args.decision==='not-sent'?this.drafts.prepareCopyAsNew(actor,display.review.draftId,display.review.draftRevision,display.copyOperationId):null;
  const result=await withResourceLock(this.contexts.store.root,()=>db.transaction(()=>{
   this.require(context,'ui.mail.unknown.confirm');if(this.displays.get(args.displayReceiptId)!==display||display.expiresAt<=this.now()||display.policyHash!==digest(canonicalJson(this.policyStamp(context.projectId!)))||canonicalJson(this.snapshot(context,args.executionId))!==canonicalJson(display.review))throw new ApplicationError('AUTHORIZATION_REQUIRED','原结果或核实窗口已变化');
   if(this.existing(context,args.executionId))throw new ApplicationError('REVISION_CONFLICT','原发送结果已经人工核实');
   const draft=copy?.()??null,body={id:args.operationId,review:display.review,decision:args.decision,confirmedAt:new Date(this.now()).toISOString(),senderId:sender.sender.id,frameProcessId:sender.senderFrame!.processId,frameRoutingId:sender.senderFrame!.routingId,displayReceiptHash:digest(args.displayReceiptId),policyHash:display.policyHash,copiedDraftId:draft?.id??null};
   const verification:MailUnknownVerification={...body,recordHash:digest(canonicalJson(body))};
   db.prepare('INSERT INTO mail_draft_mutations(project_id,operation_id,request_hash,draft_id,result_json,created_at) VALUES(?,?,?,?,?,?)').run(context.projectId,args.operationId,requestHash,display.review.draftId,canonicalJson({kind:'unknown-verification',schema:1,verification}),body.confirmedAt);
   return{verification,draft};
  }).immediate());
  this.displays.delete(args.displayReceiptId);return result;
 }
 discard(sender:ApplicationUiSender,projectId:string,displayReceiptId:string){
  if(!z.uuid().safeParse(displayReceiptId).success)throw new ApplicationError('INVALID_INPUT','核实窗口编号无效');
  const display=this.displays.get(displayReceiptId);if(!display)return{discarded:false};
  if(display.sender!==sender.sender||display.frame!==sender.senderFrame||display.review.projectId!==projectId)throw new ApplicationError('SCOPE_DENIED','不能关闭其他窗口的核实记录');
  this.displays.delete(displayReceiptId);return{discarded:true};
 }
 dispose(){this.closed=true;this.displays.clear();}
}
