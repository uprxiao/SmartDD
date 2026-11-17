// Review-owned native protocol probe. Isolated HOME; local synthetic HTTP 401;
// no real model endpoint, credentials, or daily sessions are used.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';

const root = mkdtempSync(join(tmpdir(), 'm14-review-2251-native-'));
const home = join(root, 'home'), state = join(root, 'codex'), cwd = join(root, 'project');
for (const p of [home, state, cwd]) mkdirSync(p);
const observed = { root, backend: 'loopback synthetic 401', requests: [], processes: [], native: {}, error: null };
const server = createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    let model; try { model = JSON.parse(body).model; } catch {}
    observed.requests.push({ path: req.url, method: req.method, model });
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'synthetic review endpoint', type: 'invalid_request_error', code: 'invalid_api_key' } }));
  });
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
writeFileSync(join(state, 'config.toml'), `model = "gpt-5.1-codex"\nmodel_provider = "review_local"\n[model_providers.review_local]\nname = "Local review fixture"\nbase_url = "http://127.0.0.1:${server.address().port}/v1"\nwire_api = "responses"\nenv_key = "M14_REVIEW_DUMMY_KEY"\nsupports_websockets = false\n`);
const env = { HOME: home, CODEX_HOME: state, PATH: process.env.PATH, TMPDIR: root, M14_REVIEW_DUMMY_KEY: 'synthetic-only', HTTP_PROXY: 'http://127.0.0.1:1', HTTPS_PROXY: 'http://127.0.0.1:1', ALL_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1,localhost' };
function bounded(p, ms, label) { let timer; return Promise.race([p, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout ' + label)), ms); })]).finally(() => clearTimeout(timer)); }
const peers = [];
function peer() {
  const child = spawn('/Users/liubu/.local/bin/codex', ['app-server'], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
  let seq = 0; const waiting = new Map(), notifications = []; const stderr = [];
  const processInfo = { pid: child.pid, exitCode: null, signal: null }; observed.processes.push(processInfo);
  child.stderr.on('data', b => stderr.push(b.toString('utf8')));
  const exited = new Promise(resolve => child.once('exit', (code, signal) => { processInfo.exitCode = code; processInfo.signal = signal; resolve(); }));
  createInterface({ input: child.stdout }).on('line', line => {
    let m; try { m = JSON.parse(line); } catch { return; }
    if (m.id !== undefined && !m.method) { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); m.error ? w.reject(new Error(JSON.stringify(m.error))) : w.resolve(m.result); } }
    else if (m.method) notifications.push(m);
  });
  const send = m => child.stdin.write(JSON.stringify(m) + '\n');
  const call = (method, params) => { const id = ++seq; return bounded(new Promise((resolve, reject) => { waiting.set(id, { resolve, reject }); send({ id, method, params }); }), 15000, method); };
  const p = { child, call, send, notifications, stderr, close: async () => { child.stdin.end(); try { await bounded(exited, 6000, 'normal exit'); } catch { child.kill('SIGTERM'); await bounded(exited, 3000, 'fallback exit'); } } };
  peers.push(p); return p;
}
async function init(p) { await p.call('initialize', { clientInfo: { name: 'm14_native_review', version: '1' }, capabilities: { experimentalApi: true } }); p.send({ method: 'initialized' }); }
async function until(fn) { const start = Date.now(); while (!fn()) { if (Date.now() - start > 12000) throw new Error('timeout turn ended'); await new Promise(r => setTimeout(r, 20)); } }
try {
  const p = peer(); await init(p);
  const start = await p.call('thread/start', { cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' });
  observed.native.initialModel = start.model; observed.native.threadId = start.thread.id;
  await p.call('turn/start', { threadId: start.thread.id, cwd, model: 'explicit-other', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite' }, input: [{ type: 'text', text: 'Synthetic fixture: return no tools.', text_elements: [] }] });
  await until(() => p.notifications.some(m => m.method === 'turn/completed'));
  observed.native.turnStatus = p.notifications.find(m => m.method === 'turn/completed')?.params?.turn?.status;
  await p.close();
  const q = peer(); await init(q);
  const resume = await q.call('thread/resume', { threadId: start.thread.id, cwd, approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', excludeTurns: true });
  observed.native.resumedModelWithoutOverride = resume.model;
  const config = await q.call('config/read', { cwd }); observed.native.configDefault = config.config?.model;
  await q.close();
} catch (e) { observed.error = e.message; process.exitCode = 1; }
finally {
  for (const p of peers) if (p.child.exitCode === null && !p.child.signalCode) await p.close().catch(() => {});
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync('docs/review/evidence-20261117-2251/native-resume-observations.json', JSON.stringify(observed, null, 2) + '\n');
  console.log(JSON.stringify(observed, null, 2));
}
