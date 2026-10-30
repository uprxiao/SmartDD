import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import { readFileResource } from '../resource';
import type { FileDocument } from '@shared/files';

export interface MarkdownImageSource {
  href: string; src: string; alt: string; name: string; path: string;
  hash: string; mime: string; animated: boolean;
}
export function requireLocalMarkdownImage(href: string): void {
  if (/^[a-z][\w+.-]*:|^\/\//i.test(href)) throw new Error('远程或私有图片来源尚未适配，未读取或下载该资源');
}
export function requireMarkdownImage(document: FileDocument | null | undefined): string {
  if (!document) throw new Error('无法打开图片：图片来源为空，请重新读取后重试');
  if (document.content?.kind !== 'image' || !/\.(png|jpe?g|gif|webp|avif|bmp|ico|svg)$/i.test(document.name)) throw new Error('文档引用不是受支持的图像');
  return document.content.mime ?? 'application/octet-stream';
}

export async function loadMarkdownImage(buffer: FileBuffer, element: HTMLImageElement, href: string, signal: AbortSignal): Promise<MarkdownImageSource> {
  signal.throwIfAborted();
  requireLocalMarkdownImage(href);
  // Remote URLs are never fetched implicitly by document HTML. Actual local
  // bytes must pass the same root, revision and size checks as a tree image.
  const document = await rpc.files.related(buffer.file.ref, href);
  try {
    signal.throwIfAborted();
    const mime = requireMarkdownImage(document);
    const bytes = await readFileResource(document, rpc.files, signal);
    signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    signal.addEventListener('abort', () => URL.revokeObjectURL(url), { once: true });
    element.src = url; element.dataset.filePath = document.absolutePath;
    return { href, src: url, alt: element.alt || document.name, name: document.name, path: document.absolutePath, hash: document.revision.hash, mime, animated: mime === 'image/gif' };
  } finally { if (document?.ref) await rpc.files.closeDocument(document.ref).catch(() => undefined); }
}

/** Every action reacquires its source and rejects a changed image, never using
 * a closed document capability or exporting different bytes than the preview. */
export async function withMarkdownImage<T>(buffer: FileBuffer, image: MarkdownImageSource, signal: AbortSignal, run: (file: FileDocument) => Promise<T>): Promise<T> {
  signal.throwIfAborted(); requireLocalMarkdownImage(image.href);
  const file = await rpc.files.related(buffer.file.ref, image.href);
  try {
    signal.throwIfAborted(); requireMarkdownImage(file);
    if (file.revision.hash !== image.hash || file.absolutePath !== image.path) throw new Error('图片内容或来源已改变，请关闭预览后重新打开');
    return await run(file);
  } finally { if (file?.ref) await rpc.files.closeDocument(file.ref).catch(() => undefined); }
}
