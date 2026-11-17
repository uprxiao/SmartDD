// M14 阶段 2 真实界面冒烟（开发构建 out/，隔离 userData；纯 Electron 页面用后台 CDP）。
// 准备数据（智能体配置、项目）经 RPC；被验收的动作（输入、发送、审批选择）经真实 UI。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron, pause } from '/Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';

const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-p2-'));
const userData = join(root, 'userData'); mkdirSync(userData);
const work = join(root, 'work'); mkdirSync(work);
execFileSync('git', ['init', '-q'], { cwd: work });
writeFileSync(join(work, 'README.md'), '# demo\n');
const log = []; const step = (name, data) => { log.push({ t: new Date().toISOString(), name, ...(data ?? {}) }); console.log(name, data ? JSON.stringify(data).slice(0, 300) : ''); };
const app = await openElectron({ userData, inspectMain: true, cwd: '/Users/liubu/hx/4.uprxiao/SmartDD' });
const shot = async (name) => { const r = await app.cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64')); step('shot', { name }); };
const box = async (sel) => app.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
const click = async (sel) => { const b = await box(sel); if (!b) throw new Error('找不到可点击元素 ' + sel); for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); await pause(200); };
const typeInto = async (sel, text) => { await click(sel); await app.cdp('Input.insertText', { text }); await pause(150); };
const result = { root };
try {
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // 准备：检测本机 CLI、建 Codex 订阅登录配置、建项目（非被验收数据，经 RPC）
  await app.invoke('agents.refreshTools');
  const tools = await app.invoke('agents.tools');
  const codex = tools.find(t => t.kind === 'codex' && t.installed);
  step('tools', { codex: codex && { version: codex.version, login: codex.login } });
  if (!codex || codex.login === 'none') throw new Error('本机 Codex 未安装或未登录');
  const existing = (await app.invoke('agents.list')).find(c => c.toolId === codex.id && c.source === 'login');
  const profile = existing ?? await app.invoke('agents.save', { name: 'Codex 订阅', toolId: codex.id, source: 'login', isDefault: true });
  step('profile', { id: profile.id ?? profile });
  const project = await app.invoke('projects.create', { name: 'M14 验收', aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: work }]);
  step('project', { id: project.id });
  // 开启新任务区（开发开关，本机存储）后重载
  await app.evaluate(`localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true`);
  await pause(1500);
  await app.waitFor(`!!document.querySelector('[data-testid=home-input]')`, 20000);
  await shot('01-home');
  await typeInto('[data-testid=home-input]', 'Say OK. Do not use any tools.');
  await app.evaluate(`document.querySelector('.reference-composer').requestSubmit();true`);
  await app.waitFor(`!!document.querySelector('.agent-task-view .agent-user-bubble')`, 30000);
  await app.waitFor(`!document.querySelector('.agent-stop')`, 180000);
  // 被验收：打开手动终端，在任务目录执行 pwd
  await click('[data-testid=agent-terminal-toggle]');
  await app.waitFor(`!!document.querySelector('[data-testid=agent-terminal] .xterm-screen')`, 20000);
  await pause(2500);
  await click('[data-testid=agent-terminal] .xterm-screen');
  await app.cdp('Input.insertText', { text: 'pwd' });
  await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r' });
  await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await app.waitFor(`(document.querySelector('[data-testid=agent-terminal] .xterm-rows')?.textContent??'').includes(${JSON.stringify(work)})`, 20000);
  result.terminal = await app.evaluate(`(document.querySelector('[data-testid=agent-terminal] .xterm-rows')?.textContent??'').slice(-400)`);
  step('terminal', { tail: result.terminal });
  await shot('31-terminal');
  await click('[data-testid=agent-terminal] .agent-terminal-head button');
  await app.waitFor(`!document.querySelector('[data-testid=agent-terminal]')`, 5000);
  result.rendererErrors = app.rendererErrors.slice(0, 5);
} catch (e) {
  result.error = String(e?.stack ?? e);
  try { await shot('99-failure'); } catch {}
} finally {
  try { await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`, { label: 'quit-app', timeoutMs: 5000 }); } catch (e) { result.quitError = String(e); }
  try { result.exit = await app.waitForExit(20000); } catch (e) { result.exitError = String(e); try { result.crash = await app.crash(); } catch {} }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...result, log }, null, 1));
  console.log('RESULT', JSON.stringify(result).slice(0, 1500));
}
