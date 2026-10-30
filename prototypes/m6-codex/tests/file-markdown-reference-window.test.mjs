import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, renderMarkdownBlock } from '../src/file-markdown-model.mjs';
import { referenceWindowCases, referenceWindowFixture } from '../../../scripts/files/markdown-reference-fixtures.mjs';
test('shared prototype follows the real 131072-unit image window without truncating full source', () => {
 for (const scenario of referenceWindowCases) {
  const { source } = referenceWindowFixture(scenario.end, scenario), parsed = parseMarkdown(source), html = parsed.blocks.map(block => block.tokens ? renderMarkdownBlock(block, parsed.env) : '').join('');
  assert.equal((html.match(/data-md-src=/g) ?? []).length, scenario.imageCount, scenario.name); assert.equal(parsed.blocks.map(x => x.raw).join(''), source);
 }
});
