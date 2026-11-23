import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
export { safeSvg } from '@shared/safe-image-svg';
type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const element = (node: Node): node is Element => 'tagName' in node;
const allowed = new Set('a abbr b blockquote br caption code col colgroup dd del details div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img li mark ol p pre s small span strong sub summary sup table tbody td th thead tr u ul style'.split(' '));
const removed = new Set('script iframe object embed form input button select textarea meta base link template svg math audio video source'.split(' '));
const voidTags = new Set(['br', 'col', 'hr', 'img']);
const safeCss = (value: string) => value.length <= 65536 && !/(?:url|image-set|@import|@font-face|expression|behavior|binding|\\)/i.test(value);
export const NOTEBOOK_CSP = "default-src 'none'; base-uri 'none'; connect-src 'none'; font-src 'none'; form-action 'none'; frame-src 'none'; img-src data:; object-src 'none'; script-src 'none'; style-src 'unsafe-inline'";
export interface HtmlPage { html: string; assets: string[] }

/** Parse off the UI thread, before any browser DOM exists. Split the sanitized
 * tree into bounded fragments, reopening ancestors at each boundary. Every
 * original text node remains reachable; raw output is independently pageable. */
export function htmlPages(source: string, addAsset: (dataUrl: string) => string): HtmlPage[] {
  const root = parseFragment(source), pages: HtmlPage[] = [], ancestors: { open: string; close: string }[] = [];
  let html = '', assets: string[] = [], nodes = 0, textLength = 0;
  const flush = () => {
    if (html) pages.push({ html: html + ancestors.map((item) => item.close).reverse().join(''), assets });
    html = ancestors.map((item) => item.open).join(''); assets = []; nodes = ancestors.length; textLength = 0;
  };
  const ensure = (size: number, asset = false) => { if (nodes >= 400 || textLength + size > 32768 || html.length + size > 131072 || asset && assets.length >= 2) flush(); };
  const visit = (node: Node, depth: number) => {
    if (node.nodeName === '#text' && 'value' in node) {
      for (let offset = 0; offset < node.value.length; offset += 16384) { const value = node.value.slice(offset, offset + 16384); ensure(value.length); html += escape(value); textLength += value.length; }
      return;
    }
    if (!element(node)) return;
    const tag = node.tagName.toLowerCase(); if (removed.has(tag)) return;
    if (depth > 64 || !allowed.has(tag)) { for (const child of node.childNodes) visit(child, depth); return; }
    if (tag === 'style') {
      const css = node.childNodes.filter((child): child is DefaultTreeAdapterMap['textNode'] => child.nodeName === '#text').map((child) => child.value).join('');
      if (safeCss(css)) { ensure(css.length); html += `<style>${css.replace(/<\//g, '<\\/')}</style>`; nodes++; textLength += css.length; }
      return;
    }
    const attrs: string[] = []; let asset: string | undefined;
    for (const attr of node.attrs) {
      if (attr.namespace || attr.value.length > 4096 && attr.name !== 'src') continue;
      if (['class', 'title', 'alt', 'width', 'height', 'colspan', 'rowspan', 'open'].includes(attr.name) || attr.name === 'style' && safeCss(attr.value)) attrs.push(`${attr.name}="${escape(attr.value)}"`);
      else if (tag === 'img' && attr.name === 'src' && /^data:image\/(?:png|jpeg|svg\+xml)(?:;base64)?,/i.test(attr.value)) asset = addAsset(attr.value);
    }
    if (asset) attrs.push(`data-notebook-asset="${escape(asset)}"`);
    const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`, close = voidTags.has(tag) ? '' : `</${tag}>`;
    ensure(open.length, Boolean(asset)); if (asset) assets.push(asset); html += open; nodes++;
    if (!close) return;
    ancestors.push({ open, close }); for (const child of node.childNodes) visit(child, depth + 1); ancestors.pop(); html += close;
  };
  for (const node of root.childNodes) visit(node, 0); flush();
  return pages.length ? pages : [{ html: '', assets: [] }];
}

export function frameDocument(html: string, assets: Record<string, string>): string {
  // This map contains host-generated image bytes, never original output URLs.
  const mapped = html.replace(/data-notebook-asset="([^"]+)"/g, (_match, key: string) => /^data:image\/(?:png|jpeg|svg\+xml);base64,[A-Za-z0-9+/]+={0,2}$/.test(assets[key] ?? '') ? `src="${escape(assets[key])}"` : 'alt="图像正在等待显示"');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${NOTEBOOK_CSP}"><meta name="color-scheme" content="light dark"><style>body{margin:0;padding:12px;font:13px system-ui;color:CanvasText;background:transparent;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #8885;padding:4px 6px}pre{white-space:pre-wrap}</style></head><body>${mapped}</body></html>`;
}
