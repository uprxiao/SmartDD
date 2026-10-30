// Actual FileArtifactPreview -> FileOfficePreview with a controlled Promise adapter.
// Synthetic document state only; this probe never starts a CLI, writes Office bytes, or sends a model request.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const { chromium } = createRequire('/private/tmp/m9-qa/package.json')('playwright-core');
const root = process.cwd(), out = path.join(root, 'docs/里程碑/M9_文件浏览工作区/验收/证据');
const target = 'http://127.0.0.1:4176/tests/r34-office-context-runtime.html';
const checks = [], errors = [], external = [], screenshots = [];
const check = (id, title, pass, details = {}) => { checks.push({ id, title, status: pass ? 'passed' : 'failed', details }); console.log(id, pass ? 'PASS' : 'FAIL', title); };
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--disable-background-networking','--disable-sync','--no-first-run'] });
const context = await browser.newContext({ viewport: { width: 1280, height: 960 }, deviceScaleFactor: 1 });
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
await context.route('**/*', route => { const url = route.request().url(); if (/^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4176/')) { external.push(url); return route.abort(); } return route.continue(); });
const wait = ms => page.waitForTimeout(ms);
const show = async config => { await page.evaluate(value => officeContextProbe.show(value), config); await wait(60); };
const snapshot = () => page.evaluate(() => ({ calls: officeContextProbe.calls, states: [...document.querySelectorAll('[data-office-delivery]')].map(el => ({ state: el.dataset.officeDelivery, text: el.textContent })), draft: document.querySelector('[aria-label="Office 评论草稿"]')?.value }));
const reset = async (kind = 'pptx', file = '/synthetic/演示 文档.pptx', adapter = true) => {
  await show({ visible: false });
  await page.evaluate(() => { officeContextProbe.calls = []; officeContextProbe.replies = []; officeContextProbe.pending = {}; });
  await show({ visible: true, kind, path: file, adapter, reset: true });
  await page.getByRole('button', { name: '请求修改', exact: true }).click();
};
const add = async text => { await page.getByRole('textbox', { name: 'Office 评论草稿', exact: true }).fill(text); await page.getByRole('button', { name: '添加到请求', exact: true }).click(); };
const send = () => page.getByRole('button', { name: '插入上下文', exact: true }).click();
const states = async values => page.waitForFunction(expected => {
  const actual = [...document.querySelectorAll('[data-office-delivery]')].map(el => el.dataset.officeDelivery);
  return JSON.stringify(actual) === JSON.stringify(expected);
}, values, { timeout: 5000 });
const shot = async name => { const filename = `r34-office-context-${name}.png`; await page.screenshot({ path: path.join(out, filename) }); screenshots.push({ file: filename, sha256: sha(fs.readFileSync(path.join(out, filename))) }); };
try {
  await page.goto(target); await page.waitForFunction(() => window.officeContextProbe?.show);

  await reset(); await page.locator('.fo-element.kind-text').first().click(); await add('请调整所选标题，保留原有备注。'); await send(); await states(['inserted']);
  let s = await snapshot();
  check('OC01', 'real Artifact route forwards path/page/object context without trailing Enter', s.calls.length === 1 && s.calls[0].metadata?.source === 'office-comment' && s.calls[0].metadata?.path === '/synthetic/演示 文档.pptx' && s.calls[0].metadata?.page === 1 && s.calls[0].metadata?.elementId === 'el-0-title' && s.calls[0].text.includes('/synthetic/演示 文档.pptx') && s.calls[0].text.includes('请调整所选标题') && !/[\r\n]$/.test(s.calls[0].text), s);

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ status: 'failed', message: 'controlled rejection before write' }, { status: 'inserted' }]; });
  await add('失败后保留这条原文'); await send(); await states(['failed']);
  const failed = await snapshot(); await page.getByRole('button', { name: '重试失败评论', exact: true }).click(); await states(['inserted']); s = await snapshot();
  check('OC02', 'explicit failure preserves text and retries only the failed comment', failed.states[0].text.includes('失败后保留这条原文') && s.calls.length === 2 && s.calls[0].text === s.calls[1].text, { failed, retried: s });

  const unknownResults = [];
  for (const [mode, text] of [['unknown','未知回执'],['missing','无回执'],['throw','回调抛错']]) {
    await reset(); await page.evaluate(mode => { officeContextProbe.replies = [mode === 'missing' ? undefined : mode === 'throw' ? { throw: true } : { status: 'unknown' }]; }, mode);
    await add(text); await send(); await states(['unknown']); await wait(150); s = await snapshot();
    unknownResults.push({ mode, ...s, buttonDisabled: await page.getByRole('button', { name: '插入上下文', exact: true }).isDisabled(), retryButtons: await page.getByRole('button', { name: '重试失败评论', exact: true }).count() });
  }
  check('OC03', 'unknown/missing/thrown acknowledgements remain unknown and cannot auto-retry', unknownResults.every(r => r.calls.length === 1 && r.buttonDisabled && r.retryButtons === 0 && r.states.length === 1), unknownResults);

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ defer: true }]; }); await add('正在投递的旧评论'); await send(); await states(['inserting']);
  await page.getByRole('textbox', { name: 'Office 评论草稿', exact: true }).fill('等待期间写下的新草稿');
  await page.evaluate(() => officeContextProbe.resolve(0, { status: 'inserted' })); await states(['inserted']); s = await snapshot();
  check('OC04', 'settling a pending insertion never clears a newer draft', s.draft === '等待期间写下的新草稿' && s.calls.length === 1 && s.calls[0].text.includes('正在投递的旧评论') && !s.calls[0].text.includes('等待期间'), s);

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ status: 'inserted' }, { status: 'failed' }, { status: 'inserted' }, { status: 'unknown' }]; });
  for (const text of ['批次成功', '批次失败', '批次未知']) await add(text);
  await send(); await states(['inserted','failed','queued']); const mixed = await snapshot();
  await page.getByRole('button', { name: '重试失败评论', exact: true }).click(); await states(['inserted','inserted','unknown']); s = await snapshot();
  check('OC05', 'batch stops on failure, explicit retry resumes only failed/queued entries', s.calls.length === 4 && s.calls[2].text === s.calls[1].text && mixed.calls.length === 2 && mixed.states.map(x => x.state).join(',') === 'inserted,failed,queued', { mixed, retried: s }); await shot('mixed-batch');

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ defer: true }]; }); await add('旧路径等待项'); await send(); await states(['inserting']);
  await show({ path: '/synthetic/另一份 文档.pptx' });
  if (!await page.getByRole('textbox', { name: 'Office 评论草稿', exact: true }).count()) await page.getByRole('button', { name: '请求修改', exact: true }).click();
  await add('新路径未投递项'); await states(['queued']);
  await page.evaluate(() => officeContextProbe.resolve(0, { status: 'inserted' })); await wait(120); s = await snapshot();
  check('OC06', 'same mounted component path change discards the old insertion acknowledgement', s.calls.length === 1 && s.states.length === 1 && s.states[0].state === 'queued' && s.states[0].text.includes('新路径未投递项') && !s.states[0].text.includes('旧路径'), s);

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ defer: true }]; }); await add('已卸载页面的评论'); await send(); await states(['inserting']);
  await show({ visible: false }); await page.evaluate(() => officeContextProbe.resolve(0, { status: 'inserted' })); await wait(120);
  await show({ visible: true, path: '/synthetic/重新打开.pptx', reset: true }); await page.getByRole('button', { name: '请求修改', exact: true }).click(); s = await snapshot();
  check('OC07', 'unmount drops late results and a fresh file has no previous delivery state', s.calls.length === 1 && s.states.length === 0 && s.draft === '', s);

  await reset('docx', '/synthetic/中文说明.docx');
  await page.locator('.fo-doc-rail button').last().click(); await add('第三页段落上下文'); await send(); await states(['inserted']); s = await snapshot();
  check('OC08', 'DOCX legacy route forwards its own path and active page through Artifact', s.calls.length === 1 && s.calls[0].metadata?.path === '/synthetic/中文说明.docx' && s.calls[0].metadata?.page === 3 && !/[\r\n]$/.test(s.calls[0].text), s); await shot('docx-context');

  await reset('pptx', '/synthetic/无适配器.pptx', false); await add('缺适配器必须保留'); await send(); await states(['failed']); s = await snapshot();
  check('OC09', 'missing adapter is a visible failure with retained original text', s.calls.length === 0 && s.states[0].text.includes('缺适配器必须保留'), s);

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ defer: true }, { defer: true }]; }); await add('第一代A'); await send(); await states(['inserting']);
  await show({ path: '/synthetic/B.pptx' }); await show({ path: '/synthetic/演示 文档.pptx' }); await add('新一代A'); await send(); await states(['inserting']);
  await page.evaluate(() => officeContextProbe.resolve(0, { status: 'inserted' })); await wait(100); const abaPending = await snapshot();
  await page.evaluate(() => officeContextProbe.resolve(1, { status: 'failed' })); await states(['failed']); s = await snapshot();
  check('OC11', 'A-to-B-to-A scope reuse rejects old results even while new same-ID delivery is pending', abaPending.calls.length === 2 && abaPending.states.length === 1 && abaPending.states[0].state === 'inserting' && abaPending.states[0].text.includes('新一代A') && s.states[0].state === 'failed', { beforeNewReply: abaPending, afterNewReply: s });

  await reset(); await page.evaluate(() => { officeContextProbe.replies = [{ defer: true }]; }); await add('真实等待超时保留项'); const started = Date.now(); await send(); await states(['unknown']); const timeoutMs = Date.now() - started;
  await page.evaluate(() => officeContextProbe.resolve(0, { status: 'inserted' })); await wait(100); s = await snapshot();
  check('OC12', 'real two-second timeout becomes unknown and ignores a late success', timeoutMs >= 1900 && timeoutMs < 4000 && s.calls.length === 1 && s.states[0].state === 'unknown' && await page.getByRole('button', { name: '插入上下文', exact: true }).isDisabled(), { timeoutMs, ...s });
  await show({ visible: false }); await wait(100);
  check('OC10', 'isolated route produces no external requests or unhandled page errors', errors.length === 0 && external.length === 0, { errors, external });
} catch (error) { check('FATAL', 'Office context browser probe completes', false, { error: error.stack }); await shot('failure').catch(() => {}); }
finally {
  const files = ['prototypes/m6-codex/src/FileOfficePreview.jsx','prototypes/m6-codex/src/FileArtifactPreview.jsx','prototypes/m6-codex/src/file-office-context-model.mjs','prototypes/m6-codex/tests/r34-office-context-harness.jsx','prototypes/m6-codex/tests/r34-office-context-runtime.html'];
  const report = { ranAt: new Date().toISOString(), browser: await browser.version(), target, scope: 'Synthetic Office model and Promise insertion adapter via actual FileArtifactPreview; no real Office codec/PTY/CLI/model; not formal M9 acceptance', checks, screenshots, errors, externalRequests: external, sourceHashes: Object.fromEntries(files.map(file => [file, sha(fs.readFileSync(path.join(root,file)))])), scriptSha256: sha(fs.readFileSync(new URL(import.meta.url))), summary: checks.reduce((r,c) => (r[c.status] = (r[c.status] || 0) + 1, r), {}) };
  fs.writeFileSync(path.join(out,'r34-office-context-browser-result.json'), JSON.stringify(report,null,2)+'\n');
  await browser.close(); console.log(JSON.stringify(report.summary)); if (checks.some(c => c.status === 'failed')) process.exitCode = 1;
}
