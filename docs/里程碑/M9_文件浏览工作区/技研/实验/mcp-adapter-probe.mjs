#!/usr/bin/env node
// M9-GAP-07 隔离实验：扩展 viewer（MCP）适配的握手、策略与失败处理。
// 真实服务：本机已装的 `rea mcp`（rea 6.1.0，只测握手/列表/关闭，不调用任何分析工具）。受控服务：mcp-fake-server.mjs。
// 策略来自原型的 file-viewer-policy.mjs（与单元测试同一份实现）。客户端为本脚本内最小 MCP stdio 客户端。
// 不验证：浏览器端 viewer 的隔离宿主/沙箱 UI、资源订阅、真实第三方 viewer 服务、Windows。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const policy = await import(pathToFileURL(path.join(repo, 'prototypes/m6-codex/src/file-viewer-policy.mjs')).href);
const argv = process.argv.slice(2); const out = argv[argv.indexOf('--output') + 1];
if (argv.indexOf('--output') < 0 || !out) { console.error('usage: mcp-adapter-probe.mjs --output FILE'); process.exit(2); }
// 传输层单行上限：必须容纳最大资源的 base64（20MiB×4/3≈26.7MiB）加开销；真实服务的 tools/list 也可能有数 MiB（rea 实测 3.09MB）
const LINE_CAP = Math.ceil(policy.VIEWER_LIMITS.maxResourceBytes * 4 / 3) + 256 * 1024;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const descendants = rootPid => { const rows = execFileSync('ps', ['-axo', 'pid=,ppid=']).toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number)); const kids = new Map(); for (const [p, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); } const all = []; const walk = p => { for (const k of kids.get(p) || []) { all.push(k); walk(k); } }; walk(rootPid); return all; };
const waitDead = async (pids, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (!pids.some(alive)) return Math.round(performance.now() - t0); await sleep(50); } return null; };

class Mcp {
  constructor(cmd, args, env = {}) {
    this.oversize = 0; this.dropping = false; this.id = 0; this.pending = new Map(); this.exited = null; this.bad = 0; this.notifications = 0; this.accepted = 0; this.unmatched = 0; this.buf = '';
    this.limiter = policy.createNotificationLimiter({ limit: policy.VIEWER_LIMITS.maxNotificationsPerSecond });
    this.child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    this.child.stdout.on('data', d => {
      let chunk = d.toString('utf8');
      for (;;) {
        const nl = chunk.indexOf('\n');
        if (this.dropping) { if (nl < 0) return; this.dropping = false; chunk = chunk.slice(nl + 1); continue; }
        if (nl < 0) { this.buf += chunk; if (this.buf.length > LINE_CAP) this.overflow(); return; }
        const line = this.buf + chunk.slice(0, nl); this.buf = ''; chunk = chunk.slice(nl + 1);
        if (line.length > LINE_CAP) this.overflow(false); else this.line(line);
      }
    });
    this.child.stderr.on('data', () => {});
    this.child.on('exit', (code, signal) => { this.exited = { code, signal }; for (const [, p] of this.pending) p.reject(Object.assign(new Error('server exited'), { code: 'EXIT' })); this.pending.clear(); });
  }
  // 超限：丢弃这一行（直到下一个换行），并让所有未完成的 resources/read 立刻以 TOO_LARGE 失败，而不是等超时
  overflow(streaming = true) {
    this.oversize++; this.buf = ''; if (streaming) this.dropping = true;
    for (const [id, p] of this.pending) if (p.method === 'resources/read') { this.pending.delete(id); p.reject(Object.assign(new Error('resource exceeds transport line cap'), { code: 'TOO_LARGE' })); }
  }
  line(line) {
    let m; try { m = JSON.parse(line); } catch { this.bad++; return; }
    if (m.id !== undefined && (m.result !== undefined || m.error)) { this.lastBytes = Buffer.byteLength(line); const p = this.pending.get(m.id); if (!p) { this.unmatched++; return; } this.pending.delete(m.id); m.error ? p.reject(Object.assign(new Error(m.error.message), { code: m.error.code })) : p.resolve(m.result); }
    else if (m.method) { this.notifications++; if (this.limiter.accept()) this.accepted++; }
  }
  send(o) { this.child.stdin.write(JSON.stringify(o) + '\n'); }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method, params, timeoutMs = 15000) {
    const id = ++this.id; let timer;
    const p = new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, method }); timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('timeout ' + method), { code: 'TIMEOUT' })); }, timeoutMs); });
    this.send({ jsonrpc: '2.0', id, method, params }); p.catch(() => {}).finally(() => clearTimeout(timer)); return p;
  }
  async handshake() { const t = performance.now(); const r = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smartdd-m9-probe', version: '0' } }, 30000); this.notify('notifications/initialized'); this.ready = Math.round(performance.now() - t); this.init = r; return r; }
}

const cases = []; const started = new Date().toISOString();
const run = async (id, title, fn) => { const t = performance.now(); try { const [status, evidence] = await fn(); cases.push({ id, title, status, ms: Math.round(performance.now() - t), evidence }); } catch (e) { cases.push({ id, title, status: 'failed', ms: Math.round(performance.now() - t), evidence: { exception: String(e?.stack || e).split('\n').slice(0, 3).join(' | ') } }); } };
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-mcp-'));
const fake = (mode, name) => { const log = path.join(work, name + '.log'); fs.writeFileSync(log, ''); return { log, client: new Mcp(process.execPath, [path.join(here, 'mcp-fake-server.mjs')], { FAKE_MODE: mode, FAKE_LOG: log }), read: () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) }; };
const SESSION = 'viewer://doc/a.pptx';
const reaBin = path.join(os.homedir(), '.local/bin/rea');

await run('MC01', '真实 MCP 服务（rea mcp）：握手、能力声明、工具清单、ping，记录就绪时间', async () => {
  if (!fs.existsSync(reaBin)) return ['untested', { reason: '本机没有 rea' }];
  const c = new Mcp(reaBin, ['mcp']); const r = await c.handshake(); const tools = await c.request('tools/list', {}, 30000); const toolsBytes = c.lastBytes; const ping = await c.request('ping', {}).then(() => true, () => false);
  const avail = policy.viewerAvailability(r); const kids = descendants(c.child.pid); const t0 = performance.now(); c.child.stdin.end(); const diedMs = await waitDead([c.child.pid, ...kids], 5000); if (diedMs === null) c.child.kill('SIGKILL');
  globalThis.__reaClose = { diedMs, exit: c.exited };
  return [r.serverInfo && r.capabilities ? 'passed' : 'failed', { protocolVersion: r.protocolVersion, serverInfo: r.serverInfo, declaredCapabilities: Object.keys(r.capabilities), toolCount: tools.tools?.length ?? null, toolsListBytes: toolsBytes, lineCapBytes: LINE_CAP, viewerAdapterShouldCallToolsList: false, ping, readyMs: c.ready, viewerAvailable: avail, meaning: '配置了的 MCP 服务不等于可用 viewer：rea 只声明 tools 时 viewerAvailability 为不可用；tools/list 响应约 3MB，viewer 适配层不需要它，也就不应请求' }];
});
await run('MC02', '真实服务关闭：关闭 stdin 后进程树在预算内退出', async () => { const c = globalThis.__reaClose; if (!c) return ['untested', { reason: 'MC01 未运行' }]; return [c.diedMs !== null ? 'passed' : 'failed', { treeDiedAfterMs: c.diedMs, exit: c.exit }]; });
await run('MC03', '真实服务：未知方法返回 -32601 并被识别为“不支持”，而不是挂起', async () => {
  if (!fs.existsSync(reaBin)) return ['untested', { reason: '本机没有 rea' }];
  const c = new Mcp(reaBin, ['mcp']); await c.handshake(); let code; try { await c.request('resources/list', {}, 5000); code = 'resolved'; } catch (e) { code = e.code; }
  c.child.stdin.end(); await sleep(500); if (!c.exited) c.child.kill('SIGKILL');
  return [code === -32601 || code === 'resolved' ? 'passed' : 'failed', { resourcesListOutcome: code, note: -32601 === code ? '服务未声明 resources，调用被拒绝；适配层应根据能力声明提前不发该请求' : 'resolved' }];
});
await run('MC04', '受控服务：能力门控后列出并读取会话资源', async () => {
  const f = fake('normal', 'mc04'); const r = await f.client.handshake(); const avail = policy.viewerAvailability(r);
  const list = await f.client.request('resources/list', {}); const uri = list.resources[0].uri; const allowed = policy.resourceUriAllowed(uri, SESSION);
  const read = await f.client.request('resources/read', { uri }); const dec = policy.decodeResourceContents(read.contents); f.client.child.kill();
  return [avail.available && allowed.ok && dec.ok && dec.text === '原始内容' ? 'passed' : 'failed', { avail, uri, decoded: dec.ok && { kind: dec.kind, bytes: dec.bytes } }];
});
await run('MC05', '恶意/越界 URI 在发送前被拒绝，服务端日志里没有对应读取请求', async () => {
  const f = fake('normal', 'mc05'); await f.client.handshake();
  const attempts = ['file:///etc/passwd', 'viewer://doc/../secret', 'viewer://doc/b.pptx', 'http://evil.invalid/x'];
  const verdicts = attempts.map(u => policy.resourceUriAllowed(u, SESSION)); for (let i = 0; i < attempts.length; i++) if (verdicts[i].ok) await f.client.request('resources/read', { uri: attempts[i] });
  await f.client.request('resources/read', { uri: SESSION }); await sleep(200); const reads = f.read().filter(x => x.method === 'resources/read').map(x => x.uri); f.client.child.kill();
  return [verdicts.every(v => !v.ok) && reads.length === 1 && reads[0] === SESSION ? 'passed' : 'failed', { rejected: verdicts.map((v, i) => attempts[i] + ' → ' + v.error), readsReceivedByServer: reads }];
});
await run('MC06', '大资源：传输层上限立即以 TOO_LARGE 拒绝；声明 size 与真实不符时按解码后字节拒绝', async () => {
  const f = fake('normal', 'mc06'); await f.client.handshake();
  const t0 = performance.now(); let code; try { await f.client.request('resources/read', { uri: 'viewer://doc/big' }, 30000); code = 'resolved'; } catch (e) { code = e.code; }
  const overMs = Math.round(performance.now() - t0);
  await sleep(300); const next = await f.client.request('resources/list', {}, 5000).then(r => r.resources.length, () => -1);  // 超限之后连接仍可继续使用
  const mid = await f.client.request('resources/read', { uri: 'viewer://doc/mid' }, 10000); const dec = policy.decodeResourceContents(mid.contents, { maxBytes: 1024 * 1024 });
  f.client.child.kill();
  return [code === 'TOO_LARGE' && overMs < 8000 && next === 1 && !dec.ok && dec.error === 'too-large' && mid.contents[0].size === 10 ? 'passed' : 'failed', { transport: { code, rejectedAfterMs: overMs, oversizeLinesDropped: f.client.oversize, connectionStillUsable: next === 1, lineCapBytes: LINE_CAP }, decode: { declaredSize: mid.contents[0].size, decodedBytes: dec.bytes, error: dec.error, maxBytesUsed: 1048576 },
    note: '超限那一行（约 40MB base64）仍会被完整读入内存后丢弃——生产应在传输层按字节计数并尽早断开/限流；本实验只证明“拒绝且连接可恢复”' }];
});
await run('MC07', '写回：旧 ifMatch → conflict；新 ifMatch → saved 并更新基线；只有 saved 才更新基线', async () => {
  const f = fake('normal', 'mc07'); await f.client.handshake(); let baseline = 'e1';
  const call = async (ifMatch, text) => policy.interpretWriteResult((await f.client.request('tools/call', { name: 'viewer_write', arguments: { ifMatch, text } })).structuredContent);
  const stale = await call('e0', '本地改动'); const ok = await call(baseline, '本地改动'); if (ok.ok) baseline = ok.etag; const again = await call('e1', '再改'); const big = await call(baseline, 'x'.repeat(2000));
  f.client.child.kill();
  return [!stale.ok && stale.state === 'conflict' && ok.ok && baseline === 'e2' && again.state === 'conflict' && big.state === 'too-large' ? 'passed' : 'failed', { stale, ok, baselineAfter: baseline, reusedOldEtag: again.state, tooLarge: big.state }];
});
await run('MC08', '服务未声明 resources：viewer 不可用，且适配层没有发出任何 resources/* 请求', async () => {
  const f = fake('no-resources', 'mc08'); const r = await f.client.handshake(); const avail = policy.viewerAvailability(r); await sleep(300); const methods = f.read().map(x => x.method); f.client.child.kill();
  return [!avail.available && avail.reason === 'resources-not-declared' && !methods.some(m => m.startsWith('resources/')) ? 'passed' : 'failed', { avail, methodsReceivedByServer: methods }];
});
await run('MC09', '超时：无响应请求在预算内被拒绝；服务稍后的迟到响应被丢弃，不污染后续请求', async () => {
  const f = fake('hang', 'mc09'); await f.client.handshake(); const t0 = performance.now(); let code; try { await f.client.request('resources/read', { uri: SESSION }, 500); code = 'resolved'; } catch (e) { code = e.code; }
  const ms = Math.round(performance.now() - t0); await sleep(1400); const list = await f.client.request('resources/list', {}, 3000).then(r => r.resources.length, () => -1); f.client.child.kill();
  return [code === 'TIMEOUT' && ms < 1200 && f.client.unmatched >= 1 && list === 1 ? 'passed' : 'failed', { code, ms, lateResponsesDropped: f.client.unmatched, nextRequestOk: list === 1 }];
});
await run('MC10', '崩溃：服务在请求中途退出，请求立即被拒绝；重启后可继续', async () => {
  const f = fake('crash', 'mc10'); await f.client.handshake(); const t0 = performance.now(); let code; try { await f.client.request('resources/read', { uri: SESSION }, 5000); code = 'resolved'; } catch (e) { code = e.code; }
  const ms = Math.round(performance.now() - t0); const g = fake('normal', 'mc10b'); await g.client.handshake(); const again = await g.client.request('resources/list', {}).then(r => r.resources.length, () => -1); g.client.child.kill();
  return [code === 'EXIT' && ms < 1500 && again === 1 ? 'passed' : 'failed', { code, ms, restartedAndListed: again === 1 }];
});
await run('MC11', '通知洪峰：5000 条通知被限流，丢弃数可见，请求仍能及时响应', async () => {
  const f = fake('flood', 'mc11'); await f.client.handshake(); const t0 = performance.now(); const list = await f.client.request('resources/list', {}, 5000); const ms = Math.round(performance.now() - t0); await sleep(300); f.client.child.kill();
  return [f.client.notifications >= 4000 && f.client.limiter.dropped > 0 && f.client.accepted <= policy.VIEWER_LIMITS.maxNotificationsPerSecond + 5 && list.resources.length === 1 ? 'passed' : 'failed', { received: f.client.notifications, accepted: f.client.accepted, dropped: f.client.limiter.dropped, limitPerSecond: policy.VIEWER_LIMITS.maxNotificationsPerSecond, requestAfterFloodMs: ms }];
});
await run('MC12', '脏数据：非 JSON、半截 JSON、20 万字符超长行不会打死客户端，后续合法响应照常解析', async () => {
  const f = fake('garbage', 'mc12'); const r = await f.client.handshake().then(x => x, e => ({ error: e.code })); f.client.child.kill();
  return [r.serverInfo?.name === 'fake' && f.client.bad >= 2 ? 'passed' : 'failed', { badLinesIgnored: f.client.bad, handshakeOk: !!r.serverInfo }];
});
await run('MC13', '关闭后的请求：服务退出后新请求立即失败而不是挂起', async () => {
  const f = fake('normal', 'mc13'); await f.client.handshake(); f.client.child.kill(); await sleep(300); const t0 = performance.now(); let code; try { await f.client.request('resources/list', {}, 800); code = 'resolved'; } catch (e) { code = e.code; }
  return [code === 'TIMEOUT' || code === 'EXIT' ? 'passed' : 'failed', { code, ms: Math.round(performance.now() - t0), note: '写入已退出进程的 stdin 不会抛错，只能靠超时/退出状态发现；适配层应在 exit 后直接拒绝（本客户端在退出前已排队的请求才得到 EXIT）' }];
});
fs.rmSync(work, { recursive: true, force: true });
const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
fs.writeFileSync(out, JSON.stringify({ schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'), fakeServerSha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(here, 'mcp-fake-server.mjs'))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), realServer: '本机 rea mcp（命令行 --version 为 6.1.0，MCP 握手的 serverInfo.version 为 6.5.0，两者不一致，原因未查）', protocolVersion: '2025-06-18' },
  scope: '最小 MCP stdio 客户端；真实服务仅握手/关闭；受控服务验证适配策略。不含：viewer 的隔离宿主/沙箱 UI、资源订阅、真实第三方 viewer、Windows', cases, fixtureCleanup: { removed: !fs.existsSync(work) }, completedAt: new Date().toISOString(), summary }, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
