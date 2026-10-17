import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, renderMarkdownBlock, replaceMarkdownBlock, parseFrontmatter, standaloneImage, safeImageSrc } from '../src/file-markdown-model.mjs';

const render = text => { const { blocks, env } = parseMarkdown(text); return blocks.map(b => b.tokens ? renderMarkdownBlock(b, env) : '').join(''); };
const DOCS = {
  mixed: '---\ntitle: 完整\ntags: [a, b]\n---\n# 标题 😀\n\nSetext\n======\n\n1. one\n   - nested **bold**\n2. two\n\n> quote\n> - in quote\n\n| 左 | 右 |\n|:---|---:|\n| `a|b` | 2 |\n\n[ref]: https://example.invalid "T"\n\nText [link][ref] and ![alt](/assets/app-icon.png) end.\n\n```js\nconst a = "<b>";\n```\n\n$$\n\\frac{a}{b}\n$$\n\n***\n',
  crlf: '# A\r\n\r\n- [ ] x\r\n- [x] y\r\n\r\n```\r\ncode\r\n```\r\n',
  unclosedFence: 'before\n\n```ts\nnever closed\n',
  noTrailingNewline: 'a\n\nb',
  hrNotFrontmatter: '---\n\ntext\n',
  lone: '\r\r',
  empty: ''
};

test('every document round-trips byte-for-byte through block raw ranges', () => {
  for (const [name, text] of Object.entries(DOCS)) {
    const { blocks } = parseMarkdown(text);
    assert.equal(blocks.map(b => b.raw).join(''), text, name);
    let at = 0; for (const b of blocks) { assert.equal(b.from, at, name); assert.equal(text.slice(b.from, b.to), b.raw, name); at = b.to; }
    assert.equal(at, text.length, name);
  }
});

test('fuzzed documents never lose or reorder bytes', () => {
  const atoms = ['#', ' ', '\n', '\r\n', '-', '*', '1.', '>', '|', '`', '```', '~~~', '$', '$$', '[', ']', '(', ')', '!', '---', '😀', '中', 'x', '\t', '<b>', '[ ]', '[x]'];
  let seed = 7; const rnd = n => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
  for (let i = 0; i < 400; i++) {
    let text = ''; for (let j = 0, n = rnd(40); j < n; j++) text += atoms[rnd(atoms.length)];
    const { blocks } = parseMarkdown(text);
    assert.equal(blocks.map(b => b.raw).join(''), text, JSON.stringify(text));
  }
});

test('block classification covers CommonMark structures and gaps', () => {
  const types = parseMarkdown(DOCS.mixed).blocks.filter(b => b.type !== 'blank').map(b => b.type);
  assert.deepEqual(types, ['frontmatter', 'heading', 'heading', 'list', 'quote', 'table', 'definition', 'paragraph', 'code', 'math', 'rule']);
  assert.equal(parseMarkdown(DOCS.hrNotFrontmatter).blocks[0].type, 'rule');
  assert.equal(parseMarkdown(DOCS.unclosedFence).blocks.at(-1).type, 'code');
  assert.equal(parseMarkdown('```mermaid\nA-->B\n```').blocks[0].type, 'mermaid');
});

test('rendering is escaped and links are non-executable', () => {
  const html = render('<script>alert(1)</script> [x](javascript:alert(1)) [ok](docs/a.md) ![p](https://example.invalid/t.png)');
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!/href="javascript:/i.test(html));assert.ok(!html.includes('<a href="#" data-md-href="javascript'));
  assert.match(html, /data-md-href="docs\/a\.md"/);
  assert.match(html, /<a href="#"/);
  assert.match(html, /src="\/assets\/app-icon\.png"[^>]*data-md-src="https:\/\/example\.invalid\/t\.png"|data-md-src="https:\/\/example\.invalid\/t\.png"[^>]*src="\/assets\/app-icon\.png"/);
});

test('KaTeX renders inline and block math, bad math degrades without throwing', () => {
  assert.match(render('x $a^2$ y'), /class="katex"/);
  assert.match(render('$$\n\\frac{a}{b}\n$$\n'), /katex-display/);
  assert.doesNotThrow(() => render('$\\unknowncommand{$'));
  assert.ok(!render('price $5 and $6').includes('class="katex"'));
});

test('task toggles carry the exact absolute source line, including after frontmatter', () => {
  const text = '---\na: 1\n---\n- [ ] one\n  - [x] two\n- plain\n';
  const { blocks, env } = parseMarkdown(text);
  const html = renderMarkdownBlock(blocks.find(b => b.type === 'list'), env);
  assert.deepEqual([...html.matchAll(/data-md-task-line="(\d+)"( checked)?/g)].map(m => [Number(m[1]), !!m[2]]), [[3, false], [4, true]]);
  const lines = text.split('\n'); assert.match(lines[3], /\[ \] one/); assert.match(lines[4], /\[x\] two/);
});

test('editing one block changes only its range; CJK/emoji offsets stay UTF-16 exact', () => {
  const text = '# 😀 标题\n\n段落 A\n\n段落 B\n';
  const { blocks } = parseMarkdown(text);
  const target = blocks.find(b => b.raw.startsWith('段落 B'));
  const next = replaceMarkdownBlock(text, target, '段落 B 改\n');
  assert.equal(next, '# 😀 标题\n\n段落 A\n\n段落 B 改\n');
  assert.equal(next.slice(0, target.from), text.slice(0, target.from));
  assert.equal(blocks[0].raw, '# 😀 标题\n');
  assert.equal(blocks[0].to, '# 😀 标题\n'.length);
});

test('tables keep alignment and inline code containing pipes', () => {
  const html = render('| 左 | 右 |\n|:---|---:|\n| `a|b` | 2 |\n');
  assert.match(html, /<table>/); assert.match(html, /text-align:right/);
});

test('frontmatter parses valid YAML and reports invalid or non-mapping documents', () => {
  assert.deepEqual(parseFrontmatter('---\ntitle: 完整\ntags: [a, b]\nn: 3\n---\n').entries, [['title', '完整'], ['tags', '["a","b"]'], ['n', '3']]);
  assert.match(parseFrontmatter('---\na: [1\n---\n').error, /无法解析/);
  assert.match(parseFrontmatter('---\n- a\n---\n').error, /键值映射/);
  assert.deepEqual(parseFrontmatter('---\n---\n').entries, []);
});

test('standalone image and fallback source policy', () => {
  const b = parseMarkdown('![图](./a.png)\n').blocks[0];
  assert.equal(b.type, 'image'); assert.deepEqual(standaloneImage(b), { alt: '图', original: './a.png' });
  assert.equal(safeImageSrc('https://x.invalid/a.png'), '/assets/app-icon.png');
  assert.equal(safeImageSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
});

test('non-ASCII link and image targets keep the author text for path resolution', () => {
  const { blocks, env } = parseMarkdown('[需求](<docs/需求 文档.md>) ![图](<图片/a b.png>)\n');
  const html = renderMarkdownBlock(blocks[0], env);
  assert.match(html, /data-md-href="docs\/需求 文档\.md"/);
  assert.match(html, /data-md-src="图片\/a b\.png"/);
});
