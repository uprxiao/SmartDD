// Codex 程序化驱动：本机 codex app-server（stdio JSON-RPC）。每轮在 turn/start 显式下发档位参数，
// 恢复线程也重新下发，不依赖创建时默认值（技术方案 T1.5 §7.2，V08／V09）。
import { spawn, type ChildProcess } from 'node:child_process';
import { CODEX_TIERS, codexSupportsTurnPermissions, type CodexTierParams } from '../permissions';
import { DriverError, Emitter, requireElicitationCancellation, type AgentDriver, type DriverEvent, type DriverInstance, type DriverOpenOptions, type DriverRequestKind, type TurnInput, type DriverModel } from '../driver';
import { JsonlRpcPeer } from '../jsonl-rpc';
import { redact } from '../../connections/redact';
import { catalogAccount, CodexCatalogReader, type CatalogObserver } from './codex-catalog';

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
// The native catalogue may refresh before initialize; use the same WillYou client for both paths.
const clientInfo = { name: 'willyou', version: '1' };
const codexEnv = (env: Record<string, string>) => ({ ...env, CODEX_INTERNAL_ORIGINATOR_OVERRIDE: clientInfo.name });

/** Query an account's model capabilities without creating a native thread or sending input. */
export async function previewCodexModels(executable: string, cwd: string, env: Record<string, string>, extraArgs: string[], observer: CatalogObserver = {}, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const child = spawn(executable, ['app-server', ...extraArgs, '-c', 'features.hooks=false', '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false'],
    { cwd, env: codexEnv(env), stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
  const peer = new JsonlRpcPeer(child.stdout, child.stdin, {
    notification() {},
    request(id) { peer.replyError(id, -32601, '仅查询模型目录'); },
  }, 10_000);
  const catalog = new CodexCatalogReader(peer, child.stderr);
  const abort = () => peer.close(new DriverError('EXITED', '模型目录读取已取消'));
  signal?.addEventListener('abort', abort, { once: true });
  child.once('error', error => peer.close(error));
  child.once('exit', () => peer.close(new Error('目录查询已退出')));
  child.stdin.on('error', error => peer.close(error));
  try {
    await peer.call('initialize', { clientInfo, capabilities: { experimentalApi: true } });
    peer.notify('initialized');
    const identity = observer.account && catalogAccount(peer).then(observer.account, () => {});
    const [result] = await Promise.all([catalog.read(observer.fallback), identity]);
    return result;
  } finally {
    signal?.removeEventListener('abort', abort);
    child.stdin.end();
    const terminate = setTimeout(() => child.kill('SIGTERM'), 250);
    const force = setTimeout(() => child.kill('SIGKILL'), 900);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([closed, new Promise<void>(resolve => { timeout = setTimeout(resolve, 1500); })]);
    clearTimeout(terminate);
    clearTimeout(force);
    clearTimeout(timeout);
    child.stdout.destroy();
    child.stderr.destroy();
  }
}

export class CodexAppServerInstance implements DriverInstance {
  readonly driverId = 'codex-app-server' as const;
  private child?: ChildProcess;
  private rpc?: JsonlRpcPeer;
  private catalog?: CodexCatalogReader;
  private modelCache?: DriverOpenOptions['modelCache'];
  private savedCatalog?: Promise<{ account: string; models: DriverModel[] | undefined } | undefined>;
  private catalogRequest?: Promise<DriverModel[]>;
  private threadId?: string;
  private cwd = '';
  private readOnly = false;
  private turnCliPermissions?: string;
  private activeTurn: {
    nativeTurnId: string;
    clientInputId: string;
    interrupted: boolean;
    interrupt?: Promise<void>;
    finalizedMessages: Set<string>;
  } | null = null;
  private pendingInputId = '';
  private stopPending = false;
  private readonly startedTurns = new Set<string>();
  private readonly openRequests = new Map<string, DriverRequestKind>();
  private readonly childThreads = new Set<string>();
  private readonly childTurns = new Map<string, string>();
  private readonly completedChildTurns = new Set<string>();
  private readonly finishedChildren = new Set<string>();
  private readonly emitter = new Emitter();
  private exited = false;
  private stderrTail = '';
  private secrets: string[] = [];

  constructor(private readonly spawnFn: CodexSpawn = (c, a, o) => spawn(c, a, { ...o, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] }), private readonly closeGraceMs = 5000) {}

  on = this.emitter.on.bind(this.emitter);

  async open(o: DriverOpenOptions) {
    if (this.child) throw new DriverError('STATE', '实例已打开');
    this.modelCache = o.modelCache;
    this.secrets = Object.entries(o.env).filter(([name]) => /KEY|TOKEN|PASSWORD|SECRET/.test(name)).map(([,value]) => value).filter(Boolean);
    this.cwd = o.cwd; this.readOnly = o.readOnly === true;
    this.turnCliPermissions = !this.readOnly && codexSupportsTurnPermissions(o.executable.version) ? o.codexCliPermissions : undefined;
    o.assertStarting?.();
    const child = this.spawnFn(o.executable.path, ['app-server', ...(o.extraArgs ?? []), ...(this.readOnly ? ['-c', 'features.hooks=false', '-c', 'features.plugins=false', '-c', 'features.remote_plugin=false'] : [])], { cwd: o.cwd, env: codexEnv(o.env) });
    this.child = child;
    child.stderr?.on('data', (b: Buffer) => { const message = redact(b.toString('utf8'), this.secrets); this.stderrTail = (this.stderrTail + message).slice(-2000); this.emitter.emit({ type: 'diagnostic', message: message.slice(0, 4000) }); });
    const spawnError = new Promise<never>((_, reject) => child.once('error', e => reject(new DriverError('EXITED', `无法启动 Codex：${e.message}`))));
    spawnError.catch(() => {});
    child.once('exit', (code, signal) => {
      this.exited = true;
      this.rpc?.close(new DriverError('EXITED', `Codex 已退出（${code ?? signal}）${this.stderrTail ? `：${this.stderrTail.trim()}` : ''}`));
      const turn = this.activeTurn;
      if (turn) {
        this.activeTurn = null;
        this.emitter.emit({type:'turn.completed',nativeTurnId:turn.nativeTurnId,status:turn.interrupted?'interrupted':'failed',
          ...(turn.interrupted?{}:{error:'app-server 退出'})});
      }
      this.emitter.emit({ type: 'exit', code, signal });
    });
    if (child.pid) this.emitter.emit({ type: 'process', pid: child.pid });
    this.rpc = new JsonlRpcPeer(child.stdout!, child.stdin!, {
      notification: (m, p) => this.onNotification(m, p),
      request: (id, m, p) => this.onRequest(id, m, p),
      invalid: line => this.emitter.emit({ type: 'diagnostic', message: `无法解析的输出：${line.slice(0, 500)}` }),
    });
    this.catalog = new CodexCatalogReader(this.rpc, child.stderr);
    const abort = () => this.rpc?.close(new DriverError('STATE', '会话预恢复已取消'));
    o.startupSignal?.addEventListener('abort', abort, { once: true });
    if (o.startupSignal?.aborted) abort();
    const tier = CODEX_TIERS[o.tier];
    const work = (async () => {
      await o.beforeInitialize?.();
      await this.rpc!.call('initialize', { clientInfo, capabilities: { experimentalApi: true } });
      o.assertStarting?.();
      this.rpc!.notify('initialized');
      this.savedCatalog = this.readSavedCatalog(this.rpc!);
      const instructions = o.hostBusinessInstructions
        ? this.readDeveloperInstructions(this.rpc!, o.cwd, o.hostBusinessInstructions)
        : undefined;
      if (o.resumeNativeId && o.recoverGoals) {
        const state = await this.rpc!.call<{ goal?: { objective: string; status: string; createdAt: number; updatedAt: number } | null }>('thread/goal/get', { threadId: o.resumeNativeId });
        if (state.goal?.status === 'active') {
          await this.rpc!.call('thread/goal/set', { threadId: o.resumeNativeId, origin: 'user', status: 'paused' });
          this.emitter.emit({ type: 'diagnostic', message: '恢复前发现原生目标仍在进行，已先暂停；不会因恢复会话自动续轮。' });
        }
      }
      if (o.skillRoots?.length) {
        await this.rpc!.call('skills/extraRoots/set', { extraRoots: o.skillRoots.map(s => s.path) });
        // Updating the extra roots already invalidates the native Skill cache.
        const listed = await this.rpc!.call<{ data?: { skills?: { name: string; path: string; enabled: boolean }[] }[] }>('skills/list', { cwds: [o.cwd] });
        const skills = listed.data?.flatMap(d => d.skills ?? []) ?? [];
        for (const root of o.skillRoots) if (skills.filter(s => s.name === root.name && s.enabled).length !== 1 || !skills.some(s => s.name === root.name && s.path === root.path + '/SKILL.md' && s.enabled)) throw new DriverError('REJECTED', `Skill 未按冻结目录加载：${root.name}`);
      }
      // 新线程不带模型打开，响应里的 model 即执行器默认；所选模型随每轮显式发送（模型覆盖对后续轮次持续生效，复核 FR03）。
      const sandbox = !this.readOnly && o.tier !== 'full' && o.codexCliPermissions
        ? { permissions: o.codexCliPermissions }
        : { sandbox: this.readOnly ? 'read-only' : SANDBOX_MODE[tier.sandboxPolicy.type] };
      const developerInstructions = await instructions;
      const common = { cwd: o.cwd, approvalPolicy: this.readOnly ? 'never' : tier.approvalPolicy, approvalsReviewer: tier.approvalsReviewer, ...sandbox,
        ...(developerInstructions ? { developerInstructions } : {}) };
      o.assertStarting?.();
      if (o.beforeThreadOpen) {
        await o.beforeThreadOpen();
        o.assertStarting?.();
      }
      const r = o.resumeNativeId
        ? await this.rpc!.call<{ thread: { id: string }; model?: string; reasoningEffort?: string | null }>('thread/resume', { threadId: o.resumeNativeId, excludeTurns: true, ...common, ...(o.model ? { model: o.model } : {}) })
        : await this.rpc!.call<{ thread: { id: string }; model?: string; reasoningEffort?: string | null }>('thread/start', common);
      o.assertStarting?.();
      if (!r?.thread?.id) throw new DriverError('PROTOCOL', 'thread 响应缺少 id');
      this.threadId = r.thread.id;
      for (const name of o.requiredMcpServers ?? []) {
        const deadline = Date.now() + 35_000;
        while (true) {
          o.assertStarting?.();
          const status = await this.rpc!.call<{ data?: { name: string; runtimeStatus?: string; toolsError?: string; tools?: Record<string, unknown> }[] }>('mcpServerStatus/list', { threadId: r.thread.id, serverName: name, detail: 'full' }, 30_000);
          const server = status.data?.find(s => s.name === name);
          if (!server) throw new DriverError('REJECTED', `宿主 MCP 未进入原生配置：${name}`);
          if (server.tools && Object.keys(server.tools).length) break;
          if (['failed','disabled','cancelled','authenticationRequired'].includes(server.runtimeStatus ?? '') || server.toolsError || Date.now() >= deadline) throw new DriverError('REJECTED', `宿主 MCP 未就绪：${name} / ${server.runtimeStatus ?? 'unknown'} / ${redact(server.toolsError ?? '', this.secrets).slice(0, 1000)}`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
      this.emitter.emit({ type: 'session', nativeId: r.thread.id });
      // Skill 目录：协议探测失败只让 $Skill 菜单为空，不影响会话。
      void this.rpc!.call<{ data?: { skills?: { name: string; description?: string; enabled?: boolean }[] }[] }>('skills/list', { cwds: [o.cwd] }, 15_000)
        .then(s => this.emitter.emit({ type: 'catalog', commands: ['goal', 'compact', 'review'], skills: (s?.data ?? []).flatMap(e => e.skills ?? []).filter(k => k.enabled !== false).map(k => ({ name: k.name, description: k.description })) }))
        .catch(() => this.emitter.emit({ type: 'catalog', commands: ['goal', 'compact', 'review'], skills: [] }));
      // 恢复的线程带着上次的模型覆盖，不能当默认；需要时再经 defaultModel() 从配置与模型目录读取。
      const defaultModel = !o.resumeNativeId && typeof r.model === 'string' && r.model ? r.model : undefined;
      const nativeSelection = (!o.resumeNativeId || r.thread.id === o.resumeNativeId) && typeof r.model === 'string' && r.model
        && typeof r.reasoningEffort === 'string' && r.reasoningEffort
        ? { model: r.model, effort: r.reasoningEffort } : undefined;
      return { nativeId: r.thread.id, confirmed: true, ...(defaultModel ? { defaultModel } : {}),
        ...(nativeSelection ? { nativeSelection } : {}), ...(developerInstructions ? { hostBusinessInstructionsInstalled: true } : {}) };
    })();
    try {
      return await Promise.race([work, spawnError]);
    } finally {
      o.startupSignal?.removeEventListener('abort', abort);
    }
  }

  /** 执行器默认模型：用户配置的 model，否则模型目录里标记为默认的那个；读不到返回 undefined。 */
  async defaultModel(): Promise<string | undefined> {
    if (!this.rpc) return undefined;
    try {
      const c = await this.rpc.call<{ config?: { model?: string | null } }>('config/read', { cwd: this.cwd }, 5_000);
      if (c?.config?.model) return c.config.model;
      return (await this.modelCatalog()).find(m => m.isDefault)?.id;
    } catch { return undefined; }
  }

  async modelCatalog(onFallback?: (models: DriverModel[]) => void): Promise<DriverModel[]> {
    if (!this.catalog || !this.rpc) return [];
    this.catalogRequest ??= this.readModels(this.catalog, onFallback).finally(() => { this.catalogRequest = undefined; });
    return this.catalogRequest;
  }

  private async readDeveloperInstructions(peer: JsonlRpcPeer, cwd: string, hostInstructions: string) {
    try {
      const { config } = await peer.call<{ config?: { developer_instructions?: unknown } }>('config/read', { cwd }, 750);
      const configured = config?.developer_instructions;
      // Avoid overriding a setting when the native configuration could not be verified.
      if (configured === null || typeof configured === 'string') {
        return configured ? configured + '\n\n' + hostInstructions : hostInstructions;
      }
    } catch { /* Use the existing turn-time context path. */ }
    return undefined;
  }

  private async readSavedCatalog(peer: JsonlRpcPeer) {
    if (!this.modelCache) return undefined;
    const started = performance.now();
    const report = (result: Extract<DriverEvent, { type: 'model_cache' }>['result']) =>
      this.emitter.emit({ type: 'model_cache', result, elapsedMs: Math.round(performance.now() - started) });
    let account: string | undefined;
    try { account = await catalogAccount(peer); }
    catch (error) {
      report(error instanceof DriverError && error.code === 'TIMEOUT' ? 'account_timeout' : 'account_failed');
      return undefined;
    }
    if (!account) { report('account_unavailable'); return undefined; }
    try {
      const models = await this.modelCache.read(account);
      report(models ? 'hit' : 'miss');
      return { account, models };
    }
    catch { report('read_failed'); return { account, models: undefined }; }
  }

  private async readModels(catalog: CodexCatalogReader, onFallback?: (models: DriverModel[]) => void) {
    const lookup = this.savedCatalog ?? this.readSavedCatalog(this.rpc!);
    this.savedCatalog = undefined;
    const saved = await lookup;
    if (saved?.models) return saved.models;
    // The chooser can refresh its independent catalogue. The running session
    // needs one bounded native read so retries cannot hold a user's turn.
    const result = await catalog.read(onFallback, { attempts: 1, timeoutMs: 6_000 });
    if (saved && result.confirmed) this.modelCache?.write(saved.account, result.models);
    return result.models;
  }
  async injectHistory(text: string) {
    if (!this.rpc || !this.threadId || this.activeTurn) throw new DriverError('STATE', '历史交接需要空闲会话');
    await this.rpc.call('thread/inject_items', { threadId: this.threadId, items: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text }] }] });
  }

  async startTurn(input: TurnInput) {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    if (this.activeTurn) throw new DriverError('STATE', '上一轮尚未结束');
    const tier = CODEX_TIERS[input.tier];
    const sandbox = this.turnCliPermissions && input.tier !== 'full'
      ? { permissions: this.turnCliPermissions }
      : { sandboxPolicy: this.readOnly ? { type: 'readOnly', networkAccess: false } : tier.sandboxPolicy };
    this.stopPending = false;
    this.pendingInputId = input.clientInputId;
    const r = await this.rpc.call<{ turn: { id: string } }>('turn/start', {
      threadId: this.threadId, cwd: this.cwd,
      input: [{ type: 'text', text: input.text, text_elements: [] }, ...(input.images ?? []).map(i => ({ type: 'localImage', path: i.path }))],
      clientUserMessageId: input.clientInputId,
      approvalPolicy: this.readOnly ? 'never' : tier.approvalPolicy, approvalsReviewer: tier.approvalsReviewer, ...sandbox,
      ...(input.model ? { model: input.model } : {}),
      ...(input.effort ? { effort: input.effort } : {}),
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
    this.activeTurn = { nativeTurnId, clientInputId, interrupted: false, finalizedMessages: new Set() };
    const stopPending = this.stopPending;
    this.stopPending = false;
    this.emitter.emit({ type: 'turn.started', nativeTurnId, clientInputId });
    // 发送即停止：原生开始信号到达后立即中断（技术方案 §3）。
    if (stopPending) void this.sendInterrupt(nativeTurnId);
  }

  private onNotification(method: string, params: unknown) {
    const p = (params ?? {}) as Record<string, any>;
    if (p.item?.type === 'collabAgentToolCall' && (!p.threadId || p.threadId === this.threadId) && p.item.senderThreadId === this.threadId) for (const id of p.item.receiverThreadIds ?? []) if (typeof id === 'string' && id.length <= 128) {
      this.childThreads.add(id); const state = p.item.agentsStates?.[id]?.status;
      if (['pendingInit','running'].includes(state) && !this.finishedChildren.has(id)) this.emitter.emit({ type: 'node.state', nodeId: id, state: 'running' });
      if (['completed','errored','interrupted','shutdown','notFound'].includes(state)) { this.finishedChildren.add(id); this.emitter.emit({ type: 'node.state', nodeId: id, state: state === 'completed' ? 'completed' : state === 'errored' || state === 'notFound' ? 'failed' : 'interrupted' }); }
    }
    if (!p.threadId && p.goal?.threadId) p.threadId = p.goal.threadId;
    if (p.threadId && this.threadId && p.threadId !== this.threadId) {
      if (this.childThreads.has(p.threadId)) {
        if (method === 'turn/started' && p.turn?.id && !this.completedChildTurns.has(p.turn.id)) { this.childTurns.set(p.threadId, p.turn.id); this.finishedChildren.delete(p.threadId); this.emitter.emit({ type: 'node.state', nodeId: p.threadId, nativeRunId: p.turn.id, state: 'running' }); }
        if (method === 'turn/completed' && p.turn?.id) { this.completedChildTurns.add(p.turn.id); if (!this.childTurns.has(p.threadId) || this.childTurns.get(p.threadId) === p.turn.id) { this.finishedChildren.add(p.threadId); this.emitter.emit({ type: 'node.state', nodeId: p.threadId, nativeRunId: p.turn.id, state: p.turn.status === 'completed' ? 'completed' : p.turn.status === 'interrupted' ? 'interrupted' : 'failed' }); } }
        if (!method.endsWith('/delta')) this.emitter.emit({ type: 'node.message', nodeId: p.threadId, key: `${method}:${p.item?.id ?? p.turn?.id ?? p.itemId ?? JSON.stringify(p).slice(0, 100)}`, payload: { method, ...p } });
      }
      else this.emitter.emit({ type: 'diagnostic', message: `忽略未归属主任务的原生线程事件：${method}` });
      return;
    }
    this.emitter.emit({ type: 'native', name: method, payload: params });
    switch (method) {
      case 'turn/started': {
        const id = p.turn?.id;
        // 只有宿主正在发起的 turn/start 才认领；原生自行开始的回合（目标续跑）clientInputId 为空。
        if (typeof id === 'string' && !this.startedTurns.has(id)) { this.markStarted(id, this.pendingInputId); this.pendingInputId = ''; }
        break;
      }
      case 'item/agentMessage/delta': {
        const turn = this.activeTurn;
        // A delayed preview must not reopen a finished item or appear in a later turn.
        if (turn && p.turnId === turn.nativeTurnId && typeof p.itemId === 'string' && typeof p.delta === 'string'
          && !turn.finalizedMessages.has(p.itemId)) {
          this.emitter.emit({ type: 'message.delta', nativeItemId: p.itemId, text: p.delta });
        }
        break;
      }
      case 'item/completed': {
        const item = p.item;
        if (!item || typeof item.id !== 'string') break;
        const turn = this.activeTurn;
        if (turn && p.turnId === turn.nativeTurnId && item.type === 'agentMessage') turn.finalizedMessages.add(item.id);
        this.emitter.emit({ type: 'item.completed', nativeItemId: item.id, itemType: String(item.type ?? 'unknown'), payload: item });
        break;
      }
      case 'serverRequest/resolved': {
        const key = p.requestId !== undefined ? String(p.requestId) : null;
        if (key && this.openRequests.delete(key)) this.emitter.emit({ type: 'request.resolved', requestKey: key });
        break;
      }
      case 'thread/goal/updated': {
        const g = p.goal; if (!g) break;
        const st = g.status === 'active' || g.status === 'paused' || g.status === 'complete' ? g.status : 'limited';
        this.emitter.emit({ type: 'goal', objective: typeof g.objective === 'string' ? g.objective : null, status: st, timeUsedSeconds: Number(g.timeUsedSeconds ?? 0), ...(Number.isFinite(g.createdAt) ? { nativeCreatedAt: g.createdAt } : {}), ...(Number.isFinite(g.updatedAt) ? { nativeUpdatedAt: g.updatedAt } : {}) });
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
    const source = params as { threadId?: string } | null;
    if (source?.threadId && this.threadId && source.threadId !== this.threadId && !this.childThreads.has(source.threadId)) { this.rpc?.replyError(id, -32602, '请求不属于当前任务或已登记原生子线程'); return; }
    this.emitter.emit({ type: 'native', name: method, payload: { id, params } });
    const kind = Object.hasOwn(REQUEST_KIND, method) ? REQUEST_KIND[method] : undefined;
    if (this.readOnly && kind && ['command_approval', 'file_approval', 'permission_approval'].includes(kind)) { this.rpc?.replyError(id, -32001, 'Read-only role: write/escalation denied; request wy_request_write and end this turn to enter the write queue.'); return; }
    if (REFUSED.has(method)) { this.rpc?.replyError(id, -32601, 'WillYou 不处理该请求'); return; }
    // 未知的必需请求：明确拒绝并标协议不兼容，不套通用批准（复核 NR09，技术方案 §4）。
    if (!kind) { this.rpc?.replyError(id, -32601, 'WillYou 不支持该请求'); this.emitter.emit({ type: 'native', name: 'request/unsupported', payload: { method } }); return; }
    const key = String(id);
    this.openRequests.set(key, kind);
    this.emitter.emit({ type: 'request', requestKey: key, kind, payload: { method, params }, nodeId: source?.threadId !== this.threadId ? source?.threadId : undefined });
  }

  async respond(requestKey: string, result: unknown) {
    if (!this.rpc) throw new DriverError('STATE', '会话尚未打开');
    const kind = this.openRequests.get(requestKey);
    if (!kind) throw new DriverError('STATE', '请求已结束或不存在');
    if (kind === 'elicitation') requireElicitationCancellation(result);
    const id = /^\d+$/.test(requestKey) ? Number(requestKey) : requestKey;
    this.rpc.reply(id, kind === 'elicitation' ? { action: 'cancel', content: null, _meta: null } : result);
    // 宿主自己的回应不再发 request.resolved：该事件只表示原生侧自行结束（超时、回合结束等）。
    this.openRequests.delete(requestKey);
  }

  async steer(input: TurnInput) {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    const t = this.activeTurn;
    if (!t) throw new DriverError('STATE', '当前没有进行中的回合');
    // expectedTurnId 不匹配当前回合时原生拒绝：不自动改成新回合发送（技术方案 §5）。
    const receipt = await this.rpc.call<{ turnId?: unknown } | null>('turn/steer', { threadId: this.threadId, expectedTurnId: t.nativeTurnId, clientUserMessageId: input.clientInputId, input: [{ type: 'text', text: input.text, text_elements: [] }, ...(input.images ?? []).map(i => ({ type: 'localImage', path: i.path }))] });
    if (receipt?.turnId !== t.nativeTurnId) throw new DriverError('PROTOCOL', '原生插话回执无法关联到当前回合');
    this.emitter.emit({ type: 'steer.accepted', clientInputId: input.clientInputId, nativeTurnId: t.nativeTurnId });
  }

  async command(name: 'compact' | 'review') {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    if (name === 'compact') await this.rpc.call('thread/compact/start', { threadId: this.threadId });
    else await this.rpc.call('review/start', { threadId: this.threadId, target: { type: 'uncommittedChanges' } });
  }

  async goal(op: { kind: 'set'; objective: string } | { kind: 'pause' } | { kind: 'resume' } | { kind: 'clear' }) {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    if (op.kind === 'clear') { await this.rpc.call('thread/goal/clear', { threadId: this.threadId, origin: 'user' }); return; }
    const params = op.kind === 'set' ? { objective: op.objective, status: 'active' } : { status: op.kind === 'pause' ? 'paused' : 'active' };
    await this.rpc.call('thread/goal/set', { threadId: this.threadId, origin: 'user', ...params });
  }
  async goalState() {
    if (!this.rpc || !this.threadId) throw new DriverError('STATE', '会话尚未打开');
    const r = await this.rpc.call<{ goal: { objective: string; status: string; createdAt: number; updatedAt: number } | null }>('thread/goal/get', { threadId: this.threadId });
    return r.goal;
  }
  async nativeChildHistory(nodeId: string) {
    if (!this.rpc || !this.childThreads.has(nodeId)) throw new DriverError('REJECTED', '线程不是本运行创建的原生子 Agent');
    const value = await this.rpc.call<{ thread: { turns?: { id: string; items?: { id: string }[] }[] } }>('thread/read', { threadId: nodeId, includeTurns: true }, 5000);
    return (value.thread.turns ?? []).flatMap(t => (t.items ?? []).map(item => ({ key: `${t.id}:${item.id}`, payload: item })));
  }

  private sendInterrupt(nativeTurnId: string) {
    const turn = this.activeTurn;
    if (turn?.nativeTurnId !== nativeTurnId || !this.rpc) return;
    if (turn.interrupt) return turn.interrupt;
    turn.interrupted = true;
    // 原生开始和宿主派发完成可能同时处理同一次停止，直到回合结束都共用原请求。
    turn.interrupt = this.rpc.call<void>('turn/interrupt', { threadId: this.threadId, turnId: nativeTurnId }, 15_000)
      .catch(error => {
        turn.interrupt = undefined;
        this.emitter.emit({ type: 'diagnostic', message: `中断失败：${(error as Error).message}` });
      });
    return turn.interrupt;
  }

  async interrupt() {
    if (this.activeTurn) return this.sendInterrupt(this.activeTurn.nativeTurnId);
    this.stopPending = true;
  }

  /** 关闭以真实退出为准（复核 CR04）：结束输入后等待；超时依次 SIGTERM、SIGKILL，仍未退出则返回而不冒充已退出（不发 exit）。 */
  async close() {
    const child = this.child;
    if (!child || this.exited) return;
    child.stdin?.end();
    const waitExit = (ms: number) => new Promise<boolean>(resolve => {
      if (this.exited) return resolve(true);
      const t = setTimeout(() => { child.off('exit', on); resolve(this.exited); }, ms);
      const on = () => { clearTimeout(t); resolve(true); };
      child.once('exit', on);
    });
    if (await waitExit(this.closeGraceMs)) return;
    child.kill('SIGTERM');
    if (await waitExit(this.closeGraceMs)) return;
    child.kill('SIGKILL');
    await waitExit(this.closeGraceMs);
  }
}

export const codexAppServerDriver: AgentDriver = { id: 'codex-app-server', command: 'codex', create: () => new CodexAppServerInstance() };
