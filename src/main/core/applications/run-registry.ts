import {finishCapabilityRun,recoverCapabilityRuns} from './run-recovery';
import {createNativeGuardDiscoveryProof,type NativeGuardDiscoverySelection,type NativeGuardDiscoveryProof} from './native-discovery-exclusions';
import {captureNativeStaticRoots,nativeStaticSourceIds,verifyNativeStaticRoots,type NativeStaticRoot} from './native-static-roots';
import {assertClaudeReservation,bindClaudeDelivery,assertClaudeRunDelivery,protectClaudeNativeGuard,type ClaudeDeliveryToken,type ClaudeRunDelivery} from './claude-delivery-state';
import {assertScopeExclusions,assertIndependentRoots,applicationRunScopeSchema,applicationScopeOperationId,readApplicationRunScope,type ApplicationRunScope,type ApplicationScopeExclusion} from './application-run-scope';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { CapabilityRunRecord, CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { canonicalJson, digest } from './manifest';
import {launchRestrictionSchema,readLaunchRestriction,type ManagedCapabilityRestriction} from './launch-restriction';
import type { ResourceRecord, ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import type { CapabilitySessionRegistry, StoredCapabilitySession } from './session-registry';
import type { ProcessIdentity, ProcessIdentityReader, ProcessState } from './process-identity';

const bindingSchema = z.object({ appId: z.string().regex(/^[a-z][a-z0-9-]{0,19}$/),slot: z.enum(['zentao','foxmail','smtp']),connectionId: z.uuid().nullable(),identityRevision: z.number().int().positive().nullable(),bindingRevision: z.number().int().nonnegative() }).strict();
const bindingsSchema = z.array(bindingSchema).max(64).refine(items => new Set(items.map(i => i.appId + ':' + i.slot)).size === items.length);
const reserveSchema = z.object({ taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),bindings: bindingsSchema }).strict();
export type RunBindingRevision = z.infer<typeof bindingSchema>;
export interface RunRow {
  run_id: string;task_id: string;project_id: string;runner: string;state: CapabilityRunRecord['state'];snapshot_hash: string;
  owner_instance_id: string | null;owner_pid: number | null;owner_started_at: string | null;pid: number | null;process_started_at: string | null;pty_id: string;
  bindings_json: string;started_at: string;ended_at: string | null;error_code: string | null;revocation_state: 'open' | 'revoking' | 'revoked';
}
export interface ProcessRow { process_id: string;run_id: string;kind: 'cli' | 'bridge';launch_key: string;state: 'reserved' | 'armed' | 'active' | 'exited' | 'canceled' | 'unknown';pid: number | null;process_started_at: string | null;armed_at: string | null }
interface NativeGuard { staticRoots?:readonly NativeStaticRoot[];kind:'history'|'fixed';snapshotHash:string;resources:readonly string[];verify:()=>Promise<void> }
interface NativeGuardRequest {taskId:string;projectId:string;runner:'claude-code'|'codex';snapshotHash:string;resourceIds:readonly string[];restriction?:ManagedCapabilityRestriction;discovery?:NativeGuardDiscoverySelection;verify:(discovery?:NativeGuardDiscoveryProof)=>Promise<void>}
interface OwnedRun { delivery?:ClaudeRunDelivery;scope?:ApplicationRunScope;scopeProjectionIds?:readonly string[];guard?:NativeGuard;selectionHash: string;leaseId: string;abort: AbortController;processes: Set<string>;revocation?: Promise<void> }
export interface RunContext { run: CapabilityRunRecord;snapshot: CapabilitySessionSnapshotV2;bindings: RunBindingRevision[];signal: AbortSignal;applicationScope?:readonly string[];excludedApplications?:readonly ApplicationScopeExclusion[] }
export interface RunRegistryDeps {
  /** Read current local policy/revisions; no network, filesystem or asynchronous work in C. */
  assertCurrent(snapshot: CapabilitySessionSnapshotV2,bindings: readonly RunBindingRevision[]): void;
  /** Revoke credentials and signal only owned executions/CLI/bridge handles. Exit is recorded separately. */
  revoke(runId: string,reason: string): void | Promise<void>;
  processes: ProcessIdentityReader;
  revocationTimeoutMs?: number;
}
export interface OwnedRunProcess {
  processId: string;launchKey: string;
  /** Persist the fork window BEFORE asking the OS to spawn. */
  arm(): Promise<void>;
  /** PID comes from this owned native handle, never from tool arguments. */
  attach(pid: number,expectedStartedAt?:string): Promise<void>;
  /** Call only from the exit event of that same owned native handle. */
  exited(): Promise<void>;
  cancelBeforeLaunch(): Promise<void>;
}
export interface OwnedCapabilityRun {
  runId: string;ptyId: string;signal: AbortSignal;cli: OwnedRunProcess;
  prepare(): Promise<CapabilityRunRecord>;
  reserveBridge(): Promise<OwnedRunProcess>;
  /** Caller attests no OS spawn was attempted. Not a recovery/unknown-process API. */
  cancelBeforeFork(): Promise<CapabilityRunRecord>;
  stop(reason?: string): Promise<CapabilityRunRecord>;
}
// Only a handle minted by reserveGuard can request waiting-phase H admission.
const nativeGuardReservations = new WeakMap<OwnedCapabilityRun,{store:ResourceStore;assert:(runner:'claude-code'|'codex',resources:readonly string[],phase:'preparing'|'prepared')=>void}>();
export function assertNativeGuardReservation(store:ResourceStore,run:OwnedCapabilityRun,runner:'claude-code'|'codex',resources:readonly string[],phase:'preparing'|'prepared'):void {
  const proof=nativeGuardReservations.get(run);
  if(!proof||proof.store!==store)throw new ApplicationError('SCOPE_DENIED','维护等待只允许当前宿主签发的普通原生守护');
  proof.assert(runner,resources,phase);
}
const TERMINAL = new Set(['stopped','failed']);
const PROCESS_DONE = new Set(['exited','canceled']);
const now = () => new Date().toISOString();
const bounded = async (work: Promise<void>,ms: number): Promise<void> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try { await Promise.race([work,new Promise<never>((_,reject) => { timer = setTimeout(() => reject(new ApplicationError('RUN_STOP_FAILED','撤销仍未完成，保留运行占用并等待实际退出')),ms); })]); }
  finally { if (timer) clearTimeout(timer); }
};
/** Resource registration precedes all file consumption and OS forks. No PID signalling here. */
export class CapabilityRunRegistry {
  readonly instanceId = randomUUID();
  readonly host: ProcessIdentity;
  private readonly owned = new Map<string,OwnedRun>();
  private closed = false;
  constructor(readonly store: ResourceStore,private readonly sessions: CapabilitySessionRegistry,private readonly deps: RunRegistryDeps) {
    const identity = deps.processes.read(process.pid);
    if (!identity || identity.pid !== process.pid) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','无法核验宿主进程启动身份，应用运行能力暂不可用');
    this.host = Object.freeze({ ...identity });
  }
  private row(runId: string): RunRow {
    const row = this.store.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(runId) as RunRow | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND','运行记录不存在'); return row;
  }
  private owner(runId: string): { row: RunRow;owned: OwnedRun } {
    const row = this.row(runId), owned = this.owned.get(runId);
    if (!owned || row.owner_instance_id !== this.instanceId || row.owner_pid !== this.host.pid || row.owner_started_at !== this.host.startedAt) throw new ApplicationError('SCOPE_DENIED','此运行不属于当前宿主实例');
    return { row,owned };
  }
  private mine(runId: string): { row: RunRow;owned: OwnedRun;session: StoredCapabilitySession } {
    const { row,owned } = this.owner(runId);
    if(owned.guard)throw new ApplicationError('SCOPE_DENIED','原生守护不签发应用工具、业务来源或凭据');
    const session = this.sessions.inspectCoordinated(row.task_id);
    if (session.selectionHash !== owned.selectionHash || session.snapshot.projectId !== row.project_id || session.snapshot.runner !== row.runner || session.pointer.snapshotHash !== row.snapshot_hash) throw new ApplicationError('SNAPSHOT_CORRUPT','运行与固定会话身份不同');
    const scope=readApplicationRunScope(this.store,runId,session.snapshot,owned.scope?.evidenceHash);if(Boolean(scope)!==Boolean(owned.scope))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','本轮应用范围与宿主登记不同');
    return { row,owned,session };
  }
  /** Lifecycle authority for native-only history is distinct from business authority. */
  private lifecycle(runId:string):{row:RunRow;owned:OwnedRun;session?:StoredCapabilitySession}{
    const result=this.owner(runId),guard=result.owned.guard;if(!guard)return this.mine(runId);
    if(guard.kind==='fixed'){
      if(!readLaunchRestriction(this.store,runId,result.row.task_id,result.owned.selectionHash))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原生启动限制回执缺失');
      const session=this.sessions.inspectCoordinated(result.row.task_id);
      if(session.retention!=='active'||session.selectionHash!==result.owned.selectionHash||session.snapshot.projectId!==result.row.project_id||session.snapshot.runner!==result.row.runner||session.pointer.snapshotHash!==result.row.snapshot_hash)throw new ApplicationError('SNAPSHOT_CORRUPT','原生守护的固定会话身份已变化');
      return result; // Lifecycle only: deliberately do not return business authority.
    }
    const row=this.store.sqlite.prepare('SELECT schema_version,snapshot_json,snapshot_hash,retention_state,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(result.row.task_id) as {schema_version:number;snapshot_json:string;snapshot_hash:string;retention_state:string;legacy_status:string}|undefined;
    if(!row||row.schema_version!==0||row.retention_state!=='hold'||row.legacy_status!=='history-unknown'||row.snapshot_hash!==guard.snapshotHash||result.row.snapshot_hash!==guard.snapshotHash||digest(row.snapshot_json)!==guard.snapshotHash)throw new ApplicationError('SNAPSHOT_CORRUPT','原生历史守护依据已变化，保留占用但拒绝交接');
    return result;
  }
  private currentLifecycle(row:RunRow,session?:StoredCapabilitySession):void{
    if(session){this.current(row,session);return;}this.gate();
    if(!this.store.sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(row.project_id))throw new ApplicationError('SCOPE_DENIED','原生历史项目已删除或归档');
  }
  private gate(): void {
    const state = this.store.sqlite.prepare('SELECT * FROM capability_store_state WHERE singleton=1').get() as { store_id: string;maintenance_state: string } | undefined;
    if (!state || state.store_id !== this.store.storeId || state.maintenance_state !== 'ready') throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','应用资源库正在维护或待恢复');
  }
  private current(row: RunRow,session: StoredCapabilitySession): RunBindingRevision[] {
    this.gate();
    if (session.retention !== 'active') throw new ApplicationError('SESSION_ON_HOLD','此会话能力已保留或待核查');
    const bindings = bindingsSchema.parse(JSON.parse(row.bindings_json)); this.deps.assertCurrent(session.snapshot,bindings); return bindings;
  }
  private closure(taskId: string,guard?:NativeGuard,scope?:ApplicationRunScope): ResourceRecord[] {
    const roots = guard?guard.resources.map(id=>{const r=this.store.get(id);return{ref_id:id,ref_hash:r.contentHash,ref_kind:r.kind,relative_path:r.relativePath};}):scope?scope.roots.map(r=>({ref_id:r.refId,ref_hash:r.refHash,ref_kind:r.refKind,relative_path:r.relativePath})):this.store.sqlite.prepare('SELECT ref_id,ref_hash,ref_kind,relative_path FROM capability_session_refs WHERE task_id=?').all(taskId) as { ref_id: string;ref_hash: string;ref_kind: string;relative_path: string }[];
    if (!roots.length) throw new ApplicationError('SNAPSHOT_CORRUPT','原会话资源引用缺失');
    const inert=guard?.staticRoots?nativeStaticSourceIds(this.store,guard.resources,guard.staticRoots):new Set<string>();
    const visited = new Map<string,ResourceRecord>(), visiting = new Set<string>();
    const visit = (id: string,depth = 0): void => {
      if (depth > 256) throw new ApplicationError('INVALID_PACKAGE','资源依赖深度超过预算');
      if (visiting.has(id)) throw new ApplicationError('SNAPSHOT_CORRUPT','资源依赖包含循环');
      if (visited.has(id)) return;
      if (visited.size + visiting.size >= 10000) throw new ApplicationError('INVALID_PACKAGE','资源依赖超过预算');
      const resource = this.store.get(id);
      if (!inert.has(id)&&(resource.state !== 'ready' || resource.integrity !== 'valid')) throw new ApplicationError('RESOURCE_STATE_CHANGED','原会话资源未就绪，不能准备新的运行');
      visiting.add(id);
      for (const dependency of this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=?').all(id) as { dependency_id: string }[]) visit(dependency.dependency_id,depth + 1);
      visiting.delete(id); visited.set(id,resource);
    };
    for (const root of roots) { visit(root.ref_id); const r = visited.get(root.ref_id)!; if (r.contentHash !== root.ref_hash || r.kind !== root.ref_kind || r.relativePath !== root.relative_path) throw new ApplicationError('SNAPSHOT_CORRUPT','原会话引用与资源身份不同'); }
    return [...visited.values()];
  }
  private protect(runId: string,owned: OwnedRun): void {
    const row = this.row(runId), resources = this.closure(row.task_id,owned.guard,owned.scope);
    const put = this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_lease_resources(lease_id,resource_id,content_hash,generation) VALUES(?,?,?,?)');
    for (const resource of resources) put.run(owned.leaseId,resource.resourceId,resource.contentHash,resource.generation);
    this.checkProtection(row,owned);
  }
  private checkProtection(row: RunRow,owned: OwnedRun): void {
    if(owned.delivery)assertClaudeRunDelivery(this.store,row.run_id,owned.delivery);
    const lease = this.store.sqlite.prepare('SELECT state,owner_id,host_instance_id FROM capability_resource_leases WHERE lease_id=?').get(owned.leaseId) as { state: string;owner_id: string;host_instance_id: string } | undefined;
    if (!lease || lease.owner_id !== row.run_id || lease.host_instance_id !== this.instanceId || !['preparing','active'].includes(lease.state)) throw new ApplicationError('RESOURCE_STATE_CHANGED','运行资源占用已改变');
    const protectedRows = this.store.sqlite.prepare('SELECT resource_id,content_hash,generation FROM capability_lease_resources WHERE lease_id=?').all(owned.leaseId) as { resource_id: string;content_hash: string;generation: number }[];
    for (const resource of this.closure(row.task_id,owned.guard,owned.scope)) if (!protectedRows.some(r => r.resource_id === resource.resourceId && r.content_hash === resource.contentHash && r.generation === resource.generation)) throw new ApplicationError('RESOURCE_STATE_CHANGED','原资源依赖或代次已改变，保留占用但拒绝启动');
    const inert=owned.guard?.staticRoots?nativeStaticSourceIds(this.store,owned.guard.resources,owned.guard.staticRoots):new Set<string>();
    for (const protectedRow of protectedRows) { const r = this.store.get(protectedRow.resource_id); if (!inert.has(r.resourceId)&&(r.state !== 'ready' || r.integrity !== 'valid') || r.contentHash !== protectedRow.content_hash || r.generation !== protectedRow.generation) throw new ApplicationError('RESOURCE_STATE_CHANGED','被占用资源状态发生改变'); }
  }
  private view(row: RunRow): CapabilityRunRecord { return { runId: row.run_id,taskId: row.task_id,projectId: row.project_id,runner: row.runner,state: row.state,snapshotHash: row.snapshot_hash,pid: row.pid,processStartedAt: row.process_started_at,startedAt: row.started_at,endedAt: row.ended_at }; }
  get(runId: string): CapabilityRunRecord { return this.view(this.row(runId)); }
  async reserve(input: z.infer<typeof reserveSchema>,reservation?:{runId:string;ptyId:string}):Promise<OwnedCapabilityRun>{return this.reserveManaged(input,reservation);}
  /** Host-only narrowing; never exposed as an RPC or model parameter. */
  async reserveScoped(input:z.infer<typeof reserveSchema>,appIds:readonly string[],projectionIds:readonly string[]=[],reservation?:{runId:string;ptyId:string},delivery?:ClaudeDeliveryToken,excludedApplications?:readonly ApplicationScopeExclusion[]):Promise<OwnedCapabilityRun>{return this.reserveManaged(input,reservation,{appIds:[...appIds],projectionIds:[...projectionIds],excludedApplications},delivery);}
  /** Explicit host-only zero application authority;ordinary empty scopes remain invalid. */
  async reserveIndependent(input:z.infer<typeof reserveSchema>,projectionIds:readonly string[]=[],reservation?:{runId:string;ptyId:string},delivery?:ClaudeDeliveryToken,excludedApplications?:readonly ApplicationScopeExclusion[]):Promise<OwnedCapabilityRun>{return this.reserveManaged(input,reservation,{appIds:[],projectionIds:[...projectionIds],independent:true,excludedApplications},delivery);}
  private async reserveManaged(input: z.infer<typeof reserveSchema>,reservation?: {runId:string;ptyId:string},narrowing?:{appIds:readonly string[];projectionIds:readonly string[];independent?:true;excludedApplications?:readonly ApplicationScopeExclusion[]},deliveryToken?:ClaudeDeliveryToken): Promise<OwnedCapabilityRun> {
    const parsed = reserveSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','运行准备参数无效或含未允许字段');
    if (this.closed) throw new ApplicationError('CANCELED','此宿主的应用运行服务已停止');
    if (reservation && (!z.uuid().safeParse(reservation.runId).success || !z.uuid().safeParse(reservation.ptyId).success)) throw new ApplicationError('INVALID_INPUT','宿主预留运行身份无效');
    const value = parsed.data, runId = reservation?.runId ?? randomUUID(), ptyId = reservation?.ptyId ?? randomUUID(), processId = randomUUID(), leaseId = randomUUID(); let selectionHash = '';let scope:ApplicationRunScope|undefined;let delivery:ClaudeRunDelivery|undefined;
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      if (this.closed) throw new ApplicationError('CANCELED','运行准备已取消');
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_store_state(singleton,store_id,resource_generation,maintenance_state) VALUES(?,?,1,'ready')").run(1,this.store.storeId); this.gate();
      const session = this.sessions.inspectCoordinated(value.taskId); selectionHash = session.selectionHash;
      assertClaudeReservation(this.store,value.taskId,deliveryToken);
      if (session.retention !== 'active' || session.pointer.snapshotHash !== value.snapshotHash) throw new ApplicationError('RESOURCE_STATE_CHANGED','原会话版本或保留状态已改变');
      if (!this.store.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(session.snapshot.projectId)) throw new ApplicationError('NOT_FOUND','项目已删除，保留历史但不能启动');
      if (this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").get(value.taskId)) throw new ApplicationError('RESOURCE_BUSY','原任务仍有运行或待核查占用');
      this.deps.assertCurrent(session.snapshot,value.bindings);const timestamp=now();
      if(narrowing){const roots=this.sessions.scopedReferencesCoordinated(value.taskId,narrowing.appIds,narrowing.projectionIds,narrowing.independent===true),payload={...(narrowing.independent?{schema:2 as const,mode:'independent-capabilities' as const}:{schema:1 as const}),runId,taskId:value.taskId,projectId:session.snapshot.projectId,runner:session.snapshot.runner,snapshotHash:value.snapshotHash,selectionHash,ownerInstanceId:this.instanceId,ownerPid:this.host.pid,ownerStartedAt:this.host.startedAt,applications:session.snapshot.packages.filter(p=>narrowing.appIds.includes(p.appId)).map(p=>({appId:p.appId,packageHash:p.packageHash})),roots,...(narrowing.excludedApplications?{excludedApplications:narrowing.excludedApplications}:{}),createdAt:timestamp};scope=applicationRunScopeSchema.parse({...payload,evidenceHash:digest(canonicalJson(payload))});assertScopeExclusions(session.snapshot,scope);if(scope.schema===2)assertIndependentRoots(this.store,scope.roots); }
      const resources=this.closure(value.taskId,undefined,scope);
      this.store.sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id,revocation_state) VALUES(?,?,?,?,'preparing',?,?,?,?,?,?,?,'open')").run(runId,value.taskId,session.snapshot.projectId,session.snapshot.runner,timestamp,value.snapshotHash,this.instanceId,this.host.pid,this.host.startedAt,canonicalJson(value.bindings),ptyId);
      if(scope)this.store.sqlite.prepare("INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,'application-run-scope',?,'committed',?,?,?)").run(applicationScopeOperationId(runId),this.store.storeId,canonicalJson(scope),timestamp,timestamp);
      this.store.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'run',?,?,?,?,'preparing',?)").run(leaseId,resources[0].resourceId,runId,this.instanceId,this.host.pid,this.host.startedAt,timestamp);
      for (const r of resources) this.store.sqlite.prepare('INSERT INTO capability_lease_resources(lease_id,resource_id,content_hash,generation) VALUES(?,?,?,?)').run(leaseId,r.resourceId,r.contentHash,r.generation);
      this.store.sqlite.prepare("INSERT INTO capability_run_processes(process_id,run_id,kind,launch_key,state) VALUES(?,?,'cli',?,'reserved')").run(processId,runId,ptyId);
      if(deliveryToken){if(!scope)throw new ApplicationError('SCOPE_DENIED','Claude交付必须使用真实本轮应用范围');delivery=bindClaudeDelivery(this.store,deliveryToken,runId,randomUUID(),scope.applications.map(p=>p.appId));}
    }).immediate());
    const owned: OwnedRun = { ...(delivery?{delivery}:{}),...(scope?{scope,scopeProjectionIds:Object.freeze([...narrowing!.projectionIds])}:{}),selectionHash,leaseId,abort: new AbortController(),processes: new Set([processId]) }; this.owned.set(runId,owned);
    if (this.closed) { await this.stop(runId,'host-shutdown'); throw new ApplicationError('CANCELED','运行准备期间宿主服务已停止'); }
    return { runId,ptyId,signal: owned.abort.signal,cli: this.processHandle(runId,processId,ptyId),prepare: () => this.prepare(runId),reserveBridge: () => this.reserveBridge(runId),cancelBeforeFork: () => this.cancelBeforeFork(runId),stop: (reason = 'user-stop') => this.stop(runId,reason) };
  }
  /** Trusted host-only guard for schema0 history. It cannot assertActive or reserve a bridge. */
  async reserveNativeGuard(input:NativeGuardRequest,reservation?:{runId:string;ptyId:string}):Promise<OwnedCapabilityRun>{
    return this.reserveGuard(input,'history',reservation);
  }
  /** Keep a validated fixed S while launching only its ordinary native Agent. */
  async reserveFixedNativeGuard(input:NativeGuardRequest,reservation?:{runId:string;ptyId:string}):Promise<OwnedCapabilityRun>{
    return this.reserveGuard(input,'fixed',reservation);
  }
  private async reserveGuard(input:NativeGuardRequest,kind:NativeGuard['kind'],reservation?:{runId:string;ptyId:string}):Promise<OwnedCapabilityRun>{
    const parsed=z.object({taskId:z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),projectId:z.string().min(1).max(128),runner:z.enum(['claude-code','codex']),snapshotHash:z.string().regex(/^[a-f0-9]{64}$/),resourceIds:z.array(z.string().min(1).max(512)).min(1).max(4096)}).strict().safeParse({taskId:input.taskId,projectId:input.projectId,runner:input.runner,snapshotHash:input.snapshotHash,resourceIds:input.resourceIds});
    if(!parsed.success||typeof input.verify!=='function'||reservation&&(!z.uuid().safeParse(reservation.runId).success||!z.uuid().safeParse(reservation.ptyId).success))throw new ApplicationError('INVALID_INPUT','原生历史守护身份无效');
    if(this.closed)throw new ApplicationError('CANCELED','运行服务已关闭');const value=parsed.data,runId=reservation?.runId??randomUUID(),ptyId=reservation?.ptyId??randomUUID(),processId=randomUUID(),leaseId=randomUUID();
    const staticRoots=captureNativeStaticRoots(this.store,value.resourceIds),guard:NativeGuard={kind,snapshotHash:value.snapshotHash,resources:Object.freeze([...new Set(value.resourceIds)]),staticRoots,verify:async()=>{
      const discovery=input.discovery?createNativeGuardDiscoveryProof(this.store,input.discovery,{runId,taskId:value.taskId,projectId:value.projectId,runner:value.runner,snapshotHash:value.snapshotHash,kind},()=>{const owned=this.owned.get(runId);if(!owned||owned.guard!==guard||owned.abort.signal.aborted)throw new ApplicationError('SCOPE_DENIED','此凭据不属于当前普通原生守护');const checked=this.lifecycle(runId);this.currentLifecycle(checked.row,checked.session);this.checkProtection(checked.row,checked.owned);}):undefined;
      verifyNativeStaticRoots(this.store,staticRoots,discovery);if(discovery)await input.verify(discovery);else await input.verify();
    }};let selectionHash=value.snapshotHash;
    await withResourceLock(this.store.root,()=>this.store.sqlite.transaction(()=>{
      if(this.closed)throw new ApplicationError('CANCELED','守护准备已取消');
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_store_state(singleton,store_id,resource_generation,maintenance_state) VALUES(?,?,1,'ready')").run(1,this.store.storeId);this.gate();
      if(kind==='fixed'){
        const session=this.sessions.inspectCoordinated(value.taskId);
        if(session.retention!=='active'||session.pointer.snapshotHash!==value.snapshotHash)throw new ApplicationError('RESOURCE_STATE_CHANGED','原固定快照或保留状态已改变');
        if(session.snapshot.projectId!==value.projectId||session.snapshot.runner!==value.runner)throw new ApplicationError('SCOPE_DENIED','原生守护不能更换原会话归属');
        if(!value.resourceIds.includes(`agent-adapter:${session.snapshot.runner}:${session.snapshot.adapterBinding.hash}`))throw new ApplicationError('INVALID_INPUT','原生守护必须保留原固定适配资源');
        selectionHash=session.selectionHash;
      }else{
        const snapshot=this.store.sqlite.prepare('SELECT schema_version,snapshot_json,snapshot_hash,retention_state,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(value.taskId) as {schema_version:number;snapshot_json:string;snapshot_hash:string;retention_state:string;legacy_status:string}|undefined;
        if(!snapshot||snapshot.schema_version!==0||snapshot.retention_state!=='hold'||snapshot.legacy_status!=='history-unknown'||snapshot.snapshot_hash!==value.snapshotHash||digest(snapshot.snapshot_json)!==value.snapshotHash)throw new ApplicationError('SESSION_ON_HOLD','此历史不能作为未知能力的原生守护依据');
        let history:{taskId?:unknown;projectId?:unknown;runner?:unknown;reason?:unknown};try{history=JSON.parse(snapshot.snapshot_json);}catch{throw new ApplicationError('SNAPSHOT_CORRUPT','历史守护依据损坏');}
        if(history.taskId!==value.taskId||history.projectId!==value.projectId||history.runner!==value.runner||history.reason!=='history-unknown')throw new ApplicationError('SCOPE_DENIED','原生守护不能更换原历史归属');
      }
      if(!this.store.sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(value.projectId))throw new ApplicationError('NOT_FOUND','历史项目已删除或归档');
      if(this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").get(value.taskId))throw new ApplicationError('RESOURCE_BUSY','原任务仍有运行或待核查占用');
      const resources=this.closure(value.taskId,guard),timestamp=now();
      this.store.sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id,revocation_state) VALUES(?,?,?,?,'preparing',?,?,?,?,?,'[]',?,'open')").run(runId,value.taskId,value.projectId,value.runner,timestamp,value.snapshotHash,this.instanceId,this.host.pid,this.host.startedAt,ptyId);
      this.store.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'run',?,?,?,?,'preparing',?)").run(leaseId,resources[0].resourceId,runId,this.instanceId,this.host.pid,this.host.startedAt,timestamp);
      for(const r of resources)this.store.sqlite.prepare('INSERT INTO capability_lease_resources(lease_id,resource_id,content_hash,generation) VALUES(?,?,?,?)').run(leaseId,r.resourceId,r.contentHash,r.generation);
      this.store.sqlite.prepare("INSERT INTO capability_run_processes(process_id,run_id,kind,launch_key,state) VALUES(?,?,'cli',?,'reserved')").run(processId,runId,ptyId);
      protectClaudeNativeGuard(this.store,value.taskId,runId);
      if(kind==='fixed'){
        const receipt=launchRestrictionSchema.parse({schema:1,runId,taskId:value.taskId,snapshotHash:value.snapshotHash,selectionHash,reason:input.restriction?.reason??'fixed_application_resources_unavailable',issueCode:input.restriction?.issueCode??'CAPABILITY_UNAVAILABLE',restrictedAt:timestamp}),text=canonicalJson(receipt);
        this.store.sqlite.prepare('INSERT INTO capability_run_restrictions VALUES(?,?,?,?)').run(runId,text,digest(text),timestamp);
      }
    }).immediate());
    this.owned.set(runId,{guard,selectionHash,leaseId,abort:new AbortController(),processes:new Set([processId])});
    if(this.closed){await this.stop(runId,'host-shutdown');throw new ApplicationError('CANCELED','守护准备期间服务已关闭');}
    const handle:OwnedCapabilityRun={runId,ptyId,signal:this.owned.get(runId)!.abort.signal,cli:this.processHandle(runId,processId,ptyId),prepare:()=>this.prepare(runId),reserveBridge:()=>this.reserveBridge(runId),cancelBeforeFork:()=>this.cancelBeforeFork(runId),stop:(reason='user-stop')=>this.stop(runId,reason)};
    nativeGuardReservations.set(handle,{store:this.store,assert:(runner,resources,phase)=>{
      const {row,owned,session}=this.lifecycle(runId);
      if(this.closed||owned.guard!==guard||owned.abort.signal.aborted||handle.signal!==owned.abort.signal||handle.runId!==runId||handle.ptyId!==ptyId||row.pty_id!==ptyId||row.runner!==runner||row.task_id!==value.taskId||row.project_id!==value.projectId||row.snapshot_hash!==value.snapshotHash||row.state!==phase||row.pid!==null||row.process_started_at!==null||handle.cli.processId!==processId||handle.cli.launchKey!==ptyId||owned.processes.size!==1||!owned.processes.has(processId)||row.revocation_state!=='open'||row.bindings_json!=='[]'||owned.scope||!resources.every(id=>guard.resources.includes(id)))throw new ApplicationError('SCOPE_DENIED','普通原生守护身份、阶段或完整H来源不同');
      const children=this.store.sqlite.prepare('SELECT process_id,kind,state,pid,process_started_at FROM capability_run_processes WHERE run_id=?').all(runId) as {process_id:string;kind:string;state:string;pid:number|null;process_started_at:string|null}[];
      if(children.length!==1||children[0].process_id!==processId||children[0].kind!=='cli'||children[0].state!=='reserved'||children[0].pid!==null||children[0].process_started_at!==null)throw new ApplicationError('SCOPE_DENIED','普通原生守护已存在桥或原生启动窗口');
      const lease=this.store.sqlite.prepare('SELECT owner_kind,pid,process_started_at FROM capability_resource_leases WHERE lease_id=?').get(leaseId) as {owner_kind:string;pid:number|null;process_started_at:string|null}|undefined;
      if(!lease||lease.owner_kind!=='run'||lease.pid!==this.host.pid||lease.process_started_at!==this.host.startedAt)throw new ApplicationError('RESOURCE_STATE_CHANGED','普通原生守护的原C占用身份已变化');
      this.currentLifecycle(row,session);this.checkProtection(row,owned);
    }});
    return handle;
  }
  /** Narrow an owned prepared run before any child can exist. Not an RPC surface. */
  async restrictToNative(runId:string,cause?:ManagedCapabilityRestriction):Promise<void>{
    await withResourceLock(this.store.root,()=>{
      const {owned}=this.owner(runId);
      const guard=this.store.sqlite.transaction(()=>{
        const {row,session}=this.lifecycle(runId);
        if(owned.guard?.kind==='fixed')throw new ApplicationError('RESOURCE_STATE_CHANGED','本轮已经限制为原生运行');
        if(owned.abort.signal.aborted||row.state!=='prepared')throw new ApplicationError('CANCELED','原生降级只允许在启动前执行');
        const children=this.store.sqlite.prepare('SELECT kind,state FROM capability_run_processes WHERE run_id=?').all(runId) as {kind:string;state:string}[];
        if(children.filter(p=>p.kind==='cli').length!==1||children.some(p=>p.kind==='cli'?p.state!=='reserved':!PROCESS_DONE.has(p.state)))throw new ApplicationError('RESOURCE_STATE_CHANGED','已有启动窗口，不能降级或重新启动');
        this.currentLifecycle(row,session);this.checkProtection(row,owned);
        const evidence=launchRestrictionSchema.parse({schema:1,runId,taskId:row.task_id,snapshotHash:row.snapshot_hash,selectionHash:owned.selectionHash,reason:cause?.reason??'managed_launch_payload_too_large',issueCode:cause?.issueCode??'AGENT_ADAPTER_UNSUPPORTED',restrictedAt:now()}),text=canonicalJson(evidence);
        this.store.sqlite.prepare('INSERT INTO capability_run_restrictions VALUES(?,?,?,?)').run(runId,text,digest(text),evidence.restrictedAt);
        const resources=this.closure(row.task_id,owned.guard,owned.scope).map(r=>r.resourceId);
        this.store.sqlite.prepare("UPDATE capability_runs SET bindings_json='[]' WHERE run_id=?").run(runId);
        protectClaudeNativeGuard(this.store,row.task_id,runId);
        return owned.guard??{kind:'fixed' as const,snapshotHash:row.snapshot_hash,resources:Object.freeze(resources),verify:()=>owned.scope?this.sessions.verifyScopedResources(row.task_id,owned.scope.applications.map(p=>p.appId),owned.scopeProjectionIds??[],owned.scope.schema===2):this.sessions.verifyResources(row.task_id)};
      }).immediate();
      owned.guard=guard;
    });
  }
  /** Only the current host's still-unforked launch closure may provide this receipt.
   * An armed window with no PID is not proof by itself, especially after a crash.
   */
  private async cancelBeforeFork(runId: string): Promise<CapabilityRunRecord> {
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const { row, owned } = this.owner(runId);
      // Stop/host shutdown may revoke while the launch closure is still awaiting
      // arming. Its explicit no-fork receipt remains valid for these owned windows.
      if (!['prepared','stopping','stopped'].includes(row.state) || row.pid !== null) throw new ApplicationError('RESOURCE_STATE_CHANGED', '不能将已启动或状态不明的运行改为未启动');
      const children = this.store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE run_id=?').all(runId) as ProcessRow[];
      if (!children.length || children.some(child => !owned.processes.has(child.process_id) || child.pid !== null || !['reserved','armed','canceled'].includes(child.state))) throw new ApplicationError('RESOURCE_STATE_CHANGED', '子进程已经启动或身份未知，保留占用');
      this.store.sqlite.prepare("UPDATE capability_run_processes SET state='canceled',ended_at=? WHERE run_id=? AND state IN ('reserved','armed')").run(now(), runId);
    }).immediate());
    return this.stop(runId, 'native-fork-not-attempted');
  }
  private async prepare(runId: string): Promise<CapabilityRunRecord> {
    const taskId = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const { row,owned,session } = this.lifecycle(runId);
      if (owned.abort.signal.aborted || !['preparing','prepared'].includes(row.state)) throw new ApplicationError('CANCELED','运行已被撤销，不能继续准备');
      this.currentLifecycle(row,session); this.protect(runId,owned); return row.task_id;
    }).immediate());
    const owned=this.owned.get(runId)!,guard=owned.guard;if(guard)await guard.verify();else if(owned.scope)await this.sessions.verifyScopedResources(taskId,owned.scope.applications.map(p=>p.appId),owned.scopeProjectionIds??[],owned.scope.schema===2);else await this.sessions.verifyResources(taskId);
    return withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const { row,owned,session } = this.lifecycle(runId); if (owned.abort.signal.aborted || !['preparing','prepared'].includes(row.state)) throw new ApplicationError('CANCELED','准备期间运行已被撤销');
      this.currentLifecycle(row,session); this.checkProtection(row,owned);
      this.store.sqlite.prepare("UPDATE capability_runs SET state='prepared' WHERE run_id=?").run(runId);
      this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='active' WHERE owner_kind='run' AND owner_id=? AND state='preparing'").run(runId); return this.get(runId);
    }).immediate());
  }
  private async reserveBridge(runId: string): Promise<OwnedRunProcess> {
    const id = randomUUID(), key = randomUUID();
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const { row,owned,session } = this.mine(runId);
      if (owned.abort.signal.aborted || !['prepared','active'].includes(row.state)) throw new ApplicationError('CANCELED','当前运行不能新增工具桥');
      this.current(row,session); this.checkProtection(row,owned);
      if ((this.store.sqlite.prepare("SELECT count(*) AS n FROM capability_run_processes WHERE run_id=? AND kind='bridge' AND state NOT IN ('exited','canceled')").get(runId) as { n: number }).n >= 8) throw new ApplicationError('RESOURCE_BUSY','工具桥实例超过本轮预算');
      this.store.sqlite.prepare("INSERT INTO capability_run_processes(process_id,run_id,kind,launch_key,state) VALUES(?,?,'bridge',?,'reserved')").run(id,runId,key); owned.processes.add(id);
    }).immediate()); return this.processHandle(runId,id,key);
  }
  private processRow(runId: string,id: string): ProcessRow {
    const owned = this.owned.get(runId); if (!owned?.processes.has(id)) throw new ApplicationError('SCOPE_DENIED','此子进程不属于当前运行句柄');
    const process = this.store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE process_id=? AND run_id=?').get(id,runId) as ProcessRow | undefined;
    if (!process) throw new ApplicationError('NOT_FOUND','子进程登记不存在'); return process;
  }
  private processHandle(runId: string,id: string,key: string): OwnedRunProcess {
    return { processId: id,launchKey: key,arm: async () => {
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        const { row,owned,session } = this.lifecycle(runId), process = this.processRow(runId,id);
        if (owned.abort.signal.aborted || !['prepared','active'].includes(row.state) || process.state !== 'reserved') throw new ApplicationError('CANCELED','此启动窗口已取消或已使用');
        this.currentLifecycle(row,session); this.checkProtection(row,owned);
        this.store.sqlite.prepare("UPDATE capability_run_processes SET state='armed',armed_at=? WHERE process_id=? AND state='reserved'").run(now(),id);
      }).immediate());
    },attach: async (pid,expectedStartedAt) => {
      if(expectedStartedAt!==undefined&&!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(expectedStartedAt))throw new ApplicationError('INVALID_INPUT','预期进程启动身份无效');
      const identity = this.deps.processes.read(pid); let identityUnknown = false;
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        const { row } = this.lifecycle(runId), child = this.processRow(runId,id);
        if (child.state === 'exited') return; // Owned exit callback won the attachment race.
        if (!['armed','active','unknown'].includes(child.state)) throw new ApplicationError('RESOURCE_STATE_CHANGED','尚未登记启动窗口或已经取消');
        if(expectedStartedAt!==undefined&&identity?.startedAt!==expectedStartedAt){if(child.pid===null)this.store.sqlite.prepare("UPDATE capability_run_processes SET state='unknown' WHERE process_id=?").run(id);identityUnknown=true;return;}
        if (child.state === 'active') { if (identity && child.pid === pid && child.process_started_at === identity.startedAt) return; throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生进程身份已经固定'); }
        if (!Number.isSafeInteger(pid) || pid < 1 || !identity || identity.pid !== pid) {
          this.store.sqlite.prepare("UPDATE capability_run_processes SET state='unknown' WHERE process_id=?").run(id);
          identityUnknown = true; return;
        }
        if (child.pid !== null && (child.pid !== pid || child.process_started_at !== identity.startedAt)) throw new ApplicationError('NATIVE_IDENTITY_CONFLICT','原生进程身份不能替换');
        this.store.sqlite.prepare("UPDATE capability_run_processes SET state='active',pid=?,process_started_at=?,attached_at=? WHERE process_id=?").run(pid,identity.startedAt,now(),id);
        if (child.kind === 'cli') this.store.sqlite.prepare("UPDATE capability_runs SET pid=?,process_started_at=?,state=CASE WHEN state='prepared' THEN 'active' ELSE state END WHERE run_id=?").run(pid,identity.startedAt,runId);
      }).immediate());
      if (identityUnknown) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原生进程身份未知，保留启动窗口与占用');
    },exited: async () => {
      let cli = false;
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        this.owner(runId); const process = this.processRow(runId,id); cli = process.kind === 'cli';
        if (process.state === 'reserved') throw new ApplicationError('RESOURCE_STATE_CHANGED','尚未启动的记录不能伪造退出事件');
        if (PROCESS_DONE.has(process.state)) return;
        this.store.sqlite.prepare("UPDATE capability_run_processes SET state='exited',ended_at=? WHERE process_id=?").run(now(),id); this.finish(runId);
      }).immediate());
      // A revoker may wait for this exit callback; never wait back on that same revocation.
      if (cli && !this.owned.get(runId)?.revocation) await this.stop(runId,'cli-exited');
    },cancelBeforeLaunch: async () => {
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        this.owner(runId); const process = this.processRow(runId,id);
        if (process.state !== 'reserved' && process.state !== 'canceled') throw new ApplicationError('RESOURCE_STATE_CHANGED','已登记启动窗口，不能宣称没有子进程');
        this.store.sqlite.prepare("UPDATE capability_run_processes SET state='canceled',ended_at=? WHERE process_id=?").run(now(),id); this.finish(runId);
      }).immediate());
    } };
  }
  /** Display-only native liveness, including guarded runs. Never returns a business context. */
  currentNativeRun(taskId:string,ptyId:string):CapabilityRunRecord|null{
    const rows=this.store.sqlite.prepare("SELECT run_id FROM capability_runs WHERE task_id=? AND pty_id=? AND owner_instance_id=? AND state='active'").all(taskId,ptyId,this.instanceId) as {run_id:string}[];
    if(rows.length!==1)return null;
    const {row,owned}=this.lifecycle(rows[0].run_id);
    if(owned.abort.signal.aborted||row.revocation_state!=='open'||!row.pid||!row.process_started_at)return null;
    const child=this.store.sqlite.prepare("SELECT state,pid,process_started_at FROM capability_run_processes WHERE run_id=? AND kind='cli'").get(row.run_id) as {state:string;pid:number|null;process_started_at:string|null}|undefined;
    const identity=this.deps.processes.read(row.pid);
    if(!child||child.state!=='active'||child.pid!==row.pid||child.process_started_at!==row.process_started_at||identity?.pid!==row.pid||identity.startedAt!==row.process_started_at)return null;
    return this.view(row);
  }
  /** Input provenance may only join an actual owned task/PTY, never renderer run claims. */
  inputContext(taskId:string,ptyId:string):RunContext|null{
    const rows=this.store.sqlite.prepare("SELECT run_id FROM capability_runs WHERE task_id=? AND pty_id=? AND owner_instance_id=? AND state='active'").all(taskId,ptyId,this.instanceId) as {run_id:string}[];
    if(rows.length!==1||this.owned.get(rows[0].run_id)?.guard)return null;const context=this.assertActive(rows[0].run_id);return context.run.taskId===taskId?context:null;
  }
  /** Synchronous host policy hook; tools never choose their project/task/package context. */
  assertActive(runId: string): RunContext {
    const { row,owned,session } = this.mine(runId);
    if (owned.abort.signal.aborted || row.state !== 'active' || row.revocation_state !== 'open') throw new ApplicationError('SCOPE_DENIED','当前运行已停止或尚未激活');
    const bindings = this.current(row,session); this.checkProtection(row,owned);
    return { run: this.view(row),snapshot: session.snapshot,bindings,signal: owned.abort.signal,...(owned.scope?{applicationScope:owned.scope.applications.map(p=>p.appId),...(owned.scope.excludedApplications?{excludedApplications:owned.scope.excludedApplications.map(p=>({...p}))}:{})}:{}) };
  }
  bridgePreparation(runId: string): RunContext {
    const { row,owned,session } = this.mine(runId);
    if (owned.abort.signal.aborted || !['prepared','active'].includes(row.state)) throw new ApplicationError('SCOPE_DENIED','当前运行不能准备工具桥');
    const bindings = this.current(row,session); this.checkProtection(row,owned); return { run: this.view(row),snapshot: session.snapshot,bindings,signal: owned.abort.signal,...(owned.scope?{applicationScope:owned.scope.applications.map(p=>p.appId),...(owned.scope.excludedApplications?{excludedApplications:owned.scope.excludedApplications.map(p=>({...p}))}:{})}:{}) };
  }
  assertBridge(runId: string,processId: string): RunContext {
    const context = this.assertActive(runId), child = this.processRow(runId,processId);
    if (child.kind !== 'bridge' || !['armed','active'].includes(child.state)) throw new ApplicationError('SCOPE_DENIED','工具桥尚未获得此运行的启动登记');
    return context;
  }
  async withActivity<T>(runId: string,action: (context: RunContext) => Promise<T>): Promise<T> {
    const id = randomUUID(), context = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const context = this.assertActive(runId); this.store.sqlite.prepare("INSERT INTO capability_run_activities(activity_id,run_id,state,started_at) VALUES(?,?,'active',?)").run(id,runId,now()); return context;
    }).immediate());
    try { return await action(context); }
    finally { await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => { this.store.sqlite.prepare("UPDATE capability_run_activities SET state='finished',ended_at=? WHERE activity_id=? AND state='active'").run(now(),id); this.finish(runId); }).immediate()); }
  }
  private finish(runId: string): void { finishCapabilityRun(this.store,runId); }
  async stop(runId: string,reason = 'user-stop'): Promise<CapabilityRunRecord> {
    const owned = this.owned.get(runId); if (!owned) throw new ApplicationError('SCOPE_DENIED','不能停止另一宿主的运行');
    owned.abort.abort();
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const row = this.row(runId); if (row.owner_instance_id !== this.instanceId) throw new ApplicationError('SCOPE_DENIED','运行所有者已经变化');
      if (TERMINAL.has(row.state)) return;
      this.store.sqlite.prepare("UPDATE capability_runs SET state='stopping',revocation_state=CASE WHEN revocation_state='revoked' THEN 'revoked' ELSE 'revoking' END WHERE run_id=?").run(runId);
      this.store.sqlite.prepare("UPDATE capability_run_processes SET state='canceled',ended_at=? WHERE run_id=? AND state='reserved'").run(now(),runId); this.finish(runId);
    }).immediate());
    if (this.row(runId).revocation_state === 'revoked') return this.get(runId);
    if (!owned.revocation) {
      owned.revocation = Promise.resolve().then(() => this.deps.revoke(runId,reason)).then(async () => {
        await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => { this.store.sqlite.prepare("UPDATE capability_runs SET revocation_state='revoked' WHERE run_id=? AND owner_instance_id=?").run(runId,this.instanceId); this.finish(runId); }).immediate());
      }).catch(async () => {
        await withResourceLock(this.store.root,() => { this.store.sqlite.prepare("UPDATE capability_runs SET error_code='RUN_STOP_FAILED' WHERE run_id=? AND owner_instance_id=?").run(runId,this.instanceId); });
        throw new ApplicationError('RUN_STOP_FAILED','撤销未完成，保留本次运行占用');
      }).finally(() => { owned.revocation = undefined; });
    }
    await bounded(owned.revocation,Math.min(60000,Math.max(1,this.deps.revocationTimeoutMs ?? 30000))); return this.get(runId);
  }
  ownerState(owner: { instanceId: string;pid: number;startedAt: string }): ProcessState { return this.deps.processes.state({ pid: owner.pid,startedAt: owner.startedAt }); }
  async recover(): Promise<{ runId: string;state: 'running' | 'unknown' | 'stopped' | 'orphaned' }[]> {
    return recoverCapabilityRuns(this.store,this.deps.processes,id=>this.owned.has(id));
  }
  async dispose(): Promise<void> { this.closed = true; const results = await Promise.allSettled([...this.owned.keys()].filter(id => !TERMINAL.has(this.row(id).state)).map(id => this.stop(id,'host-shutdown'))); if (results.some(r => r.status === 'rejected')) throw new ApplicationError('RUN_STOP_FAILED','部分运行撤销尚未完成，保留占用'); }
}
