import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const { chromium } = createRequire('/private/tmp/m9-qa/package.json')('playwright-core');
const root = process.cwd(), out = path.join(root, 'docs/里程碑/M9_文件浏览工作区/验收/证据/r34-pdf-runtime');
const budget = JSON.parse(fs.readFileSync(path.join(root, 'prototypes/m6-codex/tests/fixtures/r34-pdf/budget.json')));
fs.mkdirSync(out, { recursive: true });
const checks = [], errors = [], workers = [], external = [], shots = [];
const check = (id, title, ok, detail = {}) => { checks.push({ id, title, status: ok ? 'passed' : 'failed', detail }); console.log(id, ok ? 'PASS' : 'FAIL', title); };
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('worker', worker => { const record = { worker, url: worker.url(), created: Date.now(), closed: null }; workers.push(record); worker.on('close', () => { record.closed = Date.now(); }); });
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:4176/')) external.push(request.url()); });
await context.route(/^https?:\/\/(?!127\.0\.0\.1:4176)/, route => route.abort());
const wait = ms => page.waitForTimeout(ms);
const show = async config => { await page.evaluate(value => window.r34.show(value), config); };
const ready = async () => { await page.waitForFunction(() => document.querySelector('.fa-pdf-scroll canvas[data-rendered="true"]'), { timeout: 15000 }); };
const clean = async () => { await show({ kind: 'none' }); await page.waitForFunction(() => window.r34.snapshot().active === 0); await wait(100); };
const shot = async name => { const filename = path.join(out, name); await page.screenshot({ path: filename }); shots.push({ file: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex') }); };
let fatal, measurements = [];
try {
  await page.goto('http://127.0.0.1:4176/tests/r34-pdf-runtime.html');
  await page.waitForFunction(() => window.r34?.show);
  await page.evaluate(() => { window.__longTasks = []; new PerformanceObserver(list => window.__longTasks.push(...list.getEntries().map(x => x.duration))).observe({ type: 'longtask', buffered: false }); });
  const invalid = await page.evaluate(async () => { try { await r34.createPdfSession({ url: {} }); return 'unexpected-success'; } catch (error) { return error.message; } });
  await wait(100);
  check('PDF00', 'synchronous invalid source rejection disposes its native worker', invalid !== 'unexpected-success' && await page.evaluate(() => r34.snapshot().active) === 0 && workers.every(x => x.closed), { error: invalid, runtime: await page.evaluate(() => r34.snapshot()) });
  await show({ kind: 'pdf' }); await ready();
  check('PDF01', 'native dedicated pdf.js worker renders artifact canvas/text/links', workers.some(x => x.url.includes('pdf.worker')) && await page.locator('.fa-pdf-text span').count() > 0 && await page.locator('.fa-pdf-link').count() === 2, { runtime: await page.evaluate(() => r34.snapshot()), workerUrls: workers.map(x => x.url) });
  await shot('r34-pdf-artifact.png');
  // Actual uncaught worker exception, not a synthetic Window ErrorEvent.
  const active = workers.findLast(x => !x.closed); await active.worker.evaluate(() => { setTimeout(() => { throw new Error('r34 controlled worker crash'); }, 0); });
  await page.getByRole('alert').waitFor();
  check('PDF02', 'real worker crash surfaces error and terminates owned worker', (await page.getByRole('alert').innerText()).includes('工作进程意外退出'), { alert: await page.getByRole('alert').innerText() });
  const retryAt = Date.now(); await page.getByRole('button', { name: '重试', exact: true }).click(); await ready();
  check('PDF03', 'retry creates a fresh native worker and renders', Date.now() - retryAt < budget.workerFailureRecoveryMsMax, { ms: Date.now() - retryAt });
  await clean();
  // Explicit close is silent in browser Worker API; an actual pending PDF RPC must time out.
  await page.evaluate(async () => { const s = await r34.createPdfSession({ url: '/assets/m9-pdf/normal.pdf', timeoutMs: 5000 }); r34.probe = s; r34.doc = await s.ready; });
  const silent = workers.findLast(x => !x.closed); await silent.worker.evaluate(() => close()).catch(() => {});
  const silentResult = await page.evaluate(async () => { try { await r34.probe.run(r34.doc.getPage(3)); return 'unexpected-success'; } catch (e) { await r34.probe.destroy(); return e.name; } });
  check('PDF04', 'real worker self-exit rejects pending operation by watchdog', silentResult === 'PdfWorkerTimeout', { error: silentResult, runtime: await page.evaluate(() => r34.snapshot()) });
  // Cancellation with the real PDF request still in flight.
  await page.route('**/assets/m9-pdf/r34-large.pdf', async route => { await new Promise(resolve => setTimeout(resolve, 800)); await route.continue().catch(() => {}); });
  await show({ kind: 'pdf', source: 'r34-large' }); await page.waitForFunction(() => r34.snapshot().active > 0);
  const cancelledAt = Date.now(); await clean();
  check('PDF05', 'cancel loading terminates native worker within budget', Date.now() - cancelledAt < budget.cancelDisposeMsMax && workers.every(x => x.closed), { ms: Date.now() - cancelledAt });
  await page.unroute('**/assets/m9-pdf/r34-large.pdf');
  await show({ kind: 'pdf-review' }); await ready();
  check('PDF06', 'review route has canvas and pager, no text/link/comment layer', await page.locator('.fa-pdf-scroll article').count() === 1 && await page.locator('.fa-pdf-text,.fa-pdf-link,button[aria-label="PDF 评论"]').count() === 0, {});
  await page.getByRole('button', { name: '下一页', exact: true }).click(); await ready();
  check('PDF07', 'review next page changes canvas identity', await page.locator('.fa-pdf-scroll article').getAttribute('data-page') === '2');
  await shot('r34-pdf-review.png');
  const reviewWorker = workers.findLast(x => !x.closed); await reviewWorker.worker.evaluate(() => close()).catch(() => {});
  const exitAt = Date.now(); await page.getByRole('button', { name: '下一页', exact: true }).click();
  await page.getByRole('alert').waitFor({ timeout: 20000 });
  check('PDF14', 'review canvas operation detects real silent worker exit through shared watchdog', (await page.getByRole('alert').innerText()).includes('响应超时') && Date.now() - exitAt < 19000, { ms: Date.now() - exitAt, alert: await page.getByRole('alert').innerText(), watchdogMs: 15000 });
  await clean();
  await show({ kind: 'pdf', source: 'r34-cjk' }); await ready();
  const cjk = await page.locator('.fa-pdf-text').innerText();
  const painted = await page.locator('.fa-pdf-scroll canvas').first().evaluate(c => { const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let dark = 0; for (let i=0;i<data.length;i+=4) if (data[i]<128) dark++; return dark; });
  check('PDF08', 'non-embedded CJK CMap extracts expected Chinese and paints glyphs', cjk.replace(/\s/g, '').includes('文件工作区中文测试') && painted > 100, { text: cjk, darkPixels: painted, caveat: 'system CJK fallback; pixel glyph correctness inspected separately' });
  await shot('r34-pdf-cjk.png'); await clean();
  const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('HeapProfiler.collectGarbage');
  const heap = async () => (await cdp.send('Performance.getMetrics')).metrics.find(x => x.name === 'JSHeapUsedSize').value;
  const baselineHeap = await heap(); await page.evaluate(() => { window.__longTasks = []; });
  for (let round = 1; round <= budget.rounds; round++) {
    const started = Date.now(); await show({ kind: 'pdf', source: 'r34-large' }); await ready();
    const openedMs = Date.now() - started;
    const initialPages = await page.locator('.fa-pdf-scroll article').count();
    await page.locator('nav button[aria-label="第 2000 页"]').click();
    await page.waitForFunction(() => document.querySelector('.fa-pdf-scroll article[data-page="2000"] canvas[data-rendered="true"]'));
    const pages = await page.locator('.fa-pdf-scroll article').count(), canvases = await page.locator('canvas').count();
    if (round === 1) await shot('r34-pdf-2000-pages.png');
    await clean(); await cdp.send('HeapProfiler.collectGarbage');
    measurements.push({ round, openedMs, initialPages, lastPageNodes: pages, canvasElements: canvases, postGcHeap: await heap() });
  }
  const longTasks = await page.evaluate(() => window.__longTasks);
  check('PDF09', '2000-page open/end-page access keeps bounded mounted pages and canvases (3 rounds)', measurements.every(x => x.openedMs < budget.openReadyMsMax && x.initialPages <= budget.mountedMainPagesMax && x.lastPageNodes <= budget.mountedMainPagesMax && x.canvasElements <= budget.canvasElementsMax), { budget, measurements });
  check('PDF10', 'large PDF close returns worker count to zero and bounded post-GC page heap', await page.evaluate(() => r34.snapshot().active) === 0 && measurements.at(-1).postGcHeap - baselineHeap < budget.postGcHeapGrowthBytesMax, { baselineHeap, finalHeap: measurements.at(-1).postGcHeap, workerRecords: workers.map(({url,created,closed})=>({url,created,closed})) });
  check('PDF11', 'large PDF main-thread long tasks remain within declared smoke budget', Math.max(0,...longTasks) < budget.mainLongTaskMsMax, { longTasks, max: Math.max(0,...longTasks), budgetMs: budget.mainLongTaskMsMax });
  await show({ kind: 'pdf' }); await ready(); await page.getByRole('button', { name: 'PDF 评论', exact: true }).click();
  async function addComment(body, y) {
    const box = await page.locator('.fa-pdf-scroll article').first().boundingBox();
    await page.mouse.click(box.x + box.width * .5, box.y + box.height * y);
    await page.getByRole('textbox', { name: 'PDF 评论内容' }).fill(body);
    await page.locator('.fa-pdf-editor').getByRole('button', { name: '添加', exact: true }).click();
  }
  await addComment('first context', .50); await addComment('second context', .55);
  await page.evaluate(() => { r34.replies = [{ status: 'inserted' }, { status: 'unknown' }]; });
  await page.getByRole('button', { name: '插入上下文', exact: true }).click();
  await page.waitForFunction(() => r34.state?.comments.phase === 'unknown');
  check('PDF12', 'batch tracks each delivery; unknown is retained without auto-resend or CLI completion', await page.evaluate(() => r34.insertions.length === 2 && r34.state.comments.requests[0].delivery === 'inserted' && r34.state.comments.requests[1].delivery === 'unknown' && r34.insertions.every(x => !/[\r\n]$/.test(x.text))) && await page.getByRole('button', { name: '插入上下文', exact: true }).isDisabled(), { state: await page.evaluate(() => r34.state.comments), inserted: await page.evaluate(() => r34.insertions) });
  await shot('r34-pdf-delivery.png'); await clean();
  const malicious = { cells: [
    { cell_type:'markdown', source:'# Read only\n<script>parent.__r34Executed=1</script>\n![remote](https://example.invalid/markdown-image)' },
    { cell_type:'code', execution_count:3, source:'print("must not execute")', outputs:[
      {output_type:'display_data',data:{'text/html':'<style>.static-output{color:rgb(12, 34, 56)}</style><style>@import url(https://example.invalid/import);</style><h2 class="static-output" style="font-weight:600">safe output</h2><script>parent.__r34Executed=1</script><img src="https://example.invalid/html-image" onerror="parent.__r34Executed=2"><iframe src="https://example.invalid/frame"></iframe><form action="https://example.invalid/form"><input></form><div style="background:url(https://example.invalid/css)">styled</div><div style="background:u\\72l(https://example.invalid/escaped-css)">escaped</div><div style="background:image-set(&quot;https://example.invalid/image-set&quot; 1x)">image-set</div><a href="https://example.invalid/link">link</a>'}},
      {output_type:'display_data',data:{'image/svg+xml':'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="40"><script>parent.__r34Executed=3</script><rect width="100" height="40" fill="green"/></svg>'}},
      {output_type:'display_data',data:{'application/json':{nested:[1,true,'中文']}}},
      {output_type:'stream',text:'stream output'},
      {output_type:'error',ename:'ValueError',evalue:'fixture error',traceback:['safe traceback']},
      {output_type:'display_data',data:{'application/vnd.vega.v5+json':{data:[]},'text/plain':'fallback output'}}
    ]}
  ],nbformat:4,nbformat_minor:5,metadata:{} };
  await page.evaluate(() => { window.__r34Executed = 0; }); await show({ kind:'notebook', value:JSON.stringify(malicious) }); await page.locator('iframe').waitFor(); await wait(400);
  const frame = page.frames().find(x => x.parentFrame());
  check('NB01', 'Notebook complex outputs render without executing code/scripts', await page.evaluate(() => window.__r34Executed) === 0 && await page.locator('.fa-notebook').innerText().then(t => t.includes('stream output') && t.includes('ValueError') && t.includes('fallback output')) && await page.locator('code.hljs').count() > 0, { sentinel: await page.evaluate(() => window.__r34Executed), outputTypes: ['html','svg','json','stream','error','vega fallback'] });
  check('NB02', 'HTML output is sandboxed, strips active content and cannot make external requests', await page.locator('iframe').getAttribute('sandbox') === '' && await frame.locator('script,iframe,form,input,[onclick],[onerror],[href]').count() === 0 && external.length === 0, { forbiddenNodes: await frame.locator('script,iframe,form,input,[href]').count(), external });
  check('NB03', 'static HTML/CSS output survives resource cleanup', await frame.locator('h2.static-output').evaluate(el => getComputedStyle(el).color === 'rgb(12, 34, 56)' && getComputedStyle(el).fontWeight === '600') && await frame.locator('style').count() === 2, { styleCount: await frame.locator('style').count(), color: await frame.locator('h2.static-output').evaluate(el => getComputedStyle(el).color) });
  await shot('r34-notebook-complex.png'); await clean();
  check('PDF13', 'all test-owned native workers closed, no unhandled page errors', workers.every(x => x.closed) && errors.length === 0, { workersCreated:workers.length, workersClosed:workers.filter(x=>x.closed).length, errors });
} catch (error) { fatal = error.stack; check('FATAL','runtime probe completed',false,{error:fatal}); await shot('r34-failure.png').catch(()=>{}); }
finally {
  const report = { schemaVersion:1, ranAt:new Date().toISOString(), browser:await browser.version(), target:'http://127.0.0.1:4176/tests/r34-pdf-runtime.html', scope:'isolated synthetic WillYou prototype; real Chromium workers; no Codex operations; not formal App acceptance', budget, checks, measurements, screenshots:shots, errors, externalRequests:external, summary:checks.reduce((a,c)=>(a[c.status]=(a[c.status]||0)+1,a),{}) };
  fs.writeFileSync(path.join(out,'r34-pdf-runtime-report.json'),JSON.stringify(report,null,2)); await browser.close();
  console.log(JSON.stringify(report.summary)); if (checks.some(x=>x.status==='failed')) process.exitCode=1;
}
