import { createHighlighterCoreSync } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import { FILE_LANGUAGES } from './languages.mjs';
import { GRAMMARS } from './grammars.mjs';
import { CODE_THEMES } from './themes.mjs';
import { CODE_TOKEN_STRIDE, codeTokenStyle } from './paint.mjs';
export { CODE_TOKEN_STRIDE, codeTokenStyle } from './paint.mjs';
export const CODE_LIMITS = { source: 20 * 1024 * 1024, tokens: 2_000_000, window: 16_384, deadline: 15_000 };
const own = (object, key) => Object.hasOwn(object, key) ? object[key] : undefined;
function lookup(name) {
  const full = own(FILE_LANGUAGES, name); if (full) return full;
  const compound = name.match(/\.([^/\\]+\.[^/\\]+)$/)?.[1];
  const multi = compound && own(FILE_LANGUAGES, compound); if (multi) return multi;
  const suffix = name.match(/\.([^.]+)$/)?.[1];
  return suffix ? own(FILE_LANGUAGES, suffix) ?? null : null;
}
export function codeLanguage(filename) {
  const name = String(filename).split(/[\\/]/).at(-1);
  if (/^(?:text|txt|plain|plaintext)$/i.test(name)) return null;
  return lookup(name) || lookup(name.toLowerCase());
}
export function highlightLanguage(name) {
  const language = String(name || '').trim();
  if (!language || /^(?:text|txt|plain|plaintext)$/i.test(language)) return null;
  if (own(GRAMMARS, language)) return language;
  if (own(GRAMMARS, language.toLowerCase())) return language.toLowerCase();
  if (language === 'ipython3') return 'python';
  return codeLanguage(language) || codeLanguage(`code.${language}`);
}
let highlighter;
function grammar(language) {
  highlighter ??= createHighlighterCoreSync({ themes: [structuredClone(CODE_THEMES.light), structuredClone(CODE_THEMES.dark)], langs: [], engine: createJavaScriptRegexEngine() });
  if (!highlighter.getLoadedLanguages().includes(language)) highlighter.loadLanguageSync(...GRAMMARS[language]);
  return highlighter;
}
const rgb = color => {
  if (!/^#[\da-f]{6}$/i.test(color)) throw new Error('Syntax theme returned an invalid color');
  return Number.parseInt(color.slice(1), 16);
};
function ranges(source, language) {
  if (source.length > CODE_LIMITS.source) throw new Error('代码高亮超过 20 MiB 解析预算');
  if (!language || !source) return new Uint32Array();
  const parsed = grammar(language).codeToTokensWithThemes(source, { lang: language, themes: { light: CODE_THEMES.light.name, dark: CODE_THEMES.dark.name }, tokenizeMaxLineLength: Infinity });
  const tokens = []; let previousEnd = 0;
  for (const line of parsed) for (const token of line) {
    const from = token.offset, to = from + token.content.length;
    if (!Number.isSafeInteger(from) || from < previousEnd || to > source.length || source.slice(from, to) !== token.content) throw new Error('语法高亮与源码偏移不一致');
    if (!/^[\r\n]*$/.test(source.slice(previousEnd, from))) throw new Error('语法高亮遗漏源码');
    previousEnd = to; if (from === to) continue;
    const colors = [rgb(token.variants.light.color), rgb(token.variants.dark.color), Math.max(0, token.variants.light.fontStyle || 0), Math.max(0, token.variants.dark.fontStyle || 0)];
    const previous = tokens.length - CODE_TOKEN_STRIDE;
    if (previous >= 0 && tokens[previous + 1] === from && colors.every((v, i) => v === tokens[previous + i + 2])) tokens[previous + 1] = to;
    else {
      if (tokens.length / CODE_TOKEN_STRIDE >= CODE_LIMITS.tokens) throw new Error('代码高亮复杂度超过预算，源码仍可查看和编辑');
      tokens.push(from, to, ...colors);
    }
  }
  if (!/^[\r\n]*$/.test(source.slice(previousEnd))) throw new Error('语法高亮未覆盖完整源码');
  return Uint32Array.from(tokens);
}
export function highlightRanges(source, filename) { return ranges(source, codeLanguage(filename)); }
export function highlightWindow(tokens, from, to) {
  const stride = CODE_TOKEN_STRIDE;
  let lo = 0, hi = tokens.length / stride;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (tokens[mid * stride + 1] <= from) lo = mid + 1; else hi = mid; }
  const start = lo; while (lo < tokens.length / stride && tokens[lo * stride] < to && lo - start < CODE_LIMITS.window) lo++;
  return tokens.slice(start * stride, lo * stride);
}
const escapeSource = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function highlightCode(source, language) {
  const name = highlightLanguage(language); if (!name) return { html: null, language: null };
  const tokens = ranges(source, name); let cursor = 0, html = '';
  for (let i = 0; i < tokens.length; i += CODE_TOKEN_STRIDE) {
    html += escapeSource(source.slice(cursor, tokens[i]));
    html += `<span class="fw-code-token" style="${codeTokenStyle(tokens, i)}">${escapeSource(source.slice(tokens[i], tokens[i + 1]))}</span>`;
    cursor = tokens[i + 1];
  }
  return { html: html + escapeSource(source.slice(cursor)), language: name };
}
