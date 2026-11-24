// M14 运行服务（技术方案 T1.5 §3）：打开／恢复绑定、登记真实运行身份、提交输入、转发原生请求与回应。
// 统一接口验证 task、binding、run、generation；客户端不得自报 PID、nativeId 或真人来源。
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { evaluateCapabilities, type CapabilityName, type CapabilityResult, type DriverId } from './capabilities';
import type { AgentDriver, DriverEvent, DriverExecutable, DriverInstance, DriverModel, DriverModelCache } from './driver';
import { DriverError } from './driver';
import { AgentStore, sha256 } from './agent-store';
import { resolveTier, type Tier } from './permissions';
import { TimelineProjector, type ItemUpsert } from './timeline';
import type { ProcessIdentityReader } from '../applications/process-identity';
import { canonicalPath } from './identity';
import { browserInstructions, type RunIntegration, type RunIntegrationContext } from './run-integration';

export interface HostIdentity { instanceId: string; pid: number; startedAt: string | null }
export interface OpenRunInput {
  taskId: string;
  modelCache?: DriverModelCache;
  hostBusinessInstructions?: string;
  driverId: DriverId;
  profileId: string;
  executable: DriverExecutable;
  cwd: string;
  env: Record<string, string>;
  /** 配置根（CLAUDE_CONFIG_DIR／CODEX_HOME 或用户原生根）；计入兼容身份。 */
  stateRoot: string;
  /** 影响原生会话兼容性的冻结输入（扩展开关、托管配置修订等）。 */
  compatibility: Record<string, unknown>;
  tier: Tier;
  model?: string;
  extraArgs?: readonly string[];
  settingSources?: readonly ('user' | 'project' | 'local')[];
  /** 启动探测得到的逐项能力（复核 CR15）；缺省按版本计算。冻结进运行，供命令、界面与驱动共同判定。 */
  capabilities?: Record<CapabilityName, CapabilityResult>;
  /** 配置档案的默认模型（托管供应商为档案默认，订阅登录为空＝执行器默认）；“恢复默认”用它，不用最初的显式选择（复核 NR05）。 */
  defaultModel?: string;
  modelsWithoutImageInput?: ReadonlySet<string>;
  assertCurrent?(): void;
  startCancelled?(): boolean;
  startupSignal?: AbortSignal;
  stopWhenWaiting?(): boolean;
  readOnly?: boolean;
  integrate?(context: RunIntegrationContext): Promise<RunIntegration | undefined>;
}
export interface RunHandle { runId: string; taskId: string; bindingId: string; generation: number; driverId: DriverId; tier: Tier; tierNotice?: string; version: string; capabilities: Record<CapabilityName, CapabilityResult>; model?: string; defaultModel?: string; models?: DriverModel[]; modelsWithoutImageInput?: ReadonlySet<string>; /** 线程上一次生效的档位（打开或最近一轮）。 */ appliedTier?: Tier; appliedModel?: string; appliedEffort?: string; /** 本运行已发过显式模型。 */ sentModel?: boolean; /** 恢复的原生会话（可能带着旧的模型覆盖）。 */ resumed?: boolean }
export type LiveListener = (e: { taskId: string; runId: string; event: DriverEvent }) => void;
type QueuedTurnInput={clientInputId:string;text:string;images?:{path:string;mime:string}[];tier?:Tier;model?:string;effort?:string;context?:string};
export interface RunHandle {
  hostBusinessInstructions?: string;
  hostBusinessInstructionsInstalled?: boolean;
  nativeSelection?: { model: string; effort: string };
}
interface ActiveRun extends RunHandle { assertCurrent?(): void; openError?: string; catalog?: { commands: string[]; skills: { name: string; description?: string }[] }; instance: DriverInstance; projector: TimelineProjector; turnId: string | null; closing: boolean; ended: Promise<void>; markEnded(): void }

const FORCE_STOP_DELAY_MS = 10_000;
interface ActiveRun { readonly readOnly: boolean; userStop?: { requestedAt: number; turnId: string | null }; integration?: RunIntegration; registration?: Promise<void>; exitFinishing?: Promise<void>; nodeReads?: Set<Promise<void>>; nativeNodes?: Set<string>; opening?: boolean; startingNativeWork?: number }
type NativeNotice = Extract<DriverEvent, { type: 'native' }>;
const LIFECYCLE_NOTICES = new Set([
  'hook/started', 'hook/completed', 'mcpServer/startupStatus/updated',
  'system/hook_started', 'system/hook_progress', 'system/hook_response',
]);
interface ActiveRun {
  turnTier?: Tier;
  tierChange?: Promise<void>;
  prewarmNativeId?: string;
  pendingNotices?: NativeNotice[];
  mcpFailures?: Map<string, ItemUpsert>;
  firstNativeTurnStarted?: boolean;
  claudeHookTurns?: Map<string, string | null>;
  modelCatalog?: Promise<DriverModel[] | undefined>;
  firstModelCatalog?: Promise<DriverModel[] | undefined>;
}
export class AgentRunService {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly previousRecovery = new Map<string, Promise<void>>();
  private readonly live = new Set<LiveListener>();
  /** 正在由宿主回应的请求：期间原生侧的结束通知不当作“原生自行结束”。 */
  private readonly responding = new Set<string>();
  /** 用户已停止：迟到的原生自行开始回合（目标续跑）立即中断（复核 CR03）。 */
  private readonly held = new Set<string>();
  hold(taskId: string, on: boolean) { if (on) this.held.add(taskId); else this.held.delete(taskId); }
  constructor(private readonly deps: { store: AgentStore; drivers: ReadonlyMap<DriverId, AgentDriver>; processes: ProcessIdentityReader; host: HostIdentity }) {}

  /** 流式增量等短期事件只推给在线订阅者，不写历史（历史正文与短期事件分开保留）。 */
  onLive(listener: LiveListener) { this.live.add(listener); return () => { this.live.delete(listener); }; }

  active(runId: string) { return this.runs.get(runId); }

  async open(input: OpenRunInput): Promise<RunHandle>;
  async open(input: OpenRunInput, mode: 'resume-only'): Promise<RunHandle | undefined>;
  async open(input: OpenRunInput, mode?: 'resume-only'): Promise<RunHandle | undefined> {
    const { store } = this.deps;
    const task = store.task(input.taskId);
    if (!task) throw new DriverError('REJECTED', '任务不存在或不是新任务');
    if (task.archived_at) throw new DriverError('REJECTED', '任务已归档');
    const driver = this.deps.drivers.get(input.driverId);
    if (!driver) throw new DriverError('UNSUPPORTED', `未登记的执行器：${input.driverId}`);
    const tier = resolveTier(input.driverId, input.tier);
    if (!tier.ok) throw new DriverError('REJECTED', `不支持的权限档位：${String(input.tier)}`);
    // 正在关闭但尚未观察到退出的运行仍占用该任务（复核 CR04）。
    for (const r of this.runs.values()) if (r.taskId === input.taskId) throw new DriverError('STATE', r.closing ? '上一运行仍在退出，请稍后' : '该任务已有运行中的执行器');

    const cwdIdentity = canonicalPath(input.cwd), stateIdentity = canonicalPath(input.stateRoot);
    const continuationHash = sha256(JSON.stringify({ driver: input.driverId, profile: input.profileId, stateRoot: stateIdentity, cwd: cwdIdentity, compatibility: input.compatibility, ...(input.readOnly ? { readOnly: true } : {}) }));
    const existing = store.findBinding(input.taskId, input.driverId, continuationHash);
    const capabilities = input.capabilities ?? evaluateCapabilities(input.driverId, input.executable.version).capabilities;
    const resumeNativeId = existing?.native_confirmed_at ? existing.native_id ?? undefined : undefined;
    if (mode === 'resume-only' && (!resumeNativeId || capabilities.resume.state !== 'enabled')) return;
    if (resumeNativeId && capabilities.resume.state !== 'enabled') throw new DriverError('UNSUPPORTED', '当前执行器不支持恢复原生会话');
    const bindingId = existing?.binding_id ?? store.createBinding({ task_id: input.taskId, driver_id: input.driverId, profile_id: input.profileId, continuation_hash: continuationHash, state_root: stateIdentity, cwd_identity: cwdIdentity });
    store.freezeBinding(bindingId, { compatibility: input.compatibility, stateRoot: stateIdentity, cwd: cwdIdentity });
    const generation = store.nextGeneration(bindingId);
    const runId = randomUUID();
    const launchPlanHash = sha256(JSON.stringify({ driver: input.driverId, executable: input.executable, cwd: input.cwd, tier: tier.tier, model: input.model ?? null, extraArgs: input.extraArgs ?? [], settingSources: input.settingSources ?? null, readOnly: input.readOnly === true, envNames: Object.keys(input.env).sort() }));
    store.insertRun({ runId, taskId: input.taskId, projectId: task.project_id, driverId: input.driverId, bindingId, generation, owner: this.deps.host, launchPlanHash });

    const instance = driver.create();
    let markEnded!: () => void;
    const ended = new Promise<void>(r => { markEnded = r; });
    const run: ActiveRun = { runId, taskId: input.taskId, bindingId, generation, driverId: input.driverId, tier: tier.tier, version: input.executable.version, capabilities, model: input.model, defaultModel: input.defaultModel, modelsWithoutImageInput: input.modelsWithoutImageInput, appliedTier: tier.tier, sentModel: !!(resumeNativeId && input.model && input.driverId === 'codex-app-server'), resumed: !!resumeNativeId, readOnly: input.readOnly === true, ...(tier.downgraded ? { tierNotice: tier.reason } : {}), instance, projector: new TimelineProjector(input.driverId), turnId: null, closing: false, ended, markEnded };
    this.runs.set(runId, run);
    run.opening = true;
    if (mode === 'resume-only') run.prewarmNativeId = resumeNativeId;
    run.assertCurrent = input.assertCurrent;
    instance.on(e => this.onDriverEvent(run, e));
    const startupCancelled = () => run.opening === true && (run.closing || input.startCancelled?.() === true);
    const assertStarting = () => {
      if (startupCancelled()) throw new DriverError('STATE', '启动已停止');
    };
    let forkAttempted = false;
    try {
      run.integration = await input.integrate?.({ runId, bindingId, generation, nativeId: resumeNativeId, startupCancelled });
      if (input.hostBusinessInstructions) {
        run.hostBusinessInstructions = input.hostBusinessInstructions + '\n' + browserInstructions(run.integration?.browserEntry, run.readOnly);
      }
      assertStarting();
      const extraArgs = [...(input.extraArgs ?? []), ...(run.integration?.extraArgs ?? [])];
      const env = { ...input.env, ...run.integration?.env };
      const finalLaunchHash = sha256(JSON.stringify({ initial: launchPlanHash, extraArgs, envNames: Object.keys(env).sort(), mcp: run.integration?.mcpServers, projectContextMcp: run.integration?.projectContextMcp, browserMcp: run.integration?.browserMcp, claudeMcp: run.integration?.claudeMcp, skills: run.integration?.skillRoots, plugins: run.integration?.plugins,hostBusinessCli:run.integration?.hostBusinessCli,claudeSettings:run.integration?.claudeSettings,codexCliPermissions:run.integration?.codexCliPermissions }));
      if (store.sqlite.prepare("UPDATE capability_runs SET launch_plan_hash=? WHERE run_id=? AND launch_plan_hash=? AND state IN ('preparing','prepared') AND pid IS NULL").run(finalLaunchHash, runId, launchPlanHash).changes !== 1) throw new DriverError('REJECTED', '启动计划已变化或已经启动');
      if (!run.integration?.attached) store.freezeNativeRun(runId, { version: input.executable.version, capabilities, launchPlanHash: finalLaunchHash });
      await run.integration?.beforeFork?.();
      assertStarting();
      forkAttempted = true;
      const opened = await instance.open({
        executable: input.executable, modelCache: input.modelCache, hostBusinessInstructions: run.hostBusinessInstructions,
        cwd: input.cwd, env, model: input.model, tier: tier.tier, resumeNativeId, extraArgs, settingSources: input.settingSources,
        mcpServers: run.integration?.mcpServers, projectContextMcp: run.integration?.projectContextMcp,
        browserMcp: run.integration?.browserMcp, claudeMcp: run.integration?.claudeMcp,
        skillRoots: capabilities.skills.state === 'enabled' ? run.integration?.skillRoots : undefined,
        plugins: run.integration?.plugins, hostBusinessCli: run.integration?.hostBusinessCli,
        claudeSettings: run.integration?.claudeSettings, codexCliPermissions: run.integration?.codexCliPermissions,
        stopWhenWaiting: input.stopWhenWaiting, recoverGoals: capabilities.goal.state === 'enabled', readOnly: input.readOnly,
        requiredMcpServers: Object.keys(run.integration?.mcpServers ?? {}), assertStarting, startupSignal: input.startupSignal,
        beforeThreadOpen: run.integration?.beforeThreadOpen,
        beforeInitialize: async () => { await run.registration; assertStarting(); },
      });
      await run.registration;
      assertStarting();
      if (run.closing || this.runs.get(runId) !== run) throw new DriverError('EXITED', '执行器在会话就绪前退出');
      if (mode === 'resume-only' && (!opened.confirmed || opened.nativeId !== resumeNativeId)) throw new DriverError('PROTOCOL', '预恢复未确认原会话');
      if (opened.confirmed) store.confirmNative(bindingId, opened.nativeId);
      run.opening = false;
      run.prewarmNativeId = undefined;
      const optional = [['mcp', 'MCP 业务通道'], ['resume', '原生会话恢复'], ['steer', '插话'], ['skills', 'Skill 目录'], ['approvalsReviewer', '审批审阅档位']] as const;
      const unavailable = optional.filter(([name]) => capabilities[name].reason === 'probe-unavailable').map(([, label]) => label);
      if (unavailable.length) store.addHostItem(input.taskId, null, 'system_notice', { severity: 'warning', code: 'optionalProtocolUnavailable', title: `当前执行器不支持${unavailable.join('、')}`, detail: '基本对话仍可使用。' });
      if (opened.browserMcpReady === false) {
        if (input.hostBusinessInstructions) {
          run.hostBusinessInstructions = input.hostBusinessInstructions + '\n' + browserInstructions(undefined, run.readOnly);
        }
        store.addHostItem(input.taskId, null, 'system_notice', {
          severity: 'warning', code: 'browserMcpUnavailable', title: '内置浏览器工具尚未就绪', detail: 'Claude Code 启动时未确认浏览器 MCP 工具。基本对话仍可使用。',
        });
      }
      if (opened.projectContextMcpReady === false) {
        store.addHostItem(input.taskId, null, 'system_notice', {
          severity: 'warning', code: 'projectContextMcpUnavailable', title: '项目上下文 MCP 不可用',
          detail: '启动时未确认项目上下文工具。可使用已启用的数据库和 SSH 诊断 Skill。',
        });
      }
      // 档案没有指定默认模型时，用执行器报告的原生默认（复核 FR03）。
      if (!run.defaultModel && opened.defaultModel) run.defaultModel = opened.defaultModel;
      run.nativeSelection = opened.nativeSelection;
      run.hostBusinessInstructionsInstalled = opened.hostBusinessInstructionsInstalled;
      store.tx(emit => emit(run.taskId, 'run.session_ready', { runId, bindingId, resumed: !!resumeNativeId, background: mode === 'resume-only',
        ...(opened.browserMcpReady !== undefined ? { browserMcp: opened.browserMcpReady ? 'ready' : 'unavailable' } : {}),
        ...(input.hostBusinessInstructions ? { businessContext: opened.hostBusinessInstructionsInstalled ? 'developer' : 'history' } : {}) }));
      if (instance.modelCatalog) {
        const catalogStarted = performance.now();
        let publishFirst!: (models: DriverModel[] | undefined) => void;
        run.firstModelCatalog = new Promise(resolve => { publishFirst = resolve; });
        run.modelCatalog = instance.modelCatalog(publishFirst).then(models => {
          if (this.runs.get(runId) !== run || run.closing) return undefined;
          run.models = models.slice(0, 200).map(model => ({
            id: model.id.slice(0, 256), name: model.name.slice(0, 160),
            efforts: model.efforts.slice(0, 12).map(effort => effort.slice(0, 24)),
            defaultEffort: model.defaultEffort?.slice(0, 24),
            ...(model.isDefault ? { isDefault: true } : {}),
          }));
          store.tx(emit => emit(run.taskId, 'run.models', { runId, elapsedMs: Math.round(performance.now() - catalogStarted) }));
          return run.models;
        }).catch(() => undefined);
        void run.modelCatalog.then(publishFirst);
      }
    } catch (e) {
      // 已启动原生进程时，取消和打开失败都按真实退出收口（复核 NR02）。
      run.closing = true;
      const cancelled = input.startCancelled?.() === true;
      run.openError = cancelled ? undefined : !forkAttempted ? 'OPEN_FAILED_UNFORKED' : e instanceof DriverError ? e.code : 'OPEN_FAILED';
      await instance.close().catch(() => {});
      if (run.exitFinishing) await run.exitFinishing.catch(() => {});
      if (!store.run(runId)?.pid) {
        await run.integration?.cancelBeforeFork?.().catch(() => {});
        run.integration?.projectRuntime?.release();
      }
      if (this.runs.has(runId)) {
        if (!store.run(runId)?.pid) { store.finishRun(runId, input.taskId, cancelled ? 'stopped' : 'failed', run.openError ?? null); this.runs.delete(runId); run.markEnded(); }
        else store.markRunStopping(runId, input.taskId);
      }
      throw e;
    }
    return { runId, taskId: input.taskId, bindingId, generation, driverId: input.driverId, tier: tier.tier, version: input.executable.version, capabilities, model: input.model, defaultModel: run.defaultModel, ...(run.tierNotice ? { tierNotice: run.tierNotice } : {}) };
  }

  private writeNotice(run: ActiveRun, item: ItemUpsert, turnId: string | null) {
    this.deps.store.upsertItem({
      taskId: run.taskId, runId: run.runId, turnId,
      nativeKey: `${run.bindingId}:${run.generation}:${item.key}`,
      type: item.type, payload: item.payload, terminalState: item.terminal ?? null,
    });
  }

  private projectLifecycleNotice(run: ActiveRun, event: NativeNotice, discardUnresolved = false) {
    const { store } = this.deps;
    const payload = event.payload as {threadId?: string; turnId?: string; session_id?: string; parent_tool_use_id?: string} | null;
    const codex = run.driverId === 'codex-app-server';
    const binding = store.binding(run.bindingId);
    const reportedId = codex ? payload?.threadId : payload?.session_id;
    const confirmedId = binding?.native_confirmed_at ? binding.native_id : null;
    if (payload?.parent_tool_use_id || reportedId && confirmedId && reportedId !== confirmedId) return true;
    if (reportedId && !confirmedId && !discardUnresolved) return false;
    const owned = !!confirmedId && reportedId === confirmedId;
    const nativeTurn = codex && owned && payload?.turnId ? store.turnByNative(run.runId, payload.turnId) : undefined;
    if (codex && owned && payload?.turnId && !nativeTurn && !discardUnresolved) return false;

    for (const item of run.projector.project(event)) {
      if (item.payload.code === 'mcpStartup') {
        this.writeNotice(run, { ...item, payload: { ...item.payload, diagnosticOnly: true } }, null);
        if (!owned || (payload?.turnId && !nativeTurn)) continue;
        if (nativeTurn || run.firstNativeTurnStarted) {
          if (item.payload.status === 'failed') {
            const turnId = nativeTurn?.turn_id ?? null;
            this.writeNotice(run, { ...item, key: `${item.key}:warning:${turnId ?? 'session'}` }, turnId);
          }
          continue;
        }
        const failures = run.mcpFailures ??= new Map();
        if (item.payload.status === 'failed') {
          if (failures.size < 200 || failures.has(item.key)) failures.set(item.key, item);
        } else failures.delete(item.key);
        this.publishMcpFailures(run);
      } else {
        let turnId = nativeTurn?.turn_id ?? null;
        if (!codex && owned) {
          const origins = run.claudeHookTurns ??= new Map();
          if (origins.size < 200 && !origins.has(item.key)) origins.set(item.key, run.turnId);
          turnId = origins.get(item.key) ?? null;
          if (item.terminal) origins.delete(item.key);
        }
        const scoped = turnId || (!codex && owned);
        this.writeNotice(run, scoped ? item : { ...item, payload: { ...item.payload, diagnosticOnly: true } }, turnId);
      }
    }
    return true;
  }

  private publishMcpFailures(run: ActiveRun) {
    if (!run.mcpFailures?.size || !run.turnId || !this.deps.store.turn(run.turnId)?.native_turn_id) return;
    for (const item of run.mcpFailures.values()) {
      this.writeNotice(run, { ...item, key: `${item.key}:warning:${run.turnId}` }, run.turnId);
    }
    run.mcpFailures.clear();
  }

  private flushLifecycleNotices(run: ActiveRun, discardUnresolved = false) {
    run.pendingNotices = run.pendingNotices?.filter(event => !this.projectLifecycleNotice(run, event, discardUnresolved));
    if (!discardUnresolved) this.publishMcpFailures(run);
  }

  private onDriverEvent(run: ActiveRun, e: DriverEvent) {
    const { store } = this.deps;
    for (const l of [...this.live]) { try { l({ taskId: run.taskId, runId: run.runId, event: e }); } catch { /* 订阅者自身负责 */ } }
    try {
      if (e.type === 'native' && LIFECYCLE_NOTICES.has(e.name)) {
        if (!this.projectLifecycleNotice(run, e)) {
          const pending = run.pendingNotices ??= [];
          if (pending.length >= 200) this.projectLifecycleNotice(run, pending.shift()!, true);
          pending.push(e);
        }
        return;
      }
      // Partial Claude blocks belong only to the turn that dispatched the query.
      if (run.driverId === 'claude-sdk' && !run.turnId && e.type === 'native' && e.name === 'stream_event') return;
      for (const item of run.projector.project(e)) {
        store.upsertItem({ taskId: run.taskId, turnId: run.turnId, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:${item.key}`, type: item.type, payload: item.payload, terminalState: item.terminal ?? null });
        if (item.type === 'subagent' && item.payload.nativeNodeIds && run.instance.nativeChildHistory) for (const nodeId of item.payload.nativeNodeIds as string[]) this.captureNode(run, nodeId);
      }
      switch (e.type) {
        case 'process': {
          // PID 来自本宿主自己启动的 ChildProcess；出生身份由进程身份读取器核对（取不到时只记 PID）。
          const identity = this.deps.processes.read(e.pid);
          store.attachRunProcess(run.runId, run.taskId, e.pid, identity?.pid === e.pid ? identity.startedAt : null);
          if (run.integration?.attached) {
            run.registration = run.integration.attached(e.pid);
            void run.registration.catch(error => {
              run.openError = 'IDENTITY_REGISTRATION_FAILED';
              if (run.opening && run.prewarmNativeId) return; // The speculative open owns its cleanup.
              store.addHostItem(run.taskId, run.turnId, 'error', { message: `业务运行身份登记失败：${(error as Error).message}` });
              void this.close(run.runId);
            });
          }
          break;
        }
        case 'model_cache':
          store.tx(emit => emit(run.taskId, 'run.model_cache_checked', { runId: run.runId, result: e.result, elapsedMs: e.elapsedMs }));
          break;
        case 'session':
          if (run.prewarmNativeId && e.nativeId !== run.prewarmNativeId) break;
          store.confirmNative(run.bindingId, e.nativeId);
          this.flushLifecycleNotices(run);
          break;
        case 'turn.started':
          if (run.turnId) store.startTurn(run.turnId, e.nativeTurnId);
          else if (!e.clientInputId) {
            run.turnId = store.acceptAutoTurn(run.taskId, run.runId, e.nativeTurnId);
            if (this.held.has(run.taskId)) void run.instance.interrupt().catch(() => {});
          }
          if (store.goal(run.taskId)?.status === 'active') store.countGoalTurn(run.taskId);
          this.flushLifecycleNotices(run);
          run.firstNativeTurnStarted = true;
          break;
        case 'catalog': run.catalog = { commands: e.commands.slice(0, 200), skills: e.skills.slice(0, 500) }; break;
        case 'goal': {
          const before = store.goal(run.taskId);
          const heldActive = this.held.has(run.taskId) && e.status === 'active' && run.driverId === 'codex-app-server';
          if (heldActive) void run.instance.goal?.({ kind: 'pause' }).catch(() => {});
          // Codex replays the current paused goal when resuming the thread. Keep the host's
          // waiting reason only when the binding and native goal version are unchanged.
          const sameWaitingPause = run.driverId === 'codex-app-server' && e.status === 'paused'
            && before?.status === 'paused' && before.pausedReason === 'waiting_children'
            && before.bindingId === run.bindingId && before.objective === e.objective
            && Number.isFinite(e.nativeCreatedAt) && e.nativeCreatedAt === before.nativeCreatedAt
            && Number.isFinite(e.nativeUpdatedAt) && e.nativeUpdatedAt === before.nativeUpdatedAt;
          const pausedReason = sameWaitingPause ? 'waiting_children' : heldActive ? before?.pausedReason ?? 'user' : undefined;
          store.upsertGoal({ taskId: run.taskId, bindingId: run.bindingId, objective: e.objective, status: heldActive ? 'paused' : e.status, pausedReason, timeUsedSeconds: e.timeUsedSeconds, nativeCreatedAt: e.nativeCreatedAt, nativeUpdatedAt: e.nativeUpdatedAt });
          // 目标在回合进行中设定：这一轮计入目标轮次（宿主计数）。
          const after = store.goal(run.taskId);
          if (after?.status === 'active' && run.turnId && (!before || before.status !== 'active' || before.revision !== after.revision)) store.countGoalTurn(run.taskId);
          break;
        }
        case 'request':
          store.insertNativeRequest({ taskId: run.taskId, kind: e.kind, payload: e.payload, origin: { taskId: run.taskId, bindingId: run.bindingId, runId: run.runId, generation: run.generation, turnId: e.nodeId ? null : run.turnId, nativeRequest: e.requestKey, nodeId: e.nodeId } });
          break;
        case 'node.message': store.upsertItem({ taskId: run.taskId, turnId: run.turnId, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:node:${e.nodeId}:${e.key}`, nodeId: e.nodeId, type: 'subagent_message', payload: e.payload, terminalState: 'completed' }); break;
        case 'node.state': {
          if (e.state === 'running') (run.nativeNodes ??= new Set()).add(e.nodeId); else run.nativeNodes?.delete(e.nodeId);
          if (run.userStop && !run.userStop.turnId && !run.nativeNodes?.size) run.userStop = undefined;
          store.upsertItem({ taskId: run.taskId, turnId: null, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:node-state:${e.nodeId}`, nodeId: e.nodeId, type: 'subagent_status', payload: { state: e.state, nativeRunId: e.nativeRunId }, terminalState: e.state === 'running' ? null : e.state === 'completed' ? 'completed' : 'failed' }); break;
        }
        case 'request.resolved': {
          const row = store.requestByNative(run.runId, e.requestKey);
          // 原生侧自行结束的请求（超时、回合结束等）不算用户回应。
          if (row?.status === 'pending' && !this.responding.has(row.request_id)) store.retireRequest(row.request_id, 'native-resolved');
          break;
        }
        case 'turn.completed': {
          // Claude 不回报目标用时：按目标进行期间的回合用时累计（Codex 由 thread/goal/updated 提供）。
          if (run.driverId === 'claude-sdk' && store.goal(run.taskId)?.status === 'active' && run.turnId) {
            const t = store.turn(run.turnId) as { started_at?: string | null } | undefined;
            if (t?.started_at) store.addGoalTime(run.taskId, (Date.now() - Date.parse(t.started_at)) / 1000);
          }
          const turns = store.turnsByNative(run.runId, e.nativeTurnId);
          const own = run.turnId ? store.turn(run.turnId) : undefined;
          if (own && !turns.some(t => t.turn_id === own.turn_id) && !own.native_turn_id) turns.push(own);
          for (const turn of turns) store.endTurn(turn.turn_id, e.status, e.error ? e.error.slice(0, 200) : null);
          if (run.turnId && turns.some(t => t.turn_id === run.turnId)) {
            run.turnId = null;
            run.turnTier = undefined;
            if (run.userStop?.turnId) {
              // Claude's foreground interrupt and SDK stopTask are separate operations.
              if (run.nativeNodes?.size && run.driverId !== 'claude-sdk') run.userStop.turnId = null;
              else run.userStop = undefined;
            }
          }
          break;
        }
        case 'unusable':
          // 不可再用的运行退役（复核 NR04）：不再接受派发，关闭进程；观察到退出后释放，下次提交恢复会话。
          if (!run.closing) {
            run.closing = true;
            store.addHostItem(run.taskId, run.turnId, 'system_notice', { severity: 'warning', code: 'runUnusable', detail: `${e.reason}，会话将在下次发送时恢复` });
            void run.instance.close().then(() => { if (this.runs.has(run.runId)) store.markRunStopping(run.runId, run.taskId); }).catch(() => {});
          }
          break;
        case 'exit': {
          const closing = run.closing; run.closing = true;
          this.flushLifecycleNotices(run, true);
          const finish = () => { for (const nodeId of run.nativeNodes ?? []) store.upsertItem({ taskId: run.taskId, turnId: null, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:node-state:${nodeId}`, nodeId, type: 'subagent_status', payload: { state: 'interrupted', reason: 'owner-exited' }, terminalState: 'failed' }); run.nativeNodes?.clear(); store.finishRun(run.runId, run.taskId, run.openError ? 'failed' : closing ? 'stopped' : 'failed', run.openError ?? (closing ? null : `EXIT_${e.code ?? e.signal}`)); this.runs.delete(run.runId); run.markEnded(); };
          const integration = run.integration;
          if (!integration?.exited && !integration?.projectRuntime) finish();
          else if (!run.exitFinishing) {
            run.exitFinishing = Promise.resolve(run.registration).catch(() => {}).then(async () => {
              // Hosts without process-group inspection can retire a standalone session
              // after the native exit event, while leaving its files for verified cleanup.
              if (!integration.exited && process.platform !== 'darwin') { finish(); return; }
              if (!await this.drainNativeGroup(run.runId)) throw new Error('原生进程组退出不明');
              await integration.exited?.();
              integration.projectRuntime?.release();
              finish();
            });
            void run.exitFinishing.catch(error => {
              store.markRunStopping(run.runId, run.taskId);
              store.addHostItem(run.taskId, run.turnId, 'error', { message: `进程已退出，业务或后代尚未排空，保留占用：${(error as Error).message}` });
            });
          }
          break;
        }
      }
    } catch (err) {
      for (const l of [...this.live]) { try { l({ taskId: run.taskId, runId: run.runId, event: { type: 'diagnostic', message: `持久化失败：${(err as Error).message}` } }); } catch { /* ignore */ } }
    }
  }

  /** 提交输入：先持久接受（幂等），再派发；原生开始信号到达后才确认开始。 */
  async submit(runId: string, input: { clientInputId: string; text: string; tier?: Tier; model?: string; sourceKind?: 'user' | 'delegation' | 'notification' | 'system' }) {
    const run = this.runs.get(runId);
    if (!run || run.closing) throw new DriverError('STATE', '运行不存在或正在关闭');
    const { store } = this.deps;
    const accepted = store.acceptTurn({ taskId: run.taskId, clientInputId: input.clientInputId, text: input.text, sourceKind: input.sourceKind ?? 'user' });
    if (accepted.duplicate) return { turnId: accepted.turn.turn_id, duplicate: true as const, status: accepted.turn.status };
    if (run.turnId) { store.endTurn(accepted.turn.turn_id, 'canceled', 'BUSY'); throw new DriverError('STATE', '上一轮尚未结束；排队与插话在阶段 2 接入'); }
    const turnId = accepted.turn.turn_id;
    const { nativeTurnId } = await this.dispatch(runId, turnId, input);
    return { turnId, duplicate: false as const, status: 'started', nativeTurnId };
  }

  /** 派发一条已接受（排队中）的输入；原生开始信号到达后才确认开始。 */
  async dispatch(runId:string,turnId:string,input:QueuedTurnInput):Promise<{nativeTurnId:string}>;
  async dispatch(runId:string,turnId:string,input:QueuedTurnInput,beforeNative:(()=>Promise<boolean>)|undefined):Promise<{nativeTurnId:string}|null>;
  async dispatch(runId:string,turnId:string,input:QueuedTurnInput,beforeNative?:()=>Promise<boolean>) {
    const run = this.runs.get(runId);
    if (!run || run.closing) throw new DriverError('STATE', '运行不存在或正在关闭');
    if (run.turnId) throw new DriverError('STATE', '上一轮尚未结束');
    const { store } = this.deps;
    this.assertIdleRunCurrent(run);
    if (input.context) await this.injectHistory(runId, input.context);
    if (this.runs.get(runId) !== run || run.closing || this.held.has(run.taskId)) throw new DriverError('STATE', '已停止或会话已退出，输入保留在排队');
    if (input.context) this.assertIdleRunCurrent(run);
    if(beforeNative){
      if(!await beforeNative())return null;
      if(this.runs.get(runId)!==run||run.closing||run.turnId||this.held.has(run.taskId)||store.turn(turnId)?.status!=='accepted')
        throw new DriverError('STATE','接续确认后原运行状态已变化');
      this.assertIdleRunCurrent(run);
    }
    const tier = input.tier ? resolveTier(run.driverId, input.tier) : { ok: true as const, tier: run.tier };
    if (!tier.ok) { store.endTurn(turnId, 'canceled', 'TIER'); throw new DriverError('REJECTED', '不支持的权限档位'); }
    store.dispatchTurn(turnId, runId);
    run.turnId = turnId;
    run.turnTier = tier.tier;
    try {
      const { nativeTurnId } = await run.instance.startTurn({ clientInputId: input.clientInputId, text: input.text, images: input.images, tier: tier.tier, model: input.model, effort: input.effort });
      run.appliedTier = tier.tier; run.appliedModel = input.model; run.appliedEffort = input.effort; if (input.model) run.sentModel = true;
      store.startTurn(turnId, nativeTurnId);
      return { nativeTurnId };
    } catch (e) {
      if (run.turnId === turnId) {
        run.turnId = null;
        run.turnTier = undefined;
      }
      // STATE：驱动在写出前拒绝（如原生仍有回合在跑），输入未发出，放回排队；REJECTED：协议明确拒绝记失败；其余记未知。
      if (e instanceof DriverError && e.code === 'STATE') store.requeueTurn(turnId);
      else store.endTurn(turnId, e instanceof DriverError && e.code === 'REJECTED' ? 'failed' : 'unknown', e instanceof DriverError ? e.code : 'START_FAILED');
      throw e;
    }
  }

  /** Serialize native acknowledgements so rapid picks cannot leave the engine on an older choice. */
  changeTurnTier(runId: string, tier: Tier) {
    const run = this.runs.get(runId);
    const turnId = run?.turnId;
    if (!run || !turnId || run.readOnly || run.userStop || !run.instance.setTurnTier) return;
    const previous = run.tierChange;
    const apply = async () => {
      await previous;
      if (this.runs.get(runId) !== run || run.closing || run.userStop || run.turnId !== turnId) return;
      const current = run.turnTier ?? run.appliedTier ?? run.tier;
      if (current === tier || !await run.instance.setTurnTier!(current, tier)) return;
      if (run.turnId === turnId) run.turnTier = tier;
      // Claude updates the SDK session. Codex's reviewer update is scoped to one turn.
      if (run.driverId === 'claude-sdk') run.appliedTier = tier;
    };
    const change = apply().catch(() => {
      // A refused or unsupported update leaves the saved choice for the next dispatch.
    }).finally(() => {
      if (run.tierChange === change) {
        run.tierChange = undefined;
        if (this.runs.get(runId) === run && !run.closing) {
          this.deps.store.tx(emit => emit(run.taskId, 'run.permission_updated', { runId }));
        }
      }
    });
    run.tierChange = change;
    return change;
  }

  private assertIdleRunCurrent(run: ActiveRun) {
    try { run.assertCurrent?.(); }
    catch (error) {
      if (!this.busy(run.runId)) void this.close(run.runId).catch(() => {});
      throw error;
    }
  }

  /** 插话：只在执行器支持且有进行中的回合时可用；否则抛错由调用方改为排队。 */
  async steer(runId: string, turnId: string, input: { clientInputId: string; text: string; images?: { path: string; mime: string }[] }) {
    const run = this.runs.get(runId);
    if (!run || run.closing || !run.turnId) throw new DriverError('STATE', '当前没有进行中的回合');
    if (run.userStop) throw new DriverError('STATE', '正在停止本轮，不能插话');
    if (!run.instance.steer) throw new DriverError('UNSUPPORTED', '该执行器不支持插话');
    const current = this.deps.store.turn(run.turnId);
    if (!current?.native_turn_id) throw new DriverError('STATE', '回合尚未开始');
    await run.instance.steer({ clientInputId: input.clientInputId, text: input.text, images: input.images, tier: run.turnTier ?? run.appliedTier ?? run.tier });
    this.deps.store.attachSteer(turnId, runId, current.native_turn_id);
    // A native completion may arrive before the steer acknowledgement.
    const finished = this.deps.store.turn(current.turn_id)?.status;
    if (finished === 'completed' || finished === 'failed' || finished === 'interrupted' || finished === 'unknown') {
      this.deps.store.endTurn(turnId, finished);
    }
  }
  async command(runId: string, name: 'compact' | 'review') {
    const run = this.runs.get(runId);
    if (!run) throw new DriverError('STATE', '运行不存在');
    if (!run.instance.command) throw new DriverError('UNSUPPORTED', '该执行器不支持此命令');
    await this.startNativeWork(run, () => run.instance.command!(name));
  }
  async injectHistory(runId: string, text: string) {
    const run = this.runs.get(runId);
    if (!run || run.closing || run.turnId) throw new DriverError('STATE', '历史交接需要空闲会话');
    if (!run.instance.injectHistory) throw new DriverError('UNSUPPORTED', '该执行器未公布历史追加接口，无法安全交接');
    this.assertIdleRunCurrent(run);
    const started = performance.now();
    await run.instance.injectHistory(text);
    this.deps.store.tx(emit => emit(run.taskId, 'run.history_injected', { runId, elapsedMs: Math.round(performance.now() - started) }));
  }
  async goal(runId: string, op: Parameters<NonNullable<DriverInstance['goal']>>[0]) {
    const run = this.runs.get(runId);
    if (!run) throw new DriverError('STATE', '运行不存在');
    if (!run.instance.goal) throw new DriverError('UNSUPPORTED', '该执行器不支持目标');
    if (op.kind === 'set' || op.kind === 'resume') await this.startNativeWork(run, () => run.instance.goal!(op));
    else await run.instance.goal(op);
  }

  private async startNativeWork(run: ActiveRun, start: () => Promise<void>) {
    run.startingNativeWork = (run.startingNativeWork ?? 0) + 1;
    try { await start(); } finally { run.startingNativeWork--; }
  }

  busy(runId: string) { const r = this.runs.get(runId); return !!r?.turnId; }
  nativeBusy(runId: string) { return !!this.runs.get(runId)?.nativeNodes?.size; }
  async readGoal(runId: string) { return this.runs.get(runId)?.instance.goalState?.(); }
  respondingForTask(taskId: string) { return [...this.responding].some(id => this.deps.store.request(id)?.task_id === taskId); }
  /** 运行的默认模型：档案或打开时得到的优先，否则向执行器查询并缓存（复核 FR03）。 */
  async resolveDefaultModel(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return undefined;
    if (!run.defaultModel && run.instance.defaultModel) run.defaultModel = await run.instance.defaultModel();
    return run.defaultModel;
  }
  async resolveModelCatalog(runId: string, model: string | undefined, effort: string) {
    const run = this.runs.get(runId);
    if (run?.models) return run.models;
    const first = await run?.firstModelCatalog;
    if (first?.some(item => item.id === model && item.efforts.includes(effort))) return first;
    return run?.modelCatalog;
  }
  runForTask(taskId: string) { for (const r of this.runs.values()) if (r.taskId === taskId && !r.closing) return r; return undefined; }
  closingForTask(taskId: string) { for (const r of this.runs.values()) if (r.taskId === taskId && r.closing) return r; return undefined; }

  /** 原生阻塞请求的回应：按发起来源核对运行与代次，旧代次回应拒绝（技术方案 §8.1）。 */
  async respond(requestId: string, scope: { taskId: string; runId: string; generation: number; revision: number }, result: unknown) {
    const { store } = this.deps;
    const row = store.request(requestId);
    if (!row || row.task_id !== scope.taskId) throw new DriverError('REJECTED', '请求不存在');
    if (row.class !== 'native') throw new DriverError('REJECTED', '宿主业务请求由业务服务裁定（阶段 5）');
    if (row.status !== 'pending') throw new DriverError('REJECTED', '请求已结束');
    if (row.revision !== scope.revision) throw new DriverError('REJECTED', '请求已更新，请按最新内容处理');
    const origin = JSON.parse(row.origin_json) as { runId: string; generation: number; nativeRequest: string };
    if (origin.runId !== scope.runId || origin.generation !== scope.generation) throw new DriverError('REJECTED', '请求属于已结束的运行');
    const run = this.runs.get(origin.runId);
    if (!run || run.generation !== origin.generation) { store.retireRequest(requestId, 'run-gone'); throw new DriverError('REJECTED', '请求属于已结束的运行'); }
    this.responding.add(requestId);
    try {
      await run.instance.respond(origin.nativeRequest, result);
      store.resolveRequest(requestId, result);
    } finally { this.responding.delete(requestId); }
  }

  async interrupt(runId: string, showProgress = false) {
    const run = this.runs.get(runId);
    if (!run) throw new DriverError('STATE', '运行不存在');
    if (showProgress && (run.turnId || run.nativeNodes?.size)) {
      if (run.userStop) return;
      run.userStop = { requestedAt: Date.now(), turnId: run.turnId };
      this.deps.store.tx(emit => emit(run.taskId, 'run.interrupt_requested', { runId }));
    }
    try { await run.instance.interrupt(); }
    catch (error) {
      if (showProgress && run.userStop && !run.closing) {
        run.userStop = undefined;
        this.deps.store.tx(emit => emit(run.taskId, 'run.interrupt_failed', { runId }));
      }
      throw error;
    }
  }

  stopProgress(taskId: string) {
    const run=this.runForTask(taskId)??this.closingForTask(taskId);
    return run?.userStop ? { runId:run.runId, requestedAt:run.userStop.requestedAt,
      forceAt:run.userStop.requestedAt+FORCE_STOP_DELAY_MS, closing:run.closing } : null;
  }

  async forceStop(taskId: string, runId: string, requestedAt: number) {
    const stop=this.stopProgress(taskId);
    if (!stop || stop.runId!==runId || stop.requestedAt!==requestedAt || stop.closing || Date.now()<stop.forceAt) {
      throw new DriverError('STATE', '正在停止的运行已变化，或仍在等待原生响应');
    }
    await this.close(runId);
  }

  async close(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    if (!run.closing) this.deps.store.tx(emit => emit(run.taskId, 'run.close_requested', { runId }));
    run.closing = true;
    if(run.userStop)this.deps.store.tx(emit=>emit(run.taskId,'run.force_stopping',{runId}));
    await Promise.allSettled([...(run.nodeReads ?? [])]);
    await run.instance.close();
    if (run.exitFinishing) await run.exitFinishing.catch(() => {});
    // 只有观察到真实退出（exit 事件）才收口；仍未退出则保留占用并标 stopping，不冒充已退出（复核 CR04）。
    if (this.runs.has(runId)) this.deps.store.markRunStopping(runId, run.taskId);
  }

  async closeAll() { await Promise.all([...this.runs.keys()].map(id => this.close(id))); }

  async waitForPreviousRecoveries() { await Promise.allSettled(this.previousRecovery.values()); }

  async recoverPreviousNativeNodes(signal: AbortSignal, reconcileRun: (runId: string) => Promise<boolean> = async () => true, taskId?: string) {
    const { store, processes, host } = this.deps;
    const inspectGroup = processes.ownedGroup?.bind(processes);
    if (!inspectGroup || signal.aborted) return;
    const alreadyRecovering = taskId === undefined ? undefined : this.previousRecovery.get(taskId);
    if (alreadyRecovering) return alreadyRecovering;
    const candidates = store.runsAwaitingRestartRecovery(host.instanceId, taskId);
    const groups = new Map<string, typeof candidates>();
    for (const run of candidates) {
      const group = groups.get(run.taskId);
      if (group) group.push(run);
      else groups.set(run.taskId, [run]);
    }
    const work: Promise<void>[] = [];
    for (const [taskId, candidates] of groups) {
      const existing = this.previousRecovery.get(taskId);
      if (existing) { work.push(existing); continue; }
      const recovering = (async () => {
        const deadline = Date.now() + 10_000;
        let pending = candidates;
        for (let wait = 0; pending.length && !signal.aborted && Date.now() < deadline; wait = 250) {
          await delay(wait, undefined, { signal }).catch(error => { if (!signal.aborted) throw error; });
          const unfinished = [];
          for (const run of pending) {
            if (signal.aborted) return;
            if (inspectGroup({ pid: run.pid, startedAt: run.startedAt })?.state !== 'stopped') {
              unfinished.push(run);
              continue;
            }
            store.interruptRecoveredNativeNodes(run.runId);
            if (!await reconcileRun(run.runId).catch(() => false)) unfinished.push(run);
          }
          pending = unfinished;
        }
      })().finally(() => this.previousRecovery.delete(taskId));
      this.previousRecovery.set(taskId, recovering);
      work.push(recovering);
    }
    await Promise.all(work);
  }

  private captureNode(run: ActiveRun, nodeId: string) {
    const read = run.instance.nativeChildHistory!(nodeId).then(items => { for (const i of items) this.deps.store.upsertItem({ taskId: run.taskId, turnId: null, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:node:${nodeId}:history:${i.key}`, nodeId, type: 'subagent_message', payload: i.payload, terminalState: 'completed' }); }).catch(() => { /* missing native messages remain explicit; never invent content */ });
    (run.nodeReads ??= new Set()).add(read); void read.finally(() => run.nodeReads?.delete(read));
  }
  /** Exact detached launch group only. Unknown proof retains ownership; never release on a timer. */
  async drainNativeGroup(runId: string): Promise<boolean> {
    const row = this.deps.store.run(runId);
    if (row && row.pid === null && row.error_code === 'OPEN_FAILED_UNFORKED') return true;
    if (!row?.pid || !row.process_started_at || !this.deps.processes.ownedGroup) return false;
    const root = { pid: row.pid as number, startedAt: row.process_started_at as string };
    const deadline = Date.now() + 10_000;
    do {
      const group = this.deps.processes.ownedGroup(root); if (!group) return false;
      if (group.state === 'stopped') return true;
      for (const p of group.processes) if (p.pid !== root.pid && this.deps.processes.state(p) === 'running') { try { process.kill(p.pid, 'SIGTERM'); } catch { /* independently observe below */ } }
      if (Date.now() >= deadline) return false;
      await new Promise(r => setTimeout(r, 50));
    } while (true);
  }
}
