import type { FileDocument } from '@shared/files';
import type { FileClient } from '../file-buffer';
import { readFileResource } from '../resource';
import { ViewerSessionSlot } from '../pdf/session-slot';
import { reviewTextVerdict, type ReviewTextInfo, type ReviewTextWindow } from './model.mjs';

const slot = new ViewerSessionSlot<ReviewTextClient>();
let active = 0;
export const activeReviewTextWorkers = () => active;
export class ReviewTextClient {
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private readonly worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private serial = 0;
  private closed = false;
  private detach: () => void = () => undefined;
  readonly ready: Promise<ReviewTextInfo>;
  constructor(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) {
    active++;
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id); if (!pending || this.closed) return;
      this.pending.delete(data.id); clearTimeout(pending.timer);
      if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result);
    };
    this.worker.onerror = event => { event.preventDefault(); void this.destroy(new Error('只读文本预览进程发生错误，请重试')); };
    this.worker.onmessageerror = () => { void this.destroy(new Error('只读文本预览返回无效数据')); };
    const abort = () => { void this.destroy(new DOMException('只读文本预览已关闭', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true }); this.detach = () => signal.removeEventListener('abort', abort);
    this.ready = this.request<ReviewTextInfo>('open', [bytes.buffer], [bytes.buffer]);
    if (signal.aborted) abort();
  }
  private request<T>(method: string, args: unknown[], transfer: Transferable[] = []): Promise<T> {
    if (this.closed) return Promise.reject(new DOMException('只读文本预览已关闭', 'AbortError'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { void this.destroy(new Error('只读文本预览超过 15 秒，已停止；可重试或保存副本')); }, 15000);
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
      try { this.worker.postMessage({ id, method, args }, transfer); }
      catch (error) { this.pending.delete(id); clearTimeout(timer); reject(error); }
    });
  }
  window(index: number) { return this.request<ReviewTextWindow>('window', [index]); }
  async destroy(error: Error = new DOMException('只读文本预览已关闭', 'AbortError')): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.detach(); this.worker.terminate(); active--;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
}

export function createReviewTextClient(file: FileDocument, api: Pick<FileClient, 'chunk' | 'cancelResource'>, signal: AbortSignal) {
  return slot.replace(async () => {
    const verdict = reviewTextVerdict(file.content?.kind ?? 'unsupported', file.revision.size);
    if (verdict !== 'readable') throw new Error(verdict === 'unsupported' ? '[UNSUPPORTED] 此来源不支持文本预览' : verdict === 'too-large' ? '[TOO_LARGE] 文本超过 256 MiB 只读预览上限' : '[INVALID_INPUT] 无效文件大小');
    // The existing owner/revision-bound1MiB transport verifies complete bytes
    // and final SHA before any ready state. Transfer releases the UI buffer.
    const bytes = await readFileResource(file, api, signal);
    const client = new ReviewTextClient(bytes, signal);
    try { await client.ready; return client; } catch (error) { await client.destroy(); throw error; }
  }, signal);
}
