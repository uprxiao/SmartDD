import { SaxesParser } from 'saxes';

const escape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
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
