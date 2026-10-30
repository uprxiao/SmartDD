#!/usr/bin/env node
// M9-GAP-07 隔离实验：语言服务（LSP）适配的生命周期与失败处理。
// 真实服务：typescript-language-server 4.3.4 + typescript 5.9.3（装在仓库外临时目录 /tmp/m9-lsp，不进 SmartDD 依赖）。
// 客户端是本脚本里的最小 LSP 客户端（Content-Length 帧）。验证的是“适配层策略”：握手与能力门控、UTF-16 列、过期响应丢弃、取消、崩溃、
// 关闭清理、根外结果分类、延迟。只覆盖 TypeScript；其他语言服务器、安装与分发方式、项目级配置发现都没有验证。
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const arg = k => { const i = args.indexOf(k); return i < 0 ? undefined : args[i + 1]; };
const out = arg('--output'), lspHome = arg('--lsp-home') || '/tmp/m9-lsp';
if (!out) { console.error('usage: lsp-adapter-probe.mjs --output FILE [--lsp-home /tmp/m9-lsp]'); process.exit(2); }
const bin = path.join(lspHome, 'node_modules/.bin/typescript-language-server');
if (!fs.existsSync(bin)) { console.error('缺少 ' + bin + '；脚本不安装依赖'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };

class Lsp {
  constructor(root, { detached = false } = {}) {
    this.root = root; this.id = 0; this.pending = new Map(); this.buf = Buffer.alloc(0); this.exited = null; this.notes = [];
    this.child = spawn(bin, ['--stdio'], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], detached }); // detached=true：服务自成进程组，便于整组清理
    this.child.stdout.on('data', d => { this.buf = Buffer.concat([this.buf, d]); this.drain(); });
    this.child.stderr.on('data', () => {});
    this.child.on('exit', (code, signal) => { this.exited = { code, signal }; for (const [, p] of this.pending) p.reject(Object.assign(new Error('server exited'), { code: 'EXIT' })); this.pending.clear(); });
  }
  drain() {
    for (;;) {
      const i = this.buf.indexOf('\r\n\r\n'); if (i < 0) return;
      const m = /Content-Length: (\d+)/i.exec(this.buf.slice(0, i).toString()); if (!m) { this.buf = this.buf.slice(i + 4); continue; }
      const len = Number(m[1]); if (this.buf.length < i + 4 + len) return;
      const msg = JSON.parse(this.buf.slice(i + 4, i + 4 + len).toString('utf8')); this.buf = this.buf.slice(i + 4 + len);
      if (msg.id !== undefined && (msg.result !== undefined || msg.error)) { const p = this.pending.get(msg.id); if (p) { this.pending.delete(msg.id); msg.error ? p.reject(Object.assign(new Error(msg.error.message), { code: msg.error.code })) : p.resolve(msg.result); } }
      else if (msg.id !== undefined && msg.method) this.send({ jsonrpc: '2.0', id: msg.id, result: null }); // 服务端请求（如 workspace/configuration）一律空应答
      else this.notes.push(msg.method);
    }
  }
  send(o) { const body = Buffer.from(JSON.stringify(o)); this.child.stdin.write('Content-Length: ' + body.length + '\r\n\r\n'); this.child.stdin.write(body); }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, params }); }
  request(method, params, { timeoutMs = 15000 } = {}) {
    const id = ++this.id; let timer;
    const p = new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('timeout ' + method), { code: 'TIMEOUT' })); }, timeoutMs); });
    this.send({ jsonrpc: '2.0', id, method, params }); p.finally(() => clearTimeout(timer)).catch(() => {}); p.id = id; return p;
  }
  async init() {
    const t = performance.now();
    const res = await this.request('initialize', { processId: process.pid, rootUri: pathToFileURL(this.root).href, workspaceFolders: [{ uri: pathToFileURL(this.root).href, name: 'w' }],
      capabilities: { general: { positionEncodings: ['utf-16'] }, textDocument: { synchronization: {}, definition: { linkSupport: false }, references: {}, hover: { contentFormat: ['plaintext'] } } },
      initializationOptions: { tsserver: { path: path.join(lspHome, 'node_modules/typescript/lib/tsserver.js') } } });
    this.notify('initialized', {}); this.ready = performance.now() - t; this.caps = res.capabilities; return res;
  }
  open(file, text, version = 1) { this.notify('textDocument/didOpen', { textDocument: { uri: pathToFileURL(file).href, languageId: 'typescript', version, text } }); }
  async stop() { if (this.exited) return; try { await this.request('shutdown', null, { timeoutMs: 4000 }); this.notify('exit', null); } catch { this.child.kill('SIGKILL'); } for (let i = 0; i < 40 && !this.exited; i++) await sleep(50); if (!this.exited) this.child.kill('SIGKILL'); }
}

// ---- 适配层策略（被测对象，生产实现应等价）----
const supports = (caps, method) => ({ 'textDocument/definition': !!caps.definitionProvider, 'textDocument/references': !!caps.referencesProvider, 'textDocument/hover': !!caps.hoverProvider, 'textDocument/implementation': !!caps.implementationProvider }[method] ?? false);
const classifyLocation = (uri, root) => { const p = decodeURIComponent(new URL(uri).pathname); const rel = path.relative(root, p); return !rel.startsWith('..') && !path.isAbsolute(rel) ? { kind: 'in-root', relativePath: rel } : { kind: 'outside-root', path: p }; };
// 带文档版本的请求：响应回来时文档版本变了就丢弃
function guarded(lsp, versions, uri, method, params) {
  const v = versions.get(uri); const p = lsp.request(method, params);
  return p.then(result => versions.get(uri) === v ? { stale: false, result } : { stale: true, result: null }, error => ({ stale: false, error }));
}

const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
const descendants = rootPid => {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=']).toString().trim().split('\n').map(l => l.trim().split(/\s+/).map(Number));
  const kids = new Map(); for (const [p, pp] of rows) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(p); }
  const all = []; const walk = p => { for (const k of kids.get(p) || []) { all.push(k); walk(k); } }; walk(rootPid); return all;
};
const waitDead = async (pids, ms) => { const t0 = performance.now(); while (performance.now() - t0 < ms) { if (!pids.some(alive)) return Math.round(performance.now() - t0); await sleep(50); } return null; };
const cases = []; const started = new Date().toISOString();
const run = async (id, title, fn) => { const t = performance.now(); try { const [status, evidence] = await fn(); cases.push({ id, title, status, ms: Math.round(performance.now() - t), evidence }); } catch (e) { cases.push({ id, title, status: 'failed', ms: Math.round(performance.now() - t), evidence: { exception: String(e?.stack || e).split('\n').slice(0, 3).join(' | ') } }); } };

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-lsp-proj-'));
const A = path.join(root, 'a.ts'), B = path.join(root, 'b.ts');
const aText = '// 加法：中文注释\nexport function add(x: number, y: number): number {\n  return x + y;\n}\n';
const bText = 'import { add } from "./a";\nconst 😀 = add(1, 2);\nconst list: number[] = [];\nconsole.log(😀, list.length);\nconst arr: Array<number> = list;\n';
fs.writeFileSync(A, aText); fs.writeFileSync(B, bText); fs.writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2020', module: 'commonjs', strict: true } }));
const uriA = pathToFileURL(A).href, uriB = pathToFileURL(B).href; const versions = new Map([[uriA, 1], [uriB, 1]]);
const lsp = new Lsp(root); const procs = () => execFileSync('ps', ['-axo', 'pid=,rss=,command=']).toString().split('\n').filter(l => l.includes('tsserver') || l.includes('typescript-language-server'));

await run('LS01', '握手与能力门控：只对服务端声明的能力发请求', async () => {
  await lsp.init(); lsp.open(A, aText); lsp.open(B, bText); await sleep(1500);
  const caps = lsp.caps; const gate = { definition: supports(caps, 'textDocument/definition'), references: supports(caps, 'textDocument/references'), hover: supports(caps, 'textDocument/hover'), implementation: supports(caps, 'textDocument/implementation') };
  return [gate.definition && gate.references && gate.hover ? 'passed' : 'failed', { readyMs: Math.round(lsp.ready), positionEncoding: caps.positionEncoding ?? '(未声明，LSP 默认 utf-16)', gate, unsupportedMethodGatedOff: !supports(caps, 'textDocument/foo') }];
});
await run('LS02', 'definition / references / hover 跨文件返回正确位置与类型文本', async () => {
  const pos = { line: 1, character: bText.split('\n')[1].indexOf('add') }; // 位于 emoji 之后，下面的 LS03 专门测列单位
  const col = bText.split('\n')[1].indexOf('add'); // JS 字符串下标 = UTF-16 单位
  const def = await lsp.request('textDocument/definition', { textDocument: { uri: uriB }, position: { line: 1, character: col } });
  const refs = await lsp.request('textDocument/references', { textDocument: { uri: uriA }, position: { line: 1, character: 17 }, context: { includeDeclaration: true } });
  const hover = await lsp.request('textDocument/hover', { textDocument: { uri: uriB }, position: { line: 1, character: col } });
  const d0 = Array.isArray(def) ? def[0] : def; const hv = typeof hover?.contents === 'string' ? hover.contents : hover?.contents?.value || '';
  const ok = d0 && classifyLocation(d0.uri, root).relativePath === 'a.ts' && d0.range.start.line === 1 && refs.length >= 3 && /add/.test(hv) && /number/.test(hv);
  return [ok ? 'passed' : 'failed', { definition: d0 && { file: classifyLocation(d0.uri, root).relativePath, line: d0.range.start.line }, referenceCount: refs.length, referenceFiles: [...new Set(refs.map(r => classifyLocation(r.uri, root).relativePath))], hover: hv.replace(/\s+/g, ' ').slice(0, 80) }];
});
await run('LS03', '列单位是 UTF-16：emoji 之后的符号用 UTF-16 列才命中，用“字符数”会偏移', async () => {
  const line = bText.split('\n')[1]; const utf16 = line.indexOf('add'); const codePoints = [...line.slice(0, utf16)].length;
  const good = await lsp.request('textDocument/definition', { textDocument: { uri: uriB }, position: { line: 1, character: utf16 } });
  const bad = await lsp.request('textDocument/definition', { textDocument: { uri: uriB }, position: { line: 1, character: codePoints } });
  const g = Array.isArray(good) ? good : good ? [good] : [], b = Array.isArray(bad) ? bad : bad ? [bad] : [];
  return [g.length > 0 && b.length === 0 ? 'passed' : 'failed', { utf16Column: utf16, codePointColumn: codePoints, hitWithUtf16: g.length, hitWithCodePoints: b.length, note: '行列必须按 UTF-16 单位换算（编辑器选区同为 UTF-16）；按字符数或字节数换算会错位' }];
});
await run('LS04', '过期响应：请求发出后文档版本变化，响应被丢弃而不是套到新文档上', async () => {
  const col = bText.split('\n')[1].indexOf('add');
  const p = guarded(lsp, versions, uriB, 'textDocument/definition', { textDocument: { uri: uriB }, position: { line: 1, character: col } });
  versions.set(uriB, 2); lsp.notify('textDocument/didChange', { textDocument: { uri: uriB, version: 2 }, contentChanges: [{ text: '// 新增一行\n' + bText }] });
  const r = await p;
  const fresh = await guarded(lsp, versions, uriB, 'textDocument/definition', { textDocument: { uri: uriB }, position: { line: 2, character: col } });
  return [r.stale === true && r.result === null && fresh.stale === false ? 'passed' : 'failed', { oldRequestStale: r.stale, newRequestStale: fresh.stale, freshHasResult: !!fresh.result }];
});
await run('LS05', '取消：$/cancelRequest 后请求以 RequestCancelled 或正常结果结束，不挂起', async () => {
  const col = bText.split('\n')[2].indexOf('add');
  const p = lsp.request('textDocument/references', { textDocument: { uri: uriA }, position: { line: 1, character: 17 }, context: { includeDeclaration: true } }, { timeoutMs: 8000 });
  lsp.notify('$/cancelRequest', { id: p.id }); let outcome;
  try { const r = await p; outcome = { kind: 'result', count: Array.isArray(r) ? r.length : null }; } catch (e) { outcome = { kind: 'error', code: e.code }; }
  return [outcome.kind === 'result' || outcome.code === -32800 ? 'passed' : 'failed', outcome];
});
await run('LS06', '延迟：20 次 definition 的 p50/p95，以及服务进程内存', async () => {
  const col = 0; const times = [];
  for (let i = 0; i < 20; i++) { const t = performance.now(); await lsp.request('textDocument/definition', { textDocument: { uri: uriB }, position: { line: 3, character: 8 } }); times.push(performance.now() - t); }
  const rows = procs().map(l => { const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/); return m && { pid: +m[1], rssMiB: Math.round(+m[2] / 1024), cmd: m[3].slice(0, 70) }; }).filter(Boolean);
  return ['passed', { runs: 20, p50Ms: pct(times, .5), p95Ms: pct(times, .95), maxMs: +Math.max(...times).toFixed(1), processes: rows, note: '本机 Node 22 上的单项目小样本；预算未冻结' }];
});
await run('LS07', '根外结果分类：definition 指向 typescript 内置 lib 时标记 outside-root（只读，不作为可编辑根内文件打开）', async () => {
  const line = bText.split('\n').findIndex(l => l.includes('Array<')); const col = bText.split('\n')[line].indexOf('Array');
  const r = await lsp.request('textDocument/definition', { textDocument: { uri: uriB }, position: { line, character: col } }).catch(() => null);
  const locs = [].concat(r || []); const kinds = locs.map(l => classifyLocation(l.uri, root)); const outside = kinds.filter(k => k.kind === 'outside-root');
  return [outside.length > 0 ? 'passed' : 'failed', { locations: kinds.map(k => k.kind === 'in-root' ? k.relativePath : '(outside) …' + k.path.slice(-48)), outsideCount: outside.length, policy: '根外位置只读展示、不加入根内标签、不获得保存能力' }];
});
await run('LS08', '崩溃：强杀服务父进程 —— 未完成请求立即被拒绝；记录其子孙进程是否遗留', async () => {
  const s = new Lsp(root); await s.init(); s.open(A, aText); await sleep(800);
  const kids = descendants(s.child.pid);
  const pending = s.request('textDocument/references', { textDocument: { uri: uriA }, position: { line: 1, character: 17 }, context: { includeDeclaration: true } }, { timeoutMs: 8000 });
  const t0 = performance.now(); s.child.kill('SIGKILL'); let rejected; try { await pending; rejected = 'resolved'; } catch (e) { rejected = e.code; }
  const rejectedMs = Math.round(performance.now() - t0);
  const diedMs = await waitDead(kids, 5000); const survivors = kids.filter(alive);
  for (const p of survivors) { try { process.kill(p, 'SIGKILL'); } catch {} }
  const fresh = new Lsp(root); await fresh.init(); fresh.open(B, bText); await sleep(1000);
  const again = await fresh.request('textDocument/definition', { textDocument: { uri: uriB }, position: { line: 1, character: bText.split('\n')[1].indexOf('add') } }); await fresh.stop();
  const ok = rejected === 'EXIT' && rejectedMs < 1500 && !!again;
  return [!ok ? 'failed' : diedMs === null ? 'observed-gap' : 'passed', { pendingRejectedWith: rejected, rejectedAfterMs: rejectedMs, descendantsBeforeKill: kids.length, descendantsDiedWithin5sMs: diedMs, survivorsAfter5s: survivors.length, restartedAndAnswered: !!again,
    meaning: diedMs === null ? '父进程被强杀后子孙进程在 5 秒内没有自行退出（已手工清除），生产必须按进程组清理' : '子孙进程在父进程被强杀后自行退出（耗时见 descendantsDiedWithinMs）' }];
});
await run('LS08b', '补救验证：服务自成进程组，kill(-pgid) 一次清掉整棵进程树', async () => {
  const s = new Lsp(root, { detached: true }); await s.init(); s.open(A, aText); await sleep(800);
  const kids = descendants(s.child.pid); const t0 = performance.now(); process.kill(-s.child.pid, 'SIGKILL'); const diedMs = await waitDead([s.child.pid, ...kids], 3000);
  return [diedMs !== null && kids.length > 0 ? 'passed' : 'failed', { treeSize: kids.length + 1, allDeadAfterMs: diedMs, note: '用进程组（detached + 负 pid 信号）可无遗留；Windows 需另用 taskkill /T，未验证' }];
});
await run('LS09', '正常关闭：shutdown+exit 后退出码 0，且整棵进程树在预算内退出', async () => {
  const s = new Lsp(root); await s.init(); s.open(A, aText); await sleep(700); const kids = descendants(s.child.pid); const t0 = performance.now(); await s.stop();
  const diedMs = await waitDead(kids, 3000); const survivors = kids.filter(alive); for (const p of survivors) { try { process.kill(p, 'SIGKILL'); } catch {} }
  return [s.exited?.code === 0 && diedMs !== null ? 'passed' : 'failed', { exit: s.exited, stopMs: Math.round(performance.now() - t0), descendants: kids.length, descendantsDiedWithinMs: diedMs, survivors: survivors.length }];
});
await run('LS10', '超时：无响应请求在预算内被拒绝（不让界面一直等待）', async () => {
  const s = new Lsp(root, { detached: true }); await s.init(); const kids = descendants(s.child.pid); s.child.kill('SIGSTOP'); const t0 = performance.now(); let code;
  try { await s.request('textDocument/hover', { textDocument: { uri: uriA }, position: { line: 1, character: 17 } }, { timeoutMs: 600 }); code = 'resolved'; } catch (e) { code = e.code; }
  const ms = Math.round(performance.now() - t0); try { process.kill(-s.child.pid, 'SIGCONT'); process.kill(-s.child.pid, 'SIGKILL'); } catch {} const diedMs = await waitDead([s.child.pid, ...kids], 3000);
  return [code === 'TIMEOUT' && ms < 1500 && diedMs !== null ? 'passed' : 'failed', { code, ms, cleanedUpAfterMs: diedMs }];
});
const finalKids = descendants(lsp.child.pid); await lsp.stop(); const finalDiedMs = await waitDead([lsp.child.pid, ...finalKids], 3000); const leftoverEnd = [lsp.child.pid, ...finalKids].filter(alive).length;
fs.rmSync(root, { recursive: true, force: true });
const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
fs.writeFileSync(out, JSON.stringify({ schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), server: 'typescript-language-server 4.3.4', typescript: '5.9.3' },
  scope: '仅 TypeScript 语言服务；最小自写 LSP 客户端；隔离临时项目；不含其他语言、服务器分发/安装、项目配置发现、工作区符号索引大项目性能',
  cases, endOfRun: { leftoverProcessesOfMainServer: leftoverEnd, mainServerTreeDiedAfterMs: finalDiedMs }, fixtureCleanup: { removed: !fs.existsSync(root) }, completedAt: new Date().toISOString(), summary }, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
