import { randomUUID } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, unlinkSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { connect, type Socket } from 'node:net';
import { ApplicationError } from '@shared/applications';
import { BRIDGE_LIMITS, boundedJson, bridgeBootstrapSchema, type BridgeBootstrap, type BridgeResponse, type BridgeRequest } from '@shared/application-bridge';
/** Consume only an explicitly named, private, single-use file issued in this uid's broker root. */
export function consumeBridgeBootstrap(path: string): BridgeBootstrap {
  const uid = process.getuid?.(); if (uid === undefined) throw new ApplicationError('HOST_INCOMPATIBLE','当前平台启动票据尚未验证');
  const parent = dirname(path), root = realpathSync(parent), directory = lstatSync(parent);
  if (directory.isSymbolicLink() || !directory.isDirectory() || directory.uid !== uid || (directory.mode & 0o777) !== 0o700 || !new RegExp('^wy-' + uid + '-[A-Za-z0-9]+$').test(basename(root)) || dirname(root) !== realpathSync('/tmp')) throw new ApplicationError('SCOPE_DENIED','启动票据不在本次受限目录');
  const fd = openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW); let bootstrap: BridgeBootstrap, original: ReturnType<typeof fstatSync>;
  try { original = fstatSync(fd); if (!original.isFile() || original.nlink !== 1 || original.uid !== uid || (original.mode & 0o777) !== 0o600 || original.size > 4096) throw new ApplicationError('SCOPE_DENIED','启动票据归属或权限无效'); bootstrap = bridgeBootstrapSchema.parse(JSON.parse(readFileSync(fd,'utf8'))); }
  finally { closeSync(fd); }
  if (bootstrap.endpoint !== join(parent,'broker.sock') || basename(path) !== bootstrap.bridgeId + '.json' || bootstrap.expiresAt <= Date.now()) throw new ApplicationError('AUTH_REQUIRED','启动票据身份或有效期不符');
  const current = lstatSync(path); if (current.isSymbolicLink() || current.dev !== original.dev || current.ino !== original.ino) throw new ApplicationError('SCOPE_DENIED','启动票据已经替换'); unlinkSync(path); return bootstrap;
}
export class ApplicationBridgeClient {
  private socket?: Socket;
  private token = '';
  private started = false;
  private renewing?: Promise<void>;
  private expiresAt = 0;
  private renewTimer?: ReturnType<typeof setInterval>;
  private buffer = Buffer.alloc(0);
  private readonly pending = new Map<string,{ resolve(response: BridgeResponse): void;reject(error: Error): void;timer: ReturnType<typeof setTimeout> }>();
  constructor(private readonly bootstrap: BridgeBootstrap) {}
  async start(): Promise<void> {
    if (this.started) throw new ApplicationError('RESOURCE_BUSY','此单次票据桥已经使用');
    this.started = true;
    try {
    const socket = connect(this.bootstrap.endpoint); this.socket = socket; socket.on('error',() => this.close()); socket.on('close',() => this.close()); socket.on('data',data => this.receive(data));
    await new Promise<void>((resolve,reject) => { const timer = setTimeout(() => { socket.destroy(); reject(new ApplicationError('TIMEOUT','本机应用通道连接超时')); },3000); socket.once('connect',() => { clearTimeout(timer); resolve(); }); socket.once('error',() => { clearTimeout(timer); reject(new ApplicationError('CAPABILITY_UNAVAILABLE','本机应用通道不可用')); }); });
    const response = await this.raw({ schema: 1,id: randomUUID(),method: 'exchange',runId: this.bootstrap.runId,bridgeId: this.bootstrap.bridgeId,secret: this.bootstrap.secret },3000);
    this.acceptCredential(response); this.renewTimer = setInterval(() => { void this.renew().catch(() => this.close()); },300000); this.renewTimer.unref();
    } catch (error) { this.close(); throw error; }
  }
  private acceptCredential(response: BridgeResponse): void {
    if (response.status !== 'ok') throw new ApplicationError('AUTH_REQUIRED','本机应用运行凭证未获准');
    const credential = response.value as { token?: unknown;expiresAt?: unknown;hostGeneration?: unknown };
    if (!credential || typeof credential.token !== 'string' || !/^[a-f0-9]{64}$/.test(credential.token) || typeof credential.expiresAt !== 'number' || credential.hostGeneration !== this.bootstrap.hostGeneration) throw new ApplicationError('INVALID_RESPONSE','本机应用凭证回执无效'); this.token = credential.token; this.expiresAt = credential.expiresAt;
  }
  renew(): Promise<void> {
    if (this.renewing) return this.renewing;
    if (!this.token) return Promise.reject(new ApplicationError('AUTH_REQUIRED','此运行凭证已撤销'));
    this.renewing = this.raw({ schema: 1,id: randomUUID(),method: 'renew',token: this.token },3000).then(response => this.acceptCredential(response)).finally(() => { this.renewing = undefined; }); return this.renewing;
  }
  async request(method: 'tools/list' | 'tools/call',call?: Extract<BridgeRequest,{ method: 'tools/call' }>['call'],signal?: AbortSignal): Promise<BridgeResponse> {
    if (this.renewing) await this.renewing;
    if (!this.token || Date.now() >= this.expiresAt) return Promise.reject(new ApplicationError('AUTH_REQUIRED','此运行凭证已经失效'));
    const id = randomUUID(), cancel = () => { if (this.socket && this.token) void this.raw({ schema: 1,id: randomUUID(),method: 'cancel',token: this.token,targetId: id },3000).catch(() => undefined); };
    if (signal?.aborted) return Promise.reject(new ApplicationError('CANCELED','调用已取消'));
    signal?.addEventListener('abort',cancel,{ once: true });
    const request: BridgeRequest = method === 'tools/call' ? { schema: 1,id,method,token: this.token,call: call! } : { schema: 1,id,method,token: this.token };
    return this.raw(request,method === 'tools/list' ? 30000 : 125000).finally(() => signal?.removeEventListener('abort',cancel));
  }
  private raw(request: BridgeRequest,timeoutMs: number): Promise<BridgeResponse> {
    const socket = this.socket, data = JSON.stringify(request); if (!socket || socket.destroyed) return Promise.reject(new ApplicationError('CAPABILITY_UNAVAILABLE','本次应用通道已关闭'));
    if (Buffer.byteLength(data) > BRIDGE_LIMITS.requestBytes || this.pending.size >= 32) return Promise.reject(new ApplicationError('TOO_LARGE','本次应用请求超过通道预算'));
    return new Promise((resolve,reject) => { const timer = setTimeout(() => { this.pending.delete(request.id); reject(new ApplicationError('TIMEOUT','应用调用等待超时；请核对业务执行记录，不要自动重发')); },timeoutMs); this.pending.set(request.id,{ resolve,reject,timer }); socket.write(data + '\n'); });
  }
  private receive(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer,data]);
    while (this.buffer.length) {
      const end = this.buffer.indexOf(10); if (end < 0) { if (this.buffer.length > BRIDGE_LIMITS.responseBytes) this.close(); return; }
      if (end > BRIDGE_LIMITS.responseBytes) { this.close(); return; }
      try { const response = JSON.parse(this.buffer.subarray(0,end).toString('utf8')) as BridgeResponse; this.buffer = this.buffer.subarray(end + 1); if (!boundedJson(response) || response.schema !== 1 || !['ok','error'].includes(response.status) || typeof response.id !== 'string') throw new Error(); const pending = this.pending.get(response.id); if (!pending) continue; this.pending.delete(response.id); clearTimeout(pending.timer); pending.resolve(response); }
      catch { this.close(); return; }
    }
  }
  close(): void { const socket = this.socket; this.socket = undefined; this.token = ''; this.expiresAt = 0; if (this.renewTimer) clearInterval(this.renewTimer); this.renewTimer = undefined; for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new ApplicationError('CAPABILITY_UNAVAILABLE','本次应用通道已关闭，核对已有执行结果')); } this.pending.clear(); socket?.destroy(); }
}
