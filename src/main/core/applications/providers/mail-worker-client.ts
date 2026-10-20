import { execFile, type ChildProcess } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ConnectionConfig, VerifiedConnectionIdentity } from '@shared/application-connections';
import type { LocalMailContent, LocalMailQuery, MailSearch } from '@shared/application-mail';
import { ApplicationError } from '@shared/applications';
type Config = Extract<ConnectionConfig,{ kind: 'foxmail' }>;
type Pending = { config: Config; resolve(value: unknown): void; reject(error: Error): void; cleanup(): void };
/** The main thread supervises process handles; heavy metadata/MIME work stays in the Worker. */
export class MailWorkerClient {
  private readonly worker: Worker;
  private sequence = 0;
  private closed = false;
  private readonly pending = new Map<number,Pending>();
  private readonly children = new Set<ChildProcess>();
  constructor(path: string,private readonly native: string,private readonly timeoutMs = 30000) {
    this.worker = new Worker(path,{ resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 } });
    this.worker.on('error',() => this.close(new ApplicationError('SOURCE_UNAVAILABLE','邮件解析进程已退出')));
    this.worker.on('exit',() => this.close(new ApplicationError('SOURCE_UNAVAILABLE','邮件解析进程已退出')));
    this.worker.on('message',(message: { type: string; id: number; metadataId?: number; path?: string; result?: unknown; error?: { code: ApplicationError['code']; message: string } }) => {
      const pending = this.pending.get(message.id); if (!pending || this.closed) return;
      if (message.type === 'metadata') {
        const root = basename(pending.config.sourcePath) === 'messages.db' ? dirname(pending.config.sourcePath) : pending.config.sourcePath;
        if (message.path !== join(root,'messages.db')) { this.close(new ApplicationError('SCOPE_DENIED','读取器请求不属于本次选定来源')); return; }
        const child = execFile(this.native,[message.path],{ timeout: 10000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', windowsHide: true },(error,output) => {
          this.children.delete(child);
          if (!this.closed && this.pending.has(message.id)) this.worker.postMessage({ type: 'metadata-result', metadataId: message.metadataId, output: error ? undefined : output, failed: !!error });
        });
        this.children.add(child); return;
      }
      this.pending.delete(message.id); pending.cleanup();
      if (message.error) pending.reject(new ApplicationError(message.error.code,message.error.message)); else pending.resolve(message.result);
    });
  }
  private request<T>(config: Config,data: Record<string,unknown>,signal: AbortSignal): Promise<T> {
    if (signal.aborted || this.closed) return Promise.reject(new ApplicationError('CANCELED','邮件读取已关闭或取消'));
    if (this.pending.size >= 8) return Promise.reject(new ApplicationError('RESOURCE_BUSY','邮件读取队列已满，请稍后重试'));
    return new Promise<T>((resolve,reject) => {
      const id = ++this.sequence, abort = () => this.close(new ApplicationError('CANCELED','邮件读取已取消'));
      const timer = setTimeout(() => this.close(new ApplicationError('TIMEOUT','邮件读取超过本次时间预算')),this.timeoutMs);
      this.pending.set(id,{ config, resolve: value => resolve(value as T), reject, cleanup: () => { clearTimeout(timer); signal.removeEventListener('abort',abort); } });
      signal.addEventListener('abort',abort,{ once: true }); this.worker.postMessage({ id, config, ...data });
    });
  }
  verify(config: Config,signal: AbortSignal): Promise<VerifiedConnectionIdentity> { return this.request(config,{ method: 'verify' },signal); }
  query(config: Config,search: MailSearch,expected: VerifiedConnectionIdentity,signal: AbortSignal,now = new Date()): Promise<LocalMailQuery> { return this.request(config,{ method: 'query',search,expected,now: now.toISOString() },signal); }
  read(config: Config,mailId: string,expected: VerifiedConnectionIdentity,signal: AbortSignal,now = new Date()): Promise<LocalMailContent> { return this.request(config,{ method: 'read',mailId,expected,now: now.toISOString() },signal); }
  attachment(config: Config,mailId: string,attachmentId: string,hash: string,expected: VerifiedConnectionIdentity,signal: AbortSignal,now = new Date()): Promise<Uint8Array> { return this.request(config,{ method: 'attachment',mailId,attachmentId,hash,expected,now: now.toISOString() },signal); }
  close(error = new ApplicationError('CANCELED','邮件读取已关闭')): void {
    if (this.closed) return; this.closed = true;
    for (const p of this.pending.values()) { p.cleanup(); p.reject(error); } this.pending.clear();
    for (const child of this.children) child.kill('SIGKILL'); this.children.clear(); void this.worker.terminate();
  }
}
