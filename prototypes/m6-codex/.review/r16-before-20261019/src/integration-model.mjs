// M10 isolated prototype. Only public synthetic configuration is persisted.
export const M10_STORAGE = 'willyou-m10-prototype-v2';
export const APP_DEFINITIONS = [
  { id: 'zentao', name: '禅道', description: '查看 Bug 与研发需求，连接你的工作进展', tagline: 'Bug、研发需求与 Agent，一处衔接。', skills: [
    { id: 'zentao-bug-analysis', name: 'Bug 分析助手', description: '读取本人 Bug、核对复现信息，并结合项目代码分析根因。', prompt: '查看指派给我的 Bug，结合当前项目代码分析根因，先给出处理建议。' },
    { id: 'zentao-story-review', name: '研发需求评审', description: '核对需求描述、验收标准和边界，整理待确认问题。', prompt: '查看指派给我的研发需求，检查描述和验收标准，整理需要补充的问题。' },
  ], capabilities: [
    { id: 'bug.list', title: '查询我的 Bug', effect: 'read' }, { id: 'story.list', title: '查询我的研发需求', effect: 'read' }, { id: 'object.read', title: '读取详情、历史与附件', effect: 'read' }, { id: 'object.transition', title: '流转操作（待评审）', effect: 'write', pending: true },
  ] },
  { id: 'mail', name: '邮件', description: '读取本机 Foxmail 邮件，准备草稿与发送', tagline: '让本地邮件成为项目的工作上下文。', skills: [
    { id: 'mail-work-assistant', name: '邮件工作助手', description: '搜索本地邮件、总结来往内容和待办，准备回复草稿。', prompt: '找出今天与当前项目有关的本地邮件，总结待办事项，并准备需要回复的草稿。' },
  ], capabilities: [
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
  const packages = Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, value?.packages?.[a.id] === '1.1.0' ? '1.1.0' : '1.0.0']));
  return { version: 2, packages, dataSchema: value?.dataSchema === 2 ? 2 : 1, installed: [...new Set((value?.installed || []).filter(id => known.has(id)))], connections,
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
export function packageVersion(state, appId) { return state.packages?.[appId] || '1.0.0'; }
export function projectPackages(state, projectId) {
  const connections = availableConnections(state, projectId);
  return APP_DEFINITIONS.filter(a => connections.some(c => c.app === a.id)).map(a => ({
    id: a.id, version: packageVersion(state, a.id), skills: a.skills.map(s => s.id),
    tools: a.capabilities.filter(c => !c.pending && (a.id !== 'mail' || (c.id === 'mail.draft' ? connections.some(x => x.kind === 'smtp') : connections.some(x => x.kind === 'local')))).map(c => c.id),
    connections: connections.filter(c => c.app === a.id).map(c => ({ id: c.id, revision: c.revision })),
  }));
}
export function integrationSnapshot(state, projectId) { return { projectId, packages: projectPackages(state, projectId) }; }
export function snapshotCurrent(snapshot, state, projectId) {
  return !!snapshot && snapshot.projectId === projectId && JSON.stringify(snapshot.packages) === JSON.stringify(projectPackages(state, projectId));
}
export function toggleProjectApplication(state, projectId, appId, enabled) {
  const ids = state.connections.filter(c => c.app === appId).map(c => c.id);
  const old = state.bindings[projectId] || [];
  const eligible = state.installed.includes(appId) ? state.connections.filter(c => c.app === appId && connectionReady(c)).map(c => c.id) : [];
  return { ...state, bindings: { ...state.bindings, [projectId]: enabled ? [...new Set([...old, ...eligible.slice(0, 1)])] : old.filter(id => !ids.includes(id)) } };
}
export function simulatePackageUpgrade(state, fail = false) {
  if (fail) return { ok: false, state, message: '模拟迁移失败：原应用版本和本地数据均保留，可修复后重试。' };
  return { ok: true, state: { ...state, packages: Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, '1.1.0'])), dataSchema: 2 }, message: '模拟升级完成：连接、项目选用与调用记录已保留。' };
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
