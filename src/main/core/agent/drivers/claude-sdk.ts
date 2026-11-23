// Claude 程序化驱动：锁定的 Claude Agent SDK＋本机 claude（pathToClaudeCodeExecutable），不使用 SDK 自带程序。
// 流式输入模式：一个 query 承载同一会话的多轮；canUseTool 挂起为宿主请求，所有档位下计划批准都交用户（V18）。
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { McpServerStatus, OnElicitation } from '@anthropic-ai/claude-agent-sdk';
import {isHostBusinessCli} from '../host-cli-command';
import { CLAUDE_TIERS } from '../permissions';
import { DriverError, Emitter, requireElicitationCancellation, type AgentDriver, type DriverInstance, type DriverOpenOptions, type DriverRequestKind, type TurnInput, type DriverModel } from '../driver';
import type { Tier } from '../permissions';

// 只依赖 SDK 的最小形状，便于测试注入替身；生产由 loadSdk 动态加载锁定版本。
export interface SdkQuery extends AsyncIterable<any> {
  interrupt(): Promise<unknown>;
  stopTask?(taskId: string): Promise<void>;
  setPermissionMode(mode: string): Promise<void>;
  setModel?(model?: string): Promise<void>;
  supportedModels?(): Promise<{ value: string; displayName: string; supportsEffort?: boolean; supportedEffortLevels?: string[] }[]>;
  mcpServerStatus?(): Promise<McpServerStatus[]>;
  applyFlagSettings?(settings: { effortLevel: string | null }): Promise<void>;
  close?(): void;
}
export type SdkQueryFn = (params: { prompt: AsyncIterable<any>; options: Record<string, unknown> }) => SdkQuery;
export const loadSdk = async (): Promise<SdkQueryFn> => (await import('@anthropic-ai/claude-agent-sdk')).query as unknown as SdkQueryFn;

type PermissionResult = { behavior: 'allow'; updatedInput?: Record<string, unknown> } | { behavior: 'deny'; message: string; interrupt?: boolean };
interface PendingRequest { resolve(r: PermissionResult): void; input: Record<string, unknown> }

/** 可推送的异步队列，作为 SDK 的流式输入。 */
class InputQueue<T> implements AsyncIterable<T> {
  private items: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private ended = false;
  push(item: T) { const w = this.waiters.shift(); if (w) w({ value: item, done: false }); else this.items.push(item); }
  end() { this.ended = true; for (const w of this.waiters.splice(0)) w({ value: undefined as never, done: true }); }
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.items.length ? Promise.resolve({ value: this.items.shift()!, done: false }) : this.ended ? Promise.resolve({ value: undefined as never, done: true }) : new Promise(r => this.waiters.push(r)) };
  }
}

/** 有图片时用内容块（base64 图片）；只有文字时保持字符串。 */
const userContent = (input: TurnInput) => input.images?.length
  ? [{ type: 'text', text: input.text }, ...input.images.map(i => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: readFileSync(i.path).toString('base64') } }))]
  : input.text;

const requestKind = (tool: string): DriverRequestKind =>
  tool === 'ExitPlanMode' ? 'plan_approval' : tool === 'AskUserQuestion' ? 'user_input' : tool === 'Bash' ? 'command_approval' : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) ? 'file_approval' : 'tool_approval';

export class ClaudeSdkInstance implements DriverInstance {
  private openOptions?:DriverOpenOptions;
  private readonly nodeStates = new Map<string, { taskId: string; runId?: string; terminal: boolean }>();
  readonly driverId = 'claude-sdk' as const;
  private readonly emitter = new Emitter();
  private query?: SdkQuery;
  private input?: InputQueue<any>;
  private child?: ChildProcess;
  private sessionId?: string;
  private confirmed = false;
  private tier: Tier = 'ask';
  private turnSerial = 0;
  private activeTurn: { nativeTurnId: string; clientInputId: string; started: boolean; interrupted: boolean; resolveStart?: (id: string) => void; rejectStart?: (e: Error) => void } | null = null;
  private model: string | undefined;
  private effort: string | undefined;
  private goalCommandTurn: string | null = null;
  private configuringTurn = false;
  private stopPending = false;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly pendingElicitations = new Map<string, (native: boolean) => void>();
  private pump?: Promise<void>;
  private exited = false;
  private historyPending?: { id: string; resolve(): void; reject(error: Error): void };
  private historyBroken = false;

  constructor(private readonly sdk: () => Promise<SdkQueryFn> = loadSdk) {}

  on = this.emitter.on.bind(this.emitter);

  async modelCatalog(): Promise<DriverModel[]> {
    if (!this.query?.supportedModels) return [];
    const models = await this.query.supportedModels();
    return models.slice(0, 200).map(m => ({ id: m.value, name: m.displayName, efforts: m.supportsEffort && this.query?.applyFlagSettings ? m.supportedEffortLevels ?? [] : [] }));
  }
  async injectHistory(text: string) {
    if (!this.input || this.activeTurn || this.ended || this.exited) throw new DriverError('STATE', '历史交接需要空闲会话');
    if (this.historyPending || this.historyBroken) throw new DriverError('STATE', '历史追加尚未确认或已失效');
    const id = randomUUID();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.historyPending = undefined; this.historyBroken = true; reject(new DriverError('TIMEOUT', '历史追加未收到原生确认，未发送新输入')); this.emitter.emit({ type: 'unusable', reason: '历史追加确认超时' }); }, 20_000);
      this.historyPending = { id, resolve: () => { clearTimeout(timer); this.historyPending = undefined; resolve(); }, reject: error => { clearTimeout(timer); this.historyPending = undefined; this.historyBroken = true; reject(error); } };
      this.input!.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null, uuid: id, isSynthetic: true, shouldQuery: false });
    });
  }

  async open(o: DriverOpenOptions) {
    this.openOptions=o;
    if (this.query) throw new DriverError('STATE', '实例已打开');
    const params = CLAUDE_TIERS[o.tier];
    if (!params) throw new DriverError('REJECTED', 'Claude 不支持该档位');
    this.tier = o.tier;
    this.model = o.model;
    const queryFn = await this.sdk();
    o.assertStarting?.();
    this.input = new InputQueue();
    const nativeId = o.resumeNativeId ?? randomUUID();
    this.sessionId = nativeId;
    const managed = o.claudeMcp;
    const browserMcp = o.browserMcp;
    const projectContext = o.projectContextMcp;
    const browserServer = browserMcp && o.mcpServers?.[browserMcp.serverName];
    const mcpServers = {
      ...managed?.servers, ...o.mcpServers,
      ...(browserMcp?.alwaysLoad && browserServer ? { [browserMcp.serverName]: { ...browserServer, alwaysLoad: true } } : {}),
      ...(projectContext ? { [projectContext.name]: { command: projectContext.command, args: projectContext.args, alwaysLoad: true } } : {}),
    };
    const allowedTools = [...(managed?.allowTools ?? []), ...Object.keys(o.mcpServers ?? {}).map(name => `mcp__${name}__*`)];
    if (projectContext) allowedTools.push(`mcp__${projectContext.name}__project_context`);
    const settings = { ...o.claudeSettings };
    if (managed?.askTools.length) {
      const permissions = (settings.permissions ?? {}) as { ask?: string[] };
      settings.permissions = { ...permissions, ask: [...(permissions.ask ?? []), ...managed.askTools] };
    }
    const options: Record<string, unknown> = {
      pathToClaudeCodeExecutable: o.executable.path,
      cwd: o.cwd,
      env: o.env,
      ...(o.model ? { model: o.model } : {}),
      ...(Object.keys(settings).length ? { settings } : {}),
      permissionMode: params.permissionMode,
      ...(params.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      settingSources: [...(o.settingSources ?? ['user', 'project', 'local'])],
      ...(Object.keys(mcpServers).length ? { mcpServers } : {}),
      ...(allowedTools.length ? { allowedTools } : {}),
      ...(managed?.denyTools.length ? { disallowedTools: managed.denyTools } : {}),
      ...(o.plugins ? { plugins: o.plugins } : {}),
      ...(o.stopWhenWaiting ? { hooks: { Stop: [{ hooks: [async () => o.stopWhenWaiting?.() ? { continue: false } : {}] }] } } : {}),
      includeHookEvents: true,
      includePartialMessages: true,
      ...(o.resumeNativeId ? { resume: o.resumeNativeId } : { sessionId: nativeId }),
      canUseTool: (tool: string, input: Record<string, unknown>, ctx: { signal: AbortSignal; title?: string; decisionReason?: string; blockedPath?: string; agentID?: string }) => this.onPermission(tool, input, ctx),
      onElicitation: this.onElicitation,
      stderr: (data: string) => this.emitter.emit({ type: 'diagnostic', message: data.slice(0, 4000) }),
      spawnClaudeCodeProcess: (s: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined>; signal?: AbortSignal }) => {
        o.assertStarting?.();
        const child = spawn(s.command, s.args, { cwd: s.cwd, env: s.env as NodeJS.ProcessEnv, signal: s.signal, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
        this.child = child;
        child.stderr?.on('data', (b: Buffer) => this.emitter.emit({ type: 'diagnostic', message: b.toString('utf8').slice(0, 4000) }));
        child.once('exit', (code, signal) => this.onExit(code, signal));
        if (child.pid) this.emitter.emit({ type: 'process', pid: child.pid });
        return child;
      },
    };
    this.query = queryFn({ prompt: this.input, options });
    this.pump = this.consume();
    if (browserMcp || projectContext) await o.beforeInitialize?.();
    const [browserMcpReady, projectContextMcpReady] = await Promise.all([
      browserMcp && this.checkMcpTools(browserMcp.serverName, browserMcp.toolNames),
      projectContext && this.checkMcpTools(projectContext.name, ['project_context']),
    ]);
    // 新会话的预分配 ID 与恢复的 ID 都等 system/init 确认后才算原生身份（技术方案 §2）。
    return { nativeId, confirmed: false, browserMcpReady, projectContextMcpReady };
  }

  private async checkMcpTools(serverName: string, toolNames: readonly string[]): Promise<boolean> {
    const query = this.query;
    if (!query?.mcpServerStatus || toolNames.length === 0) return false;
    const budget = 2_500;
    const deadline = performance.now() + budget;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inspect = async () => {
      while (!this.exited && !this.ended && performance.now() < deadline) {
        const servers = await query.mcpServerStatus!();
        const status = Array.isArray(servers) ? servers.find(server => server.name === serverName) : undefined;
        if (status?.status === 'connected') {
          const tools = new Set(status.tools?.map(tool => tool.name));
          return toolNames.every(name => tools.has(name) || tools.has(`mcp__${serverName}__${name}`));
        }
        if (status?.status !== 'pending') return false;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return false;
    };
    try {
      return await Promise.race([inspect(), new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), budget); })]);
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private onExit(code: number | null, signal: string | null) {
    if (this.exited) return;
    this.exited = true; this.historyPending?.reject(new DriverError('EXITED', '历史追加期间执行器退出'));
    for (const [key, p] of this.pending) { p.resolve({ behavior: 'deny', message: '执行器已退出' }); this.pending.delete(key); this.emitter.emit({ type: 'request.resolved', requestKey: key }); }
    for (const finish of this.pendingElicitations.values()) finish(true);
    this.failTurn('执行器退出', this.activeTurn?.interrupted ? 'interrupted' : 'failed');
    this.emitter.emit({ type: 'exit', code, signal });
  }

  private async consume() {
    try {
      for await (const m of this.query!) this.onMessage(m);
    } catch (e) {
      this.historyPending?.reject(new DriverError('EXITED', '历史追加期间 SDK 流异常'));
      this.emitter.emit({ type: 'diagnostic', message: `SDK 流异常：${(e as Error).message}` });
      this.failTurn((e as Error).message.slice(0, 2000), this.activeTurn?.interrupted ? 'interrupted' : 'failed');
    }
    // 流结束后本实例不可再用（复核 CR07／NR04）：结束原生进程，退出事件让宿主把这次运行退役；下一次提交会恢复会话。
    this.ended = true;
    if (!this.exited) this.emitter.emit({ type: 'unusable', reason: 'SDK 流已结束' });
  }

  private ended = false;
  /** 回合在开始信号前失败：拒绝等待中的 startTurn（输入已写入流、是否被消费不能证明，由调用方记为未知）；已开始则发终态。 */
  private failTurn(error: string, status: 'failed' | 'interrupted') {
    const t = this.activeTurn; if (!t) return;
    this.activeTurn = null;
    if (!t.started) { t.rejectStart?.(new DriverError('EXITED', `回合开始前失败：${error}`)); return; }
    this.emitter.emit({ type: 'turn.completed', nativeTurnId: t.nativeTurnId, status, ...(status === 'failed' ? { error } : {}) });
  }

  private markStarted() {
    const t = this.activeTurn;
    if (!t || t.started) return;
    t.started = true;
    this.emitter.emit({ type: 'turn.started', nativeTurnId: t.nativeTurnId, clientInputId: t.clientInputId });
    t.resolveStart?.(t.nativeTurnId);
    if (this.stopPending) { this.stopPending = false; void this.interrupt(); }
  }

  private onMessage(m: any) {
    this.emitter.emit({ type: 'native', name: m?.type === 'system' ? `system/${m.subtype}` : String(m?.type ?? 'unknown'), payload: m });
    if (m?.type === 'system' && ['task_started', 'task_notification'].includes(m.subtype) && typeof m.task_id === 'string') {
      const id = String(m.tool_use_id ?? m.task_id), runId = typeof m.run_id === 'string' ? m.run_id : undefined, old = this.nodeStates.get(id), running = m.subtype === 'task_started';
      const late = old && (old.runId && runId && runId < old.runId || old.terminal && running && (!runId || runId === old.runId));
      if (!late) { this.nodeStates.set(id, { taskId: m.task_id, runId, terminal: !running }); this.emitter.emit({ type: 'node.state', nodeId: id, nativeRunId: runId, state: running ? 'running' : m.status === 'failed' ? 'failed' : m.status === 'stopped' ? 'interrupted' : 'completed' }); }
      this.emitter.emit({ type: 'node.message', nodeId: id, key: String(m.uuid ?? `${m.subtype}:${runId ?? m.task_id}`), payload: m });
    }
    if (typeof m?.parent_tool_use_id === 'string' && m.parent_tool_use_id) {
      if (m.type !== 'stream_event') this.emitter.emit({ type: 'node.message', nodeId: m.parent_tool_use_id, key: String(m.uuid ?? `${m.type}:${JSON.stringify(m).slice(0, 80)}`), payload: m });
      if (m.type === 'assistant') this.emitter.emit({ type: 'item.completed', nativeItemId: String(m.uuid ?? randomUUID()), itemType: 'assistant', payload: { content: m.message?.content, model: m.message?.model, parentToolUseId: m.parent_tool_use_id } });
      return; // Native child messages never start/end the parent's pending turn or enter its answer stream.
    }
    if (m?.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
      if (!this.confirmed) { this.confirmed = true; this.sessionId = m.session_id; this.emitter.emit({ type: 'session', nativeId: m.session_id }); }
      const terminalOnly = new Set<string>(Array.isArray(m.terminal_slash_commands) ? m.terminal_slash_commands : []);
      const skills = new Set<string>(Array.isArray(m.skills) ? m.skills : []);
      this.emitter.emit({ type: 'catalog', commands: (Array.isArray(m.slash_commands) ? m.slash_commands as string[] : []).filter(c => !terminalOnly.has(c) && !skills.has(c)), skills: [...skills].map(name => ({ name })) });
    }
    if (this.historyPending && m?.type === 'result') {
      const pending = this.historyPending;
      if (m.user_message_uuid === pending.id || m.user_message_uuids?.includes(pending.id)) {
        if (m.is_error || m.subtype !== 'success') pending.reject(new DriverError('REJECTED', '原生未接受历史追加')); else pending.resolve();
      }
      return; // shouldQuery=false has a zero-turn result; it cannot end the next real turn.
    }
    if (this.activeTurn && !this.historyPending && m?.type !== 'result' && m?.type !== 'active_goal') this.markStarted();
    // 目标以原生事实为准（复核 CR14）：SDK active_goal 与 CLI 回复的 Goal set／cleared 文字（研究 V14／V17 已验）。
    if (m?.type === 'active_goal') {
      // 结构化事实到达后，本轮的兼容文字解析失效，不能再覆盖原生事实（复核 FR07）。
      this.goalCommandTurn = null;
      this.emitter.emit(m.value ? { type: 'goal', objective: String(m.value.condition ?? ''), status: 'active' } : { type: 'goal', objective: null, status: 'cleared' });
      return;
    }
    const parent = typeof m?.parent_tool_use_id === 'string' ? m.parent_tool_use_id : null;
    if (m?.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
      // 原生子 Agent 的流式正文不进主任务（复核 CR13）。
      if (!parent) this.emitter.emit({ type: 'message.delta', nativeItemId: String(m.uuid ?? m.event.index ?? 'text'), text: String(m.event.delta.text ?? '') });
    } else if (m?.type === 'assistant' && m.message) {
      // 兼容 CLI 的目标确认文字：只认宿主发出 /goal 命令的那一轮、该轮第一段回复；普通回答不能改变目标状态（复核 NR13）。
      const trusted = !parent && !!this.activeTurn && this.goalCommandTurn === this.activeTurn.nativeTurnId;
      if (trusted) this.goalCommandTurn = null;
      if (trusted) for (const b of (m.message.content ?? []).slice(0, 1)) {
        const text = b?.type === 'text' ? String(b.text ?? '') : '';
        const set = /^Goal set: ([\s\S]+)/.exec(text), active = /^Goal active: ([\s\S]+?) \(/.exec(text);
        if (set) this.emitter.emit({ type: 'goal', objective: set[1].trim(), status: 'active' });
        else if (active) this.emitter.emit({ type: 'goal', objective: active[1].trim(), status: 'active' });
        else if (/^(Goal cleared|No goal set)/.test(text)) this.emitter.emit({ type: 'goal', objective: null, status: 'cleared' });
      }
      this.emitter.emit({ type: 'item.completed', nativeItemId: String(m.uuid ?? randomUUID()), itemType: 'assistant', payload: { ...m.message, parentToolUseId: parent } });
    } else if (m?.type === 'result') {
      const t = this.activeTurn;
      if (!t) return;
      this.markStarted();
      this.activeTurn = null;
      const status = t.interrupted ? 'interrupted' : m.subtype === 'success' && !m.is_error ? 'completed' : 'failed';
      this.emitter.emit({ type: 'turn.completed', nativeTurnId: t.nativeTurnId, status, ...(status === 'failed' ? { error: String(m.is_error && typeof m.result === 'string' ? m.result : m.subtype).slice(0, 2000) } : {}) });
    }
  }

  private onPermission(tool: string, input: Record<string, unknown>, ctx: { signal: AbortSignal; title?: string; decisionReason?: string; blockedPath?: string; agentID?: string }): Promise<PermissionResult> {
    if(tool==='Bash'&&isHostBusinessCli(input,this.openOptions?.hostBusinessCli,this.openOptions?.env??{}))return Promise.resolve({behavior:'allow',updatedInput:input});
    const key = randomUUID();
    return new Promise<PermissionResult>(resolve => {
      this.pending.set(key, { resolve, input });
      ctx.signal.addEventListener('abort', () => { if (this.pending.delete(key)) { resolve({ behavior: 'deny', message: '已取消' }); this.emitter.emit({ type: 'request.resolved', requestKey: key }); } }, { once: true });
      this.emitter.emit({ type: 'request', requestKey: key, kind: requestKind(tool), nodeId: ctx.agentID, payload: { tool, input, title: ctx.title, decisionReason: ctx.decisionReason, blockedPath: ctx.blockedPath } });
    });
  }

  private readonly onElicitation: OnElicitation = async (request, { signal, requestId }) => {
    const key = `elicitation:${requestId}`;
    if (signal.aborted || this.exited || this.ended || this.pendingElicitations.has(key)) return { action: 'cancel' };
    return new Promise(resolve => {
      const finish = (native: boolean) => {
        if (!this.pendingElicitations.delete(key)) return;
        signal.removeEventListener('abort', abort);
        resolve({ action: 'cancel' });
        if (native) this.emitter.emit({ type: 'request.resolved', requestKey: key });
      };
      const abort = () => finish(true);
      this.pendingElicitations.set(key, finish);
      signal.addEventListener('abort', abort, { once: true });
      this.emitter.emit({ type: 'request', requestKey: key, kind: 'elicitation', payload: { params: request } });
    });
  };

  async startTurn(input: TurnInput) {
    if (!this.query || !this.input) throw new DriverError('STATE', '会话尚未打开');
    // 已结束的会话不能再派发；输入尚未写出，按未发出处理（复核 NR04）。
    if (this.historyPending || this.historyBroken) throw new DriverError('STATE', '历史追加尚未确认，不能发送新输入');
    if (this.exited || this.ended) throw new DriverError('STATE', '会话已结束，将恢复后发送');
    if (this.activeTurn || this.configuringTurn) throw new DriverError('STATE', '上一轮尚未结束');
    const params = CLAUDE_TIERS[input.tier];
    if (!params) throw new DriverError('REJECTED', 'Claude 不支持该档位');
    // 跨越完全访问须在启动时声明；同一会话不切换，由调用方重开并恢复（复核 CR12，CLI 实测拒绝）。
    if (input.tier !== this.tier) throw new DriverError('UNSUPPORTED', '权限档位变化需要重开会话');
    this.stopPending = false;
    this.configuringTurn = true;
    try {
      // 下一轮显式应用选择，undefined 恢复执行器默认。
      if (input.model !== this.model) {
        if (!this.query.setModel) throw new DriverError('UNSUPPORTED', '该 SDK 不支持切换模型');
        await this.query.setModel(input.model); this.model = input.model;
        if (this.stopPending) throw new DriverError('STATE', '已停止，输入保留在排队');
      }
      if (input.effort !== this.effort) {
        if (!this.query.applyFlagSettings) throw new DriverError('UNSUPPORTED', '该 SDK 未公布会话推理强度设置');
        await this.query.applyFlagSettings({ effortLevel: input.effort ?? null }); this.effort = input.effort;
        if (this.stopPending) throw new DriverError('STATE', '已停止，输入保留在排队');
      }
    } finally {
      this.configuringTurn = false;
    }
    if (this.historyPending || this.historyBroken) throw new DriverError('STATE', '历史追加尚未确认，不能发送新输入');
    if (this.exited || this.ended) throw new DriverError('STATE', '会话已结束，将恢复后发送');
    const nativeTurnId = `${this.sessionId}:${++this.turnSerial}`;
    this.goalCommandTurn = /^\/goal(\s|$)/.test(input.text.trimStart()) ? nativeTurnId : null;
    const started = new Promise<string>((resolve, reject) => { this.activeTurn = { nativeTurnId, clientInputId: input.clientInputId, started: false, interrupted: false, resolveStart: resolve, rejectStart: reject }; });
    this.input.push({ type: 'user', message: { role: 'user', content: userContent(input) }, parent_tool_use_id: null });
    return { nativeTurnId: await started };
  }

  // 插话：Claude 流式输入写入成功不等于原生接受，当前没有本次输入的接受关联，暂不提供（复核 CR02）。

  /** Claude 目标通过 /goal 文字设定与清除；不能暂停（需求 R02）。由调用方作为普通输入发送。 */
  async goal(op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }): Promise<void> {
    throw new DriverError('UNSUPPORTED', op.kind === 'pause' || op.kind === 'resume' ? 'Claude 目标不能暂停，只能清除' : 'Claude 目标以 /goal 输入设定');
  }

  async respond(requestKey: string, result: unknown) {
    const finishElicitation = this.pendingElicitations.get(requestKey);
    if (finishElicitation) {
      requireElicitationCancellation(result);
      finishElicitation(false);
      return;
    }
    const p = this.pending.get(requestKey);
    if (!p) throw new DriverError('STATE', '请求已结束或不存在');
    const r = result as PermissionResult;
    if (!r || (r.behavior !== 'allow' && r.behavior !== 'deny')) throw new DriverError('REJECTED', '回应格式不正确');
    if (r.behavior === 'deny' && typeof r.message !== 'string') throw new DriverError('REJECTED', '拒绝须附原因');
    this.pending.delete(requestKey);
    p.resolve(r.behavior === 'allow' ? { behavior: 'allow', updatedInput: r.updatedInput ?? p.input } : r);
    // 宿主自己的回应不发 request.resolved（只表示原生侧自行结束）。
  }

  async interrupt() {
    const t = this.activeTurn;
    if (this.configuringTurn) { this.stopPending = true; return; }
    if (!t) {
      const stopTask = this.query?.stopTask?.bind(this.query);
      if (!stopTask) return;
      const background = new Set([...this.nodeStates.values()].filter(node => !node.terminal).map(node => node.taskId));
      const outcomes = await Promise.allSettled([...background].map(taskId => stopTask(taskId)));
      for (const outcome of outcomes) {
        if (outcome.status === 'rejected') this.emitter.emit({ type: 'diagnostic', message: `后台工作中断失败：${(outcome.reason as Error).message}` });
      }
      return;
    }
    if (!t.started) { this.stopPending = true; return; }
    t.interrupted = true;
    try { await this.query?.interrupt(); } catch (e) { this.emitter.emit({ type: 'diagnostic', message: `中断失败：${(e as Error).message}` }); }
  }

  async close() {
    if (!this.query) return;
    for (const finish of this.pendingElicitations.values()) finish(true);
    this.input?.end();
    try { this.query.close?.(); } catch { /* 已关闭 */ }
    const child = this.child;
    if (child && !this.exited) {
      // 以真实退出为准（复核 CR04）：超时依次 SIGTERM、SIGKILL，仍未退出不冒充已退出。
      const waitExit = (ms: number) => new Promise<boolean>(resolve => {
        if (this.exited) return resolve(true);
        const t = setTimeout(() => { child.off('exit', on); resolve(this.exited); }, ms);
        const on = () => { clearTimeout(t); resolve(true); };
        child.once('exit', on);
      });
      if (!(await waitExit(5000))) { child.kill('SIGTERM'); if (!(await waitExit(5000))) { child.kill('SIGKILL'); await waitExit(5000); } }
    }
    await this.pump?.catch(() => {});
  }
}

export const claudeSdkDriver: AgentDriver = { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance() };
