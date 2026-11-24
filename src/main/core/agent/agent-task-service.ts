import type { GoalInput } from '@shared/agent-goal';
import type { QueuedGoal } from './agent-store';
import { CODEX_LOGIN_EFFORT, CODEX_LOGIN_FALLBACK, CODEX_LOGIN_MODEL, findAgentModel, modelEffortKey, offersCodexLoginDefault, resolveModelEffort, type AgentModelOption } from '@shared/agent-model-choice';
import type { HostBusinessRequests } from './host-business-requests';
import type { TurnDiffs } from './turn-diffs';
// M14 任务命令服务（技术方案 T1.5 §3 TaskCommandService）：输入框、IPC 与（后续）MCP 共用。
// 阶段 2：新任务、草稿／选择 CAS、提交与排队、停止、请求回应、快照与订阅、归档。切换执行器属阶段 3。
import { randomUUID } from 'node:crypto';
import type { DriverId } from './capabilities';
import type { DriverExecutable, DriverModelCache } from './driver';
import { DriverError } from './driver';
import { AgentStore, INPUT_TEXT_LIMIT, sha256, type AgentSelection, type StoredEvent } from './agent-store';
import { AgentRunService, type OpenRunInput, type RunHandle } from './agent-run-service';
import { isTier, resolveTier, type Tier } from './permissions';
import { attachmentNote, freezeImages, prepareAttachment, readAttachmentImage, resolveAttachmentFile, verifyAttachments, type Attachment } from './attachments';
import type { AttachmentImageSource } from '@shared/agent-attachment-image';
import { nativeChildBlocks, type NativeChildBlock } from '@shared/agent-native-history';
import type { CapabilityName, CapabilityResult } from './capabilities';
import { searchProjectFiles } from './file-search';
import { HandoffService, type Transfer } from './handoff';
import type { RunIntegration, RunIntegrationContext } from './run-integration';
import type { TaskCoordination } from './task-coordination';
import type { CapabilityRegistryService } from '../capabilities/capability-registry';

export interface ResolvedLaunch {
  driverId: DriverId;
  modelCache?: DriverModelCache;
  executable: DriverExecutable;
  env: Record<string, string>;
  stateRoot: string;
  compatibility: Record<string, unknown>;
  model?: string;
  extraArgs: string[];
  settingSources?: ('user' | 'project' | 'local')[];
  capabilities?: Record<CapabilityName, CapabilityResult>;
  modelsWithoutImageInput?: ReadonlySet<string>;
  assertCurrent?(): void;
  integrate?(context: RunIntegrationContext): Promise<RunIntegration | undefined>;
}
/** 由宿主按配置档案解析（发现服务＋凭据服务＋托管文件），不接受客户端提供的路径或凭据。 */
export type LaunchResolver = (input: { taskId?: string; profileId: string; cwd: string; runId: string; model?: string; carryExtensions?: boolean }) => Promise<ResolvedLaunch>;
export type ProfileDriver = (profileId: string) => DriverId;

const PREWARM_IDLE_MS = 60_000;
const HOST_BUSINESS_INSTRUCTIONS = '宿主工具返回 awaiting_user 时，可继续不依赖该批准的工作。需要结果才能继续时，请结束当前回合。宿主获批执行后会在后续回合自动送达结果。请勿休眠等待、轮询或重复提交。结果通知不构成新的真人授权。';
interface PrewarmingRun {
  controller: AbortController;
  opening: Promise<RunHandle | undefined>;
  expiry?: ReturnType<typeof setTimeout>;
  closing?: Promise<void>;
}

/** 容量合同（技术方案 §3.1、A45）：IPC 响应 256 KiB、事件 32 KiB、正文段 128 KiB，全部按最终序列化后的 UTF-8 字节计。 */
export const RESPONSE_LIMIT = 256 * 1024, EVENT_LIMIT = 32 * 1024, RANGE_LIMIT = 128 * 1024;
const ITEM_PREVIEW = 24 * 1024, REQUEST_PREVIEW = 96 * 1024, REQUESTS_BUDGET = 96 * 1024, DRAFT_INLINE = 48 * 1024;
export const jsonBytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v ?? null));
function historyCursor(taskId: string, ordinal: number | undefined, hasOlder: boolean) {
  return hasOlder && ordinal !== undefined ? Buffer.from(JSON.stringify([taskId, ordinal]), 'utf8').toString('base64url') : null;
}

function historyOrdinal(taskId: string, cursor: number | string) {
  if (typeof cursor === 'number' && Number.isSafeInteger(cursor) && cursor > 0) return cursor;
  if (typeof cursor === 'string' && cursor.length <= 256 && /^[A-Za-z0-9_-]+$/.test(cursor)) {
    try {
      const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
      if (Array.isArray(decoded) && decoded.length === 2 && decoded[0] === taskId &&
          Number.isSafeInteger(decoded[1]) && decoded[1] > 0 && historyCursor(taskId, decoded[1], true) === cursor) return decoded[1] as number;
    } catch { /* A malformed cursor must be fetched again from the current snapshot. */ }
  }
  throw new DriverError('REJECTED', '历史游标无效，请重新打开任务');
}
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
function previewItem<T extends { payload: any }>(it: T, limit = ITEM_PREVIEW): T {
  const bytes = jsonBytes(it.payload);
  if (bytes <= limit && !it.payload?.artifact) return it;
  // 原文在 artifact 里的条目，库内只是预览：无论大小都标截断，界面经正文接口读全文（复核 U01）。
  const { artifact, ...fields } = it.payload ?? {};
  const marker = { truncated: true, bytes: artifact?.bytes ?? bytes };
  const preview = { ...boundedPreview(fields, limit), ...marker };
  return { ...it, payload: jsonBytes(preview) <= limit ? preview : marker };
}

function nativeHistoryPayload(ref: string) {
  const payload = JSON.parse(ref), bytes = Buffer.byteLength(ref);
  const limit = 4096;
  if (bytes <= limit && !payload?.artifact) return payload;
  const nativePreview: NativeChildBlock[] = [];
  const preview = { truncated: true, bytes: payload?.artifact?.bytes ?? bytes, nativePreview };
  // Keep the tool identifiers and type when hiding a long body so the caller can
  // still associate each output with its command before an explicit detail read.
  for (const block of nativeChildBlocks(payload).slice(0, 8)) {
    if (block.kind === 'raw') continue;
    const shortened = block.kind === 'tool_call'
      ? { ...block, name: block.name.slice(0, 96), command: block.command?.slice(0, 400), input: block.input?.slice(0, 400) }
      : block.kind === 'tool_result'
        ? { ...block, output: block.output.slice(0, 500) }
        : { ...block, text: block.text.slice(0, 500) };
    nativePreview.push(shortened);
    if (jsonBytes(preview) > limit) {
      nativePreview.pop();
      break;
    }
  }
  return preview;
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
  return { requestId: r.requestId, class: r.class, kind: r.kind, revision: r.revision, origin: r.origin, status: r.status, createdAt: r.createdAt, targetTaskTitle: r.targetTaskTitle, payload: {}, detailTruncated: true as const, bytes: jsonBytes(r.payload) };
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
function queuedPreview(q: ReturnType<AgentStore['queuedTurns']>[number], chars: number) {
  const { text = '', attachments } = JSON.parse(q.input_ref) as { text?: string; attachments?: Attachment[] };
  return {
    turnId: q.turn_id, text: text.slice(0, chars), acceptedAt: q.accepted_at, editable: q.source_kind === 'user', sourceKind: q.source_kind,
    version: sha256(q.input_ref), attachmentCount: attachments?.length ?? 0,
    ...(text.length > chars ? { truncated: true } : {}),
  };
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

export type TaskStatus = 'idle' | 'working' | 'waiting' | 'completed' | 'stopped' | 'failed' | 'limited' | 'needs_attention';

export class AgentTaskService {
  private readonly trustedInputs=new Map<string,import('../applications/execution-context').ApplicationUiSender>();private readonly humanSequences=new Map<string,number>();private recordHuman?: (runId:string,sender:import('../applications/execution-context').ApplicationUiSender,text:string,sequence:number)=>void;
  attachHumanRecorder(record:NonNullable<AgentTaskService['recordHuman']>){this.recordHuman=record;}
  private humanSent(turnId:string,run:RunHandle,text:string){const sender=this.trustedInputs.get(turnId);this.trustedInputs.delete(turnId);if(sender){const n=(this.humanSequences.get(run.runId)??0)+1;this.humanSequences.set(run.runId,n);try{this.recordHuman?.(run.runId,sender,text,n);}catch{/* Unavailable source evidence grants no authority; business approval remains explicit. */}}}
  private business?: HostBusinessRequests; private diffs?: Pick<TurnDiffs, 'before' | 'after' | 'capturing' | 'beginTaskRemoval'>;private diffBusy?:(taskId:string)=>boolean; private readonly finishingTurns=new Set<string>();
  attachBusiness(value:HostBusinessRequests){this.business=value;}
  attachDiffs(value:NonNullable<AgentTaskService['diffs']>,busy?:(taskId:string)=>boolean){this.diffs=value;this.diffBusy=busy;}
  private async finishDiff(taskId: string, turnId: string, runId: string | null | undefined) {
    const overlappingBackground = () => !!runId && this.d.runs.nativeBusy(runId);
    while (!overlappingBackground() && this.diffBusy?.(taskId)) await new Promise(resolve => setTimeout(resolve, 50));
    await this.diffs?.after(taskId, turnId, overlappingBackground());
  }
  private discardAttachments?: (taskId: string | null, data: unknown) => void;
  attachAttachmentCleanup(discard: (taskId: string | null, data: unknown) => void) { this.discardAttachments = discard; }
  discardPreparedAttachment(taskId: string | null, attachment: unknown) {
    if (taskId) this.selection(taskId);
    this.discardAttachments?.(taskId, { attachments: [attachment] });
  }
  assertWritable(taskId: string) { this.selection(taskId); }

  private coordination?: TaskCoordination;
  attachCoordination(value: TaskCoordination) { this.coordination = value; }
  isDispatching(taskId: string) { return this.dispatching.has(taskId); }
  kick(taskId: string) {
    queueMicrotask(() => {
      if (this.dispatching.has(taskId)) this.missedPump.add(taskId);
      else void this.advance(taskId);
    });
  }
  /** Trusted host messages retain their source and stable receipt; they never become fresh human authorization. */
  enqueueHost(taskId: string, clientInputId: string, text: string, sourceKind: 'delegation' | 'notification' | 'system', wake = false) {
    this.selection(taskId);
    if (Buffer.byteLength(text) > INPUT_TEXT_LIMIT) throw new DriverError('REJECTED', '宿主输入超出预算');
    const receipt = this.d.store.acceptTurn({ taskId, clientInputId, text, sourceKind });
    if (wake) { this.paused.delete(taskId); this.stoppedByUser.delete(taskId); this.d.runs.hold(taskId, this.coordination?.blocked(taskId) ?? false); }
    this.kick(taskId); return receipt;
  }
  private readonly archiving = new Set<string>();
  private readonly switching = new Set<string>();
  private readonly handoffs: HandoffService;
  /** 用户按停止后暂停自动派发排队输入，直到下一次提交（停止只停本轮，不吞掉排队）。 */
  private readonly paused = new Set<string>();
  private readonly stoppedByUser = new Set<string>();
  private readonly dispatching = new Set<string>();
  private readonly preparingTurns = new Map<string, string>();
  private readonly openingRuns = new Map<string, ReturnType<AgentTaskService['openOrReuseRun']>>();
  private readonly prewarmingRuns = new Map<string, PrewarmingRun>();
  private prewarmingClosed = false;
  private readonly queuedSteers = new Set<string>();
  private readonly missedPump = new Set<string>();
  private readonly blockedByClosing = new Map<string, number>();
  /** 每次停止递增：异步打开运行期间按了停止，返回后不再派发（复核 CR03）。 */
  private readonly stopSeq = new Map<string, number>();
  private readonly goalPending = new Map<string, GoalInput & { turnId: string }>();
  // A /goal turn that ended without a recognised confirmation: the goal state is unknown (A69, D06-66).
  private readonly goalUnknown = new Map<string, { kind: 'set' | 'clear'; objective?: string }>();

  constructor(private readonly d: { store: AgentStore; runs: AgentRunService; resolveLaunch: LaunchResolver; profileDriver: ProfileDriver; profileName?(id: string): string; profileModelSettings?(id: string): { defaultModel?: string | null; providerBacked?: boolean; options: AgentModelOption[] }; userData?: string; capabilityRegistry?: Pick<CapabilityRegistryService, 'selected'> }) {
    this.handoffs = new HandoffService(d.store);
    // 重启后排队的输入保留但不自动发出，等用户再次提交或取消（未知接收不自动重发）。
    for (const taskId of d.store.tasksWithQueue()) this.paused.add(taskId);
    // A child can finish recovery after startup and enqueue a result on a stopped parent.
    for (const taskId of d.store.tasksStoppedByUser()) {
      this.paused.add(taskId);
      this.stoppedByUser.add(taskId);
    }
    d.store.subscribe(e => {
      const goal = this.goalPending.get(e.taskId);
      if (e.type === 'goal.changed') {
        this.goalUnknown.delete(e.taskId);
        const { status } = e.payload as { status: string };
        if (goal && (goal.kind === 'clear' ? status === 'cleared' : status === 'active')
            && this.d.store.turn(goal.turnId)?.status !== 'accepted') this.goalPending.delete(e.taskId);
      }
      if (e.type === 'turn.ended' && goal && goal.turnId === (e.payload as { turnId: string }).turnId) {
        this.goalPending.delete(e.taskId);
        const turn = this.d.store.inputForTurn(goal.turnId);
        if (turn?.started_at || turn?.status === 'unknown') {
          const { turnId: _turnId, ...intent } = goal;
          this.goalUnknown.set(e.taskId, intent);
        }
      }
      // 只解除“等待旧运行退出”这一原因；等待期间用户又按了停止，则保持暂停（复核 FR01）。
      if (e.type === 'run.ended' && this.blockedByClosing.has(e.taskId)) { const since = this.blockedByClosing.get(e.taskId); this.blockedByClosing.delete(e.taskId); if (since === (this.stopSeq.get(e.taskId) ?? 0)) this.paused.delete(e.taskId); }
      if (e.type === 'turn.ended' && this.diffs) {
        const { turnId } = e.payload as { turnId: string };
        const runId = this.d.store.turn(turnId)?.run_id;
        const run = runId ? this.d.runs.active(runId) : undefined;
        if (!(run?.readOnly ?? this.coordination?.readOnly?.(e.taskId))) {
          this.finishingTurns.add(e.taskId);
          void this.finishDiff(e.taskId, turnId, runId).catch(() => {}).finally(() => {
            this.finishingTurns.delete(e.taskId);
            void this.advance(e.taskId);
          });
        }
      }
      if (e.type === 'turn.ended' || e.type === 'run.ended') {
        // 派发进行中到达的终态会被门闩挡掉：记下来，门闩释放后补一次调度（复核 NR03）。
        if (this.dispatching.has(e.taskId)) this.missedPump.add(e.taskId);
        queueMicrotask(() => void this.advance(e.taskId));
      }
    });
  }

  create(input: { clientTaskId?: string; projectId: string | null; dirId: string | null; cwd: string; title: string; profileId: string; tier: Tier; model?: string; effort?: string; initialCodexDefault?: boolean; carryExtensions?: boolean; extensionPreferences?: Record<string, boolean> }) {
    const taskId = input.clientTaskId;
    if (taskId !== undefined) {
      if (typeof taskId !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(taskId)) {
        throw new DriverError('REJECTED', '任务创建标识无效');
      }
      const existing = this.d.store.task(taskId);
      if (existing) {
        if (existing.archived_at || existing.parent_task_id || existing.project_id !== input.projectId || existing.dir_id !== input.dirId || existing.cwd !== input.cwd) {
          throw new DriverError('REJECTED', '任务创建标识已用于其他任务或目录');
        }
        return { taskId, selection: JSON.parse(existing.selection_json) as AgentSelection };
      }
    }
    const driverId = this.d.profileDriver(input.profileId);
    const tier = resolveTier(driverId, input.tier);
    if (!tier.ok) throw new DriverError('REJECTED', '不支持的权限档位');
    if (input.model && (!input.model.trim() || input.model.length > 256 || /[\x00-\x1f]/.test(input.model))) throw new DriverError('REJECTED', '模型无效');
    if (input.effort !== undefined && (typeof input.effort !== 'string' || !/^[a-z][a-z0-9_-]{0,23}$/.test(input.effort))) throw new DriverError('REJECTED', '推理强度无效');
    const preferences: Record<string, boolean> = {};
    for (const [id, enabled] of Object.entries(input.extensionPreferences ?? {}).slice(0, 200)) { if (typeof enabled === 'boolean') { try { this.d.profileDriver(id); preferences[id] = enabled; } catch { /* 已删除的首页配置不带入任务 */ } } }
    const selection: AgentSelection = { driverId, profileId: input.profileId, tier: tier.tier, carryExtensions: input.carryExtensions !== false, extensionPreferences: { ...preferences, [input.profileId]: input.carryExtensions !== false }, ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
      ...(driverId === 'codex-app-server' && input.initialCodexDefault === true && input.model === CODEX_LOGIN_MODEL &&
        input.effort === CODEX_LOGIN_EFFORT ? { initialCodexDefault: true } : {}) };
    const title = input.title.trim().slice(0, 120) || '新任务';
    return { taskId: this.d.store.createTask({ taskId, projectId: input.projectId, dirId: input.dirId, cwd: input.cwd, title, selection }), selection, ...(tier.downgraded ? { tierNotice: tier.reason } : {}) };
  }

  setReplyLiked(taskId: string, itemId: string, liked: boolean) {
    this.selection(taskId);
    if (typeof liked !== 'boolean') throw new DriverError('REJECTED', '点赞状态无效');
    return this.d.store.setReplyLiked(taskId, itemId, liked);
  }

  branchFromReply(taskId: string, itemId: string) {
    const { task, selection } = this.selection(taskId, true);
    const { pendingSwitch: _pendingSwitch, ...currentSelection } = selection;
    const title = `分支 · ${task.title}`.slice(0, 120);
    return { taskId: this.d.store.branchFromReply(taskId, itemId, {
      projectId: task.project_id, dirId: task.dir_id, cwd: task.cwd, title, selection: currentSelection,
    }) };
  }

  private selection(taskId: string, readOnly = false) {
    const t = this.d.store.task(taskId);
    if (!t) throw new DriverError('REJECTED', '任务不存在');
    if (!readOnly && (t.archived_at || this.archiving.has(taskId))) throw new DriverError('REJECTED', '任务已归档或正在归档');
    return { task: t, selection: JSON.parse(t.selection_json) as AgentSelection, revision: t.selection_revision };
  }

  private requireStableSelection(taskId: string) { if (this.switching.has(taskId)) throw new DriverError('STATE', '正在切换执行器，请稍后'); }

  private applyModelChoice(taskId: string, previous: AgentSelection, profileId: string, model?: string | null, effort?: string | null): Partial<AgentSelection> {
    const run = this.switching.has(taskId) ? undefined : this.d.runs.runForTask(taskId);
    const previousDefault = run?.defaultModel ?? this.d.profileModelSettings?.(previous.profileId)?.defaultModel;
    const previousKey = modelEffortKey(previous.profileId, previous.model ?? previousDefault);
    const choices = { ...previous.modelEfforts };
    if (!previous.modelEfforts) {
      for (const [id, saved] of Object.entries(previous.profileChoices ?? {})) {
        const model = saved.model ?? this.d.profileModelSettings?.(id)?.defaultModel;
        if (saved.effort) choices[modelEffortKey(id, model)] = saved.effort;
      }
      if (previous.effort) choices[previousKey] = previous.effort;
    }
    const sameProfile = profileId === previous.profileId;
    const saved = sameProfile ? previous : previous.profileChoices?.[profileId];
    const nextModel = model === undefined ? saved?.model : model;
    const defaultModel = sameProfile ? previousDefault : this.d.profileModelSettings?.(profileId)?.defaultModel;
    const key = modelEffortKey(profileId, nextModel ?? defaultModel);
    if (effort === null) delete choices[key];
    else if (effort !== undefined) choices[key] = effort;
    return { model: nextModel ?? undefined, effort: choices[key], modelEfforts: choices, initialCodexDefault: undefined };
  }

  /** 保存选择，符合执行器能力的权限切换应用到当前轮。 */
  setSelection(taskId: string, patch: { tier?: Tier; model?: string | null; effort?: string | null; carryExtensions?: boolean }, expectedRevision: number) {
    const { task, selection } = this.selection(taskId);
    const next: Partial<AgentSelection> = {};
    if (patch.tier !== undefined) {
      if (task.parent_task_id) throw new DriverError('REJECTED', '子任务的权限档位由主任务决定');
      if (!isTier(patch.tier)) throw new DriverError('REJECTED', '不支持的权限档位');
      const r = resolveTier(selection.driverId, patch.tier);
      if (!r.ok) throw new DriverError('REJECTED', '不支持的权限档位');
      next.tier = r.tier;
    }
    if (patch.model !== undefined) {
      if (patch.model !== null && (!patch.model.trim() || patch.model.length > 256 || /[\x00-\x1f]/.test(patch.model))) throw new DriverError('REJECTED', '模型无效');
    }
    if (patch.effort !== undefined) {
      if (patch.effort !== null && !/^[a-z][a-z0-9_-]{0,23}$/.test(patch.effort)) throw new DriverError('REJECTED', '推理强度无效');
    }
    if (patch.model !== undefined || patch.effort !== undefined) {
      Object.assign(next, this.applyModelChoice(taskId, selection, selection.profileId, patch.model, patch.effort));
    }
    if (patch.carryExtensions !== undefined) {
      if (typeof patch.carryExtensions !== 'boolean') throw new DriverError('REJECTED', '扩展选择无效');
      next.carryExtensions = patch.carryExtensions;
      next.extensionPreferences = { ...selection.extensionPreferences, [selection.profileId]: patch.carryExtensions };
    }
    const result = this.d.store.updateSelection(taskId, next, expectedRevision);
    const run = this.d.runs.runForTask(taskId);
    if (result.ok && patch.tier !== undefined && run && !this.dispatching.has(taskId) && !this.switching.has(taskId)) {
      void this.d.runs.changeTurnTier(run.runId, result.selection.tier as Tier);
    }
    return result;
  }

  /** 同任务切换：目标锁与空闲边界由服务强制，不依赖界面置灰。 */
  async switchProfile(taskId: string, profileId: string, expectedRevision: number, model?: string | null, effort?: string | null) {
    const before = this.selection(taskId);
    if (before.revision !== expectedRevision) return { ok: false as const, revision: before.revision, selection: before.selection };
    if (model !== undefined && model !== null && (!model.trim() || model.length > 256 || /[\x00-\x1f]/.test(model))) throw new DriverError('REJECTED', '模型无效');
    if (effort !== undefined && effort !== null && (typeof effort !== 'string' || !/^[a-z][a-z0-9_-]{0,23}$/.test(effort))) throw new DriverError('REJECTED', '推理强度无效');
    if (profileId === before.selection.profileId) {
      const next: Partial<AgentSelection> = { pendingSwitch: undefined };
      if (model !== undefined || effort !== undefined) Object.assign(next, this.applyModelChoice(taskId, before.selection, profileId, model, effort));
      return this.d.store.updateSelection(taskId, next, expectedRevision);
    }
    const driverId = this.d.profileDriver(profileId);
    const goal = this.d.store.goal(taskId);
    if (goal && goal.status !== 'complete') throw new DriverError('STATE', '清除目标后才能切换');
    const run = this.d.runs.runForTask(taskId);
    const busy = !!this.coordination?.blocked(taskId) || this.dispatching.has(taskId) || this.openingRuns.has(taskId)
      || this.d.runs.respondingForTask(taskId) || this.d.store.queuedTurns(taskId).length > 0 || !!(run && this.d.runs.busy(run.runId));
    if (busy) return this.d.store.updateSelection(taskId, { pendingSwitch: { profileId, model, effort } }, expectedRevision);
    const tier = resolveTier(driverId, before.selection.tier as Tier);
    if (!tier.ok) throw new DriverError('REJECTED', '目标不支持当前档位');
    const previous = before.selection;
    const modelChoice = this.applyModelChoice(taskId, before.selection, profileId, model, effort);
    const changed = this.d.store.updateSelection(taskId, {
      ...modelChoice, driverId, profileId, tier: tier.tier, pendingSwitch: undefined,
      profileChoices: { ...previous.profileChoices, [previous.profileId]: { model: previous.model, effort: previous.effort } },
      carryExtensions: previous.extensionPreferences?.[profileId] ?? true,
      extensionPreferences: { ...previous.extensionPreferences, [previous.profileId]: previous.carryExtensions !== false },
    }, expectedRevision, { from: this.d.profileName?.(previous.profileId) ?? previous.profileId, to: this.d.profileName?.(profileId) ?? profileId });
    if (changed.ok && !this.switching.has(taskId)) void this.finishSwitch(taskId);
    return changed;
  }

  private async finishSwitch(taskId: string) {
    this.switching.add(taskId);
    const seq = this.stopSeq.get(taskId) ?? 0;
    this.d.store.tx(emit => emit(taskId, 'selection.switching', { switching: true }));
    try {
      if (this.prewarmingRuns.has(taskId)) await this.cancelPrewarm(taskId);
      const run = this.d.runs.runForTask(taskId);
      if (run) await this.d.runs.close(run.runId);
      await this.d.runs.closingForTask(taskId)?.ended;
      if ((this.stopSeq.get(taskId) ?? 0) !== seq || this.prewarmingClosed) return;
      const { task, selection } = this.selection(taskId);
      // Existing Codex threads can resume while idle. A new session starts with the first input.
      if (selection.driverId !== 'codex-app-server' || this.d.store.queuedTurns(taskId).length) return;
      const launch = await this.d.resolveLaunch({ taskId, profileId: selection.profileId, cwd: task.cwd, runId: randomUUID(), carryExtensions: selection.carryExtensions });
      launch.assertCurrent?.();
      const current = this.selection(taskId).selection;
      if ((this.stopSeq.get(taskId) ?? 0) === seq && current.profileId === selection.profileId
          && current.carryExtensions === selection.carryExtensions && current.driverId === launch.driverId) this.prewarm(taskId, launch);
    } catch (e) {
      if ((this.stopSeq.get(taskId) ?? 0) === seq && !this.prewarmingClosed) {
        this.d.store.addHostItem(taskId, null, 'system_notice', {
          severity: 'warning', code: 'switchPreparationFailed', detail: `执行器后台准备失败：${(e as Error).message.slice(0, 500)}`,
        });
      }
    } finally {
      this.switching.delete(taskId);
      if (!this.prewarmingClosed) {
        this.d.store.tx(emit => emit(taskId, 'selection.switching', { switching: false }));
        this.kick(taskId);
      }
    }
  }

  setExtensions(taskId: string, profileId: string, enabled: boolean, expectedRevision: number) {
    if (typeof enabled !== 'boolean') throw new DriverError('REJECTED', '扩展选择无效');
    this.d.profileDriver(profileId);
    const { selection } = this.selection(taskId);
    return this.d.store.updateSelection(taskId, { extensionPreferences: { ...selection.extensionPreferences, [profileId]: enabled }, ...(profileId === selection.profileId ? { carryExtensions: enabled } : {}) }, expectedRevision);
  }

  private async advance(taskId: string) {
    const task = this.d.store.task(taskId); if (!task || task.archived_at || this.archiving.has(taskId)) return;
    const browserContinuation=this.hasBrowserContinuation(taskId);
    if (this.paused.has(taskId)&&!browserContinuation || this.finishingTurns.has(taskId) || this.dispatching.has(taskId) || this.switching.has(taskId)) return;
    const { selection, revision } = this.selection(taskId), run = this.d.runs.runForTask(taskId);
    if (selection.pendingSwitch && !this.d.store.queuedTurns(taskId).length && !this.d.runs.respondingForTask(taskId) && !(run && this.d.runs.busy(run.runId)) && !this.d.runs.closingForTask(taskId)) {
      try { await this.switchProfile(taskId, selection.pendingSwitch.profileId, revision, selection.pendingSwitch.model, selection.pendingSwitch.effort); }
      catch (e) {
        const current = this.selection(taskId);
        this.d.store.updateSelection(taskId, { pendingSwitch: undefined }, current.revision);
        this.d.store.addHostItem(taskId, null, 'system_notice', { code: 'switchFailed', detail: `待切换未生效：${(e as Error).message}` });
      }
    }
    await this.pump(taskId);
  }

  private hasBrowserContinuation(taskId:string):boolean{
    return !this.stoppedByUser.has(taskId)&&(
      this.business?.needsLoginRun(taskId)===true||
      this.d.store.queuedTurns(taskId).some(turn=>turn.source_kind==='system'&&turn.client_input_id.startsWith('browser-login-'))
    );
  }

  /** 草稿与输入同一文字上限；超限明确拒绝，原记录不变（复核 SR02）。冲突回执只带修订，不回传草稿正文。 */
  saveDraft(taskId: string, draft: unknown, expectedRevision: number) {
    this.selection(taskId);
    const d = draft as { text?: unknown; attachments?: unknown; goalMode?: unknown } | null;
    if (!d || typeof d !== 'object' || (d.text !== undefined && typeof d.text !== 'string')) throw new DriverError('REJECTED', '草稿无效');
    if (typeof d.text === 'string' && Buffer.byteLength(d.text) > INPUT_TEXT_LIMIT) throw new DriverError('REJECTED', '草稿超过 256 KB，未保存；请拆分或改用附件');
    if (d.attachments !== undefined && (!Array.isArray(d.attachments) || d.attachments.length > 20)) throw new DriverError('REJECTED', '草稿附件无效');
    if (d.goalMode !== undefined && typeof d.goalMode !== 'boolean') throw new DriverError('REJECTED', '草稿模式无效');
    const previous = this.d.store.draft(taskId)?.draft;
    const r = this.d.store.saveDraft(taskId, draft, expectedRevision);
    if (r.ok) {
      this.discardAttachments?.(taskId, previous);
      return r;
    }
    // 冲突回执带服务端版本；过大的只给修订与大小，由界面经 draftBody 读取，响应守容量上限。
    return jsonBytes(r.draft) <= DRAFT_INLINE ? r : { ok: false as const, revision: r.revision, draft: null, draftTruncated: true as const };
  }

  /** 提交：先持久接受（幂等），忙则排队；空闲立即派发。mode=steer 时尝试插话，不支持则保留在排队并说明原因。 */
  async submit(taskId: string, input: { clientInputId: string; text: string; expectedSelectionRevision: number; mode?: 'queue' | 'steer'; attachments?: unknown[] },sender?:import('../applications/execution-context').ApplicationUiSender, goal?: QueuedGoal) {
    let { revision, task } = this.selection(taskId);
    // 幂等命中直接返回原收据，不再核对选择修订、准备或冻结附件（复核 NR01、FR06）。
    const existing = this.d.store.turnByClientInput(taskId, input.clientInputId);
    if (existing) return { turnId: existing.turn_id, duplicate: true, status: existing.status };
    // 重启后遗留的待切换先在空闲边界处理，再让用户确认新选择；不能把新输入送给旧目标。
    const pending = (JSON.parse(task.selection_json) as AgentSelection).pendingSwitch;
    if (pending && !this.paused.has(taskId)) {
      await this.advance(taskId);
      ({ revision, task } = this.selection(taskId));
    }
    if (input.expectedSelectionRevision !== revision) throw new DriverError('REJECTED', '模型或权限已变化，请确认后再发送');
    if (Buffer.byteLength(input.text) > 256 * 1024) throw new DriverError('REJECTED', '输入超过 256 KB，请拆分或改用附件');
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(input.clientInputId)) throw new DriverError('REJECTED', '输入标识无效');
    const verified = this.d.userData ? verifyAttachments(input.attachments, task.cwd, this.d.userData) : [];
    // 图片在接受时冻结副本，派发只读副本（复核 CR01）。
    const attachments = this.d.userData ? freezeImages(verified, task.cwd, this.d.userData) : verified;
    if (!input.text.trim() && !attachments.length) throw new DriverError('REJECTED', '内容为空');
    const accepted = this.d.store.acceptTurn({ taskId, clientInputId: input.clientInputId, text: input.text, sourceKind: 'user', attachments, goal });
    if (accepted.duplicate) return { turnId: accepted.turn.turn_id, duplicate: true, status: accepted.turn.status };
    if (goal) this.trackGoal(taskId, accepted.turn.turn_id, goal);
    if(sender)this.trustedInputs.set(accepted.turn.turn_id,sender);
    this.paused.delete(taskId);
    this.stoppedByUser.delete(taskId);
    this.coordination?.userContinued(taskId);
    this.d.runs.hold(taskId, this.coordination?.blocked(taskId) ?? false);
    const run = this.d.runs.runForTask(taskId);
    if (input.mode === 'steer' && run && this.d.runs.busy(run.runId) && !this.dispatching.has(taskId) && !this.switching.has(taskId)) {
      if (!this.steerable(run)) return { turnId: accepted.turn.turn_id, duplicate: false, status: 'queued', steerRefused: '该执行器版本没有插话的验证证据，已排队' };
      this.dispatching.add(taskId);
      this.queuedSteers.add(accepted.turn.turn_id);
      try {
        const turnId = accepted.turn.turn_id;
        const { omittedImages, ...body } = this.agentInput(input.text, attachments, run, run.appliedModel ?? run.defaultModel);
        await this.d.runs.steer(run.runId, turnId, { clientInputId: input.clientInputId, ...body });
        this.reportOmittedImages(taskId, turnId, omittedImages);
        this.humanSent(turnId, run, input.text);
        return { turnId, duplicate: false, status: 'steered' };
      }
      catch (e) {
        // 只有能证明未发出（协议明确拒绝、状态不符、不支持）才转排队；超时或断线可能已被接受，记未知、不自动重发（复核 CR02）。
        if (e instanceof DriverError && (e.code === 'REJECTED' || e.code === 'STATE' || e.code === 'UNSUPPORTED')) return { turnId: accepted.turn.turn_id, duplicate: false, status: 'queued', steerRefused: `插话未被接受（${e.message.slice(0, 120)}），已排队` };
        this.d.store.endTurn(accepted.turn.turn_id, 'unknown', e instanceof DriverError ? e.code : 'STEER_UNKNOWN');
        return { turnId: accepted.turn.turn_id, duplicate: false, status: 'unknown', steerRefused: '插话是否被接受无法确认，不会自动重发；请查看回答后再决定' };
      } finally {
        this.queuedSteers.delete(accepted.turn.turn_id);
        this.dispatching.delete(taskId);
        if (this.missedPump.delete(taskId)) this.kick(taskId);
      }
    }
    const queued = !!run && this.d.runs.busy(run.runId) || this.d.store.queuedTurns(taskId).length > 1 || this.dispatching.has(taskId) || this.switching.has(taskId);
    void this.pump(taskId);
    return { turnId: accepted.turn.turn_id, duplicate: false, status: queued ? 'queued' : 'accepted' };
  }

  /** 发给执行器的文字（附件注明）与图片路径。 */
  private agentInput(text: string, attachments: Attachment[], run: RunHandle, model?: string) {
    // 图片一律读冻结副本（storedPath，在 WillYou 私有目录内）。
    const attachImages = !model || !run.modelsWithoutImageInput?.has(model);
    const images = attachments.filter(a => a.image && a.storedPath).map(a => ({ path: a.storedPath!, mime: a.mime }));
    return { text: text + attachmentNote(attachments, attachImages), images: attachImages ? images : [], omittedImages: attachImages ? 0 : images.length };
  }

  private reportOmittedImages(taskId: string, turnId: string, count: number) {
    if (!count) return;
    try {
      this.d.store.addHostItem(taskId, turnId, 'system_notice', { severity: 'warning', code: 'modelDoesNotAcceptImages',
        title: '当前模型不支持图片', detail: `未发送 ${count} 张图片的图像内容，原附件已保留。` });
    } catch { /* A display failure cannot change the native input receipt. */ }
  }

  /** 输入框附件准备：taskId 为空时（首页）用所选目录。 */
  prepareAttachment(taskId: string | null, cwd: string | null, file: { name: string; mime?: string; sourcePath?: string; dataBase64?: string }) {
    if (!this.d.userData) throw new DriverError('UNSUPPORTED', '附件不可用');
    const dir = taskId ? this.selection(taskId).task.cwd : cwd;
    if (!dir) throw new DriverError('REJECTED', '先选择项目目录');
    const prepared = prepareAttachment({ cwd: dir, userData: this.d.userData, ...file });
    if (taskId && prepared.storedPath) {
      this.d.store.sqlite.prepare(`INSERT OR IGNORE INTO agent_resource_refs(owner_kind,owner_id,resource_kind,resource_id,hold_reason,created_at)
        VALUES('task',?,'attachment',?,'prepared',?)`).run(taskId,prepared.storedPath,new Date().toISOString());
    }
    return prepared;
  }

  private sentAttachment(taskId: string, turnId: string, index: number): Attachment | undefined {
    const turn = this.d.store.inputForTurn(turnId);
    if (turn?.task_id !== taskId || turn.source_kind !== 'user' || turn.status === 'canceled') return;
    return (JSON.parse(turn.input_ref) as { attachments?: Attachment[] }).attachments?.[index];
  }

  async messageAttachmentFile(taskId: string, turnId: string, index: number) {
    if (!this.d.userData) throw new DriverError('UNSUPPORTED', '附件不可用');
    const { task } = this.selection(taskId, true);
    const attachment = this.sentAttachment(taskId, turnId, index);
    if (!attachment || attachment.image) throw new DriverError('REJECTED', '文件附件不可用');
    return resolveAttachmentFile(attachment, task.cwd, this.d.userData);
  }

  async attachmentImage(taskId: string, source: AttachmentImageSource, offset: number, revision?: string) {
    if (!this.d.userData) throw new DriverError('UNSUPPORTED', '附件不可用');
    const { task } = this.selection(taskId, true);
    let attachment: Attachment | undefined;
    if (source?.kind === 'message' && typeof source.turnId === 'string' && Number.isSafeInteger(source.index) && source.index >= 0) {
      attachment = this.sentAttachment(taskId, source.turnId, source.index);
    } else if (source?.kind === 'draft' && typeof source.attachmentId === 'string' && !task.archived_at) {
      const draft = this.d.store.draft(taskId)?.draft as { attachments?: Attachment[] } | undefined;
      attachment = Array.isArray(draft?.attachments) ? draft.attachments.find(value => value?.id === source.attachmentId) : undefined;
      if (attachment?.storedPath && !this.d.store.sqlite.prepare(`
        SELECT 1 FROM agent_resource_refs
        WHERE owner_kind='task' AND owner_id=? AND resource_kind='attachment' AND resource_id=?
        UNION ALL SELECT 1 FROM agent_turns t, json_each(t.input_ref,'$.attachments') a
        WHERE t.task_id=? AND t.status<>'canceled' AND a.type='object' AND json_extract(a.value,'$.storedPath')=? LIMIT 1
      `).get(taskId, attachment.storedPath, taskId, attachment.storedPath)) attachment = undefined;
    }
    if (!attachment) throw new DriverError('REJECTED', '图片附件不可用');
    return readAttachmentImage(attachment, this.d.userData, source.kind === 'draft' ? task.cwd : null, offset, revision);
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

  /** While idle, resume only an existing, compatible Codex thread. The foreground owns all input and handoff. */
  private prewarm(taskId: string, launch: ResolvedLaunch) {
    const task = this.d.store.task(taskId);
    if (this.prewarmingClosed || !task || task.archived_at || task.parent_task_id || this.archiving.has(taskId)
        || this.paused.has(taskId) || this.openingRuns.has(taskId) || this.prewarmingRuns.has(taskId)
        || this.d.store.queuedTurns(taskId).length || this.d.store.pendingRequests(taskId).length
        || this.d.runs.runForTask(taskId) || this.d.runs.closingForTask(taskId)
        || this.business?.busy(taskId) || this.coordination?.blocked(taskId) || this.coordination?.hasUnfinishedChildren(taskId)) return;
    const selection = JSON.parse(task.selection_json) as AgentSelection;
    const controller = new AbortController();
    const { signal } = controller;
    const options = this.runInput(taskId, task.cwd, selection, launch, () => signal.aborted);
    const opening = Promise.resolve().then(() => {
      if (signal.aborted) return;
      options.assertCurrent?.();
      return this.d.runs.open({ ...options, startupSignal: signal }, 'resume-only');
    }).catch(error => {
      if (!signal.aborted) this.d.store.tx(emit => emit(taskId, 'run.prewarm_failed', {
        code: error instanceof DriverError ? error.code : 'OPEN_FAILED',
      }));
      return undefined;
    });
    const warm: PrewarmingRun = { controller, opening };
    this.prewarmingRuns.set(taskId, warm);
    void opening.then(run => {
      if (warm.closing || this.prewarmingRuns.get(taskId) !== warm) return;
      if (!run) this.prewarmingRuns.delete(taskId);
      else {
        warm.expiry = setTimeout(() => {
          if (this.prewarmingRuns.get(taskId) === warm) void this.cancelPrewarm(taskId)?.catch(() => {});
        }, PREWARM_IDLE_MS);
        warm.expiry.unref();
      }
    });
  }

  private cancelPrewarm(taskId: string) {
    const warm = this.prewarmingRuns.get(taskId);
    if (!warm) return;
    clearTimeout(warm.expiry);
    warm.controller.abort();
    warm.closing ??= warm.opening.then(async run => {
      if (run && this.d.runs.runForTask(taskId)?.runId === run.runId) await this.d.runs.close(run.runId);
    }).finally(() => {
      if (this.prewarmingRuns.get(taskId) === warm) this.prewarmingRuns.delete(taskId);
    });
    return warm.closing;
  }

  async closePrewarms() {
    this.prewarmingClosed = true;
    await Promise.allSettled([...this.prewarmingRuns.keys()].map(taskId => this.cancelPrewarm(taskId)));
  }

  /** 打开或恢复本任务的运行（不派发输入）。 */
  private ensureRun(taskId: string) {
    const pending = this.openingRuns.get(taskId);
    if (pending) return pending;
    const warm = this.prewarmingRuns.get(taskId);
    const seq = this.stopSeq.get(taskId) ?? 0;
    const opening = (async () => {
      if (warm) {
        const ready = await warm.opening;
        await warm.closing;
        if ((this.stopSeq.get(taskId) ?? 0) !== seq) throw new DriverError('STATE', '启动已停止');
        if (this.prewarmingRuns.get(taskId) === warm) {
          clearTimeout(warm.expiry);
          this.prewarmingRuns.delete(taskId);
        }
        return this.openOrReuseRun(taskId, ready?.runId);
      }
      return this.openOrReuseRun(taskId);
    })().finally(() => this.openingRuns.delete(taskId));
    this.openingRuns.set(taskId, opening);
    return opening;
  }

  private async openOrReuseRun(taskId: string, prewarmedRunId?: string) {
    const seq = this.stopSeq.get(taskId) ?? 0;
    const startCancelled = () => (this.stopSeq.get(taskId) ?? 0) !== seq;
    if (this.coordination && !await this.coordination.beforeDispatch(taskId)) throw new DriverError('STATE', '正在等待工作目录写入资格，请稍后再执行命令');
    if (startCancelled()) throw new DriverError('STATE', '启动已停止');
    const existing = this.d.runs.runForTask(taskId);
    if (existing) {
      try {
        existing.assertCurrent?.();
        if (existing.runId === prewarmedRunId) this.coordination?.opened(taskId, existing);
        return existing;
      } catch (e) {
        if (!this.d.runs.busy(existing.runId)) await this.d.runs.close(existing.runId);
        if (existing.runId !== prewarmedRunId) throw e;
      }
    }
    const { task, selection } = this.selection(taskId);
    // 不带当前选择解析启动参数，得到档案自己的默认模型；“恢复默认”用它（复核 NR05）。
    const launch = await this.d.resolveLaunch({ taskId, profileId: selection.profileId, cwd: task.cwd, runId: randomUUID(), carryExtensions: selection.carryExtensions });
    if (startCancelled()) throw new DriverError('STATE', '启动已停止');
    if (launch.driverId !== selection.driverId) throw new DriverError('REJECTED', '配置档案的执行器已变化');
    if (this.d.runs.closingForTask(taskId)) throw new DriverError('STATE', '上一运行仍在退出，请稍后');
    const options = this.runInput(taskId, task.cwd, selection, launch, startCancelled);
    options.assertCurrent?.();
    const opened = await this.d.runs.open(options);
    const run = this.d.runs.runForTask(taskId);
    if (run?.runId !== opened.runId) throw new DriverError('EXITED', '会话就绪前执行器已退出');
    this.coordination?.opened(taskId, run);
    return run;
  }

  private runInput(taskId: string, cwd: string, selection: AgentSelection, launch: ResolvedLaunch, startCancelled: () => boolean): OpenRunInput {
    const assertCurrent = () => {
      this.coordination?.assertTargetCurrent(taskId);
      launch.assertCurrent?.();
    };
    return { taskId, driverId: launch.driverId, modelCache: launch.modelCache, hostBusinessInstructions: this.business ? HOST_BUSINESS_INSTRUCTIONS : undefined, profileId: selection.profileId, executable: launch.executable, cwd, env: launch.env, stateRoot: launch.stateRoot, compatibility: launch.compatibility, tier: selection.tier as Tier, model: selection.model ?? launch.model, defaultModel: launch.model, extraArgs: launch.extraArgs, settingSources: launch.settingSources, capabilities: launch.capabilities, modelsWithoutImageInput: launch.modelsWithoutImageInput, assertCurrent, startCancelled, integrate: launch.integrate, stopWhenWaiting: () => this.coordination?.waitingChildren(taskId) ?? false, readOnly: this.coordination?.readOnly?.(taskId) };
  }

  private async commandContext(taskId: string, run: RunHandle) {
    if (this.d.runs.busy(run.runId)) return;
    const transfer = this.handoffs.prepare(taskId, run.bindingId, null, INPUT_TEXT_LIMIT);
    if (!transfer) return;
    try { if (transfer.text) await this.d.runs.injectHistory(run.runId, transfer.text); this.handoffs.delivered(transfer.id, 'accepted'); }
    catch (e) { this.handoffs.delivered(transfer.id, e instanceof DriverError && ['STATE', 'REJECTED', 'UNSUPPORTED'].includes(e.code) ? 'unsent' : 'unknown'); throw e; }
  }

  /** 输入框原生命令：Codex 的 compact／review 走协议；Claude 及其他公布的命令作为文字输入发送。 */
  async command(taskId: string, name: string, args = '') {
    this.requireStableSelection(taskId);
    this.coordination?.userContinued(taskId);
    if (!/^[A-Za-z0-9_:.-]{1,64}$/.test(name)) throw new DriverError('REJECTED', '命令无效');
    const { selection, revision } = this.selection(taskId);
    if (selection.driverId === 'codex-app-server' && (name === 'compact' || name === 'review')) {
      const run = await this.ensureRun(taskId);
      // 会开始原生工作的命令与普通发送同一档位／能力门禁（复核 FR08）。
      this.gateTier(run, selection.tier as Tier);
      // 原生命令沿用线程上一次生效的档位：与当前选择不一致时先发一条消息让新档位生效，不借用旧配置。
      if (run.appliedTier && run.appliedTier !== selection.tier) throw new DriverError('STATE', '档位已变化，新档位要在下一条消息生效；请先发送一条消息再执行该命令');
      if (this.d.runs.busy(run.runId)) throw new DriverError('STATE', '本轮结束后再执行该命令');
      await this.commandContext(taskId, run);
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

  managedSkills(taskId: string) {
    return this.managedSkillsForDirectory(this.selection(taskId).task.cwd);
  }

  managedSkillsForDirectory(cwd?: string) {
    return (this.d.capabilityRegistry?.selected(cwd) ?? [])
      .filter(item => item.kind === 'skill')
      .map(({ name }) => ({ name }));
  }

  private trackGoal(taskId: string, turnId: string, goal: QueuedGoal) {
    const { bindingId: _bindingId, ...intent } = goal;
    this.goalUnknown.delete(taskId);
    this.goalPending.set(taskId, { ...intent, turnId });
  }

  /** Codex uses its goal RPC. Claude and Gemini use their own slash command in a turn. */
  async goal(taskId: string, op: GoalInput | { kind: 'pause' } | { kind: 'resume' }) {
    this.requireStableSelection(taskId);
    const { selection, revision, task } = this.selection(taskId);
    if (task.parent_task_id) throw new DriverError('UNSUPPORTED', '子任务不支持设置目标');
    if (op.kind === 'set' && (!op.objective.trim() || op.objective.length > 4000)) throw new DriverError('REJECTED', '目标内容无效');
    if (selection.driverId !== 'codex-app-server' && (op.kind === 'pause' || op.kind === 'resume')) {
      throw new DriverError('UNSUPPORTED', '此执行器的目标不能暂停或继续，只能清除');
    }
    const run = await this.ensureRun(taskId);
    if (this.selection(taskId).revision !== revision) throw new DriverError('REJECTED', '模型或权限已变化，请确认后再发送');
    this.requireCapability(run, 'goal', '目标');
    if (!this.d.runs.goalAvailable(run.runId)) throw new DriverError('UNSUPPORTED', '执行器没有公布目标命令');
    this.d.store.tx(emit => emit(taskId, 'goal.user_action', { kind: op.kind }));
    if (op.kind !== 'pause') this.coordination?.userContinued(taskId);
    if (run.driverId !== 'codex-app-server' && (op.kind === 'set' || op.kind === 'clear')) {
      if (this.goalPending.has(taskId)) throw new DriverError('STATE', '已有目标操作等待执行器确认');
      const current = this.d.store.goal(taskId);
      const acp = run.driverId === 'antigravity-acp';
      if (acp && op.kind === 'clear' && current?.status === 'complete') {
        this.d.store.upsertGoal({ taskId, bindingId: run.bindingId, objective: null, status: 'cleared' });
        return { ok: true };
      }
      const interrupt = acp && op.kind === 'clear' && current?.status === 'active' && this.d.runs.busy(run.runId);
      const goal = op.kind === 'set' ? { kind: 'set' as const, objective: op.objective.trim() } : op;
      const text = goal.kind === 'set' ? `/goal ${goal.objective}` : '/goal clear';
      const accepted = await this.submit(taskId, { clientInputId: `goal-${randomUUID().replace(/-/g, '')}`, text,
        expectedSelectionRevision: revision }, undefined, { ...goal, bindingId: run.bindingId });
      if (interrupt && accepted.status === 'queued' && this.d.runs.busy(run.runId)) {
        await this.d.runs.interrupt(run.runId, true);
      }
      return accepted;
    }
    if (op.kind === 'set') await this.commandContext(taskId, run);
    if (op.kind === 'resume' || op.kind === 'set') { this.stoppedByUser.delete(taskId); this.paused.delete(taskId); this.d.runs.hold(taskId, false); }
    await this.d.runs.goal(run.runId, op);
    return { ok: true };
  }

  /** 按接受顺序派发下一条排队输入；必要时先打开或恢复运行。 */
  private async pump(taskId: string) {
    const browserContinuation=this.hasBrowserContinuation(taskId);
    if (this.paused.has(taskId)&&!browserContinuation || this.finishingTurns.has(taskId) || this.dispatching.has(taskId) || this.switching.has(taskId)) return;
    const queued=this.d.store.queuedTurns(taskId);
    const goalPending = this.goalPending.get(taskId);
    const urgentClear = goalPending?.kind === 'clear' && this.d.runs.runForTask(taskId)?.driverId === 'antigravity-acp'
      ? queued.find(turn => turn.turn_id === goalPending.turnId) : undefined;
    const next = browserContinuation ? queued.find(turn => turn.source_kind === 'system' && turn.client_input_id.startsWith('browser-login-'))
      : urgentClear ?? queued[0];
    if(!next&&browserContinuation){
      if(this.d.runs.closingForTask(taskId)||this.d.runs.respondingForTask(taskId))return;
      this.dispatching.add(taskId);
      try{
        const run=await this.ensureRun(taskId);
        if(this.hasBrowserContinuation(taskId))await this.business?.bindPending(taskId,run);
      }catch(error){
        this.d.store.addHostItem(taskId,null,'system_notice',{code:'browserLoginBindPending',detail:(error as Error).message.slice(0,500)});
      }finally{
        this.dispatching.delete(taskId);
        if(this.missedPump.delete(taskId))this.kick(taskId);
      }
      return;
    }
    if (!next) return;
    const existing = this.d.runs.runForTask(taskId);
    if (existing && this.d.runs.busy(existing.runId)) return;
    this.dispatching.add(taskId);
    const seq = this.stopSeq.get(taskId) ?? 0;
    const stoppedSince = () => (this.stopSeq.get(taskId) ?? 0) !== seq || this.paused.has(taskId)&&!browserContinuation;
    let transfer: Transfer | null = null;
    try {
      if (existing?.tierChange) await existing.tierChange;
      let { selection } = this.selection(taskId);
      if (this.coordination && !await this.coordination.beforeDispatch(taskId)) return;
      if (stoppedSince()) return;
      if (next.source_kind === 'user') {
        this.preparingTurns.set(taskId, next.turn_id);
        this.d.store.tx(emit => emit(taskId, 'turn.preparing', { turnId: next.turn_id }));
      }
      selection = this.selection(taskId).selection;
      // 空闲时改档或原生未确认切换时，按新权限恢复原会话。
      if (existing && existing.driverId === 'claude-sdk' && existing.appliedTier !== selection.tier) await this.d.runs.close(existing.runId);
      if (stoppedSince()) return;
      const run = await this.ensureRun(taskId);
      await this.business?.bindPending(taskId,run);
      this.gateTier(run, selection.tier as Tier);
      // 异步打开期间用户按了停止：输入保留在排队，不派发（复核 CR03）。
      if (stoppedSince()) return;
      const frozen = JSON.parse(next.input_ref) as { text: string; attachments?: Attachment[]; goal?: QueuedGoal };
      if (frozen.goal) {
        if (run.bindingId !== frozen.goal.bindingId) throw new DriverError('REJECTED', '目标所属会话已变化，请重新设置目标');
        if (!this.d.runs.goalAvailable(run.runId)) throw new DriverError('UNSUPPORTED', '执行器没有公布目标命令');
        if (!this.goalPending.has(taskId)) this.trackGoal(taskId, next.turn_id, frozen.goal);
        if (run.driverId === 'antigravity-acp' && frozen.goal.kind === 'clear' && this.d.store.goal(taskId)?.status === 'complete') {
          this.d.store.upsertGoal({ taskId, bindingId: run.bindingId, objective: null, status: 'cleared' });
          this.d.store.endTurn(next.turn_id, 'canceled');
          this.missedPump.add(taskId);
          return;
        }
      }
      const selectedModel = selection.model ?? run.defaultModel;
      const modelSettings = this.d.profileModelSettings?.(selection.profileId);
      const providerOptions = modelSettings?.options ?? [];
      const native = run.nativeSelection;
      const matchesNativeSelection = !!selection.effort
        && (!selection.initialCodexDefault || run.defaultModel === selectedModel)
        && native?.model === selectedModel && native?.effort === selection.effort;
      let models = run.models;
      const readsNativeEffort = run.driverId === 'codex-app-server' || (run.driverId === 'claude-sdk' && !modelSettings?.providerBacked);
      if (readsNativeEffort && selection.effort && !models && !matchesNativeSelection && !providerOptions.some(item => item.id === selectedModel)) {
        models = await this.d.runs.resolveModelCatalog(run.runId, selectedModel, selection.effort);
        if (stoppedSince()) return;
      }
      if (selection.initialCodexDefault && !matchesNativeSelection && !offersCodexLoginDefault(models)) {
        const current = this.selection(taskId);
        if (current.selection.initialCodexDefault) this.d.store.updateSelection(taskId, {
          model: undefined, effort: undefined, initialCodexDefault: undefined,
        }, current.revision);
        selection = { ...selection, model: undefined, effort: undefined, initialCodexDefault: undefined };
        this.d.store.addHostItem(taskId, next.turn_id, 'system_notice', { severity: 'warning', code: 'modelDefaultFallback', title: '使用执行器默认', detail: CODEX_LOGIN_FALLBACK });
      }
      let model = selection.model ?? run.defaultModel;
      // Codex 的模型覆盖会延续：恢复的线程可能带着旧覆盖，本运行也可能发过显式模型；默认选择下先查执行器默认，
      // 查不到就拒绝，不靠省略字段“恢复默认”（复核 FR03、SR03）。
      if (!model && run.driverId === 'codex-app-server') model = await this.d.runs.resolveDefaultModel(run.runId);
      if (!model && run.driverId === 'codex-app-server' && (run.sentModel || run.resumed)) throw new DriverError('UNSUPPORTED', '无法确定执行器默认模型，请在模型菜单里明确选择一个模型');
      // 派发前最后核对停止：上面每个异步前置（打开、默认模型查询）期间都可能按了停止（复核 SR01）。
      if (stoppedSince()) return;
      const { omittedImages, ...input } = this.agentInput(frozen.text, frozen.attachments ?? [], run, model);
      models ??= run.models;
      const nativeModel = findAgentModel(models, model);
      const providerModel = providerOptions.find(m => m.id === model);
      const isCodex = run.driverId === 'codex-app-server';
      const modelInfo = !isCodex && modelSettings?.providerBacked
        ? providerModel
        : nativeModel?.efforts.length ? nativeModel : providerModel ?? nativeModel;
      const preferred = selection.modelEfforts
        ? selection.modelEfforts[modelEffortKey(selection.profileId, model)]
        : selection.effort;
      const confirmedNativeEffort = !modelInfo?.efforts.length && model === selectedModel &&
        matchesNativeSelection && preferred === selection.effort && preferred !== 'none';
      const acp = run.driverId === 'antigravity-acp';
      const effort = acp || confirmedNativeEffort ? preferred : resolveModelEffort(modelInfo, preferred, isCodex);
      if (!acp && preferred && effort !== preferred) this.d.store.addHostItem(taskId, next.turn_id, 'system_notice', { code: 'settingSkipped', detail: `未应用推理强度 ${preferred}：执行器未公布该模型的此选项。` });
      // Native goal commands need their own prompt. Leave any handoff available to the next ordinary turn.
      const includeContext = !(acp && frozen.goal);
      const hostContext = includeContext
        ? [this.coordination?.dispatchContext?.(taskId), run.hostBusinessInstructionsInstalled ? undefined : run.hostBusinessInstructions].filter(Boolean).join('\n\n')
        : '';
      const remaining = INPUT_TEXT_LIMIT - Buffer.byteLength(input.text) - (hostContext ? Buffer.byteLength(hostContext) + 2 : 0);
      if (includeContext) transfer = this.handoffs.prepare(taskId, run.bindingId, next.turn_id, remaining);
      const context = [transfer?.text, hostContext].filter(Boolean).join('\n\n');
      if (!run.readOnly) await this.diffs?.before(taskId, next.turn_id, run.runId, this.d.runs.nativeBusy(run.runId));
      if(stoppedSince())return;
      const dispatched=await this.d.runs.dispatch(run.runId, next.turn_id, { clientInputId: next.client_input_id, ...input, goal: frozen.goal, context: context || undefined, tier: selection.tier as Tier, model, effort },
        browserContinuation?async()=>!stoppedSince()&&!!await this.business?.authorizeLoginDispatch(taskId,next.client_input_id,run)&&!stoppedSince():undefined);
      if(dispatched===null){
        if(transfer)this.handoffs.delivered(transfer.id,'unsent');
        return;
      }
      const savedTier = this.selection(taskId, true).selection.tier as Tier;
      if (!stoppedSince() && savedTier !== selection.tier) void this.d.runs.changeTurnTier(run.runId, savedTier);
      if (selection.initialCodexDefault) {
        const current = this.selection(taskId);
        if (current.selection.initialCodexDefault) this.d.store.updateSelection(taskId, { initialCodexDefault: undefined }, current.revision);
      }
      this.reportOmittedImages(taskId, next.turn_id, omittedImages);
      if(this.d.store.turn(next.turn_id)?.source_kind==='user')this.humanSent(next.turn_id,run,frozen.text);
      if (transfer) this.handoffs.delivered(transfer.id, 'accepted');
      if (stoppedSince()) await this.d.runs.interrupt(run.runId).catch(() => {});
    } catch (e) {
      if (transfer) this.handoffs.delivered(transfer.id, e instanceof DriverError && ['REJECTED', 'STATE', 'UNSUPPORTED'].includes(e.code) ? 'unsent' : 'unknown');
      if (stoppedSince()) return;
      const t = this.d.store.turn(next.turn_id);
      if(browserContinuation&&t?.status==='accepted'&&e instanceof DriverError&&e.code==='REJECTED'){
        this.d.store.endTurn(next.turn_id,'canceled','BROWSER_LOGIN_REVOKED');
        this.d.store.addHostItem(taskId,next.turn_id,'system_notice',{code:'browserLoginBlocked',detail:e.message});
        this.missedPump.add(taskId);
        return;
      }
      // 驱动在发送前拒绝且已放回排队（原生仍在跑）：等该回合结束后由 turn.ended 再派发，不算失败。
      if (e instanceof DriverError && e.code === 'STATE' && t?.status === 'accepted' && this.d.runs.runForTask(taskId)) return;
      // 上一运行已不可用、仍在等真实退出：输入保留但暂停，明确告知原因；退出后自动恢复派发（复核 NR04）。
      if (e instanceof DriverError && e.code === 'STATE' && t?.status === 'accepted' && this.d.runs.closingForTask(taskId)) {
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
      if (this.preparingTurns.delete(taskId) && this.d.store.turn(next.turn_id)?.status === 'accepted') {
        this.d.store.tx(emit => emit(taskId, 'turn.queued', { turnId: next.turn_id }));
      }
      this.dispatching.delete(taskId);
      if (this.missedPump.delete(taskId)) queueMicrotask(() => void this.advance(taskId));
    }
  }

  async stop(taskId: string, subtree = false, expectedRunId?: string) {
    const selected = this.selection(taskId);
    const run = this.d.runs.runForTask(taskId);
    const prewarming = this.prewarmingRuns.has(taskId);
    if (expectedRunId !== undefined && run?.runId !== expectedRunId) {
      throw new DriverError('STATE', '所属运行已结束或变化，请重新打开原生子 Agent');
    }
    this.paused.add(taskId);
    this.stoppedByUser.add(taskId);
    this.stopSeq.set(taskId, (this.stopSeq.get(taskId) ?? 0) + 1);
    if (selected.selection.pendingSwitch) this.d.store.updateSelection(taskId, { pendingSwitch: undefined }, selected.revision);
    this.d.runs.hold(taskId, true);
    this.business?.stop(taskId);
    const interrupt = async () => {
      if (prewarming) { await this.cancelPrewarm(taskId); return; }
      if (!run) return;
      // Codex：停止键＝停止本轮并暂停目标（需求 R02）。
      if (run.driverId === 'codex-app-server' && this.d.store.goal(taskId)?.status === 'active') { try { await this.d.runs.goal(run.runId, { kind: 'pause' }); } catch { /* 目标接口失败不阻止停止 */ } }
      if (this.d.runs.runForTask(taskId)?.runId !== run.runId) return;
      // 请求挂起时按停止：先退役本回合的原生请求，再中断（技术方案 §9）。
      for (const r of this.d.store.pendingRequests(taskId)) if (r.class === 'native' && r.origin.runId === run.runId) this.d.store.retireRequest(r.requestId, 'user-stop');
      await this.d.runs.interrupt(run.runId,true);
    };
    await Promise.all([interrupt(), this.coordination?.userStopped(taskId, subtree)]);
    return { stopped: prewarming || !!run || this.dispatching.has(taskId) };
  }

  forceStop(taskId: string, runId: string, requestedAt: number) {
    this.selection(taskId);
    return this.d.runs.forceStop(taskId,runId,requestedAt);
  }

  private userInput(taskId: string, turnId: string, state: 'accepted' | 'failed') {
    this.selection(taskId);
    const row = this.d.store.inputForTurn(turnId);
    if (row?.task_id !== taskId || row.source_kind !== 'user' || row.status !== state ||
      (state === 'failed' && (row.native_turn_id || row.started_at || (row.run_id && row.error_code !== 'REJECTED')))) {
      throw new DriverError('STATE', '没有可操作的排队输入或已确认未发送的消息');
    }
    return row;
  }

  readUserInput(taskId: string, turnId: string, offset: number, version: string | null) {
    const row = this.userInput(taskId, turnId, version === null ? 'failed' : 'accepted');
    if (version !== null && sha256(row.input_ref) !== version) throw new DriverError('STATE', '排队输入已变化，请重新读取');
    const input = JSON.parse(row.input_ref) as { text: string; attachments?: Attachment[] };
    // A frozen project image can be restored to a composer using only its already-saved copy.
    const attachments = input.attachments?.map(a => a.image && a.storedPath ? { ...a, kind: 'file' as const } : a) ?? [];
    return rangeOf(JSON.stringify({text: input.text, attachments}), offset);
  }

  editQueued(taskId: string, turnId: string, version: string, text: string) {
    const row = this.userInput(taskId, turnId, 'accepted');
    if (this.dispatching.has(taskId)) throw new DriverError('STATE', '正在派发，请稍后核对队列');
    const input = JSON.parse(row.input_ref);
    if (input.goal) throw new DriverError('REJECTED', '请取消这条目标命令，然后重新输入目标');
    if (typeof text !== 'string' || Buffer.byteLength(text) > INPUT_TEXT_LIMIT ||
        !text.trim() && !input.attachments?.length) throw new DriverError('REJECTED', '输入为空或超过 256 KB');
    this.d.store.editQueuedInput(taskId, turnId, version, text);
  }

  async sendQueued(taskId: string, turnId: string, version: string, expectedRevision: number, sender: import('../applications/execution-context').ApplicationUiSender) {
    const row = this.userInput(taskId, turnId, 'accepted');
    const { selection, revision } = this.selection(taskId);
    this.requireStableSelection(taskId);
    if (selection.pendingSwitch || revision !== expectedRevision || sha256(row.input_ref) !== version) {
      throw new DriverError('STATE', '输入、模型或档位已变化，请重新核对');
    }
    if (this.dispatching.has(taskId) || this.finishingTurns.has(taskId) || this.d.runs.stopProgress(taskId)
        || this.d.runs.closingForTask(taskId) || this.d.store.pendingRequests(taskId).length) {
      throw new DriverError('STATE', '任务正在收口或等待处理；输入仍在队列中');
    }
    const run = this.d.runs.runForTask(taskId);
    if (!run || !this.d.runs.busy(run.runId)) {
      if (this.d.store.queuedTurns(taskId)[0]?.turn_id !== turnId) throw new DriverError('STATE', '空闲时按原队列顺序发送');
      this.trustedInputs.set(turnId, sender);
      this.paused.delete(taskId);
      this.stoppedByUser.delete(taskId);
      this.coordination?.userContinued(taskId);
      this.d.runs.hold(taskId, this.coordination?.blocked(taskId) ?? false);
      this.kick(taskId);
      return { status: 'queued' as const };
    }
    if (JSON.parse(row.input_ref).goal) throw new DriverError('STATE', '目标命令会在当前回合结束后执行');
    if (!this.steerable(run) || this.paused.has(taskId) || this.coordination?.blocked(taskId)
        || run.appliedTier !== selection.tier || run.appliedModel !== (selection.model ?? run.defaultModel)
        || selection.effort && selection.effort !== run.appliedEffort) {
      throw new DriverError('STATE', '当前运行不能插话或选择已变化；输入仍在队列中');
    }
    run.assertCurrent?.();
    this.gateTier(run, selection.tier as Tier);
    const input = JSON.parse(row.input_ref) as { text: string; attachments?: Attachment[] };
    this.dispatching.add(taskId);
    this.queuedSteers.add(turnId);
    try {
      const { omittedImages, ...body } = this.agentInput(input.text, input.attachments ?? [], run, run.appliedModel ?? run.defaultModel);
      await this.d.runs.steer(run.runId, turnId, { clientInputId: row.client_input_id, ...body });
      this.reportOmittedImages(taskId, turnId, omittedImages);
      this.trustedInputs.set(turnId, sender);
      this.humanSent(turnId, run, input.text);
      return { status: 'steered' as const };
    } catch(error) {
      if (error instanceof DriverError && ['STATE','UNSUPPORTED','REJECTED'].includes(error.code)) throw error;
      this.trustedInputs.delete(turnId);
      this.d.store.endTurn(turnId, 'unknown', 'STEER_UNKNOWN');
      return { status: 'unknown' as const };
    } finally {
      this.queuedSteers.delete(turnId);
      this.dispatching.delete(taskId);
      if (this.missedPump.delete(taskId)) this.kick(taskId);
    }
  }

  retryFailedInput(taskId: string, turnId: string, expectedRevision: number, sender: import('../applications/execution-context').ApplicationUiSender) {
    const row = this.userInput(taskId, turnId, 'failed');
    const { revision } = this.selection(taskId);
    this.requireStableSelection(taskId);
    if (revision !== expectedRevision) throw new DriverError('REJECTED', '模型或权限已变化，请确认后再发送');
    const { text, attachments, goal } = JSON.parse(row.input_ref) as { text: string; attachments?: Attachment[]; goal?: QueuedGoal };
    if (goal && this.goalPending.has(taskId) && !this.d.store.turnByClientInput(taskId, 'retry-' + turnId)) {
      throw new DriverError('STATE', '已有目标操作等待执行器确认');
    }
    const accepted = this.d.store.acceptTurn({ taskId, clientInputId: 'retry-' + turnId, text, attachments, goal, sourceKind: 'user' });
    if (!accepted.duplicate) {
      if (goal) this.trackGoal(taskId, accepted.turn.turn_id, goal);
      this.trustedInputs.set(accepted.turn.turn_id, sender);
      this.paused.delete(taskId);
      this.stoppedByUser.delete(taskId);
      this.coordination?.userContinued(taskId);
      this.d.runs.hold(taskId, this.coordination?.blocked(taskId) ?? false);
      this.kick(taskId);
    }
    return { turnId: accepted.turn.turn_id };
  }

  cancelQueued(taskId: string, turnId: string) {
    this.selection(taskId);
    if (this.queuedSteers.has(turnId)) throw new DriverError('STATE', '正在请求插话，请稍后核对接收结果');
    const t = this.d.store.turn(turnId);
    if (!t || t.task_id !== taskId || t.status !== 'accepted') throw new DriverError('REJECTED', '该输入已发出或不存在');
    const input = this.d.store.queuedTurns(taskId).find(row => row.turn_id === turnId);
    this.trustedInputs.delete(turnId);this.d.store.endTurn(turnId, 'canceled', 'USER_CANCELED');
    if (input) this.discardAttachments?.(taskId, JSON.parse(input.input_ref));
  }

  /** 原生请求回应：宿主按当前运行确定作用域，旧代次由运行服务拒绝。 */
  async respond(taskId: string, requestId: string, revision: number, result: unknown,sender?:import('../applications/execution-context').ApplicationUiSender) {
    this.selection(taskId);
    const req = this.d.store.request(requestId);
    if (!req || req.task_id !== taskId) throw new DriverError('REJECTED', '请求不存在');
    if(req.class==='host_business'){if(!this.business)throw new DriverError('UNSUPPORTED','宿主业务请求尚未接入');return this.business.respond(taskId,requestId,revision,result,sender);}
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
    try { await this.d.runs.respond(requestId, scope, result); }
    finally { queueMicrotask(() => void this.advance(taskId)); }
  }

  taskBlockers(taskId: string, deleting = false, ownsRemoval = false) {
    const reasons: string[] = [];
    if (this.archiving.has(taskId) && deleting && !ownsRemoval) reasons.push('归档尚未结束');
    if (this.business?.busy(taskId)) reasons.push('业务请求尚未收口');
    if (this.d.store.pendingRequests(taskId).length) reasons.push('有待处理请求');
    if (this.coordination?.hasUnfinishedChildren(taskId) || this.coordination?.blocked(taskId)) reasons.push('委派或工作副本尚未收口');
    if (this.d.store.queuedTurns(taskId).length) reasons.push('仍有排队输入或结果通知');
    const run = this.d.runs.runForTask(taskId);
    if (this.dispatching.has(taskId) || this.switching.has(taskId) || this.finishingTurns.has(taskId) ||
        this.d.runs.closingForTask(taskId) || (run && (this.d.runs.busy(run.runId) || this.d.runs.nativeBusy(run.runId) || this.d.store.goal(taskId)?.status==='active'))) reasons.push('运行尚未收口，请先停止任务或等待完成');
    if (deleting && this.diffs?.capturing(taskId)) reasons.push('正在捕获差异快照');
    if (deleting && this.d.store.sqlite.prepare(
      "SELECT 1 FROM capability_runs WHERE task_id=? AND binding_id IS NOT NULL AND state IN ('preparing','prepared','active','stopping','orphaned') AND (? IS NULL OR run_id<>?)"
    ).get(taskId,run?.runId??null,run?.runId??null)) reasons.push('原生进程仍未核实收口');
    return reasons;
  }

  private async closeIdleRunForRemoval(taskId: string) {
    if (this.prewarmingRuns.has(taskId)) await this.cancelPrewarm(taskId);
    const run = this.d.runs.runForTask(taskId);
    if (!run) return;
    await this.d.runs.close(run.runId);
    if (!this.d.runs.closingForTask(taskId)) await this.coordination?.settleClosedRun(taskId, run.runId);
  }

  async withTaskRemoval(ids: string[], remove: () => void) {
    if (ids.some(id => this.archiving.has(id))) throw new DriverError('STATE','任务正在归档或删除');
    for (const id of ids) this.archiving.add(id);
    const endDiffRemoval = this.diffs?.beginTaskRemoval(ids);
    try {
      for (const id of ids) {
        const reasons = this.taskBlockers(id, true, true);
        if (reasons.length) throw new DriverError('STATE', `${this.d.store.task(id)?.title ?? id}：${reasons.join('、')}`);
        await this.closeIdleRunForRemoval(id);
        if (this.d.runs.runForTask(id) || this.d.runs.closingForTask(id)) throw new DriverError('STATE','任务运行尚未收口');
      }
      remove();
    } finally {
      endDiffRemoval?.();
      for (const id of ids) this.archiving.delete(id);
    }
  }

  async archive(taskId: string) {
    const { task } = this.selection(taskId, true);
    if (task.archived_at) return;
    const ids = this.d.store.taskFamily(taskId);
    const assertReady = () => {
      for (const id of ids) {
        const reasons = this.taskBlockers(id);
        if (reasons.length) throw new DriverError('STATE', `${this.d.store.task(id)?.title ?? id}：${reasons.join('、')}`);
      }
    };
    if (ids.some(id => this.archiving.has(id))) throw new DriverError('STATE', '任务正在归档');
    assertReady();
    for (const id of ids) this.archiving.add(id);
    try {
      for (const id of ids) await this.closeIdleRunForRemoval(id);
      assertReady();
      this.d.store.setTasksArchived(ids, true);
    } finally {
      for (const id of ids) this.archiving.delete(id);
    }
  }

  rename(taskId: string, name: string) {
    this.assertWritable(taskId);
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 120 || /[\x00-\x1f\x7f]/.test(name)) {
      throw new DriverError('REJECTED', '任务名称须为 1–120 个字符');
    }
    this.d.store.renameTask(taskId, name.trim());
  }

  setPinned(taskId: string, pinned: boolean) {
    const { task } = this.selection(taskId);
    if (!task.project_id || typeof pinned !== 'boolean') throw new DriverError('REJECTED', '无法更改此任务的置顶状态');
    this.d.store.setTaskPinned(taskId, pinned);
  }

  unarchive(taskId: string) {
    if (this.archiving.has(taskId)) throw new DriverError('STATE','任务正在删除或归档');
    const { task } = this.selection(taskId, true);
    if (!task.archived_at) return;
    const row = this.d.store.sqlite.prepare('SELECT parent_task_id FROM agent_tasks WHERE task_id=?').get(taskId) as { parent_task_id: string | null };
    const anchor = row.parent_task_id && this.d.store.task(row.parent_task_id)?.archived_at ? row.parent_task_id : taskId;
    const family = this.d.store.taskFamily(anchor);
    if (family.some(id=>this.archiving.has(id))) throw new DriverError('STATE','任务正在删除或归档');
    this.d.store.setTasksArchived(family, false);
  }

  listArchived() {
    const rows = this.d.store.listTasks(true);
    const archived = new Set(rows.filter(row => row.archived_at).map(row => row.id));
    return rows.filter(row => row.archived_at && (!row.parent_task_id || !archived.has(row.parent_task_id))).map(row => {
      const project = row.project_id ? this.d.store.sqlite.prepare('SELECT name,archived_at FROM projects WHERE id=?').get(row.project_id) as {name:string;archived_at:number|null}|undefined : undefined;
      return { taskId: row.id, parentTaskId: row.parent_task_id, projectId: row.project_id, projectName: project?.name ?? null, projectArchived: project?.archived_at != null, title: row.title, driverId: (JSON.parse(row.selection_json) as AgentSelection).driverId, archivedAt: row.archived_at };
    });
  }

  status(taskId: string): TaskStatus {
    const pending = this.d.store.pendingRequests(taskId).some(r => r.status === 'pending');
    if (pending) return 'waiting';
    const native = this.d.runs.runForTask(taskId); if (native && this.d.runs.nativeBusy(native.runId)) return 'working';
    const turns = this.d.store.turns(taskId);
    if (this.coordination?.hasUnfinishedChildren(taskId) && !this.paused.has(taskId)) return 'working';
    if (this.stoppedByUser.has(taskId) && !turns.some(t => ['dispatching','started'].includes(t.status))) return 'stopped';
    if (turns.some(t => ['accepted', 'dispatching', 'started'].includes(t.status))) return this.paused.has(taskId) && !turns.some(t => ['dispatching', 'started'].includes(t.status)) ? 'stopped' : 'working';
    if (this.coordination?.needsAttention?.(taskId)) return 'needs_attention';
    const last = turns.filter(t => t.status !== 'canceled').at(-1);
    if (!last) return 'idle';
    if ((last.status === 'failed' || last.status === 'completed') && this.d.store.items(taskId, { limit: 200 }).some(i => i.turnId === last.turn_id && i.type === 'error' && i.payload?.limited)) return 'limited';
    return last.status === 'completed' ? 'completed' : last.status === 'interrupted' ? 'stopped' : last.status === 'failed' || last.status === 'unknown' ? 'failed' : 'idle';
  }

  list() {
    return this.d.store.listTasks().map(t => {
      const status = this.status(t.id);
      return { taskId: t.id, parentTaskId: t.parent_task_id, projectId: t.project_id, dirId: t.dir_id, cwd: t.cwd, title: t.title,
        selection: JSON.parse(t.selection_json) as AgentSelection, createdAt: t.created_at, updatedAt: t.updated_at,
        pinnedAt: t.pinned_at, status, goalRunning: status === 'working' && this.d.store.goal(t.id)?.status === 'active',
        stopping: !!this.d.runs.stopProgress(t.id) };
    });
  }
  /** Parent item fixes run/node identity. The renderer cannot provide a foreign native thread ID. */
  nativeHistory(taskId: string, itemId: string, beforeOrdinal = Number.MAX_SAFE_INTEGER) {
    this.selection(taskId, true);
    if (!Number.isSafeInteger(beforeOrdinal) || beforeOrdinal < 1) throw new DriverError('REJECTED', '消息分页游标无效');
    const parent = this.d.store.sqlite.prepare("SELECT run_id,terminal_state FROM agent_items WHERE task_id=? AND item_id=? AND type='subagent'").get(taskId, itemId) as { run_id: string | null; terminal_state: string | null } | undefined;
    if (!parent) throw new DriverError('REJECTED', '原生子节点不属于本任务');
    const ownerRunId = this.d.runs.runForTask(taskId)?.runId === parent.run_id ? parent.run_id : null;
    const body = this.d.store.readItemBody(taskId, itemId); const payload = body ? JSON.parse(body.text) : {};
    const ids = Array.isArray(payload.nativeNodeIds) ? payload.nativeNodeIds.filter((x: unknown) => typeof x === 'string' && x.length <= 256).slice(0, 128) : [];
    if (!ids.length) return { items: [], hasMore: false, total: 0, nextOrdinal: null as number | null, states: [] as string[], partial: true, stopRunId: parent.terminal_state ? null : ownerRunId };
    const params = ids.map(() => '?').join(',');
    const rows = this.d.store.sqlite.prepare(`SELECT * FROM agent_items WHERE task_id=? AND run_id=? AND node_id IN (${params}) AND type='subagent_message' AND ordinal<? ORDER BY ordinal DESC LIMIT 51`).all(taskId, parent.run_id, ...ids, beforeOrdinal) as { item_id: string; turn_id: string | null; node_id: string; type: string; ordinal: number; revision: number; payload_ref: string; terminal_state: string | null; created_at: string; updated_at: string }[];
    const total = (this.d.store.sqlite.prepare(`SELECT COUNT(*) AS n FROM agent_items WHERE task_id=? AND run_id=? AND node_id IN (${params}) AND type='subagent_message'`).get(taskId, parent.run_id, ...ids) as { n: number }).n;
    const states = (this.d.store.sqlite.prepare(`SELECT payload_ref FROM agent_items WHERE task_id=? AND run_id=? AND node_id IN (${params}) AND type='subagent_status'`).all(taskId, parent.run_id, ...ids) as { payload_ref: string }[]).map(r => String(JSON.parse(r.payload_ref).state));
    const items = rows.slice(0, 50).reverse().map(r => ({
      itemId: r.item_id, turnId: r.turn_id, nodeId: r.node_id, type: r.type,
      ordinal: r.ordinal, revision: r.revision, terminal: r.terminal_state,
      createdAt: r.created_at, updatedAt: r.updated_at, payload: nativeHistoryPayload(r.payload_ref),
    }));
    const stoppable = states.some(state => state === 'running' || state === 'needs_attention') || (!states.length && !parent.terminal_state);
    return { items, hasMore: rows.length > 50, total, nextOrdinal: (items[0]?.ordinal ?? null) as number | null, states, partial: !items.length && !!payload.childLog?.length, stopRunId: stoppable ? ownerRunId : null };
  }

  commandPreview(taskId: string, runId: string, itemKey: string) {
    const run = this.d.runs.active(runId);
    return run?.taskId === taskId ? run.instance.commandPreview?.(itemKey) ?? null : null;
  }

  /** 一致快照与已提交水位；订阅方先订阅再读快照，随后补拉 (seq, …]（技术方案 §3.1）。 */
  snapshot(taskId: string) {
    const { task, selection, revision } = this.selection(taskId, true);
    const run = this.switching.has(taskId) ? undefined : this.d.runs.runForTask(taskId);
    const draft = this.d.store.draft(taskId);
    const pending = this.d.store.pendingRequests(taskId, true);
    const preparingTurnId = this.paused.has(taskId) ? null : this.preparingTurns.get(taskId) ?? null;
    const queuedAll = this.d.store.queuedTurns(taskId).filter(row => row.turn_id !== preparingTurnId);
    const allTurns = this.d.store.turnsWithNativeWait(taskId);
    const goal = this.d.store.goal(taskId);
    const pendingGoal = this.goalPending.get(taskId);
    const catalog = run ? this.d.runs.active(run.runId)?.catalog ?? null : null;
    const backgroundWork = run?.driverId === 'claude-sdk'
      ? this.d.store.activeBackgroundItems(taskId, run.runId).map(item => previewItem(item, 2048)) : [];
    // 整份响应按最终 UTF-8 字节守 256 KiB（技术方案 §3.1，复核 FR02／SR04）。基础字段按档逐级收紧，
    // 每档都保留全部待处理请求的可访问路径（预览或只含标识的摘要，全文经 requestBody 读取）；剩余预算装最近条目。
    for (let level = 0; level <= 3; level++) {
      const base = {
        taskId, title: task.title, cwd: task.cwd, projectId: task.project_id, parentTaskId: task.parent_task_id, archivedAt: task.archived_at, selection, selectionRevision: revision,
        switching: this.switching.has(taskId),
        stopping: this.d.runs.stopProgress(taskId),
        draft: draftForSnapshot(draft, level),
        ...requestsForSnapshot(pending, level),
        queued: queuedAll.slice(0, [10, 10, 5, 3][level]).map(q => queuedPreview(q, [1000, 1000, 400, 200][level])),
        queuedTotal: queuedAll.length, preparingTurnId,
        ...(backgroundWork.length ? { backgroundWork } : {}),
        run: run ? { runId: run.runId, generation: run.generation, driverId: run.driverId, tier: run.turnTier ?? run.appliedTier ?? run.tier, tierChanging: !!run.tierChange, defaultModel: run.defaultModel, models: run.models?.slice(0, [60,60,30,5][level]), busy: this.d.runs.busy(run.runId), steer: !this.d.runs.stopProgress(taskId) && this.steerable(run), goal: this.d.runs.goalAvailable(run.runId), catalog: catalogForSnapshot(catalog, level) } : null,
        goal: goal ? boundGoal(goal) : goal, goalPending: pendingGoal ? { ...pendingGoal, queued: this.d.store.turn(pendingGoal.turnId)?.status === 'accepted' } : null, goalUnknown: this.goalUnknown.get(taskId) ?? null,
        status: this.status(taskId), seq: this.d.store.watermark(taskId),
      };
      const recentTurns = allTurns.slice(-[20, 20, 10, 3][level]);
      const budget = RESPONSE_LIMIT - 4 * 1024 - jsonBytes(base) - jsonBytes(recentTurns);
      if (budget < 0 && level < 3) continue;
      const out = { ...base, ...this.itemsPage(taskId, Math.max(0, budget), allTurns, recentTurns) };
      for (;;) {
        const projected = { ...out, historyCursor: historyCursor(taskId, out.items[0]?.ordinal ?? Number.MAX_SAFE_INTEGER, out.hasOlder) };
        if (jsonBytes(projected) <= RESPONSE_LIMIT) return projected;
        if (!out.items.length) break;
        out.items.shift();
        out.hasOlder = true;
      }
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
    return { items: out, turns, hasOlder: out.length ? !!this.d.store.sqlite.prepare("SELECT 1 FROM agent_items WHERE task_id=? AND ordinal<? AND type NOT IN ('subagent_message','subagent_status') LIMIT 1").get(taskId,out[0].ordinal) : all.length > 0 };
  }
  planForSaving(taskId: string, itemId: string, revision: number) {
    const { task } = this.selection(taskId);
    if (!task.project_id) throw new DriverError('REJECTED', '当前任务没有项目');
    const item = this.d.store.itemById(taskId, itemId);
    if (item?.type !== 'proposed_plan') throw new DriverError('REJECTED', '任务的计划不存在');
    if (item.revision !== revision) throw new DriverError('STATE', '计划已更新，请重新保存');
    const complete = this.d.store.readItemBody(taskId, itemId);
    if (!complete || complete.revision !== revision) throw new DriverError('STATE', '计划已更新，请重新保存');
    const payload = JSON.parse(complete.text) as { truncated?: boolean; storedTruncated?: boolean; plan?: unknown };
    if (payload.truncated || payload.storedTruncated || typeof payload.plan !== 'string' || !payload.plan.trim()) {
      throw new DriverError('REJECTED', '没有可保存的完整计划');
    }
    return { projectId: task.project_id, text: payload.plan };
  }

  /** 正文范围读取（复核 NR06）：截断预览的条目与过大的请求按 128 KiB 分段读取完整内容。 */
  itemBody(taskId: string, itemId: string, offset: number, revision?: number) {
    this.selection(taskId, true);
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
  history(taskId: string, cursor: number | string) {
    this.selection(taskId, true);
    const beforeOrdinal = historyOrdinal(taskId, cursor);
    const page = this.itemsPage(taskId, RESPONSE_LIMIT - 8 * 1024, this.d.store.turnsWithNativeWait(taskId), [], beforeOrdinal);
    for (;;) {
      const projected = { ...page, historyCursor: historyCursor(taskId, page.items[0]?.ordinal, page.hasOlder) };
      if (jsonBytes(projected) <= RESPONSE_LIMIT) return projected;
      if (!page.items.length) throw new DriverError('PROTOCOL', '历史页超过容量上限');
      page.items.shift();
      page.hasOlder = true;
    }
  }
  historyItems(taskId: string, itemIds: string[]) {
    this.selection(taskId, true);
    if (!Array.isArray(itemIds) || itemIds.length > 8 || itemIds.some(id => typeof id !== 'string' || !id.length || id.length > 128)) {
      throw new DriverError('REJECTED', '历史条目查询超出范围');
    }
    return this.d.store.historyItems(taskId, itemIds).map(previewItem);
  }
  draftBody(taskId: string, offset: number, revision?: number) {
    this.selection(taskId, true);
    const d = this.d.store.draft(taskId);
    if (d && 'damaged' in d) throw new DriverError('REJECTED', '草稿已受损，无法读取');
    if (revision !== undefined && revision !== (d?.revision ?? 0)) throw new DriverError('STATE', '草稿已更新，请重新读取');
    return { ...rangeOf(JSON.stringify(d?.draft ?? null), offset), revision: d?.revision ?? 0 };
  }

  /** 事件页按字节守 256 KiB，单个事件超过 32 KiB 只给信封（复核 FR02）。 */
  events(taskId: string, afterSeq: number, limit = 128, throughSeq = Number.MAX_SAFE_INTEGER): StoredEvent[] {
    if (!Number.isSafeInteger(afterSeq) || afterSeq < 0 || !Number.isSafeInteger(throughSeq) || throughSeq < afterSeq) {
      throw new DriverError('REJECTED', '事件序号范围无效');
    }
    const out: StoredEvent[] = []; let bytes = 2;
    for (const e of this.d.store.events(taskId, afterSeq, Math.min(limit, 128), throughSeq)) {
      const b = boundedEvent(e), size = jsonBytes(b) + 1;
      if (bytes + size > RESPONSE_LIMIT && out.length) break;
      bytes += size; out.push(b);
    }
    return out;
  }
}
