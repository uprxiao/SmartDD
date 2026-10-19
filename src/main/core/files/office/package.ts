import { createHash } from 'node:crypto';
import { crc32 } from 'node:zlib';
import type { Readable } from 'node:stream';
import { fromBufferPromise } from 'yauzl';
import { ZipFile } from 'yazl';
import { OFFICE_LIMITS, type OfficePartPlan } from '@shared/file-office';
import { FileError } from '@shared/files';

export interface OfficeZipLimits { inputBytes: number; outputBytes: number; expandedBytes: number; partBytes: number; parts: number }
interface Part { data: Buffer; mtime: Date; mode: number; directory: boolean; compress: boolean }
const defaults: OfficeZipLimits = OFFICE_LIMITS;
const fail = (message: string): never => { throw new FileError('INVALID_INPUT', message); };
const budget = (message: string): never => { throw new FileError('TOO_LARGE', message); };

/** Part names are identifiers, never paths to extract on the host filesystem. */
export function officePartName(name: string, directory = false): string {
  let decoded: string;
  try { decoded = decodeURIComponent(name); } catch { return fail('Office 部件名称含无效转义'); }
  const value = directory && decoded.endsWith('/') ? decoded.slice(0, -1) : decoded;
  if (!value || value.startsWith('/') || /[\\\u0000-\u001f\u007f:#?]/.test(value) || value.split('/').some((part) => !part || part === '.' || part === '..') || /%2f|%5c/i.test(name)) fail('Office 部件名称越界或不规范');
  return name;
}
const nameKey = (name: string) => decodeURIComponent(name).toLocaleLowerCase('en-US');
const checkSignal = (signal?: AbortSignal) => { if (signal?.aborted) throw new FileError('CANCELLED', 'Office 文件操作已取消'); };

/** Original uncompressed part bytes are the fidelity baseline. ZIP container
 * metadata/compression may differ; unedited XML/media/unknown parts may not. */
export class OfficePackage {
  private constructor(private readonly parts: ReadonlyMap<string, Part>, private readonly limits: OfficeZipLimits, private readonly comment: string) {}

  static async read(input: Uint8Array, signal?: AbortSignal, limits: OfficeZipLimits = defaults): Promise<OfficePackage> {
    checkSignal(signal);
    if (input.byteLength > limits.inputBytes) budget('Office 文件超过 40 MiB 读取上限');
    const zip = await fromBufferPromise(Buffer.from(input), { validateEntrySizes: true, strictFileNames: true });
    let active: Readable | undefined;
    const abort = () => { active?.destroy(new FileError('CANCELLED', 'Office 文件操作已取消')); zip.close(); };
    signal?.addEventListener('abort', abort, { once: true });
    try {
      checkSignal(signal);
      if (zip.entryCount > limits.parts) budget('Office 包内部件超过 8192 项');
      const parts = new Map<string, Part>(), keys = new Set<string>();
      let expanded = 0;
      for await (const entry of zip.eachEntry()) {
        checkSignal(signal);
        const directory = entry.fileName.endsWith('/'), name = officePartName(entry.fileName, directory);
        const key = nameKey(name), mode = entry.externalFileAttributes >>> 16;
        if (keys.has(key)) fail('Office 包包含重名部件');
        keys.add(key);
        if (parts.size >= limits.parts) budget('Office 包内部件超过 8192 项');
        if (entry.generalPurposeBitFlag & 0x41) throw new FileError('UNSUPPORTED', 'Office ZIP 加密部件尚不可读取');
        const fileType = mode & 0o170000;
        if (fileType && fileType !== (directory ? 0o040000 : 0o100000)) fail('Office 包不能包含链接或特殊文件');
        if (entry.uncompressedSize > limits.partBytes || expanded + entry.uncompressedSize > limits.expandedBytes) budget('Office 包解压后的部件大小超过预算');
        active = await zip.openReadStreamPromise(entry);
        checkSignal(signal);
        const chunks: Buffer[] = []; let size = 0, checksum = 0;
        for await (const raw of active) {
          checkSignal(signal);
          const chunk = Buffer.from(raw); size += chunk.length;
          if (size > entry.uncompressedSize || size > limits.partBytes || expanded + size > limits.expandedBytes) budget('Office 包实际解压大小超过预算');
          checksum = crc32(chunk, checksum); chunks.push(chunk);
        }
        active = undefined;
        if (size !== entry.uncompressedSize || checksum !== entry.crc32) fail('Office 部件大小或 CRC 校验失败');
        if (directory && size !== 0) fail('Office 目录条目包含意外数据');
        expanded += size;
        parts.set(name, { data: Buffer.concat(chunks, size), mtime: entry.getLastModDate(), mode: mode || (directory ? 0o40755 : 0o100644), directory, compress: entry.compressionMethod !== 0 });
      }
      if (!parts.has('[Content_Types].xml') || !parts.has('_rels/.rels')) fail('文件缺少 Office 包类型或入口关系');
      return new OfficePackage(parts, { ...limits }, zip.comment);
    } finally { signal?.removeEventListener('abort', abort); active?.destroy(); zip.close(); }
  }

  names(): string[] { return [...this.parts].filter(([, part]) => !part.directory).map(([name]) => name); }
  has(name: string): boolean { return this.parts.has(name); }
  read(name: string): Buffer {
    const part = this.parts.get(name);
    if (!part || part.directory) return fail(`Office 部件不存在：${name}`);
    return Buffer.from(part.data);
  }
  hashes(): Record<string, string> { return Object.fromEntries(this.names().map((name) => [name, createHash('sha256').update(this.parts.get(name)!.data).digest('hex')])); }
  static retainedBytes(packages: readonly OfficePackage[]): number {
    const buffers = new Set<Buffer>();
    for (const file of packages) for (const part of file.parts.values()) buffers.add(part.data);
    let total = 0; for (const bytes of buffers) total += bytes.length; return total;
  }

  /** Every operation supplies its expected part closure before materialisation.
   * A new package cannot contain undeclared changes, additions or removals. */
  patch(changes: ReadonlyMap<string, Uint8Array | null>, plan: OfficePartPlan): OfficePackage {
    const expected = new Map<string, 'changed' | 'added' | 'removed'>();
    for (const kind of ['changed', 'added', 'removed'] as const) for (const name of plan[kind]) {
      officePartName(name);
      if (expected.has(name)) fail('Office 变更计划包含重复部件');
      expected.set(name, kind);
    }
    const next = new Map(this.parts), actual = new Map<string, string>();
    for (const [name, bytes] of changes) {
      officePartName(name);
      const old = this.parts.get(name);
      if (old?.directory) fail('Office 操作不能改写目录条目');
      if (bytes === null) { if (old) { next.delete(name); actual.set(name, 'removed'); } }
      else {
        const data = Buffer.from(bytes);
        if (data.length > this.limits.partBytes) budget('Office 候选部件超过大小预算');
        if (!old || !old.data.equals(data)) {
          next.set(name, { data, mtime: old?.mtime ?? new Date('1980-01-01T00:00:00Z'), mode: old?.mode ?? 0o100644, directory: false, compress: old?.compress ?? true });
          actual.set(name, old ? 'changed' : 'added');
        }
      }
    }
    if (actual.size !== expected.size || [...actual].some(([name, kind]) => expected.get(name) !== kind)) fail('Office 候选包含未声明的修改或缺少预期修改，原件未改变');
    const keys = new Set<string>(); let total = 0;
    for (const [name, part] of next) {
      const key = nameKey(name); if (keys.has(key)) fail('Office 候选包含重名部件'); keys.add(key);
      total += part.data.length;
    }
    if (next.size > this.limits.parts || total > this.limits.expandedBytes) budget('Office 候选展开量超过预算');
    if (!next.has('[Content_Types].xml') || !next.has('_rels/.rels')) fail('Office 操作不能删除包类型或入口关系');
    return new OfficePackage(next, this.limits, this.comment);
  }

  async bytes(signal?: AbortSignal): Promise<Buffer> {
    checkSignal(signal);
    const zip = new ZipFile(), output = zip.outputStream as Readable;
    const abort = () => output.destroy(new FileError('CANCELLED', 'Office 文件物化已取消'));
    signal?.addEventListener('abort', abort, { once: true });
    // Both streams report errors; drain via async iteration instead of leaving
    // an unhandled EventEmitter error after cancellation or compressor failure.
    zip.on('error', (error: Error) => output.destroy(error));
    try {
      for (const [name, part] of this.parts) {
        checkSignal(signal);
        if (part.directory) zip.addEmptyDirectory(name, { mtime: part.mtime, mode: part.mode });
        else zip.addBuffer(part.data, name, { mtime: part.mtime, mode: part.mode, compress: part.compress });
      }
      zip.end({ comment: this.comment, forceZip64Format: false });
      const chunks: Buffer[] = []; let size = 0;
      for await (const raw of output) {
        checkSignal(signal); const chunk = Buffer.from(raw); size += chunk.length;
        if (size > this.limits.outputBytes) budget('Office 保存候选超过 40 MiB');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks, size);
    } finally { signal?.removeEventListener('abort', abort); output.destroy(); }
  }
}
