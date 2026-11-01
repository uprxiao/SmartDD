// 不调用模型的自测：真实原生助手 ＋ 进程树校验。正例＝受信任祖先的子进程；负例＝盗用令牌的树外进程。
import { spawn } from 'node:child_process';
import { connect } from 'node:net';
import { PeerCheckedHost, HELPER } from './host.mjs';
import { existsSync } from 'node:fs';
if (!existsSync(HELPER)) { console.log('helper missing', HELPER); process.exit(2); }
const host = new PeerCheckedHost(); await host.start();
const t = host.issue('A', ['read'], 120000);
const ask = token => new Promise(res => { const s = connect(host.endpoint); let o = ''; s.on('connect', () => s.write(JSON.stringify({ op: 'bug.list', token }) + '\n')); s.on('data', d => o += d); s.on('close', () => res(JSON.parse(o))); s.on('error', e => res({ err: e.code })); });
// 负例：本进程不在期望祖先树内
host.bind(t.runId, 1234567);
const neg = await ask(t.token);
// 正例：期望祖先＝本进程，由本进程的子进程发起
host.bind(t.runId, process.pid);
const pos = await new Promise(res => { const c = spawn(process.execPath, ['-e', `const {connect}=require('net');const s=connect(process.env.E);let o='';s.on('connect',()=>s.write(JSON.stringify({op:'bug.list',token:process.env.T})+'\\n'));s.on('data',d=>o+=d);s.on('close',()=>console.log(o))`], { env: { ...process.env, E: host.endpoint, T: t.token } }); let o = ''; c.stdout.on('data', d => o += d); c.on('close', () => res(JSON.parse(o))); });
// 连续 10 次延迟
const lat = []; for (let i = 0; i < 10; i++) { await ask(t.token); lat.push(host.peerLog.at(-1).helperMs); }
console.log(JSON.stringify({ negative_stolenToken_outsideTree: neg, positive_childOfTrusted: { ok: pos.ok, project: pos.project }, helperMs: { min: Math.min(...lat), max: Math.max(...lat), avg: Math.round(lat.reduce((a, b) => a + b) / lat.length) }, peerLogSample: host.peerLog.slice(0, 2) }, null, 1));
await host.close(); process.exit(0);
