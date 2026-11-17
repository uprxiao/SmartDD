// M14 运行服务（技术方案 T1.5 §3）：打开／恢复绑定、登记真实运行身份、提交输入、转发原生请求与回应。
// 统一接口验证 task、binding、run、generation；客户端不得自报 PID、nativeId 或真人来源。
import { randomUUID } from 'node:crypto';
import type { DriverId } from './capabilities';
import type { AgentDriver, DriverEvent, DriverExecutable, DriverInstance } from './driver';
import { DriverError } from './driver';
import { AgentStore, sha256 } from './agent-store';
import { resolveTier, type Tier } from './permissions';
import { TimelineProjector } from './timeline';
import type { ProcessIdentityReader } from '../applications/process-identity';

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
}
export interface RunHandle { runId: string; taskId: string; bindingId: string; generation: number; driverId: DriverId; tier: Tier; tierNotice?: string; version: string }
export type LiveListener = (e: { taskId: string; runId: string; event: DriverEvent }) => void;

interface ActiveRun extends RunHandle { instance: DriverInstance; projector: TimelineProjector; turnId: string | null; closing: boolean; ended: Promise<void>; markEnded(): void }

export class AgentRunService {
  private readonly runs = new Map<string, ActiveRun>();
  private readonly live = new Set<LiveListener>();
  /** 正在由宿主回应的请求：期间原生侧的结束通知不当作“原生自行结束”。 */
  private readonly responding = new Set<string>();

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
    for (const r of this.runs.values()) if (r.taskId === input.taskId && !r.closing) throw new DriverError('STATE', '该任务已有运行中的执行器');

    const continuationHash = sha256(JSON.stringify({ driver: input.driverId, profile: input.profileId, stateRoot: input.stateRoot, compatibility: input.compatibility }));
    const existing = store.findBinding(input.taskId, input.driverId, continuationHash);
    const bindingId = existing?.binding_id ?? store.createBinding({ task_id: input.taskId, driver_id: input.driverId, profile_id: input.profileId, continuation_hash: continuationHash, state_root: input.stateRoot, cwd_identity: input.cwd });
    const resumeNativeId = existing?.native_confirmed_at ? existing.native_id ?? undefined : undefined;
    const generation = store.nextGeneration(bindingId);
    const runId = randomUUID();
    const launchPlanHash = sha256(JSON.stringify({ driver: input.driverId, executable: input.executable, cwd: input.cwd, tier: tier.tier, model: input.model ?? null, extraArgs: input.extraArgs ?? [], settingSources: input.settingSources ?? null, envNames: Object.keys(input.env).sort() }));
    store.insertRun({ runId, taskId: input.taskId, projectId: task.project_id, driverId: input.driverId, bindingId, generation, owner: this.deps.host, launchPlanHash });

    const instance = driver.create();
    let markEnded!: () => void;
    const ended = new Promise<void>(r => { markEnded = r; });
    const run: ActiveRun = { runId, taskId: input.taskId, bindingId, generation, driverId: input.driverId, tier: tier.tier, version: input.executable.version, ...(tier.downgraded ? { tierNotice: tier.reason } : {}), instance, projector: new TimelineProjector(input.driverId), turnId: null, closing: false, ended, markEnded };
    this.runs.set(runId, run);
    instance.on(e => this.onDriverEvent(run, e));
    try {
      const opened = await instance.open({ executable: input.executable, cwd: input.cwd, env: input.env, model: input.model, tier: tier.tier, resumeNativeId, extraArgs: input.extraArgs, settingSources: input.settingSources });
      if (opened.confirmed) store.confirmNative(bindingId, opened.nativeId);
    } catch (e) {
      store.finishRun(runId, input.taskId, 'failed', e instanceof DriverError ? e.code : 'OPEN_FAILED');
      this.runs.delete(runId);
      await instance.close().catch(() => {});
      throw e;
    }
    return { runId, taskId: input.taskId, bindingId, generation, driverId: input.driverId, tier: tier.tier, version: input.executable.version, ...(run.tierNotice ? { tierNotice: run.tierNotice } : {}) };
  }

  private onDriverEvent(run: ActiveRun, e: DriverEvent) {
    const { store } = this.deps;
    for (const l of [...this.live]) { try { l({ taskId: run.taskId, runId: run.runId, event: e }); } catch { /* 订阅者自身负责 */ } }
    try {
      for (const item of run.projector.project(e))
        store.upsertItem({ taskId: run.taskId, turnId: run.turnId, runId: run.runId, nativeKey: `${run.bindingId}:${run.generation}:${item.key}`, type: item.type, payload: item.payload, terminalState: item.terminal ?? null });
      switch (e.type) {
        case 'process': {
          // PID 来自本宿主自己启动的 ChildProcess；出生身份由进程身份读取器核对（取不到时只记 PID）。
          const identity = this.deps.processes.read(e.pid);
          store.attachRunProcess(run.runId, run.taskId, e.pid, identity?.pid === e.pid ? identity.startedAt : null);
          break;
        }
        case 'session': store.confirmNative(run.bindingId, e.nativeId); break;
        case 'turn.started':
          if (run.turnId) store.startTurn(run.turnId, e.nativeTurnId);
          else if (!e.clientInputId) run.turnId = store.acceptAutoTurn(run.taskId, run.runId, e.nativeTurnId);
          if (store.goal(run.taskId)?.status === 'active') store.countGoalTurn(run.taskId);
          break;
        case 'goal':
          store.upsertGoal({ taskId: run.taskId, bindingId: run.bindingId, objective: e.objective, status: e.status, timeUsedSeconds: e.timeUsedSeconds });
          break;
        case 'request':
          store.insertNativeRequest({ taskId: run.taskId, kind: e.kind, payload: e.payload, origin: { taskId: run.taskId, bindingId: run.bindingId, runId: run.runId, generation: run.generation, turnId: run.turnId, nativeRequest: e.requestKey } });
          break;
        case 'request.resolved': {
          const row = store.requestByNative(run.runId, e.requestKey);
          // 原生侧自行结束的请求（超时、回合结束等）不算用户回应。
          if (row?.status === 'pending' && !this.responding.has(row.request_id)) store.retireRequest(row.request_id, 'native-resolved');
          break;
        }
        case 'turn.completed': {
          const turns = store.turnsByNative(run.runId, e.nativeTurnId);
          const own = run.turnId ? store.turn(run.turnId) : undefined;
          if (own && !turns.some(t => t.turn_id === own.turn_id) && !own.native_turn_id) turns.push(own);
          for (const turn of turns) store.endTurn(turn.turn_id, e.status, e.error ? e.error.slice(0, 200) : null);
          if (run.turnId && turns.some(t => t.turn_id === run.turnId)) run.turnId = null;
          break;
        }
        case 'exit':
          store.finishRun(run.runId, run.taskId, run.closing ? 'stopped' : 'failed', run.closing ? null : `EXIT_${e.code ?? e.signal}`);
          this.runs.delete(run.runId);
          run.markEnded();
          break;
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
  async dispatch(runId: string, turnId: string, input: { clientInputId: string; text: string; images?: { path: string; mime: string }[]; tier?: Tier; model?: string }) {
    const run = this.runs.get(runId);
    if (!run || run.closing) throw new DriverError('STATE', '运行不存在或正在关闭');
    if (run.turnId) throw new DriverError('STATE', '上一轮尚未结束');
    const { store } = this.deps;
    const tier = input.tier ? resolveTier(run.driverId, input.tier) : { ok: true as const, tier: run.tier };
    if (!tier.ok) { store.endTurn(turnId, 'canceled', 'TIER'); throw new DriverError('REJECTED', '不支持的权限档位'); }
    store.dispatchTurn(turnId, runId);
    run.turnId = turnId;
    try {
      const { nativeTurnId } = await run.instance.startTurn({ clientInputId: input.clientInputId, text: input.text, images: input.images, tier: tier.tier, model: input.model });
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
    if (!run || !run.turnId) throw new DriverError('STATE', '当前没有进行中的回合');
    if (!run.instance.steer) throw new DriverError('UNSUPPORTED', '该执行器不支持插话');
    const current = this.deps.store.turn(run.turnId);
    if (!current?.native_turn_id) throw new DriverError('STATE', '回合尚未开始');
    await run.instance.steer({ clientInputId: input.clientInputId, text: input.text, images: input.images, tier: run.tier });
    this.deps.store.attachSteer(turnId, runId, current.native_turn_id);
  }
  async goal(runId: string, op: Parameters<NonNullable<DriverInstance['goal']>>[0]) {
    const run = this.runs.get(runId);
    if (!run) throw new DriverError('STATE', '运行不存在');
    if (!run.instance.goal) throw new DriverError('UNSUPPORTED', '该执行器不支持目标');
    await run.instance.goal(op);
  }

  busy(runId: string) { const r = this.runs.get(runId); return !!r?.turnId; }
  runForTask(taskId: string) { for (const r of this.runs.values()) if (r.taskId === taskId && !r.closing) return r; return undefined; }

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

  async interrupt(runId: string) {
    const run = this.runs.get(runId);
    if (!run) throw new DriverError('STATE', '运行不存在');
    await run.instance.interrupt();
  }

  async close(runId: string) {
    const run = this.runs.get(runId);
    if (!run) return;
    run.closing = true;
    await run.instance.close();
    // 进程已退出时 exit 事件会收口；若没有收到退出事件（替身或异常），按关闭收口。
    if (this.runs.has(runId)) {
      this.deps.store.finishRun(runId, run.taskId, 'stopped', null);
      this.runs.delete(runId);
      run.markEnded();
    }
  }

  async closeAll() { await Promise.all([...this.runs.keys()].map(id => this.close(id))); }
}
