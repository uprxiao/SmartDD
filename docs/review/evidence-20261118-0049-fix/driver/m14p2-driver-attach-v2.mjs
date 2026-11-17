// M14 阶段 2 附件冒烟 v2（复核 W01）。开发构建 out/，隔离 userData；纯 Electron 页面用后台 CDP。
// 改动：①夹具为脚本生成并核验的纯红 PNG，记录原件与 WillYou 附件副本哈希；②等待超时、空回答、答非预期、
// 回合未结束、跳页、退出失败都判失败（attach-judge.mjs），驱动以非零状态退出；③观察器：主进程记录本窗口
// 收到的真实键盘输入与焦点变化（CDP 插入文字不产生键盘事件），页面记录视图切换与鼠标落点，用于追查跳页。
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { openElectron, pause } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
import { judgeAttach } from './attach-judge.mjs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const sha = b => createHash('sha256').update(b).digest('hex');
/** 64×64 纯红（255,0,0）PNG；isRed 按写入的像素逐个核对。 */
function redPng() {
  const w = 64, h = 64, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 255; raw[o + 1] = 0; raw[o + 2] = 0; } }
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  let isRed = true; for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; if (raw[o] !== 255 || raw[o + 1] || raw[o + 2]) isRed = false; }
  return { png: Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]), isRed, width: w, height: h };
}

const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-p2-'));
const userData = join(root, 'userData'); mkdirSync(userData);
const work = join(root, 'work'); mkdirSync(work);
execFileSync('git', ['init', '-q'], { cwd: work });
writeFileSync(join(work, 'README.md'), '# demo\n');
const log = []; const step = (name, data) => { log.push({ t: new Date().toISOString(), name, ...(data ?? {}) }); console.log(name, data ? JSON.stringify(data).slice(0, 300) : ''); };
const result = { root };
const fx = redPng();
const outsideImg = join(root, 'red.png');
writeFileSync(outsideImg, fx.png); writeFileSync(join(OUT, 'fixture-red.png'), fx.png);
result.fixture = { file: 'fixture-red.png', sha256: sha(fx.png), bytes: fx.png.length, width: fx.width, height: fx.height, isRed: fx.isRed };

const app = await openElectron({ userData, inspectMain: true, cwd: '/Users/liubu/hx/4.uprxiao/SmartDD' });
const shot = async (name) => { const r = await app.cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64')); step('shot', { name }); };
const box = async (sel) => app.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
const clicks = [];
const click = async (sel) => {
  const b = await box(sel); if (!b) throw new Error('找不到可点击元素 ' + sel);
  const at = await app.evaluate(`(()=>{const e=document.elementFromPoint(${b.x},${b.y});return e?e.tagName+'.'+String(e.className).slice(0,50):null})()`);
  clicks.push({ sel, box: b, elementAtPoint: at, t: Date.now() });
  for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 });
  await pause(200);
};
const typeInto = async (sel, text) => { await click(sel); await app.cdp('Input.insertText', { text }); await pause(150); };
const OWN = `const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');`;
const installPageObserver = () => app.evaluate(`(()=>{if(window.__wy)return true;window.__wy={views:[],mouse:[],keys:[]};const view=()=>document.querySelector('.agent-task-view')?'task':document.querySelector('[data-testid=home-input]')?'home':(document.body.innerText.includes('数据目录')?'settings':'other');let last='';setInterval(()=>{const v=view();if(v!==last){last=v;window.__wy.views.push({t:Date.now(),v});}},100);window.addEventListener('mousedown',e=>window.__wy.mouse.push({t:Date.now(),x:e.clientX,y:e.clientY,trusted:e.isTrusted,tag:e.target.tagName}),true);window.addEventListener('keydown',e=>window.__wy.keys.push({t:Date.now(),key:e.key,meta:e.metaKey,trusted:e.isTrusted}),true);return true})()`);
try {
  // 主进程观察器：本 App 窗口的真实键盘输入与焦点变化（只记录，不改行为）
  result.mainObserver = await app.mainEvaluate(`(()=>{${OWN}globalThis.__wyIn=[];const rec=o=>globalThis.__wyIn.push({t:Date.now(),...o});for(const w of E.BrowserWindow.getAllWindows()){w.on('focus',()=>rec({ev:'focus',id:w.id}));w.on('blur',()=>rec({ev:'blur',id:w.id}));w.webContents.on('before-input-event',(e,i)=>rec({ev:'key',type:i.type,key:i.key,meta:i.meta,control:i.control,alt:i.alt}));}const f=E.BrowserWindow.getFocusedWindow();return {windows:E.BrowserWindow.getAllWindows().length,focusedAtStart:!!f}})()`, { label: 'install-input-observer', timeoutMs: 5000 });
  step('main-observer', result.mainObserver);
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  const tools = await app.invoke('agents.tools');
  const codex = tools.find(t => t.kind === 'codex' && t.installed);
  step('tools', { codex: codex && { version: codex.version, login: codex.login } });
  if (!codex || codex.login === 'none') throw new Error('本机 Codex 未安装或未登录');
  const existing = (await app.invoke('agents.list')).find(c => c.toolId === codex.id && c.source === 'login');
  const profile = existing ?? await app.invoke('agents.save', { name: 'Codex 订阅', toolId: codex.id, source: 'login', isDefault: true });
  const project = await app.invoke('projects.create', { name: 'M14 验收', aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: work }]);
  step('project', { id: project.id, profile: profile.id ?? profile });
  await app.evaluate(`localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true`);
  await pause(1500);
  await app.waitFor(`!!document.querySelector('[data-testid=home-input]')`, 20000);
  await installPageObserver();
  await shot('01-home');
  await typeInto('[data-testid=home-input]', 'Say OK. Do not use any tools.');
  await app.evaluate(`document.querySelector('.reference-composer').requestSubmit();true`);
  await app.waitFor(`!!document.querySelector('.agent-task-view .agent-user-bubble')`, 30000);
  // 首轮结束：停止键出现过后又消失，且回答已显示（不在停止键尚未渲染时就判结束）
  await app.waitFor(`!document.querySelector('.agent-stop') && !!document.querySelector('.agent-assistant .agent-md')`, 180000);
  // 把项目内文件与项目外红色图片拖入输入框（CDP 拖放；系统剪贴板粘贴另按前台模式取证）
  const t = await box('.agent-composer textarea');
  if (!t) throw new Error('首轮结束后找不到任务输入框');
  for (const type of ['dragEnter', 'dragOver', 'drop']) await app.cdp('Input.dispatchDragEvent', { type, x: t.x, y: t.y, data: { items: [], files: [join(work, 'README.md'), outsideImg], dragOperationsMask: 1 } });
  await app.waitFor(`document.querySelectorAll('.agent-chip.ready').length===2`, 20000);
  result.chips = await app.evaluate(`[...document.querySelectorAll('.agent-chip')].map(c=>({cls:c.className,name:c.querySelector('.agent-chip-name')?.textContent,title:c.title,img:!!c.querySelector('img')}))`);
  // WillYou 私有目录里的附件副本应与夹具逐字节相同
  const dir = join(userData, 'agent-attachments');
  const copies = existsSync(dir) ? readdirSync(dir).flatMap(d => { const f = join(dir, d, 'red.png'); return existsSync(f) ? [f] : []; }) : [];
  result.frozen = copies.length === 1 ? { sha256: sha(readFileSync(copies[0])), bytes: readFileSync(copies[0]).length } : { copies: copies.length };
  step('chips', { chips: result.chips, frozen: result.frozen });
  await shot('21-chips');
  await typeInto('.agent-composer textarea', 'What is the dominant color of the attached image? Answer with one English word. Do not use any tools.');
  await click('.agent-send');
  await app.waitFor(`document.querySelectorAll('.agent-chip').length===0`, 10000);
  const before = await app.evaluate(`document.querySelectorAll('.agent-assistant .agent-md').length`);
  // 严格等待：第二条回答出现且回合结束；超时记失败，不吞掉
  result.waitTimedOut = false;
  try { await app.waitFor(`document.querySelectorAll('.agent-assistant .agent-md').length>${before} && !document.querySelector('.agent-stop')`, 180000); }
  catch (e) { result.waitTimedOut = true; step('answer-timeout', { e: String(e).slice(0, 200) }); }
  result.turnFinished = await app.evaluate(`!document.querySelector('.agent-stop') && /已完成/.test(document.querySelector('.agent-task-view')?.innerText??'')`);
  result.answer = await app.evaluate(`[...document.querySelectorAll('.agent-assistant .agent-md')].map(e=>e.textContent.trim()).at(-1)??null`);
  result.bubble = await app.evaluate(`[...document.querySelectorAll('.agent-user-bubble')].at(-1)?.textContent??null`);
  step('answer', { answer: result.answer, bubble: result.bubble, finished: result.turnFinished });
  await shot('22-image-answer');
  result.rendererErrors = app.rendererErrors.slice(0, 5);
} catch (e) {
  result.error = String(e?.stack ?? e);
  try { await shot('99-failure'); } catch {}
} finally {
  result.clicks = clicks;
  try { result.page = await app.evaluate('window.__wy??null'); } catch (e) { result.pageObserverError = String(e); }
  try { result.mainInput = await app.mainEvaluate('globalThis.__wyIn??null', { label: 'read-input-observer', timeoutMs: 5000 }); } catch (e) { result.mainObserverError = String(e); }
  const views = result.page?.views ?? [];
  const firstTask = views.findIndex(v => v.v === 'task');
  result.navigatedAway = firstTask >= 0 && views.slice(firstTask + 1).some(v => v.v !== 'task');
  try { await app.mainEvaluate(`(()=>{${OWN}setTimeout(()=>E.app.quit(),50);return true})()`, { label: 'quit-app', timeoutMs: 5000 }); } catch (e) { result.quitError = String(e); }
  try { result.exit = await app.waitForExit(20000); } catch (e) { result.exitError = String(e); try { result.crash = await app.crash(); } catch {} }
  result.judge = judgeAttach(result);
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...result, log }, null, 1));
  console.log('JUDGE', JSON.stringify(result.judge));
  process.exitCode = result.judge.passed ? 0 : 1;
}
