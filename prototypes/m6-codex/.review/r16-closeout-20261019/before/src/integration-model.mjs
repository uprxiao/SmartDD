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
    { id: 'mail.search', title: '搜索本地邮件', effect: 'read' }, { id: 'mail.read', title: '读取正文与附件', effect: 'read' }, { id: 'mail.draft', title: '准备邮件草稿', effect: 'draft' }, { id: 'mail.send', title: '发送、回复与回复全部（SMTP）', effect: 'write' },
  ] },
];
export function initialIntegrationState() {
  return { version: 2, installed: ['zentao', 'mail'], connections: [
    { id: 'zt-demo', app: 'zentao', kind: 'zentao', name: '公司禅道', url: 'http://zentao.intranet.example/biz/', account: 'demo.user', auth: 'password', credentialPresent: true, enabled: true, validation: 'ready', revision: 1 },
    { id: 'fox-demo', app: 'mail', kind: 'local', name: '工作邮箱 · Foxmail', path: '/Users/demo/Library/Containers/com.tencent.Foxmail/Data/Library/Foxmail/', account: 'work@example.invalid', enabled: true, validation: 'ready', revision: 1 },
  ], bindings: { ais: ['zt-demo', 'fox-demo'], smartdd: ['zt-demo'] }, activity: [] };
}
const PUBLIC_FIELDS = ['id', 'app', 'kind', 'name', 'url', 'path', 'account', 'auth', 'host', 'port', 'transport', 'tls', 'credentialPresent', 'enabled', 'validation', 'revision'];
export function projectIntegrationState(value) {
  const known = new Set(APP_DEFINITIONS.map(a => a.id));
  const connections = (Array.isArray(value?.connections) ? value.connections : []).filter(c => known.has(c.app) && typeof c.id === 'string').map(c => Object.fromEntries(PUBLIC_FIELDS.filter(k => c[k] !== undefined).map(k => [k, c[k]])));
  const ids = new Set(connections.map(c => c.id));
  const packages = Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, value?.packages?.[a.id] === '1.1.0' ? '1.1.0' : '1.0.0']));
  return { version: 2, packages, projectApps: Object.fromEntries(Object.entries(value?.projectApps || {}).map(([id, apps]) => [id, Object.fromEntries(Object.entries(apps || {}).filter(([app, enabled]) => known.has(app) && typeof enabled === 'boolean'))])), mailQueryDays: validMailDays(value?.mailQueryDays) ? Number(value.mailQueryDays) : 30, drafts: projectDrafts(value?.drafts), installedVersions: Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, [...new Set(['1.0.0', packages[a.id], ...(value?.installedVersions?.[a.id] || []).filter(v => ['1.0.0','1.1.0'].includes(v))])]])), dataSchema: value?.dataSchema === 2 ? 2 : 1, installed: [...new Set((value?.installed || []).filter(id => known.has(id)))], connections,
    bindings: Object.fromEntries(Object.entries(value?.bindings || {}).filter(([k]) => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(k)).map(([k, v]) => [k, [...new Set((Array.isArray(v) ? v : []).filter(id => ids.has(id)))]])),
    // Activity contains only fixed synthetic fixture identifiers and labels.
    activity: (Array.isArray(value?.activity) ? value.activity : []).slice(0, 40).map(a => ({ id: String(a.id), app: known.has(a.app) ? a.app : 'mail', operation: String(a.operation || ''), status: ['success', 'failed', 'unknown', 'handoff', 'draft', 'sending'].includes(a.status) ? a.status : 'unknown', project: typeof a.project === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(a.project) ? a.project : 'ais', connectionId: String(a.connectionId || ''), at: String(a.at || ''), actor: String(a.actor || ''), draftId: String(a.draftId || ''), revision: Number(a.revision) || null })),
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
export function projectAppEnabled(state, projectId, appId) {
  const explicit = state.projectApps?.[projectId]?.[appId];
  return state.installed.includes(appId) && (typeof explicit === 'boolean' ? explicit : state.connections.some(c => c.app === appId && (state.bindings[projectId] || []).includes(c.id)));
}
export function selectedConnections(state, projectId, appId) {
  const ids = new Set(state.bindings[projectId] || []);
  const matches = state.connections.filter(c => ids.has(c.id) && (!appId || c.app === appId));
  // A legacy multi-ZenTao binding is unresolved, never choose the first account.
  return matches.filter(c => c.app !== 'zentao' || matches.filter(x => x.app === 'zentao').length === 1);
}
export function availableConnections(state, project) {
  return selectedConnections(state, project).filter(c => projectAppEnabled(state, project, c.app) && connectionReady(c));
}
export function packageVersion(state, appId) { return state.packages?.[appId] || '1.0.0'; }
export function projectPackages(state, projectId) {
  return APP_DEFINITIONS.filter(a => projectAppEnabled(state, projectId, a.id)).map(a => ({
    id: a.id, version: packageVersion(state, a.id), skills: a.skills.map(s => s.id),
    tools: a.capabilities.filter(c => !c.pending).map(c => c.id),
    connections: selectedConnections(state, projectId, a.id).map(c => ({ id: c.id, revision: c.revision })),
  }));
}
export function integrationSnapshot(state, projectId) { return { projectId, evidence: 'prepared-demo', packages: projectPackages(state, projectId) }; }
// A snapshot is fixed identity, not equality with current default packages or health.
export function snapshotCurrent(snapshot, state, projectId) {
  return !!snapshot && snapshot.projectId === projectId && Array.isArray(snapshot.packages);
}
export function sessionApplicationState(snapshot, state, projectId, appId) {
  const fixed = snapshot?.projectId === projectId && snapshot.packages?.find(p => p.id === appId);
  if (!fixed) return { usable: false, label: snapshot ? '本会话未选用；需新建会话' : '历史能力未知；不自动补入' };
  if (!state.installed.includes(appId)) return { usable: false, label: '应用已移除；历史版本保留' };
  if (!projectAppEnabled(state, projectId, appId)) return { usable: false, label: '当前项目已停用' };
  const versions = state.installedVersions?.[appId] || ['1.0.0', packageVersion(state, appId)];
  if (!versions.includes(fixed.version)) return { usable: false, label: '固定版本缺失；修复原版本后可继续' };
  const selected = selectedConnections(state, projectId, appId);
  const ready = selected.filter(connectionReady);
  if (appId === 'mail') return { usable: true, label: ready.some(c => c.kind === 'smtp') ? '草稿可用；读取与SMTP按连接检查' : '草稿可用；尚无可用SMTP', connections: selected };
  return { usable: ready.length === 1, label: ready.length === 1 ? '当前生效连接可用' : selected.length ? '连接不可用；Agent继续工作' : '未选定唯一连接；Agent继续工作', connections: selected };
}
export function toggleProjectApplication(state, projectId, appId, enabled) {
  if (enabled && !state.installed.includes(appId)) return state;
  return { ...state, projectApps: { ...state.projectApps, [projectId]: { ...state.projectApps?.[projectId], [appId]: enabled } } };
}
export function switchProjectZenTao(state, projectId, connectionId, tasks = []) {
  const candidate = state.connections.find(c => c.id === connectionId && c.app === 'zentao');
  if (connectionId && !candidate) return { ok: false, state, reason: '目标连接不存在。' };
  const blocked = tasks.filter(t => t.project === projectId && t.status === 'running' && (!t.integrationSnapshot || t.integrationSnapshot.packages.some(p => p.id === 'zentao')));
  if (blocked.length) return { ok: false, state, reason: '先停止相关运行；不会自动重启。', tasks: blocked };
  return { ok: true, state: { ...state, bindings: { ...state.bindings, [projectId]: [...(state.bindings[projectId] || []).filter(id => !state.connections.some(c => c.id === id && c.app === 'zentao')), ...(connectionId ? [connectionId] : [])] } } };
}
export function removeApplication(state, appId) {
  const projectIds = new Set([...Object.keys(state.bindings), ...Object.keys(state.projectApps || {})]);
  return { ...state, installed: state.installed.filter(id => id !== appId), projectApps: Object.fromEntries([...projectIds].map(id => [id, { ...state.projectApps?.[id], [appId]: false }])) };
}
export function upgradeBlockers(tasks = []) { return tasks.filter(t => t.status === 'running' && (t.runner === 'codex' || t.sharedSkillDiscovery === true)); }
export function simulatePackageUpgrade(state, fail = false, tasks = []) {
  if (upgradeBlockers(tasks).length) return { ok: false, waiting: true, state, message: '等待共享Skill目录的相关运行结束；保持原默认版本，不强制打断Agent。' };
  if (fail) return { ok: false, state, message: '模拟准备失败：未切换默认版本，原包、会话和本地数据均保留。' };
  return { ok: true, state: { ...state, packages: Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, '1.1.0'])), installedVersions: Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, [...new Set([...(state.installedVersions?.[a.id] || ['1.0.0']), '1.1.0'])]])), dataSchema: 2 }, message: '模拟校验并启用新版：新会话用1.1.0，历史会话仍固定原版本。原本地数据继续读取。' };
}
export function packageRetention(state, tasks, appId, version) {
  const references = tasks.filter(t => t.integrationSnapshot?.packages?.some(p => p.id === appId && p.version === version));
  const unknown = tasks.filter(t => !t.integrationSnapshot);
  const reasons = [packageVersion(state, appId) === version && '新会话默认版本', references.length && `${references.length}个会话引用（含停止／归档）`, unknown.length && '历史能力未知，待核对引用'].filter(Boolean);
  return { references, running: references.filter(t => t.status === 'running').length, reasons, cleanable: reasons.length === 0 };
}
export function validMailDays(value) { return /^\d+$/.test(String(value)) && Number(value) >= 1 && Number(value) <= 100; }
export function mailQueryWindow(days, now = new Date()) {
  const count = validMailDays(days) ? Number(days) : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - count + 1);
  const date = value => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  return { days: count, from: date(start), through: date(now), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export const DEMO_MAIL_DRAFT = { to: 'team@example.invalid', subject: 'M10 接入方案评审', body: '大家好，\n\n应用连接和项目选用方案已整理，请查看账号配置、本地邮件读取与结果恢复流程。\n\n谢谢。', attachment: false };
function projectDrafts(drafts) {
  // Persist only a fixture identity and lifecycle metadata; never user-entered mail text.
  return (Array.isArray(drafts) ? drafts : []).filter(d => d.fixture === 'm10-review').map(d => ({ id: String(d.id), project: String(d.project), fixture: 'm10-review', revision: Number(d.revision) || 1, status: ['draft','sending','success','failed','unknown'].includes(d.status) ? d.status : 'draft', at: String(d.at || '') }));
}
export function saveDemoDraft(state, project, existingId, expectedRevision) {
  const old = state.drafts?.find(d => d.id === existingId);
  if (old && old.revision !== expectedRevision) return { ok: false, state, reason: '草稿已由其他会话修改，请重新打开。' };
  if (old && ['sending','success','unknown'].includes(old.status)) return { ok: false, state, reason: '发送中、已发送或结果未知的记录不能覆盖；先核实结果。' };
  const draft = { id: old?.id || 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), project, fixture: 'm10-review', revision: (old?.revision || 0) + 1, status: 'draft', at: new Date().toLocaleString('zh-CN') };
  return { ok: true, state: { ...state, drafts: [draft, ...(state.drafts || []).filter(d => d.id !== draft.id)] }, draft };
}
export function verifyDemoSendAccepted(state, recordId) {
  const record = state.activity.find(a => a.id === recordId);
  if (!record || record.status !== 'unknown') return state;
  return {
    ...state,
    activity: state.activity.map(a => a.id === recordId ? { ...a, status: 'success', operation: a.operation + '（模拟查证：已接受）' } : a),
    drafts: (state.drafts || []).map(d => record.draftId && d.id === record.draftId && d.project === record.project && d.revision === record.revision && d.status === 'unknown' ? { ...d, status: 'success' } : d),
  };
}
export function connectionIdentityChanged(old, draft) {
  if (!old || old.kind === 'local') return false;
  return old.account !== draft.account || (old.kind === 'zentao' ? old.url !== draft.url : old.host !== draft.host);
}
export function saveConnection(state, draft, hasCredential) {
  const old = state.connections.find(c => c.id === draft.id);
  if (connectionIdentityChanged(old, draft)) return state;
  const connection = { ...draft, credentialPresent: draft.kind !== 'local' && !!hasCredential, enabled: old?.enabled ?? true, validation: 'ready', revision: (old?.revision || 0) + 1 };
  return projectIntegrationState({ ...state, installed: [...state.installed, draft.app], connections: old ? state.connections.map(c => c.id === draft.id ? connection : c) : [...state.connections, connection] });
}
export function referenceText(type, id, connectionId = type === 'mail' ? 'fox-demo' : 'zt-demo') {
  const source = encodeURIComponent(connectionId);
  return type === 'mail' ? `[邮件 mail://${source}/${id}] 请基于这封示例邮件继续分析。` : `[禅道 ${type === 'story' ? 'Story' : 'Bug'} #${id} zentao://${source}/${type}/${id}] 请读取详情并分析。`;
}
