import { randomUUID } from 'node:crypto';
import { closeSync, constants, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import type { MailActor, MailAttachment } from '@shared/mail-drafts';
import { APP_HASH_PATTERN, ApplicationError } from '@shared/applications';
import { canonicalJson, digest } from './manifest';
import { ensureStoreDirectory } from './package-files';
import type { ResourceStore } from './resource-store';
import { withResourceLock } from './resource-lock';
export interface MailPolicy { requireDrafts(actor: MailActor): void }
interface BlobMetadata { attachmentId: string; projectId: string; filename: string; contentType: string; hash: string; size: number }
interface WriteRow { operation_id: string; attachment_id: string; project_id: string; request_hash: string; metadata_json: string; state: string }
const safeName = z.string().min(1).max(1024).refine(s => !/[\x00-\x1f\x7f]/.test(s));
const writeMetadataSchema = z.object({ attachmentId: z.uuid(),projectId: z.string().min(1).max(128),filename: safeName,contentType: safeName.max(256),hash: z.string().regex(APP_HASH_PATTERN),size: z.number().int().min(0).max(25 * 1024 * 1024) }).strict();
const inputSchema = z.object({ operationId: z.uuid(),filename: safeName,contentType: safeName.max(256) }).strict();
/** Persistent business blobs are physically separate from all rebuildable mail caches. */
export class MailBlobStore {
  readonly root: string;
  constructor(readonly store: ResourceStore,root: string,private readonly policy: MailPolicy,private readonly checkpoint?: (phase: 'staged' | 'published') => void) {
    this.root = resolve(root);
    if (!existsSync(this.root)) mkdirSync(this.root,{ recursive: true,mode: 0o700 });
    if (!lstatSync(this.root).isDirectory() || lstatSync(this.root).isSymbolicLink()) throw new ApplicationError('OWNERSHIP_CONFLICT','邮件业务目录归属不明确');
    const marker = join(this.root,'.willyou-mail-owner.json');
    if (!existsSync(marker)) {
      if (readdirSync(this.root).length) throw new ApplicationError('OWNERSHIP_CONFLICT','邮件业务目录包含非受管内容');
      try { writeFileSync(marker,canonicalJson({ schema: 1,storeId: store.storeId }),{ flag: 'wx',mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    if (lstatSync(marker).isSymbolicLink()) throw new ApplicationError('OWNERSHIP_CONFLICT','邮件业务目录标记无效');
    const owner = JSON.parse(readFileSync(marker,'utf8')); if (owner.schema !== 1 || owner.storeId !== store.storeId) throw new ApplicationError('OWNERSHIP_CONFLICT','邮件业务目录属于其他存储');
    ensureStoreDirectory(this.root,'blobs'); ensureStoreDirectory(this.root,'staging');
  }
  private verify(hash: string,size: number,path = join(this.root,'blobs',hash)): Buffer {
    ensureStoreDirectory(this.root,'blobs'); ensureStoreDirectory(this.root,'staging');
    if (!APP_HASH_PATTERN.test(hash) || !Number.isInteger(size) || size < 0 || size > 25 * 1024 * 1024) throw new ApplicationError('HASH_MISMATCH','附件摘要或大小无效');
    try { const fd = openSync(path,constants.O_RDONLY | constants.O_NOFOLLOW); try { const stat = fstatSync(fd); if (!stat.isFile() || stat.nlink !== 1 || stat.size !== size) throw new Error(); const bytes = readFileSync(fd); if (digest(bytes) !== hash) throw new Error(); return bytes; } finally { closeSync(fd); } }
    catch { throw new ApplicationError('HASH_MISMATCH','草稿附件副本缺失或损坏'); }
  }
  private syncDirectory(name: 'blobs' | 'staging'): void { const fd = openSync(join(this.root,name),constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
  get(actor: MailActor,id: string): MailAttachment {
    this.policy.requireDrafts(actor); const row = this.store.sqlite.prepare('SELECT * FROM mail_attachment_objects WHERE id=? AND project_id=?').get(id,actor.projectId) as { id: string;filename: string;content_type: string;byte_size: number;content_hash: string;created_at: string } | undefined;
    if (!row) throw new ApplicationError('NOT_FOUND','当前项目没有此附件');
    return { id: row.id,filename: row.filename,contentType: row.content_type,size: row.byte_size,contentHash: row.content_hash,createdAt: row.created_at };
  }
  read(actor: MailActor,id: string): Buffer { const value = this.get(actor,id); return this.verify(value.contentHash,value.size); }
  async save(actor: MailActor,input: z.infer<typeof inputSchema>,bytes: Uint8Array,signal?: AbortSignal): Promise<MailAttachment> {
    this.policy.requireDrafts(actor); const parsed = inputSchema.safeParse(input);
    if (!parsed.success || !(bytes instanceof Uint8Array) || bytes.byteLength > 25 * 1024 * 1024) throw new ApplicationError('INVALID_INPUT','附件字段无效或超过25MiB');
    if (signal?.aborted) throw new ApplicationError('CANCELED','附件保存已取消');
    const value = parsed.data, stable = Buffer.from(bytes), hash = digest(stable), requestHash = digest(canonicalJson({ projectId: actor.projectId,filename: value.filename,contentType: value.contentType,hash,size: stable.length }));
    let attachmentId: string = randomUUID(), state = '';
    await withResourceLock(this.store.root,() => this.store.sqlite.transaction(() => {
      this.policy.requireDrafts(actor); const old = this.store.sqlite.prepare('SELECT * FROM mail_blob_writes WHERE operation_id=?').get(value.operationId) as WriteRow | undefined;
      if (old) { if (old.project_id !== actor.projectId || old.request_hash !== requestHash) throw new ApplicationError('REVISION_CONFLICT','附件操作编号已用于不同内容'); attachmentId = old.attachment_id; state = old.state; return; }
      const now = new Date().toISOString(), metadata: BlobMetadata = { attachmentId,projectId: actor.projectId,filename: value.filename,contentType: value.contentType,hash,size: stable.length };
      this.store.sqlite.prepare("INSERT INTO mail_blob_writes(operation_id,attachment_id,project_id,request_hash,metadata_json,state,created_at,updated_at) VALUES(?,?,?,?,?,'preparing',?,?)").run(value.operationId,attachmentId,actor.projectId,requestHash,canonicalJson(metadata),now,now);
    }).immediate());
    if (state === 'committed') { await this.finish(value.operationId,actor,signal); const old = this.get(actor,attachmentId); this.verify(old.contentHash,old.size); return old; }
    if (state) throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','附件保存存在未完成操作，请恢复后重试');
    const path = join(this.root,'staging',value.operationId);
    try {
      const file = await open(path,constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,0o600);
      try { await file.writeFile(stable); await file.sync(); } finally { await file.close(); }
      await withResourceLock(this.store.root,() => this.store.sqlite.prepare("UPDATE mail_blob_writes SET state='staged',cleanup_pending=1,updated_at=? WHERE operation_id=? AND state='preparing'").run(new Date().toISOString(),value.operationId));
      this.checkpoint?.('staged');
      if (signal?.aborted) throw new ApplicationError('CANCELED','附件保存已取消');
      this.policy.requireDrafts(actor); await this.finish(value.operationId,actor,signal); return this.get(actor,attachmentId);
    } catch (error) {
      await withResourceLock(this.store.root,() => this.store.sqlite.prepare("UPDATE mail_blob_writes SET error_code=?,updated_at=? WHERE operation_id=? AND state<>'committed'").run(error instanceof ApplicationError ? error.code : 'RESOURCE_RECOVERY_REQUIRED',new Date().toISOString(),value.operationId)); throw error;
    }
  }
  private async finish(operationId: string,actor?: MailActor,signal?: AbortSignal): Promise<void> {
    await withResourceLock(this.store.root,() => {
      if (actor) this.policy.requireDrafts(actor);
      if (signal?.aborted) throw new ApplicationError('CANCELED','附件保存已取消');
      const op = this.store.sqlite.prepare('SELECT * FROM mail_blob_writes WHERE operation_id=?').get(operationId) as WriteRow | undefined;
      if (!op) return;
      if (!z.uuid().safeParse(operationId).success) throw new ApplicationError('RESOURCE_STATE_CHANGED','附件恢复记录无效');
      let m: BlobMetadata; try { m = writeMetadataSchema.parse(JSON.parse(op.metadata_json)); } catch { throw new ApplicationError('RESOURCE_STATE_CHANGED','附件恢复记录损坏'); }
      if (m.attachmentId !== op.attachment_id || m.projectId !== op.project_id) throw new ApplicationError('RESOURCE_STATE_CHANGED','附件恢复归属不一致');
      const path = join(this.root,'blobs',m.hash), stage = join(this.root,'staging',operationId);
      ensureStoreDirectory(this.root,'blobs'); ensureStoreDirectory(this.root,'staging');
      if (op.state === 'committed') {
        this.verify(m.hash,m.size,path); if (existsSync(stage)) { this.verify(m.hash,m.size,stage); unlinkSync(stage); this.syncDirectory('staging'); }
        this.store.sqlite.prepare('UPDATE mail_blob_writes SET cleanup_pending=0 WHERE operation_id=?').run(operationId); return;
      }
      if (existsSync(path)) this.verify(m.hash,m.size,path); else { this.verify(m.hash,m.size,stage); renameSync(stage,path); }
      this.syncDirectory('blobs'); this.syncDirectory('staging');
      this.store.sqlite.prepare("UPDATE mail_blob_writes SET state='published',updated_at=? WHERE operation_id=?").run(new Date().toISOString(),operationId); this.checkpoint?.('published');
      this.store.sqlite.transaction(() => {
        const now = new Date().toISOString();
        this.store.sqlite.prepare('INSERT OR IGNORE INTO mail_blob_objects(content_hash,byte_size,created_at) VALUES(?,?,?)').run(m.hash,m.size,now);
        const size = (this.store.sqlite.prepare('SELECT byte_size FROM mail_blob_objects WHERE content_hash=?').get(m.hash) as { byte_size: number }).byte_size; if (size !== m.size) throw new ApplicationError('HASH_MISMATCH','附件登记大小冲突');
        this.store.sqlite.prepare('INSERT OR IGNORE INTO mail_attachment_objects(id,project_id,content_hash,filename,content_type,byte_size,created_at) VALUES(?,?,?,?,?,?,?)').run(m.attachmentId,m.projectId,m.hash,m.filename,m.contentType,m.size,now);
        this.store.sqlite.prepare("UPDATE mail_blob_writes SET state='committed',cleanup_pending=1,error_code=NULL,updated_at=? WHERE operation_id=?").run(now,operationId);
      }).immediate();
      if (existsSync(stage)) { this.verify(m.hash,m.size,stage); unlinkSync(stage); this.syncDirectory('staging'); }
      this.store.sqlite.prepare('UPDATE mail_blob_writes SET cleanup_pending=0 WHERE operation_id=?').run(operationId);
    });
  }
  /** Recovery publishes only verified private bytes and never performs an external action. */
  async recover(): Promise<{ recovered: string[]; pending: string[] }> {
    const ops = this.store.sqlite.prepare("SELECT operation_id FROM mail_blob_writes WHERE state<>'committed' OR cleanup_pending=1").all() as { operation_id: string }[], result = { recovered: [] as string[],pending: [] as string[] };
    for (const op of ops) { try { await this.finish(op.operation_id); result.recovered.push(op.operation_id); } catch { result.pending.push(op.operation_id); } } return result;
  }
}
