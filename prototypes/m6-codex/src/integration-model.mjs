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
  // Materialize legacy enablement once, so clearing a connection never disables the app.
  const projectIds = [...new Set([...Object.keys(value?.bindings || {}), ...Object.keys(value?.projectApps || {})])];
  const projectApps = Object.fromEntries(projectIds.map(projectId => [projectId, Object.fromEntries(APP_DEFINITIONS.map(app => [app.id, typeof value?.projectApps?.[projectId]?.[app.id] === 'boolean' ? value.projectApps[projectId][app.id] : connections.some(c => c.app === app.id && (Array.isArray(value?.bindings?.[projectId]) ? value.bindings[projectId] : []).includes(c.id))]))]));
  return { version: 2, packages, projectApps, mailQueryDays: validMailDays(value?.mailQueryDays) ? Number(value.mailQueryDays) : 30, drafts: projectDrafts(value?.drafts), installedVersions: Object.fromEntries(APP_DEFINITIONS.map(a => [a.id, [...new Set(['1.0.0', packages[a.id], ...(value?.installedVersions?.[a.id] || []).filter(v => ['1.0.0','1.1.0'].includes(v))])]])), dataSchema: value?.dataSchema === 2 ? 2 : 1, installed: [...new Set((value?.installed || []).filter(id => known.has(id)))], connections,
    bindings: Object.fromEntries(Object.entries(value?.bindings || {}).filter(([k]) => typeof k === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(k)).map(([k, v]) => [k, [...new Set((Array.isArray(v) ? v : []).filter(id => ids.has(id)))]])),
    mailSlotRevisions: Object.fromEntries(Object.entries(value?.mailSlotRevisions || {}).filter(([k]) => /^[a-zA-Z0-9_-]{1,100}$/.test(k)).map(([k,v]) => [k,Object.fromEntries(['local','smtp'].map(slot => [slot,Number.isSafeInteger(v?.[slot]) && v[slot] >= 0 ? v[slot] : Number.isSafeInteger(value?.mailBindingRevisions?.[k]) ? value.mailBindingRevisions[k] : 0]))])),
    mailBindingRevisions: Object.fromEntries(Object.entries(value?.mailBindingRevisions || {}).filter(([k, v]) => /^[a-zA-Z0-9_-]{1,100}$/.test(k) && Number.isSafeInteger(v) && v >= 0)),
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
  // Resolve each explicit selection independently; ambiguous legacy groups never pick an account.
  return matches.filter(c => matches.filter(x => x.app === c.app && (c.app === 'zentao' || x.kind === c.kind)).length === 1);
}
const mailSlotRevision = (state,project,kind) => state.mailSlotRevisions?.[project]?.[kind] ?? state.mailBindingRevisions?.[project] ?? 0;
export function selectProjectMailConnection(state, projectId, kind, connectionId) {
  if (!['local', 'smtp'].includes(kind)) return state;
  if (connectionId && !state.connections.some(c => c.id === connectionId && c.app === 'mail' && c.kind === kind)) return state;
  const old = state.connections.filter(c => c.app === 'mail' && c.kind === kind && (state.bindings[projectId] || []).includes(c.id));
  if ((!connectionId && !old.length) || (old.length === 1 && old[0].id === connectionId)) return state;
  return { ...state, projectApps: { ...state.projectApps, [projectId]: { ...state.projectApps?.[projectId], mail: projectAppEnabled(state, projectId, 'mail') } }, mailBindingRevisions: { ...state.mailBindingRevisions, [projectId]: (state.mailBindingRevisions?.[projectId] || 0) + 1 }, mailSlotRevisions: { ...state.mailSlotRevisions,[projectId]: { local: mailSlotRevision(state,projectId,'local'),smtp: mailSlotRevision(state,projectId,'smtp'),[kind]: mailSlotRevision(state,projectId,kind) + 1 } }, bindings: { ...state.bindings, [projectId]: [
    ...(state.bindings[projectId] || []).filter(id => !state.connections.some(c => c.id === id && c.app === 'mail' && c.kind === kind)),
    ...(connectionId ? [connectionId] : []),
  ] } };
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
const CAPABILITY_FAULTS = {
  missing: { code: 'PACKAGE_MISSING', title: '固定应用包缺失', reason: '本会话引用的版本文件不可用。仅恢复同一版本、同一内容标识的可信副本。', action: '修复原版本' },
  corrupt: { code: 'HASH_MISMATCH', title: '固定应用包损坏', reason: '文件校验不一致，已隔离该应用能力；不会读取损坏文件或替换成新版本。', action: '修复原版本' },
  incompatible: { code: 'CONFIG_INCOMPATIBLE', title: '固定版本与当前配置不兼容', reason: '当前连接配置无法提供此版本需要的契约。保留当前配置与会话，不回退密码；检查兼容设置后再启用能力。', action: '重新检查兼容性' },
  nameConflict: { code: 'AGENT_CAPABILITY_NAME_CONFLICT', title: '应用能力名称与用户配置冲突', reason: '用户插件命名空间、完整 Skill 名称或 MCP 配置键已占用。此应用整体不注入，保留用户配置，Agent继续工作；不会覆盖用户能力或自动改名启用。', action: '重新检查冲突' },
  bridge: { code: 'BRIDGE_UNAVAILABLE', title: '应用能力桥暂时不可用', reason: '有限重试后仍未连接。工具暂不可用，Agent 继续工作；恢复后只接收新调用，不重放旧操作。', action: '重新连接能力桥' },
  bridgeRestart: { code: 'BRIDGE_RESTART_REQUIRED', title: '此 Agent 需下次启动时恢复能力桥', reason: '当前适配器不支持运行中重新加载能力桥。原 Agent 继续工作；下次由 WillYou 停止并恢复此会话时重新准备，仍固定原版本。不会自动停止或新建会话。' },
};
export function sessionCapabilityDiagnostic(snapshot, state, projectId, appId, fault = 'none') {
  const fixed = snapshot?.projectId === projectId && snapshot.packages?.find(p => p.id === appId);
  const current = sessionApplicationState(snapshot, state, projectId, appId);
  const versions = state.installedVersions?.[appId] || ['1.0.0', packageVersion(state, appId)];
  const actualFault = fixed && !versions.includes(fixed.version) ? 'missing' : fault;
  if (!fixed || !state.installed.includes(appId) || !projectAppEnabled(state, projectId, appId)) return { ...current, code: 'CURRENT_ACCESS_UNAVAILABLE', title: current.label, reason: '当前应用授权条件不满足；不会通过修复或重连绕过。', fault: 'none', fixedVersion: fixed?.version };
  const detail = CAPABILITY_FAULTS[actualFault];
  return detail ? { ...detail, usable: false, fault: actualFault, fixedVersion: fixed.version } : { ...current, code: 'READY_DEMO', title: current.label, reason: '仅表示合成准备条件；不代表真实 Agent 已发现或调用。', fault: 'none', fixedVersion: fixed.version };
}
export function recoverSessionCapability(snapshot, state, projectId, appId, fault, succeeds = true, evidence = {}) {
  // Fixture outcome only: production must verify the fixed content hash before publishing any repair.
  const diagnostic = sessionCapabilityDiagnostic(snapshot, state, projectId, appId, fault);
  if (diagnostic.fault === 'nameConflict' && (!succeeds || evidence.userResolvedConflict !== true)) return { ok: false, state, fault: 'nameConflict', message: '冲突仍存在，应用整体保持不注入；请自行处理明确的冲突项后再检查，未修改任何用户配置。' };
  if (!diagnostic.action || !succeeds) return { ok: false, state, fault: diagnostic.fault, message: diagnostic.fault === 'missing' || diagnostic.fault === 'corrupt' ? '未取得同内容标识的可信副本；保留原版本引用，能力仍不可用。' : '条件仍不满足，相关应用保持不可用；Agent继续工作。' };
  const next = ['missing', 'corrupt'].includes(diagnostic.fault) ? { ...state, installedVersions: { ...state.installedVersions, [appId]: [...new Set([...(state.installedVersions?.[appId] || []), diagnostic.fixedVersion])] } } : state;
  return { ok: true, state: next, fault: 'none', message: '模拟恢复完成，仍使用 v' + diagnostic.fixedVersion + '；下次新调用可用，未重发任何操作。' };
}
export function toggleProjectApplication(state, projectId, appId, enabled) {
  if (enabled && !state.installed.includes(appId)) return state;
  return { ...state, projectApps: { ...state.projectApps, [projectId]: { ...state.projectApps?.[projectId], [appId]: enabled } } };
}
export function switchProjectZenTao(state, projectId, connectionId, tasks = []) {
  const candidate = state.connections.find(c => c.id === connectionId && c.app === 'zentao');
  if (connectionId && !candidate) return { ok: false, state, reason: '目标连接不存在。' };
  let blocked;try{blocked=demoZenTaoRuns(tasks,projectId);}catch(error){return{ok:false,state,reason:error.message};}
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
export function mailSourceDiagnostic(scene, hasSource, hasSelection = hasSource) {
  if (!hasSelection) return { state: 'unselected', title: '未选用读取来源', reason: '尚未发起邮件读取；在项目中选择一个本地来源后再检查。仍可保存草稿和使用其他Agent能力。' };
  if (!hasSource) return { state: 'failed', title: '已选读取来源当前不可用', reason: '检查项目选定来源的连接与权限；不会改用其他邮箱，也不会当作完整空结果。' };
  const failures = {
    denied: ['本地来源无访问权限', '请在来源配置中检查本机目录访问权限；不会反复重试权限错误。'],
    locked: ['本地来源暂时被占用', '有限重试后仍未读到；待来源可读后重新检查，不修改Foxmail文件。'],
    unsupported: ['当前Foxmail来源格式不支持', '请检查来源路径和受支持格式；首版不提供导出后导入通道，也不将旧缓存当作完整新结果。'],
    error: ['本地来源读取失败', '有限重试后仍失败；检查来源后重试。失败不能报告为没有匹配邮件。'],
  };
  if (failures[scene]) return { state: 'failed', title: failures[scene][0], reason: failures[scene][1] };
  if (scene === 'partial') return { state: 'partial', title: '本地读取部分完成', reason: '合成示例：2封邮件正文和1个附件未读到。已读结果可用，缺失项明确标记；不能称为完整检索或推断缺失内容。' };
  return { state: 'complete', title: '本地示例检查完整', reason: '仅覆盖本次日期范围内已下载到本机的数据，不表示远端邮箱已经同步。' };
}
export function mailQueryWindow(days, now = new Date()) {
  const count = validMailDays(days) ? Number(days) : 30;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - count + 1);
  const date = value => [value.getFullYear(), String(value.getMonth() + 1).padStart(2, '0'), String(value.getDate()).padStart(2, '0')].join('-');
  return { days: count, from: date(start), through: date(now), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}
export const DEMO_MAIL_DRAFT = { to: 'team@example.invalid', subject: 'M10 接入方案评审', body: '大家好，\n\n应用连接和项目选用方案已整理，请查看账号配置、本地邮件读取与结果恢复流程。\n\n谢谢。', attachment: false };
function projectDrafts(drafts) {
  // Persist only a fixture identity and lifecycle metadata; never user-entered mail text.
  return (Array.isArray(drafts) ? drafts : []).filter(d => d.fixture === 'm10-review').map(d => ({ id: String(d.id), project: String(d.project), fixture: 'm10-review', revision: Number(d.revision) || 1, senderId: typeof d.senderId === 'string' ? d.senderId : '', mailBindingRevision: Number.isSafeInteger(d.mailBindingRevision) ? d.mailBindingRevision : -1,mailSendSlotRevision: Number.isSafeInteger(d.mailSendSlotRevision) ? d.mailSendSlotRevision : -1, status: ['draft','sending','success','failed','unknown'].includes(d.status) ? d.status : 'draft', at: String(d.at || '') }));
}
export function saveDemoDraft(state, project, existingId, expectedRevision) {
  const old = state.drafts?.find(d => d.id === existingId);
  if (old && old.project !== project) return { ok: false, state, reason: '不能覆盖其他项目的草稿。' };
  if (old && old.revision !== expectedRevision) return { ok: false, state, reason: '草稿已由其他会话修改，请重新打开。' };
  if (old && ['sending','success','unknown'].includes(old.status)) return { ok: false, state, reason: '发送中、已发送或结果未知的记录不能覆盖；先核实结果。' };
  const draft = { id: old?.id || 'draft-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7), project, fixture: 'm10-review', revision: (old?.revision || 0) + 1, senderId: selectedConnections(state, project, 'mail').find(c => c.kind === 'smtp')?.id || '', mailBindingRevision: state.mailBindingRevisions?.[project] || 0,mailSendSlotRevision: mailSlotRevision(state,project,'smtp'), status: 'draft', at: new Date().toLocaleString('zh-CN') };
  return { ok: true, state: { ...state, drafts: [draft, ...(state.drafts || []).filter(d => d.id !== draft.id)] }, draft };
}
export function demoDraftSendEligibility(state, projectId, draft) {
  const sender = selectedConnections(state, projectId, 'mail').find(c => c.kind === 'smtp');
  if (!draft || draft.project !== projectId || !['draft','failed'].includes(draft.status)) return { ok: false, reason: '草稿状态不允许提交。' };
  if (!projectAppEnabled(state, projectId, 'mail')) return { ok: false, reason: '当前项目未启用邮件，草稿保留。' };
  const changed = draft.senderId !== (sender?.id || '') || (draft.mailSendSlotRevision >= 0 ? draft.mailSendSlotRevision !== mailSlotRevision(state,projectId,'smtp') : draft.mailBindingRevision !== (state.mailBindingRevisions?.[projectId] || 0));
  if (changed) return { ok: false, changed: true, sender, reason: '项目邮件设置已变化，请重新核对来源与发件账号；原草稿未被改写，明确采用当前设置后更新草稿修订。' };
  return connectionReady(sender) ? { ok: true, sender } : { ok: false, sender, reason: '当前项目未配置可用SMTP；草稿仍保留，不改用其他账号。' };
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
  if (!old) return false;
  if (old.kind === 'local') return old.path !== draft.path;
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

// Synthetic-only scope. Missing snapshots in this prototype are known ordinary
// fixtures; an explicitly unknown/corrupt scope must never be treated as empty.
export function demoZenTaoRuns(tasks,projectId){
 return tasks.filter(t=>{
  if(t.project!==projectId||!['running','preparing','stopping'].includes(t.status))return false;
  if(t.integrationScopeUnknown)throw new Error('无法核验受影响会话的应用范围，已保留原连接选择');
  if(!t.integrationSnapshot)return false;
  if(!Array.isArray(t.integrationSnapshot.packages))throw new Error('无法核验受影响会话的应用范围，已保留原连接选择');
  return t.applicationInjection!=='native-only'&&t.integrationSnapshot.packages.some(p=>p.id==='zentao');
 });
}
export function demoApplicationImpact(state,query,projects=[]){
 const target=query.kind==='disconnect'?state.connections.find(c=>c.id===query.connectionId):null;
 if(query.kind==='disconnect'&&!target)throw new Error('该示例连接不存在');
 const appId=target?.app||query.appId||'zentao',connections=state.connections.filter(c=>query.kind==='disconnect'?c.id===query.connectionId:c.app===appId);
 const ids=[...new Set([...Object.keys(state.bindings),...Object.keys(state.projectApps||{})])].filter(id=>query.kind!=='disconnect'||state.bindings[id]?.includes(query.connectionId));
 return{kind:query.kind,appId,connections:connections.map(c=>({id:c.id,name:c.name,providerId:c.kind==='local'?'foxmail':c.kind,enabled:c.enabled,authorization:c.validation==='disconnected'?'disconnected':'connected'})),projects:ids.map(id=>({id,name:projects.find(p=>p.id===id)?.name||id,archived:!!projects.find(p=>p.id===id)?.archived,enabled:projectAppEnabled(state,id,appId),connections:(state.bindings[id]||[]).filter(x=>connections.some(c=>c.id===x)).map(x=>({id:x,slot:connections.find(c=>c.id===x).kind}))})),runs:[]};
}
