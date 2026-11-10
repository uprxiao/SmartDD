// M13 原型模型：插件、能力统一管理（Skill／MCP）、AI 配置（本机工具／Provider／运行配置）。
// 依据 docs/里程碑/M13_应用Skill与MCP插件化重构/需求.md R0.3（含补记）与 技研/技术方案.md T1.0 草案。
// 全部为合成数据：不读取真实插件、CLI 配置、Skill 目录或密钥，不发网络请求，不启动任何程序。

export const AGENTS = { claude: 'Claude Code', codex: 'Codex' };

// ---------- 插件 ----------
/** 连接表单声明（审核 P03）：由插件声明字段，WillYou 渲染；密码／Token 只显示“已保存”，原型不保存秘密值。 */
export const CONNECTION_TYPES = {
  zentao: [{ type: 'zentao', label: '禅道连接', fields: [
    { key: 'url', label: '服务器地址', kind: 'text', placeholder: 'https://zentao.example.test', required: true },
    { key: 'account', label: '账号', kind: 'text', required: true },
    { key: 'auth', label: '认证方式', kind: 'choice', options: [['token', 'Token'], ['password', '密码']], default: 'token' },
    { key: 'secret', label: 'Token 或密码', kind: 'secret' }] }],
  mail: [
    { type: 'source', label: '读取来源', fields: [
      { key: 'account', label: 'Foxmail 本机账号', kind: 'text', required: true },
      { key: 'days', label: '读取最近天数（最多 100）', kind: 'number', default: 30, min: 1, max: 100 }] },
    { type: 'smtp', label: '发件账号（SMTP）', fields: [
      { key: 'host', label: 'SMTP 服务器', kind: 'text', placeholder: 'smtp.example.test', required: true },
      { key: 'port', label: '端口', kind: 'number', default: 465, min: 1, max: 65535 },
      { key: 'account', label: '发件人邮箱', kind: 'text', required: true },
      { key: 'secret', label: '密码或授权码', kind: 'secret' }] }],
};
export const connectionTypesOf = plugin => CONNECTION_TYPES[plugin.id] || plugin.connectionTypes || [];
export function connectionSummary(plugin, c) {
  const v = c.values || {};
  if (c.type === 'zentao') return `${v.url || '—'} · ${v.account || '—'} · ${v.auth === 'password' ? '密码' : 'Token'}`;
  if (c.type === 'source') return `Foxmail 本机只读 · ${v.account || '—'} · 最近 ${v.days || 30} 天`;
  if (c.type === 'smtp') return `SMTP ${v.host || '—'}:${v.port || 465} · ${v.account || '—'}`;
  return Object.values(v).join(' · ');
}
/** 校验连接表单：必填项、数字范围。返回错误数组。 */
export function validateConnection(def, values) {
  const errors = [];
  for (const f of def.fields) {
    const v = values[f.key];
    if (f.required && !String(v ?? '').trim()) errors.push(`请填写${f.label}`);
    if (f.kind === 'number' && v !== undefined && v !== '' && (Number(v) < f.min || Number(v) > f.max || !Number.isInteger(Number(v)))) errors.push(`${f.label}应为 ${f.min}–${f.max} 的整数`);
  }
  return errors;
}
export const PLUGINS = [
  { id: 'mail', name: '邮件', mark: 'mail', builtin: true, publisher: 'WillYou', category: '沟通', version: '0.1.4', tagline: '读取本机邮箱，起草与发送邮件',
    description: '让 Agent 读取 Foxmail 本机邮件、整理线索并起草回复；发送前由你确认。随 WillYou 升级，依赖本机原生组件，保持内置。',
    capabilities: [{ name: '读取最近邮件', kind: '读取' }, { name: '查看邮件详情', kind: '读取' }, { name: '保存草稿', kind: '写入' }, { name: '发送草稿', kind: '写入' }],
    skills: ['mail-triage'], examples: ['整理最近 3 天客户邮件里待我回复的问题', '根据这封投诉邮件起草一封礼貌、明确的回复'], projects: ['smartdd'], connections: [{ id: 'mail-local', type: 'source', name: 'Foxmail 本机', values: { account: 'liubu@example.test', days: 30 }, status: 'ok' }] },
  { id: 'browser', name: '浏览器', mark: 'browser', builtin: true, publisher: 'WillYou', category: '自动化', version: '0.1.4', tagline: '在任务内置浏览器中打开和操作网页',
    description: '为每个任务提供隔离的网页标签，Agent 经宿主命令操作页面并保留回执。依赖 Electron 主进程，保持内置。',
    capabilities: [{ name: '打开页面', kind: '写入' }, { name: '页面快照', kind: '读取' }, { name: '点击与输入', kind: '写入' }],
    skills: ['willyou-browser-browser', 'willyou-browser-reproduce-bug'], examples: ['打开测试环境登录页，复现用户反馈的按钮无响应'], projects: ['smartdd', 'ais'], connections: [] },
  { id: 'zentao', name: '禅道', mark: 'zentao', builtin: false, publisher: 'WillYou', category: '研发协作', version: '1.0.0', hostApi: '^1.0',
    tagline: '查询 Bug 与研发需求，分析根因', source: { kind: 'dir', path: '~/WillYou/plugins/zentao' },
    description: '读取当前项目所选禅道中指派给你的 Bug 与研发需求，结合代码分析根因或检查需求。由原内置应用迁移为外部插件，是后续三方应用的模板。',
    migratedFrom: '原内置禅道应用：连接、项目授权与调用历史已迁移',
    permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录', '读取本次绑定连接的账号凭据（宿主按次下发）'],
    dataDir: '~/Library/Application Support/SmartDD/plugins/zentao',
    capabilities: [{ name: '查询指派给我的 Bug', kind: '读取' }, { name: '查询指派给我的研发需求', kind: '读取' }, { name: '查看详情与历史', kind: '读取' }],
    skills: ['zentao-bug-analysis', 'zentao-story-review'], examples: ['分析指派给我的高优先级 Bug，并给出最可能的根因', '检查研发需求 #482 的验收标准是否完整'],
    projects: ['ais', 'smartdd'], connections: [{ id: 'zt-company', type: 'zentao', name: '公司禅道', values: { url: 'https://zentao.example.test', account: 'liubu', auth: 'token' }, status: 'ok' }],
    resources: [{ id: 1281, title: '导出报表时金额四舍五入错误', severity: '严重', status: '激活' }, { id: 1277, title: '登录页在 Safari 下验证码不刷新', severity: '一般', status: '激活' }, { id: 1263, title: '批量导入超过 500 行时超时', severity: '严重', status: '已解决' }] },
];
export const INSTALL_CANDIDATES = [
  { id: 'demo-tracker', file: 'demo-tracker-0.1.0.zip', kind: 'zip', name: 'Demo Tracker', version: '0.1.0', publisher: '示例开发者', category: '示例', hostApi: '^1.0',
    tagline: '示例插件：记录与查询待办', permissions: ['读写插件私有数据目录'], capabilities: [{ name: '列出待办', kind: '读取' }, { name: '新增待办', kind: '写入' }], skills: ['demo-tracker-usage'] },
  { id: 'zentao', file: '~/Downloads/zentao-plugin-1.1.0/', kind: 'dir', name: '禅道', version: '1.1.0', publisher: 'WillYou', hostApi: '^1.0', tagline: '查询 Bug 与研发需求，分析根因', permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录', '读取本次绑定连接的账号凭据（宿主按次下发）'], capabilities: [{ name: '查询指派给我的 Bug', kind: '读取' }, { name: '查询指派给我的研发需求', kind: '读取' }, { name: '查看详情与历史', kind: '读取' }], skills: ['zentao-bug-analysis', 'zentao-story-review'] },
  { id: 'zentao', file: '~/Downloads/zentao-plugin-2.0.0-drop/', kind: 'dir', name: '禅道', version: '2.0.0', publisher: 'WillYou', hostApi: '^1.0', tagline: '删除了“查看详情与历史”的示例新版本', permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录'], capabilities: [{ name: '查询指派给我的 Bug', kind: '读取' }, { name: '查询指派给我的研发需求', kind: '读取' }], skills: ['zentao-bug-analysis'] },
  { id: 'report-kit', file: 'report-kit-2.0.0.zip', kind: 'zip', name: 'Report Kit', version: '2.0.0', publisher: '第三方', hostApi: '^2.0', tagline: '需要更新版 WillYou', permissions: [], capabilities: [], skills: [] },
  { id: 'native-helper', file: 'native-helper-0.3.0.zip', kind: 'zip', name: 'Native Helper', version: '0.3.0', publisher: '第三方', hostApi: '^1.0', nativeModule: 'runtime/helper.node', tagline: '自带原生模块', permissions: [], capabilities: [], skills: [] },
  { id: null, file: 'broken-plugin.zip', kind: 'zip', broken: '缺少 .willyou-plugin/plugin.json', permissions: [], capabilities: [], skills: [] },
];
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
export const HOST_API = '1.4';
/** 安装前校验：结构、身份、宿主接口、原生模块、已安装版本。返回 {ok, kind, errors, existing}。 */
/** 更新时比对能力（需求补记第 5 项）：新版本删除的能力若无 legacyToolNames 映射，提示老任务调用会失败。 */
export function removedCapabilities(existing, candidate) {
  if (!existing || !candidate.capabilities?.length) return [];
  const next = new Set(candidate.capabilities.map(c => c.name)), legacy = candidate.legacyToolNames || {};
  return existing.capabilities.filter(c => !next.has(c.name) && !legacy[c.name]).map(c => c.name);
}
export function validateInstall(candidate, installed) {
  const errors = [];
  if (candidate.broken) return { ok: false, kind: 'invalid', errors: ['插件包结构不完整：' + candidate.broken] };
  const major = Number((candidate.hostApi || '').replace(/[^\d.]/g, '').split('.')[0]);
  if (major !== Number(HOST_API.split('.')[0])) errors.push(`需要 WillYou 插件接口 ${candidate.hostApi}，当前为 ${HOST_API}，请先升级 WillYou`);
  if (candidate.nativeModule) errors.push(`包含原生模块 ${candidate.nativeModule}，首期不支持，未安装`);
  const existing = installed.find(p => p.id === candidate.id);
  if (existing?.builtin) errors.push('与内置应用同名，不能覆盖');
  if (errors.length) return { ok: false, kind: 'invalid', errors, existing };
  if (!existing) return { ok: true, kind: 'install', errors: [] };
  const d = cmpVer(candidate.version, existing.version);
  return d > 0 ? { ok: true, kind: 'update', errors: [], existing } : { ok: false, kind: d === 0 ? 'same' : 'downgrade', errors: [d === 0 ? `已安装同一版本 ${existing.version}` : `已安装更新的版本 ${existing.version}，不支持降级`], existing };
}

// ---------- 能力统一管理 ----------
// target 状态：source 来源 · configured 已配置 · onrun 按次注入 · pending 待纳管 · blocked 不可用（reason）
export const CAPABILITIES = [
  { id: 's-frontend', type: 'skill', name: 'frontend-design', desc: '前端界面设计规范与组件生成', from: 'claude', scope: 'user', path: '~/.claude/skills/frontend-design', state: 'managed',
    targets: { claude: { s: 'source' }, codex: { s: 'configured', at: '~/.agents/skills/frontend-design' } } },
  { id: 's-pdf', type: 'skill', name: 'pdf-tools', desc: '读取、合并与拆分 PDF', from: 'codex', scope: 'user', path: '~/.agents/skills/pdf-tools', state: 'new',
    targets: { codex: { s: 'source' }, claude: { s: 'pending', at: 'Claude 第三方运行：$CLAUDE_CONFIG_DIR/skills/pdf-tools；原有登录：本次运行插件目录' } } },
  { id: 's-ais', type: 'skill', name: 'ais-backend-java-rules', desc: 'AIS Java 后端开发规范', from: 'codex', scope: 'project', project: 'ais', path: '<AIS>/.agents/skills/ais-backend-java-rules', state: 'managed',
    targets: { codex: { s: 'source' }, claude: { s: 'onrun', at: '每次在 AIS 中运行时挂载为 willyou-run:ais-backend-java-rules' } } },
  { id: 's-release', type: 'skill', name: 'release-notes', desc: '按提交生成发布说明', from: 'claude', scope: 'user', path: '~/.claude/skills/release-notes', state: 'conflict',
    conflict: 'Codex 用户目录 ~/.agents/skills/release-notes 已有你自己的同名 Skill', targets: { claude: { s: 'source' }, codex: { s: 'blocked', reason: '同名冲突' } } },
  { id: 's-old', type: 'skill', name: 'old-helper', desc: '来源已被卸载', from: 'claude', scope: 'user', path: '~/.claude/skills/old-helper', state: 'dangling',
    targets: { claude: { s: 'blocked', reason: '来源已删除' }, codex: { s: 'blocked', reason: '链接已失效，下次扫描自动清理' } } },
  { id: 'm-github', type: 'mcp', name: 'github', desc: 'stdio · npx @modelcontextprotocol/server-github', from: 'claude', scope: 'user', path: '~/.claude.json · mcpServers.github', state: 'managed', transport: 'stdio',
    env: ['GITHUB_TOKEN（引用 ${GITHUB_TOKEN}）'], approval: 'source', targets: { claude: { s: 'source' }, codex: { s: 'onrun', at: '启动时以 -c mcp_servers.github 注入，经 WillYou 启动包装' } } },
  { id: 'm-pg', type: 'mcp', name: 'postgres-readonly', desc: 'stdio · 只读数据库查询', from: 'codex', scope: 'project', project: 'smartdd', path: '<SmartDD>/.codex/config.toml · mcp_servers.postgres-readonly', state: 'new', transport: 'stdio',
    env: ['PGURL（Codex env_vars 引用）'], approval: 'source', targets: { codex: { s: 'source' }, claude: { s: 'pending', at: '在 SmartDD 中运行时以 --mcp-config 注入' } } },
  { id: 'm-jira', type: 'mcp', name: 'jira', desc: 'http · https://jira.example.test/mcp?api_key=•••', from: 'claude', scope: 'user', path: '~/.claude.json · mcpServers.jira', state: 'unsupported', transport: 'http',
    reason: 'URL 含凭据（查询参数 api_key）', fix: '在来源中改用请求头或环境变量鉴权后重新扫描', targets: { claude: { s: 'source' }, codex: { s: 'blocked', reason: '不支持转换：URL 含凭据' } } },
  { id: 'm-docs', type: 'mcp', name: 'internal-docs', desc: 'stdio · 内部文档检索', from: 'claude', scope: 'user', path: '~/.claude.json · mcpServers.internal-docs', state: 'missing-var', transport: 'stdio',
    env: ['API_KEY（引用 ${DOCS_KEY}，当前未设置）'], reason: '缺少变量 DOCS_KEY', fix: '在启动 WillYou 的环境或该 MCP 的来源配置中提供 DOCS_KEY', targets: { claude: { s: 'source' }, codex: { s: 'blocked', reason: '缺少变量，整个 MCP 不注入' } } },
  { id: 'm-figma', type: 'mcp', name: 'figma', desc: 'http · 需要 OAuth', from: 'claude', scope: 'user', path: '~/.claude.json · mcpServers.figma', state: 'auth', transport: 'http',
    reason: '需要 OAuth 登录', fix: '在 Codex 中执行 codex mcp login figma 完成认证', targets: { claude: { s: 'source' }, codex: { s: 'blocked', reason: '需在 Codex 单独认证' } } },
  { id: 'm-sentry', type: 'mcp', name: 'sentry', desc: 'sse · https://mcp.sentry.example.test/sse', from: 'claude', scope: 'user', path: '~/.claude.json · mcpServers.sentry', state: 'unsupported', transport: 'sse',
    reason: 'Codex 不支持 SSE 传输', fix: '如来源提供 HTTP 端点，在来源改用后重新扫描', targets: { claude: { s: 'source' }, codex: { s: 'blocked', reason: 'SSE 不支持' } } },
];
/** 插件自带 Skill 由插件安装状态派生（审核 P04）：随插件安装、停用、更新、卸载变化。 */
export const pluginSkillCaps = plugins => plugins.filter(p => p.enabled).flatMap(p => (p.skills || []).map(name => ({ id: 'ps-' + p.id + '-' + name, type: 'skill', name, desc: `${p.name}插件自带`, from: 'plugin', plugin: p.id, pluginName: p.name, scope: 'plugin', path: `${p.name}插件 ${p.version}`, state: 'plugin', targets: {} })));
export const STATE_LABEL = { managed: '已纳管', new: '新发现', conflict: '同名冲突', dangling: '来源已删除', plugin: '插件自带', unsupported: '不支持转换', 'missing-var': '缺少变量', auth: '需单独认证', host: '宿主专属' };
export const STATE_TONE = { managed: 'ok', new: 'info', conflict: 'warn', dangling: 'warn', plugin: 'muted', unsupported: 'warn', 'missing-var': 'warn', auth: 'warn', host: 'muted' };
export const ATTENTION = new Set(['conflict', 'dangling', 'unsupported', 'missing-var', 'auth']);
export const scopeLabel = (c, projects = []) => c.scope === 'user' ? `${AGENTS[c.from]} · 用户级` : c.scope === 'project' ? `${AGENTS[c.from]} · 项目 ${projects.find(p => p.id === c.project)?.name || c.project}` : c.scope === 'plugin' ? `随${c.pluginName || ''}插件管理` : '宿主内置';
export function filterCapabilities(items, { type, filter, query }) {
  const q = (query || '').trim().toLowerCase();
  return items.filter(c => !c.hidden && c.type === type && (!q || (c.name + c.desc).toLowerCase().includes(q)) && (filter === 'all' || (filter === 'new' && c.state === 'new') || (filter === 'managed' && c.state === 'managed') || (filter === 'attention' && ATTENTION.has(c.state))));
}
export function countBy(items, type) { const r = { all: 0, new: 0, managed: 0, attention: 0 }; for (const c of items) if (!c.hidden && c.type === type) { r.all++; if (c.state === 'new') r.new++; if (c.state === 'managed') r.managed++; if (ATTENTION.has(c.state)) r.attention++; } return r; }
/** 一键纳管：只处理“新发现”，冲突等始终交给用户；返回 {items, managed:[名字]}。 */
export function manageAll(items) {
  const managed = [];
  const next = items.map(c => { if (c.state !== 'new') return c; managed.push(c.name); return manage(c); });
  return { items: next, managed };
}
/** 纳管后的生效方式（审核 P09）：MCP 一律按次注入，不写目标全局配置；Skill 用户级链接到共用目录，项目级按次挂载。 */
export const managedState = c => c.type === 'mcp' || c.scope === 'project' ? 'onrun' : 'configured';
export function manage(c) { return { ...c, state: 'managed', targets: Object.fromEntries(Object.entries(c.targets).map(([k, t]) => [k, t.s === 'pending' ? { ...t, s: managedState(c) } : t])) }; }
export function unmanage(c) { return { ...c, state: 'new', targets: Object.fromEntries(Object.entries(c.targets).map(([k, t]) => [k, t.s === 'configured' || t.s === 'onrun' ? { ...t, s: 'pending' } : t])) }; }

// ---------- AI 配置 ----------
export const TOOLS = [
  { id: 'claude', name: 'Claude Code', path: '~/.local/bin/claude', version: '2.1.322', verified: ['2.1.321', '2.1.322'] },
  { id: 'codex', name: 'Codex', path: '~/.local/bin/codex', version: '0.166.0', verified: ['0.166.0'] },
];
export const PROVIDERS = [
  { id: 'native-claude', name: 'Claude Code 原有登录', type: 'native', catalog: 'native-claude', tool: 'claude', note: '使用你在 Claude Code 中已登录的账号，WillYou 不读取凭据' },
  { id: 'native-codex', name: 'Codex 原有登录', type: 'native', catalog: 'native-codex', tool: 'codex', note: '使用你在 Codex 中已登录的账号，WillYou 不读取凭据' },
  { id: 'deepseek', name: 'DeepSeek', type: 'preset', preset: 'deepseek', catalog: 'deepseek', url: 'https://api.deepseek.com/', endpoints: { responses: 'https://api.deepseek.com/', anthropic: 'https://api.deepseek.com/anthropic' }, protocols: ['responses', 'anthropic'], key: 'sk-•••• 3f9a', refreshed: '今天 09:12',
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K', status: 'ok' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', ctx: '128K', status: 'ok' }, { id: 'deepseek-legacy-chat', name: 'deepseek-legacy-chat', ctx: '64K', status: 'rejected', detail: '能列出，但调用被服务端拒绝' }] },
  { id: 'magpie', name: 'Magpie', type: 'preset', preset: 'magpie', catalog: 'magpie', url: 'http://127.0.0.1:3425/v1', endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425' }, protocols: ['responses', 'anthropic'], key: 'magpie-codex', refreshed: '今天 08:40',
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K', status: 'ok' }, { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', ctx: '200K', status: 'untested' }] },
];
export const PROTOCOL_LABEL = { responses: 'OpenAI Responses', anthropic: 'Anthropic Messages' };
export const TOOL_PROTOCOL = { codex: 'responses', claude: 'anthropic' };
export function compatible(toolId, provider) {
  if (provider.type === 'native') return provider.tool === toolId ? { ok: true } : { ok: false, reason: `只能用于 ${AGENTS[provider.tool]}` };
  return provider.protocols.includes(TOOL_PROTOCOL[toolId]) ? { ok: true } : { ok: false, reason: `${AGENTS[toolId]} 需要 ${PROTOCOL_LABEL[TOOL_PROTOCOL[toolId]]} 兼容接口` };
}
export const autoName = (toolId, provider) => `${AGENTS[toolId]} · ${provider.type === 'native' ? '原有登录' : provider.name.replace(/（.*）/, '')}`;
export const CLAUDE_TIERS = [['opus', 'Opus 档'], ['sonnet', 'Sonnet 档'], ['haiku', 'Haiku 档'], ['smallFast', 'small-fast'], ['subagent', '子 Agent']];
/** 按所选 Provider 重建档位映射（审核 P07）：保留仍属于该 Provider 且可用的映射，其余改为默认模型。 */
export function rebuildTiers(provider, model, tiers = {}) {
  const ok = new Set((provider?.models || []).filter(m => m.status !== 'rejected').map(m => m.id));
  return Object.fromEntries(CLAUDE_TIERS.map(([k]) => [k, ok.has(tiers[k]) ? tiers[k] : model]));
}
export const tiersValid = (provider, tiers) => CLAUDE_TIERS.every(([k]) => (provider?.models || []).some(m => m.id === tiers?.[k] && m.status !== 'rejected'));
export const RUN_CONFIGS = [
  { id: 'rc-cc-native', name: 'Claude Code · 原有登录', tool: 'claude', provider: 'native-claude', model: null, default: true },
  { id: 'rc-codex-native', name: 'Codex · 原有登录', tool: 'codex', provider: 'native-codex', model: null },
  { id: 'rc-codex-ds', name: 'Codex · DeepSeek', tool: 'codex', provider: 'deepseek', model: 'deepseek-v4-pro' },
  { id: 'rc-cc-ds', name: 'Claude Code · DeepSeek', tool: 'claude', provider: 'deepseek', model: 'deepseek-v4-pro', tiers: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-flash', smallFast: 'deepseek-v4-flash', subagent: 'deepseek-v4-pro' } },
  { id: 'rc-legacy-rj', name: 'CC-rj', tool: 'claude', provider: null, model: null, legacy: true, legacyNote: '从旧 AI 配置迁移：包含无法识别的变量 RJ_GATEWAY_MODE，整体保留为高级配置，原凭据引用不变',
    env: [{ key: 'ANTHROPIC_BASE_URL', value: 'https://rj-gateway.example.test' }, { key: 'ANTHROPIC_AUTH_TOKEN', secret: true }, { key: 'RJ_GATEWAY_MODE', value: 'strict' }], args: '' },
];
/** 运行配置在启动时的说明（只显示规则，不显示具体值）。 */
export function runNotes(rc, provider) {
  const n = [];
  if (rc.legacy) return ['按原配置的环境变量与参数启动，不做拆分'];
  if (provider?.type === 'native') return [rc.tool === 'claude' ? '使用你自己的 ~/.claude 与登录' : '使用默认 CODEX_HOME 与登录'];
  if (rc.tool === 'claude') { n.push('使用 WillYou 管理的独立 Claude 配置目录，Key 只经进程环境传入'); n.push('不应用项目 .claude/settings 中的权限规则与钩子；项目 CLAUDE.md 照常加载'); n.push('所有档位（含 small-fast、子 Agent）映射到该 Provider 的模型'); }
  else { n.push('按次注入 Provider 与模型目录，不写 ~/.codex/config.toml'); n.push('关闭插件同步与统计：Codex 原生插件在此类运行中不可用'); }
  return n;
}
export const PRESETS = {
  deepseek: { name: 'DeepSeek', url: 'https://api.deepseek.com/', protocols: ['responses', 'anthropic'], keyLabel: 'DeepSeek Key', models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', ctx: '128K' }] },
  magpie: { name: 'Magpie（本机网关）', url: 'http://127.0.0.1:3425/v1', protocols: ['responses', 'anthropic'], keyLabel: '令牌', defaultKey: 'magpie-codex', models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K' }, { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', ctx: '200K' }] },
};
/** 自定义地址探测（合成）：只给出候选协议，最终以一次最小调用确认。 */
export function probe(url, key, scene) {
  if (!/^https?:\/\/.+/.test(url)) return { ok: false, error: '请输入以 http:// 或 https:// 开头的地址' };
  if (scene === 'unreachable') return { ok: false, error: '服务不可达：连接超时（10 秒）。请检查地址、网络或代理。' };
  if (scene === 'bad-key' || !key) return { ok: false, error: '模型列表返回 401，Key 可能无效。' };
  if (scene === 'empty') return { ok: true, candidates: ['responses'], models: [], note: '模型列表为空或不支持，可手动填写模型 ID' };
  return { ok: true, candidates: ['responses', 'anthropic'], models: [{ id: 'acme-coder-large', name: 'acme-coder-large', ctx: '128K' }, { id: 'acme-coder-small', name: 'acme-coder-small', ctx: '64K' }] };
}
/** 全局模型变化（只读检测）：返回提醒内容，WillYou 不写回。 */
export function globalModelNotice(before, after) {
  if (before.model === after.model && before.effort === after.effort) return null;
  const lines = [];
  if (before.model !== after.model) lines.push(before.model === undefined ? 'model（原来没有这一项，可删除该行）' : `model = "${before.model}"`);
  if (before.effort !== after.effort) lines.push(before.effort === undefined ? 'model_reasoning_effort（原来没有这一项，可删除该行）' : `model_reasoning_effort = "${before.effort}"`);
  return { before, after, restore: lines };
}

// ================= P0.5 =================
// ---------- 插件连接：全局默认＋项目个性化（需求“插件连接与项目使用”补记） ----------
/** 每个插件每种连接类型一个全局默认；有连接时必须有默认。 */
export const INITIAL_DEFAULTS = { zentao: { zentao: 'zt-company' }, mail: { source: 'mail-local' } };
/** 项目绑定：{[pluginId]: {[projectId]: {disabled?, [type]: {mode:'follow'|'custom', connectionId?}}}}；未记录即“跟随全局”。 */
export const INITIAL_BINDINGS = {};
/** 合成的运行中任务及其启动时绑定的连接（用于“运行中任务继续用原连接”与删除拦截）。 */
export const RUNNING_TASKS = [{ id: 'run-1', title: '分析登录页验证码问题', project: 'ais', plugin: 'zentao', type: 'zentao', connectionId: 'zt-company' }];
export const projectBinding = (bindings, pluginId, projectId) => bindings[pluginId]?.[projectId] || {};
export function effectiveConnection(plugin, defaults, bindings, projectId, type) {
  const b = projectBinding(bindings, plugin.id, projectId);
  if (b.disabled) return { disabled: true };
  const slot = b[type];
  if (slot?.mode === 'custom') return { mode: 'custom', connection: plugin.connections.find(c => c.id === slot.connectionId) || null };
  return { mode: 'follow', connection: plugin.connections.find(c => c.id === defaults[plugin.id]?.[type]) || null };
}
/** 改全局默认的影响：跟随全局的项目将同步；个性化的保持不变（即使选的就是原默认）。 */
export function defaultChangeImpact(plugin, bindings, projects, type) {
  const follow = [], custom = [];
  for (const pr of projects) { const b = projectBinding(bindings, plugin.id, pr.id); if (b.disabled) continue; (b[type]?.mode === 'custom' ? custom : follow).push(pr); }
  return { follow, custom };
}
/** 删除连接的影响：运行中任务在用则阻止；是全局默认且还有其他连接则须先选新默认；个性化选了它的项目改回跟随全局。 */
export function deleteImpact(plugin, defaults, bindings, projects, conn, running = RUNNING_TASKS) {
  const sameType = plugin.connections.filter(c => c.type === conn.type);
  const runningUse = running.filter(t => t.plugin === plugin.id && t.connectionId === conn.id);
  const isDefault = defaults[plugin.id]?.[conn.type] === conn.id;
  const customProjects = projects.filter(pr => { const s = projectBinding(bindings, plugin.id, pr.id)[conn.type]; return s?.mode === 'custom' && s.connectionId === conn.id; });
  return { blocked: runningUse.length > 0, runningUse, isDefault, needNewDefault: isDefault && sameType.length > 1, last: sameType.length === 1, others: sameType.filter(c => c.id !== conn.id), customProjects };
}

// ---------- 邮件“草稿”页（需求补记第 1 项） ----------
export const MAIL_DRAFTS = [
  { id: 'd1', subject: '回复：报表金额四舍五入问题的处理进度', to: 'wang@customer.example', updated: '今天 10:42', status: 'draft', project: 'smartdd', attachments: ['处理说明.pdf'], body: '王经理您好：\n关于导出报表金额四舍五入的问题，我们已定位原因，预计本周五发布修复版本……' },
  { id: 'd2', subject: '本周发布说明', to: 'team@example.test', updated: '昨天 18:05', status: 'sent', sentAt: '昨天 18:06', project: 'smartdd', attachments: [], body: '本周发布内容如下……' },
  { id: 'd3', subject: '回复：登录异常', to: 'li@customer.example', updated: '昨天 15:20', status: 'failed', error: 'SMTP 认证失败：授权码已过期', project: 'ais', attachments: ['截图.png'], body: '李工您好：……' },
  { id: 'd4', subject: '回复：批量导入超时', to: 'zhao@customer.example', updated: '11 月 9 日', status: 'unknown', project: 'ais', attachments: [], body: '赵工您好：……' },
];
export const DRAFT_STATUS = { draft: ['草稿', 'muted'], sent: ['已发送', 'ok'], failed: ['发送失败', 'danger'], unknown: ['结果未知', 'warn'] };

// ---------- 禅道“我的工作”页（需求补记第 2 项，审核 P10） ----------
const mkBugs = () => Array.from({ length: 12 }, (_, i) => ({ id: 1290 - i * 3, kind: 'bug', title: ['导出报表时金额四舍五入错误', '登录页在 Safari 下验证码不刷新', '批量导入超过 500 行时超时', '权限列表分页后筛选条件丢失', '移动端菜单遮挡保存按钮', '审计日志时间显示为 UTC'][i % 6] + (i >= 6 ? '（复现于 v2）' : ''), severity: ['严重', '一般', '严重', '一般', '轻微', '一般'][i % 6], status: i % 5 === 4 ? '已解决' : '激活', product: '订单中心', opened: `11 月 ${10 - (i % 9)} 日` }));
const mkStories = () => Array.from({ length: 7 }, (_, i) => ({ id: 482 - i * 5, kind: 'story', title: ['导出报表支持按币种汇总', '登录支持企业微信扫码', '批量导入支持断点续传', '审计日志支持按人员筛选', '订单详情显示物流轨迹', '权限模板支持复制', '数据看板支持自定义时间段'][i], priority: ['高', '中', '高', '低', '中', '中', '低'][i], status: i === 2 ? '已关闭' : '激活', product: '订单中心', opened: `11 月 ${9 - i} 日` }));
export const ZENTAO_ITEMS = { bug: mkBugs(), story: mkStories() };
export const ZENTAO_PAGE = 5;
export function zentaoDetail(item) {
  return { body: item.kind === 'bug' ? `【步骤】\n1. 打开${item.product}\n2. 按描述操作\n【结果】与预期不符：${item.title}\n【期望】按需求正常处理。` : `【需求描述】${item.title}。\n【验收标准】\n1. 功能可用\n2. 有权限控制\n3. 有操作日志`,
    history: [{ at: item.opened + ' 09:12', who: '测试员 张三', what: '创建' }, { at: item.opened + ' 14:30', who: '项目经理 李四', what: '指派给 liubu' }],
    attachments: item.kind === 'bug' && item.id % 2 === 0 ? ['复现截图.png'] : [] };
}

// ---------- WillYou 内置能力（需求补记第 7 项） ----------
export const BUILTIN_CAPS = [
  { id: 'b-db', type: 'skill', name: 'project-db-diagnostics', desc: '按项目配置的数据库做只读诊断', version: '1.3.0', enabled: true },
  { id: 'b-ssh', type: 'skill', name: 'remote-password-ssh', desc: '按项目配置的服务器做 SSH 排查', version: '1.2.1', enabled: true },
  { id: 'b-ctx', type: 'mcp', name: 'WillYou 项目上下文', desc: '按会话提供当前项目的数据库、服务器等资源身份与配置路径', version: '0.1.4', enabled: true },
];

// ---------- 能力页：重新扫描时的新发现（审核 P11 自动纳管演示） ----------
export const DISCOVERY_QUEUE = [
  { id: 's-changelog', type: 'skill', name: 'changelog-writer', desc: '按提交生成变更日志', from: 'claude', scope: 'user', path: '~/.claude/skills/changelog-writer', state: 'new', targets: { claude: { s: 'source' }, codex: { s: 'pending', at: '~/.agents/skills/changelog-writer' } } },
  { id: 's-lint', type: 'skill', name: 'code-review', desc: '代码评审清单', from: 'codex', scope: 'user', path: '~/.agents/skills/code-review', state: 'conflict', conflict: 'Claude 第三方运行目录中已有你自己的同名 Skill', targets: { codex: { s: 'source' }, claude: { s: 'blocked', reason: '同名冲突' } } },
];
/** 合成会话加载状态（审核 P11）：配置成功、会话加载、调用验证分开表达。 */
export const SESSION_STATE = { 's-frontend': { loaded: 1, pending: 1 }, 'm-github': { loaded: 2, pending: 0, verified: true } };

// ---------- AI 配置导入导出（需求补记第 6 项） ----------
/** 导出：勾选运行配置自动带上其 Provider；默认不含 Key；不导出工具路径与本机目录。 */
export function buildExport({ providers, configs, selectedConfigs, selectedProviders, includeKey }) {
  const cfgs = configs.filter(c => selectedConfigs.includes(c.id));
  const provIds = new Set([...selectedProviders, ...cfgs.map(c => c.provider).filter(Boolean)]);
  const provs = providers.filter(p => provIds.has(p.id)).map(p => p.type === 'native' ? { id: p.id, name: p.name, type: 'native', tool: p.tool } : { id: p.id, name: p.name, type: p.type, preset: p.preset, url: p.url, protocols: p.protocols, models: p.models.map(m => ({ id: m.id, name: m.name, ctx: m.ctx })), key: includeKey ? { encrypted: true } : null });
  return { format: 'willyou-ai-config/v1', exportedAt: '2026-11-11T10:00:00Z', includesKeys: !!includeKey, providers: provs, runConfigs: cfgs.map(({ id, name, tool, provider, model, tiers, env, args, legacy }) => ({ id, name, tool, provider, model, tiers, env: (env || []).map(e => ({ key: e.key, ...(e.secret ? { secret: true } : { value: e.value }) })), args, legacy })) };
}
/** 导入预览：同名不覆盖，导入项名称加“（导入）”；未带 Key 的 Provider 标“需要填写 Key”。 */
export function importPreview(file, { providers, configs }) {
  if (file?.format !== 'willyou-ai-config/v1') return { ok: false, error: '不是 WillYou Code Agent 配置文件，或版本不支持' };
  const pn = new Set(providers.map(p => p.name)), cn = new Set(configs.map(c => c.name));
  return { ok: true, encrypted: file.includesKeys,
    providers: file.providers.map(p => ({ ...p, finalName: pn.has(p.name) ? p.name + '（导入）' : p.name, needKey: p.type !== 'native' && !p.key, existsNative: p.type === 'native' && providers.some(x => x.id === p.id) })),
    runConfigs: file.runConfigs.map(c => ({ ...c, finalName: cn.has(c.name) ? c.name + '（导入）' : c.name })) };
}
export const SAMPLE_IMPORT = { format: 'willyou-ai-config/v1', exportedAt: '2026-11-10T08:00:00Z', includesKeys: false, providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'preset', preset: 'deepseek', url: 'https://api.deepseek.com/', protocols: ['responses', 'anthropic'], models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K' }], key: null }, { id: 'acme', name: '同事的 Acme 服务', type: 'custom', url: 'https://api.acme.example/v1', protocols: ['responses'], models: [{ id: 'acme-coder-large', name: 'acme-coder-large', ctx: '128K' }], key: null }], runConfigs: [{ id: 'x1', name: 'Codex · DeepSeek', tool: 'codex', provider: 'deepseek', model: 'deepseek-v4-pro' }, { id: 'x2', name: 'Codex · Acme', tool: 'codex', provider: 'acme', model: 'acme-coder-large' }] };

// ---------- 本机工具自定义路径（审核 P11） ----------
export function checkToolPath(path) {
  if (!path.trim()) return { ok: false, error: '请填写可执行文件路径' };
  if (/missing|不存在/.test(path)) return { ok: false, error: '找不到该文件' };
  if (/\.(txt|md|json)$/.test(path)) return { ok: false, error: '该文件不可执行' };
  return { ok: true };
}

// ================= P0.6：Code Agent 配置（需求 2026-11-11 补记） =================
/** 通用供应商目录：首期内置五家＋原有登录＋自定义。verified=false 的为占位数据，正式开发前须按官方资料或用户提供的信息核实。 */
export const CATALOG_GROUPS = [['native', '原有登录', '使用 CLI 自己登录的账号，不需要 Key'], ['vendor', '供应商', '模型服务的 API'], ['custom', '自定义', '目录里没有的服务']];
export const CATALOG = [
  { id: 'native-claude', group: 'native', name: 'Claude Code 原有登录', tool: 'claude', desc: '使用你在 Claude Code 中已登录的账号', verified: true },
  { id: 'native-codex', group: 'native', name: 'Codex 原有登录', tool: 'codex', desc: '使用你在 Codex 中已登录的账号', verified: true },
  { id: 'deepseek', group: 'vendor', name: 'DeepSeek', desc: '官方 API', endpoints: { responses: 'https://api.deepseek.com/', anthropic: 'https://api.deepseek.com/anthropic' }, keyLabel: 'DeepSeek API Key', verified: true,
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', ctx: '128K' }] },
  { id: 'glm', group: 'vendor', name: 'GLM（智谱）', desc: '智谱开放平台', endpoints: { anthropic: 'https://open.bigmodel.cn/api/anthropic', openai: 'https://open.bigmodel.cn/api/paas/v4' }, keyLabel: '智谱 API Key', verified: false,
    models: [{ id: 'glm-5', name: 'GLM-5', ctx: '128K' }, { id: 'glm-5-air', name: 'GLM-5-Air', ctx: '128K' }] },
  { id: 'smg', group: 'vendor', name: 'SMG', desc: '地址与协议待用户提供', endpoints: { responses: 'https://smg.example.invalid/v1', anthropic: 'https://smg.example.invalid/anthropic' }, keyLabel: 'SMG Key', verified: false,
    models: [{ id: 'smg-coder', name: 'smg-coder（占位）', ctx: '—' }] },
  { id: 'ultracloud', group: 'vendor', name: 'UltraCloud', desc: '地址与协议待用户提供', endpoints: { openai: 'https://ultracloud.example.invalid/v1' }, keyLabel: 'UltraCloud Key', verified: false,
    models: [{ id: 'uc-chat', name: 'uc-chat（占位）', ctx: '—' }] },
  { id: 'magpie', group: 'vendor', name: 'Magpie', desc: '本机网关，真实 Key 与路由留在 Magpie', endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425' }, keyLabel: '令牌', defaultKey: 'magpie-codex', verified: true,
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K' }, { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', ctx: '200K' }] },
];
export const PROTOCOL_TABS = [['responses', 'OpenAI Responses'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI 兼容']];
export const PROTOCOL_LABEL_FULL = { responses: 'OpenAI Responses', anthropic: 'Anthropic', openai: 'OpenAI 兼容' };
/** 供应商可直接搭配的工具：Codex 需要 Responses，Claude Code 需要 Anthropic；原有登录只对应其 CLI。 */
export function toolsFor(p) {
  if (p.type === 'native' || p.group === 'native') return [p.tool];
  const pr = p.protocols || Object.keys(p.endpoints || {});
  return ['codex', 'claude'].filter(t => pr.includes(TOOL_PROTOCOL[t]));
}
export const pairingNote = p => { const t = toolsFor(p); return t.length ? '可用于 ' + t.map(x => AGENTS[x]).join('、') : '两个工具都不能直接使用，可经 Magpie 等网关接入'; };
/** 自定义供应商检测协议（合成）：按地址给出候选协议；以 /anthropic 结尾判为 Anthropic，含 /chat 判为 OpenAI 兼容。 */
export function detectProtocols(url) {
  if (!/^https?:\/\/.+/.test(url)) return { ok: false, error: '请输入以 http:// 或 https:// 开头的地址' };
  if (/anthropic\/?$/.test(url)) return { ok: true, candidates: ['anthropic'] };
  if (/chat|paas|compatible/.test(url)) return { ok: true, candidates: ['openai'] };
  return { ok: true, candidates: ['responses', 'anthropic'] };
}
export const catalogItem = id => CATALOG.find(c => c.id === id);
