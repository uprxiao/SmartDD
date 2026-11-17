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
const log = []; const step = (name, data) => { log.push({ t: new Date().toISOString(), name, ...(data ?? {}) }); console.log(name, data ? JSON.stringify(data).slice(0, 300).split(process.env.DEEPSEEK_API_KEY || '\u0000').join('[REDACTED]') : ''); };
const app = await openElectron({ userData, inspectMain: true, cwd: '/Users/liubu/hx/4.uprxiao/SmartDD' });
const shot = async (name) => { const r = await app.cdp('Page.captureScreenshot', { format: 'png' }); writeFileSync(join(OUT, `${name}.png`), Buffer.from(r.data, 'base64')); step('shot', { name }); };
const box = async (sel) => app.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2}:null})()`);
const click = async (sel) => { const b = await box(sel); if (!b) throw new Error('找不到可点击元素 ' + sel); for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, x: b.x, y: b.y, button: 'left', clickCount: 1 }); await pause(200); };
const typeInto = async (sel, text) => { await click(sel); await app.cdp('Input.insertText', { text }); await pause(150); };
const result = { root };
try {
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  // 准备：检测本机 CLI、建 DeepSeek 托管供应商（保存 Key 会触发 macOS 钥匙串授权，需用户点“允许”）
  const KEY = process.env.DEEPSEEK_API_KEY; if (!KEY) throw new Error('需要 DEEPSEEK_API_KEY');
  await app.invoke('agents.refreshTools');
  const tools = await app.invoke('agents.tools');
  const claude = tools.find(t => t.kind === 'claude' && t.installed);
  step('tools', { claude: claude && { version: claude.version } });
  if (!claude) throw new Error('本机 Claude Code 未安装');
  step('WAITING_FOR_KEYCHAIN', { hint: '请在 macOS 弹窗中点“始终允许”' });
  const provider = await app.invoke('agents.saveProvider', { name: 'DeepSeek', preset: 'deepseek', endpoints: { anthropic: 'https://api.deepseek.com/anthropic' }, authType: 'bearer', key: KEY,
    models: [{ id: 'deepseek-flash', name: 'deepseek-flash' }, { id: 'deepseek-pro', name: 'deepseek-pro' }], recommended: { claude: 'deepseek-flash' } });
  step('provider saved', { id: provider.id, hasKey: provider.hasKey });
  const profile = await app.invoke('agents.save', { name: 'Claude · DeepSeek', toolId: claude.id, source: 'provider', providerId: provider.id, models: ['deepseek-flash', 'deepseek-pro'], defaultModel: 'deepseek-flash', isDefault: true });
  const project = await app.invoke('projects.create', { name: 'M14 Claude 验收', aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: work }]);
  step('prepared', { profile: profile.id, project: project.id });
  await app.evaluate(`localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true`);
  await pause(1500);
  await app.waitFor(`!!document.querySelector('[data-testid=home-input]')`, 20000);
  const status = () => app.evaluate(`document.querySelector('.agent-status')?.textContent??''`);
  const idle = () => app.waitFor(`!document.querySelector('.agent-stop') && !document.querySelector('.agent-request')`, 240000);
  const lastAnswer = () => app.evaluate(`[...document.querySelectorAll('.agent-assistant .agent-md')].map(e=>e.textContent.trim()).at(-1)??''`);
  const panelTitle = () => app.evaluate(`document.querySelector('.agent-request-head b')?.textContent??''`);
  const clickOption = async (re) => { const ok = await app.evaluate(`(()=>{const b=[...document.querySelectorAll('.agent-request-options button')].find(b=>${re}.test(b.textContent));if(!b)return false;b.scrollIntoView({block:'center'});return true})()`); if (!ok) throw new Error('找不到选项 ' + re); const p = await app.evaluate(`(()=>{const b=[...document.querySelectorAll('.agent-request-options button')].find(b=>${re}.test(b.textContent));const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`); for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button: 'left', clickCount: 1 }); await pause(400); };
  // 运行中出现的工具审批一律经界面批准（被验收的是面板本身与回传）
  const approveUntilIdle = async (label) => { const end = Date.now() + 240000; const seen = []; while (Date.now() < end) { const t = await panelTitle(); if (t) { seen.push(t); if (/计划/.test(t)) return seen; await shot(`${label}-panel-${seen.length}`); await clickOption('/^1/'); continue; } if (await app.evaluate(`!document.querySelector('.agent-stop')`)) return seen; await pause(500); } throw new Error(label + ' 超时'); };
  const send = async (text) => { await typeInto('.agent-composer textarea', text); await click('.agent-send'); await pause(800); };

  // 1. 首页建任务，首轮
  await typeInto('[data-testid=home-input]', 'Reply with exactly the single word PONG. Do not use any tools.');
  await app.evaluate(`document.querySelector('.reference-composer').requestSubmit();true`);
  await app.waitFor(`!!document.querySelector('.agent-task-view .agent-user-bubble')`, 30000);
  await idle(); result.turn1 = await lastAnswer(); step('turn1', { answer: result.turn1 }); await shot('c01-first');

  // 2. 提问表单（AskUserQuestion）
  await send('Use the AskUserQuestion tool to ask me which color I prefer, with exactly two options: Red and Blue. After I answer, reply with only the color I chose.');
  await app.waitFor(`!!document.querySelector('.agent-form')`, 180000);
  await shot('c02-question-form');
  await app.evaluate(`(()=>{const l=[...document.querySelectorAll('.agent-form-q label')].find(l=>/Blue/.test(l.textContent));l.querySelector('input').click();return true})()`);
  await pause(300);
  await app.evaluate(`(()=>{[...document.querySelectorAll('.agent-form-actions button')].find(b=>/提交回答/.test(b.textContent)).click();return true})()`);
  await idle(); result.question = await lastAnswer(); step('question', { answer: result.question }); await shot('c03-question-answer');

  // 3. 计划批准（EnterPlanMode → ExitPlanMode → 请求面板）
  await send('Use the EnterPlanMode tool first. Then present a one-step plan to create a file named plan.txt containing ok, using ExitPlanMode. Do not create the file before I approve the plan.');
  result.planPanels = await approveUntilIdle('c04');
  if (/计划/.test(await panelTitle())) {
    result.planDetail = await app.evaluate(`document.querySelector('.agent-request-detail')?.textContent??''`);
    await shot('c05-plan-panel');
    await clickOption('/批准并开始/');
    result.afterPlan = await approveUntilIdle('c06');
  }
  await idle(); result.planFile = existsSync(join(work, 'plan.txt')); step('plan', { panels: result.planPanels, file: result.planFile }); await shot('c07-after-plan');

  // 4. 目标（/goal，等原生确认）
  await send('/goal Create a file named goal.txt containing ok in the current directory. The goal is met when that file exists.');
  result.goalPendingSeen = await app.evaluate(`!!document.querySelector('[data-testid=agent-goal-pending]')`);
  result.goalActiveSeen = await app.waitFor(`!!document.querySelector('[data-testid=agent-goal]')`, 120000).then(() => true, () => false);
  await shot('c08-goal');
  result.goalApprovals = await approveUntilIdle('c09');
  await idle(); result.goalFile = existsSync(join(work, 'goal.txt')); result.goalRow = await app.evaluate(`document.querySelector('[data-testid=agent-goal]')?.textContent??null`);
  step('goal', { pending: result.goalPendingSeen, active: result.goalActiveSeen, file: result.goalFile, row: result.goalRow }); await shot('c10-goal-end');

  // 5. 同任务换模型
  await app.evaluate(`(()=>{const s=document.querySelector('select[aria-label="模型"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'deepseek-pro');s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await pause(800);
  await send('Reply with exactly OK. Do not use any tools.');
  await idle(); result.modelTurn = await lastAnswer(); step('model switch', { answer: result.modelTurn }); await shot('c11-model');

  // 6. 请求批准 → 完全访问（首次确认框），重开并恢复原会话
  await app.evaluate(`(()=>{const s=document.querySelector('select[aria-label="权限档位"]');const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,'full');s.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
  await app.waitFor(`!!document.querySelector('[data-testid=agent-confirm-full]')`, 10000);
  await shot('c12-full-confirm');
  await click('[data-testid=agent-confirm-full]');
  await pause(800);
  await send(`Use the Bash tool to run exactly: touch ${join(work, 'full.txt')} . Then reply DONE.`);
  result.fullPanels = await approveUntilIdle('c13');
  await idle(); result.fullFile = existsSync(join(work, 'full.txt')); result.fullAnswer = await lastAnswer();
  step('full', { panels: result.fullPanels, file: result.fullFile, answer: result.fullAnswer }); await shot('c14-full');
  result.dbRuns = execFileSync('sqlite3', [join(userData, 'smartdd.db'), "select generation,state,driver_id from capability_runs where binding_id is not null order by generation"], { encoding: 'utf8' });
  result.dbBindings = execFileSync('sqlite3', [join(userData, 'smartdd.db'), "select count(*), count(distinct native_id) from agent_bindings"], { encoding: 'utf8' });
  result.dbModels = execFileSync('sqlite3', [join(userData, 'smartdd.db'), "select json_extract(payload_ref,'$.model') from agent_items where type='assistant_message'"], { encoding: 'utf8' });
  result.rendererErrors = app.rendererErrors.slice(0, 5);
} catch (e) {
  result.error = String(e?.stack ?? e);
  try { await shot('99-failure'); } catch {}
} finally {
  try { await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`, { label: 'quit-app', timeoutMs: 5000 }); } catch (e) { result.quitError = String(e); }
  try { result.exit = await app.waitForExit(20000); } catch (e) { result.exitError = String(e); try { result.crash = await app.crash(); } catch {} }
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ ...result, log }, null, 1).split(process.env.DEEPSEEK_API_KEY || '\u0000').join('[REDACTED]'));
  console.log('RESULT', JSON.stringify(result).slice(0, 1500));
}
