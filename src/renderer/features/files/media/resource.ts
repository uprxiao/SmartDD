import { FILE_LIMITS, type FileDocument } from '@shared/files';
import { MEDIA_LIMIT } from '@shared/file-media';
import { bytesFromBase64, type FileClient } from '../file-buffer';

export async function openMediaResource(file: FileDocument, api: Pick<FileClient, 'openMedia' | 'mediaChunk' | 'releaseMedia'>, signal: AbortSignal) {
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
