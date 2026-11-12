import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import {realpathSync} from 'node:fs';
import {join} from 'node:path';
import {boundedJson} from '@shared/application-bridge';
import {ApplicationError as HostError} from '@shared/applications';
import {PLUGIN_HOST_API, PLUGIN_LIMITS, PLUGIN_PROTOCOL, type PluginCapability} from '@shared/plugins';
import {pluginSandboxProfile, type PluginSandboxPaths} from './sandbox';
import {inspectPluginDirectory, type ValidatedPlugin} from './package';
import {ensureStoreDirectory} from '../package-files';
import {pluginExecutionScopeSchema,pluginBusinessErrorSchema,type PluginExecutionScope} from '@shared/plugin-session';

// One shared budget covers all versions and connections; an upgrade may briefly have one old and one new child.
export class PluginProcessBudget {
  private total = 0;
  private readonly plugins = new Map<string, number>();
  constructor(private readonly maximum: number = PLUGIN_LIMITS.hostProcesses, private readonly perPlugin: number = PLUGIN_LIMITS.processesPerPlugin) {
    if (!Number.isSafeInteger(maximum) || maximum < 1 || maximum > PLUGIN_LIMITS.hostProcesses || !Number.isSafeInteger(perPlugin) || perPlugin < 1 || perPlugin > PLUGIN_LIMITS.processesPerPlugin) throw new HostError('INVALID_INPUT', '插件进程预算无效');
  }
  acquire(id: string): () => void {
    const count = this.plugins.get(id) ?? 0;
    if (this.total >= this.maximum || count >= this.perPlugin) throw new HostError('RESOURCE_BUSY', '插件进程数已达上限');
    this.total++; this.plugins.set(id, count + 1); let released = false;
    return () => {if (!released) {released = true; this.total--; const remaining = (this.plugins.get(id) ?? 1) - 1; if (remaining) this.plugins.set(id, remaining); else this.plugins.delete(id);}};
  }
  get active(): number {return this.total;}
}
const budget = new PluginProcessBudget();
interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
  cleanup(): void;
  submitted: boolean;
  write: boolean;
}
export interface PluginProcessOptions extends PluginSandboxPaths {
  executable: string;
  budget?: PluginProcessBudget;
  limits?: Partial<Record<'frameBytes' | 'outputBytes' | 'concurrentCalls' | 'handshakeMs' | 'executeMs', number>>;
  onBeforeSpawn?(): void;
  onSpawn?(pid: number): void;
  onClose?(event: {pid:number|undefined;code:number|null;signal:NodeJS.Signals|null;expected:boolean;errorCode:string|null}): void;
}
interface RpcReply {jsonrpc: '2.0'; id: number; result?: unknown; error?: {code: number; message: string;data?:unknown}}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** An untrusted runtime is never loaded into the main process. This object owns exactly one child generation. */
export class PluginProcess {
  private child: ChildProcessWithoutNullStreams | undefined;
  private initializing: Promise<void> | undefined;
  private closed = false;
  private failure: Error | undefined;
  private stopped: Promise<void> | undefined;
  private closeResolve: (() => void) | undefined;
  private seq = 0;
  private received = 0;
  private buffered: Buffer = Buffer.alloc(0);
  private readonly pending = new Map<number, Pending>();
  private readonly limits;
  constructor(readonly plugin: ValidatedPlugin, private readonly options: PluginProcessOptions) {
    this.limits = {...PLUGIN_LIMITS, ...options.limits};
    for (const key of ['frameBytes', 'outputBytes', 'concurrentCalls', 'handshakeMs', 'executeMs'] as const) {
      const value = this.limits[key];
      if (!Number.isSafeInteger(value) || value < 1 || value > PLUGIN_LIMITS[key]) throw new HostError('INVALID_INPUT', '插件运行限额无效');
    }
  }
  get pid(): number | undefined {return this.child?.pid;}
  get isClosed(): boolean {return this.closed;}
  /** Retire a healthy idle generation before ordinary successive responses exhaust its lifetime quota. */
  get shouldRecycle():boolean {return this.limits.outputBytes-this.received<=this.limits.frameBytes*(this.limits.concurrentCalls+1);}
  private start(): void {
    if (this.closed) throw new HostError('CAPABILITY_UNAVAILABLE', '插件进程已关闭');
    if (process.platform !== 'darwin') throw new HostError('CAPABILITY_UNAVAILABLE', '当前平台的插件沙箱尚不可用，已拒绝启动');
    let profile: string;
    try {profile = pluginSandboxProfile(this.options);} catch {throw new HostError('CAPABILITY_UNAVAILABLE', '插件沙箱准备失败，已拒绝启动');}
    const release = (this.options.budget ?? budget).acquire(this.plugin.manifest.id);
    try {
      const root = realpathSync(this.options.dataRoot), pack = realpathSync(this.options.packageRoot);
      if (inspectPluginDirectory(pack).hash !== this.plugin.hash) throw new HostError('HASH_MISMATCH', '插件包内容已改变，已拒绝执行');
      for (const path of ['home', 'tmp', 'config', 'cache']) ensureStoreDirectory(root, path);
      const env = {
        PATH: '/usr/bin:/bin', HOME: join(root, 'home'), TMPDIR: join(root, 'tmp'),
        XDG_CONFIG_HOME: join(root, 'config'), XDG_CACHE_HOME: join(root, 'cache'),
        XDG_DATA_HOME: root, ELECTRON_RUN_AS_NODE: '1',
        WILLYOU_PLUGIN_DATA: root, WILLYOU_PLUGIN_ID: this.plugin.manifest.id,
      };
      this.options.onBeforeSpawn?.();
      this.child = spawn('/usr/bin/sandbox-exec', ['-p', profile, realpathSync(this.options.executable), join(pack, this.plugin.manifest.runtime.entry)], {cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true});
      this.stopped = new Promise(resolve => {this.closeResolve = resolve;});
      this.child.stdout.on('data', (bytes: Buffer) => this.receive(bytes));
      this.child.stderr.on('data', (bytes: Buffer) => this.output(bytes.length));
      this.child.stdin.on('error', () => this.fail(new HostError('CAPABILITY_UNAVAILABLE', '插件输入通道已关闭')));
      this.child.once('error', () => this.fail(new HostError('CAPABILITY_UNAVAILABLE', '插件沙箱不可用，已拒绝启动')));
      this.child.once('exit', () => this.fail(new HostError('CAPABILITY_UNAVAILABLE', '插件进程异常退出')));
      this.child.once('close', (code,signal) => {
        release();
        try {this.options.onClose?.({pid:this.child?.pid,code,signal,expected:this.failure instanceof HostError&&this.failure.code==='CANCELED',errorCode:this.failure instanceof HostError?this.failure.code:null});}
        catch {/* A failed observer leaves its durable lease unresolved; callers must not delete its resources. */}
        finally {this.closeResolve?.();}
      });
      if(!this.child.pid)throw new HostError('CAPABILITY_UNAVAILABLE','插件沙箱未返回进程身份');
      this.options.onSpawn?.(this.child.pid);
    } catch (error) {
      const failure=error instanceof HostError?error:new HostError('CAPABILITY_UNAVAILABLE','插件沙箱启动失败，未降级执行');
      if(this.child)this.fail(failure);else{release();this.closed=true;this.failure=failure;}
      throw failure;
    }
  }
  private output(bytes: number): boolean {
    this.received += bytes;
    if (this.received <= this.limits.outputBytes) return true;
    this.fail(new HostError('TOO_LARGE', '插件输出总量超过上限')); return false;
  }
  private receive(bytes: Buffer): void {
    if (this.closed || !this.output(bytes.length)) return;
    let offset = 0;
    while (offset < bytes.length) {
      const newline = bytes.indexOf(10, offset), end = newline < 0 ? bytes.length : newline;
      const fragment = bytes.subarray(offset, end);
      if (this.buffered.length + fragment.length > this.limits.frameBytes) {this.fail(new HostError('TOO_LARGE', '插件单帧输出超过上限')); return;}
      this.buffered = Buffer.concat([this.buffered, fragment]);
      if (newline < 0) return;
      const frame = this.buffered; this.buffered = Buffer.alloc(0); offset = newline + 1;
      let reply: unknown;
      try {reply = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(frame));} catch {this.fail(new HostError('INVALID_RESPONSE', '插件返回无效 JSON-RPC')); return;}
      if (!boundedJson(reply) || !object(reply) || reply.jsonrpc !== '2.0' || !Number.isSafeInteger(reply.id) || Object.keys(reply).some(key => !['jsonrpc', 'id', 'result', 'error'].includes(key)) || Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error') || reply.error !== undefined && (!object(reply.error) || !Number.isInteger(reply.error.code) || typeof reply.error.message !== 'string')) {
        this.fail(new HostError('INVALID_RESPONSE', '插件响应不符合协议')); return;
      }
      const result = reply as unknown as RpcReply, pending = this.pending.get(result.id);
      if (!pending) {this.fail(new HostError('INVALID_RESPONSE', '插件响应引用未知调用')); return;}
      this.pending.delete(result.id); pending.cleanup();
      if (result.error){const code=pluginBusinessErrorSchema.safeParse(object(result.error.data)?result.error.data.code:undefined);pending.reject(this.callError(pending,new HostError(code.success?code.data:'CAPABILITY_UNAVAILABLE',code.success?'插件操作未完成（'+code.data+'），请核对当前来源与连接':'插件返回执行错误')));}
      else pending.resolve(result.result);
    }
  }
  private callError(pending: Pick<Pending, 'write' | 'submitted'>, error: Error): Error {
    return pending.write && pending.submitted ? new HostError('UPSTREAM_RESULT_UNKNOWN', '插件写操作结果未知，请核对记录，不要自动重试') : error;
  }
  private fail(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.failure=error;
    for (const pending of this.pending.values()) {pending.cleanup(); pending.reject(this.callError(pending, error));}
    this.pending.clear(); this.buffered = Buffer.alloc(0);
    const child = this.child;
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    const kill = (signal: NodeJS.Signals) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
      try {process.kill(-child.pid, signal);} catch {try {child.kill(signal);} catch {/* Already closed. */}}
    };
    kill('SIGTERM'); const timer = setTimeout(() => kill('SIGKILL'), 250); timer.unref(); child.once('close', () => clearTimeout(timer));
  }
  private request(method: string, params: unknown, write: boolean, timeout: number, signal?: AbortSignal,onSubmit?:()=>void): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new HostError('CANCELED', '插件调用已取消'));
    if (this.closed || !this.child) return Promise.reject(new HostError('CAPABILITY_UNAVAILABLE', '插件进程不可用'));
    if (this.pending.size >= this.limits.concurrentCalls) return Promise.reject(new HostError('RESOURCE_BUSY', '插件并发调用超过上限'));
    if (!boundedJson(params)) return Promise.reject(new HostError('INVALID_INPUT', '插件参数必须是有界 JSON'));
    const id = ++this.seq, bytes = Buffer.from(JSON.stringify({jsonrpc: '2.0', id, method, params}) + '\n');
    if (bytes.length - 1 > this.limits.frameBytes) return Promise.reject(new HostError('TOO_LARGE', '插件请求超过单帧上限'));
    return new Promise((resolve, reject) => {
      const abort = () => this.fail(new HostError('CANCELED', '插件调用已取消'));
      const timer = setTimeout(() => this.fail(new HostError('TIMEOUT', method === 'initialize' ? '插件握手超时' : '插件执行超时')), timeout);
      const pending: Pending = {resolve, reject, submitted: false, write, cleanup: () => {clearTimeout(timer); signal?.removeEventListener('abort', abort);}};
      this.pending.set(id, pending); signal?.addEventListener('abort', abort, {once: true});
      if (signal?.aborted) {abort(); return;}
      try{onSubmit?.();}catch(error){this.pending.delete(id);pending.cleanup();reject(error);return;}
      pending.submitted = true;
      try {this.child!.stdin.write(bytes, error => {if (error) this.fail(new HostError('CAPABILITY_UNAVAILABLE', '插件输入通道不可用'));});}
      catch {this.fail(new HostError('CAPABILITY_UNAVAILABLE', '插件输入通道不可用'));}
    });
  }
  async initialize(signal?:AbortSignal): Promise<void> {
    if (!this.initializing) this.initializing = (async () => {
      this.start();
      const reply = await this.request('initialize', {hostApi: PLUGIN_HOST_API, protocol: PLUGIN_PROTOCOL}, false, this.limits.handshakeMs,signal);
      if (!object(reply) || reply.protocol !== PLUGIN_PROTOCOL || reply.plugin !== this.plugin.manifest.id || reply.version !== this.plugin.manifest.version) {
        const error = new HostError('HOST_INCOMPATIBLE', '插件握手版本或身份不符'); this.fail(error); throw error;
      }
    })();
    return this.initializing;
  }
  private async ready(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new HostError('CANCELED', '插件调用已取消');
    const abort = () => this.fail(new HostError('CANCELED', '插件调用已取消'));
    signal?.addEventListener('abort', abort, {once: true});
    try {await this.initialize();} finally {signal?.removeEventListener('abort', abort);}
  }
  async verify(provider: string, config: unknown, secret?: string, signal?: AbortSignal,authMode?:string): Promise<unknown> {
    if (!boundedJson(config) || !this.plugin.providers.get(provider)?.(config).valid) throw new HostError('INVALID_INPUT', '插件连接不符合声明');
    if (signal?.aborted) throw new HostError('CANCELED', '插件调用已取消');
    const declared=this.plugin.manifest.providers.find(p=>p.id===provider);
    if(authMode!==undefined&&(!declared?.secret||!(declared.secret.modes??['secret']).includes(authMode)))throw new HostError('INVALID_INPUT','插件认证方式不符合声明');
    await this.ready(signal);
    return this.request('verify', {provider, config, ...(authMode===undefined?{}:{authMode}), ...(secret === undefined ? {} : {secret})}, false, this.limits.executeMs, signal);
  }
  async execute(id: string, input: unknown, connection: unknown, signal?: AbortSignal,onSubmit?:()=>void,scope?:PluginExecutionScope): Promise<unknown> {
    const capability: PluginCapability | undefined = this.plugin.manifest.capabilities[id], contract = this.plugin.contracts.get(id);
    if (!capability || !contract) throw new HostError('CAPABILITY_UNAVAILABLE', '插件未声明该能力');
    if (!boundedJson(input) || !boundedJson(connection) || !contract.input(input).valid) throw new HostError('INVALID_INPUT', '插件参数不符合声明');
    if (signal?.aborted) throw new HostError('CANCELED', '插件调用已取消');
    if(scope!==undefined&&!pluginExecutionScopeSchema.safeParse(scope).success)throw new HostError('INVALID_INPUT','插件调用缺少有效宿主作用域');
    await this.ready(signal);
    const result = await this.request('execute', {capability: id, input, connection,...(scope?{scope}:{})}, capability.semantics !== 'read', this.limits.executeMs, signal,onSubmit);
    if (!contract.output(result).valid) throw this.callError({write: capability.semantics !== 'read', submitted: true}, new HostError('INVALID_RESPONSE', '插件返回结果不符合声明'));
    return result;
  }
  async close(): Promise<void> {
    this.fail(new HostError('CANCELED', '插件进程已停止'));
    await this.stopped;
  }
}
