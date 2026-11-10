// M13 原型模型：插件、能力统一管理（Skill／MCP）、AI 配置（本机工具／Provider／运行配置）。
// 依据 docs/里程碑/M13_应用Skill与MCP插件化重构/需求.md R0.3（含补记）与 技研/技术方案.md T1.0 草案。
// 全部为合成数据：不读取真实插件、CLI 配置、Skill 目录或密钥，不发网络请求，不启动任何程序。

export const AGENTS = { claude: 'Claude Code', codex: 'Codex' };

// ---------- 插件 ----------
export const PLUGINS = [
  { id: 'mail', name: '邮件', mark: 'mail', builtin: true, publisher: 'WillYou', category: '沟通', version: '0.1.4', tagline: '读取本机邮箱，起草与发送邮件',
    description: '让 Agent 读取 Foxmail 本机邮件、整理线索并起草回复；发送前由你确认。随 WillYou 升级，依赖本机原生组件，保持内置。',
    capabilities: [{ name: '读取最近邮件', kind: '读取' }, { name: '查看邮件详情', kind: '读取' }, { name: '保存草稿', kind: '写入' }, { name: '发送草稿', kind: '写入' }],
    skills: ['mail-triage'], examples: ['整理最近 3 天客户邮件里待我回复的问题', '根据这封投诉邮件起草一封礼貌、明确的回复'], projects: ['smartdd'], connections: [{ id: 'mail-local', name: 'Foxmail 本机', detail: '只读来源 · 最近 30 天', status: 'ok' }] },
  { id: 'browser', name: '浏览器', mark: 'browser', builtin: true, publisher: 'WillYou', category: '自动化', version: '0.1.4', tagline: '在任务内置浏览器中打开和操作网页',
    description: '为每个任务提供隔离的网页标签，Agent 经宿主命令操作页面并保留回执。依赖 Electron 主进程，保持内置。',
    capabilities: [{ name: '打开页面', kind: '读取' }, { name: '页面快照', kind: '读取' }, { name: '点击与输入', kind: '写入' }],
    skills: ['willyou-browser-browser', 'willyou-browser-reproduce-bug'], examples: ['打开测试环境登录页，复现用户反馈的按钮无响应'], projects: ['smartdd', 'ais'], connections: [] },
  { id: 'zentao', name: '禅道', mark: 'zentao', builtin: false, publisher: 'WillYou', category: '研发协作', version: '1.0.0', hostApi: '^1.0',
    tagline: '查询 Bug 与研发需求，分析根因', source: { kind: 'dir', path: '~/WillYou/plugins/zentao' },
    description: '读取当前项目所选禅道中指派给你的 Bug 与研发需求，结合代码分析根因或检查需求。由原内置应用迁移为外部插件，是后续三方应用的模板。',
    migratedFrom: '原内置禅道应用：连接、项目授权与调用历史已迁移',
    permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录', '读取本次绑定连接的账号凭据（宿主按次下发）'],
    dataDir: '~/Library/Application Support/SmartDD/plugins/zentao',
    capabilities: [{ name: '查询 Bug 列表', kind: '读取' }, { name: '查看 Bug 详情', kind: '读取' }, { name: '查询研发需求', kind: '读取' }, { name: '添加 Bug 备注', kind: '写入' }],
    skills: ['zentao-bug-analysis', 'zentao-story-review'], examples: ['分析指派给我的高优先级 Bug，并给出最可能的根因', '检查研发需求 #482 的验收标准是否完整'],
    projects: ['ais', 'smartdd'], connections: [{ id: 'zt-company', name: '公司禅道', detail: 'https://zentao.example.test · liubu', status: 'ok' }],
    resources: [{ id: 1281, title: '导出报表时金额四舍五入错误', severity: '严重', status: '激活' }, { id: 1277, title: '登录页在 Safari 下验证码不刷新', severity: '一般', status: '激活' }, { id: 1263, title: '批量导入超过 500 行时超时', severity: '严重', status: '已解决' }] },
];
export const INSTALL_CANDIDATES = [
  { id: 'demo-tracker', file: 'demo-tracker-0.1.0.zip', kind: 'zip', name: 'Demo Tracker', version: '0.1.0', publisher: '示例开发者', category: '示例', hostApi: '^1.0',
    tagline: '示例插件：记录与查询待办', permissions: ['读写插件私有数据目录'], capabilities: [{ name: '列出待办', kind: '读取' }, { name: '新增待办', kind: '写入' }], skills: ['demo-tracker-usage'] },
  { id: 'zentao', file: '~/Downloads/zentao-plugin-1.1.0/', kind: 'dir', name: '禅道', version: '1.1.0', publisher: 'WillYou', hostApi: '^1.0', tagline: '禅道 1.1.0', permissions: ['联网：仅连接你配置的禅道服务器', '读写插件私有数据目录', '读取本次绑定连接的账号凭据（宿主按次下发）'], capabilities: [], skills: [] },
  { id: 'report-kit', file: 'report-kit-2.0.0.zip', kind: 'zip', name: 'Report Kit', version: '2.0.0', publisher: '第三方', hostApi: '^2.0', tagline: '需要更新版 WillYou', permissions: [], capabilities: [], skills: [] },
  { id: 'native-helper', file: 'native-helper-0.3.0.zip', kind: 'zip', name: 'Native Helper', version: '0.3.0', publisher: '第三方', hostApi: '^1.0', nativeModule: 'runtime/helper.node', tagline: '自带原生模块', permissions: [], capabilities: [], skills: [] },
  { id: null, file: 'broken-plugin.zip', kind: 'zip', broken: '缺少 .willyou-plugin/plugin.json', permissions: [], capabilities: [], skills: [] },
];
const cmpVer = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
export const HOST_API = '1.4';
/** 安装前校验：结构、身份、宿主接口、原生模块、已安装版本。返回 {ok, kind, errors, existing}。 */
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
  { id: 's-zentao', type: 'skill', name: 'zentao-bug-analysis', desc: '禅道 Bug 根因分析', from: 'plugin', plugin: 'zentao', scope: 'plugin', path: '禅道插件 1.0.0', state: 'plugin', targets: {} },
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
  { id: 'm-willyou', type: 'mcp', name: 'willyou', desc: 'WillYou 宿主工具', from: 'host', scope: 'host', path: 'WillYou 内置', state: 'host', targets: {} },
];
export const STATE_LABEL = { managed: '已纳管', new: '新发现', conflict: '同名冲突', dangling: '来源已删除', plugin: '插件自带', unsupported: '不支持转换', 'missing-var': '缺少变量', auth: '需单独认证', host: '宿主专属' };
export const STATE_TONE = { managed: 'ok', new: 'info', conflict: 'warn', dangling: 'warn', plugin: 'muted', unsupported: 'warn', 'missing-var': 'warn', auth: 'warn', host: 'muted' };
export const ATTENTION = new Set(['conflict', 'dangling', 'unsupported', 'missing-var', 'auth']);
export const scopeLabel = (c, projects = []) => c.scope === 'user' ? `${AGENTS[c.from]} · 用户级` : c.scope === 'project' ? `${AGENTS[c.from]} · 项目 ${projects.find(p => p.id === c.project)?.name || c.project}` : c.scope === 'plugin' ? '随插件管理' : '宿主内置';
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
export function manage(c) { return { ...c, state: 'managed', targets: Object.fromEntries(Object.entries(c.targets).map(([k, t]) => [k, t.s === 'pending' ? { ...t, s: c.scope === 'project' ? 'onrun' : 'configured' } : t])) }; }
export function unmanage(c) { return { ...c, state: 'new', targets: Object.fromEntries(Object.entries(c.targets).map(([k, t]) => [k, t.s === 'configured' || t.s === 'onrun' ? { ...t, s: 'pending' } : t])) }; }

// ---------- AI 配置 ----------
export const TOOLS = [
  { id: 'claude', name: 'Claude Code', path: '~/.local/bin/claude', version: '2.1.322', verified: ['2.1.321', '2.1.322'] },
  { id: 'codex', name: 'Codex', path: '~/.local/bin/codex', version: '0.166.0', verified: ['0.166.0'] },
];
export const PROVIDERS = [
  { id: 'native-claude', name: 'Claude Code 原有登录', type: 'native', tool: 'claude', note: '使用你在 Claude Code 中已登录的账号，WillYou 不读取凭据' },
  { id: 'native-codex', name: 'Codex 原有登录', type: 'native', tool: 'codex', note: '使用你在 Codex 中已登录的账号，WillYou 不读取凭据' },
  { id: 'deepseek', name: 'DeepSeek', type: 'preset', preset: 'deepseek', url: 'https://api.deepseek.com/', protocols: ['responses', 'anthropic'], key: 'sk-•••• 3f9a', refreshed: '今天 09:12',
    models: [{ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', ctx: '128K', status: 'ok' }, { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', ctx: '128K', status: 'ok' }, { id: 'deepseek-legacy-chat', name: 'deepseek-legacy-chat', ctx: '64K', status: 'rejected', detail: '能列出，但调用被服务端拒绝' }] },
  { id: 'magpie', name: 'Magpie（本机网关）', type: 'preset', preset: 'magpie', url: 'http://127.0.0.1:3425/v1', protocols: ['responses', 'anthropic'], key: 'magpie-codex', refreshed: '今天 08:40',
    models: [{ id: 'gpt-5.5', name: 'gpt-5.5', ctx: '256K', status: 'ok' }, { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', ctx: '200K', status: 'untested' }] },
];
export const PROTOCOL_LABEL = { responses: 'OpenAI Responses', anthropic: 'Anthropic Messages' };
export const TOOL_PROTOCOL = { codex: 'responses', claude: 'anthropic' };
export function compatible(toolId, provider) {
  if (provider.type === 'native') return provider.tool === toolId ? { ok: true } : { ok: false, reason: `只能用于 ${AGENTS[provider.tool]}` };
  return provider.protocols.includes(TOOL_PROTOCOL[toolId]) ? { ok: true } : { ok: false, reason: `${AGENTS[toolId]} 需要 ${PROTOCOL_LABEL[TOOL_PROTOCOL[toolId]]} 兼容接口` };
}
export const autoName = (toolId, provider) => `${AGENTS[toolId]} · ${provider.type === 'native' ? '原有登录' : provider.name.replace(/（.*）/, '')}`;
export const RUN_CONFIGS = [
  { id: 'rc-cc-native', name: 'Claude Code · 原有登录', tool: 'claude', provider: 'native-claude', model: null, default: true },
  { id: 'rc-codex-native', name: 'Codex · 原有登录', tool: 'codex', provider: 'native-codex', model: null },
  { id: 'rc-codex-ds', name: 'Codex · DeepSeek', tool: 'codex', provider: 'deepseek', model: 'deepseek-v4-pro' },
  { id: 'rc-cc-ds', name: 'Claude Code · DeepSeek', tool: 'claude', provider: 'deepseek', model: 'deepseek-v4-pro', tiers: { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-flash' } },
  { id: 'rc-legacy-rj', name: 'CC-rj', tool: 'claude', provider: null, model: null, legacy: true, legacyNote: '从旧 AI 配置迁移：包含无法识别的变量 RJ_GATEWAY_MODE，整体保留为高级配置，原凭据引用不变' },
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
