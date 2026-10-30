import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { FileError, fileScopeSchema, rootRequestSchema, type FileIdentity, type FileRoot, type FileRoots, type FileScope, type RootRequest } from '@shared/files';
import type { NativeFileBroker, RootDescriptor } from './native-broker';
import { isNonLocalFileSource, NONLOCAL_WORKSPACE_MESSAGE } from '@shared/file-source-boundary.mjs';
import { fileRootRetrySchema, type FileRootRetryInput } from '@shared/files';

export interface RootSource {
  kind: 'project-directory' | 'task-cwd';
  id: string;
  path: string;
  label: string;
  projectId: string | null;
}
export interface SourceResolver { sources(scope: FileScope): RootSource[] }
export interface RootLease extends FileRoot {
  owner: string;
  scope: FileScope;
  projectId: string | null;
  sourcePath: string;
  descriptor: RootDescriptor;
  abort: AbortController;
}
export const identityKey = (identity: FileIdentity) => `${identity.device}:${identity.inode}`;
export const scopeKey = (scope: FileScope) => scope.kind === 'task' ? `task:${scope.taskId}` : `project:${scope.projectId}`;
export const isLocalPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 32768 && !value.includes('\0') && !value.startsWith('//') && !value.startsWith('\\\\') && !/^[a-z][a-z\d+.-]*:\/\//i.test(value) && isAbsolute(value);

/** Opaque capabilities are bound to a renderer frame and a specific source.
 * Re-reading the source invalidates edited/deleted project paths; task cwd is
 * its launch snapshot and is never substituted with a new project default.
 */
export class FileRootsService {
  private readonly leases = new Map<string, RootLease>();
  private readonly pending = new Map<string, { generation: number; abort: AbortController }>();
  private readonly retries = new Map<string, { owner: string; scope: string; abort: AbortController }>();
  private readonly checking = new Map<string, Promise<boolean>>();
  private sequence = 0;
  constructor(private readonly resolver: SourceResolver, private readonly broker: NativeFileBroker) {}

  async open(owner: string, input: FileScope): Promise<FileRoots> {
    if (isNonLocalFileSource(input)) throw new FileError('UNSUPPORTED', NONLOCAL_WORKSPACE_MESSAGE);
    const scope = fileScopeSchema.parse(input), key = `${owner}/${scopeKey(scope)}`;
    this.closeScope(owner, scope);
    const generation = ++this.sequence, abort = new AbortController();
    this.pending.set(key, { generation, abort });
    const roots: FileRoot[] = [], unavailable: FileRoots['unavailable'] = [];
    try {
      const sources = this.resolver.sources(scope);
      for (const source of sources) {
        try {
          if (isNonLocalFileSource(source)) throw new FileError('UNSUPPORTED', NONLOCAL_WORKSPACE_MESSAGE);
          if (!isLocalPath(source.path)) throw new FileError('UNSUPPORTED', '当前文件工作区仅支持已登记的本机绝对路径');
          const descriptor = await this.broker.request<RootDescriptor>({ operation: 'inspect-root', path: source.path }, { signal: abort.signal });
          descriptor.sourcePath = source.path;
          if (abort.signal.aborted || this.pending.get(key)?.generation !== generation) throw new FileError('CANCELLED', '根请求已失效');
          const latest = this.resolver.sources(scope).find((s) => s.kind === source.kind && s.id === source.id);
          if (!latest || latest.path !== source.path || latest.projectId !== source.projectId) throw new FileError('STALE_ROOT', '目录来源已改变，请重新打开文件区');
          const lease: RootLease = { lease: randomUUID(), generation, source: source.kind, sourceId: source.id, label: source.label, path: source.path, canonicalPath: descriptor.path, identity: descriptor.identity, owner, scope, projectId: source.projectId, sourcePath: source.path, descriptor, abort: new AbortController() };
          this.leases.set(lease.lease, lease);
          roots.push(this.publicRoot(lease));
        } catch (error) {
          if (abort.signal.aborted) throw new FileError('CANCELLED', '根请求已取消');
          unavailable.push({ source: source.kind, sourceId: source.id, label: source.label, path: source.path, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      if (abort.signal.aborted || this.pending.get(key)?.generation !== generation) throw new FileError('CANCELLED', '根请求已失效');
      return { roots, unavailable };
    } catch (error) {
      for (const root of roots) this.revoke(root.lease);
      throw error;
    } finally { if (this.pending.get(key)?.generation === generation) this.pending.delete(key); }
  }

  require(owner: string, input: RootRequest): RootLease {
    const request = rootRequestSchema.parse({ lease: input.lease, generation: input.generation });
    const lease = this.leases.get(request.lease);
    if (!lease || lease.owner !== owner || lease.generation !== request.generation || lease.abort.signal.aborted) throw new FileError('UNTRUSTED', '文件根授权已失效或不属于当前窗口');
    let source: RootSource | undefined;
    try { source = this.resolver.sources(lease.scope).find((s) => s.id === lease.sourceId && s.kind === lease.source); } catch { /* a removed task/project invalidates the lease */ }
    if (!source || source.path !== lease.sourcePath || source.projectId !== lease.projectId) {
      this.revoke(lease.lease); throw new FileError('STALE_ROOT', '项目目录或任务来源已改变，请重新打开文件区');
    }
    return lease;
  }

  /** A native source-root failure invalidates its old physical namespace.
   * A missing leaf alone is ordinary: inspect the trusted root before revoking.
   * This is called only for operations with a source root, never recovery IO. */
  async observeFailure(lease: RootLease, error: unknown): Promise<boolean> {
    if (this.leases.get(lease.lease) !== lease || !(error instanceof FileError)) return false;
    const invalidate = () => {
      const reason = new FileError('STALE_ROOT', '原目录已移动、删除或被替换，授权和监听已停止；已有编辑仍保留，请恢复原目录后重新关联');
      for (const current of [...this.leases.values()]) if (current.canonicalPath === lease.canonicalPath && identityKey(current.identity) === identityKey(lease.identity)) this.revoke(current.lease, reason);
      return true;
    };
    if (error.code === 'STALE_ROOT') return invalidate();
    if (error.code !== 'MISSING') return false;
    const existing = this.checking.get(lease.lease); if (existing) return existing;
    const job = (async () => {
      try {
        const current = await this.broker.request<RootDescriptor>({ operation: 'inspect-root', path: lease.sourcePath }, { signal: lease.abort.signal });
        if (this.leases.get(lease.lease) !== lease) return false;
        return current.path !== lease.canonicalPath || identityKey(current.identity) !== identityKey(lease.identity) ? invalidate() : false;
      } catch (failure) {
        return this.leases.get(lease.lease) === lease && failure instanceof FileError && ['MISSING', 'STALE_ROOT'].includes(failure.code) ? invalidate() : false;
      }
    })().finally(() => { if (this.checking.get(lease.lease) === job) this.checking.delete(lease.lease); });
    this.checking.set(lease.lease, job); return job;
  }

  /** Retry one registered source. Renewing the entire scope would revoke
   * unrelated open documents and strand their unsaved buffers. */
  async retry(owner: string, raw: FileRootRetryInput): Promise<FileRoots> {
    const input = fileRootRetrySchema.parse(raw), scoped = scopeKey(input.scope);
    const source = this.resolver.sources(input.scope).find(s => s.kind === input.source && s.id === input.sourceId);
    if (!source) throw new FileError('MISSING', '原目录来源已移除，请检查项目配置');
    const key = JSON.stringify([owner, scoped, input.source, input.sourceId]);
    this.retries.get(key)?.abort.abort();
    const job = { owner, scope: scoped, abort: new AbortController() }; this.retries.set(key, job);
    try {
      if (isNonLocalFileSource(source) || !isLocalPath(source.path)) throw new FileError('UNSUPPORTED', '当前文件工作区仅支持已登记的本机绝对路径');
      const descriptor = await this.broker.request<RootDescriptor>({ operation: 'inspect-root', path: source.path }, { signal: job.abort.signal });
      if (job.abort.signal.aborted || this.retries.get(key) !== job) throw new FileError('CANCELLED', '目录重试已失效');
      const latest = this.resolver.sources(input.scope).find(s => s.kind === source.kind && s.id === source.id);
      if (!latest || latest.path !== source.path || latest.projectId !== source.projectId) throw new FileError('STALE_ROOT', '目录来源已改变，请检查项目配置');
      descriptor.sourcePath = source.path;
      const existing = [...this.leases.values()].filter(lease => lease.owner === owner && scopeKey(lease.scope) === scoped && lease.source === source.kind && lease.sourceId === source.id);
      const reusable = existing.find(lease => lease.sourcePath === source.path && lease.canonicalPath === descriptor.path && identityKey(lease.identity) === identityKey(descriptor.identity) && !lease.abort.signal.aborted);
      if (reusable) { reusable.label = latest.label; return { roots: [this.publicRoot(reusable)], unavailable: [] }; }
      for (const lease of existing) this.revoke(lease.lease);
      const lease: RootLease = { lease: randomUUID(), generation: ++this.sequence, source: source.kind, sourceId: source.id, label: latest.label, path: source.path, canonicalPath: descriptor.path, identity: descriptor.identity, owner, scope: input.scope, projectId: source.projectId, sourcePath: source.path, descriptor, abort: new AbortController() };
      this.leases.set(lease.lease, lease); return { roots: [this.publicRoot(lease)], unavailable: [] };
    } catch (error) {
      if (job.abort.signal.aborted) throw new FileError('CANCELLED', '目录重试已取消');
      return { roots: [], unavailable: [{ source: source.kind, sourceId: source.id, path: source.path, label: source.label, reason: error instanceof Error ? error.message : String(error) }] };
    } finally { if (this.retries.get(key) === job) this.retries.delete(key); }
  }
  release(owner: string, input: RootRequest): void {
    const request = rootRequestSchema.parse(input), lease = this.leases.get(request.lease);
    if (!lease) return;
    if (lease.owner !== owner || lease.generation !== request.generation) throw new FileError('UNTRUSTED', '目录不属于当前窗口');
    this.revoke(lease.lease);
  }

  closeScope(owner: string, scope: FileScope): void {
    for (const retry of this.retries.values()) if (retry.owner === owner && retry.scope === scopeKey(scope)) retry.abort.abort();
    const key = `${owner}/${scopeKey(scope)}`; this.pending.get(key)?.abort.abort(); this.pending.delete(key);
    for (const lease of this.leases.values()) if (lease.owner === owner && scopeKey(lease.scope) === scopeKey(scope)) this.revoke(lease.lease);
  }
  closeOwner(owner: string): void {
    for (const retry of this.retries.values()) if (retry.owner === owner) retry.abort.abort();
    for (const [key, pending] of this.pending) if (key.startsWith(`${owner}/`)) { pending.abort.abort(); this.pending.delete(key); }
    for (const lease of this.leases.values()) if (lease.owner === owner) this.revoke(lease.lease);
  }
  private revoke(id: string, reason?: FileError): void { this.leases.get(id)?.abort.abort(reason); this.leases.delete(id); }
  private publicRoot({ lease, generation, source, sourceId, label, path, canonicalPath, identity }: RootLease): FileRoot {
    // This service only grants inspected local roots. The bundled file host
    // provides content search; untrusted renderer host hints never grant it.
    return { lease, generation, source, sourceId, label, path, canonicalPath, identity, hostId: 'local', capabilities: { searchContent: true, pdfAnnotations: true, pdfAnnotationBatching: false } };
  }
}
