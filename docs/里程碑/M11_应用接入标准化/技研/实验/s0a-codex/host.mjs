// 实验宿主 v3（2026-11-01，按评审 A01 修正）：先核验身份，再进入业务。
// 顺序：解析 → 令牌（存在、未撤销、未过期）→ 内核对端身份（可读、可执行文件、祖先含本次运行的 {pid, startedAt}）
//       → 项目范围与权限 → 业务。任何一步失败都不进入业务；businessCalls 只在真正执行业务时加一。
// 使用项目已有的 macOS 原生助手 out/native/willyou-process-identity（--peer-fd 读对端；<pid> 读启动时间）。
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ExperimentBroker } from '../cli-identity/broker.mjs';
const here = dirname(fileURLToPath(import.meta.url));
export const HELPER = resolve(here, '../../../../../../out/native/willyou-process-identity');
const h = v => createHash('sha256').update(v).digest('hex');
export const processStartedAt = pid => { try { const v = JSON.parse(execFileSync(HELPER, [String(pid)], { encoding: 'utf8' })); return v.state === 'running' ? v.startedAt : null; } catch { return null; } };
const readPeer = socket => new Promise(res => {
  const fd = socket._handle?.fd; if (!Number.isInteger(fd) || fd < 0) return res(null);
  let child; try { child = spawn(HELPER, ['--peer-fd', '3'], { stdio: ['ignore', 'pipe', 'ignore', fd] }); } catch { return res(null); }
  let out = ''; child.stdout.on('data', d => out += d); child.on('error', () => res(null));
  child.on('close', () => { try { res(JSON.parse(out)); } catch { res(null); } });
});
export class PeerCheckedHost extends ExperimentBroker {
  expected = new Map();      // runId -> Promise<{pid, startedAt}>
  peerLog = [];
  businessCalls = 0;
  expectedExecutable = realpathSync(process.execPath); // 实验中 CLI 由 node 执行；生产应为固定的 willyou-app 路径
  /** 绑定本次运行的受管进程；启动时间由原生助手读取，调用方不能自报。 */
  bind(runId, pid, startedAtOverride) { this.expected.set(runId, Promise.resolve({ pid, startedAt: startedAtOverride ?? processStartedAt(pid) })); }
  async authorize(req, socket) {
    const run = typeof req.token === 'string' ? this.runs.get(h(req.token)) : undefined;
    if (!run) return { code: 'UNAUTHENTICATED' };
    if (run.revoked) return { code: 'REVOKED', run };
    if (this.now() > run.expiresAt) return { code: 'EXPIRED', run };
    const want = await this.expected.get(run.runId);
    const t0 = Date.now(), peer = await readPeer(socket), helperMs = Date.now() - t0;
    const log = { runId: run.runId, helperMs, peerState: peer?.state ?? 'unavailable' };
    if (!want || !want.startedAt) return { code: 'PEER_UNVERIFIABLE', run, log };
    if (!peer || peer.state !== 'running') return { code: 'PEER_UNVERIFIABLE', run, log };
    let exe = null; try { exe = realpathSync(peer.peer.executable); } catch {}
    log.executableOk = exe === this.expectedExecutable;
    if (!log.executableOk) return { code: 'EXECUTABLE_MISMATCH', run, log };
    log.inExpectedTree = peer.ancestors.some(a => a.pid === want.pid && a.startedAt === want.startedAt);
    log.ancestorCount = peer.ancestors.length;
    if (!log.inExpectedTree) return { code: 'PEER_MISMATCH', run, log };
    if (req.project !== undefined && req.project !== run.project) return { code: 'SCOPE_DENIED', run, log };
    const need = req.op === 'bug.write' ? 'write' : 'read';
    if (!run.grants.includes(need)) return { code: 'PERMISSION_DENIED', run, log };
    return { code: null, run, log };
  }
  business(req, run) {
    this.businessCalls++;
    if (req.op === 'bug.list') return { ok: true, project: run.project, items: this.data[run.project].bug };
    if (req.op === 'bug.write') return { ok: true, wrote: true };
    return { ok: false, code: 'UNKNOWN_OP' };
  }
  accept(socket) {
    let buf = '';
    socket.on('data', async d => {
      buf += d; const i = buf.indexOf('\n'); if (i < 0) return; const line = buf.slice(0, i); buf = '';
      let req; try { req = JSON.parse(line); } catch { return socket.end('{"ok":false,"code":"BAD_REQUEST"}\n'); }
      const before = this.businessCalls;
      const auth = await this.authorize(req, socket);
      const res = auth.code ? { ok: false, code: auth.code } : this.business(req, auth.run);
      this.peerLog.push({ ...(auth.log ?? { runId: auth.run?.runId ?? null }), op: req.op, code: res.code ?? 'OK', businessRan: this.businessCalls > before });
      socket.end(JSON.stringify(res) + '\n');
    });
    socket.on('error', () => {});
  }
}
