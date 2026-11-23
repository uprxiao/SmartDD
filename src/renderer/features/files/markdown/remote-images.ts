import { rpc } from '@renderer/lib/ipc';
import { bytesFromBase64, type FileBuffer } from '../file-buffer';
import type { MarkdownRemoteImage } from '@shared/markdown-remote-image';

type RemoteLoader = (image: HTMLImageElement, href: string, signal: AbortSignal) => Promise<void>;
type RemoteImage = { image: HTMLImageElement; href: string };

/** Reuse previously approved image bytes across widget remounts in this document. */
export function createRemoteImageLoader(buffer: FileBuffer): RemoteLoader {
  const cache = new Map<string, MarkdownRemoteImage>();
  let cacheSize = 0;
  return async (image, href, signal) => {
    signal.throwIfAborted();
    let data = cache.get(href);
    if (!data) {
      const id = crypto.randomUUID();
      const cancel = () => { void rpc.files.cancelMarkdownRemoteImage(id).catch(() => undefined); };
      signal.addEventListener('abort', cancel, { once: true });
      try { data = await rpc.files.markdownRemoteImage(buffer.file.ref, { id, href }); }
      finally { signal.removeEventListener('abort', cancel); }
    }
    signal.throwIfAborted();
    const url = URL.createObjectURL(new Blob([bytesFromBase64(data.base64)], { type: data.mime }));
    const release = () => URL.revokeObjectURL(url);
    signal.addEventListener('abort', release, { once: true });
    try {
      image.src = url;
      await image.decode();
      signal.throwIfAborted();
    } catch (error) {
      signal.removeEventListener('abort', release);
      release();
      image.removeAttribute('src');
      throw error;
    }
    if (!cache.has(href)) {
      while (cacheSize + data.base64.length > 8 * 1024 * 1024 && cache.size) {
        const [key, oldest] = cache.entries().next().value!;
        cacheSize -= oldest.base64.length;
        cache.delete(key);
      }
      cacheSize += data.base64.length;
      cache.set(href, data);
    }
  };
}

export function addRemoteImageControl(
  root: HTMLElement, entries: RemoteImage[], load: RemoteLoader, loaded: Set<string>, signal: AbortSignal, measure: () => void,
) {
  if (!entries.length) return;
  const doc = root.ownerDocument;
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'fw-md-load-remote';
  button.textContent = '加载外链图片';
  const images = entries.map(({ image, href }) => {
    image.classList.add('fw-md-external-image');
    image.hidden = true;
    const placeholder = doc.createElement('span');
    placeholder.className = 'fw-md-external-placeholder';
    placeholder.textContent = image.alt || '外链图片';
    image.after(placeholder);
    return { image, href, placeholder };
  });
  root.append(button);
  let busy = false;
  const fetchImages = async (targets: typeof images) => {
    busy = button.disabled = true;
    button.textContent = '正在加载图片';
    let failed = false;
    for (let at = 0; at < targets.length && !signal.aborted; at += 3) {
      await Promise.all(targets.slice(at, at + 3).map(async ({ image, href, placeholder }) => {
        try {
          await load(image, href, signal);
          if (signal.aborted) return;
          loaded.add(href);
          image.hidden = false;
          placeholder.remove();
        } catch {
          if (!signal.aborted) { failed = true; placeholder.title = '外链图片暂时无法加载'; }
        }
      }));
    }
    if (signal.aborted) return;
    busy = button.disabled = false;
    button.hidden = images.every(({ image }) => !image.hidden);
    button.textContent = failed ? '重试外链图片' : '加载外链图片';
    measure();
  };
  button.addEventListener('mousedown', event => event.preventDefault(), { signal });
  button.addEventListener('click', () => {
    if (!busy) void fetchImages(images.filter(({ image }) => image.hidden).slice(0, 12));
  }, { signal });
  const alreadyLoaded = images.filter(({ href }) => loaded.has(href));
  if (alreadyLoaded.length) void fetchImages(alreadyLoaded);
}
