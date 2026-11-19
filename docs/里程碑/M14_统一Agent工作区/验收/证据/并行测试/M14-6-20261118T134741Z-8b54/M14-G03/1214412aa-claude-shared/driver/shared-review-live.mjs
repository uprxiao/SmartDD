// M14 A80 / A81 / A82 / A84 packaged A + R driver (Claude Code, 2026-11-19).
// Real DeepSeek through an isolated loopback relay: the App only sees a local public token; the key stays in this process.
// Only synthetic files and prompts are sent. Checks that a real model chooses the right mode from natural language.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { openElectron, pause } from './electron-harness.mjs';
import { redirectHome } from './home-redirect-main.mjs';

const [out, scenarioId, sourceCommit] = process.argv.slice(2);
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
const DESIGN_MARKER = 'M14_DESIGN_MARKER_Q7ZK';
const SYMBOL = 'M14UniqueGadgetContract';
const [base, variant] = scenarioId.split(':');
const reverse = (variant ?? '').includes('rev');
const x1 = (variant ?? '').includes('x1');
const x1Auth = process.env.M14_X1_AUTH;
if (x1) assert(x1Auth && existsSync(x1Auth), 'X1 auth source required');
const parentKind = reverse ? (x1 ? 'x1' : 'codex') : 'claude';
const childKind = reverse ? 'claude' : (x1 ? 'x1' : 'codex');
const name = { claude: 'M14 Claude DeepSeek', codex: 'M14 Codex DeepSeek', x1: 'M14 Codex 订阅' };
const prompts = {
  a81: `design.md 是我刚写好、还没有提交的设计文档。请先开启委派，然后派两个只读审查子任务，都只读审查 design.md、不要修改任何文件：一个用「${x1 ? name.x1 : name.claude}」，一个用「${name.codex}」。审查意见里要原样引用文档中 Marker 那一行的标记。派出后结束本轮，等子任务结果回来后再简要汇总。`,
  a82: `gadget-contract.cjs 是我刚写的接口，还没有提交。请委派一个子任务，用「${name[childKind]}」，基于这个接口在当前目录实现 gadget-impl.cjs：用 require("./gadget-contract.cjs") 读入接口，导出一个对象，键名取接口里 ${SYMBOL} 字段的值，值是一个返回字符串 "IMPLEMENTED" 的函数。派出后结束本轮，等结果回来再说明。`,
  a84: `design.md 是我刚写的设计，还没有提交。请委派一个子任务，用「${name[childKind]}」，审查 design.md 并直接修正问题：把 TYPO_FIELD_NAME 改成 FIXED_FIELD_NAME，其余内容保持不变。派出后结束本轮，等结果回来再说明。`,
  a83: `我刚改了 subject.cjs 但还没提交。请委派一个子任务，用「${name[childKind]}」，在当前目录运行 node --test check.test.cjs，原样报告测试结果（pass 和 fail 的数量），不要修改任何文件。派出后结束本轮，等结果回来再说明。`,
  a80: `请开两个独立工作副本，并行开发两个互不相关的小功能，都用「${name[childKind]}」：子任务一新建 feature-x.txt，内容为 FEATURE_X；子任务二新建 feature-y.txt，内容为 FEATURE_Y。派出后结束本轮，等结果回来再说明。`,
};
assert(Object.hasOwn(prompts, base), 'Unknown scenario ' + scenarioId);
const result = { sourceCommit, executable, scenarioId, parentKind, childKind, model: MODEL,
  layer: 'A + R: packaged Electron, actual native CLIs, isolated loopback relay to real DeepSeek. Synthetic files and prompts only. X1 (Codex subscription) not covered.',
  prompt: prompts[base], requests: [], approvals: [], checks: [], status: 'failed' };
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
    result.requests.push(row);
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
// The isolated synthetic directory stands in for the user: approve command/file requests once, never session-wide.
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
  writeFileSync(join(cwd, 'design.md'), '# Committed design\nField: TYPO_FIELD_NAME baseline\n');
  if (base === 'a83') {
    writeFileSync(join(cwd, 'subject.cjs'), 'module.exports = "BAD_HEAD";\n');
    writeFileSync(join(cwd, 'check.test.cjs'), 'const {test}=require("node:test");const assert=require("node:assert/strict");test("DIRTY_TEST_PASSES",()=>assert.equal(require("./subject.cjs"),"DIRTY_FIXTURE"));\n');
  }
  git('init', '-qb', 'main'); git('add', '-A');
  git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'frozen baseline');
  git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid'); git('config', 'commit.gpgsign', 'false');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(cwd, 'design.md'), `# Uncommitted design\nMarker: ${DESIGN_MARKER}\nField: TYPO_FIELD_NAME\n`);
  if (base === 'a82') writeFileSync(join(cwd, 'gadget-contract.cjs'), `module.exports = { ${SYMBOL}: "${SYMBOL}" };\n`);
  if (base === 'a80') writeFileSync(join(cwd, 'unrelated-dirty.txt'), 'M14_UNCOMMITTED_NOT_FOR_CHILDREN\n');
  if (base === 'a83') {
    writeFileSync(join(cwd, 'subject.cjs'), 'module.exports = "DIRTY_FIXTURE";\n');
    const run = dir => spawnSync(process.execPath, ['--test', 'check.test.cjs'], { cwd: dir, encoding: 'utf8', timeout: 10000 }).status;
    const headClone = join(root, 'head-clone'); git('clone', '-q', '--no-hardlinks', cwd, headClone);
    result.fixtureTests = { head: run(headClone), dirty: run(cwd) };
    assert.deepEqual(Object.values(result.fixtureTests), [1, 0], 'fixture: HEAD fails, dirty passes');
  }
  if (x1) {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'auth.json'), readFileSync(x1Auth), { mode: 0o600 });
    result.x1 = 'Codex subscription login copied into the isolated CODEX_HOME for this run only (user authorised 2026-11-19); removed after the run.';
  }
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
  for (const kind of ['claude', 'codex']) {
    const tool = tools.find(t => t.kind === kind && t.installed);
    assert(tool, kind + ' CLI installed');
    profiles[kind] = await app.invoke('agents.save', { name: name[kind], toolId: tool.id, source: 'provider', providerId: provider.id,
      models: [MODEL], defaultModel: MODEL, isDefault: kind === parentKind });
  }
  if (x1) {
    const codexTool = tools.find(t => t.kind === 'codex' && t.installed);
    result.x1Login = codexTool.login;
    profiles.x1 = await app.invoke('agents.save', { name: name.x1, toolId: codexTool.id, source: 'login', models: [], defaultModel: null, isDefault: parentKind === 'x1' });
  }
  result.nativeTools = tools.filter(t => t.installed && ['claude', 'codex'].includes(t.kind)).map(t => ({ kind: t.kind, version: t.version }));
  const project = await app.invoke('projects.create', { name: 'M14 live ' + scenarioId, aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: cwd }]);
  const title = 'Live parent ' + scenarioId;
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd, title, profileId: profiles[parentKind].id, ...(parentKind === 'x1' ? {} : { model: MODEL }), tier: 'ask' });
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const row = '[data-testid="sidebar-agent-task"][data-task-id="' + task.taskId + '"]';
  await app.waitFor(`Boolean(document.querySelector(${JSON.stringify(row)}))`, 20000, { navigation: true });
  await click(row);
  await app.waitFor('Boolean(document.querySelector(\'[data-testid="agent-delegation-toggle"]\'))', 10000);
  await click('[data-testid="agent-delegation-toggle"]');
  await app.waitFor('document.querySelector(\'[data-testid="agent-delegation-toggle"]\')?.getAttribute("aria-pressed")==="true"', 10000);
  phase = 'real model delegation from natural language';
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText', { text: prompts[base] });
  await click('.agent-task-view button[type="submit"]');
  const expected = base === 'a81' ? 2 : base === 'a80' ? 2 : 1;
  let family;
  await until(async () => {
    await approvePending();
    family = await relations(task.taskId);
    const kids = family.children ?? [];
    const parent = await snapshot(task.taskId);
    return kids.length >= expected && kids.every(k => k.state === 'delivered') && !parent.run?.busy && parent.status !== 'working';
  }, 'children delivered and parent idle', 420000);
  await pause(3000);
  family = await relations(task.taskId);
  const children = [];
  for (const k of family.children) {
    const snap = await snapshot(k.childTaskId);
    const text = snap.items.filter(i => i.type === 'assistant_message').map(i => i.payload.text).join('\n');
    const profile = (await app.invoke('agentTasks.list')).find(t => t.taskId === k.childTaskId)?.selection?.profileId;
    children.push({ title: k.title, access: k.access, workspaceMode: k.workspaceMode, state: k.state, cwd: snap.cwd,
      profile: profile === profiles.claude.id ? 'claude' : profile === profiles.codex.id ? 'codex' : profile === profiles.x1?.id ? 'x1' : profile, branch: k.workspace?.branch ?? null, answer: text.slice(0, 1500) });
  }
  result.children = children;
  phase = 'scenario checks';
  if (base === 'a81') {
    check('two review children', children.length === 2, children.length);
    const cl = children.find(c => c.profile === (x1 ? 'x1' : 'claude')), cx = children.find(c => c.profile === 'codex');
    check('Claude reviewer used and managed as write in the shared directory', cl && cl.access === 'write' && cl.workspaceMode === 'shared', cl && { access: cl.access, mode: cl.workspaceMode });
    check('Codex third-party reviewer stays trusted read in the shared directory', cx && cx.access === 'read' && cx.workspaceMode === 'shared', cx && { access: cx.access, mode: cx.workspaceMode });
    check('both reviews quote the uncommitted marker', children.every(c => c.answer.includes(DESIGN_MARKER)));
    check('design.md unchanged by reviewers', readFileSync(join(cwd, 'design.md'), 'utf8').includes('TYPO_FIELD_NAME'));
  }
  if (base === 'a82') {
    check('default shared directory when the prompt names no mode', children[0].workspaceMode === 'shared' && children[0].cwd === cwd, children[0].workspaceMode);
    const run = spawnSync(process.execPath, ['-e', `const m=require("./gadget-impl.cjs");if(typeof m["${SYMBOL}"]!=="function"||m["${SYMBOL}"]()!=="IMPLEMENTED")process.exit(3);console.log("IMPL_OK")`], { cwd, encoding: 'utf8', timeout: 10000 });
    check('implementation uses the uncommitted symbol and loads in the main directory', run.status === 0, (run.stdout + run.stderr).slice(0, 300));
  }
  if (base === 'a84') {
    const text = readFileSync(join(cwd, 'design.md'), 'utf8');
    check('default shared directory', children[0].workspaceMode === 'shared' && children[0].cwd === cwd, children[0].workspaceMode);
    check('fix applied in the main directory on top of the uncommitted design', text.includes('FIXED_FIELD_NAME') && text.includes(DESIGN_MARKER) && !text.includes('TYPO_FIELD_NAME'), text);
  }
  if (base === 'a83') {
    check('default shared directory in the current tree', children[0].workspaceMode === 'shared' && children[0].cwd === cwd, children[0].workspaceMode);
    const items = (await snapshot(family.children[0].childTaskId)).items.filter(i => i.type === 'command_execution' && JSON.stringify(i.payload).includes('check.test.cjs'));
    result.testCommands = items.map(i => ({ exitCode: i.payload.exitCode, output: String(i.payload.output ?? '').slice(-300) }));
    check('child ran the test against the uncommitted code and it passed (HEAD fails)', items.some(i => i.payload.exitCode === 0 && String(i.payload.output ?? '').includes('pass 1')), result.testCommands);
    check('child reported the passing result', /pass\s*[:：]?\s*1|1\s*(个)?\s*(通过|pass)|全部通过|通过/.test(children[0].answer), children[0].answer.slice(0, 300));
  }
  if (base === 'a80') {
    check('two children', children.length === 2, children.length);
    check('real model chose independent worktrees from natural language', children.every(c => c.workspaceMode === 'worktree' && c.branch), children.map(c => c.workspaceMode));
    const branches = children.map(c => c.branch);
    for (const branch of branches) {
      const files = git('show', '--name-only', '--format=', branch).split('\n').filter(Boolean);
      check('branch ' + branch + ' has a host commit with the feature file and no uncommitted parent file', files.some(f => f.startsWith('feature-')) && !files.includes('unrelated-dirty.txt'), files);
      check('branch ' + branch + ' is based on the original HEAD', git('rev-parse', branch + '^') === head);
    }
  }
  check('no host commit on the user branch', git('rev-parse', 'HEAD') === head);
  if (base !== 'a80') check('no worktree created', git('worktree', 'list').split('\n').length === 1);
  check('all upstream requests succeeded', result.requests.every(r => r.upstreamStatus === 200), result.requests.map(r => r.upstreamStatus));
  if (x1) check('the X1 subscription profile took part', children.some(c => c.profile === 'x1') || parentKind === 'x1', children.map(c => c.profile));
  await app.screenshot(join(out, '20-live-result.png'));
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
  try { if (x1) { const { rmSync } = await import('node:fs'); rmSync(join(home, '.codex', 'auth.json'), { force: true }); result.x1Removed = !existsSync(join(home, '.codex', 'auth.json')); } } catch (error) { result.x1RemoveError = String(error); }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
}
if (result.status !== 'passed' || result.exit?.code !== 0) process.exitCode = 1;
