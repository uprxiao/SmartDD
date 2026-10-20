import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ApplicationError } from '@shared/applications';
import type { CapabilityRunRecord, CapabilitySessionSnapshotV2 } from '@shared/application-session';
import { canonicalJson } from './manifest';
import type { ResourceRecord, ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
import type { CapabilitySessionRegistry, StoredCapabilitySession } from './session-registry';
import type { ProcessIdentity, ProcessIdentityReader, ProcessState } from './process-identity';

const bindingSchema = z.object({ appId: z.string().regex(/^[a-z][a-z0-9-]{0,19}$/),slot: z.enum(['zentao','foxmail','smtp']),connectionId: z.uuid().nullable(),identityRevision: z.number().int().positive().nullable(),bindingRevision: z.number().int().nonnegative() }).strict();
const bindingsSchema = z.array(bindingSchema).max(64).refine(items => new Set(items.map(i => i.appId + ':' + i.slot)).size === items.length);
const reserveSchema = z.object({ taskId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/),snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),bindings: bindingsSchema }).strict();
export type RunBindingRevision = z.infer<typeof bindingSchema>;
interface RunRow {
  run_id: string;task_id: string;project_id: string;runner: string;state: CapabilityRunRecord['state'];snapshot_hash: string;
  owner_instance_id: string | null;owner_pid: number | null;owner_started_at: string | null;pid: number | null;process_started_at: string | null;pty_id: string;
  bindings_json: string;started_at: string;ended_at: string | null;error_code: string | null;revocation_state: 'open' | 'revoking' | 'revoked';
}
interface ProcessRow { process_id: string;run_id: string;kind: 'cli' | 'bridge';launch_key: string;state: 'reserved' | 'armed' | 'active' | 'exited' | 'canceled' | 'unknown';pid: number | null;process_started_at: string | null;armed_at: string | null }
interface OwnedRun { selectionHash: string;leaseId: string;abort: AbortController;processes: Set<string>;revocation?: Promise<void> }
export interface RunContext { run: CapabilityRunRecord;snapshot: CapabilitySessionSnapshotV2;bindings: RunBindingRevision[];signal: AbortSignal }
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
  attach(pid: number): Promise<void>;
  /** Call only from the exit event of that same owned native handle. */
  exited(): Promise<void>;
  cancelBeforeLaunch(): Promise<void>;
}
export interface OwnedCapabilityRun {
  runId: string;ptyId: string;signal: AbortSignal;cli: OwnedRunProcess;
  prepare(): Promise<CapabilityRunRecord>;
  reserveBridge(): Promise<OwnedRunProcess>;
  stop(reason?: string): Promise<CapabilityRunRecord>;
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
    const session = this.sessions.inspectCoordinated(row.task_id);
    if (session.selectionHash !== owned.selectionHash || session.snapshot.projectId !== row.project_id || session.snapshot.runner !== row.runner || session.pointer.snapshotHash !== row.snapshot_hash) throw new ApplicationError('SNAPSHOT_CORRUPT','运行与固定会话身份不同');
    return { row,owned,session };
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
  private closure(taskId: string): ResourceRecord[] {
    const roots = this.store.sqlite.prepare('SELECT ref_id,ref_hash,ref_kind,relative_path FROM capability_session_refs WHERE task_id=?').all(taskId) as { ref_id: string;ref_hash: string;ref_kind: string;relative_path: string }[];
    if (!roots.length) throw new ApplicationError('SNAPSHOT_CORRUPT','原会话资源引用缺失');
    const visited = new Map<string,ResourceRecord>(), visiting = new Set<string>();
    const visit = (id: string,depth = 0): void => {
      if (depth > 256) throw new ApplicationError('INVALID_PACKAGE','资源依赖深度超过预算');
      if (visiting.has(id)) throw new ApplicationError('SNAPSHOT_CORRUPT','资源依赖包含循环');
      if (visited.has(id)) return;
      if (visited.size + visiting.size >= 10000) throw new ApplicationError('INVALID_PACKAGE','资源依赖超过预算');
      const resource = this.store.get(id);
      if (resource.state !== 'ready' || resource.integrity !== 'valid') throw new ApplicationError('RESOURCE_STATE_CHANGED','原会话资源未就绪，不能准备新的运行');
      visiting.add(id);
      for (const dependency of this.store.sqlite.prepare('SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=?').all(id) as { dependency_id: string }[]) visit(dependency.dependency_id,depth + 1);
      visiting.delete(id); visited.set(id,resource);
    };
    for (const root of roots) { visit(root.ref_id); const r = visited.get(root.ref_id)!; if (r.contentHash !== root.ref_hash || r.kind !== root.ref_kind || r.relativePath !== root.relative_path) throw new ApplicationError('SNAPSHOT_CORRUPT','原会话引用与资源身份不同'); }
    return [...visited.values()];
  }
  private protect(runId: string,owned: OwnedRun): void {
    const row = this.row(runId), resources = this.closure(row.task_id);
    const put = this.store.sqlite.prepare('INSERT OR IGNORE INTO capability_lease_resources(lease_id,resource_id,content_hash,generation) VALUES(?,?,?,?)');
    for (const resource of resources) put.run(owned.leaseId,resource.resourceId,resource.contentHash,resource.generation);
    this.checkProtection(row,owned);
  }
  private checkProtection(row: RunRow,owned: OwnedRun): void {
    const lease = this.store.sqlite.prepare('SELECT state,owner_id,host_instance_id FROM capability_resource_leases WHERE lease_id=?').get(owned.leaseId) as { state: string;owner_id: string;host_instance_id: string } | undefined;
    if (!lease || lease.owner_id !== row.run_id || lease.host_instance_id !== this.instanceId || !['preparing','active'].includes(lease.state)) throw new ApplicationError('RESOURCE_STATE_CHANGED','运行资源占用已改变');
    const protectedRows = this.store.sqlite.prepare('SELECT resource_id,content_hash,generation FROM capability_lease_resources WHERE lease_id=?').all(owned.leaseId) as { resource_id: string;content_hash: string;generation: number }[];
    for (const resource of this.closure(row.task_id)) if (!protectedRows.some(r => r.resource_id === resource.resourceId && r.content_hash === resource.contentHash && r.generation === resource.generation)) throw new ApplicationError('RESOURCE_STATE_CHANGED','原资源依赖或代次已改变，保留占用但拒绝启动');
    for (const protectedRow of protectedRows) { const r = this.store.get(protectedRow.resource_id); if (r.state !== 'ready' || r.integrity !== 'valid' || r.contentHash !== protectedRow.content_hash || r.generation !== protectedRow.generation) throw new ApplicationError('RESOURCE_STATE_CHANGED','被占用资源状态发生改变'); }
  }
  private view(row: RunRow): CapabilityRunRecord { return { runId: row.run_id,taskId: row.task_id,projectId: row.project_id,runner: row.runner,state: row.state,snapshotHash: row.snapshot_hash,pid: row.pid,processStartedAt: row.process_started_at,startedAt: row.started_at,endedAt: row.ended_at }; }
  get(runId: string): CapabilityRunRecord { return this.view(this.row(runId)); }
  async reserve(input: z.infer<typeof reserveSchema>,reservation?: {runId:string;ptyId:string}): Promise<OwnedCapabilityRun> {
    const parsed = reserveSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','运行准备参数无效或含未允许字段');
    if (this.closed) throw new ApplicationError('CANCELED','此宿主的应用运行服务已停止');
    if (reservation && (!z.uuid().safeParse(reservation.runId).success || !z.uuid().safeParse(reservation.ptyId).success)) throw new ApplicationError('INVALID_INPUT','宿主预留运行身份无效');
    const value = parsed.data, runId = reservation?.runId ?? randomUUID(), ptyId = reservation?.ptyId ?? randomUUID(), processId = randomUUID(), leaseId = randomUUID(); let selectionHash = '';
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      if (this.closed) throw new ApplicationError('CANCELED','运行准备已取消');
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_store_state(singleton,store_id,resource_generation,maintenance_state) VALUES(?,?,1,'ready')").run(1,this.store.storeId); this.gate();
      const session = this.sessions.inspectCoordinated(value.taskId); selectionHash = session.selectionHash;
      if (session.retention !== 'active' || session.pointer.snapshotHash !== value.snapshotHash) throw new ApplicationError('RESOURCE_STATE_CHANGED','原会话版本或保留状态已改变');
      if (!this.store.sqlite.prepare('SELECT 1 FROM projects WHERE id=?').get(session.snapshot.projectId)) throw new ApplicationError('NOT_FOUND','项目已删除，保留历史但不能启动');
      if (this.store.sqlite.prepare("SELECT 1 FROM capability_runs WHERE task_id=? AND state NOT IN ('stopped','failed')").get(value.taskId)) throw new ApplicationError('RESOURCE_BUSY','原任务仍有运行或待核查占用');
      this.deps.assertCurrent(session.snapshot,value.bindings); const resources = this.closure(value.taskId), timestamp = now();
      this.store.sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id,revocation_state) VALUES(?,?,?,?,'preparing',?,?,?,?,?,?,?,'open')").run(runId,value.taskId,session.snapshot.projectId,session.snapshot.runner,timestamp,value.snapshotHash,this.instanceId,this.host.pid,this.host.startedAt,canonicalJson(value.bindings),ptyId);
      this.store.sqlite.prepare("INSERT INTO capability_resource_leases(lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at) VALUES(?,?,'run',?,?,?,?,'preparing',?)").run(leaseId,resources[0].resourceId,runId,this.instanceId,this.host.pid,this.host.startedAt,timestamp);
      for (const r of resources) this.store.sqlite.prepare('INSERT INTO capability_lease_resources(lease_id,resource_id,content_hash,generation) VALUES(?,?,?,?)').run(leaseId,r.resourceId,r.contentHash,r.generation);
      this.store.sqlite.prepare("INSERT INTO capability_run_processes(process_id,run_id,kind,launch_key,state) VALUES(?,?,'cli',?,'reserved')").run(processId,runId,ptyId);
    }).immediate());
    const owned: OwnedRun = { selectionHash,leaseId,abort: new AbortController(),processes: new Set([processId]) }; this.owned.set(runId,owned);
    if (this.closed) { await this.stop(runId,'host-shutdown'); throw new ApplicationError('CANCELED','运行准备期间宿主服务已停止'); }
    return { runId,ptyId,signal: owned.abort.signal,cli: this.processHandle(runId,processId,ptyId),prepare: () => this.prepare(runId),reserveBridge: () => this.reserveBridge(runId),stop: (reason = 'user-stop') => this.stop(runId,reason) };
  }
  private async prepare(runId: string): Promise<CapabilityRunRecord> {
    const taskId = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const { row,owned,session } = this.mine(runId);
      if (owned.abort.signal.aborted || !['preparing','prepared'].includes(row.state)) throw new ApplicationError('CANCELED','运行已被撤销，不能继续准备');
      this.current(row,session); this.protect(runId,owned); return row.task_id;
    }).immediate());
    await this.sessions.verifyResources(taskId);
    return withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      const { row,owned,session } = this.mine(runId); if (owned.abort.signal.aborted || !['preparing','prepared'].includes(row.state)) throw new ApplicationError('CANCELED','准备期间运行已被撤销');
      this.current(row,session); this.checkProtection(row,owned);
      this.store.sqlite.prepare("UPDATE capability_runs SET state='prepared' WHERE run_id=?").run(runId);
      this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='active' WHERE lease_id=? AND state='preparing'").run(owned.leaseId); return this.get(runId);
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
        const { row,owned,session } = this.mine(runId), process = this.processRow(runId,id);
        if (owned.abort.signal.aborted || !['prepared','active'].includes(row.state) || process.state !== 'reserved') throw new ApplicationError('CANCELED','此启动窗口已取消或已使用');
        this.current(row,session); this.checkProtection(row,owned);
        this.store.sqlite.prepare("UPDATE capability_run_processes SET state='armed',armed_at=? WHERE process_id=? AND state='reserved'").run(now(),id);
      }).immediate());
    },attach: async pid => {
      const identity = this.deps.processes.read(pid); let identityUnknown = false;
      await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        const { row } = this.mine(runId), child = this.processRow(runId,id);
        if (child.state === 'exited') return; // Owned exit callback won the attachment race.
        if (!['armed','active','unknown'].includes(child.state)) throw new ApplicationError('RESOURCE_STATE_CHANGED','尚未登记启动窗口或已经取消');
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
  /** Input provenance may only join an actual owned task/PTY, never renderer run claims. */
  inputContext(taskId:string,ptyId:string):RunContext|null{
    const rows=this.store.sqlite.prepare("SELECT run_id FROM capability_runs WHERE task_id=? AND pty_id=? AND owner_instance_id=? AND state='active'").all(taskId,ptyId,this.instanceId) as {run_id:string}[];
    if(rows.length!==1)return null;const context=this.assertActive(rows[0].run_id);return context.run.taskId===taskId?context:null;
  }
  /** Synchronous host policy hook; tools never choose their project/task/package context. */
  assertActive(runId: string): RunContext {
    const { row,owned,session } = this.mine(runId);
    if (owned.abort.signal.aborted || row.state !== 'active' || row.revocation_state !== 'open') throw new ApplicationError('SCOPE_DENIED','当前运行已停止或尚未激活');
    const bindings = this.current(row,session); this.checkProtection(row,owned);
    return { run: this.view(row),snapshot: session.snapshot,bindings,signal: owned.abort.signal };
  }
  bridgePreparation(runId: string): RunContext {
    const { row,owned,session } = this.mine(runId);
    if (owned.abort.signal.aborted || !['prepared','active'].includes(row.state)) throw new ApplicationError('SCOPE_DENIED','当前运行不能准备工具桥');
    const bindings = this.current(row,session); this.checkProtection(row,owned); return { run: this.view(row),snapshot: session.snapshot,bindings,signal: owned.abort.signal };
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
  private finish(runId: string): void {
    const row = this.row(runId); if (TERMINAL.has(row.state) || row.revocation_state !== 'revoked') return;
    if (!this.store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND kind='cli'").get(runId)) return;
    if (this.store.sqlite.prepare("SELECT 1 FROM capability_run_processes WHERE run_id=? AND state NOT IN ('exited','canceled')").get(runId) || this.store.sqlite.prepare("SELECT 1 FROM capability_run_activities WHERE run_id=? AND state='active'").get(runId)) return;
    const timestamp = now();
    this.store.sqlite.prepare("UPDATE capability_runs SET state='stopped',ended_at=? WHERE run_id=?").run(timestamp,runId);
    this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE owner_kind='run' AND owner_id=? AND state<>'released'").run(timestamp,runId);
  }
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
    const rows = this.store.sqlite.prepare("SELECT * FROM capability_runs WHERE state NOT IN ('stopped','failed')").all() as RunRow[], result: { runId: string;state: 'running' | 'unknown' | 'stopped' | 'orphaned' }[] = [];
    for (const row of rows) {
      if (this.owned.has(row.run_id)) { result.push({ runId: row.run_id,state: 'running' }); continue; }
      const owner = row.owner_pid && row.owner_started_at ? this.deps.processes.state({ pid: row.owner_pid,startedAt: row.owner_started_at }) : 'unknown';
      if (owner !== 'stopped') { result.push({ runId: row.run_id,state: owner }); continue; }
      const processes = this.store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE run_id=? ORDER BY process_id').all(row.run_id) as ProcessRow[];
      const observations = processes.map(p => ({ p,state: PROCESS_DONE.has(p.state) || p.state === 'reserved' ? 'stopped' : p.pid && p.process_started_at ? this.deps.processes.state({ pid: p.pid,startedAt: p.process_started_at }) : 'unknown' }));
      const state = await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
        const fresh = this.row(row.run_id), currentProcesses = this.store.sqlite.prepare('SELECT * FROM capability_run_processes WHERE run_id=? ORDER BY process_id').all(row.run_id);
        if (canonicalJson(fresh) !== canonicalJson(row) || canonicalJson(currentProcesses) !== canonicalJson(processes)) return 'unknown' as const;
        const timestamp = now();
        for (const { p,state } of observations) if (state === 'stopped' && !PROCESS_DONE.has(p.state)) this.store.sqlite.prepare('UPDATE capability_run_processes SET state=?,ended_at=? WHERE process_id=?').run(p.state === 'reserved' ? 'canceled' : 'exited',timestamp,p.process_id);
        this.store.sqlite.prepare("UPDATE capability_run_activities SET state='owner-stopped',ended_at=? WHERE run_id=? AND state='active'").run(timestamp,row.run_id);
        this.store.sqlite.prepare("UPDATE capability_runs SET state='orphaned',revocation_state='revoked',error_code='HOST_INTERRUPTED' WHERE run_id=?").run(row.run_id);
        this.finish(row.run_id);
        if (this.row(row.run_id).state === 'stopped') return 'stopped' as const;
        this.store.sqlite.prepare("UPDATE capability_resource_leases SET state='recovery-required' WHERE owner_kind='run' AND owner_id=? AND state<>'released'").run(row.run_id); return 'orphaned' as const;
      }).immediate()); result.push({ runId: row.run_id,state });
    }
    return result;
  }
  async dispose(): Promise<void> { this.closed = true; const results = await Promise.allSettled([...this.owned.keys()].filter(id => !TERMINAL.has(this.row(id).state)).map(id => this.stop(id,'host-shutdown'))); if (results.some(r => r.status === 'rejected')) throw new ApplicationError('RUN_STOP_FAILED','部分运行撤销尚未完成，保留占用'); }
}
