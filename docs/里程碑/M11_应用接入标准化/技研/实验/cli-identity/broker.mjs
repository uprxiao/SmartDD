// 实验用最小宿主：运行级令牌 + Unix socket。仅用于技研验证，不属于生产代码。
import { createServer } from 'node:net';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const h = v => createHash('sha256').update(v).digest('hex');
export class ExperimentBroker {
  constructor() { this.runs = new Map(); this.calls = []; this.now = () => Date.now(); }
  // 数据按项目隔离；调用方参数里的 project 只做对照，从不授权。
  data = { A: { bug: ['A-1', 'A-2'] }, B: { bug: ['B-1'] } };
  async start() {
    this.dir = mkdtempSync(join(tmpdir(), 'wy-exp-')); chmodSync(this.dir, 0o700);
    this.endpoint = join(this.dir, 'b.sock');
    this.server = createServer(s => this.accept(s));
    await new Promise(r => this.server.listen(this.endpoint, r)); chmodSync(this.endpoint, 0o600);
  }
  issue(project, grants, ttlMs = 60000) {
    const token = randomBytes(32).toString('hex'), runId = randomBytes(4).toString('hex');
    this.runs.set(h(token), { runId, project, grants, expiresAt: this.now() + ttlMs, revoked: false });
    return { token, runId };
  }
  revoke(runId) { for (const r of this.runs.values()) if (r.runId === runId) r.revoked = true; }
  accept(socket) {
    let buf = '';
    socket.on('data', d => { buf += d; if (buf.length > 65536) return socket.destroy(); const i = buf.indexOf('\n'); if (i < 0) return; const line = buf.slice(0, i); buf = '';
      let req; try { req = JSON.parse(line); } catch { return socket.end(JSON.stringify({ ok: false, code: 'BAD_REQUEST' }) + '\n'); }
      socket.end(JSON.stringify(this.handle(req)) + '\n'); });
    socket.on('error', () => {});
  }
  handle(req) {
    const run = typeof req.token === 'string' ? this.runs.get(h(req.token)) : undefined;
    const log = (ok, code, extra = {}) => { this.calls.push({ op: req.op, ok, code, runId: run?.runId, requestedProject: req.project, ...extra }); return ok ? { ok, ...extra } : { ok, code }; };
    if (!run) return log(false, 'UNAUTHENTICATED');
    if (run.revoked) return log(false, 'REVOKED');
    if (this.now() > run.expiresAt) return log(false, 'EXPIRED');
    if (req.project !== undefined && req.project !== run.project) return log(false, 'SCOPE_DENIED');
    const need = req.op === 'bug.write' ? 'write' : 'read';
    if (!run.grants.includes(need)) return log(false, 'PERMISSION_DENIED');
    if (req.op === 'bug.list') return log(true, 'OK', { project: run.project, items: this.data[run.project].bug });
    if (req.op === 'bug.write') return log(true, 'OK', { wrote: true });
    return log(false, 'UNKNOWN_OP');
  }
  async close() { await new Promise(r => this.server.close(r)); rmSync(this.dir, { recursive: true, force: true }); }
}
