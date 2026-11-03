// E4b: can the host tell "same role+name, different node" apart? Reads the accessibility tree over CDP (as the per-page proxy's
// debugger would) and compares backendDOMNodeId before/after: untouched, unrelated DOM change, same-name replacement, re-render of the same node.
// Usage: node ax-identity.mjs <out dir>
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const [OUT] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = createRequire(join(process.cwd(), 'package.json'))('electron');
const PORT = 9380, A = 9381, B = 9382;
await mkdir(OUT, { recursive: true });
const userData = await mkdtemp('/private/tmp/claude-501/e4b-userdata-');
const host = spawn(ELECTRON, [join(HERE, 'main.cjs'), `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E4_A_PORT: String(A), E4_B_PORT: String(B) } });
await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('not ready')), 20000); host.stdout.on('data', d => { if (String(d).includes('E4_READY')) { clearTimeout(t); resolve(); } }); });
const result = { at: new Date().toISOString(), boundary: 'E4b: CDP accessibility tree on a local Electron 42 page; no agent-browser, no WillYou gateway', raw: {} };
try {
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.title === 'E4 旧引用页');
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0; const pend = new Map(); ws.addEventListener('message', m => { const x = JSON.parse(m.data); if (pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  await send('Accessibility.enable'); await send('DOM.enable'); await send('DOM.getDocument', { depth: -1 });
  const nodes = async (name) => {
    const tree = (await send('Accessibility.getFullAXTree')).result.nodes;
    const matches = tree.filter(n => n.role?.value === 'button' && n.name?.value === name && !n.ignored);
    return Promise.all(matches.map(async n => ({ backend: n.backendDOMNodeId, id: (await send('DOM.describeNode', { backendNodeId: n.backendDOMNodeId })).result?.node?.attributes?.[1] })));
  };
  const t0 = performance.now(); const first = await nodes('Action'); const lookupMs = Math.round(performance.now() - t0);
  await ev("document.getElementById('counter').click()");
  const unrelated = await nodes('Action');
  await ev("document.getElementById('original').textContent = 'Action'");
  const sameNodeTextReset = await nodes('Action');
  await ev('replaceSameName()');
  const replaced = await nodes('Action');
  result.raw = { first, unrelated, sameNodeTextReset, replaced, lookupMs };
  result.verdicts = {
    stableWhenUntouched: JSON.stringify(first) === JSON.stringify(unrelated) && JSON.stringify(first) === JSON.stringify(sameNodeTextReset),
    changesOnReplacement: first.length === 1 && replaced.length === 1 && first[0].backend !== replaced[0].backend && replaced[0].id === 'replacement',
  };
  ws.close();
} catch (e) { result.failure = String(e?.stack || e); }
finally { host.kill(); await writeFile(join(OUT, 'ax-identity-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 1)); }
