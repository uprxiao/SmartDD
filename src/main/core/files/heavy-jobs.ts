import { FileError } from '@shared/files';

/** Office and TeX share this application-wide slot; queued work is cancellable. */
export class FileHeavyJobs {
  private busy = false;
  private readonly pending: { run: () => void; cancel: () => void }[] = [];
  run<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
    if (signal.aborted) return Promise.reject(new FileError('CANCELLED', '文档转换已取消'));
    if (this.pending.length >= 16) return Promise.reject(new FileError('TOO_LARGE', '文档转换队列已满'));
    return new Promise((resolve, reject) => {
      const job = {
        cancel: () => { const index = this.pending.indexOf(job); if (index >= 0) this.pending.splice(index, 1); signal.removeEventListener('abort', job.cancel); reject(new FileError('CANCELLED', '文档转换已取消')); },
        run: () => { signal.removeEventListener('abort', job.cancel); this.busy = true; void Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(resolve, reject).finally(() => { this.busy = false; this.pump(); }); },
      };
      signal.addEventListener('abort', job.cancel, { once: true }); this.pending.push(job); this.pump();
    });
  }
  private pump() { if (!this.busy) this.pending.shift()?.run(); }
}
export const fileHeavyJobs = new FileHeavyJobs();
