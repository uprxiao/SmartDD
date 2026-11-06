import { Worker } from 'node:worker_threads';
import { FILE_ERROR_CODES, FileError, type FileErrorCode } from '@shared/files';
import { OFFICE_LIMITS } from '@shared/file-office';

/** Common bounded request lifetime for isolated Office document Workers. */
export class OfficeWorkerClient {
  private readonly worker: Worker;
  private closed = false;
  private failure: Error | undefined;
  private sequence = 0;
  private readonly pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; cleanup(): void }>();
  get isClosed():boolean{return this.closed;}
  constructor(path: string, private readonly timeoutMs: number = OFFICE_LIMITS.parseMs) {
    this.worker = new Worker(path, { resourceLimits: { maxOldGenerationSizeMb: OFFICE_LIMITS.workerHeapMiB, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    this.worker.on('error', (error) => this.close(new FileError('IO', `Office 解析器已退出：${error.message}`)));
    this.worker.on('exit', () => this.close(new FileError('IO', 'Office 解析器已退出')));
    this.worker.on('message', (message: { id: number; result?: unknown; error?: { code: string; message: string } }) => {
      const request = this.pending.get(message.id); if (!request || this.closed) return;
      this.pending.delete(message.id); request.cleanup();
      if (message.error) request.reject(new FileError(FILE_ERROR_CODES.includes(message.error.code as FileErrorCode) ? message.error.code as FileErrorCode : 'IO', message.error.message.replace(/^\[[A-Z_]+\]\s*/, '')));
      else request.resolve(message.result);
    });
  }
  protected request<T>(data: Record<string, unknown>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new FileError('CANCELLED', 'Office 解析已取消'));
    if (this.closed) return Promise.reject(this.failure ?? new FileError('CANCELLED', 'Office 解析已关闭'));
    if (this.pending.size >= 8) return Promise.reject(new FileError('TOO_LARGE', 'Office 待处理请求过多'));
    return new Promise<T>((resolve, reject) => {
      const id = ++this.sequence, abort = () => this.close(new FileError('CANCELLED', 'Office 解析已取消'));
      const timer = setTimeout(() => this.close(new FileError('TIMEOUT', 'Office 解析超过 15 秒')), this.timeoutMs);
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort', abort); } });
      signal.addEventListener('abort', abort, { once: true });
      try { this.worker.postMessage({ id, ...data }); } catch (error) { this.close(error instanceof Error ? error : new Error(String(error))); }
    });
  }
  close(error: Error = new FileError('CANCELLED', 'Office 解析已关闭')): void {
    if (this.closed) return; this.closed = true; this.failure = error;
    for (const request of this.pending.values()) { request.cleanup(); request.reject(error); } this.pending.clear(); void this.worker.terminate();
  }
}
