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
      // 用户消息由宿主在本地接受时记录（可信出站来源），不取原生回显（技术方案 §4 user_message）。
      const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(t.taskId) as { ordinal: number };
      const itemId = randomUUID();
      this.sqlite.prepare("INSERT INTO agent_items(item_id,task_id,turn_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,'user_message',?,1,?,?,'completed',?,?)")
        .run(itemId, t.taskId, turnId, ordinal, `input:${turnId}`, boundedJson({ text: t.text, sourceKind: t.sourceKind }), now(), now());
      emit(t.taskId, 'item.created', { type: 'user_message', ordinal, payload: { text: t.text, sourceKind: t.sourceKind } }, itemId, 1);
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

  /** 草稿 CAS：修订不符返回冲突，保留调用方本地编辑（R01 草稿按任务持久保存）。 */
  saveDraft(taskId: string, draft: unknown, expectedRevision: number): { ok: true; revision: number } | { ok: false; revision: number; draft: unknown } {
    return this.sqlite.transaction(() => {
      const row = this.sqlite.prepare('SELECT draft_json,draft_revision FROM agent_tasks WHERE task_id=?').get(taskId) as { draft_json: string; draft_revision: number } | undefined;
      if (!row) throw new Error('任务不存在');
      if (row.draft_revision !== expectedRevision) return { ok: false as const, revision: row.draft_revision, draft: JSON.parse(row.draft_json) };
      const revision = row.draft_revision + 1;
      this.sqlite.prepare('UPDATE agent_tasks SET draft_json=?,draft_revision=?,updated_at=? WHERE task_id=?').run(boundedJson(draft, 256 * 1024), revision, now(), taskId);
      return { ok: true as const, revision };
    })();
  }
  updateSelection(taskId: string, patch: Partial<AgentSelection>, expectedRevision: number): { ok: true; revision: number; selection: AgentSelection } | { ok: false; revision: number; selection: AgentSelection } {
    return this.tx(emit => {
      const row = this.sqlite.prepare('SELECT selection_json,selection_revision FROM agent_tasks WHERE task_id=?').get(taskId) as { selection_json: string; selection_revision: number } | undefined;
      if (!row) throw new Error('任务不存在');
      const current = JSON.parse(row.selection_json) as AgentSelection;
      if (row.selection_revision !== expectedRevision) return { ok: false as const, revision: row.selection_revision, selection: current };
      const selection = { ...current, ...patch }, revision = row.selection_revision + 1;
      this.sqlite.prepare('UPDATE agent_tasks SET selection_json=?,selection_revision=?,updated_at=? WHERE task_id=?').run(JSON.stringify(selection), revision, now(), taskId);
      emit(taskId, 'selection.changed', { selection, revision });
      return { ok: true as const, revision, selection };
    });
  }
  archiveTask(taskId: string) {
    this.tx(emit => { if (this.sqlite.prepare('UPDATE agent_tasks SET archived_at=?,updated_at=? WHERE task_id=? AND archived_at IS NULL').run(now(), now(), taskId).changes) emit(taskId, 'task.archived', {}); });
  }
  listTasks(includeArchived = false) {
    return this.sqlite.prepare(`SELECT t.id,t.project_id,t.dir_id,t.cwd,t.title,a.selection_json,a.archived_at,a.created_at,a.updated_at,a.parent_task_id FROM tasks t JOIN agent_tasks a ON a.task_id=t.id ${includeArchived ? '' : 'WHERE a.archived_at IS NULL'} ORDER BY a.created_at DESC`).all() as
      { id: string; project_id: string | null; dir_id: string | null; cwd: string; title: string; selection_json: string; archived_at: string | null; created_at: string; updated_at: string; parent_task_id: string | null }[];
  }
  /** 排队中的输入：已接受、尚未派发，按接受顺序。 */
  queuedTurns(taskId: string) {
    return this.sqlite.prepare("SELECT turn_id,client_input_id,input_ref,accepted_at FROM agent_turns WHERE task_id=? AND status='accepted' ORDER BY accepted_at,rowid").all(taskId) as { turn_id: string; client_input_id: string; input_ref: string; accepted_at: string }[];
  }
  turns(taskId: string) {
    return this.sqlite.prepare('SELECT turn_id,client_input_id,status,native_turn_id,accepted_at,started_at,ended_at,error_code,run_id FROM agent_turns WHERE task_id=? ORDER BY accepted_at,rowid').all(taskId) as Record<string, any>[];
  }
  items(taskId: string) {
    return (this.sqlite.prepare('SELECT item_id,turn_id,type,ordinal,revision,payload_ref,terminal_state,created_at,updated_at FROM agent_items WHERE task_id=? ORDER BY ordinal').all(taskId) as Record<string, any>[])
      .map(r => ({ itemId: r.item_id, turnId: r.turn_id, type: r.type, ordinal: r.ordinal, revision: r.revision, payload: JSON.parse(r.payload_ref), terminal: r.terminal_state, createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  pendingRequests(taskId: string) {
    return (this.sqlite.prepare("SELECT request_id,class,kind,revision,payload_ref,origin_json,status,created_at FROM agent_requests WHERE task_id=? AND status IN ('pending','approved_pending_bind') ORDER BY created_at,rowid").all(taskId) as Record<string, any>[])
      .map(r => ({ requestId: r.request_id, class: r.class, kind: r.kind, revision: r.revision, payload: JSON.parse(r.payload_ref), origin: JSON.parse(r.origin_json), status: r.status, createdAt: r.created_at }));
  }
  draft(taskId: string) {
    const r = this.sqlite.prepare('SELECT draft_json,draft_revision FROM agent_tasks WHERE task_id=?').get(taskId) as { draft_json: string; draft_revision: number } | undefined;
    return r ? { draft: JSON.parse(r.draft_json), revision: r.draft_revision } : null;
  }
  watermark(taskId: string) { return (this.sqlite.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM agent_events WHERE task_id=?').get(taskId) as { seq: number }).seq; }

  /**
   * 宿主重启恢复（技术方案 §9）：上一宿主实例留下的新运行一律收口为 orphaned；原生阻塞请求退役；
   * 已派发但无原生终态的回合标“结果未知”，不自动重发。返回需要按出生身份核对的原生进程。
   */
  recoverOrphanRuns(currentInstanceId: string): { runId: string; taskId: string; pid: number | null; processStartedAt: string | null }[] {
    return this.tx(emit => {
      const rows = this.sqlite.prepare("SELECT run_id,task_id,pid,process_started_at FROM capability_runs WHERE binding_id IS NOT NULL AND state IN ('preparing','active','stopping') AND COALESCE(owner_instance_id,'')<>?").all(currentInstanceId) as { run_id: string; task_id: string; pid: number | null; process_started_at: string | null }[];
      for (const r of rows) {
        this.sqlite.prepare("UPDATE capability_runs SET state='orphaned',error_code='HOST_RESTARTED',ended_at=? WHERE run_id=?").run(now(), r.run_id);
        this.sqlite.prepare("UPDATE agent_requests SET status='retired',updated_at=? WHERE class='native' AND status='pending' AND json_extract(origin_json,'$.runId')=?").run(now(), r.run_id);
        for (const t of this.sqlite.prepare("SELECT turn_id FROM agent_turns WHERE run_id=? AND status IN ('dispatching','started')").all(r.run_id) as { turn_id: string }[]) {
          this.sqlite.prepare("UPDATE agent_turns SET status='unknown',ended_at=?,error_code='HOST_RESTARTED' WHERE turn_id=?").run(now(), t.turn_id);
          emit(r.task_id, 'turn.ended', { turnId: t.turn_id, status: 'unknown', errorCode: 'HOST_RESTARTED' });
        }
        emit(r.task_id, 'run.ended', { runId: r.run_id, state: 'orphaned', errorCode: 'HOST_RESTARTED' });
      }
      return rows.map(r => ({ runId: r.run_id, taskId: r.task_id, pid: r.pid, processStartedAt: r.process_started_at }));
    });
  }
  tasksWithQueue() { return (this.sqlite.prepare("SELECT DISTINCT task_id FROM agent_turns WHERE status='accepted'").all() as { task_id: string }[]).map(r => r.task_id); }

  /** 原生自行开始的回合（目标自动续跑等）：宿主记录为系统来源的回合，不生成用户消息。 */
  acceptAutoTurn(taskId: string, runId: string, nativeTurnId: string): string {
    return this.tx(emit => {
      const existing = this.turnByNative(runId, nativeTurnId);
      if (existing) return existing.turn_id;
      const turnId = randomUUID();
      this.sqlite.prepare("INSERT INTO agent_turns(turn_id,task_id,run_id,client_input_id,input_ref,source_kind,status,native_turn_id,accepted_at,started_at) VALUES(?,?,?,?,'{}','system','started',?,?,?)")
        .run(turnId, taskId, runId, `auto:${nativeTurnId}`, nativeTurnId, now(), now());
      emit(taskId, 'turn.started', { turnId, nativeTurnId, sourceKind: 'system' });
      return turnId;
    });
  }
  /** 插话被原生接受后并入当前原生回合；该回合结束时一起收口。 */
  attachSteer(turnId: string, runId: string, nativeTurnId: string) {
    const turn = this.turn(turnId)!;
    this.tx(emit => {
      if (this.sqlite.prepare("UPDATE agent_turns SET status='started',run_id=?,native_turn_id=?,started_at=? WHERE turn_id=? AND status='accepted'").run(runId, nativeTurnId, now(), turnId).changes)
        emit(turn.task_id, 'turn.steered', { turnId, nativeTurnId });
    });
  }
  /** 驱动在发送前就拒绝（证明未发出）：放回排队，不记未知（技术方案 §5 投递状态 not_sent）。 */
  requeueTurn(turnId: string) {
    const turn = this.turn(turnId)!;
    this.tx(emit => {
      if (this.sqlite.prepare("UPDATE agent_turns SET status='accepted',run_id=NULL WHERE turn_id=? AND status='dispatching'").run(turnId).changes) emit(turn.task_id, 'turn.requeued', { turnId });
    });
  }
  turnsByNative(runId: string, nativeTurnId: string) { return this.sqlite.prepare("SELECT * FROM agent_turns WHERE run_id=? AND native_turn_id=? AND status IN ('dispatching','started')").all(runId, nativeTurnId) as TurnRow[]; }
  upsertGoal(g: { taskId: string; bindingId: string; objective: string | null; status: 'active' | 'paused' | 'complete' | 'cleared' | 'limited'; timeUsedSeconds?: number; pausedReason?: 'user' | 'waiting_children' | 'limit' }) {
    this.tx(emit => {
      const cur = this.sqlite.prepare('SELECT objective,revision,turns FROM agent_goals WHERE task_id=?').get(g.taskId) as { objective: string; revision: number; turns: number } | undefined;
      if (g.status === 'cleared') {
        if (cur) this.sqlite.prepare("UPDATE agent_goals SET status='cleared',paused_reason=NULL,updated_at=? WHERE task_id=?").run(now(), g.taskId);
        emit(g.taskId, 'goal.changed', { status: 'cleared' });
        return;
      }
      const objective = g.objective ?? cur?.objective ?? '';
      const status = g.status === 'limited' ? 'paused' : g.status;
      const reason = status === 'paused' ? (g.status === 'limited' ? 'limit' : g.pausedReason ?? 'user') : null;
      const revision = !cur ? 1 : cur.objective !== objective ? cur.revision + 1 : cur.revision;
      this.sqlite.prepare(`INSERT INTO agent_goals(task_id,binding_id,objective,revision,status,paused_reason,turns,time_used_s,updated_at) VALUES(?,?,?,?,?,?,0,?,?)
        ON CONFLICT(task_id) DO UPDATE SET binding_id=excluded.binding_id,objective=excluded.objective,revision=excluded.revision,status=excluded.status,paused_reason=excluded.paused_reason,time_used_s=MAX(agent_goals.time_used_s,excluded.time_used_s),turns=CASE WHEN agent_goals.revision<>excluded.revision THEN 0 ELSE agent_goals.turns END,updated_at=excluded.updated_at`)
        .run(g.taskId, g.bindingId, objective, revision, status, reason, Math.round(g.timeUsedSeconds ?? 0), now());
      emit(g.taskId, 'goal.changed', { objective, status, pausedReason: reason, revision });
    });
  }
  countGoalTurn(taskId: string) { this.sqlite.prepare("UPDATE agent_goals SET turns=turns+1,updated_at=? WHERE task_id=? AND status='active'").run(now(), taskId); }
  goal(taskId: string) {
    const r = this.sqlite.prepare('SELECT objective,revision,status,paused_reason,turns,time_used_s,updated_at FROM agent_goals WHERE task_id=?').get(taskId) as Record<string, any> | undefined;
    return r && r.status !== 'cleared' ? { objective: r.objective, revision: r.revision, status: r.status, pausedReason: r.paused_reason, turns: r.turns, timeUsedSeconds: r.time_used_s, updatedAt: r.updated_at } : null;
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
