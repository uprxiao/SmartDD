// M12 prototype R0.7 new-tab entry (header button, ⇧⌘B) and launcher driver: isolated headless Chromium + CDP against the Vite dev server. Synthetic data only.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5180/?preview=m12';
const BIN = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9351;
await mkdir(OUT, { recursive: true });
const profile = await mkdtemp('/private/tmp/m12-p4-profile-');
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
const NEW_TAB = '[aria-label="新建标签页（⇧⌘B）"]';
const view = () => ev(() => ({
  header: !!document.querySelector('[aria-label="新建标签页（⇧⌘B）"]'),
  panel: !!document.querySelector('[aria-label="查找并打开文件"]'),
  webTabs: document.querySelectorAll('.fw-web-tab').length,
  launcher: !!document.querySelector('.bw-launcher'),
  sites: [...document.querySelectorAll('.bw-launcher-site .bw-launcher-name')].map(e => e.textContent),
  empty: !!document.querySelector('.bw-launcher-empty'),
  tools: [...document.querySelectorAll('.bw-launcher-tool span')].map(e => e.textContent),
}));
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

  const tabsInitial = (await view()).webTabs;
  await click('[aria-label="隐藏文件工作区"]');
  await waitFor(() => !document.querySelector('[aria-label="查找并打开文件"]'), 'right panel closed');
  const closed = await view();
  await click(NEW_TAB);
  await waitFor(() => !!document.querySelector('.bw-launcher'), 'header button opened launcher');
  const opened = await view();
  check('R01.11-header', closed.header && !closed.panel && opened.panel && opened.launcher && opened.webTabs === tabsInitial + 1, { tabsInitial, closed, opened });
  check('R01.11-recent', opened.sites.includes('登录 · 测试环境') && opened.tools.join() === '文件', { sites: opened.sites, tools: opened.tools });
  await shot('01-标题栏按钮打开启动页');

  await click('.bw-launcher-site .bw-launcher-name', '登录 · 测试环境');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '登录', 'recent site opened');
  check('R01.11-open-recent', true, {});

  const tabsBefore = (await view()).webTabs;
  await click('[aria-label="隐藏文件工作区"]');
  await waitFor(() => !document.querySelector('[aria-label="查找并打开文件"]'), 'closed again');
  await ev(() => document.querySelector('.terminal-panel, .xterm, main')?.focus?.());
  await key('B', 'KeyB', 4 | 8);
  await waitFor(() => !!document.querySelector('.bw-launcher'), 'shortcut opened launcher');
  const viaKey = await view();
  check('R01.11-shortcut', viaKey.panel && viaKey.launcher && viaKey.webTabs === tabsBefore + 1, { tabsBefore, viaKey });

  await click('.bw-launcher-tool span', '文件');
  await waitFor(() => !document.querySelector('.fw-web-layer'), 'file view shown');
  check('R01.11-files-tool', await ev(() => !!document.querySelector('[aria-label="查找并打开文件"]') && !document.querySelector('.fw-web-layer')), {});
  await shot('02-文件工具切回文件视图');

  await ev(() => { location.hash = 'project/smartdd/overview'; });
  await waitFor(() => location.hash === '#project/smartdd/overview', 'project view');
  check('U1-project-view', !(await view()).header, {});
  await shot('03-项目视图无入口');

  await ev(() => { location.hash = 'task/build'; });
  await waitFor(() => location.hash === '#task/build', 'back to task route');
  result.backToTask = await ev(() => ({ hash: location.hash, header: !!document.querySelector('.task-window-header'), actions: [...document.querySelectorAll('.task-window-actions [aria-label]')].map(e => e.getAttribute('aria-label')) }));
  await waitFor(() => !!document.querySelector('[aria-label="新建标签页（⇧⌘B）"]'), 'back to task');
  await click('[aria-label="更多"]');
  await waitFor(() => [...document.querySelectorAll('.menu-item')].some(b => b.textContent.includes('主题')), 'menu').catch(() => {});
  const themed = await ev(() => { const b = [...document.querySelectorAll('.menu-item')].find(x => x.textContent.includes('主题')); if (b) { b.click(); return true; } return false; });
  if (!themed) await ev(() => { document.documentElement.dataset.theme = 'dark'; });
  await ev(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
  await click(NEW_TAB);
  await waitFor(() => !!document.querySelector('.bw-launcher'), 'dark launcher');
  check('B15-dark', await ev(() => document.documentElement.dataset.theme === 'dark'), { viaMenu: themed });
  await shot('04-深色启动页');
} catch (error) {
  result.failure = String(error?.stack || error);
} finally {
  result.pass = !result.failure && result.errors.length === 0 && result.checks.every(c => c.pass);
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  try { ws?.close(); } catch {}
  proc.kill();
  console.log(JSON.stringify({ pass: result.pass, failure: result.failure, errors: result.errors, checks: result.checks.map(c => [c.id, c.pass]) }, null, 1));
}
