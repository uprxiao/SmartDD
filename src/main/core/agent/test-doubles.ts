// 测试替身：内存中的子进程（stdio 为 PassThrough）与按行 JSON-RPC 的假 app-server 脚本。仅供测试导入。
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createInterface } from 'node:readline';
import type { ChildProcess } from 'node:child_process';

export class FakeChild extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 4242;
  exitCode: number | null = null;
  killed = false;
  kill(signal: NodeJS.Signals = 'SIGTERM') { this.killed = true; this.exit(null, signal); return true; }
  exit(code: number | null, signal: string | null = null) { if (this.exitCode !== null || this.listenerCount('exit') < 0) return; this.exitCode = code ?? -1; this.emit('exit', code, signal); }
  asChild() { return this as unknown as ChildProcess; }
}

export type ServerScript = (msg: any, server: FakeAppServer) => void;
/** 读取客户端写入的每一行，交给脚本决定回应；记录全部收到的消息。 */
export class FakeAppServer {
  readonly received: any[] = [];
  constructor(readonly child: FakeChild, script: ServerScript) {
    createInterface({ input: child.stdin }).on('line', line => { const msg = JSON.parse(line); this.received.push(msg); script(msg, this); });
    child.stdin.on('finish', () => setImmediate(() => child.exit(0)));
  }
  send(obj: unknown) { this.child.stdout.write(JSON.stringify(obj) + '\n'); }
  reply(id: number, result: unknown) { this.send({ id, result }); }
  notify(method: string, params: unknown) { this.send({ method, params }); }
  request(id: number | string, method: string, params: unknown) { this.send({ id, method, params }); }
  calls(method: string) { return this.received.filter(m => m.method === method); }
}
export const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
export async function until(cond: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!cond()) { if (Date.now() > end) throw new Error('until: 超时'); await tick(5); }
}
