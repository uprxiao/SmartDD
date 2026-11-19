// M14 A81 / A82 / A84 packaged A/I driver (Claude Code, 2026-11-19).
// Derived from G03 local-collaboration-packaged.mjs (fef791bc6). Local synthetic model only; no R-layer claims.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from './electron-harness.mjs';
import { redirectHome } from './home-redirect-main.mjs';

const BASE = '/private/tmp/willyou-m14-stage6.WRvdST';
const [out, scenarioId, sourceCommit] = process.argv.slice(2);
assert(/^\/private\/tmp\/willyou-m14-stage6\.WRvdST\/g03\/attempt-3\d\d$/.test(out ?? ''), 'Private output path required');
const executable = process.env.M14_ACCEPTANCE_APP;
assert(executable?.startsWith(BASE + '/package/'), 'Explicit private package required');
assert(existsSync(executable), 'Package executable missing');
assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/);
mkdirSync(out);
const root = realpathSync(mkdtempSync(join(out, 'runtime-')));
const home = join(root, 'home');
const userData = join(root, 'data');
for (const dir of [home, userData]) mkdirSync(dir);
const env = { npm_config_cache: join(root, 'npm-cache'), npm_config_offline: 'true', npm_config_audit: 'false',
  npm_config_fund: 'false', npm_config_update_notifier: 'false', HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0', ENABLE_TOOL_SEARCH: 'false' };

// Unique markers prove that a child read the uncommitted working copy, not HEAD.
const DESIGN_MARKER = 'M14_DESIGN_MARKER_Q7ZK';
const SYMBOL = 'M14UniqueGadgetContract';
const [base, variant] = scenarioId.split(':'); // e.g. a82:rev, a84:plain, a84:rev-plain
const reverse = (variant ?? '').includes('rev');
const plain = (variant ?? '').includes('plain');
const parentKind = reverse ? 'codex' : 'claude';
const childKind = reverse ? 'claude' : 'codex';
const catCommand = file => `cat ${file}`;
const configured = {
  a81: reverse
    ? [{ id: 'review-untrusted', profile: 'claude', access: 'read', commands: [catCommand('design.md')], expectMarker: DESIGN_MARKER }]
    : [
      { id: 'review-untrusted', profile: 'claude', access: 'read', commands: [catCommand('design.md')], expectMarker: DESIGN_MARKER },
      { id: 'review-trusted', profile: 'codex', access: 'read', commands: [catCommand('design.md')], expectMarker: DESIGN_MARKER },
    ],
  a82: [{ id: 'implement', profile: childKind, access: 'write', commands: [
    catCommand('gadget-contract.cjs'),
    `printf '%s\\n' 'const contract = require("./gadget-contract.cjs");' 'module.exports = { [contract.${SYMBOL}]: () => "IMPLEMENTED" };' > gadget-impl.cjs`,
  ], expectMarker: SYMBOL }],
  a84: [{ id: 'review-fix', profile: childKind, access: 'write', commands: [
    catCommand('design.md'),
    `sed -i.bak 's/TYPO_FIELD_NAME/FIXED_FIELD_NAME/' design.md && rm -f design.md.bak`,
  ], expectMarker: DESIGN_MARKER }],
};
assert(Object.hasOwn(configured, base), 'Unknown scenario ' + scenarioId);
// A81 also runs in a plain directory (P3).
const scenario = { parent: parentKind, children: configured[base] };
for (const child of scenario.children) {
  child.model = 'fixture-child-' + child.id;
  child.title = 'Acceptance ' + child.id + ' - shared directory review';
  child.answer = 'M14_CHILD_DONE_' + child.id.toUpperCase().replaceAll('-', '_');
  child.sent = 0;
}
const result = { bootstrap: {}, sourceCommit, executable, scenarioId, parentKind, childKind, plain,
  scope: 'Packaged App with native drivers and authenticated private MCP. Local synthetic model responses; fixture pre-writes the parent\'s uncommitted files. No R-layer or X1 claims.',
  observations: [], requests: [], actions: [], approvals: [], status: 'failed' };
let app;
let profileIds;
let parentWaiting = false;
let parentReleasedAt = null;
const planned = new Set();
const received = new Map();
let releaseParent;
const parentGate = new Promise(resolve => { releaseParent = resolve; });
let independentHeld = false;
let releaseIndependent;
const independentGate = new Promise(resolve => { releaseIndependent = resolve; });
const port = 3425;

function record(label, data = {}) { result.observations.push({ label, at: new Date().toISOString(), ...data }); }
function writeEvents(res, kind, model, answer, call) {
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  if (kind === 'claude') {
    event('message_start', { message: { id: 'm' + randomUUID(), type: 'message', role: 'assistant', model,
      content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
    event('content_block_start', { index: 0, content_block: call
      ? { type: 'tool_use', id: 'toolu_' + randomUUID(), name: call.tool.name, input: {} }
      : { type: 'text', text: '' } });
    event('content_block_delta', { index: 0, delta: call
      ? { type: 'input_json_delta', partial_json: JSON.stringify(call.args) }
      : { type: 'text_delta', text: answer } });
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: call ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } });
    event('message_stop', {});
  } else {
    const id = 'r' + randomUUID();
    const item = call ? { id: 'fc' + randomUUID(), type: 'function_call', call_id: 'call' + randomUUID(),
      name: call.tool.name, ...(call.tool.namespace ? { namespace: call.tool.namespace } : {}),
      arguments: JSON.stringify(call.args), status: 'completed' }
      : { id: 'm' + randomUUID(), type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: answer, annotations: [] }] };
    event('response.created', { response: { id, status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
    if (!call) event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: answer });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id, status: 'completed', output: [item],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  }
  res.end();
}
const nativeShell = (kind, tools) => kind === 'claude'
  ? { tool: tools.find(tool => tool.name === 'Bash'), args: command => ({ command }) }
  : { tool: tools.find(tool => tool.name === 'exec_command'), args: command => ({ cmd: command }) };

const server = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fixture-parent' }, { id: 'fixture-independent' }, ...scenario.children.map(child => ({ id: child.model }))] }));
      return;
    }
    const kind = req.url?.includes('messages') ? 'claude' : req.url?.includes('responses') ? 'codex' : null;
    if (req.method !== 'POST' || !kind) { res.writeHead(404); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const input = JSON.stringify(kind === 'claude' ? [payload.system, payload.messages] : [payload.instructions, payload.input]);
    const tools = (payload.tools ?? []).flatMap(tool => tool.type === 'namespace'
      ? (tool.tools ?? []).map(item => ({ ...item, namespace: tool.name })) : [tool]);
    const child = scenario.children.find(item => item.model === payload.model);
    const wake = input.includes('宿主子任务结果通知');
    const row = { model: payload.model, kind, child: child?.id, wake, at: Date.now(), parentBusyAtRequest: parentWaiting && !parentReleasedAt };
    result.requests.push(row);
    if (payload.model === 'fixture-independent') {
      if (input.includes('M14_INDEPENDENT_FIRST') && !independentHeld) { independentHeld = true; await independentGate; }
      if (!res.destroyed) writeEvents(res, kind, payload.model, input.includes('M14_INDEPENDENT_SECOND') ? 'INDEPENDENT_SECOND_OK' : 'INDEPENDENT_FIRST_OK');
      return;
    }
    if (child) {
      if (!received.has(child.id)) received.set(child.id, { at: Date.now(), parentBusy: row.parentBusyAtRequest });
      row.handoffNotice = input.includes('宿主目录交接');
      if (child.sent < child.commands.length) {
        const shell = nativeShell(kind, tools);
        assert(shell.tool, 'Native shell tool unavailable for ' + kind + ' child');
        const command = child.commands[child.sent++];
        row.nativeCommand = command;
        writeEvents(res, kind, payload.model, null, { tool: shell.tool, args: shell.args(command) });
        return;
      }
      const cites = input.includes(child.expectMarker);
      row.citesMarker = cites;
      writeEvents(res, kind, payload.model, `${child.answer} ${cites ? 'CITES_' + child.expectMarker : 'MARKER_NOT_SEEN'}`);
      return;
    }
    if (wake) {
      row.rereadNotice = input.includes('上一位写入者改动的文件');
      row.noticeFiles = ['gadget-impl.cjs', 'design.md'].filter(file => input.includes(file));
      writeEvents(res, kind, payload.model, 'M14_PARENT_WAKE');
      return;
    }
    const reference = kind === 'claude' && [...input.matchAll(/"tool_name":"([^"]*wy_delegate)"/g)][0]?.[1];
    const delegate = tools.find(tool => ((tool.namespace ?? '') + (tool.name ?? '')).includes('wy_delegate'))
      ?? (reference ? { name: reference } : undefined);
    const next = scenario.children.find(item => !planned.has(item.id));
    // The 1214412aa contract requires wy_targets first; the delegate call carries the queried profileRevision.
    const plainInput = input.replaceAll('\\', '');
    if (next && delegate && !plainInput.includes('"targets"')) {
      const targetsTool = tools.find(tool => ((tool.namespace ?? '') + (tool.name ?? '')).includes('wy_targets'));
      assert(targetsTool, 'wy_targets tool unavailable');
      row.queriedTargets = true;
      writeEvents(res, kind, payload.model, null, { tool: targetsTool, args: {} });
      return;
    }
    if (next && delegate) {
      const profileId = profileIds[next.profile];
      const at = plainInput.indexOf('"profileId":"' + profileId + '"');
      assert(at >= 0, 'queried targets do not include ' + next.profile);
      const object = plainInput.slice(plainInput.lastIndexOf('{', at), plainInput.indexOf('}', at) + 1);
      const revision = /"revision":"([^"]+)"/.exec(object)?.[1];
      assert(revision, 'profile revision missing from wy_targets result');
      planned.add(next.id);
      row.scheduledChild = next.id;
      // No workspaceMode: A82/A84 verify that the default is the shared directory.
      writeEvents(res, kind, payload.model, null, { tool: delegate, args: {
        requestKey: base + '-' + next.id, profileId, profileRevision: revision, title: next.title,
        instructions: 'Review or continue the uncommitted work in the current directory and return ' + next.answer,
        model: next.model, access: next.access,
      } });
      return;
    }
    assert(!next, 'Native delegate tool not available for parent');
    if (!parentWaiting) { parentWaiting = true; await parentGate; }
    if (!res.destroyed) writeEvents(res, kind, payload.model, 'M14_PARENT_FINISHED');
  } catch (error) {
    result.serverError = String(error.stack ?? error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    if (await fn()) return;
    await pause(150);
  }
  throw Error('Timed out: ' + label);
}
const selectorExpr = selector => `document.querySelector(${JSON.stringify(selector)})`;
async function click(selector, text = null) {
  const query = text ? `[...document.querySelectorAll(${JSON.stringify(selector)})].filter(item => item.innerText.includes(${JSON.stringify(text)}))`
    : `[...document.querySelectorAll(${JSON.stringify(selector)})]`;
  const point = await app.evaluate(`(() => {
    const nodes = ${query};
    const node = nodes.length === 1 && nodes[0];
    if (!node || node.disabled) return null;
    node.scrollIntoView({block:'nearest',inline:'nearest'});
    const rect=node.getBoundingClientRect(), x=rect.x+rect.width/2, y=rect.y+rect.height/2;
    return rect.width&&rect.height&&node.contains(document.elementFromPoint(x,y))?{x,y}:null;
  })()`);
  assert(point, 'Expected visible unique control: ' + selector + ' ' + (text ?? ''));
  for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  result.actions.push({ selector, text, ...point });
}
// Approve only command requests whose text contains one of this run's fixture commands.
async function approveFixtureCommands() {
  const panel = await app.evaluate('document.querySelector(".agent-request")?.innerText ?? ""');
  if (!panel) return;
  const markers = scenario.children.flatMap(child => child.commands.map(command => command.split(' ').slice(0, 2).join(' ')));
  if (!markers.some(marker => panel.includes(marker))) return;
  const option = await app.evaluate(`(() => { const o=[...document.querySelectorAll('.agent-request [role="option"]')].find(n=>/^(批准|批准一次|允许)/.test(n.getAttribute('aria-label')??'')); return o?.getAttribute('aria-label') ?? null; })()`);
  if (!option) return;
  await click(`.agent-request [role="option"][aria-label="${option}"]`);
  await click('.agent-request .agent-confirm-choice');
  result.approvals.push({ option, panel: panel.slice(0, 300), at: new Date().toISOString() });
  await pause(300);
}
async function openLineage() {
  await app.waitFor(`Boolean(${selectorExpr('.agent-lineage-toggle')})`, 10000);
  if (!await app.evaluate('Boolean(document.querySelector(".agent-lineage"))')) await click('.agent-lineage-toggle');
  await app.waitFor('Boolean(document.querySelector(".agent-lineage"))', 10000);
}

let phase = 'fixture setup';
try {
  const cwd = join(root, 'work');
  mkdirSync(cwd);
  const designFile = join(cwd, 'design.md');
  writeFileSync(designFile, '# Committed design\nTYPO_FIELD_NAME baseline\n');
  if (!plain) {
    git(cwd, 'init', '-qb', 'main');
    git(cwd, 'add', '-A');
    git(cwd, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'frozen baseline');
    git(cwd, 'config', 'user.name', 'Fixture'); git(cwd, 'config', 'user.email', 'fixture@example.invalid'); git(cwd, 'config', 'commit.gpgsign', 'false');
  }
  const head = plain ? null : git(cwd, 'rev-parse', 'HEAD');
  const commitCount = plain ? null : git(cwd, 'rev-list', '--count', 'HEAD');
  // Parent's uncommitted work (fixture-written; the real-model layer covers an Agent writing it).
  writeFileSync(designFile, `# Uncommitted design\nMarker: ${DESIGN_MARKER}\nField: TYPO_FIELD_NAME\n`);
  if (base === 'a82') writeFileSync(join(cwd, 'gadget-contract.cjs'), `module.exports = { ${SYMBOL}: "${SYMBOL}" };\n`);
  result.fixture = { cwd, head, plain, uncommitted: plain ? 'plain directory' : git(cwd, 'status', '--porcelain') };

  phase = 'native packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => Object.assign(result.bootstrap, await redirectHome({ ...info, home })) });
  result.pid = app.processId;
  const appIdentity = await app.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(appIdentity, [true, userData, home, home, executable, app.processId]);
  result.identity = appIdentity;
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) {
    const custom = await app.invoke('agents.customToolPath', 'claude', process.env.M14_SMOKE_CLAUDE);
    assert(custom.tool?.installed, 'Explicit Claude tool must be installed');
    result.explicitClaude = { version: custom.tool.version, path: custom.tool.customPath };
  }
  const tools = await app.invoke('agents.tools');
  result.nativeTools = tools.filter(t => ['codex', 'claude'].includes(t.kind) && t.installed).map(t => ({ kind: t.kind, version: t.version }));
  const models = ['fixture-parent', 'fixture-independent', ...scenario.children.map(child => child.model)];
  const provider = await app.invoke('agents.saveProvider', { name: 'Synthetic loopback fixture', preset: 'magpie',
    endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425/' }, models: models.map(id => ({ id, name: id })) });
  const profiles = {};
  for (const kind of ['codex', 'claude']) {
    const tool = tools.find(t => t.kind === kind && t.installed);
    assert(tool, kind + ' CLI installed');
    profiles[kind] = await app.invoke('agents.save', { name: 'Fixture ' + kind, toolId: tool.id, source: 'provider',
      providerId: provider.id, models, defaultModel: 'fixture-parent', isDefault: kind === scenario.parent });
  }
  profileIds = Object.fromEntries(Object.entries(profiles).map(([kind, profile]) => [kind, profile.id]));

  phase = 'fixture project, parent and unrelated task';
  const project = await app.invoke('projects.create', { name: 'M14 shared ' + scenarioId, aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: cwd }]);
  const title = 'Acceptance parent ' + scenarioId;
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd,
    title, profileId: profileIds[scenario.parent], model: 'fixture-parent', tier: 'ask' });
  const independent = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd,
    title: 'M14 isolated independent task', profileId: profileIds.codex, model: 'fixture-independent', tier: 'ask' });
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const taskRow = id => '[data-testid="sidebar-agent-task"][data-task-id="' + id + '"]';
  await app.waitFor('Boolean(' + selectorExpr(taskRow(task.taskId)) + ')', 20000, { navigation: true });
  async function openTask(id, name) {
    await click(taskRow(id));
    await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent === ' + JSON.stringify(name), 10000);
  }
  async function submitText(message) {
    await app.waitFor('Boolean(document.querySelector(".agent-task-view textarea"))', 10000);
    await click('.agent-task-view textarea');
    await app.cdp('Input.insertText', { text: message });
    await click('.agent-task-view button[type="submit"]');
  }
  await openTask(independent.taskId, 'M14 isolated independent task');
  await submitText('M14_INDEPENDENT_FIRST');
  await until(async () => independentHeld && (await snapshot(independent.taskId)).run?.busy, 'same-root independent native round held');
  const independentRun = (await snapshot(independent.taskId)).run?.runId;

  await openTask(task.taskId, title);
  const toggle = '[data-testid="agent-delegation-toggle"]';
  await app.waitFor('Boolean(' + selectorExpr(toggle) + ')', 10000);
  await click(toggle);
  await app.waitFor(selectorExpr(toggle) + "?.getAttribute('aria-pressed')==='true'", 10000);

  phase = 'CDP input and real MCP delegation';
  const prompts = {
    a81: 'Ask reviewers to check the uncommitted design.md without changing it.',
    a82: 'Implement a module on top of the uncommitted gadget-contract.cjs interface.',
    a84: 'Review the uncommitted design.md and fix the problems directly.',
  };
  await submitText(prompts[base]);
  let family;
  await until(async () => {
    family = await relations(task.taskId);
    const snap = await snapshot(task.taskId);
    const error = snap.items.find(item => item.type === 'error');
    if (error) throw Error('Native parent error: ' + JSON.stringify(error.payload));
    return parentWaiting && family.children.length === scenario.children.length;
  }, 'native parent issues all MCP delegation calls');
  const byTitle = () => Object.fromEntries(scenario.children.map(child => [child.id, family.children.find(row => row.title === child.title)]));
  let children = byTitle();
  const refresh = async () => { family = await relations(task.taskId); children = byTitle(); return children; };
  result.parentTaskId = task.taskId;
  result.childTaskIds = Object.fromEntries(Object.entries(children).map(([id, row]) => [id, row.childTaskId]));
  await openLineage();

  phase = 'mode routing while the parent turn is still active';
  // Trusted read runs beside the active parent; every write (including untrusted read) waits in the shared queue.
  const trusted = scenario.children.filter(child => child.access === 'read' && child.profile === 'codex');
  const queued = scenario.children.filter(child => !trusted.includes(child));
  if (trusted.length) {
    await until(async () => { await refresh(); return trusted.every(child => received.has(child.id)); }, 'trusted read child starts during parent turn', 45000);
  }
  await pause(1500);
  await refresh();
  assert((await snapshot(task.taskId)).run?.busy, 'parent turn must still be active');
  for (const child of queued) {
    assert.equal(children[child.id].workspaceMode, 'shared', child.id + ' must use the shared directory');
    assert.equal(children[child.id].access, 'write', child.id + ' untrusted or write child is managed as write');
    assert.equal(children[child.id].state, 'queued', child.id + ' waits for the parent boundary');
    assert(!received.has(child.id), child.id + ' must not start before the parent turn ends');
  }
  for (const child of trusted) {
    assert.equal(children[child.id].access, 'read');
    assert.equal(children[child.id].workspaceMode, 'shared');
    assert(received.get(child.id).parentBusy, 'trusted read started while the parent turn was active');
  }
  const lineageBefore = await app.evaluate('document.querySelector(".agent-lineage")?.innerText ?? ""');
  if (queued.length) assert(lineageBefore.includes('写入队列'), 'Lineage shows the shared write queue label');
  if (queued.length && process.env.M14_EXPECT_HOLDER === '1') {
    const queueSection = lineageBefore.slice(lineageBefore.indexOf('目录写入队列'));
    assert(!queueSection.includes('当前无人持有写入权'), 'Write queue must not claim nobody is writing while the parent still holds the directory');
    assert(queueSection.includes(title) && queueSection.includes('正在写入'), 'Write queue shows the delegating parent as the active writer');
  }
  if (trusted.length) assert(lineageBefore.includes('只读'), 'Lineage shows the read-only label');
  assert((await snapshot(independent.taskId)).run?.busy, 'unrelated same-root task still active');
  result.routing = { queued: queued.map(child => child.id), trusted: trusted.map(child => child.id), lineage: lineageBefore.slice(0, 1200) };
  await app.screenshot(join(out, '10-routing-while-parent-active.png'));

  phase = 'release parent; shared children run after the boundary';
  parentReleasedAt = Date.now();
  releaseParent();
  await until(async () => {
    await approveFixtureCommands();
    await refresh();
    return scenario.children.every(child => children[child.id].state === 'delivered');
  }, 'all children deliver results to the original parent', 120000);
  for (const child of queued) assert(received.get(child.id).at >= parentReleasedAt, child.id + ' started only after the parent boundary');

  phase = 'verify child behaviour on disk and in the timeline';
  const childResults = {};
  for (const child of scenario.children) {
    const childSnap = await snapshot(children[child.id].childTaskId);
    assert.equal(childSnap.cwd, cwd, child.id + ' ran in the shared directory');
    const answer = childSnap.items.find(i => i.type === 'assistant_message' && i.payload.text?.includes(child.answer));
    assert(answer, child.id + ' answer missing');
    assert(answer.payload.text.includes('CITES_' + child.expectMarker), child.id + ' must have read the uncommitted marker');
    const commands = childSnap.items.filter(i => i.type === 'command_execution').map(i => JSON.stringify(i.payload).slice(0, 300));
    childResults[child.id] = { cwd: childSnap.cwd, answer: answer.payload.text, commands };
  }
  if (base === 'a82') {
    const check = spawnSync(process.execPath, ['-e', `const m=require("./gadget-impl.cjs");if(typeof m["${SYMBOL}"]!=="function"||m["${SYMBOL}"]()!=="IMPLEMENTED")process.exit(3);console.log("IMPL_OK")`], { cwd, encoding: 'utf8', timeout: 10000 });
    assert.equal(check.status, 0, 'implementation must load against the uncommitted contract: ' + check.stderr);
    result.buildCheck = { status: check.status, stdout: check.stdout.trim() };
  }
  if (base === 'a84') {
    const text = readFileSync(designFile, 'utf8');
    assert(text.includes('FIXED_FIELD_NAME') && text.includes(DESIGN_MARKER), 'fix must land in the main directory on top of the uncommitted design');
    const page = await app.invoke('agentTasks.changePage', children['review-fix'].childTaskId);
    const changed = page.items.flatMap(item => item.files?.map(file => file.path) ?? []);
    assert(changed.includes('design.md'), 'diff for design.md must be attributed to the child interval');
    result.diffAttribution = { childTurns: page.items.map(item => ({ status: item.status, files: item.files?.map(f => f.path) })) };
  }
  if (base === 'a81') assert(readFileSync(designFile, 'utf8').includes('TYPO_FIELD_NAME'), 'reviewers must not change design.md');
  if (!plain) {
    assert.equal(git(cwd, 'rev-parse', 'HEAD'), head, 'no host commit on the user branch');
    assert.equal(git(cwd, 'rev-list', '--count', 'HEAD'), commitCount);
    assert.equal(git(cwd, 'worktree', 'list').split('\n').length, 1, 'no worktree created');
  }
  result.children = childResults;

  phase = 'parent wake and re-read notice';
  await until(async () => answerPresent(await snapshot(task.taskId), 'M14_PARENT_WAKE'), 'parent wakes on child results', 60000);
  const wakes = result.requests.filter(row => row.wake && row.model === 'fixture-parent');
  if (base === 'a82' || base === 'a84') {
    const expected = base === 'a82' ? 'gadget-impl.cjs' : 'design.md';
    assert(wakes.some(row => row.rereadNotice && row.noticeFiles.includes(expected)), 'parent resume must carry the re-read notice listing ' + expected);
  }
  result.wakes = wakes.map(({ rereadNotice, noticeFiles }) => ({ rereadNotice, noticeFiles }));
  if (process.env.M14_EXPECT_RESULT_TEXT === '1') {
    const cards = await app.evaluate('[...document.querySelectorAll(".agent-child-result")].map(n => n.innerText).join("\\n")');
    assert(cards.includes('已完成') && !cards.includes('{"text"') && !/· completed/.test(cards), 'result cards show the readable status and message text');
    for (const child of scenario.children) assert(cards.includes(child.answer), 'result card shows ' + child.answer);
    result.resultCards = cards.slice(0, 1500);
  }
  await until(async () => !(await snapshot(task.taskId)).run?.busy, 'parent idle after wake', 30000);
  await app.screenshot(join(out, '20-results-delivered.png'));

  phase = 'unrelated task unaffected';
  assert.equal((await snapshot(independent.taskId)).run?.runId, independentRun, 'unrelated task kept its native run');
  releaseIndependent();
  await until(async () => answerPresent(await snapshot(independent.taskId), 'INDEPENDENT_FIRST_OK'), 'unrelated first round completes');
  record('A/I passed', { scenarioId });
  assert.deepEqual(app.rendererErrors, []);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,8000)');
    await app.screenshot(join(out, '99-failure.png'));
  } catch { /* target already exited */ }
} finally {
  releaseParent(); releaseIndependent();
  if (app) {
    try {
      const tasks = await app.invoke('agentTasks.list');
      result.beforeQuit = tasks.map(({ taskId, title, status, parentTaskId }) => ({ taskId, title, status, parentTaskId }));
      const active = tasks.filter(t => (t.status === 'working' || t.status === 'waiting') && !t.parentTaskId);
      if (active.length) {
        result.cleanupMadeIdle = [];
        for (const t of active) { await app.invoke('agentTasks.stop', t.taskId, true); result.cleanupMadeIdle.push(t.title); }
        const deadline = Date.now() + 15000;
        while (Date.now() < deadline && (await app.invoke('agentTasks.list')).some(t => t.status === 'working' || t.status === 'waiting')) await pause(100);
      }
    } catch (error) { result.quitProbeError = String(error); }
    try {
      await app.mainEvaluate(`(() => { const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if (E.app.getPath('userData')!==${JSON.stringify(userData)}) throw Error('Wrong App');
        setTimeout(() => E.app.quit(),50); return true; })()`);
    } catch (error) { result.quitRpcError = String(error); }
    try { result.exit = await app.waitForExit(25000); } catch (error) {
      result.exitError = String(error);
      try { result.forcedExit = await app.crash(); } catch (forcedError) { result.forceError = String(forcedError); }
    }
    result.rendererErrors = app.rendererErrors;
    if (result.status === 'passed' && result.cleanupMadeIdle?.length) { result.status = 'partial'; result.cleanupRequired = true; }
    writeFileSync(join(out, 'app.log'), app.logs(), { mode: 0o600 });
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
}
if (result.status !== 'passed' || result.exit?.code !== 0 || result.exit?.signal || result.rendererErrors?.length) process.exitCode = 1;
