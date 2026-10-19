import { BrowserWindow } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { FileError } from '@shared/files';

/** Mermaid needs a DOM. Give it a separate, sandboxed renderer with no preload,
 * no IPC bridge, no remote resources, and an enforceable process deadline. */
export class FileDiagramRenderer {
  private window: BrowserWindow | null = null;
  private queue: { start: () => void; cancel: () => void }[] = [];
  private busy = false;
  private disposed = false;
  constructor(private readonly rendererDirectory: string, private readonly devURL?: string) {}
  render(source: string, theme: 'light' | 'dark', signal: AbortSignal): Promise<string> {
    if (this.disposed || signal.aborted) return Promise.reject(new FileError('CANCELLED', '图表渲染已取消'));
    if (this.queue.length >= 60) return Promise.reject(new FileError('TOO_LARGE', '当前图表队列已满，请稍后重试'));
    return new Promise((resolve, reject) => {
      const job = {
        start: () => { signal.removeEventListener('abort', job.cancel); this.busy = true; void this.run(source, theme, signal).then(resolve, reject).finally(() => { this.busy = false; this.pump(); }); },
        cancel: () => { this.queue = this.queue.filter((entry) => entry !== job); signal.removeEventListener('abort', job.cancel); reject(new FileError('CANCELLED', '图表渲染已取消')); },
      };
      signal.addEventListener('abort', job.cancel, { once: true }); this.queue.push(job); this.pump();
    });
  }
  private pump() { if (!this.busy && !this.disposed) this.queue.shift()?.start(); }
  private async run(source: string, theme: 'light' | 'dark', signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const win = new BrowserWindow({ show: false, width: 1200, height: 900, title: 'WillYou diagram renderer', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, partition: `willyou-diagram-${randomUUID()}` } });
    this.window = win;
    const resourceBase = this.devURL ? new URL(this.devURL).origin + '/' : pathToFileURL(this.rendererDirectory + '/').href;
    win.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(resourceBase) }));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    let timeout: ReturnType<typeof setTimeout> | undefined, abort = () => undefined;
    try {
      return await Promise.race([
        new Promise<string>((_resolve, reject) => {
          abort = () => { if (!win.isDestroyed()) win.destroy(); reject(new FileError('CANCELLED', '图表渲染已取消')); };
          signal.addEventListener('abort', abort, { once: true });
          timeout = setTimeout(() => { if (!win.isDestroyed()) win.destroy(); reject(new FileError('TIMEOUT', '图表渲染超过 15 秒，已停止')); }, 15000);
        }),
        (async () => {
          if (this.devURL) await win.loadURL(new URL('m9-diagram.html', this.devURL + '/').href);
          else await win.loadFile(join(this.rendererDirectory, 'm9-diagram.html'));
          signal.throwIfAborted();
          const svg: unknown = await win.webContents.executeJavaScript(`window.renderWillYouDiagram(${JSON.stringify({ source, theme })})`);
          if (typeof svg !== 'string' || Buffer.byteLength(svg) > 4 * 1024 * 1024 || !svg.startsWith('<svg')) throw new FileError('TOO_LARGE', '图表输出无效或超过 4 MiB');
          signal.throwIfAborted(); return svg;
        })(),
      ]);
    } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); if (!win.isDestroyed()) win.destroy(); if (this.window === win) this.window = null; }
  }
  dispose() { this.disposed = true; for (const job of [...this.queue]) job.cancel(); this.window?.destroy(); this.window = null; }
}
