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
  // 被验收：首页用 /goal 之外的普通首条消息建任务，再在任务内用 /goal 设定目标
  await typeInto('[data-testid=home-input]', 'Say OK. Do not use any tools.');
  await app.evaluate(`document.querySelector('.reference-composer').requestSubmit();true`);
  await app.waitFor(`!!document.querySelector('.agent-task-view .agent-user-bubble')`, 30000);
  await app.waitFor(`!document.querySelector('.agent-stop')`, 180000);
  const goalFile = join(work, 'goal-done.txt');
  await typeInto('.agent-composer textarea', '/goal Create a file named goal-done.txt in the current directory containing the single word done. Then the goal is complete.');
  await click('.agent-send');
  await app.waitFor(`!!document.querySelector('[data-testid=agent-goal]')`, 60000);
  result.goalShown = await app.evaluate(`document.querySelector('[data-testid=agent-goal]')?.textContent`);
  step('goal shown', { text: result.goalShown });
  await shot('11-goal-active');
  await app.waitFor(`/已完成/.test(document.querySelector('[data-testid=agent-goal]')?.textContent??'')`, 300000).catch(e => step('goal not complete in time', { e: String(e) }));
  result.goalEnd = { text: await app.evaluate(`document.querySelector('[data-testid=agent-goal]')?.textContent`), file: existsSync(goalFile) };
  step('goal end', result.goalEnd);
  await shot('12-goal-end');
  // 被验收：慢任务中途按停止
  await app.waitFor(`!document.querySelector('.agent-stop')`, 120000).catch(() => {});
  await typeInto('.agent-composer textarea', 'Run this exact shell command and wait for it: for i in $(seq 1 60); do echo $i; sleep 1; done');
  await click('.agent-send');
  await app.waitFor(`!!document.querySelector('.agent-stop') && /工作中/.test(document.querySelector('.agent-status')?.textContent??'')`, 60000);
  await pause(8000);
  await click('button[title="停止本轮"]');
  await app.waitFor(`/已停止/.test(document.querySelector('.agent-status')?.textContent??'')`, 60000);
  result.stopped = { status: await app.evaluate(`document.querySelector('.agent-status')?.textContent`), footer: await app.evaluate(`[...document.querySelectorAll('.agent-turn-footer')].map(e=>e.textContent)`) };
  step('stopped', result.stopped);
  await shot('13-stopped');
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
