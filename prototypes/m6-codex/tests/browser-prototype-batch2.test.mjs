import test from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeDownloadName, downloadCollisionCandidate, uniqueDownloadName, resolvePage,
  projectProfiles, createTaskProfile, cloneProfile, deleteProfile, addCertException, removeCertException,
  rememberPermission, permissionDecision, revokePermission, crossTaskDecision, grantCrossTask, revokeCrossTask,
  importOutcome, recordImport, emptyTaskBrowser, openTab, updateTab, endRun
} from '../src/browser-prototype-model.mjs';

test('R01.7 download names follow Orca sanitizing rules', () => {
  assert.equal(sanitizeDownloadName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeDownloadName('C:\\Users\\a\\report.csv'), 'report.csv');
  assert.equal(sanitizeDownloadName('a<b>c:d"e|f?g*h.txt'), 'a_b_c_d_e_f_g_h.txt');
  assert.equal(sanitizeDownloadName('name\u0001.txt'), 'name_.txt');
  assert.equal(sanitizeDownloadName('trail. . '), 'trail');
  assert.equal(sanitizeDownloadName(''), 'download');
  assert.equal(sanitizeDownloadName('..'), 'download');
});

test('R01.7 collisions append " (n)" before the extension', () => {
  assert.equal(downloadCollisionCandidate('orders.csv', 0), 'orders.csv');
  assert.equal(downloadCollisionCandidate('orders.csv', 2), 'orders (2).csv');
  assert.equal(downloadCollisionCandidate('.env', 1), '.env (1)');
  assert.equal(uniqueDownloadName('orders.csv', ['orders.csv', 'orders (1).csv']), 'orders (2).csv');
});

test('B05 certificate error until the user adds a per-host exception (O3)', () => {
  assert.equal(resolvePage('https://selfsigned.example.test/').kind, 'cert-error');
  assert.equal(resolvePage('https://selfsigned.example.test/', { certAllowed: ['selfsigned.example.test'] }).kind, 'cert-continued');
  let store = projectProfiles('WillYou');
  store = addCertException(store, 'project', 'selfsigned.example.test');
  assert.deepEqual(store.certExceptions.project, ['selfsigned.example.test']);
  assert.equal(addCertException(store, 'project', 'selfsigned.example.test'), store, 'idempotent');
  assert.deepEqual(removeCertException(store, 'project', 'selfsigned.example.test').certExceptions.project, []);
});

test('B06 HTTP basic auth host until the user signs in', () => {
  assert.equal(resolvePage('https://auth.example.test/').kind, 'http-auth');
  assert.equal(resolvePage('https://auth.example.test/', { authed: ['auth.example.test'] }).kind, 'auth-ok');
});

test('O4 site permissions are remembered per site and revocable', () => {
  let store = projectProfiles('WillYou');
  assert.equal(permissionDecision(store, 'project', 'qa.example.test', 'geolocation'), 'ask');
  store = rememberPermission(store, 'project', 'qa.example.test', 'geolocation', 'allow');
  assert.equal(permissionDecision(store, 'project', 'qa.example.test', 'geolocation'), 'allow');
  assert.equal(permissionDecision(store, 'other', 'qa.example.test', 'geolocation'), 'ask', 'other profiles are isolated');
  store = revokePermission(store, 'project', 'qa.example.test', 'geolocation');
  assert.deepEqual(store.permissions.project, {});
});

test('C1/R05 task profiles: create, clone (copies exceptions/permissions), delete falls back to the project profile', () => {
  let store = projectProfiles('WillYou');
  store = addCertException(store, 'project', 'selfsigned.example.test');
  const created = createTaskProfile(store, '复现 Bug #1025');
  store = created.store;
  assert.equal(store.profiles.length, 2);
  const cloned = cloneProfile(store, 'project');
  store = cloned.store;
  assert.deepEqual(store.certExceptions[cloned.id], ['selfsigned.example.test']);
  let tasks = { t: updateTab(openTab(emptyTaskBrowser()), 'x', tab => tab) };
  tasks.t = { ...tasks.t, tabs: tasks.t.tabs.map(tab => ({ ...tab, profile: created.id })) };
  const removed = deleteProfile(store, tasks, created.id);
  assert.equal(removed.store.profiles.some(item => item.id === created.id), false);
  assert.equal(removed.browserByTask.t.tabs[0].profile, 'project');
  assert.equal(deleteProfile(store, tasks, 'project').store, store, 'project profile cannot be deleted');
});

test('P4 cross-task: same project asks, other projects and unattended runs are denied', () => {
  assert.deepEqual(crossTaskDecision({ sameProject: true, unattended: false }), { outcome: 'ask' });
  assert.equal(crossTaskDecision({ sameProject: false, unattended: false }).code, 'SCOPE_DENIED');
  assert.equal(crossTaskDecision({ sameProject: true, unattended: true }).code, 'SCOPE_DENIED');
  let state = grantCrossTask(emptyTaskBrowser(), { taskId: 'b', title: 'B', mode: 'observe' });
  state = grantCrossTask(state, { taskId: 'b', title: 'B', mode: 'control' });
  assert.deepEqual(state.grants, [{ taskId: 'b', title: 'B', mode: 'control' }], 'a new grant replaces the old one for that task');
  assert.deepEqual(revokeCrossTask(state, 'b').grants, []);
  assert.deepEqual(endRun(state).grants, state.grants, 'endRun itself keeps grants; the UI clears them with the run');
});

test('B13 import outcomes: keychain denied/timeout write nothing; success excludes Google', () => {
  assert.equal(importOutcome('denied').ok, false);
  assert.equal(importOutcome('timeout').ok, false);
  const ok = importOutcome('allow');
  assert.equal(ok.summary.importedCookies + ok.summary.skippedCookies, ok.summary.totalCookies);
  assert.ok(ok.summary.googleCookiesSkipped > 0);
  const undecryptable = importOutcome('undecryptable');
  assert.equal(undecryptable.ok, false);
  assert.equal(undecryptable.summary, undefined);
  assert.match(undecryptable.reason, /无法解密.*尚未写入/);
  const store = recordImport(projectProfiles('WillYou'), 'project', 'Google Chrome', 'Default', 1);
  assert.deepEqual(store.sources.project, { browser: 'Google Chrome', profileName: 'Default', importedAt: 1 });
});
