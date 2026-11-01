import {SelectionPreconditionError} from './selection-precondition-error';
import {CredentialHandles,type CredentialHandle} from './credential-handles';
import {assertRunApplication} from './application-run-scope';
import { randomUUID } from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {retryAfterWait} from './retry-after';
import type { IpcMainInvokeEvent } from 'electron';
import { z } from 'zod';
import { ApplicationError, type InstalledApplicationPackage } from '@shared/applications';
import type {ApplicationId,ConnectionConfig} from '@shared/application-connections';
import type {HostedConfiguration,HostedConnection} from './host-application-registry';
import type { MailSendActor } from '@shared/mail-execution';
import type { ProcessIdentity } from './process-identity';
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
import type { CallerContext } from './caller-context';
import {requirePlanEntry} from './run-plan';

export type ApplicationUiSender = Pick<IpcMainInvokeEvent,'sender'|'senderFrame'>;
export interface ApplicationExecutionContext<A extends string=ApplicationId> {
  readonly operationId:string;readonly callerKind:'ui'|'agent-run'|'index-job';
  readonly scopeKind:'project'|'connection-management'|'internal-index';
  readonly projectId:string|null;readonly taskId:string|null;readonly runId:string|null;readonly jobId:string|null;
  readonly parentOperationId:string|null;readonly appId:A;readonly packageHash:string;readonly dataApi:1;
  readonly action:string;readonly semantics:'read'|'write';readonly allowedOperations:readonly string[];
  readonly signal:AbortSignal;readonly startedAt:string;
}
interface ReadDefaults {configHash:string;values:Record<string,unknown>}
interface Target<P extends string> {readDefaults?:ReadDefaults;slot:P;id:string;identityRevision:number;configRevision:number;policyRevision:number;bindingRevision:number;identityOnly?:true}
interface ContextRecord<C extends HostedConfiguration,A extends string> {context:ApplicationExecutionContext<A>;active:boolean;abort:AbortController;check:()=>void;allowed:Set<string>;targets:Map<C['kind'],Target<C['kind']>>;scopeHash:string}
interface OperationRow {scope_hash:string;targets_json:string;state:string;semantics:'read'|'write';attempt_count:number}
const actionSchema=z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const targetSchema=z.object({slot:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),id:z.uuid(),identityRevision:z.number().int().positive(),configRevision:z.number().int().positive(),policyRevision:z.number().int().nonnegative(),bindingRevision:z.number().int().nonnegative(),identityOnly:z.literal(true).optional(),readDefaults:z.object({configHash:z.string().regex(/^[a-f0-9]{64}$/),values:z.record(z.string().min(1).max(64),z.unknown()).refine(value=>Object.keys(value).length<=8&&JSON.stringify(value).length<=4096)}).strict().optional()}).strict();
const managementActions=new Set(['application.configure','application.cache.status','application.cache.clear','application.add','application.enable','application.project.read','application.project.select','connection.list','connection.test','connection.test.discard','connection.save','connection.enable','connection.disconnect']);

/** Contexts are capabilities minted only by trusted host entrypoints; JSON copies have no authority. */
export class ApplicationExecutionContexts<C extends HostedConfiguration=ConnectionConfig,A extends string=ApplicationId> {
  private readonly records=new WeakMap<object,ContextRecord<C,A>>();
  private readonly callers=new WeakMap<object,ApplicationExecutionContext<A>>();
  private readonly agentCalls=new WeakMap<object,Extract<CallerContext,{kind:'agent'}>>();
  private readonly credentials=new CredentialHandles<ReturnType<ApplicationConnectionService<C,A>['authentication']>>();
  private readonly sharedIndexes=new WeakSet<object>();
  private readonly active=new Set<ContextRecord<C,A>>();
  private readonly actors=new WeakMap<MailActor,ApplicationExecutionContext<A>>();
  private readonly sendActors=new WeakMap<MailSendActor,'mail.send'|'mail.draft'>();
  private readonly pending=new Set<Promise<unknown>>();
  private readonly builtin:BuiltinPackageRegistry;
  private closed=false;
  constructor(readonly store:ResourceStore,private readonly selections:ApplicationSelectionService<C,A>,private readonly connections:ApplicationConnectionService<C,A>,private readonly deps:{
    requireSender(sender:ApplicationUiSender):void;
    assertRun(runId:string):RunContext;
    now?:()=>number;changed?:(change?:{kind:'health';appId:A;connectionId:string})=>void;uiReadRetryDelays?:readonly number[];uiReadTimeoutMs?:number;
  }){this.builtin=new BuiltinPackageRegistry(store,this.connections.registry);}
  private get registry(){return this.connections.registry;}
  private decodeTargets(value:string,appId:A):Target<C['kind']>[] {
    return z.array(targetSchema).parse(JSON.parse(value)).map(target=>{const provider=this.registry.provider(target.slot);if(provider.appId!==appId)throw new ApplicationError('HASH_MISMATCH','原业务来源类别不属于当前应用');return{...target,slot:provider.id};});
  }
  private now():number{return this.deps.now?.()??Date.now();}
  private record(context:ApplicationExecutionContext<A>):ContextRecord<C,A>{
    const record=this.records.get(context);
    if(!record?.active||this.closed)throw new ApplicationError('SCOPE_DENIED','业务操作上下文不属于当前有效宿主');
    if(record.abort.signal.aborted||context.signal.aborted){if(context.signal.reason instanceof ApplicationError&&context.signal.reason.code==='TIMEOUT')throw context.signal.reason;throw new ApplicationError('CANCELED','本次业务操作已取消');}
    record.check();for(const target of record.targets.values())this.checkTarget(context,target);return record;
  }
  async subject(context:ApplicationExecutionContext<A>,kind:'connection'|'mail-send'|'mail-draft',subjectId:string):Promise<void>{
    this.assertActive(context);if(!['connection','mail-send','mail-draft'].includes(kind)||!z.uuid().safeParse(subjectId).success)throw new ApplicationError('INVALID_INPUT','业务记录关联身份无效');
    await withResourceLock(this.store.root,()=>{this.assertActive(context);this.store.sqlite.prepare('INSERT OR IGNORE INTO application_activity_subjects VALUES(?,?,?)').run(context.operationId,kind,subjectId);});
  }
  assertActive(context:ApplicationExecutionContext<A>):void{this.record(context);}
  caller(context:ApplicationExecutionContext<A>):CallerContext{
    this.record(context);
    const base={operationId:context.operationId,appId:context.appId,packageHash:context.packageHash,action:context.action};
    let caller:CallerContext;
    if(context.callerKind==='agent-run'){
      const issued=this.agentCalls.get(context);if(!issued)throw new ApplicationError('SCOPE_DENIED','Agent调用缺少网关签发依据');caller=issued;
    }else if(context.scopeKind==='connection-management')caller=Object.freeze({...base,kind:'management',projectId:context.projectId});
    else if(context.callerKind==='index-job'){
      if(!context.projectId||!context.jobId||!context.parentOperationId)throw new ApplicationError('SCOPE_DENIED','内部调用缺少父操作');
      caller=Object.freeze({...base,kind:'internal',projectId:context.projectId,job:context.jobId,parentOperationId:context.parentOperationId});
    }else{
      if(!context.projectId)throw new ApplicationError('SCOPE_DENIED','页面业务调用缺少项目');
      caller=Object.freeze({...base,kind:'ui',projectId:context.projectId,operations:context.allowedOperations});
    }
    this.callers.set(caller,context);return caller;
  }
  contextFor(caller:CallerContext):ApplicationExecutionContext<A>{
    const context=caller&&typeof caller==='object'?this.callers.get(caller):undefined;
    if(!context)throw new ApplicationError('SCOPE_DENIED','调用身份不是当前宿主签发');this.record(context);return context;
  }
  async withSignal<T>(context:ApplicationExecutionContext<A>,signal:AbortSignal|undefined,work:()=>Promise<T>):Promise<T>{
    const record=this.record(context),cancel=()=>record.abort.abort(signal?.reason);
    if(signal){signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();}
    try{this.record(context);const value=await work();this.record(context);return value;}
    finally{signal?.removeEventListener('abort',cancel);}
  }
  async requireSlots(context:ApplicationExecutionContext<A>,slots:readonly string[]):Promise<void>{
    this.record(context);
    for(const slot of slots){const provider=this.registry.provider(slot);if(provider.appId!==context.appId)throw new ApplicationError('SCOPE_DENIED','能力依赖的连接槽不属于本应用');await this.pinConnection(context,provider.id,null,false);}
    this.record(context);
  }
  require(context:ApplicationExecutionContext<A>,permission:string):void{
    const record=this.record(context);
    if(!record.allowed.has(permission))throw new ApplicationError('SCOPE_DENIED','本次业务操作未获该动作授权');
    if(context.callerKind==='index-job'&&!permission.endsWith('.read'))throw new ApplicationError('SCOPE_DENIED','索引任务只能读取来源和维护自身索引');
  }
  actor(context:ApplicationExecutionContext<A>,permission='mail.draft'):MailActor{
    this.require(context,permission);
    if(context.scopeKind!=='project'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','本操作需要真实项目作用域');
    const actor=Object.freeze({projectId:context.projectId,taskId:context.taskId});this.actors.set(actor,context);return actor;
  }
  requireActor(actor:MailActor,permission='mail.draft'):void{
    const context=this.actors.get(actor);if(!context)throw new ApplicationError('SCOPE_DENIED','业务调用者不是当前宿主签发的身份');this.assertActor(context,actor,permission==='mail.draft'&&this.sendActors.get(actor as MailSendActor)==='mail.send'?'mail.send':permission);
  }
  assertActor(context:ApplicationExecutionContext<A>,actor:MailActor,permission='mail.draft'):void{
    const current=this.actor(context,permission);
    if(actor.projectId!==current.projectId||actor.taskId!==current.taskId)throw new ApplicationError('SCOPE_DENIED','业务对象不能替换宿主作用域');
  }
  sendActor(context:ApplicationExecutionContext<A>,permission:'mail.send'|'mail.draft'='mail.send'):MailSendActor{
    this.require(context,permission);if(context.scopeKind!=='project'||context.appId!=='mail'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','发送业务需要真实邮件项目');
    const actor=Object.freeze({projectId:context.projectId,taskId:context.taskId,runId:context.runId});this.actors.set(actor,context);this.sendActors.set(actor,permission);return actor;
  }
  sendScope(actor:MailSendActor,permission:'mail.send'|'mail.draft'='mail.send'):ApplicationExecutionContext<A>{
    const context=this.actors.get(actor);if(!context||!this.sendActors.has(actor)||actor.runId!==context.runId)throw new ApplicationError('SCOPE_DENIED','发送身份不是当前宿主签发');this.require(context,permission==='mail.draft'&&this.sendActors.get(actor)==='mail.send'?'mail.send':permission);this.assertActor(context,actor,permission==='mail.draft'&&this.sendActors.get(actor)==='mail.send'?'mail.send':permission);return context;
  }
  assertSendOrigin(projectId:string,taskId:string|null,runId:string|null):AbortSignal|null{
    if(runId===null){if(taskId!==null)throw new ApplicationError('SCOPE_DENIED','发送来源运行缺失');return null;}
    const current=this.deps.assertRun(runId);assertRunApplication(current,'mail');if(current.run.projectId!==projectId||current.run.taskId!==taskId||!current.snapshot.packages.some(pack=>pack.appId==='mail'&&pack.allowedOperations.includes('mail.send')))throw new ApplicationError('SCOPE_DENIED','原发送运行或邮件权限已失效');return current.signal;
  }
  retainSendActivity(actor:MailSendActor,intentId:string,identity:ProcessIdentity,work:()=>Promise<unknown>):Promise<unknown>{
    const context=this.sendScope(actor),application=this.builtin.assertTrusted(context.packageHash);
    const activity=this.store.use(application.resourceId,'mail-send',intentId,()=>{this.assertActive(context);return work();},{identity});this.pending.add(activity);void activity.finally(()=>this.pending.delete(activity)).catch(()=>{});return activity;
  }
  async sendConnection(context:ApplicationExecutionContext<A>):Promise<HostedConnection<C,A>>{this.require(context,'mail.send');return this.pinConnection(context,this.registry.provider('smtp').id,null,false);}
  private readDefaults(connection:HostedConnection<C,A>):ReadDefaults|undefined{
    const provider=this.registry.provider(connection.providerId),keys=provider.readDefaultKeys;if(!keys?.length)return;
    const config=this.registry.parseConfig(connection.config),fields={...config} as Record<string,unknown>,values:Record<string,unknown>={};
    for(const key of keys){if(!Object.hasOwn(fields,key))throw new ApplicationError('CONFIG_INCOMPATIBLE','已声明的读取默认值缺失');values[key]=fields[key];delete fields[key];}
    return{configHash:digest(canonicalJson({provider:connection.providerId,schema:connection.configSchemaVersion??1,definitionSchema:provider.configSchemaVersion??1,keys,fields})),values};
  }
  private restoreReadDefaults(connection:HostedConnection<C,A>,original:ReadDefaults):HostedConnection<C,A>{
    const current=this.readDefaults(connection);
    if(!current||current.configHash!==original.configHash||canonicalJson(Object.keys(current.values).sort())!==canonicalJson(Object.keys(original.values).sort()))throw new ApplicationError('REVISION_CONFLICT','本次来源配置或契约已变化，结果未交付');
    return{...connection,config:this.registry.parseConfig({...connection.config,...original.values})};
  }
  private checkTarget(context:Pick<ApplicationExecutionContext<A>,'projectId'|'appId'|'semantics'>,target:Target<C['kind']>):void{
    if(!context.projectId)throw new ApplicationError('SCOPE_DENIED','来源使用需要真实项目');
    const selected=this.selections.connectionSlot(context.projectId,context.appId,target.slot),current=this.connections.get(target.id);
    // A captured read default is a preference, not a grant. Every other config
    // field/schema and all identity/policy/binding/enablement checks stay current.
    const sameConfig=target.readDefaults?context.semantics==='read'&&!!this.restoreReadDefaults(current,target.readDefaults):current.configRevision===target.configRevision;
    if(selected.connectionId!==target.id||selected.identityRevision!==target.identityRevision||selected.revision!==target.bindingRevision||current.identityRevision!==target.identityRevision||!sameConfig||current.policyRevision!==target.policyRevision||!target.identityOnly&&(!current.enabled||current.authorization!=='connected'))throw new ApplicationError('REVISION_CONFLICT','本次来源身份、配置或选用已变化，结果未交付');
  }
  /** Only resolve a view for a source already pinned by this operation. No credential access. */
  configView(context:ApplicationExecutionContext<A>,connection:HostedConnection<C,A>){
    const record=this.record(context),target=record.targets.get(connection.providerId);
    if(context.appId!==connection.appId||!target||target.id!==connection.id)throw new ApplicationError('SCOPE_DENIED','配置视图不属于本次已固定来源');
    this.checkTarget(context,target);
    return this.connections.resolvePackageView(context.packageHash,connection);
  }
  /** Resolves compatibility now; authentication is deferred to the trusted executor. */
  async resolveForPackage(context:ApplicationExecutionContext<A>,slot:C['kind'],expectedId:string|null=null){
    const provider=this.registry.provider(slot);this.require(context,context.semantics==='write'?provider.permissions.write:provider.permissions.read);
    if(this.sharedIndexes.has(context))throw new ApplicationError('SCOPE_DENIED','共享索引不能直接解析项目连接或秘密');
    if(!context.projectId||context.scopeKind==='connection-management')throw new ApplicationError('SCOPE_DENIED','连接管理不能用来读取项目数据');
    const connection=await this.pinConnection(context,slot,expectedId,false);
    return this.resolvePinned(context,connection);
  }
  resolvePinned(context:ApplicationExecutionContext<A>,connection:HostedConnection<C,A>){
    const provider=this.registry.provider(connection.providerId);
    this.require(context,context.semantics==='write'?provider.permissions.write:provider.permissions.read);
    const configView=this.configView(context,connection);
    const id=connection.id; // Never follow a caller-mutated returned metadata object.
    const credentialHandle=this.credentials.issue(context,()=>{
      // assertActive revalidates the exact pinned target, including the narrow
      // read-default fingerprint, before resolving the latest same-identity secret.
      this.assertActive(context);const current=this.connections.get(id);
      return this.connections.authentication(current.id,current);
    });
    return {connection,configView,credentialHandle};
  }
  authenticate(context:ApplicationExecutionContext<A>,handle:CredentialHandle){return this.credentials.consume(context,handle);}
  async connection(context:ApplicationExecutionContext<A>,slot:C['kind'],expectedId:string|null=null){
    const resolved=await this.resolveForPackage(context,slot,expectedId);
    const authenticated=this.authenticate(context,resolved.credentialHandle);
    return {connection:resolved.connection,configView:resolved.configView,secret:authenticated.secret};
  }
  private async pinConnection(context:ApplicationExecutionContext<A>,slot:C['kind'],expectedId:string|null,identityOnly:boolean):Promise<HostedConnection<C,A>>{
    if(!context.projectId)throw new ApplicationError('SCOPE_DENIED','连接使用需要有效项目');
    const selected=this.selections.connectionSlot(context.projectId,context.appId,slot);
    if(!selected.connectionId)throw new ApplicationError('AUTH_REQUIRED','请先明确选用此项目的来源或发件连接');
    if(expectedId!==null&&expectedId!==selected.connectionId)throw new ApplicationError('SCOPE_DENIED','请求的连接不是当前项目明确选用的连接');
    const connection=this.connections.get(selected.connectionId);
    if(!identityOnly&&(!connection.enabled||connection.authorization!=='connected'))throw new ApplicationError('AUTH_REQUIRED','当前连接已停用或断开');
    const defaults=context.semantics==='read'?this.readDefaults(connection):undefined;let pinned=connection,target:Target<C['kind']>={slot,id:connection.id,identityRevision:connection.identityRevision,configRevision:connection.configRevision,policyRevision:connection.policyRevision,bindingRevision:selected.revision,...(identityOnly?{identityOnly:true as const}:{}),...(defaults?{readDefaults:defaults}:{})};
    await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      const record=this.record(context),row=this.store.sqlite.prepare('SELECT targets_json FROM application_data_operations WHERE operation_id=?').get(context.operationId) as {targets_json:string};
      let targets:Target<C['kind']>[];try{targets=this.decodeTargets(row.targets_json,context.appId);}catch{throw new ApplicationError('HASH_MISMATCH','原业务来源记录无法核验');}
      const prior=targets.find(t=>t.slot===slot);
      if(prior){
        this.checkTarget(context,prior);
        if(prior.readDefaults)pinned={...this.restoreReadDefaults(connection,prior.readDefaults),configRevision:prior.configRevision};
        else{const{readDefaults:_defaults,...strict}=target;if(canonicalJson(prior)!==canonicalJson(strict))throw new ApplicationError('REVISION_CONFLICT','同一操作不能在重试时改用其他来源');}
        target=prior;
      }
      if(!prior){targets.push(target);this.store.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(canonicalJson(targets),context.operationId);}
      record.targets.set(slot,target);this.checkTarget(context,target);
    }).immediate());
    return pinned;
  }
  async draftSender(context:ApplicationExecutionContext<A>,expectedId:string|null):Promise<HostedConnection<C,A>|null>{
    this.require(context,'mail.draft');if(context.appId!=='mail'||context.scopeKind!=='project'||!context.projectId)throw new ApplicationError('SCOPE_DENIED','回复身份需要真实邮件项目');
    const selected=this.selections.connectionSlot(context.projectId,this.registry.appId('mail'),this.registry.provider('smtp').id);
    if(!selected.connectionId){if(expectedId)throw new ApplicationError('SCOPE_DENIED','回复发件连接不是当前项目明确选用的连接');return null;}
    return this.pinConnection(context,this.registry.provider('smtp').id,expectedId,true);
  }
  async connectionHealth(context:ApplicationExecutionContext<A>,connection:HostedConnection<C,A>,code:ApplicationError['code']|null):Promise<void>{
    this.assertActive(context);const target=this.record(context).targets.get(connection.providerId);if(!target||target.id!==connection.id)throw new ApplicationError('SCOPE_DENIED','健康结果不属于本次已固定来源');const changed=await this.connections.reportHealth(connection.id,connection,code);this.assertActive(context);if(changed)this.deps.changed?.({kind:'health',appId:context.appId,connectionId:connection.id});
  }
  /** A bounded caller may stop waiting before its native producer actually exits. */
  retainActivity<T>(context:ApplicationExecutionContext<A>,work:()=>Promise<T>):Promise<T>{
    this.assertActive(context);const application=this.builtin.assertTrusted(context.packageHash),id=randomUUID();
    const activity=this.store.use(application.resourceId,context.callerKind==='index-job'?'index-job':'ui',id,()=>{this.assertActive(context);return work();});
    this.pending.add(activity);void activity.finally(()=>this.pending.delete(activity)).catch(()=>{});return activity;
  }
  private activePackage(appId:A):InstalledApplicationPackage{
    const active=this.builtin.packages.active(appId);if(!active)throw new ApplicationError('CAPABILITY_UNAVAILABLE','当前应用没有已准备的默认版本');return this.builtin.packages.get(active.packageHash);
  }
  withUi<T>(sender:ApplicationUiSender,input:{projectId:string;appId:A;action:string;operations:readonly string[];semantics:'read'|'write';signal?:AbortSignal;retry?:'safe-read'},work:(context:ApplicationExecutionContext<A>)=>Promise<T>):Promise<T>{
    this.deps.requireSender(sender);const application=this.activePackage(input.appId),stamp=this.selections.policyStamp(input.projectId,input.appId);
    const check=()=>{this.deps.requireSender(sender);if(canonicalJson(this.selections.policyStamp(input.projectId,input.appId))!==canonicalJson(stamp))throw new ApplicationError('SCOPE_DENIED','应用授权已变化，原业务操作失效');};
    if(input.retry&&input.semantics!=='read')throw new ApplicationError('INVALID_INPUT','只有受信只读操作可使用读取重试');
    const timeout=input.retry?new AbortController():null,duration=Math.min(30000,Math.max(1,this.deps.uiReadTimeoutMs??30000)),deadline=performance.now()+duration;
    const timer=timeout?setTimeout(()=>timeout.abort(new ApplicationError('TIMEOUT','本次读取到达总时限，未继续请求')),duration):undefined;
    const signal=AbortSignal.any([input.signal??new AbortController().signal,...(timeout?[timeout.signal]:[])]);
    try{return this.begin(application,{operationId:randomUUID(),callerKind:'ui',scopeKind:'project',projectId:input.projectId,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:input.appId,packageHash:application.packageHash,dataApi:1,action:input.action,semantics:input.semantics,allowedOperations:input.operations,signal,startedAt:new Date(this.now()).toISOString()},check,stamp,input.retry?context=>this.retryUiRead(context,deadline,work):work,true).catch(error=>{if(signal.aborted&&signal.reason instanceof ApplicationError&&signal.reason.code==='TIMEOUT')throw signal.reason;throw error;}).finally(()=>{if(timer)clearTimeout(timer);});}catch(error){if(timer)clearTimeout(timer);throw error;}
  }
  /** UI owns one budget. Agent operations enter withAgent and keep their existing outer ToolService budget. */
  private async retryUiRead<T>(context:ApplicationExecutionContext<A>,deadline:number,work:(context:ApplicationExecutionContext<A>)=>Promise<T>):Promise<T>{
    let attempts=0;
    try{while(true){
      await withResourceLock(this.store.root,()=>{this.record(context);attempts++;this.store.sqlite.prepare('UPDATE application_data_operations SET attempt_count=? WHERE operation_id=?').run(attempts,context.operationId);});
      try{return await work(context);}catch(error){
        this.record(context);
        if(!(error instanceof ApplicationError)||!['TRANSIENT_FAILURE','TIMEOUT','RESOURCE_BUSY'].includes(error.code))throw error;
        const exhausted=()=>new ApplicationError(error.code,error.message+'；本次已尝试 '+attempts+' 次，读取预算已结束，请稍后明确重试');
        if(attempts>=3)throw exhausted();
        const backoff=Math.min(5000,Math.max(0,this.deps.uiReadRetryDelays?.[attempts-1]??([1000,3000][attempts-1]+Math.floor(Math.random()*100)))),wait=Math.max(backoff,retryAfterWait(error));
        if(performance.now()+wait>=deadline)throw exhausted();
        await delay(wait,undefined,{signal:context.signal});
      }
    }}catch(error){if(context.signal.aborted)this.record(context);throw error;}
  }
  withManagement<T>(sender:ApplicationUiSender,input:{appId:A;action:string;semantics:'read'|'write';projectId?:string;signal?:AbortSignal},work:(context:ApplicationExecutionContext<A>)=>Promise<T>):Promise<T>{
    this.deps.requireSender(sender);if(!managementActions.has(input.action))throw new ApplicationError('SCOPE_DENIED','连接管理只允许明确的配置动作');const application=this.activePackage(input.appId);
    return this.begin(application,{operationId:randomUUID(),callerKind:'ui',scopeKind:'connection-management',projectId:input.projectId??null,taskId:null,runId:null,jobId:null,parentOperationId:null,appId:input.appId,packageHash:application.packageHash,dataApi:1,action:input.action,semantics:input.semantics,allowedOperations:[input.action],signal:input.signal??new AbortController().signal,startedAt:new Date(this.now()).toISOString()},()=>this.deps.requireSender(sender),null,work,true);
  }
  withAgent<T>(claim:RunContext,binding:Readonly<ApplicationDataBinding>,operation:ApplicationOperationContext,semantics:'read'|'write',work:(context:ApplicationExecutionContext<A>)=>Promise<T>):Promise<T>{
    const known=this.deps.assertRun(claim.run.runId);assertRunApplication(known,binding.appId);const selected=known.snapshot.packages.find(p=>p.packageHash===binding.packageHash&&p.appId===binding.appId);
    if(known.plan){const allowed=known.plan.allowed.find(c=>c.mcpTool===binding.toolName&&c.contractMajor===operation.contractMajor&&c.packageHash===binding.packageHash);if(!allowed)throw new ApplicationError('SCOPE_DENIED','固定工具不在运行允许表中');requirePlanEntry(known.plan,allowed.capabilityId,operation.contractMajor,'mcp');}
    if(known.run.taskId!==claim.run.taskId||known.run.projectId!==claim.run.projectId||!selected||!selected.allowedOperations.includes(binding.permission)||selected.toolContractMajors[binding.toolName]!==operation.contractMajor||operation.packageHash!==binding.packageHash||operation.appId!==binding.appId||operation.toolName!==binding.toolName)throw new ApplicationError('SCOPE_DENIED','工具上下文不能替换真实运行、原包或动作');
    const application=this.builtin.assertTrusted(binding.packageHash),appId=this.registry.appId(application.appId),stamp=this.selections.policyStamp(known.run.projectId,appId);
    const check=()=>{const current=this.deps.assertRun(known.run.runId);assertRunApplication(current,binding.appId);if(current.run.taskId!==known.run.taskId||current.run.projectId!==known.run.projectId||canonicalJson(this.selections.policyStamp(known.run.projectId,appId))!==canonicalJson(stamp))throw new ApplicationError('SCOPE_DENIED','当前运行或应用授权已变化');};
    return this.begin(application,{operationId:operation.operationId,callerKind:'agent-run',scopeKind:'project',projectId:known.run.projectId,taskId:known.run.taskId,runId:known.run.runId,jobId:null,parentOperationId:null,appId,packageHash:binding.packageHash,dataApi:1,action:binding.toolName,semantics,allowedOperations:selected.allowedOperations,signal:AbortSignal.any([known.signal,operation.signal]),startedAt:new Date(this.now()).toISOString()},check,stamp,context=>{
      this.agentCalls.set(context,Object.freeze({kind:'agent',operationId:context.operationId,appId,packageHash:binding.packageHash,action:context.action,projectId:known.run.projectId,taskId:known.run.taskId,runId:known.run.runId,entry:'mcp',requestId:operation.requestId,plan:Object.freeze(known.plan?{kind:'run-plan',hash:known.plan.planHash}:{kind:'snapshot-v2',hash:known.run.snapshotHash})}));
      return work(context);
    },false);
  }
  withIndex<T>(parent:ApplicationExecutionContext<A>,permission:'mail.read'|'zentao.read',work:(context:ApplicationExecutionContext<A>)=>Promise<T>):Promise<T>{
    this.require(parent,permission);if(parent.scopeKind!=='project'||!parent.projectId)throw new ApplicationError('SCOPE_DENIED','来源刷新需要有效项目触发');const application=this.builtin.assertTrusted(parent.packageHash),id=randomUUID();
    return this.begin(application,{operationId:id,callerKind:'index-job',scopeKind:'internal-index',projectId:parent.projectId,taskId:null,runId:null,jobId:id,parentOperationId:parent.operationId,appId:parent.appId,packageHash:parent.packageHash,dataApi:1,action:parent.appId+'.refresh',semantics:'read',allowedOperations:[permission],signal:parent.signal,startedAt:new Date(this.now()).toISOString()},()=>this.require(parent,permission),{parent:parent.operationId},work,true);
  }
  withSharedIndex<T>(parents:()=>readonly ApplicationExecutionContext<A>[],permission:'mail.read',signal:AbortSignal,work:(context:ApplicationExecutionContext<A>)=>Promise<T>):Promise<T>{
    const first=parents()[0];if(!first||first.scopeKind!=='project'||!first.projectId)throw new ApplicationError('SCOPE_DENIED','共享邮件检查需要有效项目触发');this.require(first,permission);
    const check=()=>{for(const parent of parents())try{if(parent.appId===first.appId){this.require(parent,permission);return;}}catch{}throw new ApplicationError('CANCELED','本次共享邮件检查已没有有效触发方');};
    const application=this.builtin.assertTrusted(first.packageHash),id=randomUUID();
    return this.begin(application,{operationId:id,callerKind:'index-job',scopeKind:'internal-index',projectId:first.projectId,taskId:null,runId:null,jobId:id,parentOperationId:first.operationId,appId:this.registry.appId('mail'),packageHash:first.packageHash,dataApi:1,action:'mail.refresh',semantics:'read',allowedOperations:[permission],signal,startedAt:new Date(this.now()).toISOString()},check,{sharedIndex:true},context=>{this.sharedIndexes.add(context);return work(context);},true);
  }
  linkIndexParent(index:ApplicationExecutionContext<A>,parent:ApplicationExecutionContext<A>,sourceKey:string):Promise<void>{
    this.require(index,'mail.read');this.require(parent,'mail.read');if(!this.sharedIndexes.has(index)||parent.scopeKind!=='project'||parent.appId!=='mail'||!/^[a-f0-9]{64}$/.test(sourceKey))throw new ApplicationError('SCOPE_DENIED','无效共享检查关系');
    return withResourceLock(this.store.root,()=>{this.require(index,'mail.read');this.require(parent,'mail.read');this.store.sqlite.prepare("INSERT OR IGNORE INTO application_index_waiters VALUES(?,?,?,?,NULL,'waiting')").run(index.operationId,parent.operationId,sourceKey,new Date(this.now()).toISOString());});
  }
  endIndexParent(index:ApplicationExecutionContext<A>,parent:ApplicationExecutionContext<A>,state:'completed'|'cancelled'|'failed'):Promise<void>{
    if(!this.sharedIndexes.has(index)||!this.records.has(parent))throw new ApplicationError('SCOPE_DENIED','检查关系不是当前宿主签发');
    return withResourceLock(this.store.root,()=>{this.store.sqlite.prepare('UPDATE application_index_waiters SET state=?,ended_at=? WHERE index_operation_id=? AND parent_operation_id=?').run(state,new Date(this.now()).toISOString(),index.operationId,parent.operationId);});
  }
  private begin<T>(application:InstalledApplicationPackage,input:ApplicationExecutionContext<A>,check:()=>void,policy:unknown,work:(context:ApplicationExecutionContext<A>)=>Promise<T>,lease:boolean):Promise<T>{
    if(this.closed)throw new ApplicationError('CANCELED','应用业务服务已停止');this.registry.appId(input.appId);if(application.appId!==input.appId||application.packageHash!==input.packageHash)throw new ApplicationError('SCOPE_DENIED','业务上下文不能替换受信应用或原包');actionSchema.parse(input.action);if(!z.uuid().safeParse(input.operationId).success)throw new ApplicationError('INVALID_INPUT','业务操作编号无效');
    if(input.scopeKind!=='connection-management'&&input.allowedOperations.some(p=>!application.manifest.permissions.includes(p)))throw new ApplicationError('SCOPE_DENIED','业务动作超过固定包能力范围');
    const abort=new AbortController(),context=Object.freeze({...input,allowedOperations:Object.freeze([...input.allowedOperations]),signal:AbortSignal.any([input.signal,abort.signal])}),scopeHash=digest(canonicalJson({callerKind:context.callerKind,scopeKind:context.scopeKind,projectId:context.projectId,taskId:context.taskId,runId:context.runId,jobId:context.jobId,parentOperationId:context.parentOperationId,appId:context.appId,packageHash:context.packageHash,action:context.action,semantics:context.semantics,policy}));
    const record:ContextRecord<C,A>={context,active:true,abort,check,allowed:new Set(context.allowedOperations),targets:new Map(),scopeHash};
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
      catch(error){const code=error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE',selectionRejected=context.scopeKind==='connection-management'&&context.action==='application.project.select'&&error instanceof SelectionPreconditionError;await this.end(context,code==='CANCELED'?'cancelled':context.semantics==='write'&&!selectionRejected?'unknown':'failed',code);throw error;}
      finally{record.active=false;abort.abort();this.active.delete(record);}
    };
    const execution=lease?this.store.use(application.resourceId,input.callerKind==='index-job'?'index-job':'ui',input.operationId,run):run();
    const result=execution.then(value=>{if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','本次业务结果已取消交付');check();for(const target of record.targets.values())this.checkTarget(context,target);return value;});
    this.pending.add(result);void result.finally(()=>this.pending.delete(result)).catch(()=>undefined);return result;
  }
  private end(context:ApplicationExecutionContext<A>,state:string,code:string|null):Promise<void>{return withResourceLock(this.store.root,()=>{this.store.sqlite.prepare('UPDATE application_data_operations SET state=?,error_code=?,ended_at=? WHERE operation_id=?').run(state,code,new Date(this.now()).toISOString(),context.operationId);});}
  assertAgentReceipt(claim:RunContext,binding:Readonly<ApplicationDataBinding>,operationId:string):void{
    const known=this.deps.assertRun(claim.run.runId);assertRunApplication(known,binding.appId);const selected=known.snapshot.packages.find(p=>p.packageHash===binding.packageHash&&p.appId===binding.appId);
    if(!selected||!selected.allowedOperations.includes(binding.permission))throw new ApplicationError('SCOPE_DENIED','当前运行不能读取该原业务回执');
    const row=this.store.sqlite.prepare('SELECT * FROM application_data_operations WHERE operation_id=?').get(operationId) as {caller_kind:string;scope_kind:string;project_id:string;task_id:string;run_id:string;job_id:null;parent_operation_id:null;app_id:A;package_hash:string;action:string;semantics:'read'|'write';scope_hash:string;targets_json:string}|undefined;
    if(!row||row.caller_kind!=='agent-run'||row.project_id!==known.run.projectId||row.task_id!==known.run.taskId||row.run_id!==known.run.runId||row.app_id!==binding.appId||row.package_hash!==binding.packageHash||row.action!==binding.toolName)throw new ApplicationError('SCOPE_DENIED','回执不属于当前真实运行及固定工具');
    const policy=this.selections.policyStamp(row.project_id,row.app_id),hash=digest(canonicalJson({callerKind:row.caller_kind,scopeKind:row.scope_kind,projectId:row.project_id,taskId:row.task_id,runId:row.run_id,jobId:row.job_id,parentOperationId:row.parent_operation_id,appId:row.app_id,packageHash:row.package_hash,action:row.action,semantics:row.semantics,policy}));
    if(hash!==row.scope_hash)throw new ApplicationError('SCOPE_DENIED','原回执对应的应用授权代次已变化');
    let targets:Target<C['kind']>[];try{targets=this.decodeTargets(row.targets_json,row.app_id);}catch{throw new ApplicationError('HASH_MISMATCH','原回执来源记录已损坏');}
    for(const target of targets)this.checkTarget({projectId:row.project_id,appId:row.app_id,semantics:row.semantics},target);
  }
  withReadReceipt<T>(claim:RunContext,binding:Readonly<ApplicationDataBinding>,originalOperationId:string,work:(context:ApplicationExecutionContext<A>)=>Promise<T>,signal?:AbortSignal):Promise<T>{
    this.assertAgentReceipt(claim,binding,originalOperationId);
    const known=this.deps.assertRun(claim.run.runId);assertRunApplication(known,binding.appId);const application=this.builtin.assertTrusted(binding.packageHash),id=randomUUID();
    const check=()=>this.assertAgentReceipt(known,binding,originalOperationId);
    return this.begin(application,{operationId:id,callerKind:'agent-run',scopeKind:'project',projectId:known.run.projectId,taskId:known.run.taskId,runId:known.run.runId,jobId:null,parentOperationId:null,appId:this.registry.appId(application.appId),packageHash:application.packageHash,dataApi:1,action:binding.toolName+'.receipt',semantics:'read',allowedOperations:[binding.permission],signal:AbortSignal.any([known.signal,...(signal?[signal]:[])]),startedAt:new Date(this.now()).toISOString()},check,{receiptOf:originalOperationId},async context=>{
      await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
        this.assertActive(context);const original=this.store.sqlite.prepare('SELECT targets_json FROM application_data_operations WHERE operation_id=?').get(originalOperationId) as {targets_json:string};
        const pinned=this.decodeTargets(original.targets_json,context.appId).filter(target=>target.readDefaults!==undefined),record=this.record(context);
        for(const target of pinned){this.checkTarget(context,target);record.targets.set(target.slot,target);}
        if(pinned.length)this.store.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(canonicalJson(pinned),context.operationId);
        this.store.sqlite.prepare('INSERT INTO application_read_receipt_checks VALUES(?,?,?)').run(id,originalOperationId,new Date(this.now()).toISOString());
      }).immediate());return work(context);
    },false);
  }
  invalidate():void{for(const record of this.active)try{this.record(record.context);}catch{record.abort.abort();}}
  async dispose():Promise<void>{this.closed=true;for(const record of this.active)record.abort.abort();await Promise.allSettled([...this.pending]);}
}
