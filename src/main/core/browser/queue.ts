import { BrowserError } from './errors';

/** One queue per page. Admission runs twice so queued work cannot retain revoked authority. */
export class BrowserPageQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private closed = false;
  private readonly pending = new Set<(reason: Error) => void>();
  private readonly owners = new WeakMap<(reason:Error)=>void,string>();
  run<T>(admit: () => void, work: () => Promise<T>, signal?: AbortSignal, owner?:string): Promise<T> {
    const check = () => {
      if (this.closed) throw new BrowserError('BROWSER_TAB_CLOSED', '网页已经关闭');
      if (signal?.aborted) throw signal.reason ?? new BrowserError('BROWSER_ERROR', '操作已取消');
      admit();
    };
    try { check(); } catch (error) { return Promise.reject(error); }
    return new Promise<T>((resolve, reject) => {
      let waiting = true;
      const cleanup = () => { this.pending.delete(cancel); this.owners.delete(cancel); signal?.removeEventListener('abort', aborted); };
      const cancel = (reason: Error) => {
        if (!waiting) return;
        waiting = false; cleanup(); reject(reason);
      };
      const aborted = () => cancel(signal?.reason ?? new BrowserError('BROWSER_ERROR', '操作已取消'));
      this.pending.add(cancel);
      if(owner!==undefined)this.owners.set(cancel,owner);
      signal?.addEventListener('abort', aborted, { once: true });
      this.tail = this.tail.then(async () => {
        if (!waiting) return;
        waiting = false; cleanup();
        try { check(); resolve(await work()); } catch (error) { reject(error); }
      });
    });
  }
  cancelQueued(reason: Error,owner?:string): void { for (const cancel of this.pending) if(owner===undefined||this.owners.get(cancel)===owner)cancel(reason); }
  close(): void { this.closed = true; this.cancelQueued(new BrowserError('BROWSER_TAB_CLOSED', '网页已经关闭')); }
  async settled(): Promise<void> { await this.tail; }
}
