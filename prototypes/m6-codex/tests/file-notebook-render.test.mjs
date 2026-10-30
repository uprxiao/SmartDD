import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdownReadOnly } from '../src/file-markdown-model.mjs';
import { highlightCode, highlightLanguage } from '../src/file-highlight.mjs';

test('read-only Markdown model covers lists, tables, quotes, code, math placeholders and escaped HTML', () => {
  const html = renderMarkdownReadOnly('# T\n\n1. a\n   - b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n> q\n\n`c` $a^2$ <script>alert(1)</script> [l](javascript:alert(1)) [ok](x.md)\n\n- [x] done\n');
  for (const needle of ['<h1>', '<ol>', '<ul>', '<table>', '<blockquote>', '<code>', 'data-md-math="inline"']) assert.ok(html.includes(needle), needle);
  assert.ok(!html.includes('<script>')); assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!/href="javascript:/i.test(html)); assert.match(html, /<a href="#" data-md-href="x\.md">/);
});
test('read-only task checkboxes are disabled', () => {
  const html = renderMarkdownReadOnly('- [ ] a\n- [x] b\n');
  assert.equal([...html.matchAll(/<input[^>]*>/g)].every(m => m[0].includes('disabled')), true);
});
test('remote images fall back to the local placeholder in read-only Markdown', () => {
  assert.match(renderMarkdownReadOnly('![x](https://example.invalid/a.png)'), /src="\/assets\/app-icon\.png"/);
});
test('highlighter: aliases, unknown languages, escaping and illegal input', () => {
  assert.equal(highlightLanguage('Python'), 'python'); assert.equal(highlightLanguage('ipython3'), 'python'); assert.equal(highlightLanguage('sh'), 'zsh'); assert.equal(highlightLanguage('cobol'), 'cobol'); assert.equal(highlightLanguage(''), null);
  const r = highlightCode('def f(x):\n    return "<b>" + x  # c', 'python');
  assert.equal(r.language, 'python'); assert.ok(r.html.includes('fw-code-token')); assert.ok(r.html.includes('&lt;b&gt;')); assert.ok(!r.html.includes('<b>'));
  assert.equal(highlightCode('x', 'not-a-language').html, null);
  assert.doesNotThrow(() => highlightCode('}{ ][ ((', 'json'));
});
