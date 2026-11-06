const LIMIT = 256 * 1024 * 1024;
const extensions = { 'image/png':'png', 'image/jpeg':'jpg', 'image/gif':'gif', 'image/webp':'webp', 'image/avif':'avif', 'image/svg+xml':'svg+xml' };

function filename(picture, mime, src) {
  let name = picture.name || picture.path?.split(/[\\/]/).at(-1);
  if (!name && /^https?:/i.test(src)) {
    try { name = decodeURIComponent(new URL(src).pathname.split('/').at(-1)); } catch { /* Use a MIME-based name. */ }
  }
  const extension = extensions[mime.split(';')[0]] || 'png';
  return (name || `图片.${extension === 'svg+xml' ? 'svg' : extension}`).replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '_');
}

/** Explicit save action only. The source host owns resolution and the native
 * save capability. Display URLs do not grant arbitrary file reads or writes. */
export async function downloadImageCopy(picture, { saveContent, resolve, signal }) {
  signal.throwIfAborted();
  if (typeof saveContent !== 'function') throw new Error('图片来源尚未提供保存权限');
  const source = resolve ? await resolve(picture, signal) : picture.downloadSrc || picture.src;
  signal.throwIfAborted();
  if (!source) throw new Error('图片来源为空，无法下载');
  let blob;
  if (source instanceof Blob) blob = source;
  else {
    if (typeof source !== 'string' || !/^(?:https?:|data:|blob:)/i.test(source)) throw new Error('图片来源尚未提供受控读取入口');
    const response = await fetch(source, { signal, credentials:'omit', referrerPolicy:'no-referrer' });
    if (!response.ok) throw new Error(`图片读取失败（${response.status}）`);
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > LIMIT) throw new Error('图片超过 256 MiB 读取上限');
    if (response.body) {
      const reader = response.body.getReader(), chunks = []; let size = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const { done, value } = await reader.read();
          signal.throwIfAborted();
          if (done) break;
          size += value.byteLength;
          if (size > LIMIT) throw new Error('图片超过 256 MiB 读取上限');
          chunks.push(value);
        }
        blob = new Blob(chunks, { type: response.headers.get('content-type') || '' });
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    } else blob = await response.blob();
  }
  if (!blob.size || blob.size > LIMIT) throw new Error('图片内容为空或超过读取上限');
  const bytes = new Uint8Array(await blob.arrayBuffer()); signal.throwIfAborted();
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  // Preserve original bytes (including GIF animation); canvas conversion is
  // never used for a successfully resolved source.
  return saveContent({ name: filename(picture, blob.type, typeof source === 'string' ? source : ''), base64: btoa(binary) }, picture);
}
