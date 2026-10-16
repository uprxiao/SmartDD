import { randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { TRANSFER_LIMITS } from '@shared/project-transfer';
import type { AppDb } from '../../db/client';
import { importedKeys, projectImportReceipts, projectServers } from '../../db/schema';
import { strictJson, TransferError } from './transfer-format';

export function readLimited(path: string, limit = TRANSFER_LIMITS.file): Buffer {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new TransferError('FILE_IO_FAILED', '请选择可读取的普通文件');
    if (stat.size > limit) throw new TransferError('TOO_LARGE', '文件超过允许的大小');
    const data = Buffer.alloc(limit + 1);
    let total = 0;
    try {
      for (;;) { const n = readSync(fd, data, total, data.length - total, null); total += n; if (!n || total === data.length) break; }
      if (total > limit) throw new TransferError('TOO_LARGE', '文件超过允许的大小');
      return Buffer.from(data.subarray(0, total));
    } finally { data.fill(0); }
  } catch (e) {
    if (e instanceof TransferError) throw e;
    throw new TransferError('FILE_IO_FAILED', '无法读取文件，请检查文件位置与访问权限');
  } finally { if (fd !== undefined) closeSync(fd); }
}

function syncDirectory(path: string) {
  const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
}
export function atomicWrite(path: string, bytes: Buffer, beforeRename?: () => void): void {
  const temporary = join(dirname(path), `.willyou-${randomUUID()}.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
    beforeRename?.(); renameSync(temporary, path); syncDirectory(dirname(path));
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
}

const journalSchema = z.strictObject({ requestId: z.string().uuid(), serverIds: z.array(z.string().uuid()).max(100) });
const ownershipSchema = z.strictObject({ requestId: z.string().uuid(), serverId: z.string().uuid() });
const ownershipFile = '.willyou-owned.json';
export class ImportedKeyFiles {
  readonly root: string;
  readonly journals: string;
  constructor(private readonly db: AppDb, userData: string, private readonly keyCheckpoint?: (phase: 'key-staged' | 'key-renamed') => void) {
    this.root = join(userData, 'imported-keys'); this.journals = join(this.root, 'journals');
  }
  private directory(path: string) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new TransferError('KEY_IO_FAILED', '受管密钥目录不可用');
    chmodSync(path, 0o700);
  }
  private roots() { this.directory(this.root); this.directory(this.journals); }
  path(serverId: string) {
    if (!z.string().uuid().safeParse(serverId).success) throw new TransferError('KEY_IO_FAILED', '受管密钥标识无效');
    return join(this.root, serverId, 'key');
  }
  begin(requestId: string, serverIds: string[]) {
    journalSchema.parse({ requestId, serverIds });
    this.roots();
    atomicWrite(join(this.journals, `${requestId}.json`), Buffer.from(JSON.stringify({ requestId, serverIds })));
  }
  write(requestId: string, serverId: string, key: Buffer) {
    ownershipSchema.parse({ requestId, serverId }); this.roots();
    const path = this.path(serverId);
    // UUID directory must be new; never follow or reuse a pre-existing entry.
    mkdirSync(dirname(path), { mode: 0o700 });
    // Persist ownership before key bytes. A pre-existing UUID directory must
    // never be mistaken for this operation's output during rollback/recovery.
    atomicWrite(join(dirname(path), ownershipFile), Buffer.from(JSON.stringify({ requestId, serverId })));
    atomicWrite(path, key, () => this.keyCheckpoint?.('key-staged'));
    this.keyCheckpoint?.('key-renamed');
  }
  finish(requestId: string) {
    if (!z.string().uuid().safeParse(requestId).success) return;
    this.roots();
    rmSync(join(this.journals, `${requestId}.json`), { force: true });
  }
  private removeOwned(serverId: string, requestId?: string) {
    const dir = dirname(this.path(serverId));
    let stat; try { stat = lstatSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return true; throw e; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
    // An empty directory can be left by a process killed between mkdir and
    // the ownership write. Removing it cannot delete pre-existing key data.
    if (requestId && readdirSync(dir).length === 0) { rmSync(dir, { recursive: true }); return true; }
    const marker = join(dir, ownershipFile);
    try { lstatSync(marker); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    // Missing ownership is different from a temporarily unreadable owned file.
    // Propagate I/O failures so the journal/registry remains available for retry.
    const bytes = readLimited(marker, 1024);
    const owner = ownershipSchema.safeParse(strictJson(bytes.toString('utf8')));
    if (!owner.success || owner.data.serverId !== serverId || (requestId && owner.data.requestId !== requestId)) return false;
    rmSync(dir, { recursive: true, force: true });
    return true;
  }
  rollback(requestId: string, serverIds: string[]) {
    this.roots();
    for (const id of serverIds) {
      const path = this.path(id);
      if (!this.db.select().from(projectServers).where(eq(projectServers.privateKeyPath, path)).get()) this.removeOwned(id, requestId);
    }
    this.finish(requestId);
  }
  recover() {
    this.roots();
    for (const name of readdirSync(this.journals)) {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) continue;
      const bytes = readLimited(join(this.journals, name), 16_384);
      const j = journalSchema.parse(strictJson(bytes.toString('utf8')));
      if (`${j.requestId}.json` !== name) throw new TransferError('KEY_IO_FAILED', '导入恢复记录无效');
      if (this.db.select().from(projectImportReceipts).where(eq(projectImportReceipts.requestId, j.requestId)).get()) this.finish(j.requestId);
      else this.rollback(j.requestId, j.serverIds);
    }
    this.cleanup();
  }
  cleanup() {
    this.roots();
    for (const key of this.db.select().from(importedKeys).all()) {
      // Only delete registered owned paths, never caller-supplied external keys.
      if (key.path !== this.path(key.serverId)) continue;
      if (this.db.select().from(projectServers).where(eq(projectServers.privateKeyPath, key.path)).get()) continue;
      if (!this.removeOwned(key.serverId)) continue;
      this.db.delete(importedKeys).where(eq(importedKeys.serverId, key.serverId)).run();
    }
  }
}
