#!/usr/bin/env node
// M9-GAP-08 隔离实验：文件监听失效后的恢复策略（FS10–FS12 的补充）。
// WatchGuard 是实验原型：目录级 fs.watch 只作“失效提示”，真值来自 stat 快照重扫；
// 事件风暴/错误/原子替换后 resync；原生监听不可用时退回有界轮询；stop() 释放全部句柄与定时器。
// 只使用 Node 标准库与随机临时目录，不读取用户文件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const args = process.argv.slice(2);
const output = args[args.indexOf('--output') + 1];
if (!output) { console.error('usage: watch-recovery-probe.mjs --output result.json'); process.exit(2); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nativeAvailable = async root => {
  // 与 FS10 一致：先探测当前进程里目录原生 watch 是否真的收得到事件
  let got = false; const w = fs.watch(root, () => { got = true; });
  fs.writeFileSync(path.join(root, '.probe'), String(Date.now())); await sleep(300); w.close(); fs.rmSync(path.join(root, '.probe'), { force: true });
  return got;
};

function snapshot(root) {
  const out = new Map();
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else if (e.isFile()) { const s = fs.statSync(p); out.set(path.relative(root, p), `${s.ino}:${s.size}:${s.mtimeMs}`); }
    }
  };
  walk(root); return out;
}
function diff(a, b) {
  const changes = [];
  for (const [k, v] of b) if (!a.has(k)) changes.push(['add', k]); else if (a.get(k) !== v) changes.push(['change', k]);
  for (const k of a.keys()) if (!b.has(k)) changes.push(['remove', k]);
  return changes;
}
class WatchGuard {
  constructor(root, { onChanges, burstLimit = 500, pollMs = 50, factory = (dir, cb) => fs.watch(dir, cb) }) {
    Object.assign(this, { root, onChanges, burstLimit, pollMs, factory });
    this.state = { coverage: 'none', resyncRequired: false, error: null, generations: 0, events: 0 };
    this.snap = snapshot(root); this.timer = null; this.watcher = null; this.pollTimer = null; this.pending = 0; this.stopped = false;
    this.bind();
  }
  bind() {
    try {
      this.watcher = this.factory(this.root, () => { this.state.events++; this.pending++; this.schedule(); });
      this.watcher.on?.('error', e => this.degrade(e));
      this.state.coverage = 'native'; this.state.generations++;
    } catch (e) { this.degrade(e); }
  }
  degrade(e) {
    this.state.error = String(e?.code || e?.message || e); this.state.coverage = 'poll';
    try { this.watcher?.close(); } catch {} this.watcher = null;
    if (!this.pollTimer && !this.stopped) { this.pollTimer = setInterval(() => this.rescan(), this.pollMs); }
  }
  schedule() { if (this.timer || this.stopped) return; this.timer = setTimeout(() => { this.timer = null; this.rescan(); }, 20); }
  rescan() {
    if (this.stopped) return;
    if (this.pending > this.burstLimit) this.state.resyncRequired = true;
    this.pending = 0;
    let next; try { next = snapshot(this.root); this.state.error = null; } catch (e) { this.state.error = String(e.code || e.message); this.state.coverage = this.watcher ? this.state.coverage : 'poll'; return; }
    const changes = diff(this.snap, next); this.snap = next;
    if (changes.length) this.onChanges(changes, { ...this.state });
  }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.pollTimer); this.timer = this.pollTimer = null; try { this.watcher?.close(); } catch {} this.watcher = null; }
}

const resources = () => process.getActiveResourcesInfo().reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
const cases = [];
const run = async (id, title, fn) => {
  const t0 = performance.now();
  try { const [status, evidence] = await fn(); cases.push({ id, title, status, durationMs: +(performance.now() - t0).toFixed(2), evidence }); }
  catch (e) { cases.push({ id, title, status: 'failed', durationMs: +(performance.now() - t0).toFixed(2), evidence: { exception: String(e?.stack || e) } }); }
};
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-watch-'));
const mk = n => { const d = path.join(base, n); fs.mkdirSync(d, { recursive: true }); return d; };
const started = new Date().toISOString();
const native = await nativeAvailable(mk('probe'));

await run('WR01', '原子替换后，绑定旧 inode 的文件级 watch 失明；目录级 guard 仍收到后续就地编辑', async () => {
  const root = mk('wr01'), file = path.join(root, 'f.txt'); fs.writeFileSync(file, 'v1');
  let fileEvents = 0; const fw = fs.watch(file, () => { fileEvents++; });
  const seen = []; const g = new WatchGuard(root, { onChanges: c => seen.push(...c.map(x => x.join(':'))) });
  fs.writeFileSync(file + '.tmp', 'v2'); fs.renameSync(file + '.tmp', file); await sleep(250);
  const afterReplace = fileEvents; fs.appendFileSync(file, '-edited'); await sleep(300);
  const out = { fileWatchEventsAfterReplace: afterReplace, fileWatchEventsAfterEdit: fileEvents, guardChanges: seen, coverage: g.state.coverage };
  fw.close(); g.stop();
  if (!native) return ['skipped', { ...out, reason: '当前进程目录原生 watch 不可用；见 WR03/WR06 的轮询回退' }];
  return [fileEvents === afterReplace && seen.some(s => s === 'change:f.txt') ? 'passed' : 'failed', out];
});

await run('WR02', '事件风暴：超过阈值标记 resyncRequired，重扫后最终快照完整（不依赖逐事件账）', async () => {
  const root = mk('wr02'); const seen = new Map(); let flagged = false;
  const g = new WatchGuard(root, { burstLimit: 50, onChanges: (c, st) => { flagged ||= st.resyncRequired; for (const [k, p] of c) seen.set(p, k); } });
  for (let i = 0; i < 3000; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), String(i));
  await sleep(1200); g.rescan(); await sleep(50);
  const ok = seen.size === 3000;
  const out = { createdFiles: 3000, rescanSawFiles: seen.size, eventsDelivered: g.state.events, resyncFlagged: flagged, coverage: g.state.coverage };
  g.stop();
  if (!native) return [ok ? 'passed' : 'failed', { ...out, note: '原生 watch 不可用，由轮询回退达成' }];
  return [ok && flagged ? 'passed' : 'failed', out];
});

await run('WR03', '注入原生 watch 创建失败 → 自动退回轮询并检测新增/修改/删除', async () => {
  const root = mk('wr03'); fs.writeFileSync(path.join(root, 'a.txt'), 'a'); const seen = [];
  const g = new WatchGuard(root, { pollMs: 30, factory: () => { const e = new Error('inject'); e.code = 'EMFILE'; throw e; }, onChanges: c => seen.push(...c.map(x => x.join(':'))) });
  fs.writeFileSync(path.join(root, 'b.txt'), 'b'); fs.appendFileSync(path.join(root, 'a.txt'), '2'); await sleep(150); fs.rmSync(path.join(root, 'a.txt')); await sleep(150);
  const out = { coverage: g.state.coverage, error: g.state.error, seen };
  g.stop();
  return [g.state.coverage === 'poll' && ['add:b.txt', 'change:a.txt', 'remove:a.txt'].every(s => seen.includes(s)) ? 'passed' : 'failed', out];
});

await run('WR04', '目录权限被移除 → 记录错误并保持降级；权限恢复后自动补扫', async () => {
  if (process.platform === 'win32' || process.getuid?.() === 0) return ['skipped', { reason: 'chmod 语义不适用或以 root 运行' }];
  const root = mk('wr04'), sub = path.join(root, 'sub'); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'x.txt'), 'x'); const seen = []; const states = [];
  const g = new WatchGuard(root, { pollMs: 30, factory: () => { throw Object.assign(new Error('poll only'), { code: 'EMFILE' }); }, onChanges: c => seen.push(...c.map(x => x.join(':'))) });
  fs.chmodSync(sub, 0o000); await sleep(120); states.push({ error: g.state.error, coverage: g.state.coverage });
  fs.chmodSync(sub, 0o755); fs.writeFileSync(path.join(sub, 'y.txt'), 'y'); await sleep(150); states.push({ error: g.state.error, coverage: g.state.coverage });
  g.stop();
  return [states[0].error && !states[1].error && seen.includes('add:sub/y.txt') ? 'passed' : 'failed', { states, seen }];
});

await run('WR05', 'stop() 释放原生 watcher 与全部定时器；停止后文件变化不再回调', async () => {
  const root = mk('wr05'); const before = resources(); let calls = 0;
  const gs = Array.from({ length: 20 }, () => new WatchGuard(root, { pollMs: 20, onChanges: () => { calls++; } }));
  const during = resources(); gs.forEach(g => g.stop());
  await sleep(100); const baselineCalls = calls; fs.writeFileSync(path.join(root, 'late.txt'), 'x'); await sleep(200);
  const after = resources();
  const leaked = (after.FSEventWrap || 0) - (before.FSEventWrap || 0), leakedTimers = (after.Timeout || 0) - (before.Timeout || 0);
  return [leaked <= 0 && leakedTimers <= 0 && calls === baselineCalls ? 'passed' : 'failed', { before, during, after, callsAfterStop: calls - baselineCalls }];
});

await run('WR06', '轮询成本：2000 文件仅 stat 快照的耗时分布（决定生产轮询频率与预算）', async () => {
  const root = mk('wr06'); for (let i = 0; i < 2000; i++) fs.writeFileSync(path.join(root, `f${i}.txt`), 'x');
  const times = []; for (let i = 0; i < 20; i++) { const t = performance.now(); snapshot(root); times.push(performance.now() - t); }
  times.sort((a, b) => a - b); const p = q => +times[Math.min(times.length - 1, Math.floor(q * times.length))].toFixed(1);
  return ['passed', { files: 2000, runs: 20, p50Ms: p(0.5), p95Ms: p(0.95), maxMs: +times.at(-1).toFixed(1), note: '仅 stat，未读内容/hash；50ms 轮询全项目扫描在此规模已不可接受，生产需只扫已展开目录+已打开文件并退避' }];
});

fs.rmSync(base, { recursive: true, force: true });
const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
const report = { schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(new URL(import.meta.url))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), nativeDirectoryWatchWorks: native },
  scope: 'Synthetic temporary directories; WatchGuard research prototype; no Electron or production implementation',
  cases, fixtureCleanup: { removed: !fs.existsSync(base) }, completedAt: new Date().toISOString(), summary };
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
