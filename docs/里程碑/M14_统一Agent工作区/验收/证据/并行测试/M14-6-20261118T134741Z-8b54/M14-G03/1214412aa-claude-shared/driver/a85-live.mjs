// M14 A85 packaged A + R driver (Claude Code, 2026-11-19): design, three review rounds with wy_send, then development.
// Real DeepSeek through the isolated loopback relay; synthetic files and prompts only. X1 not covered.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openElectron, pause } from './electron-harness.mjs';
import { redirectHome } from './home-redirect-main.mjs';

const [out, sourceCommit] = process.argv.slice(2);
assert(/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-3\d\d$/.test(out ?? ''), 'Private output path required');
const executable = process.env.M14_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/package/') && existsSync(executable));
assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/);
const upstreamSecret = process.env.M14_LIVE_DEEPSEEK_KEY;
assert(upstreamSecret, 'Missing test model credential');
const MODEL = 'deepseek-flash';
mkdirSync(out);
const root = realpathSync(mkdtempSync(join(out, 'runtime-')));
const home = join(root, 'home'), userData = join(root, 'data'), cwd = join(root, 'work');
for (const dir of [home, userData, cwd]) mkdirSync(dir);
const env = { HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ENABLE_TOOL_SEARCH: 'false', TMPDIR: root };
const MARKER = 'M14_A85_DESIGN_MARKER_7RX';
const x1Auth = process.env.M14_X1_AUTH || null;
const CODEX = x1Auth ? 'M14 Codex 订阅' : 'M14 Codex DeepSeek', CLAUDE = 'M14 Claude DeepSeek';
const steps = [
  { id: 'review-1', text: `design.md 是我刚写的设计草稿，还没有提交。请开启委派，派一个审查子任务（用「${CODEX}」，共用目录，只审查不改文件）审查 design.md，审查意见里要原样引用 Marker 行的标记。派出后结束本轮。` },
  { id: 'review-2', text: '根据审查意见修改 design.md：在文件末尾加一行 "Revision: 2"。然后用 wy_send 把修改后的设计发回给同一个审查子任务再审一遍，要求审查意见里引用 Revision 行。发出后结束本轮。' },
  { id: 'review-3', text: '再修改 design.md：把 "Revision: 2" 改成 "Revision: 3"。然后用 wy_send 让同一个审查子任务做第三轮审查，引用 Revision 行；如果没有问题就回复“没有问题”。发出后结束本轮。' },
  { id: 'dev-shared', text: `设计确认了。请派一个开发子任务 C（用「${CODEX}」，共用目录），按 design.md 在当前目录新建 impl.txt，内容写 design.md 中 Marker 行的标记。派出后结束本轮。` },
  { id: 'dev-worktree-dirty', text: `另外再派一个开发子任务，要求使用独立工作副本（workspaceMode 为 worktree），用「${CODEX}」，新建 impl-wt.txt，内容写 design.md 中 Marker 行的标记；如果读不到就写 MARKER_NOT_FOUND。先不要提交任何文件。派出后结束本轮，并告诉我委派回执里关于未提交文件的说明。` },
  { id: 'dev-worktree-committed', text: `现在先用 git 提交 design.md（只提交这一个文件，提交说明写 "design"），然后再派一个使用独立工作副本的开发子任务（用「${CODEX}」），新建 impl-wt2.txt，内容写 design.md 中 Marker 行的标记。派出后结束本轮。` },
];
const result = { sourceCommit, executable, model: MODEL, steps: steps.map(s => s.id),
  layer: 'A + R: packaged Electron, actual native CLIs, isolated loopback relay to real DeepSeek. Synthetic files and prompts only. X1 not covered.',
  requests: [], approvals: [], checks: [], rounds: {}, status: 'failed' };
let app;
const server = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: MODEL }] })); return; }
    const claude = req.url?.includes('/messages');
    if (req.method !== 'POST' || (!claude && !req.url?.includes('/responses'))) { res.writeHead(404); res.end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const row = { protocol: claude ? 'anthropic' : 'responses', at: new Date().toISOString() };
    result.requests.push(row);
    const url = claude ? 'https://api.deepseek.com/anthropic/v1/messages' : 'https://api.deepseek.com/responses';
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + upstreamSecret };
    if (claude) { headers['anthropic-version'] = req.headers['anthropic-version'] ?? '2023-06-01'; if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta']; }
    const upstream = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
    row.upstreamStatus = upstream.status;
    res.writeHead(upstream.status, { 'content-type': upstream.headers.get('content-type') ?? 'application/json' });
    if (upstream.body) await pipeline(Readable.fromWeb(upstream.body), res); else res.end();
  } catch (error) {
    result.relayErrors = [...(result.relayErrors ?? []), String(error).slice(0, 300)];
    if (!res.headersSent) res.writeHead(502);
    res.end();
  }
});
const git = (...args) => execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const snapshot = id => app.invoke('agentTasks.snapshot', id);
const relations = id => app.invoke('agentTasks.relations', id);
const check = (label, ok, detail) => { result.checks.push({ label, ok: !!ok, ...(detail === undefined ? {} : { detail }) }); assert(ok, label); };
async function until(fn, label, timeout) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const v = await fn(); if (v) return v; await pause(500); }
  throw Error('Timed out: ' + label);
}
async function click(selector) {
  const point = await app.evaluate(`(() => { const n=[...document.querySelectorAll(${JSON.stringify(selector)})]; const node=n.length===1&&n[0];
    if(!node||node.disabled)return null; node.scrollIntoView({block:'nearest'}); const r=node.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return r.width&&r.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null; })()`);
  assert(point, 'Expected visible unique control: ' + selector);
  for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
}
async function approvePending() {
  const panel = await app.evaluate('document.querySelector(".agent-request")?.innerText ?? ""');
  if (!panel) return;
  const option = await app.evaluate(`(() => { const o=[...document.querySelectorAll('.agent-request [role="option"]')].find(n=>/^(批准一次|批准|允许)$/.test(n.getAttribute('aria-label')??'')); return o?.getAttribute('aria-label') ?? null; })()`);
  if (!option) return;
  await click(`.agent-request [role="option"][aria-label="${option}"]`);
  await click('.agent-request .agent-confirm-choice');
  result.approvals.push({ option, panel: panel.slice(0, 240), at: new Date().toISOString() });
  await pause(500);
}
let phase = 'fixture setup';
try {
  writeFileSync(join(cwd, 'design.md'), '# Design\nStatus: committed baseline without marker\n');
  git('init', '-qb', 'main'); git('add', '-A');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'frozen baseline');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'design.md'), `# Design draft (uncommitted)\nMarker: ${MARKER}\nGoal: write the marker into implementation files.\n`);
  if (x1Auth) { mkdirSync(join(home, '.codex'), { recursive: true }); writeFileSync(join(home, '.codex', 'auth.json'), readFileSync(x1Auth), { mode: 0o600 }); result.x1 = 'Codex subscription login copied into the isolated CODEX_HOME for this run only; removed after the run.'; }
  phase = 'packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3425, '127.0.0.1', resolve); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => { result.redirect = await redirectHome({ ...info, home }); } });
  const identity = await app.mainEvaluate(`(() => { const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),process.env.HOME,process.env.DEEPSEEK_API_KEY===undefined]; })()`);
  check('isolated packaged identity without the real key', JSON.stringify(identity) === JSON.stringify([true, userData, home, true]), identity);
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) await app.invoke('agents.customToolPath', 'claude', process.env.M14_SMOKE_CLAUDE);
  const tools = await app.invoke('agents.tools');
  const provider = await app.invoke('agents.saveProvider', { name: 'M14 isolated DeepSeek relay', preset: 'magpie',
    endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425/' }, models: [{ id: MODEL, name: MODEL }] });
  const profiles = {};
  for (const [kind, label] of [['claude', CLAUDE], ['codex', CODEX]]) {
    const tool = tools.find(t => t.kind === kind && t.installed);
    assert(tool, kind + ' CLI installed');
    profiles[kind] = kind === 'codex' && x1Auth
      ? await app.invoke('agents.save', { name: label, toolId: tool.id, source: 'login', models: [], defaultModel: null, isDefault: false })
      : await app.invoke('agents.save', { name: label, toolId: tool.id, source: 'provider', providerId: provider.id, models: [MODEL], defaultModel: MODEL, isDefault: kind === 'claude' });
  }
  result.nativeTools = tools.filter(t => t.installed && ['claude', 'codex'].includes(t.kind)).map(t => ({ kind: t.kind, version: t.version }));
  const project = await app.invoke('projects.create', { name: 'M14 live a85', aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: cwd }]);
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd, title: 'Live parent a85', profileId: profiles.claude.id, model: MODEL, tier: 'ask' });
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const row = '[data-testid="sidebar-agent-task"][data-task-id="' + task.taskId + '"]';
  await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(row)}))`, 20000, { navigation: true });
  await click(row);
  await app.waitFor('Boolean(document.querySelector(\'[data-testid="agent-delegation-toggle"]\'))', 10000);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector(\'[data-testid="agent-delegation-toggle"]\')?.getAttribute("aria-pressed")==="true"', 10000);
  const idleWithChildren = async expectedDelivered => {
    await approvePending();
    const family = await relations(task.taskId);
    const parent = await snapshot(task.taskId);
    const delivered = family.children.reduce((n, k) => n + (k.state === 'delivered' ? k.attempts : 0), 0);
    return delivered >= expectedDelivered && family.children.every(k => k.state !== 'running' && k.state !== 'queued' && k.state !== 'queued_for_parent')
      && !parent.run?.busy && parent.status !== 'working' && !parent.queued?.length && family;
  };
  const childText = async id => (await snapshot(id)).items.filter(i => i.type === 'assistant_message').map(i => i.payload.text);
  let deliveredTarget = 0;
  for (const step of steps) {
    phase = 'step ' + step.id;
    await app.waitFor('Boolean(document.querySelector(".agent-task-view textarea"))', 10000);
    await click('.agent-task-view textarea');
    await app.cdp('Input.insertText', { text: step.text });
    await click('.agent-task-view button[type="submit"]');
    deliveredTarget += 1;
    const family = await until(() => idleWithChildren(deliveredTarget), step.id + ' settles', 480000);
    await pause(2000);
    result.rounds[step.id] = { children: family.children.map(k => ({ id: k.childTaskId, title: k.title, mode: k.workspaceMode, access: k.access, attempts: k.attempts, state: k.state, branch: k.workspace?.branch ?? null })) };
    await app.screenshot(join(out, `step-${step.id}.png`));
  }
  phase = 'checks';
  const family = await relations(task.taskId);
  const reviewer = family.children[0];
  check('one reviewer kept across three rounds', reviewer.attempts === 3 && reviewer.workspaceMode === 'shared', { attempts: reviewer.attempts, mode: reviewer.workspaceMode });
  const reviews = await childText(reviewer.childTaskId);
  result.reviews = reviews.map(t => t.slice(0, 600));
  check('round 1 cites the uncommitted marker', reviews.some(t => t.includes(MARKER)));
  check('round 2 cites Revision: 2', reviews.some(t => t.includes('Revision: 2')));
  check('round 3 cites Revision: 3', reviews.some(t => t.includes('Revision: 3')));
  const db = join(userData, 'smartdd.db');
  const bindings = execFileSync('sqlite3', [db, `select count(*), count(distinct native_id) from agent_bindings where task_id='${reviewer.childTaskId}'`], { encoding: 'utf8' }).trim();
  result.reviewerBindings = bindings;
  check('reviewer kept one native binding', bindings.startsWith('1|'), bindings);
  const others = family.children.slice(1);
  const shared = others.find(k => k.workspaceMode === 'shared');
  check('development child C uses the shared directory', !!shared);
  check('shared C wrote the marker read from the uncommitted design', readFileSync(join(cwd, 'impl.txt'), 'utf8').includes(MARKER));
  const worktrees = others.filter(k => k.workspaceMode === 'worktree');
  check('two worktree development children', worktrees.length === 2, worktrees.map(k => k.workspace?.branch));
  const parentItems = (await snapshot(task.taskId)).items;
  const delegateOutputs = parentItems.filter(i => i.type === 'tool_call' && String(i.payload?.name ?? '').includes('wy_delegate')).map(i => String(i.payload.output ?? ''));
  const warning = delegateOutputs.find(o => /主目录有 [1-9]\d* 个未提交文件，没有带进子任务/.test(o));
  check('worktree receipt warns about uncommitted files', !!warning, delegateOutputs.map(o => o.slice(0, 200)));
  const [dirty, committed] = worktrees;
  const fileOn = (branch, file) => { try { return git('show', branch + ':' + file); } catch { return null; } };
  const dirtyText = fileOn(dirty.workspace.branch, 'impl-wt.txt');
  const committedText = fileOn(committed.workspace.branch, 'impl-wt2.txt');
  result.worktreeFiles = { dirty: dirtyText, committed: committedText };
  check('worktree child before the commit could not see the uncommitted design', dirtyText !== null && !dirtyText.includes(MARKER), dirtyText);
  check('worktree child after the commit sees the design', committedText !== null && committedText.includes(MARKER), committedText);
  const intents = execFileSync('sqlite3', [db, "select count(*) from agent_intents where action='auto_commit'"], { encoding: 'utf8' }).trim();
  check('no host automatic commit', intents === '0', intents);
  const mainLog = git('log', '--format=%s', head + '..main').split('\n').filter(Boolean);
  result.mainLog = mainLog;
  check('main has only the parent Agent design commit', mainLog.length === 1 && mainLog[0].toLowerCase().includes('design'), mainLog);
  check('all upstream requests succeeded', result.requests.every(r => r.upstreamStatus === 200), result.requests.filter(r => r.upstreamStatus !== 200).length);
  check('no renderer errors', app.rendererErrors.length === 0, app.rendererErrors);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error).slice(0, 2000);
  if (app) try { result.visible = await app.evaluate('document.body.innerText.slice(0,6000)'); await app.screenshot(join(out, '99-failure.png')); } catch { /* exited */ }
} finally {
  if (app) {
    try {
      const tasks = await app.invoke('agentTasks.list');
      result.beforeQuit = tasks.map(({ title, status }) => ({ title, status }));
      for (const t of tasks.filter(t => (t.status === 'working' || t.status === 'waiting') && !t.parentTaskId)) { await app.invoke('agentTasks.stop', t.taskId, true); (result.cleanupMadeIdle ??= []).push(t.title); }
    } catch (error) { result.quitProbeError = String(error); }
    try { await app.mainEvaluate(`(() => { const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron'); if (E.app.getPath('userData')!==${JSON.stringify(userData)}) throw Error('Wrong App'); setTimeout(()=>E.app.quit(),50); return true; })()`); } catch (error) { result.quitRpcError = String(error); }
    try { result.exit = await app.waitForExit(25000); } catch (error) { result.exitError = String(error); try { result.forcedExit = await app.crash(); } catch { /* gone */ } }
    result.rendererErrors = app.rendererErrors;
    writeFileSync(join(out, 'app.log'), app.logs(), { mode: 0o600 });
  }
  try { if (x1Auth) { const { rmSync } = await import('node:fs'); rmSync(join(home, '.codex', 'auth.json'), { force: true }); result.x1Removed = !existsSync(join(home, '.codex', 'auth.json')); } } catch (error) { result.x1RemoveError = String(error); }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
}
if (result.status !== 'passed' || result.exit?.code !== 0) process.exitCode = 1;
