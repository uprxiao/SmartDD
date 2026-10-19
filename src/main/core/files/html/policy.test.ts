import { describe, expect, it } from 'vitest';
import { htmlBounds, htmlHeaders, htmlLookup, htmlRequestType, HtmlResponses } from './policy';
import { htmlDocumentURL, type HtmlResource } from './resources';

const token = 'a'.repeat(64), origin = `willyou-document://${token}`, url = htmlDocumentURL(token, 'docs/中文 a.html');
function fixture(size = 140000) {
  const abort = new AbortController(), resource: HtmlResource = { url, path: 'docs/中文 a.html', mime: 'text/html', bytes: new Uint8Array(size).fill(42) }, resources = new Map([[url, resource]]);
  return { abort, resource, resources, responses: new HtmlResponses(origin, resources, abort.signal) };
}
describe('HTML document protocol policy', () => {
  it('matches only the issued origin and mapped path, including equivalent UTF-8 URL escapes', () => {
    const f = fixture(); expect(htmlLookup(url.replaceAll('%E', '%e') + '?revision=1#x', origin, f.resources)).toBe(f.resource);
    for (const bad of [url.replace(token, 'b'.repeat(64)), url.replace('willyou-document:', 'file:'), `${origin}/docs/secret.html`, `${origin}/docs/%00.html`, url.replace(`${token}/`, `user@${token}/`)]) expect(htmlLookup(bad, origin, f.resources)).toBeUndefined();
    expect(htmlRequestType('mainFrame', f.resource, url, true)).toBe(true); expect(htmlRequestType('mainFrame', f.resource, url, false)).toBe(false);
    for (const type of ['subFrame', 'xhr', 'ping', 'webSocket', 'other', 'script', 'image']) expect(htmlRequestType(type, f.resource, url, true)).toBe(false);
    expect(htmlRequestType('script', { ...f.resource, mime: 'text/javascript' }, url, false)).toBe(true);
  });
  it('sends an opaque sandbox CSP without Node/main-frame privileges or network capabilities', () => {
    const headers = htmlHeaders(origin, 'text/html'), csp = headers['Content-Security-Policy'];
    expect(csp).toContain('sandbox allow-scripts'); expect(csp).not.toContain('allow-same-origin'); expect(csp).not.toContain('unsafe-eval');
    for (const directive of ['connect-src', 'frame-src', 'object-src', 'worker-src', 'base-uri', 'form-action']) expect(csp).toContain(`${directive} 'none'`);
    expect(headers['Access-Control-Allow-Origin']).toBe('null'); expect(headers['Cache-Control']).toBe('no-store');
  });
  it('streams exact bytes and ranges with bounded readers and revokes existing streams on close', async () => {
    const f = fixture(), response = f.responses.handle(new Request(url));
    const reader = response.body!.getReader(); expect((await reader.read()).value?.length).toBe(65536); await reader.cancel();
    const range = f.responses.handle(new Request(url, { headers: { Range: 'bytes=10-29' } }));
    expect(range.status).toBe(206); expect(range.headers.get('Content-Range')).toBe('bytes 10-29/140000'); expect(new Uint8Array(await range.arrayBuffer())).toEqual(f.resource.bytes.slice(10, 30));
    const head = f.responses.handle(new Request(url, { method: 'HEAD' })); expect(head.headers.get('Content-Length')).toBe('140000'); expect(await head.text()).toBe('');
    expect(f.responses.handle(new Request(url, { headers: { Range: 'bytes=140000-' } })).status).toBe(416);
    expect(f.responses.handle(new Request(url, { method: 'POST' })).status).toBe(404);
    const pending = Array.from({ length: 8 }, () => f.responses.handle(new Request(url))); expect(f.responses.handle(new Request(url)).status).toBe(429);
    await pending.pop()!.body!.cancel(); const resumed = f.responses.handle(new Request(url)); expect(resumed.status).toBe(200);
    f.abort.abort(); await expect(resumed.arrayBuffer()).rejects.toThrow('已关闭'); expect(f.responses.handle(new Request(url)).status).toBe(404);
    await Promise.all(pending.map((value) => value.arrayBuffer().catch(() => undefined)));
  });
  it('clamps viewport bounds after zoom without extending into native window chrome', () => {
    const base = { id: 'x', visible: true, x: -20, y: 30, width: 600, height: 900 };
    expect(htmlBounds(base, 700, 600, 1.5)).toEqual({ x: 0, y: 45, width: 700, height: 555 });
    expect(htmlBounds({ ...base, x: 900 }, 700, 600, 1)).toEqual({ x: 700, y: 30, width: 0, height: 570 });
  });
});
