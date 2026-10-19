import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { documentReferences } from './references';
import { buildHtmlResources, htmlDocumentURL, htmlResourceURL, type HtmlSource } from './resources';
import { HTML_LIMITS } from '@shared/file-html';
import { FileError } from '@shared/files';
const token = 'a'.repeat(64), hash = (value: string) => createHash('sha256').update(value).digest('hex');
const fixture = (files: Record<string, string>): HtmlSource => ({ path: 'docs/index.html', hash: hash(files['docs/index.html']), signal: new AbortController().signal, assert() {}, async read(path, limit, signal) { signal.throwIfAborted(); if (!(path in files)) throw new Error('missing'); const bytes = new TextEncoder().encode(files[path]); if (bytes.length > limit) throw new FileError('TOO_LARGE', 'File exceeds this operation\'s byte limit'); return { bytes, hash: hash(files[path]) }; } });
describe('HTML resource references and restricted local mapping', () => {
  it('parses real HTML/CSS/module syntax without treating comments or JavaScript strings as tags', async () => {
    const result = await documentReferences('<link rel="stylesheet" href="a.css"><!-- <img src="secret.png"> --><script>const x = \'<img src="fake.png">\'; import("./dynamic.js");</script><style>@import "b.css"; a{background:url("图像\\20 空.png")}</style><img srcset="one.png 1x, two.png 2x, data:image/png;base64,AAAA 3x" style="background:url(three.png)">', 'html');
    expect(result.references).toEqual(expect.arrayContaining(['a.css', 'b.css', './dynamic.js', '图像 空.png', 'one.png', 'two.png', 'three.png', 'data:image/png;base64,AAAA']));
    expect(result.references).not.toContain('secret.png'); expect(result.references).not.toContain('fake.png');
    expect((await documentReferences('import x from "./x.js"; import(variable); export {x} from "./y.js";', 'script')).warnings).toContain('动态模块路径未映射');
  });
  it('never maps another origin, file URL, credentials, encoded controls or arbitrary local files', () => {
    const base = htmlDocumentURL(token, 'docs/index.html');
    for (const href of ['https://example.invalid/x.png', 'file:///tmp/x.png', '//elsewhere/x.js', `willyou-document://user@${token}/x.js`, '../.env', '/.git/config', 'x%00.png', 'a\\b.png']) expect(() => htmlResourceURL(href, base, token), href).toThrow();
    expect(htmlResourceURL('../assets/中文%20图.png?x=1#part', base, token)).toMatchObject({ path: 'assets/中文 图.png', mime: 'image/png' });
    expect(htmlResourceURL('data:image/png;base64,AAA', base, token)).toBeNull();
  });
  it('builds a deduplicated bounded graph with local CSS/font and module dependencies, retaining failures', async () => {
    const source = fixture({ 'docs/index.html': '<link rel="stylesheet" href="a.css"><script type="module" src="app.js"></script><img src="https://example.invalid/a.png"><img src="missing.png">', 'docs/a.css': '@import "a.css"; @font-face{src:url(font.woff2)}', 'docs/font.woff2': 'fixture-font', 'docs/app.js': 'import "./other.js";', 'docs/other.js': 'export default 1' });
    const result = await buildHtmlResources(source, token, documentReferences, new AbortController().signal);
    expect(result.resources.size).toBe(5); expect(result.warnings).toEqual(expect.arrayContaining(['外部资源未加载', '本地资源不可读取']));
    expect(result.resources.get(htmlDocumentURL(token, 'docs/index.html'))?.mime).toBe('text/html');
  });
  it('checks source revision, bytes/UTF-16 independently and resource count/depth without truncating', async () => {
    const changed = fixture({ 'docs/index.html': 'hello' }); changed.hash = 'b'.repeat(64);
    await expect(buildHtmlResources(changed, token, documentReferences, new AbortController().signal)).rejects.toThrow('读取期间改变');
    await expect(buildHtmlResources(fixture({ 'docs/index.html': 'a'.repeat(HTML_LIMITS.sourceUnits + 1) }), token, documentReferences, new AbortController().signal)).rejects.toThrow('字符预览上限');
    const large = fixture({ 'docs/index.html': '中'.repeat(4_000_000) });
    await expect(buildHtmlResources(large, token, documentReferences, new AbortController().signal)).rejects.toThrow('10 MiB');
    large.read = async () => ({ bytes: new TextEncoder().encode('中'.repeat(4_000_000)), hash: large.hash });
    await expect(buildHtmlResources(large, token, documentReferences, new AbortController().signal)).rejects.toThrow('10 MiB');
    const many = { 'docs/index.html': Array.from({ length: 129 }, (_, index) => `<img src="${index}.png">`).join('') };
    await expect(buildHtmlResources(fixture(many), token, documentReferences, new AbortController().signal)).rejects.toThrow('128项');
    const deep: Record<string, string> = { 'docs/index.html': '<link rel="stylesheet" href="0.css">' };
    for (let i = 0; i < 9; i++) deep[`docs/${i}.css`] = `@import "${i + 1}.css";`;
    await expect(buildHtmlResources(fixture(deep), token, documentReferences, new AbortController().signal)).rejects.toThrow('8层');
  });
  it('aborts between native reads and never returns a partial successful bundle', async () => {
    const abort = new AbortController(), source = fixture({ 'docs/index.html': '<img src="one.png">', 'docs/one.png': 'one' }), original = source.read;
    source.read = async (...args) => { const result = await original(...args); if (args[0].endsWith('.png')) abort.abort(); return result; };
    await expect(buildHtmlResources(source, token, documentReferences, abort.signal)).rejects.toThrow('abort');
  });
});
