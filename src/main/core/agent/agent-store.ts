// M14 新表的读写（技术方案 T1.5 §2、§3.1）。投影、事件与递增 seq 同事务，提交后再通知订阅者。
import type BetterSqlite3 from 'better-sqlite3';
import { DriverError } from './driver';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { DriverId } from './capabilities';

export const EVENT_PAYLOAD_LIMIT = 32 * 1024;
/** 历史正文与输入原文的上限（复核 CR06）：输入在接受前按文字预算校验，这里只防异常大对象。 */
export const BODY_LIMIT = 1024 * 1024;
export const INPUT_TEXT_LIMIT = 256 * 1024;
/** 草稿存储上限：256 KiB 文字在最坏 JSON 转义（6 倍）下加 20 个附件元数据仍放得下。 */
export const DRAFT_STORE_LIMIT = 2 * 1024 * 1024;
const now = () => new Date().toISOString();
export const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

/** 有界序列化：超过上限只保留前缀并标记截断（完整正文转产物属阶段 2 的容量合同）。 */
export function boundedJson(value: unknown, limit = EVENT_PAYLOAD_LIMIT): string {
  const text = JSON.stringify(value ?? null);
  if (Buffer.byteLength(text) <= limit) return text;
  // 前缀按字节截取并预留 JSON 转义余量，保证结果确实不超过上限（复核 FR02）。
  return JSON.stringify({ truncated: true, bytes: Buffer.byteLength(text), sha256: sha256(text), head: Buffer.from(text).subarray(0, Math.floor(limit / 4)).toString('utf8') });
}

/** 历史正文：上限 1 MiB，超限保留前缀并标记（完整产物存储属后续容量合同）。 */
export const bodyJson = (value: unknown) => boundedJson(value, BODY_LIMIT);

/** 按字符上限截短长字符串，保留对象结构。 */
function cutStrings(v: unknown, cap: number): unknown {
  return typeof v === 'string' ? (v.length > cap ? v.slice(0, cap) : v)
    : Array.isArray(v) ? v.map(x => cutStrings(x, cap)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cutStrings(x, cap)])) : v;
}
/** 结构化截短到上限内，附加 extra 字段。 */
function shortenedJson(value: unknown, extra: Record<string, unknown>, limit = BODY_LIMIT): string | null {
  for (const cap of [128 * 1024, 32 * 1024, 8 * 1024, 1024]) {
    const out = JSON.stringify({ ...(cutStrings(value, cap) as object), ...extra });
    if (Buffer.byteLength(out) <= limit) return out;
  }
  return null;
}
/** 最小引用：只留顶层短字段（长文字截到 500 字）与原文引用，保证远小于预览预算。 */
function minimalRef(value: unknown, artifact: { file: string; bytes: number; sha256: string }): string {
  const top = value && typeof value === 'object' && !Array.isArray(value) ? Object.entries(value as Record<string, unknown>).slice(0, 40) : [];
  const fields = Object.fromEntries(top.filter(([, v]) => v === null || typeof v !== 'object').map(([k, v]) => [k.slice(0, 64), typeof v === 'string' ? v.slice(0, 500) : v]));
  return JSON.stringify({ ...fields, previewOmitted: true, artifact });
}
/** 单个条目原文的 artifact 上限；更大的只能结构化截短并标不完整。 */
export const ARTIFACT_LIMIT = 64 * 1024 * 1024;

/**
 * 时间线条目正文在没有 artifact 目录（或写入失败、超过 artifact 上限）时的降级（复核 T02）：保留条目结构，
 * 按需截短长字符串并标 storedTruncated，界面明确告知不完整，复制／下载会拒绝。
 */
export function itemJson(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  const bytes = Buffer.byteLength(text);
  if (bytes <= BODY_LIMIT) return text;
  return shortenedJson(value, { storedTruncated: true, bytes, sha256: sha256(text) }) ?? boundedJson(value, BODY_LIMIT);
}

export interface AgentSelection { driverId: DriverId; profileId: string; model?: string; effort?: string; tier: string; carryExtensions?: boolean; extensionPreferences?: Record<string, boolean>; pendingSwitch?: { profileId: string; model?: string } }
export interface CreateTaskInput { projectId: string | null; dirId: string | null; cwd: string; title: string; selection: AgentSelection; parentTaskId?: string }
export interface BindingRow { binding_id: string; task_id: string; driver_id: string; profile_id: string; continuation_hash: string; state_root: string; cwd_identity: string; native_id: string | null; native_confirmed_at: string | null }
export interface TurnRow { turn_id: string; task_id: string; run_id: string | null; client_input_id: string; status: string; native_turn_id: string | null; source_kind: 'user' | 'delegation' | 'notification' | 'system' }
export interface RequestRow { request_id: string; task_id: string; class: 'native' | 'host_business'; origin_json: string; revision: number; kind: string; payload_ref: string; status: string }
export interface StoredEvent { taskId: string; seq: number; type: string; itemId: string | null; payload: unknown }
export type EventListener = (event: StoredEvent) => void;

export class AgentStore {
  private readonly transactionEvents: StoredEvent[][] = [];
  private readonly listeners = new Set<EventListener>();
  /** 超限正文的 artifact 目录（技术方案 §3.1“超限正文转 artifact”，复核 U01）；不设时降级为结构化截短。 */
  private readonly artifactDir?: string;
  /** 最近读过的一个原文（分段读取连续命中）；按文件身份与修改时间失效，改动或替换都会重新核对摘要。 */
  private artifactCache: { key: string; text: string } | null = null;
  constructor(readonly sqlite: BetterSqlite3.Database, opts: { artifactDir?: string } = {}) { this.artifactDir = opts.artifactDir; }

  /**
   * 条目正文：1 MiB 内直接入库；超限时把完整原文写成 artifact 文件（先写临时文件再改名），
   * 库里只存结构化预览与受任务／条目／修订约束的引用。写入失败或超过 artifact 上限时降级并标不完整，不冒充完整保存。
   */
  private itemBody(taskId: string, itemId: string, revision: number, value: unknown, written: string[]): string {
    const text = JSON.stringify(value ?? null);
    const bytes = Buffer.byteLength(text);
    if (bytes <= BODY_LIMIT) return text;
    if (this.artifactDir && bytes <= ARTIFACT_LIMIT) {
      const rel = `${taskId}/${itemId}.r${revision}.json`;
      const file = join(this.artifactDir, rel);
      // 临时文件路径在写入前确定；任何一步失败都删掉本次写出的临时／最终文件（复核 V03）。
      const tmp = `${file}.${randomUUID()}.tmp`;
      let renamed = false;
      try {
        mkdirSync(join(this.artifactDir, taskId), { recursive: true, mode: 0o700 });
        writeFileSync(tmp, text, { mode: 0o600, flag: 'wx' });
        renameSync(tmp, file);
        renamed = true;
        const artifact = { file: rel, bytes, sha256: sha256(text) };
        // 引用与预览分开（复核 V01）：结构化预览放不进预算时，只留顶层短字段与引用，绝不丢掉已保存的原文。
        const ref = shortenedJson(value, { artifact }, 256 * 1024) ?? minimalRef(value, artifact);
        written.push(file);
        return ref;
      } catch {
        rmSync(tmp, { force: true });
        if (renamed) rmSync(file, { force: true });
        /* 写入失败：降级为结构化截短，并如实标不完整 */
      }
    }
    return itemJson(value);
  }
  /** 带 artifact 的写事务：事务失败删除本次写出的文件；成功后删除被替换修订的旧文件。 */
  private itemTx<T>(fn: (written: string[], replaced: string[], emit: Parameters<Parameters<AgentStore['tx']>[0]>[0]) => T): T {
    const written: string[] = [], replaced: string[] = [];
    let result: T;
    try { result = this.tx(emit => fn(written, replaced, emit)); }
    catch (e) { for (const f of written) rmSync(f, { force: true }); throw e; }
    for (const ref of replaced) { const f = this.artifactPath(ref); if (f) rmSync(f, { force: true }); }
    return result;
  }
  private artifactPath(rel: string) {
    if (!this.artifactDir || typeof rel !== 'string') return null;
    const f = join(this.artifactDir, rel), r = relative(this.artifactDir, f);
    return !r || r.startsWith('..') || r.includes(`..${sep}`) ? null : f;
  }
  private static artifactOf(payloadJson: string): { file: string; bytes: number; sha256: string } | null {
    try { const a = JSON.parse(payloadJson)?.artifact; return a && typeof a.file === 'string' ? a : null; } catch { return null; }
  }
  /** 条目完整正文：有 artifact 的读文件并核对大小与摘要；文件丢失或被改动明确报错，不返回残缺内容。 */
  readItemBody(taskId: string, itemId: string) {
    const r = this.itemById(taskId, itemId);
    if (!r) return undefined;
    const a = AgentStore.artifactOf(r.payloadJson);
    if (!a) return { revision: r.revision, text: r.payloadJson };
    const file = this.artifactPath(a.file);
    // 引用只能指向本任务、本条目、当前修订的文件。
    if (!file || a.file !== `${taskId}/${itemId}.r${r.revision}.json`) throw new DriverError('REJECTED', '原文引用无效');
    let text: string, key: string;
    try {
      const real = realpathSync(file);
      if (relative(realpathSync(this.artifactDir!), real).startsWith('..')) throw new Error('outside');
      const st = statSync(real); key = `${real}:${st.ino}:${st.size}:${st.mtimeMs}:${a.sha256}`;
      if (this.artifactCache?.key === key) return { revision: r.revision, text: this.artifactCache.text };
      text = readFileSync(real, 'utf8');
    } catch { throw new DriverError('REJECTED', '原文文件丢失，无法读取全文'); }
    if (Buffer.byteLength(text) !== a.bytes || sha256(text) !== a.sha256) throw new DriverError('REJECTED', '原文文件已损坏，无法读取全文');
    this.artifactCache = { key, text };
    return { revision: r.revision, text };
  }

  subscribe(listener: EventListener) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify(events: StoredEvent[]) { for (const e of events) for (const l of [...this.listeners]) { try { l(e); } catch { /* 订阅者自身负责 */ } } }

  /** 在事务内追加事件；返回已提交事件，由调用方在事务外 notify。 */
  private appendIn(taskId: string, type: string, payload: unknown, itemId: string | null = null, revision: number | null = null): StoredEvent {
    const { seq } = this.sqlite.prepare('SELECT COALESCE(MAX(seq),0)+1 AS seq FROM agent_events WHERE task_id=?').get(taskId) as { seq: number };
    const stored = boundedJson(payload);
    this.sqlite.prepare('INSERT INTO agent_events(task_id,seq,event_type,item_id,revision,payload,created_at) VALUES(?,?,?,?,?,?,?)').run(taskId, seq, type, itemId, revision, stored, now());
    // 即时通知与持久事件同一有界形状：超过 32 KiB 的事件只带截断标记，订阅者按水位重读（复核 FR02）。
    return { taskId, seq, type, itemId, payload: stored === JSON.stringify(payload ?? null) ? payload : JSON.parse(stored) };
  }
  /** 写库与事件在同一事务；提交成功后才通知。 */
  tx<T>(fn: (emit: (taskId: string, type: string, payload: unknown, itemId?: string | null, revision?: number | null) => void) => T): T {
    const pending: StoredEvent[] = [];
    this.transactionEvents.push(pending);
    try {
      const result = this.sqlite.transaction(() => fn((taskId, type, payload, itemId = null, revision = null) => { pending.push(this.appendIn(taskId, type, payload, itemId, revision)); }))();
      this.transactionEvents.pop();
      const parent = this.transactionEvents.at(-1); if (parent) parent.push(...pending); else this.notify(pending);
      return result;
    } catch (e) { this.transactionEvents.pop(); throw e; }
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
  /** 不含凭据的创建配置快照；恢复绑定沿用创建时扩展选择。 */
  bindingLaunch(taskId: string, profileId: string) {
    const row = this.sqlite.prepare("SELECT b.*,s.snapshot_json FROM agent_bindings b JOIN agent_capability_sessions s ON s.binding_id=b.binding_id WHERE b.task_id=? AND b.profile_id=? AND json_extract(s.snapshot_json,'$.kind')='launch' ORDER BY b.created_at DESC,b.rowid DESC,s.revision DESC LIMIT 1").get(taskId, profileId) as (BindingRow & { snapshot_json: string }) | undefined;
    return row ? { binding: row, frozen: JSON.parse(row.snapshot_json) as { compatibility: Record<string, unknown>; stateRoot: string; cwd: string } } : undefined;
  }
  freezeBinding(bindingId: string, value: { compatibility: Record<string, unknown>; stateRoot: string; cwd: string }) {
    if (this.sqlite.prepare("SELECT 1 FROM agent_capability_sessions WHERE binding_id=? AND json_extract(snapshot_json,'$.kind')='launch' LIMIT 1").get(bindingId)) return;
    const text = JSON.stringify({ kind: 'launch', ...value });
    const row = this.sqlite.prepare('SELECT COALESCE(MAX(revision),0)+1 AS revision FROM agent_capability_sessions WHERE binding_id=?').get(bindingId) as { revision: number };
    this.sqlite.prepare('INSERT INTO agent_capability_sessions(capability_session_id,binding_id,revision,content_hash,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(), bindingId, row.revision, sha256(text), text, now());
  }
  recordTransfer(t: { id: string; taskId: string; bindingId: string; turnId: string | null; kind: 'full' | 'incremental'; text: string; covered: { itemId: string; revision: number }[]; omissions: { itemId: string; reason: string }[] }) {
    return this.itemTx((written, _replaced, emit) => {
      this.sqlite.prepare('INSERT INTO agent_transfers(transfer_id,task_id,target_binding_id,kind,through_seq,covered_ids_json,omissions_json,payload_hash,delivery_state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(t.id, t.taskId, t.bindingId, t.kind, this.watermark(t.taskId), JSON.stringify(t.covered), JSON.stringify(t.omissions), sha256(t.text), 'pending', now());
      const itemId = randomUUID();
      const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(t.taskId) as { ordinal: number };
      const payload = { transferId: t.id, inputTurnId: t.turnId, text: t.text, covered: t.covered, omissions: t.omissions, kind: t.kind, sourceKind: 'history' };
      this.sqlite.prepare("INSERT INTO agent_items(item_id,task_id,turn_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,'handoff',?,1,?,?,'completed',?,?)")
        .run(itemId, t.taskId, t.turnId, ordinal, `transfer:${t.id}`, this.itemBody(t.taskId, itemId, 1, payload, written), now(), now());
      emit(t.taskId, 'item.created', { type: 'handoff', ordinal, payload }, itemId, 1);
      return itemId;
    });
  }
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
      const sessionId = randomUUID(), text = JSON.stringify({ kind: 'run_preparing', runId: r.runId, launchPlanHash: r.launchPlanHash });
      const revision = (this.sqlite.prepare('SELECT COALESCE(MAX(revision),0)+1 AS n FROM agent_capability_sessions WHERE binding_id=?').get(r.bindingId) as { n: number }).n;
      this.sqlite.prepare('INSERT INTO agent_capability_sessions(capability_session_id,binding_id,revision,content_hash,snapshot_json,created_at) VALUES(?,?,?,?,?,?)').run(sessionId, r.bindingId, revision, sha256(text), text, now());
      this.sqlite.prepare("INSERT INTO capability_runs(run_id,task_id,project_id,runner,state,started_at,owner_instance_id,owner_pid,owner_started_at,binding_id,capability_session_id,driver_id,generation,launch_plan_hash,binding_mode) VALUES(?,?,?,?,'preparing',?,?,?,?,?,?,?,?,?,'run')")
        .run(r.runId, r.taskId, r.projectId ?? '', r.driverId, now(), r.owner.instanceId, r.owner.pid, r.owner.startedAt, r.bindingId, sessionId, r.driverId, r.generation, r.launchPlanHash);
      emit(r.taskId, 'run.preparing', { runId: r.runId, bindingId: r.bindingId, generation: r.generation, driverId: r.driverId });
    });
  }
  freezeNativeRun(runId: string, value: unknown) {
    const r = this.run(runId); if (!r || r.pid || r.state !== 'preparing') throw new DriverError('STATE', '原生启动交付已经固定');
    const row = this.sqlite.prepare('SELECT snapshot_json FROM agent_capability_sessions WHERE capability_session_id=?').get(r.capability_session_id) as { snapshot_json: string };
    if (JSON.parse(row.snapshot_json).kind !== 'run_preparing') throw new DriverError('STATE', '不能替换已固定的运行能力');
    const text = JSON.stringify({ kind: 'native', runId, value }); this.sqlite.prepare('UPDATE agent_capability_sessions SET snapshot_json=?,content_hash=? WHERE capability_session_id=?').run(text, sha256(text), r.capability_session_id);
  }
  /** 只接受本宿主自己启动的原生进程 PID（来自 ChildProcess），不接受客户端或模型自报。 */
  attachRunProcess(runId: string, taskId: string, pid: number, processStartedAt: string | null) {
    this.tx(emit => {
      const changed = this.sqlite.prepare("UPDATE capability_runs SET pid=?,process_started_at=?,state='active' WHERE run_id=? AND state IN ('preparing','prepared') AND pid IS NULL").run(pid, processStartedAt, runId).changes;
      if (changed) emit(taskId, 'run.active', { runId, pid, processStartedAt });
    });
  }
  finishRun(runId: string, taskId: string, state: 'stopped' | 'failed', errorCode: string | null) {
    this.tx(emit => {
      if (this.sqlite.prepare("SELECT 1 FROM agent_events WHERE task_id=? AND event_type='run.ended' AND json_extract(payload,'$.runId')=?").get(taskId, runId)) return;
      const row = this.run(runId); if (!row || !['preparing','prepared','active','stopping','stopped','failed'].includes(row.state)) return;
      this.sqlite.prepare("UPDATE capability_runs SET state=?,error_code=?,ended_at=COALESCE(ended_at,?) WHERE run_id=?").run(state, errorCode, now(), runId);
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
  acceptTurn(t: { taskId: string; clientInputId: string; text: string; sourceKind: 'user' | 'delegation' | 'notification' | 'system'; attachments?: unknown[] }): { turn: TurnRow; duplicate: boolean } {
    // 用户消息与其他条目同一正文合同：转义后超过内联上限也转 artifact，时间线能逐字读回（复核 V02）。
    return this.itemTx((written, _replaced, emit) => {
      const existing = this.sqlite.prepare('SELECT * FROM agent_turns WHERE task_id=? AND client_input_id=?').get(t.taskId, t.clientInputId) as TurnRow | undefined;
      if (existing) return { turn: existing, duplicate: true };
      const turnId = randomUUID();
      if (Buffer.byteLength(t.text) > INPUT_TEXT_LIMIT) throw new Error(`输入超过 ${INPUT_TEXT_LIMIT / 1024} KB，请拆分或改用附件`);
      // 输入原文完整保存，派发读回的就是接受时的原文（不复用事件的 32 KiB 预览限额）。
      this.sqlite.prepare("INSERT INTO agent_turns(turn_id,task_id,client_input_id,input_ref,source_kind,status,accepted_at) VALUES(?,?,?,?,?,'accepted',?)")
        .run(turnId, t.taskId, t.clientInputId, JSON.stringify({ text: t.text, ...(t.attachments?.length ? { attachments: t.attachments } : {}) }), t.sourceKind, now());
      emit(t.taskId, 'turn.accepted', { turnId, clientInputId: t.clientInputId, sourceKind: t.sourceKind });
      // 用户消息由宿主在本地接受时记录（可信出站来源），不取原生回显（技术方案 §4 user_message）。
      const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(t.taskId) as { ordinal: number };
      const itemId = randomUUID();
      this.sqlite.prepare("INSERT INTO agent_items(item_id,task_id,turn_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,'user_message',?,1,?,?,'completed',?,?)")
        .run(itemId, t.taskId, turnId, ordinal, `input:${turnId}`, this.itemBody(t.taskId, itemId, 1, { text: t.text, sourceKind: t.sourceKind, ...(t.attachments?.length ? { attachments: (t.attachments as any[]).map(a => ({ name: a.name, kind: a.kind, image: a.image, relativePath: a.relativePath })) } : {}) }, written), now(), now());
      emit(t.taskId, 'item.created', { type: 'user_message', ordinal, payload: { text: t.text, sourceKind: t.sourceKind } }, itemId, 1);
      return { turn: this.sqlite.prepare('SELECT * FROM agent_turns WHERE turn_id=?').get(turnId) as TurnRow, duplicate: false };
    });
  }
  itemById(taskId: string, itemId: string) {
    const r = this.sqlite.prepare('SELECT item_id,revision,payload_ref FROM agent_items WHERE task_id=? AND item_id=?').get(taskId, itemId) as { item_id: string; revision: number; payload_ref: string } | undefined;
    return r ? { itemId: r.item_id, revision: r.revision, payloadJson: r.payload_ref } : undefined;
  }
  turnByClientInput(taskId: string, clientInputId: string) { return this.sqlite.prepare('SELECT * FROM agent_turns WHERE task_id=? AND client_input_id=?').get(taskId, clientInputId) as TurnRow | undefined; }
  inputForTurn(turnId: string) {
    return this.sqlite.prepare('SELECT * FROM agent_turns WHERE turn_id=?').get(turnId) as
      (TurnRow & { input_ref: string; accepted_at: string; started_at: string | null; ended_at: string | null; error_code: string | null }) | undefined;
  }

  editQueuedInput(taskId: string, turnId: string, version: string, text: string) {
    return this.itemTx((written, replaced, emit) => {
      const turn = this.inputForTurn(turnId);
      if (turn?.task_id !== taskId || turn.source_kind !== 'user' || turn.status !== 'accepted' || sha256(turn.input_ref) !== version) {
        throw new DriverError('STATE', '排队输入已变化，请重新读取');
      }
      const message = this.sqlite.prepare("SELECT item_id, revision, payload_ref FROM agent_items WHERE task_id=? AND native_key=? AND type='user_message'")
        .get(taskId, 'input:' + turnId) as { item_id: string; revision: number; payload_ref: string } | undefined;
      if (!message) throw new DriverError('STATE', '排队输入的历史记录不可用');
      const input = JSON.parse(turn.input_ref);
      const attachments = (input.attachments ?? []).map((a: any) => ({ name: a.name, kind: a.kind, image: a.image, relativePath: a.relativePath }));
      const payload = { text, sourceKind: 'user', ...(attachments.length ? { attachments } : {}) };
      const revision = message.revision + 1;
      const old = AgentStore.artifactOf(message.payload_ref);
      if (old) replaced.push(old.file);
      this.sqlite.prepare('UPDATE agent_turns SET input_ref=? WHERE turn_id=?').run(JSON.stringify({ ...input, text }), turnId);
      this.sqlite.prepare('UPDATE agent_items SET payload_ref=?, revision=?, updated_at=? WHERE item_id=?')
        .run(this.itemBody(taskId, message.item_id, revision, payload, written), revision, now(), message.item_id);
      emit(taskId, 'item.updated', { type: 'user_message' }, message.item_id, revision);
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
  upsertItem(i: { taskId: string; turnId: string | null; runId: string | null; nativeKey: string; nodeId?: string; type: string; payload: unknown; terminalState?: string | null }): string {
    return this.itemTx((written, replaced, emit) => {
      const existing = this.sqlite.prepare('SELECT item_id,revision,payload_ref FROM agent_items WHERE task_id=? AND native_key=?').get(i.taskId, i.nativeKey) as { item_id: string; revision: number; payload_ref: string } | undefined;
      if (existing) {
        const revision = existing.revision + 1;
        const old = AgentStore.artifactOf(existing.payload_ref); if (old) replaced.push(old.file);
        this.sqlite.prepare('UPDATE agent_items SET payload_ref=?,revision=?,terminal_state=?,updated_at=? WHERE item_id=?').run(this.itemBody(i.taskId, existing.item_id, revision, i.payload, written), revision, i.terminalState ?? null, now(), existing.item_id);
        emit(i.taskId, 'item.updated', { type: i.type, payload: i.payload }, existing.item_id, revision);
        return existing.item_id;
      }
      const itemId = randomUUID();
      const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(i.taskId) as { ordinal: number };
      this.sqlite.prepare('INSERT INTO agent_items(item_id,task_id,turn_id,run_id,node_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,1,?,?,?,?,?)')
        .run(itemId, i.taskId, i.turnId, i.runId, i.nodeId ?? null, i.type, ordinal, i.nativeKey, this.itemBody(i.taskId, itemId, 1, i.payload, written), i.terminalState ?? null, now(), now());
      emit(i.taskId, 'item.created', { type: i.type, ordinal, payload: i.payload }, itemId, 1);
      return itemId;
    });
  }

  insertNativeRequest(r: { taskId: string; origin: { taskId: string; bindingId: string; runId: string; generation: number; turnId: string | null; nativeRequest: string; nodeId?: string }; kind: string; payload: unknown }): string {
    return this.tx(emit => {
      const requestId = randomUUID();
      this.sqlite.prepare("INSERT INTO agent_requests(request_id,task_id,class,origin_json,kind,payload_ref,status,created_at,updated_at) VALUES(?,?,'native',?,?,?,'pending',?,?)")
        .run(requestId, r.taskId, JSON.stringify(r.origin), r.kind, bodyJson(r.payload), now(), now());
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
      // 草稿完整保存或明确拒绝，不能截断后报成功（复核 SR02）；拒绝时原记录与修订不变。
      const text = JSON.stringify(draft ?? null);
      if (Buffer.byteLength(text) > DRAFT_STORE_LIMIT) throw new DriverError('REJECTED', '草稿过大，未保存');
      this.sqlite.prepare('UPDATE agent_tasks SET draft_json=?,draft_revision=?,updated_at=? WHERE task_id=?').run(text, revision, now(), taskId);
      return { ok: true as const, revision };
    })();
  }
  updateSelection(taskId: string, patch: Partial<AgentSelection>, expectedRevision: number, labels?: { from: string; to: string }): { ok: true; revision: number; selection: AgentSelection } | { ok: false; revision: number; selection: AgentSelection } {
    return this.itemTx((written, _replaced, emit) => {
      const row = this.sqlite.prepare('SELECT selection_json,selection_revision FROM agent_tasks WHERE task_id=?').get(taskId) as { selection_json: string; selection_revision: number } | undefined;
      if (!row) throw new Error('任务不存在');
      const current = JSON.parse(row.selection_json) as AgentSelection;
      if (row.selection_revision !== expectedRevision) return { ok: false as const, revision: row.selection_revision, selection: current };
      const selection = { ...current, ...patch }, revision = row.selection_revision + 1;
      this.sqlite.prepare('UPDATE agent_tasks SET selection_json=?,selection_revision=?,updated_at=? WHERE task_id=?').run(JSON.stringify(selection), revision, now(), taskId);
      if (current.profileId !== selection.profileId) {
        const itemId = randomUUID(), payload = { from: current.profileId, to: selection.profileId, fromName: labels?.from ?? current.profileId, toName: labels?.to ?? selection.profileId, driverId: selection.driverId };
        const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(taskId) as { ordinal: number };
        this.sqlite.prepare("INSERT INTO agent_items(item_id,task_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,'provider_switch',?,1,?,?,'completed',?,?)")
          .run(itemId, taskId, ordinal, `switch:${revision}`, this.itemBody(taskId, itemId, 1, payload, written), now(), now());
        emit(taskId, 'item.created', { type: 'provider_switch', ordinal, payload }, itemId, 1);
      }
      emit(taskId, 'selection.changed', { selection, revision });
      return { ok: true as const, revision, selection };
    });
  }
  taskFamily(taskId: string) {
    return (this.sqlite.prepare(`WITH RECURSIVE family(id) AS (
      SELECT task_id FROM agent_tasks WHERE task_id=?
      UNION SELECT a.task_id FROM agent_tasks a JOIN family f ON a.parent_task_id=f.id
    ) SELECT id FROM family`).all(taskId) as { id: string }[]).map(row => row.id);
  }

  setTasksArchived(taskIds: string[], archived: boolean) {
    const stamp = now();
    this.tx(emit => {
      const update = this.sqlite.prepare(`UPDATE agent_tasks SET archived_at=?,updated_at=? WHERE task_id=? AND archived_at IS ${archived ? '' : 'NOT '}NULL`);
      for (const id of taskIds) {
        if (update.run(archived ? stamp : null, stamp, id).changes) emit(id, archived ? 'task.archived' : 'task.unarchived', {});
      }
    });
  }

  listTasks(includeArchived = false) {
    return this.sqlite.prepare(`SELECT t.id,t.project_id,t.dir_id,t.cwd,t.title,a.selection_json,a.archived_at,a.created_at,a.updated_at,a.parent_task_id FROM tasks t JOIN agent_tasks a ON a.task_id=t.id ${includeArchived ? '' : 'WHERE a.archived_at IS NULL'} ORDER BY a.created_at DESC`).all() as
      { id: string; project_id: string | null; dir_id: string | null; cwd: string; title: string; selection_json: string; archived_at: string | null; created_at: string; updated_at: string; parent_task_id: string | null }[];
  }
  /** 排队中的输入：已接受、尚未派发，按接受顺序。 */
  queuedTurns(taskId: string) {
    return this.sqlite.prepare("SELECT turn_id,client_input_id,input_ref,accepted_at,source_kind FROM agent_turns WHERE task_id=? AND status='accepted' ORDER BY accepted_at,rowid").all(taskId) as { turn_id: string; client_input_id: string; input_ref: string; accepted_at: string; source_kind: TurnRow['source_kind'] }[];
  }
  turns(taskId: string) {
    return this.sqlite.prepare('SELECT turn_id,client_input_id,status,native_turn_id,accepted_at,started_at,ended_at,error_code,run_id,source_kind FROM agent_turns WHERE task_id=? ORDER BY accepted_at,rowid').all(taskId) as Record<string, any>[];
  }
  /** 最近的条目（renderer 每任务上限 2000 条，技术方案 §3.1）；beforeOrdinal 分页读更早的。 */
  items(taskId: string, opts: { limit?: number; beforeOrdinal?: number } = {}) {
    const limit = Math.min(opts.limit ?? 2000, 2000);
    return (this.sqlite.prepare(`SELECT * FROM (SELECT item_id,turn_id,type,ordinal,revision,payload_ref,terminal_state,created_at,updated_at FROM agent_items WHERE task_id=? AND type NOT IN ('subagent_message','subagent_status') AND ordinal<? ORDER BY ordinal DESC LIMIT ?) ORDER BY ordinal`).all(taskId, opts.beforeOrdinal ?? Number.MAX_SAFE_INTEGER, limit) as Record<string, any>[])
      .map(r => ({ itemId: r.item_id, turnId: r.turn_id, type: r.type, ordinal: r.ordinal, revision: r.revision, payload: JSON.parse(r.payload_ref), terminal: r.terminal_state, createdAt: r.created_at, updatedAt: r.updated_at }));
  }
  pendingRequests(taskId: string, present = false) {
    return (this.sqlite.prepare("SELECT request_id,class,kind,revision,payload_ref,origin_json,status,created_at FROM agent_requests WHERE task_id=? AND status IN ('pending','approved_pending_bind') ORDER BY created_at,rowid").all(taskId) as Record<string, any>[])
      .map(r => {
        const payload = JSON.parse(r.payload_ref);
        // Resolve the title for display only. The frozen review and its hash stay intact.
        const targetId = present && r.class === 'host_business' && payload?.businessKind === 'browser_access' ? payload.review?.targetTaskId : undefined;
        const target = typeof targetId === 'string'
          ? this.sqlite.prepare('SELECT b.title FROM tasks a JOIN tasks b ON a.project_id=b.project_id WHERE a.id=? AND b.id=?').get(taskId, targetId) as { title: string } | undefined
          : undefined;
        return { requestId: r.request_id, class: r.class, kind: r.kind, revision: r.revision, payload, origin: JSON.parse(r.origin_json), status: r.status, createdAt: r.created_at, targetTaskTitle: target?.title.slice(0, 120) };
      });
  }
  draft(taskId: string) {
    const r = this.sqlite.prepare('SELECT draft_json,draft_revision FROM agent_tasks WHERE task_id=?').get(taskId) as { draft_json: string; draft_revision: number } | undefined;
    if (!r) return null;
    const draft = JSON.parse(r.draft_json);
    // 旧版本按上限截断写入的草稿已无法还原：如实标“受损”，不当作空草稿（复核 SR02）。
    if (draft && typeof draft === 'object' && draft.truncated === true && typeof draft.sha256 === 'string' && 'head' in draft) return { draft: null, revision: r.draft_revision, damaged: true as const, bytes: Number(draft.bytes) || 0 };
    return { draft, revision: r.draft_revision };
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
  upsertGoal(g: { taskId: string; bindingId: string; objective: string | null; status: 'active' | 'paused' | 'complete' | 'cleared' | 'limited'; timeUsedSeconds?: number; pausedReason?: 'user' | 'waiting_children' | 'limit'; nativeCreatedAt?: number; nativeUpdatedAt?: number }) {
    this.tx(emit => {
      const cur = this.sqlite.prepare('SELECT objective,revision,turns,status FROM agent_goals WHERE task_id=?').get(g.taskId) as { objective: string; revision: number; turns: number; status: string } | undefined;
      if (g.status === 'cleared') {
        if (cur) this.sqlite.prepare("UPDATE agent_goals SET status='cleared',paused_reason=NULL,updated_at=? WHERE task_id=?").run(now(), g.taskId);
        emit(g.taskId, 'goal.changed', { status: 'cleared' });
        return;
      }
      const objective = g.objective ?? cur?.objective ?? '';
      const status = g.status === 'limited' ? 'paused' : g.status;
      const reason = status === 'paused' ? (g.status === 'limited' ? 'limit' : g.pausedReason ?? 'user') : null;
      const previous = this.goalNativeMeta(g.taskId);
      const nativeCreatedAt = Number.isFinite(g.nativeCreatedAt) ? g.nativeCreatedAt : previous.nativeCreatedAt;
      const nativeUpdatedAt = Number.isFinite(g.nativeUpdatedAt) ? g.nativeUpdatedAt : previous.nativeUpdatedAt;
      const revision = !cur ? 1 : cur.status === 'cleared' || cur.objective !== objective || (previous.nativeCreatedAt !== undefined && nativeCreatedAt !== previous.nativeCreatedAt) ? cur.revision + 1 : cur.revision;
      this.sqlite.prepare(`INSERT INTO agent_goals(task_id,binding_id,objective,revision,status,paused_reason,turns,time_used_s,updated_at) VALUES(?,?,?,?,?,?,0,?,?)
        ON CONFLICT(task_id) DO UPDATE SET binding_id=excluded.binding_id,objective=excluded.objective,revision=excluded.revision,status=excluded.status,paused_reason=excluded.paused_reason,time_used_s=MAX(agent_goals.time_used_s,excluded.time_used_s),turns=CASE WHEN agent_goals.revision<>excluded.revision THEN 0 ELSE agent_goals.turns END,updated_at=excluded.updated_at`)
        .run(g.taskId, g.bindingId, objective, revision, status, reason, Math.round(g.timeUsedSeconds ?? 0), now());
      emit(g.taskId, 'goal.changed', { objective, status, pausedReason: reason, revision, bindingId: g.bindingId, nativeCreatedAt, nativeUpdatedAt });
    });
  }
  /** 执行器不回报目标用时（Claude）时，由宿主按目标进行期间的回合用时累计。 */
  addGoalTime(taskId: string, seconds: number) { if (seconds > 0) this.sqlite.prepare("UPDATE agent_goals SET time_used_s=time_used_s+?,updated_at=? WHERE task_id=? AND status='active'").run(Math.round(seconds), now(), taskId); }
  countGoalTurn(taskId: string) { this.sqlite.prepare("UPDATE agent_goals SET turns=turns+1,updated_at=? WHERE task_id=? AND status='active'").run(now(), taskId); }
  private goalNativeMeta(taskId: string): { nativeCreatedAt?: number; nativeUpdatedAt?: number } {
    const r = this.sqlite.prepare("SELECT payload FROM agent_events WHERE task_id=? AND event_type='goal.changed' ORDER BY seq DESC LIMIT 1").get(taskId) as { payload: string } | undefined;
    if (!r) return {}; const p = JSON.parse(r.payload); return { ...(Number.isFinite(p.nativeCreatedAt) ? { nativeCreatedAt: p.nativeCreatedAt } : {}), ...(Number.isFinite(p.nativeUpdatedAt) ? { nativeUpdatedAt: p.nativeUpdatedAt } : {}) };
  }
  goal(taskId: string) {
    const r = this.sqlite.prepare('SELECT binding_id,objective,revision,status,paused_reason,turns,time_used_s,updated_at FROM agent_goals WHERE task_id=?').get(taskId) as Record<string, any> | undefined;
    return r && r.status !== 'cleared' ? { ...this.goalNativeMeta(taskId), bindingId: r.binding_id, objective: r.objective, revision: r.revision, status: r.status, pausedReason: r.paused_reason, turns: r.turns, timeUsedSeconds: r.time_used_s, updatedAt: r.updated_at } : null;
  }

  /** 宿主条目（启动失败等用户可见原因，复核 CR17）：不属于任何原生运行。 */
  addHostItem(taskId: string, turnId: string | null, type: 'error' | 'system_notice' | 'provider_switch' | 'handoff' | 'omission_notice' | 'subtask' | 'notification' | 'files_changed', payload: Record<string, unknown>) {
    return this.itemTx((written, _replaced, emit) => {
      const itemId = randomUUID();
      const { ordinal } = this.sqlite.prepare('SELECT COALESCE(MAX(ordinal),0)+1 AS ordinal FROM agent_items WHERE task_id=?').get(taskId) as { ordinal: number };
      this.sqlite.prepare("INSERT INTO agent_items(item_id,task_id,turn_id,type,ordinal,revision,native_key,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,?,?,1,?,?,'completed',?,?)")
        .run(itemId, taskId, turnId, type, ordinal, `host:${itemId}`, this.itemBody(taskId, itemId, 1, payload, written), now(), now());
      emit(taskId, 'item.created', { type, ordinal, payload }, itemId, 1);
      return itemId;
    });
  }
  /** 已请求关闭但尚未观察到进程退出：保留占用（复核 CR04）。 */
  markRunStopping(runId: string, taskId: string) {
    this.tx(emit => { if (this.sqlite.prepare("UPDATE capability_runs SET state='stopping' WHERE run_id=? AND state IN ('preparing','active')").run(runId).changes) emit(taskId, 'run.stopping', { runId }); });
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
