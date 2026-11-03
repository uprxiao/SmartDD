// M12 prototype batch-1 driver: isolated headless Chromium + CDP against the Vite dev server. Synthetic data only.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5191/?preview=m12';
const BIN = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9347;
await mkdir(OUT, { recursive: true });
const profile = await mkdtemp('/private/tmp/m12-p1-profile-');
const proc = spawn(BIN, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const result = { at: new Date().toISOString(), boundary: 'P: prototype dev server, synthetic pages and simulated agent; no network, no real agent', checks: [], errors: [] };
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
  const p = await ev((s, t) => { const all = [...document.querySelectorAll(s)].filter(e => t === null || e.textContent.trim() === t); let last = ''; for (const e of all) { e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); if (!b.width || !b.height) continue; const x = b.x + b.width / 2, y = b.y + b.height / 2; const hit = document.elementFromPoint(x, y); if (e.contains(hit)) return { x, y }; last = String(hit?.className || hit?.tagName); } throw new Error('no visible unoccluded ' + s + ' (' + all.length + ' candidates) last hit ' + last); }, selector, text);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, ...p, ...(type === 'mouseMoved' ? {} : { button: 'left', clickCount: 1 }) });
}
async function key(key, code, vk, modifiers = 0) { const text = key === 'Enter' ? '\r' : undefined; for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers, ...(type === 'keyDown' && text ? { text } : {}) }); }
async function address(text) {
  const wasFocused = await ev(() => document.activeElement === document.querySelector('[aria-label="地址栏"]'));
  await click('[aria-label="地址栏"]');
  const selected = await ev(() => { const e = document.querySelector('[aria-label="地址栏"]'); return e.selectionStart === 0 && e.selectionEnd === e.value.length; });
  if (!wasFocused) addressSelectAll.push(selected);
  if (!selected) for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 4, commands: type === 'keyDown' ? ['selectAll'] : [] });
  await send('Input.insertText', { text });
  await key('Enter', 'Enter', 13);
}
async function shot(name) { const r = await send('Page.captureScreenshot', { format: 'png' }); await writeFile(join(OUT, name + '.png'), Buffer.from(r.data, 'base64')); }
const pageText = () => ev(() => document.querySelector('.bw-page')?.innerText || '');
const check = (id, detail) => result.checks.push({ id, ...detail });
const addressSelectAll = [];
let stage = 'setup';
try {
  ws = new WebSocket(await connect());
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', m => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } else if (msg.method === 'Runtime.exceptionThrown') result.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text); else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') result.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' ')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await waitFor(() => !!document.querySelector('.file-workspace'), 'app');
  await ev(() => { localStorage.removeItem('willyou-m12-prototype-v1'); return true; });
  await send('Page.navigate', { url: BASE });
  stage = 'B01 tab strip';
  await waitFor(() => !!document.querySelector('.fw-web-layer .bw-root'), 'web layer', 10000);
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '登录', 'login page');
  const strip = await ev(() => ({ web: [...document.querySelectorAll('.fw-web-tab')].map(e => e.textContent.trim()), fileSelected: !!document.querySelector('.fw-tab:not(.fw-web-tab).selected'), webSelected: !!document.querySelector('.fw-web-tab.selected'), newWeb: !!document.querySelector('[aria-label="新建网页标签"]') }));
  if (strip.fileSelected || !strip.webSelected || !strip.newWeb || !strip.web[0].includes('登录')) throw new Error('strip ' + JSON.stringify(strip));
  check('B01', strip); await shot('light-01-login');
  stage = 'B02 navigation';
  await click('.bw-site-primary', '登录');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '订单 #1024', 'order page');
  await waitFor(() => !document.querySelector('.bw-progress'), 'loaded');
  const addr = await ev(() => document.querySelector('[aria-label="地址栏"]').value);
  if (addr !== 'https://qa.example.test/orders/1024') throw new Error('address ' + addr);
  await shot('light-02-order');
  await click('.bw-nav [aria-label="后退"]'); await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '登录', 'back');
  await click('.bw-nav [aria-label="前进"]'); await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '订单 #1024', 'forward');
  check('B02', { login: true, back: true, forward: true, address: addr });
  stage = 'B02 stop';
  await waitFor(() => !document.querySelector('.bw-progress'), 'idle before stop test');
  await address('https://qa.example.test/');
  await waitFor(() => !!document.querySelector('.bw-nav [aria-label="停止加载"]'), 'stop button visible', 2000);
  if (await ev(() => document.querySelector('.bw-site-card h2')?.textContent) !== '登录') throw new Error('address submit did not navigate');
  await click('.bw-nav [aria-label="停止加载"]');
  await waitFor(() => !document.querySelector('.bw-progress') && !!document.querySelector('.bw-nav [aria-label="刷新"]'), 'stopped');
  check('B02-stop', { stopShownWhileLoading: true });
  stage = 'B03 address rules';
  await address('javascript:alert(1)');
  await waitFor(() => document.querySelector('.bw-failure h2')?.textContent.includes('请输入有效'), 'invalid');
  const keptInvalid = await ev(() => { const e = document.querySelector('[aria-label="地址栏"]'); return { value: e.value, focused: document.activeElement === e, selected: e.selectionStart === 0 && e.selectionEnd === e.value.length }; });
  if (keptInvalid.value !== 'javascript:alert(1)' || !keptInvalid.focused || !keptInvalid.selected) throw new Error('invalid input not kept ' + JSON.stringify(keptInvalid));
  await shot('light-03-invalid');
  await address('react hooks');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === 'react hooks', 'search');
  const searchAddr = await ev(() => document.querySelector('[aria-label="地址栏"]').value);
  await address('localhost:5173');
  await waitFor(() => (document.querySelector('.bw-site-head')?.textContent || '').includes('本地开发服务'), 'local dev');
  const localAddr = await ev(() => document.querySelector('[aria-label="地址栏"]').value);
  check('B03', { invalid: true, search: searchAddr, local: localAddr, firstClickSelectsAll: addressSelectAll.every(Boolean), samples: addressSelectAll.length });
  if (searchAddr !== 'https://www.bing.com/search?q=react%20hooks' || localAddr !== 'http://localhost:5173/' || !addressSelectAll.every(Boolean)) throw new Error('address rule mismatch ' + JSON.stringify({ searchAddr, localAddr, addressSelectAll }));
  stage = 'B04 failures';
  const failures = [['localhost:3000', '上还没有服务在运行'], ['refused.example.test', '拒绝连接'], ['nxdomain.example.test', '找不到'], ['timeout.example.test', '响应时间过长'], ['reset.example.test', '连接被中断'], ['other.example.test', '无法访问']];
  const seen = [];
  for (const [host, text] of failures) {
    await address(host.startsWith('localhost') ? host : 'https://' + host + '/');
    await waitFor(t => (document.querySelector('.bw-failure h2')?.textContent || '').includes(t), 'failure ' + host, 6000, text);
    seen.push(await ev(() => ({ title: document.querySelector('.bw-failure h2').textContent, error: document.querySelector('.bw-error-name')?.textContent, recovery: document.querySelector('.bw-recovery')?.textContent || null })));
    if (host === 'localhost:3000') { await shot('light-04-not-running'); await click('.bw-demo-link', '演示：模拟服务已启动'); await waitFor(() => (document.querySelector('.bw-site-head')?.textContent || '').includes('本地开发服务'), 'server started'); }
  }
  await click('.bw-demo label');
  await waitFor(() => (document.querySelector('.bw-failure h2')?.textContent || '').includes('离线'), 'offline');
  seen.push(await ev(() => ({ title: document.querySelector('.bw-failure h2').textContent, recovery: document.querySelector('.bw-recovery')?.textContent || null })));
  await shot('light-05-offline');
  await click('.bw-demo-link', '演示：模拟网络恢复');
  await waitFor(() => (document.querySelector('.bw-failure h2')?.textContent || '').includes('无法访问 other.example.test'), 'online again: back to the page that was open');
  check('B04', { kinds: seen.length, seen });
  stage = 'B01 new tab';
  await click('[aria-label="新建网页标签"]');
  await waitFor(() => document.querySelector('.bw-blank h2')?.textContent === '新标签页', 'blank');
  if (await ev(() => !!document.querySelector('.bw-progress') || !!document.querySelector('.bw-nav [aria-label="停止加载"]'))) throw new Error('new tab inherited loading state');
  const tabCount = await ev(() => document.querySelectorAll('.fw-web-tab').length);
  await shot('light-06-newtab');
  await click('.bw-examples button span', '测试环境（合成）');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '登录', 'example opened');
  check('B01-newtab', { tabCount });
  stage = 'B09 agent mark';
  await click('.bw-demo button', '模拟 Agent 写命令');
  await waitFor(() => document.querySelector('.bw-banner.bw-agent')?.textContent.includes('正在操作'), 'agent running');
  const running = await ev(() => ({ glow: !!document.querySelector('.bw-agent-glow') && getComputedStyle(document.querySelector('.bw-agent-glow'), '::after').boxShadow !== 'none', tabDot: !!document.querySelector('.fw-web-tab.selected .bw-tab-agent'), pauseButton: !!document.querySelector('.bw-pause') }));
  if (!running.glow || !running.tabDot || !running.pauseButton) throw new Error('agent ' + JSON.stringify(running));
  await shot('light-07-agent-running');
  await waitFor(() => document.querySelector('.bw-banner.bw-agent')?.textContent.includes('秒后清除'), 'agent hold', 4000);
  const hold = await ev(() => document.querySelector('.bw-banner.bw-agent').textContent);
  check('B09', { ...running, hold });
  stage = 'B10 pause';
  await click('.bw-pause');
  await waitFor(() => !!document.querySelector('.bw-banner.bw-paused') && !!document.querySelector('.bw-resume'), 'paused');
  await click('.bw-demo button', '模拟 Agent 写命令');
  await waitFor(() => document.querySelector('.bw-demo-status')?.textContent.includes('browser_paused'), 'rejected');
  const pausedDot = await ev(() => !!document.querySelector('.fw-web-tab.selected .bw-tab-agent.paused'));
  await shot('light-08-paused');
  await click('.bw-resume');
  await waitFor(() => !document.querySelector('.bw-banner.bw-paused'), 'resumed');
  await click('.bw-demo button', '模拟 Agent 只读等待');
  await waitFor(() => document.querySelector('.bw-banner.bw-agent')?.textContent.includes('正在操作'), 'read running');
  await click('.bw-pause');
  await waitFor(() => document.querySelector('.bw-demo-status')?.textContent.includes('只读等待立即结束'), 'read interrupted');
  await click('.bw-demo button', '模拟运行结束');
  await waitFor(() => !document.querySelector('.bw-banner'), 'run ended');
  check('B10', { rejectedWhilePaused: true, pausedDot, readInterrupted: true, endRunClears: true });
  stage = 'B01 switch to file tab and back';
  const fileTab = await ev(() => !!document.querySelector('.fw-tab:not(.fw-web-tab) [role=tab]'));
  if (fileTab) {
    await click('.fw-tab:not(.fw-web-tab) [role=tab]');
    await waitFor(() => !document.querySelector('.fw-web-layer') && !!document.querySelector('.fw-tab:not(.fw-web-tab).selected'), 'file shown');
    await shot('light-09-file-tab');
    await click('.fw-web-tab [role=tab]');
    await waitFor(() => !!document.querySelector('.fw-web-layer'), 'web back');
  }
  check('B01-switch', { fileTabPresent: fileTab });
  stage = 'R01.9 restore';
  await send('Page.navigate', { url: BASE });
  await waitFor(() => !!document.querySelector('.fw-web-layer .bw-root'), 'reloaded', 10000);
  const restored = await ev(() => ({ tabs: [...document.querySelectorAll('.fw-web-tab')].map(e => e.textContent.trim()), paused: !!document.querySelector('.bw-banner.bw-paused') }));
  if (restored.tabs.length !== tabCount || restored.paused) throw new Error('restore ' + JSON.stringify(restored));
  check('R01.9', restored);
  stage = 'B15 dark';
  await click('[aria-label="更多"]');
  await click('.task-actions-menu .menu-item', '主题');
  await waitFor(() => document.documentElement.dataset.theme === 'dark', 'dark applied by app');
  await waitFor(() => !!document.querySelector('.fw-web-layer .bw-root'), 'web tab still shown');
  await sleep(300);
  await shot('dark-01-login');
  await address('localhost:3000');
  await waitFor(() => (document.querySelector('.bw-failure h2')?.textContent || '').includes('上还没有服务'), 'dark failure');
  await shot('dark-02-not-running');
  await address('https://qa.example.test/orders/1024');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '订单 #1024', 'dark order');
  await click('.bw-demo button', '模拟 Agent 写命令');
  await waitFor(() => !!document.querySelector('.bw-banner.bw-agent'), 'dark agent');
  await shot('dark-03-agent');
  await click('.bw-pause');
  await waitFor(() => !!document.querySelector('.bw-banner.bw-paused'), 'dark paused');
  await shot('dark-04-paused');
  check('B15', { dark: true });
  if (result.errors.length) throw new Error('page errors: ' + result.errors.join(' | '));
  result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.failedStage = stage; result.error = String(error);
  try { await shot('failure'); result.text = await pageText(); } catch {}
  process.exitCode = 1;
} finally {
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  try { ws?.close(); } catch {}
  proc.kill();
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, failedStage: result.failedStage, error: result.error, errors: result.errors.length }));
}
