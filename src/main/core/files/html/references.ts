import { SAXParser } from 'parse5-sax-parser';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';
import { parse as parseModules } from 'es-module-lexer/js';
import { HTML_LIMITS } from '@shared/file-html';

export type ReferenceKind = 'html' | 'css' | 'script';
export interface HtmlReferences { references: string[]; warnings: string[] }
const cssText = (value: string) => value.replace(/\\(?:\r\n|[\n\r\f])/g, '').replace(/\\([a-f0-9]{1,6})(?:\r\n|[\t\n\f\r ])?|\\([^\n\r\f])/gi, (_match, hex, literal) => {
  if (!hex) return literal; const code = Number.parseInt(hex, 16); return code && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '\ufffd';
});
function srcset(value: string): string[] {
  const result: string[] = []; let index = 0;
  while (index < value.length) {
    while (/[\t\n\f\r ,]/.test(value[index] ?? '') && index < value.length) index++;
    const start = index; while (index < value.length && !/[\t\n\f\r ]/.test(value[index])) index++;
    const url = value.slice(start, index); if (!url) break;
    result.push(url.replace(/,+$/, '')); if (url.endsWith(',')) continue;
    let depth = 0;
    while (index < value.length) { const char = value[index++]; if (char === '(') depth++; else if (char === ')') depth = Math.max(0, depth - 1); else if (char === ',' && !depth) break; }
  }
  return result;
}
/** Runs in a bounded Node worker. No HTML/JS/CSS is evaluated. */
export async function documentReferences(raw: string, kind: ReferenceKind): Promise<HtmlReferences> {
  if (raw.length > HTML_LIMITS.sourceUnits || Buffer.byteLength(raw) > HTML_LIMITS.sourceBytes) throw new Error('文档解析输入超过预算');
  const references = new Set<string>(), warnings = new Set<string>(); let count = 0;
  const add = (value: string | undefined) => { if (!value?.trim() || value.trim().startsWith('#')) return; if (value.length > 32768) throw new Error('文档资源路径过长'); references.add(value.trim()); if (references.size > HTML_LIMITS.references) throw new Error('文档资源引用超过512项'); };
  const css = (source: string) => {
    const root = postcss.parse(source);
    const values = (source: string) => valueParser(source).walk((node) => { if (node.type === 'function' && node.value.toLowerCase() === 'url') { add(cssText(valueParser.stringify(node.nodes).replace(/^(['"])([\s\S]*)\1$/, '$2').trim())); return false; } });
    root.walkDecls((decl) => { if (++count > HTML_LIMITS.tokens) throw new Error('文档结构超过解析预算'); values(decl.value); });
    root.walkAtRules((rule) => { if (++count > HTML_LIMITS.tokens) throw new Error('文档结构超过解析预算'); values(rule.params); if (rule.name.toLowerCase() === 'import') { const node = valueParser(rule.params).nodes.find((part) => part.type !== 'space' && part.type !== 'comment'); if (node?.type === 'string') add(cssText(node.value)); } });
  };
  const scripts: string[] = [];
  if (kind === 'css') css(raw);
  else if (kind === 'script') scripts.push(raw);
  else {
    const parser = new SAXParser(); let inside: 'script' | 'style' | null = null, content = '', scriptType = '';
    parser.on('startTag', (tag) => {
      if (++count > HTML_LIMITS.tokens) throw new Error('文档结构超过100,000项');
      const attrs = new Map(tag.attrs.map((attr) => [attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, attr.value]));
      if (attrs.has('style')) css(`x{${attrs.get('style')}}`);
      if (['img', 'source', 'video', 'audio', 'script', 'input', 'track'].includes(tag.tagName)) add(attrs.get('src'));
      if (['img', 'source'].includes(tag.tagName)) srcset(attrs.get('srcset') ?? '').forEach(add);
      if (tag.tagName === 'video') add(attrs.get('poster'));
      if (tag.tagName === 'image') add(attrs.get('href') ?? attrs.get('xlink:href'));
      if (tag.tagName === 'link' && /(?:^|\s)(?:stylesheet|icon|preload|modulepreload)(?:\s|$)/i.test(attrs.get('rel') ?? '')) add(attrs.get('href'));
      if (tag.tagName === 'script' || tag.tagName === 'style') { inside = tag.tagName; content = ''; scriptType = attrs.get('type')?.toLowerCase() ?? ''; }
    });
    parser.on('text', (token) => { if (inside) content += token.text; });
    const finish = () => { if (inside === 'style') css(content); else if (inside === 'script' && (!scriptType || ['module', 'text/javascript', 'application/javascript'].includes(scriptType))) scripts.push(content); inside = null; content = ''; };
    parser.on('endTag', (tag) => { if (++count > HTML_LIMITS.tokens) throw new Error('文档结构超过100,000项'); if (tag.tagName === inside) finish(); });
    await new Promise<void>((resolve, reject) => { parser.on('error', reject); parser.on('finish', () => { try { finish(); resolve(); } catch (error) { reject(error); } }); parser.resume(); parser.end(raw); });
  }
  for (const source of scripts) {
    let imports;
    try { [imports] = await parseModules(source); }
    catch { warnings.add('部分脚本无法静态解析模块引用'); continue; }
    for (const entry of imports) { if (entry.n) add(entry.n); else if (entry.d >= 0) warnings.add('动态模块路径未映射'); }
  }
  return { references: [...references], warnings: [...warnings] };
}
