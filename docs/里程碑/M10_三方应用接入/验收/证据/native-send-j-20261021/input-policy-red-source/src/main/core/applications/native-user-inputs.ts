import {randomUUID} from 'node:crypto';
import {ApplicationError} from '@shared/applications';
import type {ApplicationUiSender} from './execution-context';
import type {RunContext} from './run-registry';
import {canonicalJson,digest} from './manifest';
export interface NativeInputTarget {taskId:string;ptyId:string}
export interface HostUserInputReceipt {
 readonly id:string;readonly projectId:string;readonly taskId:string;readonly runId:string;readonly ptyId:string;
 readonly selectionHash:string;readonly textHash:string;readonly observedAt:number;readonly inputSequence:number;
 readonly transport:'terminal'|'launch-argument';readonly senderId:number;readonly frameProcessId:number;readonly frameRoutingId:number;
}
interface Captured {receipt:HostUserInputReceipt;text:string;signal:AbortSignal;usedBy:string|null;boundSessionId:string|null}
interface Editor {runId:string;selectionHash:string;text:string;bytes:number;escape:string;paste:boolean;known:boolean;launchCaptured:boolean;inputSequence:number;lastCr:boolean;signal:AbortSignal;detach:()=>void}
const beginPaste='\x1b[200~',endPaste='\x1b[201~',normalize=(text:string)=>text.replace(/\r\n?/g,'\n');
const selection=(context:RunContext)=>digest(canonicalJson({...context.snapshot,native:{...context.snapshot.native,sessionId:null}}));
/** RAM-only provenance of bytes actually accepted by the trusted PTY transport.
 * It grants no send permission. A caller must separately match an actual native user message
 * and resolve its concrete action/target/content before minting any authorization.
 */
export class NativeUserInputs {
 private readonly editors=new Map<string,Editor>();private readonly captured=new Map<string,Captured>();private closed=false;
 private readonly now:()=>number;private readonly maxBytes:number;private readonly maxReceipts:number;private readonly ttlMs:number;
 constructor(private readonly deps:{requireSender:(sender:ApplicationUiSender)=>void;current:(target:NativeInputTarget)=>RunContext|null;now?:()=>number;maxBytes?:number;maxReceipts?:number;ttlMs?:number}){this.now=deps.now??Date.now;this.maxBytes=deps.maxBytes??16*1024*1024;this.maxReceipts=deps.maxReceipts??256;this.ttlMs=deps.ttlMs??600000;}
 private eligible(context:RunContext):boolean{return !context.signal.aborted&&context.run.state==='active'&&context.run.projectId===context.snapshot.projectId&&context.run.taskId===context.snapshot.taskId&&context.snapshot.packages.some(pack=>pack.appId==='mail'&&pack.allowedOperations.includes('mail.send'));}
 private prune(){
  for(const[id,value]of this.captured)if(value.signal.aborted||this.now()-value.receipt.observedAt>=this.ttlMs)this.captured.delete(id);
  let editorBytes=[...this.editors.values()].reduce((n,value)=>n+value.bytes,0),bytes=[...this.captured.values()].reduce((n,value)=>n+Buffer.byteLength(value.text),0);
  for(const[id,value]of this.captured){if(this.captured.size<=this.maxReceipts&&bytes+editorBytes<=this.maxBytes)break;bytes-=Buffer.byteLength(value.text);this.captured.delete(id);}
  for(const[id,editor]of this.editors){if(editorBytes<=this.maxBytes)break;editorBytes-=editor.bytes;this.clear(id);}
 }
 private clear(target:string){const editor=this.editors.get(target);if(editor){editor.detach();this.editors.delete(target);}for(const[id,value]of this.captured)if(value.receipt.ptyId===target)this.captured.delete(id);}
 observe(sender:ApplicationUiSender,target:NativeInputTarget,data:string):void{
  this.deps.requireSender(sender);if(this.closed||typeof data!=='string')return;if(Buffer.byteLength(data)>1024*1024){this.clear(target.ptyId);return;}const context=this.deps.current(target);if(!context||!this.eligible(context)){this.clear(target.ptyId);return;}
  const stamp=selection(context);let editor=this.editors.get(target.ptyId);
  if(editor&&(editor.runId!==context.run.runId||editor.selectionHash!==stamp)){this.clear(target.ptyId);editor=undefined;}
  if(!editor){if(this.editors.size>=128)return;const remove=()=>this.clear(target.ptyId);editor={runId:context.run.runId,selectionHash:stamp,text:'',bytes:0,escape:'',paste:false,known:true,launchCaptured:false,inputSequence:0,lastCr:false,signal:context.signal,detach:()=>context.signal.removeEventListener('abort',remove)};this.editors.set(target.ptyId,editor);context.signal.addEventListener('abort',remove,{once:true});}
  const completed:{text:string;sequence:number}[]=[];let next=0;
  for(const character of data){
   if(editor.escape){editor.escape+=character;const expected=editor.paste?endPaste:beginPaste;if(expected.startsWith(editor.escape)){if(editor.escape===expected){editor.paste=!editor.paste;editor.escape='';editor.lastCr=false;}continue;}
    // Unknown cursor/history/terminal protocol means we cannot reconstruct the accepted line.
    editor.escape='';editor.known=false;continue;
   }
   if(character==='\x1b'){editor.escape=character;continue;}
   if(editor.paste){if(character==='\r'){this.append(editor,'\n');editor.lastCr=true;}else if(character==='\n'&&editor.lastCr)editor.lastCr=false;else{this.append(editor,character);editor.lastCr=false;}}
   else if(character==='\r'||character==='\n'){
    if(character==='\n'&&editor.lastCr){editor.lastCr=false;continue;}
    if(!editor.known||editor.text.trim())editor.inputSequence++;
    if(editor.known&&editor.text.trim()){completed[next]={text:editor.text,sequence:editor.inputSequence};next=(next+1)%this.maxReceipts;}
    editor.text='';editor.bytes=0;editor.escape='';editor.known=true;editor.lastCr=character==='\r';
   }else{
    editor.lastCr=false;
    if(character==='\x03'){editor.inputSequence++;editor.text='';editor.bytes=0;editor.known=true;}
    else if(character==='\x15'){editor.text='';editor.bytes=0;editor.known=true;}
    else if(character==='\x7f'||character==='\b'){const cut=editor.text.length>=2&&/[\uD800-\uDBFF]/.test(editor.text.at(-2)!)&&/[\uDC00-\uDFFF]/.test(editor.text.at(-1)!)?2:1;editor.bytes-=Buffer.byteLength(editor.text.slice(-cut));editor.text=editor.text.slice(0,-cut);}
    else if(character==='\x17'){editor.text=editor.text.replace(/\S+\s*$/u,'');editor.bytes=Buffer.byteLength(editor.text);}
    else if(/[\x00-\x1f\x7f-\x9f]/.test(character))editor.known=false;
    else this.append(editor,character);
   }
   if(editor.bytes>1024*1024){editor.text='';editor.bytes=0;editor.known=false;}
  }
  const first=completed.length===this.maxReceipts?next:0;for(let index=0;index<completed.length;index++){const entry=completed[(first+index)%completed.length];this.capture(sender,target,context,entry.text,stamp,'terminal',entry.sequence);this.prune();}
  this.prune();
 }
 /** Called only after the host passes this exact argument to its owned, active process. */
 observeLaunch(sender:ApplicationUiSender,target:NativeInputTarget,text:string):void{
  this.deps.requireSender(sender);if(this.closed||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>1024*1024)return;
  this.observe(sender,target,'');const editor=this.editors.get(target.ptyId),context=this.deps.current(target);
  if(!editor||editor.launchCaptured||!context||!this.eligible(context)||editor.runId!==context.run.runId||editor.selectionHash!==selection(context))return;
  editor.launchCaptured=true;this.capture(sender,target,context,text,editor.selectionHash,'launch-argument',0);this.prune();
 }
 /** A partial native controlled write makes this editable line unprovable until reset/submission. */
 uncertain(sender:ApplicationUiSender,target:NativeInputTarget):void{this.observe(sender,target,'');const editor=this.editors.get(target.ptyId);if(editor){editor.inputSequence++;editor.text='';editor.bytes=0;editor.escape='';editor.paste=false;editor.known=false;}}
 private append(editor:Editor,text:string){const joinedSurrogate=/[\uD800-\uDBFF]/.test(editor.text.at(-1)??'')&&/[\uDC00-\uDFFF]/.test(text[0]??'');editor.bytes+=Buffer.byteLength(text)-(joinedSurrogate?2:0);editor.text+=text;}
 private capture(sender:ApplicationUiSender,target:NativeInputTarget,context:RunContext,text:string,stamp:string,transport:HostUserInputReceipt['transport']='terminal',inputSequence=0){
  const frame=sender.senderFrame;if(!frame||!Number.isSafeInteger(frame.processId)||!Number.isSafeInteger(frame.routingId))return;
  const normalized=normalize(text);if(Buffer.byteLength(normalized)>this.maxBytes)return;
  const receipt=Object.freeze({id:randomUUID(),projectId:context.run.projectId,taskId:context.run.taskId,runId:context.run.runId,ptyId:target.ptyId,selectionHash:stamp,textHash:digest(normalized),observedAt:this.now(),inputSequence,transport,senderId:sender.sender.id,frameProcessId:frame.processId,frameRoutingId:frame.routingId});
  this.captured.set(receipt.id,{receipt,text:normalized,signal:context.signal,usedBy:null,boundSessionId:context.snapshot.native.sessionId});
 }
 /** Exact text/time matching is origin evidence only, never a semantic approval decision. */
 match(context:RunContext,text:string,nativeTimestamp:number):HostUserInputReceipt|null{
  this.prune();if(this.closed||!this.eligible(context)||!context.snapshot.native.sessionId||typeof text!=='string'||!Number.isFinite(nativeTimestamp)||nativeTimestamp>this.now()+5000)return null;
  const normalized=normalize(text),hash=digest(normalized);
  const candidates=[...this.captured.values()].reverse().filter(value=>(value.boundSessionId===null||value.boundSessionId===context.snapshot.native.sessionId)&&value.receipt.runId===context.run.runId&&value.receipt.taskId===context.run.taskId&&value.receipt.projectId===context.run.projectId&&value.receipt.textHash===hash&&value.text===normalized&&nativeTimestamp>=value.receipt.observedAt-5000&&nativeTimestamp<=value.receipt.observedAt+120000);if(!candidates.length)return null;const stamp=selection(context),matched=candidates.find(value=>value.receipt.selectionHash===stamp);if(!matched)return null;matched.boundSessionId=context.snapshot.native.sessionId;return matched.receipt;
 }
 /** Pure RAM guard: safe inside the send authorization transaction, with no process/filesystem IO. */
 isLatest(receipt:HostUserInputReceipt):boolean{
  this.prune();const value=this.captured.get(receipt.id),editor=this.editors.get(receipt.ptyId);
  return !this.closed&&value?.receipt===receipt&&!value.signal.aborted&&value.boundSessionId!==null&&!!editor&&!editor.signal.aborted&&editor.runId===receipt.runId&&editor.selectionHash===receipt.selectionHash&&editor.inputSequence===receipt.inputSequence;
 }
 claim(receipt:HostUserInputReceipt,context:RunContext,intentId:string):void{
  this.prune();const value=this.captured.get(receipt.id);
  if(this.closed||!this.eligible(context)||!value||value.receipt!==receipt||!context.snapshot.native.sessionId||value.boundSessionId!==context.snapshot.native.sessionId||receipt.runId!==context.run.runId||receipt.projectId!==context.run.projectId||receipt.taskId!==context.run.taskId||receipt.selectionHash!==selection(context)||value.usedBy&&value.usedBy!==intentId)throw new ApplicationError('AUTHORIZATION_REQUIRED','本次原生用户输入来源已失效或用于其他意图');value.usedBy=intentId;
 }
 dispose(){this.closed=true;for(const id of [...this.editors.keys()])this.clear(id);this.captured.clear();}
}
