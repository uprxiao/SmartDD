import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLANK_URL, AGENT_HOLD_MS, resolveAddress, resolvePage, securityState, hostLabel,
  emptyTaskBrowser, openTab, closeTab, updateTab, navigateTab, goBack, goForward, canGoBack, canGoForward, currentUrl,
  agentCommandStart, agentCommandEnd, agentMarked, agentHoldRemaining, pauseAgent, resumeAgent, endRun, serialize, restore
} from '../src/browser-prototype-model.mjs';

const nav = (input, engine) => resolveAddress(input, engine);

test('R01.1 empty and about:blank open the blank page', () => {
  assert.deepEqual(nav(''), { status: 'navigate', url: BLANK_URL });
  assert.deepEqual(nav('  about:blank '), { status: 'navigate', url: BLANK_URL });
});

test('R01.1 scheme-less local dev addresses get http', () => {
  assert.equal(nav('localhost:5173').url, 'http://localhost:5173/');
  assert.equal(nav('127.0.0.1:8080/api').url, 'http://127.0.0.1:8080/api');
  assert.equal(nav('0.0.0.0:3000').url, 'http://0.0.0.0:3000/');
  assert.equal(nav('[::1]:3000').url, 'http://[::1]:3000/');
});

test('R01.1 dotted domain with port gets https, *.localhost gets http', () => {
  assert.equal(nav('test.corp.com:8080').url, 'https://test.corp.com:8080/');
  assert.equal(nav('app.localhost:3000').url, 'http://app.localhost:3000/');
});

test('R01.1 full http(s) and file URLs pass through; other schemes are invalid', () => {
  assert.equal(nav('https://qa.example.test/orders/1024').url, 'https://qa.example.test/orders/1024');
  assert.equal(nav('file:///tmp/a.html').url, 'file:///tmp/a.html');
  assert.equal(nav('javascript:alert(1)').status, 'invalid');
  assert.equal(nav('data:text/html,hi').status, 'invalid');
  assert.equal(nav('mailto:a@b.c').status, 'invalid');
});

test('R01.1 absolute local paths become file URLs (O1)', () => {
  assert.equal(nav('/Users/me/report v1.html').url, 'file:///Users/me/report%20v1.html');
});

test('R01.1 search fallback follows Orca looksLikeSearchQuery (O2)', () => {
  assert.equal(nav('a.com').url, 'https://a.com/');
  assert.equal(nav('react hooks').url, 'https://www.bing.com/search?q=react%20hooks');
  assert.equal(nav('foo').url, 'https://www.bing.com/search?q=foo');
  assert.equal(nav('foo', 'google').url, 'https://www.google.com/search?q=foo');
  assert.equal(nav('foo', 'unknown').url, 'https://www.bing.com/search?q=foo');
});

test('R01.4 synthetic hosts map to the seven applicable failure kinds', () => {
  const kinds = ['http://localhost:3000/', 'https://refused.example.test/', 'https://nxdomain.example.test/', 'https://timeout.example.test/', 'https://reset.example.test/', 'https://other.example.test/'].map(url => resolvePage(url).failure);
  assert.deepEqual(kinds, ['not-running', 'refused', 'dns', 'timeout', 'reset', 'other']);
  assert.equal(resolvePage('https://qa.example.test/', { offline: true }).failure, 'offline');
});

test('R01.4 a started local server stops failing (auto-reload demo)', () => {
  assert.equal(resolvePage('http://localhost:3000/', { startedServers: ['localhost:3000'] }).kind, 'local-dev');
});

test('synthetic pages never claim real content', () => {
  assert.equal(resolvePage(BLANK_URL).kind, 'blank');
  assert.equal(resolvePage('https://qa.example.test/').kind, 'qa-login');
  assert.equal(resolvePage('https://qa.example.test/orders/1024').kind, 'qa-order');
  assert.equal(resolvePage('https://www.bing.com/search?q=a%20b').query, 'a b');
  assert.equal(resolvePage('file:///tmp/x.html').kind, 'file');
  assert.equal(resolvePage('https://unknown.example.test/').kind, 'generic');
});

test('security state and host label for the address bar', () => {
  assert.equal(securityState('https://qa.example.test/'), 'secure');
  assert.equal(securityState('http://localhost:5173/'), 'local');
  assert.equal(securityState('http://intranet.example.test/'), 'insecure');
  assert.equal(securityState('file:///tmp/a'), 'file');
  assert.equal(hostLabel(BLANK_URL), '');
  assert.equal(hostLabel('file:///tmp/a'), '本机文件');
});

test('tabs: open, navigate, back/forward, close selects a neighbour', () => {
  let state = openTab(emptyTaskBrowser(), 'https://qa.example.test/');
  const first = state.active;
  state = updateTab(state, first, tab => navigateTab(tab, 'https://qa.example.test/orders/1024'));
  let tab = state.tabs[0];
  assert.equal(currentUrl(tab), 'https://qa.example.test/orders/1024');
  assert.ok(canGoBack(tab));
  tab = goBack(tab);
  assert.equal(currentUrl(tab), 'https://qa.example.test/');
  assert.ok(canGoForward(tab));
  assert.equal(currentUrl(goForward(tab)), 'https://qa.example.test/orders/1024');
  assert.equal(navigateTab(tab, 'https://qa.example.test/').history.length, tab.history.length, 'same URL is not pushed twice');
  assert.equal(currentUrl(navigateTab(tab, 'http://localhost:5173/')), 'http://localhost:5173/');
  assert.equal(navigateTab(tab, 'http://localhost:5173/').history.length, 2, 'forward history is dropped after a new navigation');
  state = openTab(state);
  const second = state.active;
  state = closeTab(state, second);
  assert.equal(state.active, first);
  state = closeTab(state, first);
  assert.equal(state.active, null);
});

test('R07.2 agent mark lasts while running and for 20 s after the last command', () => {
  let state = openTab(emptyTaskBrowser());
  const tabId = state.active;
  ({ state } = agentCommandStart(state, tabId, 1000));
  assert.ok(agentMarked(state, tabId, 999_999), 'running keeps the mark');
  state = agentCommandEnd(state, 2000);
  assert.ok(agentMarked(state, tabId, 2000 + AGENT_HOLD_MS - 1));
  assert.equal(agentMarked(state, tabId, 2000 + AGENT_HOLD_MS), false);
  assert.equal(agentHoldRemaining(state, 2000 + 5000), AGENT_HOLD_MS - 5000);
  assert.equal(agentMarked(state, 'other-tab', 2000), false);
});

test('R07.6 pause rejects new commands, interrupts a running read-only wait, lets a write finish', () => {
  let state = openTab(emptyTaskBrowser());
  const tabId = state.active;
  ({ state } = agentCommandStart(state, tabId, 1000, { kind: 'read' }));
  let paused = pauseAgent(state);
  assert.equal(paused.interrupted, 'BROWSER_PAUSED');
  assert.equal(paused.state.agent.running, false);
  assert.equal(agentCommandStart(paused.state, tabId, 1500).outcome, 'BROWSER_PAUSED');
  state = resumeAgent(paused.state);
  ({ state } = agentCommandStart(state, tabId, 2000, { kind: 'write' }));
  paused = pauseAgent(state);
  assert.equal(paused.interrupted, null);
  assert.equal(paused.state.agent.running, true, 'a started write command finishes');
  assert.equal(pauseAgent(paused.state).state, paused.state, 'pausing twice is a no-op');
});

test('R07.6 ending the run clears pause and the activity mark (not persisted)', () => {
  let state = openTab(emptyTaskBrowser());
  ({ state } = agentCommandStart(state, state.active, 1));
  state = endRun(pauseAgent(state).state);
  assert.equal(state.paused, false);
  assert.equal(state.agent, null);
});

test('R01.9 persistence keeps only tab addresses and the active index', () => {
  let state = openTab(emptyTaskBrowser(), 'https://qa.example.test/');
  state = openTab(state, 'http://localhost:5173/');
  ({ state } = agentCommandStart(pauseAgent(state).state, state.active, 1));
  const saved = serialize({ t1: state });
  assert.deepEqual(saved, { t1: { tabs: [{ url: 'https://qa.example.test/', profile: 'project' }, { url: 'http://localhost:5173/', profile: 'project' }], active: 1 } });
  const restored = restore(JSON.parse(JSON.stringify(saved))).t1;
  assert.equal(restored.tabs.length, 2);
  assert.equal(currentUrl(restored.tabs[1]), 'http://localhost:5173/');
  assert.equal(restored.active, restored.tabs[1].id);
  assert.equal(restored.paused, false);
  assert.equal(restored.agent, null);
  assert.deepEqual(restore('broken'), {});
  assert.deepEqual(restore({ t: { tabs: [null, { url: 3 }] } }).t.tabs, []);
});
