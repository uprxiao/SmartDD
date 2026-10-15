import test from 'node:test';
import assert from 'node:assert/strict';
import { makeProject, saveResource, removeResource, safeSecretFields } from '../src/preview-model.mjs';

test('code directory defaults follow edits and removal without changing other projects', () => {
  const ais = makeProject({ id: 'ais', path: '/workspace/AIS' });
  const second = makeProject({ id: 'second', path: '/workspace/second' });
  const next = saveResource(ais, 'dirs', { id: 'd2', path: '/workspace/AIS/backend', isDefault: true });
  assert.equal(next.path, '/workspace/AIS/backend');
  assert.equal(next.dirs.filter(d => d.isDefault).length, 1);
  assert.equal(ais.path, '/workspace/AIS');
  assert.equal(second.path, '/workspace/second');
  const removed = removeResource(next, 'dirs', 'd2');
  assert.equal(removed.path, '/workspace/AIS');
  assert.equal(removed.dirs[0].isDefault, true);
  assert.equal(removed.configVersion, 3);
});

test('removing the last directory makes the project unavailable for launch', () => {
  const project = makeProject({ id: 'ais', path: '/workspace/AIS' });
  const next = removeResource(project, 'dirs', project.dirs[0].id);
  assert.equal(next.path, '');
  assert.deepEqual(next.dirs, []);
});

test('database defaults are separate for each environment', () => {
  let project = makeProject({ id: 'ais' });
  project = saveResource(project, 'databases', { id: 'dev1', env: 'dev', isDefault: true });
  project = saveResource(project, 'databases', { id: 'prod1', env: 'prod', isDefault: true });
  project = saveResource(project, 'databases', { id: 'dev2', env: 'dev', isDefault: true });
  assert.deepEqual(project.databases.filter(d => d.isDefault).map(d => d.id), ['prod1', 'dev2']);
});

test('saved passwords survive keep, clear explicitly, and never enter prototype model', () => {
  const before = { hasPassword: true, hasPassphrase: true, hasSudoPassword: false };
  const next = safeSecretFields({ passwordMode: 'keep', password: 'discard', passphraseMode: 'clear', sudoPasswordMode: 'replace', sudoPassword: 'demo-only' }, before);
  assert.deepEqual(next, { hasPassword: true, hasPassphrase: false, hasSudoPassword: true });
  assert.equal(JSON.stringify(next).includes('demo-only'), false);
});

test('empty replacement is not reported as a saved credential', () => {
  assert.equal(safeSecretFields({ passwordMode: 'replace', password: '' }, { hasPassword: true }).hasPassword, false);
});
