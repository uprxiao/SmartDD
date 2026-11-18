// Development App and installed Codex with an isolated, synthetic model endpoint.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { openElectron, pause } from '../lib/electron-harness.mjs';

const output = process.argv[2];
assert(output, 'Supply a new evidence directory');
mkdirSync(output, { recursive: true });
const root = realpathSync(mkdtempSync('/private/tmp/willyou-m14-independent-'));
const fixtureHome = join(root, 'home');
const userData = join(root, 'data');
mkdirSync(fixtureHome);
mkdirSync(userData);
const cwdByKind = { git: join(root, 'git'), svn: join(root, 'svn'), plain: join(root, 'plain') };
const evidence = { layer: 'development App / real Codex / synthetic loopback model', root, assertions: [], actions: [], requests: [], passed: false };
const gates = new Map();
const markerPattern = /WY_PARALLEL_(?:GIT|SVN|PLAIN)_(?:FIRST|SECOND|RESUME)/g;
let app;

function endTurn(res, text) {
  const id = randomUUID();
  const item = { id: randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] };
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, value) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
  event('response.created', { response: { id, status: 'in_progress', output: [] } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
  event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: text });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  res.end();
}

const server = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: [{ id: 'parallel-fixture' }] }));
      return;
    }
    if (req.method !== 'POST' || !req.url?.includes('responses')) { res.writeHead(404); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const input = typeof body.input === 'string' ? body.input : JSON.stringify(body.input ?? []);
    const marker = [...input.matchAll(markerPattern)].at(-1)?.[0];
    assert(marker, 'Expected one of the scoped prompt markers');
    evidence.requests.push({ marker, receivedAt: Date.now() });
    const gate = gates.get(marker);
    if (gate) await gate.promise;
    endTurn(res, `ANSWER_${marker}`);
  } catch (error) {
    evidence.serverError = String(error);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

async function waitUntil(predicate, label, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (evidence.serverError) throw Error(evidence.serverError);
    if (await predicate()) return;
    await pause(100);
  }
  throw Error(`Timed out waiting for ${label}`);
}

async function click(selector) {
  const point = await app.evaluate(`(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node || node.disabled) return null; const r = node.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; return r.width && r.height && node.contains(document.elementFromPoint(x,y)) ? {x,y} : null; })()`);
  assert(point, `Control unavailable: ${selector}`);
  for (const type of ['mousePressed', 'mouseReleased']) await app.cdp('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  evidence.actions.push({ selector, ...point });
}

async function send(task, marker) {
  const selector = `[data-testid="sidebar-agent-task"][data-task-id="${task.taskId}"]`;
  await app.waitFor(`!!document.querySelector(${JSON.stringify(selector)})`, 20_000);
  await click(selector);
  await app.waitFor(`document.querySelector('.agent-task-head h1')?.textContent === ${JSON.stringify(task.title)}`, 20_000);
  await click('.agent-task-view textarea');
  await app.cdp('Input.insertText', { text: marker });
  await click('.agent-task-view button[type="submit"]');
}

async function snapshot(task) {
  const state = await app.invoke('agentTasks.snapshot', task.taskId);
  const error = state.items.find(item => item.type === 'error');
  if (error) throw Error(JSON.stringify(error.payload));
  return state;
}

async function settled(task, marker) {
  await waitUntil(async () => {
    const state = await snapshot(task);
    return state.status === 'completed' && !state.run?.busy && state.items.some(item => item.type === 'assistant_message' && item.payload.text === `ANSWER_${marker}`);
  }, marker);
  return snapshot(task);
}

try {
  mkdirSync(cwdByKind.git);
  mkdirSync(cwdByKind.plain);
  const gitOptions = { stdio: 'pipe', env: { ...process.env, HOME: fixtureHome, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' } };
  execFileSync('git', ['init', '-qb', 'main', cwdByKind.git], gitOptions);
  execFileSync('git', ['-C', cwdByKind.git, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'fixture'], gitOptions);
  const svnRepository = join(root, 'svn-repository');
  execFileSync('svnadmin', ['create', svnRepository], { stdio: 'pipe' });
  execFileSync('svn', ['checkout', '--non-interactive', '--config-dir', join(root, 'svn-config'), `file://${svnRepository}`, cwdByKind.svn], { stdio: 'pipe' });

  // Match the verified local provider preset used by the other isolated M14 smokes.
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(3425, '127.0.0.1', resolve); });
  const endpoint = `http://127.0.0.1:${server.address().port}`;
  app = await openElectron({ userData, env: { HOME: fixtureHome, CODEX_HOME: join(fixtureHome, '.codex'), CLAUDE_CONFIG_DIR: join(fixtureHome, '.claude') }, inspectMain: true });
  await app.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await app.invoke('agents.refreshTools');
  const tools = await app.invoke('agents.tools');
  const codex = tools.find(tool => tool.kind === 'codex' && tool.installed);
  assert(codex, 'Codex CLI installed');
  evidence.nativeVersion = codex.version;
  const provider = await app.invoke('agents.saveProvider', { name: 'Local parallel fixture', preset: 'magpie', endpoints: { responses: `${endpoint}/v1`, anthropic: `${endpoint}/` }, models: [{ id: 'parallel-fixture', name: 'parallel-fixture' }] });
  const profile = await app.invoke('agents.save', { name: 'Parallel fixture', toolId: codex.id, source: 'provider', providerId: provider.id, models: ['parallel-fixture'], defaultModel: 'parallel-fixture', isDefault: true });
  const pairs = [];
  // Load the sidebar after fixture preparation so it reads the complete project list.
  for (const [kind, cwd] of Object.entries(cwdByKind)) {
    const project = await app.invoke('projects.create', { name: `Parallel ${kind}`, aliases: [], description: '', rulesPath: null }, [{ label: 'work', path: cwd }]);
    const createTask = async side => {
      const title = `${kind} independent ${side}`;
      const result = await app.invoke('agentTasks.create', { projectId: project.id, dirId: project.dirs[0].id, cwd, title, profileId: profile.id, model: 'parallel-fixture', tier: 'ask' });
      return { ...result, title };
    };
    pairs.push({ kind, first: await createTask('first'), second: await createTask('second') });
  }
  await app.evaluate("localStorage.setItem('willyou-m14-agent-workspace','true'); location.reload(); true");
  await app.waitFor("!!document.querySelector('.agent-model-pill')", 20_000);

  for (const { kind, first, second } of pairs) {
    const marker = side => `WY_PARALLEL_${kind.toUpperCase()}_${side}`;
    const gate = {};
    gate.promise = new Promise(resolve => { gate.release = resolve; });
    gates.set(marker('FIRST'), gate);
    await send(first, marker('FIRST'));
    await waitUntil(() => evidence.requests.some(row => row.marker === marker('FIRST')), `${kind} first native request`);
    const held = await snapshot(first);
    assert(held.run?.busy);
    await send(second, marker('SECOND'));
    const secondCompleted = await settled(second, marker('SECOND'));
    const stillHeld = await snapshot(first);
    assert.equal(stillHeld.run?.runId, held.run.runId);
    assert(stillHeld.run.busy);
    assert(secondCompleted.run?.runId && secondCompleted.run.runId !== held.run.runId);
    for (const task of [first, second]) {
      const relations = await app.invoke('agentTasks.relations', task.taskId);
      assert.equal(relations.queue ?? null, null);
    }
    gate.release();
    await settled(first, marker('FIRST'));
    await send(first, marker('RESUME'));
    const continued = await settled(first, marker('RESUME'));
    assert.equal(continued.run?.runId, held.run.runId);
    evidence.assertions.push({ kind, firstRun: held.run.runId, secondRun: secondCompleted.run.runId, continuedRun: continued.run.runId, secondCompletedWithFirstStillRunning: true, directoryQueueEntries: 0 });
    const screenshot = await app.cdp('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(output, `${kind}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  assert.deepEqual(app.rendererErrors, []);
  evidence.passed = true;
} catch (error) {
  evidence.error = String(error.stack ?? error);
  if (app) {
    try { evidence.visible = await app.evaluate('document.body.innerText'); } catch { /* target may have closed */ }
  }
} finally {
  for (const gate of gates.values()) gate.release();
  if (app) {
    try {
      await app.mainEvaluate(`(() => { const electron = process.getBuiltinModule('module').createRequire(process.cwd() + '/package.json')('electron'); if (electron.app.getPath('userData') !== ${JSON.stringify(userData)}) throw Error('Test App identity changed'); setTimeout(() => electron.app.quit(), 50); return true; })()`);
      evidence.exit = await app.waitForExit(20_000);
    } catch (error) {
      evidence.exitError = String(error);
      await app.crash();
    }
    evidence.rendererErrors = app.rendererErrors;
    evidence.appLogs = app.logs();
  }
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  evidence.passed = evidence.passed && evidence.exit?.code === 0 && !evidence.exit?.signal && !evidence.rendererErrors?.length && !evidence.serverError;
  writeFileSync(join(output, 'result.json'), JSON.stringify(evidence, null, 2) + '\n');
}

if (!evidence.passed) process.exitCode = 1;
