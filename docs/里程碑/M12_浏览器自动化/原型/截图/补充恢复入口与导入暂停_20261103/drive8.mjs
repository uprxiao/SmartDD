// M12 prototype R1.2 driver: review4 G04 (every import entry and the Agent are blocked while a profile needs attention) and the import-time page unload notice: isolated headless Chromium + CDP against the Vite dev server. Synthetic data only.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5180/?preview=m12';
const BIN = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9357;
await mkdir(OUT, { recursive: true });
const profile = await mkdtemp('/private/tmp/m12-p8-profile-');
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
const menuImportDisabled = () => ev(() => [...document.querySelectorAll('.bw-menu button')].find(b => b.textContent.includes('导入'))?.disabled ?? null);
try {
  ws = new WebSocket(await connect());
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', m => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } else if (msg.method === 'Runtime.exceptionThrown') result.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text); else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') result.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' ')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await waitFor(() => location.href.startsWith('http'), 'page loaded', 10000);
  await ev(() => { localStorage.clear(); });
  await send('Page.navigate', { url: BASE });
  await waitFor(() => document.querySelectorAll('.fw-web-tab').length > 0, 'preview task ready', 10000);

  await click('[aria-label="浏览器菜单"]');
  const enabledBefore = await menuImportDisabled();
  await click('[aria-label="关闭菜单"]');
  await click('.bw-demo button', '模拟导入恢复失败');
  await waitFor(() => !!document.querySelector('.bw-attention-banner'), 'attention banner');
  await click('[aria-label="浏览器菜单"]');
  const disabledAfter = await menuImportDisabled();
  check('G04-menu-import-blocked', enabledBefore === false && disabledAfter === true, { enabledBefore, disabledAfter });
  await shot('01-菜单导入被禁用');
  await click('[aria-label="关闭菜单"]');
  await click('.bw-demo button', '模拟 Agent 写命令');
  await waitFor(() => (document.querySelector('.bw-demo-status')?.textContent || '').includes('BROWSER_UNAVAILABLE'), 'agent refused');
  check('G04-agent-refused', await ev(() => !document.querySelector('.bw-banner.bw-agent')), {});
  await click('.bw-attention-banner .bw-mini', '去处理');
  await click('.bw-attention .bw-mini', '重试恢复');
  await waitFor(() => !document.querySelector('.bw-attention'), 'resolved');
  await click('.bw-dialog button', '完成');

  await click('[aria-label="浏览器菜单"]');
  await click('.bw-menu button', '导入 Chrome／Edge 登录态');
  await click('.bw-dialog button', '下一步');
  await waitFor(() => (document.querySelector('.bw-warn-list')?.textContent || '').includes('暂时卸载'), 'unload notice');
  check('R06.4-unload-notice', true, {});
  await shot('02-导入确认提示页面暂时卸载');
  await click('.bw-dialog button', '确认导入');
  await click('.bw-dialog button', '模拟允许');
  await waitFor(() => (document.querySelector('.bw-dialog .bw-kv')?.textContent || '').includes('重新加载的页面'), 'summary');
  check('R06.4-summary-reloaded-pages', await ev(() => !/冲突/.test(document.querySelector('.bw-dialog').textContent)), {});
  await shot('03-导入摘要');
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
