import { spawn, execFileSync } from 'node:child_process';
import { createServer as httpServer } from 'node:http';
import { createServer as netServer } from 'node:net';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const dir = new URL('.', import.meta.url).pathname;
const out = dir + (process.argv[2] ?? 'attempt-1'); mkdirSync(out, { recursive: true });
const native = '/private/tmp/willyou-m14-global-f3zh527k/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/bin/codex';
const helper = '/private/tmp/willyou-m14-owner-probe/process-identity';
const home = out + '/home', cfg = home + '/.codex', cwd = out + '/project';
for (const p of [home, cfg, cwd]) mkdirSync(p, { recursive: true });
const deferred = () => { let resolve, reject; const promise = new Promise((y, n) => { resolve = y; reject = n; }); return { promise, resolve, reject }; };
const bounded = (promise, ms = 20000) => { let t; return Promise.race([promise, new Promise((_, reject) => t = setTimeout(() => reject(Error('observation deadline')), ms))]).finally(() => clearTimeout(t)); };
const ident = pid => JSON.parse(execFileSync(helper, [String(pid)], { encoding: 'utf8' }));
const quote = text => "'" + text.replaceAll("'", "'\\''") + "'";
const log = (name, value) => appendFileSync(out + '/' + name, JSON.stringify(value) + '\n');
const checks = [], writers = [], requests = new Map();
let phase, server, child, exit, rpc, next;

async function observer(label) {
  const token = randomUUID(), ready = deferred(), gone = deferred(), replies = new Map();
  const sockets = new Set(); let writer, info;
  const s = netServer(socket => {
    sockets.add(socket); let buf = '';
    socket.on('data', bytes => {
      buf += bytes;
      while (buf.includes('\n')) {
        const pos = buf.indexOf('\n'), m = JSON.parse(buf.slice(0, pos)); buf = buf.slice(pos + 1);
        if (m.event === 'ready') { if (m.token !== token) { socket.destroy(); continue; } writer = socket; info = m; ready.resolve(m); }
        else replies.get(m.id)?.resolve(m);
      }
    });
    socket.on('error', () => {}); socket.on('close', () => { sockets.delete(socket); if (socket === writer) gone.resolve(); });
  });
  await new Promise((r, j) => { s.once('error', j); s.listen(0, '127.0.0.1', r); });
  const file = out + '/' + label + '.writes';
  const args = [dir + 'writer.mjs', String(s.address().port), token, file];
  const o = { label, args, file, command: [process.execPath, ...args].map(quote).join(' '), ready: ready.promise, gone: gone.promise,
    get pid() { return info?.pid; }, get live() { return Boolean(writer && !writer.destroyed); },
    async write(id) { const d = deferred(); replies.set(id, d); assert(this.live); writer.write(JSON.stringify({ kind: 'write', id }) + '\n'); return bounded(d.promise); },
    async stop() { if (this.live) { writer.write('{"kind":"stop"}\n'); await bounded(gone.promise); } },
    async close() { await this.stop(); for (const socket of sockets) socket.destroy(); await new Promise(r => s.close(r)); },
  }; writers.push(o); return o;
}

function respond(res, item) {
  const id = 'r' + randomUUID(); res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, v) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...v })}\n\n`);
  event('response.created', { response: { id, status: 'in_progress', output: [] } });
  event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress' } });
  if (item.type === 'message') event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
  event('response.output_item.done', { output_index: 0, item });
  event('response.completed', { response: { id, status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }); res.end();
}

async function beginThread(writer, mode = 'background') {
  phase = { id: writer.label, writer, mode, count: 0 };
  const t = await rpc('thread/start', { cwd, model: 'gpt-5.3-codex', modelProvider: 'm14', approvalPolicy: 'never', sandbox: 'danger-full-access' });
  const turn = await rpc('turn/start', { threadId: t.thread.id, input: [{ type: 'text', text: `Run isolated probe ${writer.label}.`, text_elements: [] }] });
  const done = next(m => m.method === 'turn/completed' && m.params?.threadId === t.thread.id && m.params?.turn?.id === turn.turn.id);
  return { thread: t.thread.id, turn: turn.turn.id, done };
}

async function record(id, fn) {
  try { const detail = await fn(); checks.push({ id, status: 'passed', detail }); }
  catch (e) { checks.push({ id, status: 'failed', error: e.stack }); throw e; }
  finally { writeFileSync(out + '/result.json', JSON.stringify({ scope: 'Actual managed Codex 0.167.1 app-server and native execution tools; fake local model, isolated files/home; not WillYou/T3 production lifecycle.', checks }, null, 2)); }
}

let failure;
try {
  server = httpServer(async (req, res) => {
    try {
      let raw = ''; for await (const b of req) raw += b;
      const body = JSON.parse(raw); assert(req.url.includes('/responses'));
      const p = phase; assert(p); p.count++; assert(p.count <= 4);
      const tools = (body.tools ?? []).flatMap(t => t.type === 'namespace' ? (t.tools ?? []).map(x => ({ ...x, namespace: t.name })) : [t]);
      const tool = tools.find(t => t.name === 'exec_command');
      const outputs = (body.input ?? []).filter(x => x.type === 'function_call_output');
      log('model.jsonl', { phase: p.id, count: p.count, model: body.model, tools: tools.map(t => ({ name: t.name, namespace: t.namespace })), outputs });
      if (p.count === 1) {
        assert(tool, 'exec_command not offered by this native configuration');
        writeFileSync(out + '/' + p.id + '-exec-tool.json', JSON.stringify(tool, null, 2));
        respond(res, { id: 'fc' + randomUUID(), type: 'function_call', status: 'completed', call_id: 'call' + randomUUID(), name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify({ cmd: p.writer.command, yield_time_ms: p.mode === 'foreground' ? 30000 : 1000, max_output_tokens: 1000 }) });
      } else respond(res, { id: 'm' + randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'PROBE_STARTED', annotations: [] }] });
    } catch (e) { failure ??= e; log('model-error.jsonl', { error: e.stack }); res.writeHead(500); res.end('{}'); }
  });
  await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
  const env = { HOME: home, CODEX_HOME: cfg, PATH: '/usr/bin:/bin', TMPDIR: out, WY_MOCK_KEY: 'synthetic-only', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: 'localhost,127.0.0.1' };
  const args = ['app-server', '--disable', 'plugins', '-c', 'analytics.enabled=false', '-c', 'features.unified_exec=true', '-c', 'model_provider="m14"', '-c', `model_providers.m14={name="m14",base_url="http://127.0.0.1:${server.address().port}/v1",wire_api="responses",env_key="WY_MOCK_KEY"}`];
  child = spawn(native, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  exit = new Promise((r, j) => { child.once('exit', (code, signal) => r({ code, signal })); child.once('error', j); }); exit.catch(() => {});
  log('process.jsonl', { event: 'spawn', pid: child.pid, identity: ident(child.pid) });
  child.stderr.on('data', b => appendFileSync(out + '/native.stderr', b));
  let seq = 0; const events = [], waiters = [];
  createInterface({ input: child.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    log('wire.jsonl', { direction: 'in', ...m });
    if (m.id !== undefined && !m.method) { const d = requests.get(m.id); if (d) { requests.delete(m.id); m.error ? d.reject(Error(JSON.stringify(m.error))) : d.resolve(m.result); } }
    else {
      events.push(m);
      if (m.id !== undefined && m.method) child.stdin.write(JSON.stringify({ id: m.id, error: { code: -32601, message: 'No external approval in isolated probe' } }) + '\n');
      for (const w of [...waiters]) if (w.match(m)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(m); }
    }
  });
  rpc = (method, params) => { const d = deferred(), id = ++seq; requests.set(id, d); const m = { id, method, params }; log('wire.jsonl', { direction: 'out', ...m }); child.stdin.write(JSON.stringify(m) + '\n'); return bounded(d.promise); };
  next = match => { const existing = events.find(match); return existing ? Promise.resolve(existing) : new Promise(resolve => waiters.push({ match, resolve })); };
  await rpc('initialize', { clientInfo: { name: 'm14_codex_scope', version: '1' }, capabilities: { experimentalApi: true } }); child.stdin.write('{"method":"initialized"}\n');
  let a, at, b, bt;
  await record('C01-native-exec-session-survives-turn-completion', async () => {
    a = await observer('A'); at = await beginThread(a); await bounded(a.ready); const done = await bounded(at.done);
    assert.equal(done.params.turn.status, 'completed'); await a.write('after-turn-completed');
    return { ...at, done: undefined, writer: a.pid, identity: ident(a.pid), turnStatus: done.params.turn.status };
  });
  await record('C02-thread-unsubscribe-versus-shared-sibling', async () => {
    b = await observer('B'); bt = await beginThread(b); await bounded(b.ready); await bounded(bt.done);
    const ack = await rpc('thread/unsubscribe', { threadId: at.thread });
    const loadedAfterAck = await rpc('thread/loaded/list', {});
    const closedAtCheck = events.some(m => m.method === 'thread/closed' && m.params?.threadId === at.thread);
    const afterClosed = ident(a.pid); let stillWrites = false;
    if (afterClosed.state === 'running' && a.live) { await a.write('after-unsubscribe-ack'); stillWrites = true; }
    await b.write('sibling-after-unsubscribe'); assert.equal(ident(b.pid).state, 'running');
    if (a.live) await a.stop();
    const loadedAfterWriterStop = await rpc('thread/loaded/list', {});
    return { ack, closedAtCheck, loadedAfterAck, loadedAfterWriterStop, writerAfterUnsubscribe: afterClosed, stillWrites, siblingIdentity: ident(b.pid), serverIdentity: ident(child.pid) };
  });
  await record('C03-interrupt-active-native-command', async () => {
    const c = await observer('C'); const ct = await beginThread(c, 'foreground'); await bounded(c.ready);
    const ack = await rpc('turn/interrupt', { threadId: ct.thread, turnId: ct.turn }); const done = await bounded(ct.done);
    const state = ident(c.pid); let stillWrites = false;
    if (state.state === 'running' && c.live) { await c.write('after-turn-interrupt'); stillWrites = true; }
    if (c.live) await c.stop();
    assert.equal(done.params.turn.status, 'interrupted'); await b.write('sibling-after-turn-interrupt');
    return { ack, status: done.params.turn.status, writerIdentity: state, stillWrites, siblingIdentity: ident(b.pid) };
  });
  await record('C04-explicit-command-exec-id-and-terminate', async () => {
    const d = await observer('D'), processId = 'isolated-' + randomUUID();
    const completed = rpc('command/exec', { command: [process.execPath, ...d.args], processId, cwd, disableTimeout: true, streamStdoutStderr: true, sandboxPolicy: { type: 'dangerFullAccess' } }); completed.catch(() => {});
    await bounded(d.ready); await d.write('before-explicit-terminate');
    let wrongRejected = false;
    try { await rpc('command/exec/terminate', { processId: 'unknown-' + processId }); } catch { wrongRejected = true; }
    assert(wrongRejected); await d.write('after-wrong-process-id');
    const ack = await rpc('command/exec/terminate', { processId }); const end = await completed; await bounded(d.gone);
    assert.equal(ident(d.pid).state, 'stopped'); await b.write('sibling-after-command-terminate');
    return { processId, wrongRejected, ack, end, writerIdentity: ident(d.pid), siblingIdentity: ident(b.pid) };
  });
  await record('C06-native-background-terminal-scope-and-targeted-stop', async () => {
    const e = await observer('E'), et = await beginThread(e); await bounded(e.ready); await bounded(et.done);
    const listed = await rpc('thread/backgroundTerminals/list', { threadId: et.thread });
    assert.equal(listed.data.length, 1); const terminal = listed.data[0];
    const item = events.find(m => m.method === 'item/started' && m.params?.threadId === et.thread && m.params?.item?.type === 'commandExecution');
    assert.equal(item.params.item.processId, terminal.processId);
    let wrongThread, wrongNamespace;
    try { wrongThread = await rpc('thread/backgroundTerminals/terminate', { threadId: bt.thread, processId: terminal.processId }); }
    catch (err) { wrongThread = { error: err.message }; }
    await e.write('after-wrong-thread'); await b.write('sibling-after-wrong-thread');
    try { wrongNamespace = await rpc('command/exec/terminate', { processId: terminal.processId }); }
    catch (err) { wrongNamespace = { error: err.message }; }
    await e.write('after-wrong-command-namespace');
    const ack = await rpc('thread/backgroundTerminals/terminate', { threadId: et.thread, processId: terminal.processId });
    await bounded(e.gone); assert.equal(ident(e.pid).state, 'stopped');
    const remaining = await rpc('thread/backgroundTerminals/list', { threadId: et.thread });
    assert(!remaining.data.some(t => t.processId === terminal.processId)); await b.write('sibling-after-native-terminal-stop');
    return { nativeThread: et.thread, terminal, wrongThread, wrongNamespace, ack, remaining, writerIdentity: ident(e.pid), siblingIdentity: ident(b.pid) };
  });
  await record('C05-app-server-stdin-close-and-remaining-thread', async () => {
    await b.write('before-app-server-close'); child.stdin.end(); const ended = await bounded(exit, 10000);
    const state = ident(b.pid); let stillWrites = false;
    if (state.state === 'running' && b.live) { await b.write('after-app-server-exit'); stillWrites = true; }
    if (b.live) await b.stop();
    return { ended, writerIdentity: state, stillWrites, appServerIdentity: ident(child.pid) };
  });
} catch (e) { failure ??= e; }
finally {
  for (const w of writers) await w.close().catch(e => { failure ??= e; });
  if (child && child.exitCode === null && child.signalCode === null) { child.kill('SIGTERM'); try { await bounded(exit, 5000); } catch { child.kill('SIGKILL'); await bounded(exit, 5000); } }
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  const cleanup = { appServer: child ? { pid: child.pid, identity: ident(child.pid), exit: await exit } : null, writers: writers.map(w => ({ label: w.label, pid: w.pid, identity: w.pid ? ident(w.pid) : null })) };
  writeFileSync(out + '/cleanup.json', JSON.stringify(cleanup, null, 2));
  writeFileSync(out + '/result.json', JSON.stringify({ scope: 'Actual managed Codex 0.167.1 app-server and native execution tools; fake local model, isolated files/home; not WillYou/T3 production lifecycle.', checks, error: failure?.stack }, null, 2));
  writeFileSync(out + '/runtime-inputs.json', JSON.stringify({ node: process.version, native, nativeSha256: createHash('sha256').update(readFileSync(native)).digest('hex'), helperSha256: createHash('sha256').update(readFileSync(helper)).digest('hex') }, null, 2));
}
console.log(JSON.stringify({ passed: checks.filter(x => x.status === 'passed').length, checks, error: failure?.stack }));
process.exitCode = failure ? 1 : 0;
