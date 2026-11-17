import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { BridgeTool } from '@shared/application-bridge';
import type { AgentHostTools } from '../applications/agent-host-tools';
import type { RunContext } from '../applications/run-registry';
import { AgentStore, sha256, type AgentSelection } from './agent-store';
import { AgentRunService, type RunHandle } from './agent-run-service';
import { AgentTaskService, rangeOf } from './agent-task-service';
import { DriverError } from './driver';
import type { DriverId } from './capabilities';
import { DirectoryQueue, directoryIdentity } from './directory-queue';
import { GitWorkspaces } from './git-workspaces';
import { resolveTier, type Tier } from './permissions';
import type { TaskCoordination } from './task-coordination';
const at = () => new Date().toISOString();
const key = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
const delegateSchema = z.object({ requestKey: key, profileId: z.string().min(1).max(128), title: z.string().trim().min(1).max(120), instructions: z.string().min(1).refine(s => Buffer.byteLength(s) <= 128 * 1024), model: z.string().min(1).max(256).optional(), access: z.enum(['read', 'write']).optional() }).strict();
type DelegateInput = z.infer<typeof delegateSchema>;
export interface DelegationProfile { profileId: string; driverId: DriverId; name: string; revision: string; available: boolean; models: string[]; trustedRead?: boolean }
interface Target { profile: DelegationProfile; model?: string; tier: Tier; requestedAccess: string; actualAccess: 'read' | 'write'; strategy: 'git' | 'serial'; parentBranch?: string; parentCwd: string; title: string; directoryIdentity: string; startHead?: string; resultItemId?: string; mergeFailures?: number }
export interface DelegationRow { delegation_id: string; parent_task_id: string; child_task_id: string; parent_run_id: string; target_json: string; access: 'read' | 'write'; request_key: string; result_revision: number; delivery_state: 'queued' | 'running' | 'delivered' | 'queued_for_parent' | 'canceled' | 'failed' }
interface Attempt { attempt_id: string; delegation_id: string; ordinal: number; kind: string; input_ref: string; child_turn_id: string | null; commit_range: string | null; notified_at: string | null; merge_check_json: string | null }
/** Public delegation and UI use the same persistent command service. A caller's identity is always host-derived. */
export class DelegationService implements TaskCoordination, AgentHostTools {
  readonly queue: DirectoryQueue;
  private readonly draining = new Map<string, string>();
  private readonly preparing = new Set<string>();
  private readonly prepareAbort = new Map<string, AbortController>();
  private readonly finishing = new Set<string>();
  private readonly resultFinishing = new Set<string>();
  private readonly notices = new Set<string>();
  private readonly contexts = new Map<string, string>();
  private readonly pendingWork = new Set<Promise<void>>();
  private readonly pausing = new Map<string, Promise<void>>();
  private scheduled = false; private working = false; private again = false; private closed = false;
  private readonly timer: ReturnType<typeof setInterval>;
  private readonly disposeListeners: (() => void)[] = [];
  constructor(private readonly d: { store: AgentStore; runs: AgentRunService; tasks: AgentTaskService; git: GitWorkspaces; roots(taskId: string): string[]; profile(id: string): DelegationProfile; profiles(): DelegationProfile[]; project(id: string | null): { id: string; name: string }; drained?(runId: string): Promise<boolean>; maxChildren?: number }) {
    this.queue = new DirectoryQueue(d.store); d.tasks.attachCoordination(this);
    this.disposeListeners.push(d.runs.onLive(({ taskId, runId, event }) => {
      if (event.type === 'node.state') this.schedule();
      if (event.type === 'turn.completed') {
        const goal = d.store.goal(taskId);
        if (!this.parentOf(taskId) && !this.waitingChildren(taskId) && !this.unverifiedMerges(taskId) && (goal?.status === 'active' || !this.competitor(taskId))) return;
        // Freeze before turn.ended listeners can pump another input or a goal can open its next turn.
        this.draining.set(taskId, runId); d.runs.hold(taskId, true); void this.pauseWaitingGoal(taskId, runId).catch(() => {}); this.schedule();
      }
    }));
    this.disposeListeners.push(d.store.subscribe(e => {
      if (e.type.startsWith('request.')) { const parent = this.parentOf(e.taskId); if (parent) d.store.tx(emit => emit(parent.parent_task_id, 'delegation.requestChanged', { childTaskId: e.taskId })); }
      if (e.type === 'run.ended') { const q = this.queue.forTask(e.taskId), runId = (e.payload as { runId: string }).runId; if (q?.state === 'active' && q.run_id === runId) { this.draining.set(e.taskId, runId); d.runs.hold(e.taskId, true); } }
      if (e.type === 'turn.ended' || e.type === 'run.ended' || e.type.startsWith('directory.') || e.type === 'delegation.changed') this.schedule();
      if (e.type === 'turn.started') {
        const t = d.store.turn((e.payload as { turnId: string }).turnId);
        if (t?.source_kind === 'notification') {
          for (const row of this.rows(e.taskId).filter(r => r.delivery_state === 'queued_for_parent')) if (t.client_input_id === `result-${this.attempt(row).attempt_id}`) this.update(row, 'delivered');
          void this.resumeWaitingGoal(e.taskId);
        }
      }
      if (e.type === 'run.preparing') { const q = this.queue.forTask(e.taskId), id = (e.payload as { runId: string }).runId; if (q?.state === 'active') this.queue.bind(q.queue_id, id); }
    }));
    // Unknown active rows after a crash remain occupied until their exact process/business proof is available.
    for (const q of d.store.sqlite.prepare("SELECT * FROM agent_directory_queue WHERE state='active'").all() as { task_id: string; run_id: string | null }[]) if (q.run_id) this.draining.set(q.task_id, q.run_id);
    this.timer = setInterval(() => this.schedule(), 1000); this.timer.unref();
  }
  async close() { this.closed = true; this.prepareAbort.forEach(a=>a.abort()); clearInterval(this.timer); this.disposeListeners.forEach(f => f()); await Promise.allSettled([...this.pendingWork]); }
  private track(work:Promise<void>) {this.pendingWork.add(work);void work.finally(()=>this.pendingWork.delete(work)).catch(()=>{});return work;}
  private rows(parentTaskId?: string) { return this.d.store.sqlite.prepare(`SELECT * FROM agent_delegations${parentTaskId ? ' WHERE parent_task_id=?' : ''} ORDER BY rowid`).all(...(parentTaskId ? [parentTaskId] : [])) as DelegationRow[]; }
  private parentOf(childTaskId: string) { return this.d.store.sqlite.prepare('SELECT * FROM agent_delegations WHERE child_task_id=?').get(childTaskId) as DelegationRow | undefined; }
  private attempt(d: DelegationRow) { return this.d.store.sqlite.prepare('SELECT * FROM agent_delegation_attempts WHERE delegation_id=? ORDER BY ordinal DESC LIMIT 1').get(d.delegation_id) as Attempt; }
  private selection(taskId: string) { const t = this.d.store.task(taskId); if (!t || t.archived_at) throw new DriverError('REJECTED', '任务不存在或已归档'); return { task: t, selection: JSON.parse(t.selection_json) as AgentSelection }; }
  private stopped(taskId: string) { const e = this.d.store.sqlite.prepare("SELECT event_type FROM agent_events WHERE task_id=? AND event_type IN ('task.user_stopped','task.user_continued') ORDER BY seq DESC LIMIT 1").get(taskId) as { event_type: string } | undefined; return e?.event_type === 'task.user_stopped'; }
  userContinued(taskId: string) { this.d.store.tx(emit => emit(taskId, 'task.user_continued', {})); this.schedule(); }
  readOnly(taskId: string) { return this.parentOf(taskId)?.access === 'read'; }
  blocked(taskId: string) { return this.draining.has(taskId) || this.preparing.has(taskId); }
  private competitor(taskId: string) { return this.queue.hasQueuedCompetitor(taskId); }
  private unverifiedMerges(taskId: string) { return this.rows(taskId).some(r=>{if(r.delivery_state!=='delivered')return false;const a=this.attempt(r);return !!a.commit_range&&JSON.parse(a.commit_range).commits?.length>0&&!(a.merge_check_json&&JSON.parse(a.merge_check_json).pass);}); }
  private pendingMerge(row: DelegationRow) {
    if (row.delivery_state !== 'delivered') return false;
    const a=this.attempt(row),target=JSON.parse(row.target_json) as Target;
    return !!a.commit_range && JSON.parse(a.commit_range).commits?.length > 0 && !(a.merge_check_json && JSON.parse(a.merge_check_json).pass) && (target.mergeFailures ?? 0) < 2;
  }
  needsAttention(taskId: string) { return this.rows(taskId).some(r => { const a=this.attempt(r);return ((JSON.parse(r.target_json) as Target).mergeFailures ?? 0) >= 2 && !!a.merge_check_json && !JSON.parse(a.merge_check_json).pass; }); }
  waitingChildren(taskId: string) { return this.rows(taskId).some(r => ['queued', 'running', 'queued_for_parent'].includes(r.delivery_state) || this.pendingMerge(r)); }
  hasUnfinishedChildren(taskId: string) { return this.waitingChildren(taskId) || this.rows(taskId).some(r => this.blocked(r.child_task_id)); }
  async userStopped(taskId: string, subtree: boolean) {
    this.d.store.tx(emit => emit(taskId, 'task.user_stopped', { subtree }));
    const goal = this.d.store.goal(taskId); if (goal?.status === 'paused' && goal.pausedReason === 'waiting_children') this.d.store.upsertGoal({ taskId, bindingId: goal.bindingId, objective: goal.objective, status: 'paused', pausedReason: 'user' });
    this.queue.cancel(taskId); this.prepareAbort.get(taskId)?.abort();
    const run = this.d.runs.runForTask(taskId); if (run) this.draining.set(taskId, run.runId);
    const parent = this.parentOf(taskId);
    if (parent && ['queued', 'running'].includes(parent.delivery_state)) {
      this.update(parent, 'canceled');
      for (const t of this.d.store.queuedTurns(taskId)) this.d.tasks.cancelQueued(taskId, t.turn_id);
      if (!run && !this.d.runs.closingForTask(taskId) && !this.preparing.has(taskId)) await this.finishChild({ ...parent, delivery_state: 'canceled' });
    }
    if (subtree) for (const child of this.rows(taskId)) if (['queued', 'running'].includes(child.delivery_state)) { this.update(child, 'canceled'); await this.d.tasks.stop(child.child_task_id, true); }
    this.schedule();
  }
  private update(row: DelegationRow, state: DelegationRow['delivery_state'], target?: Target) { this.d.store.tx(emit => { this.d.store.sqlite.prepare('UPDATE agent_delegations SET delivery_state=?,target_json=COALESCE(?,target_json),updated_at=? WHERE delegation_id=?').run(state, target ? JSON.stringify(target) : null, at(), row.delegation_id); emit(row.parent_task_id, 'delegation.changed', { delegationId: row.delegation_id, childTaskId: row.child_task_id, state }); emit(row.child_task_id, 'delegation.changed', { state }); }); }
  setMode(taskId: string, enabled: boolean) {
    if (typeof enabled !== 'boolean' || this.parentOf(taskId)) throw new DriverError('REJECTED', '子任务不能再开启宿主委派');
    this.selection(taskId);
    this.d.store.tx(emit => { this.d.store.sqlite.prepare('UPDATE agent_tasks SET mode=?,updated_at=? WHERE task_id=?').run(enabled || this.hasUnfinishedChildren(taskId) ? 'multi' : 'single', at(), taskId); emit(taskId, enabled ? 'delegation.enabled' : 'delegation.disabled', { enabled }); });
    return this.view(taskId);
  }
  private enabled(taskId: string) {
    const row = this.d.store.sqlite.prepare("SELECT event_type FROM agent_events WHERE task_id=? AND event_type IN ('delegation.enabled','delegation.disabled') ORDER BY seq DESC LIMIT 1").get(taskId) as { event_type: string } | undefined;
    return row?.event_type === 'delegation.enabled';
  }
  private caller(runId: string) {
    const run = this.d.runs.active(runId), record = this.d.store.run(runId);
    if (!run || !record || !record.pid || !record.process_started_at || record.state !== 'active') throw new DriverError('REJECTED', '调用来源不是当前已登记运行');
    if (this.blocked(run.taskId) || this.stopped(run.taskId)) throw new DriverError('STATE', '调用来源已停止或正在交出写入资格');
    return run;
  }
  async delegate(runId: string, raw: DelegateInput) {
    const run = this.caller(runId), parent = this.selection(run.taskId), value = delegateSchema.parse(raw);
    const known = this.d.store.sqlite.prepare('SELECT * FROM agent_delegations WHERE parent_task_id=? AND request_key=?').get(run.taskId, value.requestKey) as DelegationRow | undefined;
    if (known) return this.receipt(known);
    if (this.parentOf(run.taskId) || !this.enabled(run.taskId)) throw new DriverError('REJECTED', '当前任务未开启新委派，或已经是子任务');
    const profile = this.d.profile(value.profileId); if (!profile.available || value.model && !profile.models.includes(value.model)) throw new DriverError('REJECTED', '目标智能体或模型不可用');
    const tier = resolveTier(profile.driverId, parent.selection.tier as Tier); if (!tier.ok) throw new DriverError('REJECTED', '目标没有可继承的档位');
    const root = directoryIdentity(parent.task.cwd, this.d.roots(run.taskId)), repo = await this.d.git.detect(parent.task.cwd);
    this.caller(runId); // Recheck after asynchronous Git discovery; no stale caller can create children.
    const readOnly = value.access === 'read' && profile.trustedRead === true;
    const target: Target = { profile, model: value.model, tier: tier.tier, requestedAccess: value.access ?? 'write', actualAccess: readOnly ? 'read' : 'write', strategy: repo && !readOnly ? 'git' : 'serial', parentBranch: repo?.branch, parentCwd: parent.task.cwd, title: value.title, directoryIdentity: root.identity };
    const result = this.d.store.tx(emit => {
      const duplicate = this.d.store.sqlite.prepare('SELECT * FROM agent_delegations WHERE parent_task_id=? AND request_key=?').get(run.taskId, value.requestKey) as DelegationRow | undefined; if (duplicate) return duplicate;
      const childTaskId = this.d.store.createTask({ projectId: parent.task.project_id, dirId: null, cwd: parent.task.cwd, title: value.title, parentTaskId: run.taskId, selection: { driverId: profile.driverId, profileId: profile.profileId, model: value.model, tier: tier.tier, carryExtensions: parent.selection.extensionPreferences?.[profile.profileId] ?? true } });
      const id = randomUUID(), attempt = randomUUID();
      this.d.store.sqlite.prepare("INSERT INTO agent_delegations(delegation_id,parent_task_id,child_task_id,parent_run_id,target_json,access,request_key,delivery_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'queued',?,?)").run(id, run.taskId, childTaskId, runId, JSON.stringify(target), target.actualAccess, value.requestKey, at(), at());
      this.d.store.sqlite.prepare("INSERT INTO agent_delegation_attempts(attempt_id,delegation_id,ordinal,kind,input_ref,created_at) VALUES(?,?,1,'initial',?,?)").run(attempt, id, JSON.stringify({ text: value.instructions, sourceKind: 'delegation', parentRunId: runId }), at());
      const accepted = this.d.store.acceptTurn({ taskId: childTaskId, clientInputId: `delegate-${attempt}`, text: this.childInput(value.instructions), sourceKind: 'delegation' });
      this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET child_turn_id=? WHERE attempt_id=?').run(accepted.turn.turn_id, attempt);
      this.queue.enter(childTaskId, root.identity, readOnly);
      this.d.store.addHostItem(run.taskId, run.turnId ?? null, 'subtask', { delegationId: id, childTaskId, title: value.title, profileName: profile.name, status: 'queued', access: target.actualAccess, ...(value.access === 'read' && !readOnly ? { notice: '当前扩展与业务入口未能证明全链路只读，按写入型管理' } : {}) });
      emit(run.taskId, 'delegation.changed', { delegationId: id, childTaskId, state: 'queued' });
      return this.d.store.sqlite.prepare('SELECT * FROM agent_delegations WHERE delegation_id=?').get(id) as DelegationRow;
    });
    this.schedule(); return this.receipt(result);
  }
  private receipt(r: DelegationRow) { return { delegationId: r.delegation_id, childTaskId: r.child_task_id, state: r.delivery_state, resultRevision: r.result_revision, asynchronous: true, message: '已持久接受；不要在 shell 循环等待，当前回合结束且排空后宿主会启动子任务并通知结果。' }; }
  private owned(parentTaskId: string, childTaskId: string) { const r = this.parentOf(childTaskId); if (!r || r.parent_task_id !== parentTaskId) throw new DriverError('REJECTED', '只能操作本任务派出的子任务'); return r; }
  async send(runId: string, childTaskId: string, requestKey: string, text: string) {
    const run = this.caller(runId), row = this.owned(run.taskId, childTaskId); key.parse(requestKey);
    if (!text.trim() || Buffer.byteLength(text) > 128 * 1024) throw new DriverError('REJECTED', '子任务消息无效');
    const duplicate = this.d.store.sqlite.prepare("SELECT * FROM agent_delegation_attempts WHERE delegation_id=? AND json_extract(input_ref,'$.requestKey')=?").get(row.delegation_id, requestKey) as Attempt | undefined; if (duplicate) return { ...this.receipt(row), attemptId: duplicate.attempt_id, duplicate: true };
    if (['queued', 'running'].includes(row.delivery_state)) {
      const attempt = this.attempt(row), input = JSON.parse(attempt.input_ref) as { text: string; followUps?: string[] };
      const receipt = this.d.store.tx(() => { const accepted = this.d.tasks.enqueueHost(childTaskId, `send-${sha256(requestKey).slice(0, 32)}-${row.delegation_id}`, text, 'delegation', !this.stopped(childTaskId));
        if (!accepted.duplicate) this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET input_ref=? WHERE attempt_id=?').run(JSON.stringify({ ...input, followUps: [...(input.followUps ?? []), accepted.turn.turn_id] }), attempt.attempt_id); return accepted; });
      return { ...this.receipt(row), turnId: receipt.turn.turn_id, duplicate: receipt.duplicate, queued: true };
    }
    const target = JSON.parse(row.target_json) as Target, parent = this.selection(run.taskId), child = this.selection(childTaskId);
    const tier = resolveTier(child.selection.driverId, lowerTier(parent.selection.tier as Tier, child.selection.tier as Tier)); if (!tier.ok) throw new DriverError('REJECTED', '子任务档位不可用');
    this.d.tasks.setSelection(childTaskId, { tier: tier.tier }, child.task.selection_revision);
    const old = this.attempt(row), id = randomUUID();
    this.d.store.tx(() => { this.d.store.sqlite.prepare("INSERT INTO agent_delegation_attempts(attempt_id,delegation_id,ordinal,kind,input_ref,created_at) VALUES(?,?,?,'rework',?,?)").run(id, row.delegation_id, old.ordinal + 1, JSON.stringify({ text, requestKey, sourceKind: 'delegation' }), at()); this.update(row, 'queued', { ...target, startHead: old.commit_range && old.merge_check_json && JSON.parse(old.merge_check_json).pass ? JSON.parse(old.commit_range).head : target.startHead, resultItemId: undefined, mergeFailures: 0 });
      const accepted = this.d.store.acceptTurn({ taskId: childTaskId, clientInputId: `delegate-${id}`, text: this.childInput(text), sourceKind: 'delegation' });
      this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET child_turn_id=? WHERE attempt_id=?').run(accepted.turn.turn_id, id);
      this.userContinued(childTaskId);
    });
    this.schedule(); return { ...this.receipt({ ...row, delivery_state: 'queued' }), attemptId: id };
  }
  requestWrite(taskId: string) {
    const row = this.parentOf(taskId); if (!row || row.access !== 'read') throw new DriverError('REJECTED', '当前任务不是只读子任务');
    const target = JSON.parse(row.target_json) as Target;
    this.update(row, row.delivery_state, { ...target, requestedAccess: 'write' });
    return { state: 'queued_for_write', message: '本轮仍是只读。结束本轮并排空后才能进入写入队列，禁止继续尝试写入。' };
  }
  async cancel(parentTaskId: string, childTaskId: string) { const row = this.owned(parentTaskId, childTaskId); this.update(row, 'canceled'); await this.d.tasks.stop(childTaskId, true); this.schedule(); return this.receipt({ ...row, delivery_state: 'canceled' }); }
  view(taskId: string) {
    this.selection(taskId); const parent = this.parentOf(taskId), rows = this.rows(taskId);
    const workspace = (id: string) => { const w = this.d.git.workspace(id); return w ? { path: w.path, branch: w.branch, baseCommit: w.base_commit, state: w.state } : null; };
    const children: { delegationId: string; childTaskId: string; state: DelegationRow['delivery_state']; resultRevision: number; title: string; profileName: string; attempts: number; needsHandling: boolean; workspace: ReturnType<typeof workspace> }[] = [];
    for (const r of rows) {
      const t = JSON.parse(r.target_json) as Target, c = { delegationId: r.delegation_id, childTaskId: r.child_task_id, state: r.delivery_state, resultRevision: r.result_revision, title: t.title, profileName: t.profile.name, attempts: this.attempt(r).ordinal, needsHandling: (t.mergeFailures ?? 0) >= 2 && !!this.attempt(r).merge_check_json && !JSON.parse(this.attempt(r).merge_check_json!).pass, workspace: workspace(r.child_task_id) };
      if (children.length >= 100 || Buffer.byteLength(JSON.stringify(children)) + Buffer.byteLength(JSON.stringify(c)) > 64 * 1024) break;
      children.push(c);
    }
    return { enabled: this.enabled(taskId), mode: (this.d.store.sqlite.prepare('SELECT mode FROM agent_tasks WHERE task_id=?').get(taskId) as { mode: string } | undefined)?.mode ?? 'single', parentTaskId: parent?.parent_task_id ?? null, queue: this.queue.forTask(taskId), workspace: workspace(taskId), children, childrenTotal: rows.length, needsHandling: this.needsAttention(taskId) };
  }
  treeRequests(taskId: string) {
    this.selection(taskId); const out: { ownerTaskId: string; ownerName: string; driverId: DriverId; requestId: string; kind: string; revision: number; origin: unknown; status: string; payload: Record<string, unknown>; detailTruncated: true; bytes: number }[] = [];
    let more = 0;
    for (const child of this.rows(taskId)) for (const r of this.d.store.pendingRequests(child.child_task_id).filter(r => r.status === 'pending')) {
      const x = { ...r, ownerTaskId: child.child_task_id, ownerName: (JSON.parse(child.target_json) as Target).title, driverId: this.selection(child.child_task_id).selection.driverId, payload: {}, detailTruncated: true as const, bytes: Buffer.byteLength(JSON.stringify(r.payload)) };
      if (out.length >= 200 || Buffer.byteLength(JSON.stringify(out)) + Buffer.byteLength(JSON.stringify(x)) > 96 * 1024) more++; else out.push(x);
    }
    return { requests: out, more };
  }
  observe(parentTaskId: string, childTaskId?: string, offset = 0) {
    const rows = childTaskId ? [this.owned(parentTaskId, childTaskId)] : this.rows(parentTaskId);
    return rows.map(r => { const target = JSON.parse(r.target_json) as Target, a = this.attempt(r); const item = target.resultItemId ? this.d.store.readItemBody(parentTaskId, target.resultItemId) : null; return { ...this.receipt(r), title: target.title, attemptId: a.attempt_id, ...(item ? { body: rangeOf(item.text, offset) } : {}), commitRange: a.commit_range ? JSON.parse(a.commit_range) : null, mergeCheck: a.merge_check_json ? JSON.parse(a.merge_check_json) : null }; });
  }
  async beforeDispatch(taskId: string) {
    if (this.blocked(taskId) || this.closed || this.stopped(taskId)) return false;
    const child = this.parentOf(taskId);
    if (child) {
      if (child.delivery_state !== 'running') return false;
      const target = JSON.parse(child.target_json) as Target;
      if (target.profile.revision !== this.d.profile(target.profile.profileId).revision) throw new DriverError('REJECTED', '委派目标配置已经变化，保留原收据，须重新委派');
      const c = this.selection(taskId), p = this.selection(child.parent_task_id), tier = resolveTier(c.selection.driverId, lowerTier(c.selection.tier as Tier, p.selection.tier as Tier));
      if (!tier.ok) throw new DriverError('REJECTED', '无法继承父任务档位');
      if (tier.tier !== c.selection.tier) this.d.tasks.setSelection(taskId, { tier: tier.tier }, c.task.selection_revision);
    }
    const task = this.selection(taskId).task, root = directoryIdentity(task.cwd, this.d.roots(taskId));
    const q = this.queue.enter(taskId, root.identity, this.readOnly(taskId)); if (!this.queue.acquire(q.queue_id)) return false;
    const previous = this.d.store.sqlite.prepare("SELECT task_id FROM agent_directory_queue WHERE directory_identity=? AND state='released' AND queue_id<>? ORDER BY accepted_order DESC LIMIT 1").get(root.identity, q.queue_id) as { task_id: string } | undefined;
    if (previous && !this.notices.has(q.queue_id)) { this.notices.add(q.queue_id); const text = '宿主目录交接：上一位写入者的改动清单请查看每轮差异记录；如记录不可用则为未知。修改前重新读取工作区与涉及文件，不沿用旧内容。这是来源提示，不是新的真人授权。'; this.contexts.set(taskId, text); this.d.store.addHostItem(taskId, null, 'system_notice', { sourceKind: 'system', code: 'directoryHandoff', detail: text }); }
    return true;
  }
  opened(taskId: string, run: RunHandle) { const q = this.queue.forTask(taskId); if (q?.state === 'active') this.queue.bind(q.queue_id, run.runId); }
  dispatchContext(taskId: string) { const w = this.d.git.workspace(taskId), deps = w?.deps_result ? JSON.parse(w.deps_result) : null; return [this.contexts.get(taskId), deps?.state === 'failed' ? `宿主准备记录：依赖安装失败（${deps.command}，${deps.detail}）。此限制必须如实说明。` : ''].filter(Boolean).join('\n\n') || undefined; }
  private schedule() { if (this.closed || this.scheduled) return; this.scheduled = true; queueMicrotask(() => { this.scheduled = false; void this.track(this.work()); }); }
  private async work() {
    if (this.working) { this.again = true; return; } this.working = true;
    try {
      // An ordinary idle owner stays alive (turn-end is not run-end). It yields when another writer actually queues.
      for (const q of this.d.store.sqlite.prepare("SELECT task_id,run_id FROM agent_directory_queue WHERE state='active' AND kind='write'").all() as {task_id:string;run_id:string|null}[]) {
        const run=q.run_id?this.d.runs.active(q.run_id):undefined;
        if(run&&!this.d.runs.busy(run.runId)&&this.competitor(q.task_id)&&this.d.store.goal(q.task_id)?.status!=='active') {this.draining.set(q.task_id,run.runId);this.d.runs.hold(q.task_id,true);}
      }
      for (const [taskId, runId] of this.draining) void this.track(this.drain(taskId, runId)).catch(e=>this.warnOnce(taskId, `drain-error:${runId}`, `收口尚未完成，保留目录占用：${(e as Error).message}`));
      for (const row of this.rows()) {
        if (row.delivery_state === 'queued') {
          const target = JSON.parse(row.target_json) as Target;
          if (target.strategy === 'git' && !this.d.git.workspace(row.child_task_id) && !this.d.runs.runForTask(row.parent_task_id) && !this.d.runs.closingForTask(row.parent_task_id) && !this.draining.has(row.parent_task_id)) {
            const last = this.d.store.sqlite.prepare('SELECT run_id,state FROM capability_runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1').get(row.parent_task_id) as { run_id: string; state: string } | undefined;
            if (last && ['stopped', 'failed'].includes(last.state)) {
              const root=directoryIdentity(target.parentCwd,this.d.roots(row.parent_task_id)),reservation=this.queue.enter(row.parent_task_id,root.identity);
              if(this.queue.acquire(reservation.queue_id)){this.draining.set(row.parent_task_id,last.run_id);this.d.runs.hold(row.parent_task_id,true);}
            }
          }
          await this.startChild(row);
        }
        if (row.delivery_state === 'queued_for_parent' && !this.stopped(row.parent_task_id)) {
          const goal = this.d.store.goal(row.parent_task_id), evidence = this.pauseEvidence(row.parent_task_id);
          // After restart only a proven host waiting pause may unpause the task queue. Native revision is checked after reopening.
          if (evidence && goal?.status === 'paused' && goal.pausedReason === 'waiting_children' && evidence.bindingId === goal.bindingId && evidence.revision === goal.revision && evidence.userSeq === this.goalActionSeq(row.parent_task_id)) {
            const a = this.attempt(row), original = this.d.store.turnByClientInput(row.parent_task_id, `result-${a.attempt_id}`);
            if (original?.status === 'accepted') this.d.tasks.enqueueHost(row.parent_task_id, original.client_input_id, JSON.parse(this.d.store.queuedTurns(row.parent_task_id).find(t => t.turn_id === original.turn_id)!.input_ref).text, 'notification', true);
          }
          this.d.tasks.kick(row.parent_task_id);
        }
        if (row.delivery_state === 'running' && !this.draining.has(row.child_task_id) && !this.preparing.has(row.child_task_id) && !this.d.runs.runForTask(row.child_task_id) && !this.d.runs.closingForTask(row.child_task_id)) {
          const a = this.attempt(row), t = a.child_turn_id ? this.d.store.turn(a.child_turn_id) : null;
          const native = this.d.store.sqlite.prepare('SELECT * FROM capability_runs WHERE task_id=? ORDER BY started_at DESC LIMIT 1').get(row.child_task_id) as { run_id: string; pid: number | null; state: string } | undefined;
          if (t && !['accepted','dispatching','started'].includes(t.status) && (!native || ['stopped','failed'].includes(native.state) && (!native.pid || await (this.d.drained?.(native.run_id) ?? this.d.runs.drainNativeGroup(native.run_id))))) { await this.finishChild(row); const q = this.queue.forTask(row.child_task_id); if (q?.state === 'active' && !native?.pid) this.queue.release(q.queue_id, { nativeExited: true, descendantsDrained: true, businessDrained: true, admissionFrozen: true }); this.queue.cancel(row.child_task_id); }
        }
      }
      for (const id of new Set(this.rows().map(r => r.parent_task_id))) if (!this.enabled(id) && !this.hasUnfinishedChildren(id)) this.d.store.sqlite.prepare("UPDATE agent_tasks SET mode='single' WHERE task_id=? AND mode='multi'").run(id);
      for (const q of this.d.store.sqlite.prepare("SELECT task_id FROM agent_directory_queue WHERE state='queued' ORDER BY accepted_order").all() as { task_id: string }[]) this.d.tasks.kick(q.task_id);
    } catch (e) { console.warn('[agent/delegation] reconciliation pending:', (e as Error).message.slice(0, 160)); }
    finally { this.working = false; if (this.again) { this.again = false; this.schedule(); } }
  }
  private goalActionSeq(taskId: string) { return (this.d.store.sqlite.prepare("SELECT COALESCE(MAX(seq),0) AS n FROM agent_events WHERE task_id=? AND event_type='goal.user_action'").get(taskId) as { n: number }).n; }
  private pauseEvidence(taskId: string) {
    const r = this.d.store.sqlite.prepare("SELECT result_json FROM agent_intents WHERE task_id=? AND action='goal_pause' AND state='done' ORDER BY rowid DESC LIMIT 1").get(taskId) as { result_json: string | null } | undefined;
    return r?.result_json ? JSON.parse(r.result_json) as { bindingId: string; revision: number; objective: string; userSeq: number; native?: { objective: string; status: string; createdAt: number; updatedAt: number } } : null;
  }
  private pauseWaitingGoal(taskId: string, runId: string): Promise<void> {
    const pending = this.pausing.get(taskId); if (pending) return pending;
    const work = this.pauseGoal(taskId, runId); this.pausing.set(taskId, work); void work.finally(() => this.pausing.delete(taskId)).catch(() => {}); return work;
  }
  private async pauseGoal(taskId: string, runId: string) {
    const goal = this.d.store.goal(taskId); if (!goal || goal.status === 'complete' || goal.status === 'cleared' || (!this.waitingChildren(taskId) && !this.unverifiedMerges(taskId)) || this.stopped(taskId)) return;
    if (goal.status === 'paused' && goal.pausedReason !== 'waiting_children') return;
    if (goal.status === 'paused' && goal.pausedReason === 'waiting_children' && this.pauseEvidence(taskId)?.revision === goal.revision) return;
    const run = this.d.runs.active(runId); if (!run || run.bindingId !== goal.bindingId) return;
    const id = randomUUID(), userSeq = this.goalActionSeq(taskId), evidence = { bindingId: goal.bindingId as string, revision: goal.revision as number, objective: goal.objective as string, userSeq };
    this.d.store.tx(() => {
      this.d.store.sqlite.prepare("INSERT INTO agent_intents(intent_id,task_id,action,target_ref,state,result_json,created_at,updated_at) VALUES(?,?,'goal_pause',?,'intended',?,?,?)").run(id, taskId, goal.bindingId, JSON.stringify(evidence), at(), at());
      this.d.store.upsertGoal({ taskId, bindingId: goal.bindingId, objective: goal.objective, status: 'paused', pausedReason: 'waiting_children' });
    });
    try {
      if (run.driverId === 'codex-app-server') await this.d.runs.goal(runId, { kind: 'pause' });
      const native = run.driverId === 'codex-app-server' ? await this.d.runs.readGoal(runId) : undefined;
      const current = this.d.store.goal(taskId);
      if (!current || current.bindingId !== goal.bindingId || current.revision !== goal.revision || this.goalActionSeq(taskId) !== userSeq || this.stopped(taskId)) { this.d.store.sqlite.prepare("UPDATE agent_intents SET state='abandoned',updated_at=? WHERE intent_id=?").run(at(), id); return; }
      if (run.driverId === 'codex-app-server' && (!native || native.status !== 'paused' || native.objective !== goal.objective || !Number.isFinite(native.createdAt) || !Number.isFinite(native.updatedAt))) throw new Error('原生目标暂停状态无法核实');
      this.d.store.tx(() => { this.d.store.upsertGoal({ taskId, bindingId: goal.bindingId, objective: goal.objective, status: 'paused', pausedReason: 'waiting_children' }); this.d.store.sqlite.prepare("UPDATE agent_intents SET state='done',result_json=?,updated_at=? WHERE intent_id=?").run(JSON.stringify({ ...evidence, native }), at(), id); });
    } catch (e) { this.d.store.sqlite.prepare("UPDATE agent_intents SET state='needs_review',result_json=?,updated_at=? WHERE intent_id=?").run(JSON.stringify({ ...evidence, error: (e as Error).message }), at(), id); const g = this.d.store.goal(taskId); if (g && g.revision === goal.revision) this.d.store.upsertGoal({ taskId, bindingId: g.bindingId, objective: g.objective, status: 'paused', pausedReason: 'user' }); this.warnOnce(taskId, `goal-pause:${id}`, '目标暂停状态未能核实，不会自动恢复；原写入资格仍按退出与排空处理。'); }
  }
  private async drain(taskId: string, runId: string) {
    if (this.finishing.has(taskId)) return; this.finishing.add(taskId);
    try {
      const run = this.d.runs.active(runId);
      if (run && this.d.runs.busy(runId) && !this.stopped(taskId)) return;
      if (run?.driverId === 'codex-app-server' && this.stopped(taskId) && this.d.store.goal(taskId)?.status === 'active') await this.d.runs.goal(runId, { kind: 'pause' });
      this.d.runs.hold(taskId, true); await this.pauseWaitingGoal(taskId, runId);
      if (this.d.runs.nativeBusy(runId) && !this.stopped(taskId)) return;
      if (this.d.store.pendingRequests(taskId).some(r => r.class === 'native' && r.status === 'pending' && r.origin.runId === runId) && !this.stopped(taskId)) return;
      if (run) await this.d.runs.close(runId);
      if (this.d.runs.closingForTask(taskId)) return;
      const record = this.d.store.run(runId); if (!record || !['stopped', 'failed', 'orphaned'].includes(record.state)) return;
      const drained = await (this.d.drained?.(runId) ?? this.d.runs.drainNativeGroup(runId)); if (!drained) { this.warnOnce(taskId, `drain:${runId}`, '原生进程组或业务退出未能核实，保留写入资格；不会按超时交给下一个任务。'); return; }
      if (this.d.store.run(runId)?.state === 'orphaned') this.d.store.sqlite.prepare("UPDATE capability_runs SET state='failed',error_code='ORPHAN_OWNER_DRAINED' WHERE run_id=? AND state='orphaned'").run(runId);
      // Workspace creation happens only inside the frozen parent boundary, before releasing its write slot.
      for (const child of this.rows(taskId).filter(r => r.delivery_state === 'queued')) await this.prepareChild(child);
      const child = this.parentOf(taskId);
      const upgrade = child && child.access === 'read' && (JSON.parse(child.target_json) as Target).requestedAccess === 'write' && !this.stopped(taskId);
      if (child && !upgrade) await this.finishChild(child);
      else await this.verifyMerges(taskId);
      const q = this.queue.forTask(taskId); if (q?.state === 'active') this.queue.release(q.queue_id, { nativeExited: true, descendantsDrained: true, businessDrained: true, admissionFrozen: true });
      if (child && upgrade) {
        const target = JSON.parse(child.target_json) as Target, repo = await this.d.git.detect(target.parentCwd);
        this.d.store.tx(() => { this.d.store.sqlite.prepare("UPDATE agent_delegations SET access='write' WHERE delegation_id=?").run(child.delegation_id); this.update(child, 'queued', { ...target, actualAccess: 'write', strategy: repo ? 'git' : 'serial', parentBranch: repo?.branch });
          const a = this.attempt(child), accepted = this.d.tasks.enqueueHost(taskId, `write-${a.attempt_id}`, '宿主：只读轮已结束。取得写入资格后请重新读取文件，再继续原委派。', 'delegation', true);
          const input = JSON.parse(a.input_ref); this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET input_ref=? WHERE attempt_id=?').run(JSON.stringify({ ...input, followUps: [...(input.followUps ?? []), accepted.turn.turn_id] }), a.attempt_id);
        });
      }
      this.draining.delete(taskId);
      this.contexts.delete(taskId);
      if (!this.stopped(taskId)) { this.d.runs.hold(taskId, false); this.d.tasks.kick(taskId); }
    } finally { this.finishing.delete(taskId); }
  }
  private async prepareChild(row: DelegationRow) {
    if (this.preparing.has(row.child_task_id)) return; this.preparing.add(row.child_task_id); const abort = new AbortController(); this.prepareAbort.set(row.child_task_id, abort);
    try {
      const target = JSON.parse(row.target_json) as Target;
      if (target.profile.revision !== this.d.profile(target.profile.profileId).revision) throw new Error('委派目标配置已变化，未启动');
      if (target.strategy === 'git') {
        if ((await this.d.git.detect(target.parentCwd))?.branch !== target.parentBranch) throw new Error('接受委派后主分支已经变化，未创建工作副本');
        const project = this.d.project(this.selection(row.parent_task_id).task.project_id);
        const created = await this.d.git.create({ parentTaskId: row.parent_task_id, childTaskId: row.child_task_id, cwd: target.parentCwd, title: target.title, projectId: project.id, projectName: project.name, signal: abort.signal, assertBoundary: () => { if (this.queue.forTask(row.parent_task_id)?.state !== 'active' || !this.draining.has(row.parent_task_id) || this.d.runs.runForTask(row.parent_task_id) || this.d.runs.closingForTask(row.parent_task_id)) throw new Error('父任务尚未完成排空'); } });
        if (!created) throw new Error('接受时的 Git 仓库已变化，不能静默换成共用目录');
        this.queue.cancel(row.child_task_id);
        this.d.store.sqlite.prepare('UPDATE tasks SET cwd=? WHERE id=?').run(created.cwd, row.child_task_id);
        target.startHead = target.startHead ?? created.workspace.base_commit!;
        const current=this.parentOf(row.child_task_id)!;this.update(current, current.delivery_state, target);
      }
    } catch (e) { this.update(row, this.stopped(row.child_task_id)?'canceled':'failed'); this.warnOnce(row.child_task_id, `prepare:${row.delegation_id}`, `子任务准备失败：${(e as Error).message}`); this.queue.cancel(row.child_task_id); for (const t of this.d.store.queuedTurns(row.child_task_id)) this.d.tasks.cancelQueued(row.child_task_id, t.turn_id); await this.finishChild({ ...row, delivery_state: 'failed' }); }
    finally { this.preparing.delete(row.child_task_id); this.prepareAbort.delete(row.child_task_id); const current=this.parentOf(row.child_task_id); if(current?.delivery_state==='canceled') await this.finishChild(current); }
  }
  private async startChild(row: DelegationRow) {
    if (this.preparing.has(row.child_task_id) || this.blocked(row.parent_task_id) || this.stopped(row.child_task_id)) return;
    const target = JSON.parse(row.target_json) as Target;
    const parentRun = this.d.runs.runForTask(row.parent_task_id);
    if (target.strategy === 'git' && this.d.git.workspace(row.child_task_id)?.state !== 'ready') { if (!parentRun && !this.d.runs.closingForTask(row.parent_task_id)) this.warnOnce(row.parent_task_id, `prepare-boundary:${row.delegation_id}`, '工作副本仍在等待父任务已核实的回合边界'); return; }
    if (target.strategy === 'serial' && target.actualAccess !== 'read' && parentRun) return;
    const running = this.rows().filter(r => r.delivery_state === 'running').length; if (running >= (this.d.maxChildren ?? 4)) return;
    const current = this.parentOf(row.child_task_id)!; if (current.delivery_state !== 'queued') return;
    const attempt = this.attempt(current), childRun = this.d.runs.runForTask(row.child_task_id);
    // Rework during a child turn queues to the same native binding/worktree; no nested delegation.
    const text = (JSON.parse(attempt.input_ref) as { text: string }).text;
    this.d.store.tx(() => { this.update(row, 'running'); const accepted = this.d.tasks.enqueueHost(row.child_task_id, `delegate-${attempt.attempt_id}`, this.childInput(text), 'delegation', true); this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET child_turn_id=? WHERE attempt_id=?').run(accepted.turn.turn_id, attempt.attempt_id); });
    if (!childRun) this.d.tasks.kick(row.child_task_id);
  }
  private childInput(text: string) { return '只读角色若需要写入，先调用 wy_request_write 并结束本轮；不能提权或绕过。宿主委派（来源 delegation，不是新的真人授权）。你是子任务，不能再派子任务。只修改当前授权工作目录；不要修改 .git，完成后由宿主提交。\n\n' + text; }
  private async finishChild(row: DelegationRow) {
    const id=this.attempt(row).attempt_id;if(this.resultFinishing.has(id))return;this.resultFinishing.add(id);
    try { await this.finishChildOwned(row); } finally { this.resultFinishing.delete(id); }
  }
  private async finishChildOwned(row: DelegationRow) {
    const a = this.attempt(row), turn = a.child_turn_id ? this.d.store.turn(a.child_turn_id) : null;
    if (!turn || ['accepted', 'dispatching', 'started'].includes(turn.status) || a.notified_at) return;
    const input = JSON.parse(a.input_ref) as { followUps?: string[] };
    const followUps = (input.followUps ?? []).map(id => this.d.store.turn(id)).filter(t => !!t);
    if (this.d.store.queuedTurns(row.child_task_id).length || followUps.some(t => ['accepted', 'dispatching', 'started'].includes(t.status))) return;
    const target = JSON.parse(row.target_json) as Target;
    const commits = target.actualAccess === 'write' ? await this.d.git.finalize(row.child_task_id, a.attempt_id, target.title, target.startHead) : null;
    const latest=this.attempt(row),currentInput=JSON.parse(latest.input_ref) as {followUps?:string[]};
    if(latest.attempt_id!==a.attempt_id||latest.notified_at||this.d.store.queuedTurns(row.child_task_id).length||(currentInput.followUps??[]).some(id=>['accepted','dispatching','started'].includes(this.d.store.turn(id)?.status??'unknown')))return;
    const turnIds = new Set([turn.turn_id, ...followUps.map(t => t.turn_id)]);
    const items = this.d.store.items(row.child_task_id, { limit: 500 }).filter(i => i.turnId && turnIds.has(i.turnId) && i.type === 'assistant_message');
    const summary = items.map(i => this.d.store.readItemBody(row.child_task_id, i.itemId)?.text ?? '').join('\n').slice(-24 * 1024);
    const currentRow=this.parentOf(row.child_task_id)!;const success = turn.status === 'completed' && followUps.every(t => t.status === 'completed') && currentRow.delivery_state !== 'canceled';
    const result = { sourceKind: 'child_result', delegationId: row.delegation_id, childTaskId: row.child_task_id, attemptId: a.attempt_id, status: success ? 'completed' : currentRow.delivery_state === 'canceled' ? 'canceled' : 'failed', summary, sourceItemIds: items.map(i => i.itemId), commits, title: target.title };
    this.d.store.tx(() => {
      const resultItemId = this.d.store.addHostItem(row.parent_task_id, null, 'notification', result);
      this.d.store.sqlite.prepare('UPDATE agent_delegations SET result_revision=result_revision+1,target_json=?,delivery_state=?,updated_at=? WHERE delegation_id=?').run(JSON.stringify({ ...target, resultItemId }), success ? 'queued_for_parent' : result.status === 'canceled' ? 'canceled' : 'failed', at(), row.delegation_id);
      this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET notified_at=? WHERE attempt_id=? AND notified_at IS NULL').run(at(), a.attempt_id);
      const merge = success && commits?.commits.length ? `\n在原主分支 ${target.parentBranch} 合并：先提交当前改动，再按顺序 git cherry-pick -x ${commits.commits.join(' ')}；逐文件解决冲突，保留双方意图。不要 reset --hard、checkout -- .、clean -fd 或强制推送。` : '';
      this.d.tasks.enqueueHost(row.parent_task_id, `result-${a.attempt_id}`, `宿主子任务结果通知（来源 child_result，不是新的真人授权）。结果引用 ${resultItemId}；子任务 ${target.title} / ${row.child_task_id}，attempt ${a.ordinal} 状态 ${result.status}。正文通过 wy_observe 领取；此通知不含新授权。${merge}`, 'notification', !this.stopped(row.parent_task_id));
    });
  }
  private autoGoalIntent(taskId: string) { return (this.d.store.sqlite.prepare("SELECT intent_id FROM agent_intents WHERE task_id=? AND action IN ('goal_pause','goal_resume') AND state<>'abandoned' ORDER BY rowid DESC LIMIT 1").get(taskId) as { intent_id: string } | undefined)?.intent_id; }
  private async resumeWaitingGoal(taskId: string) {
    const goal = this.d.store.goal(taskId), run = this.d.runs.runForTask(taskId), evidence = this.pauseEvidence(taskId);
    if (!goal || goal.status !== 'paused' || goal.pausedReason !== 'waiting_children' || !run || this.stopped(taskId)) return;
    let expectedIntent = this.autoGoalIntent(taskId);
    const decline = () => { const g = this.d.store.goal(taskId); if (g && g.revision === goal.revision && g.pausedReason === 'waiting_children') this.d.store.upsertGoal({ taskId, bindingId: g.bindingId, objective: g.objective, status: 'paused', pausedReason: 'user' }); };
    const matches = () => { const g = this.d.store.goal(taskId); return !!evidence && !!g && g.bindingId === evidence.bindingId && g.revision === evidence.revision && g.objective === evidence.objective && run.bindingId === evidence.bindingId && this.goalActionSeq(taskId) === evidence.userSeq && this.autoGoalIntent(taskId) === expectedIntent && !this.stopped(taskId); };
    if (!matches()) { decline(); this.warnOnce(taskId, `goal-resume-source:${run.runId}`, '目标或用户操作已变化，结果仍保留，未自动恢复旧目标。'); return; }
    if (run.driverId === 'codex-app-server') {
      const native = await this.d.runs.readGoal(run.runId).catch(() => undefined);
      if (!native || !evidence?.native || native.status !== 'paused' || native.objective !== evidence.objective || native.createdAt !== evidence.native.createdAt || native.updatedAt !== evidence.native.updatedAt || !matches()) { decline(); this.warnOnce(taskId, `goal-resume-state:${run.runId}`, '原生目标状态或修订已变化，未自动恢复；请核对后手动继续。'); return; }
    }
    const id = randomUUID(); this.d.store.sqlite.prepare("INSERT INTO agent_intents(intent_id,task_id,action,target_ref,state,result_json,created_at,updated_at) VALUES(?,?,'goal_resume',?,'intended',?,?,?)").run(id, taskId, run.bindingId, JSON.stringify(evidence), at(), at()); expectedIntent = id;
    try {
      if (!matches()) throw new Error('目标恢复预检已过期');
      if (run.driverId === 'codex-app-server') await this.d.runs.goal(run.runId, { kind: 'resume' });
      if (!matches()) { if (this.stopped(taskId) && run.driverId === 'codex-app-server') await this.d.runs.goal(run.runId, { kind: 'pause' }).catch(() => {}); this.d.store.sqlite.prepare("UPDATE agent_intents SET state='abandoned',updated_at=? WHERE intent_id=?").run(at(), id); return; }
      const current = this.d.store.goal(taskId)!; this.d.store.tx(() => { this.d.store.upsertGoal({ taskId, bindingId: current.bindingId, objective: current.objective, status: 'active' }); this.d.store.sqlite.prepare("UPDATE agent_intents SET state='done',updated_at=? WHERE intent_id=?").run(at(), id); });
    } catch (e) { this.d.store.sqlite.prepare("UPDATE agent_intents SET state='needs_review',updated_at=? WHERE intent_id=?").run(at(), id); decline(); this.warnOnce(taskId, `goal-resume:${run.runId}`, `子任务结果已送达，但目标未恢复：${(e as Error).message}`); }
  }
  private async verifyMerges(taskId: string) {
    for (const row of this.rows(taskId).filter(r => r.delivery_state === 'delivered')) {
      const a = this.attempt(row), target = JSON.parse(row.target_json) as Target;
      if (!a.commit_range || !target.parentBranch || a.merge_check_json && JSON.parse(a.merge_check_json).pass) continue;
      const check = await this.d.git.checkMerge(target.parentCwd, JSON.parse(a.commit_range), target.parentBranch);
      const count = (target.mergeFailures ?? 0) + (check.pass ? 0 : 1);
      this.d.store.sqlite.prepare('UPDATE agent_delegation_attempts SET merge_check_json=? WHERE attempt_id=?').run(JSON.stringify(check), a.attempt_id);
      this.update(row, row.delivery_state, { ...target, mergeFailures: count });
      const goal = this.d.store.goal(taskId);
      if (check.pass && goal?.status === 'paused' && goal.pausedReason === 'waiting_children' && !this.stopped(taskId)) this.d.tasks.enqueueHost(taskId, `merge-verified-${a.attempt_id}`, '宿主：子任务提交已经核实合入，等待原因已解除；可以继续原目标。这是状态通知，不是新的真人授权。', 'notification', true);
      if (!check.pass && count >= 2 && goal?.status === 'paused' && goal.pausedReason === 'waiting_children') this.d.store.upsertGoal({taskId,bindingId:goal.bindingId,objective:goal.objective,status:'paused',pausedReason:'user'});
      if (!check.pass && count < 2) this.d.tasks.enqueueHost(taskId, `merge-check-${a.attempt_id}-${count}`, `宿主合并核对失败：${JSON.stringify(check)}。请重新核对并合并子任务提交；这是状态通知，不是新的真人授权。`, 'notification', !this.stopped(taskId));
      if (!check.pass) this.warnOnce(taskId, `merge:${a.attempt_id}:${count}`, count >= 2 ? '子任务提交连续两轮未能核实合入，需要你处理。' : '子任务提交尚未核实合入，请检查原分支、未结束的 cherry-pick／冲突及提交来源。');
    }
  }
  private warnOnce(taskId: string, key: string, detail: string) { if (this.notices.has(key)) return; this.notices.add(key); this.d.store.addHostItem(taskId, null, 'system_notice', { code: key, detail }); }
  list(context: RunContext): BridgeTool[] {
    if (!this.d.store.run(context.run.runId)?.binding_id) return [];
    const definitions: [string, string, Record<string, unknown>][] = [
      ['wy_targets', '查询当前宿主接入的智能体目标。身份由宿主决定。', {}],
      ['wy_observe', '观察本任务派出的子任务，按结果修订和分段领取结果；不要轮询或 shell 等待。', { childTaskId: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }],
      ['wy_cancel', '取消自己派出的子任务并等待排空。', { childTaskId: { type: 'string' } }],
      ['wy_send', '给自己派出的子任务再次发消息，沿用原会话和工作副本。', { childTaskId: { type: 'string' }, requestKey: { type: 'string' }, text: { type: 'string' } }],
    ];
    if (this.readOnly(context.run.taskId)) definitions.push(['wy_request_write', '只读任务申请进入写入队列，必须结束本轮；不会在本轮放宽权限。', {}]);
    if (!this.parentOf(context.run.taskId)) definitions.push(['wy_delegate', '异步委派：持久返回 queued 收据，结束当前回合后宿主自动启动和回送结果。不要用循环等子任务。', { requestKey: { type: 'string' }, profileId: { type: 'string' }, title: { type: 'string' }, instructions: { type: 'string' }, model: { type: 'string' }, access: { type: 'string', enum: ['read', 'write'] } }]);
    return definitions.map(([name, description, properties]) => ({ name, description, contractMajor: 1, inputSchema: { type: 'object', properties, additionalProperties: false }, outputSchema: { type: 'object' }, annotations: { readOnlyHint: name === 'wy_targets' || name === 'wy_observe', destructiveHint: false, idempotentHint: true, openWorldHint: false } }));
  }
  async call(context: RunContext, name: string, args: Record<string, unknown>, signal: AbortSignal) {
    if (signal.aborted || !this.list(context).some(t => t.name === name)) throw new DriverError('REJECTED', '此运行无权调用该宿主工具');
    const run = this.caller(context.run.runId); if (run.taskId !== context.run.taskId) throw new DriverError('REJECTED', '宿主来源不符');
    if (name === 'wy_request_write') { z.object({}).strict().parse(args); return this.requestWrite(run.taskId); }
    if (name === 'wy_targets') { z.object({}).strict().parse(args); return { targets: this.d.profiles() }; }
    if (name === 'wy_delegate') return this.delegate(run.runId, delegateSchema.parse(args));
    if (name === 'wy_observe') { const i = z.object({ childTaskId: z.string().optional(), offset: z.number().int().nonnegative().optional() }).strict().parse(args); return { children: this.observe(run.taskId, i.childTaskId, i.offset) }; }
    if (name === 'wy_send') { const i = z.object({ childTaskId: z.string(), requestKey: key, text: z.string() }).strict().parse(args); return this.send(run.runId, i.childTaskId, i.requestKey, i.text); }
    if (name === 'wy_cancel') { const i = z.object({ childTaskId: z.string() }).strict().parse(args); return this.cancel(run.taskId, i.childTaskId); }
    throw new DriverError('REJECTED', '未知宿主工具');
  }
}
export const lowerTier = (a: Tier, b: Tier): Tier => a === 'ask' || b === 'ask' ? 'ask' : a === 'auto' || b === 'auto' ? 'auto' : 'full';
