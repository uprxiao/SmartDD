// Run after pnpm build: node scripts/m4-ui-smoke.mjs
// Set SMARTDD_UI_APP to a packaged executable to verify the same flow inside the .app.
// A real Electron renderer/IPC/PTY smoke test, with an isolated HOME/userData and a fake runner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packagedApp = process.env.SMARTDD_UI_APP;
const electron = packagedApp ? resolve(packagedApp) : require('electron');
const root = resolve(dirname(new URL(import.meta.url).pathname), '..');
const scratch = await mkdtemp(join(tmpdir(), 'smartdd-m4-ui-'));
for (const path of ['home', 'work/.svn', 'userdata']) await mkdir(join(scratch, path), { recursive: true });
await writeFile(join(scratch, 'work', 'unchanged.txt'), 'working copy sentinel');
const fake = join(scratch, 'runner.py');
await writeFile(fake, `import json, os, sys, time
if '--version' in sys.argv:
 print('SmartDD isolated test runner 1.0'); sys.exit(0)
if 'SMARTDD_PROJECT_CONTEXT' not in os.environ:
 print(json.dumps({'type':'result','is_error':False,'result':'SMARTDD_OK'})); sys.exit(0)
with open(os.environ['SMARTDD_PROJECT_CONTEXT']) as f: context=json.load(f)
assert context['projectId'] == os.environ['SMARTDD_PROJECT_ID']
assert 'NO_COLOR' not in os.environ
assert os.environ['COLORTERM'] == 'truecolor'
print('M4_GUI_PROJECT_CONTEXT_OK', flush=True)
print('\\x1b[31mSMARTDD_ANSI_RED\\x1b[0m \\x1b[32mSMARTDD_ANSI_GREEN\\x1b[0m \\x1b[38;2;180;50;160mSMARTDD_TRUECOLOR\\x1b[0m', flush=True)
time.sleep(3)
`);
const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
await new Promise((r) => server.close(r));
const env = { ...process.env, NO_COLOR: '1', SMARTDD_USER_DATA: join(scratch, 'userdata'), HOME: join(scratch, 'home'), ZDOTDIR: join(scratch, 'home'), CODEX_HOME: join(scratch, 'home', '.codex'), CLAUDE_CONFIG_DIR: join(scratch, 'home', '.claude') };
for (const name of Object.keys(env)) if (/^(ELECTRON_RUN_AS_NODE|ANTHROPIC_|OPENAI_|CLAUDECODE|CLAUDE_CODE_)/.test(name)) delete env[name];
const child = spawn(electron, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, ...(packagedApp ? [] : ['.'])], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
let childLogs = '';
child.stdout.on('data', (b) => { childLogs += b; }); child.stderr.on('data', (b) => { childLogs += b; });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
const checks = [];
try {
  let page;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((p) => p.type === 'page'); if (page) break; } catch { /* app starting */ }
    if (child.exitCode !== null) throw new Error('Electron exited before opening a window');
    await pause(100);
  }
  assert(page, 'Electron debugging target not ready');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let seq = 0; const pending = new Map(); const rendererErrors = [];
  ws.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) { const p = pending.get(message.id); if (!p) return; pending.delete(message.id); message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result); }
    if (message.method === 'Runtime.exceptionThrown') rendererErrors.push(message.params.exceptionDetails.text);
  });
  const cdp = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  await cdp('Runtime.enable');
  const evaluate = async (expression) => {
    const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, ms = 6000) => {
    const started = Date.now();
    while (Date.now() - started < ms) { if (await evaluate(expression)) return; await pause(80); }
    throw new Error(`UI condition timed out: ${expression}`);
  };
  const invoke = (channel, ...args) => evaluate(`window.electronAPI.invoke(${JSON.stringify(channel)}, ...${JSON.stringify(args)})`);
  const click = (selector) => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  const section = () => evaluate(`[...document.querySelectorAll('nav button')].find(b => b.textContent.includes('Skill')).click()`);
  const screenshot = async (name) => { const { data } = await cdp('Page.captureScreenshot', { format: 'png' }); await writeFile(join(scratch, name + '.png'), Buffer.from(data, 'base64')); };
  await waitFor('Boolean(window.electronAPI && document.querySelector("[data-testid=nav-settings]"))');
  const project = await invoke('projects.create', { name: 'M4 UI 验证', aliases: [], description: 'Isolated test project', rulesPath: null }, [{ label: 'SVN fixture', path: join(scratch, 'work') }]);
  const profile = await invoke('aiProfiles.create', { name: 'M4 test runner', runner: 'claude', executable: '/usr/bin/python3', args: [fake], env: [], color: null, isDefault: true });
  // A reload exercises persistence and refreshes the same queries an ordinary app launch uses.
  await cdp('Page.reload');
  await waitFor(`Boolean(document.querySelector('[data-project-id="${project.id}"]'))`);
  await click('[data-testid=nav-settings]'); await section();
  await waitFor('Boolean(document.querySelector("[data-testid=capability-discovery]"))');
  assert(await evaluate('document.body.innerText.includes("smartdd-project-db-diagnostics")'));
  assert(await evaluate('document.body.innerText.includes("已是随包最新版本")'));
  await screenshot('settings'); checks.push('Settings catalog, retained versions, source and static discovery rendered');
  await click('[data-testid=nav-home]');
  await waitFor(`Boolean(document.querySelector('[data-project-id="${project.id}"]'))`);
  await click(`[data-project-id="${project.id}"] [data-testid=sidebar-project-more]`);
  await waitFor('Boolean(document.querySelector("[data-testid=sidebar-project-edit]"))');
  await click('[data-testid=sidebar-project-edit]'); await section();
  await waitFor('Boolean(document.querySelector("[aria-label=smartdd-project-db-diagnostics]"))');
  await click('[aria-label=smartdd-project-db-diagnostics]');
  await waitFor(`window.electronAPI.invoke('capabilities.projectSettings', '${project.id}').then(x=>!x.skills.find(s=>s.id==='project-db-diagnostics').enabled)`);
  await screenshot('project'); checks.push('Project toggle persisted through IPC');
  await click('[aria-label=smartdd-project-db-diagnostics]');
  await waitFor(`window.electronAPI.invoke('capabilities.projectSettings', '${project.id}').then(x=>x.skills.find(s=>s.id==='project-db-diagnostics').enabled)`);
  await click('[data-testid=nav-new-task]');
  await click('[data-testid=home-task-settings]');
  await waitFor('Boolean(document.querySelector("[data-testid=capability-launch-preview]"))');
  await click('[data-testid=capability-launch-preview] summary'); await screenshot('launch-preview');
  await click('[data-testid=home-settings-done]');
  await waitFor('!document.querySelector("[data-testid=home-launch]").disabled'); await click('[data-testid=home-launch]');
  await waitFor('Boolean(document.querySelector("[data-testid=task-info]"))'); await click('[data-testid=task-info]');
  await waitFor('document.querySelector("[data-testid=runtime-capabilities]")?.textContent.includes("终端自检通过")');
  assert(await evaluate('document.querySelector("[data-testid=task-env]").textContent.includes("PROJECT_DB_CONFIG")'));
  assert(await evaluate('document.querySelector("[data-testid=runtime-capabilities]").textContent.includes("加载未核验")'));
  await screenshot('task-info'); checks.push('Home launch → real PTY check → task capability snapshot, env names and unverified load status');
  await click('[data-testid=task-info]');
  const colourCheck = `(() => {
    const spans = [...document.querySelectorAll('.xterm-rows span')];
    const markers = ['SMARTDD_ANSI_RED', 'SMARTDD_ANSI_GREEN', 'SMARTDD_TRUECOLOR'];
    const colours = markers.map(marker => {
      const span = spans.find(s => s.textContent.includes(marker));
      return span ? getComputedStyle(span).color : null;
    });
    return colours.every(Boolean) && new Set(colours).size === 3;
  })()`;
  for (const theme of ['ylight', 'ydark']) {
    await invoke('appSettings.update', 'theme', theme);
    await waitFor(`document.documentElement.classList.contains('${theme}')`);
    await waitFor(colourCheck);
    await screenshot('terminal-colour-' + theme);
  }
  checks.push('ANSI and truecolour rendered in light/dark themes despite parent NO_COLOR=1');
  await invoke('appSettings.update', 'theme', null);
  const task = (await invoke('tasks.list'))[0];
  assert.equal(task.runtimeSnapshot.selfCheck.status, 'passed');
  await invoke('tasks.kill', task.id);
  await waitFor(`window.electronAPI.invoke('tasks.get','${task.id}').then(t=>!t.ptyId)`);
  assert.equal(await readFile(join(scratch, 'work', 'unchanged.txt'), 'utf8'), 'working copy sentinel');
  assert.deepEqual(rendererErrors, []); checks.push('No renderer exceptions; original working-copy file unchanged');
  await invoke('appSettings.update', 'general', { language: 'en' });
  await cdp('Page.reload');
  await waitFor('Boolean(document.querySelector("[data-testid=nav-settings]"))');
  await click('[data-testid=nav-settings]'); await section();
  await waitFor('document.body.innerText.includes("Skills & MCP")'); await screenshot('english'); checks.push('English capability screen rendered');
  await cdp('Emulation.setDeviceMetricsOverride', { width: 800, height: 650, deviceScaleFactor: 1, mobile: false });
  await screenshot('compact'); checks.push('Compact 800px viewport captured');
  await writeFile(join(scratch, 'result.json'), JSON.stringify({ ok: true, checks, projectId: project.id, aiProfileId: profile.id, scratch }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, artifacts: scratch }, null, 2));
} catch (error) {
  await writeFile(join(scratch, 'failure.json'), JSON.stringify({ error: String(error), checks }, null, 2));
  console.error(String(error)); console.error(`Artifacts: ${scratch}`); process.exitCode = 1;
} finally {
  ws?.close(); child.kill('SIGTERM');
  await writeFile(join(scratch, 'electron.log'), childLogs);
}
