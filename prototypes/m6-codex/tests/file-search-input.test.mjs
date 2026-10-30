import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampFileSearchInput } from '../../../src/shared/file-search-input.mjs';
import { normalizeSearchHistory } from '../src/file-search-history-model.mjs';
test('P R08 shares whole-codepoint256 limit and refuses malformed/oversized history', () => {
  for (const length of [255, 256, 257]) assert.equal(clampFileSearchInput('中'.repeat(length)), '中'.repeat(Math.min(length, 256)));
  assert.equal(clampFileSearchInput('中'.repeat(255) + '🙂'), '中'.repeat(255));
  assert.deepEqual(normalizeSearchHistory({ queries: ['good', 'x\ud800'], masks: ['*.ts', 'x'.repeat(257)] }), { queries: ['good'], masks: ['*.ts'] });
});
