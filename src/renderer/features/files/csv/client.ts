import type { CsvInfo, CsvPart, CsvWindow } from './model';
import { ViewerSessionSlot } from '../pdf/session-slot';
const slot = new ViewerSessionSlot<CsvClient>();
export class CsvClient {
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private readonly pending = new Map<number, { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private serial = 0;
  private closed = false;
  private detach: () => void = () => undefined;
  readonly ready: Promise<CsvInfo>;
  constructor(raw: string, delimiter: ',' | '\t', signal: AbortSignal) {
    this.worker.onmessage = ({ data }) => { const request = this.pending.get(data.id); if (!request || this.closed) return; this.pending.delete(data.id); clearTimeout(request.timer); if (data.error) request.reject(new Error(data.error)); else request.resolve(data.result); };
    this.worker.onerror = (event) => { event.preventDefault(); void this.destroy(new Error('表格解析进程发生错误，可重试或查看源码')); };
    this.worker.onmessageerror = () => { void this.destroy(new Error('表格解析进程返回无效数据')); };
    const abort = () => { void this.destroy(); }; signal.addEventListener('abort', abort, { once: true }); this.detach = () => signal.removeEventListener('abort', abort);
    this.ready = this.request<CsvInfo>('open', [raw, delimiter]); if (signal.aborted) abort();
  }
  private request<T>(method: string, args: unknown[]): Promise<T> {
    if (this.closed) return Promise.reject(new DOMException('表格已关闭', 'AbortError'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.destroy(new Error('表格解析超过15秒，已停止；可重试或查看源码')); }, 15000);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, method, args }); } catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  window(row: number, column: number, rows: number, columns: number) { return this.request<CsvWindow>('window', [row, column, rows, columns]); }
  cell(row: number, column: number, offset = 0) { return this.request<CsvPart>('cell', [row, column, offset]); }
  async copyCell(row: number, column: number): Promise<void> {
    const parts: string[] = []; let offset = 0;
    do { const result = await this.cell(row, column, offset); parts.push(result.text); offset = result.end; if (offset === result.total) break; } while (true);
    if (!this.closed) await navigator.clipboard.writeText(parts.join(''));
  }
  async destroy(error: Error = new DOMException('表格已关闭', 'AbortError')): Promise<void> {
    if (this.closed) return; this.closed = true; this.detach(); this.worker.terminate();
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(error); } this.pending.clear();
  }
}
export const createCsvClient = (raw: string, delimiter: ',' | '\t', signal: AbortSignal) => slot.replace(async () => new CsvClient(raw, delimiter, signal), signal);
