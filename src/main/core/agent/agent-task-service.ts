// M14 任务命令服务（技术方案 T1.5 §3 TaskCommandService）：输入框、IPC 与（后续）MCP 共用。
// 阶段 2：新任务、草稿／选择 CAS、提交与排队、停止、请求回应、快照与订阅、归档。切换执行器属阶段 3。
import { randomUUID } from 'node:crypto';
import type { DriverId } from './capabilities';
import type { DriverExecutable } from './driver';
import { DriverError } from './driver';
import { AgentStore, type AgentSelection, type StoredEvent } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { isTier, resolveTier, type Tier } from './permissions';
import { attachmentNote, freezeImages, prepareAttachment, verifyAttachments, type Attachment } from './attachments';
import type { CapabilityName, CapabilityResult } from './capabilities';
import { searchProjectFiles } from './file-search';

export interface ResolvedLaunch {
  driverId: DriverId;
  executable: DriverExecutable;
  env: Record<string, string>;
  stateRoot: string;
  compatibility: Record<string, unknown>;
  model?: string;
  extraArgs: string[];
  settingSources?: ('user' | 'project' | 'local')[];
  capabilities?: Record<CapabilityName, CapabilityResult>;
}
/** 由宿主按配置档案解析（发现服务＋凭据服务＋托管文件），不接受客户端提供的路径或凭据。 */
export type LaunchResolver = (input: { profileId: string; cwd: string; runId: string; model?: string }) => Promise<ResolvedLaunch>;
export type ProfileDriver = (profileId: string) => DriverId;

const SNAPSHOT_ITEM_BUDGET = 160 * 1024, HISTORY_BUDGET = 224 * 1024, ITEM_PREVIEW = 24 * 1024, REQUEST_PREVIEW = 96 * 1024, RANGE = 128 * 1024;
/** 过大的正文给预览：长字符串截短并标 truncated，完整内容经 itemBody／requestBody 范围读取。 */
function shorten(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 4000 ? v.slice(0, 4000) : v;
  if (Array.isArray(v)) return v.slice(0, 50).map(x => shorten(x, depth + 1));
  if (v && typeof v === 'object' && depth < 4) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, shorten(x, depth + 1)]));
  return v;
}
function previewItem<T extends { payload: any }>(it: T): T {
  const bytes = Buffer.byteLength(JSON.stringify(it.payload));
  return bytes <= ITEM_PREVIEW ? it : { ...it, payload: { ...(shorten(it.payload) as object), truncated: true, bytes } };
}
function previewRequest<T extends { payload: any }>(r: T): T & { detailTruncated?: boolean; bytes?: number } {
  const bytes = Buffer.byteLength(JSON.stringify(r.payload));
  // 关键请求不截断：过大的请求只给预览，界面读完完整内容后才开放批准（复核 NR06）。
  return bytes <= REQUEST_PREVIEW && !r.payload?.truncated ? r : { ...r, payload: shorten(r.payload), detailTruncated: true, bytes };
}
function rangeOf(text: string, offset: number) {
  const start = Math.max(0, Math.floor(offset) || 0);
  return { chunk: text.slice(start, start + RANGE), total: text.length, done: start + RANGE >= text.length };
}

export type TaskStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'stopped' | 'failed' | 'limited';

export class AgentTaskService {
  /** 用户按停止后暂停自动派发排队输入，直到下一次提交（停止只停本轮，不吞掉排队）。 */
  private readonly paused = new Set<string>();
  private readonly dispatching = new Set<string>();
  private readonly missedPump = new Set<string>();
  private readonly blockedByClosing = new Set<string>();
  /** 每次停止递增：异步打开运行期间按了停止，返回后不再派发（复核 CR03）。 */
  private readonly stopSeq = new Map<string, number>();
  /** Claude 目标命令已发出、尚未得到原生确认（复核 CR14）；确认后以原生事实为准。 */
  private readonly goalPending = new Map<string, { kind: 'set' | 'clear'; objective?: string; turnId?: string }>();

  constructor(private readonly d: { store: AgentStore; runs: AgentRunService; resolveLaunch: LaunchResolver; profileDriver: ProfileDriver; userData?: string }) {
    // 重启后排队的输入保留但不自动发出，等用户再次提交或取消（未知接收不自动重发）。
    for (const taskId of d.store.tasksWithQueue()) this.paused.add(taskId);
    d.store.subscribe(e => {
      if (e.type === 'goal.changed') this.goalPending.delete(e.taskId);
      if (e.type === 'turn.ended') { const g = this.goalPending.get(e.taskId); if (g?.turnId === (e.payload as { turnId?: string }).turnId) this.goalPending.delete(e.taskId); }
      if (e.type === 'run.ended' && this.blockedByClosing.delete(e.taskId)) this.paused.delete(e.taskId);
      if (e.type === 'turn.ended' || e.type === 'run.ended') {
        // 派发进行中到达的终态会被门闩挡掉：记下来，门闩释放后补一次调度（复核 NR03）。
        if (this.dispatching.has(e.taskId)) this.missedPump.add(e.taskId);
        queueMicrotask(() => void this.pump(e.taskId));
      }
    });
  }

  create(input: { projectId: string | null; dirId: string | null; cwd: string; title: string; profileId: string; tier: Tier; model?: string }) {
    const driverId = this.d.profileDriver(input.profileId);
    const tier = resolveTier(driverId, input.tier);
    if (!tier.ok) throw new DriverError('REJECTED', '不支持的权限档位');
    const selection: AgentSelection = { driverId, profileId: input.profileId, tier: tier.tier, ...(input.model ? { model: input.model } : {}) };
    const title = input.title.trim().slice(0, 120) || '新任务';
    return { taskId: this.d.store.createTask({ projectId: input.projectId, dirId: input.dirId, cwd: input.cwd, title, selection }), selection, ...(tier.downgraded ? { tierNotice: tier.reason } : {}) };
  }

  private selection(taskId: string) {
    const t = this.d.store.task(taskId);
    if (!t) throw new DriverError('REJECTED', '任务不存在');
    if (t.archived_at) throw new DriverError('REJECTED', '任务已归档');
    return { task: t, selection: JSON.parse(t.selection_json) as AgentSelection, revision: t.selection_revision };
  }

  /** 同一执行器内改档位或模型；换执行器属阶段 3（且有目标时禁止）。 */
  setSelection(taskId: string, patch: { tier?: Tier; model?: string | null }, expectedRevision: number) {
    const { selection } = this.selection(taskId);
    const next: Partial<AgentSelection> = {};
    if (patch.tier !== undefined) {
      if (!isTier(patch.tier)) throw new DriverError('REJECTED', '不支持的权限档位');
      const r = resolveTier(selection.driverId, patch.tier);
      if (!r.ok) throw new DriverError('REJECTED', '不支持的权限档位');
      next.tier = r.tier;
    }
    if (patch.model !== undefined) {
      if (patch.model !== null && (!patch.model.trim() || patch.model.length > 256 || /[\x00-\x1f]/.test(patch.model))) throw new DriverError('REJECTED', '模型无效');
      next.model = patch.model ?? undefined;
    }
    return this.d.store.updateSelection(taskId, next, expectedRevision);
  }

  saveDraft(taskId: string, draft: unknown, expectedRevision: number) { this.selection(taskId); return this.d.store.saveDraft(taskId, draft, expectedRevision); }

  /** 提交：先持久接受（幂等），忙则排队；空闲立即派发。mode=steer 时尝试插话，不支持则保留在排队并说明原因。 */
  async submit(taskId: string, input: { clientInputId: string; text: string; expectedSelectionRevision: number; mode?: 'queue' | 'steer'; attachments?: unknown[] }) {
    const { revision, task } = this.selection(taskId);
    if (input.expectedSelectionRevision !== revision) throw new DriverError('REJECTED', '模型或权限已变化，请确认后再发送');
    // 幂等命中直接返回原收据，不再准备或冻结附件（复核 NR01）。
    const existing = this.d.store.turnByClientInput(taskId, input.clientInputId);
    if (existing) return { turnId: existing.turn_id, duplicate: true, status: existing.status };
    if (Buffer.byteLength(input.text) > 256 * 1024) throw new DriverError('REJECTED', '输入超过 256 KB，请拆分或改用附件');
    const verified = this.d.userData ? verifyAttachments(input.attachments, task.cwd, this.d.userData) : [];
    // 图片在接受时冻结副本，派发只读副本（复核 CR01）。
    const attachments = this.d.userData ? freezeImages(verified, task.cwd, this.d.userData) : verified;
    if (!input.text.trim() && !attachments.length) throw new DriverError('REJECTED', '内容为空');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.clientInputId)) throw new DriverError('REJECTED', '输入标识无效');
    const accepted = this.d.store.acceptTurn({ taskId, clientInputId: input.clientInputId, text: input.text, sourceKind: 'user', attachments });
    if (accepted.duplicate) return { turnId: accepted.turn.turn_id, duplicate: true, status: accepted.turn.status };
    this.paused.delete(taskId);
    this.d.runs.hold(taskId, false);
    const run = this.d.runs.runForTask(taskId);
    if (input.mode === 'steer' && run && this.d.runs.busy(run.runId)) {
      if (!this.steerable(run)) return { turnId: accepted.turn.turn_id, duplicate: false, status: 'queued', steerRefused: '该执行器版本没有插话的验证证据，已排队' };
      try { await this.d.runs.steer(run.runId, accepted.turn.turn_id, { clientInputId: input.clientInputId, ...this.agentInput(input.text, attachments) }); return { turnId: accepted.turn.turn_id, duplicate: false, status: 'steered' }; }
      catch (e) {
        // 只有能证明未发出（协议明确拒绝、状态不符、不支持）才转排队；超时或断线可能已被接受，记未知、不自动重发（复核 CR02）。
        if (e instanceof DriverError && (e.code === 'REJECTED' || e.code === 'STATE' || e.code === 'UNSUPPORTED')) return { turnId: accepted.turn.turn_id, duplicate: false, status: 'queued', steerRefused: `插话未被接受（${e.message.slice(0, 120)}），已排队` };
        this.d.store.endTurn(accepted.turn.turn_id, 'unknown', e instanceof DriverError ? e.code : 'STEER_UNKNOWN');
        return { turnId: accepted.turn.turn_id, duplicate: false, status: 'unknown', steerRefused: '插话是否被接受无法确认，不会自动重发；请查看回答后再决定' };
      }
    }
    const queued = !!run && this.d.runs.busy(run.runId) || this.d.store.queuedTurns(taskId).length > 1 || this.dispatching.has(taskId);
    void this.pump(taskId);
    return { turnId: accepted.turn.turn_id, duplicate: false, status: queued ? 'queued' : 'accepted' };
  }

  /** 发给执行器的文字（附件注明）与图片路径。 */
  private agentInput(text: string, attachments: Attachment[]) {
    // 图片一律读冻结副本（storedPath，在 WillYou 私有目录内）。
    return { text: text + attachmentNote(attachments), images: attachments.filter(a => a.image && a.storedPath).map(a => ({ path: a.storedPath!, mime: a.mime })) };
  }

  /** 输入框附件准备：taskId 为空时（首页）用所选目录。 */
  prepareAttachment(taskId: string | null, cwd: string | null, file: { name: string; mime?: string; sourcePath?: string; dataBase64?: string }) {
    if (!this.d.userData) throw new DriverError('UNSUPPORTED', '附件不可用');
    const dir = taskId ? this.selection(taskId).task.cwd : cwd;
    if (!dir) throw new DriverError('REJECTED', '先选择项目目录');
    return prepareAttachment({ cwd: dir, userData: this.d.userData, ...file });
  }

  /** 插话只认冻结进运行的能力；Claude 暂无原生接受关联，不提供（复核 CR02、CR15）。 */
  private steerable(run: { driverId: DriverId; capabilities: Record<CapabilityName, CapabilityResult> }) {
    return run.driverId === 'codex-app-server' && run.capabilities.steer.state === 'enabled';
  }
  private requireCapability(run: { capabilities: Record<CapabilityName, CapabilityResult> }, name: CapabilityName, label: string) {
    const c = run.capabilities[name];
    if (c.state !== 'enabled') throw new DriverError('UNSUPPORTED', `${label}不可用：${c.reason === 'below-minimum' ? `版本低于最低已验证版本 ${c.minVersion}` : c.reason === 'probe-unavailable' ? '执行器没有公布该方法' : c.reason ?? '未声明'}`);
  }

  /** 打开或恢复本任务的运行（不派发输入）。 */
  private async ensureRun(taskId: string) {
    const existing = this.d.runs.runForTask(taskId);
    if (existing) return existing;
    const { task, selection } = this.selection(taskId);
    // 不带当前选择解析启动参数，得到档案自己的默认模型；“恢复默认”用它（复核 NR05）。
    const launch = await this.d.resolveLaunch({ profileId: selection.profileId, cwd: task.cwd, runId: randomUUID() });
    if (launch.driverId !== selection.driverId) throw new DriverError('REJECTED', '配置档案的执行器已变化');
    if (this.d.runs.closingForTask(taskId)) throw new DriverError('STATE', '上一运行仍在退出，请稍后');
    await this.d.runs.open({ taskId, driverId: launch.driverId, profileId: selection.profileId, executable: launch.executable, cwd: task.cwd, env: launch.env, stateRoot: launch.stateRoot, compatibility: launch.compatibility, tier: selection.tier as Tier, model: selection.model ?? launch.model, defaultModel: launch.model, extraArgs: launch.extraArgs, settingSources: launch.settingSources, capabilities: launch.capabilities });
    return this.d.runs.runForTask(taskId)!;
  }

  /** 输入框原生命令：Codex 的 compact／review 走协议；Claude 及其他公布的命令作为文字输入发送。 */
  async command(taskId: string, name: string, args = '') {
    if (!/^[A-Za-z0-9_:.-]{1,64}$/.test(name)) throw new DriverError('REJECTED', '命令无效');
    const { selection, revision } = this.selection(taskId);
    if (selection.driverId === 'codex-app-server' && (name === 'compact' || name === 'review')) {
      const run = await this.ensureRun(taskId);
      if (this.d.runs.busy(run.runId)) throw new DriverError('STATE', '本轮结束后再执行该命令');
      this.paused.delete(taskId);
      await this.d.runs.command(run.runId, name);
      return { ok: true };
    }
    if (selection.driverId === 'codex-app-server') throw new DriverError('UNSUPPORTED', `Codex 没有公布 /${name} 命令`);
    return this.submit(taskId, { clientInputId: `cmd-${randomUUID().replace(/-/g, '')}`, text: `/${name}${args ? ' ' + args : ''}`, expectedSelectionRevision: revision });
  }

  /** @文件：只在任务（或首页所选）目录内查找。 */
  async searchFiles(taskId: string | null, cwd: string | null, query: string) {
    const dir = taskId ? this.selection(taskId).task.cwd : cwd;
    if (!dir) return [];
    return searchProjectFiles(dir, String(query).slice(0, 200));
  }

  /** 目标（需求 R02）：Codex 用原生目标接口，可暂停／继续；Claude 以 /goal 文字设定与清除，不能暂停。 */
  async goal(taskId: string, op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }) {
    const { selection } = this.selection(taskId);
    if (op.kind === 'set' && (!op.objective.trim() || op.objective.length > 4000)) throw new DriverError('REJECTED', '目标内容无效');
    if (selection.driverId === 'claude-sdk') {
      if (op.kind === 'pause' || op.kind === 'resume') throw new DriverError('UNSUPPORTED', 'Claude 目标不能暂停，只能清除');
      const run = await this.ensureRun(taskId);
      this.requireCapability(run, 'goal', '目标');
      const text = op.kind === 'set' ? `/goal ${op.objective.trim()}` : '/goal clear';
      // 不预写目标状态：命令发出后等原生确认（active_goal 或 Goal set／cleared），期间显示“等待确认”（复核 CR14）。
      const r = await this.submit(taskId, { clientInputId: `goal-${randomUUID().replace(/-/g, '')}`, text, expectedSelectionRevision: this.selection(taskId).revision });
      this.goalPending.set(taskId, { kind: op.kind === 'set' ? 'set' : 'clear', ...(op.kind === 'set' ? { objective: op.objective.trim() } : {}), turnId: r.turnId });
      return r;
    }
    const run = await this.ensureRun(taskId);
    this.requireCapability(run, 'goal', '目标');
    if (op.kind === 'resume' || op.kind === 'set') { this.paused.delete(taskId); this.d.runs.hold(taskId, false); }
    await this.d.runs.goal(run.runId, op);
    return { ok: true };
  }

  /** 按接受顺序派发下一条排队输入；必要时先打开或恢复运行。 */
  private async pump(taskId: string) {
    if (this.paused.has(taskId) || this.dispatching.has(taskId)) return;
    const next = this.d.store.queuedTurns(taskId)[0];
    if (!next) return;
    let run = this.d.runs.runForTask(taskId);
    if (run && this.d.runs.busy(run.runId)) return;
    this.dispatching.add(taskId);
    const seq = this.stopSeq.get(taskId) ?? 0;
    const stoppedSince = () => (this.stopSeq.get(taskId) ?? 0) !== seq || this.paused.has(taskId);
    try {
      const { selection } = this.selection(taskId);
      // Claude 跨越完全访问须重开会话并恢复（CLI 不允许同一会话切到绕过权限，复核 CR12）。
      if (run && run.driverId === 'claude-sdk' && run.tier !== selection.tier) { await this.d.runs.close(run.runId); run = undefined; }
      run = await this.ensureRun(taskId);
      // 无法保证把审批交给用户的版本不能运行“请求批准／帮我批准”（复核 NR09，技术方案 §7.1）。
      if (run.driverId === 'codex-app-server' && selection.tier !== 'full') this.requireCapability(run, 'approvalsReviewer', `${selection.tier === 'ask' ? '请求批准' : '帮我批准'}档位`);
      // 异步打开期间用户按了停止：输入保留在排队，不派发（复核 CR03）。
      if (stoppedSince()) return;
      const frozen = JSON.parse(next.input_ref) as { text: string; attachments?: Attachment[] };
      await this.d.runs.dispatch(run.runId, next.turn_id, { clientInputId: next.client_input_id, ...this.agentInput(frozen.text, frozen.attachments ?? []), tier: selection.tier as Tier, model: selection.model ?? run.defaultModel });
      if (stoppedSince()) await this.d.runs.interrupt(run.runId).catch(() => {});
    } catch (e) {
      const t = this.d.store.turn(next.turn_id);
      // 驱动在发送前拒绝且已放回排队（原生仍在跑）：等该回合结束后由 turn.ended 再派发，不算失败。
      if (e instanceof DriverError && e.code === 'STATE' && t?.status === 'accepted' && this.d.runs.runForTask(taskId)) return;
      // 上一运行已不可用、仍在等真实退出：输入保留但暂停，明确告知原因；退出后自动恢复派发（复核 NR04）。
      if (e instanceof DriverError && e.code === 'STATE' && t?.status === 'accepted' && this.d.runs.closingForTask(taskId)) {
        if (!this.blockedByClosing.has(taskId)) { this.blockedByClosing.add(taskId); this.d.store.addHostItem(taskId, next.turn_id, 'system_notice', { severity: 'warning', code: 'waitingPreviousRun', detail: '上一会话已不可用、正在等待它退出；输入已保留，退出后会自动发送。也可以取消这条输入。' }); }
        this.paused.add(taskId);
        return;
      }
      // 打开运行失败：这条输入明确未发出，标失败并把原因写进时间线；后续排队保留，等用户处理。
      if (t?.status === 'accepted') this.d.store.endTurn(next.turn_id, 'failed', e instanceof DriverError ? e.code : 'OPEN_FAILED');
      const message = (e as Error).message.slice(0, 2000);
      this.d.store.tx(emit => emit(taskId, 'task.error', { turnId: next.turn_id, message }));
      // 用户可见的具体原因写进时间线，快照与重开任务都能看到（复核 CR17）。
      this.d.store.addHostItem(taskId, next.turn_id, 'error', { code: e instanceof DriverError ? e.code : 'OPEN_FAILED', message });
      this.paused.add(taskId);
    } finally {
      this.dispatching.delete(taskId);
      if (this.missedPump.delete(taskId)) queueMicrotask(() => void this.pump(taskId));
    }
  }

  async stop(taskId: string) {
    this.paused.add(taskId);
    this.stopSeq.set(taskId, (this.stopSeq.get(taskId) ?? 0) + 1);
    this.d.runs.hold(taskId, true);
    const run = this.d.runs.runForTask(taskId);
    if (!run) return { stopped: this.dispatching.has(taskId) };
    // Codex：停止键＝停止本轮并暂停目标（需求 R02）。
    if (run.driverId === 'codex-app-server' && this.d.store.goal(taskId)?.status === 'active') { try { await this.d.runs.goal(run.runId, { kind: 'pause' }); } catch { /* 目标接口失败不阻止停止 */ } }
    // 请求挂起时按停止：先退役本回合的原生请求，再中断（技术方案 §9）。
    for (const r of this.d.store.pendingRequests(taskId)) if (r.class === 'native' && r.origin.runId === run.runId) this.d.store.retireRequest(r.requestId, 'user-stop');
    await this.d.runs.interrupt(run.runId);
    return { stopped: true };
  }

  cancelQueued(taskId: string, turnId: string) {
    const t = this.d.store.turn(turnId);
    if (!t || t.task_id !== taskId || t.status !== 'accepted') throw new DriverError('REJECTED', '该输入已发出或不存在');
    this.d.store.endTurn(turnId, 'canceled', 'USER_CANCELED');
  }

  /** 原生请求回应：宿主按当前运行确定作用域，旧代次由运行服务拒绝。 */
  async respond(taskId: string, requestId: string, revision: number, result: unknown) {
    const req = this.d.store.request(requestId);
    if (!req || req.task_id !== taskId) throw new DriverError('REJECTED', '请求不存在');
    // 批准以宿主保存的完整请求为准：客户端交回的入参（可能来自预览）不能替换原文，提问类只取答案（复核 NR06）。
    const r = result as { behavior?: string; updatedInput?: Record<string, unknown> } | null;
    if (r && r.behavior === 'allow' && r.updatedInput) {
      const stored = JSON.parse(req.payload_ref) as { input?: Record<string, unknown>; truncated?: boolean };
      if (stored.truncated) throw new DriverError('REJECTED', '请求内容过大，不能批准');
      result = req.kind === 'user_input' ? { ...r, updatedInput: { ...(stored.input ?? {}), answers: (r.updatedInput as { answers?: unknown }).answers } } : { ...r, updatedInput: stored.input };
    }
    const origin = JSON.parse(req.origin_json) as { runId: string; generation: number };
    const run = this.d.runs.runForTask(taskId);
    const scope = run ? { taskId, runId: run.runId, generation: run.generation, revision } : { taskId, runId: origin.runId, generation: -1, revision };
    await this.d.runs.respond(requestId, scope, result);
  }

  async archive(taskId: string) {
    const run = this.d.runs.runForTask(taskId);
    if (run && this.d.runs.busy(run.runId)) throw new DriverError('STATE', '任务仍在运行，请先停止');
    if (run) await this.d.runs.close(run.runId);
    this.d.store.archiveTask(taskId);
  }

  status(taskId: string): TaskStatus {
    const pending = this.d.store.pendingRequests(taskId).some(r => r.status === 'pending');
    if (pending) return 'waiting';
    const turns = this.d.store.turns(taskId);
    if (turns.some(t => ['accepted', 'dispatching', 'started'].includes(t.status))) return this.paused.has(taskId) && !turns.some(t => ['dispatching', 'started'].includes(t.status)) ? 'stopped' : 'working';
    const last = turns.filter(t => t.status !== 'canceled').at(-1);
    if (!last) return 'idle';
    if ((last.status === 'failed' || last.status === 'completed') && this.d.store.items(taskId, { limit: 200 }).some(i => i.turnId === last.turn_id && i.type === 'error' && i.payload?.limited)) return 'limited';
    return last.status === 'completed' ? 'completed' : last.status === 'interrupted' ? 'stopped' : last.status === 'failed' || last.status === 'unknown' ? 'failed' : 'idle';
  }

  list() {
    return this.d.store.listTasks().map(t => ({ taskId: t.id, projectId: t.project_id, dirId: t.dir_id, cwd: t.cwd, title: t.title, selection: JSON.parse(t.selection_json) as AgentSelection, createdAt: t.created_at, updatedAt: t.updated_at, status: this.status(t.id) }));
  }

  /** 一致快照与已提交水位；订阅方先订阅再读快照，随后补拉 (seq, …]（技术方案 §3.1）。 */
  snapshot(taskId: string) {
    const { task, selection, revision } = this.selection(taskId);
    const run = this.d.runs.runForTask(taskId);
    const base = {
      taskId, title: task.title, cwd: task.cwd, projectId: task.project_id, selection, selectionRevision: revision,
      draft: this.d.store.draft(taskId), items: [] as ReturnType<AgentStore['items']>, hasOlder: false, turns: this.d.store.turns(taskId).slice(-500),
      requests: this.d.store.pendingRequests(taskId).map(previewRequest), queued: this.d.store.queuedTurns(taskId).slice(0, 50).map(q => { const t = (JSON.parse(q.input_ref) as { text: string }).text; return { turnId: q.turn_id, text: t.length > 2000 ? t.slice(0, 2000) : t, ...(t.length > 2000 ? { truncated: true } : {}) }; }),
      run: run ? { runId: run.runId, generation: run.generation, driverId: run.driverId, tier: run.tier, busy: this.d.runs.busy(run.runId), steer: this.steerable(run), goal: run.capabilities.goal.state === 'enabled', catalog: this.d.runs.active(run.runId)?.catalog ?? null } : null,
      goal: this.d.store.goal(taskId), goalPending: this.goalPending.get(taskId) ?? null,
      status: this.status(taskId), seq: this.d.store.watermark(taskId),
    };
    // 整体响应守 256 KiB：先算除条目外的部分，剩余预算装入最近的条目（复核 NR06）。
    const rest = Buffer.byteLength(JSON.stringify(base));
    return { ...base, ...this.itemsPage(taskId, Math.max(16 * 1024, 240 * 1024 - rest)) };
  }

  /** 快照只带最近 2000 条；更早的按 100 条一页、响应不超过 256 KiB 读取（技术方案 §3.1）。 */
  private itemsPage(taskId: string, budget = SNAPSHOT_ITEM_BUDGET) {
    // 快照条目按字节预算从新到旧装入，单项过大给预览（复核 NR06，IPC 响应 256 KiB）。
    const all = this.d.store.items(taskId);
    const out: typeof all = []; let bytes = 0;
    for (const it of [...all].reverse()) {
      const shown = previewItem(it);
      const size = Buffer.byteLength(JSON.stringify(shown));
      if (bytes + size > budget && out.length) break;
      bytes += size; out.unshift(shown);
    }
    return { items: out, hasOlder: out.length > 0 && out[0].ordinal > 1 };
  }
  /** 正文范围读取（复核 NR06）：截断预览的条目与过大的请求按 128 KiB 分段读取完整内容。 */
  itemBody(taskId: string, itemId: string, offset: number) {
    this.selection(taskId);
    const it = this.d.store.itemById(taskId, itemId);
    if (!it) throw new DriverError('REJECTED', '条目不存在');
    return rangeOf(JSON.stringify(it.payload), offset);
  }
  requestBody(taskId: string, requestId: string, offset: number) {
    const r = this.d.store.request(requestId);
    if (!r || r.task_id !== taskId) throw new DriverError('REJECTED', '请求不存在');
    return rangeOf(r.payload_ref, offset);
  }
  history(taskId: string, beforeOrdinal: number) {
    this.selection(taskId);
    const page = this.d.store.items(taskId, { beforeOrdinal, limit: 100 });
    const out: typeof page = []; let bytes = 0;
    for (const it of [...page].reverse()) { const shown = previewItem(it); const size = Buffer.byteLength(JSON.stringify(shown)); if (bytes + size > HISTORY_BUDGET && out.length) break; bytes += size; out.unshift(shown); }
    return { items: out, hasOlder: out.length > 0 && out[0].ordinal > 1 };
  }

  events(taskId: string, afterSeq: number, limit = 128): StoredEvent[] { return this.d.store.events(taskId, afterSeq, Math.min(limit, 128)); }
}
