// Window chrome follows Yoda (Apache-2.0) src/main/app/window.ts.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BaseWindow, WebContentsView, nativeTheme, type IpcMainEvent, type WebContents } from 'electron';
import type { Theme } from '@shared/app-settings';
import { windowShownEvent } from '@shared/events';
import { appIcon } from './icon';
import { bindMainHost, clearMainHost, getMainWindow, getMainShell, getMainWindowContents, invalidateMainShell, replaceMainShell } from './window-host';
export { getMainWindow, getMainWindowContents, mainWindowForContents, getMainShell } from './window-host';

let creating: Promise<BaseWindow> | null = null;
let shellLoading: Promise<void> | null = null;
let mainDocumentURL: string | null = null;
let shellLoaded = false;
let shellNeedsRecovery = false;
let shellLossRevision = 0;
let presentedRecovery: Promise<void> | null = null;
let appQuitting = false;
let shutdownCommitted = false;
const MAC_TITLEBAR_HEIGHT = 40;
const SHELL_LOAD_TIMEOUT = 30_000;

/** Once a real quit starts, the last window stops hiding and no new host is made. */
export function beginAppShutdown(): void { shutdownCommitted = true; }
export function markAppQuitting(): void { shutdownCommitted = true; appQuitting = true; }

function notifyWindowShown(win: BaseWindow): void {
  if (getMainWindow() === win) getMainWindowContents()?.send(windowShownEvent.name);
}

/** A native window can become visible without a separate app.activate event.
 * Repair only a lost trusted shell, never show/activate a hidden root or replay
 * browser work. A failed repair waits for the next explicit native presentation. */
function recoverPresentedShell(win: BaseWindow): void {
  if (shutdownCommitted || getMainWindow() !== win || !win.isVisible() ||
      creating || shellLoading || presentedRecovery ||
      (!shellNeedsRecovery && getMainWindowContents())) return;
  const attempt = (async () => {
    try {
      await ensureMainWindow();
      const contents = getMainWindowContents();
      if (shutdownCommitted || getMainWindow() !== win || !contents) return;
      if (!shellLoaded || shellNeedsRecovery) await loadShell(contents);
      if (getMainWindow() === win && win.isVisible() && !shutdownCommitted) notifyWindowShown(win);
    } catch (error) {
      console.warn('[main-window] trusted shell recovery failed', error instanceof Error ? error.name : 'Error');
    }
  })();
  presentedRecovery = attempt;
  void attempt.finally(() => { if (presentedRecovery === attempt) presentedRecovery = null; });
}

function shellLost(win: BaseWindow, contents: WebContents): void {
  if (!invalidateMainShell(contents, 'renderer-gone')) return;
  shellLoaded = false;
  shellNeedsRecovery = true;
  shellLossRevision++;
  // Electron can unset/remove the native view during the destruction event.
  // Recheck the bound root after that event finishes.
  queueMicrotask(() => recoverPresentedShell(win));
}

function originalDocument(contents: WebContents): boolean {
  if (!mainDocumentURL || contents.isDestroyed()) return false;
  try {
    const current = new URL(contents.mainFrame.url);
    current.hash = '';
    return current.href === mainDocumentURL;
  } catch { return false; }
}

/** A renderer navigation must not carry terminal authority to another page. */
export function isMainRenderer(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>): boolean {
  const contents = getMainWindowContents();
  return !!contents && event.sender === contents && !contents.isDestroyed() &&
    !!event.senderFrame && event.senderFrame === contents.mainFrame && originalDocument(contents);
}

/** Native chrome (menus, dialogs, window background) follows the theme setting. */
export function applyNativeTheme(theme: Theme | null): void {
  nativeTheme.themeSource = theme === null ? 'system' : theme === 'ydark' ? 'dark' : 'light';
  getMainWindow()?.setBackgroundColor(windowBackground());
  getMainShell()?.setBackgroundColor(windowBackground());
}
function windowBackground(): string { return nativeTheme.shouldUseDarkColors ? '#111111' : '#ffffff'; }

function loadShell(contents: WebContents): Promise<void> {
  if (shellLoading) return shellLoading;
  const lossRevision = shellLossRevision;
  const load = process.env.ELECTRON_RENDERER_URL
    ? () => contents.loadURL(process.env.ELECTRON_RENDERER_URL!)
    : () => contents.loadFile(join(__dirname, '../renderer/index.html'));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const pending = (async () => {
    await Promise.race([
      load(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('WillYou 界面加载超时')), SHELL_LOAD_TIMEOUT); }),
    ]);
    if (getMainWindowContents() !== contents || !originalDocument(contents) || lossRevision !== shellLossRevision) {
      throw new Error('WillYou 界面已变化');
    }
    shellLoaded = true;
    shellNeedsRecovery = false;
  })();
  shellLoading = pending;
  void pending.finally(() => { clearTimeout(timer); if (shellLoading === pending) shellLoading = null; }).catch(() => {});
  return pending;
}

function closeContents(win: BaseWindow): void {
  for (const view of [...win.contentView.children]) {
    if (view instanceof WebContentsView && view.webContents&&!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
  }
}

function attachShell(win:BaseWindow,replace=false):WebContents {
      const shell = new WebContentsView({ webPreferences: {
        preload: join(__dirname, '../preload/index.js'), sandbox: false, contextIsolation: true, nodeIntegration: false,
        backgroundThrottling: false,
      } });
      shell.setBackgroundColor(windowBackground());
      win.contentView.addChildView(shell);
      const contents = shell.webContents;
      const resize = () => {
        if (!win.isDestroyed() && !contents.isDestroyed()) {
          const { width, height } = win.getContentBounds();
          shell.setBounds({ x: 0, y: 0, width, height });
        }
      };
      resize();

      if(replace)replaceMainShell(win,shell);else bindMainHost(win,shell);
      const documentURL = new URL(process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(__dirname, '../renderer/index.html')).href);
      documentURL.hash = '';
      mainDocumentURL = documentURL.href;
      shellLoaded = false;
      contents.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument && getMainWindowContents() === contents) {
          shellLoaded = false;
          invalidateMainShell(contents, 'navigation');
        }
      });
      contents.on('did-finish-load', () => { if (getMainWindowContents() === contents) shellLoaded = originalDocument(contents); });
      contents.on('render-process-gone', () => shellLost(win, contents));
      contents.once('destroyed', () => shellLost(win, contents));
      return contents;
}

function resizeMainShell(win:BaseWindow):void{
  const shell=getMainShell();if(!shell||win!==getMainWindow())return;
  const {width,height}=win.getContentBounds();shell.setBounds({x:0,y:0,width,height});
}

/** Create the unique native root, and load its trusted shell without activating a
 * window. Background operations and explicit window presentation share this creation. */
export function ensureMainWindow(): Promise<BaseWindow> {
  if (shutdownCommitted) return Promise.reject(new Error('WillYou 正在退出'));
  if (creating) return creating;
  const existing = getMainWindow();
  if(existing){
    if(getMainWindowContents())return Promise.resolve(existing);
    shellLoading=null;
    const recovery=(async()=>{const contents=attachShell(existing,true);await loadShell(contents);return existing;})();
    creating=recovery;void recovery.finally(()=>{if(creating===recovery)creating=null;}).catch(()=>{});
    return recovery;
  }
  const work = (async () => {
    const isMac = process.platform === 'darwin';
    const win = new BaseWindow({
      width: 1400, height: 900, minWidth: 700, minHeight: 500, title: 'WillYou', icon: appIcon,
      show: false, backgroundColor: windowBackground(),
      ...(isMac ? { titleBarStyle: 'hiddenInset' as const, titleBarOverlay: { height: MAC_TITLEBAR_HEIGHT },
        trafficLightPosition: { x: 14, y: 14 }, acceptFirstMouse: true } : {}),
    });
    try {
      const contents=attachShell(win);
      const resize=()=>resizeMainShell(win);
      win.on('resize',resize);win.on('enter-full-screen',resize);win.on('leave-full-screen',resize);
      win.on('close', (event) => {
        if (!appQuitting) {
          event.preventDefault();
          if (isMac) win.hide(); else app.quit();
          return;
        }
        // The confirmed quit path drains page and file services first. BaseWindow
        // itself does not dispose its child WebContents.
        closeContents(win);
      });
      win.on('closed', () => {
        if (clearMainHost(win)) { mainDocumentURL = null; shellLoaded = false; shellNeedsRecovery = false; }
      });
      win.on('show', () => recoverPresentedShell(win));
      win.on('focus', () => recoverPresentedShell(win));
      win.on('restore', () => {
        if (shellNeedsRecovery || !getMainWindowContents()) recoverPresentedShell(win);
        else notifyWindowShown(win);
      });
      await loadShell(contents);
      if (shutdownCommitted || getMainWindow() !== win) throw new Error('WillYou 主窗口已关闭');
      resize();
      return win;
    } catch (error) {
      // Registry callers await the same initialization outcome, so no page has
      // been attached to a failed initial shell by a successful ensure().
      if (!win.isDestroyed()) { closeContents(win); win.destroy(); }
      if (clearMainHost(win)) { mainDocumentURL = null; shellLoaded = false; shellNeedsRecovery = false; }
      throw error;
    }
  })();
  creating = work;
  void work.finally(() => { if (creating === work) creating = null; }).catch(() => {});
  return work;
}

export async function showMainWindow(): Promise<BaseWindow> {
  const win = await ensureMainWindow();
  const contents = getMainWindowContents();
  if (!contents || getMainWindow() !== win || shutdownCommitted) throw new Error('WillYou 主窗口不可用');
  if (!shellLoaded || shellNeedsRecovery) await loadShell(contents);
  if (shutdownCommitted || getMainWindow() !== win) throw new Error('WillYou 主窗口已关闭');
  const wasHidden = !win.isVisible()||win.isMinimized();
  if(win.isMinimized())win.restore();
  win.show();
  if (wasHidden) notifyWindowShown(win);
  return win;
}

/** The normal startup path presents the shell only after loading it. */
export function createMainWindow(): Promise<BaseWindow> { return showMainWindow(); }
