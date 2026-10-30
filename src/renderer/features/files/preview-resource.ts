import { FILE_LIMITS, type FileDocument } from '@shared/files';
import { FILE_IMAGE_LIMIT, FILE_RESOURCE_SCHEME } from '@shared/file-resource';
import type { FileClient } from './file-buffer';

type PreviewClient = Pick<FileClient, 'openResource' | 'releaseResource'>;
const digest = async (bytes: Uint8Array<ArrayBuffer>) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');

/** The grant lasts only for this active preview. No shared-origin Blob URL or
 * arbitrary path fallback is issued when the protected protocol is unavailable. */
export async function openPreviewResource(file: FileDocument, api: PreviewClient, signal: AbortSignal) {
  const limit = file.content?.kind === 'pdf' ? FILE_LIMITS.asset : FILE_IMAGE_LIMIT;
  if (file.revision.size > limit) throw new Error('文件超过预览资源读取上限');
  signal.throwIfAborted();
  const id = crypto.randomUUID(); let released = false;
  const release = () => {
    if (released) return; released = true; signal.removeEventListener('abort', release);
    void api.releaseResource(id).catch(() => undefined);
  };
  signal.addEventListener('abort', release, { once: true });
  try {
    const source = await api.openResource({ id, ref: file.ref, baseHash: file.revision.hash });
    signal.throwIfAborted();
    if (source.id !== id || source.hash !== file.revision.hash || source.size !== file.revision.size || source.mime !== file.content?.mime || source.transport !== 'protocol' || !new RegExp(`^${FILE_RESOURCE_SCHEME}://local/[a-f0-9]{64}$`).test(source.url ?? '')) throw new Error('预览资源版本或读取地址无效');
    return { url: source.url!, release };
  } catch (error) { release(); throw error; }
}

/** PDF still receives verified bytes rather than an authored URL. Its internal
 * URL is minted by main and checked against the initiating window on every read. */
export async function readPreviewResource(file: FileDocument, api: PreviewClient, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
  const source = await openPreviewResource(file, api, signal);
  try {
    const response = await fetch(source.url, { signal, credentials: 'omit', cache: 'no-store' });
    if (!response.ok || response.headers.get('Content-Length') !== String(file.revision.size) || !response.body) throw new Error('无法读取当前版本的预览资源');
    const bytes = new Uint8Array(file.revision.size), reader = response.body.getReader(); let offset = 0;
    try {
      for (;;) {
        signal.throwIfAborted(); const next = await reader.read(); signal.throwIfAborted();
        if (next.done) break;
        if (offset + next.value.length > bytes.length) { await reader.cancel(); throw new Error('预览资源超过已核验长度'); }
        bytes.set(next.value, offset); offset += next.value.length;
      }
    } finally { reader.releaseLock(); }
    if (offset !== bytes.length || await digest(bytes) !== file.revision.hash) throw new Error('预览资源内容已改变，请刷新后重试');
    signal.throwIfAborted(); return bytes;
  } catch (error) { source.release(); throw error; }
}
