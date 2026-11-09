// M12 browser prototype model. Synthetic only: no network, no real cookies, no real agent.
// Address rules follow Orca bd9455b6165 src/shared/browser-url.ts (normalizeBrowserNavigationUrl).

export const BLANK_URL = 'willyou://newtab';
export const AGENT_HOLD_MS = 20_000; // Orca browser-agent-activity.ts ACTIVITY_IDLE_MS
export const STORAGE_KEY = 'willyou-m12-prototype-v1';

export const SEARCH_ENGINES = {
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  kagi: { label: 'Kagi', url: 'https://kagi.com/search?q=' }
};

const LOCAL_ADDRESS = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i;
const LOOKS_LIKE_URL = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i;
const UNIX_PATH = /^\/.*$/;
const WINDOWS_PATH = /^[A-Za-z]:[\\/].*$/;

function validDnsName(name) {
  if (!name || name.length > 253) return false;
  return name.split('.').every(label => label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
}

function domainPortAddress(input) {
  const match = /^([^\s/\\:@?#]+):\d+(?:[/?#].*)?$/.exec(input);
  if (!match || !match[1].includes('.')) return null;
  try {
    const url = new URL('https://' + input);
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!validDnsName(host)) return null;
    return host.endsWith('.localhost') ? new URL('http://' + input).toString() : url.toString();
  } catch {
    return null;
  }
}

export function looksLikeSearchQuery(input) {
  if (input.includes(' ')) return true;
  if (LOOKS_LIKE_URL.test(input)) return false;
  if (input.includes('.') || input.includes(':')) return false;
  return true;
}

function pathToFileUrl(path) {
  const normalized = path.replaceAll('\\', '/');
  const parts = normalized.split('/').map((segment, index) => (index === 0 && /^[A-Za-z]:$/.test(segment) ? segment : encodeURIComponent(segment)));
  return normalized.startsWith('/') ? 'file://' + parts.join('/') : 'file:///' + parts.join('/');
}

/** Address-bar submission (R01.1). Returns { status:'navigate', url } or { status:'invalid', message }. */
export function resolveAddress(raw, engine = 'bing') {
  const trimmed = String(raw ?? '').trim();
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return { status: 'invalid', message: '请输入有效的 http(s) 或 localhost 地址' };
  if (!trimmed || trimmed === 'about:blank' || trimmed === BLANK_URL) return { status: 'navigate', url: BLANK_URL };
  if (LOCAL_ADDRESS.test(trimmed)) return { status: 'navigate', url: new URL('http://' + trimmed).toString() };
  if (UNIX_PATH.test(trimmed) || WINDOWS_PATH.test(trimmed)) return { status: 'navigate', url: pathToFileUrl(trimmed) };
  const domainPort = domainPortAddress(trimmed);
  if (domainPort) return { status: 'navigate', url: domainPort };
  try {
    const parsed = new URL(trimmed);
    if (['http:', 'https:', 'file:'].includes(parsed.protocol)) return { status: 'navigate', url: parsed.toString() };
    return { status: 'invalid', message: '请输入有效的 http(s) 或 localhost 地址' };
  } catch {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) return { status: 'invalid', message: '请输入有效的 http(s) 或 localhost 地址' };
    try {
      const withScheme = new URL('https://' + trimmed);
      if (withScheme.hostname.toLowerCase().replace(/\.$/, '').endsWith('.localhost')) withScheme.protocol = 'http:';
      if (!looksLikeSearchQuery(trimmed)) return { status: 'navigate', url: withScheme.toString() };
    } catch {
      // not a URL even with https://
    }
    const search = SEARCH_ENGINES[engine] ?? SEARCH_ENGINES.bing;
    return { status: 'navigate', url: search.url + encodeURIComponent(trimmed) };
  }
}

/** Load-failure catalogue (R01.4, Orca src/shared/browser-load-failure.ts). The extension-blocked kind does not apply. */
export const LOAD_FAILURES = {
  'not-running': { title: host => `${host} 上还没有服务在运行`, description: '请先启动这个地址的开发服务。', recovery: 'poll', error: 'ERR_CONNECTION_REFUSED' },
  refused: { title: host => `${host} 拒绝连接`, description: '站点可能已停止，或者地址有误。', recovery: null, error: 'ERR_CONNECTION_REFUSED' },
  dns: { title: host => `找不到 ${host}`, description: '请检查地址拼写。', recovery: null, error: 'ERR_NAME_NOT_RESOLVED' },
  offline: { title: () => '当前处于离线状态', description: null, recovery: 'online', error: 'ERR_INTERNET_DISCONNECTED' },
  timeout: { title: host => `${host} 响应时间过长`, description: null, recovery: null, error: 'ERR_TIMED_OUT' },
  reset: { title: host => `与 ${host} 的连接被中断`, description: null, recovery: null, error: 'ERR_CONNECTION_RESET' },
  other: { title: host => (host ? `无法访问 ${host}` : '无法加载此页面'), description: null, recovery: null, error: 'ERR_FAILED' }
};

export const RECOVERY_TEXT = { poll: '服务启动后会自动重新加载', online: '网络恢复后会自动重新加载' };

const FAILURE_HOSTS = {
  'localhost:3000': 'not-running',
  'refused.example.test': 'refused',
  'nxdomain.example.test': 'dns',
  'timeout.example.test': 'timeout',
  'reset.example.test': 'reset',
  'other.example.test': 'other'
};

/** Synthetic page resolution. Nothing here touches the network. */
export function resolvePage(url, { offline = false, startedServers = [], certAllowed = [], authed = [] } = {}) {
  if (url === BLANK_URL) return { kind: 'blank', title: '新标签页' };
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'failure', failure: 'other', host: null, title: '无法加载此页面' };
  }
  if (parsed.protocol === 'file:') return { kind: 'file', title: decodeURIComponent(parsed.pathname.split('/').pop() || '本机文件'), path: decodeURIComponent(parsed.pathname) };
  const host = parsed.host;
  if (offline) return { kind: 'failure', failure: 'offline', host, title: '当前处于离线状态' };
  for (const engine of Object.values(SEARCH_ENGINES)) {
    if (url.startsWith(engine.url)) return { kind: 'search', title: '搜索 · ' + engine.label, query: decodeURIComponent(url.slice(engine.url.length)), engine: engine.label };
  }
  if (host === 'selfsigned.example.test') return certAllowed.includes(host) ? { kind: 'cert-continued', title: '内部系统（证书例外）', host } : { kind: 'cert-error', title: '证书不受信任 · ' + host, host };
  if (host === 'auth.example.test') return authed.includes(host) ? { kind: 'auth-ok', title: '已通过基本认证 · ' + host, host } : { kind: 'http-auth', title: '需要登录 · ' + host, host };
  const failure = FAILURE_HOSTS[host];
  if (failure && !(failure === 'not-running' && startedServers.includes(host))) return { kind: 'failure', failure, host, title: LOAD_FAILURES[failure].title(host) };
  if (host === 'qa.example.test') {
    if (parsed.pathname.startsWith('/orders/1024')) return { kind: 'qa-order', title: '订单 #1024 · 测试环境' };
    return { kind: 'qa-login', title: '登录 · 测试环境' };
  }
  if (host === 'localhost:5173' || (host === 'localhost:3000' && startedServers.includes(host))) return { kind: 'local-dev', title: '本地开发服务 · ' + host };
  return { kind: 'generic', title: host || url, host };
}

export function hostLabel(url) {
  if (url === BLANK_URL) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'file:' ? '本机文件' : parsed.host;
  } catch {
    return url;
  }
}

export function securityState(url) {
  if (url === BLANK_URL) return 'none';
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') return 'secure';
    if (parsed.protocol === 'file:') return 'file';
    return /^(localhost|127\.|0\.0\.0\.0|\[)/.test(parsed.hostname) ? 'local' : 'insecure';
  } catch {
    return 'none';
  }
}

let counter = 0;
const nextId = prefix => prefix + '-' + Date.now().toString(36) + '-' + (++counter).toString(36);

export function createTab(url = BLANK_URL, profile = 'project') {
  return { id: nextId('web'), history: [url], index: 0, profile };
}

export function currentUrl(tab) {
  return tab.history[tab.index];
}

export function navigateTab(tab, url) {
  const history = tab.history.slice(0, tab.index + 1);
  if (history[history.length - 1] === url) return tab;
  history.push(url);
  return { ...tab, history, index: history.length - 1 };
}

export const canGoBack = tab => tab.index > 0;
export const canGoForward = tab => tab.index < tab.history.length - 1;
export const goBack = tab => (canGoBack(tab) ? { ...tab, index: tab.index - 1 } : tab);
export const goForward = tab => (canGoForward(tab) ? { ...tab, index: tab.index + 1 } : tab);

/** Per-task browser state. Tabs are task-scoped (D8); login profiles are project-scoped (O10). */
export function emptyTaskBrowser() {
  return { tabs: [], active: null, paused: false, agent: null };
}

export function openTab(state, url = BLANK_URL) {
  const tab = createTab(url);
  return { ...state, tabs: [...state.tabs, tab], active: tab.id };
}

export function closeTab(state, id) {
  const index = state.tabs.findIndex(tab => tab.id === id);
  if (index < 0) return state;
  const tabs = state.tabs.filter(tab => tab.id !== id);
  let active = state.active;
  if (active === id) active = tabs.length ? tabs[Math.min(index, tabs.length - 1)].id : null;
  const agent = state.agent?.tabId === id ? null : state.agent;
  return { ...state, tabs, active, agent };
}

/** New-tab launcher "推荐" (R01.11): per-project visit log ordered by real visit time, one entry per host, newest first (review R09). */
export const RECENT_SITE_LIMIT = 8;
export function recordVisit(visits, url, at) {
  if (url === BLANK_URL || !/^https?:/.test(url) || resolvePage(url).kind === 'search') return visits;
  const host = hostLabel(url);
  if (!host) return visits;
  const entry = { url, host, title: resolvePage(url).title, at };
  return [entry, ...(visits ?? []).filter(item => item.host !== host)].slice(0, RECENT_SITE_LIMIT);
}
export function recentSites(visits) {
  return [...(visits ?? [])].sort((a, b) => b.at - a.at).slice(0, RECENT_SITE_LIMIT);
}

export function updateTab(state, id, update) {
  return { ...state, tabs: state.tabs.map(tab => (tab.id === id ? update(tab) : tab)) };
}

/**
 * Agent activity (R07.2): marked while a command runs; kept AGENT_HOLD_MS after the last command.
 * Pause (R07.6, O14): new commands are rejected with BROWSER_PAUSED; a running read-only wait ends immediately.
 */
export function agentCommandStart(state, tabId, now, { kind = 'write', unavailable = false } = {}) {
  // R06.4: a profile that needs attention (or is being imported) makes its pages unavailable to the Agent.
  if (unavailable) return { state, outcome: 'BROWSER_UNAVAILABLE' };
  if (state.paused) return { state, outcome: 'BROWSER_PAUSED' };
  return { state: { ...state, agent: { tabId, running: true, kind, lastAt: now } }, outcome: 'started' };
}

export function agentCommandEnd(state, now) {
  if (!state.agent) return state;
  return { ...state, agent: { ...state.agent, running: false, lastAt: now } };
}

export function agentMarked(state, tabId, now) {
  const agent = state.agent;
  if (!agent || agent.tabId !== tabId) return false;
  return agent.running || now - agent.lastAt < AGENT_HOLD_MS;
}

export function agentHoldRemaining(state, now) {
  const agent = state.agent;
  if (!agent || agent.running) return 0;
  return Math.max(0, AGENT_HOLD_MS - (now - agent.lastAt));
}

export function pauseAgent(state) {
  if (state.paused) return { state, interrupted: null };
  const interrupted = state.agent?.running && state.agent.kind === 'read' ? 'BROWSER_PAUSED' : null;
  const agent = interrupted ? { ...state.agent, running: false } : state.agent;
  return { state: { ...state, paused: true, agent }, interrupted };
}

export function resumeAgent(state) {
  return { ...state, paused: false };
}

/** A run ending clears pause (not persisted) and the activity mark. */
export function endRun(state) {
  return { ...state, paused: false, agent: null };
}

/** Persist only tab addresses (R01.9: no in-page state). */
export function serialize(byTask) {
  const out = {};
  for (const [taskId, state] of Object.entries(byTask)) {
    out[taskId] = { tabs: state.tabs.map(tab => ({ url: currentUrl(tab), profile: tab.profile })), active: state.tabs.findIndex(tab => tab.id === state.active) };
  }
  return out;
}

export function restore(saved) {
  const byTask = {};
  if (!saved || typeof saved !== 'object') return byTask;
  for (const [taskId, value] of Object.entries(saved)) {
    if (!value || !Array.isArray(value.tabs)) continue;
    const tabs = value.tabs.filter(item => item && typeof item.url === 'string').map(item => createTab(item.url, typeof item.profile === 'string' && /^(project|task|profile-[a-z0-9-]{1,64})$/.test(item.profile) ? item.profile : 'project'));
    // Keep the saved profile ID; the view falls back to the project profile only if that ID no longer exists in the project (review R08).
    const active = tabs[value.active]?.id ?? tabs[0]?.id ?? null;
    byTask[taskId] = { ...emptyTaskBrowser(), tabs, active };
  }
  return byTask;
}

// ---------------------------------------------------------------------------
// Batch 2 (B05–B08, B11–B14). Synthetic only.

/** Orca src/shared/browser-download-filename.ts (macOS branch). */
export function sanitizeDownloadName(filename) {
  const base = String(filename ?? '').replace(/\\/g, '/').split('/').at(-1)?.trim() ?? '';
  const safe = [...base].map(ch => (ch.charCodeAt(0) < 32 || '<>:"|?*'.includes(ch) ? '_' : ch)).join('').replace(/[. ]+$/g, '').trim();
  return !safe || safe === '.' || safe === '..' ? 'download' : safe;
}
export const MAX_DOWNLOAD_COLLISION_ATTEMPTS = 1000;
export function downloadCollisionCandidate(filename, suffix) {
  if (suffix === 0) return filename;
  const dot = filename.lastIndexOf('.');
  const ext = dot > 0 ? filename.slice(dot) : '';
  return `${ext ? filename.slice(0, -ext.length) : filename} (${suffix})${ext}`;
}
export function uniqueDownloadName(filename, existing) {
  const clean = sanitizeDownloadName(filename);
  for (let i = 0; i < MAX_DOWNLOAD_COLLISION_ATTEMPTS; i++) {
    const candidate = downloadCollisionCandidate(clean, i);
    if (!existing.includes(candidate)) return candidate;
  }
  return null;
}

/** Project-scoped login profiles (O10) plus optional task-own profiles (C1). */
export function projectProfiles(projectName) {
  return { profiles: [{ id: 'project', label: projectName + ' 项目登录态', scope: 'project' }], certExceptions: {}, permissions: {}, sources: {} };
}
export function createTaskProfile(store, taskTitle) {
  const id = nextId('profile');
  return { store: { ...store, profiles: [...store.profiles, { id, label: taskTitle + ' 独立登录态', scope: 'task' }] }, id };
}
export function cloneProfile(store, sourceId) {
  const source = store.profiles.find(item => item.id === sourceId);
  if (!source) return { store, id: null };
  const id = nextId('profile');
  return {
    store: {
      ...store,
      profiles: [...store.profiles, { id, label: source.label + '（副本）', scope: 'task' }],
      certExceptions: { ...store.certExceptions, [id]: [...(store.certExceptions[sourceId] ?? [])] },
      permissions: { ...store.permissions, [id]: structuredClone(store.permissions[sourceId] ?? {}) }
    },
    id
  };
}
/** The project profile cannot be deleted; tabs using a deleted profile fall back to the project profile. */
export function deleteProfile(store, browserByTask, id) {
  if (id === 'project') return { store, browserByTask };
  const { [id]: _c, ...certExceptions } = store.certExceptions;
  const { [id]: _p, ...permissions } = store.permissions;
  const { [id]: _s, ...sources } = store.sources;
  const nextTasks = {};
  for (const [taskId, state] of Object.entries(browserByTask)) nextTasks[taskId] = { ...state, tabs: state.tabs.map(tab => (tab.profile === id ? { ...tab, profile: 'project' } : tab)) };
  return { store: { ...store, profiles: store.profiles.filter(item => item.id !== id), certExceptions, permissions, sources }, browserByTask: nextTasks };
}

/** O3: user-only certificate exception, per host, remembered in the profile. */
export function addCertException(store, profileId, host) {
  const list = store.certExceptions[profileId] ?? [];
  return list.includes(host) ? store : { ...store, certExceptions: { ...store.certExceptions, [profileId]: [...list, host] } };
}
export function removeCertException(store, profileId, host) {
  return { ...store, certExceptions: { ...store.certExceptions, [profileId]: (store.certExceptions[profileId] ?? []).filter(item => item !== host) } };
}
/** O4: prompt the user; an allow/deny is remembered per site in the profile. */
export function rememberPermission(store, profileId, host, permission, decision) {
  const profile = store.permissions[profileId] ?? {};
  return { ...store, permissions: { ...store.permissions, [profileId]: { ...profile, [host]: { ...(profile[host] ?? {}), [permission]: decision } } } };
}
export function permissionDecision(store, profileId, host, permission) {
  return store.permissions[profileId]?.[host]?.[permission] ?? 'ask';
}
export function revokePermission(store, profileId, host, permission) {
  const profile = { ...(store.permissions[profileId] ?? {}) };
  const site = { ...(profile[host] ?? {}) };
  delete site[permission];
  if (Object.keys(site).length) profile[host] = site; else delete profile[host];
  return { ...store, permissions: { ...store.permissions, [profileId]: profile } };
}

/** P4: cross-task access only within the same project, only with a per-run user grant; unattended runs are denied. */
export function crossTaskDecision({ sameProject, unattended }) {
  if (!sameProject) return { outcome: 'denied', code: 'SCOPE_DENIED', reason: '跨项目访问一律不允许' };
  if (unattended) return { outcome: 'denied', code: 'SCOPE_DENIED', reason: '无人值守运行无法弹窗批准' };
  return { outcome: 'ask' };
}
export function grantCrossTask(state, grant) {
  return { ...state, grants: [...(state.grants ?? []).filter(item => item.taskId !== grant.taskId), grant] };
}
export function revokeCrossTask(state, taskId) {
  return { ...state, grants: (state.grants ?? []).filter(item => item.taskId !== taskId) };
}

/** B13 synthetic import outcomes (D2, O11): whole browser profile, Google excluded. */
export const IMPORT_SOURCES = [
  { family: 'chrome', label: 'Google Chrome', keychain: 'Chrome Safe Storage', profiles: ['Default', 'Profile 1'] },
  { family: 'edge', label: 'Microsoft Edge', keychain: 'Microsoft Edge Safe Storage', profiles: ['Default'] }
];
export function importOutcome(keychain) {
  if (keychain === 'missing') return { ok: false, reason: '找不到所选浏览器或浏览器 profile，没有写入任何 Cookie。' };
  if (keychain === 'denied') return { ok: false, reason: '钥匙串访问被拒绝，没有写入任何 Cookie。' };
  if (keychain === 'timeout') return { ok: false, reason: '等待钥匙串授权超时（30 秒），没有写入任何 Cookie。' };
  if (keychain === 'undecryptable') return { ok: false, reason: '无法解密来源Cookie；目标登录态尚未写入' };
  return { ok: true, summary: { totalCookies: 412, importedCookies: 371, skippedCookies: 41, googleCookiesSkipped: 37, partitionSkippedCookies: 4, domains: ['qa.example.test', 'zentao.example.test', 'gitlab.example.test', 'wiki.example.test'], reloadedPages: 2 } };
}
export function recordImport(store, profileId, source, profileName, at) {
  return { ...store, sources: { ...store.sources, [profileId]: { browser: source, profileName, importedAt: at } } };
}

/** R06.4 (review3 F09): a failed import rollback leaves the profile "needs attention" until the user retries or clears it. */
export function markRecoveryFailed(store, profileId, conflicts = 0) {
  return { ...store, attention: { ...(store.attention ?? {}), [profileId]: { conflicts } } };
}
export function needsAttention(store, profileId) {
  return Boolean(store.attention?.[profileId]);
}
export function resolveRecovery(store, profileId) {
  const { [profileId]: _gone, ...rest } = store.attention ?? {};
  return { ...store, attention: rest };
}
export function clearProfileLogin(store, profileId) {
  const { [profileId]: _source, ...sources } = store.sources ?? {};
  return { ...resolveRecovery(store, profileId), sources };
}

/** B05/B06 synthetic hosts. */
export const SPECIAL_HOSTS = { cert: 'selfsigned.example.test', auth: 'auth.example.test' };
