// M12 prototype batch-2 driver: isolated headless Chromium + CDP against the Vite dev server. Synthetic data only.
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OUT = process.argv[2];
const BASE = 'http://127.0.0.1:5191/?preview=m12';
const BIN = join(homedir(), 'Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell');
const PORT = 9348;
await mkdir(OUT, { recursive: true });
const profile = await mkdtemp('/private/tmp/m12-p2-profile-');
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
const status = () => ev(() => document.querySelector('.bw-demo-status')?.textContent || '');
const dialogTitle = () => ev(() => document.querySelector('.bw-dialog h2')?.textContent || null);
async function menu(item) { await click('[aria-label="浏览器菜单"]'); await click('.bw-menu button', item); }
async function themeDark() { await click('[aria-label="更多"]'); await click('.task-actions-menu .menu-item', '主题'); await waitFor(() => document.documentElement.dataset.theme === 'dark', 'dark'); }
try {
  ws = new WebSocket(await connect());
  await new Promise(r => ws.addEventListener('open', r, { once: true }));
  ws.addEventListener('message', m => { const msg = JSON.parse(m.data); if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result); } else if (msg.method === 'Runtime.exceptionThrown') result.errors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text); else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') result.errors.push('console.error: ' + msg.params.args.map(a => a.value ?? a.description).join(' ')); });
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE });
  await waitFor(() => !!document.querySelector('.file-workspace'), 'app');
  await ev(() => { localStorage.removeItem('willyou-m12-prototype-v1'); localStorage.removeItem('willyou-m12-prototype-profiles-v1'); return true; });
  await send('Page.navigate', { url: BASE });
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '登录', 'login page', 10000);

  stage = 'B05 certificate';
  await address('https://selfsigned.example.test/');
  await waitFor(() => document.querySelector('.bw-failure h2')?.textContent === '此连接不受信任', 'cert page');
  const certIcon = await ev(() => document.querySelector('.bw-security')?.className);
  await shot('light-11-cert-error');
  await click('.bw-danger-link', '我了解风险，继续访问');
  await waitFor(() => (document.querySelector('.bw-site-head')?.textContent || '').includes('内部系统'), 'cert continued');
  const continuedIcon = await ev(() => document.querySelector('.bw-security')?.className);
  if (!certIcon.includes('bw-certificate') || !continuedIcon.includes('bw-certificate')) throw new Error('cert security icon ' + certIcon + ' / ' + continuedIcon);
  check('B05', { certIcon, continuedIcon, status: await status() });

  stage = 'B06 http auth';
  await address('https://auth.example.test/');
  await waitFor(async () => document.querySelector('.bw-dialog h2')?.textContent === '需要登录', 'auth dialog');
  await shot('light-12-http-auth');
  await click('.bw-dialog button', '取消');
  await waitFor(() => (document.querySelector('.bw-failure h2')?.textContent || '').includes('401'), '401');
  await click('.bw-failure button', '重新登录');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '需要登录', 'auth dialog again');
  await click('.bw-dialog button', '登录');
  await waitFor(() => (document.querySelector('.bw-site-head')?.textContent || '').includes('受保护的站点'), 'auth ok');
  stage = 'B06 permission and external app';
  await address('https://qa.example.test/');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '登录', 'qa');
  await click('.bw-demo button', '模拟站点申请位置');
  await waitFor(() => !!document.querySelector('.bw-prompt[aria-label="站点权限请求"]'), 'permission prompt');
  await shot('light-13-permission');
  await click('.bw-prompt button', '允许');
  await waitFor(async () => !document.querySelector('.bw-prompt'), 'prompt closed');
  await click('.bw-demo button', '模拟站点申请位置');
  await waitFor(() => (document.querySelector('.bw-demo-status')?.textContent || '').includes('按记住的选择自动允许'), 'remembered');
  await click('.bw-demo button', '模拟外部应用链接');
  await waitFor(() => !!document.querySelector('.bw-prompt[aria-label="外部应用请求"]'), 'external prompt');
  await click('.bw-prompt button', '取消');
  await waitFor(() => !document.querySelector('.bw-prompt'), 'external closed');
  check('B06', { httpAuthCancelRetryLogin: true, permissionRemembered: true, externalPrompt: true });

  stage = 'B07 downloads';
  await address('https://qa.example.test/orders/1024');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '订单 #1024', 'order');
  await click('.bw-site-link', '导出订单 CSV');
  await waitFor(() => (document.querySelector('.bw-download-text span')?.textContent || '').includes('正在下载'), 'progress');
  await shot('light-14-download-progress');
  await waitFor(() => [...document.querySelectorAll('.bw-download-text span')].some(e => e.textContent.includes('已保存到')), 'done', 4000);
  await click('.bw-site-link', '导出订单 CSV');
  await waitFor(() => [...document.querySelectorAll('.bw-download-text strong')].some(e => e.textContent === '订单导出 (1).csv'), 'collision name', 4000);
  await click('.bw-demo button', '模拟下载失败');
  await waitFor(() => [...document.querySelectorAll('.bw-download-text span')].some(e => e.textContent.includes('下载失败')), 'failed', 4000);
  await waitFor(() => [...document.querySelectorAll('.bw-download-text span')].filter(e => e.textContent.includes('已保存到')).length === 2, 'second done', 4000);
  await shot('light-15-downloads');
  await click('[aria-label="移除下载记录 日志.zip"]');
  await waitFor(() => ![...document.querySelectorAll('.bw-download-text strong')].some(e => e.textContent === '日志.zip'), 'removed');
  await click('.bw-download .bw-mini', '在文件夹中显示');
  await waitFor(() => (document.querySelector('.bw-demo-status')?.textContent || '').includes('访达'), 'reveal');
  check('B07', { names: await ev(() => [...document.querySelectorAll('.bw-download-text strong')].map(e => e.textContent)) });

  stage = 'B08 find';
  await click('.bw-site-card h2');
  await key('f', 'KeyF', 70, 4);
  await waitFor(() => !!document.querySelector('.bw-find input') && document.activeElement === document.querySelector('.bw-find input'), 'find focused');
  await key('Escape', 'Escape', 27);
  await waitFor(() => !document.querySelector('.bw-find'), 'find closed by Escape');
  await click('[aria-label="地址栏"]');
  await key('f', 'KeyF', 70, 4);
  await waitFor(() => document.activeElement === document.querySelector('.bw-find input'), 'Cmd+F from address bar');
  await send('Input.insertText', { text: '订单' });
  await waitFor(() => /第 1 \/ \d+ 个/.test(document.querySelector('.bw-find-count')?.textContent || ''), 'find count');
  const findFirst = await ev(() => document.querySelector('.bw-find-count').textContent);
  await key('Enter', 'Enter', 13);
  await waitFor(() => (document.querySelector('.bw-find-count')?.textContent || '').startsWith('第 2'), 'find next');
  await shot('light-16-find');
  await key('Escape', 'Escape', 27);
  await waitFor(() => !document.querySelector('.bw-find'), 'find closed');
  check('B08', { findFirst });

  stage = 'B11 cross task';
  await click('.bw-demo button', '模拟跨任务请求（同项目）');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === 'Agent 请求访问其他任务的网页', 'cross dialog');
  await click('.bw-dialog label', '可以操作（点击、输入、导航）');
  await shot('light-17-cross-task');
  await click('.bw-dialog button', '允许本次运行');
  await waitFor(() => (document.querySelector('.bw-demo-status')?.textContent || '').includes('已允许本次运行操作'), 'granted');
  await menu('跨任务授权（1）');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '跨任务授权', 'grants');
  await click('.bw-dialog .bw-list button', '撤销');
  await waitFor(() => !!document.querySelector('.bw-dialog .bw-empty-note'), 'revoked');
  await click('.bw-dialog button', '完成');
  await click('.bw-demo button', '模拟跨项目请求');
  await waitFor(() => (document.querySelector('.bw-demo-status')?.textContent || '').includes('SCOPE_DENIED'), 'other project denied');
  if (await ev(() => !!document.querySelector('.bw-dialog'))) throw new Error('cross-project must not open a dialog');
  await click('.bw-demo button', '模拟无人值守跨任务请求');
  await waitFor(() => (document.querySelector('.bw-demo-status')?.textContent || '').includes('无人值守'), 'unattended denied');
  check('B11', { grantRevoke: true, otherProjectDenied: true, unattendedDenied: true });

  stage = 'B12 profiles';
  await click('button.bw-profile');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '登录态管理', 'profiles');
  const projectCerts = await ev(() => [...document.querySelectorAll('.bw-profile-detail .bw-list strong')].map(e => e.textContent));
  if (!projectCerts.includes('selfsigned.example.test') || !projectCerts.includes('qa.example.test')) throw new Error('project profile lists ' + JSON.stringify(projectCerts));
  await click('.bw-profile-list .bw-add');
  await waitFor(() => document.querySelectorAll('.bw-profile-list [role=option]').length === 2, 'task profile created');
  await click('.bw-profile-list [role=option]:nth-of-type(1)');
  await ev(() => { const opts = [...document.querySelectorAll('.bw-profile-list [role=option]')]; return opts.length; });
  const taskOption = '.bw-profile-list li:nth-child(2) [role=option]';
  await click(taskOption);
  await waitFor(() => (document.querySelector('.bw-profile-detail h3')?.textContent || '').includes('独立登录态'), 'task profile selected');
  const taskLists = await ev(() => [...document.querySelectorAll('.bw-profile-detail .bw-empty-note')].length);
  if (taskLists !== 2) throw new Error('new task profile should have no exceptions/permissions');
  await click('.bw-profile-detail .bw-mini', '用于当前页面');
  await waitFor(() => (document.querySelector('button.bw-profile')?.textContent || '').includes('独立登录态'), 'chip task');
  await shot('light-18-profiles');
  await click('.bw-profile-list li:nth-child(1) [role=option]');
  await click('.bw-profile-detail .bw-list li button', '撤销');
  await waitFor(() => document.querySelectorAll('.bw-profile-detail .bw-list li').length === 1, 'one revoked');
  await click(taskOption);
  await click('.bw-profile-detail .bw-mini', '删除');
  await click('.bw-profile-detail .bw-mini', '确认删除');
  await waitFor(() => document.querySelectorAll('.bw-profile-list [role=option]').length === 1, 'deleted');
  await click('.bw-dialog button', '完成');
  await waitFor(() => (document.querySelector('button.bw-profile')?.textContent || '').includes('项目登录态'), 'fallback to project');
  check('B12', { projectCerts, isolatedNewProfile: true, deleteFallsBack: true });

  stage = 'B13 import';
  await menu('导入 Chrome／Edge 登录态');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '导入 Chrome／Edge 登录态', 'import source');
  await click('.bw-dialog label', 'Google Chrome · Profile 1');
  await click('.bw-dialog button', '下一步');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '确认导入', 'confirm');
  const warn = await ev(() => document.querySelector('.bw-warn-list').innerText);
  if (!warn.includes('Agent 将能读取这些站点的会话令牌') || !warn.includes('Chrome Safe Storage')) throw new Error('warning text ' + warn);
  if (await ev(() => document.querySelector('.bw-warn-list').innerText.includes('`'))) throw new Error('literal backticks in import warning');
  await shot('light-19-import-confirm');
  await click('.bw-dialog button', '确认导入');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '模拟 macOS 钥匙串请求', 'keychain');
  await click('.bw-dialog button', '模拟拒绝');
  await waitFor(() => (document.querySelector('.bw-dialog [role=alert]')?.textContent || '').includes('没有写入任何 Cookie'), 'denied');
  await click('.bw-dialog button', '完成');
  await menu('导入 Chrome／Edge 登录态');
  await click('.bw-dialog button', '下一步');
  await click('.bw-dialog button', '确认导入');
  await click('.bw-dialog button', '模拟允许');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '导入完成', 'imported');
  await shot('light-20-import-result');
  await click('.bw-dialog button', '完成');
  await click('button.bw-profile');
  await waitFor(() => (document.querySelector('.bw-profile-detail .bw-hint')?.textContent || '').includes('已从 Google Chrome · Default 导入'), 'source recorded');
  await click('.bw-dialog button', '完成');
  await sleep(1000);
  const idleReload = await ev(() => document.querySelector('.bw-nav button:nth-child(3)')?.getAttribute('aria-label'));
  if (idleReload !== '刷新') throw new Error('page should be idle after dialogs, reload button is ' + idleReload);
  const literalBackticks = await ev(() => document.body.innerText.includes('`'));
  check('B13', { deniedWritesNothing: true, sourceRecorded: true, idleReload, literalBackticks });

  stage = 'B14 settings';
  await menu('浏览器设置');
  await click('.bw-dialog label', 'Google');
  await click('.bw-dialog label', 'Electron 原生身份（部分站点需要；Google 登录不可用）');
  await waitFor(() => !!document.querySelector('.bw-restart'), 'restart note');
  await shot('light-21-settings');
  await click('.bw-dialog button', '完成');
  await address('foo');
  await waitFor(() => (document.querySelector('[aria-label="地址栏"]')?.value || '').startsWith('https://www.google.com/search?q=foo'), 'google search');
  check('B14', { engine: 'google', identityRestartNote: true });

  stage = 'dark';
  await themeDark();
  await address('https://selfsigned.example.test/');
  await sleep(700);
  await shot('dark-11-cert-continued');
  await click('button.bw-profile');
  await waitFor(() => document.querySelector('.bw-dialog h2')?.textContent === '登录态管理', 'dark profiles');
  await shot('dark-12-profiles');
  await click('.bw-dialog button', '完成');
  await menu('导入 Chrome／Edge 登录态');
  await click('.bw-dialog button', '下一步');
  await shot('dark-13-import-confirm');
  await click('.bw-dialog [aria-label="关闭"]');
  await address('https://qa.example.test/orders/1024');
  await waitFor(() => document.querySelector('.bw-site-card h2')?.textContent === '订单 #1024', 'dark order');
  await click('.bw-site-link', '导出订单 CSV');
  await click('.bw-demo button', '模拟站点申请位置');
  await sleep(500);
  await shot('dark-14-download-permission');
  check('dark', { screenshots: 4 });

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
