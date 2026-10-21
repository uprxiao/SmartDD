import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync, lstatSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import type { ProcessIdentity } from './process-identity';
/** H precedes C and SQLite. Only the exact owning token may release this lock. */
export async function withDiscoveryLock<T>(root: string, host: ProcessIdentity, action: () => T | Promise<T>, options: {
    timeoutMs?: number;
    signal?: AbortSignal;
} = {}): Promise<T> {
    const original=lstatSync(root);
    const assertRoot=()=>{const stat=lstatSync(root);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(root)!==root||stat.dev!==original.dev||stat.ino!==original.ino)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','共享目录的规范位置或归属已变化，保留原锁');};assertRoot();
    const path = join(root, 'catalog.lock'), token = randomUUID(), deadline = performance.now() + (options.timeoutMs ?? 3000);
    for (;;) {
        assertRoot();
        if (options.signal?.aborted)
            throw new ApplicationError('CANCELED', '已取消等待发现目录');
        try {
            mkdirSync(path, { mode: 0o700 });
            break;
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST')
                throw error;
        }
        if (performance.now() >= deadline) {
            try {
                const stat = lstatSync(path), owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
                if (!stat.isDirectory() || stat.isSymbolicLink() || typeof owner.token !== 'string' || !Number.isSafeInteger(owner.pid) || typeof owner.startedAt !== 'string')
                    throw new Error();
            }
            catch {
                throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录锁记录不完整，保留现场');
            }
            throw new ApplicationError('RESOURCE_BUSY', '共享目录仍有协调者；不按年龄或PID抢锁');
        }
        await new Promise<void>(resolve => setTimeout(resolve, Math.min(20, Math.max(1, deadline - performance.now()))));
    }
    const identity = lstatSync(path);
    try {
        assertRoot();
        writeFileSync(join(path, 'owner.json'), JSON.stringify({ schema: 1, token, ...host }), { flag: 'wx', mode: 0o600 });
        if (options.signal?.aborted)
            throw new ApplicationError('CANCELED', '共享目录操作已取消');
        return await action();
    }
    finally {
        assertRoot();
        let owner: {
            token?: string;
        };
        try {
            const current = lstatSync(path);
            if (current.isSymbolicLink() || !current.isDirectory() || current.ino !== identity.ino || current.dev !== identity.dev)
                throw new Error();
            owner = JSON.parse(readFileSync(join(path, 'owner.json'), 'utf8'));
        }
        catch {
            throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录锁归属无法核验');
        }
        if (owner.token !== token)
            throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED', '共享目录锁已被替换，保留现场');
        rmSync(path, { recursive: true });
    }
}
