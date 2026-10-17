// M10 isolated prototype. Only public synthetic configuration is persisted.
export const M10_STORAGE = 'willyou-m10-prototype-v2';
export const APP_DEFINITIONS = [
  { id: 'zentao', name: '禅道', description: '查看 Bug 与研发需求，连接你的工作进展', tagline: 'Bug、研发需求与 Agent，一处衔接。', capabilities: [
    { id: 'bug.list', title: '查询我的 Bug', effect: 'read' }, { id: 'story.list', title: '查询我的研发需求', effect: 'read' }, { id: 'object.read', title: '读取详情、历史与附件', effect: 'read' }, { id: 'object.transition', title: '流转操作（待评审）', effect: 'write', pending: true },
  ] },
  { id: 'mail', name: '邮件', description: '读取本机 Foxmail 邮件，准备草稿与发送', tagline: '让本地邮件成为项目的工作上下文。', capabilities: [
    { id: 'mail.search', title: '搜索本地邮件', effect: 'read' }, { id: 'mail.read', title: '读取正文与附件', effect: 'read' }, { id: 'mail.draft', title: '准备邮件草稿', effect: 'draft' }, { id: 'mail.send', title: '发送邮件（通道待选）', effect: 'write', pending: true },
  ] },
];
export function initialIntegrationState() {
  return { version: 2, installed: ['zentao', 'mail'], connections: [
    { id: 'zt-demo', app: 'zentao', kind: 'zentao', name: '公司禅道', url: 'http://zentao.intranet.example/biz/', account: 'demo.user', auth: 'password', credentialPresent: true, enabled: true, validation: 'ready', revision: 1 },
    { id: 'fox-demo', app: 'mail', kind: 'local', name: '工作邮箱 · Foxmail', path: '/Users/demo/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/', account: 'work@example.invalid', enabled: true, validation: 'ready', revision: 1 },
  ], bindings: { ais: ['zt-demo', 'fox-demo'], smartdd: ['zt-demo'] }, activity: [] };
}
const PUBLIC_FIELDS = ['id', 'app', 'kind', 'name', 'url', 'path', 'account', 'auth', 'host', 'port', 'tls', 'credentialPresent', 'enabled', 'validation', 'revision'];
export function projectIntegrationState(value) {
  const known = new Set(APP_DEFINITIONS.map(a => a.id));
  const connections = (Array.isArray(value?.connections) ? value.connections : []).filter(c => known.has(c.app) && typeof c.id === 'string').map(c => Object.fromEntries(PUBLIC_FIELDS.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
  const ids = new Set(connections.map(c => c.id));
  return { version: 2, installed: [...new Set((value?.installed || []).filter(id => known.has(id)))], connections,
    bindings: Object.fromEntries(Object.entries(value?.bindings || {}).filter(([k]) => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(k)).map(([k, v]) => [k, [...new Set((Array.isArray(v) ? v : []).filter(id => ids.has(id)))]])),
    // Activity contains only fixed synthetic fixture identifiers and labels.
    activity: (Array.isArray(value?.activity) ? value.activity : []).slice(0, 40).map(a => ({ id: String(a.id), app: known.has(a.app) ? a.app : 'mail', operation: String(a.operation || ''), status: ['success', 'failed', 'unknown', 'handoff', 'draft'].includes(a.status) ? a.status : 'unknown', project: typeof a.project === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(a.project) ? a.project : 'ais', connectionId: String(a.connectionId || ''), at: String(a.at || '') })),
  };
}
export function validateConnection(draft, secret = '') {
  if (!draft.name?.trim()) return '请输入连接名称。';
  if (draft.name.length > 120) return '连接名称最多120个字符。';
  if (draft.kind === 'local') return draft.path?.startsWith('/') && !/[\x00-\x1f]/.test(draft.path) ? '' : '请选择完整的本地来源路径。';
  if (draft.kind === 'zentao') {
    try { const u = new URL(draft.url); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.hash || u.search) return '请填写不含凭据、查询参数或片段的 HTTP(S) 服务地址。'; }
    catch { return '请输入有效的禅道服务地址。'; }
    if (draft.auth !== 'token' && !draft.account?.trim()) return '请输入用户名。';
  } else {
    if (!draft.host?.trim() || /[\s/@?#]/.test(draft.host)) return '请填写邮件服务主机名。';
    if (!Number.isInteger(Number(draft.port)) || Number(draft.port) < 1 || Number(draft.port) > 65535) return '端口必须为1–65535之间的整数。';
    if (!draft.account?.includes('@')) return '请输入发件账号的邮件地址。';
  }
  if (!secret.trim() && !draft.credentialPresent) return '请填入示例认证信息，或保留已保存的示例凭据。';
  return '';
}
export function connectionReady(connection) { return !!connection && connection.enabled && connection.validation === 'ready'; }
export function availableConnections(state, project) {
  const allowed = new Set(state.bindings[project] || []);
  return state.connections.filter(c => allowed.has(c.id) && state.installed.includes(c.app) && connectionReady(c));
}
export function saveConnection(state, draft, hasCredential) {
  const old = state.connections.find(c => c.id === draft.id);
  const connection = { ...draft, credentialPresent: draft.kind !== 'local' && !!hasCredential, enabled: old?.enabled ?? true, validation: 'ready', revision: (old?.revision || 0) + 1 };
  return projectIntegrationState({ ...state, installed: [...state.installed, draft.app], connections: old ? state.connections.map(c => c.id === draft.id ? connection : c) : [...state.connections, connection] });
}
export function referenceText(type, id, connectionId = type === 'mail' ? 'fox-demo' : 'zt-demo') {
  const source = encodeURIComponent(connectionId);
  return type === 'mail' ? `[邮件 mail://${source}/${id}] 请基于这封示例邮件继续分析。` : `[禅道 ${type === 'story' ? 'Story' : 'Bug'} #${id} zentao://${source}/${type}/${id}] 请读取详情并分析。`;
}
