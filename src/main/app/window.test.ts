import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({ windows: [] as any[], views: [] as any[], nextLoad: null as null | (() => Promise<void>) }));
vi.mock('./icon', () => ({ appIcon: '' }));
vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  nativeTheme: { shouldUseDarkColors: false },
  BaseWindow: class extends EventEmitter {
    contentView = { children: [] as any[], addChildView: (view: any) => { this.contentView.children = this.contentView.children.filter(v => v !== view); this.contentView.children.push(view); }, removeChildView: (view:any)=>{this.contentView.children=this.contentView.children.filter(v=>v!==view);}};
    visible = false;
    minimized = false;
    destroyed = false;
    constructor() { super(); native.windows.push(this); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isMinimized() { return this.minimized; }
    restore() { this.minimized=false;this.visible=true;this.emit('restore'); }
    show() { if (!this.visible) { this.visible = true; this.emit('show'); } }
    hide() { this.visible = false; }
    getContentBounds() { return { x: 0, y: 0, width: 1400, height: 900 }; }
    setBackgroundColor() {}
    destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
  },
  WebContentsView: class {
    webContents: any;
    bounds = vi.fn();
    constructor() {
      const wc = new EventEmitter() as any;
      wc.mainFrame = { url: '' };
      wc.destroyed = false;
      wc.isDestroyed = () => wc.destroyed;
      wc.send = vi.fn();
      wc.close = vi.fn(() => { wc.destroyed = true; wc.emit('destroyed'); });
      const load = async (url: string) => {
        wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url });
        const pending = native.nextLoad; native.nextLoad = null;
        if (pending) await pending();
        wc.mainFrame.url = url;
        wc.emit('did-finish-load');
      };
      wc.loadURL = vi.fn(load);
      wc.loadFile = vi.fn((path: string) => load(new URL('file://' + path).href));
      this.webContents = wc;
      native.views.push(this);
    }
    setBounds(value: unknown) { this.bounds(value); }
    setBackgroundColor() {}
  },
}));
import { createMainWindow, ensureMainWindow, getMainWindow, getMainWindowContents, isMainRenderer, showMainWindow } from './window';
import { getMainShellIdentity, mainWindowForContents, observeMainShell } from './window-host';

afterEach(() => {
  for (const win of native.windows.splice(0)) win.destroy();
  native.views.splice(0);
  native.nextLoad = null;
  vi.unstubAllEnvs();
});

describe('single native main host and trusted renderer', () => {
  it('restores the existing minimized main host before an explicit show',async()=>{
    const root=await createMainWindow(),nativeRoot=native.windows[0];nativeRoot.minimized=true;nativeRoot.visible=false;
    expect(await showMainWindow()).toBe(root);expect(nativeRoot.minimized).toBe(false);expect(nativeRoot.visible).toBe(true);expect(native.windows).toHaveLength(1);
  });
  it('shares one hidden creation; explicit show waits for the loaded shell', async () => {
    let release!: () => void;
    native.nextLoad = () => new Promise<void>(resolve => { release = resolve; });
    const background = ensureMainWindow(), other = ensureMainWindow(), visible = showMainWindow();
    expect(background).toBe(other);
    expect(native.windows).toHaveLength(1);
    expect(native.windows[0].visible).toBe(false);
    release();
    const win = await background;
    expect(await other).toBe(win);
    expect(await visible).toBe(win);
    expect(native.windows[0].visible).toBe(true);
    expect(native.views[0].bounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 1400, height: 900 });
  });

  it('leaves background-only ensure hidden and does not reuse a failed initial host', async () => {
    native.nextLoad = async () => { throw new Error('fixture load error'); };
    const failed = ensureMainWindow();
    await expect(failed).rejects.toThrow('fixture load error');
    expect(native.windows[0].destroyed).toBe(true);
    expect(native.views[0].webContents.destroyed).toBe(true);
    expect(getMainWindow()).toBeNull();
    const win = await ensureMainWindow();
    expect(native.windows).toHaveLength(2);
    expect(win.isVisible()).toBe(false);
    expect(await createMainWindow()).toBe(win);
  });

  it('accepts the exact loaded main document and hash navigation, rejects foreign pages/queries/frames/windows', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/');
    const win = await createMainWindow(), wc = getMainWindowContents()!;
    const e = { sender: wc, senderFrame: wc.mainFrame };
    expect(isMainRenderer(e)).toBe(true);
    expect(mainWindowForContents(wc)).toBe(win);
    (wc.mainFrame as any).url = 'http://127.0.0.1:5173/#tasks';
    expect(isMainRenderer(e)).toBe(true);
    for (const url of ['http://127.0.0.1:5173/other', 'http://127.0.0.1:5173/?other', 'https://example.invalid/', 'about:blank']) {
      (wc.mainFrame as any).url = url;
      expect(isMainRenderer(e)).toBe(false);
    }
    (wc.mainFrame as any).url = 'http://127.0.0.1:5173/';
    expect(isMainRenderer({ ...e, senderFrame: {} as never })).toBe(false);
    expect(isMainRenderer({ ...e, sender: {} as never })).toBe(false);
    native.windows[0].destroy();
    expect(isMainRenderer(e)).toBe(false);
    expect(mainWindowForContents(wc)).toBeNull();
  });

  it('does not replace the live native host, but revokes an old shell when the host is destroyed', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', '');
    const first = await createMainWindow(), old = getMainWindowContents()!;
    const oldEvent = { sender: old, senderFrame: old.mainFrame };
    expect(isMainRenderer(oldEvent)).toBe(true);
    expect(await createMainWindow()).toBe(first);
    native.windows[0].destroy();
    const next = await createMainWindow(), wc = getMainWindowContents()!;
    expect(next).not.toBe(first);
    expect(isMainRenderer(oldEvent)).toBe(false);
    expect(isMainRenderer({ sender: wc, senderFrame: wc.mainFrame })).toBe(true);
    expect(getMainWindowContents()).toBe(wc);
  });

  it('invalidates only cross-document navigation or renderer exit, not a hash navigation', async () => {
    await createMainWindow();
    const wc = getMainWindowContents()!, previous = getMainShellIdentity()!;
    const observed = vi.fn(); const release = observeMainShell(observed);
    try {
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true } as never);
      expect(getMainShellIdentity()).toEqual(previous);
      wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false } as never);
      expect(getMainShellIdentity()?.document).toBe(previous.document + 1);
      wc.emit('render-process-gone', {}, {} as never);
      expect(getMainShellIdentity()?.document).toBe(previous.document + 2);
      expect(observed.mock.calls.map(c => c[0].reason)).toEqual(['navigation', 'renderer-gone']);
    } finally { release(); }
  });
  it('recreates only a destroyed shell on the same root, rejects the old sender and retains other views', async()=>{
    const root=await createMainWindow(),old=getMainWindowContents()!,identity=getMainShellIdentity()!;
    const page={webContents:{isDestroyed:()=>false},setVisible:()=>{}} as never;
    root.contentView.addChildView(page);
    old.close({waitForBeforeUnload:false});
    // Actual Electron removes the destroyed native view and unsets its getter.
    native.views[0].webContents=undefined;root.contentView.removeChildView(native.views[0]);
    const current=await createMainWindow(),wc=getMainWindowContents()!;
    expect(current).toBe(root);expect(wc).not.toBe(old);
    expect(root.contentView.children).toContain(page);
    expect(getMainShellIdentity()?.host).toBe(identity.host);
    expect(getMainShellIdentity()?.document).toBeGreaterThan(identity.document);
    expect(isMainRenderer({sender:old,senderFrame:old.mainFrame})).toBe(false);
    expect(isMainRenderer({sender:wc,senderFrame:wc.mainFrame})).toBe(true);
  });
  it('recovers a lost trusted shell on an already visible native root without a second window or app activation', async () => {
    const root = await createMainWindow(), old = getMainWindowContents()!;
    const page = { webContents: { isDestroyed: () => false } } as never;
    root.contentView.addChildView(page);
    old.close({ waitForBeforeUnload: false });
    native.views[0].webContents = undefined;
    root.contentView.removeChildView(native.views[0]);

    await vi.waitFor(() => {
      const current = getMainWindowContents();
      expect(current).not.toBeNull();
      expect(current).not.toBe(old);
      expect(isMainRenderer({ sender: current!, senderFrame: current!.mainFrame })).toBe(true);
      expect(current!.send).toHaveBeenCalledWith('window:shown');
    });
    expect(native.windows).toHaveLength(1);
    expect(root.contentView.children).toContain(page);
    expect(root.isVisible()).toBe(true);
  });
  it('does not show or rebuild a hidden root after shell loss until native presentation, and coalesces show/focus/restore', async () => {
    const root = await createMainWindow(), old = getMainWindowContents()!;
    root.hide();
    old.close({ waitForBeforeUnload: false });
    native.views[0].webContents = undefined;
    root.contentView.removeChildView(native.views[0]);
    await Promise.resolve();
    expect(root.isVisible()).toBe(false);
    expect(getMainWindowContents()).toBeNull();
    expect(native.views).toHaveLength(1);

    let release!: () => void;
    native.nextLoad = () => new Promise<void>(resolve => { release = resolve; });
    root.show();
    root.emit('focus');
    root.emit('restore');
    expect(native.views).toHaveLength(2);
    release();
    await vi.waitFor(() => expect(getMainWindowContents()?.send).toHaveBeenCalledWith('window:shown'));
    expect(native.views).toHaveLength(2);
    expect(native.windows).toHaveLength(1);
  });
  it('recovers a crashed visible shell renderer whose native WebContents is still live without replacing other views', async () => {
    const root = await createMainWindow(), contents = getMainWindowContents()!;
    const page = { webContents: { isDestroyed: () => false } } as never;
    root.contentView.addChildView(page);
    vi.mocked(contents.send).mockClear();
    vi.mocked(contents.loadFile).mockClear();
    contents.emit('render-process-gone', {}, {} as never);
    await vi.waitFor(() => {
      expect(contents.loadFile).toHaveBeenCalledTimes(1);
      expect(contents.send).toHaveBeenCalledWith('window:shown');
    });
    expect(getMainWindowContents()).toBe(contents);
    expect(root.contentView.children).toContain(page);
    expect(native.windows).toHaveLength(1);
  });
  it('waits for a later native presentation after one failed repair instead of retrying in a loop', async () => {
    const root = await createMainWindow(), contents = getMainWindowContents()!;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      vi.mocked(contents.loadFile).mockClear();
      vi.mocked(contents.send).mockClear();
      native.nextLoad = async () => { throw new Error('fixture recovery failure'); };
      contents.emit('render-process-gone', {}, {} as never);
      await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('[main-window] trusted shell recovery failed', 'Error'));
      expect(contents.loadFile).toHaveBeenCalledTimes(1);
      expect(contents.send).not.toHaveBeenCalled();
      root.emit('focus');
      await vi.waitFor(() => expect(contents.send).toHaveBeenCalledWith('window:shown'));
      expect(contents.loadFile).toHaveBeenCalledTimes(2);
      expect(native.windows).toHaveLength(1);
    } finally { warn.mockRestore(); }
  });
  it('notifies the current renderer on explicit re-show and native restore, ignoring the old window', async () => {
    const first = await createMainWindow(), firstContents = getMainWindowContents()!;
    vi.mocked(firstContents.send).mockClear();
    native.windows[0].destroy();
    const current = await createMainWindow(), contents = getMainWindowContents()!;
    vi.mocked(contents.send).mockClear();
    first.emit('restore');
    current.hide();
    expect(await showMainWindow()).toBe(current);
    expect(await showMainWindow()).toBe(current);
    current.emit('restore');
    native.windows[1].destroy();
    current.emit('restore');
    expect(firstContents.send).not.toHaveBeenCalled();
    expect(vi.mocked(contents.send).mock.calls).toEqual([['window:shown'], ['window:shown']]);
  });
});
