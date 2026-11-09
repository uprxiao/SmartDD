// E1 runner: start the Electron host, then drive its WebContentsView with agent-browser over CDP, the way Orca calls it
// (`--session X --cdp <port> batch --json`, one command as JSON on stdin). Usage: node run.mjs <agent-browser binary> <out dir>
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [AB, OUT] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = createRequire(join(process.cwd(), 'package.json'))('electron');
const PORT = 9350;
await mkdir(OUT, { recursive: true });
const home = await mkdtemp('/private/tmp/claude-501/e1-home-');
const userData = await mkdtemp('/private/tmp/claude-501/e1-userdata-');
const env = { ...process.env, HOME: home, AGENT_BROWSER_SOCKET_DIR: join(home, 'ab-sock'), AGENT_BROWSER_IDLE_TIMEOUT_MS: '60000' };
const result = { at: new Date().toISOString(), boundary: 'E1 experiment: local Electron 42 host + bundled agent-browser 0.27.3, synthetic page, no network, no WillYou gateway', electronPort: PORT, steps: [], errors: [] };

const host = spawn(ELECTRON, [join(HERE, 'main.cjs'), `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'] });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('electron not ready in 20s')), 20000);
  host.stdout.on('data', d => { const m = String(d).match(/E1_READY (\{.*\})/); if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); } });
  host.on('exit', code => reject(new Error('electron exited ' + code)));
});

function ab(command, { argv = null } = {}) {
  const args = argv ?? ['--session', 'e1', '--cdp', String(PORT), 'batch', '--json'];
  const started = performance.now();
  return new Promise(resolve => {
    const child = execFile(AB, args, { env, maxBuffer: 50 * 1024 * 1024, timeout: 30000 }, (error, stdout, stderr) => {
      const ms = Math.round(performance.now() - started);
      let parsed = null; try { parsed = JSON.parse(stdout); } catch {}
      const entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
      resolve({ command, ms, exit: error?.code ?? 0, ok: entry?.success === true, data: entry?.result ?? entry?.data ?? null, error: entry?.error ?? (error ? String(stderr || error.message).slice(0, 400) : null), stdoutBytes: stdout.length });
    });
    if (!argv) { child.stdin.end(JSON.stringify([command])); }
  });
}
const step = async (label, command, opts) => { const r = await ab(command, opts); result.steps.push({ label, ...r, data: summarize(r.data) }); return r; };
function summarize(data) { const s = JSON.stringify(data ?? null); return s.length > 1500 ? s.slice(0, 1500) + `…(${s.length} chars)` : data; }
const findRef = (snap, role, name) => { const refs = snap?.refs ?? {}; for (const [ref, v] of Object.entries(refs)) if (v.role === role && (!name || (v.name ?? '').includes(name))) return '@' + ref; return null; };

try {
  result.ids = await ready;
  result.targets = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).map(t => ({ type: t.type, title: t.title, url: t.url.slice(0, 80) }));
  await step('tab list (first attach)', ['tab', 'list']);
  const list = result.steps.at(-1);
  const tabs = list.data?.tabs ?? [];
  const page = tabs.find(t => String(t.title).includes('E1 登录页'));
  result.pageTab = page?.tabId ?? null;
  if (page) await step('switch to page tab', ['tab', page.tabId]);
  const snap = await step('snapshot', ['snapshot']);
  const textbox = findRef(snap.data, 'textbox', '用户名'), button = findRef(snap.data, 'button', '登录');
  result.refs = { textbox, button };
  await step('fill', ['fill', textbox ?? '#user', 'alice']);
  await step('click', ['click', button ?? '#go']);
  await step('click again (same page, fresh state)', ['click', button ?? '#go']);
  await step('get text', ['get', 'text', '#out']);
  const shotPath = join(OUT, 'e1-screenshot.png');
  await step('screenshot to file', ['screenshot', shotPath]);
  try { result.screenshotBytes = (await stat(shotPath)).size; } catch { result.screenshotBytes = 0; }
  await step('eval title', ['eval', 'document.title']);
  await step('reload', ['reload']);
  await step('stale ref click after reload', ['click', button ?? '@e999']);
  for (let i = 0; i < 5; i++) await step('warm snapshot ' + (i + 1), ['snapshot']);
  const warm = result.steps.filter(s => s.label.startsWith('warm snapshot')).map(s => s.ms);
  result.latency = { firstAttachMs: list.ms, warmSnapshotMs: warm, warmMedianMs: warm.sort((a, b) => a - b)[2] };
} catch (error) {
  result.failure = String(error?.stack || error);
} finally {
  await ab(['close'], { argv: ['--session', 'e1', 'close'] }).then(r => { result.closeExit = r.exit; });
  host.kill();
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ failure: result.failure, pageTab: result.pageTab, visible: result.ids?.visible, refs: result.refs, latency: result.latency, screenshotBytes: result.screenshotBytes, steps: result.steps.map(s => [s.label, s.ok, s.ms, s.error && String(s.error).slice(0, 120)]) }, null, 1));
}
