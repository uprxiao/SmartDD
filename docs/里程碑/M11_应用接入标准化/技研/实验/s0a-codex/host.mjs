// 实验宿主 v2：令牌 ＋ 对端进程树校验（使用项目已有的 macOS 原生助手 out/native/willyou-process-identity）。
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ExperimentBroker } from '../cli-identity/broker.mjs';
const here = dirname(fileURLToPath(import.meta.url));
export const HELPER = resolve(here, '../../../../../../out/native/willyou-process-identity');
const h = v => createHash('sha256').update(v).digest('hex');
const readPeer = socket => new Promise(res => {
  const fd = socket._handle?.fd; if (!Number.isInteger(fd) || fd < 0) return res(null);
  let child; try { child = spawn(HELPER, ['--peer-fd', '3'], { stdio: ['ignore', 'pipe', 'ignore', fd] }); } catch { return res(null); }
  let out = ''; child.stdout.on('data', d => out += d); child.on('error', () => res(null));
  child.on('close', () => { try { res(JSON.parse(out)); } catch { res(null); } });
});
export class PeerCheckedHost extends ExperimentBroker {
  expected = new Map(); peerLog = [];
  bind(runId, pid) { this.expected.set(runId, pid); }
  accept(socket) {
    let buf = '';
    socket.on('data', async d => {
      buf += d; const i = buf.indexOf('\n'); if (i < 0) return; const line = buf.slice(0, i); buf = '';
      let req; try { req = JSON.parse(line); } catch { return socket.end('{"ok":false,"code":"BAD_REQUEST"}\n'); }
      const t0 = Date.now(), peer = await readPeer(socket), helperMs = Date.now() - t0;
      let res = this.handle(req); const run = this.runs.get(h(String(req.token)));
      const want = run && this.expected.get(run.runId), anc = peer?.state === 'running' ? peer.ancestors.map(a => a.pid) : null;
      const inTree = !!(want && anc && anc.includes(want));
      this.peerLog.push({ runId: run?.runId ?? null, tokenOk: res.ok === true, peerState: peer?.state ?? 'unavailable', ancestorCount: anc?.length ?? 0, inExpectedTree: inTree, helperMs });
      if (res.ok && !inTree) res = { ok: false, code: 'PEER_MISMATCH' };
      socket.end(JSON.stringify(res) + '\n');
    });
    socket.on('error', () => {});
  }
}
