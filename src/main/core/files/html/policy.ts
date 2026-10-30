import { HTML_LIMITS, HTML_SCHEME, type HtmlViewBounds } from '@shared/file-html';
import { mediaRange } from '../media-service';
import { htmlDocumentURL, type HtmlResource } from './resources';

export function htmlHeaders(origin: string, mime: string): Record<string, string> {
  return {
    'Content-Type': `${mime}${/^text\//.test(mime) ? '; charset=utf-8' : ''}`,
    'Content-Security-Policy': `default-src 'none'; script-src ${origin} 'unsafe-inline'; style-src ${origin} 'unsafe-inline'; img-src ${origin} data: blob:; font-src ${origin}; media-src ${origin} blob:; connect-src 'none'; frame-src 'none'; child-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox allow-scripts`,
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), clipboard-write=(), payment=(), usb=(), serial=(), hid=(), fullscreen=()',
    'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    // CSP sandbox makes the document opaque. Modules can read only this already
    // registered snapshot; connect-src still disallows fetch/XHR/WebSocket.
    'Access-Control-Allow-Origin': 'null', 'Accept-Ranges': 'bytes',
  };
}
export function htmlLookup(url: string, origin: string, resources: Map<string, HtmlResource>): HtmlResource | undefined {
  try {
    const value = new URL(url);
    if (value.protocol !== `${HTML_SCHEME}:` || `${value.protocol}//${value.host}` !== origin || value.username || value.password) return;
    return resources.get(htmlDocumentURL(value.hostname, decodeURIComponent(value.pathname.slice(1))));
  } catch { return; }
}
export function htmlRequestType(type: string, resource: HtmlResource, entry: string, firstDocument: boolean): boolean {
  if (type === 'mainFrame') return firstDocument && resource.url === entry;
  return type === 'script' ? resource.mime === 'text/javascript' : type === 'stylesheet' ? resource.mime === 'text/css' : type === 'image' ? resource.mime.startsWith('image/') : type === 'font' ? resource.mime.startsWith('font/') : type === 'media' ? /^(audio|video)\//.test(resource.mime) || resource.mime === 'text/vtt' : false;
}
export function htmlBounds(input: HtmlViewBounds, width: number, height: number, zoom: number) {
  const x = Math.max(0, Math.min(width, Math.round(input.x * zoom))), y = Math.max(0, Math.min(height, Math.round(input.y * zoom)));
  const right = Math.max(x, Math.min(width, Math.round((input.x + input.width) * zoom))), bottom = Math.max(y, Math.min(height, Math.round((input.y + input.height) * zoom)));
  return { x, y, width: right - x, height: bottom - y };
}

/** A snapshot is revoked together with its view. Back pressure keeps responses
 * from duplicating every resource into queued stream chunks at once. */
export class HtmlResponses {
  private readers = 0;
  constructor(private readonly origin: string, private readonly resources: Map<string, HtmlResource>, private readonly signal: AbortSignal) {}
  handle(request: Request): Response {
    const resource = htmlLookup(request.url, this.origin, this.resources);
    if (this.signal.aborted || !resource || !['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 404 });
    const range = mediaRange(request.headers.get('Range'), resource.bytes.length), headers = htmlHeaders(this.origin, resource.mime);
    if (!range) return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${resource.bytes.length}` } });
    headers['Content-Length'] = String(range.end - range.start + 1);
    if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${resource.bytes.length}`;
    if (request.method === 'HEAD' || !resource.bytes.length) return new Response(null, { status: range.partial ? 206 : 200, headers });
    if (this.readers >= HTML_LIMITS.readers) return new Response(null, { status: 429 });
    this.readers++; let offset = range.start, done = false;
    const release = () => { if (!done) { done = true; this.readers--; this.signal.removeEventListener('abort', abort); } };
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const abort = () => { if (!done) { controller.error(new Error('HTML文档已关闭')); release(); } };
    const stream = new ReadableStream<Uint8Array>({
      start: (value) => { controller = value; this.signal.addEventListener('abort', abort, { once: true }); if (this.signal.aborted) abort(); },
      pull: (value) => {
        if (done) return;
        const end = Math.min(range.end + 1, offset + 64 * 1024); value.enqueue(resource.bytes.slice(offset, end)); offset = end;
        if (offset > range.end) { value.close(); release(); }
      }, cancel: release,
    }, { highWaterMark: 0 });
    return new Response(stream, { status: range.partial ? 206 : 200, headers });
  }
}
