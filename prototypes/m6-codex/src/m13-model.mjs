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
  { id: 'zentao', file: '~/Downloads/zentao-plugin-1.1.0/', kind: 'dir', name: '禅道', version: '1.1.0', publisher: 'WillYou', hostApi: '^1.0', tagline: '查询 Bug 与研发需求，分析根因', permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录', '读取本次绑定连接的账号凭据（宿主按次下发）', '联网：下载 Bug 附件'], capabilities: [{ name: '查询指派给我的 Bug', kind: '读取' }, { name: '查询指派给我的研发需求', kind: '读取' }, { name: '查看详情与历史', kind: '读取' }, { name: '下载附件', kind: '读取' }], skills: ['zentao-bug-analysis', 'zentao-story-review', 'zentao-daily-summary'] },
  { id: 'zentao', file: 'zentao-plugin-0.9.0.zip', kind: 'zip', name: '禅道', version: '0.9.0', publisher: 'WillYou', hostApi: '^1.0', tagline: '比已安装版本低的旧包', permissions: ['联网：仅连接你配置的禅道服务器'], capabilities: [{ name: '查询指派给我的 Bug', kind: '读取' }], skills: [] },
  { id: 'zentao', file: '~/Downloads/zentao-plugin-2.0.0-drop/', kind: 'dir', name: '禅道', version: '2.0.0', publisher: 'WillYou', hostApi: '^1.0', tagline: '删除了“查看详情与历史”的示例新版本', permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录'], capabilities: [{ name: '查询指派给我的 Bug', kind: '读取' }, { name: '查询指派给我的研发需求', kind: '读取' }], skills: ['zentao-bug-analysis'] },
  { id: 'report-kit', file: 'report-kit-2.0.0.zip', kind: 'zip', name: 'Report Kit', version: '2.0.0', publisher: '第三方', hostApi: '^2.0', tagline: '需要更新版 WillYou', permissions: [], capabilities: [], skills: [] },
  { id: 'native-helper', file: 'native-helper-0.3.0.zip', kind: 'zip', name: 'Native Helper', version: '0.3.0', publisher: '第三方', hostApi: '^1.0', nativeModule: 'runtime/helper.node', tagline: '自带原生模块', permissions: [], capabilities: [], skills: [] },
  { id: null, file: 'broken-plugin.zip', kind: 'zip', broken: '缺少 .willyou-plugin/plugin.json', permissions: [], capabilities: [], skills: [] },
];
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
export const HOST_API = '1.4';
/** 安装前校验：结构、身份、宿主接口、原生模块、已安装版本。返回 {ok, kind, errors, existing}。 */
/** 更新时比对能力（需求补记第 5 项）：新版本删除的能力若无 legacyToolNames 映射，提示老任务调用会失败。 */
/** 更新时只展示变化（P0.8）：能力、权限、Skill 的增删；删除能力按 legacyToolNames 判断老任务是否会失败。 */
export function updateDiff(existing, candidate) {
  const diff = (a = [], b = []) => [b.filter(x => !a.includes(x)), a.filter(x => !b.includes(x))];
  const [addedCaps, droppedCaps] = diff(existing.capabilities.map(c => c.name), candidate.capabilities.map(c => c.name));
  const [addedPerms, removedPerms] = diff(existing.permissions, candidate.permissions);
  const [addedSkills, removedSkills] = diff(existing.skills, candidate.skills);
  const broken = removedCapabilities(existing, candidate);
  return { addedCaps, droppedCaps, broken, addedPerms, removedPerms, addedSkills, removedSkills, empty: ![addedCaps, droppedCaps, addedPerms, removedPerms, addedSkills, removedSkills].some(x => x.length) };
}
export function removedCapabilities(existing, candidate) {
  if (!existing || !Array.isArray(candidate.capabilities)) return []; // P0.16（审核 N05）：合法的空数组表示新版删除了全部能力
  const next = new Set(candidate.capabilities.map(c => c.name)), legacy = candidate.legacyToolNames || {};
  return existing.capabilities.filter(c => !next.has(c.name) && !legacy[c.name]).map(c => c.name);
}
export function validateInstall(candidate, installed, forPlugin = null) {
  const errors = [];
  if (candidate.broken) return { ok: false, kind: 'invalid', errors: ['插件包结构不完整：' + candidate.broken] };
  // P0.8：从“更新…”进入时只接受同一插件的包（需求补记 3 插件升级）
  if (forPlugin && candidate.id !== forPlugin.id) return { ok: false, kind: 'mismatch', errors: [`这不是${forPlugin.name}的插件包（包内插件为“${candidate.name}”）。安装新插件请用“添加”。`] };
  const major = Number((candidate.hostApi || '').replace(/[^\d.]/g, '').split('.')[0]);
  if (major !== Number(HOST_API.split('.')[0])) errors.push(`需要 WillYou 插件接口 ${candidate.hostApi}，当前为 ${HOST_API}，请先升级 WillYou`);
  if (candidate.nativeModule) errors.push(`包含原生模块 ${candidate.nativeModule}，首期不支持，未安装`);
  const existing = installed.find(p => p.id === candidate.id);
  if (existing?.builtin) errors.push('与内置应用同名，不能覆盖');
  if (errors.length) return { ok: false, kind: 'invalid', errors, existing };
  if (!existing) return { ok: true, kind: 'install', errors: [] };
  const d = cmpVer(candidate.version, existing.version);
  return d > 0 ? { ok: true, kind: 'update', errors: [], existing } : { ok: false, kind: d === 0 ? 'same' : 'downgrade', errors: [d === 0 ? `已是当前版本 ${existing.version}，无需更新` : `版本 ${candidate.version} 低于已安装的 ${existing.version}。不支持安装更低的版本（用户 2026-11-11 决定）`], existing };
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

// ---------- 智能体（P0.12，需求补记“智能体自动生成”） ----------
/** 本机工具。login 为 CLI 自身登录的检测结果：subscription（订阅）／api（CLI 里登录的 API Key）／none；
 *  正式版由 `claude auth status`、`codex login status` 读取，登录后的输出格式须在开发第 1 步用真实账号核实。 */
export const TOOLS = [
  { id: 'claude', name: 'Claude Code', path: '~/.local/bin/claude', version: '2.1.322', verified: ['2.1.321', '2.1.322'], installed: true, login: 'subscription' },
  { id: 'codex', name: 'Codex', path: '~/.local/bin/codex', version: '0.166.0', verified: ['0.166.0'], installed: true, login: 'none' },
];
export const LOGIN_LABEL = { subscription: '订阅', api: 'API' };
export const LOGIN_DESC = { subscription: '使用 CLI 里登录的订阅账号，消耗订阅额度', api: '使用 CLI 里登录的 API Key，按官方价格计费' };
export const loginName = (tool, method) => `${AGENTS[tool]} · ${LOGIN_LABEL[method] || '订阅'}`;
/** 模型可用性按工具分别记录：ok 可用／bad 不可用／untested 未测试（需求第 6 项）。 */
export const AVAIL_LABEL = { ok: '可用', bad: '不可用', untested: '未测试', testing: '测试中…' };
export const availOf = (model, tool) => model?.avail?.[tool] || 'untested';
export const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', type: 'preset', preset: 'deepseek', catalog: 'deepseek', url: 'https://api.deepseek.com/', endpoints: { responses: 'https://api.deepseek.com/', anthropic: 'https://api.deepseek.com/anthropic' }, protocols: ['responses', 'anthropic'], key: 'sk-•••• 3f9a', refreshed: '今天 09:12', recommended: 'deepseek-v4-pro',
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K', avail: { claude: 'ok', codex: 'ok' } }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', ctx: '128K', avail: { claude: 'ok', codex: 'untested' } }, { id: 'deepseek-legacy-chat', name: 'deepseek-legacy-chat', ctx: '64K', avail: { claude: 'bad', codex: 'bad' }, detail: '能列出，但调用被服务端拒绝' }] },
  { id: 'magpie', name: 'Magpie', type: 'preset', preset: 'magpie', catalog: 'magpie', url: 'http://127.0.0.1:3425/v1', endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425' }, protocols: ['responses', 'anthropic'], key: 'magpie-codex', refreshed: '今天 08:40', recommended: { codex: 'gpt-5.5', claude: 'claude-sonnet-5-5' },
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K', avail: { codex: 'ok', claude: 'untested' } }, { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', ctx: '200K', avail: { claude: 'ok', codex: 'bad' }, detail: 'Codex 调用时工具调用格式不兼容' }] },
];
export const PROTOCOL_LABEL = { responses: 'OpenAI Responses', anthropic: 'Anthropic Messages' };
export const TOOL_PROTOCOL = { codex: 'responses', claude: 'anthropic' };
export function compatible(toolId, provider) {
  return (provider.protocols || []).includes(TOOL_PROTOCOL[toolId]) ? { ok: true } : { ok: false, reason: `${AGENTS[toolId]} 需要 ${PROTOCOL_LABEL[TOOL_PROTOCOL[toolId]]} 兼容接口` };
}
export const autoName = (toolId, provider) => `${AGENTS[toolId]} · ${provider.name.replace(/（.*）/, '')}`;
/** 某工具可选的模型：去掉“不可用”，推荐的排第一。 */
export function modelsFor(provider, tool) {
  const rec = recommendedId(provider, tool);
  return (provider?.models || []).filter(m => availOf(m, tool) !== 'bad' && !m.offline).sort((a, b) => (b.id === rec) - (a.id === rec));
}
const recommendedId = (p, tool) => typeof p?.recommended === 'object' ? p.recommended?.[tool] : p?.recommended;
/** 推荐的默认模型：供应商推荐值可用时用它，否则取第一个可用的，再否则第一个未测试的。 */
export function recommendedModel(provider, tool) {
  const ms = modelsFor(provider, tool);
  return (ms.find(m => m.id === recommendedId(provider, tool)) || ms.find(m => availOf(m, tool) === 'ok') || ms[0])?.id || null;
}
export const CLAUDE_TIERS = [['opus', 'Opus 档'], ['sonnet', 'Sonnet 档'], ['haiku', 'Haiku 档'], ['smallFast', 'small-fast'], ['subagent', '子 Agent']];
/** 按所选供应商重建档位映射（审核 P07）：保留仍属于该供应商且在 Claude Code 中不是“不可用”的映射，其余改为默认模型。 */
export function rebuildTiers(provider, model, tiers = {}) {
  const ok = new Set(modelsFor(provider, 'claude').map(m => m.id));
  return Object.fromEntries(CLAUDE_TIERS.map(([k]) => [k, ok.has(tiers[k]) ? tiers[k] : model]));
}
/** P0.16（审核 N02）：Claude Code 五个档位一律等于默认模型（需求补记 5）。 */
export const uniformTiers = model => Object.fromEntries(CLAUDE_TIERS.map(([k]) => [k, model]));
/** 勾选的模型只保留当前在该工具中可选的（不可用、已下线的移除）；默认模型不在其中时改为第一个。 */
export function cleanPicked(provider, tool, picked, model) {
  const ok = new Set(modelsFor(provider, tool).map(m => m.id)); const p = (picked || []).filter(id => ok.has(id));
  return { picked: p, model: p.includes(model) ? model : p[0] || null };
}
export const tiersValid = (provider, tiers) => CLAUDE_TIERS.every(([k]) => modelsFor(provider, 'claude').some(m => m.id === tiers?.[k]));
/** 智能体 = Code Agent ＋ 订阅/API（source: login）或供应商（source: provider）；旧 AI 配置迁移来的为 legacy（P0.13 起与其他智能体平铺）。
 *  列表顺序即首页下拉顺序，默认的固定排第一；visible：是否在首页显示；default：首页默认选中（必须显示）。
 *  models：勾选的模型（P0.14，可多选，会话里可切换）；model：其中的默认模型。 */
export const RUN_CONFIGS = [
  { id: 'rc-cc-login', name: 'Claude Code · 订阅', tool: 'claude', source: 'login', provider: null, model: null, default: true, visible: true },
  { id: 'rc-cc-ds', name: 'Claude Code · DeepSeek', tool: 'claude', source: 'provider', provider: 'deepseek', model: 'deepseek-v4-pro', models: ['deepseek-v4-pro', 'deepseek-v4-flash'], visible: true, tiers: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-pro', smallFast: 'deepseek-v4-pro', subagent: 'deepseek-v4-pro' } },
  { id: 'rc-codex-ds', name: 'Codex · DeepSeek', tool: 'codex', source: 'provider', provider: 'deepseek', model: 'deepseek-v4-pro', models: ['deepseek-v4-pro'], visible: true },
  { id: 'rc-codex-mp', name: 'Codex · Magpie', tool: 'codex', source: 'provider', provider: 'magpie', model: 'gpt-5.5', models: ['gpt-5.5'], visible: false },
  { id: 'rc-legacy-rj', name: 'CC-rj', tool: 'claude', source: 'legacy', provider: null, model: null, legacy: true, visible: true, legacyNote: '从旧 AI 配置迁移：包含无法识别的变量 RJ_GATEWAY_MODE，保留原环境变量与参数，原凭据引用不变',
    env: [{ key: 'ANTHROPIC_BASE_URL', value: 'https://rj-gateway.example.test' }, { key: 'ANTHROPIC_AUTH_TOKEN', secret: true }, { key: 'RJ_GATEWAY_MODE', value: 'strict' }], args: '' },
];
/** Code Agent 列表（P0.13）：首期支持 Claude Code、Codex；其余先展示并标“暂不支持”。 */
export const CODE_AGENTS = [
  { id: 'claude', name: 'Claude Code', supported: true }, { id: 'codex', name: 'Codex', supported: true },
  { id: 'opencode', name: 'OpenCode', supported: false }, { id: 'zcode', name: 'Z Code', supported: false }, { id: 'pi', name: 'Pi', supported: false }, { id: 'dsh', name: 'DSH', supported: false },
];
const newId = () => 'rc-' + Math.random().toString(36).slice(2, 8);
/** 唯一性（P0.15）：同一个 Code Agent ＋ 同一个供应商（或订阅）只能有一个智能体；想用更多模型就编辑已有的那个。旧配置不参与。 */
export const existingAgent = (configs, tool, prov, exceptId) => configs.find(c => c.id !== exceptId && !c.legacy && c.tool === tool && (prov === 'login' ? c.source === 'login' : c.source === 'provider' && c.provider === prov)) || null;
/** 名称不能和其他智能体重复。 */
export const nameTaken = (configs, name, exceptId) => configs.find(c => c.id !== exceptId && c.name.trim() === name.trim()) || null;
/** 名称自动生成：工具 · 供应商（订阅/API 用登录方式）。 */
export function agentName(configs, tool, provider, model, method) {
  const base = provider ? autoName(tool, provider) : loginName(tool, method);
  let n = base, k = 2; while (configs.some(c => c.name === n)) n = `${base} ${k++}`;
  return n;
}
/** 新建供应商智能体；Claude Code 各档位默认等于默认模型。 */
export function makeProviderAgent(provider, tool, extra = {}) {
  const model = extra.model ?? recommendedModel(provider, tool);
  return { id: newId(), name: autoName(tool, provider), tool, source: 'provider', provider: provider.id, model, models: model ? [model] : [], visible: true, tiers: tool === 'claude' ? uniformTiers(model) : undefined, env: [], args: '', ...extra };
}
export const makeLoginAgent = (tool, method, extra = {}) => ({ id: newId(), name: loginName(tool, method), tool, source: 'login', provider: null, model: null, method, visible: true, env: [], args: '', ...extra });
/** 新建时第 ② 步：按所选 Code Agent 的协议过滤供应商；不兼容的单独返回并带原因。 */
export function providersForTool(tool, providers) {
  const compat = [], incompat = [];
  for (const p of providers) { const c = compatible(tool, p); (c.ok ? compat : incompat).push(c.ok ? p : { provider: p, reason: c.reason }); }
  return { compat, incompat };
}
/** 供应商在某工具下的模型摘要：可用几个、未测试几个。 */
export function providerSummary(p, tool) {
  const ms = modelsFor(p, tool); const ok = ms.filter(m => availOf(m, tool) === 'ok').length;
  return { ok, untested: ms.length - ok, text: [ok && `${ok} 个可用`, ms.length - ok && `${ms.length - ok} 个未测试`].filter(Boolean).join(' · ') || '没有可用模型' };
}
/** 排序：列表顺序即首页下拉顺序。 */
const pinned = configs => (configs[0]?.default ? 1 : 0);
/** 默认智能体固定排第一（P0.14）：它不能移动，其他智能体也不能排到它前面。 */
export function moveAgent(configs, id, dir) {
  const i = configs.findIndex(c => c.id === id), j = i + dir;
  if (i < 0 || configs[i].default || j < pinned(configs) || j >= configs.length) return configs;
  const next = [...configs]; [next[i], next[j]] = [next[j], next[i]]; return next;
}
export function reorderAgent(configs, fromId, toId) {
  const from = configs.findIndex(c => c.id === fromId); let to = configs.findIndex(c => c.id === toId);
  if (from < 0 || to < 0 || from === to || configs[from].default) return configs;
  if (to < pinned(configs)) to = pinned(configs);
  const next = [...configs]; const [x] = next.splice(from, 1); next.splice(to, 0, x); return next;
}
/** 默认交接：默认智能体被删除、退出登录或供应商删除时，默认交给下一个在首页显示且可用的智能体。 */
export function nextDefault(configs, excludeIds = [], tools = TOOLS) {
  const ex = new Set([].concat(excludeIds));
  return configs.find(c => !ex.has(c.id) && usable(c, tools)) || null;
}
/** 可作为默认／首页可选：打开首页显示、未退出登录、供应商未删除、工具已安装。 */
const usable = (c, tools = TOOLS) => !!c && c.visible && !c.loggedOut && !c.broken && tools.find(t => t.id === c.tool)?.installed !== false;
/** P0.16（审核 N04，用户 2026-11-11 决定）：默认智能体不可用（如工具没了）时，按当前顺序从上往下第一个可用的设为默认并排第一；
 *  原默认恢复可用后不抢回。没有默认但有可用的（如新建第一个）时，也设第一个可用的为默认。都不可用时清空默认。 */
export function reconcileDefault(configs, tools = TOOLS) {
  const cur = configs.find(c => c.default);
  if (cur && usable(cur, tools)) return { configs, newDefault: null, previous: null };
  const nd = nextDefault(configs, cur ? [cur.id] : [], tools);
  if (nd) return { configs: withDefault(configs, nd.id), newDefault: nd, previous: cur || null };
  return { configs: cur ? configs.map(c => ({ ...c, default: false })) : configs, newDefault: null, previous: cur || null, empty: true };
}
/** 设为默认：只有在首页显示的才能设为默认；设为默认后排到第一位（P0.14）。 */
export const canBeDefault = rc => !!rc && rc.visible && !rc.loggedOut && !rc.broken;
export function withDefault(configs, id) {
  const next = configs.map(c => ({ ...c, default: c.id === id }));
  const i = next.findIndex(c => c.id === id); if (i > 0) next.unshift(next.splice(i, 1)[0]);
  return next;
}
/** 智能体使用的模型：勾选的模型，默认模型排第一。 */
export const agentModels = rc => { const ms = rc.models?.length ? rc.models : rc.model ? [rc.model] : []; return [rc.model, ...ms.filter(m => m !== rc.model)].filter(Boolean); };
/** 删除智能体或供应商后整理默认：原默认不在了就交接。 */
function handover(configs, removedIds, tools = TOOLS) {
  const left = configs.filter(c => !removedIds.includes(c.id));
  if (left.some(c => c.default)) return { configs: left, newDefault: null };
  const nd = nextDefault(left, [], tools);
  return { configs: nd ? withDefault(left, nd.id) : left, newDefault: nd };
}
export function removeAgent(configs, id, tools = TOOLS) { return handover(configs, [id], tools); }
/** 删除供应商：使用它的智能体一并删除（删除前列出），默认按规则交接。 */
export function removeProviderImpact(providerId, configs, tools = TOOLS) {
  const removed = configs.filter(c => c.provider === providerId);
  return { removed, ...handover(configs, removed.map(c => c.id), tools) };
}
/** 首页可选的智能体（按列表顺序）：打开了“首页显示”、没有退出登录、工具已安装。 */
export const homeAgents = (configs, tools = TOOLS) => configs.filter(c => usable(c, tools));
/** 按 CLI 登录检测结果同步已有的订阅/API 智能体（P0.13 起不自动添加，新建时“订阅”作为一个选项）：
 *  登录方式变化 → 改名（订阅↔API，用户改过的名称保留）；退出登录 → 保留并标“已退出登录”、不在首页显示，默认交给下一个；
 *  重新登录 → 恢复，不抢回默认。 */
export function syncLogin(configs, toolId, method) {
  const mine = configs.filter(c => c.source === 'login' && c.tool === toolId);
  if (!mine.length) return { configs, event: null };
  if (method === 'none') {
    const hit = mine.filter(c => !c.loggedOut); if (!hit.length) return { configs, event: null };
    const ids = new Set(hit.map(c => c.id)), wasDefault = hit.some(c => c.default);
    let next = configs.map(c => ids.has(c.id) ? { ...c, loggedOut: true, visible: false, default: false } : c), newDefault = null;
    if (wasDefault) { newDefault = nextDefault(next); if (newDefault) next = withDefault(next, newDefault.id); }
    return { configs: next, event: { kind: 'logout', agents: hit, newDefault } };
  }
  const name = loginName(toolId, method), out = mine.filter(c => c.loggedOut), sw = mine.filter(c => !c.loggedOut && (c.method || 'subscription') !== method);
  if (!out.length && !sw.length) return { configs, event: null };
  const fix = c => ({ ...c, method, name: c.customName ? c.name : name });
  const next = configs.map(c => out.includes(c) ? { ...fix(c), loggedOut: false, visible: true } : sw.includes(c) ? fix(c) : c);
  return { configs: next, event: out.length ? { kind: 'restored', agents: out } : { kind: 'switched', agents: sw, name } };
}
/** 运行时说明（只显示规则，不显示具体值）。 */
export function runNotes(rc, provider) {
  const n = [];
  if (rc.legacy) return ['按原配置的环境变量与参数启动，不做拆分'];
  if (rc.source === 'login') return [rc.tool === 'claude' ? '不注入任何供应商，使用你自己的 ~/.claude 与登录' : '不注入任何供应商，使用默认 CODEX_HOME 与登录'];
  if (rc.tool === 'claude') { n.push('使用 WillYou 管理的独立 Claude 配置目录，Key 只经进程环境传入'); n.push('不应用项目 .claude/settings 中的权限规则与钩子；项目 CLAUDE.md 照常加载'); n.push(`所有档位（含 small-fast、子 Agent）映射到 ${provider?.name || '该供应商'} 的模型`); }
  else { n.push('按次注入供应商与模型目录，不写 ~/.codex/config.toml'); n.push('关闭插件同步与统计：Codex 原生插件在此类运行中不可用'); }
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
/** P0.16（审核 N07）：running 为运行中任务启动时的连接快照（runningPluginUses(tasks)），不再用写死的示例任务。 */
export function deleteImpact(plugin, defaults, bindings, projects, conn, running = []) {
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

// ---------- AI 配置导入导出（需求补记第 6 项；P0.12：订阅/API 智能体跟随本机登录，不导出） ----------
/** 导出：勾选智能体自动带上其供应商；默认不含 Key；不导出工具路径、本机目录和订阅/API 智能体。 */
export function buildExport({ providers, configs, selectedConfigs, selectedProviders, includeKey }) {
  const cfgs = configs.filter(c => selectedConfigs.includes(c.id) && c.source !== 'login');
  const provIds = new Set([...selectedProviders, ...cfgs.map(c => c.provider).filter(Boolean)]);
  const provs = providers.filter(p => provIds.has(p.id)).map(p => ({ id: p.id, name: p.name, type: p.type, preset: p.preset, url: p.url, protocols: p.protocols, endpoints: p.endpoints || null, recommended: p.recommended ?? null, models: p.models.map(m => ({ id: m.id, name: m.name, ctx: m.ctx })), key: includeKey ? { encrypted: true } : null })); // P0.16（审核 N03）：保留各协议地址与推荐模型
  return { format: 'willyou-ai-config/v1', exportedAt: '2026-11-11T10:00:00Z', includesKeys: !!includeKey, providers: provs, runConfigs: cfgs.map(({ id, name, tool, source, provider, model, models, tiers, env, args, legacy, visible }) => ({ id, name, tool, source, provider, model, models: agentModels({ model, models }), tiers, visible, env: (env || []).map(e => ({ key: e.key, ...(e.secret ? { secret: true } : { value: e.value }) })), args, legacy })) };
}
/** 导入预览：同名不覆盖，导入项名称加“（导入）”；未带 Key 的供应商标“需要填写 Key”；文件里的订阅/API 智能体跳过（按本机登录检测）。 */
export function importPreview(file, { providers, configs }) {
  if (file?.format !== 'willyou-ai-config/v1') return { ok: false, error: '不是 WillYou 智能体配置文件，或版本不支持' };
  // P0.16（审核 N03）：名称在“现有＋本批已分配”的集合里循环避重：X、X（导入）、X（导入 2）……
  const unique = (name, used) => { let n = name, k = 1; while (used.has(n)) n = k++ === 1 ? `${name}（导入）` : `${name}（导入 ${k - 1}）`; used.add(n); return n; };
  const pn = new Set(providers.map(p => p.name)), cn = new Set(configs.map(c => c.name));
  return { ok: true, encrypted: file.includesKeys,
    providers: file.providers.filter(p => p.type !== 'native').map(p => ({ ...p, finalName: unique(p.name, pn), needKey: !p.key })),
    skipped: file.runConfigs.filter(c => c.source === 'login').length,
    runConfigs: file.runConfigs.filter(c => c.source !== 'login').map(c => ({ ...c, finalName: unique(c.name, cn) })) };
}
export const SAMPLE_IMPORT = { format: 'willyou-ai-config/v1', exportedAt: '2026-11-10T08:00:00Z', includesKeys: false, providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'preset', preset: 'deepseek', url: 'https://api.deepseek.com/', protocols: ['responses', 'anthropic'], models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K' }], key: null }, { id: 'acme', name: '同事的 Acme 服务', type: 'custom', url: 'https://api.acme.example/v1', protocols: ['responses'], models: [{ id: 'acme-coder-large', name: 'acme-coder-large', ctx: '128K' }], key: null }], runConfigs: [{ id: 'x1', name: 'Codex · DeepSeek', tool: 'codex', provider: 'deepseek', model: 'deepseek-v4-pro' }, { id: 'x2', name: 'Codex · Acme', tool: 'codex', provider: 'acme', model: 'acme-coder-large' }] };

// ---------- 本机工具自定义路径（审核 P11） ----------
export function checkToolPath(path) {
  if (!path.trim()) return { ok: false, error: '请填写可执行文件路径' };
  if (/missing|不存在/.test(path)) return { ok: false, error: '找不到该文件' };
  if (/\.(txt|md|json)$/.test(path)) return { ok: false, error: '该文件不可执行' };
  return { ok: true };
}

// ================= 供应商目录（P0.6 起；P0.12 去掉“原有登录”组，加 Anthropic、OpenAI 官方） =================
/** verified=false 的为占位数据，正式开发前须按官方资料或用户提供的信息核实。目录里的模型只是示例，接入时以实际获取的列表为准。 */
/** SMG 内网地址不入库（用户 2026-11-11 决定）：原型由开发服务器的环境变量 M13_SMG_URL 注入，没有时显示占位。 */
export const SMG_URL = (typeof __M13_SMG_URL__ !== 'undefined' && __M13_SMG_URL__) || 'http://<SMG 内网地址>';
export const SMG_CONFIGURED = SMG_URL !== 'http://<SMG 内网地址>';
export const CATALOG_GROUPS = [['vendor', '供应商', '模型服务的 API，Key 由 WillYou 加密保存'], ['custom', '自定义', '目录里没有的服务']];
export const CATALOG = [
  { id: 'anthropic', group: 'vendor', name: 'Anthropic', desc: '官方 API', endpoints: { anthropic: 'https://api.anthropic.com' }, keyLabel: 'Anthropic API Key', verified: true, recommended: 'claude-sonnet-5-5',
    models: [{ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', ctx: '200K' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', ctx: '200K' }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5', ctx: '200K' }] },
  { id: 'openai', group: 'vendor', name: 'OpenAI', desc: '官方 API', endpoints: { responses: 'https://api.openai.com/v1' }, keyLabel: 'OpenAI API Key', verified: true, recommended: 'gpt-5.5',
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K' }, { id: 'gpt-5.5-mini', name: 'gpt-5.5-mini', ctx: '256K' }] },
  { id: 'deepseek', group: 'vendor', name: 'DeepSeek', desc: '官方 API', endpoints: { responses: 'https://api.deepseek.com/', anthropic: 'https://api.deepseek.com/anthropic' }, keyLabel: 'DeepSeek API Key', verified: true, recommended: 'deepseek-v4-pro',
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', ctx: '128K' }] },
  { id: 'glm', group: 'vendor', name: 'GLM（智谱）', desc: '智谱开放平台', endpoints: { anthropic: 'https://open.bigmodel.cn/api/anthropic', openai: 'https://open.bigmodel.cn/api/paas/v4' }, keyLabel: '智谱 API Key', verified: false, recommended: 'glm-5',
    models: [{ id: 'glm-5', name: 'GLM-5', ctx: '128K' }, { id: 'glm-5-air', name: 'GLM-5-Air', ctx: '128K' }] },
  // SMG（SmartModelGate）：用户 2026-11-11 提供的内网网关；原型中真实接入（live，见 m13-live.mjs）。公开的 /openapi.json 只有 /v1/messages、/v1/chat/completions、/v1/models 等，没有 Responses；Codex 0.166 已不支持 chat 接口，所以只适用 Claude Code（补验 D）。
  { id: 'smg', group: 'vendor', name: 'SMG', desc: '公司内网模型网关', endpoints: { anthropic: SMG_URL, openai: SMG_URL + '/v1' }, keyLabel: 'SMG API Key', verified: true, live: true, recommended: 'deepseek-v4-pro', models: [] },
  { id: 'ultracloud', group: 'vendor', name: 'UltraCloud', desc: '地址与协议待用户提供', endpoints: { openai: 'https://ultracloud.example.invalid/v1' }, keyLabel: 'UltraCloud Key', verified: false,
    models: [{ id: 'uc-chat', name: 'uc-chat（占位）', ctx: '—' }] },
  { id: 'magpie', group: 'vendor', name: 'Magpie', desc: '本机网关，真实 Key 与路由留在 Magpie', endpoints: { responses: 'http://127.0.0.1:3425/v1', anthropic: 'http://127.0.0.1:3425' }, keyLabel: '令牌', defaultKey: 'magpie-codex', verified: true, recommended: { codex: 'gpt-5.5', claude: 'claude-sonnet-5-5' },
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K' }, { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', ctx: '200K' }] },
];
export const PROTOCOL_TABS = [['responses', 'OpenAI Responses'], ['anthropic', 'Anthropic'], ['openai', 'OpenAI 兼容']];
export const PROTOCOL_LABEL_FULL = { responses: 'OpenAI Responses', anthropic: 'Anthropic', openai: 'OpenAI 兼容' };
/** 供应商能用于哪些工具：Codex 需要 Responses，Claude Code 需要 Anthropic。 */
export function toolsFor(p) {
  const pr = p.protocols || Object.keys(p.endpoints || {});
  return ['claude', 'codex'].filter(t => pr.includes(TOOL_PROTOCOL[t]));
}
export const pairingNote = p => { const t = toolsFor(p); return t.length ? '适用 ' + t.map(x => AGENTS[x]).join('、') : '两个工具都不能直接使用，可经 Magpie 等网关接入'; };
/** 自定义供应商检测协议（合成）：按地址给出候选协议；以 /anthropic 结尾判为 Anthropic，含 /chat 判为 OpenAI 兼容。 */
export function detectProtocols(url) {
  if (!/^https?:\/\/.+/.test(url)) return { ok: false, error: '请输入以 http:// 或 https:// 开头的地址' };
  if (/anthropic\/?$/.test(url)) return { ok: true, candidates: ['anthropic'] };
  if (/chat|paas|compatible/.test(url)) return { ok: true, candidates: ['openai'] };
  return { ok: true, candidates: ['responses', 'anthropic'] };
}
export const catalogItem = id => CATALOG.find(c => c.id === id);
/** 接入时自动测试（合成）：每个兼容工具测一次推荐模型；demo=tools-fail 时 Claude Code 的推荐模型失败，改用下一个候选并标“未测试”。 */
export function autoTest(provider, demo = 'ok') {
  const res = {};
  for (const t of toolsFor(provider)) {
    const m = recommendedModel(provider, t);
    res[t] = { model: m, result: m ? (demo === 'tools-fail' && t === 'claude' ? 'bad' : 'ok') : null };
  }
  return res;
}
/** 把测试结果写回模型可用性。 */
export function applyTest(provider, tests) {
  return { ...provider, models: provider.models.map(m => ({ ...m, avail: { ...(m.avail || {}), ...Object.fromEntries(Object.entries(tests).filter(([, r]) => r.model === m.id && r.result).map(([t, r]) => [t, r.result])) } })) };
}

/** 对会话的统一生效规则（P0.8，需求 R0.3 补记 3）：新建或恢复的会话按最新状态加载；
 *  经 WillYou 转发的插件调用立即按最新状态执行（停用／卸载即拒绝，更新即用新版）；
 *  运行中会话启动时已加载的 Skill 与 MCP 重启后才变化；切换连接另按“运行中用原连接”。 */
export const runningSessions = tasks => (tasks || []).filter(t => t.status === 'running' && !t.archived).length;
const EFFECT = {
  'plugin-off': '运行中的会话即刻不能再调用它，新建或恢复的会话不再加载',
  'plugin-on': '新建或恢复的会话即可使用',
  'plugin-update': '插件调用立即使用新版本',
  'plugin-remove': '运行中的会话即刻不能再调用它',
  'cap-off': '新建或恢复的会话不再加载',
  'cap-on': '新建或恢复的会话即可使用',
  'project-off': '本项目运行中的会话即刻不能再调用它，新建或恢复的会话不再加载',
  'project-on': '本项目新建或恢复的会话即可使用',
};
export function sessionEffect(kind, running = 0) {
  const base = EFFECT[kind];
  if (!base) throw new Error('未知的生效类型：' + kind);
  return running > 0 ? `${base}；${running} 个运行中的会话重启后完全生效` : base;
}

/** 受影响的运行中会话数（P0.10，需求补记 3 B3）：只数真正受影响的会话。
 *  plugin：插件可用的项目里的会话（项目已关闭该插件的不算）；project：该项目的会话；
 *  cap：加载了这一项的会话（项目目录自带的只算该项目）；manage：只算“另一个工具”的会话，可传数组取并集。 */
const AGENT_OF_PROFILE = id => /codex/i.test(id || '') ? 'codex' : /^cc|claude/i.test(id || '') ? 'claude' : null;
export const taskAgent = t => t.runner || AGENT_OF_PROFILE(t.profile);
export function affectedSessions(kind, target, tasks, bindings = {}) {
  const run = (tasks || []).filter(t => t.status === 'running' && !t.archived);
  const inScope = (c, t) => c.scope !== 'project' || t.project === c.project;
  const other = c => c.from === 'claude' ? 'codex' : c.from === 'codex' ? 'claude' : null;
  const hit = {
    plugin: t => !projectBinding(bindings, target.id, t.project).disabled,
    project: t => t.project === target,
    cap: t => inScope(target, t),
    manage: t => [].concat(target).some(c => inScope(c, t) && (!other(c) || !taskAgent(t) || taskAgent(t) === other(c))),
  }[kind];
  if (!hit) throw new Error('未知的影响范围：' + kind);
  return run.filter(hit).length;
}

// ================= P0.16：任务快照（审核 review-20261111-1500 N01／N07） =================
/** 任务创建时记录的智能体快照：恢复与显示都读它，不再回查旧 AI 配置。 */
export function agentSnapshot(agent, providers = [], runModel) {
  if (!agent) return null;
  const p = providers.find(x => x.id === agent.provider);
  const nameOf = id => p?.models?.find(m => m.id === id)?.name || id;
  // runModel：本次运行实际使用的模型（审核 Q01）；新建时为智能体默认模型，恢复时由 resumeDecision 决定
  const run = agent.source === 'provider' ? (runModel || agent.model || null) : null;
  return { agentId: agent.id, agentName: agent.name, tool: agent.tool, source: agent.source, method: agent.method || null, providerId: agent.provider || null, providerName: p?.name || null, providerRev: p ? (p.rev || 0) : null,
    model: agent.model || null, models: agentModels(agent), modelNames: agentModels(agent).map(nameOf), runModel: run, runModelName: run ? nameOf(run) : null };
}
/** 恢复用哪个模型（审核 Q01）：上次使用的模型仍在所选智能体允许列表里就保留；不在时用所选智能体的默认模型并提示。订阅与旧配置按 CLI 自己的模型。 */
export function resumeDecision(snapshot, agent) {
  if (!agent || agent.source !== 'provider') return { model: null, lost: false };
  const last = snapshot?.runModel || snapshot?.model || null;
  if (last && agentModels(agent).includes(last)) return { model: last, lost: false };
  return { model: agent.model, lost: !!last };
}
/** 模型来源的可读描述（恢复提示用）。 */
export const sourceLabel = (a, providers = []) => a.source === 'login' ? `${LOGIN_LABEL[a.method || 'subscription'] || '订阅'}（CLI 自己的登录）` : a.source === 'legacy' ? '旧配置'
  : (providers.find(p => p.id === (a.providerId ?? a.provider))?.name || a.providerName || '供应商已删除');
/** 身份变化（审核 review-20261111-2119 F01，需求 5.3「任务记录与恢复」）：所选智能体就是原智能体（ID 相同），但认证来源已变——
 *  来源类型、CLI 登录方式（订阅↔API）、供应商，或同一供应商的身份修订号（地址、协议或已有 Key 被替换时加 1，不含 Key 原文）。
 *  只改名称、排序、默认模型、勾选模型不算。换成另一个智能体由用户主动选择，不经此判断。 */
export function identityChange(snapshot, agent, providers = []) {
  if (!snapshot || !agent || snapshot.agentId !== agent.id) return null;
  const pid = agent.provider || null; const p = providers.find(x => x.id === pid);
  const changed = snapshot.source !== agent.source
    || (agent.source === 'login' && (snapshot.method || 'subscription') !== (agent.method || 'subscription'))
    || (agent.source === 'provider' && (snapshot.providerId !== pid || (snapshot.providerRev ?? 0) !== (p ? (p.rev || 0) : null)));
  if (!changed) return null;
  const from = sourceLabel(snapshot, []); const to = sourceLabel(agent, providers);
  return { from, to: from === to ? `${to}（地址或 Key 已修改）` : to };
}
/** 恢复任务（审核 Q01、Q02、review-20261111-2119 F01）：模型按 resumeDecision；插件与连接按恢复时的最新状态重新生成本次运行快照；权限沿用创建时的档位。
 *  原智能体的来源已变时，必须带 confirmedIdentity（用户在恢复弹窗里重新选择过）才能恢复——与弹窗同一判断，不只靠界面。 */
export function resumedTask(task, agent, store, { confirmedIdentity = false } = {}) {
  const ch = identityChange(task.agent, agent, store.providers);
  if (ch && !confirmedIdentity) throw new Error(`原智能体的来源已改变（${ch.from} → ${ch.to}），需重新选择后才能恢复`);
  const d = resumeDecision(task.agent, agent);
  return { lost: d.lost, task: { ...task, profile: agent.id, profileName: agent.name, agent: agentSnapshot(agent, store.providers, d.model),
    pluginSnapshot: pluginSnapshot(store.plugins, store.defaults, store.bindings, task.project), status: 'running' } };
}
/** 新建与恢复共用的启动预检（审核 Q03，技术方案 §3.1“Provider 缺认证：启动前拒绝”）：供应商已删除或缺 Key 时不启动。 */
export function launchBlock(agent, providers = []) {
  if (!agent || agent.source !== 'provider') return null;
  const p = providers.find(x => x.id === agent.provider);
  if (!p) return { reason: `智能体“${agent.name}”的供应商已删除，请改选其他智能体`, providerId: null };
  if (p.needKey || !p.key) return { reason: `供应商“${p.name}”还没有填写 Key，填写后才能启动`, providerId: p.id };
  return null;
}
/** 启动时的插件快照：项目里可用的插件及当时生效的连接（运行中任务继续用原连接；删除连接按它判断）。 */
export function pluginSnapshot(plugins, defaults, bindings, projectId) {
  return plugins.filter(p => p.enabled && !projectBinding(bindings, p.id, projectId).disabled).map(p => ({ id: p.id, name: p.name, version: p.version,
    connections: connectionTypesOf(p).map(t => ({ type: t.type, connectionId: effectiveConnection(p, defaults, bindings, projectId, t.type).connection?.id || null })).filter(c => c.connectionId) }));
}
/** 恢复时可选的智能体：同一个工具、工具已安装、未退出登录。 */
export const resumeAgents = (configs, tools, tool) => configs.filter(c => c.tool === tool && !c.loggedOut && !c.broken && tools.find(t => t.id === tool)?.installed !== false);
/** 合成任务转成删除连接判断所需的运行记录（只看运行中任务启动时的连接快照）。 */
export const runningPluginUses = tasks => (tasks || []).filter(t => t.status === 'running' && !t.archived && t.pluginSnapshot).flatMap(t => t.pluginSnapshot.flatMap(p => p.connections.map(c => ({ id: t.id, title: t.title, project: t.project, plugin: p.id, type: c.type, connectionId: c.connectionId }))));

// ================= P0.16：插件更新元数据、邮件草稿项目边界、模型目录对账（审核 N05／N06／N08） =================
/** 更新插件：新包声明整体作为新元数据；启停、连接、项目设置、数据目录等本机状态保留。区分“字段缺失”与“合法空数组”。 */
export function applyPluginUpdate(p, cand) {
  const meta = ['version', 'publisher', 'hostApi', 'tagline', 'permissions', 'capabilities', 'skills', 'legacyToolNames'];
  const next = { ...p }; for (const k of meta) if (k in cand) next[k] = cand[k];
  return next;
}
/** 邮件草稿的项目边界：项目关闭邮件插件时只读；发件账号用本项目生效的 SMTP 连接（跟随全局或个性化）。 */
export function mailDraftState(draft, plugin, defaults, bindings) {
  const b = projectBinding(bindings, plugin.id, draft.project);
  if (b.disabled) return { projectClosed: true, sender: null, mode: null };
  const eff = effectiveConnection(plugin, defaults, bindings, draft.project, 'smtp');
  return { projectClosed: false, sender: eff.connection || null, mode: eff.mode };
}
/** 模型目录对账：新列表里没有的旧模型标“已下线”（保留以便提示改选），新出现的标未测试。 */
export function reconcileModels(oldModels, fresh) {
  const ids = new Set(fresh.map(m => m.id)), have = new Set(oldModels.map(m => m.id));
  const models = [...oldModels.map(m => ids.has(m.id) ? { ...m, offline: false } : { ...m, offline: true }), ...fresh.filter(m => !have.has(m.id)).map(m => ({ ...m, avail: {} }))];
  return { models, added: fresh.filter(m => !have.has(m.id)), removed: oldModels.filter(m => !ids.has(m.id) && !m.offline) };
}

// ================= P0.17：智能体权限（需求补记 8，用户 2026-11-11 决定；参数依据补验 E） =================
/** 首页权限档位，名称与说明照搬 Codex。tools 缺省表示两个 Code Agent 都提供；Claude 暂不提供“帮我批准”（订阅未实测、第三方不完整）。两个 Code Agent 都不提供“自定义”（用户 2026-11-11 原型评审：太专业，去掉）。 */
export const PERMISSIONS = [
  { id: 'ask', name: '请求批准', desc: '编辑外部文件和使用互联网时始终询问', icon: 'hand' },
  { id: 'auto', name: '帮我批准', desc: '仅对检测到的风险操作请求批准', icon: 'shield-prompt', tools: ['codex'] },
  { id: 'full', name: '完全访问权限', desc: '可不受限制地访问互联网和你电脑上的任何文件', icon: 'alert', danger: true },
];
export const DEFAULT_PERMISSION = 'ask';
/** 启动参数（补验 E 实测）：Codex 的“请求批准”必须指定由用户审批，否则用户 config.toml 里的自动审查会代批。 */
export const PERMISSION_ARGS = {
  codex: { ask: '-s workspace-write -a on-request -c approvals_reviewer="user"', auto: '--approve-for-me', full: '--dangerously-bypass-approvals-and-sandbox' },
  claude: { ask: '--permission-mode default', full: '--permission-mode bypassPermissions' },
};
/** 某个 Code Agent 可选的档位。 */
export const permissionOptions = tool => PERMISSIONS.filter(p => !p.tools || p.tools.includes(tool));
/** 记住的选择对当前智能体不可用时（如 Claude 不提供“帮我批准”），按默认档位显示与启动；记住的选择本身不改，切回 Codex 仍恢复。 */
export function effectivePermission(selected, tool) {
  const opts = permissionOptions(tool);
  return opts.find(p => p.id === selected) || opts.find(p => p.id === DEFAULT_PERMISSION);
}
/** 选择档位：第一次选完全访问需要确认，确认后记住。 */
export function choosePermission(id, fullConfirmed) {
  return id === 'full' && !fullConfirmed ? { needConfirm: true } : { needConfirm: false, selected: id };
}
/** 任务创建时记录的权限快照；恢复任务沿用它，不随首页之后的选择变化。 */
export function permissionSnapshot(selected, tool) {
  const p = effectivePermission(selected, tool);
  return { id: p.id, name: p.name, args: PERMISSION_ARGS[tool]?.[p.id] ?? '' };
}
