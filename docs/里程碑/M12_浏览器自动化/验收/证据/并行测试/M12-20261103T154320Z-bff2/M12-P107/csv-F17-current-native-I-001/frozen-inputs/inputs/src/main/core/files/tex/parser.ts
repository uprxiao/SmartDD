import { Worker } from 'node:worker_threads';
import { FileError } from '@shared/files';
import { TEX_LIMITS } from '@shared/file-tex';
import type { TexReferences } from './references';

export class TexParser {
  private worker: Worker;
  private sequence = 0;
  private closed = false;
  private pending: { reject: (error: Error) => void } | null = null;
  constructor(path: string) { this.worker = new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } }); this.worker.on('error', (error) => this.close(error)); this.worker.on('exit', () => this.close(new FileError('IO', 'TeX 引用解析器已退出'))); }
  parse(source: string, signal: AbortSignal): Promise<TexReferences> {
    return this.request({ source }, signal);
  }
  normalizePdf(pdf: Uint8Array, signal: AbortSignal): Promise<Uint8Array | null> {
    if (pdf.byteLength > TEX_LIMITS.outputBytes) return Promise.reject(new FileError('TOO_LARGE', 'TeX PDF 图片超过 40 MiB'));
    return this.request({ pdf }, signal);
  }
  private request<T>(data: { source: string } | { pdf: Uint8Array }, signal: AbortSignal): Promise<T> {
    if (this.closed || signal.aborted) return Promise.reject(new FileError('CANCELLED', 'TeX 引用解析已取消'));
    if (this.pending) return Promise.reject(new FileError('CONFLICT', 'TeX 引用解析正在进行'));
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const cleanup = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); this.worker.removeListener('message', receive); this.pending = null; };
      const fail = (error: Error) => { cleanup(); reject(error); };
      const abort = () => this.close(new FileError('CANCELLED', 'TeX 引用解析已取消'));
      const receive = (message: { id: number; result: T; error?: string }) => { if (message.id !== id) return; cleanup(); message.error ? reject(new FileError('INVALID_INPUT', message.error)) : resolve(message.result); };
      const timer = setTimeout(() => this.close(new FileError('TIMEOUT', 'TeX 引用解析超过 5 秒')), TEX_LIMITS.parseMs);
      this.pending = { reject: fail }; signal.addEventListener('abort', abort, { once: true }); this.worker.on('message', receive);
      try { this.worker.postMessage({ id, ...data }); } catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  close(error: Error = new FileError('CANCELLED', 'TeX 引用解析已关闭')) { if (this.closed) return; this.closed = true; this.pending?.reject(error); void this.worker.terminate(); }
}
