// Discovery/session translation adapted from Orca bd9455b6165, MIT, Copyright (c) 2026 Lovecast Inc.
// WillYou adds a capability URL and enforces page/iframe ownership before forwarding.
import { randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { WebContents } from 'electron';
import { WebSocket, WebSocketServer } from 'ws';
import { BrowserError } from './errors';

export type CdpParams = Record<string, unknown>;
export type CdpSend = <T = CdpParams>(method: string, params?: CdpParams, sessionId?: string) => Promise<T>;
export type CdpEvent = { method: string; params: CdpParams; sessionId?: string };
export interface BrowserAXTree { sessionId?: string; frameId?: string; nodes: BrowserAXNode[] }
export interface BrowserAXNode { nodeId: string; childIds?: string[]; ignored?: boolean; backendDOMNodeId?: number; role?: { value: string }; name?: { value: string }; frameId?: string }
type Client = { socket: WebSocket; pageSessions: Set<string>; browserSessions: Set<string>; primary?: string };

/** The only debugger attachment for a page. Host commands and helper traffic share it. */
export class BrowserCdpProxy {
  private server?: Server;
  private sockets?: WebSocketServer;
  private clients = new Set<Client>();
  private frameSessions = new Map<string, CdpParams>();
  private listeners = new Set<(event: CdpEvent) => void>();
  private port = 0;
  private stopped = false;
  private readonly token = randomBytes(32).toString('hex');
  private readonly targetId = 'wy-page-' + randomBytes(12).toString('hex');
  private ordinal = 0;
  private readonly mouseInputs=new Set<Promise<unknown>>();
  private capture?: BrowserAXTree[];
  private frameInitializer?: (sessionId: string) => Promise<void>;
  private frameInitializations = new Map<string, Promise<void>>();
  constructor(readonly contents: WebContents, private readonly trace: (event: CdpParams) => void = () => {}) {}
  get endpoint(): string { return `ws://127.0.0.1:${this.port}/${this.token}`; }
  get discoveryEndpoint(): string { return `http://127.0.0.1:${this.port}/${this.token}`; }
  get sessions(): ReadonlyMap<string, CdpParams> { return this.frameSessions; }
  onEvent(listener: (event: CdpEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  captureSnapshot(): { trees: BrowserAXTree[]; finish: () => void } {
    if (this.capture) throw new BrowserError('BROWSER_ERROR', '快照读取已经在进行');
    const trees: BrowserAXTree[] = []; this.capture = trees;
    return { trees, finish: () => { if (this.capture === trees) this.capture = undefined; } };
  }
  initializeFrames(work: (sessionId: string) => Promise<void>): void { this.frameInitializer = work; }
  async frameReady(sessionId?: string): Promise<void> { if (sessionId) await this.frameInitializations.get(sessionId); }

  readonly send: CdpSend = async <T = CdpParams>(method: string, params: CdpParams = {}, sessionId?: string): Promise<T> => {
    if (this.stopped || this.contents.isDestroyed()) throw new BrowserError('BROWSER_TAB_CLOSED', '网页已经关闭');
    if (sessionId && !this.frameSessions.has(sessionId)) throw new BrowserError('BROWSER_TAB_CHANGED', '网页框架会话已经失效');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const native=(sessionId?this.contents.debugger.sendCommand(method,params,sessionId):this.contents.debugger.sendCommand(method,params)) as Promise<T>;
      if(method==='Input.dispatchMouseEvent'){
        this.mouseInputs.add(native);
        void native.then(()=>{this.mouseInputs.delete(native);},()=>{this.mouseInputs.delete(native);});
      }
      return await Promise.race([
        native,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new BrowserError('BROWSER_TIMEOUT', `CDP ${method} 超时`)), 10000); }),
      ]);
    } finally { clearTimeout(timer); }
  };

  async waitForInputCompletion():Promise<void>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      await Promise.race([
        (async()=>{while(this.mouseInputs.size)await Promise.allSettled([...this.mouseInputs]);})(),
        new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new BrowserError('BROWSER_TIMEOUT','原生鼠标输入仍未确认结束，保留旧引用守卫')),10000);}),
      ]);
    }finally{clearTimeout(timer);}
  }

  private trusted(request: IncomingMessage): boolean {
    return request.socket.remoteAddress === '127.0.0.1' && request.headers.host === `127.0.0.1:${this.port}` &&
      !request.headers.origin && !request.headers['sec-fetch-site'];
  }
  private target(): CdpParams {
    return { targetId: this.targetId, type: 'page', title: this.contents.getTitle(), url: this.contents.getURL(), attached: true, canAccessOpener: false, browserContextId: 'wy-page-context' };
  }
  private emit(client: Client, value: unknown): void { if (client.socket.readyState === WebSocket.OPEN) client.socket.send(JSON.stringify(value)); }
  private readonly message = (_event: unknown, method: string, params: CdpParams, sessionId: string): void => {
    // Target.setAutoAttach is issued against this page, never the browser target.
    if (method === 'Target.attachedToTarget') {
      const target = params.targetInfo as CdpParams | undefined, child = params.sessionId;
      if (typeof child !== 'string') return;
      if (target?.type !== 'iframe') {
        if (params.waitingForDebugger) void this.contents.debugger.sendCommand('Runtime.runIfWaitingForDebugger', {}, child).catch(() => {});
        return;
      }
      this.frameSessions.set(child, target);
      if (this.frameInitializer) {
        const prepare = this.frameInitializer(child); this.frameInitializations.set(child, prepare);
        void prepare.then(() => this.send('Runtime.runIfWaitingForDebugger', {}, child), error => {
          this.trace({kind:'frame-initialization-error',message:String(error)});
          return this.send('Runtime.runIfWaitingForDebugger', {}, child);
        }).catch(() => {});
      }
    }
    if (method === 'Target.detachedFromTarget' && typeof params.sessionId === 'string') { this.frameSessions.delete(params.sessionId); this.frameInitializations.delete(params.sessionId); }
    if (sessionId && !this.frameSessions.has(sessionId)) return;
    const event = { method, params, ...(sessionId ? { sessionId } : {}) };
    for (const listener of this.listeners) listener(event);
    // The pinned helper represents a direct page connection as session "" and
    // compares event session IDs literally. Keep root events in that same scope;
    // attached clients and owned OOPIF events retain their real scoped IDs.
    for (const client of this.clients) this.emit(client, { method, params, sessionId: sessionId || client.primary || '' });
  };
  private readonly detached = (): void => { if (!this.stopped) void this.stop(); };

  async start(): Promise<string> {
    if (this.server) return this.endpoint;
    if (this.stopped) throw new BrowserError('BROWSER_UNAVAILABLE', 'CDP 代理已关闭');
    if (this.contents.debugger.isAttached()) throw new BrowserError('BROWSER_UNAVAILABLE', '网页调试器已有其他持有者');
    this.contents.debugger.attach('1.3');
    this.contents.debugger.on('message', this.message);
    this.contents.debugger.on('detach', this.detached);
    try {
      await this.send('Page.enable');
      // A non-activating parked view otherwise drops synthetic clicks while CDP reports success.
      // This changes renderer focus emulation only; it does not activate a native window.
      await this.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      await this.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: Boolean(this.frameInitializer), flatten: true });
      this.server = createServer((request, response) => {
        this.trace({ kind: 'http', host: request.headers.host, origin: request.headers.origin ?? null, route: request.url?.endsWith('/json/version') ? 'version' : 'other', allowed: this.trusted(request) });
        if (!this.trusted(request)) { response.writeHead(403).end(); return; }
        const path = request.url, prefix = '/' + this.token;
        response.setHeader('Content-Type', 'application/json');
        response.setHeader('Cache-Control', 'no-store');
        if (path === prefix + '/json/version') response.end(JSON.stringify({ Browser: `Chrome/${process.versions.chrome}`, 'Protocol-Version': '1.3', webSocketDebuggerUrl: this.endpoint }));
        else if (path === prefix + '/json/list' || path === prefix + '/json') response.end(JSON.stringify([{ ...this.target(), id: this.targetId, webSocketDebuggerUrl: this.endpoint }]));
        else response.writeHead(404).end();
      });
      this.sockets = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024, perMessageDeflate: false });
      this.server.on('upgrade', (request, socket, head) => {
        this.trace({ kind: 'upgrade', host: request.headers.host, origin: request.headers.origin ?? null, allowed: this.trusted(request) && request.url === '/' + this.token });
        if (!this.trusted(request) || request.url !== '/' + this.token) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
        this.sockets!.handleUpgrade(request, socket, head, ws => this.sockets!.emit('connection', ws));
      });
      this.sockets.on('connection', socket => {
        this.trace({ kind: 'connected' });
        const client: Client = { socket, pageSessions: new Set(), browserSessions: new Set() };
        this.clients.add(client);
        socket.on('error', error => { this.trace({kind:'socket-error',message:error.message}); });
        socket.on('message', data => { void this.handle(client, data.toString()); });
        socket.once('close', code => { this.trace({kind:'socket-close',code}); this.clients.delete(client); });
      });
      await new Promise<void>((resolve, reject) => {
        this.server!.once('error', reject);
        this.server!.listen(0, '127.0.0.1', () => {
          const address = this.server!.address();
          if (!address || typeof address === 'string') { reject(new Error('CDP bind failed')); return; }
          this.port = address.port; this.server!.removeListener('error', reject); resolve();
        });
      });
      return this.endpoint;
    } catch (error) { await this.stop(); throw error; }
  }

  private async handle(client: Client, raw: string): Promise<void> {
    let msg: { id: number; method: string; params?: CdpParams; sessionId?: string };
    try {
      msg = JSON.parse(raw);
      if (!Number.isSafeInteger(msg.id) || typeof msg.method !== 'string' || msg.params && (typeof msg.params !== 'object' || Array.isArray(msg.params))) {
        this.trace({kind:'invalid-envelope',idType:typeof msg.id,methodType:typeof msg.method,paramsType:typeof msg.params,keys:Object.keys(msg)}); return;
      }
    } catch { this.trace({kind:'invalid-json',length:raw.length}); return; }
    const { id, method, sessionId } = msg, params = msg.params ?? {};
    this.trace({ kind: 'command', method, sessionId: sessionId ?? null });
    const reply = (result: unknown) => this.emit(client, { id, result, ...(sessionId ? { sessionId } : {}) });
    const denied = () => { throw new BrowserError('BROWSER_UNAVAILABLE', 'CDP request is outside this page'); };
    try {
      if (sessionId && !client.pageSessions.has(sessionId) && !client.browserSessions.has(sessionId) && !this.frameSessions.has(sessionId)) denied();
      if (method === 'Browser.getVersion') { reply({ protocolVersion: '1.3', product: `Chrome/${process.versions.chrome}`, revision: '', userAgent: '', jsVersion: '' }); return; }
      if (method.startsWith('Browser.')) denied();
      if (method === 'Target.getTargets') { reply({ targetInfos: [this.target()] }); return; }
      if (method === 'Target.getTargetInfo') {
        if (params.targetId !== undefined && params.targetId !== this.targetId) denied();
        reply({ targetInfo: this.target() }); return;
      }
      if (method === 'Target.setDiscoverTargets') {
        denied();
      }
      if (method === 'Target.attachToBrowserTarget') {
        const value = 'wy-browser-' + ++this.ordinal; client.browserSessions.add(value); reply({ sessionId: value }); return;
      }
      if (method === 'Target.attachToTarget') {
        if (params.targetId !== this.targetId) denied();
        const value = 'wy-session-' + ++this.ordinal; client.pageSessions.add(value); client.primary ??= value;
        reply({ sessionId: value }); return;
      }
      if (method === 'Target.detachFromTarget') {
        const value = String(params.sessionId);
        if (!client.pageSessions.delete(value) && !client.browserSessions.delete(value)) denied();
        if (value === client.primary) client.primary = [...client.pageSessions][0]; reply({}); return;
      }
      if (method === 'Target.setAutoAttach') {
        // Never use a synthetic browser session to enumerate app-wide targets.
        await this.send(method, { ...params, autoAttach: true, flatten: true, waitForDebuggerOnStart: Boolean(this.frameInitializer) }, this.frameSessions.has(sessionId ?? '') ? sessionId : undefined);
        reply({});
        for (const [child, targetInfo] of this.frameSessions) this.emit(client, { method: 'Target.attachedToTarget', params: { sessionId: child, targetInfo, waitingForDebugger: false }, ...(sessionId ? { sessionId } : {}) });
        return;
      }
      if (method.startsWith('Target.')) denied();
      if (method === 'Page.bringToFront') { reply({}); return; }
      // Storage/BrowserContext operations could affect another task sharing a partition.
      if (method.startsWith('Storage.') || method.startsWith('SystemInfo.') || method.startsWith('Tethering.')) denied();
      const effectiveSession = sessionId && this.frameSessions.has(sessionId) ? sessionId : undefined;
      await this.frameReady(effectiveSession);
      let captured: BrowserAXTree | undefined;
      if (this.capture && method === 'Accessibility.getFullAXTree') {
        captured = { sessionId: effectiveSession, frameId: typeof params.frameId === 'string' ? params.frameId : undefined, nodes: [] };
        this.capture.push(captured);
      }
      const result = await this.send(method, params, effectiveSession);
      if (captured && Array.isArray(result.nodes)) captured.nodes = result.nodes as BrowserAXNode[];
      reply(result);
    } catch (error) {
      this.emit(client, { id, error: { code: -32000, message: error instanceof Error ? error.message : String(error) }, ...(sessionId ? { sessionId } : {}) });
    }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.contents.debugger.removeListener('message', this.message);
    this.contents.debugger.removeListener('detach', this.detached);
    for (const { socket } of this.clients) socket.terminate();
    this.clients.clear(); this.frameSessions.clear(); this.frameInitializations.clear(); this.listeners.clear();
    this.sockets?.close();
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    if (!this.contents.isDestroyed() && this.contents.debugger.isAttached()) this.contents.debugger.detach();
  }
}
