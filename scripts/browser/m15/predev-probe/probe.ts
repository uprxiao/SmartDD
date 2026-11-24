import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { app, BrowserWindow } from 'electron';
import { BrowserPageRegistry, type BrowserPage } from '@source/main/core/browser/page-registry';
import { BrowserWorkspace } from '@source/main/core/browser/workspace';
import { BrowserOperations } from '@source/main/core/browser/operations';
import { BrowserCdpProxy } from '@source/main/core/browser/cdp-proxy';
import { WebSocket } from 'ws';

const root = process.env.WY_M15_LAB!;
assert.match(root, /^\/private\/tmp\/willyou-m15-predev\.[a-zA-Z0-9]+$/);
app.setPath('userData', join(root, 'data-2'));
const db = new (require(process.env.WY_M15_SQLITE!))(':memory:');
db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT, updated_at INTEGER)');
db.exec(readFileSync(join(root, 'frozen/drizzle/0030_browser_operations.sql'), 'utf8'));

const result: Record<string, unknown> = {
  source: '60e7f65452e96f2f76c9fa82725f972822d2091a',
  time: new Date().toISOString(),
  electron: process.versions.electron,
  chromium: process.versions.chrome,
  platform: process.platform,
  architecture: process.arch
};
const until = async (check: () => boolean | Promise<boolean>, label: string) => {
  const end = performance.now() + 4000;
  while (performance.now() < end) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 15));
  }
  throw new Error('Fixture timeout: ' + label);
};
let resolveGate!: () => void;
const gate = new Promise<void>(resolve => { resolveGate = resolve; });
let gateHits = 0;
let validSession = 0;
let logins = 0;
let writes = 0;
let drop = false;
const server = createServer(async (request, response) => {
  const path = new URL(request.url!, 'http://127.0.0.1').pathname;
  const redirect = (target: string) => { response.writeHead(303, { location: target }).end(); };
  const html = (content: string) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    response.end('<!doctype html>' + content);
  };
  const authenticated = validSession > 0 && request.headers.cookie === 'wy-m15=' + validSession;
  if (path === '/delayed') {
    gateHits++;
    await gate;
    return html('<title>Delayed fixture</title><h1 id="ready">Delayed fixture ready</h1>');
  }
  if (path === '/login' && request.method === 'POST') {
    let fields = '';
    for await (const chunk of request) fields += String(chunk);
    if (fields !== 'account=fixture-user&code=fixture-code') return response.writeHead(400).end();
    logins++;
    validSession = logins;
    response.setHeader('Set-Cookie', 'wy-m15=' + validSession + '; Path=/; HttpOnly; SameSite=Lax');
    return redirect('/desk');
  }
  if (path === '/login') return html('<title>Login fixture</title><form method="POST" action="/login"><input name="account"><input name="code" type="password"><button>Sign in</button></form>');
  if (path === '/desk') {
    if (!authenticated) return redirect('/login');
    return html('<title>Business fixture</title><h1 id="desk">Reports</h1>');
  }
  if (!authenticated) return response.writeHead(401).end();
  if (path === '/write' && request.method === 'POST') {
    writes++;
    if (drop) {
      drop = false;
      response.writeHead(200, {'content-length': '100', connection: 'close'});
      return response.end('partial');
    }
    return response.writeHead(200).end('written');
  }
  if (path === '/receipt') return response.writeHead(200, {'cache-control':'no-store'}).end('reports:' + writes);
  return response.writeHead(404).end();
});

const read = (page: BrowserPage, expression: string) => page.contents.executeJavaScript(expression);
const submitFixtureLogin = async (page: BrowserPage) => {
  await read(page, 'document.querySelector("[name=account]").value="fixture-user"; document.querySelector("[name=code]").value="fixture-code"; document.querySelector("form").requestSubmit(); true');
  await until(() => page.contents.getURL().endsWith('/desk') && read(page, 'Boolean(document.querySelector("#desk"))'), 'authorized business marker');
};

const wsRpc = async (socket: WebSocket, id: number, method: string, params = {}) => {
  const deadline = AbortSignal.timeout(3000);
  const packet = new Promise<{ result?: any; error?: { message: string } }>((resolve, reject) => {
    const onMessage = (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.id !== id) return;
      socket.off('message', onMessage);
      resolve(msg);
    };
    deadline.addEventListener('abort', () => { socket.off('message', onMessage); reject(new Error('CDP timeout: ' + method)); }, {once:true});
    socket.on('message', onMessage);
  });
  socket.send(JSON.stringify({id, method, params}));
  return packet;
};

let registry: BrowserPageRegistry | undefined;
let workspace: BrowserWorkspace | undefined;
let window: BrowserWindow | undefined;
let probeProxy: BrowserCdpProxy | undefined;
try {
  await app.whenReady();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = (server.address() as {port: number}).port;
  const site = 'http://127.0.0.1:' + port;
  window = new BrowserWindow({show: false, focusable: false, skipTaskbar: true, width: 800, height: 600});
  const executable = process.env.WY_M15_HELPER!;
  const sha256 = createHash('sha256').update(readFileSync(executable)).digest('hex');
  registry = new BrowserPageRegistry({userData: app.getPath('userData'), helper: {executable, sha256}, window: () => window!});
  workspace = new BrowserWorkspace({sqlite: db, pages: registry, taskProject: id => id === 'separate' ? 'profile-isolate' : 'profile-original'});
  const taskId = 'fixture-task';
  const started = performance.now();
  const initial = workspace.create(taskId, site + '/delayed');
  const receiptMs = performance.now() - started;
  const tabId = initial.activeId!;
  assert(initial.tabs[0].loading && initial.tabs[0].pendingUrl === site + '/delayed');
  assert.equal(registry.list(taskId).length, 0);
  await until(() => gateHits === 1, 'request gate');
  const page = await workspace.target(taskId, tabId);
  await workspace.placement(taskId, tabId, {x: 100, y: 100, width: 600, height: 400});
  const mountedBeforeCommit = registry.isMounted(page);
  const pendingWhileHeld = workspace.snapshot(taskId).tabs[0].loading === true;
  resolveGate();
  await until(() => page.contents.getURL().endsWith('/delayed') && !page.contents.isLoading(), 'released navigation');
  const readyMs = performance.now() - started;
  assert(await read(page, 'Boolean(document.querySelector("#ready"))'));
  assert.equal(workspace.snapshot(taskId).activeId, tabId);
  assert.equal(gateHits, 1);
  result.open = { pendingBeforeNativeView: true, pendingWhileResponseHeld: pendingWhileHeld, mountedBeforeCommit, loadedSameTab: true, gateHits, receiptMs, readyMs };

  const originalContents = page.contents.id;
  await workspace.navigate(taskId, tabId, site + '/desk');
  await until(() => page.contents.getURL().endsWith('/login'), 'initial login page');
  await submitFixtureLogin(page);
  const peer = await registry.create('same-profile', 'profile-original');
  await registry.navigate(peer, site + '/desk');
  assert(peer.contents.getURL().endsWith('/desk'));
  const other = await registry.create('separate', 'profile-isolate');
  await registry.navigate(other, site + '/desk');
  assert(other.contents.getURL().endsWith('/login'));
  validSession = 0;
  await workspace.navigate(taskId, tabId, site + '/desk');
  await until(() => page.contents.getURL().endsWith('/login'), 'expired session login page');
  await submitFixtureLogin(page);
  assert.equal(page.contents.id, originalContents);
  assert.equal((await workspace.target(taskId, tabId)).profileId, page.profileId);
  await registry.navigate(other, site + '/desk');
  assert(other.contents.getURL().endsWith('/login'));
  result.login = { initialLogin: true, sameProfileReused: true, isolatedProfileDenied: true, expiredSessionReauthenticatedInSameView: true, loginSubmissions: logins };

  const operations = new BrowserOperations(db);
  assert.equal(operations.begin('test-run', 'report-click', taskId, tabId, 'click').replay, false);
  operations.update('test-run', 'report-click', 'running', 'unknown');
  drop = true;
  assert.equal(await read(page, 'fetch("/write",{method:"POST"}).then(r=>r.text()).then(()=>false,()=>true)'), true);
  operations.recover();
  assert.equal(operations.receipt('test-run', 'report-click').state, 'unknown');
  const sameReceipt = operations.begin('test-run', 'report-click', taskId, tabId, 'click');
  assert(sameReceipt.replay);
  assert.equal(await read(page, 'fetch("/receipt").then(r=>r.text())'), 'reports:1');
  assert.equal(writes, 1);
  result.receipt = { serverCommittedThenDroppedResponse: true, recoveredStatus: 'unknown', sameKeyReplayed: sameReceipt.replay, recoveredViaReadOnlyCheck: true, serverWrites: writes };

  // Separate synthetic view isolates the compatibility clients and their traces.
  const proxyOwner = await registry.create('proxy-compat', 'proxy-fixture-profile');
  await registry.navigate(proxyOwner, site + '/login');
  await proxyOwner.proxy.stop();
  const calls: string[] = [];
  probeProxy = new BrowserCdpProxy(proxyOwner.contents, trace => {
    if (typeof trace.method === 'string') calls.push(trace.method);
  });
  const endpoint = await probeProxy.start();
  const attempt = async (variant: string, modulePath: string, options: Record<string, boolean> = {}) => {
    calls.splice(0);
    const library = require(modulePath);
    let browser: any;
    try {
      browser = await library.chromium.connectOverCDP(endpoint, { timeout: 3200, ...options });
      const pages = browser.contexts().flatMap((context: any) => context.pages());
      return { variant, connected: true, pages: pages.length, fixturePageFound: pages.some((p: any) => p.url() === site + '/login'), methods: [...new Set(calls)] };
    } catch (error) {
      const message = String((error as Error).message).split('\n')[0].replaceAll(endpoint, '<loopback>');
      return { variant, connected:false, error: message, methods: [...new Set(calls)] };
    } finally {
      if (browser) await browser.close();
    }
  };
  const probes = [
    await attempt('1.57.0 default', process.env.WY_M15_PW_OLD!),
    await attempt('1.63.0 default', process.env.WY_M15_PW_NEW!),
    await attempt('1.63.0 noDefaults', process.env.WY_M15_PW_NEW!, { noDefaults:true }),
  ];
  const socket = new WebSocket(endpoint);
  try {
    await once(socket, 'open');
    const targets = await wsRpc(socket, 1, 'Target.getTargets');
    assert.equal(targets.result.targetInfos.length, 1);
    const disallowed = await wsRpc(socket, 2, 'Browser.setDownloadBehavior', {behavior:'default'});
    assert(disallowed.error);
    const tree = await wsRpc(socket, 3, 'Accessibility.getFullAXTree');
    assert(tree.result.nodes.some((node: any) => node.name?.value === 'Sign in'));
    result.cdp = { probes, scopedTargetCount: 1, enclosingBrowserPolicyChangeDenied: true, originalTargetReadable: true };
  } finally { socket.terminate(); }
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.error = String((error as Error).stack).replace(/wss?:\/\/[^\s)'"]+/g,'<loopback>');
  console.error(result.error);
} finally {
  resolveGate();
  await probeProxy?.stop();
  await workspace?.dispose();
  await registry?.dispose();
  window?.destroy();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  db.close();
  writeFileSync(join(root, 'probe-result.json'), JSON.stringify(result, null, 2) + '\n', {mode:0o600});
  app.exit(result.passed ? 0 : 1);
}
