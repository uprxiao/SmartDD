import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import {applicationTerminalBindSchema,applicationTerminalInsertSchema,type ApplicationTerminalBind,type ApplicationTerminalBinding,type ApplicationTerminalInsert} from '@shared/application-terminal';
import {sanitizeTerminalText,terminalBodyData,TERMINAL_CONTEXT_LIMITS,type TerminalInsertionReceipt} from '@shared/file-terminal';
import type {ApplicationUiSender} from './execution-context';
export interface ApplicationTerminalProof {text:string;runId:string;assert():void;inspect():Promise<void>}
interface Binding {value:ApplicationTerminalBinding;sender:ApplicationUiSender;proof:ApplicationTerminalProof;cancelled:boolean;operation?:{id:string;result:Promise<TerminalInsertionReceipt>}}
/** One opaque, sender-owned delivery. Accepted editable bytes are observed separately; a paste never grants authorization. */
export class ApplicationTerminalInsertion {
 private readonly bindings=new Map<NonNullable<ApplicationUiSender['senderFrame']>,Binding>();
 private readonly epochs=new WeakMap<NonNullable<ApplicationUiSender['senderFrame']>,object>();
 private closed=false;
 constructor(private readonly deps:{authorize(sender:ApplicationUiSender,target:{taskId:string;ptyId:string}):void;requireSender(sender:ApplicationUiSender):void;resolve(sender:ApplicationUiSender,input:ApplicationTerminalBind):Promise<ApplicationTerminalProof>;bracketedPaste(ptyId:string):Promise<boolean>;write(ptyId:string,data:string):void;observed?(sender:ApplicationUiSender,target:{taskId:string;ptyId:string},data:string):void;uncertain?(sender:ApplicationUiSender,target:{taskId:string;ptyId:string}):void;now?:()=>number}){}
 private now(){return this.deps.now?.()??Date.now();}
 private owner(sender:ApplicationUiSender){this.deps.requireSender(sender);if(this.closed||!sender.senderFrame)throw new ApplicationError('SCOPE_DENIED','终端插入服务或窗口已失效');return sender.senderFrame;}
 private require(sender:ApplicationUiSender,id:string):Binding{const b=this.bindings.get(this.owner(sender));if(!b||b.cancelled||b.value.id!==id||b.value.expiresAt<=this.now())throw new ApplicationError('CANCELED','原终端投递已失效，请重新选择');this.deps.authorize(sender,b.value);b.proof.assert();return b;}
 async bind(sender:ApplicationUiSender,raw:ApplicationTerminalBind):Promise<ApplicationTerminalBinding>{
  const input=applicationTerminalBindSchema.parse(raw),owner=this.owner(sender),epoch={};this.epochs.set(owner,epoch);const old=this.bindings.get(owner);if(old)old.cancelled=true;this.bindings.delete(owner);
  for(const [key,b] of this.bindings)if(b.value.expiresAt<=this.now()||b.sender.sender.isDestroyed()){b.cancelled=true;this.bindings.delete(key);}
  if(this.bindings.size>=32)throw new ApplicationError('RESOURCE_BUSY','终端投递窗口过多');this.deps.authorize(sender,input.target);
  const proof=await this.deps.resolve(sender,input);if(this.epochs.get(owner)!==epoch||this.closed)throw new ApplicationError('CANCELED','目标已切换，未创建旧投递');this.owner(sender);this.deps.authorize(sender,input.target);proof.assert();
  const clean=sanitizeTerminalText(proof.text);if(!clean.text.trim()||clean.text.length>TERMINAL_CONTEXT_LIMITS.total)throw new ApplicationError('TOO_LARGE','引用超过安全插入范围');
  const value={id:randomUUID(),...input.target,projectId:input.projectId,runId:proof.runId,text:clean.text,expiresAt:this.now()+120000};this.bindings.set(owner,{value,sender,proof,cancelled:false});return {...value};
 }
 release(sender:ApplicationUiSender,id:string):void{const owner=this.owner(sender),b=this.bindings.get(owner);if(b?.value.id===id){b.cancelled=true;this.bindings.delete(owner);this.epochs.set(owner,{});}}
 insert(sender:ApplicationUiSender,raw:ApplicationTerminalInsert):Promise<TerminalInsertionReceipt>{const input=applicationTerminalInsertSchema.parse(raw),b=this.require(sender,input.bindingId);if(b.operation){if(b.operation.id!==input.operationId)throw new ApplicationError('RESOURCE_STATE_CHANGED','本次引用已经投递，不自动重复插入');return b.operation.result;}const result=this.deliver(sender,b,input);b.operation={id:input.operationId,result};return result;}
 private async deliver(sender:ApplicationUiSender,b:Binding,input:ApplicationTerminalInsert):Promise<TerminalInsertionReceipt>{let started=false;try{
  await b.proof.inspect();this.require(sender,b.value.id);const bracketed=await this.deps.bracketedPaste(b.value.ptyId),data=terminalBodyData(b.value.text,bracketed);this.require(sender,b.value.id);
  started=true;this.deps.write(b.value.ptyId,data);try{this.deps.observed?.(sender,b.value,data);}catch{/* observation cannot duplicate accepted bytes */}return{operationId:input.operationId,state:'inserted',characters:b.value.text.length,removed:0,replaced:0,truncated:0,stale:[],bracketed};
 }catch(error){if(started)try{this.deps.uncertain?.(sender,b.value);}catch{/* no transport retry */}return{operationId:input.operationId,state:started?'unknown':'failed',message:started?'插入结果未知；不会自动重发':error instanceof Error?error.message:'引用未插入'};}}
 dispose(){this.closed=true;for(const b of this.bindings.values())b.cancelled=true;this.bindings.clear();}
}
