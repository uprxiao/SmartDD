// Claude 程序化驱动：锁定的 Claude Agent SDK＋本机 claude（pathToClaudeCodeExecutable），不使用 SDK 自带程序。
// 流式输入模式：一个 query 承载同一会话的多轮；canUseTool 挂起为宿主请求，所有档位下计划批准都交用户（V18）。
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { CLAUDE_TIERS } from '../permissions';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type DriverRequestKind, type TurnInput } from '../driver';
import type { Tier } from '../permissions';

// 只依赖 SDK 的最小形状，便于测试注入替身；生产由 loadSdk 动态加载锁定版本。
export interface SdkQuery extends AsyncIterable<any> {
  interrupt(): Promise<unknown>;
  setPermissionMode(mode: string): Promise<void>;
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

const requestKind = (tool: string): DriverRequestKind =>
  tool === 'ExitPlanMode' ? 'plan_approval' : tool === 'AskUserQuestion' ? 'user_input' : tool === 'Bash' ? 'command_approval' : /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(tool) ? 'file_approval' : 'tool_approval';

export class ClaudeSdkInstance implements DriverInstance {
  readonly driverId = 'claude-sdk' as const;
  private readonly emitter = new Emitter();
  private query?: SdkQuery;
  private input?: InputQueue<any>;
  private child?: ChildProcess;
  private sessionId?: string;
  private confirmed = false;
  private tier: Tier = 'ask';
  private turnSerial = 0;
  private activeTurn: { nativeTurnId: string; clientInputId: string; started: boolean; interrupted: boolean; resolveStart?: (id: string) => void } | null = null;
  private stopPending = false;
  private readonly pending = new Map<string, PendingRequest>();
  private pump?: Promise<void>;
  private exited = false;

  constructor(private readonly sdk: () => Promise<SdkQueryFn> = loadSdk) {}

  on = this.emitter.on.bind(this.emitter);

  async open(o: DriverOpenOptions) {
    if (this.query) throw new DriverError('STATE', '实例已打开');
    const params = CLAUDE_TIERS[o.tier];
    if (!params) throw new DriverError('REJECTED', 'Claude 不支持该档位');
    this.tier = o.tier;
    const queryFn = await this.sdk();
    this.input = new InputQueue();
    const nativeId = o.resumeNativeId ?? randomUUID();
    this.sessionId = nativeId;
    const options: Record<string, unknown> = {
      pathToClaudeCodeExecutable: o.executable.path,
      cwd: o.cwd,
      env: o.env,
      ...(o.model ? { model: o.model } : {}),
      permissionMode: params.permissionMode,
      ...(params.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
      settingSources: [...(o.settingSources ?? ['user', 'project', 'local'])],
      includePartialMessages: true,
      ...(o.resumeNativeId ? { resume: o.resumeNativeId } : { sessionId: nativeId }),
      canUseTool: (tool: string, input: Record<string, unknown>, ctx: { signal: AbortSignal; title?: string; decisionReason?: string; blockedPath?: string }) => this.onPermission(tool, input, ctx),
      stderr: (data: string) => this.emitter.emit({ type: 'diagnostic', message: data.slice(0, 4000) }),
      spawnClaudeCodeProcess: (s: { command: string; args: string[]; cwd?: string; env: Record<string, string | undefined>; signal?: AbortSignal }) => {
        const child = spawn(s.command, s.args, { cwd: s.cwd, env: s.env as NodeJS.ProcessEnv, signal: s.signal, stdio: ['pipe', 'pipe', 'pipe'] });
        this.child = child;
        child.stderr?.on('data', (b: Buffer) => this.emitter.emit({ type: 'diagnostic', message: b.toString('utf8').slice(0, 4000) }));
        child.once('exit', (code, signal) => this.onExit(code, signal));
        if (child.pid) this.emitter.emit({ type: 'process', pid: child.pid });
        return child;
      },
    };
    this.query = queryFn({ prompt: this.input, options });
    this.pump = this.consume();
    // 新会话的预分配 ID 与恢复的 ID 都等 system/init 确认后才算原生身份（技术方案 §2）。
    return { nativeId, confirmed: false };
  }

  private onExit(code: number | null, signal: string | null) {
    if (this.exited) return;
    this.exited = true;
    for (const [key, p] of this.pending) { p.resolve({ behavior: 'deny', message: '执行器已退出' }); this.pending.delete(key); this.emitter.emit({ type: 'request.resolved', requestKey: key }); }
    if (this.activeTurn) { this.emitter.emit({ type: 'turn.completed', nativeTurnId: this.activeTurn.nativeTurnId, status: 'failed', error: '执行器退出' }); this.activeTurn = null; }
    this.emitter.emit({ type: 'exit', code, signal });
  }

  private async consume() {
    try {
      for await (const m of this.query!) this.onMessage(m);
    } catch (e) {
      this.emitter.emit({ type: 'diagnostic', message: `SDK 流异常：${(e as Error).message}` });
      if (this.activeTurn) { this.emitter.emit({ type: 'turn.completed', nativeTurnId: this.activeTurn.nativeTurnId, status: this.activeTurn.interrupted ? 'interrupted' : 'failed', error: (e as Error).message.slice(0, 2000) }); this.activeTurn = null; }
    }
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
    if (m?.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string') {
      if (!this.confirmed) { this.confirmed = true; this.sessionId = m.session_id; this.emitter.emit({ type: 'session', nativeId: m.session_id }); }
    }
    if (this.activeTurn && m?.type !== 'result') this.markStarted();
    if (m?.type === 'stream_event' && m.event?.type === 'content_block_delta' && m.event.delta?.type === 'text_delta') {
      this.emitter.emit({ type: 'message.delta', nativeItemId: String(m.uuid ?? m.event.index ?? 'text'), text: String(m.event.delta.text ?? '') });
    } else if (m?.type === 'assistant' && m.message) {
      this.emitter.emit({ type: 'item.completed', nativeItemId: String(m.uuid ?? randomUUID()), itemType: 'assistant', payload: m.message });
    } else if (m?.type === 'result') {
      const t = this.activeTurn;
      if (!t) return;
      this.markStarted();
      this.activeTurn = null;
      const status = t.interrupted ? 'interrupted' : m.subtype === 'success' && !m.is_error ? 'completed' : 'failed';
      this.emitter.emit({ type: 'turn.completed', nativeTurnId: t.nativeTurnId, status, ...(status === 'failed' ? { error: String(m.subtype) } : {}) });
    }
  }

  private onPermission(tool: string, input: Record<string, unknown>, ctx: { signal: AbortSignal; title?: string; decisionReason?: string; blockedPath?: string }): Promise<PermissionResult> {
    const key = randomUUID();
    return new Promise<PermissionResult>(resolve => {
      this.pending.set(key, { resolve, input });
      ctx.signal.addEventListener('abort', () => { if (this.pending.delete(key)) { resolve({ behavior: 'deny', message: '已取消' }); this.emitter.emit({ type: 'request.resolved', requestKey: key }); } }, { once: true });
      this.emitter.emit({ type: 'request', requestKey: key, kind: requestKind(tool), payload: { tool, input, title: ctx.title, decisionReason: ctx.decisionReason, blockedPath: ctx.blockedPath } });
    });
  }

  async startTurn(input: TurnInput) {
    if (!this.query || !this.input || this.exited) throw new DriverError('STATE', '会话尚未打开');
    if (this.activeTurn) throw new DriverError('STATE', '上一轮尚未结束');
    const params = CLAUDE_TIERS[input.tier];
    if (!params) throw new DriverError('REJECTED', 'Claude 不支持该档位');
    if (input.tier !== this.tier) { await this.query.setPermissionMode(params.permissionMode); this.tier = input.tier; }
    const nativeTurnId = `${this.sessionId}:${++this.turnSerial}`;
    const started = new Promise<string>(resolve => { this.activeTurn = { nativeTurnId, clientInputId: input.clientInputId, started: false, interrupted: false, resolveStart: resolve }; });
    this.input.push({ type: 'user', message: { role: 'user', content: input.text }, parent_tool_use_id: null });
    return { nativeTurnId: await started };
  }

  async respond(requestKey: string, result: unknown) {
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
    if (!t || !t.started) { this.stopPending = true; return; }
    t.interrupted = true;
    try { await this.query?.interrupt(); } catch (e) { this.emitter.emit({ type: 'diagnostic', message: `中断失败：${(e as Error).message}` }); }
  }

  async close() {
    if (!this.query) return;
    this.input?.end();
    try { this.query.close?.(); } catch { /* 已关闭 */ }
    const child = this.child;
    if (child && !this.exited) {
      await new Promise<void>(resolve => { const t = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 5000); child.once('exit', () => { clearTimeout(t); resolve(); }); });
    }
    await this.pump?.catch(() => {});
  }
}

export const claudeSdkDriver: AgentDriver = { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance() };
