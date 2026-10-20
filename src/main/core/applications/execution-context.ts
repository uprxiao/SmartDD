import { randomUUID } from 'node:crypto';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { ApplicationError, type InstalledApplicationPackage } from '@shared/applications';
import type { ApplicationId, ApplicationProvider, ApplicationConnection } from '@shared/application-connections';
import type { MailActor } from '@shared/mail-drafts';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import type { ApplicationConnectionService } from './connection-service';
import type { ApplicationSelectionService } from './selection-service';
import type { ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import { canonicalJson, digest } from './manifest';
import type { RunContext } from './run-registry';
import type { ApplicationDataBinding } from './application-adapter-registry';
import type { ApplicationOperationContext } from './tool-service';

export type ApplicationUiSender = Pick<IpcMainInvokeEvent,'sender'|'senderFrame'>;
export interface ApplicationExecutionContext {
  readonly operationId:string;readonly callerKind:'ui'|'agent-run'|'index-job';
  readonly scopeKind:'project'|'connection-management'|'internal-index';
  readonly projectId:string|null;readonly taskId:string|null;readonly runId:string|null;readonly jobId:string|null;
  readonly parentOperationId:string|null;readonly appId:ApplicationId;readonly packageHash:string;readonly dataApi:1;
  readonly action:string;readonly semantics:'read'|'write';readonly allowedOperations:readonly string[];
  readonly signal:AbortSignal;readonly startedAt:string;
}
interface Target {slot:ApplicationProvider;id:string;identityRevision:number;configRevision:number;policyRevision:number;bindingRevision:number}
interface ContextRecord {context:ApplicationExecutionContext;active:boolean;abort:AbortController;check:()=>void;allowed:Set<string>;targets:Map<ApplicationProvider,Target>;scopeHash:string}
interface OperationRow {scope_hash:string;targets_json:string;state:string;semantics:'read'|'write';attempt_count:number}
const actionSchema=z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const targetSchema=z.object({slot:z.enum(['zentao','foxmail','smtp']),id:z.uuid(),identityRevision:z.number().int().positive(),configRevision:z.number().int().positive(),policyRevision:z.number().int().nonnegative(),bindingRevision:z.number().int().nonnegative()}).strict();
const managementActions=new Set(['application.configure','application.add','application.enable','application.project.read','application.project.select','connection.list','connection.test','connection.save','connection.enable','connection.disconnect']);

/** Contexts are capabilities minted only by trusted host entrypoints; JSON copies have no authority. */
export class ApplicationExecutionContexts {
  private readonly records=new WeakMap<object,ContextRecord>();
  private readonly active=new Set<ContextRecord>();
  private readonly actors=new WeakMap<MailActor,ApplicationExecutionContext>();
  private readonly pending=new Set<Promise<unknown>>();
  private readonly builtin:BuiltinPackageRegistry;
  private closed=false;
  constructor(readonly store:ResourceStore,private readonly selections:ApplicationSelectionService,private readonly connections:ApplicationConnectionService,private readonly deps:{
    requireSender(sender:ApplicationUiSender):void;
    assertRun(runId:string):RunContext;
    now?:()=>number;changed?:()=>void;
  }){this.builtin=new BuiltinPackageRegistry(store);}
  private now():number{return this.deps.now?.()??Date.now();}
  private record(context:ApplicationExecutionContext):ContextRecord{
    const record=this.records.get(context);
    if(!record?.active||this.closed)throw new ApplicationError('SCOPE_DENIED','业务操作上下文不属于当前有效宿主');
    if(record.abort.signal.aborted||context.signal.aborted)throw new ApplicationError('CANCELED','本次业务操作已取消');
    record.check();for(const target of record.targets.values())this.checkTarget(context,target);return record;
  }
  assertActive(context:ApplicationExecutionContext):void{this.record(context);}
  require(context:ApplicationExecutionContext,permission:string):void{
    const record=this.record(context);
    if(!record.allowed.has(permission))throw new ApplicationError('SCOPE_DENIED','本次业务操作未获该动作授权');
    if(context.callerKind==='index-job'&&!permission.endsWith('.read'))throw new ApplicationError('SCOPE_DENIED','索引任务只能读取来源和维护自身索引');
  }
  actor(context:ApplicationExecutionContext,permission='mail.draft'):MailActor{
    this.require(context,permission);
    if(context.scopeKind!=='project'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','本操作需要真实项目作用域');
    const actor=Object.freeze({projectId:context.projectId,taskId:context.taskId});this.actors.set(actor,context);return actor;
  }
  requireActor(actor:MailActor,permission='mail.draft'):void{
    const context=this.actors.get(actor);if(!context)throw new ApplicationError('SCOPE_DENIED','业务调用者不是当前宿主签发的身份');this.assertActor(context,actor,permission);
  }
  assertActor(context:ApplicationExecutionContext,actor:MailActor,permission='mail.draft'):void{
    const current=this.actor(context,permission);
    if(actor.projectId!==current.projectId||actor.taskId!==current.taskId)throw new ApplicationError('SCOPE_DENIED','业务对象不能替换宿主作用域');
  }
  private checkTarget(context:ApplicationExecutionContext,target:Target):void{
    if(!context.projectId)throw new ApplicationError('SCOPE_DENIED','来源使用需要真实项目');
    const selected=this.selections.connectionSlot(context.projectId,context.appId,target.slot),current=this.connections.get(target.id);
    if(selected.connectionId!==target.id||selected.identityRevision!==target.identityRevision||selected.revision!==target.bindingRevision||current.identityRevision!==target.identityRevision||current.configRevision!==target.configRevision||current.policyRevision!==target.policyRevision||!current.enabled||current.authorization!=='connected')throw new ApplicationError('REVISION_CONFLICT','本次来源身份、配置或选用已变化，结果未交付');
  }
  async connection(context:ApplicationExecutionContext,slot:ApplicationProvider,expectedId:string|null=null):Promise<{connection:ApplicationConnection;secret:string|null}>{
    this.require(context,slot==='smtp'?'mail.send':context.appId+'.read');
    if(!context.projectId||context.scopeKind==='connection-management')throw new ApplicationError('SCOPE_DENIED','连接管理不能用来读取项目数据');
    const selected=this.selections.connectionSlot(context.projectId,context.appId,slot);
    if(!selected.connectionId)throw new ApplicationError('AUTH_REQUIRED','请先明确选用此项目的来源或发件连接');
    if(expectedId!==null&&expectedId!==selected.connectionId)throw new ApplicationError('SCOPE_DENIED','请求的连接不是当前项目明确选用的连接');
    const connection=this.connections.get(selected.connectionId);
    if(!connection.enabled||connection.authorization!=='connected')throw new ApplicationError('AUTH_REQUIRED','当前连接已停用或断开');
    const target:Target={slot,id:connection.id,identityRevision:connection.identityRevision,configRevision:connection.configRevision,policyRevision:connection.policyRevision,bindingRevision:selected.revision};
    await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      const record=this.record(context),row=this.store.sqlite.prepare('SELECT targets_json FROM application_data_operations WHERE operation_id=?').get(context.operationId) as {targets_json:string};
      let targets:Target[];try{targets=z.array(targetSchema).parse(JSON.parse(row.targets_json));}catch{throw new ApplicationError('HASH_MISMATCH','原业务来源记录无法核验');}
      const prior=targets.find(t=>t.slot===slot);if(prior&&canonicalJson(prior)!==canonicalJson(target))throw new ApplicationError('REVISION_CONFLICT','同一操作不能在重试时改用其他来源');
      if(!prior){targets.push(target);this.store.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(canonicalJson(targets),context.operationId);}
      record.targets.set(slot,target);this.checkTarget(context,target);
    }).immediate());
    const authenticated=this.connections.authentication(connection.id,connection);
    return {connection,secret:authenticated.secret};
  }
  async connectionHealth(context:ApplicationExecutionContext,connection:ApplicationConnection,code:ApplicationError['code']|null):Promise<void>{
    this.assertActive(context);const target=this.record(context).targets.get(connection.providerId);if(!target||target.id!==connection.id)throw new ApplicationError('SCOPE_DENIED','健康结果不属于本次已固定来源');const changed=await this.connections.reportHealth(connection.id,connection,code);this.assertActive(context);if(changed)this.deps.changed?.();
  }
  private activePackage(appId:ApplicationId):InstalledApplicationPackage{
    const active=this.builtin.packages.active(appId);if(!active)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前应用没有已准备的默认版本');return this.builtin.packages.get(active.packageHash);
  }
  withUi<T>(sender:ApplicationUiSender,input:{projectId:string;appId:ApplicationId;action:string;operations:readonly string[];semantics:'read'|'write';signal?:AbortSignal},work:(context:ApplicationExecutionContext)=>Promise<T>):Promise<T>{
    this.deps.requireSender(sender);const application=this.activePackage(input.appId),stamp=this.selections.policyStamp(input.projectId,input.appId);
    const check=()=>{this.deps.requireSender(sender);if(canonicalJson(this.selections.policyStamp(input.projectId,input.appId))!==canonicalJson(stamp))throw new ApplicationError('SCOPE_DENIED','应用授权已变化，原业务操作失效');};
    return this.begin(application,{operationId:randomUUID(),callerKind:'ui',scopeKind:'project',projectId:input.projectId,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:input.appId,packageHash:application.packageHash,dataApi:1,action:input.action,semantics:input.semantics,allowedOperations:input.operations,signal:input.signal??new AbortController().signal,startedAt:new Date(this.now()).toISOString()},check,stamp,work,true);
  }
  withManagement<T>(sender:ApplicationUiSender,input:{appId:ApplicationId;action:string;semantics:'read'|'write';projectId?:string;signal?:AbortSignal},work:(context:ApplicationExecutionContext)=>Promise<T>):Promise<T>{
    this.deps.requireSender(sender);if(!managementActions.has(input.action))throw new ApplicationError('SCOPE_DENIED','连接管理只允许明确的配置动作');const application=this.activePackage(input.appId);
    return this.begin(application,{operationId:randomUUID(),callerKind:'ui',scopeKind:'connection-management',projectId:input.projectId??null,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:input.appId,packageHash:application.packageHash,dataApi:1,action:input.action,semantics:input.semantics,allowedOperations:[input.action],signal:input.signal??new AbortController().signal,startedAt:new Date(this.now()).toISOString()},()=>this.deps.requireSender(sender),null,work,true);
  }
  withAgent<T>(claim:RunContext,binding:Readonly<ApplicationDataBinding>,operation:ApplicationOperationContext,semantics:'read'|'write',work:(context:ApplicationExecutionContext)=>Promise<T>):Promise<T>{
    const known=this.deps.assertRun(claim.run.runId),selected=known.snapshot.packages.find(p=>p.packageHash===binding.packageHash&&p.appId===binding.appId);
    if(known.run.taskId!==claim.run.taskId||known.run.projectId!==claim.run.projectId||!selected||!selected.allowedOperations.includes(binding.permission)||selected.toolContractMajors[binding.toolName]!==operation.contractMajor||operation.packageHash!==binding.packageHash||operation.appId!==binding.appId||operation.toolName!==binding.toolName)throw new ApplicationError('SCOPE_DENIED','工具上下文不能替换真实运行、原包或动作');
    const application=this.builtin.assertTrusted(binding.packageHash),appId=application.appId as ApplicationId,stamp=this.selections.policyStamp(known.run.projectId,appId);
    const check=()=>{const current=this.deps.assertRun(known.run.runId);if(current.run.taskId!==known.run.taskId||current.run.projectId!==known.run.projectId||canonicalJson(this.selections.policyStamp(known.run.projectId,appId))!==canonicalJson(stamp))throw new ApplicationError('SCOPE_DENIED','当前运行或应用授权已变化');};
    return this.begin(application,{operationId:operation.operationId,callerKind:'agent-run',scopeKind:'project',projectId:known.run.projectId,taskId:known.run.taskId,runId:known.run.runId,jobId:null,parentOperationId:null,appId,packageHash:binding.packageHash,dataApi:1,action:binding.toolName,semantics,allowedOperations:selected.allowedOperations,signal:AbortSignal.any([known.signal,operation.signal]),startedAt:new Date(this.now()).toISOString()},check,stamp,work,false);
  }
  withIndex<T>(parent:ApplicationExecutionContext,permission:'mail.read'|'zentao.read',work:(context:ApplicationExecutionContext)=>Promise<T>):Promise<T>{
    this.require(parent,permission);if(parent.scopeKind!=='project'||!parent.projectId)throw new ApplicationError('SCOPE_DENIED','来源刷新需要有效项目触发');const application=this.builtin.assertTrusted(parent.packageHash),id=randomUUID();
    return this.begin(application,{operationId:id,callerKind:'index-job',scopeKind:'internal-index',projectId:parent.projectId,taskId:null,runId:null,jobId:id,parentOperationId:parent.operationId,appId:parent.appId,packageHash:parent.packageHash,dataApi:1,action:parent.appId+'.refresh',semantics:'read',allowedOperations:[permission],signal:parent.signal,startedAt:new Date(this.now()).toISOString()},()=>this.require(parent,permission),{parent:parent.operationId},work,true);
  }
  private begin<T>(application:InstalledApplicationPackage,input:ApplicationExecutionContext,check:()=>void,policy:unknown,work:(context:ApplicationExecutionContext)=>Promise<T>,lease:boolean):Promise<T>{
    if(this.closed)throw new ApplicationError('CANCELED','应用业务服务已停止');actionSchema.parse(input.action);if(!z.uuid().safeParse(input.operationId).success)throw new ApplicationError('INVALID_INPUT','业务操作编号无效');
    if(input.scopeKind!=='connection-management'&&input.allowedOperations.some(p=>!application.manifest.permissions.includes(p)))throw new ApplicationError('SCOPE_DENIED','业务动作超过固定包能力范围');
    const abort=new AbortController(),context=Object.freeze({...input,allowedOperations:Object.freeze([...input.allowedOperations]),signal:AbortSignal.any([input.signal,abort.signal])}),scopeHash=digest(canonicalJson({callerKind:context.callerKind,scopeKind:context.scopeKind,projectId:context.projectId,taskId:context.taskId,runId:context.runId,jobId:context.jobId,parentOperationId:context.parentOperationId,appId:context.appId,packageHash:context.packageHash,action:context.action,semantics:context.semantics,policy}));
    const record:ContextRecord={context,active:true,abort,check,allowed:new Set(context.allowedOperations),targets:new Map(),scopeHash};
    const run=async()=>{
      if(this.closed||context.signal.aborted)throw new ApplicationError('CANCELED','本次业务操作已取消');
      this.builtin.assertTrusted(application.packageHash);check();
      if(context.signal.aborted)throw new ApplicationError('CANCELED','本次业务操作已取消');
      await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
        if(this.closed||context.signal.aborted)throw new ApplicationError('CANCELED','本次业务操作已取消');check();const old=this.store.sqlite.prepare('SELECT scope_hash,targets_json,state,semantics,attempt_count FROM application_data_operations WHERE operation_id=?').get(context.operationId) as OperationRow|undefined;
        if(old){if(old.scope_hash!==scopeHash)throw new ApplicationError('SCOPE_DENIED','同一操作不能改变来源或授权代次');if(old.state==='running'||context.semantics==='write'||old.state==='succeeded')throw new ApplicationError('EXECUTION_ALREADY_ATTEMPTED','业务操作已有执行记录，请读取原结果');this.store.sqlite.prepare("UPDATE application_data_operations SET state='running',error_code=NULL,ended_at=NULL,attempt_count=attempt_count+1 WHERE operation_id=?").run(context.operationId);}
        else this.store.sqlite.prepare("INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,task_id,run_id,job_id,parent_operation_id,app_id,package_hash,data_api,action,semantics,scope_hash,state,started_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'running',?)").run(context.operationId,context.callerKind,context.scopeKind,context.projectId,context.taskId,context.runId,context.jobId,context.parentOperationId,context.appId,context.packageHash,context.dataApi,context.action,context.semantics,scopeHash,context.startedAt);
      }).immediate());
      this.records.set(context,record);this.active.add(record);
      try{const value=await work(context);this.record(context);await this.end(context,'succeeded',null);this.record(context);return value;}
      catch(error){const code=error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE';await this.end(context,code==='CANCELED'?'cancelled':context.semantics==='write'?'unknown':'failed',code);throw error;}
      finally{record.active=false;abort.abort();this.active.delete(record);}
    };
    const execution=lease?this.store.use(application.resourceId,input.callerKind==='index-job'?'index-job':'ui',input.operationId,run):run();
    const result=execution.then(value=>{if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','本次业务结果已取消交付');check();for(const target of record.targets.values())this.checkTarget(context,target);return value;});
    this.pending.add(result);void result.finally(()=>this.pending.delete(result)).catch(()=>undefined);return result;
  }
  private end(context:ApplicationExecutionContext,state:string,code:string|null):Promise<void>{return withResourceLock(this.store.root,()=>{this.store.sqlite.prepare('UPDATE application_data_operations SET state=?,error_code=?,ended_at=? WHERE operation_id=?').run(state,code,new Date(this.now()).toISOString(),context.operationId);});}
  assertAgentReceipt(claim:RunContext,binding:Readonly<ApplicationDataBinding>,operationId:string):void{
    const known=this.deps.assertRun(claim.run.runId),selected=known.snapshot.packages.find(p=>p.packageHash===binding.packageHash&&p.appId===binding.appId);
    if(!selected||!selected.allowedOperations.includes(binding.permission))throw new ApplicationError('SCOPE_DENIED','当前运行不能读取该原业务回执');
    const row=this.store.sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(operationId) as {caller_kind:string;scope_kind:string;project_id:string;task_id:string;run_id:string;job_id:null;parent_operation_id:null;app_id:ApplicationId;package_hash:string;action:string;semantics:'read'|'write';scope_hash:string;targets_json:string}|undefined;
    if(!row||row.caller_kind!=='agent-run'||row.project_id!==known.run.projectId||row.task_id!==known.run.taskId||row.run_id!==known.run.runId||row.app_id!==binding.appId||row.package_hash!==binding.packageHash||row.action!==binding.toolName)throw new ApplicationError('SCOPE_DENIED','回执不属于当前真实运行及固定工具');
    const policy=this.selections.policyStamp(row.project_id,row.app_id),hash=digest(canonicalJson({callerKind:row.caller_kind,scopeKind:row.scope_kind,projectId:row.project_id,taskId:row.task_id,runId:row.run_id,jobId:row.job_id,parentOperationId:row.parent_operation_id,appId:row.app_id,packageHash:row.package_hash,action:row.action,semantics:row.semantics,policy}));
    if(hash!==row.scope_hash)throw new ApplicationError('SCOPE_DENIED','原回执对应的应用授权代次已变化');
    let targets:Target[];try{targets=z.array(targetSchema).parse(JSON.parse(row.targets_json));}catch{throw new ApplicationError('HASH_MISMATCH','原回执来源记录已损坏');}
    for(const target of targets)this.checkTarget({projectId:row.project_id,appId:row.app_id} as ApplicationExecutionContext,target);
  }
  withReadReceipt<T>(claim:RunContext,binding:Readonly<ApplicationDataBinding>,originalOperationId:string,work:(context:ApplicationExecutionContext)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    this.assertAgentReceipt(claim,binding,originalOperationId);
    const known=this.deps.assertRun(claim.run.runId),application=this.builtin.assertTrusted(binding.packageHash),id=randomUUID();
    const check=()=>this.assertAgentReceipt(known,binding,originalOperationId);
    return this.begin(application,{operationId:id,callerKind:'agent-run',scopeKind:'project',projectId:known.run.projectId,taskId:known.run.taskId,runId:known.run.runId,jobId:null,parentOperationId:null,appId:application.appId as ApplicationId,packageHash:application.packageHash,dataApi:1,action:binding.toolName+'.receipt',semantics:'read',allowedOperations:[binding.permission],signal:AbortSignal.any([known.signal,...(signal?[signal]:[])]),startedAt:new Date(this.now()).toISOString()},check,{receiptOf:originalOperationId},async context=>{
      await withResourceLock(this.store.root,()=>{this.assertActive(context);this.store.sqlite.prepare('INSERT INTO application_read_receipt_checks VALUES(?,?,?)').run(id,originalOperationId,new Date(this.now()).toISOString());});return work(context);
    },false);
  }
  invalidate():void{for(const record of this.active)try{this.record(record.context);}catch{record.abort.abort();}}
  async dispose():Promise<void>{this.closed=true;for(const record of this.active)record.abort.abort();await Promise.allSettled([...this.pending]);}
}
