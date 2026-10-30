import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ windows: [] as any[] }));
vi.mock('./icon', () => ({ appIcon: '' }));
vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false },
  BrowserWindow: class extends EventEmitter {
    webContents = { mainFrame: { url: '' }, isDestroyed: () => false };
    constructor() { super(); native.windows.push(this); }
    isDestroyed() { return false; }
    async loadURL(url: string) { this.webContents.mainFrame.url = url; }
    async loadFile(path: string) { this.webContents.mainFrame.url = `file://${path}`; }
  },
}));
import { createMainWindow, isMainRenderer } from './window';
afterEach(() => { for (const win of native.windows.splice(0)) win.emit('closed'); vi.unstubAllEnvs(); });
describe('trusted terminal renderer document', () => {
  it('accepts the exact loaded main document and hash navigation, rejects foreign pages/queries/frames/windows', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/');
    const win = await createMainWindow(); const wc = win.webContents;
    const e = { sender: wc, senderFrame: wc.mainFrame };
    expect(isMainRenderer(e)).toBe(true);
    (wc.mainFrame as any).url = 'http://127.0.0.1:5173/#tasks'; expect(isMainRenderer(e)).toBe(true);
    for (const url of ['http://127.0.0.1:5173/evil', 'http://127.0.0.1:5173/?injected', 'https://example.invalid/', 'about:blank']) {
      (wc.mainFrame as any).url = url; expect(isMainRenderer(e)).toBe(false);
    }
    (wc.mainFrame as any).url = 'http://127.0.0.1:5173/';
    expect(isMainRenderer({ ...e, senderFrame: {} as never })).toBe(false);
    expect(isMainRenderer({ ...e, sender: {} as never })).toBe(false);
    native.windows[0].emit('closed'); expect(isMainRenderer(e)).toBe(false);
  });
  it('accepts a packaged file document and revokes an old window after replacement', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const first = await createMainWindow(); const e = { sender: first.webContents, senderFrame: first.webContents.mainFrame };
    expect(isMainRenderer(e)).toBe(true);
    const second = await createMainWindow();
    expect(isMainRenderer(e)).toBe(false);
    expect(isMainRenderer({ sender: second.webContents, senderFrame: second.webContents.mainFrame })).toBe(true);
  });
});
