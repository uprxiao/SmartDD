"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const permissions_cjs_1 = require("./components/permissions.cjs");
const site_state_cjs_1 = require("./components/site-state.cjs");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_http_1 = __importDefault(require("node:http"));
const node_crypto_1 = require("node:crypto");
const g = globalThis.__m12T017Deps;
if (!g)
    throw Error('Actual App025 dependencies required');
const Database = g.Database;
const announce = (message) => g.onStage(message);
const { COORDS, html } = require('/private/tmp/willyou-m12-t017-App025-I-002/geo-fixture.cjs');
const root = '/private/tmp/willyou-m12-t017-App025-I-002', config = g.config, write = (name, value) => node_fs_1.default.writeFileSync(node_path_1.default.join(root, name), JSON.stringify(value, null, 2) + '\n'), now = () => new Date().toISOString();
if (config.root !== root || process.versions.electron !== '42.11.14' || process.versions.modules !== '146')
    throw Error('Pinned private config/runtime required');
if (electron_1.app.getPath('userData') !== config.userData)
    throw Error('Exact current App userData required');
let db, states, permissions, parentServer, childServer, parentOrigin, childOrigin;
const known = new Set(['profile-A', 'profile-B']), owners = [], windows = [], nativeSessions = [], sockets = new Set(), passive = new Map(), raw = { group: 'M12-P014', scope: 'Actual BrowserPermissions/BrowserSiteStates technical I only, not T017 App A', pid: process.pid, versions: process.versions, startedAt: now(), coordinateFixture: { method: 'Emulation.setGeolocationOverride', ...COORDS, meaning: 'Synthetic coordinates only, no permission grant or OS privacy bypass' }, segments: [], changed: [], events: [], serverRequests: [], windows: [], cdp: [] };
class ProbeError extends Error {
    classification;
    detail;
    constructor(message, classification, detail) {
        super(message);
        this.classification = classification;
        this.detail = detail;
    }
}
async function poll(read, ms = 6500) { const end = Date.now() + ms; do {
    const value = await read();
    if (value !== undefined && value !== false)
        return value;
    await new Promise(ok => setTimeout(ok, 35));
} while (Date.now() < end); throw new ProbeError('Bounded native observation deadline', 'undetermined-native-precondition'); }
function snapshots() { return { memoryA: states.snapshot('profile-A'), memoryB: states.snapshot('profile-B'), persisted: db.prepare('SELECT key,value,updated_at FROM app_settings ORDER BY key').all(), nativePending: owners.map(owner => ({ taskId: owner.taskId, pageId: owner.pageId, prompt: permissions.snapshot(owner.taskId, owner.pageId) })) }; }
async function pageState(owner) { return owner.contents.executeJavaScript('JSON.parse(JSON.stringify(window.geoState))'); }
async function query(owner, label) { return owner.contents.executeJavaScript('window.queryGeo(' + JSON.stringify(label) + ')'); }
async function override(owner) { if (!owner.contents.debugger.isAttached())
    owner.contents.debugger.attach('1.3'); await owner.contents.debugger.sendCommand('Emulation.setGeolocationOverride', COORDS); raw.cdp.push({ at: now(), wcId: owner.contents.id, method: 'Emulation.setGeolocationOverride', params: COORDS }); }
async function navigate(owner, url) { await owner.win.loadURL(url); await override(owner); const state = await pageState(owner); if (!state.info.isSecureContext || state.info.nodeRequire !== 'undefined' || state.info.nodeProcess !== 'undefined')
    throw new ProbeError('Browser fixture is not a secure non-Node page', 'fixture-security-context', state.info); return state; }
async function makeOwner(profileId, label) { const ses = profileId === 'profile-A' ? nativeSessions[0] : nativeSessions[1], win = new electron_1.BrowserWindow({ show: false, focusable: false, skipTaskbar: true, width: 900, height: 600, title: '[I] P014 ' + label, webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } }); windows.push(win); const owner = { win, contents: win.webContents, profileId, taskId: profileId === 'profile-A' ? 'task-A' : 'task-B', pageId: (0, node_crypto_1.randomUUID)(), label }; owners.push(owner); const baseline = { navigation: owner.contents.listenerCount('did-start-navigation'), gone: owner.contents.listenerCount('render-process-gone'), destroyed: owner.contents.listenerCount('destroyed') }; raw.windows.push({ at: now(), id: win.id, wcId: owner.contents.id, profileId, taskId: owner.taskId, pageId: owner.pageId, label, baseline }); permissions.install(owner); const navigation = (_e, url, inPlace, isMainFrame) => raw.events.push({ at: now(), kind: 'did-start-navigation', wcId: owner.contents.id, url, inPlace, isMainFrame }); const gone = (_e, details) => raw.events.push({ at: now(), kind: 'render-process-gone', wcId: owner.contents.id, details, pending: permissions.snapshot(owner.taskId, owner.pageId) }); const destroyed = () => raw.events.push({ at: now(), kind: 'destroyed', wcId: owner.contents.id, pending: permissions.snapshot(owner.taskId, owner.pageId) }); owner.contents.on('did-start-navigation', navigation); owner.contents.on('render-process-gone', gone); owner.contents.on('destroyed', destroyed); passive.set(win, { navigation, gone, destroyed }); await navigate(owner, parentOrigin + '/main'); const rendererPid = owner.contents.getOSProcessId(); raw.windows.find((row) => row.id === win.id).rendererPid = rendererPid; announce({ stage: 'owner-ready', wcId: owner.contents.id, rendererPid }); return owner; }
async function request(owner, id) { return owner.contents.executeJavaScript('window.requestGeo(' + JSON.stringify(id) + ')'); }
async function pending(owner, id, frame = false) { return poll(async () => { const value = permissions.snapshot(owner.taskId, owner.pageId); if (value)
    return value; const state = await pageState(owner), finished = frame ? state.messages.find((m) => m.data?.kind === 'geo-result' && m.data.id === id)?.data : state.results.find((r) => r.id === id); if (finished)
    throw new ProbeError('Geolocation completed without a pending production prompt', 'undetermined-native-no-pending', { finished, state }); return undefined; }); }
async function geo(owner, id, frame = false) { return poll(async () => { const state = await pageState(owner); return frame ? state.messages.find((m) => m.data?.kind === 'geo-result' && m.data.id === id)?.data : state.results.find((r) => r.id === id); }, 8500); }
function respond(owner, prompt, allow) { permissions.respond(owner.taskId, prompt.id, allow); return { at: now(), prompt, allow, boundary: 'Synthetic trusted-UI response using actual production method; not App/user A approval', saved: snapshots() }; }
function stale(owner, prompt) { try {
    permissions.respond(owner.taskId, prompt.id, true);
    return { rejected: false };
}
catch (error) {
    return { rejected: true, code: error.code ?? null, message: error.message };
} }
async function cancelled(owner, prompt) { await poll(() => permissions.snapshot(owner.taskId, owner.pageId) === null ? true : undefined, 1800); return { pendingAfter: permissions.snapshot(owner.taskId, owner.pageId), oldResponse: stale(owner, prompt), savedDecision: states.permission(owner.profileId, parentOrigin, 'geolocation'), saved: snapshots() }; }
async function segment(name, work) { const row = { name, startedAt: now(), savedBefore: snapshots() }; raw.segments.push(row); try {
    await work(row);
    row.status = 'executed';
}
catch (error) {
    row.status = 'failed';
    row.classification = error.classification ?? 'product-or-native-undetermined';
    row.error = String(error.stack ?? error);
    row.detail = error.detail ?? null;
} row.savedAfter = snapshots(); row.finishedAt = now(); write('segment-' + name + '.raw.json', row); write('live.json', raw); announce({ stage: 'segment', name, status: row.status, classification: row.classification, rendererPid: row.owner?.rendererPid ?? null }); }
electron_1.app.whenReady().then(async () => {
    let main, other;
    try {
        db = new Database(node_path_1.default.join(config.userData, 'permissions.sqlite'), { nativeBinding: config.nativeBinding });
        g.runtime.actualSQLiteCachePath = Object.keys(require.cache).find((key) => key === config.nativeBinding) ?? null;
        if (g.runtime.actualSQLiteCachePath !== config.nativeBinding)
            throw Error('Exact current SQLite addon not loaded');
        raw.currentRuntime = { ...g.runtime };
        db.exec('CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL)');
        states = new site_state_cjs_1.BrowserSiteStates(db, id => known.has(id));
        permissions = new permissions_cjs_1.BrowserPermissions({ states, available: id => known.has(id), changed: taskId => raw.changed.push({ at: now(), taskId, prompts: owners.filter(owner => owner.taskId === taskId).map(owner => ({ pageId: owner.pageId, prompt: permissions.snapshot(taskId, owner.pageId) })) }) });
        const serve = (child) => (request, response) => { const url = new URL(request.url, child ? childOrigin : parentOrigin); raw.serverRequests.push({ at: now(), origin: child ? childOrigin : parentOrigin, url: url.href, remoteAddress: request.socket.remoteAddress }); response.setHeader('cache-control', 'no-store'); response.setHeader('content-type', 'text/html;charset=utf-8'); response.setHeader('Permissions-Policy', child ? 'geolocation=(self)' : 'geolocation=(self "' + childOrigin + '")'); response.end(html({ kind: child ? 'child' : url.pathname === '/frame' ? 'frame' : 'main', parentOrigin, childOrigin })); };
        parentServer = node_http_1.default.createServer(serve(false));
        childServer = node_http_1.default.createServer(serve(true));
        for (const server of [parentServer, childServer])
            server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
        await new Promise(ok => parentServer.listen(0, '127.0.0.1', ok));
        await new Promise(ok => childServer.listen(0, '127.0.0.1', ok));
        const ports = { parent: parentServer.address().port, child: childServer.address().port };
        parentOrigin = 'http://127.0.0.1:' + ports.parent;
        childOrigin = 'http://127.0.0.1:' + ports.child;
        raw.origins = { parent: parentOrigin, child: childOrigin, sameHostDifferentPort: true, crossOrigin: true, crossSiteClaim: false, delegationHeader: 'geolocation=(self "' + childOrigin + '")', iframeAllow: 'geolocation *' };
        raw.ports = ports;
        for (const name of ['A', 'B']) {
            const partition = 'persist:p014-' + name + '-' + (0, node_crypto_1.randomUUID)(), ses = electron_1.session.fromPartition(partition);
            await ses.setProxy({ mode: 'direct' });
            nativeSessions.push(ses);
            raw.partitions ??= [];
            raw.partitions.push({ profileId: 'profile-' + name, partition });
        }
        announce({ ready: true, pid: process.pid, port: ports.parent, ports, versions: process.versions });
        main = await makeOwner('profile-A', 'main A');
        other = await makeOwner('profile-B', 'isolated B');
        await segment('main-allow-reload', async (row) => { row.owner = { taskId: main.taskId, pageId: main.pageId, wcId: main.contents.id, rendererPid: main.contents.getOSProcessId() }; row.initialQuery = await query(main, 'initial-query'); row.request = await request(main, 'initial'); row.firstPending = await pending(main, 'initial'); if (row.firstPending.origin !== parentOrigin)
            throw new ProbeError('Initial prompt origin mismatch', 'product-permission-origin', row.firstPending); row.beforeResponsePage = await pageState(main); row.response = respond(main, row.firstPending, true); row.queryAfterAllow = await query(main, 'after-allow'); row.firstGeo = await geo(main, 'initial'); if (!row.firstGeo.ok) {
            row.nativeDeliveryBlock = { classification: row.queryAfterAllow.state === 'granted' ? 'environment-or-platform-location-delivery' : 'product-or-native-permission', actual: row.firstGeo };
        } row.beforeReloadChanged = raw.changed.length; row.reloadState = await navigate(main, parentOrigin + '/main?reload=1'); row.reloadQuery = await query(main, 'after-reload'); row.reloadRequest = await request(main, 'reload'); const reloadOutcome = await poll(async () => { const value = permissions.snapshot(main.taskId, main.pageId); if (value)
            return { pending: value }; const state = await pageState(main); const finished = state.results.find((r) => r.id === 'reload'); return finished ? { geo: finished } : undefined; }, 8500); if (reloadOutcome.pending) {
            row.reloadUnexpectedPending = reloadOutcome.pending;
            throw new ProbeError('Saved permission prompted again after reload', 'product-saved-permission-reprompt', reloadOutcome.pending);
        } row.reloadGeo = reloadOutcome.geo; row.reloadPending = permissions.snapshot(main.taskId, main.pageId); row.afterReloadChanged = raw.changed.length; });
        await segment('profile-isolation', async (row) => { if (states.permission('profile-A', parentOrigin, 'geolocation') !== 'allow')
            throw new ProbeError('A allow precondition missing', 'dependent-precondition'); row.request = await request(other, 'isolated'); row.pending = await pending(other, 'isolated'); row.queryBefore = await query(other, 'before-deny'); row.response = respond(other, row.pending, false); row.geo = await geo(other, 'isolated'); row.queryAfter = await query(other, 'after-deny'); row.savedA = states.permission('profile-A', parentOrigin, 'geolocation'); row.savedB = states.permission('profile-B', parentOrigin, 'geolocation'); });
        await segment('revoke-and-navigation-cancel', async (row) => { row.beforeRevokeDocument = await pageState(main); states.revokePermission('profile-A', parentOrigin, 'geolocation'); row.afterRevoke = snapshots(); if (states.permission('profile-A', childOrigin, 'geolocation') === 'allow' && main.contents.getURL().includes('/frame')) {
            await main.contents.executeJavaScript('window.frameCommand("child-query-after-parent-revoke","query")');
            row.childQuery = await poll(async () => { const state = await pageState(main); return state.messages.find((message) => message.data?.kind === 'geo-query' && message.data.id === 'child-query-after-parent-revoke')?.data; });
        } if (!main.contents.getURL().includes('/main') && !main.contents.getURL().includes('/frame'))
            await navigate(main, parentOrigin + '/main'); row.request = await request(main, 'after-revoke'); row.pending = await pending(main, 'after-revoke'); row.navigation = await navigate(main, parentOrigin + '/main?after-navigation=1'); row.cancelled = await cancelled(main, row.pending); });
        await segment('iframe-requester-origin', async (row) => { row.parentChoiceBefore = states.permission('profile-A', parentOrigin, 'geolocation'); await navigate(main, parentOrigin + '/frame'); row.childReady = await poll(async () => { const state = await pageState(main); return state.messages.find((message) => message.data?.kind === 'child-ready'); }); if (!row.childReady.data.info.isSecureContext || row.childReady.data.info.policy === false)
            throw new ProbeError('Child secure context/delegation unavailable', 'fixture-iframe-permissions-policy', row.childReady); await main.contents.executeJavaScript('window.frameCommand("iframe","geo")'); row.pending = await pending(main, 'iframe', true); if (row.pending.origin !== childOrigin)
            throw new ProbeError('Child prompt stored using wrong origin', 'product-permission-origin', row.pending); row.response = respond(main, row.pending, true); row.geo = await geo(main, 'iframe', true); await main.contents.executeJavaScript('window.frameCommand("iframe-query","query")'); row.query = await poll(async () => { const state = await pageState(main); return state.messages.find((message) => message.data?.kind === 'geo-query' && message.data.id === 'iframe-query')?.data; }); row.parentQuery = await query(main, 'parent-after-child-allow'); row.parentChoice = states.permission('profile-A', parentOrigin, 'geolocation'); row.childChoice = states.permission('profile-A', childOrigin, 'geolocation'); });
        await segment('close-cancels-pending', async (row) => { states.revokePermission('profile-A', parentOrigin, 'geolocation'); const owner = await makeOwner('profile-A', 'close pending'); row.owner = { taskId: owner.taskId, pageId: owner.pageId, wcId: owner.contents.id, windowId: owner.win.id, rendererPid: owner.contents.getOSProcessId() }; row.request = await request(owner, 'close'); row.pending = await pending(owner, 'close'); owner.win.destroy(); row.windowDestroyed = owner.win.isDestroyed(); row.cancelled = await cancelled(owner, row.pending); });
        await segment('renderer-crash-cancels-pending', async (row) => { states.revokePermission('profile-A', parentOrigin, 'geolocation'); const owner = await makeOwner('profile-A', 'crash pending'); row.owner = { taskId: owner.taskId, pageId: owner.pageId, wcId: owner.contents.id, windowId: owner.win.id, rendererPid: owner.contents.getOSProcessId() }; row.request = await request(owner, 'crash'); row.pending = await pending(owner, 'crash'); row.faultInjection = { method: 'webContents.forcefullyCrashRenderer', onlyOwnedContents: true, at: now() }; owner.contents.forcefullyCrashRenderer(); row.gone = await poll(() => raw.events.find((event) => event.kind === 'render-process-gone' && event.wcId === owner.contents.id)); row.cancelled = await cancelled(owner, row.pending); });
        raw.finalState = snapshots();
        raw.status = 'executed';
    }
    catch (error) {
        raw.status = 'failed';
        raw.failure = String(error.stack ?? error);
    }
    finally {
        raw.cleanup = {};
        if (permissions) {
            for (const [win, events] of passive)
                if (!win.isDestroyed()) {
                    win.webContents.off('did-start-navigation', events.navigation);
                    win.webContents.off('render-process-gone', events.gone);
                    win.webContents.off('destroyed', events.destroyed);
                }
            permissions.dispose();
            raw.cleanup.productionMaps = { pending: Reflect.get(permissions, 'pending').size, owners: Reflect.get(permissions, 'owners').size, detach: Reflect.get(permissions, 'detach').size, sessions: Reflect.get(permissions, 'sessions').size };
            raw.cleanup.listeners = windows.filter(win => !win.isDestroyed()).map(win => ({ windowId: win.id, wcId: win.webContents.id, navigation: win.webContents.listenerCount('did-start-navigation'), gone: win.webContents.listenerCount('render-process-gone'), destroyed: win.webContents.listenerCount('destroyed'), baseline: raw.windows.find((row) => row.id === win.id).baseline }));
        }
        raw.cleanup.overrides = [];
        for (const owner of owners)
            if (!owner.contents.isDestroyed() && owner.contents.debugger.isAttached()) {
                try {
                    await owner.contents.debugger.sendCommand('Emulation.clearGeolocationOverride');
                    owner.contents.debugger.detach();
                    raw.cleanup.overrides.push({ wcId: owner.contents.id, cleared: true, detached: true });
                }
                catch (error) {
                    raw.cleanup.overrides.push({ wcId: owner.contents.id, error: error.message, rendererGone: raw.events.some((event) => event.kind === 'render-process-gone' && event.wcId === owner.contents.id) });
                }
            }
        raw.cleanup.windows = windows.map(win => { if (!win.isDestroyed())
            win.destroy(); return { id: win.id, destroyed: win.isDestroyed() }; });
        for (const ses of nativeSessions)
            await ses.closeAllConnections().catch(() => { });
        for (const socket of sockets)
            socket.destroy();
        raw.cleanup.servers = [];
        for (const server of [parentServer, childServer])
            if (server) {
                server.closeAllConnections();
                await new Promise(ok => server.close(ok));
                raw.cleanup.servers.push({ closed: true });
            }
        if (db) {
            raw.finalDatabase = db.prepare('SELECT key,value,updated_at FROM app_settings ORDER BY key').all();
            db.close();
            raw.cleanup.sqliteClosed = true;
        }
        raw.finishedAt = now();
        write('probe.raw.json', raw);
        write('host-cleanup.json', raw.cleanup);
        announce({ complete: true, status: raw.status, segments: raw.segments.map((segment) => ({ name: segment.name, status: segment.status })) });
        raw.currentRuntime ??= { ...g.runtime };
        raw.currentRuntime.finalDisplay = g.displaySnapshot();
        try {
            raw.startupHooksRestored = g.restoreStartup();
            delete globalThis.__m12T017Deps;
        }
        catch (error) {
            raw.startupHookRestoreFailure = String(error.stack ?? error);
        }
        write('probe.raw.json', raw);
        electron_1.app.quit();
    }
});
electron_1.app.on('window-all-closed', () => { });
