import { spawnClaudeProcessGroup } from './extracted.mjs';
import { createServer as netServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { query } from '/private/tmp/willyou-m14-global-f3zh527k/node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs';

const dir = new URL('.', import.meta.url).pathname;
const attempt = process.argv[2] ?? 'attempt-1';
const out = dir + attempt; mkdirSync(out, { recursive: true });
const helper = '/private/tmp/willyou-m14-owner-probe/process-identity';
const native = '/private/tmp/willyou-m14-global-f3zh527k/node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude';
const rows = [];
const deferred = () => { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };
const bounded = (promise, ms = 15000) => { let timer; return Promise.race([promise, new Promise((_, reject) => timer = setTimeout(() => reject(Error('probe observation deadline')), ms))]).finally(() => clearTimeout(timer)); };
const identity = pid => JSON.parse(execFileSync(helper, [String(pid)], { encoding: 'utf8' }));
const track = child => { const done = deferred(); child.once('exit', (code, signal) => done.resolve({ code, signal })); child.once('error', done.reject); done.promise.catch(() => {}); return done.promise; };
const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";

async function observer(id) {
  const token = randomUUID(), ready = deferred(), gone = deferred(), replies = new Map();
  const connections = new Set(); let writer, readyInfo;
  const server = netServer(socket => {
    connections.add(socket); let pending = '';
    socket.on('data', bytes => {
      pending += bytes;
      while (pending.includes('\n')) {
        const pos = pending.indexOf('\n'), raw = pending.slice(0, pos); pending = pending.slice(pos + 1);
        const event = JSON.parse(raw);
        if (event.event === 'ready') {
          if (event.token !== token) { socket.destroy(); continue; }
          writer = socket; readyInfo = event; ready.resolve(event);
        } else replies.get(event.id)?.resolve(event);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => { connections.delete(socket); if (writer === socket) gone.resolve(); });
  });
  await new Promise((yes, no) => { server.once('error', no); server.listen(0, '127.0.0.1', yes); });
  const file = out + '/' + id + '.writes';
  return { token, port: server.address().port, file, ready: ready.promise, gone: gone.promise,
    get live() { return Boolean(writer && !writer.destroyed); },
    async write(label) { const d = deferred(); replies.set(label, d); writer.write(JSON.stringify({ kind: 'write', id: label }) + '\n'); return bounded(d.promise); },
    async stop() { if (writer && !writer.destroyed) { writer.write('{"kind":"stop"}\n'); await bounded(gone.promise); } },
    async close() { await this.stop(); for (const socket of connections) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
    get info() { return readyInfo; },
  };
}

async function run(id, fn) {
  if (process.argv[3] && !process.argv[3].split(',').some(prefix => id.startsWith(prefix))) return;
  const trace = []; const mark = (event, detail = {}) => trace.push({ ...detail, event });
  let error;
  try { await fn(mark); } catch (e) { error = e; }
  rows.push({ id, passed: !error, error: error?.stack, trace });
  writeFileSync(out + '/result.json', JSON.stringify({ scope: 'Actual extracted T3 group helper and actual Claude SDK with fake loopback model; no full T3 descendant tracker or WillYou launcher.', rows }, null, 2));
  console.log(id, error ? error.stack : 'passed');
}

await run('G01-registration-gate-and-normal-group-exit', async mark => {
  const o = await observer('G01'); let child, end;
  const marker = out + '/G01-root-started';
  try {
    child = spawnClaudeProcessGroup({ command: process.execPath, args: [dir + 'root.mjs', 'ordinary', String(o.port), o.token, o.file, marker], cwd: out, env: process.env }, undefined, () => {}, () => {}, pid => {
      assert(!existsSync(marker)); mark('registered-before-execution', { pid, identity: identity(pid) }); return () => mark('registration-forgotten');
    });
    end = track(child); child.stdout.resume();
    const writer = await bounded(o.ready); mark('writer-started', { ...writer, token: undefined, identity: identity(writer.pid) });
    await o.write('before-root-exit'); child.stdin.write('exit\n');
    mark('root-exit', await bounded(end)); await bounded(o.gone);
    const state = identity(writer.pid); mark('writer-after-group-exit', state); assert.equal(state.state, 'stopped');
  } finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); if (end) await bounded(end); await o.close(); }
});

await run('G02-register-failure-does-not-execute-target', async mark => {
  const marker = out + '/G02-must-not-exist', exited = deferred(); let registered;
  assert.throws(() => spawnClaudeProcessGroup({ command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad')`], cwd: out, env: process.env }, exited.resolve, () => {}, () => {}, pid => {
    registered = pid; throw Error('registration rejected');
  }), /registration rejected/);
  await bounded(exited.promise); assert(!existsSync(marker)); mark('failed-registration-cleaned', { pid: registered, identity: identity(registered) });
});

await run('G03-host-crash-EOF-watcher-cleans-ordinary-group', async mark => {
  const o = await observer('G03'); let host, end; const registered = deferred();
  try {
    host = spawn(process.execPath, [dir + 'supervisor.mjs', String(o.port), o.token, o.file, out + '/G03-started'], { cwd: out, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    end = track(host); host.stderr.resume(); let lines = '';
    host.stdout.on('data', data => { lines += data; if (lines.includes('\n')) registered.resolve(JSON.parse(lines.split('\n')[0])); });
    const root = await bounded(registered.promise), writer = await bounded(o.ready);
    await o.write('before-host-crash'); mark('live-before-host-crash', { host: host.pid, root: root.pid, writer: writer.pid });
    host.kill('SIGKILL'); await bounded(end); await bounded(o.gone);
    mark('writer-after-host-crash', identity(writer.pid)); assert.equal(identity(writer.pid).state, 'stopped');
    mark('root-after-host-crash', identity(root.pid)); assert.equal(identity(root.pid).state, 'stopped');
  } finally { if (host && host.exitCode === null && host.signalCode === null) host.kill('SIGKILL'); if (end) await bounded(end); await o.close(); }
});

await run('G04-group-only-negative-control-escaped-writer', async mark => {
  const o = await observer('G04'); let child, end;
  try {
    child = spawnClaudeProcessGroup({ command: process.execPath, args: [dir + 'root.mjs', 'escaped', String(o.port), o.token, o.file, out + '/G04-started'], cwd: out, env: process.env });
    end = track(child); child.stdout.resume(); const writer = await bounded(o.ready);
    child.stdin.write('exit\n'); await bounded(end);
    const written = await o.write('after-root-and-group-exit'); mark('escaped-writer-still-writes', { ...written, identity: identity(writer.pid) });
    assert(readFileSync(o.file, 'utf8').includes('after-root-and-group-exit'));
    await o.stop(); mark('explicit-control-pipe-cleanup', identity(writer.pid));
  } finally { if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); if (end) await bounded(end); await o.close(); }
});

await run('G06-two-owned-groups-do-not-kill-sibling', async mark => {
  const first = await observer('G06-first'), second = await observer('G06-second');
  const owned = [];
  try {
    for (const [i, o] of [first, second].entries()) {
      const child = spawnClaudeProcessGroup({ command: process.execPath, args: [dir + 'root.mjs', 'ordinary', String(o.port), o.token, o.file, out + '/G06-root-' + i], cwd: out, env: process.env });
      const end = track(child); child.stdout.resume(); owned.push({ child, end }); await bounded(o.ready);
    }
    owned[0].child.stdin.write('exit\n'); await bounded(owned[0].end); await bounded(first.gone);
    await second.write('sibling-after-first-stop');
    mark('sibling-still-running', { firstWriter: identity(first.info.pid), secondWriter: identity(second.info.pid) });
    assert.equal(identity(first.info.pid).state, 'stopped'); assert.equal(identity(second.info.pid).state, 'running');
    owned[1].child.stdin.write('exit\n'); await bounded(owned[1].end); await bounded(second.gone);
    assert.equal(identity(second.info.pid).state, 'stopped'); mark('both-cleaned');
  } finally {
    for (const { child, end } of owned) { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await bounded(end); }
    await first.close(); await second.close();
  }
});

for (const stopMode of ['close', 'task']) await run(stopMode === 'close' ? 'G05-real-SDK-background-Bash-and-session-close' : 'G07-real-SDK-targeted-background-stop', async mark => {
  const o = await observer(stopMode === 'close' ? 'G05' : 'G07'); const home = out + '/sdk-home'; mkdirSync(home, { recursive: true });
  let model, child, end, q, consume, requests = 0, taskId;
  const final = deferred(), hold = deferred(), stopped = deferred(), empty = deferred();
  const command = [process.execPath, dir + 'writer.mjs', String(o.port), o.token, o.file].map(quote).join(' ');
  try {
    model = httpServer((req, res) => {
      let raw = ''; req.on('data', bytes => raw += bytes);
      req.on('end', () => {
        try {
          assert(req.url.startsWith('/v1/messages')); const body = JSON.parse(raw); requests++;
          assert(requests <= 4, 'unexpected model loop');
          const toolResults = (body.messages ?? []).flatMap(m => Array.isArray(m.content) ? m.content : []).filter(x => x.type === 'tool_result');
          mark('fake-model-request', { ordinal: requests, model: body.model, toolResults });
          const invoke = requests === 1;
          if (invoke) assert((body.tools ?? []).some(t => t.name === 'Bash'));
          res.writeHead(200, { 'content-type': 'text/event-stream' });
          const emit = (type, payload) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
          emit('message_start', { message: { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', model: body.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 } } });
          emit('content_block_start', { index: 0, content_block: invoke ? { type: 'tool_use', id: 'toolu_bg', name: 'Bash', input: {} } : { type: 'text', text: '' } });
          emit('content_block_delta', { index: 0, delta: invoke ? { type: 'input_json_delta', partial_json: JSON.stringify({ command, run_in_background: true, description: 'Start isolated local probe writer' }) } : { type: 'text_delta', text: 'BACKGROUND_STARTED' } });
          emit('content_block_stop', { index: 0 }); emit('message_delta', { delta: { stop_reason: invoke ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }); emit('message_stop', {}); res.end();
        } catch (e) { final.reject(e); res.writeHead(500); res.end('{}'); }
      });
    });
    await new Promise((resolve, reject) => { model.once('error', reject); model.listen(0, '127.0.0.1', resolve); });
    const prompt = (async function* () { yield { type: 'user', uuid: randomUUID(), session_id: '', parent_tool_use_id: null, message: { role: 'user', content: 'Run the isolated background probe, then report BACKGROUND_STARTED.' } }; await hold.promise; })();
    q = query({ prompt, options: {
      pathToClaudeCodeExecutable: native, cwd: out, model: 'claude-sonnet-4-6', settingSources: [], tools: ['Bash'],
      canUseTool: async (tool, input) => { mark('permission-callback', { tool, exactCommand: input.command === command }); return tool === 'Bash' && input.command === command ? { behavior: 'allow', updatedInput: input } : { behavior: 'deny', message: 'Only the isolated probe command is allowed' }; },
      env: { HOME: home, PATH: '/usr/bin:/bin', TMPDIR: out, CLAUDE_CONFIG_DIR: home + '/.claude', ANTHROPIC_BASE_URL: `http://127.0.0.1:${model.address().port}`, ANTHROPIC_AUTH_TOKEN: 'synthetic-only', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', DISABLE_AUTOUPDATER: '1', ENABLE_TOOL_SEARCH: 'false' },
      spawnClaudeCodeProcess: options => {
        child = spawnClaudeProcessGroup(options, undefined, () => {}, () => {}, pid => { mark('SDK-registered-before-release', { pid, identity: identity(pid) }); return () => {}; });
        end = track(child); return child;
      },
    } });
    consume = (async () => { for await (const message of q) {
      if (message.type === 'result') { mark('SDK-result', { subtype: message.subtype, result: message.result }); final.resolve(message); }
      else if (message.type === 'system') {
        mark('SDK-system', { subtype: message.subtype, task_id: message.task_id, run_id: message.run_id, status: message.status, tasks: message.tasks });
        if (message.subtype === 'task_started') taskId = message.task_id;
        if (message.subtype === 'task_notification' && message.status === 'stopped') stopped.resolve(message);
        if (message.subtype === 'background_tasks_changed' && message.tasks?.length === 0) empty.resolve(message);
      }
    } })(); consume.catch(final.reject); final.promise.catch(() => {});
    const result = await bounded(final.promise, 45000); assert.equal(result.subtype, 'success');
    const writer = await bounded(o.ready); await o.write('after-SDK-result'); mark('writes-after-turn-result', { writer: writer.pid, identity: identity(writer.pid) });
    if (stopMode === 'task') {
      assert(taskId); await q.stopTask(taskId); mark('stopTask-control-returned', { taskId });
      await bounded(o.gone); await bounded(stopped.promise); await bounded(empty.promise);
      assert.equal(identity(writer.pid).state, 'stopped'); assert.equal(identity(child.pid).state, 'running');
      mark('native-task-stopped-process-still-running', { writer: identity(writer.pid), cli: identity(child.pid) });
    }
    q.close(); hold.resolve(); mark('SDK-process-exit', await bounded(end));
    // A deadline is only an observation window, never proof that a process exited.
    let closed = false; await bounded(o.gone, 2000).then(() => closed = true, () => {});
    const writerState = identity(writer.pid); mark('background-after-session-close', { socketClosed: closed, identity: writerState });
    if (writerState.state === 'running' && o.live) {
      await o.write('after-SDK-session-close'); mark('negative-control-background-survived-close');
      await o.stop();
    } else assert.equal(writerState.state, 'stopped');
    await bounded(consume, 5000).catch(e => mark('consumer-close', { message: e.message }));
    mark('explicit-final-cleanup', identity(writer.pid));
  } finally {
    q?.close(); hold.resolve();
    if (child && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    if (end) await bounded(end).catch(() => {}); await o.close();
    if (model) { model.closeAllConnections(); await new Promise(resolve => model.close(resolve)); }
  }
});

writeFileSync(out + '/runtime-inputs.json', JSON.stringify({ node: process.version, nativePath: native, nativeSha256: createHash('sha256').update(readFileSync(native)).digest('hex'), helperSha256: createHash('sha256').update(readFileSync(helper)).digest('hex') }, null, 2));
console.log(JSON.stringify({ passed: rows.filter(r => r.passed).length, total: rows.length }));
process.exitCode = rows.every(r => r.passed) ? 0 : 1;
