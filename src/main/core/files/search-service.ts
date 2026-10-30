import { prioritizeSearchPaths } from '@shared/file-search-priority.mjs';
import picomatch from 'picomatch';
import { FileError, fileSearchSchema, type FileSearchIssue, type FileSearchProgress, type FileSearchRequest, type FileSearchResult, type FileSearchRow } from '@shared/files';
import type { NativeFileBroker } from './native-broker';
import type { FileRootsService, RootLease } from './roots';
import type { FileRecoveryStore } from './recovery-store';

interface WalkResult { paths: string[]; skipped: number; issues: FileSearchIssue[] }
interface SearchResult { rows: FileSearchRow[]; limited: boolean; searched: number; skipped: number; issues: FileSearchIssue[] }

/** Parsing/search runs in the killable broker against fd-anchored paths. No
 * shell, global rg configuration, ambient gitignore or untrusted executable. */
export class FileSearchService {
  private readonly jobs = new Map<string, AbortController>();
  constructor(private readonly roots: FileRootsService, private readonly broker: NativeFileBroker, private readonly recovery: FileRecoveryStore) {}
  async search(owner: string, raw: FileSearchRequest, emit: (update: FileSearchProgress) => void): Promise<FileSearchResult> {
    const input = fileSearchSchema.parse(raw), key = `${owner}/${input.id}`;
    if (this.jobs.has(key)) throw new FileError('IDEMPOTENCY', '搜索编号仍在使用');
    const abort = new AbortController(); this.jobs.set(key, abort);
    let lease: RootLease | null = null;
    try {
      await this.recovery.ready(); lease = this.roots.require(owner, input.root);
      const source = lease;
      if (abort.signal.aborted) throw new FileError('CANCELLED', '搜索已取消');
      const signal = AbortSignal.any([lease.abort.signal, abort.signal]);
      const walk = await this.broker.request<WalkResult>({ operation: 'walk', root: lease.descriptor, protected: this.recovery.protectedIdentities() }, { signal, timeoutMs: 15000 });
      this.roots.require(owner, input.root);
      if (input.kind === 'name') return { id: input.id, kind: input.kind, ...walk, rows: [], limited: false, searched: walk.paths.length };
      let paths = walk.paths;
      if (input.mask) {
        try { const match = picomatch(input.mask, { dot: true, nocase: false, matchBase: !input.mask.includes('/'), strictBrackets: true }); paths = paths.filter((path) => match(path)); }
        catch { throw new FileError('INVALID_INPUT', '文件掩码格式无效，请检查括号和通配符'); }
      }
      paths = prioritizeSearchPaths(paths, input.priorityFolders);
      const result = await this.broker.request<SearchResult>({ operation: 'search', root: lease.descriptor, protected: this.recovery.protectedIdentities(), paths, query: input.query }, { signal, timeoutMs: 15000, onSearchRow: (row) => {
        if (signal.aborted) return;
        try { this.roots.require(owner, input.root); emit({ id: input.id, lease: source.lease, generation: source.generation, row }); } catch { abort.abort(); }
      } });
      this.roots.require(owner, input.root);
      return { id: input.id, kind: input.kind, ...result, paths: [], skipped: walk.skipped + result.skipped, issues: [...walk.issues, ...result.issues].slice(0, 100) };
    } catch (error) {
      if (lease && await this.roots.observeFailure(lease, error)) throw new FileError('STALE_ROOT', '原目录已失效，请恢复原目录后重新关联');
      throw error;
    } finally { if (this.jobs.get(key) === abort) this.jobs.delete(key); }
  }
  cancel(owner: string, id: string): void { this.jobs.get(`${owner}/${id}`)?.abort(); }
  closeOwner(owner: string): void { for (const [key, abort] of this.jobs) if (key.startsWith(`${owner}/`)) abort.abort(); }
  dispose(): void { for (const abort of this.jobs.values()) abort.abort(); }
  get activeRequests(): number { return this.jobs.size; }
}
