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
describe('F36 native-parent shape diagnostics (software-only)', () => {
  it('the old HTML layout requires a shell zoom source; BaseWindow without webContents cannot supply it', async () => {
    const f=fixture();services.push(f.service);const input=f.input();
    expect((await f.service.open('owner',input,f.parent,f.emit)).state).toBe('ready');
    const native = f.parent as any; const shell= native.webContents;
    delete native.webContents;
    try {
      expect(()=>f.service.bounds('owner',{id:input.id,x:20,y:30,width:200,height:100,visible:true})).toThrow(TypeError);
    } finally {native.webContents=shell;}
    f.service.bounds('owner',{id:input.id,x:20,y:30,width:200,height:100,visible:true});
    expect(fake.views[0].setBounds).toHaveBeenLastCalledWith({x:20,y:30,width:200,height:100});
  });
});
