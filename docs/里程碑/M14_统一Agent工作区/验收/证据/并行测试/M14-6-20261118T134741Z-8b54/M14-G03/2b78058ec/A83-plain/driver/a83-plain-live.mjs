// M14 A83 P3 packaged A + R, adapted from the Git control driver.
// Real DeepSeek through an isolated loopback relay: the App only sees a local public token; the key stays in this process.
// Only synthetic files and prompts are sent. Checks that a real model chooses the right mode from natural language.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openElectron, pause } from './electron-harness.mjs';
import { redirectHome } from './home-redirect-main.mjs';

const [out, scenarioId, sourceCommit] = process.argv.slice(2);
assert(/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-3\d\d$/.test(out ?? ''), 'Private output path required');
const executable = process.env.M14_ACCEPTANCE_APP;
assert(executable?.startsWith('/private/tmp/willyou-m14-stage6.WRvdST/package/') && existsSync(executable));
assert.equal(sourceCommit, '2b78058ec1e55c027f69ceb2d3c8fcbef1c69286');
assert.equal(executable, realpathSync(executable));
const hash = value => createHash('sha256').update(value).digest('hex');
const asar = hash(readFileSync(join(executable,'../../Resources/app.asar')));
assert.equal(asar,'7712450f6430db759657bdec03a2e155b05cb96764b2e9a31711ad08306bcc5c');
const upstreamSecret = process.env.M14_LIVE_DEEPSEEK_KEY;
delete process.env.M14_LIVE_DEEPSEEK_KEY;
assert(upstreamSecret, 'Missing test model credential');
const MODEL = 'deepseek-flash';
mkdirSync(out);
const root = realpathSync(mkdtempSync(join(out, 'runtime-')));
const home = join(root, 'home'), userData = join(root, 'data'), cwd = join(root, 'work');
for (const dir of [home, userData, cwd]) mkdirSync(dir);
const env = { HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ENABLE_TOOL_SEARCH: 'false', TMPDIR: root };
const DESIGN_MARKER = 'M14_DESIGN_MARKER_Q7ZK';
const SYMBOL = 'M14UniqueGadgetContract';
assert.equal(scenarioId, 'a83:plain');
const base = 'a83';
const parentKind = 'claude', childKind = 'codex';
const name = { claude: 'M14 Claude DeepSeek', codex: 'M14 Codex DeepSeek' };
const independentTitle = 'A83 independent same-root task';
const independentInput = 'A83_INDEPENDENT_GATE_344 不调用工具，只回复 A83_INDEPENDENT_DONE。';
const prompts = { a83: '我刚改了 subject.cjs。请派一个子任务，用「M14 Codex DeepSeek」，在当前目录运行 node --test check.test.cjs，原样报告 pass 和 fail 的数量。不要修改任何文件，派出后结束本轮，等结果回来再说明。' };
const result = { sourceCommit, asar, executable, scenarioId, parentKind, childKind, model: MODEL, root, cwd, home, userData,
  layer: 'A + R: signed packaged Electron and actual native CLIs; isolated local relay to DeepSeek using synthetic data',
  prompt: prompts[base], requests: [], approvals: [], checks: [], status: 'failed' };
let independentHeld = false, releaseIndependent;
const independentGate = new Promise(resolve => { releaseIndependent = resolve; });
let app;
const server = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ data: [{ id: MODEL }] })); return; }
    const claude = req.url?.includes('/messages');
    if (req.method !== 'POST' || (!claude && !req.url?.includes('/responses'))) { res.writeHead(404); res.end(); return; }
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const row = { protocol: claude ? 'anthropic' : 'responses', model: body.model, at: new Date().toISOString() };
    assert.equal(body.model, MODEL);
    result.requests.push(row);
    if (JSON.stringify(body).includes('A83_INDEPENDENT_GATE_344')) {
      assert(!independentHeld, 'one independent model request only');
      independentHeld = true;
      row.independentRequestedAt = new Date().toISOString();
      await independentGate;
      row.independentReleasedAt = new Date().toISOString();
    }
    const url = claude ? 'https://api.deepseek.com/anthropic/v1/messages' : 'https://api.deepseek.com/responses';
    const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + upstreamSecret };
    if (claude) {
      headers['anthropic-version'] = req.headers['anthropic-version'] ?? '2023-06-01';
      if (req.headers['anthropic-beta']) headers['anthropic-beta'] = req.headers['anthropic-beta'];
    }
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
async function requireNoPendingApproval() {
  const panel = await app.evaluate('document.querySelector(".agent-request")?.innerText ?? ""');
  if (panel) {
    result.unexpectedApproval = panel.slice(0, 300);
    throw Error('Unexpected approval on read-only test fixture');
  }
}
const original = 'module.exports = "BAD_BASELINE";\n';
const modified = 'module.exports = "DIRTY_FIXTURE";\n';
const testContent = 'const {test}=require("node:test");const assert=require("node:assert/strict");test("DIRTY_TEST_PASSES",()=>assert.equal(require("./subject.cjs"),"DIRTY_FIXTURE"));\n';
const fixtureHashes = dir => ({
  subject: hash(readFileSync(join(dir,'subject.cjs'))),
  test: hash(readFileSync(join(dir,'check.test.cjs'))),
});
let phase = 'fixture setup';
try {
  const baseline = join(root, 'baseline-control');
  mkdirSync(baseline);
  for (const dir of [baseline,cwd]) {
    writeFileSync(join(dir,'subject.cjs'), original);
    writeFileSync(join(dir,'check.test.cjs'), testContent);
  }
  const run = dir => {
    const p = spawnSync(process.execPath, ['--test', 'check.test.cjs'], { cwd: dir, encoding: 'utf8', timeout: 10000, env: { PATH:env.PATH ?? '/usr/bin:/bin',HOME:home } });
    return { status:p.status, signal:p.signal, output:p.stdout.trim(), hashes:fixtureHashes(dir) };
  };
  const headControl = run(baseline);
  writeFileSync(join(cwd,'subject.cjs'), modified);
  const dirty = run(cwd);
  result.fixtureTests = { baseline:headControl, current:dirty };
  assert.deepEqual([headControl.status, dirty.status, headControl.hashes.test],[1,0,dirty.hashes.test]);
  assert(!existsSync(join(cwd,'.git')) && !existsSync(join(cwd,'.svn')));
  phase = 'packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3425, '127.0.0.1', resolve); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => { result.redirect = await redirectHome({ ...info, home }); } });
  const identity = await app.mainEvaluate(`(() => { const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),process.env.HOME,process.env.DEEPSEEK_API_KEY===undefined&&process.env.M14_LIVE_DEEPSEEK_KEY===undefined,process.pid,process.execPath]; })()`);
  check('isolated packaged identity without the real key', JSON.stringify(identity) === JSON.stringify([true, userData, home, true, app.processId, executable]), identity);
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) await app.invoke('agents.customToolPath', 'claude', process.env.M14_SMOKE_CLAUDE);
  const tools = await app.invoke('agents.tools');
  const provider = await app.invoke('agents.saveProvider', { name: 'M14 isolated DeepSeek relay', preset: 'magpie',
    endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425/' }, models: [{ id: MODEL, name: MODEL }] });
  const profiles = {};
  for (const kind of ['claude', 'codex']) {
    const tool = tools.find(t => t.kind === kind && t.installed);
    assert(tool, kind + ' CLI installed');
    profiles[kind] = await app.invoke('agents.save', { name: name[kind], toolId: tool.id, source: 'provider', providerId: provider.id,
      models: [MODEL], defaultModel: MODEL, isDefault: kind === parentKind });
  }
  result.nativeTools = tools.filter(t => t.installed && ['claude', 'codex'].includes(t.kind)).map(t => ({ kind: t.kind, version: t.version }));
  const project = await app.invoke('projects.create', { name: 'M14 live ' + scenarioId, aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: cwd }]);
  const title = 'Live parent ' + scenarioId;
  const newTask = (taskTitle,profileId) => app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd,
    title: taskTitle, profileId, model: MODEL, tier: 'ask' });
  const task = await newTask(title, profiles.claude.id);
  const independent = await newTask(independentTitle, profiles.codex.id);
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const row = id => '[data-testid="sidebar-agent-task"][data-task-id="' + id + '"]';
  const openTask = async id => {
    await click(row(id));
    await app.waitFor('Boolean(document.querySelector(".agent-task-view textarea"))', 10000);
  };
  const submit = async text => {
    await click('.agent-task-view textarea');
    await app.cdp('Input.insertText', { text });
    await click('.agent-task-view button[type="submit"]');
  };
  await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(row(task.taskId))}))`, 20000, { navigation: true });
  await openTask(independent.taskId);
  await submit(independentInput);
  const unrelated = await until(async () => {
    const snap = await snapshot(independent.taskId);
    return independentHeld && snap.run?.busy && {taskId:independent.taskId,runId:snap.run.runId,cwd:snap.cwd};
  }, 'same-root independent native work active', 20000);
  assert.equal(unrelated.cwd,cwd);
  result.independent = { before:unrelated };
  await openTask(task.taskId);
  await app.waitFor('Boolean(document.querySelector(\'[data-testid="agent-delegation-toggle"]\'))', 10000);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector(\'[data-testid="agent-delegation-toggle"]\')?.getAttribute("aria-pressed")==="true"', 10000);
  phase = 'real model delegation from natural language';
  await submit(prompts[base]);
  const expected = 1;
  let family;
  await until(async () => {
    await requireNoPendingApproval();
    family = await relations(task.taskId);
    const kids = family.children ?? [];
    const parent = await snapshot(task.taskId);
    const nativeError = parent.items.find(i=>i.type==='error');
    if(nativeError) throw Error('Parent failed: ' + JSON.stringify(nativeError.payload));
    const other = await snapshot(independent.taskId);
    assert(other.run?.busy && other.run.runId===unrelated.runId, 'Unrelated same-root round remains active and keeps its run');
    if (kids.length) result.independent.observedWithChild = {runId:other.run.runId,busy:other.run.busy,childState:kids[0].state};
    return kids.length === expected && kids.every(k => k.state === 'delivered') && !parent.run?.busy && parent.status !== 'working';
  }, 'children delivered and parent idle', 420000);
  await pause(3000);
  family = await relations(task.taskId);
  const children = [];
  for (const k of family.children) {
    const snap = await snapshot(k.childTaskId);
    const text = snap.items.filter(i => i.type === 'assistant_message').map(i => i.payload.text).join('\n');
    const profile = (await app.invoke('agentTasks.list')).find(t => t.taskId === k.childTaskId)?.selection?.profileId;
    children.push({ title: k.title, access: k.access, workspaceMode: k.workspaceMode, state: k.state, cwd: snap.cwd,
      profile: profile === profiles.claude.id ? 'claude' : profile === profiles.codex.id ? 'codex' : profile, branch: k.workspace?.branch ?? null, answer: text.slice(0, 1500) });
  }
  result.children = children;
  phase = 'scenario checks';
  check('only one actual Codex child uses the plain current directory', children.length===1&&children[0].profile==='codex'&&children[0].workspaceMode==='shared'&&children[0].cwd===cwd&&children[0].branch===null, children);
  const items = (await snapshot(family.children[0].childTaskId)).items.filter(i => i.type === 'command_execution' && JSON.stringify(i.payload).includes('check.test.cjs'));
  result.testCommands = items.map(i => ({ id:i.itemId, terminal:i.terminal, exitCode:i.payload.exitCode, output:String(i.payload.output??'').slice(-700) }));
  check('real command succeeds against current code while frozen control fails',result.testCommands.some(i=>i.exitCode===0&&/^# pass 1$/m.test(i.output)&&/^# fail 0$/m.test(i.output)),result.testCommands);
  check('child reported passing count', /pass[^\d]{0,15}1|1\s*(个)?\s*(通过|pass)|通过[^\d]{0,15}1/.test(children[0].answer),children[0].answer);
  check('ordinary directory has no Git or SVN state and files preserved',!existsSync(join(cwd,'.git'))&&!existsSync(join(cwd,'.svn'))&&JSON.stringify(fixtureHashes(cwd))===JSON.stringify(dirty.hashes));
  await app.screenshot(join(out,'19-parent-result-unrelated-active.png'));
  await openTask(independent.taskId);
  releaseIndependent();
  const unaffected = await until(async () => {
    const snap = await snapshot(independent.taskId);
    const answers = snap.items.filter(i=>i.type==='assistant_message').map(i=>String(i.payload.text??''));
    return !snap.run?.busy && answers.some(a=>a.includes('A83_INDEPENDENT_DONE')) && {runId:snap.run?.runId,answer:answers.at(-1)};
  }, 'independent actual native round finishes on the same run', 45000);
  check('independent same-root round finishes on the unchanged native run',unaffected.runId===unrelated.runId,unaffected);
  result.independent.after = unaffected;
  check('real model requests on both official protocol endpoints succeeded', result.requests.some(r=>r.protocol==='responses')&&result.requests.some(r=>r.protocol==='anthropic')&&result.requests.every(r=>r.upstreamStatus===200),result.requests.map(r=>r.upstreamStatus));
  await app.screenshot(join(out, '20-live-result.png'));
  check('no renderer errors', app.rendererErrors.length === 0, app.rendererErrors);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error).slice(0, 2000);
  if (app) try { result.visible = await app.evaluate('document.body.innerText.slice(0,6000)'); await app.screenshot(join(out, '99-failure.png')); } catch { /* exited */ }
} finally {
  releaseIndependent();
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
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
}
if (result.status !== 'passed' || result.exit?.code !== 0) process.exitCode = 1;
