import { rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import { bytesFromBase64, bytesToBase64 } from '../file-buffer';
import { readFileResource } from '../resource';
import type { NotebookAsset } from './model';
import { notebookImageSlots, type NotebookClient } from './client';
import { notebookImageData } from './image-data';

export async function notebookAssetUrl(buffer: FileBuffer, load: () => Promise<NotebookAsset>, signal: AbortSignal, presentation: 'host' | 'opaque-frame' = 'host'): Promise<{ url: string; downscaled: boolean }> {
  const release = await notebookImageSlots.acquire(signal); let url = '', id = '';
  const close = () => { if (url) URL.revokeObjectURL(url); release(); if (id) void rpc.files.cancelRaster(id).catch(() => undefined); };
  signal.addEventListener('abort', close, { once: true });
  try {
    signal.throwIfAborted(); const asset = await load(); signal.throwIfAborted(); let bytes: Uint8Array<ArrayBuffer>, mime: string, downscaled = false;
    if (asset.mime === 'image/svg+xml') { bytes = new TextEncoder().encode(asset.data); mime = asset.mime; }
    else {
      id = crypto.randomUUID();
      const result = await rpc.files.raster(buffer.file.ref, { id, baseHash: buffer.file.revision.hash, mime: asset.mime, base64: asset.data });
      bytes = new Uint8Array(bytesFromBase64(result.base64)); mime = 'image/png'; downscaled = result.downscaled;
    }
    signal.throwIfAborted();
    // An opaque srcdoc origin cannot fetch the host's blob:file URL. Only the
    // already bounded raster / sanitized SVG bytes cross into that frame.
    if (presentation === 'opaque-frame') return { url: `data:${mime};base64,${bytesToBase64(bytes)}`, downscaled };
    url = URL.createObjectURL(new Blob([bytes], { type: mime })); return { url, downscaled };
  } catch (error) { signal.removeEventListener('abort', close); close(); throw error; }
}
export async function notebookRelatedImage(buffer: FileBuffer, client: NotebookClient, href: string, signal: AbortSignal): Promise<NotebookAsset> {
  signal.throwIfAborted();
  if (/^data:/i.test(href)) {
    const asset = notebookImageData(href);
    if (asset.mime !== 'image/svg+xml') return asset;
    const data = await client.svg(asset.data); signal.throwIfAborted();
    return { mime: asset.mime, data };
  }
  const file = await rpc.files.related(buffer.file.ref, href);
  try {
    signal.throwIfAborted();
    if (!/\.(?:png|jpe?g|svg)$/i.test(file.name)) throw new Error('此 Notebook 内嵌图片格式暂不能显示');
    if (file.revision.size > 40 * 1024 * 1024) throw new Error('Notebook 图片超过 40 MiB');
    const bytes = await readFileResource(file, rpc.files, signal); signal.throwIfAborted();
    if (/\.svg$/i.test(file.name)) return { mime: 'image/svg+xml', data: await client.svg(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) };
    return { mime: /\.png$/i.test(file.name) ? 'image/png' : 'image/jpeg', data: bytesToBase64(bytes) };
  } finally { await rpc.files.closeDocument(file.ref).catch(() => undefined); }
}
