import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { z } from 'zod';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverModel, type DriverOpenOptions, type TurnInput } from '../driver';
import { JsonlRpcPeer, type RpcHandlers } from '../jsonl-rpc';
import { startGeminiResponseRelay } from './gemini-response-relay';

const protocolVersion = 1;
const authMethod = 'gemini-api-key';
const initializeOptions = { protocolVersion, clientInfo: { name: 'WillYou', version: '1' }, clientCapabilities: {} };
const sessionIdSchema = z.string().regex(/^[a-zA-Z0-9_-]{1,256}$/);
const capabilitiesSchema = z.object({
  protocolVersion: z.literal(protocolVersion),
  authMethods: z.array(z.object({ id: z.string() })).default([]),
  agentCapabilities: z.object({
    mcpCapabilities: z.object({}).passthrough().optional(),
    sessionCapabilities: z.object({ resume: z.object({}).optional() }).optional(),
  }).optional(),
});
const valueSchema = z.object({ value: z.string(), name: z.string().optional() });
const optionSchema = z.object({
  id: z.string(), category: z.string().optional(), type: z.literal('select'), currentValue: z.string(),
  options: z.array(z.union([valueSchema, z.object({ options: z.array(valueSchema) })])),
});
const permissionSchema = z.object({
  sessionId: z.string(),
  toolCall: z.object({ title: z.string().optional(), rawInput: z.unknown().optional() }),
  options: z.array(z.object({ optionId: z.string(), kind: z.string() })),
});
type ConfigOption = z.infer<typeof optionSchema>;
type Permission = z.infer<typeof permissionSchema>;
type ActiveTurn = { id: string; text: string; thoughts: string; model?: string; cancelling: boolean; nativeLogOffset: number };

export function antigravityArgs(configDir: string) {
  return ['acp', '--gemini-dir', configDir, '--app-data-dir', 'antigravity-acp',
    '--disable-telemetry=true', '--include-default-customizations=false', '--sandbox=true'];
}

function acpProcess(executable: string, args: readonly string[], cwd: string, env: NodeJS.ProcessEnv,
  handlers: RpcHandlers, onExit?: (code: number | null, signal: NodeJS.Signals | null) => void) {
  const child = spawn(executable, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
  const peer = new JsonlRpcPeer(child.stdout, child.stdin, handlers, 12_000, '2.0');
  const started = new Promise<number>((resolve, reject) => {
    child.once('spawn', () => resolve(child.pid!));
    child.once('error', reject);
  });
  let closed = false;
  const ended = new Promise<void>(resolve => child.once('close', (code, signal) => {
    closed = true;
    peer.close(new DriverError('EXITED', 'Antigravity ACP 进程已退出'));
    onExit?.(code, signal);
    resolve();
  }));
  child.once('error', error => peer.close(error));
  child.stdin.on('error', error => peer.close(error));
  child.stderr.resume();
  let closing: Promise<void> | undefined;
  const stop = async () => {
    if (closed) return;
    child.stdin.end();
    if (await Promise.race([ended.then(() => true), wait(350, false, { ref: false })])) return;
    if (!closed) child.kill('SIGTERM');
    if (await Promise.race([ended.then(() => true), wait(900, false, { ref: false })])) return;
    if (!closed) child.kill('SIGKILL');
    await ended;
  };
  return {
    peer, started,
    close: () => closing ??= stop(),
  };
}

export async function inspectAntigravity(executable: string, home: string, env: NodeJS.ProcessEnv) {
  const process = acpProcess(executable, antigravityArgs(home), home, env, { request() {}, notification() {} });
  try {
    await process.started;
    const init = capabilitiesSchema.safeParse(await process.peer.call('initialize', initializeOptions, 3500));
    if (!init.success) throw new DriverError('PROTOCOL', 'Antigravity ACP 协议不兼容');
    // A malformed request exercises dispatch without creating a session or sending any model input.
    const recognizes = async (method: string) => {
      try { await process.peer.call(method, { cwd: 42 }, 2200); return false; }
      catch (error) { return error instanceof DriverError && error.nativeCode !== undefined && error.nativeCode !== -32601; }
    };
    const mcp = process.peer.call('session/new', { cwd: home, mcpServers: 42 }, 2200)
      .then(() => false, error => error instanceof DriverError && error.nativeCode === -32602 && /mcpServers/i.test(error.message));
    const [basic, resume, typedMcp] = await Promise.all([recognizes('session/new'), recognizes('session/resume'), mcp]);
    if (!basic) throw new DriverError('UNSUPPORTED', 'Antigravity 缺少新建会话能力');
    if (!init.data.authMethods.some(method => method.id === authMethod)) {
      throw new DriverError('UNSUPPORTED', 'Antigravity 未提供 Gemini API Key 认证');
    }
    return { basic, resume, mcp: typedMcp || init.data.agentCapabilities?.mcpCapabilities !== undefined };
  } finally {
    await process.close();
  }
}

function configValues(option: ConfigOption): string[] {
  return option.options.flatMap(value => 'options' in value ? value.options.map(item => item.value) : [value.value]);
}

class AntigravityInstance implements DriverInstance {
  readonly driverId = 'antigravity-acp' as const;
  private readonly events = new Emitter();
  private opening?: AbortController;
  private process?: ReturnType<typeof acpProcess>;
  private session?: string;
  private turn?: ActiveTurn;
  private config: ConfigOption[] = [];
  private history?: string;
  private geminiDirectory?: string;
  private tier: TurnInput['tier'] = 'ask';
  private readonly requests = new Map<string, { id: string | number; options: Permission['options'] }>();

  on(listener: Parameters<DriverInstance['on']>[0]) { return this.events.on(listener); }

  async open(options: DriverOpenOptions) {
    if (this.opening || this.process) throw new DriverError('STATE', 'Antigravity 会话已经启动');
    if (options.readOnly) throw new DriverError('UNSUPPORTED', 'Antigravity 尚无已验证的只读执行能力');
    options.assertStarting?.();
    const args = options.extraArgs ?? ['acp'];
    const directoryFlag = args.indexOf('--gemini-dir');
    this.geminiDirectory = directoryFlag < 0 ? undefined : args[directoryFlag + 1];
    const opening = this.opening = new AbortController();
    const abort = () => { void this.close(); };
    let relay: Awaited<ReturnType<typeof startGeminiResponseRelay>> | undefined;
    options.startupSignal?.addEventListener('abort', abort, { once: true });
    try {
      options.startupSignal?.throwIfAborted();
      if (options.env.GOOGLE_GEMINI_BASE_URL && options.env.GEMINI_API_KEY) {
        relay = await startGeminiResponseRelay(options.env.GOOGLE_GEMINI_BASE_URL, options.env);
      }
      opening.signal.throwIfAborted();
      options.assertStarting?.();
      const env = relay ? { ...options.env, GOOGLE_GEMINI_BASE_URL: relay.endpoint } : options.env;
      const process = this.process = acpProcess(options.executable.path, args, options.cwd, env, {
        request: (id, method, params) => this.request(id, method, params),
        notification: (method, params) => this.notification(method, params),
      }, (code, signal) => {
        relay?.close();
        this.events.emit({ type: 'exit', code, signal });
      });
      this.events.emit({ type: 'process', pid: await process.started });
      await options.beforeInitialize?.();
      options.assertStarting?.();
      const init = capabilitiesSchema.safeParse(await process.peer.call('initialize', initializeOptions));
      if (!init.success) throw new DriverError('UNSUPPORTED', 'Antigravity 未确认可用的 ACP v1 协议');
      if (!options.env.GEMINI_API_KEY || !init.data.authMethods.some(method => method.id === authMethod)) {
        throw new DriverError('UNSUPPORTED', '当前 Antigravity 会话无法使用供应商 Gemini API Key');
      }
      await process.peer.call('authenticate', { methodId: authMethod });
      await options.beforeThreadOpen?.();
      options.assertStarting?.();
      const mcpServers = Object.entries(options.mcpServers ?? {}).map(([name, server]) => ({
        name, command: server.command, args: server.args,
        env: Object.entries(server.env ?? {}).map(([name, value]) => ({ name, value })),
      }));
      const previous = options.resumeNativeId && sessionIdSchema.parse(options.resumeNativeId);
      const reply = await process.peer.call<{ sessionId?: string; configOptions?: unknown[] }>(
        previous ? 'session/resume' : 'session/new',
        { cwd: options.cwd, mcpServers, ...(previous ? { sessionId: previous } : {}) },
      );
      this.session = sessionIdSchema.parse(reply.sessionId ?? previous);
      if (previous && previous !== this.session) throw new DriverError('PROTOCOL', 'Antigravity 恢复返回了其他会话');
      this.updateConfig(reply.configOptions);
      const model = this.option('model');
      if (options.model) await this.selectModel(options.model);
      this.events.emit({ type: 'session', nativeId: this.session });
      return { nativeId: this.session, confirmed: true, defaultModel: options.model ?? model?.currentValue };
    } catch (error) {
      relay?.close();
      await this.process?.close();
      throw error;
    } finally {
      this.opening = undefined;
      options.startupSignal?.removeEventListener('abort', abort);
    }
  }

  async injectHistory(text: string) { this.history = text; }

  async inspectModels(ids: readonly string[]): Promise<DriverModel[]> {
    const catalog = this.option('model');
    if (!catalog) return [];
    const allowed = new Set(configValues(catalog));
    const results: DriverModel[] = [];
    for (const id of ids) {
      if (!allowed.has(id)) continue;
      await this.selectModel(id);
      const effort = this.option('thought_level');
      results.push({ id, name: id, efforts: effort ? configValues(effort).filter(value => value.length <= 24).slice(0, 12) : [],
        defaultEffort: effort?.currentValue, isDefault: id === catalog.currentValue });
    }
    return results;
  }

  async startTurn(input: TurnInput) {
    if (!this.process || !this.session || this.turn) throw new DriverError('STATE', 'Antigravity 会话尚未就绪');
    if (input.model) await this.selectModel(input.model);
    const effort = this.option('thought_level');
    const availableEfforts = effort ? configValues(effort) : [];
    const requestedEffort = input.effort;
    const effortUnavailable = !!requestedEffort && !availableEfforts.includes(requestedEffort);
    if (effort && requestedEffort && !effortUnavailable) await this.select(effort, requestedEffort);
    const text = this.history ? `${this.history}\n\n${input.text}` : input.text;
    const prompt: Record<string, string>[] = [{ type: 'text', text }];
    for (const image of input.images ?? []) {
      prompt.push({ type: 'image', mimeType: image.mime, data: (await readFile(image.path)).toString('base64') });
    }
    this.history = undefined;
    this.tier = input.tier;
    const turn = this.turn = { id: randomUUID(), model: this.option('model')?.currentValue ?? input.model, text: '', thoughts: '', cancelling: false,
      nativeLogOffset: this.latestNativeStep()?.idx ?? -1 };
    this.events.emit({ type: 'turn.started', nativeTurnId: turn.id, clientInputId: input.clientInputId });
    if (effortUnavailable) {
      const nativeEffort = effort && availableEfforts.includes(effort.currentValue) ? effort.currentValue : undefined;
      const detail = nativeEffort
        ? `当前模型未公布所选档位 ${requestedEffort}，本轮使用原生档位 ${nativeEffort}。可以重新选择。`
        : `当前模型未公布所选档位 ${requestedEffort}，也没有可用的原生默认档位，本轮未设置推理档位。`;
      this.events.emit({ type: 'item.completed', nativeItemId: `${turn.id}:effort`, itemType: 'acpEffortFallback', payload: { detail } });
    }
    void this.process.peer.call<{ stopReason?: string }>('session/prompt', { sessionId: this.session, prompt }, 15 * 60_000)
      .then(reply => this.finish(turn, reply.stopReason), error => this.finish(turn, undefined, error));
    return { nativeTurnId: turn.id };
  }

  async setTurnTier(_current: TurnInput['tier'], next: TurnInput['tier']) {
    if (!this.turn || this.turn.cancelling || next === 'auto') return false;
    this.tier = next;
    return true;
  }

  private finish(turn: ActiveTurn, reason?: string, error?: Error) {
    if (this.turn !== turn) return;
    if (turn.text) this.events.emit({ type: 'item.completed', nativeItemId: turn.id, itemType: 'agentMessage', payload: { text: turn.text, model: turn.model } });
    if (turn.thoughts) this.events.emit({ type: 'item.completed', nativeItemId: `${turn.id}:thoughts`, itemType: 'reasoning', payload: { text: turn.thoughts } });
    for (const key of this.requests.keys()) this.events.emit({ type: 'request.resolved', requestKey: key });
    this.requests.clear();
    this.turn = undefined;
    const step = this.latestNativeStep();
    const nativeFailure = step?.type === 17 && step.idx > turn.nativeLogOffset;
    const httpStatus = nativeFailure ? step.httpStatus : undefined;
    const limited = reason === 'max_tokens' || (nativeFailure && step.outputRetriesExhausted) ? 'output' :
      httpStatus === 429 ? 'rate' : undefined;
    const failureMessage = limited === 'output' ? '已达到模型输出上限，可继续发送' :
      limited === 'rate' ? 'Gemini 请求受限（HTTP 429）' :
      nativeFailure ? `Gemini 上游请求失败${httpStatus ? `（HTTP ${httpStatus}）` : ''}` :
      error?.message ?? `Antigravity：${reason ?? '未确认回合结束'}`;
    const unknown = error instanceof DriverError && ['TIMEOUT', 'EXITED'].includes(error.code);
    const status = reason === 'cancelled' ? 'interrupted' : reason === 'end_turn' && !nativeFailure ? 'completed' : unknown ? 'unknown' : 'failed';
    if (limited && status === 'failed') this.events.emit({ type: 'item.completed', nativeItemId: `${turn.id}:limit`, itemType: 'acpError',
      payload: { code: limited === 'output' ? 'max_output_tokens' : 'rate_limit_rejected', message: failureMessage, limited: { kind: limited } } });
    this.events.emit({ type: 'turn.completed', nativeTurnId: turn.id, status, error: status === 'failed' || status === 'unknown' ? failureMessage : undefined });
    if (error instanceof DriverError && error.code === 'TIMEOUT') this.events.emit({ type: 'unusable', reason: 'Antigravity 回合未返回终态' });
  }

  private latestNativeStep(): { idx: number; type: number; httpStatus?: number; outputRetriesExhausted: boolean } | undefined {
    if (!this.geminiDirectory || !this.session) return;
    const file = join(this.geminiDirectory, 'antigravity-acp', 'conversations', `${this.session}.db`);
    try {
      const path = realpathSync(file);
      if (!path.startsWith(realpathSync(this.geminiDirectory) + sep) || !lstatSync(file).isFile()) return;
      const database = new Database(path, { readonly: true, fileMustExist: true, timeout: 50 });
      try {
        const step = database.prepare('SELECT idx, step_type AS type, CASE WHEN step_type=17 THEN substr(step_payload,1,16384) END AS failure FROM steps ORDER BY idx DESC LIMIT 1')
          .get() as { idx: number; type: number; failure: Buffer | null } | undefined;
        if (!step) return;
        const failure = step.failure?.toString('utf8') ?? '';
        const http = /\b(?:Error|HTTP) ([45][0-9]{2})\b/.exec(failure);
        // agy can finish an exhausted output retry with ACP end_turn and a terminal native error.
        const outputRetriesExhausted = failure.includes('exceeded the output token limit') &&
          /\bOutput retries exhausted after \d+ attempts\b/.test(failure);
        return { idx: step.idx, type: step.type, outputRetriesExhausted, ...(http ? { httpStatus: Number(http[1]) } : {}) };
      } finally { database.close(); }
    } catch { /* Some ACP implementations do not use Antigravity's optional local evidence format. */ }
  }

  private updateConfig(options: unknown[] | undefined) {
    if (!Array.isArray(options)) return;
    this.config = options.flatMap(value => {
      const option = optionSchema.safeParse(value);
      return option.success ? [option.data] : [];
    });
  }
  private option(category: string) { return this.config.find(option => option.id === category || option.category === category); }
  private async selectModel(model: string) {
    const option = this.option('model');
    if (!option || !configValues(option).includes(model)) throw new DriverError('REJECTED', '当前 Antigravity 会话未提供选定模型，请重新选择');
    await this.select(option, model);
  }
  private async select(option: ConfigOption, value: string) {
    if (option.currentValue === value) return;
    const reply = await this.process!.peer.call<{ configOptions?: unknown[] }>('session/set_config_option',
      { sessionId: this.session, configId: option.id, value });
    this.updateConfig(reply.configOptions);
    if (this.config.find(item => item.id === option.id)?.currentValue !== value) throw new DriverError('PROTOCOL', 'Antigravity 未确认所选模型或档位');
  }
  private notification(method: string, params: unknown) {
    if (method !== 'session/update') return;
    const payload = params as { sessionId?: string; update?: Record<string, unknown> } | null;
    const update = payload?.update;
    if (!update || payload?.sessionId !== this.session) return;
    if (update.sessionUpdate === 'config_option_update') this.updateConfig(update.configOptions as unknown[]);
    const turn = this.turn;
    if (!turn) return;
    const content = update.content as { type?: string; text?: string } | undefined;
    if (update.sessionUpdate === 'agent_message_chunk' && content?.type === 'text' && typeof content.text === 'string') {
      turn.text += content.text;
      this.events.emit({ type: 'message.delta', nativeItemId: turn.id, text: content.text });
    } else if (update.sessionUpdate === 'agent_thought_chunk' && typeof content?.text === 'string') {
      turn.thoughts += content.text;
    } else if ((update.sessionUpdate === 'tool_call' || update.sessionUpdate === 'tool_call_update') && typeof update.toolCallId === 'string') {
      this.events.emit({ type: 'item.completed', nativeItemId: `${turn.id}:tool:${update.toolCallId}`, itemType: 'acpToolCall', payload: update });
    }
  }
  private request(id: string | number, method: string, params: unknown) {
    const peer = this.process!.peer;
    if (method !== 'session/request_permission') {
      peer.replyError(id, -32601, 'WillYou does not implement this ACP client method');
      return;
    }
    const result = permissionSchema.safeParse(params);
    const key = this.turn ? `${this.turn.id}:${id}` : '';
    if (!key || this.turn?.cancelling || !result.success || result.data.sessionId !== this.session || this.requests.has(key)) {
      peer.reply(id, { outcome: { outcome: 'cancelled' } });
      return;
    }
    const { toolCall, options } = result.data;
    const allow = options.find(option => option.kind === 'allow_once');
    if (this.tier === 'full' && allow) {
      peer.reply(id, { outcome: { outcome: 'selected', optionId: allow.optionId } });
      return;
    }
    this.requests.set(key, { id, options });
    this.events.emit({ type: 'request', requestKey: key, kind: 'tool_approval', payload: {
      name: toolCall.title ?? 'Antigravity', input: toolCall.rawInput, canApprove: !!allow,
    } });
  }

  async respond(key: string, decision: unknown) {
    const request = this.requests.get(key);
    if (!request || !this.turn || this.turn.cancelling) throw new DriverError('REJECTED', 'Antigravity 审批已失效');
    const behavior = (decision as { behavior?: unknown } | null)?.behavior;
    if (behavior !== 'allow' && behavior !== 'deny') throw new DriverError('REJECTED', 'Antigravity 审批决定不可用');
    const option = request.options.find(item => item.kind === (behavior === 'allow' ? 'allow_once' : 'reject_once'));
    if (!option && behavior === 'allow') throw new DriverError('REJECTED', 'Antigravity 未提供批准一次的选项');
    this.process!.peer.reply(request.id, { outcome: option ? { outcome: 'selected', optionId: option.optionId } : { outcome: 'cancelled' } });
    this.requests.delete(key);
  }
  async interrupt() {
    if (!this.turn || this.turn.cancelling) return;
    this.turn.cancelling = true;
    this.process!.peer.notify('session/cancel', { sessionId: this.session });
    for (const [key, request] of this.requests) {
      this.process!.peer.reply(request.id, { outcome: { outcome: 'cancelled' } });
      this.events.emit({ type: 'request.resolved', requestKey: key });
    }
    this.requests.clear();
  }
  async close() {
    this.opening?.abort();
    await this.process?.close();
  }
}

export const antigravityAcpDriver: AgentDriver = {
  id: 'antigravity-acp', command: 'agy', create: () => new AntigravityInstance(),
};

export async function previewAntigravityModels(options: DriverOpenOptions, models: readonly string[]) {
  const driver = new AntigravityInstance();
  const signal = options.startupSignal;
  const abort = () => { void driver.close(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new DriverError('STATE', 'Antigravity 模型查询已取消');
    await driver.open(options);
    return await driver.inspectModels(models);
  } finally {
    signal?.removeEventListener('abort', abort);
    await driver.close();
  }
}
