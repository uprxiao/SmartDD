// 代码高亮：highlight.js core + 有限语言子集（按需加载体积小）。输出的 HTML 由 highlight.js 转义，只含 span.hljs-*。
import hljs from 'highlight.js/lib/core';
import python from 'highlight.js/lib/languages/python';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
for (const [name, language] of Object.entries({ python, javascript, typescript, json, bash, sql, xml, css, yaml, markdown })) hljs.registerLanguage(name, language);
const ALIASES = { py: 'python', js: 'javascript', ts: 'typescript', sh: 'bash', shell: 'bash', zsh: 'bash', html: 'xml', yml: 'yaml', md: 'markdown', ipython3: 'python' };
export const highlightLanguage = name => { const key = String(name || '').trim().toLowerCase(); const mapped = ALIASES[key] || key; return hljs.getLanguage(mapped) ? mapped : null; };
export function highlightCode(source, language) {
  const name = highlightLanguage(language);
  if (!name) return { html: null, language: null };
  try { return { html: hljs.highlight(source, { language: name, ignoreIllegals: true }).value, language: name }; }
  catch { return { html: null, language: null }; }
}
