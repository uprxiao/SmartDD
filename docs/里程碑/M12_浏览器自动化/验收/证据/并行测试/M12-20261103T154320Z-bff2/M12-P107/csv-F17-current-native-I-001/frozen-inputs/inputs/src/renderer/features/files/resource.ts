import { FILE_LIMITS, type FileDocument } from '@shared/files';
import { bytesFromBase64, type FileClient } from './file-buffer';

/** Resources use bounded, revision-bound chunks. A final content hash rejects
 * mixed snapshots; viewer disposal prevents any late bytes becoming visible. */
export async function readFileResource(file: FileDocument, api: Pick<FileClient, 'chunk'> & Partial<Pick<FileClient, 'cancelResource'>>, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  if (file.revision.size > FILE_LIMITS.asset) throw new Error('文件超过 256 MiB 资源上限');
  signal.throwIfAborted();
  const requestId = crypto.randomUUID(), cancel = () => { void api.cancelResource?.(requestId).catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
  const bytes = new Uint8Array(file.revision.size);
  for (let offset = 0; offset < bytes.length; offset += FILE_LIMITS.chunk) {
    signal.throwIfAborted();
    const size = Math.min(FILE_LIMITS.chunk, bytes.length - offset);
    const chunk = bytesFromBase64(await api.chunk(file.ref, offset, size, file.revision.hash, requestId));
    signal.throwIfAborted();
    if (chunk.byteLength !== size) throw new Error('文件长度在读取过程中改变');
    bytes.set(chunk, offset);
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  signal.throwIfAborted();
  const hash = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  if (hash !== file.revision.hash) throw new Error('文件内容在读取过程中改变，请刷新后重试');
  return bytes;
  } finally { signal.removeEventListener('abort', cancel); }
}
