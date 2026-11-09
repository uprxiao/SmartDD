// E4c: bind the verified node, not the role+name. The host tags the verified backendDOMNodeId with a one-time attribute over CDP,
// then agent-browser acts on that attribute selector. Cases: untouched (must click the original), replaced after tagging
// (must fail, no click lands), and the same short ref "@e2" on two pages (host-issued refs keep them apart).
// Raw outputs first; verdicts at the end. Usage: node tag-binding.mjs <agent-browser binary> <out dir>
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const [AB, OUT] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = createRequire(join(process.cwd(), 'package.json'))('electron');
const PORT = 9390, A = 9391, B = 9392;
await mkdir(OUT, { recursive: true });
const home = await mkdtemp('/private/tmp/claude-501/e4c-home-'), userData = await mkdtemp('/private/tmp/claude-501/e4c-userdata-');
const env = { ...process.env, HOME: home, AGENT_BROWSER_SOCKET_DIR: join(home, 'ab-sock') };
const host = spawn(ELECTRON, [join(HERE, 'main.cjs'), `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E4_A_PORT: String(A), E4_B_PORT: String(B) } });
await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('not ready')), 20000); host.stdout.on('data', d => { if (String(d).includes('E4_READY')) { clearTimeout(t); ok(); } }); });
const ab = cmd => new Promise(r => { const c = execFile(AB, ['--session', 'e4c', '--cdp', String(PORT), 'batch', '--json'], { env, timeout: 30000 }, (e, so) => { let p = null; try { p = JSON.parse(so); } catch {} const x = Array.isArray(p) ? p[0] : p; r({ ok: x?.success === true, data: x?.result ?? x?.data ?? null, error: x?.error ?? (e ? String(e.message).slice(0, 200) : null) }); }); c.stdin.end(JSON.stringify([cmd])); });
const result = { at: new Date().toISOString(), boundary: 'E4c: local Electron 42 page, agent-browser 0.27.3 over the global CDP port, host tagging over a direct CDP client; no per-page proxy, no WillYou gateway', raw: {} };
try {
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.title === 'E4 旧引用页');
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0; const pend = new Map(); ws.addEventListener('message', m => { const x = JSON.parse(m.data); if (pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  await send('DOM.enable'); await send('Accessibility.enable'); await send('DOM.getDocument', { depth: -1 });
  const tag = async (name, nonce) => {
    const n = (await send('Accessibility.getFullAXTree')).result.nodes.find(x => x.role?.value === 'button' && x.name?.value === name && !x.ignored);
    const ids = (await send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [n.backendDOMNodeId] })).result.nodeIds;
    await send('DOM.setAttributeValue', { nodeId: ids[0], name: 'data-willyou-ref', value: nonce });
    return n.backendDOMNodeId;
  };
  const tabs = (await ab(['tab', 'list'])).data?.tabs ?? []; const page = tabs.find(t => String(t.title).includes('E4 旧引用页')); await ab(['tab', page.tabId]);
  await ev('window.__hits=[]');
  await tag('Action', 'p1-s1-e4');
  const untouched = await ab(['click', '[data-willyou-ref="p1-s1-e4"]']);
  result.raw.untouched = { ok: untouched.ok, error: untouched.error, hits: JSON.parse(await ev('JSON.stringify(window.__hits)')) };
  await ev('window.__hits=[]');
  await tag('Action', 'p1-s2-e4');
  await ev('replaceSameName()');
  const replaced = await ab(['click', '[data-willyou-ref="p1-s2-e4"]']);
  result.raw.replacedAfterTag = { ok: replaced.ok, error: replaced.error, hits: JSON.parse(await ev('JSON.stringify(window.__hits)')) };
  ws.close();
  result.verdicts = {
    untouchedClicksOriginal: result.raw.untouched.ok && JSON.stringify(result.raw.untouched.hits) === '["original"]',
    replacedAfterTagNeverClicks: !result.raw.replacedAfterTag.ok && result.raw.replacedAfterTag.hits.length === 0,
  };
} catch (e) { result.failure = String(e?.stack || e); }
finally {
  await new Promise(r => execFile(AB, ['--session', 'e4c', 'close'], { env, timeout: 15000 }, () => r()));
  host.kill(); await writeFile(join(OUT, 'tag-binding-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 1));
}
