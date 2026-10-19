import test from 'node:test';
import assert from 'node:assert/strict';
import { initialIntegrationState, projectIntegrationState, validateConnection, availableConnections, saveConnection, referenceText, packageVersion, projectPackages, toggleProjectApplication, integrationSnapshot, snapshotCurrent, simulatePackageUpgrade } from '../src/integration-model.mjs';

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

test('old saved configurations gain package metadata without replacing connections or project bindings', () => {
  const source = initialIntegrationState(), saved = JSON.parse(JSON.stringify(source));
  const restored = projectIntegrationState(saved);
  assert.equal(packageVersion(restored, 'zentao'), '1.0.0');
  assert.equal(restored.dataSchema, 1);
  assert.deepEqual(restored.connections, saved.connections);
  assert.deepEqual(restored.bindings, saved.bindings);
});

test('project application enablement bundles skills once and never enables pending external writes', () => {
  const source = initialIntegrationState();
  source.connections.push({ ...source.connections[0], id: 'second-zen' });
  source.bindings.ais.push('second-zen');
  const bundles = projectPackages(source, 'ais');
  assert.equal(bundles.filter(p => p.id === 'zentao').length, 1);
  assert.equal(bundles[0].skills.length, 2);
  assert.equal(bundles[0].connections.length, 2);
  assert.ok(!bundles[0].tools.includes('object.transition'));
  assert.deepEqual(bundles.find(p => p.id === 'mail').tools, ['mail.search', 'mail.read']);
});

test('application disablement preserves connection data and other projects; re-enabling only selects ready sources', () => {
  const source = initialIntegrationState();
  source.connections.push({ ...source.connections[0], id: 'paused-zen', enabled: false }, { ...source.connections[0], id: 'other-account' });
  const disabled = toggleProjectApplication(source, 'ais', 'zentao', false);
  assert.deepEqual(disabled.bindings.ais, ['fox-demo']);
  assert.deepEqual(disabled.bindings.smartdd, ['zt-demo']);
  assert.deepEqual(disabled.connections, source.connections);
  assert.equal(projectPackages(disabled, 'ais').some(p => p.id === 'zentao'), false);
  const enabled = toggleProjectApplication(disabled, 'ais', 'zentao', true);
  assert.ok(enabled.bindings.ais.includes('zt-demo'));
  assert.ok(!enabled.bindings.ais.includes('paused-zen'));
  assert.ok(!enabled.bindings.ais.includes('other-account'));
  const uninstalled = { ...disabled, installed: ['mail'] };
  assert.deepEqual(toggleProjectApplication(uninstalled, 'ais', 'zentao', true).bindings.ais, ['fox-demo']);
});

test('session snapshots become stale for connection edits, app upgrades, revocation and project switches', () => {
  const source = projectIntegrationState(initialIntegrationState());
  const snapshot = integrationSnapshot(source, 'ais');
  assert.ok(snapshotCurrent(snapshot, source, 'ais'));
  assert.equal(snapshotCurrent(snapshot, source, 'smartdd'), false);
  const edited = { ...source, connections: source.connections.map(c => ({ ...c, revision: c.revision + 1 })) };
  assert.equal(snapshotCurrent(snapshot, edited, 'ais'), false);
  assert.equal(snapshotCurrent(snapshot, simulatePackageUpgrade(source).state, 'ais'), false);
  assert.equal(snapshotCurrent(snapshot, toggleProjectApplication(source, 'ais', 'mail', false), 'ais'), false);
});

test('simulated upgrade preserves all local records; a failed migration leaves the original state untouched', () => {
  const source = projectIntegrationState(initialIntegrationState());
  source.activity.push({ id: 'existing-invocation', app: 'zentao', operation: '读取', status: 'success', project: 'ais', connectionId: 'zt-demo', at: '10:30' });
  const before = JSON.stringify(source), failed = simulatePackageUpgrade(source, true);
  assert.equal(failed.ok, false); assert.equal(failed.state, source);
  assert.equal(JSON.stringify(source), before);
  const upgrade = simulatePackageUpgrade(source);
  assert.equal(upgrade.ok, true); assert.equal(upgrade.state.dataSchema, 2);
  assert.equal(packageVersion(upgrade.state, 'zentao'), '1.1.0');
  for (const key of ['connections', 'bindings', 'activity', 'installed']) assert.deepEqual(upgrade.state[key], source[key]);
  assert.equal(JSON.stringify(source), before);
  assert.equal(packageVersion(projectIntegrationState(upgrade.state), 'mail'), '1.1.0');
});
