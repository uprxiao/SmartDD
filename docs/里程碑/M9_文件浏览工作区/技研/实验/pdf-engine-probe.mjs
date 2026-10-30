#!/usr/bin/env node
// M9-GAP-05 隔离实验：pdf.js（pdfjs-dist 5.4.296 legacy build）在 Node 中的真实 PDF 解析行为。
// 样本由 pdf-fixtures.py 生成（合成）。用法：node pdf-engine-probe.mjs --fixtures /tmp/m9-pdf --output result.json
// 注意：Node 下 pdf.js 使用同线程的 fake worker，没有画布；渲染、Worker 终止与画布尺寸上限在 Chromium 的原型检查里另测。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../../../..');
const pdfjs = await import(pathToFileURL(path.join(repo, 'prototypes/m6-codex/node_modules/pdfjs-dist/legacy/build/pdf.mjs')).href);
const args = process.argv.slice(2);
const arg = k => args[args.indexOf(k) + 1];
const fixtures = arg('--fixtures'), output = arg('--output');
if (!fixtures || !output) { console.error('usage: pdf-engine-probe.mjs --fixtures DIR --output FILE'); process.exit(2); }
const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'prototypes/m6-codex/node_modules/pdfjs-dist/package.json'), 'utf8'));
const read = name => new Uint8Array(fs.readFileSync(path.join(fixtures, name)));
const open = (name, extra = {}) => pdfjs.getDocument({ data: read(name), verbosity: 0, isEvalSupported: false, useSystemFonts: false, ...extra });
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return +s[Math.min(s.length - 1, Math.floor(q * s.length))].toFixed(1); };
const rss = () => Math.round(process.memoryUsage().rss / 1048576);
const cases = []; const started = new Date().toISOString();
const run = async (id, title, fn) => {
  const t = performance.now();
  try { const [status, evidence] = await fn(); cases.push({ id, title, status, ms: +(performance.now() - t).toFixed(1), evidence }); }
  catch (e) { cases.push({ id, title, status: 'failed', ms: +(performance.now() - t).toFixed(1), evidence: { exception: String(e?.stack || e) } }); }
};
const failure = async (name, extra) => { try { const doc = await open(name, extra).promise; const n = doc.numPages; await doc.destroy(); return { opened: true, numPages: n }; } catch (e) { return { opened: false, name: e.name, code: e.code ?? null, message: String(e.message).slice(0, 120) }; } };

await run('PD01', '正常 PDF：页数、中文文本层、链接注解、书签大纲与目的地解析', async () => {
  const doc = await open('normal.pdf').promise;
  const texts = []; const links = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent(); texts.push(content.items.map(x => x.str).join(''));
    for (const a of await page.getAnnotations()) if (a.subtype === 'Link') links.push({ page: i, url: a.url ?? null, dest: a.dest ?? null, rect: a.rect.map(v => +v.toFixed(0)) });
  }
  const outline = await doc.getOutline();
  const targets = [];
  for (const item of outline || []) { const d = typeof item.dest === 'string' ? await doc.getDestination(item.dest) : item.dest; targets.push({ title: item.title, pageIndex: d ? await doc.getPageIndex(d[0]) : null }); }
  const internal = links.find(l => l.dest); let internalIndex = null;
  if (internal) { const d = Array.isArray(internal.dest) ? internal.dest : await doc.getDestination(internal.dest); internalIndex = await doc.getPageIndex(d[0]); }
  const meta = await doc.getMetadata(); const all = texts.join('\n');
  const ev = { numPages: doc.numPages, chineseTextLayer: all.includes('文件浏览工作区') && all.includes('English mixed'), markers: ['PAGE_ONE_MARKER', 'PAGE_TWO_MARKER', 'PAGE_THREE_MARKER'].map(m => all.includes(m)), externalLink: links.some(l => l.url === 'https://example.invalid/external'), internalLinkTargetsPageIndex: internalIndex, outline: targets, producer: meta.info?.Producer ?? null };
  await doc.destroy();
  const ok = ev.numPages === 3 && ev.chineseTextLayer && ev.markers.every(Boolean) && ev.externalLink && ev.internalLinkTargetsPageIndex === 2 && targets.map(t => t.pageIndex).join() === '1,2';
  return [ok ? 'passed' : 'failed', ev];
});

await run('PD02', '200 页：加载+全部页文本提取耗时（5 次）与内存', async () => {
  const times = []; const before = rss(); let peak = before;
  for (let r = 0; r < 5; r++) {
    const t = performance.now(); const doc = await open('many-200.pdf').promise;
    for (let i = 1; i <= doc.numPages; i++) { const p = await doc.getPage(i); await p.getTextContent(); p.cleanup(); }
    times.push(performance.now() - t); peak = Math.max(peak, rss()); await doc.destroy();
  }
  global.gc?.(); await new Promise(r => setTimeout(r, 100));
  return ['passed', { pages: 200, runs: 5, loadAndExtractMs: { p50: pct(times, .5), p95: pct(times, .95), max: +Math.max(...times).toFixed(1) }, rssMiB: { before, peak, after: rss() }, note: 'Node 同线程 fake worker，不含渲染；不是 Chromium 数字，预算未冻结' }];
});

await run('PD03', '密码保护：缺失/错误/正确密码分别可区分，且不泄漏内容', async () => {
  const none = await failure('encrypted.pdf');
  const wrong = await failure('encrypted.pdf', { password: 'wrong' });
  const right = await open('encrypted.pdf', { password: 'm9-user' }).promise; const page = await right.getPage(1); const text = (await page.getTextContent()).items.map(x => x.str).join(''); await right.destroy();
  let flow = null;
  const task = open('encrypted.pdf'); const calls = [];
  task.onPassword = (update, reason) => { calls.push(reason); update(reason === pdfjs.PasswordResponses.NEED_PASSWORD ? 'bad' : 'm9-user'); };
  const d2 = await task.promise; flow = { callbackReasons: calls, pages: d2.numPages }; await d2.destroy();
  const ok = none.name === 'PasswordException' && none.code === 1 && wrong.name === 'PasswordException' && wrong.code === 2 && text.includes('文件浏览工作区') && JSON.stringify(calls) === '[1,2]';
  return [ok ? 'passed' : 'failed', { noPassword: none, wrongPassword: wrong, correctPasswordReadsText: text.includes('文件浏览工作区'), onPasswordFlow: flow, codes: 'NEED_PASSWORD=1, INCORRECT_PASSWORD=2' }];
});

await run('PD04', '损坏/伪装文件：错误类型可区分，不挂起', async () => {
  const res = {};
  for (const n of ['truncated.pdf', 'garbage.pdf', 'not-pdf.pdf']) { const t = performance.now(); res[n] = { ...(await failure(n)), ms: +(performance.now() - t).toFixed(1) }; }
  const bad = Object.values(res).some(r => r.ms > 5000);
  return [bad ? 'failed' : 'passed', { results: res, note: 'truncated 可能被 pdf.js 重建 xref 而成功打开（opened=true 时页数可能少于原文件），界面必须显示“文件可能不完整”而不是当作正常' }];
});

await run('PD05', '极大页面：计算画布尺寸并核对保护策略', async () => {
  const doc = await open('bigpage.pdf').promise; const page = await doc.getPage(1); const v = page.getViewport({ scale: 1 }); await doc.destroy();
  const area = v.width * v.height, cap = 16 * 1024 * 1024;
  const scale = area > cap ? Math.sqrt(cap / area) : 1;
  return [v.width === 14400 && scale < 1 ? 'passed' : 'failed', { widthPt: v.width, heightPt: v.height, pixelsAtScale1: area, assumedCanvasAreaCap: cap, safeScale: +scale.toFixed(4), note: '14400×14400 在 scale=1 就有 2.07 亿像素，超过 Safari 常见上限（约 1670 万像素）；必须按面积封顶并显示降采样提示，实际画布分配在 Chromium 检查中验证' }];
});

await run('PD06', '取消：加载中与提取中 destroy，及时返回并拒绝后续请求', async () => {
  // (a) 加载尚未完成时立刻 destroy
  const t0 = performance.now(); const loading = open('many-200.pdf'); const pending = loading.promise.then(() => 'resolved', e => e.name || 'rejected'); await loading.destroy(); const loadingOutcome = await pending; const loadingDestroyMs = +(performance.now() - t0).toFixed(1);
  // (b) 同步发出 200 个 getPage+getTextContent 后立刻 destroy（不留让它们先完成的间隙）
  const task = open('many-200.pdf'); const doc = await task.promise; let resolved = 0, rejected = 0; const names = new Set();
  const jobs = Array.from({ length: 200 }, (_, i) => doc.getPage(i + 1).then(p => p.getTextContent()).then(() => resolved++, e => { rejected++; names.add(e.name || 'rejected'); }));
  const t1 = performance.now(); await task.destroy(); const destroyMs = +(performance.now() - t1).toFixed(1); await Promise.allSettled(jobs);
  let after; try { await doc.getPage(1); after = 'resolved'; } catch (e) { after = e.name || 'rejected'; }
  const ok = loadingOutcome !== 'resolved' && after !== 'resolved' && rejected + resolved === 200 && destroyMs < 1000;
  return [ok ? 'passed' : 'failed', { loadingDestroyOutcome: loadingOutcome, loadingDestroyMs, extraction: { resolvedBeforeDestroy: resolved, rejectedByDestroy: rejected, rejectionNames: [...names], destroyMs }, getPageAfterDestroy: after, note: rejected === 0 ? '本机太快，提取在 destroy 前已全部完成，(b) 只证明 destroy 后拒绝新请求' : 'destroy 使未完成请求被拒绝' }];
});

const summary = cases.reduce((m, c) => (m[c.status] = (m[c.status] || 0) + 1, m), {});
fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, startedAt: started, scriptSha256: crypto.createHash('sha256').update(fs.readFileSync(fileURLToPath(import.meta.url))).digest('hex'),
  environment: { node: process.version, platform: process.platform, arch: process.arch, osRelease: os.release(), pdfjsDist: pkg.version, pdfjsLicense: pkg.license, build: 'legacy (Node)' },
  fixtures: JSON.parse(fs.readFileSync(path.join(fixtures, 'manifest.json'), 'utf8')), scope: 'Synthetic PDFs; pdf.js in Node (fake worker, no canvas); no Chromium rendering; no production implementation', cases, completedAt: new Date().toISOString(), summary }, null, 2));
console.log(JSON.stringify(summary)); for (const c of cases) console.log(c.id, c.status, c.title);
process.exit(summary.failed ? 1 : 0);
