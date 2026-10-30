import test from 'node:test';
import assert from 'node:assert/strict';
import { initialWorkspace, openFile, closeFile, restoreFile, fileKey, serializeWorkspaceStore, editDraft, commitDraft } from '../src/file-workspace-model.mjs';

const fixture = () => {
  const opened = openFile(initialWorkspace(), 'main', '附件回调示例.txt', true);
  const attachment = { key: 'synthetic-host', onDownload: () => {}, onClose: () => {} };
  return { ...opened, tabs: opened.tabs.map(tab => tab.path === '附件回调示例.txt' ? { ...tab, attachment } : tab) };
};
test('D20 prototype projection excludes callback attachments, active route and closed entries from JSON', () => {
  const state = fixture(), attachment = state.tabs.at(-1), ordinary = state.tabs[0];
  const output = serializeWorkspaceStore({ saved: {}, fileOpener: 'TextEdit', scope: { ...state, closed: [attachment, { ...ordinary, index: 0 }] } });
  const persisted = JSON.parse(JSON.stringify(output));
  assert.deepEqual(persisted.scope.tabs, [{ root: 'main', path: 'AGENTS.md', preview: false }]);
  assert.deepEqual(persisted.scope.closed, [{ root: 'main', path: 'AGENTS.md', preview: false, index: 0 }]);
  assert.equal(persisted.scope.active, fileKey('main', 'AGENTS.md'));
  assert.doesNotMatch(JSON.stringify(output), /attachment|onDownload|onClose|synthetic-host|附件回调/);
});
test('D20 prototype ordinary close remains restorable; callback attachment never enters undo-close', () => {
  const state = fixture(), key = fileKey('main', '附件回调示例.txt');
  const closed = closeFile(state, key); assert.equal(closed.closed.length, 0); assert.equal(restoreFile(closed), closed);
  const ordinary = closeFile(closed, fileKey('main', 'AGENTS.md')); assert.equal(ordinary.closed.length, 1);
  assert.equal(restoreFile(ordinary).tabs[0].path, 'AGENTS.md');
});
test('D20 prototype attachment remains read-only even if an edit/save call bypasses the disabled view', () => {
  const state = fixture(), key = state.active;
  assert.equal(editDraft(state, key, 'changed', 'base'), state);
  const store = { saved: {}, scope: { ...state, drafts: { [key]: { text: 'must not write', base: 'base' } } } };
  const result = commitDraft(store, 'scope', [{ id: 'main', path: '/synthetic' }], key, { override: true });
  assert.equal(result.result, 'readonly'); assert.equal(result.store, store);
});
