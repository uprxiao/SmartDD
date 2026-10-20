import { randomBytes, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { BRIDGE_LIMITS, boundedJson, bridgeRequestSchema, type BridgeBootstrap, type BridgeRequest, type BridgeResponse } from '@shared/application-bridge';
import { digest } from './manifest';
import type { CapabilityRunRegistry, OwnedCapabilityRun, OwnedRunProcess } from './run-registry';
import type { ApplicationToolService } from './tool-service';
interface Ticket { runId: string;bridge: OwnedRunProcess;path: string;dev: number;ino: number;expiresAt: number;claiming?:boolean }
interface Binding { runId: string;bridgeId: string;digest: string;expiresAt: number;revoked: boolean }
interface Peer { socket: Socket;binding?: Binding;buffer: Buffer;controllers: Map<string,AbortController>;inFlight: number }
const errorResponse = (id: string,error: unknown): BridgeResponse => ({ schema: 1,id,status: 'error',error: { code: error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE',message: error instanceof ApplicationError ? error.message : '本机应用通道不可用',layer: 'bridge',retryable: false,attemptCount: 0,retryExhausted: false,effectState: 'not-started',nextAction: '查看应用能力状态；不要自动重发外部写操作' } });
/** Per-host Unix endpoint; only one-time host-issued tickets can bind a connection to a run. */
export class PrivateApplicationBroker {
  readonly hostGeneration = randomUUID();
  private server?: Server;
  private directory = '';
  private socketIdentity?: { dev: number;ino: number };
  private readonly tickets = new Map<string,Ticket>();
  private readonly bindings = new Map<string,Binding>();
  private readonly peers = new Set<Peer>();
  private closed = false;
  constructor(private readonly runs: CapabilityRunRegistry,private readonly tools: ApplicationToolService,private readonly options: { now?: () => number;tokenTtlMs?: number;ticketTtlMs?: number;attachPeer?:(socket:Socket,runId:string,bridge:OwnedRunProcess)=>Promise<void> } = {}) {}
  private clock(): number { return this.options.now?.() ?? Date.now(); }
  get endpoint(): string { if (!this.server || this.closed) throw new ApplicationError('CAPABILITY_UNAVAILABLE','本机应用通道尚未启动'); return join(this.directory,'broker.sock'); }
  async start(): Promise<void> {
    if (this.closed) throw new ApplicationError('CANCELED','本次应用通道已关闭');
    if (this.server) throw new ApplicationError('RESOURCE_BUSY','本次应用通道已启动');
    if (process.platform !== 'darwin') throw new ApplicationError('HOST_INCOMPATIBLE','此版本尚未验证当前平台的私有应用通道');
    this.directory = mkdtempSync('/tmp/wy-' + process.getuid!() + '-'); chmodSync(this.directory,0o700);
    const endpoint = join(this.directory,'broker.sock'); if (Buffer.byteLength(endpoint) >= 100) throw new ApplicationError('INVALID_INPUT','本机应用通道路径超过平台预算');
    const server = createServer(socket => this.accept(socket)); server.maxConnections = 64; this.server = server;
    try { await new Promise<void>((resolve,reject) => { server.once('error',reject); server.listen(endpoint,() => { server.off('error',reject); resolve(); }); }); chmodSync(endpoint,0o600); const stat = lstatSync(endpoint); this.socketIdentity = { dev: stat.dev,ino: stat.ino }; server.on('error',() => { for (const peer of this.peers) peer.socket.destroy(); }); }
    catch { await this.close(); throw new ApplicationError('CAPABILITY_UNAVAILABLE','无法建立本次私有应用通道'); }
  }
  async prepare(run: OwnedCapabilityRun,serverName: string): Promise<{ bootstrapPath: string;bridge: OwnedRunProcess }> {
    const endpoint = this.endpoint, bridge = await run.reserveBridge();
    try {
      // The owned run handle, not caller-supplied project/package fields, authorizes preparation.
      const context = this.runs.bridgePreparation(run.runId);
      if (!context.snapshot.mcp.some(m => m.kind === 'applications' && m.serverName === serverName)) throw new ApplicationError('SCOPE_DENIED','此服务名不属于原会话应用桥');
      const secret = randomBytes(32).toString('hex'), path = join(this.directory,bridge.processId + '.json'), expiresAt = this.clock() + Math.min(60000,Math.max(1,this.options.ticketTtlMs ?? 30000));
      const bootstrap: BridgeBootstrap = { schema: 1,endpoint,runId: run.runId,bridgeId: bridge.processId,secret,hostGeneration: this.hostGeneration,expiresAt };
      writeFileSync(path,JSON.stringify(bootstrap) + '\n',{ flag: 'wx',mode: 0o600 }); const stat = lstatSync(path); this.tickets.set(digest(secret),{ runId: run.runId,bridge,path,expiresAt,dev: stat.dev,ino: stat.ino });
      return { bootstrapPath: path,bridge };
    } catch (error) { await bridge.cancelBeforeLaunch().catch(() => undefined); throw error; }
  }
  private cleanupTicket(ticket: Ticket): void { try { const stat = lstatSync(ticket.path); if (!stat.isSymbolicLink() && stat.isFile() && stat.dev === ticket.dev && stat.ino === ticket.ino) unlinkSync(ticket.path); } catch { /* consumed or no longer ours */ } }
  private accept(socket: Socket): void {
    const peer: Peer = { socket,buffer: Buffer.alloc(0),controllers: new Map(),inFlight: 0 }; this.peers.add(peer); socket.setTimeout(10000,() => socket.destroy()); socket.on('error',() => undefined);
    socket.on('close',() => { this.peers.delete(peer); this.revokePeer(peer); });
    socket.on('data',chunk => {
      peer.buffer = Buffer.concat([peer.buffer,chunk]);
      while (peer.buffer.length) {
        const end = peer.buffer.indexOf(10); if (end < 0) { if (peer.buffer.length > BRIDGE_LIMITS.requestBytes) socket.destroy(); return; }
        if (end > BRIDGE_LIMITS.requestBytes || peer.inFlight >= 32) { socket.destroy(); return; }
        const bytes = peer.buffer.subarray(0,end); peer.buffer = peer.buffer.subarray(end + 1); peer.inFlight++;
        void this.receive(peer,bytes).then(response => this.send(peer,response),() => socket.destroy()).finally(() => { peer.inFlight--; });
      }
    });
  }
  private send(peer: Peer,response: BridgeResponse): void {
    if (peer.socket.destroyed || this.closed) return;
    let data = JSON.stringify(response); if (Buffer.byteLength(data) > BRIDGE_LIMITS.responseBytes) data = JSON.stringify(errorResponse(response.id,new ApplicationError('TOO_LARGE','通道响应超过预算，请使用分页或有界资源')));
    if (peer.socket.writableLength + Buffer.byteLength(data) > 4 * BRIDGE_LIMITS.responseBytes) { peer.socket.destroy(); return; } peer.socket.write(data + '\n');
  }
  private authenticate(peer: Peer,token: string): Binding {
    const binding = this.bindings.get(digest(token));
    if (this.closed || !binding || peer.binding !== binding || binding.revoked || binding.expiresAt <= this.clock()) { this.revokePeer(peer); throw new ApplicationError('AUTH_REQUIRED','本次运行凭证已失效'); }
    this.checkBinding(peer,binding); return binding;
  }
  private checkBinding(peer: Peer,binding: Binding): void {
    if (this.closed || binding.revoked || peer.binding !== binding || this.bindings.get(binding.digest) !== binding || binding.expiresAt <= this.clock()) throw new ApplicationError('AUTH_REQUIRED','本次运行凭证已失效');
    this.runs.assertBridge(binding.runId,binding.bridgeId);
  }
  private async receive(peer: Peer,bytes: Buffer): Promise<BridgeResponse> {
    let id: string = randomUUID();
    try {
      const input: unknown = JSON.parse(bytes.toString('utf8'));
      if (input && typeof input === 'object' && 'id' in input && typeof input.id === 'string' && /^[a-f0-9-]{36}$/.test(input.id)) id = input.id;
      if (!boundedJson(input)) throw new ApplicationError('INVALID_INPUT','通道JSON结构超过预算');
      const parsed = bridgeRequestSchema.safeParse(input); if (!parsed.success) throw new ApplicationError('INVALID_INPUT','通道请求包含未允许字段或格式无效');
      const request = parsed.data; id = request.id;
      if (request.method === 'exchange') return await this.exchange(peer,request);
      const binding = this.authenticate(peer,request.token);
      if (request.method === 'renew') { this.bindings.delete(binding.digest); const token = randomBytes(32).toString('hex'); binding.digest = digest(token); binding.expiresAt = this.clock() + Math.min(900000,Math.max(1,this.options.tokenTtlMs ?? 900000)); this.bindings.set(binding.digest,binding); return { schema: 1,id,status: 'ok',value: { token,expiresAt: binding.expiresAt,hostGeneration: this.hostGeneration } }; }
      if (request.method === 'cancel') { const current = peer.controllers.get(request.targetId); current?.abort(); return { schema: 1,id,status: 'ok',value: { cancellationRequested: !!current } }; }
      const controller = peer.controllers.get(id) ?? new AbortController(); peer.controllers.set(id,controller);
      try {
        const response: BridgeResponse = request.method === 'tools/list' ? { schema: 1,id,status: 'ok',value: await this.tools.list(binding.runId) } : await this.tools.call(binding.runId,id,request.call,controller.signal);
        try { this.checkBinding(peer,binding); }
        catch (error) { const denied = errorResponse(id,error); if (denied.status === 'error' && response.operationId) { denied.operationId = response.operationId; denied.error.effectState = response.status === 'error' ? response.error.effectState : response.effectState ?? 'unknown'; denied.error.nextAction = '查看此operationId关联的已有业务记录，不要重复提交'; } return denied; }
        return response;
      } finally { peer.controllers.delete(id); }
    } catch (error) { return errorResponse(id,error); }
  }
  private async exchange(peer: Peer,request: Extract<BridgeRequest,{ method: 'exchange' }>): Promise<BridgeResponse> {
    if (peer.binding) throw new ApplicationError('AUTH_REQUIRED','此连接已消费过启动票据');
    const hash = digest(request.secret), ticket = this.tickets.get(hash);
    if (!ticket || ticket.runId !== request.runId || ticket.bridge.processId !== request.bridgeId || ticket.expiresAt <= this.clock()) { if (ticket && ticket.expiresAt <= this.clock()) { this.tickets.delete(hash); this.cleanupTicket(ticket); } throw new ApplicationError('AUTH_REQUIRED','一次性运行票据无效或已消费'); }
    if(ticket.claiming)throw new ApplicationError('AUTH_REQUIRED','此启动票据正在核验');ticket.claiming=true;
    try{await this.options.attachPeer?.(peer.socket,ticket.runId,ticket.bridge);if(this.closed||peer.socket.destroyed||this.tickets.get(hash)!==ticket||ticket.expiresAt<=this.clock())throw new ApplicationError('AUTH_REQUIRED','启动核验期间票据已撤销或失效');this.runs.assertBridge(ticket.runId,ticket.bridge.processId);this.tickets.delete(hash);this.cleanupTicket(ticket);}finally{ticket.claiming=false;}
    const token = randomBytes(32).toString('hex'), binding: Binding = { runId: ticket.runId,bridgeId: ticket.bridge.processId,digest: digest(token),expiresAt: this.clock() + Math.min(900000,Math.max(1,this.options.tokenTtlMs ?? 900000)),revoked: false };
    peer.binding = binding; this.bindings.set(binding.digest,binding); peer.socket.setTimeout(0);
    return { schema: 1,id: request.id,status: 'ok',value: { token,expiresAt: binding.expiresAt,hostGeneration: this.hostGeneration } };
  }
  private revokePeer(peer: Peer): void { if (peer.binding) { peer.binding.revoked = true; this.bindings.delete(peer.binding.digest); } for (const controller of peer.controllers.values()) controller.abort(); }
  revokeRun(runId: string): void { for (const peer of this.peers) if (peer.binding?.runId === runId) { this.revokePeer(peer); peer.socket.destroy(); } for (const [hash,ticket] of this.tickets) if (ticket.runId === runId) { this.tickets.delete(hash); this.cleanupTicket(ticket); } this.tools.clearMemory(runId); }
  async close(): Promise<void> {
    if (this.closed) return; this.closed = true;
    for (const peer of this.peers) { this.revokePeer(peer); peer.socket.destroy(); } for (const ticket of this.tickets.values()) this.cleanupTicket(ticket); this.tickets.clear(); this.bindings.clear();
    if (this.server) { const server = this.server; this.server = undefined; await new Promise<void>(resolve => { try { server.close(() => resolve()); } catch { resolve(); } }); }
    try { const path = join(this.directory,'broker.sock'), stat = lstatSync(path); if (this.socketIdentity && stat.dev === this.socketIdentity.dev && stat.ino === this.socketIdentity.ino && stat.isSocket()) unlinkSync(path); } catch { /* Node normally unlinks its listening socket. */ }
    if (this.directory) try { rmdirSync(this.directory); } catch { /* Never recursively delete unknown contents. */ }
  }
}
