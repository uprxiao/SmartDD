import {realpathSync} from 'node:fs';
import type {Socket} from 'node:net';
import {ApplicationError} from '@shared/applications';
import type {ProcessIdentity,ProcessIdentityReader} from './process-identity';
import type {UnixPeerIdentityReader} from './unix-peer-identity';
import type {CapabilityRunRegistry,OwnedRunProcess} from './run-registry';
interface Tracked {runId:string;handle:OwnedRunProcess;identity:ProcessIdentity;detach:()=>void;state:'active'|'unknown';exiting?:Promise<void>}
/** Agent-spawned bridges are owned only after kernel peer + executable + CLI ancestry proof.
 * Socket closure is not an exit event. Unknown identity retains its registry lease.
 */
export class AgentBridgeProcesses {
 private readonly tracked=new Map<string,Tracked>();private readonly pending=new Set<Promise<void>>();private closed=false;private closing?:Promise<void>;private polling=false;private readonly timer:ReturnType<typeof setInterval>;
 constructor(private readonly runs:CapabilityRunRegistry,private readonly peers:UnixPeerIdentityReader,private readonly processes:ProcessIdentityReader,private readonly options:{pollMs?:number;waitForCliMs?:number;signal?:(identity:ProcessIdentity)=>void;disposeWaitMs?:number}={}){this.timer=setInterval(()=>{void this.poll();},Math.max(20,options.pollMs??500));this.timer.unref();}
 attach(socket:Socket,runId:string,handle:OwnedRunProcess):Promise<void>{const work=this.attachOnce(socket,runId,handle);this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work;}
 private async attachOnce(socket:Socket,runId:string,handle:OwnedRunProcess):Promise<void>{
  if(this.closed)throw new ApplicationError('CANCELED','桥进程监督已停止');const deadline=performance.now()+Math.max(1,Math.min(2000,this.options.waitForCliMs??1500));let context=this.runs.bridgePreparation(runId);
  while(context.run.state==='prepared'&&performance.now()<deadline&&!context.signal.aborted&&!socket.destroyed&&!this.closed){await new Promise<void>(done=>setTimeout(done,10));context=this.runs.bridgePreparation(runId);}
  if(this.closed||socket.destroyed||context.run.state!=='active'||context.signal.aborted||context.run.pid===null||context.run.processStartedAt===null)throw new ApplicationError('SCOPE_DENIED','原生CLI尚未确认启动或本次运行已停止');
  const proof=await this.peers.read(socket),latest=this.runs.get(runId);if(latest.pid!==context.run.pid||latest.processStartedAt!==context.run.processStartedAt)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生CLI启动身份已改变');let expected:string;try{expected=realpathSync(process.execPath);}catch{throw new ApplicationError('HOST_INCOMPATIBLE','无法核验当前桥执行器');}
  let actualImage:string|null=null;try{if(proof)actualImage=realpathSync(proof.peer.executable);}catch{/* The original image must still be verifiable. */}
  if(!proof)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验本次桥进程身份，保留启动窗口与占用');
  if(proof.peer.pid===context.run.pid||actualImage!==expected||!proof.ancestors.some(item=>item.pid===context.run.pid&&item.startedAt===context.run.processStartedAt))throw new ApplicationError('SCOPE_DENIED','连接进程不是本次CLI的受管桥');
  const identity={pid:proof.peer.pid,startedAt:proof.peer.startedAt},old=this.tracked.get(handle.processId);
  if(old&&(old.runId!==runId||old.identity.pid!==identity.pid||old.identity.startedAt!==identity.startedAt))throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原桥进程身份不能替换');
  try{await handle.attach(identity.pid,identity.startedAt);}catch(error){
    // A proved peer can exit between the socket probe and attach. Never adopt a
    // reused PID. Only a confirmed stopped original identity may finalize it.
    const current=this.runs.store.sqlite.prepare('SELECT pid,process_started_at FROM capability_run_processes WHERE process_id=? AND run_id=?').get(handle.processId,runId) as {pid:number|null;process_started_at:string|null}|undefined;
    if(error instanceof ApplicationError&&error.code==='RESOURCE_RECOVERY_REQUIRED'&&current&&(current.pid===null||current.pid===identity.pid&&current.process_started_at===identity.startedAt)&&this.processes.state(identity)==='stopped')await handle.exited();throw error;
  }const row=this.runs.store.sqlite.prepare('SELECT pid,process_started_at FROM capability_run_processes WHERE process_id=? AND run_id=?').get(handle.processId,runId) as {pid:number;process_started_at:string}|undefined;
  if(!row||row.pid!==identity.pid||row.process_started_at!==identity.startedAt)throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','桥实际启动身份发生变化');
  if(!old){const aborted=()=>this.signal(identity),entry:Tracked={runId,handle,identity,detach:()=>context.signal.removeEventListener('abort',aborted),state:'active'};this.tracked.set(handle.processId,entry);context.signal.addEventListener('abort',aborted,{once:true});if(context.signal.aborted||this.closed||socket.destroyed)this.signal(identity);}
  if(this.closed||socket.destroyed||context.signal.aborted)throw new ApplicationError('CANCELED','桥启动核验已取消');this.runs.assertBridge(runId,handle.processId);
 }
 private signal(identity:ProcessIdentity):void{if(this.processes.state(identity)!=='running')return;try{if(this.options.signal)this.options.signal(identity);else process.kill(identity.pid,'SIGTERM');}catch{/* Recheck actual identity later,never infer exit from signalling. */}}
 revokeRun(runId:string):void{for(const entry of this.tracked.values())if(entry.runId===runId)this.signal(entry.identity);}
 poll():Promise<void>{return this.sweep(false);}
 private async sweep(allowClosed:boolean):Promise<void>{
  if(this.closed&&!allowClosed||this.polling)return;this.polling=true;
  try{for(const[id,entry]of this.tracked){if(this.closed&&!allowClosed)break;if(entry.exiting)continue;const state=this.processes.state(entry.identity);if(state!=='stopped'){entry.state=state==='unknown'?'unknown':'active';continue;}
   const work=entry.handle.exited();entry.exiting=work;this.pending.add(work);try{await work;entry.detach();if(this.tracked.get(id)===entry)this.tracked.delete(id);}catch{entry.exiting=undefined;entry.state='unknown';}finally{this.pending.delete(work);}
  }}finally{this.polling=false;}
 }
 status(){return[...this.tracked.values()].map(entry=>({runId:entry.runId,processId:entry.handle.processId,pid:entry.identity.pid,startedAt:entry.identity.startedAt,state:entry.state}));}
 dispose():Promise<void>{if(this.closing)return this.closing;this.closed=true;clearInterval(this.timer);for(const entry of this.tracked.values())this.signal(entry.identity);this.closing=(async()=>{await Promise.allSettled([...this.pending]);for(const entry of this.tracked.values())this.signal(entry.identity);const deadline=performance.now()+Math.max(1,Math.min(5000,this.options.disposeWaitMs??2000));do{await this.sweep(true);if(!this.tracked.size||[...this.tracked.values()].every(entry=>entry.state==='unknown'))break;await new Promise<void>(done=>setTimeout(done,10));}while(performance.now()<deadline);for(const entry of this.tracked.values()){entry.state='unknown';entry.detach();}})();return this.closing;}
}
