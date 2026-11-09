import { BrowserError } from './errors';

/** One queue per page. Admission runs twice so queued work cannot retain revoked authority. */
export class BrowserPageQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly pending = new Set<(reason: Error) => void>();
  run<T>(admit: () => void, work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const check = () => {
      if (this.closed) throw new BrowserError('BROWSER_TAB_CLOSED', '网页已经关闭');
      if (signal?.aborted) throw signal.reason ?? new BrowserError('BROWSER_ERROR', '操作已取消');
      admit();
    };
    try { check(); } catch (error) { return Promise.reject(error); }
    return new Promise<T>((resolve, reject) => {
      let waiting = true;
      const cleanup = () => { this.pending.delete(cancel); signal?.removeEventListener('abort', aborted); };
      const cancel = (reason: Error) => {
        if (!waiting) return;
        waiting = false; cleanup(); reject(reason);
      };
      const aborted = () => cancel(signal?.reason ?? new BrowserError('BROWSER_ERROR', '操作已取消'));
      this.pending.add(cancel);
      signal?.addEventListener('abort', aborted, { once: true });
      this.tail = this.tail.then(async () => {
        if (!waiting) return;
        waiting = false; cleanup();
        try { check(); resolve(await work()); } catch (error) { reject(error); }
      });
    });
  }
  cancelQueued(reason: Error): void { for (const cancel of this.pending) cancel(reason); }
  close(): void { this.closed = true; this.cancelQueued(new BrowserError('BROWSER_TAB_CLOSED', '网页已经关闭')); }
  async settled(): Promise<void> { await this.tail; }
}
