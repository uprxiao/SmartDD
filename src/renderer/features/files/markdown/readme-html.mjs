import { parseFragment } from 'parse5';

const allowed = new Set('a b blockquote br caption code dd del div dl dt em figcaption figure h1 h2 h3 h4 h5 h6 hr i img li ol p picture pre s small span strong sub sup table tbody td tfoot th thead tr u ul'.split(' '));
const discarded = new Set('button embed form iframe input link math meta noscript object script select style svg template textarea video audio'.split(' '));
const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attribute = (node, key) => node.attrs?.find(value => value.name === key && !value.namespace)?.value ?? '';

function reference(value, image = false) {
  value = value.trim();
  if (!value || value.length > 8192 || /[\u0000-\u001f\u007f\\]/.test(value) || value.startsWith('//')) return '';
  if (!/^[a-z][\w+.-]*:/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (!url.username && !url.password && (url.protocol === 'https:' || !image && url.protocol === 'http:')) return value;
  } catch { /* Malformed authored link. */ }
  return '';
}

function darkSource(children) {
  for (const node of children) {
    if (node.tagName !== 'source' || !/^\(\s*prefers-color-scheme\s*:\s*dark\s*\)$/i.test(attribute(node, 'media').trim())) continue;
    const src = attribute(node, 'srcset').trim();
    if (!/[\s,]/.test(src) && reference(src, true)) return src;
  }
  return '';
}

/** Serialize a fixed vocabulary. Authored attributes never become DOM URLs. */
export function renderReadmeHtml(source) {
  function render(node, depth = 0, dark = '') {
    if (node.nodeName === '#text') return escape(node.value);
    if (!node.tagName || node.namespaceURI !== 'http://www.w3.org/1999/xhtml' || depth > 64 || discarded.has(node.tagName)) return '';
    const tag = node.tagName;
    const renderChildren = fallback => node.childNodes.map(child => render(child, depth + 1, fallback)).join('');
    if (!allowed.has(tag)) return renderChildren('');
    const attrs = [];
    const add = (key, value) => { if (value) attrs.push(` ${key}="${escape(value)}"`); };
    const align = attribute(node, 'align').toLowerCase();
    if (['p', 'div', 'td', 'th'].includes(tag) && ['left', 'center', 'right'].includes(align)) add('align', align);
    for (const key of tag === 'img' ? ['width', 'height'] : tag === 'td' || tag === 'th' ? ['width', 'rowspan', 'colspan'] : []) {
      const value = attribute(node, key);
      if (/^[1-9]\d{0,3}$/.test(value) && Number(value) <= 4096) add(key, value);
    }
    if (tag === 'img') {
      const src = reference(attribute(node, 'src'), true);
      const alt = attribute(node, 'alt').slice(0, 1024);
      if (!src) return escape(alt);
      add('alt', alt);
      add('data-md-src', src);
      add('data-md-src-dark', dark);
      return `<img${attrs.join('')}>`;
    }
    if (tag === 'a') {
      const href = reference(attribute(node, 'href'));
      if (!href) return renderChildren('');
      add('href', '#');
      add('data-md-href', href);
    }
    if (tag === 'br' || tag === 'hr') return `<${tag}>`;
    return `<${tag}${attrs.join('')}>${renderChildren(tag === 'picture' ? darkSource(node.childNodes) : '')}</${tag}>`;
  }
  const result = parseFragment(source).childNodes.map(node => render(node)).join('');
  return result.trim() ? result : escape(source);
}
