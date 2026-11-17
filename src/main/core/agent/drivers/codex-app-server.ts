// Codex 程序化驱动：本机 codex app-server（stdio JSON-RPC）。每轮在 turn/start 显式下发档位参数，
// 恢复线程也重新下发，不依赖创建时默认值（技术方案 T1.5 §7.2，V08／V09）。
import { spawn, type ChildProcess } from 'node:child_process';
import { CODEX_TIERS, type CodexTierParams } from '../permissions';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type DriverRequestKind, type TurnInput } from '../driver';
import { JsonlRpcPeer } from '../jsonl-rpc';

const SANDBOX_MODE: Record<CodexTierParams['sandboxPolicy']['type'], string> = { workspaceWrite: 'workspace-write', dangerFullAccess: 'danger-full-access' };
const REQUEST_KIND: Record<string, DriverRequestKind> = {
  'item/commandExecution/requestApproval': 'command_approval',
  'item/fileChange/requestApproval': 'file_approval',
  'item/permissions/requestApproval': 'permission_approval',
  'item/tool/requestUserInput': 'user_input',
  'mcpServer/elicitation/request': 'elicitation',
  execCommandApproval: 'command_approval',
  applyPatchApproval: 'file_approval',
};
// 宿主不代办的服务端请求：明确拒绝，不让原生侧一直挂起（认证刷新、动态工具等不属于本期）。
const REFUSED = new Set(['account/chatgptAuthTokens/refresh', 'attestation/generate', 'item/tool/call']);

export interface CodexSpawn { (command: string, args: string[], options: { cwd: string; env: Record<string, string> }): ChildProcess }

export class CodexAppServerInstance implements DriverInstance {
  readonly driverId = 'codex-app-server' as const;
  private child?: ChildProcess;
  private rpc?: JsonlRpcPeer;
  private threadId?: string;
  private cwd = '';
  private activeTurn: { nativeTurnId: string; clientInputId: string } | null = null;
  private pendingInputId = '';
  private stopPending = false;
  private readonly startedTurns = new Set<string>();
  private readonly openRequests = new Set<string>();
  private readonly emitter = new Emitter();
  private exited = false;

  constructor(private readonly spawnFn: CodexSpawn = (c, a, o) => spawn(c, a, { ...o, stdio: ['pipe', 'pipe', 'pipe'] })) {}

  on = this.emitter.on.bind(this.emitter);

  async open(o: DriverOpenOptions) {
    if (this.child) throw new DriverError('STATE', '实例已打开');
    this.cwd = o.cwd;
    const child = this.spawnFn(o.executable.path, ['app-server', ...(o.extraArgs ?? [])], { cwd: o.cwd, env: o.env });
    this.child = child;
    child.stderr?.on('data', (b: Buffer) => this.emitter.emit({ type: 'diagnostic', message: b.toString('utf8').slice(0, 4000) }));
    const spawnError = new Promise<never>((_, reject) => child.once('error', e => reject(new DriverError('EXITED', `无法启动 Codex：${e.message}`))));
    spawnError.catch(() => {});
    child.once('exit', (code, signal) => {
      this.exited = true;
      this.rpc?.close(new DriverError('EXITED', `Codex 已退出（${code ?? signal}）`));
      if (this.activeTurn) { this.emitter.emit({ type: 'turn.completed', nativeTurnId: this.activeTurn.nativeTurnId, status: 'failed', error: 'app-server 退出' }); this.activeTurn = null; }
      this.emitter.emit({ type: 'exit', code, signal });
    });
    if (child.pid) this.emitter.emit({ type: 'process', pid: child.pid });
    this.rpc = new JsonlRpcPeer(child.stdout!, child.stdin!, {
      notification: (m, p) => this.onNotification(m, p),
      request: (id, m, p) => this.onRequest(id, m, p),
      invalid: line => this.emitter.emit({ type: 'diagnostic', message: `无法解析的输出：${line.slice(0, 500)}` }),
    });
    const tier = CODEX_TIERS[o.tier];
    const work = (async () => {
      await this.rpc!.call('initialize', { clientInfo: { name: 'willyou', version: '1' }, capabilities: { experimentalApi: true } });
      this.rpc!.notify('initialized');
      const common = { cwd: o.cwd, approvalPolicy: tier.approvalPolicy, approvalsReviewer: tier.approvalsReviewer, sandbox: SANDBOX_MODE[tier.sandboxPolicy.type], ...(o.model ? { model: o.model } : {}) };
      const r = o.resumeNativeId
        ? await this.rpc!.call<{ thread: { id: string } }>('thread/resume', { threadId: o.resumeNativeId, excludeTurns: true, ...common })
        : await this.rpc!.call<{ thread: { id: string } }>('thread/start', common);
      if (!r?.thread?.id) throw new DriverError('PROTOCOL', 'thread 响应缺少 id');
      this.threadId = r.thread.id;
      this.emitter.emit({ type: 'session', nativeId: r.thread.id });
      return { nativeId: r.thread.id, confirmed: true };
    })();
    return Promise.race([work, spawnError]);
  }

  async startTurn(input: TurnInput) {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    if (this.activeTurn) throw new DriverError('STATE', '上一轮尚未结束');
    const tier = CODEX_TIERS[input.tier];
    this.stopPending = false;
    this.pendingInputId = input.clientInputId;
    const r = await this.rpc.call<{ turn: { id: string } }>('turn/start', {
      threadId: this.threadId, cwd: this.cwd,
      input: [{ type: 'text', text: input.text, text_elements: [] }],
      clientUserMessageId: input.clientInputId,
      approvalPolicy: tier.approvalPolicy, approvalsReviewer: tier.approvalsReviewer, sandboxPolicy: tier.sandboxPolicy,
      ...(input.model ? { model: input.model } : {}),
    });
    const nativeTurnId = r?.turn?.id;
    if (!nativeTurnId) throw new DriverError('PROTOCOL', 'turn/start 响应缺少 turn.id');
    this.markStarted(nativeTurnId, input.clientInputId);
    this.pendingInputId = '';
    return { nativeTurnId };
  }

  private markStarted(nativeTurnId: string, clientInputId: string) {
    if (this.startedTurns.has(nativeTurnId)) return;
    this.startedTurns.add(nativeTurnId);
    this.activeTurn = { nativeTurnId, clientInputId };
    this.emitter.emit({ type: 'turn.started', nativeTurnId, clientInputId });
    // 发送即停止：原生开始信号到达后立即中断（技术方案 §3）。
    if (this.stopPending) void this.sendInterrupt(nativeTurnId);
  }

  private onNotification(method: string, params: unknown) {
    this.emitter.emit({ type: 'native', name: method, payload: params });
    const p = (params ?? {}) as Record<string, any>;
    switch (method) {
      case 'turn/started': {
        const id = p.turn?.id;
        // 只有宿主正在发起的 turn/start 才认领；原生自行开始的回合（目标续跑）clientInputId 为空。
        if (typeof id === 'string' && !this.startedTurns.has(id)) { this.markStarted(id, this.pendingInputId); this.pendingInputId = ''; }
        break;
      }
      case 'item/agentMessage/delta':
        if (typeof p.itemId === 'string' && typeof p.delta === 'string') this.emitter.emit({ type: 'message.delta', nativeItemId: p.itemId, text: p.delta });
        break;
      case 'item/completed':
        if (p.item && typeof p.item.id === 'string') this.emitter.emit({ type: 'item.completed', nativeItemId: p.item.id, itemType: String(p.item.type ?? 'unknown'), payload: p.item });
        break;
      case 'serverRequest/resolved': {
        const key = p.requestId !== undefined ? String(p.requestId) : null;
        if (key && this.openRequests.delete(key)) this.emitter.emit({ type: 'request.resolved', requestKey: key });
        break;
      }
      case 'thread/goal/updated': {
        const g = p.goal; if (!g) break;
        const st = g.status === 'active' || g.status === 'paused' || g.status === 'complete' ? g.status : 'limited';
        this.emitter.emit({ type: 'goal', objective: typeof g.objective === 'string' ? g.objective : null, status: st, timeUsedSeconds: Number(g.timeUsedSeconds ?? 0) });
        break;
      }
      case 'thread/goal/cleared':
        this.emitter.emit({ type: 'goal', objective: null, status: 'cleared' });
        break;
      case 'turn/completed': {
        const id = p.turn?.id; const status = p.turn?.status;
        if (typeof id !== 'string') break;
        const mapped = status === 'completed' ? 'completed' : status === 'interrupted' ? 'interrupted' : 'failed';
        if (this.activeTurn?.nativeTurnId === id) this.activeTurn = null;
        this.emitter.emit({ type: 'turn.completed', nativeTurnId: id, status: mapped, ...(mapped === 'failed' ? { error: p.turn?.error ? JSON.stringify(p.turn.error).slice(0, 2000) : String(status) } : {}) });
        break;
      }
    }
  }

  private onRequest(id: string | number, method: string, params: unknown) {
    this.emitter.emit({ type: 'native', name: method, payload: { id, params } });
    if (REFUSED.has(method)) { this.rpc?.replyError(id, -32601, 'WillYou 不处理该请求'); return; }
    const key = String(id);
    this.openRequests.add(key);
    this.emitter.emit({ type: 'request', requestKey: key, kind: REQUEST_KIND[method] ?? 'other', payload: { method, params } });
  }

  async respond(requestKey: string, result: unknown) {
    if (!this.rpc) throw new DriverError('STATE', '会话尚未打开');
    if (!this.openRequests.has(requestKey)) throw new DriverError('STATE', '请求已结束或不存在');
    const id = /^\d+$/.test(requestKey) ? Number(requestKey) : requestKey;
    this.rpc.reply(id, result);
    // 宿主自己的回应不再发 request.resolved：该事件只表示原生侧自行结束（超时、回合结束等）。
    this.openRequests.delete(requestKey);
  }

  async steer(input: TurnInput) {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    const t = this.activeTurn;
    if (!t) throw new DriverError('STATE', '当前没有进行中的回合');
    // expectedTurnId 不匹配当前回合时原生拒绝：不自动改成新回合发送（技术方案 §5）。
    await this.rpc.call('turn/steer', { threadId: this.threadId, expectedTurnId: t.nativeTurnId, clientUserMessageId: input.clientInputId, input: [{ type: 'text', text: input.text, text_elements: [] }] });
    this.emitter.emit({ type: 'steer.accepted', clientInputId: input.clientInputId, nativeTurnId: t.nativeTurnId });
  }

  async goal(op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }) {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    if (op.kind === 'clear') { await this.rpc.call('thread/goal/clear', { threadId: this.threadId, origin: 'user' }); return; }
    const params = op.kind === 'set' ? { objective: op.objective, status: 'active' } : { status: op.kind === 'pause' ? 'paused' : 'active' };
    await this.rpc.call('thread/goal/set', { threadId: this.threadId, origin: 'user', ...params });
  }

  private async sendInterrupt(nativeTurnId: string) {
    try { await this.rpc?.call('turn/interrupt', { threadId: this.threadId, turnId: nativeTurnId }, 15_000); }
    catch (e) { this.emitter.emit({ type: 'diagnostic', message: `中断失败：${(e as Error).message}` }); }
  }

  async interrupt() {
    if (this.activeTurn) return this.sendInterrupt(this.activeTurn.nativeTurnId);
    this.stopPending = true;
  }

  async close() {
    const child = this.child;
    if (!child || this.exited) return;
    child.stdin?.end();
    await new Promise<void>(resolve => {
      if (this.exited) return resolve();
      const t = setTimeout(() => { child.kill('SIGTERM'); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(t); resolve(); });
    });
  }
}

export const codexAppServerDriver: AgentDriver = { id: 'codex-app-server', command: 'codex', create: () => new CodexAppServerInstance() };
