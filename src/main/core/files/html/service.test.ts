import { EventEmitter } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HTML_LIMITS, type HtmlOpenInput } from '@shared/file-html';
import { FileHtmlService } from './service';
import type { HtmlSource } from './resources';

const fake = vi.hoisted(() => ({ sessions: [] as any[], views: [] as any[], load: vi.fn(), memory: 0, heartbeat: vi.fn(), chooser: vi.fn() }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  class IsolatedSession extends EventEmitter {
    request: any; protocolHandler: any;
    protocol = { handle: vi.fn((_scheme, fn) => { this.protocolHandler = fn; }), unhandle: vi.fn(() => { this.protocolHandler = null; }) };
    webRequest = { onBeforeRequest: vi.fn((fn) => { this.request = fn; }) };
    setPermissionRequestHandler = vi.fn(); setPermissionCheckHandler = vi.fn(); setDevicePermissionHandler = vi.fn(); setDisplayMediaRequestHandler = vi.fn();
    setProxy = vi.fn(async () => undefined); clearStorageData = vi.fn(async () => undefined); clearCache = vi.fn(async () => undefined); closeAllConnections = vi.fn(async () => undefined);
  }
  class Contents extends EventEmitter {
    id = fake.views.length + 100; mainFrame = {}; destroyed = false;
    setAudioMuted = vi.fn(); setWebRTCIPHandlingPolicy = vi.fn(); setWindowOpenHandler = vi.fn();
    loadURL = vi.fn((url) => fake.load(url)); getOSProcessId = () => this.id;
    isDestroyed = () => this.destroyed; isFocused = vi.fn(() => false);
    close = vi.fn(() => { this.destroyed = true; this.emit('destroyed'); }); forcefullyCrashRenderer = vi.fn();
    executeJavaScriptInIsolatedWorld = vi.fn(() => fake.heartbeat());
    debugger = Object.assign(new EventEmitter(), { attach: vi.fn(), sendCommand: fake.chooser });
  }
  return {
    app: { getAppMetrics: () => fake.views.map((view) => ({ pid: view.webContents.id, memory: { workingSetSize: fake.memory } })) },
    session: { fromPartition: vi.fn(() => { const value = new IsolatedSession(); fake.sessions.push(value); return value; }) },
    WebContentsView: class { webContents = new Contents(); setVisible = vi.fn(); setBounds = vi.fn(); constructor(readonly options: unknown) { fake.views.push(this); } },
  };
});
vi.mock('./parser', async () => {
  const { documentReferences } = await import('./references');
  return { HtmlReferenceParser: class { parse = documentReferences; close = vi.fn(); } };
});
function fixture(raw = '<script src="app.js"></script><p>hello</p>') {
  const abort = new AbortController(), hash = createHash('sha256').update(raw).digest('hex');
  const source: HtmlSource = { path: 'index.html', hash, signal: abort.signal, assert: vi.fn(), read: vi.fn(async (path) => ({ bytes: new TextEncoder().encode(path === 'index.html' ? raw : 'document.body.dataset.script="yes";'), hash })) };
  const service = new FileHtmlService(() => source), emit = vi.fn(), input = (): HtmlOpenInput => ({ id: randomUUID(), ref: { id: randomUUID(), lease: randomUUID(), generation: 1 }, baseHash: hash });
  const parent = Object.assign(new EventEmitter(), { isDestroyed: () => false, isFocused: vi.fn(() => true), isVisible: () => true, isMinimized: vi.fn(() => false), getContentSize: () => [800, 600], webContents: { getZoomFactor: () => 1, focus: vi.fn() }, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } }) as unknown as BrowserWindow;
  return { abort, source, service, emit, input, parent };
}
const services: FileHtmlService[] = [];
beforeEach(() => { vi.clearAllMocks(); fake.views.length = 0; fake.sessions.length = 0; fake.memory = 0; fake.load.mockResolvedValue(undefined); fake.heartbeat.mockResolvedValue(0); fake.chooser.mockResolvedValue({}); });
afterEach(() => { for (const service of services.splice(0)) service.closeOwner('owner'); vi.useRealTimers(); });
describe('HTML native host lifecycle (Electron boundary isolated)', () => {
  it('accepts an extensionless source only with the main-derived readonly HTML mapping', async () => {
    const f = fixture('<h1>EXTENSIONLESS_ATTACHMENT</h1>'); services.push(f.service); f.source.path = 'attachment';
    f.source.read = vi.fn(async () => ({ bytes: new TextEncoder().encode('<h1>EXTENSIONLESS_ATTACHMENT</h1>'), hash: f.source.hash }));
    await expect(f.service.open('owner', f.input(), f.parent, f.emit)).rejects.toThrow('UNSUPPORTED'); expect(fake.views).toHaveLength(0);
    f.source.attachmentHtml = true; expect((await f.service.open('owner', f.input(), f.parent, f.emit)).state).toBe('ready');
    expect(fake.views[0].options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true });
    expect(fake.load.mock.calls[1][0]).toMatch(/\/attachment$/); expect(fake.chooser).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true });
  });
  it('uses only the independent input guard and refuses other frames, network, reload, XHR and unmapped files', async () => {
    const f = fixture(); services.push(f.service); const input = f.input();
    expect((await f.service.open('owner', input, f.parent, f.emit)).state).toBe('ready');
    const view = fake.views[0], session = fake.sessions[0], entry = fake.load.mock.calls[1][0];
    expect(view.options.webPreferences).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true }); expect(view.options.webPreferences.preload).toMatch(/m9-html-guard\.js$/);
    expect(fake.chooser).toHaveBeenCalledWith('Page.setInterceptFileChooserDialog', { enabled: true, cancel: true });
    expect(fake.chooser.mock.calls.map(([command]) => command)).toEqual(['Page.enable', 'Page.setInterceptFileChooserDialog', 'Page.setInterceptFileChooserDialog']);
    expect(fake.chooser.mock.invocationCallOrder[1]).toBeLessThan(fake.load.mock.invocationCallOrder[1]);
    expect(fake.chooser.mock.invocationCallOrder[2]).toBeGreaterThan(fake.load.mock.invocationCallOrder[1]);
    const request = (url: string, type = 'mainFrame', extra = {}) => {
      const callback = vi.fn(); session.request({ url, resourceType: type, method: 'GET', webContentsId: view.webContents.id, frame: view.webContents.mainFrame, ...extra }, callback); return callback.mock.calls[0][0];
    };
    expect(request(entry)).toEqual({ cancel: false }); expect(request(entry)).toEqual({ cancel: true });
    const script = new URL('app.js', entry).href; expect(request(script, 'script')).toEqual({ cancel: false });
    for (const extra of [{ frame: {} }, { webContentsId: 999 }, { method: 'POST' }]) expect(request(script, 'script', extra)).toEqual({ cancel: true });
    expect(request(script, 'xhr')).toEqual({ cancel: true }); expect(request('file:///tmp/app.js', 'script')).toEqual({ cancel: true }); expect(request('https://example.invalid/app.js', 'script')).toEqual({ cancel: true }); expect(request(new URL('secret.js', entry).href, 'script')).toEqual({ cancel: true });
    const response = session.protocolHandler(new Request(script)); expect(await response.text()).toContain('dataset.script');
    const navigation = { preventDefault: vi.fn() }; view.webContents.emit('will-frame-navigate', navigation); expect(navigation.preventDefault).toHaveBeenCalled();
    expect(view.webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
    expect(session.setPermissionCheckHandler.mock.calls[0][0]()).toBe(false);
    f.service.bounds('other', { id: input.id, x: 50, y: 60, width: 400, height: 300, visible: true }); expect(view.setVisible).toHaveBeenLastCalledWith(false);
    f.service.bounds('owner', { id: input.id, x: 50, y: 60, width: 400, height: 300, visible: true }); expect(view.setVisible).toHaveBeenLastCalledWith(true);
    f.parent.emit('sheet-begin'); expect(view.setVisible).toHaveBeenLastCalledWith(false); f.parent.emit('sheet-end'); expect(view.setVisible).toHaveBeenLastCalledWith(true);
  });
  it('returns child keyboard focus when hidden for an App popup or closed, but respects sheets and inactive windows', async () => {
    const f = fixture(); services.push(f.service); const input = f.input();
    await f.service.open('owner', input, f.parent, f.emit); const view = fake.views[0];
    const bounds = { id: input.id, x: 50, y: 60, width: 400, height: 300, visible: true };
    f.service.bounds('owner', bounds); view.webContents.isFocused.mockReturnValue(true);
    f.parent.emit('sheet-begin'); expect(f.parent.webContents.focus).not.toHaveBeenCalled(); f.parent.emit('sheet-end');
    f.service.bounds('owner', { ...bounds, visible: false }); expect(f.parent.webContents.focus).toHaveBeenCalledTimes(1);
    vi.mocked(f.parent.isMinimized).mockReturnValue(true); f.parent.emit('minimize'); expect(f.parent.webContents.focus).toHaveBeenCalledTimes(1);
    vi.mocked(f.parent.isMinimized).mockReturnValue(false); vi.mocked(f.parent.isFocused).mockReturnValue(false);
    f.service.bounds('owner', { ...bounds, visible: false }); expect(f.parent.webContents.focus).toHaveBeenCalledTimes(1);
    vi.mocked(f.parent.isFocused).mockReturnValue(true); f.service.close('owner', input.id); expect(f.parent.webContents.focus).toHaveBeenCalledTimes(2);
  });
  it('fails closed when native chooser protection cannot attach or its guard is lost', async () => {
    const f = fixture(); services.push(f.service); fake.chooser.mockRejectedValueOnce(new Error('chooser isolation unavailable'));
    expect((await f.service.open('owner', f.input(), f.parent, f.emit)).state).toBe('failed');
    expect(fake.load.mock.calls.every(([url]) => url === 'about:blank')).toBe(true); expect(fake.views[0].webContents.close).toHaveBeenCalled();
    await f.service.open('owner', f.input(), f.parent, f.emit); fake.views[1].webContents.debugger.emit('detach', {}, 'unexpected');
    expect(fake.views[1].webContents.close).toHaveBeenCalled(); expect(f.emit.mock.lastCall?.[0].message).toContain('文件选择隔离已失效');
    await f.service.open('owner', f.input(), f.parent, f.emit); fake.views[2].webContents.emit('preload-error', {}, 'guard', new Error('failed'));
    expect(fake.views[2].webContents.close).toHaveBeenCalled(); expect(f.emit.mock.lastCall?.[0].message).toContain('文件输入隔离未能加载');
  });
  it('revokes active resources on source close, rejects changed versions and reuses only cleared sessions', async () => {
    const f = fixture(); services.push(f.service);
    await expect(f.service.open('owner', { ...f.input(), baseHash: '0'.repeat(64) }, f.parent, f.emit)).rejects.toThrow('CHANGED');
    const first = f.input(); await f.service.open('owner', first, f.parent, f.emit);
    const view = fake.views[0], session = fake.sessions[0], old = session.protocolHandler;
    f.service.close('owner', first.id); expect(view.webContents.close).toHaveBeenCalledWith({ waitForBeforeUnload: false }); expect(session.protocolHandler).toBeNull();
    expect(old(new Request(fake.load.mock.calls[0][0])).status).toBe(404); expect(session.clearStorageData).toHaveBeenCalled();
    await f.service.open('owner', f.input(), f.parent, f.emit); expect(fake.sessions).toHaveLength(1);
    f.abort.abort(); expect(fake.views[1].webContents.close).toHaveBeenCalled(); expect(f.emit.mock.lastCall?.[0].state).toBe('failed');
  });
  it('handles cancel-before-open and cancel-during-load without accepting a late ready result', async () => {
    const f = fixture(); services.push(f.service); const input = f.input();
    f.service.close('owner', input.id); await expect(f.service.open('owner', input, f.parent, f.emit)).rejects.toThrow('CANCELLED');
    let finish!: () => void; fake.load.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const next = f.input(), pending = f.service.open('owner', next, f.parent, f.emit);
    await vi.waitFor(() => expect(fake.load).toHaveBeenCalled()); f.service.close('owner', next.id);
    expect((await pending).state).toBe('closed'); finish(); await Promise.resolve(); expect(f.emit.mock.calls.some(([value]) => value.state === 'ready')).toBe(false);
  });
  it('terminates load timeouts and post-load hung or oversized processes while retaining a retry result', async () => {
    vi.useFakeTimers(); const f = fixture(); services.push(f.service);
    fake.load.mockImplementation(() => new Promise(() => undefined)); const pending = f.service.open('owner', f.input(), f.parent, f.emit);
    await vi.advanceTimersByTimeAsync(HTML_LIMITS.timeout + 1); expect((await pending).message).toContain('15秒'); expect(fake.views[0].webContents.close).toHaveBeenCalled();
    fake.load.mockResolvedValue(undefined); await f.service.open('owner', f.input(), f.parent, f.emit);
    fake.heartbeat.mockImplementation(() => new Promise(() => undefined)); await vi.advanceTimersByTimeAsync(7001);
    expect(fake.views[1].webContents.forcefullyCrashRenderer).toHaveBeenCalled(); expect(f.emit.mock.lastCall?.[0].message).toContain('5秒');
    fake.heartbeat.mockResolvedValue(0); await f.service.open('owner', f.input(), f.parent, f.emit); fake.memory = 512 * 1024 + 1; await vi.advanceTimersByTimeAsync(2001);
    expect(fake.views[2].webContents.forcefullyCrashRenderer).toHaveBeenCalled(); expect(f.emit.mock.lastCall?.[0].message).toContain('512 MiB');
  });
});
