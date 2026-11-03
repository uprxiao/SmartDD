// E3 runner: snapshot coverage of iframes / shadow DOM, `find` locators, Orca's `intercept enable` (= `network route <pattern>`),
// clipboard target, and long `keyboard type`. Usage: node run.mjs <agent-browser binary> <out dir>
import { spawn, execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const [AB, OUT] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = createRequire(join(process.cwd(), 'package.json'))('electron');
const PORT = 9360, A = 9361, B = 9362;
await mkdir(OUT, { recursive: true });
const home = await mkdtemp('/private/tmp/claude-501/e3-home-');
const userData = await mkdtemp('/private/tmp/claude-501/e3-userdata-');
const env = { ...process.env, HOME: home, AGENT_BROWSER_SOCKET_DIR: join(home, 'ab-sock'), AGENT_BROWSER_IDLE_TIMEOUT_MS: '60000' };
const result = { at: new Date().toISOString(), boundary: 'E3 experiment: local Electron 42 host + agent-browser 0.27.3, loopback synthetic pages on two origins, no external network, no WillYou gateway', steps: [], findings: {} };

const host = spawn(ELECTRON, [join(HERE, 'main.cjs'), `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E3_A_PORT: String(A), E3_B_PORT: String(B) } });
const ready = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('electron not ready in 20s')), 20000);
  host.stdout.on('data', d => { const m = String(d).match(/E3_READY (\{.*\})/); if (m) { clearTimeout(timer); resolve(JSON.parse(m[1])); } });
  host.on('exit', code => reject(new Error('electron exited ' + code)));
});
function ab(command, timeout = 30000) {
  const started = performance.now();
  return new Promise(resolve => {
    const child = execFile(AB, ['--session', 'e3', '--cdp', String(PORT), 'batch', '--json'], { env, maxBuffer: 50 * 1024 * 1024, timeout }, (error, stdout, stderr) => {
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

let savedClipboard = null;
try {
  await ready;
  const tabs = (await step('tab list', ['tab', 'list'])).data?.tabs ?? [];
  const page = tabs.find(t => String(t.title).includes('E3 覆盖页'));
  if (page) await step('switch', ['tab', page.tabId]);
  await new Promise(r => setTimeout(r, 500));

  const snap = (await step('snapshot (Orca default, no flags)', ['snapshot'])).data;
  result.snapshotText = snap?.snapshot;
  const want = { 主页面输入: ['textbox', '主页面输入'], 同源框输入: ['textbox', '同源框输入'], 跨源框输入: ['textbox', '跨源框输入'], 开放影子输入: ['textbox', '开放影子输入'], 封闭影子输入: ['textbox', '封闭影子输入'], 同源框按钮: ['button', '同源框按钮'], 跨源框按钮: ['button', '跨源框按钮'], 开放影子按钮: ['button', '开放影子按钮'], 封闭影子按钮: ['button', '封闭影子按钮'] };
  const coverage = {};
  for (const [k, [role, name]] of Object.entries(want)) coverage[k] = { ref: refOf(snap, role, name) };
  const reads = {
    同源框输入: () => evalJs("document.getElementById('same').contentDocument.getElementById('fi').value"),
    开放影子输入: () => evalJs("document.getElementById('open-host').shadowRoot.getElementById('so').value"),
    封闭影子输入: () => evalJs("window.__closed.getElementById('sc').value"),
    主页面输入: () => evalJs("document.getElementById('main').value"),
  };
  for (const k of ['主页面输入', '同源框输入', '跨源框输入', '开放影子输入', '封闭影子输入']) {
    const ref = coverage[k].ref; if (!ref) continue;
    const r = await step(`fill ${k}`, ['fill', ref, 'E3值']);
    coverage[k].fill = r.ok; coverage[k].fillError = r.error;
    if (reads[k]) coverage[k].readBack = await reads[k]();
  }
  for (const k of ['同源框按钮', '跨源框按钮', '开放影子按钮', '封闭影子按钮']) {
    const ref = coverage[k].ref; if (!ref) continue;
    const r = await step(`click ${k}`, ['click', ref]);
    coverage[k].click = r.ok; coverage[k].clickError = r.error;
  }
  const after = (await step('snapshot after clicks', ['snapshot'])).data?.snapshot ?? '';
  for (const k of ['同源框按钮', '跨源框按钮', '开放影子按钮', '封闭影子按钮']) coverage[k].effectVisible = after.includes(k.replace('按钮', '已点'));
  coverage['跨源框输入'].readBackViaSnapshot = after.includes('E3值') ? 'value text present somewhere in snapshot' : 'not visible in snapshot';
  result.findings.coverage = coverage;

  const find = {};
  const cases = {
    'role button --name 主按钮 click': ['find', 'role', 'button', 'click', '--name', '主按钮'],
    'text 主按钮 click': ['find', 'text', '主按钮', 'click'],
    'label 主页面输入 fill': ['find', 'label', '主页面输入', 'fill', 'find值'],
    'placeholder 主页面占位 fill': ['find', 'placeholder', '主页面占位', 'fill', 'ph值'],
    'testid main-btn click': ['find', 'testid', 'main-btn', 'click'],
    'first button hover': ['find', 'first', 'button', 'hover'],
    'nth 1 button focus': ['find', 'nth', '1', 'button', 'focus'],
    'label 同源框输入 fill (inside iframe)': ['find', 'label', '同源框输入', 'fill', 'iframe值'],
    'label 不存在 click (no match)': ['find', 'label', '不存在的标签', 'click'],
  };
  for (const [k, cmd] of Object.entries(cases)) { const r = await step('find ' + k, cmd, 15000); find[k] = { ok: r.ok, ms: r.ms, error: r.error }; }
  find.mainInputAfter = await evalJs("document.getElementById('main').value");
  result.findings.find = find;

  const net = {};
  const hitsBefore = (await (await fetch(`http://127.0.0.1:${A}/hits`)).json()).filter(h => h.url === '/api/data').length;
  const loadRef = refOf((await ab(['snapshot'])).data, 'button', '加载数据');
  net.route = await step('network route **/api/* (Orca intercept enable, no options)', ['network', 'route', '**/api/*']);
  await step('click 加载数据', ['click', loadRef]);
  await new Promise(r => setTimeout(r, 3000));
  net.pageTextAfterRoute = await text('#net');
  net.serverHitsDuringRoute = (await (await fetch(`http://127.0.0.1:${A}/hits`)).json()).filter(h => h.url === '/api/data').length - hitsBefore;
  net.requests = (await step('network requests --filter api', ['network', 'requests', '--filter', 'api'])).data;
  await step('network unroute', ['network', 'unroute']);
  await step('click 加载数据 after unroute', ['click', loadRef]);
  await new Promise(r => setTimeout(r, 1500));
  net.pageTextAfterUnroute = await text('#net');
  await step('network route --abort (reachable via exec)', ['network', 'route', '**/api/*', '--abort']);
  await step('click 加载数据 with abort route', ['click', loadRef]);
  await new Promise(r => setTimeout(r, 1500));
  net.pageTextWithAbort = await text('#net');
  await step('network unroute (cleanup)', ['network', 'unroute']);
  net.route = net.route.ok;
  result.findings.intercept = net;

  savedClipboard = pb.read();
  const clip = {};
  pb.write('E3-SYSTEM-MARKER');
  clip.read = (await step('clipboard read', ['clipboard', 'read'])).data;
  clip.readMatchesSystem = JSON.stringify(clip.read ?? '').includes('E3-SYSTEM-MARKER');
  const w = await step('clipboard write', ['clipboard', 'write', 'E3-PAGE-WRITE']);
  clip.writeOk = w.ok;
  clip.systemAfterWrite = pb.read() === 'E3-PAGE-WRITE';
  result.findings.clipboard = clip;

  const typeRes = {};
  await step('focus textarea', ['focus', '#long']);
  const chunk = '中文输入E3'.repeat(1500);
  typeRes.inputChars = chunk.length; typeRes.inputUtf8Bytes = Buffer.byteLength(chunk);
  const t = await step('keyboard type ~25KB', ['keyboard', 'type', chunk], 120000);
  typeRes.ok = t.ok; typeRes.ms = t.ms; typeRes.error = t.error;
  typeRes.valueLength = await evalJs("document.getElementById('long').value.length");
  typeRes.exact = (await evalJs("document.getElementById('long').value")) === chunk;
  result.findings.type = typeRes;
} catch (error) {
  result.failure = String(error?.stack || error);
} finally {
  if (savedClipboard !== null) { pb.write(savedClipboard); result.clipboardRestored = pb.read() === savedClipboard; }
  await new Promise(r => execFile(AB, ['--session', 'e3', 'close'], { env, timeout: 15000 }, () => r()));
  host.kill();
  await writeFile(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ failure: result.failure, clipboardRestored: result.clipboardRestored, findings: result.findings }, null, 1));
}
