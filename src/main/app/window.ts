// Window chrome follows Yoda (Apache-2.0) src/main/app/window.ts.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, nativeTheme, type IpcMainEvent } from 'electron';
import type { Theme } from '@shared/app-settings';
import { appIcon } from './icon';

let mainWindow: BrowserWindow | null = null;
let mainDocumentURL: string | null = null;
let appQuitting = false;
const MAC_TITLEBAR_HEIGHT = 40;

/** Once a real quit starts, the last window stops hiding and actually closes. */
export function markAppQuitting(): void {
  appQuitting = true;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow && !mainWindow.isDestroyed() ? mainWindow : null;
}

/** A renderer navigation must not carry terminal authority to another page. */
export function isMainRenderer(event: Pick<IpcMainEvent, 'sender' | 'senderFrame'>): boolean {
  const win = getMainWindow();
  if (!win || event.sender !== win.webContents || event.sender.isDestroyed() ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame || !mainDocumentURL) return false;
  try {
    const current = new URL(event.senderFrame.url);
    current.hash = '';
    return current.href === mainDocumentURL;
  } catch { return false; }
}

/** Native chrome (menus, dialogs, window background) follows the theme setting. */
export function applyNativeTheme(theme: Theme | null): void {
  nativeTheme.themeSource = theme === null ? 'system' : theme === 'ydark' ? 'dark' : 'light';
}

function windowBackground(): string {
  return nativeTheme.shouldUseDarkColors ? '#111111' : '#ffffff';
}

export async function createMainWindow(): Promise<BrowserWindow> {
  const isMac = process.platform === 'darwin';
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    title: 'WillYou',
    icon: appIcon,
    show: false,
    backgroundColor: windowBackground(),
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          titleBarOverlay: { height: MAC_TITLEBAR_HEIGHT },
          trafficLightPosition: { x: 14, y: 14 },
          acceptFirstMouse: true,
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep terminal painting and renderer state current when the workspace is
      // covered by another window; PTY sessions continue to run in the background.
      backgroundThrottling: false,
    },
  });
  mainWindow = win;
  const documentURL = new URL(process.env.ELECTRON_RENDERER_URL || pathToFileURL(join(__dirname, '../renderer/index.html')).href);
  documentURL.hash = '';
  mainDocumentURL = documentURL.href;

  // macOS: closing the window hides it (terminals keep running); Cmd+Q is the real quit.
  win.on('close', (event) => {
    if (appQuitting) return;
    event.preventDefault();
    if (isMac) win.hide();
    else app.quit();
  });
  win.on('closed', () => {
    if (mainWindow === win) { mainWindow = null; mainDocumentURL = null; }
  });
  win.once('ready-to-show', () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(__dirname, '../renderer/index.html'));
  return win;
}
