import { FileError } from '@shared/files';
import { VIEWER_LIMITS, type ViewerResource } from '@shared/file-viewer';
import { createHash } from 'node:crypto';

export function requireResourceUri(actual: unknown, expected: string): void {
  // Deliberately no URL canonicalization, fragment removal or prefix matching.
  if (typeof actual !== 'string' || actual !== expected) throw new FileError('UNTRUSTED', '扩展只可访问当前会话的精确资源 URI');
}
export function decodeViewerResource(result: unknown, uri: string): ViewerResource {
  const contents = (result as { contents?: unknown[] })?.contents;
  if (!Array.isArray(contents) || contents.length !== 1) throw new FileError('INVALID_INPUT', '扩展需要返回单一资源');
  const value = contents[0] as Record<string, unknown>; requireResourceUri(value?.uri, uri);
  if ((typeof value.text === 'string') === (typeof value.blob === 'string')) throw new FileError('INVALID_INPUT', '扩展资源必须恰有 text 或 blob');
  let bytes: Buffer;
  if (typeof value.text === 'string') bytes = Buffer.from(value.text, 'utf8');
  else {
    if (typeof value.blob !== 'string' || value.blob.length > VIEWER_LIMITS.frameBytes) throw new FileError('TOO_LARGE', '扩展资源超过 20 MiB');
    bytes = Buffer.from(value.blob, 'base64');
    if (bytes.toString('base64') !== value.blob) throw new FileError('INVALID_INPUT', '扩展资源 Base64 无效');
  }
  if (bytes.length > VIEWER_LIMITS.resourceBytes) throw new FileError('TOO_LARGE', '扩展资源超过 20 MiB');
  return { uri, base64: bytes.toString('base64'), bytes: bytes.length, mimeType: typeof value.mimeType === 'string' ? value.mimeType : 'application/octet-stream', etag: createHash('sha256').update(bytes).digest('hex') };
}
export class ViewerNotificationBudget {
  private start = 0; private count = 0; dropped = 0;
  accept(now = Date.now()): boolean {
    if (now - this.start >= 1000) { this.start = now; this.count = 0; }
    if (++this.count <= VIEWER_LIMITS.notificationsPerSecond) return true;
    this.dropped++; return false;
  }
}
