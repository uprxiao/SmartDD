import { Worker } from 'node:worker_threads';
import { HTML_LIMITS } from '@shared/file-html';
import type { HtmlReferences, ReferenceKind } from './references';

export class HtmlReferenceParser {
  private readonly worker: Worker;
  private readonly pending = new Map<number, { resolve(value: HtmlReferences): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  private serial = 0;
  private closed = false;
  constructor(file: string) {
    this.worker = new Worker(file, { resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    this.worker.on('message', (data) => { const pending = this.pending.get(data.id); if (!pending || this.closed) return; this.pending.delete(data.id); clearTimeout(pending.timer); if (data.error) pending.reject(new Error(data.error)); else pending.resolve(data.result); });
    this.worker.on('error', () => this.close(new Error('HTML资源解析进程发生错误')));
    this.worker.on('exit', () => this.close(new Error('HTML资源解析进程已退出')));
  }
  parse(raw: string, kind: ReferenceKind): Promise<HtmlReferences> {
    if (this.closed) return Promise.reject(new Error('HTML资源解析已结束'));
    if (this.pending.size) return Promise.reject(new Error('HTML资源解析请求仍在执行'));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('HTML资源解析超过15秒，已停止')), HTML_LIMITS.timeout);
      this.pending.set(id, { resolve, reject, timer });
      try { this.worker.postMessage({ id, raw, kind }); } catch { this.close(new Error('HTML资源解析请求发送失败')); }
    });
  }
  close(error: Error = new DOMException('HTML资源解析已取消', 'AbortError')): void {
    if (this.closed) return; this.closed = true;
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); } this.pending.clear(); void this.worker.terminate();
  }
}
