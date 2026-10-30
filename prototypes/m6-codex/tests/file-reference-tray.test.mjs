import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../src/file-reference-model.mjs';

test('tray validates the aggregate including separators, reports the exact total and rejects missing sources', () => {
 assert.equal(typeof model.formatReferenceTray, 'function');
 for (const size of [7999, 8000, 8001]) {
  const items = [{ ref: { kind: 'range', relativePath: 'a', range: { startLine: 1, endLine: 1 } }, selectedText: '中'.repeat(3990) }, { ref: { kind: 'range', relativePath: 'b', range: { startLine: 1, endLine: 1 } }, selectedText: 'i'.repeat(size - 3990 - 20) }];
  const value = model.formatReferenceTray(items, { includeText: true, style: 'plain' });
  assert.equal(value.ok, size <= 8000);
  if (size <= 8000) assert.equal(value.text.length, size); else assert.deepEqual(value, { ok: false, error: 'too-large', length: size });
 }
 const item = { ref: { kind: 'file', relativePath: 'a' } };
 assert.equal(model.formatReferenceTray([item], {}, () => ({ missing: true })).error, 'missing-source');
 assert.equal(model.formatReferenceTray([item], {}, () => ({ revision: 'changed' })).ok, true);
 for (const relativePath of ['../a', 'C:/a', 'a\0b']) assert.equal(model.formatReferenceTray([{ ref: { kind: 'file', relativePath } }]).error, 'invalid-path');
});

test('a captured initial revision zero becomes stale after an edit', () => {
 assert.equal(model.referenceStaleness({ revision: 0 }, { revision: 1 }), 'stale');
 assert.equal(model.referenceStaleness({ revision: 0 }, { revision: 0 }), 'fresh');
});
