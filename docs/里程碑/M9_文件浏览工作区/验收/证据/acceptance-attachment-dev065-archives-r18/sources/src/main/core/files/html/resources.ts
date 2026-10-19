import { HTML_LIMITS, HTML_SCHEME } from '@shared/file-html';
import type { HtmlReferences, ReferenceKind } from './references';

const types: Record<string, string> = { css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', cjs: 'text/javascript', json: 'application/json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', webp: 'image/webp', avif: 'image/avif', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', vtt: 'text/vtt' };
export interface HtmlResource { url: string; path: string; mime: string; bytes: Uint8Array<ArrayBuffer> }
export interface HtmlSource {
  path: string; hash: string; signal: AbortSignal;
  /** Main-derived from a readonly document's actual text classification. */
  attachmentHtml?: boolean;
  assert(): void;
  read(path: string, limit: number, signal: AbortSignal): Promise<{ bytes: Uint8Array<ArrayBuffer>; hash: string }>;
}
export function htmlDocumentURL(token: string, path: string): string {
  if (!/^[a-f0-9]{64}$/.test(token) || !path || path.startsWith('/') || path.split('/').some((part) => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f\\]/.test(path)) throw new Error('HTML文档路径无效');
  return `${HTML_SCHEME}://${token}/${path.split('/').map(encodeURIComponent).join('/')}`;
}
export function htmlResourceURL(href: string, base: string, token: string): { url: string; path: string; mime: string; kind?: ReferenceKind } | null {
  if (href.startsWith('#') || /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml)[;,]/i.test(href)) return null;
  if (href.length > 32768 || /[\u0000-\u001f\u007f\\]/.test(href)) throw new Error('资源路径含无效字符');
  const url = new URL(href, base);
  if (url.protocol !== `${HTML_SCHEME}:` || url.hostname !== token || url.port || url.username || url.password) throw new Error('外部资源未加载');
  let path: string;
  try { path = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error('资源路径编码无效'); }
  if (!path || /[\u0000-\u001f\u007f\\]/.test(path) || path.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('资源路径超出本地映射');
  const extension = path.split('/').at(-1)!.split('.').at(-1)!.toLowerCase(), mime = types[extension];
  if (!mime) throw new Error('资源类型未开放');
  return { url: htmlDocumentURL(token, path), path, mime, ...(extension === 'css' ? { kind: 'css' as const } : ['js', 'mjs', 'cjs'].includes(extension) ? { kind: 'script' as const } : {}) };
}
function text(bytes: Uint8Array, units: number): string {
  let raw: string; try { raw = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { throw new Error('文档资源无法按UTF-8读取'); }
  if (raw.length > units) throw new Error('HTML文档超过5,000,000字符预览上限；可查看源码');
  return raw;
}
export async function buildHtmlResources(source: HtmlSource, token: string, parse: (raw: string, kind: ReferenceKind) => Promise<HtmlReferences>, signal: AbortSignal) {
  const check = () => { signal.throwIfAborted(); source.signal.throwIfAborted(); source.assert(); }, warnings: string[] = [], resources = new Map<string, HtmlResource>();
  const warn = (message: string) => { if (warnings.length < 20) warnings.push(message); };
  check(); let entry: Awaited<ReturnType<HtmlSource['read']>>;
  try { entry = await source.read(source.path, HTML_LIMITS.sourceBytes, signal); }
  catch (error) { check(); if (error && typeof error === 'object' && 'code' in error && error.code === 'TOO_LARGE') throw new Error('HTML文档超过10 MiB预览上限；可查看源码'); throw error; }
  check();
  if (entry.bytes.length > HTML_LIMITS.sourceBytes) throw new Error('HTML文档超过10 MiB预览上限；可查看源码');
  if (entry.hash !== source.hash) throw new Error('HTML文档在读取期间改变，请重试');
  const raw = text(entry.bytes, HTML_LIMITS.sourceUnits), url = htmlDocumentURL(token, source.path);
  resources.set(url, { url, path: source.path, mime: 'text/html', bytes: entry.bytes });
  const queue = [{ url, raw, kind: 'html' as ReferenceKind, depth: 0 }]; let bytes = entry.bytes.length;
  const attempted = new Set<string>();
  while (queue.length) {
    check(); const item = queue.shift()!, parsed = await parse(item.raw, item.kind); check(); parsed.warnings.forEach(warn);
    for (const href of parsed.references) {
      check(); let target: ReturnType<typeof htmlResourceURL>;
      try { target = htmlResourceURL(href, item.url, token); } catch (error) { warn(error instanceof Error ? error.message : '资源无法映射'); continue; }
      if (!target || resources.has(target.url) || attempted.has(target.url)) continue;
      attempted.add(target.url);
      if (attempted.size > HTML_LIMITS.resources) throw new Error('HTML资源超过128项预览上限');
      if (item.depth >= HTML_LIMITS.depth) throw new Error('HTML资源依赖超过8层预览上限');
      let result: Awaited<ReturnType<HtmlSource['read']>>;
      try { result = await source.read(target.path, HTML_LIMITS.assetBytes, signal); }
      catch (error) { check(); if (error && typeof error === 'object' && 'code' in error && error.code === 'TOO_LARGE') throw new Error('HTML单项资源超过8 MiB预览上限'); warn('本地资源不可读取'); continue; }
      check();
      if (result.bytes.length > HTML_LIMITS.assetBytes) throw new Error('HTML单项资源超过8 MiB预览上限');
      bytes += result.bytes.length; if (bytes > HTML_LIMITS.totalBytes) throw new Error('HTML资源合计超过40 MiB预览上限');
      resources.set(target.url, { ...target, bytes: result.bytes });
      if (target.kind) {
        try { queue.push({ url: target.url, raw: text(result.bytes, HTML_LIMITS.sourceUnits), kind: target.kind, depth: item.depth + 1 }); }
        catch { warn('部分文本资源编码或长度不支持'); resources.delete(target.url); }
      }
    }
  }
  check(); return { url, resources, warnings, bytes };
}
