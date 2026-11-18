// M14 运行服务（技术方案 T1.5 §3）：打开／恢复绑定、登记真实运行身份、提交输入、转发原生请求与回应。
// 统一接口验证 task、binding、run、generation；客户端不得自报 PID、nativeId 或真人来源。
import { randomUUID } from 'node:crypto';
import { evaluateCapabilities, type CapabilityName, type CapabilityResult, type DriverId } from './capabilities';
import type { AgentDriver, DriverEvent, DriverExecutable, DriverInstance, DriverModel } from './driver';
import { DriverError } from './driver';
import { AgentStore, sha256 } from './agent-store';
import { resolveTier, type Tier } from './permissions';
import { TimelineProjector } from './timeline';
import type { ProcessIdentityReader } from '../applications/process-identity';
import { canonicalPath } from './identity';
import type { RunIntegration } from './run-integration';

export interface HostIdentity { instanceId: string; pid: number; startedAt: string | null }
export interface OpenRunInput {
  taskId: string;
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
  assertCurrent?(): void;
  stopWhenWaiting?(): boolean;
  readOnly?: boolean;
  integrate?(context: { runId: string; bindingId: string; generation: number; nativeId?: string }): Promise<RunIntegration | undefined>;
}
export interface RunHandle { runId: string; taskId: string; bindingId: string; generation: number; driverId: DriverId; tier: Tier; tierNotice?: string; version: string; capabilities: Record<CapabilityName, CapabilityResult>; model?: string; defaultModel?: string; models?: DriverModel[]; /** 线程上一次生效的档位（打开或最近一轮）。 */ appliedTier?: Tier; appliedModel?: string; appliedEffort?: string; /** 本运行已发过显式模型。 */ sentModel?: boolean; /** 恢复的原生会话（可能带着旧的模型覆盖）。 */ resumed?: boolean }
export type LiveListener = (e: { taskId: string; runId: string; event: DriverEvent }) => void;
interface ActiveRun extends RunHandle { assertCurrent?(): void; openError?: string; catalog?: { commands: string[]; skills: { name: string; description?: string }[] }; instance: DriverInstance; projector: TimelineProjector; turnId: string | null; closing: boolean; ended: Promise<void>; markEnded(): void }

const FORCE_STOP_DELAY_MS = 10_000;
interface ActiveRun { userStop?: { requestedAt: number; turnId: string | null }; integration?: RunIntegration; registration?: Promise<void>; exitFinishing?: Promise<void>; nodeReads?: Set<Promise<void>>; nativeNodes?: Set<string>; opening?: boolean; startingNativeWork?: number }
export class AgentRunService {
  private readonly runs = new Map<string, ActiveRun>();
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

  async open(input: OpenRunInput): Promise<RunHandle> {
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
    const bindingId = existing?.binding_id ?? store.createBinding({ task_id: input.taskId, driver_id: input.driverId, profile_id: input.profileId, continuation_hash: continuationHash, state_root: stateIdentity, cwd_identity: cwdIdentity });
    store.freezeBinding(bindingId, { compatibility: input.compatibility, stateRoot: stateIdentity, cwd: cwdIdentity });
    const resumeNativeId = existing?.native_confirmed_at ? existing.native_id ?? undefined : undefined;
    const generation = store.nextGeneration(bindingId);
    const runId = randomUUID();
    const launchPlanHash = sha256(JSON.stringify({ driver: input.driverId, executable: input.executable, cwd: input.cwd, tier: tier.tier, model: input.model ?? null, extraArgs: input.extraArgs ?? [], settingSources: input.settingSources ?? null, readOnly: input.readOnly === true, envNames: Object.keys(input.env).sort() }));
    store.insertRun({ runId, taskId: input.taskId, projectId: task.project_id, driverId: input.driverId, bindingId, generation, owner: this.deps.host, launchPlanHash });

    const instance = driver.create();
    let markEnded!: () => void;
    const ended = new Promise<void>(r => { markEnded = r; });
    const capabilities = input.capabilities ?? evaluateCapabilities(input.driverId, input.executable.version).capabilities;
    const run: ActiveRun = { runId, taskId: input.taskId, bindingId, generation, driverId: input.driverId, tier: tier.tier, version: input.executable.version, capabilities, model: input.model, defaultModel: input.defaultModel, appliedTier: tier.tier, sentModel: !!(resumeNativeId && input.model && input.driverId === 'codex-app-server'), resumed: !!resumeNativeId, ...(tier.downgraded ? { tierNotice: tier.reason } : {}), instance, projector: new TimelineProjector(input.driverId), turnId: null, closing: false, ended, markEnded };
    this.runs.set(runId, run);
    run.opening = true;
    run.assertCurrent = input.assertCurrent;
    instance.on(e => this.onDriverEvent(run, e));
    let forkAttempted = false;
    try {
      run.integration = await input.integrate?.({ runId, bindingId, generation, nativeId: resumeNativeId });
      const finalLaunchHash = sha256(JSON.stringify({ initial: launchPlanHash, extraArgs: [...(input.extraArgs ?? []), ...(run.integration?.extraArgs ?? [])], envNames: Object.keys({ ...input.env, ...run.integration?.env }).sort(), mcp: run.integration?.mcpServers, skills: run.integration?.skillRoots, plugins: run.integration?.plugins,hostBusinessCli:run.integration?.hostBusinessCli,claudeSettings:run.integration?.claudeSettings,codexCliPermissions:run.integration?.codexCliPermissions }));
      if (store.sqlite.prepare("UPDATE capability_runs SET launch_plan_hash=? WHERE run_id=? AND launch_plan_hash=? AND state IN ('preparing','prepared') AND pid IS NULL").run(finalLaunchHash, runId, launchPlanHash).changes !== 1) throw new DriverError('REJECTED', '启动计划已变化或已经启动');
      if (!run.integration) store.freezeNativeRun(runId, { version: input.executable.version, capabilities, launchPlanHash: finalLaunchHash });
      await run.integration?.beforeFork();
      forkAttempted = true;
      const opened = await instance.open({ executable: input.executable, cwd: input.cwd, env: { ...input.env, ...run.integration?.env }, model: input.model, tier: tier.tier, resumeNativeId, extraArgs: [...(input.extraArgs ?? []), ...(run.integration?.extraArgs ?? [])], settingSources: input.settingSources, mcpServers: run.integration?.mcpServers, skillRoots: run.integration?.skillRoots, plugins: run.integration?.plugins,hostBusinessCli:run.integration?.hostBusinessCli,claudeSettings:run.integration?.claudeSettings,codexCliPermissions:run.integration?.codexCliPermissions, stopWhenWaiting: input.stopWhenWaiting, recoverGoals: capabilities.goal.state === 'enabled', readOnly: input.readOnly, requiredMcpServers: Object.keys(run.integration?.mcpServers ?? {}), beforeInitialize: async () => { await run.registration; } });
      await run.registration;
      if (opened.confirmed) store.confirmNative(bindingId, opened.nativeId);
      run.opening = false;
      // 档案没有指定默认模型时，用执行器报告的原生默认（复核 FR03）。
      if (!run.defaultModel && opened.defaultModel) run.defaultModel = opened.defaultModel;
      if (instance.modelCatalog) void instance.modelCatalog().then(models => {
        if (this.runs.get(runId) !== run || run.closing) return;
        run.models = models.slice(0, 200).map(m => ({ id: m.id.slice(0, 256), name: m.name.slice(0, 160), efforts: m.efforts.slice(0, 12).map(x => x.slice(0, 24)), defaultEffort: m.defaultEffort }));
        store.tx(emit => emit(run.taskId, 'run.models', {}));
      }).catch(() => { /* 未公布的可选设置不应用，界面明确说明 */ });
    } catch (e) {
      // 打开失败也按真实退出收口（复核 NR02）：先关闭；观察到退出才记失败并释放，否则保留 stopping 占用。
      run.closing = true;
      run.openError = !forkAttempted ? 'OPEN_FAILED_UNFORKED' : e instanceof DriverError ? e.code : 'OPEN_FAILED';
      await instance.close().catch(() => {});
      if (!store.run(runId)?.pid) await run.integration?.cancelBeforeFork().catch(() => {});
      if (this.runs.has(runId)) {
        if (!store.run(runId)?.pid) { store.finishRun(runId, input.taskId, 'failed', !forkAttempted ? 'OPEN_FAILED_UNFORKED' : e instanceof DriverError ? e.code : 'OPEN_FAILED'); this.runs.delete(runId); run.markEnded(); }
        else store.markRunStopping(runId, input.taskId);
      }
      throw e;
    }
    return { runId, taskId: input.taskId, bindingId, generation, driverId: input.driverId, tier: tier.tier, version: input.executable.version, capabilities, model: input.model, defaultModel: run.defaultModel, ...(run.tierNotice ? { tierNotice: run.tierNotice } : {}) };
  }

  private onDriverEvent(run: ActiveRun, e: DriverEvent) {
    const { store } = this.deps;
    for (const l of [...this.live]) { try { l({ taskId: run.taskId, runId: run.runId, event: e }); } catch { /* 订阅者自身负责 */ } }
    try {
      for (const item of run.projector.project(e)) {
        store.upsertItem({ taskId: run.taskId, turnId: run.turnId, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:${item.key}`, type: item.type, payload: item.payload, terminalState: item.terminal ?? null });
        if (item.type === 'subagent' && item.payload.nativeNodeIds && run.instance.nativeChildHistory) for (const nodeId of item.payload.nativeNodeIds as string[]) this.captureNode(run, nodeId);
      }
      switch (e.type) {
        case 'process': {
          // PID 来自本宿主自己启动的 ChildProcess；出生身份由进程身份读取器核对（取不到时只记 PID）。
          const identity = this.deps.processes.read(e.pid);
          store.attachRunProcess(run.runId, run.taskId, e.pid, identity?.pid === e.pid ? identity.startedAt : null);
          if (run.integration) {
            run.registration = run.integration.attached(e.pid);
            void run.registration.catch(error => { run.openError = 'IDENTITY_REGISTRATION_FAILED'; store.addHostItem(run.taskId, run.turnId, 'error', { message: `业务运行身份登记失败：${(error as Error).message}` }); void this.close(run.runId); });
          }
          break;
        }
        case 'session': store.confirmNative(run.bindingId, e.nativeId); break;
        case 'turn.started':
          if (run.turnId) store.startTurn(run.turnId, e.nativeTurnId);
          else if (!e.clientInputId) {
            run.turnId = store.acceptAutoTurn(run.taskId, run.runId, e.nativeTurnId);
            if (this.held.has(run.taskId)) void run.instance.interrupt().catch(() => {});
          }
          if (store.goal(run.taskId)?.status === 'active') store.countGoalTurn(run.taskId);
          break;
        case 'catalog': run.catalog = { commands: e.commands.slice(0, 200), skills: e.skills.slice(0, 500) }; break;
        case 'goal': {
          const before = store.goal(run.taskId);
          const heldActive = this.held.has(run.taskId) && e.status === 'active' && run.driverId === 'codex-app-server';
          if (heldActive) void run.instance.goal?.({ kind: 'pause' }).catch(() => {});
          store.upsertGoal({ taskId: run.taskId, bindingId: run.bindingId, objective: e.objective, status: heldActive ? 'paused' : e.status, pausedReason: heldActive ? before?.pausedReason ?? 'user' : undefined, timeUsedSeconds: e.timeUsedSeconds, nativeCreatedAt: e.nativeCreatedAt, nativeUpdatedAt: e.nativeUpdatedAt });
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
            if (run.userStop?.turnId) {
              // The parent interruption may be acknowledged while a native child is
              // still active. Keep the original deadline until those children drain.
              if (run.nativeNodes?.size) run.userStop.turnId = null;
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
          const finish = () => { for (const nodeId of run.nativeNodes ?? []) store.upsertItem({ taskId: run.taskId, turnId: null, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:node-state:${nodeId}`, nodeId, type: 'subagent_status', payload: { state: 'interrupted', reason: 'owner-exited' }, terminalState: 'failed' }); run.nativeNodes?.clear(); store.finishRun(run.runId, run.taskId, run.openError ? 'failed' : closing ? 'stopped' : 'failed', run.openError ?? (closing ? null : `EXIT_${e.code ?? e.signal}`)); this.runs.delete(run.runId); run.markEnded(); };
          if (!run.integration) finish();
          else if (!run.exitFinishing) { run.exitFinishing = Promise.resolve(run.registration).catch(() => {}).then(async () => { if (!await this.drainNativeGroup(run.runId)) throw new Error('原生进程组退出不明'); await run.integration!.exited(); }).then(finish); void run.exitFinishing.catch(error => { store.markRunStopping(run.runId, run.taskId); store.addHostItem(run.taskId, run.turnId, 'error', { message: `进程已退出，业务或后代尚未排空，保留占用：${(error as Error).message}` }); }); }
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
  async dispatch(runId: string, turnId: string, input: { clientInputId: string; text: string; images?: { path: string; mime: string }[]; tier?: Tier; model?: string; effort?: string; context?: string }) {
    const run = this.runs.get(runId);
    if (!run || run.closing) throw new DriverError('STATE', '运行不存在或正在关闭');
    if (run.turnId) throw new DriverError('STATE', '上一轮尚未结束');
    const { store } = this.deps;
    run.assertCurrent?.();
    if (input.context) await this.injectHistory(runId, input.context);
    if (this.runs.get(runId) !== run || run.closing || this.held.has(run.taskId)) throw new DriverError('STATE', '已停止或会话已退出，输入保留在排队');
    const tier = input.tier ? resolveTier(run.driverId, input.tier) : { ok: true as const, tier: run.tier };
    if (!tier.ok) { store.endTurn(turnId, 'canceled', 'TIER'); throw new DriverError('REJECTED', '不支持的权限档位'); }
    store.dispatchTurn(turnId, runId);
    run.turnId = turnId;
    try {
      const { nativeTurnId } = await run.instance.startTurn({ clientInputId: input.clientInputId, text: input.text, images: input.images, tier: tier.tier, model: input.model, effort: input.effort });
      run.appliedTier = tier.tier; run.appliedModel = input.model; run.appliedEffort = input.effort; if (input.model) run.sentModel = true;
      store.startTurn(turnId, nativeTurnId);
      return { nativeTurnId };
    } catch (e) {
      if (run.turnId === turnId) run.turnId = null;
      // STATE：驱动在写出前拒绝（如原生仍有回合在跑），输入未发出，放回排队；REJECTED：协议明确拒绝记失败；其余记未知。
      if (e instanceof DriverError && e.code === 'STATE') store.requeueTurn(turnId);
      else store.endTurn(turnId, e instanceof DriverError && e.code === 'REJECTED' ? 'failed' : 'unknown', e instanceof DriverError ? e.code : 'START_FAILED');
      throw e;
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
    await run.instance.steer({ clientInputId: input.clientInputId, text: input.text, images: input.images, tier: run.tier });
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
    run.assertCurrent?.();
    await run.instance.injectHistory(text);
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
    run.closing = true;
    if(run.userStop)this.deps.store.tx(emit=>emit(run.taskId,'run.force_stopping',{runId}));
    await Promise.allSettled([...(run.nodeReads ?? [])]);
    await run.instance.close();
    if (run.exitFinishing) await run.exitFinishing.catch(() => {});
    // 只有观察到真实退出（exit 事件）才收口；仍未退出则保留占用并标 stopping，不冒充已退出（复核 CR04）。
    if (this.runs.has(runId)) this.deps.store.markRunStopping(runId, run.taskId);
  }

  async closeAll() { await Promise.all([...this.runs.keys()].map(id => this.close(id))); }
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
