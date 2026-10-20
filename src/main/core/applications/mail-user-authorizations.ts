import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { MailSendActor,MailSendIntent,MailSendReview,VerifiedMailUserAction } from '@shared/mail-execution';
import { ApplicationExecutionContexts,type ApplicationExecutionContext,type ApplicationUiSender } from './execution-context';
import { canonicalJson,digest } from './manifest';
import { withResourceLock } from './resource-lock';
const confirmSchema=z.object({intentId:z.uuid(),expectedReviewHash:z.string().regex(/^[a-f0-9]{64}$/),displayReceiptId:z.uuid(),reviewedUnknownExecutionIds:z.array(z.uuid()).max(100).default([])}).strict();
interface Display {sender:ApplicationUiSender['sender'];frame:ApplicationUiSender['senderFrame'];projectId:string;intentId:string;reviewHash:string;expiresAt:number}
interface Action {value:VerifiedMailUserAction;provenance:string;originSignal:AbortSignal|null}
/** Only host-observed sources mint authority. Persistent provenance alone is never a live grant. */
export class MailUserAuthorizations {
 private readonly displays=new Map<string,Display>();private readonly actions=new Map<string,Action>();private closed=false;
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly now=Date.now){}
 private cleanup(){for(const [id,value] of this.displays)if(value.expiresAt<=this.now())this.displays.delete(id);for(const [id,value] of this.actions)if(Date.parse(value.value.expiresAt)<=this.now()||value.originSignal?.aborted)this.actions.delete(id);}
 present(context:ApplicationExecutionContext,sender:ApplicationUiSender,intent:MailSendIntent):{displayReceiptId:string;review:MailSendReview}{
  this.contexts.require(context,'mail.draft');if(this.closed||context.callerKind!=='ui'||context.action!=='ui.mail.send.review'||intent.projectId!==context.projectId||!intent.review||!intent.reviewHash)throw new ApplicationError('SCOPE_DENIED','发送审阅必须来自当前项目的真实界面');this.cleanup();if(this.displays.size>=256)throw new ApplicationError('RESOURCE_BUSY','发送审阅已满，请稍后重试');
  const displayReceiptId=randomUUID();this.displays.set(displayReceiptId,{sender:sender.sender,frame:sender.senderFrame,projectId:intent.projectId,intentId:intent.id,reviewHash:intent.reviewHash,expiresAt:this.now()+600000});return{displayReceiptId,review:intent.review};
 }
 async confirm(context:ApplicationExecutionContext,sender:ApplicationUiSender,intent:MailSendIntent,input:unknown):Promise<string>{
  this.contexts.require(context,'mail.send');const parsed=confirmSchema.safeParse(input);if(!parsed.success)throw new ApplicationError('INVALID_INPUT','发送确认字段无效');const args=parsed.data,display=this.displays.get(args.displayReceiptId);
  if(this.closed||context.callerKind!=='ui'||context.action!=='ui.mail.send.authorize'||!display||display.sender!==sender.sender||display.frame!==sender.senderFrame||display.projectId!==context.projectId||display.intentId!==args.intentId||intent.id!==args.intentId||display.reviewHash!==args.expectedReviewHash||intent.reviewHash!==args.expectedReviewHash||display.expiresAt<=this.now()||!intent.review||!['awaiting-authorization','authorized'].includes(intent.state))throw new ApplicationError('AUTHORIZATION_REQUIRED','请从当前项目界面审阅本次具体邮件后确认');
  const reviewed=[...new Set(args.reviewedUnknownExecutionIds)].sort();if(canonicalJson(reviewed)!==canonicalJson(intent.review.priorUnknownExecutionIds))throw new ApplicationError('AUTHORIZATION_REQUIRED','需先核实原未知执行，再明确是否另行发送');
  const originSignal=this.contexts.assertSendOrigin(intent.projectId,intent.review.sourceTaskId,intent.review.sourceRunId);this.cleanup();if(this.actions.size>=1024)throw new ApplicationError('RESOURCE_BUSY','当前发送证据已满，请稍后重试');
  const id=randomUUID(),at=new Date(this.now()).toISOString(),provenance=canonicalJson({schema:1,kind:'renderer-confirmation',senderId:sender.sender.id,frameProcessId:sender.senderFrame?.processId,frameRoutingId:sender.senderFrame?.routingId,displayReceiptHash:digest(args.displayReceiptId),intentId:intent.id,reviewHash:intent.reviewHash,at,reviewedUnknownExecutionIds:reviewed}),sourceHash=digest(provenance);
  const value:VerifiedMailUserAction=Object.freeze({id,source:'renderer-confirmation',sourceHash,intentId:intent.id,reviewHash:intent.reviewHash!,projectId:intent.projectId,taskId:intent.review.sourceTaskId,runId:intent.review.sourceRunId,createdAt:at,expiresAt:new Date(this.now()+600000).toISOString(),reviewedUnknownExecutionIds:Object.freeze(reviewed) as unknown as string[]});
  await withResourceLock(this.contexts.store.root,()=>{this.contexts.require(context,'mail.send');if(this.closed||this.displays.get(args.displayReceiptId)!==display)throw new ApplicationError('AUTHORIZATION_REQUIRED','本次界面确认已被消费或关闭');if(originSignal?.aborted)throw new ApplicationError('SCOPE_DENIED','原发送运行已结束');this.contexts.store.sqlite.prepare('INSERT INTO mail_user_action_sources VALUES(?,?,?,?,?,?)').run(id,intent.id,value.source,sourceHash,provenance,at);this.displays.delete(args.displayReceiptId);});
  if(this.closed)throw new ApplicationError('CANCELED','发送授权服务已关闭');this.actions.set(id,{value,provenance,originSignal});return id;
 }
 allowUi(actor:MailSendActor,intent:MailSendIntent):boolean{const context=this.contexts.sendScope(actor);return context.callerKind==='ui'&&context.action==='ui.mail.send.authorize'&&context.projectId===intent.projectId;}
 verify(actor:MailSendActor,id:string,intent:MailSendIntent):VerifiedMailUserAction{
  const context=this.contexts.sendScope(actor),action=this.actions.get(id);if(this.closed||!action||action.value.intentId!==intent.id||action.value.reviewHash!==intent.reviewHash||action.value.projectId!==actor.projectId||Date.parse(action.value.expiresAt)<=this.now()||action.originSignal?.aborted)throw new ApplicationError('AUTHORIZATION_REQUIRED','没有当前有效的宿主用户授权来源');
  if(!this.allowUi(actor,intent)&&(actor.runId!==action.value.runId||actor.taskId!==action.value.taskId))throw new ApplicationError('SCOPE_DENIED','授权不属于当前真实发送运行');
  if(context.callerKind==='ui'&&context.action!=='ui.mail.send.authorize'&&(action.value.runId!==null||action.value.taskId!==null))throw new ApplicationError('SCOPE_DENIED','界面不能代替另一个Agent运行提交发送');
  const row=this.contexts.store.sqlite.prepare('SELECT * FROM mail_user_action_sources WHERE evidence_id=?').get(id) as {intent_id:string;source_kind:string;source_hash:string;provenance_json:string}|undefined;
  if(!row||row.intent_id!==intent.id||row.source_kind!==action.value.source||row.source_hash!==action.value.sourceHash||row.provenance_json!==action.provenance||digest(row.provenance_json)!==row.source_hash)throw new ApplicationError('HASH_MISMATCH','原用户授权来源记录不符');return action.value;
 }
 hasLive(intent:MailSendIntent):boolean{this.cleanup();return !this.closed&&[...this.actions.values()].some(action=>action.value.intentId===intent.id&&action.value.reviewHash===intent.reviewHash);}
 dispose(){this.closed=true;this.displays.clear();this.actions.clear();}
}
