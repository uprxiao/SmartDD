// M12 prototype R0.8 driver: downloads behind a toolbar button, browser dialogs scoped to the browser pane: isolated headless Chromium + CDP against the Vite dev server. Synthetic data only.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5180/?preview=m12';
const BIN = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9352;
await mkdir(OUT, { recursive: true });
const profile = await mkdtemp('/private/tmp/m12-p5-profile-');
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
const frameTop = () => ev(() => Math.round(document.querySelector('.bw-frame').getBoundingClientRect().top));
const geometry = () => ev(() => {
  const r = e => { const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const root = document.querySelector('.bw-root'), scrim = document.querySelector('.bw-scrim'), dialog = document.querySelector('.bw-scrim [role=dialog]');
  const rr = r(root), dr = r(dialog), sr = r(scrim);
  const terminalPoint = document.elementFromPoint(400, 500);
  return { root: rr, scrim: sr, dialog: dr, dx: Math.abs(dr.x + dr.w / 2 - (rr.x + rr.w / 2)), dy: Math.abs(dr.y + dr.h / 2 - (rr.y + rr.h / 2)), terminalCovered: !!terminalPoint?.closest('.bw-scrim'), title: dialog.getAttribute('aria-label') };
});
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

  await address('https://qa.example.test/orders/1024');
  await waitFor(() => [...document.querySelectorAll('.bw-site-link')].some(e => e.textContent.trim() === '导出订单 CSV'), 'order page');
  const before = await frameTop();
  await click('.bw-site-link', '导出订单 CSV');
  await waitFor(() => !!document.querySelector('.bw-downloads') && !!document.querySelector('[aria-label^="下载（"]'), 'popover opened by new download');
  await click('.bw-site-link', '导出订单 CSV');
  await waitFor(() => [...document.querySelectorAll('.bw-download-text span')].filter(e => e.textContent.includes('已保存到')).length === 2, 'both done', 5000);
  const during = await frameTop();
  await shot('01-下载列表弹出不挤压页面');
  check('R01.7-no-push', before === during, { before, during });
  const t0 = Date.now();
  await waitFor(() => !document.querySelector('.bw-downloads'), 'auto folded', 9000);
  check('R01.7-auto-fold', Date.now() - t0 < 9000, { foldedAfterMs: Date.now() - t0, busyDotGone: await ev(() => !document.querySelector('.bw-dl-busy')) });
  await shot('02-下载收起只剩工具栏按钮');
  await click('[aria-label="下载（2）"]');
  await waitFor(() => !!document.querySelector('.bw-downloads'), 'reopened from toolbar');
  await click('.bw-download .bw-mini', '在文件夹中显示');
  await click('[aria-label="收起下载列表"]');
  await waitFor(() => !document.querySelector('.bw-downloads'), 'closed by button');
  await click('[aria-label="下载（2）"]');
  await waitFor(() => !!document.querySelector('.bw-downloads'), 'reopened again');
  await click('[aria-label="地址栏"]');
  await waitFor(() => !document.querySelector('.bw-downloads'), 'outside click folds');
  check('R01.7-reopen-and-outside-click', true, {});

  await click('[aria-label="浏览器菜单"]');
  await click('.bw-menu button', '浏览器设置');
  await waitFor(() => !!document.querySelector('.bw-scrim [role=dialog]'), 'settings dialog');
  const g1 = await geometry();
  check('R0.8-dialog-in-pane', JSON.stringify(g1.scrim) === JSON.stringify(g1.root) && g1.dx <= 2 && g1.dy <= 2 && !g1.terminalCovered, g1);
  await shot('03-设置弹框只在浏览器区域居中');
  await click('.bw-dialog button', '完成');
  await address('https://auth.example.test/');
  await waitFor(() => !!document.querySelector('.bw-scrim [role=dialog]'), 'auth dialog');
  const g2 = await geometry();
  check('R0.8-auth-in-pane', JSON.stringify(g2.scrim) === JSON.stringify(g2.root) && g2.dx <= 2 && g2.dy <= 2 && !g2.terminalCovered, g2);
  await shot('04-基本认证弹框只在浏览器区域');
  await click('.bw-dialog button', '登录');
} catch (error) {
  result.failure = String(error?.stack || error);
} finally {
  result.pass = !result.failure && result.errors.length === 0 && result.checks.every(c => c.pass);
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  try { ws?.close(); } catch {}
  proc.kill();
  console.log(JSON.stringify({ pass: result.pass, failure: result.failure, errors: result.errors, checks: result.checks.map(c => [c.id, c.pass]) }, null, 1));
}
