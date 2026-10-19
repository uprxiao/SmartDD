import { randomUUID, createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { FILE_LIMITS, FileError, fileActionTargetSchema, fileCopySchema, fileExternalOpenSchema, type FileActionTarget, type FileApplications, type FileCopyInput, type FileCopyReceipt, type FileExternalOpen, type FileIdentity, type FileRevision, type FileSaveReceipt } from '@shared/files';
import { NativeFileBroker, type NativeFileResult, type RootDescriptor } from './native-broker';
import { type RootLease, FileRootsService } from './roots';
import { FileRecoveryStore, recoveryProjectKey } from './recovery-store';

export interface FileActionContext { lease: RootLease; relativePath: string; directory: boolean; identity?: FileIdentity; signal: AbortSignal }
export interface OpenerPreferences { get(): { path: string | null; bundleId: string | null }; set(value: { path: string; bundleId: string }): Promise<unknown> }
interface NativeApplication { path: string; identity: FileIdentity; name: string; bundleId: string; icon?: string; systemDefault: boolean }
interface ApplicationGrant { owner: string; context: FileActionContext; expires: number; applications: Map<string, NativeApplication> }
interface CopyDestination { root: RootDescriptor; relativePath: string; revision: FileRevision | null }
export interface CopySelection { owner: string; context: FileActionContext; name: string; revision: FileRevision; draftBase64?: string; used: boolean }
const hash = (data: string) => createHash('sha256').update(data).digest('hex');

/** Native side effects share the same frame/root authority as file reads. */
export class FileActions {
  private readonly grants = new Map<string, ApplicationGrant>();
  private readonly pendingCopies = new Set<string>();
  private readonly blockedCopies = new Map<string, string>();
  private readonly installationId = randomUUID();
  constructor(private readonly resolve: (owner: string, target: FileActionTarget) => FileActionContext, private readonly roots: FileRootsService, private readonly broker: NativeFileBroker, private readonly recovery: FileRecoveryStore, private readonly preferences?: OpenerPreferences) {}

  private validate(owner: string, context: FileActionContext): void {
    this.roots.require(owner, context.lease);
    if (context.signal.aborted) throw new FileError('CANCELLED', '文件操作的来源已关闭');
  }
  private request<T>(operation: string, context: FileActionContext, extra: Record<string, unknown> = {}): Promise<T> {
    return this.broker.request<T>({ operation, root: context.lease.descriptor, relativePath: context.relativePath, directory: context.directory, ...(context.identity ? { expectedIdentity: context.identity } : {}), protected: this.recovery.protectedIdentities(), ...extra }, { signal: context.signal });
  }
  async applications(owner: string, raw: FileActionTarget): Promise<FileApplications> {
    const context = this.resolve(owner, fileActionTargetSchema.parse(raw)); await this.recovery.ready(); this.validate(owner, context);
    const result = await this.request<{ identity: FileIdentity; relativePath: string; applications: NativeApplication[] }>('applications', context);
    this.validate(owner, context);
    context.identity = result.identity; context.relativePath = result.relativePath;
    for (const [id, grant] of this.grants) if (grant.expires < Date.now() || grant.context.signal.aborted) this.grants.delete(id);
    while (this.grants.size >= 256) this.grants.delete(this.grants.keys().next().value!);
    const id = randomUUID(), applications = new Map(result.applications.map((app) => [randomUUID(), app]));
    this.grants.set(id, { owner, context, expires: Date.now() + 10 * 60_000, applications });
    const preferred = this.preferences?.get(), selected = preferred?.path ? [...applications].find(([, app]) => app.path === preferred.path && app.bundleId === preferred.bundleId)?.[0] : [...applications].find(([, app]) => app.systemDefault)?.[0];
    return { id, apps: [...applications].map(([id, { name, bundleId, icon, systemDefault }]) => ({ id, name, bundleId, icon, systemDefault })), preferredId: selected, preferredUnavailable: Boolean(preferred?.path && !selected) };
  }
  async open(owner: string, raw: FileExternalOpen): Promise<{ state: 'opened'; name: string }> {
    const input = fileExternalOpenSchema.parse(raw), grant = this.grants.get(input.listId);
    if (!grant || grant.owner !== owner || grant.expires < Date.now()) throw new FileError('UNTRUSTED', '应用列表已失效，请重新读取');
    this.validate(owner, grant.context);
    const application = grant.applications.get(input.appId);
    if (!application) throw new FileError('UNTRUSTED', '请选择本次发现的应用');
    await this.request('open-external', grant.context, { application });
    this.validate(owner, grant.context);
    // Merely opening a menu or an application must not change the preference.
    if (input.remember) await this.preferences?.set({ path: application.path, bundleId: application.bundleId });
    return { state: 'opened', name: application.name };
  }
  async reveal(owner: string, raw: FileActionTarget): Promise<{ state: 'dispatched' }> {
    const context = this.resolve(owner, fileActionTargetSchema.parse(raw)); await this.recovery.ready(); this.validate(owner, context);
    const result = await this.request<{ state: 'dispatched' }>('reveal', context); this.validate(owner, context); return result;
  }
  async prepareCopy(owner: string, raw: FileCopyInput): Promise<CopySelection> {
    const input = fileCopySchema.parse(raw), context = this.resolve(owner, input.target);
    if (context.directory) throw new FileError('NOT_REGULAR', '另存副本只适用于文件');
    if (input.draftBase64 !== undefined) {
      const bytes = Buffer.from(input.draftBase64, 'base64');
      if (input.target.kind !== 'document' || bytes.length > FILE_LIMITS.readableText || bytes.toString('base64') !== input.draftBase64) throw new FileError('INVALID_INPUT', '副本内容无效或超过上限');
    }
    await this.recovery.ready(); this.validate(owner, context);
    const result = await this.request<NativeFileResult>('stat', context); this.validate(owner, context);
    if (input.baseHash !== undefined && result.revision.hash !== input.baseHash) throw new FileError('CHANGED', '源图片内容已改变，请重新打开预览后另存');
    if (context.identity && (result.revision.device !== context.identity.device || result.revision.inode !== context.identity.inode)) throw new FileError('CHANGED', '源文件已被替换，请刷新后重试');
    context.relativePath = result.relativePath; context.identity = { device: result.revision.device, inode: result.revision.inode };
    return { owner, context, name: basename(result.relativePath), revision: result.revision, draftBase64: input.draftBase64, used: false };
  }
  /** destinationPath is supplied only by a main-owned native save dialog. */
  async copyTo(owner: string, selection: CopySelection, destinationPath: string): Promise<FileCopyReceipt> {
    if (selection.owner !== owner || selection.used) throw new FileError('UNTRUSTED', '另存副本请求已失效');
    selection.used = true;
    const { context, revision } = selection; this.validate(owner, context);
    const destination = await this.broker.request<CopyDestination>({ operation: 'inspect-copy-target', path: destinationPath, protected: this.recovery.protectedIdentities() }, { signal: context.signal });
    this.validate(owner, context);
    const path = join(destination.root.path, destination.relativePath);
    if (destination.revision && destination.revision.device === revision.device && destination.revision.inode === revision.inode) throw new FileError('CONFLICT', '请选择其它文件名；另存副本不能覆盖源文件');
    if (this.pendingCopies.has(path) || this.blockedCopies.has(path) || this.recovery.blockingPath(destination.root.path, destination.relativePath)) throw new FileError('CONFLICT', '此目标有进行中或结果未确认的副本，请先核对目标和恢复记录');
    const lease = context.lease, opId = randomUUID(), projectKey = recoveryProjectKey(lease.projectId);
    const fingerprint = hash(JSON.stringify({ source: lease.descriptor, path: context.relativePath, revision, destination, draft: selection.draftBase64 === undefined ? null : hash(selection.draftBase64) }));
    this.recovery.reserve(projectKey, opId, destination.revision?.size ?? 0, selection.draftBase64 === undefined ? revision.size : Buffer.byteLength(selection.draftBase64, 'base64'));
    this.pendingCopies.add(path);
    let receipt: FileSaveReceipt;
    try {
      receipt = await this.broker.request<FileSaveReceipt>({ operation: 'copy', root: lease.descriptor, relativePath: context.relativePath, expectedRevision: revision, ...(selection.draftBase64 === undefined ? {} : { draftBase64: selection.draftBase64 }), destination, recoveryRoot: this.recovery.descriptor(), protected: this.recovery.protectedIdentities(), source: { kind: lease.source, id: lease.sourceId, scope: lease.scope }, installationId: this.installationId, projectKey, fingerprint, opId, bufferVersion: 0 }, { signal: context.signal, onTransaction: (identity) => this.recovery.protect(identity) });
    } catch (error) {
      const beforeWrite = error instanceof FileError && ['CHANGED', 'CONFLICT', 'UNTRUSTED', 'MISSING', 'STALE_ROOT', 'NOT_REGULAR', 'TOO_LARGE', 'INTERNAL_OBJECT', 'INVALID_INPUT'].includes(error.code);
      receipt = { opId, bufferVersion: 0, state: beforeWrite ? 'failed' : 'unknown', ...(beforeWrite ? {} : { recoveryId: opId }), message: error instanceof Error ? error.message : String(error) };
    }
    finally { this.pendingCopies.delete(path); }
    this.recovery.remember(lease, opId, receipt);
    if (receipt.state !== 'saved' || !receipt.revision) {
      if (receipt.state === 'unknown' || receipt.state === 'conflict' && receipt.recoveryId) this.blockedCopies.set(path, opId);
      throw new FileError(receipt.state === 'conflict' ? 'CONFLICT' : 'IO', `副本未确认保存：${receipt.message ?? receipt.state}${receipt.recoveryId ? '；请核对恢复记录与目标文件' : ''}`);
    }
    this.validate(owner, context);
    return { state: 'saved', path, hash: receipt.revision.hash };
  }
  closeOwner(owner: string): void { for (const [id, grant] of this.grants) if (grant.owner === owner) this.grants.delete(id); }
}
