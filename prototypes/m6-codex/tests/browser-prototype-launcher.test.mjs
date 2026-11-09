import test from 'node:test';
import assert from 'node:assert/strict';
import { BLANK_URL, RECENT_SITE_LIMIT, emptyTaskBrowser, openTab, updateTab, recordVisit, recentSites, serialize, restore } from '../src/browser-prototype-model.mjs';

const visitAll = (visits, entries) => entries.reduce((list, [url, at]) => recordVisit(list, url, at), visits);

test('R01.11 recommendations follow real visit time across tasks (review R09: T1 visits A, B, then T2 visits C)', () => {
  const visits = visitAll([], [['https://a.example.test/', 1], ['https://b.example.test/', 2], ['https://c.example.test/', 3]]);
  assert.deepEqual(recentSites(visits).map(site => site.host), ['c.example.test', 'b.example.test', 'a.example.test']);
});

test('R01.11 revisiting a host moves it to the front and keeps one entry per host', () => {
  const visits = visitAll([], [['https://a.example.test/', 1], ['https://b.example.test/', 2], ['https://a.example.test/orders', 3]]);
  assert.deepEqual(recentSites(visits).map(site => [site.host, site.url]), [['a.example.test', 'https://a.example.test/orders'], ['b.example.test', 'https://b.example.test/']]);
});

test('R01.11 blank and search pages are not recorded, and the list is bounded', () => {
  assert.deepEqual(visitAll([], [[BLANK_URL, 1], ['https://www.bing.com/search?q=x', 2]]), []);
  const many = visitAll([], Array.from({ length: RECENT_SITE_LIMIT + 3 }, (_, i) => [`https://s${i}.example.test/`, i]));
  assert.equal(recentSites(many).length, RECENT_SITE_LIMIT);
  assert.equal(recentSites(many)[0].host, `s${RECENT_SITE_LIMIT + 2}.example.test`);
});

test('R01.11 the log survives a JSON round trip (restart) and closing tabs does not affect it', () => {
  const visits = visitAll([], [['https://a.example.test/', 1], ['https://b.example.test/', 2]]);
  assert.deepEqual(recentSites(JSON.parse(JSON.stringify(visits))).map(site => site.host), ['b.example.test', 'a.example.test']);
});

test('C1 a tab bound to a task profile stays bound after reload (review R08)', () => {
  let state = openTab(emptyTaskBrowser(), 'https://qa.example.test/');
  state = updateTab(state, state.active, tab => ({ ...tab, profile: 'profile-mw0cryrj-2' }));
  const restored = restore(JSON.parse(JSON.stringify(serialize({ t1: state }))));
  assert.equal(restored.t1.tabs[0].profile, 'profile-mw0cryrj-2');
  const tampered = restore({ t1: { tabs: [{ url: 'https://qa.example.test/', profile: '../other-project' }], active: 0 } });
  assert.equal(tampered.t1.tabs[0].profile, 'project');
});

import { projectProfiles, recordImport, markRecoveryFailed, needsAttention, resolveRecovery, clearProfileLogin } from '../src/browser-prototype-model.mjs';

test('R06.4 a failed rollback marks the profile; retry clears the mark and keeps the import record (review3 F09)', () => {
  const store = markRecoveryFailed(recordImport(projectProfiles('P'), 'project', 'Chrome', 'Profile 1', 1), 'project', 1);
  assert.equal(needsAttention(store, 'project'), true);
  const retried = resolveRecovery(store, 'project');
  assert.equal(needsAttention(retried, 'project'), false);
  assert.equal(retried.sources.project.browser, 'Chrome');
});

test('R06.4 clearing the login of a profile that needs attention also drops its import record', () => {
  const cleared = clearProfileLogin(markRecoveryFailed(recordImport(projectProfiles('P'), 'project', 'Edge', 'Default', 1), 'project'), 'project');
  assert.equal(needsAttention(cleared, 'project'), false);
  assert.equal(cleared.sources.project, undefined);
  assert.equal(cleared.profiles.length, 1);
});

import { emptyTaskBrowser as emptyBrowser, openTab as openBrowserTab, agentCommandStart, importOutcome } from '../src/browser-prototype-model.mjs';

test('R06.4 the Agent is refused with BROWSER_UNAVAILABLE while the profile needs attention (review4 G04)', () => {
  const state = openBrowserTab(emptyBrowser(), 'https://qa.example.test/');
  assert.equal(agentCommandStart(state, state.active, 1, { unavailable: true }).outcome, 'BROWSER_UNAVAILABLE');
  assert.equal(agentCommandStart(state, state.active, 1, { unavailable: false }).outcome, 'started');
});

test('R06.4 the import summary reports reloaded pages and no conflict count', () => {
  const summary = importOutcome('allow').summary;
  assert.equal(typeof summary.reloadedPages, 'number');
  assert.equal('conflicts' in summary, false);
});
