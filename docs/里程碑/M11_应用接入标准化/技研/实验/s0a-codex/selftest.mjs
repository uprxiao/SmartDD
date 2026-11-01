// 不调用模型的自测（评审 A01 补验）：真实原生助手 ＋ 先认证后业务。
// 每个负例都断言 businessCalls 不增加，而不只断言返回码。
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PeerCheckedHost, HELPER } from './host.mjs';
const here = dirname(fileURLToPath(import.meta.url));
if (!existsSync(HELPER)) { console.log('helper missing', HELPER); process.exit(2); }
const host = new PeerCheckedHost(); await host.start();
const A = host.issue('A', ['read'], 120000), B = host.issue('B', ['read'], 120000), W = host.issue('A', ['read', 'write'], 120000);
// 子进程客户端：本进程的子进程，从真实 socket 发请求
const child = (token, op = 'bug.list') => new Promise(res => {
  const c = spawn(process.execPath, ['-e', `const {connect}=require('net');const s=connect(process.env.E);let o='';s.on('connect',()=>s.write(JSON.stringify({op:process.env.OP,token:process.env.T})+'\\n'));s.on('data',d=>o+=d);s.on('close',()=>console.log(o))`], { env: { ...process.env, E: host.endpoint, T: token, OP: op } });
  let o = ''; c.stdout.on('data', d => o += d); c.on('close', () => { try { res(JSON.parse(o)); } catch { res({ raw: o }); } });
});
// 树外的独立进程，用作“另一棵受管树”的根
const sleeper = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)']); await new Promise(r => setTimeout(r, 200));
const cases = [];
const check = async (id, label, fn, expectCode, expectBusiness) => {
  const before = host.businessCalls; const r = await fn(); const delta = host.businessCalls - before;
  const pass = (expectCode === 'OK' ? r.ok === true : r.code === expectCode) && delta === expectBusiness;
  cases.push({ id, label, code: r.code ?? (r.ok ? 'OK' : '?'), businessDelta: delta, expectCode, expectBusiness, pass });
};
// 期望受管根：A、W 绑定到本进程（正例与权限负例），B 绑定到 sleeper
host.bind(A.runId, process.pid); host.bind(W.runId, process.pid); host.bind(B.runId, sleeper.pid);
await check('P1', '正例：受管树内、只读令牌、读操作', () => child(A.token), 'OK', 1);
await check('N1', '有效令牌但调用者在树外（A 的根改为 sleeper）', async () => { host.bind(A.runId, sleeper.pid); const r = await child(A.token); host.bind(A.runId, process.pid); return r; }, 'PEER_MISMATCH', 0);
await check('N2', '另一运行的令牌（B，其根为 sleeper）从 A 的树内使用', () => child(B.token), 'PEER_MISMATCH', 0);
await check('N3', '身份不可读（无内核 fd 的假 socket，评审复现路径）', () => new Promise(res => { class FakeSocket extends EventEmitter { end(t) { res(JSON.parse(t)); } } const s = new FakeSocket(); host.accept(s); s.emit('data', Buffer.from(JSON.stringify({ op: 'bug.write', token: W.token }) + '\n')); }), 'PEER_UNVERIFIABLE', 0);
await check('N4', '启动时间不匹配（同 PID，伪造的启动时间）', async () => { host.bind(A.runId, process.pid, 'darwin-proc-v1:1:0'); const r = await child(A.token); host.bind(A.runId, process.pid); return r; }, 'PEER_MISMATCH', 0);
await check('N5', '可执行文件不符（期望固定 CLI 路径不是 node）', async () => { const old = host.expectedExecutable; host.expectedExecutable = '/usr/bin/false'; const r = await child(A.token); host.expectedExecutable = old; return r; }, 'EXECUTABLE_MISMATCH', 0);
await check('N6', '树内但只读令牌执行写操作', () => child(A.token, 'bug.write'), 'PERMISSION_DENIED', 0);
await check('N7', '伪造令牌', () => child('f'.repeat(64)), 'UNAUTHENTICATED', 0);
await check('N8', '已撤销令牌', async () => { host.revoke(A.runId); return child(A.token); }, 'REVOKED', 0);
await check('P2', '正例：树内、读写令牌、写操作', () => child(W.token, 'bug.write'), 'OK', 1);
const lat = host.peerLog.filter(l => typeof l.helperMs === 'number').map(l => l.helperMs);
sleeper.kill();
const out = { generatedAt: new Date().toISOString(), helper: 'out/native/willyou-process-identity', cases, allPass: cases.every(c => c.pass), helperMs: { min: Math.min(...lat), max: Math.max(...lat) } };
mkdirSync(join(here, 'results'), { recursive: true }); writeFileSync(join(here, 'results', 'selftest-a01.json'), JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 1));
await host.close(); process.exit(out.allPass ? 0 : 1);
