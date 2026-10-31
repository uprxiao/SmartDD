import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cleanupRecoveryPreview} from '../src/cleanup-recovery-preview.mjs';
for (const scene of ['original', 'moved']) test('complete '+scene+' remains unavailable until explicit cancellation', () => {
  assert.equal(cleanupRecoveryPreview(scene).state, 'deleting');
  assert.equal(cleanupRecoveryPreview(scene).canCancel, true);
  assert.equal(cleanupRecoveryPreview(scene, true).state, 'ready');
});
for (const scene of ['partial', 'occupied', 'unknown']) test(scene+' cannot become ready by requesting cancellation', () => {
  assert.equal(cleanupRecoveryPreview(scene, true).state, 'deleting');
  assert.equal(cleanupRecoveryPreview(scene, true).canCancel, false);
});
