// E4 runner (review 20261103-1542 D01-D03 reproduction): stale @ref after DOM replacement, `wait --fn` side effects, long input.
// Records raw outputs first; verdicts come from the separate check() at the end. Usage: node run.mjs <agent-browser binary> <out dir>
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [AB, OUT] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = createRequire(join(process.cwd(), 'package.json'))('electron');
const PORT = 9370, A = 9371, B = 9372;
await mkdir(OUT, { recursive: true });
const home = await mkdtemp('/private/tmp/claude-501/e4-home-');
const userData = await mkdtemp('/private/tmp/claude-501/e4-userdata-');
const env = { ...process.env, HOME: home, AGENT_BROWSER_SOCKET_DIR: join(home, 'ab-sock'), AGENT_BROWSER_IDLE_TIMEOUT_MS: '60000' };
const result = { at: new Date().toISOString(), boundary: 'E4 experiment: local Electron 42 host (window shown off-screen, not the transparent park window) + agent-browser 0.27.3, loopback synthetic page, no WillYou gateway', steps: [], findings: {} };

const host = spawn(ELECTRON, [join(HERE, 'main.cjs'), `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E4_A_PORT: String(A), E4_B_PORT: String(B) } });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('electron not ready in 20s')), 20000);
  host.stdout.on('data', d => { const m = String(d).match(/E4_READY (\{.*\})/); if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); } });
  host.on('exit', code => reject(new Error('electron exited ' + code)));
});
function ab(command, timeout = 30000) {
  const started = performance.now();
  return new Promise(resolve => {
    const child = execFile(AB, ['--session', 'e4', '--cdp', String(PORT), 'batch', '--json'], { env, maxBuffer: 50 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
      let parsed = null; try { parsed = JSON.parse(stdout); } catch {}
      const entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : parsed;
      resolve({ command: command.map(x => String(x).length > 80 ? String(x).slice(0, 40) + `…(${String(x).length} chars)` : x), ms: Math.round(performance.now() - started), exit: error?.code ?? 0, ok: entry?.success === true, data: entry?.result ?? entry?.data ?? null, error: entry?.error ?? (error ? String(stderr || error.message).slice(0, 400) : null) });
    });
    child.stdin.end(JSON.stringify([command]));
  });
}
const short = d => { const s = JSON.stringify(d ?? null); return s.length > 1200 ? s.slice(0, 1200) + `…(${s.length} chars)` : d; };
const step = async (label, command, timeout) => { const r = await ab(command, timeout); result.steps.push({ label, ...r, data: short(r.data) }); return r; };
const refOf = (snap, role, name) => { for (const [ref, v] of Object.entries(snap?.refs ?? {})) if (v.role === role && (v.name ?? '').includes(name)) return '@' + ref; return null; };
const text = async sel => (await ab(['get', 'text', sel])).data?.text ?? null;
const evalJs = async js => (await ab(['eval', js])).data?.result ?? null;
const pb = { read: () => execFileSync('pbpaste', { encoding: 'utf8' }), write: s => execFileSync('pbcopy', { input: s }) };

const hits = () => evalJs('JSON.stringify(window.__hits)').then(v => JSON.parse(v ?? '[]'));
const count = () => evalJs('String(window.__count||0)').then(v => Number(v));
try {
  await ready;
  const tabs = (await step('tab list', ['tab', 'list'])).data?.tabs ?? [];
  const page = tabs.find(t => String(t.title).includes('E4 旧引用页'));
  if (page) await step('switch', ['tab', page.tabId]);
  await new Promise(r => setTimeout(r, 500));
  const raw = {};

  let snap = (await step('snapshot 1', ['snapshot'])).data;
  const refAction = refOf(snap, 'button', 'Action'), refOther = refOf(snap, 'button', 'Original only');
  await evalJs('replaceSameName()');
  const a = await step('click stale ref after same-name replacement', ['click', refAction]);
  raw.sameName = { ref: refAction, ok: a.ok, error: a.error, hits: await hits() };

  await evalJs('window.__hits=[]');
  snap = (await step('snapshot 2', ['snapshot'])).data;
  const refAction2 = refOf(snap, 'button', 'Action');
  await evalJs('insertBefore()');
  const b = await step('click stale ref after a same-name node is inserted before it', ['click', refAction2]);
  raw.insertedBefore = { ref: refAction2, ok: b.ok, error: b.error, hits: await hits() };

  await evalJs('window.__hits=[]');
  await evalJs('replaceOtherName()');
  const c = await step('click stale ref after replacement with a different name', ['click', refOther]);
  raw.otherName = { ref: refOther, ok: c.ok, error: c.error, hits: await hits() };

  const c0 = await count();
  const w1 = await step('wait --fn that clicks and returns true', ['wait', '--fn', '(()=>{document.getElementById("counter").click();return true})()'], 20000);
  const c1 = await count();
  const w2 = await step('wait --fn that clicks and returns false, timeout 300ms', ['wait', '--fn', '(()=>{document.getElementById("counter").click();return false})()', '--timeout', '300'], 20000);
  const c2 = await count();
  raw.waitFn = { before: c0, afterTrue: c1, afterFalse: c2, w1: { ok: w1.ok, error: w1.error }, w2: { ok: w2.ok, error: w2.error } };

  const typed = {};
  for (const [label, n, verb] of [['type 4096', 4096, 'type'], ['type 16384', 16384, 'type'], ['inserttext 65536', 65536, 'inserttext'], ['type 65536', 65536, 'type']]) {
    await evalJs("document.getElementById('long').value=''");
    await step('focus', ['focus', '#long']);
    const text = 'abcdefghij'.repeat(Math.ceil(n / 10)).slice(0, n);
    const r = await step('keyboard ' + label, ['keyboard', verb, text], 110000);
    typed[label] = { chars: n, ok: r.ok, ms: r.ms, error: r.error ? String(r.error).slice(0, 300) : null, valueLength: Number(await evalJs("String(document.getElementById('long').value.length)")) };
  }
  raw.typed = typed;
  result.raw = raw;
} catch (error) {
  result.failure = String(error?.stack || error);
} finally {
  await new Promise(r => execFile(AB, ['--session', 'e4', 'close'], { env, timeout: 15000 }, () => r()));
  host.kill();
  const r = result.raw ?? {};
  result.verdicts = {
    D01_sameNameStaleRefClicksReplacement: r.sameName ? (r.sameName.ok && r.sameName.hits.includes('replacement')) : null,
    D01_insertedBeforeChangesTarget: r.insertedBefore ? (r.insertedBefore.ok && r.insertedBefore.hits[0] !== 'original' && r.insertedBefore.hits[0] !== 'replacement' ? r.insertedBefore.hits[0] : r.insertedBefore.hits) : null,
    D01_otherNameIsReportedStale: r.otherName ? (!r.otherName.ok && /unknown ref|ref not found|element not found: @e/i.test(String(r.otherName.error))) : null,
    D02_waitFnHasSideEffects: r.waitFn ? r.waitFn.afterTrue > r.waitFn.before : null,
    D02_waitFnRepeats: r.waitFn ? r.waitFn.afterFalse - r.waitFn.afterTrue > 1 : null,
    D03_typeMsPerChar4096: r.typed?.['type 4096']?.ok ? +(r.typed['type 4096'].ms / 4096).toFixed(2) : null,
    D03_type65536Complete: r.typed ? r.typed['type 65536'].ok && r.typed['type 65536'].valueLength === 65536 : null,
    D03_inserttext65536Complete: r.typed ? r.typed['inserttext 65536'].ok && r.typed['inserttext 65536'].valueLength === 65536 : null,
  };
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ failure: result.failure, raw: result.raw, verdicts: result.verdicts }, null, 1));
}
