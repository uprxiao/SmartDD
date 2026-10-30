import { FILE_LIMITS, type FileDocument } from '@shared/files';
import { MEDIA_LIMIT } from '@shared/file-media';
import { bytesFromBase64, bytesToBase64, type FileClient } from '../file-buffer';
import type { FileRef } from '@shared/files';

export interface OwnedMediaResource {
  url: string;
  transport: 'protocol' | 'binary' | 'data-uri';
  release(): void;
}

/** An explicit inline source, separate from a document capability or copy-link metadata. */
export function decodeDataUriMedia(uri: string, signal: AbortSignal): { bytes: Uint8Array<ArrayBuffer>; mime: string; fragment: string } {
  signal.throwIfAborted();
  const comma = uri.indexOf(','), fragment = uri.indexOf('#');
  if (!/^data:/i.test(uri) || comma < 5 || fragment >= 0 && fragment < comma) throw new Error('媒体 data URI 无效');
  const header = uri.slice(5, comma), payload = uri.slice(comma + 1, fragment < 0 ? undefined : fragment);
  // The reference Stl first UTF-8 encodes non-base64 input, then replaces valid
  // %HH byte pairs in place. Invalid percent sequences stay literal; '+' stays '+'.
  const base64 = /;base64/i.test(header);
  if (payload.length > MEDIA_LIMIT * (base64 ? 4 : 3)) throw new Error('媒体超过 128 MiB 读取上限');
  let value = payload, bytes: Uint8Array<ArrayBuffer>;
  if (!base64 || payload.includes('%')) {
    const encoded = new TextEncoder().encode(payload); let end = 0;
    for (let offset = 0; offset < encoded.length; offset++) {
      if (offset % 4096 === 0) signal.throwIfAborted();
      if (encoded[offset] === 37) {
        const pair = String.fromCharCode(encoded[offset + 1] ?? 0, encoded[offset + 2] ?? 0);
        if (/^[\da-f]{2}$/i.test(pair)) { encoded[end++] = Number.parseInt(pair, 16); offset += 2; continue; }
      }
      encoded[end++] = encoded[offset];
    }
    bytes = encoded.slice(0, end);
    if (base64) value = new TextDecoder().decode(bytes);
  } else bytes = new Uint8Array(0);
  if (base64) {
    let digits = 0, padding = 0;
    for (let offset = 0; offset < value.length; offset++) {
      if (offset % 4096 === 0) signal.throwIfAborted();
      const char = value[offset];
      if (/[\t\n\f\r ]/.test(char)) continue;
      digits++; padding = char === '=' ? padding + 1 : 0;
    }
    if (Math.floor(digits * 3 / 4) - padding > MEDIA_LIMIT) throw new Error('媒体超过 128 MiB 读取上限');
    try { bytes = bytesFromBase64(value); }
    catch { throw new Error('媒体 data URI 的 base64 内容无效'); }
  }
  if (bytes.byteLength > MEDIA_LIMIT) throw new Error('媒体超过 128 MiB 读取上限');
  signal.throwIfAborted();
  const mime = uri.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() ?? '';
  return { bytes, mime, fragment: fragment < 0 ? '' : uri.slice(fragment) };
}

export async function saveDataUriMedia(source: { uri: string; name: string; context: FileRef }, api: Pick<FileClient, 'saveContent'>, signal: AbortSignal) {
  const { bytes } = decodeDataUriMedia(source.uri, signal);
  signal.throwIfAborted();
  return api.saveContent({ context: source.context, name: source.name, base64: bytesToBase64(bytes) });
}

export async function openDataUriMediaResource(uri: string, signal: AbortSignal): Promise<OwnedMediaResource> {
  const { bytes, mime, fragment } = decodeDataUriMedia(uri, signal);
  const base = URL.createObjectURL(new Blob([bytes], { type: mime })); let released = false;
  const release = () => { if (released) return; released = true; signal.removeEventListener('abort', release); URL.revokeObjectURL(base); };
  signal.addEventListener('abort', release, { once: true });
  // Conversion is synchronous; the asynchronous return still lets a caller
  // abort/unmount before assignment. That caller releases the owned result.
  return { url: base + fragment, transport: 'data-uri', release };
}

export async function openMediaResource(file: FileDocument, api: Pick<FileClient, 'openMedia' | 'mediaChunk' | 'releaseMedia'>, signal: AbortSignal): Promise<OwnedMediaResource> {
  if (file.revision.size > MEDIA_LIMIT) throw new Error('媒体超过 128 MiB 读取上限');
  signal.throwIfAborted();
  const id = crypto.randomUUID(); let released = false, blob = '';
  const release = () => {
    if (released) return; released = true; signal.removeEventListener('abort', release);
    if (blob) URL.revokeObjectURL(blob);
    void api.releaseMedia(id).catch(() => undefined);
  };
  signal.addEventListener('abort', release, { once: true });
  try {
    const source = await api.openMedia({ id, ref: file.ref, baseHash: file.revision.hash });
    signal.throwIfAborted();
    if (source.id !== id || source.size !== file.revision.size || source.hash !== file.revision.hash || source.size > MEDIA_LIMIT) throw new Error('媒体版本与当前文件不一致');
    if (source.transport === 'protocol') {
      if (!/^willyou-media:\/\/local\/[a-f0-9]{64}$/.test(source.url ?? '')) throw new Error('媒体读取地址无效');
      return { url: source.url!, transport: source.transport, release };
    }
    const bytes = new Uint8Array(source.size);
    for (let offset = 0; offset < bytes.length; offset += FILE_LIMITS.chunk) {
      signal.throwIfAborted();
      const length = Math.min(FILE_LIMITS.chunk, bytes.length - offset), chunk = bytesFromBase64(await api.mediaChunk(id, offset, length));
      signal.throwIfAborted(); if (chunk.length !== length) throw new Error('媒体长度在读取过程中改变'); bytes.set(chunk, offset);
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes); signal.throwIfAborted();
    if ([...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('') !== source.hash) throw new Error('媒体内容在读取过程中改变，请刷新后重试');
    blob = URL.createObjectURL(new Blob([bytes], { type: source.mime }));
    return { url: blob, transport: source.transport, release };
  } catch (error) { release(); throw error; }
}
