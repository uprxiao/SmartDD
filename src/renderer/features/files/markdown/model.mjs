import { parseMarkdown, renderMarkdownBlock, markdownMathRanges, markdownInlinePlan, highlightedCode, codeBody, parseFrontmatter } from './file-markdown-model.mjs';
export const blockTypes = ['blank', 'definition', 'frontmatter', 'heading', 'paragraph', 'quote', 'list', 'table', 'rule', 'math', 'mermaid', 'code', 'image'];
export function analyze(source) {
  const parsed = parseMarkdown(source), index = new Uint32Array(parsed.blocks.length * 4);
  let cursor = 0;
  for (let at = 0; at < parsed.blocks.length; at++) {
    const block = parsed.blocks[at];
    if (block.from !== cursor || source.slice(block.from, block.to) !== block.raw) throw new Error('Markdown 源码范围不连续');
    index.set([block.from, block.to, block.line, blockTypes.indexOf(block.type)], at * 4); cursor = block.to;
  }
  if (cursor !== source.length) throw new Error('Markdown 源码覆盖不完整');
  return { parsed, index };
}
export function renderWindow(parsed, start, count, readOnly = false) {
  if (!Number.isSafeInteger(start) || start < 0 || !Number.isSafeInteger(count) || count < 0 || count > 60) throw new Error('Markdown 视口范围无效');
  let size = 0;
  return parsed.blocks.slice(start, start + count).map((block) => {
    const item = { from: block.from, to: block.to, line: block.line, type: block.type };
    // A pathological single block stays as source. The editable document is
    // retained and CodeMirror still virtualizes its lines; no truncated edit.
    if (block.raw.length > 262144) return { ...item, sourceOnly: '此块过大，显示完整源码' };
    if (block.type === 'frontmatter') {
      const metadata = parseFrontmatter(block.raw);
      if (metadata && Array.isArray(metadata.entries)) item.metadata = metadata;
      else item.sourceOnly = 'Frontmatter 没有有效解析结果，显示完整源码';
    }
    else if (block.type === 'mermaid') item.source = codeBody(block);
    else if (block.type === 'code') { const code = highlightedCode(block); item.html = `<pre><code>${code.html}</code></pre>`; item.sourceMap = code.map; }
    else if (block.tokens) item.html = renderMarkdownBlock(block, { ...parsed.env, readOnly });
    if (item.html) {
      size += item.html.length;
      if (size > 2 * 1024 * 1024 || (item.html.match(/</g) ?? []).length > 1000) { delete item.html; item.sourceOnly = '此块预览复杂度超过预算，显示完整源码'; }
      else { const math = markdownMathRanges(block, { ...parsed.env, readOnly }); if (math.length) item.math = math; const inline = markdownInlinePlan(block, { ...parsed.env, readOnly }); if (inline.length) item.inline = inline; }
    }
    return item;
  });
}
