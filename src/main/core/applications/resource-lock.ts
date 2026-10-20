import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { ensureStoreDirectory } from './package-files';

/** Single-U coordinator. H catalog locking is acquired before this lock by the Agent adapter. */
export async function withResourceLock<T>(root: string, action: () => T, options: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  ensureStoreDirectory(root, 'locks');
  const path = join(root, 'locks', 'resource.lock'), token = randomUUID();
  const deadline = performance.now() + (options.timeoutMs ?? 3000);
  for (;;) {
    if (options.signal?.aborted) throw new ApplicationError('CANCELED', '已取消等待资源协调');
    try { mkdirSync(path, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      if (performance.now() >= deadline) {
        try { const owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')); if (typeof owner.token !== 'string' || !Number.isInteger(owner.pid)) throw new Error(); }
        catch { throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '资源协调记录不完整，保留现场待核查'); }
        throw new ApplicationError('RESOURCE_BUSY', '资源正在使用，请稍后重试');
      }
      await new Promise<void>(resolve => setTimeout(resolve, Math.min(20, Math.max(1, deadline - performance.now()))));
    }
  }
  try {
    writeFileSync(join(path, 'owner.json'), JSON.stringify({ token, pid: process.pid, processStartedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() }), { mode: 0o600, flag: 'wx' });
    if (options.signal?.aborted) throw new ApplicationError('CANCELED', '已取消资源操作');
    const value = action();
    if (value instanceof Promise) throw new Error('资源协调区禁止等待网络、文件复制或异步业务');
    return value;
  } finally {
    // Never remove a lock replaced by another owner; age or PID alone is not proof.
    let owner: { token?: string };
    try { owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8')); }
    catch { throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '资源协调所有权无法核对'); }
    if (owner.token !== token) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '资源协调所有权已变化，保留现场');
    rmSync(path, { recursive: true });
  }
}
