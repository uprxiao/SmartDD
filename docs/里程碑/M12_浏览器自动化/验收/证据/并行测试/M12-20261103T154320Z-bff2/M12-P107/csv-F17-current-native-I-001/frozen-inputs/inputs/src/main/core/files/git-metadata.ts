import { createHash } from 'node:crypto';
import { FileError, filePathSchema, type FileIdentity, type FileRef, type FileRevision } from '@shared/files';
import { githubRepository, gitBlameSchema, gitStatusSchema, type GitBlame, type GitBlameInput, type GitBlameLine, type GitEntry, type GitRepositoryInfo, type GitStatus, type GitStatusInput } from '@shared/file-git';
export { githubRepository } from '@shared/file-git';
import type { NativeFileBroker } from './native-broker';
import type { FileRootsService, RootLease } from './roots';
import type { FileRecoveryStore } from './recovery-store';
import { addGitBlameDetails, type GitBlameDetailsAdapter } from './git-blame-details';

interface NativeGit { state: 'ready' | 'unavailable'; reason?: string; repository: FileIdentity; metadata: FileIdentity; head: string; prefix: string; remote: string; statusBase64?: string; attributesBase64?: string; attributesAvailable?: boolean; truncated?: boolean; blameBase64?: string; baseHash?: string }
function repository(raw: NativeGit): GitRepositoryInfo {
  const id = createHash('sha256').update(JSON.stringify([raw.repository, raw.metadata])).digest('hex');
  return { id, head: /^[a-f0-9]{40,64}$/.test(raw.head) ? raw.head : null, webBase: githubRepository(raw.remote), prefix: raw.prefix };
}
function zeroParts(value: string): string[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'base64'));
  if (!text) return []; if (!text.endsWith('\0')) throw new FileError('IO', 'Git 返回了不完整的文件信息'); return text.slice(0, -1).split('\0');
}
export function parseGitStatus(raw: Pick<NativeGit, 'statusBase64' | 'attributesBase64' | 'attributesAvailable' | 'prefix'>): GitEntry[] {
  const attributes = new Map<string, boolean | null>(), values = zeroParts(raw.attributesBase64 ?? '');
  if (raw.attributesAvailable) for (let i = 0; i + 2 < values.length; i += 3) if (values[i + 1] === 'linguist-generated') attributes.set(values[i], ['set', 'true'].includes(values[i + 2]) ? true : ['unset', 'false'].includes(values[i + 2]) ? false : null);
  const records = zeroParts(raw.statusBase64 ?? ''), entries: GitEntry[] = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i], xy = row.slice(0, 2), path = row.slice(3), rename = /[RC]/.test(xy), previous = rename ? records[++i] : undefined;
    if (row[2] !== ' ' || !path.startsWith(raw.prefix)) throw new FileError('IO', 'Git 文件路径不属于当前来源');
    const relativePath = filePathSchema.parse(path.slice(raw.prefix.length).replace(/\/$/, '')); if (!relativePath) continue;
    const status = xy === '??' ? 'untracked' : xy === '!!' ? 'ignored' : /U/.test(xy) || ['AA', 'DD'].includes(xy) ? 'conflict' : rename ? 'renamed' : xy.includes('D') ? 'deleted' : xy.includes('A') ? 'added' : 'modified';
    entries.push({ relativePath, status, generated: attributes.get(path) ?? null, directory: path.endsWith('/'), ...(previous?.startsWith(raw.prefix) && previous ? { previousPath: filePathSchema.parse(previous.slice(raw.prefix.length)) } : {}) });
  }
  return entries;
}
export function parseGitBlame(base64: string, start: number, end: number): GitBlameLine[] {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(base64, 'base64')), lines: GitBlameLine[] = [];
  let current: GitBlameLine | null = null;
  for (const row of text.split('\n')) {
    const header = /^([a-f0-9]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(row);
    if (header) current = { line: Number(header[2]), commitId: header[1], author: '', at: null, summary: '' };
    else if (current && row.startsWith('author ')) current.author = row.slice(7).slice(0, 256);
    else if (current && row.startsWith('author-time ')) { const at = Number(row.slice(12)); current.at = Number.isSafeInteger(at) && Math.abs(at) <= 8.64e12 ? at : null; }
    else if (current && row.startsWith('summary ')) current.summary = row.slice(8).slice(0, 2048);
    else if (current && row.startsWith('\t')) { lines.push(current); current = null; }
  }
  if (lines.length !== end - start + 1 || lines.some((line, index) => line.line !== start + index || /^0+$/.test(line.commitId))) throw new FileError('CHANGED', 'Git 行归属与当前文件行号不匹配');
  return lines;
}

export class FileGitMetadata {
  private readonly pending = new Map<string, AbortController>();
  private readonly cancelled = new Map<string, number>();
  constructor(private readonly roots: FileRootsService, private readonly broker: NativeFileBroker, private readonly recovery: FileRecoveryStore, private readonly document: (owner: string, ref: FileRef) => { lease: RootLease; relativePath: string; revision: FileRevision; signal: AbortSignal }, private readonly detailsAdapter?: GitBlameDetailsAdapter) {}
  private async request(owner: string, id: string, lease: RootLease, signal: AbortSignal, payload: Record<string, unknown>): Promise<NativeGit> {
    const key = `${owner}/${id}`, now = Date.now(); for (const [key, until] of this.cancelled) if (until < now) this.cancelled.delete(key);
    if (signal.aborted || this.cancelled.has(key)) throw new FileError('CANCELLED', 'Git 信息请求已取消');
    if (this.pending.has(key)) throw new FileError('IDEMPOTENCY', 'Git 请求编号已使用');
    if ([...this.pending.keys()].filter((key) => key.startsWith(owner + '/')).length >= 4) throw new FileError('TOO_LARGE', 'Git 查询队列已满');
    const abort = new AbortController(); this.pending.set(key, abort);
    try {
      await this.recovery.ready(); this.roots.require(owner, lease);
      const result = await this.broker.request<NativeGit>({ ...payload, root: lease.descriptor, protected: this.recovery.protectedIdentities() }, { signal: AbortSignal.any([signal, lease.abort.signal, abort.signal]) });
      this.roots.require(owner, lease); return result;
    } finally { this.pending.delete(key); }
  }
  async status(owner: string, raw: GitStatusInput): Promise<GitStatus> {
    const input = gitStatusSchema.parse(raw), lease = this.roots.require(owner, input.root);
    const result = await this.request(owner, input.id, lease, lease.abort.signal, { operation: 'git-status' });
    return result.state === 'unavailable' ? { state: 'unavailable', reason: result.reason ?? 'Git 信息不可用' } : { state: 'ready', repository: repository(result), entries: parseGitStatus(result), truncated: Boolean(result.truncated), attributesAvailable: Boolean(result.attributesAvailable) };
  }
  async blame(owner: string, raw: GitBlameInput): Promise<GitBlame> {
    const input = gitBlameSchema.parse(raw), context = this.document(owner, input.ref);
    if (context.revision.hash !== input.baseHash) throw new FileError('CHANGED', '当前文件版本已更新');
    const result = await this.request(owner, input.id, context.lease, context.signal, { operation: 'git-blame', relativePath: context.relativePath, expectedIdentity: { device: context.revision.device, inode: context.revision.inode }, baseHash: input.baseHash, lineStart: input.lineStart, lineEnd: input.lineEnd });
    if (this.document(owner, input.ref).revision.hash !== input.baseHash) throw new FileError('CHANGED', '当前文件版本已更新');
    if (result.state === 'unavailable') return { state: 'unavailable', reason: result.reason ?? 'Git 行归属不可用' };
    const repo = repository(result), lines = addGitBlameDetails(parseGitBlame(result.blameBase64!, input.lineStart, input.lineEnd), repo, this.detailsAdapter);
    // An optional adapter is synchronous, but it still cannot replace the
    // native document/root authority or widen a revoked source.
    this.roots.require(owner, context.lease);
    if (this.document(owner, input.ref).revision.hash !== input.baseHash) throw new FileError('CHANGED', '当前文件版本已更新');
    return { state: 'ready', repository: repo, baseHash: result.baseHash!, lines };
  }
  cancel(owner: string, id: string): void { if (!/^[a-f0-9-]{36}$/.test(id)) throw new FileError('INVALID_INPUT', 'Git 请求编号无效'); const key = `${owner}/${id}`; this.pending.get(key)?.abort(); this.cancelled.set(key, Date.now() + 60_000); while (this.cancelled.size > 2048) this.cancelled.delete(this.cancelled.keys().next().value!); }
  closeOwner(owner: string): void { for (const [key, abort] of this.pending) if (key.startsWith(owner + '/')) abort.abort(); }
}
