import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FileError, type FileRef } from '@shared/files';
import { TEX_LIMITS, texOpenSchema, type TexOpenInput, type TexPreviewResult } from '@shared/file-tex';
import { fileHeavyJobs, type FileHeavyJobs } from '../heavy-jobs';
import type { NativeFileBroker, RootDescriptor } from '../native-broker';
import { texEngineResources, type TexEngineResources } from './engine-resources';
import { TexParser } from './parser';
import { normalizeTexPdfResources, texSnapshot, type TexSnapshot, type TexSource } from './resources';
import { TexWorkspaces } from './workspaces';

export interface TexConfiguration { directory: string; userData: string; packagePath?: string; workerPath?: string }
export type TexNativeResult = { state: 'failed'; diagnostic: string; message: string } | ({ state: 'ready'; base64: string } & Omit<TexPreviewResult, 'id' | 'warnings'>);
export interface TexDocumentSource extends TexSource { compile: (snapshot: TexSnapshot, resources: TexEngineResources, job: RootDescriptor, wallMs: number, signal: AbortSignal) => Promise<TexNativeResult> }
interface Job { owner: string; id: string; abort: AbortController; source: TexDocumentSource; bytes?: Buffer; result?: TexPreviewResult; invalidated: () => void }

export class FileTexService {
  private readonly jobs = new Map<string, Job>();
  private readonly cancelled = new Map<string, number>();
  private warmed = false;
  private readonly workspaces?: TexWorkspaces;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private disposed = false;
  constructor(private readonly resolve: (owner: string, ref: FileRef) => TexDocumentSource, broker: NativeFileBroker, private readonly configuration?: TexConfiguration, private readonly queue: FileHeavyJobs = fileHeavyJobs) {
    if (configuration) this.workspaces = new TexWorkspaces(configuration.userData, broker);
  }
  async recover(): Promise<void> {
    if (!this.workspaces || this.disposed) return;
    clearTimeout(this.recoveryTimer);
    const report = await this.workspaces.recover();
    if (report.issues.length) console.warn('[files/tex] Temporary objects retained after identity/type check:', report.issues);
    if (report.busy.length && !this.disposed) { this.recoveryTimer = setTimeout(() => { void this.recover().catch((error) => console.warn('[files/tex] Cleanup pending:', error)); }, 15_000); this.recoveryTimer.unref(); }
  }
  dispose(): void { this.disposed = true; clearTimeout(this.recoveryTimer); for (const job of this.jobs.values()) this.release(job.owner, job.id); }
  private key(owner: string, id: string) { return `${owner}/${id}`; }
  async open(owner: string, raw: TexOpenInput): Promise<TexPreviewResult> {
    const input = texOpenSchema.parse(raw), key = this.key(owner, input.id);
    for (const [id, until] of this.cancelled) if (until < Date.now()) this.cancelled.delete(id);
    if (this.cancelled.has(key)) throw new FileError('CANCELLED', 'TeX 编译已取消');
    if (this.jobs.has(key)) throw new FileError('IDEMPOTENCY', 'TeX 请求编号已经使用');
    if (!this.configuration) throw new FileError('UNSUPPORTED', '本平台尚未提供离线 TeX 编译器');
    if ([...this.jobs.values()].some((value) => value.owner === owner)) throw new FileError('CONFLICT', '请先关闭当前 TeX 预览');
    if (this.jobs.size >= 4) throw new FileError('TOO_LARGE', 'TeX 预览已达到四个窗口的上限');
    const source = this.resolve(owner, input.ref); source.assert();
    if (!/\.tex$/i.test(source.path) || source.hash !== input.baseHash) throw new FileError('CHANGED', 'TeX 源码或版本不匹配');
    const abort = new AbortController(), job: Job = { owner, id: input.id, source, abort, invalidated: () => this.release(owner, input.id) };
    source.signal.addEventListener('abort', job.invalidated, { once: true }); this.jobs.set(key, job);
    const signal = AbortSignal.any([abort.signal, source.signal]);
    try {
      return await this.queue.run(signal, async () => {
        const config = this.configuration!, parser = new TexParser(config.workerPath ?? join(__dirname, 'm9-tex-resources.js'));
        let workspace: RootDescriptor | undefined;
        // This deadline includes dependency discovery/resource validation. The
        // compiler has a separate 30/15 second budget enforced in native code.
        const timer = setTimeout(() => abort.abort(new FileError('TIMEOUT', 'TeX 资源准备及编译超过 60 秒')), 60_000);
        try {
          const snapshot = await texSnapshot(source, (text, cancel) => parser.parse(text, cancel), signal);
          await normalizeTexPdfResources(source, snapshot, (bytes, cancel) => parser.normalizePdf(bytes, cancel), signal); parser.close(); signal.throwIfAborted();
          const resources = await texEngineResources(config.directory, config.packagePath); signal.throwIfAborted();
          workspace = await this.workspaces!.create(); signal.throwIfAborted(); source.assert();
          const result = await source.compile(snapshot, resources, workspace, this.warmed ? TEX_LIMITS.warmMs : TEX_LIMITS.coldMs, signal); this.warmed = true;
          signal.throwIfAborted(); source.assert();
          if (result.state === 'failed') throw new FileError('INVALID_INPUT', `${result.message}\n${result.diagnostic.slice(-16384)}`);
          const bytes = Buffer.from(result.base64, 'base64');
          if (!bytes.length || bytes.length > TEX_LIMITS.outputBytes || bytes.length !== result.bytes || createHash('sha256').update(bytes).digest('hex') !== result.hash || result.pages < 1 || result.pages > TEX_LIMITS.pages) throw new FileError('IO', 'TeX PDF 回执校验失败');
          job.bytes = bytes; job.result = { id: input.id, hash: result.hash, bytes: bytes.length, pages: result.pages, elapsedMs: result.elapsedMs, peakRssBytes: result.peakRssBytes, warnings: snapshot.warnings, diagnostic: result.diagnostic };
          return job.result;
        } finally { clearTimeout(timer); parser.close(); if (workspace) await this.workspaces!.clean(workspace); }
      });
    } catch (error) { this.release(owner, input.id); if (abort.signal.reason instanceof FileError) throw abort.signal.reason; throw error; }
  }
  chunk(owner: string, id: string, offset: number, length: number): string {
    const job = this.jobs.get(this.key(owner, id));
    if (!job?.bytes || job.abort.signal.aborted) throw new FileError('UNTRUSTED', 'TeX PDF 预览已关闭或不属于此窗口');
    job.source.assert();
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > TEX_LIMITS.chunkBytes || offset + length > job.bytes.length) throw new FileError('INVALID_INPUT', 'TeX PDF 读取范围无效');
    return job.bytes.subarray(offset, offset + length).toString('base64');
  }
  release(owner: string, id: string) {
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return;
    const key = this.key(owner, id), job = this.jobs.get(key);
    if (this.cancelled.size >= 2048) this.cancelled.delete(this.cancelled.keys().next().value!); this.cancelled.set(key, Date.now() + 60_000);
    if (job) { job.abort.abort(); job.source.signal.removeEventListener('abort', job.invalidated); job.bytes = undefined; this.jobs.delete(key); }
  }
  closeOwner(owner: string) { for (const job of this.jobs.values()) if (job.owner === owner) this.release(owner, job.id); }
}
