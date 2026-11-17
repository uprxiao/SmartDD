// M14 任务命令服务（技术方案 T1.5 §3 TaskCommandService）：输入框、IPC 与（后续）MCP 共用。
// 阶段 2：新任务、草稿／选择 CAS、提交与排队、停止、请求回应、快照与订阅、归档。切换执行器属阶段 3。
import { randomUUID } from 'node:crypto';
import type { DriverId } from './capabilities';
import type { DriverExecutable } from './driver';
import { DriverError } from './driver';
import { AgentStore, INPUT_TEXT_LIMIT, type AgentSelection, type StoredEvent } from './agent-store';
import { AgentRunService, type RunHandle } from './agent-run-service';
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

/** 容量合同（技术方案 §3.1、A45）：IPC 响应 256 KiB、事件 32 KiB、正文段 128 KiB，全部按最终序列化后的 UTF-8 字节计。 */
export const RESPONSE_LIMIT = 256 * 1024, EVENT_LIMIT = 32 * 1024, RANGE_LIMIT = 128 * 1024;
const ITEM_PREVIEW = 24 * 1024, REQUEST_PREVIEW = 96 * 1024, REQUESTS_BUDGET = 96 * 1024, DRAFT_INLINE = 48 * 1024;
export const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null));
/** 过大的正文给预览：长字符串截短并标 truncated，完整内容经范围读取接口取得。 */
function shorten(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') return v.length > 2000 ? v.slice(0, 2000) : v;
  if (Array.isArray(v)) return v.slice(0, 20).map(x => shorten(x, depth + 1));
  if (v && typeof v === 'object') return depth < 3 ? Object.fromEntries(Object.entries(v).slice(0, 40).map(([k, x]) => [k, shorten(x, depth + 1)])) : {};
  return v;
}
/** 预览仍超限时只留顶层短字段，保证单项不超过上限。 */
function boundedPreview(payload: unknown, limit: number): Record<string, unknown> {
  const p = shorten(payload) as Record<string, unknown>;
  if (jsonBytes(p) <= limit) return p ?? {};
  return Object.fromEntries(Object.entries(payload as Record<string, unknown>).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 500) : v]));
}
function previewItem<T extends { payload: any }>(it: T): T {
  const bytes = jsonBytes(it.payload);
  // 原文在 artifact 里的条目，库内只是预览：无论大小都标截断，界面经正文接口读全文（复核 U01）。
  if (it.payload?.artifact) { const { artifact, ...rest } = it.payload; return { ...it, payload: { ...boundedPreview(rest, ITEM_PREVIEW), truncated: true, bytes: artifact.bytes } }; }
  return bytes <= ITEM_PREVIEW ? it : { ...it, payload: { ...boundedPreview(it.payload, ITEM_PREVIEW), truncated: true, bytes } };
}
function previewRequest<T extends { payload: any }>(r: T, limit = REQUEST_PREVIEW): T & { detailTruncated?: boolean; bytes?: number } {
  const bytes = jsonBytes(r.payload);
  // 关键请求不截断：过大的请求只给预览，界面读完完整内容后才开放批准（复核 NR06）。
  return bytes <= limit && !r.payload?.truncated ? r : { ...r, payload: boundedPreview(r.payload, 8 * 1024), detailTruncated: true, bytes };
}
/** 按 UTF-8 字节偏移分段：不切断多字节字符，段的序列化大小（含 JSON 转义）不超过 128 KiB。 */
export function rangeOf(text: string, offset: number) {
  const buf = Buffer.from(text, 'utf8');
  const start = Math.min(buf.length, Math.max(0, Math.floor(offset) || 0));
  if (start < buf.length && (buf[start] & 0xc0) === 0x80) throw new DriverError('REJECTED', '偏移不在字符边界');
  const cut = (end: number) => { while (end > start && end < buf.length && (buf[end] & 0xc0) === 0x80) end--; return end; };
  let end = cut(Math.min(buf.length, start + RANGE_LIMIT - 64));
  let chunk = buf.subarray(start, end).toString('utf8');
  while (end > start && jsonBytes(chunk) > RANGE_LIMIT - 64) { end = cut(start + Math.floor((end - start) * 0.7)); chunk = buf.subarray(start, end).toString('utf8'); }
  return { chunk, next: end, totalBytes: buf.length, done: end >= buf.length };
}
/** 事件出进程前有界化：超过 32 KiB 只发信封，界面按水位重新读取快照（复核 FR02）。 */
export function boundedEvent(e: StoredEvent): StoredEvent {
  return jsonBytes(e) <= EVENT_LIMIT ? e : { taskId: e.taskId, seq: e.seq, type: e.type, itemId: e.itemId, payload: { truncated: true, bytes: jsonBytes(e.payload) } };
}

type DraftRow = ReturnType<AgentStore['draft']>;
type PendingRequest = ReturnType<AgentStore['pendingRequests']>[number];
/** 草稿：小的随快照给出；大的（或收紧档）只给修订与大小，经 draftBody 分段读取；受损记录如实标出。 */
function draftForSnapshot(draft: DraftRow, level: number) {
  if (!draft || 'damaged' in draft) return draft;
  const bytes = jsonBytes(draft.draft);
  return bytes > (level >= 2 ? 4 * 1024 : DRAFT_INLINE) ? { revision: draft.revision, draft: null, truncated: true as const, bytes } : draft;
}
/** 请求摘要：只留标识、种类、修订与来源，正文经 requestBody 读取。 */
function requestStub(r: PendingRequest) {
  return { requestId: r.requestId, class: r.class, kind: r.kind, revision: r.revision, origin: r.origin, status: r.status, createdAt: r.createdAt, payload: {}, detailTruncated: true as const, bytes: jsonBytes(r.payload) };
}
/**
 * 待处理请求（复核 SR04）：先为每个请求留出摘要，保证全部可访问；剩余预算按顺序把摘要升级为完整内容或预览。
 * 摘要本身都放不下时（数量极多）按顺序给前面的，并报总数，处理掉前面的会继续出现。
 */
function requestsForSnapshot(pending: PendingRequest[], level: number) {
  const budget = [REQUESTS_BUDGET, REQUESTS_BUDGET, 48 * 1024, 32 * 1024][level];
  const out: (PendingRequest & { detailTruncated?: boolean; bytes?: number })[] = [];
  let used = 0;
  for (const r of pending) { const st = requestStub(r), n = jsonBytes(st) + 1; if (used + n > budget) break; used += n; out.push(st); }
  if (level < 2 && out.length === pending.length) {
    pending.forEach((r, i) => {
      const stubSize = jsonBytes(out[i]) + 1;
      for (const c of [previewRequest(r), previewRequest(r, 0)]) {
        const n = jsonBytes(c) + 1;
        if (used - stubSize + n <= budget) { used += n - stubSize; out[i] = c; break; }
      }
    });
  }
  return { requests: out, requestsTotal: pending.length };
}
function queuedPreview(q: { turn_id: string; input_ref: string }, chars: number) {
  const t = (JSON.parse(q.input_ref) as { text: string }).text;
  return { turnId: q.turn_id, text: t.length > chars ? t.slice(0, chars) : t, ...(t.length > chars ? { truncated: true } : {}) };
}
/** 命令与 Skill 目录：条数与描述长度有界。 */
function catalogForSnapshot(c: { commands: string[]; skills: { name: string; description?: string }[] } | null, level: number) {
  if (!c) return null;
  const n = [200, 200, 80, 30][level], d = [160, 160, 80, 0][level];
  return { commands: c.commands.slice(0, 100).map(x => x.slice(0, 64)), skills: c.skills.slice(0, n).map(k => ({ name: k.name.slice(0, 128), ...(d && k.description ? { description: k.description.slice(0, d) } : {}) })) };
}
function boundGoal<T extends { objective?: string | null }>(g: T): T {
  return typeof g.objective === 'string' && g.objective.length > 4000 ? { ...g, objective: g.objective.slice(0, 4000), objectiveTruncated: true } : g;
}

export type TaskStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'stopped' | 'failed' | 'limited';

export class AgentTaskService {
  /** 用户按停止后暂停自动派发排队输入，直到下一次提交（停止只停本轮，不吞掉排队）。 */
  private readonly paused = new Set<string>();
  private readonly dispatching = new Set<string>();
  private readonly missedPump = new Set<string>();
  private readonly blockedByClosing = new Map<string, number>();
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
      // 只解除“等待旧运行退出”这一原因；等待期间用户又按了停止，则保持暂停（复核 FR01）。
      if (e.type === 'run.ended' && this.blockedByClosing.has(e.taskId)) { const since = this.blockedByClosing.get(e.taskId); this.blockedByClosing.delete(e.taskId); if (since === (this.stopSeq.get(e.taskId) ?? 0)) this.paused.delete(e.taskId); }
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

  /** 草稿与输入同一文字上限；超限明确拒绝，原记录不变（复核 SR02）。冲突回执只带修订，不回传草稿正文。 */
  saveDraft(taskId: string, draft: unknown, expectedRevision: number) {
    this.selection(taskId);
    const d = draft as { text?: unknown; attachments?: unknown } | null;
    if (!d || typeof d !== 'object' || (d.text !== undefined && typeof d.text !== 'string')) throw new DriverError('REJECTED', '草稿无效');
    if (typeof d.text === 'string' && Buffer.byteLength(d.text) > INPUT_TEXT_LIMIT) throw new DriverError('REJECTED', '草稿超过 256 KB，未保存；请拆分或改用附件');
    if (d.attachments !== undefined && (!Array.isArray(d.attachments) || d.attachments.length > 20)) throw new DriverError('REJECTED', '草稿附件无效');
    const r = this.d.store.saveDraft(taskId, draft, expectedRevision);
    if (r.ok) return r;
    // 冲突回执带服务端版本；过大的只给修订与大小，由界面经 draftBody 读取，响应守容量上限。
    return jsonBytes(r.draft) <= DRAFT_INLINE ? r : { ok: false as const, revision: r.revision, draft: null, draftTruncated: true as const };
  }

  /** 提交：先持久接受（幂等），忙则排队；空闲立即派发。mode=steer 时尝试插话，不支持则保留在排队并说明原因。 */
  async submit(taskId: string, input: { clientInputId: string; text: string; expectedSelectionRevision: number; mode?: 'queue' | 'steer'; attachments?: unknown[] }) {
    const { revision, task } = this.selection(taskId);
    // 幂等命中直接返回原收据，不再核对选择修订、准备或冻结附件（复核 NR01、FR06）。
    const existing = this.d.store.turnByClientInput(taskId, input.clientInputId);
    if (existing) return { turnId: existing.turn_id, duplicate: true, status: existing.status };
    if (input.expectedSelectionRevision !== revision) throw new DriverError('REJECTED', '模型或权限已变化，请确认后再发送');
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

  /** 无法保证把审批交给用户的版本不能运行“请求批准／帮我批准”（复核 NR09、FR08，技术方案 §7.1）。 */
  private gateTier(run: RunHandle, tier: Tier) {
    if (run.driverId === 'codex-app-server' && tier !== 'full') this.requireCapability(run, 'approvalsReviewer', `${tier === 'ask' ? '请求批准' : '帮我批准'}档位`);
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
      // 会开始原生工作的命令与普通发送同一档位／能力门禁（复核 FR08）。
      this.gateTier(run, selection.tier as Tier);
      // 原生命令沿用线程上一次生效的档位：与当前选择不一致时先发一条消息让新档位生效，不借用旧配置。
      if (run.appliedTier && run.appliedTier !== selection.tier) throw new DriverError('STATE', '档位已变化，新档位要在下一条消息生效；请先发送一条消息再执行该命令');
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
      this.gateTier(run, selection.tier as Tier);
      // 异步打开期间用户按了停止：输入保留在排队，不派发（复核 CR03）。
      if (stoppedSince()) return;
      const frozen = JSON.parse(next.input_ref) as { text: string; attachments?: Attachment[] };
      let model = selection.model ?? run.defaultModel;
      // Codex 的模型覆盖会延续：恢复的线程可能带着旧覆盖，本运行也可能发过显式模型；默认选择下先查执行器默认，
      // 查不到就拒绝，不靠省略字段“恢复默认”（复核 FR03、SR03）。
      if (!model && run.driverId === 'codex-app-server') model = await this.d.runs.resolveDefaultModel(run.runId);
      if (!model && run.driverId === 'codex-app-server' && (run.sentModel || run.resumed)) throw new DriverError('UNSUPPORTED', '无法确定执行器默认模型，请在模型菜单里明确选择一个模型');
      // 派发前最后核对停止：上面每个异步前置（打开、默认模型查询）期间都可能按了停止（复核 SR01）。
      if (stoppedSince()) return;
      await this.d.runs.dispatch(run.runId, next.turn_id, { clientInputId: next.client_input_id, ...this.agentInput(frozen.text, frozen.attachments ?? []), tier: selection.tier as Tier, model });
      if (stoppedSince()) await this.d.runs.interrupt(run.runId).catch(() => {});
    } catch (e) {
      const t = this.d.store.turn(next.turn_id);
      // 驱动在发送前拒绝且已放回排队（原生仍在跑）：等该回合结束后由 turn.ended 再派发，不算失败。
      if (e instanceof DriverError && e.code === 'STATE' && t?.status === 'accepted' && this.d.runs.runForTask(taskId)) return;
      // 上一运行已不可用、仍在等真实退出：输入保留但暂停，明确告知原因；退出后自动恢复派发（复核 NR04）。
      if (e instanceof DriverError && e.code === 'STATE' && t?.status === 'accepted' && this.d.runs.closingForTask(taskId)) {
        // 本次尝试开始后已按停止：保持暂停，不取得退出后自动恢复的资格（复核 SR01）。
        if (stoppedSince()) return;
        // 恢复资格绑定本次尝试开始时的停止序号；之后任何停止都会使它失效。
        if (!this.blockedByClosing.has(taskId)) { this.blockedByClosing.set(taskId, seq); this.d.store.addHostItem(taskId, next.turn_id, 'system_notice', { severity: 'warning', code: 'waitingPreviousRun', detail: '上一会话已不可用、正在等待它退出；输入已保留，退出后会自动发送。也可以取消这条输入。' }); }
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
    const draft = this.d.store.draft(taskId);
    const pending = this.d.store.pendingRequests(taskId);
    const queuedAll = this.d.store.queuedTurns(taskId);
    const allTurns = this.d.store.turns(taskId);
    const goal = this.d.store.goal(taskId);
    const catalog = run ? this.d.runs.active(run.runId)?.catalog ?? null : null;
    // 整份响应按最终 UTF-8 字节守 256 KiB（技术方案 §3.1，复核 FR02／SR04）。基础字段按档逐级收紧，
    // 每档都保留全部待处理请求的可访问路径（预览或只含标识的摘要，全文经 requestBody 读取）；剩余预算装最近条目。
    for (let level = 0; level <= 3; level++) {
      const base = {
        taskId, title: task.title, cwd: task.cwd, projectId: task.project_id, selection, selectionRevision: revision,
        draft: draftForSnapshot(draft, level),
        ...requestsForSnapshot(pending, level),
        queued: queuedAll.slice(0, [10, 10, 5, 3][level]).map(q => queuedPreview(q, [1000, 1000, 400, 200][level])),
        queuedTotal: queuedAll.length,
        run: run ? { runId: run.runId, generation: run.generation, driverId: run.driverId, tier: run.tier, busy: this.d.runs.busy(run.runId), steer: this.steerable(run), goal: run.capabilities.goal.state === 'enabled', catalog: catalogForSnapshot(catalog, level) } : null,
        goal: goal ? boundGoal(goal) : goal, goalPending: this.goalPending.get(taskId) ?? null,
        status: this.status(taskId), seq: this.d.store.watermark(taskId),
      };
      const recentTurns = allTurns.slice(-[20, 20, 10, 3][level]);
      const budget = RESPONSE_LIMIT - 4 * 1024 - jsonBytes(base) - jsonBytes(recentTurns);
      if (budget < 0 && level < 3) continue;
      const out = { ...base, ...this.itemsPage(taskId, Math.max(0, budget), allTurns, recentTurns) };
      while (jsonBytes(out) > RESPONSE_LIMIT && out.items.length) { out.items.shift(); out.hasOlder = true; }
      if (jsonBytes(out) <= RESPONSE_LIMIT) return out;
    }
    throw new DriverError('PROTOCOL', '任务快照超过容量上限');
  }

  /** 从新到旧装入条目（单项过大给预览），并带上这些条目所属的回合；字节与条数（2000）双重边界。 */
  private itemsPage(taskId: string, budget: number, allTurns: ReturnType<AgentStore['turns']>, keepTurns: ReturnType<AgentStore['turns']> = [], beforeOrdinal?: number) {
    const all = this.d.store.items(taskId, beforeOrdinal !== undefined ? { beforeOrdinal, limit: 100 } : undefined);
    const turnMap = new Map(allTurns.map(t => [t.turn_id, t]));
    const turnIds = new Set(keepTurns.map(t => t.turn_id));
    const out: typeof all = []; let bytes = 0;
    for (const it of [...all].reverse()) {
      const shown = previewItem(it);
      const t = it.turnId && !turnIds.has(it.turnId) ? turnMap.get(it.turnId) : undefined;
      const size = jsonBytes(shown) + (t ? jsonBytes(t) : 0) + 1;
      if (bytes + size > budget) break;
      bytes += size; out.unshift(shown); if (t) turnIds.add(t.turn_id);
    }
    const turns = allTurns.filter(t => turnIds.has(t.turn_id));
    return { items: out, turns, hasOlder: out.length ? out[0].ordinal > 1 : all.length > 0 };
  }
  /** 正文范围读取（复核 NR06）：截断预览的条目与过大的请求按 128 KiB 分段读取完整内容。 */
  itemBody(taskId: string, itemId: string, offset: number, revision?: number) {
    this.selection(taskId);
    // 有 artifact 的条目从原文文件读取（复核 U01）；分段读取期间条目被更新则拒绝拼接（复核 SR05）。
    const it = this.d.store.readItemBody(taskId, itemId);
    if (!it) throw new DriverError('REJECTED', '条目不存在');
    if (revision !== undefined && revision !== it.revision) throw new DriverError('STATE', '条目已更新，请重新读取');
    return { ...rangeOf(it.text, offset), revision: it.revision };
  }
  requestBody(taskId: string, requestId: string, offset: number, revision?: number) {
    const r = this.d.store.request(requestId);
    if (!r || r.task_id !== taskId) throw new DriverError('REJECTED', '请求不存在');
    if (revision !== undefined && revision !== r.revision) throw new DriverError('STATE', '请求已更新，请重新读取');
    return { ...rangeOf(r.payload_ref, offset), revision: r.revision };
  }
  history(taskId: string, beforeOrdinal: number) {
    this.selection(taskId);
    const page = this.itemsPage(taskId, RESPONSE_LIMIT - 8 * 1024, this.d.store.turns(taskId), [], beforeOrdinal);
    while (jsonBytes(page) > RESPONSE_LIMIT && page.items.length > 1) page.items.shift();
    return page;
  }
  draftBody(taskId: string, offset: number, revision?: number) {
    this.selection(taskId);
    const d = this.d.store.draft(taskId);
    if (d && 'damaged' in d) throw new DriverError('REJECTED', '草稿已受损，无法读取');
    if (revision !== undefined && revision !== (d?.revision ?? 0)) throw new DriverError('STATE', '草稿已更新，请重新读取');
    return { ...rangeOf(JSON.stringify(d?.draft ?? null), offset), revision: d?.revision ?? 0 };
  }

  /** 事件页按字节守 256 KiB，单个事件超过 32 KiB 只给信封（复核 FR02）。 */
  events(taskId: string, afterSeq: number, limit = 128): StoredEvent[] {
    const out: StoredEvent[] = []; let bytes = 2;
    for (const e of this.d.store.events(taskId, afterSeq, Math.min(limit, 128))) {
      const b = boundedEvent(e), size = jsonBytes(b) + 1;
      if (bytes + size > RESPONSE_LIMIT && out.length) break;
      bytes += size; out.push(b);
    }
    return out;
  }
}
