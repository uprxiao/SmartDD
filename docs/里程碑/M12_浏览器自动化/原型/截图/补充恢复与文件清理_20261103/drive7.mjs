// M12 prototype R1.1 driver: review3 F09 (profile needs attention after a failed rollback; retry / clear) and R01.13 (browser file usage and cleanup): isolated headless Chromium + CDP against the Vite dev server. Synthetic data only.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5180/?preview=m12';
const BIN = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9354;
await mkdir(OUT, { recursive: true });
const profile = await mkdtemp('/private/tmp/m12-p7-profile-');
const proc = spawn(BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = { at: new Date().toISOString(), boundary: 'P: prototype dev server, synthetic data; header entry, shortcut and launcher through real input events', checks: [], errors: [] };
let ws, seq = 0; const pending = new Map();
async function connect() {
  for (let i = 0; i < 50; i++) { try { const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); const page = list.find(t => t.type === 'page'); if (page) return page.webSocketDebuggerUrl; } catch {} await sleep(200); }
  throw new Error('no CDP');
}
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
async function ev(fn, ...args) {
  const r = await send('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(args)})`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
async function waitFor(fn, label, timeout = 6000, ...args) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { try { if (await ev(fn, ...args)) return; } catch {} await sleep(100); }
  throw new Error('timeout: ' + label);
}
async function click(selector, text = null) {
  await waitFor((s, t) => [...document.querySelectorAll(s)].some(e => t === null || e.textContent.trim() === t), 'present ' + selector + ' ' + text, 6000, selector, text);
  const p = await ev((s, t) => { const all = [...document.querySelectorAll(s)].filter(e => t === null || e.textContent.trim() === t); for (const e of all) { e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue; const x = b.x + b.width / 2, y = b.y + b.height / 2; if (e.contains(document.elementFromPoint(x, y))) return { x, y }; } throw new Error('no visible unoccluded ' + s); }, selector, text);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(OUT, name + '.png'), Buffer.from(r.data, 'base64')); }
const state = () => ev(() => ({
  route: location.hash.slice(1),
  newWeb: !!document.querySelector('[aria-label="新建网页标签"]'),
  webTabs: document.querySelectorAll('.fw-web-tab').length,
  webLayer: !!document.querySelector('.fw-web-layer'),
  fileOpen: !!document.querySelector('[aria-label="查找并打开文件"]'),
}));
const check = (id, pass, detail) => result.checks.push({ id, pass, ...detail });
async function key(keyName, code, modifiers) {
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: keyName, code, modifiers, windowsVirtualKeyCode: keyName.toUpperCase().charCodeAt(0) });
}
async function address(text) {
  await click('[aria-label="地址栏"]');
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: type === 'keyDown' ? ['selectAll'] : [] });
  await send('Input.insertText', { text });
  for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: '\r' } : {}) });
}
const attention = () => ev(() => ({ banner: !!document.querySelector('.bw-attention-banner'), card: !!document.querySelector('.bw-attention'), importDisabled: [...document.querySelectorAll('.bw-profile-detail .bw-mini')].find(b => b.textContent.includes('导入'))?.disabled ?? null }));
try {
  ws = new WebSocket(await connect());
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', m => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } else if (msg.method === 'Runtime.exceptionThrown') result.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text); else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') result.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' ')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await ev(() => { localStorage.clear(); });
  await send('Page.navigate', { url: BASE });
  await waitFor(() => document.querySelectorAll('.fw-web-tab').length > 0, 'preview task ready', 10000);

  await click('.bw-demo button', '模拟导入恢复失败');
  await waitFor(() => !!document.querySelector('.bw-attention-banner'), 'attention banner');
  await shot('01-需要处理横幅');
  await click('.bw-attention-banner .bw-mini', '去处理');
  await waitFor(() => !!document.querySelector('.bw-attention'), 'attention card');
  const inDialog = await attention();
  check('F09-attention-shown-import-blocked', inDialog.banner === false || inDialog.card, inDialog);
  check('F09-import-disabled', inDialog.importDisabled === true, inDialog);
  await shot('02-登录态需要处理');
  await click('.bw-attention .bw-mini', '重试恢复');
  await waitFor(() => !document.querySelector('.bw-attention'), 'retry cleared');
  check('F09-retry-clears', (await attention()).importDisabled === false, await attention());
  await click('.bw-dialog button', '完成');
  await waitFor(() => !document.querySelector('.bw-attention-banner'), 'banner gone');

  await click('.bw-demo button', '模拟导入恢复失败');
  await click('.bw-attention-banner .bw-mini', '去处理');
  await click('.bw-attention .bw-mini', '清空该登录态');
  await waitFor(() => [...document.querySelectorAll('.bw-attention .bw-mini')].some(b => b.textContent.trim() === '确认清空'), 'confirm shown');
  check('F09-clear-needs-confirm', await ev(() => !!document.querySelector('.bw-attention')), {});
  await click('.bw-attention .bw-mini', '确认清空');
  await waitFor(() => !document.querySelector('.bw-attention'), 'cleared');
  check('F09-clear-resolves', true, {});
  await click('.bw-dialog button', '完成');

  await click('[aria-label="浏览器菜单"]');
  await click('.bw-menu button', '浏览器设置');
  await waitFor(() => !!document.querySelector('[aria-label="浏览器文件占用"]'), 'settings usage');
  const before = await ev(() => document.querySelector('[aria-label="浏览器文件占用"]').textContent);
  await shot('03-设置里的浏览器文件');
  await click('.bw-dialog .bw-mini', '清理全部浏览器文件');
  await click('.bw-dialog .bw-mini', '确认清理');
  await waitFor(() => document.querySelector('[aria-label="浏览器文件占用"]')?.textContent === '0 MB', 'cleaned');
  check('R01.13-cleanup', /MB/.test(before) && before !== '0 MB', { before, after: '0 MB' });
  await click('.bw-dialog button', '完成');
} catch (error) {
  result.failure = String(error?.stack || error);
} finally {
  result.pass = !result.failure && result.errors.length === 0 && result.checks.every(c => c.pass);
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  try { ws?.close(); } catch {}
  proc.kill();
  console.log(JSON.stringify({ pass: result.pass, failure: result.failure, errors: result.errors, checks: result.checks.map(c => [c.id, c.pass]) }));
}
