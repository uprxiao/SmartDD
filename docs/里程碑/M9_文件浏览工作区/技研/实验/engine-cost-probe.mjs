#!/usr/bin/env node
// M9-GAP-09 隔离实验：Markdown 解析/渲染引擎的耗时、内存、取消、崩溃与损坏输入。
// 对象是原型实际使用的 markdown-it + KaTeX + js-yaml（经 prototypes/m6-codex/src/file-markdown-model.mjs）。
// 样本由固定种子生成（冻结），全部为合成文本；不读取用户文件，不联网。
// 预算数字是实验结论的输入，不是已批准的产品指标。
import { Worker } from 'node:worker_threads';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const modelUrl = pathToFileURL(path.join(repo, 'prototypes/m6-codex/src/file-markdown-model.mjs')).href;
const args = process.argv.slice(2);

if (args[0] === '--worker') {
  // Worker 内：按 mode 执行，用于取消/崩溃/超时测试
  const { parentPort, workerData } = await import('node:worker_threads');
  const { parseMarkdown, renderMarkdownBlock } = await import(modelUrl);
  if (workerData.mode === 'crash') process.exit(13);
  if (workerData.mode === 'throw') throw new Error('injected worker failure');
  const { blocks, env } = parseMarkdown(workerData.text);
  parentPort.postMessage({ phase: 'parsed', blocks: blocks.length });
  let n = 0; for (const b of blocks) if (b.tokens) { renderMarkdownBlock(b, env); n++; if (n % 2000 === 0) await new Promise(r => setImmediate(r)); }
  parentPort.postMessage({ phase: 'rendered', rendered: n });
  process.exit(0);
}

const output = args[args.indexOf('--output') + 1];
if (!output) { console.error('usage: engine-cost-probe.mjs --output result.json'); process.exit(2); }
const { parseMarkdown, renderMarkdownBlock } = await import(modelUrl);

// ---- 冻结样本 ----
let seed = 20261017; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
const WORDS = ['文件', '工作区', 'WillYou', 'markdown', '终端', '😀', 'alpha', '保存', '冲突', 'resolve'];
const para = () => Array.from({ length: 12 }, () => WORDS[rnd(WORDS.length)]).join(' ');
function makeDoc(bytes, { math = true } = {}) {
  const parts = []; let size = 0, i = 0;
  while (size < bytes) {
    const k = i++ % 8; let s;
    if (k === 0) s = `## 小节 ${i}\n\n`;
    else if (k === 1) s = `${para()} **粗** *斜* \`code\` [链接](docs/a${i}.md)${math ? ` $x_${i}^2+1$` : ''}\n\n`;
    else if (k === 2) s = `- ${para()}\n  - 嵌套 ${para()}\n- [ ] 任务 ${i}\n\n`;
    else if (k === 3) s = `| a | b |\n|---|--:|\n| ${para()} | ${i} |\n\n`;
    else if (k === 4) s = `> ${para()}\n\n`;
    else if (k === 5) s = '```js\nconst a = ' + i + ';\n```\n\n';
    else if (k === 6 && math) s = `$$\n\\frac{${i}}{2}\n$$\n\n`;
    else s = `${para()}\n\n`;
    parts.push(s); size += Buffer.byteLength(s);
  }
  return parts.join('');
}
const samples = {
  '100KiB': makeDoc(100 * 1024), '1MiB': makeDoc(1024 * 1024), '10MiB': makeDoc(10 * 1024 * 1024),
  '1MiB-nomath': makeDoc(1024 * 1024, { math: false })
};
const sampleHashes = Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, crypto.createHash('sha256').update(v).digest('hex')]));

const pct = (arr, q) => { const a = [...arr].sort((x, y) => x - y); return +a[Math.min(a.length - 1, Math.floor(q * a.length))].toFixed(1); };
const mem = () => { global.gc?.(); return Math.round(process.memoryUsage().rss / 1048576); };
const cases = []; const started = new Date().toISOString();
const run = async (id, title, fn) => {
  const t0 = performance.now();
  try { const [status, evidence] = await fn(); cases.push({ id, title, status, durationMs: +(performance.now() - t0).toFixed(1), evidence }); }
  catch (e) { cases.push({ id, title, status: 'failed', durationMs: +(performance.now() - t0).toFixed(1), evidence: { exception: String(e?.stack || e) } }); }
};

await run('EC01', '主线程解析 + 全量渲染耗时（冷/热，5 次取 p50/p95）', async () => {
  const out = {};
  for (const [name, text] of Object.entries(samples)) {
    const runs = 5, parse = [], render = [];
    for (let i = 0; i < runs; i++) {
      let t = performance.now(); const { blocks, env } = parseMarkdown(text); parse.push(performance.now() - t);
      t = performance.now(); for (const b of blocks) if (b.tokens) renderMarkdownBlock(b, env); render.push(performance.now() - t);
      if (i === runs - 1) out[name] = { blocks: blocks.length, parseColdMs: +parse[0].toFixed(1), parseP50Ms: pct(parse, .5), parseP95Ms: pct(parse, .95), renderAllP50Ms: pct(render, .5), renderAllP95Ms: pct(render, .95) };
    }
  }
  return ['passed', { runs: out, note: '组件每次 text 变化重新 parse 全文；渲染按块，未变化的块应缓存。数字仅反映本机 Node，不是 Chromium 主线程' }];
});

await run('EC02', '内存：解析 10MiB 前后 RSS 与释放（5 轮）', async () => {
  const rows = [];
  for (let i = 0; i < 5; i++) { const before = mem(); let r = parseMarkdown(samples['10MiB']); const during = mem(); r = null; await new Promise(r => setTimeout(r, 50)); rows.push({ before, during, after: mem() }); }
  const growth = rows.at(-1).after - rows[0].before;
  return [growth < 100 ? 'passed' : 'failed', { rssMiB: rows, growthOverFiveRunsMiB: growth, gcExposed: typeof global.gc === 'function', note: '5 轮后 RSS 增长应有界；单次峰值约等于 during-before' }];
});

const runWorker = (mode, text, { cancelAfterMs, timeoutMs = 120000 } = {}) => new Promise(resolve => {
  const t0 = performance.now(); const events = []; let settled = false, intent = null, tc = 0;
  const w = new Worker(fileURLToPath(import.meta.url), { argv: ['--worker'], workerData: { mode, text } });
  const done = (kind, extra = {}) => { if (settled) return; settled = true; clearTimeout(timer); resolve({ kind, ms: +(performance.now() - t0).toFixed(1), events, ...extra }); };
  const stop = why => { intent = why; tc = performance.now(); w.terminate(); };   // terminate() 的退出码恒为 1，用 intent 区分“被我们终止”与“自己失败”
  const timer = setTimeout(() => stop('timeout'), timeoutMs);
  w.on('message', m => events.push(m.phase)); w.on('error', e => done('error', { message: e.message }));
  w.on('exit', code => done(intent || 'exit', { code, ...(intent ? { terminateMs: +(performance.now() - tc).toFixed(1) } : {}) }));
  if (cancelAfterMs != null) setTimeout(() => stop('cancelled'), cancelAfterMs);
});

await run('EC03', 'Worker 正常完成 10MiB（主线程不被占用）', async () => {
  let ticks = 0; const iv = setInterval(() => ticks++, 10);
  const r = await runWorker('ok', samples['10MiB']); clearInterval(iv);
  return [r.kind === 'exit' && r.code === 0 && r.events.includes('rendered') ? 'passed' : 'failed', { ...r, mainThreadTicksDuring: ticks, expectedTicksIfBlockedNearZero: Math.round(r.ms / 10) }];
});

await run('EC04', '取消：Worker 处理 10MiB 中途 terminate，及时返回且无后续消息', async () => {
  const r = await runWorker('ok', samples['10MiB'], { cancelAfterMs: 150 });
  return [r.kind === 'cancelled' && !r.events.includes('rendered') && r.terminateMs < 1000 ? 'passed' : 'failed', r];
});

await run('EC05', '崩溃与异常：Worker process.exit / 抛错不拖垮主进程，错误可区分', async () => {
  const crash = await runWorker('crash', ''), thrown = await runWorker('throw', '');
  const ok = crash.kind === 'exit' && crash.code === 13 && thrown.kind === 'error' && /injected/.test(thrown.message);
  return [ok ? 'passed' : 'failed', { crash, thrown, mainProcessAlive: true }];
});

await run('EC06', '超时：看门狗 terminate 卡死/过长任务并报告 timeout', async () => {
  const r = await runWorker('ok', samples['10MiB'], { timeoutMs: 100 });
  return [r.kind === 'timeout' ? 'passed' : 'failed', r];
});

await run('EC07', '损坏/极端输入：NUL、孤立代理对、深嵌套、超长行、未闭合围栏——不抛错且字节往返', async () => {
  const nasty = {
    nul: 'a\u0000b\n', loneSurrogate: 'x\ud800y\n', deepQuote: '>'.repeat(5000) + ' x\n', deepList: Array.from({ length: 500 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n') + '\n',
    longLine: 'a'.repeat(2_000_000) + '\n', tableMany: '|' + 'a|'.repeat(2000) + '\n|' + '-|'.repeat(2000) + '\n', unclosed: '```js\n' + 'x\n'.repeat(1000), emphasis: '*'.repeat(50000) + 'a' + '*'.repeat(50000)
  };
  const rows = {}; let bad = 0;
  for (const [name, text] of Object.entries(nasty)) {
    const t = performance.now(); let err = null, bytes = false, rendered = 0;
    try { const { blocks, env } = parseMarkdown(text); bytes = blocks.map(b => b.raw).join('') === text; for (const b of blocks) if (b.tokens) { renderMarkdownBlock(b, env); rendered++; } } catch (e) { err = String(e.message).slice(0, 80); }
    const ms = +(performance.now() - t).toFixed(1); rows[name] = { ms, bytesRoundTrip: bytes, rendered, error: err }; if (err || !bytes) bad++;
  }
  const slow = Object.entries(rows).filter(([, v]) => v.ms > 1500).map(([k, v]) => `${k}:${v.ms}ms`);
  return [bad ? 'failed' : slow.length ? 'observed-gap' : 'passed', { rows, slowOver1500ms: slow, note: '损坏输入的 CPU 耗时必须由 Worker 超时兜底，不能在渲染主线程直接解析不受信任的大文本' }];
});

await run('EC08', '依赖清单：版本、许可证、安装体积（用于锁定与分发评估）', async () => {
  const nm = path.join(repo, 'prototypes/m6-codex/node_modules');
  const du = dir => { let t = 0; const w = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? w(p) : e.isFile() && (t += fs.statSync(p).size); } }; w(dir); return Math.round(t / 1024); };
  const info = {};
  for (const name of ['markdown-it', 'markdown-it-texmath', 'katex', 'js-yaml', 'mermaid']) {
    const pkg = JSON.parse(fs.readFileSync(path.join(nm, name, 'package.json'), 'utf8'));
    info[name] = { version: pkg.version, license: pkg.license, installKiB: du(path.join(nm, name)) };
  }
  return ['passed', { info, note: '仅包自身体积，不含传递依赖；mermaid 为运行时动态 import，体积见构建产物' }];
});

const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
const report = { schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), cpus: os.cpus().length, cpuModel: os.cpus()[0].model, totalMemMiB: Math.round(os.totalmem() / 1048576) },
  frozenSamples: { generator: 'makeDoc seed 20261017', sha256: sampleHashes }, scope: 'Synthetic generated text; Node main/worker threads; no Chromium, no production implementation',
  cases, completedAt: new Date().toISOString(), summary };
fs.writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
