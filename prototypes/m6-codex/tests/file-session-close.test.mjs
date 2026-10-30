import test from 'node:test';
import assert from 'node:assert/strict';
import { fileKey, initialWorkspace, openFile, workspaceScope, documentKey, preparePrototypeTaskClose, setFileScenario } from '../src/file-workspace-model.mjs';

function fixture() {
  const roots = [{ id: 'main', hostId: 'local', path: '/public/synthetic' }];
  const own = workspaceScope('close-owned', roots), other = workspaceScope('close-other', roots), key = fileKey('main', 'one.txt');
  const state = openFile(initialWorkspace('main'), 'main', 'one.txt', true);
  state.drafts[key] = { base: 'BASE', text: 'LOCAL' };
  state.recoveryMaterial = { current: 'current-kept', displaced: 'displaced-kept' };
  const store = { saved: { [documentKey(roots, key)]: 'BASE' }, [own]: state, [other]: structuredClone(state) };
  return { roots, own, other, key, store };
}
test('synthetic save/close prepares only this task and preserves routes and recovery data', () => {
  const f = fixture(), outcome = preparePrototypeTaskClose(f.store, 'close-owned');
  assert.equal(outcome.ready, true);
  assert.equal(outcome.store.saved[documentKey(f.roots, f.key)], 'LOCAL');
  assert.deepEqual(outcome.store[f.own].drafts, {});
  assert.deepEqual(outcome.store[f.own].tabs, f.store[f.own].tabs);
  assert.deepEqual(outcome.store[f.own].recoveryMaterial, f.store[f.own].recoveryMaterial);
  assert.equal(outcome.store[f.other], f.store[f.other]);
});
test('synthetic conflict keeps the same draft and refuses close', () => {
  const f = fixture(); f.store[f.own] = setFileScenario(f.store[f.own], f.key, 'conflict', 'EXTERNAL');
  const outcome = preparePrototypeTaskClose(f.store, 'close-owned');
  assert.equal(outcome.ready, false); assert.equal(outcome.canDiscard, true);
  assert.deepEqual(outcome.store[f.own].drafts[f.key], { base: 'BASE', text: 'LOCAL' });
  assert.equal(outcome.store[f.other], f.store[f.other]);
  assert.equal(outcome.store.saved[documentKey(f.roots, f.key)], 'BASE');
});
test('explicit synthetic discard clears only this task drafts and keeps all recovery material', () => {
  const f = fixture(), outcome = preparePrototypeTaskClose(f.store, 'close-owned', 'discard');
  assert.equal(outcome.ready, true); assert.deepEqual(outcome.store[f.own].drafts, {});
  assert.deepEqual(outcome.store[f.own].recoveryMaterial, f.store[f.own].recoveryMaterial);
  assert.equal(outcome.store.saved[documentKey(f.roots, f.key)], 'BASE');
  assert.equal(outcome.store[f.other], f.store[f.other]);
});
