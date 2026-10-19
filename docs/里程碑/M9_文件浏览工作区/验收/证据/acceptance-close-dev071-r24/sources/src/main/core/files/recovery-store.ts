import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { z } from 'zod';
import { FILE_LIMITS, FileError, fileScopeSchema, type FileEntry, type FileIdentity, type FileSaveReceipt } from '@shared/files';
import { identityKey, type RootLease, type SourceResolver } from './roots';
import { type NativeFileResult, NativeFileBroker, type RootDescriptor, type BrokerOptions } from './native-broker';
import { fileRecoveryInspectionSchema, type FileRecoveryInspection, type FileRecoveryInspectionInput, type FileRecoveryMaterial, type FileRecoveryMaterialKind } from '@shared/file-recovery';

const identitySchema = z.object({ device: z.string().regex(/^\d+$/), inode: z.string().regex(/^\d+$/) }).strict();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionSchema = identitySchema.extend({ size: z.number().int().nonnegative(), modifiedNs: z.string(), changedNs: z.string(), hash: hashSchema }).strict();
const journalSchema = z.object({
  schemaVersion: z.literal(1), opId: z.string().uuid(), projectKey: hashSchema, fingerprint: hashSchema,
  root: z.object({ path: z.string().min(1), identity: identitySchema, sourcePath: z.string().optional() }).strict(),
  source: z.object({ kind: z.enum(['project-directory', 'task-cwd']), id: z.string().min(1).max(128), scope: fileScopeSchema }).strict(),
  relativePath: z.string().min(1), bytes: z.number().int().nonnegative().max(FILE_LIMITS.globalRecovery),
  bufferVersion: z.number().int().nonnegative(), createdAt: z.number().nonnegative(),
  kind: z.enum(['checkpoint', 'copy']).optional(),
  encoding: z.enum(['utf-8', 'ooxml-draft']).optional(),
  copySourceRoot: z.object({ path: z.string().min(1), identity: identitySchema, sourcePath: z.string().optional() }).strict().optional(),
  copySourcePath: z.string().optional(),
  exchanged: z.boolean().optional(),
  state: z.enum(['dirty', 'resolved', 'preparing', 'prepared', 'saved', 'conflict', 'unknown', 'failed']),
  draftHash: hashSchema, draftLeaf: z.string().regex(/^draft(?:-[a-f0-9-]{36})?$/), recordIdentity: identitySchema,
  draftIdentity: identitySchema.optional(), baseHash: hashSchema.optional(),
  baseRevision: revisionSchema.optional(), candidateIdentity: identitySchema.optional(), candidateHash: hashSchema.optional(), displacedIdentity: identitySchema.optional(),
  transactionLeaf: z.string().regex(/^\.willyou-recovery-[a-z0-9-]+$/).optional(), transactionIdentity: identitySchema.optional(),
  targetParentIdentity: identitySchema.optional(),
  receipt: z.object({ opId: z.string().uuid(), bufferVersion: z.number().int().nonnegative(), state: z.enum(['saved', 'conflict', 'unknown', 'failed']), recoveryId: z.string().uuid().optional(), revision: z.object({ device: z.string(), inode: z.string(), size: z.number(), hash: hashSchema, modifiedNs: z.string(), changedNs: z.string() }).optional(), message: z.string().optional() }).strict().optional(),
}).passthrough();
type Journal = z.infer<typeof journalSchema>;
export interface RecoveryItem {
  id: string;
  projectKey: string;
  state: string;
  message?: string;
  relativePath?: string;
  source?: Journal['source'];
  createdAt?: number;
  sourceAvailable?: boolean;
}
interface Reservation { projectKey: string; bytes: number }
export const recoveryProjectKey = (projectId: string | null) => createHash('sha256').update(`project:${projectId ?? 'unassigned'}`).digest('hex');

/** Journals and drafts live only in userData. The target-volume directory is
 * registered by identity, not by a filename pattern. Unknown/corrupt records
 * stay intact and visible as recovery problems; they are never auto-cleaned.
 */
export class FileRecoveryStore {
  private root!: RootDescriptor;
  private readonly internal = new Map<string, FileIdentity>();
  private readonly reservations = new Map<string, Reservation>();
  private readonly records = new Map<string, Journal>();
  private readonly issues = new Map<string, RecoveryItem>();
  private initialization: Promise<void> | null = null;
  private quotaUncertain = false;
  constructor(private readonly broker: NativeFileBroker, private readonly userData: string, private readonly sources: SourceResolver) {}

  ready(): Promise<void> { return this.initialization ??= this.initialize(); }
  private async initialize(): Promise<void> {
    const root = await this.broker.request<RootDescriptor & { parentIdentity: FileIdentity }>({ operation: 'initialize-recovery', path: this.userData });
    this.root = { path: root.path, identity: root.identity, privateObjects: true };
    this.protect(root.identity); this.protect(root.parentIdentity);
    const projects = await this.listInternal('');
    for (const project of projects) {
      if (project.kind !== 'directory' || !hashSchema.safeParse(project.name).success) { this.bad(project.name, project.name, '恢复分区名称或类型异常，已保留原件'); continue; }
      let entries: FileEntry[];
      try { entries = await this.listInternal(project.name); }
      catch (error) { this.bad(project.name, project.name, this.message(error)); continue; }
      for (const entry of entries) {
        if (entry.kind !== 'directory' || !z.string().uuid().safeParse(entry.name).success) { this.bad(entry.name, project.name, '恢复记录名称或类型异常，已保留原件'); continue; }
        await this.inspectRecord(project.name, entry.name, entry.identity);
      }
    }
  }

  private async listInternal(relativePath: string): Promise<FileEntry[]> {
    const result = await this.broker.request<{ entries: FileEntry[] }>({ operation: 'list', root: this.root, relativePath });
    return result.entries;
  }
  private bad(id: string, projectKey: string, message: string): void {
    if (!this.records.has(`${projectKey}/${id}`)) this.quotaUncertain = true;
    this.issues.set(`${projectKey}/${id}`, { id, projectKey, state: 'invalid', message });
  }
  private message(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  private async sourceRoot(record: Journal, options: BrokerOptions = {}): Promise<RootDescriptor> {
    const source = this.sources.sources(record.source.scope).find(s => s.kind === record.source.kind && s.id === record.source.id);
    if (!source || recoveryProjectKey(source.projectId) !== record.projectKey) throw new FileError('STALE_ROOT', '恢复来源已删除或不再属于原项目');
    let root = await this.broker.request<RootDescriptor>({ operation: 'inspect-root', path: source.path }, options);
    const expected = record.kind === 'copy' ? record.copySourceRoot : record.root;
    if (!expected || identityKey(root.identity) !== identityKey(expected.identity) || root.path !== expected.path) throw new FileError('STALE_ROOT', '恢复来源卷或根身份改变，独立草稿已保留');
    if (record.kind === 'copy') {
      root = await this.broker.request<RootDescriptor>({ operation: 'inspect-root', path: record.root.sourcePath ?? record.root.path }, options);
      if (identityKey(root.identity) !== identityKey(record.root.identity) || root.path !== record.root.path) throw new FileError('STALE_ROOT', '副本目标目录已改变，恢复材料仍保留');
    }
    return root;
  }
  private async inspectRecord(projectKey: string, id: string, expectedIdentity: FileIdentity | null, options: BrokerOptions = {}): Promise<void> {
    try {
      const result = await this.broker.request<NativeFileResult>({ operation: 'read', root: this.root, relativePath: `${projectKey}/${id}/journal.json`, byteLimit: 64 * 1024 }, options);
      const record = journalSchema.parse(JSON.parse(Buffer.from(result.base64!, 'base64').toString('utf8')));
      if (record.opId !== id || record.projectKey !== projectKey || !expectedIdentity || identityKey(record.recordIdentity) !== identityKey(expectedIdentity) || record.receipt && record.receipt.opId !== id) throw new FileError('UNTRUSTED', '恢复日志身份不匹配');
      if (record.relativePath.startsWith('/') || record.relativePath.split('/').some((part) => !part || part === '.' || part === '..')) throw new FileError('UNTRUSTED', '恢复日志相对路径无效');
      this.records.set(`${projectKey}/${id}`, record);
      this.reservations.set(`${projectKey}/${id}`, { projectKey, bytes: record.bytes });
      const draft = await this.broker.request<NativeFileResult>({ operation: 'stat', root: this.root, relativePath: `${projectKey}/${id}/${record.draftLeaf}` }, options);
      // An interruption between draft fsync and the next preparing journal can
      // leave its inode unrecorded. It cannot have reached the exchange: that
      // requires a durable prepared journal first. Verify the private bytes;
      // preserve this record without misclassifying a failed preparation as a
      // post-commit unknown result. Never relax prepared/checkpoint identities.
      const earlyPreparation = record.kind !== 'checkpoint' && record.state === 'preparing';
      if ((!record.draftIdentity && !earlyPreparation) || record.draftIdentity && identityKey(record.draftIdentity) !== identityKey(draft.revision) || draft.revision.hash !== record.draftHash) throw new FileError('CHANGED', '独立草稿身份或内容与日志不一致，已保留原件');
      let currentRoot: RootDescriptor | undefined, sourceProblem: string | undefined;
      try {
        currentRoot = await this.sourceRoot(record, options);
      } catch (error) { if (options.signal?.aborted) throw new FileError('CANCELLED', '恢复材料读取已取消'); currentRoot = undefined; sourceProblem = this.message(error); }
      if (record.transactionLeaf && record.transactionIdentity) {
        if (!record.transactionLeaf.endsWith(`-${id}`)) throw new FileError('UNTRUSTED', '恢复事务目录编号不匹配');
        if (currentRoot) {
          const transactionPath = posix.join(posix.dirname(record.relativePath), record.transactionLeaf);
          const transaction = await this.broker.request<{ identity: FileIdentity }>({ operation: 'list', root: currentRoot, relativePath: transactionPath }, options);
          if (identityKey(transaction.identity) !== identityKey(record.transactionIdentity)) throw new FileError('UNTRUSTED', '恢复事务目录被替换');
          this.protect(transaction.identity);
        }
      }
      // A journal state is only an historical observation. Actual target,
      // displaced and draft versions are checked again when recovery is opened.
      this.issues.set(`${projectKey}/${id}`, { id, projectKey, state: record.kind === 'checkpoint' ? record.state : record.state === 'saved' ? 'saved-history' : 'needs-inspection', relativePath: record.relativePath, source: record.source, createdAt: record.createdAt, sourceAvailable: currentRoot !== undefined, message: sourceProblem });
    } catch (error) { if (options.signal?.aborted) throw new FileError('CANCELLED', '恢复材料读取已取消'); this.bad(id, projectKey, this.message(error)); }
  }

  protect(identity: FileIdentity): void { this.internal.set(identityKey(identity), identity); }
  protectedIdentities(): FileIdentity[] { return [...this.internal.values()]; }
  isProtected(identity: FileIdentity | null): boolean { return identity !== null && this.internal.has(identityKey(identity)); }
  descriptor(): RootDescriptor { return this.root; }
  items(): RecoveryItem[] { return [...this.issues.values()]; }
  blocks(lease: RootLease, relativePath: string): boolean {
    return Boolean(this.blockingId(lease, relativePath));
  }
  blockingId(lease: RootLease, relativePath: string): string | undefined {
    return this.blockingPath(lease.canonicalPath, relativePath);
  }
  blockingPath(root: string, relativePath: string): string | undefined {
    return [...this.records.values()].find((record) => record.kind !== 'checkpoint' && record.state !== 'saved' && record.state !== 'preparing' && !(record.exchanged === false && (record.state === 'failed' || record.state === 'conflict')) && record.root.path === root && record.relativePath === relativePath)?.opId;
  }

  reserve(projectKey: string, opId: string, currentBytes: number, candidateBytes: number): void {
    if (this.quotaUncertain) throw new FileError('QUOTA', '恢复记录存在异常，容量未核实；请先处理恢复记录，内存修改仍保留');
    const key = `${projectKey}/${opId}`;
    const previous = this.reservations.get(key)?.bytes ?? 0;
    const bytes = Math.max(previous, currentBytes + 2 * candidateBytes + 64 * 1024);
    let projectUsed = 0, total = 0;
    for (const [id, reservation] of this.reservations) { if (id === key) continue; total += reservation.bytes; if (reservation.projectKey === projectKey) projectUsed += reservation.bytes; }
    if (total + bytes > FILE_LIMITS.globalRecovery || projectUsed + bytes > FILE_LIMITS.projectRecovery) throw new FileError('QUOTA', '文件恢复空间额度不足；请处理已解决的恢复记录后重试');
    this.reservations.set(key, { projectKey, bytes });
  }
  remember(lease: RootLease, id: string, receipt: FileSaveReceipt, relativePath?: string): void {
    const projectKey = recoveryProjectKey(lease.projectId);
    this.issues.set(`${projectKey}/${id}`, { id, projectKey, state: receipt.state === 'saved' ? 'saved-history' : receipt.state, relativePath, source: { kind: lease.source, id: lease.sourceId, scope: lease.scope }, message: receipt.message, createdAt: Date.now() });
  }
  existing(projectKey: string, opId: string): { fingerprint: string; receipt?: FileSaveReceipt; filePath: string } | undefined {
    const record = this.records.get(`${projectKey}/${opId}`);
    return record && { fingerprint: record.fingerprint, receipt: record.receipt, filePath: posix.join(record.root.path, record.relativePath) };
  }
  async refreshRecord(projectKey: string, id: string, options: BrokerOptions = {}): Promise<void> {
    const directory = await this.broker.request<{ identity: FileIdentity }>({ operation: 'list', root: this.root, relativePath: `${projectKey}/${id}` }, options);
    await this.inspectRecord(projectKey, id, directory.identity, options);
    const issue = this.issues.get(`${projectKey}/${id}`);
    if (issue?.state === 'invalid') throw new FileError('IO', issue.message ?? '恢复记录未通过核对');
  }
  /** Inspection never resolves a journal or writes any source/recovery object.
   * Renderers supply opaque IDs; all paths are derived from verified journals. */
  async inspect(raw: FileRecoveryInspectionInput, options: BrokerOptions = {}): Promise<FileRecoveryInspection> {
    const { projectKey, id } = fileRecoveryInspectionSchema.parse(raw);
    await this.ready();
    if (options.signal?.aborted) throw new FileError('CANCELLED', '恢复材料读取已取消');
    await this.refreshRecord(projectKey, id, options);
    const key = `${projectKey}/${id}`, record = this.records.get(key), item = this.issues.get(key);
    if (!record || !item) throw new FileError('MISSING', '恢复记录不存在，未改动任何材料');
    const read = async (kind: FileRecoveryMaterialKind, root: RootDescriptor | undefined, relativePath: string | undefined, expected?: FileIdentity, expectedHash?: string, strict = false, expectedParentIdentity?: FileIdentity): Promise<FileRecoveryMaterial> => {
      if (!root || !relativePath) return { kind, available: false, message: '原目录或该版本当前不可用，其余恢复材料仍保留' };
      try {
        const file = await this.broker.request<NativeFileResult>({ operation: 'stat', root, relativePath, ...(expectedParentIdentity ? { expectedParentIdentity } : {}) }, options);
        if (strict && (expected && identityKey(file.revision) !== identityKey(expected) || expectedHash && file.revision.hash !== expectedHash)) throw new FileError('CHANGED', '独立草稿身份或内容已改变');
        const length = Math.min(file.revision.size, 262144);
        const chunk = await this.broker.request<NativeFileResult>({ operation: 'chunk', root, relativePath, offset: 0, length, expectedRevision: file.revision, expectedHash: file.revision.hash, resourceLimit: FILE_LIMITS.asset, ...(expectedParentIdentity ? { expectedParentIdentity } : {}) }, options);
        const bytes = Buffer.from(chunk.base64!, 'base64'), truncated = bytes.length < file.revision.size;
        let preview: string | null = null;
        try { const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: truncated }); if (!text.includes('\0')) preview = text; } catch { /* A binary material remains available with its full revision. */ }
        return { kind, available: true, revision: file.revision, preview, truncated, changed: Boolean(expected && identityKey(file.revision) !== identityKey(expected) || expectedHash && file.revision.hash !== expectedHash) };
      } catch (error) {
        if (options.signal?.aborted) throw new FileError('CANCELLED', '恢复材料读取已取消');
        return { kind, available: false, message: error instanceof FileError && error.code === 'MISSING' ? '该版本当前不存在，其余恢复材料仍保留' : '该版本未通过读取核对，其余恢复材料仍保留' };
      }
    };
    let root: RootDescriptor | undefined;
    try { root = await this.sourceRoot(record, options); } catch { if (options.signal?.aborted) throw new FileError('CANCELLED', '恢复材料读取已取消'); }
    const transaction = record.transactionLeaf ? posix.join(posix.dirname(record.relativePath), record.transactionLeaf) : undefined;
    const materials: FileRecoveryMaterial[] = [];
    materials.push(await read('current', root, record.relativePath, record.candidateIdentity, record.draftHash));
    materials.push(await read('displaced', record.exchanged ? root : undefined, transaction ? posix.join(transaction, 'candidate') : undefined, record.displacedIdentity ?? record.baseRevision, record.baseRevision?.hash, false, record.transactionIdentity));
    materials.push(await read('draft', this.root, `${projectKey}/${id}/${record.draftLeaf}`, record.draftIdentity, record.draftHash, true, record.recordIdentity));
    materials.push(await read('materialized', root, transaction ? posix.join(transaction, 'materialized') : undefined, record.candidateIdentity, record.draftHash, false, record.transactionIdentity));
    return { item: { ...item }, state: record.state, readOnly: true, materials };
  }
  drafts(lease: RootLease, relativePath: string): RecoveryItem[] {
    return [...this.records.values()].filter((r) => r.kind === 'checkpoint' && r.state !== 'resolved' && r.root.path === lease.canonicalPath && r.relativePath === relativePath && JSON.stringify(r.source.scope) === JSON.stringify(lease.scope))
      .map((r) => this.issues.get(`${r.projectKey}/${r.opId}`)!).filter(Boolean);
  }
  async readDraft(lease: RootLease, relativePath: string, id: string): Promise<{ base64: string; baseHash: string; bufferVersion: number; hash: string; encoding?: 'utf-8' | 'ooxml-draft' }> {
    const record = this.records.get(`${recoveryProjectKey(lease.projectId)}/${id}`);
    if (!record || record.kind !== 'checkpoint' || !this.drafts(lease, relativePath).some((r) => r.id === id)) throw new FileError('UNTRUSTED', '草稿不属于当前文件与任务');
    const relative = `${record.projectKey}/${id}/${record.draftLeaf}`;
    const result = await this.broker.request<NativeFileResult>({ operation: record.encoding === 'ooxml-draft' ? 'stat' : 'read', root: this.root, relativePath: relative });
    if (!record.draftIdentity || identityKey(result.revision) !== identityKey(record.draftIdentity) || result.revision.hash !== record.draftHash || !record.baseHash) throw new FileError('CHANGED', '草稿已改变，不能自动恢复');
    if (record.encoding === 'ooxml-draft') {
      if (result.revision.size > FILE_LIMITS.officeDraft) throw new FileError('TOO_LARGE', 'Office 草稿超过预算');
      const bytes = Buffer.alloc(result.revision.size);
      for (let offset=0;offset<bytes.length;offset+=FILE_LIMITS.chunk) {
        const length = Math.min(FILE_LIMITS.chunk, bytes.length-offset);
        const chunk = await this.broker.request<NativeFileResult>({ operation:'chunk', root:this.root, relativePath:relative, offset, length, resourceLimit:FILE_LIMITS.officeDraft, expectedRevision:result.revision, expectedHash:record.draftHash });
        const decoded = Buffer.from(chunk.base64!,'base64');
        if (decoded.length !== length || identityKey(chunk.revision) !== identityKey(record.draftIdentity)) throw new FileError('CHANGED', 'Office 草稿读取不完整或身份改变');
        decoded.copy(bytes,offset);
      }
      if (createHash('sha256').update(bytes).digest('hex') !== record.draftHash) throw new FileError('CHANGED', 'Office 草稿内容已改变');
      result.base64 = bytes.toString('base64');
    }
    return { base64: result.base64!, baseHash: record.baseHash, bufferVersion: record.bufferVersion, hash: record.draftHash, encoding: record.encoding };
  }
}
