import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReference, formatReference, formatReferenceTray } from '../src/file-reference-model.mjs';
const reference = { kind: 'pdf-comment', relativePath: '目录/内容.pdf', pdf: { page: 2, anchor: { x: 0.125, y: 0.25, width: 0.375, height: 0.5 } }, note: '请核对🙂', revision: 1 };
test('PDF tray retains actual page/region and selected text without source line labels', () => {
  assert.equal(normalizeReference(reference).ok, true);
  for (const style of ['plain', 'at']) {
    const formatted = formatReference(reference, { style, includeText: true, selectedText: '原文🙂' });
    assert.equal(formatted.ok, true); assert.match(formatted.text, /第 2 页 · 区域 12.5%, 25%, 37.5%, 50%/);
    assert.match(formatted.text, /> 请核对🙂/); assert.match(formatted.text, /    原文🙂/); assert.doesNotMatch(formatted.text, /\bL\d/);
  }
  const built = formatReferenceTray([{ ref: reference, selectedText: '第一处' }, { ref: { ...reference, pdf: { ...reference.pdf, page: 3 } }, selectedText: '第二处' }], { includeText: true });
  assert.equal(built.ok, true); assert.match(built.text, /第 2 页/); assert.match(built.text, /第 3 页/);
});
test('PDF location accepts points and rejects out-of-page, non-finite, line-shaped or fake-line comments', () => {
  assert.equal(normalizeReference({ ...reference, pdf: { page: 1, anchor: { x: 0, y: 1, width: 0, height: 0 } } }).ok, true);
  for (const pdf of [{ page: 0, anchor: reference.pdf.anchor }, { page: 1.5, anchor: reference.pdf.anchor }, { page: 2, anchor: { x: 0.9, y: 0, width: 0.2, height: 0.1 } }, { page: 2, anchor: { x: NaN, y: 0, width: 0, height: 0 } }, { page: 2, anchor: { x: 0, y: 0, width: 0, height: 0.5 } }]) assert.equal(normalizeReference({ ...reference, pdf }).ok, false);
  assert.equal(normalizeReference({ ...reference, range: { startLine: 1, endLine: 1 } }).ok, false);
  assert.equal(normalizeReference({ ...reference, note: '' }).ok, false);
});
