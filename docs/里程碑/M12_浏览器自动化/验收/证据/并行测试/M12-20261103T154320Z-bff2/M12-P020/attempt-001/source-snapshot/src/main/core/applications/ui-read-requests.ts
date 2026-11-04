import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {ApplicationUiSender} from './execution-context';

interface Reading {sender:ApplicationUiSender;controller:AbortController}
type Owner=ApplicationUiSender['sender'];
/** A request ID identifies an own-window read, never grants data access. */
export class ApplicationUiReads {
 private readonly pending=new Map<string,Reading>();
 private readonly owners=new Map<Owner,{destroyed:()=>void;navigated:(_event:unknown,_url:string,_inPlace:boolean,main:boolean)=>void}>();
 private closed=false;
 private current(sender:ApplicationUiSender){if(sender.sender.isDestroyed()||sender.senderFrame!==sender.sender.mainFrame)throw new ApplicationError('SCOPE_DENIED','读取请求不属于当前主窗口');}
 async run<T>(sender:ApplicationUiSender,id:string,work:(signal:AbortSignal)=>Promise<T>):Promise<T>{
  z.uuid().parse(id);this.current(sender);
  if(this.closed)throw new ApplicationError('CANCELED','页面读取已关闭');
  if(this.pending.has(id)||this.pending.size>=64||[...this.pending.values()].filter(r=>r.sender.sender===sender.sender).length>=16)throw new ApplicationError('RESOURCE_BUSY','已有页面读取尚未结束');
  const record:Reading={sender:{sender:sender.sender,senderFrame:sender.senderFrame},controller:new AbortController()};this.pending.set(id,record);
  if(!this.owners.has(sender.sender)){
   const abort=()=>{for(const r of this.pending.values())if(r.sender.sender===sender.sender)r.controller.abort();};
   const navigated=(_event:unknown,_url:string,_inPlace:boolean,main:boolean)=>{if(main)abort();};
   this.owners.set(sender.sender,{destroyed:abort,navigated});sender.sender.once('destroyed',abort);sender.sender.on('did-start-navigation',navigated);
  }
  try{const value=await work(record.controller.signal);if(record.controller.signal.aborted)throw new ApplicationError('CANCELED','本次页面读取已取消交付');return value;}
  finally{if(this.pending.get(id)===record)this.pending.delete(id);if(![...this.pending.values()].some(r=>r.sender.sender===sender.sender))this.unwatch(sender.sender);}
 }
 cancel(sender:ApplicationUiSender,id:string):{canceled:boolean}{
  z.uuid().parse(id);this.current(sender);const record=this.pending.get(id);if(!record)return{canceled:false};
  if(record.sender.sender!==sender.sender||record.sender.senderFrame!==sender.senderFrame)throw new ApplicationError('SCOPE_DENIED','不能取消其他窗口或原文档的读取');
  if(record.controller.signal.aborted)return{canceled:false};record.controller.abort();return{canceled:true};
 }
 private unwatch(owner:Owner){const watch=this.owners.get(owner);if(!watch)return;owner.removeListener('destroyed',watch.destroyed);owner.removeListener('did-start-navigation',watch.navigated);this.owners.delete(owner);}
 dispose(){this.closed=true;for(const record of this.pending.values())record.controller.abort();this.pending.clear();for(const owner of this.owners.keys())this.unwatch(owner);}
}
