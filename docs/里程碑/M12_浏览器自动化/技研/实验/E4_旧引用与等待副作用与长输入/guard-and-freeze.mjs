// E4e (review4 G01, G02): (1) an isolated-world action guard that holds the verified node object and cancels input events aimed
// at any other node, tested against a cloned replacement that copies the tag attribute; (2) whether freezing the page via
// Page.setWebLifecycleState stops page-side cookie writes. Raw outputs first; verdicts at the end.
// Usage: node guard-and-freeze.mjs <agent-browser binary> <out dir>
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const [AB, OUT] = process.argv.slice(2);
const HERE = dirname(fileURLToPath(import.meta.url));
const ELECTRON = createRequire(join(process.cwd(), 'package.json'))('electron');
const PORT = 9395, A = 9396, B = 9397;
await mkdir(OUT, { recursive: true });
const home = await mkdtemp('/private/tmp/claude-501/e4e-home-'), userData = await mkdtemp('/private/tmp/claude-501/e4e-userdata-');
const env = { ...process.env, HOME: home, AGENT_BROWSER_SOCKET_DIR: join(home, 'ab-sock') };
const host = spawn(ELECTRON, [join(HERE, 'main.cjs'), `--remote-debugging-port=${PORT}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${userData}`], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, E4_A_PORT: String(A), E4_B_PORT: String(B), E4_ONSCREEN: '1' } });
await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('not ready')), 20000); host.stdout.on('data', d => { if (String(d).includes('E4_READY')) { clearTimeout(t); ok(); } }); });
const ab = cmd => new Promise(r => { const c = execFile(AB, ['--session', 'e4e', '--cdp', String(PORT), 'batch', '--json'], { env, timeout: 30000 }, (e, so) => { let p = null; try { p = JSON.parse(so); } catch {} const x = Array.isArray(p) ? p[0] : p; r({ ok: x?.success === true, error: x?.error ?? (e ? String(e.message).slice(0, 200) : null) }); }); c.stdin.end(JSON.stringify([cmd])); });
const result = { at: new Date().toISOString(), boundary: 'E4e: local Electron 42 page, agent-browser 0.27.3 over the global CDP port, host guard over a direct CDP client; no per-page proxy, no WillYou gateway', raw: {} };
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  const target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find(t => t.title === 'E4 旧引用页');
  const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener('open', r, { once: true }));
  let seq = 0; const pend = new Map(); ws.addEventListener('message', m => { const x = JSON.parse(m.data); if (pend.has(x.id)) { pend.get(x.id)(x); pend.delete(x.id); } });
  const send = (method, params = {}) => new Promise(r => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async e => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result?.result?.value;
  await send('DOM.enable'); await send('Accessibility.enable'); await send('Page.enable'); await send('DOM.getDocument', { depth: -1 });
  const frameId = (await send('Page.getFrameTree')).result.frameTree.frame.id;
  const world = (await send('Page.createIsolatedWorld', { frameId, worldName: 'willyou-guard' })).result.executionContextId;
  const backendOf = async (role, name) => (await send('Accessibility.getFullAXTree')).result.nodes.find(x => x.role?.value === role && x.name?.value === name && !x.ignored)?.backendDOMNodeId;
  async function arm(backendNodeId, nonce) {
    const ids = (await send('DOM.pushNodesByBackendIdsToFrontend', { backendNodeIds: [backendNodeId] })).result.nodeIds;
    await send('DOM.setAttributeValue', { nodeId: ids[0], name: 'data-willyou-ref', value: nonce });
    const objectId = (await send('DOM.resolveNode', { backendNodeId, executionContextId: world })).result.object.objectId;
    await send('Runtime.callFunctionOn', { objectId, functionDeclaration: `function(){ const node = this; const kinds = ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','keydown','keypress','beforeinput','input','focusin']; const blocked = []; const h = e => { if (!e.composedPath().includes(node)) { e.stopImmediatePropagation(); e.preventDefault(); blocked.push(e.type); } }; for (const k of kinds) window.addEventListener(k, h, true); window.__wyGuard = { blocked, off: () => kinds.forEach(k => window.removeEventListener(k, h, true)) }; }` });
  }
  const guardState = async () => (await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__wyGuard ? window.__wyGuard.blocked : null)', contextId: world, returnByValue: true })).result?.result?.value;
  const disarm = async () => send('Runtime.evaluate', { expression: 'window.__wyGuard && window.__wyGuard.off(); delete window.__wyGuard', contextId: world });
  const tabs = (await (async () => { const r = await new Promise(res => { const c = execFile(AB, ['--session', 'e4e', '--cdp', String(PORT), 'batch', '--json'], { env }, (e, so) => res(so)); c.stdin.end(JSON.stringify([['tab', 'list']])); }); return JSON.parse(r)[0]?.result?.tabs ?? []; })());
  await ab(['tab', tabs.find(t => String(t.title).includes('E4 旧引用页')).tabId]);

  await ev('window.__hits=[]');
  await arm(await backendOf('button', 'Action'), 'n1');
  const c1 = await ab(['click', '[data-willyou-ref="n1"]']);
  result.raw.environment = 'window on screen (E4_ONSCREEN=1), background throttling off';
  result.raw.untouchedClick = { ok: c1.ok, error: c1.error, hits: JSON.parse(await ev('JSON.stringify(window.__hits)')), blocked: JSON.parse(await guardState()) };
  await disarm(); await ev("document.querySelector('[data-willyou-ref]')?.removeAttribute('data-willyou-ref')");

  await ev('window.__hits=[]');
  const before = await backendOf('button', 'Action');
  await arm(before, 'n2');
  await ev("cloneReplace('original')");
  const after = await backendOf('button', 'Action');
  const c2 = await ab(['click', '[data-willyou-ref="n2"]']);
  result.raw.clonedClick = { before, after, ok: c2.ok, error: c2.error, hits: JSON.parse(await ev('JSON.stringify(window.__hits)')), blocked: JSON.parse(await guardState()) };
  await disarm();

  const fBefore = await backendOf('textbox', 'Field input');
  await arm(fBefore, 'n3');
  await ev("cloneReplace('field')");
  const f = await ab(['fill', '[data-willyou-ref="n3"]', 'WRONG']);
  result.raw.clonedFill = { ok: f.ok, error: f.error, cloneValue: await ev("document.getElementById('field-clone').value"), blocked: JSON.parse(await guardState()) };
  await disarm();

  await ev('startCookieWriter()'); await sleep(200);
  const c0 = await ev("document.cookie");
  await send('Page.setWebLifecycleState', { state: 'frozen' });
  const frozenAt = Number(/cw=(\d+)/.exec(await ev('document.cookie') ?? '')?.[1] ?? -1);
  await sleep(1000);
  const cookiesDuring = (await send('Network.getCookies', { urls: [`http://127.0.0.1:${A}/`] })).result?.cookies?.find(c => c.name === 'cw')?.value;
  await send('Page.setWebLifecycleState', { state: 'active' });
  await sleep(300);
  const resumed300 = Number(/cw=(\d+)/.exec(await ev('document.cookie') ?? '')?.[1] ?? -1);
  await sleep(1000);
  const resumed = Number(/cw=(\d+)/.exec(await ev('document.cookie') ?? '')?.[1] ?? -1);
  const baseline = (await send('Runtime.evaluate', { expression: '(async()=>{const a=window.__cw; await new Promise(r=>setTimeout(r,1000)); return window.__cw-a;})()', awaitPromise: true, returnByValue: true })).result?.result?.value;
  result.raw.freeze = { beforeFreeze: c0, frozenAt, cookieAfter1sFrozen: cookiesDuring, resumedAfter300ms: resumed300, resumedValue: resumed, writesPerSecondAfterResume: baseline };
  await ev('clearInterval(window.__cwTimer)');
  ws.close();
  const r = result.raw;
  result.verdicts = {
    G01_untouchedStillClicksOriginal: r.untouchedClick.ok && JSON.stringify(r.untouchedClick.hits) === '["original"]' && r.untouchedClick.blocked.length === 0,
    G01_cloneCarriesTagAndNewId: r.clonedClick.before !== r.clonedClick.after,
    G01_guardBlocksClickOnClone: r.clonedClick.hits.length === 0 && r.clonedClick.blocked.includes('click'),
    G01_guardBlocksFillOnClone: r.clonedFill.cloneValue !== 'WRONG',
    G02_freezeStopsPageCookieWrites: Number(r.freeze.cookieAfter1sFrozen) === r.freeze.frozenAt || Number(r.freeze.cookieAfter1sFrozen) <= r.freeze.frozenAt + 1,
    G02_resumesAfterFreeze: r.freeze.resumedValue > Number(r.freeze.cookieAfter1sFrozen) + 5 && r.freeze.writesPerSecondAfterResume > 5,
  };
} catch (e) { result.failure = String(e?.stack || e); }
finally {
  await new Promise(r => execFile(AB, ['--session', 'e4e', 'close'], { env, timeout: 15000 }, () => r()));
  host.kill(); await writeFile(join(OUT, 'guard-and-freeze-result.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify({ failure: result.failure, raw: result.raw, verdicts: result.verdicts }, null, 1));
}
