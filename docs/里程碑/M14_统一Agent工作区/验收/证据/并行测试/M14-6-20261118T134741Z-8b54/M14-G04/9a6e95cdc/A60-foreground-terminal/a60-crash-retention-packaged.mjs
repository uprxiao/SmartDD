import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { openElectron, pause } from './helpers/scripts/lib/electron-harness.mjs';
import { redirectHome } from './helpers/scripts/applications/fixtures/home-redirect-main.mjs';

const [out, scenarioId, sourceCommit, expectedAsar] = process.argv.slice(2);
assert.match(out,/^\/private\/tmp\/willyou-m14-stage6\.[A-Za-z0-9]{6}\/g04\/attempt-\d{3}$/);
const packageRoot=out.slice(0,out.indexOf('/g04/'));
const executable = process.env.M14_ACCEPTANCE_APP;
assert.equal(executable,join(packageRoot,'package/mac-arm64/WillYou.app/Contents/MacOS/WillYou'));
assert.equal(executable,realpathSync(executable));
assert.equal(realpathSync(process.cwd()),join(packageRoot,'source'));
assert.equal(execFileSync('/usr/bin/git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceCommit);
const asar=createHash('sha256').update(readFileSync(join(dirname(executable),'../Resources/app.asar'))).digest('hex');
assert.equal(asar,expectedAsar);
assert.equal(scenarioId,'crash');
for (const key of ['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','CLAUDE_CODE_OAUTH_TOKEN','CODEX_API_KEY','OPENAI_API_KEY','DEEPSEEK_API_KEY'])
  assert(!process.env[key],'Test instance cannot use external model credentials: '+key);
assert(existsSync(executable), 'Package executable missing');
assert.match(sourceCommit ?? '', /^[a-f0-9]{40}$/);
assert(out?.startsWith(join(packageRoot,'g04','attempt-')));
mkdirSync(out);
const root = realpathSync(mkdtempSync(join(out, 'runtime-')));
const home = join(root, 'home');
const userData = join(root, 'data');
for (const dir of [home, userData]) mkdirSync(dir);
const env = { npm_config_cache: join(root, 'npm-cache'), npm_config_offline:'true', npm_config_audit:'false',
  npm_config_fund:'false', npm_config_update_notifier:'false', HOME: home, CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
  XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local/share'), XDG_CACHE_HOME: join(home, '.cache'),
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_TERMINAL_PROMPT: '0' };

const configuredScenarios = {
  crash: [],
  a80: [
    { id: 'feature-x', access: 'write', workspaceMode: 'worktree', command: "printf '%s\\n' 'FEATURE_X' > feature-x.txt" },
    { id: 'feature-y', access: 'write', workspaceMode: 'worktree', command: "printf '%s\\n' 'FEATURE_Y' > feature-y.txt" },
  ],
  a83: [{ id: 'test-dirty', access: 'write', command: 'pwd; node --test check.test.cjs', expected: 'DIRTY_TEST_PASSES' }],
  a27: [
    { id: 'queued-writer', access: 'write' },
    { id: 'reader-x', access: 'read' },
    { id: 'reader-y', access: 'read' },
  ],
};
assert(Object.hasOwn(configuredScenarios, scenarioId));
const scenario = { parent:'claude', children:configuredScenarios[scenarioId] };
for (const value of scenario.children) value.profile = 'codex';
const sentNativeCommand = new Set();
let independentHeld = false;
let releaseIndependent;
const independentGate = new Promise(resolve => { releaseIndependent = resolve; });
let parentCommandSent = false;
let parentWriteResultSeen = false;
for (const value of scenario.children) {
  value.model = 'fixture-child-' + value.id;
  value.title = 'Acceptance ' + value.id + ' - isolated delegation workspace';
  value.answer = 'M14_CHILD_DONE_' + value.id.toUpperCase();
}
const hookResult = {};
const result = { bootstrap:hookResult, sourceCommit, asar, executable, scenarioId,
  scope: 'Packaged App with native drivers and authenticated private MCP. Local synthetic responses. No R-layer claims.',
  observations: [], requests: [], actions: [], status: 'failed' };
let app;
let profileIds;
let parentWaiting = false;
const planned = new Set();
const received = new Set();
const childGates = new Map();
let releaseParent;
const parentGate = new Promise(resolve => { releaseParent = resolve; });
for (const child of scenario.children) {
  let release;
  const promise = new Promise(resolve => { release = resolve; });
  childGates.set(child.id, { promise, release });
}
if (process.env.M14_G03_DISABLE_TOOL_SEARCH === '1') env.ENABLE_TOOL_SEARCH = 'false';
let toolSearchAttempts=0;
const initialMarker='M14_A27_ORIGINAL_UNFINISHED';
const queuedMarker='M14_A27_DEFERRED_WRITE';
const question='G03 old native request before restart';
let firstModelWaiting=false;
let explicitDispatch=false;
let releasedNativeGate=false;
let openQuestion;
let completeNewTurn;
const askGate=new Promise(resolve=>{openQuestion=resolve;});
const finishGate=new Promise(resolve=>{completeNewTurn=resolve;});
function databaseSummary(dbPath, taskId) {
  const query = [
    'import json,sqlite3,sys,pathlib',
    'p=sys.argv[1]; t=sys.argv[2]',
    'd=sqlite3.connect(pathlib.Path(p).as_uri()+"?mode=ro",uri=True)',
    'd.row_factory=sqlite3.Row',
    'def rows(query): return [dict(r) for r in d.execute(query,(t,))]',
    'print(json.dumps(dict(runs=rows("select run_id,pid,process_started_at,owner_pid,owner_started_at,owner_instance_id,state,error_code from capability_runs where task_id=? order by started_at"), turns=rows("select turn_id,run_id,source_kind,status,error_code,started_at,ended_at from agent_turns where task_id=? order by accepted_at"), requests=rows("select request_id,status from agent_requests where task_id=?")),ensure_ascii=False))',
  ].join('\n');
  return JSON.parse(execFileSync('python3',['-c',query,dbPath,taskId],{ encoding:'utf8',timeout:10000 }));
}
function processExists(pid) {
  if(!Number.isSafeInteger(pid)||pid<=1) throw Error('Bad specific PID for liveness check');
  try { process.kill(pid,0); return true; }
  catch(error) { if(error.code==='ESRCH') return false; throw error; }
}
const port = 3425;

function record(label, data = {}) {
  result.observations.push({ label, at: new Date().toISOString(), ...data });
}
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
const server = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'fixture-parent' }, ...scenario.children.map(child => ({ id: child.model }))] }));
      return;
    }
    const kind = req.url?.includes('messages') ? 'claude' : req.url?.includes('responses') ? 'codex' : null;
    if (req.method !== 'POST' || !kind) { res.writeHead(404); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    const input = JSON.stringify(kind === 'claude' ? payload.messages : payload.input);
    const child = scenario.children.find(item => item.model === payload.model);
    const wake = input.includes('宿主子任务结果通知');
    const row = { model: payload.model, kind, child: child?.id, wake, at: Date.now() };
    result.requests.push(row);
    if(scenarioId==='crash') {
      const tools=payload.tools??[];
      if(input.includes(queuedMarker)) {
        row.sawQueuedUserInput=true;
        row.explicitDispatch=explicitDispatch;
        if(!explicitDispatch) {
          result.unexpectedAutomaticQueuedInput=true;
          if(!res.destroyed) writeEvents(res,kind,payload.model,'UNEXPECTED_AUTOMATIC_INPUT');
          return;
        }
        await finishGate;
        if(!res.destroyed) writeEvents(res,kind,payload.model,'A27_POST_RESTART_ANSWER');
        return;
      }
      if(!firstModelWaiting && input.includes(initialMarker)) {
        firstModelWaiting=true;
        await askGate;
        const tool=tools.find(item=>item.name==='AskUserQuestion');
        assert(tool,'Real Claude AskUserQuestion unavailable');
        row.awaitedNativeQuestion=true;
        if(!res.destroyed) writeEvents(res,kind,payload.model,null,{tool,args:{questions:[{
          question,header:'G03 restart',options:[{label:'APPROVE_TEST_OPTION',description:'Only for stale reply rejection'},
           {label:'REJECT_TEST_OPTION',description:'Alternative for isolated data'}],multiSelect:false,
        }]}});
        return;
      }
      if(!res.destroyed) writeEvents(res,kind,payload.model,'UNEXPECTED_OLD_ROUND_CONTINUED');
      return;
    }
    if (payload.model === 'fixture-independent') {
      if (input.includes('M14_INDEPENDENT_FIRST') && !independentHeld) {
        independentHeld = true;
        await independentGate;
      }
      if (!res.destroyed) writeEvents(res,kind,payload.model,input.includes('M14_INDEPENDENT_SECOND') ? 'INDEPENDENT_SECOND_OK' : 'INDEPENDENT_FIRST_OK');
      return;
    }
    if (child) {
      received.add(child.id);
      row.reReadPrompt = input.includes('修改前重新读取');
      await childGates.get(child.id).promise;

      if (child.command && !sentNativeCommand.has(child.id)) {
        const tool = (payload.tools ?? []).find(item => item.name === 'exec_command');
        assert(tool, 'Original Codex exec_command unavailable');
        sentNativeCommand.add(child.id);
        row.nativeCommand = child.command;
        writeEvents(res, kind, payload.model, null, { tool, args: { cmd:child.command } });
        return;
      }
      if (child.expected) {
        assert(input.includes('# pass 1') && input.includes(child.expected), 'Expected successful dirty-only test in actual native tool result');
        row.nativeTestPassed = true;
      }
      if (!res.destroyed) writeEvents(res, kind, payload.model, child.answer);
      return;
    }
    if (wake) { writeEvents(res, kind, payload.model, 'M14_PARENT_WAKE'); return; }
    const tools = (payload.tools ?? []).flatMap(tool => tool.type === 'namespace'
      ? (tool.tools ?? []).map(item => ({ ...item, namespace: tool.name })) : [tool]);
    const reference = kind === 'claude' && [...input.matchAll(/"tool_name":"([^"]*wy_delegate)"/g)][0]?.[1];
    const delegate = tools.find(tool => ((tool.namespace ?? '') + (tool.name ?? '')).includes('wy_delegate'))
      ?? (reference ? { name: reference } : undefined);
    const next = scenario.children.find(item => !planned.has(item.id));
    if (next && delegate) {
      planned.add(next.id);
      row.scheduledChild = next.id;
      writeEvents(res, kind, payload.model, null, { tool: delegate, args: {
        requestKey: scenarioId + '-' + next.id, profileId: profileIds[next.profile], title: next.title,
        instructions: 'Return the isolated workspace acceptance marker ' + next.answer,
        model: next.model, access: next.access, ...(next.workspaceMode ? { workspaceMode: next.workspaceMode } : {}),
      } });
      return;
    }
    const search = kind === 'claude' && tools.find(tool => tool.name === 'ToolSearch');
    if (next && search && ++toolSearchAttempts <= 2) {
      row.search = true;
      writeEvents(res, kind, payload.model, null, { tool: search, args: { query: 'wy_delegate', max_results: 5 } });
      return;
    }
    assert(!next, 'Native delegate tool not available');
    if (scenarioId === 'a80' && !parentCommandSent) {
      const bash = tools.find(tool => tool.name === 'Bash');
      assert(bash, 'Original Claude Bash tool unavailable');
      parentCommandSent = true;
      await until(()=>scenario.children.every(child=>received.has(child.id)), 'both native worktree children started before parent file edit');
      row.nativeCommand = 'write parent file';
      row.bothChildrenStarted = true;
      writeEvents(res,kind,payload.model,null,{tool:bash,args:{command:"printf '%s\\n' 'PARENT_NATIVE_WRITE' > parent-change.txt; printf '%s\\n' 'PARENT_WRITE_ACK'" }});
      return;
    }
    if (input.includes('PARENT_WRITE_ACK') && input.includes('tool_result')) parentWriteResultSeen = true;
    if (!parentWaiting) {
      parentWaiting = true;
      await parentGate;
    }
    if (!res.destroyed) writeEvents(res, kind, payload.model, 'M14_PARENT_FINISHED');
  } catch (error) {
    result.serverError = String(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], {
  env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
}).trim();
const snapshot = taskId => app.invoke('agentTasks.snapshot', taskId);
const relations = taskId => app.invoke('agentTasks.relations', taskId);
const answerPresent = (snap, answer) => snap.items.some(i => i.type === 'assistant_message' && i.payload.text?.includes(answer));
async function until(fn, label, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (result.serverError) throw Error(result.serverError);
    if (await fn()) return;
    await pause(100);
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
  for (const type of ['mousePressed', 'mouseReleased']) {
    await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  }
  result.actions.push({ selector, text, ...point });
}
async function openLineage() {
  await app.waitFor(`Boolean(${selectorExpr('.agent-lineage-toggle')})`, 10000);
  if (!await app.evaluate('Boolean(document.querySelector(".agent-lineage"))')) await click('.agent-lineage-toggle');
  await app.waitFor('Boolean(document.querySelector(".agent-lineage"))', 10000);
}
async function verifyExactApp(handle) {
  const identity=await handle.mainEvaluate(`(() => {
    const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
    return [E.app.isPackaged,E.app.getPath('userData'),E.app.getPath('home'),process.env.HOME,process.execPath,process.pid];
  })()`);
  assert.deepEqual(identity, [true, userData, home, home, executable, handle.processId]);
  assert.equal(realpathSync(executable),executable);
  assert(realpathSync(userData).startsWith(join(packageRoot,'g04','attempt-')));
  return identity;
}
let phase = 'fixture setup';
try {

  const cwd = join(root, 'work');
  mkdirSync(cwd);
  const markerFile = join(cwd, 'architecture-fixture.txt');
  writeFileSync(markerFile, 'HEAD_ISOLATED_FIXTURE\n');
  git(cwd, 'init', '-qb', 'main');
  if (scenarioId === 'a83') {
    writeFileSync(join(cwd,'subject.cjs'), 'module.exports = "BAD_HEAD";\n');
    writeFileSync(join(cwd,'check.test.cjs'), [
      'const {test} = require("node:test");',
      'const assert = require("node:assert/strict");',
      'test("DIRTY_TEST_PASSES", () => assert.equal(require("./subject.cjs"), "DIRTY_FIXTURE"));',
      '',
    ].join('\n'));
  }
  git(cwd,'add','-A');
  git(cwd,'-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','-qm','frozen baseline');
  git(cwd,'config','user.name','Fixture');
  git(cwd,'config','user.email','fixture@example.invalid');
  git(cwd,'config','commit.gpgsign','false');
  const head = git(cwd,'rev-parse','HEAD');
  writeFileSync(markerFile, 'UNCOMMITTED_ISOLATED_FIXTURE\n');
  if (scenarioId === 'a83') {
    const headFixture = join(root,'frozen-head');
    git(cwd,'clone','-q','--no-hardlinks',cwd,headFixture);
    writeFileSync(join(cwd,'subject.cjs'), 'module.exports = "DIRTY_FIXTURE";\n');
    const checks = [headFixture,cwd].map(checkCwd=>{
      const command = spawnSync(process.execPath,['--test','check.test.cjs'],{cwd:checkCwd,env:{...process.env,...env},encoding:'utf8',timeout:10000});
      assert(!command.error,command.error?.message);
      return { cwd:checkCwd, status:command.status, stdout:command.stdout };
    });
    assert.deepEqual(checks.map(check=>check.status),[1,0]);
    assert(checks.every(check=>check.stdout.includes('DIRTY_TEST_PASSES')));
    result.workspaceComparison = checks;
  }
  phase = 'native packaged startup';
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  app = await openElectron({ executable, userData, env, inspectMain: true, startupMainHook: async info => Object.assign(hookResult,await redirectHome({ ...info,home })) });
  result.pid = app.processId;
  result.identity=await verifyExactApp(app);
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  if (process.env.M14_SMOKE_CLAUDE) {
    const custom = await app.invoke('agents.customToolPath','claude',process.env.M14_SMOKE_CLAUDE);
    assert(custom.tool?.installed && custom.tool.version === '2.1.326', 'Explicit verified Claude tool must be installed');
    assert.equal(custom.tool.customPath,process.env.M14_SMOKE_CLAUDE);
    result.explicitClaude = { version:custom.tool.version, path:custom.tool.customPath };
  }
  const tools = await app.invoke('agents.tools');
  result.nativeTools = tools.filter(t => ['codex', 'claude'].includes(t.kind) && t.installed)
    .map(t => ({ kind: t.kind, version: t.version }));
  const models = ['fixture-parent', 'fixture-independent', ...scenario.children.map(child => child.model)];
  const provider = await app.invoke('agents.saveProvider', { name: 'Synthetic loopback fixture', preset: 'magpie',
    endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425/' },
    models: models.map(id => ({ id, name: id })) });
  const profiles = {};
  for (const kind of ['codex', 'claude']) {
    const tool = tools.find(t => t.kind === kind && t.installed);
    assert(tool, kind + ' CLI installed');
    profiles[kind] = await app.invoke('agents.save', { name: 'Fixture ' + kind, toolId: tool.id, source: 'provider',
      providerId: provider.id, models, defaultModel: 'fixture-parent', isDefault: kind === scenario.parent });
  }
  profileIds = Object.fromEntries(Object.entries(profiles).map(([kind, profile]) => [kind, profile.id]));
  phase = 'fixture project and parent creation';
  const project = await app.invoke('projects.create', { name: 'M14 G03 ' + scenarioId, aliases: [], description: '', rulesPath: null },
    [{ label: 'work', path: cwd }]);
  const title = 'Acceptance parent ' + scenarioId;
  const task = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd,
    title, profileId: profileIds[scenario.parent], model: 'fixture-parent', tier: 'ask' });

  const independent = scenarioId === 'a80' || scenarioId === 'a27' ? await app.invoke('agentTasks.create',{
    projectId:project.id,dirId:project.dirs[0].id,cwd,title:'M14 isolated independent task',profileId:profileIds.codex,
    model:'fixture-independent',tier:'ask',
  }) : null;
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
  const taskRow = id => '[data-testid="sidebar-agent-task"][data-task-id="' + id + '"]';
  await app.waitFor('Boolean(' + selectorExpr(taskRow(task.taskId)) + ')',20000,{navigation:true});
  async function openTask(id, name) {
    await click(taskRow(id));
    await app.waitFor('document.querySelector(".agent-task-head h1")?.textContent === ' + JSON.stringify(name),10000);
  }
  async function submitText(message) {
    await app.waitFor('Boolean(document.querySelector(".agent-task-view textarea"))',10000);
    await click('.agent-task-view textarea');
    await app.cdp('Input.insertText',{text:message});
    await click('.agent-task-view button[type="submit"]');
  }
  async function approveFixtureCommand(commandMarker) {
    const panel = await app.evaluate('document.querySelector(".agent-request")?.innerText');
    if (!panel?.includes(commandMarker)) return;
    const selector = '.agent-request [role="option"][aria-label="批准"],.agent-request [role="option"][aria-label="批准一次"]';
    await click(selector);
    await click('.agent-request .agent-confirm-choice');
    await app.waitFor('!document.querySelector(".agent-request")?.innerText.includes(' + JSON.stringify(commandMarker) + ')',10000);
  }

  assert.equal(scenarioId,'crash','This driver only handles a crash-restart fixture');
  result.parentTaskId=task.taskId;
  const dbPath=join(userData,'smartdd.db');
  const deferredWritePath=join(cwd,'deferred-crash-write.txt');
  phase='start native Claude and queue user input from normal UI';
  await openTask(task.taskId,title);
  await submitText(initialMarker+' Ask a native question after the second user input is queued.');
  await until(async()=>firstModelWaiting&&(await snapshot(task.taskId)).run?.busy,'original real Claude turn waits at fixture model boundary');
  await submitText(queuedMarker+' In the isolated fixture only, request to create deferred-crash-write.txt.');
  let beforeQueue;
  await until(async()=>{
    const snap=await snapshot(task.taskId);
    beforeQueue=snap.queued.find(turn=>turn.text.includes(queuedMarker));
    return Boolean(beforeQueue) && Boolean(snap.run?.busy);
  },'user input accepted to queue but not sent to executor');
  openQuestion();
  phase='freeze actual completed startup identity and pending request';
  await app.waitFor('document.querySelector(".agent-request")?.innerText.includes(' + JSON.stringify(question) + ')',15000);
  const pre=await snapshot(task.taskId);
  const req=pre.requests.find(item=>JSON.stringify(item.payload).includes(question));
  const original=pre.turns.find(turn=>turn.status==='started'&&turn.source_kind==='user');
  assert(pre.run?.runId && req && original && req.origin.runId===pre.run.runId);
  async function readOriginalTool(handle,snap,preferredId) {
    const matches=snap.items.filter(item=>item.turnId===original.turn_id&&item.type==='tool_call'
      && (preferredId ? item.itemId===preferredId : item.payload.name==='AskUserQuestion'));
    assert.equal(matches.length,1,'The actual pending native question has one matching foreground tool row');
    const item=matches[0];
    const body=await handle.invoke('agentTasks.itemBody',task.taskId,item.itemId,0,item.revision);
    assert(body.done && body.revision===item.revision && body.next===body.totalBytes);
    assert.equal(Buffer.byteLength(body.chunk),body.totalBytes);
    return {itemId:item.itemId,revision:item.revision,terminal:item.terminal,body:body.chunk,
      bodySha256:createHash('sha256').update(body.chunk).digest('hex')};
  }
  const questionBefore=await readOriginalTool(app,pre);
  assert.equal(questionBefore.terminal,null);
  assert.equal(JSON.parse(questionBefore.body).name,'AskUserQuestion');
  assert.equal(JSON.parse(questionBefore.body).status,'running');
  result.foregroundQuestion={before:questionBefore};
  result.beforeFault=databaseSummary(dbPath,task.taskId);
  const exactRun=result.beforeFault.runs.find(run=>run.run_id===pre.run.runId);
  assert(exactRun&&exactRun.owner_pid===app.processId&&exactRun.process_started_at&&processExists(exactRun.pid));
  assert(!result.requests.some(row=>row.sawQueuedUserInput));
  assert(!existsSync(deferredWritePath));
  await app.screenshot(join(out,'80-a27-crash-before-restart-native-request.png'));
  await app.waitFor('document.readyState==="complete"',5000);
  const crashed=app;
  await app.mainEvaluate('(() => {const E=process.getBuiltinModule("module").createRequire(process.cwd()+"/package.json")("electron");const browser=E.BrowserWindow.getAllWindows()[0];if(!browser)throw Error("No isolated BrowserWindow");browser.webContents.session.flushStorageData();return true;})()');
  assert(await app.evaluate('localStorage.getItem("willyou-m14-agent-workspace")==="true"'));
  result.flushedTestSwitch=true;
  const preCrashIdentity=await verifyExactApp(crashed);
  assert.equal(preCrashIdentity[5], exactRun.owner_pid);
  result.faultIdentity=preCrashIdentity;
  result.preCrashRendererErrors=[...crashed.rendererErrors];
  phase='crash exactly the verified original private packaged App process';
  result.crashed=await crashed.crash();
  app=undefined;
  assert.deepEqual(result.crashed,{pid:exactRun.owner_pid,code:null,signal:'SIGKILL'});
  await assert.rejects(()=>crashed.evaluate('document.title',3000));
  assert(!processExists(result.crashed.pid),'The crashed App PID should no longer exist');

  phase='restart exact same isolated App data and reject the retired request';
  const restartHook={};
  app=await openElectron({executable,userData,env,inspectMain:true,startupMainHook:async info=>Object.assign(restartHook,await redirectHome({...info,home}))});
  result.restart={bootstrap:restartHook,identity:await verifyExactApp(app)};
  assert.notEqual(app.processId,result.crashed.pid);
  result.restart.featureFlagPersisted=await app.evaluate('localStorage.getItem("willyou-m14-agent-workspace")==="true"');
  if(!result.restart.featureFlagPersisted) {
    await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true');location.reload();true");
    result.restart.fixtureRearmed=true;
  }
  await app.cdp('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await app.waitFor('Boolean(' + selectorExpr(taskRow(task.taskId)) + ')',20000,{navigation:true});
  await openTask(task.taskId,title);
  await until(()=>{
    const db=databaseSummary(dbPath,task.taskId);
    const run=db.runs.find(row=>row.run_id===pre.run.runId);
    result.restart.db=db;
    return Boolean(run)&&run.state!=='active'&&!processExists(exactRun.pid);
  },'new App recovers registered old executor and observes process exit',15000);
  const recovered=await snapshot(task.taskId);
  const originalNow=recovered.turns.find(turn=>turn.turn_id===original.turn_id);
  assert.equal(originalNow.status,'unknown');
  assert.equal(originalNow.error_code,'HOST_RESTARTED');
  assert(!recovered.requests.some(request=>request.requestId===req.requestId));
  assert(recovered.queued.some(turn=>turn.turnId===beforeQueue.turnId));
  assert(!recovered.run?.busy);
  assert.equal(result.restart.db.requests.find(item=>item.request_id===req.requestId).status,'retired');
  let rejectedOldRequest;
  try { await app.invoke('agentTasks.respond',task.taskId,req.requestId,req.revision,{behavior:'allow',updatedInput:{answers:{[question]:'APPROVE_TEST_OPTION'}}}); }
  catch(error) { rejectedOldRequest=String(error); }
  assert(rejectedOldRequest,'Old exact request identity must be rejected');
  assert.match(rejectedOldRequest,/请求|request/i);
  result.restart.oldRequestRejected=rejectedOldRequest;
  await app.waitFor('document.querySelector(".agent-unknown-result")?.innerText.includes("接收未知")',10000);
  phase='verify recovered foreground tool with retained bytes and real UI';
  const questionAfter=await readOriginalTool(app,recovered,questionBefore.itemId);
  assert.deepEqual(questionAfter,{...questionBefore,terminal:'unconfirmed'});
  result.foregroundQuestion.after=questionAfter;
  const recoveredRows="(() => [...document.querySelectorAll('.agent-task-view .agent-work-row > summary')].filter(node=>node.getBoundingClientRect().width>0&&node.innerText.includes('AskUserQuestion')).map(node=>({text:node.innerText,unconfirmed:node.parentElement.classList.contains('unconfirmed'),running:node.parentElement.classList.contains('running')})))()";
  if(!(await app.evaluate(recoveredRows)).length) {
    const collapsed=await app.evaluate("document.querySelectorAll('.agent-task-view .agent-work-head[aria-expanded=false]').length");
    if(collapsed===1)await click('.agent-task-view .agent-work-head[aria-expanded=false]');
  }
  result.foregroundQuestion.ui=await until(async()=>{
    const rows=await app.evaluate(recoveredRows);
    return rows.length&&rows;
  },'same recovered AskUserQuestion work row visible');
  await app.screenshot(join(out,'81-a27-crash-reopened-queue.png'));
  assert.equal(result.foregroundQuestion.ui.length,1);
  assert.match(result.foregroundQuestion.ui[0].text,/^未收到工具结果 · AskUserQuestion$/);
  assert.equal(result.foregroundQuestion.ui[0].unconfirmed,true);
  assert.equal(result.foregroundQuestion.ui[0].running,false);
  const firstUnattendedAt=Date.now();
  for(;Date.now()-firstUnattendedAt<3500;await pause(100)) {
    const current=await snapshot(task.taskId);
    assert(!current.run?.busy);
    assert(current.queued.some(turn=>turn.turnId===beforeQueue.turnId));
    assert(!result.requests.some(row=>row.sawQueuedUserInput));
    assert(!existsSync(deferredWritePath));
  }
  result.restart.unattendedMs=Date.now()-firstUnattendedAt;
  phase='only explicit queued send restarts agent, then reject old run stop';
  const explicitSendSelector='button[title="立即发送"]';
  await app.waitFor('Boolean(' + selectorExpr(explicitSendSelector) + ')',10000);
  explicitDispatch=true;
  await click(explicitSendSelector);
  await until(async()=>{
    const current=await snapshot(task.taskId);
    return current.run?.busy && current.run.runId!==pre.run.runId && result.requests.some(row=>row.sawQueuedUserInput&&row.explicitDispatch);
  },'original queue record starts once under a new exact native run');
  const newState=await snapshot(task.taskId);
  let staleStopError;
  try { await app.invoke('agentTasks.stop',task.taskId,false,pre.run.runId); }
  catch(error) { staleStopError=String(error); }
  assert(staleStopError && /运行|run/i.test(staleStopError),'Old run identifier should not stop the current run');
  const afterAttack=await snapshot(task.taskId);
  assert.equal(afterAttack.run.runId,newState.run.runId);
  assert(afterAttack.run.busy);
  assert.equal(afterAttack.stopping,null);
  result.restart.oldRunStopRejected=staleStopError;
  result.restart.newRunId=afterAttack.run.runId;
  completeNewTurn();
  releasedNativeGate=true;
  await until(async()=>{
    const current=await snapshot(task.taskId);
    return current.status==='completed' && !current.run?.busy && answerPresent(current,'A27_POST_RESTART_ANSWER');
  },'new original queued turn finishes after stale stop was refused');
  assert.equal(result.requests.filter(row=>row.sawQueuedUserInput).length,1);
  assert(!existsSync(deferredWritePath));
  result.restart.noUnexpectedWrite=true;
  result.restart.finished=databaseSummary(dbPath,task.taskId);
  const freshRun=result.restart.finished.runs.find(item=>item.run_id===afterAttack.run.runId);
  assert.equal(freshRun.owner_pid,app.processId);
  assert.notEqual(freshRun.owner_instance_id,exactRun.owner_instance_id);
  const finishedQueue=result.restart.finished.turns.find(item=>item.turn_id===beforeQueue.turnId);
  assert.equal(finishedQueue.status,'completed');
  assert.equal(finishedQueue.run_id,freshRun.run_id);
  assert.equal(result.restart.finished.requests.find(item=>item.request_id===req.requestId).status,'retired');
  await app.screenshot(join(out,'82-a27-crash-explicit-new-run.png'));
  record('A27 real packaged host crashed exact owned PID; native request retired, unknown original identified and queued user input untouched until explicit resend');
  assert.deepEqual(result.preCrashRendererErrors, []);
  assert.deepEqual(app.rendererErrors, []);
  result.status = 'passed';
} catch (error) {
  result.phase = phase;
  result.error = String(error.stack ?? error);
  if (error.electronStartupLogs) result.startupError = error.electronStartupLogs;
  if (app) try {
    result.visible = await app.evaluate('document.body.innerText.slice(0,12000)');
    await app.screenshot(join(out, '99-failure.png'));
  } catch { /* target already exited */ }
} finally {
  releaseParent();
  releaseIndependent();
  openQuestion();
  if(!releasedNativeGate) completeNewTurn();
  for (const gate of childGates.values()) gate.release();
  if (app) {
    try {
      const tasks = await app.invoke('agentTasks.list');
      result.beforeQuit = tasks.map(({ taskId, title, status, parentTaskId }) => ({ taskId, title, status, parentTaskId }));
      result.beforeQuitRuns = await Promise.all(tasks.map(async task => {
        const current = await snapshot(task.taskId);
        return [task.title,current.run?.runId ?? null,current.run?.busy ?? false];
      }));
      writeFileSync(join(out,'before-quit.json'),JSON.stringify({ at:new Date().toISOString(), pid:app.processId, tasks:result.beforeQuit, runs:result.beforeQuitRuns },null,2));
      const activeRoots = tasks.filter(t => (t.status === 'working' || t.status === 'waiting') && !t.parentTaskId);
      if (activeRoots.length) {
        result.cleanupMadeIdle=[];
        for (const task of activeRoots) {
          await app.invoke('agentTasks.stop',task.taskId,true);
          result.cleanupMadeIdle.push(task.title);
        }
        const untilIdle = Date.now()+15000;
        while (Date.now()<untilIdle) {
          const remaining=(await app.invoke('agentTasks.list')).filter(t=>t.status==='working'||t.status==='waiting');
          if (!remaining.length) break;
          await pause(100);
        }
        result.tasksAfterCleanup=(await app.invoke('agentTasks.list')).map(({title,status})=>({title,status}));
      }
    } catch(error) { result.quitProbeError = String(error); }
    try {
      result.closeEvents=[];
      app.onCDP('Runtime.consoleAPICalled', event=>{
        const message=event.args?.[0]?.value;
        if (typeof message==='string' && message.startsWith('G03_CLOSE_EVENT ')) result.closeEvents.push(message);
      });
      await app.evaluate(`window.electronAPI.eventOn('files:close-request',request=>console.info('G03_CLOSE_EVENT '+request.action));true`);
    } catch(error) { result.closeEventObserverError=String(error); }
    try {
      await app.mainEvaluate(`(() => { const E=process.getBuiltinModule('module').createRequire(process.cwd()+'/package.json')('electron');
        if (E.app.getPath('userData')!==${JSON.stringify(userData)}) throw Error('Wrong App');
        setTimeout(() => E.app.quit(),50); return true; })()`);
    } catch (error) { result.quitRpcError = String(error); }
    try { result.exit = await app.waitForExit(20000); } catch (error) {
      result.exitError = String(error);
      try { result.forcedExit = await app.crash(); } catch (forcedError) { result.forceError = String(forcedError); }
    }

    result.rendererErrors = app.rendererErrors;
    if (result.status === 'passed' && result.cleanupMadeIdle?.length) {
      result.status = 'partial';
      result.cleanupRequired = true;
    }
    writeFileSync(join(out, 'app.log'), app.logs(), { mode: 0o600 });
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, 2));
}
if (result.status !== 'passed' || result.exit?.code !== 0 || result.exit.signal || result.rendererErrors.length) process.exitCode = 1;
