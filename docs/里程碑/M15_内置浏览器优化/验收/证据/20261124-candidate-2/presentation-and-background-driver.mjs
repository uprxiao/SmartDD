// M15 R01 acceptance driver for a pinned candidate. All websites and model responses are local fixtures.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { arch, cpus, loadavg, release } from 'node:os';
import { openElectron, pause } from 'file:///Users/liubu/hx/4.uprxiao/SmartDD/scripts/lib/electron-harness.mjs';
import { startReportFixture } from 'file:///Users/liubu/hx/4.uprxiao/SmartDD/scripts/browser/m15/report-fixture.mjs';

const [bundleArg, pin, cliArg, selection = 'A04,A06,A07,A08'] = process.argv.slice(2);
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
const selectedCases = new Set(selection.split(','));
assert([...selectedCases].every(id => ['A04', 'A06', 'A07', 'A08'].includes(id)));
const bundle = await realpath(bundleArg);
const cli = await realpath(cliArg);
assert(bundle.startsWith('/private/tmp/willyou-') && bundle.endsWith('/WillYou.app'));
const executable = join(bundle, 'Contents/MacOS/WillYou');
const asar = join(bundle, 'Contents/Resources/app.asar');
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar), pin);
const root = await mkdtemp('/private/tmp/willyou-m15-candidate-e2e-');
const userData = join(root, 'data'), home = join(root, 'home'), cliHome = join(root, 'cli-home'), cwd = join(root, 'project');
for (const path of [userData, home, cliHome, cwd]) await mkdir(path, { mode: 0o700 });
const clock = () => performance.timeOrigin + performance.now();
const report = {
  appSha256: pin, appExecutableSha256: await digest(executable), claudeSha256: await digest(cli), claudeBuild: cli.split('/').at(-1),
  root, selection, host: { arch: arch(), kernel: release(), cpus: cpus().length, initialLoad: loadavg() },
  driverSha256: await digest(new URL(import.meta.url)), fixtureSha256: await digest(new URL('file:///Users/liubu/hx/4.uprxiao/SmartDD/scripts/browser/m15/report-fixture.mjs', import.meta.url)),
  samples: [], cases: {}, model: [], failures: [], startedAt: new Date().toISOString(),
};
const persist = () => writeFile(join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('M15_CANDIDATE_ROOT=' + root);
await persist();
await writeFile(join(cwd, 'm15-fixture.txt'), 'M15 local read-only fixture\n', { mode: 0o600 });
const fixture = await startReportFixture();
const key = 'm15-local-model-fixture';
const model = 'claude-sonnet-5-5';
let sequence = 0;
let activeAgentCase;
let app;
let stage = 'setup';
const taskIds = [];
const releases = new Set();
function latch() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  const release = () => { releases.delete(release); resolve(); };
  releases.add(release);
  return { promise, release };
}
function resultMessage(messages, toolId) {
  if (!toolId) return null;
  return messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .find(data => data.type === 'tool_result' && data.tool_use_id === toolId) ?? null;
}

const mockModel = createServer(async (request, response) => {
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
      size += chunk.length;
      assert(size < 4_000_000);
      chunks.push(chunk);
    }
    const pathname = new URL(request.url, base).pathname;
    if (pathname.endsWith('/count_tokens')) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"input_tokens":40}');
      return;
    }
    assert.equal(pathname, '/v1/messages');
    assert.equal(request.headers['x-api-key'], key);
    const params = JSON.parse(Buffer.concat(chunks).toString());
    const requestSequence = ++sequence;
    const id = 'msg_m15_' + requestSequence;
    const message = {
      id, type: 'message', role: 'assistant', model: params.model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: 40, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    };
    if (!params.stream) {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        ...message, content: [{ type: 'text', text: 'M15 本地基线' }], stop_reason: 'end_turn',
      }));
      return;
    }
    assert.equal(params.model, model);
    const text = JSON.stringify(params.messages);
    const sample = activeAgentCase;
    const tool = (params.tools ?? []).find(item => item.name.endsWith('browser_' + sample?.operation + '_v2'));
    let block = null;
    let answer = 'M15 测试已收到回执';
    if (sample && text.includes('WY_M15_AGENT_' + sample.name) && !sample.dispatchedAt) {
      assert(tool, 'Expected fixture MCP tool missing: ' + sample.operation);
      sample.dispatchedAt = clock();
      if (sample.beforeDispatch) await sample.beforeDispatch.promise;
      if (response.destroyed) return;
      sample.toolId = 'tool_' + requestSequence;
      block = { name: tool.name, input: sample.input };
    } else if (sample && text.includes('WY_M15_AGENT_' + sample.name)) {
      sample.result ??= resultMessage(params.messages, sample.toolId);
      if (sample.holdFollowup && sample.result) await sample.holdFollowup.promise;
      if (response.destroyed) return;
    }
    report.model.push({ id, tool: block?.name ?? null, approvalFollowup: text.includes('宿主业务结果通知') });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'request-id': 'req_' + requestSequence });
    const send = (type, fields = {}) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    send('message_start', { message });
    send('content_block_start', { index: 0, content_block: block ? { type: 'tool_use', id: 'tool_' + requestSequence, name: block.name, input: {} } : { type: 'text', text: '' } });
    send('content_block_delta', { index: 0, delta: block ? { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } : { type: 'text_delta', text: answer } });
    send('content_block_stop', { index: 0 });
    send('message_delta', { delta: { stop_reason: block ? 'tool_use' : 'end_turn', stop_sequence: null }, usage: { output_tokens: 20 } });
    send('message_stop');
    response.end();
  } catch (error) {
    report.failures.push({ stage: 'local-model', error: error.message });
    if (!response.headersSent) response.writeHead(500);
    response.end('{}');
  }
});
const listening = once(mockModel, 'listening');
mockModel.listen(0, '127.0.0.1');
await listening;
const base = 'http://127.0.0.1:' + mockModel.address().port;
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const wrapper = join(root, 'claude-fixture');
const cliEnv = {
  HOME: cliHome, CLAUDE_CONFIG_DIR: join(cliHome, 'config'), PATH: '/usr/bin:/bin:/usr/sbin:/sbin', TMPDIR: root,
  SHELL: '/bin/zsh', LANG: 'en_US.UTF-8', NO_PROXY: '127.0.0.1,localhost', ANTHROPIC_BASE_URL: base, ANTHROPIC_API_KEY: key,
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1',
};
await writeFile(wrapper, `#!/bin/sh\nexec /usr/bin/env -i ${Object.entries(cliEnv).map(([k,v]) => quote(k + '=' + v)).join(' ')} ${quote(cli)} "$@"\n`, { mode: 0o700 });
const js = (fn, ...args) => '(' + fn.toString() + ')(...' + JSON.stringify(args) + ')';
async function until(check, name, timeout = 18000) {
  const deadline = performance.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await pause(20);
  } while (performance.now() < deadline);
  throw Error('Timeout waiting for ' + name);
}

const uiState = () => app.evaluate(`(() => {
  const w = document.querySelector('.bw-workspace');
  const address = w?.querySelector('input[aria-label="网页地址"]');
  const visible = Boolean(w?.isConnected && w.getBoundingClientRect().width > 0 && address?.getBoundingClientRect().width > 0);
  return { taskId: visible ? w.dataset.browserTask : null, address: visible ? address.value : null, loading: visible && !!w.querySelector('.bw-progress[role=status]') };
})()`);
async function click(selector, label = null) {
  const point = await app.evaluate(js(function locate(query, text) {
    const candidates = [...document.querySelectorAll(query)].filter(node => {
      if (node.disabled || text !== null && node.textContent.trim() !== text) return false;
      const r = node.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (candidates.length !== 1) return null;
    const node = candidates[0];
    node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    const rect = node.getBoundingClientRect();
    const x = Math.floor(rect.x + rect.width / 2), y = Math.floor(rect.y + rect.height / 2);
    return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
  }, selector, label));
  assert(point, 'Expected one visible clickable target ' + selector);
  await app.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  const releasedAt = clock();
  await app.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
  return releasedAt;
}
const sidebar = id => `[data-testid="sidebar-agent-task"][data-task-id="${id}"]`;
const taskSnapshot = id => app.invoke('agentTasks.snapshot', id);
const browserSnapshot = id => app.invoke('browser.snapshot', { taskId: id });

async function switchTo(id) {
  await app.waitFor(js(query => !!document.querySelector(query), sidebar(id)), 16000, { navigation: true });
  await click(sidebar(id));
  await app.waitFor(js(query => document.querySelector(query)?.getAttribute('aria-current') === 'page' &&
    !!document.querySelector('.agent-task-view textarea'), sidebar(id)), 10000);
}
async function send(text) {
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText', { text });
  assert.equal(await app.evaluate('document.querySelector(".agent-task-view textarea").value'), text);
  await app.waitFor('!!document.querySelector(".agent-task-view button[type=submit]:enabled")', 5000);
  return click('.agent-task-view button[type=submit]');
}
async function pendingBrowserWrite(taskId) {
  return until(async () => {
    const state = await taskSnapshot(taskId);
    return state.requests?.find(item => item.payload?.businessKind === 'browser_write' && item.status === 'pending');
  }, 'durable product browser approval', 28000);
}
async function approveBrowserWrite() {
  await app.waitFor('!!document.querySelector(".agent-request-options button")', 10000);
  const options = await app.evaluate('[...document.querySelectorAll(".agent-request-options button")].map(node => node.textContent.trim())');
  const allow = options.find(text => /批准|允许/.test(text));
  assert(allow);
  await click('.agent-request-options button', allow);
  await app.waitFor('!!document.querySelector(".agent-confirm-choice:enabled")', 6000);
  return click('.agent-confirm-choice');
}
async function modelIdle(taskId) {
  await until(async () => !(await taskSnapshot(taskId)).turns.some(turn => ['dispatching','started'].includes(turn.status)), 'fixture model to finish after result');
}
async function visible(id, url) {
  return until(async () => {
    const now = await uiState();
    return now.taskId === id && now.address === url ? { ...now, at: clock() } : null;
  }, 'the selected target in the actual right pane');
}
async function nativeReady(id, url) {
  return until(async () => {
    const state = await browserSnapshot(id);
    const tab = state.tabs.find(item => item.id === state.activeId);
    if (tab?.url !== url || tab.loading || tab.failure) return null;
    const view = await app.mainEvaluate(js(async function attached(pid, expectedURL) {
      if (process.pid !== pid) throw Error('App process changed');
      const electron = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      const window = electron.BrowserWindow.getAllWindows().find(win => /\/out\/renderer\/index\.html(?:[?#]|$)/.test(win.webContents.getURL()));
      const view = window?.contentView.children.find(child => {
        const contents = child.webContents;
        return contents && !contents.isDestroyed() && contents.getURL() === expectedURL;
      });
      if (!view || view.webContents.isLoading()) return null;
      const bounds = view.getBounds();
      if (bounds.width <= 50 || bounds.height <= 50) return null;
      const marker = await view.webContents.executeJavaScript('Boolean(document.querySelector("#fixture-ready") && document.querySelector("#available") && !document.querySelector("#available").disabled)');
      return marker ? { id: view.webContents.id, width: bounds.width, height: bounds.height } : null;
    }, app.processId, url), { label: 'measure-attached-native-page' });
    return view ? { tabId: tab.id, at: clock(), view } : null;
  }, 'the attached native view with a readable marker');
}
function scheduledReply(site) {
  let release;
  site.controls.openGate = new Promise(resolveGate => { release = resolveGate; });
  return release;
}

try {
  stage = 'isolated-launch';
  app = await openElectron({ userData, executable, cwd: root, env: { HOME: home, SMARTDD_CLI_HOME: cliHome }, inspectMain: true });
  report.pid = await app.mainEvaluate(js(function bind(pid, program, data, homeDir) {
    const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    if (process.pid !== pid || process.execPath !== program || e.app.getPath('userData') !== data || process.env.HOME !== homeDir) throw Error('Isolation mismatch');
    return pid;
  }, app.processId, executable, userData, home), { label: 'bind-isolated-m15-app' });
  report.display = await app.mainEvaluate(`(() => {
    const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
    const w = e.BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
    return { bounds: w?.getBounds(), visible: w?.isVisible(), displays: e.screen.getAllDisplays().map(d => ({ bounds: d.bounds, scaleFactor: d.scaleFactor })) };
  })()`, { label: 'observe-m15-isolated-display' });
  stage = 'fixture-project-and-tasks';
  const tool = await app.invoke('agents.customToolPath', 'claude', wrapper);
  assert(tool.tool.installed && tool.tool.login === 'api');
  const profile = await app.invoke('agents.save', { name: 'M15 本地模型夹具', toolId: tool.tool.id, source: 'login' });
  const project = await app.invoke('projects.create', { name: 'M15 隔离基线', aliases: [], description: '', rulesPath: null }, [{ label: 'fixture', path: cwd }]);
  const { dirs } = await app.invoke('projects.get', project.id);
  const createTask = async (title, tier = 'ask') => {
    const { taskId } = await app.invoke('agentTasks.create', {
      projectId: project.id, dirId: dirs[0].id, cwd, title, profileId: profile.id, tier, model, carryExtensions: false,
    });
    taskIds.push(taskId);
    return taskId;
  };

  const tasks = new Map();
  for (const id of selectedCases) {
    if (id === 'A04') tasks.set(id, { owner: await createTask('M15 A04 浏览任务'), other: await createTask('M15 A04 另一任务') });
    if (id === 'A06') tasks.set(id, { owner: await createTask('M15 A06 后选优先', 'full'), approve: await createTask('M15 A06 批准前切走'), other: await createTask('M15 A06 另一任务') });
    if (id === 'A07') tasks.set(id, { owner: await createTask('M15 A07 保持界面'), other: await createTask('M15 A07 另一任务') });
    if (id === 'A08') tasks.set(id, { ask: await createTask('M15 A08 审批档位'), full: await createTask('M15 A08 完全访问') });
  }
  const rendererOrigin = await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor('performance.timeOrigin!==' + rendererOrigin +
    ' && !!document.querySelector("[data-testid=sidebar-agent-task]")', 16000, { navigation: true });

  const workspaceTabs = '[data-testid="agent-workspace-panel-header"] [role="tab"]';
  const browserTab = address => workspaceTabs + '[title=' + JSON.stringify(address) + ']';
  const addressInput = '.bw-workspace input[aria-label="网页地址"]';
  const traffic = site => site.visits.filter(visit => visit.route === 'open' && visit.method === 'GET');
  const pollElement = selector => app.waitFor(js(query => {
    const element = document.querySelector(query);
    return element && !element.disabled && element.getBoundingClientRect().width > 0;
  }, selector), 10000);
  const activeTask = () => app.evaluate('document.querySelector("[data-testid=sidebar-agent-task][aria-current=page]")?.dataset.taskId ?? null');
  const activeFile = () => app.evaluate('document.querySelector("[data-testid=agent-workspace-panel-header] .fw-tab button[role=tab][aria-selected=true]")?.textContent.trim() ?? null');
  const filesVisible = () => app.evaluate('!!document.querySelector(".agent-file-surface:not([hidden]) [data-testid=file-workspace]")');
  const userSnapshot = async taskId => ({
    activeTask: await activeTask(), browser: await uiState(), file: await activeFile(),
    filesVisible: await filesVisible(), selectedTabId: (await browserSnapshot(taskId)).activeId,
  });
  async function showFile() {
    if (!await filesVisible()) {
      await click(workspaceTabs, (await app.evaluate('[...document.querySelectorAll("[data-testid=agent-workspace-panel-header] .fw-tab button[role=tab]")].some(node=>node.textContent.trim()==="m15-fixture.txt")')) ? 'm15-fixture.txt' : '文件');
    }
    const treeFile = '[role=treeitem][data-file-path$="/m15-fixture.txt"]';
    if (await activeFile() !== 'm15-fixture.txt') {
      await pollElement(treeFile);
      await click(treeFile);
    }
    await until(async () => await filesVisible() && await activeFile() === 'm15-fixture.txt', 'selected fixture file tab');
    return clock();
  }
  async function showTab(taskId, address) {
    await pollElement(browserTab(address));
    const at = await click(browserTab(address));
    await visible(taskId, address);
    return at;
  }
  async function enterAddress(address) {
    await pollElement(addressInput);
    await click(addressInput);
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 4 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 4 });
    await app.cdp('Input.insertText', { text: address });
    assert.equal(await app.evaluate('document.querySelector(".bw-workspace input[aria-label=网页地址]").value'), address);
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
    await app.cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  }
  async function startTool(taskId, name, operation, input, gates = {}) {
    stage = name;
    await modelIdle(taskId);
    const sample = { name, operation, input, ...gates };
    activeAgentCase = sample;
    sample.sentAt = await send('M15 本机夹具步骤 WY_M15_AGENT_' + sample.name);
    await until(() => sample.dispatchedAt, 'model received ' + sample.name);
    return sample;
  }
  async function readToolResult(sample) {
    return until(() => sample.result, 'native executor tool result for ' + sample.name, 19000);
  }
  function findObject(value, matches, depth = 0) {
    if (depth > 15 || value === null) return null;
    if (typeof value === 'string') {
      if (!/^\s*[\[{]/.test(value)) return null;
      try { return findObject(JSON.parse(value), matches, depth + 1); } catch { return null; }
    }
    if (typeof value !== 'object') return null;
    if (matches(value)) return value;
    for (const item of Object.values(value)) {
      const found = findObject(item, matches, depth + 1);
      if (found) return found;
    }
    return null;
  }
  async function approve(taskId, sample) {
    const request = await pendingBrowserWrite(taskId);
    sample.requestId = request.requestId;
    sample.approvedAt = await approveBrowserWrite();
    return request;
  }
  async function notice(taskId, requestId) {
    return until(async () => (await taskSnapshot(taskId)).items
      .find(item => item.type === 'notification' && item.payload?.requestId === requestId &&
        ['finished','failed','cancelled','denied'].includes(item.payload.status)), 'host terminal notification');
  }
  async function resultForOpen(taskId, sample, tier) {
    const answer = tier === 'ask' ? (await notice(taskId, sample.requestId)).payload : await readToolResult(sample);
    const receipt = findObject(answer, obj => typeof obj.pageId === 'string' && typeof obj.presentation === 'string' && typeof obj.operationId === 'string');
    return { answer, receipt };
  }
  async function open(taskId, name, input, { tier = 'ask', beforeDispatch, holdFollowup } = {}) {
    const sample = await startTool(taskId, name, 'tab_open', input, { beforeDispatch, holdFollowup });
    if (tier === 'ask') await approve(taskId, sample);
    const outcome = await resultForOpen(taskId, sample, tier);
    return { sample, ...outcome };
  }
  function operationRows(taskId, pageId, operationId) {
    assert.match(taskId, /^[a-f0-9-]{36}$/);
    assert.match(pageId, /^[a-f0-9-]{36}$/);
    assert.match(operationId, /^[a-f0-9-]{36}$/);
    const query = "SELECT request_id, run_id, state, effect_state, error_code, created_at, updated_at, summary " +
      "FROM browser_operations WHERE command='tab open' AND task_id='" + taskId + "' AND page_id='" + pageId +
      "' AND json_extract(summary,'$.operationId')='" + operationId + "' AND request_id NOT LIKE 'audit:%'";
    const content = execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', join(userData, 'smartdd.db'), query], { encoding: 'utf8' }).trim();
    return content ? JSON.parse(content).map(row => ({
      requestId: row.request_id, runId: row.run_id, state: row.state, errorCode: row.error_code,
      effect: row.effect_state, createdAt: row.created_at, updatedAt: row.updated_at, ...JSON.parse(row.summary),
    })) : [];
  }
  async function waitPhase(taskId, receipt, phase) {
    assert(receipt, 'Open command returned no page receipt');
    return until(() => operationRows(taskId, receipt.pageId, receipt.operationId)
      .find(row => row.phase === phase), 'original open ledger ' + phase, 14000);
  }
  async function observePage(taskId, name, receipt, url) {
    const sample = await startTool(taskId, name, 'nav_snapshot', { page: receipt.pageId });
    const result = await readToolResult(sample);
    const observation = findObject(result, obj => obj.browserPageId === receipt.pageId && obj.url === url && typeof obj.snapshot === 'string');
    assert(observation && observation.snapshot.includes('M15 测试网页'), 'The actual MCP snapshot must read the expected site marker');
    await modelIdle(taskId);
    return { browserPageId: observation.browserPageId, url: observation.url, title: observation.title, marker: 'M15 测试网页' };
  }
  async function captureUI(name) {
    await app.screenshot(join(root, name + '.png'));
  }
  async function followResult(taskId, url, expectedPage) {
    const link = await app.evaluate(js(function locate(address) {
      const cards = [...document.querySelectorAll('.agent-child-result')].reverse();
      const parent = cards.find(card => [...card.children].some(row => row.tagName === 'SMALL' && row.textContent === address));
      const node = [...(parent?.querySelectorAll('button') ?? [])].find(button => button.textContent === '查看网页标签');
      if (!node) return null;
      node.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      const r = node.getBoundingClientRect(), x = Math.floor(r.x + r.width/2), y = Math.floor(r.y + r.height/2);
      return r.width > 0 && node.contains(document.elementFromPoint(x,y)) ? { x,y } : null;
    }, url));
    assert(link, 'Could not locate the real result card at the reported URL');
    await app.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...link });
    await app.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...link });
    const shown = await nativeReady(taskId, url);
    assert.equal(shown.tabId, expectedPage);
    return shown;
  }
  async function record(row) {
    report.samples.push({ at: clock(), ...row });
    await persist();
  }
  async function runCase(id, execute) {
    if (!selectedCases.has(id)) return;
    try {
      await execute(tasks.get(id));
      report.cases[id] = { status: 'app-checks-passed' };
    } catch (error) {
      report.cases[id] = { status: 'failed', stage, error: String(error.stack ?? error) };
      await captureUI(id + '-failed').catch(() => {});
      const dom = await app.evaluate('document.body.innerText').catch(() => '');
      await writeFile(join(root, id + '-failed-ui.txt'), dom, { mode: 0o600 });
      for (const release of releases) release();
    } finally {
      await persist();
    }
  }

  await runCase('A04', async ({ owner, other }) => {
    const target = fixture.create('a04-target'), start = fixture.create('a04-default');
    const url = target.url('open'), startURL = start.url('open');
    stage = 'a04-profiles-setup';
    // Identity provisioning is a non-tested precondition. All opens go through the requested browser tool.
    const alternate = (await app.invoke('browser.createProfile', { taskId: owner, label: 'A04 任务独立身份' })).result;
    const foreign = (await app.invoke('browser.createProfile', { taskId: other, label: 'A04 另一任务的身份' })).result;
    await switchTo(other);
    const { receipt: foreignTab } = await open(other, 'a04-other-task', { url, profileId: foreign.id, presentation: 'show' });
    await waitPhase(other, foreignTab, 'ready');
    const foreignIdentity = (await browserSnapshot(other)).tabs.find(tab => tab.id === foreignTab.pageId);
    assert.equal(foreignIdentity.profileId, foreign.id);
    await switchTo(owner);
    const { receipt: defaultTab } = await open(owner, 'a04-default-tab', { url: startURL, presentation: 'show' });
    await nativeReady(owner, startURL);
    const defaultProfile = (await browserSnapshot(owner)).tabs.find(tab => tab.id === defaultTab.pageId).profileId;
    const { receipt: alternateTab } = await open(owner, 'a04-other-identity', { url, profileId: alternate.id, presentation: 'background' });
    await waitPhase(owner, alternateTab, 'ready');
    const before = await browserSnapshot(owner);
    assert.equal(before.activeId, defaultTab.pageId);
    assert.equal(before.tabs.find(tab => tab.id === alternateTab.pageId).profileId, alternate.id);
    assert.equal(traffic(target).length, 2);
    const { receipt: newTab } = await open(owner, 'a04-current-identity', { url, presentation: 'show' });
    const native = await nativeReady(owner, url);
    assert.equal(native.tabId, newTab.pageId);
    assert.equal(newTab.reused, false);
    assert.notEqual(newTab.pageId, alternateTab.pageId);
    assert.notEqual(newTab.pageId, foreignTab.pageId);
    const after = await browserSnapshot(owner);
    assert.equal(after.tabs.find(tab => tab.id === newTab.pageId).profileId, defaultProfile);
    assert.equal(traffic(target).length, 3);
    for (const [suffix, input, possible] of [
      ['page', { pageId: foreignTab.pageId, presentation: 'show' }, /BROWSER_TAB_NOT_FOUND|SCOPE_DENIED/],
      ['identity', { url, profileId: foreign.id, presentation: 'show' }, /SCOPE_DENIED/],
    ]) {
      const denied = await open(owner, 'a04-denied-' + suffix, input);
      assert.equal(denied.receipt, null);
      assert.match(JSON.stringify(denied.answer), possible);
      await record({ id:'A04', step:'denied-' + suffix, nativePage: native.tabId, result: denied.answer, visits: traffic(target).length });
    }
    assert.deepEqual((await browserSnapshot(owner)).tabs.map(row => [row.id,row.profileId,row.url]), after.tabs.map(row => [row.id,row.profileId,row.url]));
    assert.equal((await browserSnapshot(other)).tabs.find(tab => tab.id === foreignTab.pageId).profileId, foreign.id);
    assert.equal(traffic(target).length, 3);
    await record({ id:'A04', step:'triple-identity', original: foreignIdentity, alternateTab, newTab, defaultProfile, native, visits: traffic(target) });
  });

  // I-level transport fault: defer one real presentation message for its original
  // owner while all other product messages and actual UI input proceed normally.
  async function holdPresentation(taskId) {
    const guard = 'm15-hold-original-presentation';
    await app.mainEvaluate(js(function install(pid, program, data, owner) {
      const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      if (process.pid !== pid || process.execPath !== program || e.app.getPath('userData') !== data) throw Error('Isolation mismatch');
      const w = e.BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
      const target = w?.webContents;
      if (!target || target.isDestroyed() || globalThis.__m15QaHeldBrowserPresentation) throw Error('Invalid isolated transport state');
      const previous = Object.getOwnPropertyDescriptor(target, 'send');
      const send = target.send;
      const state = {
        captured: null, queued: null,
        restore(deliver) {
          if (previous) Object.defineProperty(target, 'send', previous);
          else Reflect.deleteProperty(target, 'send');
          delete globalThis.__m15QaHeldBrowserPresentation;
          if (deliver && state.queued && !target.isDestroyed()) Reflect.apply(send, target, state.queued);
          return { captured: state.captured, deliveredAt: deliver ? Date.now() : null };
        },
      };
      target.send = function sendOrDefer(channel, ...args) {
        const payload = args[0];
        if (channel === 'browser:open-presentation' && payload?.taskId === owner && !state.captured) {
          state.captured = { ...payload, heldAt:Date.now() };
          state.queued = [channel, ...args];
          return;
        }
        return Reflect.apply(send, this, [channel, ...args]);
      };
      globalThis.__m15QaHeldBrowserPresentation = state;
      return true;
    }, app.processId, executable, userData, taskId), { label:guard });
    return {
      captured: () => app.mainEvaluate('globalThis.__m15QaHeldBrowserPresentation?.captured ?? null', { label:guard }),
      restore: deliver => app.mainEvaluate(js(flag => globalThis.__m15QaHeldBrowserPresentation?.restore(flag) ?? null, deliver), { label:guard }),
    };
  }

  await runCase('A06', async ({ owner, approve: ask, other }) => {
    await app.evaluate(`(() => {
      const observations = [];
      const off = window.electronAPI.eventOn('browser:open-presentation', message => {
        if (observations.length < 16) observations.push({ ...message, receivedAt: Date.now() });
      });
      window.__m15QaObservePresentation = { observations, off };
    })()`);
    const old = fixture.create('a06-user-tab'), oldURL = old.url('open');
    await switchTo(owner);
    const initial = await open(owner, 'a06-existing-user-tab', { url: oldURL, presentation: 'show' }, { tier:'full' });
    await nativeReady(owner, oldURL);
    for (const situation of ['switch-task', 'file', 'other-tab', 'away-and-return']) {
      await switchTo(owner);
      const site = fixture.create('a06-' + situation), url = site.url('open');
      const presentation = await holdPresentation(owner);
      try {
        const { sample, receipt } = await open(owner,'a06-' + situation,{ url,presentation:'show' },{tier:'full'});
        const captured = await until(presentation.captured,'actual browser presentation event was intercepted');
        assert.equal(captured.pageId,receipt.pageId);
        assert.equal(captured.operationId,receipt.operationId);
        assert.equal(typeof captured.clientInputId,'string');
        let selectedAt;
        if (situation === 'switch-task') { await switchTo(other); selectedAt = clock(); }
        if (situation === 'file') selectedAt = await showFile();
        if (situation === 'other-tab') {
          await showFile();
          selectedAt = await showTab(owner, oldURL);
        }
        if (situation === 'away-and-return') { await switchTo(other); await switchTo(owner); selectedAt = await showFile(); }
        const before = await userSnapshot(owner);
        const forwarded = await presentation.restore(true);
        const operation = await waitPhase(owner, receipt, 'ready');
        const observed = await until(() => app.evaluate(js(operationId =>
          window.__m15QaObservePresentation.observations.find(row => row.operationId === operationId) ?? null,
        captured.operationId)), 'original event reached the renderer');
        const after = await userSnapshot(owner);
        assert.deepEqual(after, before);
        assert.equal(traffic(site).length, 1);
        assert.notEqual(receipt.pageId, initial.receipt.pageId);
        await record({ id:'A06', step:situation, transport:'one actual main-to-renderer presentation notification held', before, after,
          sentAt:sample.sentAt, mockReceivedAt:sample.dispatchedAt, selectedAt, forwarded, observed, operation, visits:traffic(site) });
        await modelIdle(owner);
      } finally {
        await presentation.restore(false);
      }
    }
    await switchTo(ask);
    const site = fixture.create('a06-before-approval'), url = site.url('open');
    const pending = await startTool(ask, 'a06-before-approval', 'tab_open', { url, presentation:'show' });
    const approvalCard = await pendingBrowserWrite(ask);
    await switchTo(other);
    const selectOtherAt = clock();
    await switchTo(ask);
    const selectedFileAt = await showFile();
    const before = await userSnapshot(ask);
    const approvedAt = await approveBrowserWrite();
    const { receipt } = await resultForOpen(ask, {...pending, requestId: approvalCard.requestId}, 'ask');
    const operation = await waitPhase(ask, receipt, 'ready');
    assert.deepEqual(await userSnapshot(ask), before);
    const shown = await followResult(ask, url, receipt.pageId);
    await record({ id:'A06', step:'before-approval', selectOtherAt, selectedFileAt, approvedAt, operation, expected:receipt.pageId, shown, visits:traffic(site) });
    await captureUI('A06-original-card-revealed');
    await app.evaluate('window.__m15QaObservePresentation.off(); delete window.__m15QaObservePresentation;');
  });

  await runCase('A07', async ({ owner, other }) => {
    await switchTo(owner);
    const old = fixture.create('a07-foreground'), oldURL = old.url('open');
    const { receipt: front } = await open(owner, 'a07-foreground', { url: oldURL, presentation:'show' });
    await nativeReady(owner, oldURL);
    const opened = {};
    for (const [surface, reuse] of [['file',false],['file',true],['browser',false],['browser',true]]) {
      if (surface === 'file') await showFile(); else await showTab(owner, oldURL);
      const site = reuse ? opened[surface].site : fixture.create('a07-' + surface + '-new');
      const url = site.url('open');
      const before = await userSnapshot(owner), previous = traffic(site).length;
      const command = 'a07-' + surface + (reuse ? '-reuse' : '-new');
      const { receipt } = await open(owner, command, { url, presentation:'background' });
      const operation = await waitPhase(owner, receipt, 'ready');
      const observation = await observePage(owner, command + '-snapshot', receipt, url);
      assert.deepEqual(await userSnapshot(owner), before);
      assert.equal(receipt.reused, reuse);
      assert.equal(traffic(site).length - previous, reuse ? 0 : 1);
      if (reuse) assert.equal(receipt.pageId, opened[surface].receipt.pageId);
      else opened[surface] = { site, receipt };
      await record({ id:'A07', step:command, before, after:await userSnapshot(owner), operation, observation, visits:traffic(site), foregroundId:front.pageId });
    }
    const site = fixture.create('a07-after-switch'), url = site.url('open');
    const load = latch();
    site.controls.openGate = load.promise;
    const { receipt } = await open(owner, 'a07-background-in-flight-switch', { url, presentation:'background' });
    await until(() => traffic(site).length === 1, 'background site reached hold');
    const loading = await waitPhase(owner, receipt, 'loading');
    await switchTo(other);
    const before = await userSnapshot(owner);
    load.release();
    const operation = await waitPhase(owner, receipt, 'ready');
    const after = await userSnapshot(owner);
    assert.deepEqual(after, before);
    await switchTo(owner);
    const observation = await observePage(owner, 'a07-after-switch-snapshot', receipt, url);
    const shown = await followResult(owner, url, receipt.pageId);
    await record({ id:'A07', step:'switch-during-background-load', before, after, loading, operation, observation, shown, visits:traffic(site) });
    await captureUI('A07-background-card-revealed');
  });

  await runCase('A08', async ({ ask, full }) => {
    async function theme(label, expected) {
      await click('[data-testid=nav-settings]');
      await click('.settings-nav button', '外观');
      await pollElement('[role=combobox][aria-label=主题]');
      await click('[role=combobox][aria-label=主题]');
      await click('[role=option]', label);
      await app.waitFor(js(value => document.documentElement.classList.contains(value), expected), 10000);
    }
    async function narrow() {
      return app.mainEvaluate(js(function adjust(pid, program, data) {
        const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
        if (process.pid !== pid || process.execPath !== program || e.app.getPath('userData') !== data) throw Error('Isolation mismatch');
        const w = e.BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('/renderer/index.html'));
        if (!w || w.isDestroyed()) throw Error('Missing isolated candidate window');
        const before = w.getBounds();
        w.setBounds({ ...before, width: 950 });
        return { before, after: w.getBounds() };
      }, app.processId, executable, userData), { label:'m15-narrow-isolated-window' });
    }
    async function diagnostics(expectedUrl) {
      return app.evaluate(js(function current(url) {
        const reason = document.querySelector('.bw-navigation-failure[role=alert]');
        const address = document.querySelector('.bw-workspace input[aria-label="网页地址"]');
        const retry = reason?.querySelector('button');
        const rect = retry?.getBoundingClientRect();
        return {
          hasReason: Boolean(reason?.querySelector('.bw-error-name')?.textContent?.trim()),
          urlMatches: address?.value === url,
          retryFocused: document.activeElement === retry,
          retryVisible: Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth),
          theme: document.documentElement.classList.contains('ydark') ? 'dark' : 'light', innerWidth,
        };
      }, expectedUrl));
    }
    async function retryByKeyboard() {
      const selector = '.bw-navigation-failure[role=alert] .bw-failure-actions button';
      // Use actual keyboard Tab to reach Retry from the real address bar.
      await click(addressInput);
      for (let attempt = 0; attempt < 18; attempt++) {
        if (await app.evaluate(js(query => document.activeElement === document.querySelector(query), selector))) break;
        await app.cdp('Input.dispatchKeyEvent', { type:'keyDown', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
        await app.cdp('Input.dispatchKeyEvent', { type:'keyUp', key:'Tab', code:'Tab', windowsVirtualKeyCode:9 });
      }
      assert(await app.evaluate(js(query => document.activeElement === document.querySelector(query), selector)), 'Retry is unreachable by Tab');
      await app.cdp('Input.dispatchKeyEvent', { type:'keyDown', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
      await app.cdp('Input.dispatchKeyEvent', { type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13 });
    }
    async function disconnectBrowserInProject() {
      await pollElement('[aria-label="项目插件"]');
      await click('[aria-label="项目插件"]');
      await click('[role=dialog] button', '管理项目插件');
      const off = '[role=switch][aria-label="关闭 浏览器"]', on = '[role=switch][aria-label="启用 浏览器"]';
      await pollElement(off);
      await click(off);
      await pollElement(on);
      return {
        async restore() { await click(on); await pollElement(off); }
      };
    }

    for (const appearance of ['light', 'dark']) {
      stage = 'a08-appearance-' + appearance;
      await theme(appearance === 'dark' ? '深色' : '浅色', appearance === 'dark' ? 'ydark' : 'ylight');
      const size = appearance==='dark' ? await narrow() : null;
      await switchTo(ask);
      const site = fixture.create('a08-connection-failure-' + appearance);
      const url = site.url('open') + '?long=' + 'report-'.repeat(44) + '#november';
      site.controls.openFailure = true;
      const { receipt } = await open(ask, 'a08-connection-failure-' + appearance, { url, presentation:'show' });
      const originalFailure = await waitPhase(ask, receipt, 'failed');
      const notice = '.bw-navigation-failure[role=alert]';
      await pollElement(notice);
      const details = await diagnostics(url), before = await browserSnapshot(ask);
      assert(details.hasReason && details.urlMatches && details.retryVisible);
      assert.equal(details.theme, appearance);
      assert.equal(before.activeId, receipt.pageId);
      if (appearance === 'dark') assert(size.after.width <= 950 && details.innerWidth <= 950);
      await captureUI('A08-failure-' + appearance);
      site.controls.openFailure = false;
      if (appearance === 'dark') await retryByKeyboard();
      else await click(notice + ' .bw-failure-actions button', '重试');
      const recovered = await nativeReady(ask,url);
      assert.equal(recovered.tabId, receipt.pageId);
      assert.equal((await waitPhase(ask, receipt, 'failed')).requestId, originalFailure.requestId);
      await record({ id:'A08', step:'connection-failure-and-retry-' + appearance, appearance:details, window:size, originalFailure, recovered, visits:traffic(site), retryBy:appearance==='dark'?'Tab and Enter':'click' });
    }
    await theme('浅色','ylight');
    const releaseNavigationFairly = async (site, gate) => {
      const request = await until(() => traffic(site).find(visit => visit.closedBeforeFinish), 'canceled original HTTP request closed');
      gate.release();
      return request;
    };
    for (const tier of ['ask', 'full']) {
      const taskId = tier === 'ask' ? ask : full;
      for (const action of ['stop', 'close', 'address', 'revoke']) {
        stage = 'a08-' + tier + '-' + action;
        await switchTo(taskId);
        const caseName = 'a08-' + tier + '-' + action;
        const site = fixture.create(caseName), url = site.url('open');
        const gate = latch(), holdFollowup = action === 'stop' ? latch() : undefined;
        site.controls.openGate = gate.promise;
        const { receipt } = await open(taskId, caseName, { url, presentation:'show' }, { tier, holdFollowup });
        const loading = await waitPhase(taskId, receipt, 'loading');
        await visible(taskId, url);
        await until(() => traffic(site).length === 1, 'one target HTTP request in flight');
        const selectedWhileLoading = (await browserSnapshot(taskId)).activeId;
        assert.equal(selectedWhileLoading, receipt.pageId);
        let alternateUrl, reenable;
        if (action === 'stop') {
          const stopSelector = '.agent-composer-primary[data-action=stop]';
          await pollElement(stopSelector);
          await click(stopSelector);
        }
        if (action === 'close') await click(browserTab(url) + ' + button');
        if (action === 'address') {
          alternateUrl = fixture.create(caseName + '-replacement').url('open');
          await enterAddress(alternateUrl);
        }
        if (action === 'revoke') reenable = await disconnectBrowserInProject();
        const cancelled = await waitPhase(taskId, receipt, 'cancelled');
        const oldRequest = await releaseNavigationFairly(site, gate);
        holdFollowup?.release();
        const state = await browserSnapshot(taskId);
        if (action === 'close') assert(!state.tabs.some(tab => tab.id === receipt.pageId), 'Closed ID is absent after old HTTP response resumes');
        if (action === 'address') {
          const after = await nativeReady(taskId,alternateUrl);
          assert.equal(after.tabId,receipt.pageId);
        }
        assert(!state.tabs.some(tab => tab.url === url), 'The old requested URL has never been committed after cancellation');
        assert.equal(traffic(site).length, 1);
        assert(oldRequest.closedBeforeFinish);
        await record({ id:'A08', step:caseName, selectedWhileLoading, loading, cancelled, alternateUrl, state, oldRequest });
        if (reenable) {
          await reenable.restore();
          await switchTo(taskId);
        }
        await modelIdle(taskId);
      }
    }
  });
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(report.failures, []);
  report.status = Object.values(report.cases).every(row => row.status === 'app-checks-passed') ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed';
  report.failures.push({ stage, error: String(error.stack ?? error) });
  if (app) {
    try {
      await writeFile(join(root, 'failed-ui.txt'), await app.evaluate('document.body.innerText'), { mode: 0o600 });
      await app.screenshot(join(root, 'failed-ui.png'));
    } catch { /* The original failure remains the result. */ }
  }
} finally {
  for (const release of releases) release();
  if (app) {
    try {
      for (const id of taskIds) await app.invoke('agentTasks.stop', id, true);
      await app.mainEvaluate(`(() => {
        const e = process.getBuiltinModule('module').createRequire(process.execPath)('electron');
        setTimeout(() => e.app.quit(), 40);
        return true;
      })()`, { label: 'quit-isolated-m15-baseline' });
      report.exit = await app.waitForExit(18000);
      assert.equal(report.exit.code, 0);
      assert.equal(report.exit.signal, null);
    } catch (error) {
      report.failures.push({ stage: 'normal-exit', error: String(error) });
      report.status = 'failed';
    }
    await writeFile(join(root, 'electron.log'), app.logs(), { mode: 0o600 });
    await app.close();
  }
  await fixture.close();
  const modelClosed = once(mockModel, 'close');
  mockModel.close();
  mockModel.closeAllConnections();
  await modelClosed;
  report.finalLoad = loadavg();
  report.finishedAt = new Date().toISOString();
  report.sameAsarAfterRun = pin === await digest(asar);
  if (!report.sameAsarAfterRun) report.status = 'failed';
  await persist();
  console.log(JSON.stringify({ status: report.status, samples: report.samples.length, lastStage: stage, failures: report.failures.map(f => f.stage) }));
  process.exitCode = report.status === 'passed' ? 0 : 1;
}
