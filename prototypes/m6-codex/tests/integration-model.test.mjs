import test from 'node:test';
import assert from 'node:assert/strict';
import { initialIntegrationState, projectIntegrationState, validateConnection, availableConnections, saveConnection, referenceText } from '../src/integration-model.mjs';

test('projection drops passwords, tokens, unknown apps and dangling project bindings', () => {
  const source = initialIntegrationState();
  source.connections[0].password = 'sensitive-marker'; source.connections[0].token = 'sensitive-marker';
  source.connections.push({ id: 'unknown', app: 'arbitrary-code', password: 'sensitive-marker' });
  source.installed.push('arbitrary-code'); source.bindings.ais.push('missing', 'unknown');
  const result = projectIntegrationState(source);
  assert.ok(!JSON.stringify(result).includes('sensitive-marker'));
  assert.equal(result.connections.length, 2); assert.deepEqual(result.bindings.ais, ['zt-demo', 'fox-demo']);
});
test('availability checks current project binding, connection health and application installation', () => {
  const source = initialIntegrationState();
  assert.equal(availableConnections(source, 'ais').length, 2); assert.equal(availableConnections(source, 'smartdd').length, 1);
  source.connections[0].enabled = false; assert.equal(availableConnections(source, 'smartdd').length, 0);
  source.connections[1].validation = 'disconnected'; assert.equal(availableConnections(source, 'ais').length, 0);
});
test('editing a paused connection keeps it paused and stores a credential-presence flag only', () => {
  const source = initialIntegrationState(); source.connections[0].enabled = false;
  const next = saveConnection(source, { ...source.connections[0], name: 'changed', password: 'must-not-store' }, true);
  assert.equal(next.connections[0].enabled, false); assert.equal(next.connections[0].revision, 2);
  assert.equal(next.connections[0].credentialPresent, true); assert.ok(!JSON.stringify(next).includes('must-not-store'));
});
test('ZenTao config rejects embedded secrets, query strings and non-HTTP addresses', () => {
  const base = { ...initialIntegrationState().connections[0] };
  for (const url of ['file:///etc/passwd', 'https://user:secret@host/biz', 'https://host/biz?token=value', 'not-a-url']) assert.ok(validateConnection({ ...base, url }));
  assert.equal(validateConnection(base), '');
});
test('local mailbox needs an absolute source and never needs a password', () => {
  const base = initialIntegrationState().connections[1];
  assert.equal(validateConnection(base), ''); assert.ok(validateConnection({ ...base, path: 'relative/path' }));
  assert.ok(validateConnection({ ...base, path: '/tmp/a\nother' }));
});
test('sender validates account, service and integer port separately from local reading', () => {
  const base = { name: 'sender', kind: 'smtp', host: 'smtp.example.invalid', port: 465, account: 'demo@example.invalid' };
  assert.equal(validateConnection(base, 'synthetic'), ''); assert.ok(validateConnection(base));
  for (const port of [0, 65536, 1.1, 'bad']) assert.ok(validateConnection({ ...base, port }, 'synthetic'));
  assert.ok(validateConnection({ ...base, host: 'a/b' }, 'synthetic'));
});
test('object references preserve Bug/Story namespace and contain no executable control characters', () => {
  const bug = referenceText('bug', 812), story = referenceText('story', 812);
  assert.notEqual(bug, story); assert.match(bug, /\/bug\/812/); assert.match(story, /\/story\/812/);
  assert.ok(!/[\x00-\x1f\x7f]/.test(referenceText('mail', 'm-101')));
  assert.match(referenceText('story', 146, 'new-connection'), /zentao:\/\/new-connection\/story\/146/);
});
test('new prototype projects keep bindings through persistence projection', () => {
  const source = initialIntegrationState(); source.bindings['preview-new-project'] = ['zt-demo'];
  const result = projectIntegrationState(source);
  assert.equal(availableConnections(result, 'preview-new-project').length, 1);
});
