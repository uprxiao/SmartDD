// 按行分隔的 JSON-RPC 对端（Codex app-server stdio 协议：无 jsonrpc 字段，id＋method 为服务端请求）。
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { DriverError } from './driver';

interface Pending { resolve(v: unknown): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> | undefined; method: string }
export interface RpcHandlers {
  notification(method: string, params: unknown): void;
  request(id: string | number, method: string, params: unknown): void;
  /** 无法解析的行（含非 JSON 诊断输出），不中断会话。 */
  invalid?(line: string): void;
}

const MAX_LINE = 16 * 1024 * 1024;

export class JsonlRpcPeer {
  private serial = 0;
  private readonly pending = new Map<string | number, Pending>();
  private closedError: Error | null = null;

  constructor(private readonly input: Readable, private readonly output: Writable, private readonly handlers: RpcHandlers, private readonly defaultTimeoutMs = 60_000, private readonly protocol?: '2.0') {
    createInterface({ input, crlfDelay: Infinity }).on('line', line => this.onLine(line));
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    if (line.length > MAX_LINE) { this.handlers.invalid?.(line.slice(0, 200)); return; }
    let msg: { jsonrpc?: string; id?: string | number; method?: string; params?: unknown; result?: unknown; error?: unknown };
    try { msg = JSON.parse(line); } catch { this.handlers.invalid?.(line.slice(0, 2000)); return; }
    if (msg === null || typeof msg !== 'object') { this.handlers.invalid?.(line.slice(0, 2000)); return; }
    if (this.protocol && msg.jsonrpc !== this.protocol) { this.handlers.invalid?.(line.slice(0, 200)); return; }
    if (msg.id !== undefined && msg.method === undefined) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id); clearTimeout(p.timer);
      if (msg.error !== undefined) {
        const code = (msg.error as { code?: unknown } | null)?.code;
        p.reject(new DriverError('REJECTED', `${p.method}: ${JSON.stringify(msg.error).slice(0, 2000)}`, typeof code === 'number' ? code : undefined));
      } else p.resolve(msg.result);
      return;
    }
    if (typeof msg.method !== 'string') { this.handlers.invalid?.(line.slice(0, 2000)); return; }
    if (msg.id !== undefined) this.handlers.request(msg.id, msg.method, msg.params);
    else this.handlers.notification(msg.method, msg.params);
  }

  private write(obj: Record<string, unknown>) {
    if (this.closedError) throw this.closedError;
    this.output.write(JSON.stringify(this.protocol ? { jsonrpc: this.protocol, ...obj } : obj) + '\n');
  }

  call<T = unknown>(method: string, params: unknown, timeoutMs: number | null = this.defaultTimeoutMs): Promise<T> {
    if (this.closedError) return Promise.reject(this.closedError);
    const id = ++this.serial;
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs === null ? undefined : setTimeout(() => { this.pending.delete(id); reject(new DriverError('TIMEOUT', `${method} 超时`)); }, timeoutMs);
      this.pending.set(id, { resolve: v => resolve(v as T), reject, timer, method });
      try { this.write({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
    });
  }
  notify(method: string, params?: unknown) { this.write(params === undefined ? { method } : { method, params }); }
  reply(id: string | number, result: unknown) { this.write({ id, result }); }
  replyError(id: string | number, code: number, message: string) { this.write({ id, error: { code, message } }); }

  /** 对端退出：所有在途调用以同一原因失败。 */
  close(reason: Error) {
    if (this.closedError) return;
    this.closedError = reason;
    for (const [id, p] of this.pending) { clearTimeout(p.timer); p.reject(reason); this.pending.delete(id); }
  }
}
