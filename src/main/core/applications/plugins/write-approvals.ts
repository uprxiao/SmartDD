import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ApplicationError} from '@shared/applications';
import {boundedJson} from '@shared/application-bridge';
import {pluginApprovalTargetSchema,pluginWriteDecisionSchema,type PluginWriteDecision,type PluginWriteDisplay,type PluginWriteReview} from '@shared/plugin-approval';
import type {TerminalTarget} from '@shared/file-terminal';
import type {ResourceStore} from '../resource-store';
import type {RunContext} from '../run-registry';
import type {ApplicationOperationContext} from '../tool-service';
import type {PluginToolPolicy} from './session-tools';
import type {ProcessIdentityReader,ProcessIdentity} from '../process-identity';
import {canonicalJson,digest} from '../manifest';

export interface PluginWriteScope {displayName:string;version:string;capability:string;title:string;ptyId:string;targets:PluginWriteReview['targets'];stamp:string}
interface Pending {
  review:PluginWriteReview;hash:string;context:RunContext;operation:ApplicationOperationContext;check():void;
  resolve():void;reject(error:ApplicationError):void;cleanup():void;displays:Map<string,string>;
}
/** A grant is one pending, authenticated host operation, not a CLI permission mode or a reusable model token. */
export class PluginWriteApprovals {
  private readonly pending=new Map<string,Pending>();private readonly operations=new Set<string>();private closed=false;
  private readonly timer:ReturnType<typeof setInterval>;
  constructor(private readonly store:ResourceStore,private readonly deps:{
    current(runId:string):RunContext;
    scope(...args:Parameters<PluginToolPolicy['approve']>):PluginWriteScope;
    host:ProcessIdentity;processes:ProcessIdentityReader;changed(taskId:string):void;now?:()=>number;
  }){this.timer=setInterval(()=>this.reconcile(),250);this.timer.unref();}
  private now(){return this.deps.now?.()??Date.now();}
  private notify(taskId:string){try{this.deps.changed(taskId);}catch{/* Notification does not create or renew authority. */}}
  request:PluginToolPolicy['approve']=(context,selection,capability,input,operation)=>{
    if(this.closed||operation.signal.aborted)throw new ApplicationError('CANCELED','插件写操作确认已取消');
    if(capability.semantics==='read'||operation.appId!==selection.appId||!z.uuid().safeParse(operation.operationId).success||!boundedJson(input))throw new ApplicationError('SCOPE_DENIED','插件确认不属于本次写操作');
    if(this.operations.has(operation.operationId)||this.pending.size>=16||[...this.pending.values()].filter(p=>p.review.runId===context.run.runId).length>=4)throw new ApplicationError('RESOURCE_BUSY','已有插件操作等待确认');
    const original=structuredClone(input),scope=this.deps.scope(context,selection,capability,original,operation),at=this.now(),expiresAt=Math.min(operation.deadline,at+60000);
    if(!Number.isFinite(expiresAt)||expiresAt<=at)throw new ApplicationError('TIMEOUT','插件操作已超过本次时限');
    const row=this.store.sqlite.prepare('SELECT * FROM application_invocations WHERE operation_id=?').get(operation.operationId) as Record<string,unknown>|undefined;
    if(!row||row.run_id!==context.run.runId||row.request_id!==operation.requestId||row.project_id!==context.run.projectId||row.task_id!==context.run.taskId||row.app_id!==selection.appId||row.package_hash!==operation.packageHash||row.tool_name!==operation.toolName||row.semantics!=='write'||row.state!=='running')throw new ApplicationError('SCOPE_DENIED','插件确认没有当前宿主调用账本');
    const review:PluginWriteReview={id:randomUUID(),operationId:operation.operationId,runId:context.run.runId,taskId:context.run.taskId,ptyId:scope.ptyId,projectId:context.run.projectId,
      appId:selection.appId,displayName:scope.displayName,version:scope.version,packageHash:operation.packageHash,capability:scope.capability,title:scope.title,permission:capability.permission,semantics:capability.semantics,targets:scope.targets,input:original,createdAt:at,expiresAt},hash=digest(canonicalJson(review));
    const check=()=>{
      if(this.closed||operation.signal.aborted||context.signal.aborted)throw new ApplicationError('CANCELED','原插件操作或运行已停止');
      if(this.now()>=expiresAt)throw new ApplicationError('TIMEOUT','本次插件操作确认已过期');
      const fresh=this.deps.current(context.run.runId);
      if(fresh.run.taskId!==review.taskId||fresh.run.projectId!==review.projectId||this.deps.scope(fresh,selection,capability,original,operation).stamp!==scope.stamp)throw new ApplicationError('INTENT_STALE','本次操作的运行、连接或授权已变化');
    };
    check();
    this.store.sqlite.prepare("INSERT INTO plugin_write_approvals(operation_id,approval_id,run_id,app_id,package_hash,capability,input_hash,review_hash,policy_hash,state,host_instance_id,host_pid,host_started_at,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?)")
      .run(operation.operationId,review.id,review.runId,review.appId,review.packageHash,review.capability,digest(canonicalJson(original)),hash,scope.stamp,this.store.instanceId,this.deps.host.pid,this.deps.host.startedAt,at,expiresAt);
    this.operations.add(operation.operationId);
    const promise=new Promise<void>((resolve,reject)=>{
      const abort=()=>this.finish(review.id,'cancelled',new ApplicationError('CANCELED','原插件操作已取消'));
      operation.signal.addEventListener('abort',abort,{once:true});context.signal.addEventListener('abort',abort,{once:true});
      this.pending.set(review.id,{review,hash,context,operation,check,resolve,reject,cleanup:()=>{operation.signal.removeEventListener('abort',abort);context.signal.removeEventListener('abort',abort);},displays:new Map()});
    });
    this.notify(review.taskId);return promise.then(()=>{check();return check;});
  };
  private finish(id:string,state:'allowed'|'denied'|'cancelled'|'expired'|'invalidated',error?:ApplicationError,provenance?:unknown){
    const pending=this.pending.get(id);if(!pending)return false;let recorded=true;
    try{
      const result=this.store.sqlite.prepare("UPDATE plugin_write_approvals SET state=?,provenance_json=?,decided_at=? WHERE approval_id=? AND state='pending'").run(state,provenance?canonicalJson(provenance):null,this.now(),id);
      if(result.changes!==1)throw new ApplicationError('INTENT_STALE','本次插件确认已结束');
    }catch{recorded=false;state='invalidated';error=new ApplicationError('AUTHORIZATION_REQUIRED','本次确认无法安全记录，未执行插件写入');}
    this.pending.delete(id);this.operations.delete(pending.review.operationId);pending.cleanup();pending.displays.clear();
    if(state==='allowed'&&!error)pending.resolve();else pending.reject(error??new ApplicationError('PERMISSION_DENIED','你已拒绝本次插件写操作'));
    this.notify(pending.review.taskId);
    return recorded;
  }
  private reconcile(){for(const[id,p]of this.pending){try{p.check();}catch(error){const e=error instanceof ApplicationError?error:new ApplicationError('SCOPE_DENIED','原运行不可用');this.finish(id,e.code==='TIMEOUT'?'expired':e.code==='CANCELED'?'cancelled':'invalidated',e);}}}
  present(owner:string,target:TerminalTarget):PluginWriteDisplay[]{
    const parsed=pluginApprovalTargetSchema.parse(target);this.reconcile();
    return[...this.pending.values()].filter(p=>p.review.taskId===parsed.taskId&&p.review.ptyId===parsed.ptyId).map(p=>{
      let receipt=p.displays.get(owner);if(!receipt){if(p.displays.size>=8)throw new ApplicationError('RESOURCE_BUSY','本次操作的审阅窗口过多');receipt=randomUUID();p.displays.set(owner,receipt);}
      return{...structuredClone(p.review),reviewHash:p.hash,displayReceiptId:receipt};
    });
  }
  decide(owner:string,raw:PluginWriteDecision){
    const input=pluginWriteDecisionSchema.parse(raw),p=this.pending.get(input.id);
    if(!p||p.review.taskId!==input.taskId||p.review.ptyId!==input.ptyId||p.hash!==input.reviewHash||p.displays.get(owner)!==input.displayReceiptId)throw new ApplicationError('AUTHORIZATION_REQUIRED','请在本次运行的终端中审阅具体插件操作后确认');
    try{p.check();}catch(error){const e=error instanceof ApplicationError?error:new ApplicationError('INTENT_STALE','本次确认已失效');this.finish(input.id,e.code==='TIMEOUT'?'expired':'invalidated',e);throw e;}
    if(!this.finish(input.id,input.allow?'allowed':'denied',undefined,{kind:'renderer-confirmation',owner,displayReceiptHash:digest(input.displayReceiptId),reviewHash:p.hash,allow:input.allow,at:this.now()}))throw new ApplicationError('AUTHORIZATION_REQUIRED','本次确认无法安全记录，未执行插件写入');
    return{id:input.id,decision:input.allow?'allowed' as const:'denied' as const};
  }
  recover(){
    const recovered:string[]=[],pending:string[]=[];
    const rows=this.store.sqlite.prepare("SELECT a.*,i.semantics,i.state AS invocation_state,i.effect_state FROM plugin_write_approvals a JOIN application_invocations i ON i.operation_id=a.operation_id AND i.run_id=a.run_id AND i.app_id=a.app_id AND i.package_hash=a.package_hash WHERE a.state='pending'").all() as Record<string,unknown>[];
    for(const row of rows){
      const recoverable=['running','unknown'].includes(String(row.invocation_state))&&['not-started','unknown'].includes(String(row.effect_state))||row.invocation_state==='failed'&&row.effect_state==='not-started';
      if(!z.uuid().safeParse(row.operation_id).success||!z.uuid().safeParse(row.host_instance_id).success||!Number.isSafeInteger(row.host_pid)||Number(row.host_pid)<1||typeof row.host_started_at!=='string'||!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(row.host_started_at)||row.semantics!=='write'||!recoverable){pending.push(String(row.operation_id));continue;}
      let stopped=false;try{stopped=this.deps.processes.state({pid:Number(row.host_pid),startedAt:row.host_started_at})==='stopped';}catch{/* Unknown owner is retained. */}
      if(!stopped){pending.push(String(row.operation_id));continue;}
      this.store.sqlite.transaction(()=>{
        const actual=this.store.sqlite.prepare("SELECT state FROM plugin_write_approvals WHERE operation_id=? AND state='pending' AND host_instance_id=? AND host_pid=? AND host_started_at=?").get(row.operation_id,row.host_instance_id,row.host_pid,row.host_started_at);
        if(!actual){pending.push(String(row.operation_id));return;}
        this.store.sqlite.prepare("UPDATE plugin_write_approvals SET state=?,decided_at=? WHERE operation_id=? AND state='pending'").run(row.invocation_state==='failed'?'invalidated':'cancelled',this.now(),row.operation_id);
        this.store.sqlite.prepare("UPDATE application_invocations SET state='failed',effect_state='not-started',error_code='CANCELED',ended_at=? WHERE operation_id=? AND state IN ('running','unknown')").run(new Date(this.now()).toISOString(),row.operation_id);recovered.push(String(row.operation_id));
      }).immediate();
    }return{recovered,pending};
  }
  close(){this.closed=true;clearInterval(this.timer);for(const id of [...this.pending.keys()])this.finish(id,'cancelled',new ApplicationError('CANCELED','插件确认服务已关闭'));}
}
