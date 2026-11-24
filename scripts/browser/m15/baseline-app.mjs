// Pre-development measurement against an unchanged, pinned packaged WillYou.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { arch, cpus, loadavg, release } from 'node:os';
import { openElectron, pause } from '../../lib/electron-harness.mjs';
import { startReportFixture } from './report-fixture.mjs';

const [bundleArg, pin, cliArg, mode = 'both', countArg = '5'] = process.argv.slice(2);
assert.match(pin ?? '', /^[a-f0-9]{64}$/);
assert(['manual', 'agent', 'both'].includes(mode));
const count = Number(countArg);
assert(Number.isInteger(count) && count >= 1 && count <= 20);
const bundle = await realpath(bundleArg);
const cli = await realpath(cliArg);
assert(bundle.startsWith('/private/tmp/willyou-') && bundle.endsWith('/WillYou.app'));
const executable = join(bundle, 'Contents/MacOS/WillYou');
const asar = join(bundle, 'Contents/Resources/app.asar');
const digest = async file => createHash('sha256').update(await readFile(file)).digest('hex');
assert.equal(await digest(asar), pin);
const root = await mkdtemp('/private/tmp/willyou-m15-baseline-');
const userData = join(root, 'data'), home = join(root, 'home'), cliHome = join(root, 'cli-home'), cwd = join(root, 'project');
for (const path of [userData, home, cliHome, cwd]) await mkdir(path, { mode: 0o700 });
const clock = () => performance.timeOrigin + performance.now();
const report = {
  appSha256: pin, appExecutableSha256: await digest(executable), claudeSha256: await digest(cli), claudeBuild: cli.split('/').at(-1),
  root, mode, count, host: { arch: arch(), kernel: release(), cpus: cpus().length, initialLoad: loadavg() },
  driverSha256: await digest(new URL(import.meta.url)), fixtureSha256: await digest(new URL('./report-fixture.mjs', import.meta.url)),
  samples: [], model: [], failures: [], startedAt: new Date().toISOString(),
};
const persist = () => writeFile(join(root, 'result.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
console.log('M15_BASELINE_ROOT=' + root);
await persist();
const fixture = await startReportFixture();
const scenarios = new Map();
const key = 'm15-local-model-fixture';
const model = 'claude-sonnet-5-5';
let sequence = 0;
let preparedLinks = [];
let activeAgentCase;
let app;
let stage = 'setup';
const taskIds = [];

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
    const id = 'msg_m15_' + ++sequence;
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
    const operation = sample?.pageId ? 'switch' : 'create';
    const tool = (params.tools ?? []).find(item => item.name.endsWith('browser_tab_' + operation + '_v2'));
    let block = null;
    let answer = 'M15 测试已收到回执';
    if (text.includes('WY_M15_LINKS')) {
      answer = preparedLinks.map(name => `[M15 ${name}](${scenarios.get(name).url('open')})`).join('\n\n');
    } else if (sample && text.includes('WY_M15_AGENT_' + sample.name) && !sample.dispatchedAt) {
      assert(tool, 'Browser create tool missing. Available browser/search names: ' + (params.tools ?? []).map(item => item.name).filter(name => /browser|toolsearch/i.test(name)).join(','));
      sample.dispatchedAt = clock();
      block = { name: tool.name, input: sample.pageId ? { page: sample.pageId, focus: true } : { url: scenarios.get(sample.name).url('open') } };
    }
    report.model.push({ id, tool: block?.name ?? null, approvalFollowup: text.includes('宿主业务结果通知') });
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'request-id': 'req_' + sequence });
    const send = (type, fields = {}) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    send('message_start', { message });
    send('content_block_start', { index: 0, content_block: block ? { type: 'tool_use', id: 'tool_' + sequence, name: block.name, input: {} } : { type: 'text', text: '' } });
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
  await app.waitFor('!!document.querySelector(".agent-task-view textarea")', 10000);
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
  const createTask = async title => {
    const { taskId } = await app.invoke('agentTasks.create', {
      projectId: project.id, dirId: dirs[0].id, cwd, title, profileId: profile.id, tier: 'ask', model, carryExtensions: false,
    });
    taskIds.push(taskId);
    return taskId;
  };

  const manualId = mode === 'agent' ? null : await createTask('M15 旧版消息链接');
  const agentIds = [];
  if (mode !== 'manual') for (let rank = 1; rank <= count; rank++) agentIds.push(await createTask('M15 旧版 Agent ' + rank));
  const rendererOrigin = await app.evaluate('performance.timeOrigin');
  await app.cdp('Page.reload');
  await app.waitFor(`performance.timeOrigin!==${rendererOrigin} && !!document.querySelector('[data-testid=sidebar-agent-task]')`, 16000, { navigation: true });

  if (manualId) {
    stage = 'manual-prepare-links';
    preparedLinks = Array.from({ length: count }, (_, i) => 'link-' + (i + 1));
    for (const name of preparedLinks) scenarios.set(name, fixture.create(name));
    await switchTo(manualId);
    await send('请给出本地报表测试链接 WY_M15_LINKS');
    const anchor = '.agent-turn .agent-assistant a[data-agent-link]';
    await until(async () => await app.evaluate(js((selector, expected) => document.querySelectorAll(selector).length === expected, anchor, count)), 'all actual chat links');
    for (const name of preparedLinks) {
      stage = 'manual-' + name;
      const site = scenarios.get(name);
      const url = site.url('open');
      const release = scheduledReply(site);
      const old = await browserSnapshot(manualId);
      try {
        const clicked = await click(anchor, 'M15 ' + name);
        const render = await visible(manualId, url);
        const visit = await until(() => site.visits.find(v => v.route === 'open'), 'slow-site request while held');
        assert(render.loading);
        assert.equal(visit.finishedAt, undefined);
        release();
        const ready = await nativeReady(manualId, url);
        assert(!old.tabs.some(tab => tab.id === ready.tabId));
        assert.equal(site.visits.filter(x => x.route === 'open').length, 1);
        report.samples.push({ route: 'message-link', scenario: name, clickToVisibleMs: render.at - clicked, requestToReadyMs: ready.at - visit.receivedAt,
          clickToReadyMs: ready.at - clicked, visibleBeforeResponse: render.at < visit.finishedAt, requests: 1 });
        // Reopen the address through the same visible message. Count the resulting real request and tab.
        site.controls.openGate = undefined;
        const repeated = await click(anchor, 'M15 ' + name);
        const repeatedReady = await until(async () => {
          const r = await nativeReady(manualId, url);
          return r.tabId !== ready.tabId ? r : null;
        }, 'second real delivery in another tab');
        const visits = site.visits.filter(x => x.route === 'open');
        assert.equal(visits.length, 2);
        report.samples.push({ route: 'message-link-existing-target', scenario: name, clickToReadyMs: repeatedReady.at - repeated,
          requestToReadyMs: repeatedReady.at - visits[1].receivedAt, requests: 1, reused: false });
        await persist();
      } finally {
        release();
      }
    }
  }
  for (const [index, taskId] of agentIds.entries()) {
    const name = 'agent-' + (index + 1);
    const site = fixture.create(name);
    scenarios.set(name, site);
    const url = site.url('open');
    const release = scheduledReply(site);
    const sample = { route: 'agent-approved-link', name };
    activeAgentCase = sample;
    stage = name + '-request';
    try {
      await switchTo(taskId);
      assert.equal((await uiState()).taskId, null);
      await send('请在内置浏览器打开样例网页 WY_M15_AGENT_' + name);
      const request = await pendingBrowserWrite(taskId);
      assert.equal(site.visits.filter(v => v.route === 'open').length, 0);
      stage = name + '-approve';
      const approved = await approveBrowserWrite();
      stage = name + '-hold-network';
      const visit = await until(() => site.visits.find(x => x.route === 'open'), 'approved navigation reaching the server', 28000);
      const during = await uiState();
      assert.equal(visit.finishedAt, undefined);
      release();
      stage = name + '-control-card';
      const cardSelector = '.agent-child-result button';
      await until(() => app.evaluate(js(selector => [...document.querySelectorAll(selector)].some(n => n.textContent.trim() === '查看网页标签' && n.getBoundingClientRect().height > 0), cardSelector)), 'old result-card reveal control', 28000);
      const cardAt = clock();
      const beforeManual = await uiState();
      const reveal = await click(cardSelector, '查看网页标签');
      const selected = await visible(taskId, url);
      const ready = await nativeReady(taskId, url);
      assert.equal(site.visits.filter(x => x.route === 'open').length, 1);
      const stats = await taskSnapshot(taskId);
      const notice = stats.items.find(item => item.type === 'notification' && item.payload?.requestId === request.requestId && item.payload.status === 'finished');
      assert(notice, 'Missing original successful host result');
      const receiptPage = notice.payload.result?.value?.data?.pageId;
      assert.equal(receiptPage, ready.tabId);
      report.samples.push({ ...sample, approvalToRequestMs: visit.receivedAt - approved, approvalToResultCardMs: cardAt - approved,
        approvalToVisibleWithDriverClickMs: selected.at - approved, requestToReadyWithDriverClickMs: ready.at - visit.receivedAt, clickToVisibleMs: selected.at - reveal,
        autoVisibleWhileHeld: during.taskId === taskId, autoVisibleBeforeManual: beforeManual.taskId === taskId, manualRevealNeeded: beforeManual.address !== url, requests: 1 });
      await persist();
      await modelIdle(taskId);

      stage = name + '-existing-target';
      await click('button[title="收起右侧面板"]');
      await until(async () => !(await uiState()).taskId, 'collapsed right pane');
      const previousTabs = (await browserSnapshot(taskId)).tabs.map(tab => tab.id);
      const refocus = { route: 'agent-explicit-existing-tab', name: name + '-refocus', pageId: ready.tabId };
      activeAgentCase = refocus;
      await send('请展示当前已有标签 WY_M15_AGENT_' + refocus.name);
      const warmRequest = await pendingBrowserWrite(taskId);
      assert.notEqual(warmRequest.requestId, request.requestId);
      const warmApproved = await approveBrowserWrite();
      const shown = await visible(taskId, url);
      const warmReady = await nativeReady(taskId, url);
      const afterTabs = (await browserSnapshot(taskId)).tabs.map(tab => tab.id);
      assert.equal(warmReady.tabId, ready.tabId);
      assert.deepEqual(afterTabs, previousTabs);
      assert.equal(site.visits.filter(x => x.route === 'open').length, 1);
      report.samples.push({ route: refocus.route, name, reused: true,
        approvalToVisibleMs: shown.at - warmApproved, approvalToReadyMs: warmReady.at - warmApproved,
        additionalRequests: 0 });
      await persist();
      await modelIdle(taskId);
    } finally { release(); }
  }
  assert.deepEqual(fixture.errors, []);
  assert.deepEqual(report.failures, []);
  report.status = 'passed';
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
