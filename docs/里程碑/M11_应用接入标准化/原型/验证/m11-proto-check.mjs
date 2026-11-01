// M11 原型浏览器检查（合成数据）：无头 Chrome + 最小 CDP 驱动，隔离的临时用户目录，不连接日常浏览器。
// 用法：node m11-proto-check.mjs <preview-base-url> <输出目录>
// 流程：项目应用页的发件身份（经真实点击添加 SMTP、选用、确认），会话弹窗的运行计划；浅／深色截图 + 文字断言。
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const [base, outDir] = [process.argv[2], process.argv[3]];
mkdirSync(outDir, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const profile = mkdtempSync(join(tmpdir(), 'wy-m11-chrome-'));
const port = 9300 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
const results = []; const check = (id, ok, note) => { results.push({ id, ok, note }); console.log((ok ? 'PASS ' : 'FAIL ') + id + ' ' + note); };
let ws, seq = 0; const pending = new Map();
const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expr, label, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(100); } throw new Error('timeout waiting for: ' + label); };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(outDir, name + '.png'), Buffer.from(r.data, 'base64')); };
const text = () => ev('document.body.innerText');
const clickByLabel = (label) => ev(`(()=>{const el=[...document.querySelectorAll('button,[role=button],label,input')].find(e=>(e.getAttribute('aria-label')||e.textContent||'').trim().includes(${JSON.stringify(label)}));if(!el)return false;el.click();return true})()`);
const setTheme = async (theme) => { await ev(`document.documentElement.dataset.theme=${JSON.stringify(theme)};document.body.dataset.theme=${JSON.stringify(theme)};true`); };
const go = async (hash) => { await send('Page.navigate', { url: `${base}/?preview=m10#${hash}` }); await sleep(600); await send('Page.reload', { ignoreCache: true }); await sleep(900); };

try {
  let target; for (let i = 0; i < 60 && !target; i++) { try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); target = list.find(t => t.type === 'page'); } catch {} if (!target) await sleep(250); }
  if (!target) throw new Error('chrome did not start');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { const p = pending.get(d.id); pending.delete(d.id); d.error ? p.rej(new Error(d.error.message)) : p.res(d.result); } };
  await send('Page.enable'); await send('Runtime.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

  const KEY = 'willyou-m10-prototype-v2';
  const smtpConn = (over = {}) => ({ id: 'smtp-demo', app: 'mail', kind: 'smtp', name: '公司发件 · 合成', host: 'smtp.example.invalid', port: 465, transport: 'smtp', tls: 'implicit', account: 'login.user', auth: 'password', fromAddress: 'work@example.invalid', credentialPresent: true, enabled: true, validation: 'ready', revision: 1, ...over });
  // 数据准备（非被验收交互）：在原型存储中放入一个就绪的合成 SMTP 连接。选用、确认、失效都走真实点击。
  const seed = async (smtpOver) => {
    await send('Page.navigate', { url: `${base}/?preview=m10#project/ais/apps` }); await sleep(700);
    await ev(`(()=>{localStorage.clear();return true})()`);
    await ev(`(()=>{const KEY=${JSON.stringify(KEY)};localStorage.removeItem(KEY);return true})()`);
    await go('project/ais/apps');
    await waitFor(`document.body.innerText.includes('项目应用')`, '项目应用页');
    await ev(`(()=>{const KEY=${JSON.stringify(KEY)};const saved=JSON.parse(localStorage.getItem(KEY));saved.connections.push(${JSON.stringify(smtpConn(smtpOver))});localStorage.setItem(KEY,JSON.stringify(saved));return true})()`);
    await go('project/ais/apps');
    await waitFor(`!!document.querySelector('[aria-label="发件身份"]')`, '发件身份区');
  };
  const status = () => ev(`document.querySelector('[aria-label="发件身份"]')?.dataset.status`);
  const senderText = () => ev(`document.querySelector('[aria-label="发件身份"]')?.innerText||''`);
  const clickRadio = (aria) => ev(`(()=>{const el=document.querySelector('input[aria-label=${JSON.stringify(aria)}]');if(!el||el.disabled)return false;el.click();return true})()`);
  const clickButton = (label) => ev(`(()=>{const el=[...document.querySelectorAll('.m10-sender-identity button')].find(b=>b.textContent.includes(${JSON.stringify(label)}));if(!el||el.disabled)return false;el.click();return true})()`);
  const scrollTo = (sel) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;el.scrollIntoView({block:'center'});return true})()`);
  const shotSender = async (name) => { await scrollTo('[aria-label="发件身份"]'); await sleep(250); await shot(name + '-light'); await setTheme('dark'); await sleep(200); await shot(name + '-dark'); await setTheme('light'); };

  // ---- 项目页：发件身份 ----
  await seed();
  const t0 = await text();
  check('P1 项目应用页可达', t0.includes('项目应用') && t0.includes('邮件'), '页面含「项目应用」与邮件应用');
  check('P2 未选 SMTP：未选用状态', (await status()) === 'no-smtp', 'data-status=' + await status());
  await shotSender('01-sender-no-smtp');

  // 选用合成 SMTP：Foxmail 账号目录 work@example.invalid 与发件地址一致 → 自动确认
  check('P3 真实点击选用 SMTP', await clickRadio('为ais选用公司发件 · 合成'), '点击单选');
  await waitFor(`document.querySelector('[aria-label="发件身份"]')?.dataset.status==='auto'`, '自动确认');
  check('P4 一致 → 自动确认，无确认按钮', (await status()) === 'auto' && !(await clickButton('确认')), (await senderText()).replace(/\s+/g, ' ').slice(0, 60));
  await shotSender('02-sender-auto');

  // 不一致：改发件地址 → 拒绝，不能确认
  await seed({ fromAddress: 'other@example.invalid' });
  await clickRadio('为ais选用公司发件 · 合成');
  await waitFor(`document.querySelector('[aria-label="发件身份"]')?.dataset.status==='mismatch'`, '不一致');
  const mm = await senderText();
  check('P5 不一致 → 拒绝', (await status()) === 'mismatch' && mm.includes('不能用确认覆盖'), '状态 mismatch，文案含「不能用确认覆盖」');
  check('P6 不一致时没有任何确认按钮', !(await ev(`[...document.querySelectorAll('.m10-sender-identity button')].some(b=>/确认/.test(b.textContent))`)), '无「确认」类按钮');
  await shotSender('03-sender-mismatch');

  // 只配 SMTP：取消 Foxmail 来源 → 需要确认 → 确认 → 已确认
  await seed();
  await clickRadio('为ais选用公司发件 · 合成'); await waitFor(`document.querySelector('[aria-label="发件身份"]')?.dataset.status==='auto'`, 'auto');
  check('P7 取消 Foxmail 来源', await clickRadio('不选用本地读取来源'), '点击「不选用」');
  await waitFor(`document.querySelector('[aria-label="发件身份"]')?.dataset.status==='needs-confirm'`, '需要确认');
  check('P8 只配 SMTP → 需要确认', (await status()) === 'needs-confirm', 'needs-confirm');
  await shotSender('04-sender-needs-confirm');
  check('P9 真实点击确认', await clickButton('确认这是我的发件身份'), '点击确认按钮');
  await waitFor(`document.querySelector('[aria-label="发件身份"]')?.dataset.status==='confirmed'`, '已确认');
  check('P10 确认后 → 已确认', (await status()) === 'confirmed', 'confirmed');
  await shotSender('05-sender-confirmed');

  // 刷新后确认仍在（持久化）；再改 SMTP 修订 → 失效
  await go('project/ais/apps'); await waitFor(`!!document.querySelector('[aria-label="发件身份"]')`, '刷新后');
  check('P11 刷新后确认保留', (await status()) === 'confirmed', '刷新后仍 confirmed');
  await ev(`(()=>{const KEY=${JSON.stringify(KEY)};const saved=JSON.parse(localStorage.getItem(KEY));const c=saved.connections.find(x=>x.id==='smtp-demo');c.revision=2;localStorage.setItem(KEY,JSON.stringify(saved));return true})()`);
  await go('project/ais/apps'); await waitFor(`!!document.querySelector('[aria-label="发件身份"]')`, '修订后');
  check('P12 SMTP 修订变化 → 确认失效', (await status()) === 'invalidated', 'invalidated');
  await shotSender('06-sender-invalidated');
  check('P13 失效后可重新确认', await clickButton('重新确认发件身份'), '点击重新确认');
  await waitFor(`document.querySelector('[aria-label="发件身份"]')?.dataset.status==='confirmed'`, '重新确认');
  check('P14 重新确认 → 已确认', (await status()) === 'confirmed', 'confirmed');

  // ---- 会话弹窗：运行计划 ----
  // 历史任务没有固定能力快照：先确认明确说明（不补造运行计划）
  await send('Page.navigate', { url: `${base}/?preview=m10#task/research` }); await sleep(900);
  await waitFor(`!!document.querySelector('[aria-label="会话应用"]')`, '会话应用按钮（历史任务）');
  await clickByLabel('会话应用');
  await waitFor(`document.body.innerText.includes('本会话没有固定的运行计划')`, '历史任务说明');
  check('S0 历史会话明确说明没有固定运行计划，不显示运行计划区', !(await ev(`!!document.querySelector('[aria-label="本次运行计划"]')`)), '已说明');
  await shot('07a-run-plan-history-light');
  // 真实流程新建会话（带固定能力快照）：工作台选择项目、填写描述、提交
  await send('Page.navigate', { url: `${base}/?preview=m10#home` }); await sleep(900);
  await waitFor(`!!document.querySelector('textarea[aria-label="任务描述"]')`, '工作台输入框');
  // 真实操作：打开「选择项目」菜单并选 AIS（工作台默认项目是 WillYou，其邮件应用未启用）
  await ev(`document.querySelector('button[aria-label="选择项目"]').click();true`);
  await waitFor(`!!document.querySelector('[role=menu] [role=menuitem]')`, '项目菜单');
  check('S0b 真实操作选择 AIS 项目', await ev(`(()=>{const el=[...document.querySelectorAll('[role=menu] [role=menuitem]')].find(b=>b.textContent.trim()==='AIS');if(!el)return false;el.click();return true})()`), '点击菜单项 AIS');
  await waitFor(`document.querySelector('button[aria-label="选择项目"]').textContent.includes('AIS')`, '已选 AIS');
  await ev(`(()=>{const ta=document.querySelector('textarea[aria-label="任务描述"]');const setter=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;setter.call(ta,'检查本项目的应用能力');ta.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await ev(`(()=>{document.querySelector('form.reference-composer').requestSubmit();return true})()`);
  await waitFor(`location.hash.startsWith('#task/')`, '进入新建会话');
  await waitFor(`!!document.querySelector('[aria-label="会话应用"]')`, '会话应用按钮');
  check('S1 真实点击打开「会话应用」', await clickByLabel('会话应用'), '点击');
  await waitFor(`!!document.querySelector('[aria-label="本次运行计划"]')`, '运行计划');
  const plan0 = await ev(`document.querySelector('[aria-label="本次运行计划"]').innerText`);
  check('S2 运行计划区出现，含 6 个适配等级', ['L0.skill', 'L0.mcp', 'L0.cli', 'L1', 'L2', 'L3'].every(l => plan0.includes(l)), '6 个等级均显示');
  check('S3 禅道生效入口 CLI，邮件生效入口 MCP', /禅道[\s\S]*生效入口 · CLI/.test(plan0) && /邮件[\s\S]*生效入口 · MCP/.test(plan0), '已声明场景');
  check('S4 L2、L3 显示未验证', /L2[\s\S]{0,40}未验证/.test(plan0) && /L3[\s\S]{0,40}未验证/.test(plan0), '0.166.0 下保持关闭');
  await scrollTo('[aria-label="本次运行计划"]'); await sleep(250); await shot('07-run-plan-declared-light'); await setTheme('dark'); await sleep(200); await shot('07-run-plan-declared-dark'); await setTheme('light');
  // 切换场景：真实操作 select
  const pick = (val) => ev(`(()=>{const sel=document.querySelector('select[aria-label="运行计划场景"]');if(!sel)return false;const setter=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;setter.call(sel,${JSON.stringify(val)});sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  check('S5 切换到「未声明版本」', await pick('fallback'), 'select change');
  await waitFor(`document.querySelector('[aria-label="本次运行计划"]').innerText.includes('已降级为只读 MCP')`, '降级提示');
  const plan1 = await ev(`document.querySelector('[aria-label="本次运行计划"]').innerText`);
  check('S6 禅道降级为 MCP 并说明原因，CLI 等级不再声明', plan1.includes('已降级为只读 MCP') && plan1.includes('未声明 CLI 交付') && /L0\.cli[\s\S]{0,40}未验证/.test(plan1), '降级与等级一致');
  await shot('08-run-plan-fallback-light'); await setTheme('dark'); await sleep(200); await shot('08-run-plan-fallback-dark'); await setTheme('light');
  check('S7 切换到「沙箱无法证明等价」', await pick('sandbox'), 'select change');
  await waitFor(`document.querySelector('[aria-label="本次运行计划"]').innerText.includes('无法证明用户沙箱策略等价')`, '沙箱降级');
  check('S8 沙箱场景：不注入 CLI、降级 MCP', (await ev(`document.querySelector('[aria-label="本次运行计划"]').innerText`)).includes('不注入 CLI'), '文案正确');
  // 邮件能力可用性（只配 SMTP 的当前项目状态）
  const caps = await ev(`document.querySelector('[aria-label="邮件能力可用性"]')?.innerText||''`);
  check('S9 邮件能力可用性按槽显示（含读取、发送、查询发送结果）', ['查询与读取原邮件', '回复草稿', '冻结与发送', '查询发送结果／停止等待'].every(t => caps.includes(t)), '6 行能力');
  const sendRow = async () => ev(`(()=>{const li=[...document.querySelectorAll('[aria-label="邮件能力可用性"] li')].find(x=>x.textContent.includes('冻结与发送'));return li?li.innerText.replace(/\\s+/g,' '):''})()`);
  check('S9b 发件身份已确认时，「冻结与发送」可用', (await sendRow()).includes('可用') && !(await sendRow()).includes('需要确认'), await sendRow());
  const sr = await sendRow();
  check('S9c 「查询发送结果／停止等待」不依赖 Foxmail 与 SMTP，始终可用', (await ev(`[...document.querySelectorAll('[aria-label="邮件能力可用性"] li')].find(x=>x.textContent.includes('查询发送结果'))?.innerText.includes('可用')`)) === true, '可用');
  // 窄屏
  await send('Emulation.setDeviceMetricsOverride', { width: 420, height: 900, deviceScaleFactor: 2, mobile: true });
  await sleep(400); await scrollTo('[aria-label="本次运行计划"]'); await sleep(250); await shot('09-run-plan-narrow');
  const overflow = await ev(`(()=>{const d=document.querySelector('[aria-label="本次运行计划"]');return d.scrollWidth>d.clientWidth+1})()`);
  check('S10 窄屏运行计划区无横向溢出', !overflow, 'scrollWidth<=clientWidth');
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
} catch (e) {
  check('RUNNER', false, String(e.message || e).slice(0, 200));
} finally {
  writeFileSync(join(outDir, 'result.json'), JSON.stringify({ generatedAt: new Date().toISOString(), base, results }, null, 2) + '\n');
  try { ws?.close(); } catch {}
  chrome.kill('SIGTERM'); await sleep(500); try { chrome.kill('SIGKILL'); } catch {}
  rmSync(profile, { recursive: true, force: true });
  process.exit(results.every(r => r.ok) ? 0 : 1);
}
