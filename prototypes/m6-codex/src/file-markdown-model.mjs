// Markdown interaction model. markdown-it supplies the CommonMark tokens and line maps; source text stays authoritative
// and each top-level block keeps exact UTF-16 offsets, so an edit replaces only that block's bytes.
import MarkdownIt from 'markdown-it';
import { installDollarMath } from '../../../src/shared/markdown-dollar-math.mjs';
import yaml from 'js-yaml';
import { highlightCode } from './file-highlight.mjs';
import { installInlineSourceTracking, attachInlineSource, sourceAttrs, lineSourceMap } from './file-markdown-source.mjs';
import { installImageReferenceWindow, boundedImageReferences } from '../../../src/shared/markdown-reference-window.mjs';

const SAFE_IMAGES = new Set(['/assets/app-icon.png', '/assets/m9-image-fixture.svg']);
const TINY_FIXTURE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aDeUAAAAASUVORK5CYII=';
export const safeImageSrc = raw => raw === 'tiny.png' || raw === 'tiny2.png' ? TINY_FIXTURE : SAFE_IMAGES.has(raw) || /^data:image\/(?:png|jpe?g|gif|webp);/i.test(raw) ? raw : '/assets/app-icon.png';

// markdown-it percent-encodes non-ASCII targets; the model keeps the author's text (e.g. 需求.md) for path resolution.
const decodeRef = value => { try { return decodeURI(value); } catch { return value; } };
const md = new MarkdownIt({ html: false, linkify: false, typographer: false });
installDollarMath(md);
installImageReferenceWindow(md);
installInlineSourceTracking(md);
md.core.ruler.after('inline', 'source_positions', state => {
  if (typeof state.env.originalSource === 'string') attachInlineSource(state.tokens, state.env.originalSource, state.env.lineBase || 0);
});
const wrapSource = (html, source) => source && html ? `<span${sourceAttrs(source)}>${html}</span>` : html;
for (const type of ['text', 'code_inline', ...Object.keys(md.renderer.rules).filter(type => type.startsWith('math_'))]) {
  const render = md.renderer.rules[type] || ((tokens, i) => md.utils.escapeHtml(tokens[i].content));
  md.renderer.rules[type] = (tokens, i, options, env, renderer) => wrapSource(render(tokens, i, options, env, renderer), tokens[i].meta?.source);
}
md.options.highlight = (source, language) => highlightCode(source, language).html || '';
// Task markers: only the list item's own first text; the source line is carried so a toggle edits that exact line.
md.core.ruler.after('text_join', 'task_lists', state => {
  const t = state.tokens;
  for (let i = 2; i < t.length; i++) {
    if (t[i].type !== 'inline' || t[i - 1].type !== 'paragraph_open' || t[i - 2].type !== 'list_item_open') continue;
    const m = t[i].content.match(/^\[([ xX])\][ \t]+/), first = t[i].children?.[0];
    if (!m || !first || first.type !== 'text') continue;
    const removed = first.content.match(/^\[[ xX]\][ \t]+/)?.[0].length || 0;
    first.content = first.content.slice(removed);
    if (first.meta?.source?.mode === 'linear') first.meta.source.from += removed;
    t[i].content = t[i].content.slice(m[0].length);
    const box = new state.Token('task_checkbox', 'input', 0);
    box.meta = { checked: m[1] !== ' ', line: (t[i].map?.[0] ?? 0) + (state.env.lineBase || 0) };
    t[i].children.unshift(box);
    t[i - 2].attrJoin('class', 'fw-md-task-item');
  }
});
md.renderer.rules.task_checkbox = (tokens, i, options, env) => `<input type="checkbox" class="fw-md-task-box" data-md-task-line="${tokens[i].meta.line}"${tokens[i].meta.checked ? ' checked' : ''}${env?.readOnly ? ' disabled' : ''}>`;
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.attrGet('data-md-src') === null) { const raw = decodeRef(token.attrGet('src')); token.attrSet('data-md-src', raw); token.attrSet('src', safeImageSrc(raw)); }
  return defaultImage(tokens, idx, options, env, self);
};
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  if (token.attrGet('data-md-href') === null) { token.attrSet('data-md-href', decodeRef(token.attrGet('href'))); token.attrSet('href', '#'); }
  return self.renderToken(tokens, idx, options);
};

const NEWLINE = /[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g;
const blankLine = line => !line.trim();
function blockType(tokens) {
  const open = tokens[0];
  if (open.type === 'heading_open') return 'heading';
  if (open.type === 'blockquote_open') return 'quote';
  if (open.type === 'bullet_list_open' || open.type === 'ordered_list_open') return 'list';
  if (open.type === 'table_open') return 'table';
  if (open.type === 'hr') return 'rule';
  if (open.type.startsWith('math_block')) return 'math';
  if (open.type === 'fence') return open.info.trim().split(/\s+/)[0] === 'mermaid' ? 'mermaid' : 'code';
  if (open.type === 'code_block') return 'code';
  if (open.type === 'paragraph_open' && tokens[1]?.children?.length === 1 && tokens[1].children[0].type === 'image') return 'image';
  return 'paragraph';
}
export function parseMarkdown(text) {
  const lines = text.match(NEWLINE) || [], starts = []; let offset = 0;
  for (const line of lines) { starts.push(offset); offset += line.length; } starts.push(offset);
  const blocks = [];
  const push = (type, s, e, extra = {}, tokens) => {
    const block = { type, language: extra.language || '', raw: text.slice(starts[s], starts[e]), from: starts[s], to: starts[e], line: s + 1 };
    if (tokens) Object.defineProperty(block, 'tokens', { value: tokens });
    blocks.push(block);
  };
  const gap = (a, b) => {
    for (let i = a; i < b;) {
      if (blankLine(lines[i])) { push('blank', i, i + 1); i++; continue; }
      let j = i; while (j < b && !blankLine(lines[j])) j++;
      push('definition', i, j); i = j; // reference definitions consume no block token
    }
  };
  let base = 0;
  if (lines.length > 1 && /^---[ \t]*(?:\r\n|\r|\n)?$/.test(lines[0])) {
    let j = 1; while (j < lines.length && !/^(?:---|\.\.\.)[ \t]*(?:\r\n|\r|\n)?$/.test(lines[j])) j++;
    if (j < lines.length) { push('frontmatter', 0, j + 1); base = j + 1; }
  }
  const env = { lineBase: base, originalSource: text, imageReferences: boundedImageReferences(md, text, starts[base]) }, tokens = md.parse(lines.slice(base).join(''), env);
  let cursor = base;
  for (let t = 0; t < tokens.length;) {
    const tok = tokens[t]; let end = t;
    if (tok.nesting === 1) while (!(tokens[end].level === tok.level && tokens[end].nesting === -1)) end++;
    const slice = tokens.slice(t, end + 1), map = tok.map || [cursor - base, cursor - base + 1];
    gap(cursor, base + map[0]);
    let type = blockType(slice);
    if (type === 'mermaid' && !completeFence(text.slice(starts[base + map[0]], starts[base + map[1]]), tok.markup)) type = 'code';
    push(type, base + map[0], base + map[1], { language: tok.type === 'fence' ? tok.info.trim().split(/\s+/)[0] : '' }, slice);
    cursor = base + map[1]; t = end + 1;
  }
  gap(cursor, lines.length);
  return { blocks, env };
}
// 只读场景（Notebook 等）：整段 Markdown 渲染为安全 HTML（原始 HTML 已转义，链接 href 改为 #，图片只允许白名单来源）。
export const renderMarkdownReadOnly = (text, mathRender) => md.render(text, { lineBase: 0, readOnly: true, mathRender });
export const markdownBlocks = text => parseMarkdown(text).blocks;
export const renderMarkdownBlock = (block, env) => {
  if (block.type === 'math') block.tokens[0].meta = { ...block.tokens[0].meta, source: { from: block.from, to: block.to, mode: 'atomic' } };
  return md.renderer.render(block.tokens, md.options, env);
};
export function markdownMathRanges(block, env) {
  const ranges = [];
  for (const token of block.tokens ?? []) for (const child of token.type === 'inline' ? token.children ?? [] : [token]) {
    const range = child.meta?.mathRange;
    if (!range || !child.type.startsWith('math_')) continue;
    ranges.push({ ...range, code: child.content, html: md.renderer.render([child], md.options, env) });
  }
  return ranges;
}
export function completeFence(raw, markup = '```') {
  const lines = raw.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
  if (lines.length < 2) return false;
  const last = lines.at(-1).trim();
  return last.length >= markup.length && [...last].every(char => char === markup[0]);
}
export function codeSourceMap(block) {
  const token = block.tokens.find(token => token.type === 'fence' || token.type === 'code_block');
  if (!token) return null;
  const lines = block.raw.match(NEWLINE) || [];
  const start = token.type === 'fence' ? lines[0]?.length || 0 : 0;
  const end = token.type === 'fence' && completeFence(block.raw, token.markup) ? block.raw.length - (lines.at(-1)?.length || 0) : block.raw.length;
  return lineSourceMap(block.raw.slice(start, end), token.content, block.from + start);
}
export function highlightedCode(block) {
  const code = codeBody(block), result = highlightCode(code, block.language);
  return { code, html: result.html || md.utils.escapeHtml(code), language: result.language, map: codeSourceMap(block) };
}
export const standaloneImage = block => {
  const image = block.tokens[1].children[0];
  return { alt: image.content || '图片', original: image.attrGet('data-md-src') ?? image.attrGet('src') ?? '' };
};
export const codeBody = block => block.tokens.find(t => t.type === 'fence' || t.type === 'code_block')?.content ?? '';
export const mathSource = block => block.tokens[0].content.trim();
export function parseFrontmatter(raw) {
  const body = raw.replace(/^---[ \t]*\r?\n/, '').replace(/\r?\n(?:---|\.\.\.)[ \t]*\r?\n?$/, '');
  try {
    const value = yaml.load(body, { schema: yaml.CORE_SCHEMA });
    if (value === null || value === undefined) return { entries: [] };
    if (typeof value !== 'object' || Array.isArray(value)) return { entries: [], error: 'Frontmatter 必须是键值映射' };
    return { entries: Object.entries(value).map(([k, v]) => [k, typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)]) };
  } catch (error) { return { entries: [], error: 'Frontmatter 无法解析：' + String(error.reason || error.message).split('\n')[0] }; }
}
export function replaceMarkdownBlock(text, block, value) {
  if (!block || text.slice(block.from, block.to) !== block.raw) return null;
  return text.slice(0, block.from) + value + text.slice(block.to);
}
export function resolveMarkdownPath(currentPath, href, { decode = false } = {}) {
  if (/^(?:[a-z][\w+.-]*:|\/\/|\\)/i.test(href)) return null;
  let path = href.split(/[?#]/)[0];
  try { if (decode) path = decodeURIComponent(path); } catch { return null; }
  if (/[\u0000-\u001f\\]/.test(path)) return null;
  const parts = path.startsWith('/') ? [] : currentPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop(); }
    else if (part && part !== '.') parts.push(part);
  }
  return parts.join('/');
}
export { imageMenuActions } from '../../../src/shared/image-menu-policy.mjs';
export const IMAGE_ZOOM_STEPS = [25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500];
export const fitImage = (width, height, viewportWidth, viewportHeight) => Math.min(1, Math.max(.01, Math.min(viewportWidth / width, viewportHeight / height)));
export function stepImageZoom(current, direction, fit = 1) {
  const values = [...new Set([...IMAGE_ZOOM_STEPS.map(v => v / 100), fit])].sort((a,b) => a-b);
  return direction > 0 ? values.find(v => v > current + .00001) ?? values.at(-1) : [...values].reverse().find(v => v < current - .00001) ?? values[0];
}
export const scaleWheelDelta = (delta, mode) => delta * (mode === 1 ? 16 : mode === 2 ? 800 : 1);
export function anchoredImageZoom(previous, next, pan, point) {
  return { x: point.x - (point.x - pan.x) * next / previous, y: point.y - (point.y - pan.y) * next / previous };
}
export function localFind(text, query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  if (!query) return { matches: [], error: '' };
  try {
    const pattern = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(wholeWord ? '\\b(?:' + pattern + ')\\b' : pattern, caseSensitive ? 'gu' : 'giu');
    const matches = [];
    for (const m of text.matchAll(re)) {
      matches.push({ from: m.index, to: m.index + m[0].length, value: m[0] });
      if (matches.length >= 10000) break;
    }
    return { matches, error: '' };
  } catch { return { matches: [], error: '正则表达式无效' }; }
}

// Browser textareas normalize EOL to LF. Replace only the actual changed slice in original source,
// preserving all untouched CRLF/CR/LF bytes; new line breaks adopt the current range's EOL.
export function markdownTextareaEdit(original, value) {
  let normalized = '', positions = [0];
  for (let i = 0; i < original.length;) {
    if (original[i] === '\r') { i += original[i + 1] === '\n' ? 2 : 1; normalized += '\n'; }
    else { normalized += original[i++]; }
    positions.push(i);
  }
  const next = value.replace(/\r\n?/g, '\n');
  let start = 0; while (start < normalized.length && start < next.length && normalized[start] === next[start]) start++;
  let end = normalized.length, nextEnd = next.length;
  while (end > start && nextEnd > start && normalized[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  const from = positions[start], to = positions[end], eol = original.slice(from, to).match(/\r\n|\r|\n/)?.[0] || original.match(/\r\n|\r|\n/)?.[0] || '\n';
  return original.slice(0, from) + next.slice(start, nextEnd).replace(/\n/g, eol) + original.slice(to);
}
