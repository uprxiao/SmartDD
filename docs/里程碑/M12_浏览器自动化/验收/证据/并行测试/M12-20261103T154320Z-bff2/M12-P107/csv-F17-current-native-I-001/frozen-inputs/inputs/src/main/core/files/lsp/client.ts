import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtemp, realpath, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { CancellationTokenSource, createMessageConnection, StreamMessageWriter, ResponseError, ErrorCodes, type MessageConnection } from 'vscode-jsonrpc/node';
import { LSP_LIMITS, type LanguageServerConfiguration, type LspCapabilities, type LspKind } from '@shared/file-lsp';
import { LspMessageReader } from './reader';
export class LspClient {
  readonly capabilities: LspCapabilities = { hover: false, locationKinds: [] };
  serverName: string;
  private closed = false;
  private closing: Promise<void> | null = null;
  private failure: Error | null = null;
  private readonly requests = new Set<CancellationTokenSource>();
  private constructor(private readonly child: ChildProcessWithoutNullStreams, private readonly connection: MessageConnection, private readonly home: string, private readonly root: string, name: string) {
    this.serverName = name;
    connection.onError(([error]) => this.fail(error));
    connection.onClose(() => { if (!this.closed) this.fail(new Error('语言服务连接已关闭')); });
    child.on('error', error => this.fail(error)); child.on('exit', () => { if (!this.closed && !this.closing) this.fail(new Error('语言服务进程已退出')); });
    // No diagnostic stream is accumulated; only allowlisted read-only queries
    // are exposed by the host. Server-to-client mutations are rejected.
    child.stderr.on('data', () => undefined);
    connection.onRequest((method: string, params: unknown) => {
      if (method === 'workspace/configuration') return Array.isArray((params as { items?: unknown[] })?.items) ? (params as { items: unknown[] }).items.map(() => ({})) : [];
      if (method === 'workspace/workspaceFolders') return [{ uri: pathToFileURL(root).href, name: 'workspace' }];
      if (method === 'window/workDoneProgress/create') return null;
      if (method === 'workspace/applyEdit') return { applied: false, failureReason: '此语言服务通道只读' };
      throw new ResponseError(ErrorCodes.MethodNotFound, '此语言服务通道不提供该宿主能力');
    });
    connection.onNotification(() => undefined); connection.listen();
  }
  static async start(configuration: LanguageServerConfiguration, root: string, signal?: AbortSignal): Promise<LspClient> {
    if (!isAbsolute(configuration.command) || configuration.command.includes('\0')) throw new Error('语言服务须显式配置本机可执行文件的绝对路径');
    const command = await realpath(configuration.command); await access(command, constants.X_OK);
    const home = await mkdtemp(join(tmpdir(), 'willyou-lsp-'));
    let client: LspClient | undefined;
    try {
      const child = spawn(command, configuration.args, { cwd: root, detached: process.platform !== 'win32', windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], env: { PATH: `${dirname(command)}:/usr/bin:/bin`, HOME: home, TMPDIR: home, XDG_CONFIG_HOME: home, PYTHONNOUSERSITE: '1', LANG: 'en_US.UTF-8', ELECTRON_RUN_AS_NODE: '1' } });
      client = new LspClient(child, createMessageConnection(new LspMessageReader(child.stdout), new StreamMessageWriter(child.stdin)), home, root, configuration.name);
      const abort = () => client!.fail(new Error('语言服务初始化已取消'));
      signal?.addEventListener('abort', abort, { once: true });
      try { if (signal?.aborted) abort(); await client.initialize(); }
      finally { signal?.removeEventListener('abort', abort); }
      return client;
    } catch (error) { if (client) await client.dispose(); else await rm(home, { recursive: true, force: true }); throw error; }
  }
  private async initialize(): Promise<void> {
    const result = await this.request('initialize', { processId: process.pid, rootUri: pathToFileURL(this.root).href, workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: 'workspace' }], capabilities: { general: { positionEncodings: ['utf-16'] }, workspace: { applyEdit: false, configuration: true, workspaceFolders: true }, textDocument: { synchronization: { dynamicRegistration: false }, hover: { dynamicRegistration: false, contentFormat: ['plaintext'] }, definition: { dynamicRegistration: false, linkSupport: true }, typeDefinition: { dynamicRegistration: false, linkSupport: true }, implementation: { dynamicRegistration: false, linkSupport: true }, references: { dynamicRegistration: false } } } }, undefined, LSP_LIMITS.initializeMs) as { capabilities?: Record<string, unknown>; serverInfo?: { name?: string; version?: string } };
    const capabilities = result?.capabilities;
    if (!capabilities || capabilities.positionEncoding && capabilities.positionEncoding !== 'utf-16') throw new Error('语言服务未协商 UTF-16 位置编码');
    this.capabilities.hover = Boolean(capabilities.hoverProvider);
    this.capabilities.locationKinds = (['definition', 'typeDefinition', 'implementation', 'references'] as LspKind[]).filter(kind => Boolean(capabilities[`${kind}Provider`]));
    if (result.serverInfo) this.serverName = `${result.serverInfo.name ?? this.serverName}${result.serverInfo.version ? ` ${result.serverInfo.version}` : ''}`.slice(0, 512);
    this.notify('initialized', {});
  }
  private check(method: string, params: unknown): void {
    if (this.failure || this.closed) throw this.failure ?? new Error('语言服务已关闭');
    if (Buffer.byteLength(JSON.stringify({ jsonrpc: '2.0', method, params, id: Number.MAX_SAFE_INTEGER }), 'utf8') > LSP_LIMITS.frameBytes) throw new Error('语言服务消息超过 1 MiB 限制；仍可浏览和编辑源码');
  }
  notify(method: string, params: unknown): void { this.check(method, params); void this.connection.sendNotification(method, params).catch(error => this.fail(error)); }
  async request(method: string, params: unknown, signal?: AbortSignal, timeout: number = LSP_LIMITS.requestMs): Promise<unknown> {
    this.check(method, params);
    if (signal?.aborted) throw new Error('语言服务请求已取消');
    const cancellation = new CancellationTokenSource(); this.requests.add(cancellation);
    let rejectAbort!: (error: Error) => void;
    const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const abort = () => { cancellation.cancel(); rejectAbort(new Error('语言服务请求已取消')); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { cancellation.cancel(); rejectAbort(new Error(`语言服务请求超时：${method}`)); }, timeout);
    try { return await Promise.race([this.connection.sendRequest(method, params, cancellation.token), cancelled]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); cancellation.dispose(); this.requests.delete(cancellation); }
  }
  private kill(): void {
    if (!this.child.pid) return;
    try { if (process.platform === 'win32') this.child.kill(); else process.kill(-this.child.pid, 'SIGKILL'); } catch { /* already exited */ }
  }
  private fail(error: unknown): void {
    if (this.closed || this.failure) return;
    this.failure = error instanceof Error ? error : new Error(String(error));
    this.kill(); this.connection.dispose();
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const started = Date.now();
      if (!this.failure && !this.closed) { try { await this.request('shutdown', null, undefined, LSP_LIMITS.closeMs); this.notify('exit', null); } catch { /* kill owned process group below */ } }
      if (!this.failure && this.child.exitCode === null && this.child.signalCode === null) await new Promise<void>(resolve => {
        const finish = () => { clearTimeout(timer); this.child.off('exit', finish); resolve(); };
        const timer = setTimeout(finish, Math.max(0, LSP_LIMITS.closeMs - (Date.now() - started))); this.child.once('exit', finish);
      });
      this.closed = true; for (const request of this.requests) request.cancel(); this.requests.clear();
      this.kill(); this.connection.dispose(); this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy();
      await rm(this.home, { recursive: true, force: true });
    })();
    return this.closing;
  }
}
