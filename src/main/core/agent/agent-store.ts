// M14 新表的读写（技术方案 T1.5 §2、§3.1）。投影、事件与递增 seq 同事务，提交后再通知订阅者。
import type BetterSqlite3 from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import type { DriverId } from './capabilities';

export const EVENT_PAYLOAD_LIMIT = 32 * 1024;
const now = () => new Date().toISOString();
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** 有界序列化：超过上限只保留前缀并标记截断（完整正文转产物属阶段 2 的容量合同）。 */
export function boundedJson(value: unknown, limit = EVENT_PAYLOAD_LIMIT): string {
  const text = JSON.stringify(value ?? null);
  if (Buffer.byteLength(text) <= limit) return text;
  return JSON.stringify({ truncated: true, bytes: Buffer.byteLength(text), sha256: sha256(text), head: text.slice(0, Math.floor(limit / 2)) });
}

export interface AgentSelection { driverId: DriverId; profileId: string; model?: string; tier: string }
export interface CreateTaskInput { projectId: string | null; dirId: string | null; cwd: string; title: string; selection: AgentSelection; parentTaskId?: string }
export interface BindingRow { binding_id: string; task_id: string; driver_id: string; profile_id: string; continuation_hash: string; state_root: string; cwd_identity: string; native_id: string | null; native_confirmed_at: string | null }
export interface TurnRow { turn_id: string; task_id: string; run_id: string | null; client_input_id: string; status: string; native_turn_id: string | null }
export interface RequestRow { request_id: string; task_id: string; class: 'native' | 'host_business'; origin_json: string; revision: number; kind: string; payload_ref: string; status: string }
export interface StoredEvent { taskId: string; seq: number; type: string; itemId: string | null; payload: unknown }
export type EventListener = (event: StoredEvent) => void;

export class AgentStore {
  private readonly listeners = new Set<EventListener>();
  constructor(readonly sqlite: BetterSqlite3.Database) {}

  subscribe(listener: EventListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(events: StoredEvent[]) { for (const e of events) for (const l of [...this.listeners]) { try { l(e); } catch { /* 订阅者自身负责 */ } } }

  /** 在事务内追加事件；返回已提交事件，由调用方在事务外 notify。 */
  private appendIn(taskId: string, type: string, payload: unknown, itemId: string | null = null, revision: number | null = null): StoredEvent {
    const { seq } = this.sqlite.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM agent_events WHERE task_id=?').get(taskId) as { seq: number };
    this.sqlite.prepare('INSERT INTO agent_events(task_id,seq,event_type,item_id,revision,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(taskId, seq, type, itemId, revision, boundedJson(payload), now());
    return { taskId, seq, type, itemId, payload };
  }
  /** 写库与事件在同一事务；提交成功后才通知。 */
  tx<T>(fn: (emit: (taskId: string, type: string, payload: unknown, itemId?: string | null, revision?: number | null) => void) => T): T {
    const pending: StoredEvent[] = [];
    const result = this.sqlite.transaction(() => fn((taskId, type, payload, itemId = null, revision = null) => { pending.push(this.appendIn(taskId, type, payload, itemId, revision)); }))();
    this.notify(pending);
    return result;
  }

  createTask(input: CreateTaskInput): string {
    const taskId = randomUUID(), at = now(), ms = Date.now();
    this.tx(emit => {
      this.sqlite.prepare('INSERT INTO tasks(id,project_id,dir_id,cwd,runner,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(taskId, input.projectId, input.dirId, input.cwd, input.selection.driverId === 'codex-app-server' ? 'codex' : 'claude', input.title, ms, ms);
      this.sqlite.prepare('INSERT INTO agent_tasks(task_id,parent_task_id,selection_json,created_at,updated_at) VALUES(?,?,?,?,?)')
        .run(taskId, input.parentTaskId ?? null, JSON.stringify(input.selection), at, at);
      emit(taskId, 'task.created', { selection: input.selection });
    });
    return taskId;
  }

  task(taskId: string) {
    return this.sqlite.prepare('SELECT t.id,t.project_id,t.cwd,t.title,a.selection_json,a.selection_revision,a.archived_at FROM tasks t JOIN agent_tasks a ON a.task_id=t.id WHERE t.id=?').get(taskId) as
      { id: string; project_id: string | null; cwd: string; title: string; selection_json: string; selection_revision: number; archived_at: string | null } | undefined;
  }

  /** 同一任务、执行器与兼容身份下最新的绑定；兼容身份变化（配置根、开关等）必须新建绑定。 */
  findBinding(taskId: string, driverId: string, continuationHash: string): BindingRow | undefined {
    return this.sqlite.prepare('SELECT * FROM agent_bindings WHERE task_id=? AND driver_id=? AND continuation_hash=? ORDER BY created_at DESC, rowid DESC LIMIT 1').get(taskId, driverId, continuationHash) as BindingRow | undefined;
  }
  binding(bindingId: string): BindingRow | undefined { return this.sqlite.prepare('SELECT * FROM agent_bindings WHERE binding_id=?').get(bindingId) as BindingRow | undefined; }
  createBinding(b: Omit<BindingRow, 'binding_id' | 'native_id' | 'native_confirmed_at'>): string {
    const id = randomUUID();
    this.sqlite.prepare('INSERT INTO agent_bindings(binding_id,task_id,driver_id,profile_id,continuation_hash,state_root,cwd_identity,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(id, b.task_id, b.driver_id, b.profile_id, b.continuation_hash, b.state_root, b.cwd_identity, now());
    return id;
  }
  /** 原生确认身份。已确认的绑定不能改指其他原生会话；新原生身份须新建绑定。 */
  confirmNative(bindingId: string, nativeId: string) {
    this.tx(emit => {
      const row = this.binding(bindingId);
      if (!row) throw new Error('绑定不存在');
      if (row.native_confirmed_at && row.native_id !== nativeId) throw new Error('绑定已确认为其他原生会话');
      if (row.native_confirmed_at) return;
      this.sqlite.prepare('UPDATE agent_bindings SET native_id=?,native_confirmed_at=? WHERE binding_id=?').run(nativeId, now(), bindingId);
      emit(row.task_id, 'binding.confirmed', { bindingId, nativeId });
    });
  }

  nextGeneration(bindingId: string): number {
    return (this.sqlite.prepare('SELECT COALESCE(MAX(generation),0)+1 AS g FROM capability_runs WHERE binding_id=?').get(bindingId) as { g: number }).g;
  }
  insertRun(r: { runId: string; taskId: string; projectId: string | null; driverId: DriverId; bindingId: string; generation: number; owner: { instanceId: string; pid: number; startedAt: string | null }; launchPlanHash: string }) {
    this.tx(emit => {
      this.sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,owner_instance_id,owner_pid,owner_started_at,binding_id,driver_id,generation,launch_plan_hash,binding_mode) VALUES(?,?,?,?,'preparing',?,?,?,?,?,?,?,?,'run')")
        .run(r.runId, r.taskId, r.projectId ?? '', r.driverId, now(), r.owner.instanceId, r.owner.pid, r.owner.startedAt, r.bindingId, r.driverId, r.generation, r.launchPlanHash);
      emit(r.taskId, 'run.preparing', { runId: r.runId, bindingId: r.bindingId, generation: r.generation, driverId: r.driverId });
    });
  }
  /** 只接受本宿主自己启动的原生进程 PID（来自 ChildProcess），不接受客户端或模型自报。 */
  attachRunProcess(runId: string, taskId: string, pid: number, processStartedAt: string | null) {
    this.tx(emit => {
      const changed = this.sqlite.prepare("UPDATE capability_runs SET pid=?,process_started_at=?,state='active' WHERE run_id=? AND state='preparing'").run(pid, processStartedAt, runId).changes;
      if (changed) emit(taskId, 'run.active', { runId, pid, processStartedAt });
    });
  }
  finishRun(runId: string, taskId: string, state: 'stopped' | 'failed', errorCode: string | null) {
    this.tx(emit => {
      const changed = this.sqlite.prepare("UPDATE capability_runs SET state=?,error_code=?,ended_at=? WHERE run_id=? AND state IN ('preparing','active','stopping')").run(state, errorCode, now(), runId).changes;
      if (!changed) return;
      // 原生阻塞请求归属回合与运行：运行结束即退役（技术方案 §8.1 分类表）。
      const retired = this.sqlite.prepare("UPDATE agent_requests SET status='retired',updated_at=? WHERE class='native' AND status='pending' AND json_extract(origin_json,'$.runId')=?").run(now(), runId).changes;
      const open = this.sqlite.prepare("SELECT turn_id FROM agent_turns WHERE run_id=? AND status IN ('dispatching','started')").all(runId) as { turn_id: string }[];
      for (const t of open) {
        // 已开始但没有原生终态：状态未知，不自动重发。
        this.sqlite.prepare("UPDATE agent_turns SET status='unknown',ended_at=?,error_code='RUN_ENDED' WHERE turn_id=?").run(now(), t.turn_id);
        emit(taskId, 'turn.ended', { turnId: t.turn_id, status: 'unknown' });
      }
      emit(taskId, 'run.ended', { runId, state, errorCode, retiredRequests: retired });
    });
  }
  run(runId: string) {
    return this.sqlite.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(runId) as Record<string, any> | undefined;
  }

  /** 本地接受：同一 clientInputId 只接受一次，重复提交返回原收据（幂等只保证宿主接受）。 */
  acceptTurn(t: { taskId: string; clientInputId: string; text: string; sourceKind: 'user' | 'delegation' | 'notification' | 'system' }): { turn: TurnRow; duplicate: boolean } {
    return this.tx(emit => {
      const existing = this.sqlite.prepare('SELECT * FROM agent_turns WHERE task_id=? AND client_input_id=?').get(t.taskId, t.clientInputId) as TurnRow | undefined;
      if (existing) return { turn: existing, duplicate: true };
      const turnId = randomUUID();
      this.sqlite.prepare("INSERT INTO agent_turns(turn_id,task_id,client_input_id,input_ref,source_kind,status,accepted_at) VALUES(?,?,?,?,?,'accepted',?)")
        .run(turnId, t.taskId, t.clientInputId, boundedJson({ text: t.text }), t.sourceKind, now());
      emit(t.taskId, 'turn.accepted', { turnId, clientInputId: t.clientInputId, sourceKind: t.sourceKind });
      return { turn: this.sqlite.prepare('SELECT * FROM agent_turns WHERE turn_id=?').get(turnId) as TurnRow, duplicate: false };
    });
  }
  turn(turnId: string) { return this.sqlite.prepare('SELECT * FROM agent_turns WHERE turn_id=?').get(turnId) as TurnRow | undefined; }
  turnByNative(runId: string, nativeTurnId: string) { return this.sqlite.prepare('SELECT * FROM agent_turns WHERE run_id=? AND native_turn_id=?').get(runId, nativeTurnId) as TurnRow | undefined; }
  dispatchTurn(turnId: string, runId: string) {
    const turn = this.turn(turnId)!;
    this.tx(emit => {
      if (!this.sqlite.prepare("UPDATE agent_turns SET status='dispatching',run_id=? WHERE turn_id=? AND status='accepted'").run(runId, turnId).changes) throw new Error('该输入已在处理或已结束');
      emit(turn.task_id, 'turn.dispatching', { turnId, runId });
    });
  }
  startTurn(turnId: string, nativeTurnId: string) {
    const turn = this.turn(turnId)!;
    this.tx(emit => {
      if (this.sqlite.prepare("UPDATE agent_turns SET status='started',native_turn_id=?,started_at=? WHERE turn_id=? AND status='dispatching'").run(nativeTurnId, now(), turnId).changes)
        emit(turn.task_id, 'turn.started', { turnId, nativeTurnId });
    });
  }
  endTurn(turnId: string, status: 'completed' | 'failed' | 'interrupted' | 'unknown' | 'canceled', errorCode: string | null = null) {
    const turn = this.turn(turnId)!;
    this.tx(emit => {
      if (this.sqlite.prepare("UPDATE agent_turns SET status=?,ended_at=?,error_code=? WHERE turn_id=? AND status IN ('accepted','dispatching','started')").run(status, now(), errorCode, turnId).changes) {
        this.sqlite.prepare("UPDATE agent_requests SET status='retired',updated_at=? WHERE class='native' AND status='pending' AND json_extract(origin_json,'$.turnId')=?").run(now(), turnId);
        emit(turn.task_id, 'turn.ended', { turnId, status, errorCode });
      }
    });
  }

  /** 规范条目：ordinal 稳定；原生键包含 binding/run/generation，同一原生条目重复到达只升修订。 */
  upsertItem(i: { taskId: string; turnId: string | null; runId: string; nativeKey: string; type: string; payload: unknown; terminalState?: string | null }): string {
    return this.tx(emit => {
      const existing = this.sqlite.prepare('SELECT item_id,revision FROM agent_items WHERE task_id=? AND native_key=?').get(i.taskId, i.nativeKey) as { item_id: string; revision: number } | undefined;
      if (existing) {
        const revision = existing.revision + 1;
        this.sqlite.prepare('UPDATE agent_items SET payload_ref=?,revision=?,terminal_state=?,updated_at=? WHERE item_id=?').run(boundedJson(i.payload), revision, i.terminalState ?? null, now(), existing.item_id);
        emit(i.taskId, 'item.updated', { type: i.type, payload: i.payload }, existing.item_id, revision);
        return existing.item_id;
      }
      const itemId = randomUUID();
      const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(i.taskId) as { ordinal: number };
      this.sqlite.prepare('INSERT INTO agent_items(item_id,task_id,turn_id,run_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?,?,?,?)')
        .run(itemId, i.taskId, i.turnId, i.runId, i.type, ordinal, i.nativeKey, boundedJson(i.payload), i.terminalState ?? null, now(), now());
      emit(i.taskId, 'item.created', { type: i.type, ordinal, payload: i.payload }, itemId, 1);
      return itemId;
    });
  }

  insertNativeRequest(r: { taskId: string; origin: { taskId: string; bindingId: string; runId: string; generation: number; turnId: string | null; nativeRequest: string }; kind: string; payload: unknown }): string {
    return this.tx(emit => {
      const requestId = randomUUID();
      this.sqlite.prepare("INSERT INTO agent_requests(request_id,task_id,class,origin_json,kind,payload_ref,status,created_at,updated_at) VALUES(?,?,'native',?,?,?,'pending',?,?)")
        .run(requestId, r.taskId, JSON.stringify(r.origin), r.kind, boundedJson(r.payload), now(), now());
      emit(r.taskId, 'request.opened', { requestId, kind: r.kind, payload: r.payload, origin: r.origin });
      return requestId;
    });
  }
  request(requestId: string) { return this.sqlite.prepare('SELECT * FROM agent_requests WHERE request_id=?').get(requestId) as RequestRow | undefined; }
  requestByNative(runId: string, nativeRequest: string) {
    return this.sqlite.prepare("SELECT * FROM agent_requests WHERE class='native' AND json_extract(origin_json,'$.runId')=? AND json_extract(origin_json,'$.nativeRequest')=?").get(runId, nativeRequest) as RequestRow | undefined;
  }
  resolveRequest(requestId: string, decision: unknown) {
    const row = this.request(requestId)!;
    this.tx(emit => {
      if (this.sqlite.prepare("UPDATE agent_requests SET status='resolved',decision_ref=?,updated_at=? WHERE request_id=? AND status='pending'").run(boundedJson(decision), now(), requestId).changes)
        emit(row.task_id, 'request.resolved', { requestId });
    });
  }
  retireRequest(requestId: string, reason: string) {
    const row = this.request(requestId)!;
    this.tx(emit => {
      if (this.sqlite.prepare("UPDATE agent_requests SET status='retired',updated_at=? WHERE request_id=? AND status='pending'").run(now(), requestId).changes)
        emit(row.task_id, 'request.retired', { requestId, reason });
    });
  }

  recordProbe(p: { driverId: string; binaryPath: string; realpath: string | null; version: string | null; capabilities: unknown; state: string; reason: string | null }) {
    const id = randomUUID();
    this.sqlite.prepare('INSERT INTO agent_driver_probes(probe_id,driver_id,binary_path,realpath,version,capabilities_json,state,reason,probed_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, p.driverId, p.binaryPath, p.realpath, p.version, JSON.stringify(p.capabilities), p.state, p.reason, now());
    return id;
  }

  events(taskId: string, afterSeq = 0, limit = 128): StoredEvent[] {
    return (this.sqlite.prepare('SELECT task_id,seq,event_type,item_id,payload FROM agent_events WHERE task_id=? AND seq>? ORDER BY seq LIMIT ?').all(taskId, afterSeq, limit) as { task_id: string; seq: number; event_type: string; item_id: string | null; payload: string }[])
      .map(r => ({ taskId: r.task_id, seq: r.seq, type: r.event_type, itemId: r.item_id, payload: JSON.parse(r.payload) }));
  }
}
