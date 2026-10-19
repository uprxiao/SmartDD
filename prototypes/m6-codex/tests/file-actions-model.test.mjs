import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MISSING_PROTOTYPE_APPLICATION, prototypeApplicationChoices, prototypeOpenApplication, prototypeRevealTarget } from '../src/file-actions-model.mjs';
import { initialWorkspace, openFile, serializeWorkspaceStore } from '../src/file-workspace-model.mjs';

test('E06: explicit remember alone replaces a missing preference and survives workspace serialization', () => {
  const original = MISSING_PROTOTYPE_APPLICATION;
  assert.equal(prototypeApplicationChoices(original).preferredUnavailable, true);
  assert.equal(prototypeApplicationChoices(original).preferred, undefined);
  const once = prototypeOpenApplication(original, 'textedit', false);
  assert.equal(once.ok, true); assert.equal(once.preference, original);
  const remembered = prototypeOpenApplication(original, 'textedit', true);
  assert.equal(remembered.ok, true); assert.equal(prototypeApplicationChoices(remembered.preference).preferred.name, 'TextEdit');
  const scope = openFile(initialWorkspace(), 'main', 'CLAUDE.md');
  const restored = JSON.parse(JSON.stringify(serializeWorkspaceStore({ saved: {}, fileOpener: remembered.preference, scope })));
  assert.deepEqual(restored.fileOpener, remembered.preference);
  assert.deepEqual(restored.scope.tabs.map(tab => tab.path), ['AGENTS.md']);
});
test('E06: failed or missing-target opens never update remembered preferences', () => {
  for (const options of [{ missing: true }, { available: false }]) {
    const result = prototypeOpenApplication(MISSING_PROTOTYPE_APPLICATION, 'code', true, options);
    assert.equal(result.ok, false); assert.equal(result.preference, MISSING_PROTOTYPE_APPLICATION);
  }
});
test('E07: ordinary files, directories and root keep exact parent and selection', () => {
  assert.deepEqual(prototypeRevealTarget('/workspace/SmartDD', 'docs/中文.txt'), { ok: true, path: '/workspace/SmartDD/docs/中文.txt', parent: '/workspace/SmartDD/docs', selected: '中文.txt', directory: false });
  assert.deepEqual(prototypeRevealTarget('/workspace/SmartDD', '', { directory: true }), { ok: true, path: '/workspace/SmartDD', parent: '/workspace', selected: 'SmartDD', directory: true });
  assert.deepEqual(prototypeRevealTarget('/workspace/SmartDD', 'docs', { directory: true }), { ok: true, path: '/workspace/SmartDD/docs', parent: '/workspace/SmartDD', selected: 'docs', directory: true });
});
test('E07: missing or invalid targets fail without returning a fallback path', () => {
  for (const result of [prototypeRevealTarget('/workspace/SmartDD', 'gone.txt', { missing: true }), prototypeRevealTarget('/workspace/SmartDD', '../outside.txt')]) {
    assert.equal(result.ok, false); assert.equal('path' in result, false); assert.equal('parent' in result, false);
  }
});
