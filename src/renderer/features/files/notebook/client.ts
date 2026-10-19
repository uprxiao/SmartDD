import type { NotebookAsset, NotebookChoices, NotebookInfo, NotebookWindow, TextPart } from './model';
import { ViewerSessionSlot } from '../pdf/session-slot';
const slot = new ViewerSessionSlot<NotebookClient>();
let active = 0;
export const activeNotebookWorkers = () => active;
export class NotebookClient {
  private readonly pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private serial = 0;
  private closed = false;
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private detach: () => void = () => undefined;
  readonly ready: Promise<NotebookInfo>;
  constructor(bytes: Uint8Array<ArrayBuffer>, filename: string, signal: AbortSignal) {
    active++;
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id); if (!pending || this.closed) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = (event) => { event.preventDefault(); void this.destroy(new Error('Notebook 解析进程发生错误，请重试')); };
    this.worker.onmessageerror = () => { void this.destroy(new Error('Notebook 解析进程返回无效数据')); };
    const abort = () => { void this.destroy(new DOMException('Notebook 已关闭', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true }); this.detach = () => signal.removeEventListener('abort', abort);
    this.ready = this.request('open', [bytes.buffer, filename], [bytes.buffer]);
    if (signal.aborted) abort();
  }
  private request<T>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new DOMException('Notebook 已关闭', 'AbortError'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.destroy(new Error('Notebook 预览超过 15 秒，已停止；可重试或保存副本')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, method, args }, transfer); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  window(start: number, count: number, choices: NotebookChoices) { return this.request<NotebookWindow>('window', [start, count, choices]); }
  chunk(key: string, offset: number) { return this.request<TextPart>('chunk', [key, offset]); }
  asset(key: string) { return this.request<NotebookAsset>('asset', [key]); }
  svg(source: string) { return this.request<string>('svg', [source]); }
  async copySource(key: string): Promise<void> {
    const parts: string[] = []; let offset = 0;
    do { const part = await this.chunk(key, offset); parts.push(part.text); offset = part.end; if (offset === part.total) break; } while (true);
    if (!this.closed) await navigator.clipboard.writeText(parts.join(''));
  }
  async destroy(error: Error = new DOMException('Notebook 已关闭', 'AbortError')): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.detach(); this.worker.terminate(); active--;
    for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear();
  }
}
export const createNotebookClient = (bytes: Uint8Array<ArrayBuffer>, filename: string, signal: AbortSignal) => slot.replace(async () => new NotebookClient(bytes, filename, signal), signal);

/** Shared slots cover raster outputs, Markdown images and HTML embedded images.
 * Each raster has <=4Mi pixels; eight simultaneous reservations fit 32Mi pixels. */
export class ViewerSlots {
  private used = 0;
  private readonly queue: { signal: AbortSignal; resolve: (release: () => void) => void; reject: (error: unknown) => void; abort: () => void }[] = [];
  constructor(private readonly max: number) {}
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const entry = { signal, resolve, reject, abort: () => { const at = this.queue.indexOf(entry); if (at >= 0) this.queue.splice(at, 1); reject(new DOMException('已关闭', 'AbortError')); } };
      signal.addEventListener('abort', entry.abort, { once: true }); this.queue.push(entry); this.pump();
    });
  }
  private pump(): void {
    while (this.used < this.max && this.queue.length) {
      const entry = this.queue.shift()!; entry.signal.removeEventListener('abort', entry.abort); if (entry.signal.aborted) { entry.reject(new DOMException('已关闭', 'AbortError')); continue; }
      this.used++; let released = false;
      entry.resolve(() => { if (released) return; released = true; this.used--; this.pump(); });
    }
  }
}
export const notebookImageSlots = new ViewerSlots(8), notebookFrameSlots = new ViewerSlots(4);
