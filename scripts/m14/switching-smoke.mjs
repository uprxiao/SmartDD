// Development build UI check only; no model call, no formal packaged A/R acceptance.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openElectron } from '../lib/electron-harness.mjs';
const output = process.argv[2]; assert(output); mkdirSync(output, { recursive: true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-switch-')), home = join(root, 'home'), userData = join(root, 'data'), cwd = join(root, 'work');
[home, userData, cwd].forEach(p => mkdirSync(p));
const app = await openElectron({ userData, env: { HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude') }, inspectMain: true });
const result = { layer: 'development App UI, isolated HOME and userData; no model call', root, assertions: [] };
const click = async selector => {
  const point = await app.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect();const x=r.x+r.width/2,y=r.y+r.height/2;return r.width&&r.height&&e.contains(document.elementFromPoint(x,y))?{x,y}:null})()`);
  assert(point, 'clickable unobscured ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
};
const check = async (name, expression) => { await app.waitFor(expression, 20000); result.assertions.push(name); };
const shot = async name => writeFileSync(join(output, name + '.png'), Buffer.from((await app.cdp('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
try {
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools'); const tools = await app.invoke('agents.tools');
  // Public local preset needs no saved credential/keychain. No send/turn action in this driver.
  const provider = await app.invoke('agents.saveProvider', { name: 'Isolated UI fixture', preset: 'magpie', endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425/' }, models: [{ id: 'fixture-model', name: 'fixture-model' }] });
  const profiles = [];
  for (const kind of ['codex', 'claude']) {
    const tool = tools.find(t => t.kind === kind && t.installed); assert(tool, kind + ' installed');
    const p = await app.invoke('agents.save', { name: 'UI ' + kind, toolId: tool.id, source: 'provider', providerId: provider.id, models: ['fixture-model'], defaultModel: 'fixture-model', isDefault: kind === 'codex' }); profiles.push(p);
  }
  const project = await app.invoke('projects.create', { name: 'Switch UI fixture', aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: cwd }]);
  await app.evaluate(`localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true`);
  await check('home picker mounted', `!!document.querySelector('.agent-model-pill')`);
  await click('.agent-model-pill');
  await check('three column picker', `!!document.querySelector('.agent-picker-rail')&&!!document.querySelector('.agent-picker-list')&&!!document.querySelector('.agent-picker-traits')`);
  await click('.agent-picker-rail button[aria-label="UI claude"]');
  await click('.agent-model-row[aria-label="fixture-model"]');
  await check('home selection changed without submitting form', `!document.querySelector('.agent-task-view')&&document.querySelector('.agent-model-pill').textContent.includes('UI claude')&&!document.querySelector('.agent-picker')`);
  await shot('01-home-picker');
  const dirs = await app.invoke('projects.get', project.id);
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: dirs.dirs?.[0]?.id ?? null, cwd, title: 'Idle switching fixture', profileId: profiles[0].id, tier: 'ask' });
  await check('prepared task visible', `!!document.querySelector('[data-testid="sidebar-agent-task"]')`);
  await click('[data-testid="sidebar-agent-task"]');
  await check('task view opened', `!!document.querySelector('.agent-task-view .agent-model-pill')`);
  await click('.agent-task-view .agent-model-pill'); await click('.agent-picker-rail button[aria-label="UI claude"]'); await click('.agent-model-row[aria-label="fixture-model"]');
  await check('task switched and marker visible', `document.querySelector('.agent-task-view .agent-model-pill').textContent.includes('UI claude')&&document.body.textContent.includes('此处切换到 UI claude')`);
  const snap = await app.invoke('agentTasks.snapshot', task.taskId);
  assert.equal(snap.selection.profileId, profiles[1].id); assert.equal(snap.run, null); assert.equal(snap.turns.length, 0);
  result.assertions.push('selection durable; switch alone starts no run or turn');
  await shot('02-task-switched');
  assert.deepEqual(app.rendererErrors, []); result.passed = true;
} catch (e) { result.error = String(e?.stack ?? e); try { await shot('99-failure'); } catch {} }
finally {
  try { await app.mainEvaluate(`(()=>{const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');if(E.app.getPath('userData')!==${JSON.stringify(userData)})throw Error('Own App only');setTimeout(()=>E.app.quit(),50);return true})()`); } catch (e) { result.quitError = String(e); }
  try { result.exit = await app.waitForExit(20000); } catch (e) { result.exitError = String(e); await app.crash(); }
  result.rendererErrors = app.rendererErrors; writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
}
if (!result.passed || result.exitError || result.quitError || result.rendererErrors.length) process.exitCode = 1;
