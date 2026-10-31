import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { MailSendActor,MailSendIntent,MailSendReview,VerifiedMailUserAction } from '@shared/mail-execution';
import { ApplicationExecutionContexts,type ApplicationExecutionContext,type ApplicationUiSender } from './execution-context';
import { canonicalJson,digest } from './manifest';
import { withResourceLock } from './resource-lock';
import {NativeUserMessages,type NativeUserMessage} from './native-user-messages';
import {resolveReferencedMailSend,resolveContextualMailSend,nativeMailConnectionHash} from './native-mail-intent';
const confirmSchema=z.object({intentId:z.uuid(),expectedReviewHash:z.string().regex(/^[a-f0-9]{64}$/),displayReceiptId:z.uuid(),reviewedUnknownExecutionIds:z.array(z.uuid()).max(100).default([])}).strict();
interface Display {sender:ApplicationUiSender['sender'];frame:ApplicationUiSender['senderFrame'];projectId:string;intentId:string;reviewHash:string;expiresAt:number}
interface Action {value:VerifiedMailUserAction;provenance:string;originSignal:AbortSignal|null;native?:NativeUserMessage;nativeContext?:readonly NativeUserMessage[]}
/** Only host-observed sources mint authority. Persistent provenance alone is never a live grant. */
export class MailUserAuthorizations {
 private readonly displays=new Map<string,Display>();private readonly actions=new Map<string,Action>();private closed=false;private nativeSources?:NativeUserMessages;private nativePolicyHash?:(projectId:string)=>string|null;
 constructor(private readonly contexts:ApplicationExecutionContexts,private readonly now=Date.now){}
 attachNative(sources:NativeUserMessages,policyHash:(projectId:string)=>string|null):void{if(this.nativeSources&&this.nativeSources!==sources)throw new ApplicationError('RESOURCE_STATE_CHANGED','原生用户来源服务已经固定');this.nativeSources=sources;this.nativePolicyHash=policyHash;}
 private cleanup(){for(const [id,value] of this.displays)if(value.expiresAt<=this.now())this.displays.delete(id);for(const [id,value] of this.actions)if(Date.parse(value.value.expiresAt)<=this.now()||value.originSignal?.aborted||value.native&&!this.nativeActionLive(value))this.actions.delete(id);}
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
 /** The source guard is RAM-only; this policy stamp uses only local SQLite, including in C. */
 private nativeLive(message:NativeUserMessage):boolean{
  if(!this.nativeSources?.isLive(message)||!message.receipt.mailSendScope)return false;
  try{return this.nativePolicyHash?.(message.receipt.projectId)===message.receipt.mailSendScope.policyHash;}catch{return false;}
 }
 private contextLive(message:NativeUserMessage,previous:NativeUserMessage):boolean{
  const a=message.receipt,b=previous.receipt,scope=a.mailSendScope,prior=b.mailSendScope;
  return !!this.nativeSources?.isRetained(previous)&&this.nativeLive(message)&&!!scope&&!!prior&&scope.connectionHash===prior.connectionHash&&scope.policyHash===prior.policyHash&&a.inputSequence===b.inputSequence+1&&a.projectId===b.projectId&&a.taskId===b.taskId&&a.runId===b.runId&&a.ptyId===b.ptyId&&a.selectionHash===b.selectionHash&&message.nativeSessionId===previous.nativeSessionId&&message.runner===previous.runner&&message.cliVersion===previous.cliVersion&&previous.timestamp<=message.timestamp;
 }
 private nativeActionLive(action:Action):boolean{return !!action.native&&this.nativeLive(action.native)&&(action.nativeContext??[]).every(value=>this.contextLive(action.native!,value));}
 private async verifyNativeAction(action:Action):Promise<boolean>{
  const sources=this.nativeSources;if(!sources||!action.native||!this.nativeActionLive(action))return false;
  for(const value of [...action.nativeContext??[],action.native])if(!await sources.verify(value))return false;
  return this.nativeActionLive(action);
 }
 private activeNative(intent:MailSendIntent):string|null{
  const row=this.contexts.store.sqlite.prepare("SELECT g.evidence_id,g.source FROM mail_send_intents i JOIN mail_send_grants g ON g.id=i.grant_id WHERE i.id=? AND i.project_id=? AND g.state='active'").get(intent.id,intent.projectId) as {evidence_id:string;source:string}|undefined;
  return row?.source==='native-user-message'?row.evidence_id:null;
 }
 needsNativeRefresh(intent:MailSendIntent):boolean{return this.activeNative(intent)!==null;}
 async tryNative(context:ApplicationExecutionContext,intent:MailSendIntent):Promise<string|null>{
  this.contexts.require(context,'mail.send');this.cleanup();const sources=this.nativeSources,review=intent.review;
  if(this.closed||!sources||context.callerKind!=='agent-run'||!context.runId||!review||!intent.reviewHash||intent.executionId||!['awaiting-authorization','authorized'].includes(intent.state)||review.sourceRunId!==context.runId||review.sourceTaskId!==context.taskId||review.projectId!==context.projectId)return null;
  const old=[...this.actions.values()].find(action=>action.native&&action.value.intentId===intent.id&&action.value.reviewHash===intent.reviewHash);
  if(old?.native&&await this.verifyNativeAction(old)){this.contexts.require(context,'mail.send');return old.value.id;}
  const observed=await sources.read(context.runId);this.contexts.require(context,'mail.send');
  const message=observed.messages.find(value=>this.nativeLive(value));if(!message||message.receipt.mailSendScope?.connectionHash!==nativeMailConnectionHash(review))return null;
  let resolved:ReturnType<typeof resolveReferencedMailSend>|ReturnType<typeof resolveContextualMailSend>=resolveReferencedMailSend(message.text,review);let nativeContext:readonly NativeUserMessage[]=[];
  if(!resolved&&!message.text.includes('mail-draft://')){
   const previous=observed.messages.find(value=>this.contextLive(message,value));
   if(previous){resolved=resolveContextualMailSend(message.text,previous.text,review);if(resolved)nativeContext=Object.freeze([previous]);}
  }
  if(!resolved)return null;
  for(const value of nativeContext)if(!await sources.verify(value)||!this.contextLive(message,value))return null;
  await sources.claim(message,intent.id);this.contexts.require(context,'mail.send');
  const originSignal=this.contexts.assertSendOrigin(intent.projectId,review.sourceTaskId,review.sourceRunId);if(!originSignal||originSignal.aborted||!this.nativeLive(message)||nativeContext.some(value=>!this.contextLive(message,value)))return null;
  const at=new Date(message.receipt.observedAt).toISOString(),id='native-'+digest(canonicalJson({receiptId:message.receipt.id,intentId:intent.id,reviewHash:intent.reviewHash})),provenance=canonicalJson({schema:1,kind:'native-user-message',intentId:intent.id,reviewHash:intent.reviewHash,projectId:intent.projectId,taskId:context.taskId,runId:context.runId,nativeSessionId:message.nativeSessionId,runner:message.runner,cliVersion:message.cliVersion,nativeRecordHash:message.recordHash,nativeTimestamp:message.timestamp,inputReceipt:message.receipt,contextSources:nativeContext.map(value=>({nativeRecordHash:value.recordHash,nativeTimestamp:value.timestamp,inputReceipt:value.receipt})),action:resolved,at}),sourceHash=digest(provenance);
  const value:VerifiedMailUserAction=Object.freeze({id,source:'native-user-message',sourceHash,intentId:intent.id,reviewHash:intent.reviewHash,projectId:intent.projectId,taskId:review.sourceTaskId,runId:review.sourceRunId,createdAt:at,expiresAt:new Date(Math.min(message.receipt.observedAt,...nativeContext.map(value=>value.receipt.observedAt))+600000).toISOString(),reviewedUnknownExecutionIds:Object.freeze([]) as unknown as string[]});
  await withResourceLock(this.contexts.store.root,()=>{
   this.contexts.require(context,'mail.send');this.cleanup();if(this.closed||originSignal.aborted||!this.nativeLive(message)||nativeContext.some(value=>!this.contextLive(message,value))||Date.parse(value.expiresAt)<=this.now())throw new ApplicationError('AUTHORIZATION_REQUIRED','本次原生具体指令已失效');
   if(!this.actions.has(id)&&this.actions.size>=1024)throw new ApplicationError('RESOURCE_BUSY','当前发送证据已满');
   const row=this.contexts.store.sqlite.prepare('SELECT intent_id,source_kind,source_hash,provenance_json FROM mail_user_action_sources WHERE evidence_id=?').get(id) as {intent_id:string;source_kind:string;source_hash:string;provenance_json:string}|undefined;
   if(row&&(row.intent_id!==intent.id||row.source_kind!==value.source||row.source_hash!==sourceHash||row.provenance_json!==provenance))throw new ApplicationError('HASH_MISMATCH','同一原生用户来源已有不同记录');
   if(!row)this.contexts.store.sqlite.prepare('INSERT INTO mail_user_action_sources VALUES(?,?,?,?,?,?)').run(id,intent.id,value.source,sourceHash,provenance,at);
   this.actions.set(id,{value,provenance,originSignal,native:message,nativeContext});
  });return id;
 }
 async revalidateNative(context:ApplicationExecutionContext,intent:MailSendIntent):Promise<void>{
  const id=this.activeNative(intent);if(!id)return;
  const action=this.actions.get(id),sources=this.nativeSources;
  if(!sources||!action?.native||!await this.verifyNativeAction(action))throw new ApplicationError('AUTHORIZATION_REQUIRED','原生指令或所引用的用户上下文已变化，请核对本次冻结邮件');
  this.contexts.require(context,'mail.send');if(!this.nativeActionLive(action))throw new ApplicationError('AUTHORIZATION_REQUIRED','原生指令或上下文已被新的输入或取消替代');
 }
 allowUi(actor:MailSendActor,intent:MailSendIntent):boolean{const context=this.contexts.sendScope(actor);return context.callerKind==='ui'&&context.action==='ui.mail.send.authorize'&&context.projectId===intent.projectId;}
 verify(actor:MailSendActor,id:string,intent:MailSendIntent):VerifiedMailUserAction{
  const context=this.contexts.sendScope(actor),action=this.actions.get(id);if(this.closed||!action||action.value.intentId!==intent.id||action.value.reviewHash!==intent.reviewHash||action.value.projectId!==actor.projectId||Date.parse(action.value.expiresAt)<=this.now()||action.originSignal?.aborted||action.native&&!this.nativeActionLive(action))throw new ApplicationError('AUTHORIZATION_REQUIRED','没有当前有效的宿主用户授权来源');
  if(!this.allowUi(actor,intent)&&(actor.runId!==action.value.runId||actor.taskId!==action.value.taskId))throw new ApplicationError('SCOPE_DENIED','授权不属于当前真实发送运行');
  if(context.callerKind==='ui'&&context.action!=='ui.mail.send.authorize'&&(action.value.runId!==null||action.value.taskId!==null))throw new ApplicationError('SCOPE_DENIED','界面不能代替另一个Agent运行提交发送');
  const row=this.contexts.store.sqlite.prepare('SELECT * FROM mail_user_action_sources WHERE evidence_id=?').get(id) as {intent_id:string;source_kind:string;source_hash:string;provenance_json:string}|undefined;
  if(!row||row.intent_id!==intent.id||row.source_kind!==action.value.source||row.source_hash!==action.value.sourceHash||row.provenance_json!==action.provenance||digest(row.provenance_json)!==row.source_hash)throw new ApplicationError('HASH_MISMATCH','原用户授权来源记录不符');return action.value;
 }
 /** Main-only invalidation notification; stored evidence alone is never made live again. */
 reconcileSources():boolean{const before=this.actions.size;this.cleanup();return this.actions.size!==before;}
 hasLive(intent:MailSendIntent):boolean{this.cleanup();return !this.closed&&[...this.actions.values()].some(action=>action.value.intentId===intent.id&&action.value.reviewHash===intent.reviewHash);}
 dispose(){this.closed=true;this.displays.clear();this.actions.clear();}
}
