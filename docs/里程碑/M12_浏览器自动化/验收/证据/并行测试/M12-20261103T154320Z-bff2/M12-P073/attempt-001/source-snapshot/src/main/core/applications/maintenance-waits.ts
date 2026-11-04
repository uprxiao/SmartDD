import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import type {CoordinatorLockOptions} from './coordinator-lock';

export interface CleanupWaitControl {
 readonly signal:AbortSignal;
 lockOptions():CoordinatorLockOptions;
 onExecuting():void;
}
export interface MaintenanceWaitOwner {
 readonly id:number;
 isDestroyed():boolean;
 once(event:'destroyed',listener:()=>void):unknown;
 removeListener(event:'destroyed',listener:()=>void):unknown;
}
interface Waiting {owner:MaintenanceWaitOwner;controller:AbortController;phase:'waiting'|'executing';settled:Promise<void>}
/** Request identity only, never an authorization token. The trusted IPC caller
 * owns its wait; existing plan and immutable-resource checks still authorize work. */
export class MaintenanceWaits {
 private readonly pending=new Map<string,Waiting>();
 private closed=false;
 async run<T>(owner:MaintenanceWaitOwner,token:string,work:(control:CleanupWaitControl)=>Promise<T>,notify?:(phase:'waiting'|'executing')=>void):Promise<T>{
  z.uuid().parse(token);
  if(this.closed||owner.isDestroyed())throw new ApplicationError('CANCELED','维护等待已关闭');
  if(this.pending.has(token)||this.pending.size>=16)throw new ApplicationError('RESOURCE_BUSY','已有维护请求尚未结束');
  const record:Waiting={owner,controller:new AbortController(),phase:'waiting',settled:Promise.resolve()},deadline=performance.now()+15000;
  const check=()=>{if(record.controller.signal.aborted)throw new ApplicationError('CANCELED','已取消本次维护等待');if(performance.now()>=deadline)throw new ApplicationError('RESOURCE_BUSY','等待资源操作结束超时，请重新检查后重试');};
  const progress=(phase:'waiting'|'executing')=>{if(!owner.isDestroyed())try{notify?.(phase);}catch{/* Display delivery cannot cancel or change the original cleanup. */}};
  const control:CleanupWaitControl={signal:record.controller.signal,lockOptions:()=>{check();return{signal:record.controller.signal,timeoutMs:Math.max(1,deadline-performance.now())};},onExecuting:()=>{check();if(record.phase!=='executing'){record.phase='executing';progress('executing');}}};
  const destroyed=()=>{if(record.phase==='waiting')record.controller.abort();};
  this.pending.set(token,record);owner.once('destroyed',destroyed);progress('waiting');
  const execution=(async()=>{try{return await work(control);}finally{owner.removeListener('destroyed',destroyed);if(this.pending.get(token)===record)this.pending.delete(token);}})();
  record.settled=execution.then(()=>undefined,()=>undefined);return execution;
 }
 cancel(owner:MaintenanceWaitOwner,token:string):{canceled:boolean}{
  z.uuid().parse(token);const record=this.pending.get(token);if(!record)return{canceled:false};
  if(record.owner!==owner)throw new ApplicationError('SCOPE_DENIED','不能取消其他窗口的维护等待');
  if(record.phase!=='waiting')return{canceled:false};record.controller.abort();return{canceled:true};
 }
 async dispose():Promise<void>{this.closed=true;const records=[...this.pending.values()];for(const record of records)if(record.phase==='waiting')record.controller.abort();await Promise.all(records.map(record=>record.settled));}
}
