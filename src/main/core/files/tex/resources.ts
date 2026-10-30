import { posix } from 'node:path';
import { createHash } from 'node:crypto';
import { FileError, filePathSchema, type FileRevision } from '@shared/files';
import { TEX_LIMITS } from '@shared/file-tex';
import type { TexReference, TexReferences } from './references';

export interface TexResource { path: string; revision: FileRevision; normalized?: { base64: string; hash: string; bytes: number } }
export interface TexSource {
  path: string; hash: string; signal: AbortSignal; assert: () => void;
  stat: (path: string, signal: AbortSignal) => Promise<FileRevision>;
  read: (path: string, signal: AbortSignal, byteLimit?: number) => Promise<{ bytes: Uint8Array; hash: string }>;
}
export interface TexSnapshot { entry: string; files: TexResource[]; warnings: string[]; bytes: number }
const parsedKinds = new Set(['source', 'style', 'class']);
const suffixes: Record<TexReference['kind'], string[]> = { source: ['', '.tex'], image: ['', '.pdf', '.png', '.jpg', '.jpeg'], bibliography: ['', '.bib'], style: ['.sty'], class: ['.cls'], data: [''] };
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export async function texSnapshot(source: TexSource, parse: (text: string, signal: AbortSignal) => Promise<TexReferences>, signal: AbortSignal): Promise<TexSnapshot> {
  const files = new Map<string, TexResource>(), parsed = new Set<string>(), warnings = new Set<string>();
  const cwd = posix.dirname(source.path), graphics = new Set<string>();
  let bytes = 0, references = 0;
  const check = () => { signal.throwIfAborted(); source.signal.throwIfAborted(); source.assert(); };
  const relative = (base: string, path: string) => {
    if (!path || path.startsWith('/') || /^[a-z][\w+.-]*:/i.test(path) || /[\\\u0000-\u001f\u007f]/.test(path)) throw new FileError('OUTSIDE_ROOT', 'TeX 资源必须是授权目录内的相对路径');
    return filePathSchema.parse(posix.normalize(posix.join(base, path)));
  };
  const add = async (path: string, optional = false): Promise<TexResource | null> => {
    check(); if (files.has(path)) return files.get(path)!;
    let revision: FileRevision;
    try { revision = await source.stat(path, signal); }
    catch (error) { if (optional && error instanceof FileError && error.code === 'MISSING') return null; throw error; }
    check(); if (files.size >= TEX_LIMITS.files || bytes + revision.size > TEX_LIMITS.snapshotBytes) throw new FileError('TOO_LARGE', 'TeX 快照超过 1024 个文件或 128 MiB');
    const file = { path, revision }; files.set(path, file); bytes += revision.size; return file;
  };
  const queue = [{ path: source.path, base: cwd, depth: 0 }];
  const entry = await add(source.path);
  if (!entry || entry.revision.hash !== source.hash) throw new FileError('CHANGED', 'TeX 源码已改变');
  for (let index = 0; index < queue.length; index++) {
    const item = queue[index], parseKey = `${item.base}\0${item.path}`;
    if (parsed.has(parseKey)) continue;
    if (item.depth > TEX_LIMITS.depth) throw new FileError('TOO_LARGE', 'TeX 引用深度超过 32 层');
    parsed.add(parseKey); check();
    const file = files.get(item.path)!;
    if (file.revision.size > TEX_LIMITS.sourceBytes) throw new FileError('TOO_LARGE', 'TeX 源码或本地宏包超过 10 MiB');
    const read = await source.read(item.path, signal); check();
    if (read.hash !== file.revision.hash || read.bytes.byteLength !== file.revision.size) throw new FileError('CHANGED', 'TeX 资源在收集期间改变');
    let text: string; try { text = textDecoder.decode(read.bytes); } catch { throw new FileError('UNSUPPORTED', 'TeX 编译仅接受可识别的 UTF-8 源码；原文件仍保留'); }
    const found = await parse(text, signal); check();
    for (const warning of found.warnings) warnings.add(warning);
    for (const directory of found.graphics) { const path = relative(item.base, directory); graphics.add(path); }
    for (const reference of found.references) for (const name of reference.names) {
      if (++references > TEX_LIMITS.references) throw new FileError('TOO_LARGE', 'TeX 资源引用超过 4096 项');
      const base = reference.directory ? relative(item.base, reference.directory) : item.base;
      const bases = reference.kind === 'image' ? [base, ...graphics] : [base];
      let selected: TexResource | null = null;
      for (const directory of bases) {
        for (const suffix of suffixes[reference.kind]) {
          const candidate = relative(directory, suffix && name.toLowerCase().endsWith(suffix) ? name : name + suffix);
          selected = await add(candidate, true); if (selected) break;
        }
        if (selected) break;
      }
      if (!selected) { if (!reference.optional) warnings.add(`本地资源未找到：${name.slice(0, 160)}`); continue; }
      if (parsedKinds.has(reference.kind)) queue.push({ path: selected.path, base, depth: item.depth + 1 });
    }
  }
  check(); return { entry: source.path, files: [...files.values()], warnings: [...warnings].slice(0, 128), bytes };
}

export async function normalizeTexPdfResources(source: TexSource, snapshot: TexSnapshot, normalize: (bytes: Uint8Array, signal: AbortSignal) => Promise<Uint8Array | null>, signal: AbortSignal): Promise<void> {
  for (const file of snapshot.files) {
    if (!/\.pdf$/i.test(file.path)) continue;
    signal.throwIfAborted(); source.signal.throwIfAborted(); source.assert();
    if (file.revision.size > TEX_LIMITS.outputBytes) throw new FileError('TOO_LARGE', 'TeX PDF 图片超过 40 MiB');
    const read = await source.read(file.path, signal, TEX_LIMITS.outputBytes);
    if (read.hash !== file.revision.hash || read.bytes.byteLength !== file.revision.size) throw new FileError('CHANGED', 'TeX PDF 图片在兼容处理前改变');
    const normalized = await normalize(read.bytes, signal);
    signal.throwIfAborted(); source.signal.throwIfAborted(); source.assert();
    if (!normalized) continue;
    const bytes = snapshot.bytes - file.revision.size + normalized.byteLength;
    if (normalized.byteLength > TEX_LIMITS.outputBytes || bytes > TEX_LIMITS.snapshotBytes) throw new FileError('TOO_LARGE', 'TeX 兼容快照超过大小预算');
    file.normalized = { base64: Buffer.from(normalized).toString('base64'), hash: createHash('sha256').update(normalized).digest('hex'), bytes: normalized.byteLength };
    snapshot.bytes = bytes; snapshot.warnings.push(`已兼容空白 PDF 页面（仅编译副本）：${file.path}`);
  }
}
