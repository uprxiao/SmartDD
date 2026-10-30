import { parseFragment, type DefaultTreeAdapterMap } from 'parse5';
import { SaxesParser } from 'saxes';
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

const svgTags = new Set('svg g path rect circle ellipse line polyline polygon text tspan defs linearGradient radialGradient stop clipPath mask title desc'.toLowerCase().split(' '));
const svgAttrs = new Set('id x y x1 y1 x2 y2 cx cy r rx ry width height viewBox d points fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin opacity transform gradientTransform gradientUnits offset stop-color stop-opacity font-family font-size font-weight text-anchor dominant-baseline clip-path clip-rule mask'.toLowerCase().split(' '));
export function safeSvg(source: string): string {
  const parser = new SaxesParser({ xmlns: true }), output: string[] = [];
  let count = 0, length = 0, depth = 0, blocked = 0, rootSeen = false;
  const append = (value: string) => { length += value.length; if (length > 2 * 1024 * 1024) throw new Error('SVG 输出超过预览预算'); output.push(value); };
  parser.on('error', () => { throw new Error('SVG XML 结构无效'); });
  parser.on('doctype', () => { throw new Error('SVG 预览不允许 DTD 或外部实体'); });
  parser.on('opentag', (node) => {
    depth++;
    if (depth > 64 || ++count > 5000) throw new Error('SVG 输出过于复杂，可查看或下载原始文档');
    if (depth === 1) { if (node.local !== 'svg') throw new Error('SVG 输出无效'); rootSeen = true; }
    if (blocked || !svgTags.has(node.local.toLowerCase()) || node.uri && node.uri !== 'http://www.w3.org/2000/svg') { if (!blocked) blocked = depth; return; }
    const original = Object.values(node.attributes);
    const attrs = original.filter((a) => !a.prefix && svgAttrs.has(a.local.toLowerCase()) && a.value.length < 1048576 && !/(?:https?:|data:|javascript:|\\)/i.test(a.value) && (!/url/i.test(a.value) || /^url\(#[\w-]+\)$/.test(a.value))).map((a) => `${a.local}="${escape(a.value)}"`);
    if (depth === 1) {
      const attr = (name: string) => original.find((a) => a.local.toLowerCase() === name)?.value;
      const view = attr('viewbox'), width = parseFloat(attr('width') ?? '') || 300, height = parseFloat(attr('height') ?? '') || 150;
      const size = view?.trim().split(/[ ,]+/).map(Number), w = size?.length === 4 && size[2] > 0 ? size[2] : width, h = size?.length === 4 && size[3] > 0 ? size[3] : height;
      if (![w, h].every((n) => Number.isFinite(n) && n > 0)) throw new Error('SVG 尺寸无效');
      const factor = Math.min(1, 2048 / Math.max(w, h));
      for (let i = attrs.length - 1; i >= 0; i--) if (/^(width|height)=/.test(attrs[i])) attrs.splice(i, 1);
      attrs.push('xmlns="http://www.w3.org/2000/svg"', `width="${Math.max(1, Math.floor(w * factor))}"`, `height="${Math.max(1, Math.floor(h * factor))}"`);
      if (!view) attrs.push(`viewBox="0 0 ${w} ${h}"`);
    }
    append(`<${node.local} ${attrs.join(' ')}>`);
  });
  parser.on('closetag', (node) => { if (!blocked) append(`</${node.local}>`); if (blocked === depth) blocked = 0; depth--; });
  const content = (value: string) => { if (depth && !blocked) append(escape(value)); };
  parser.on('text', content); parser.on('cdata', content);
  parser.write(source).close(); if (!rootSeen) throw new Error('SVG 输出无效'); return output.join('');
}
