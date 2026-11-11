// M13 原型模型单测：安装校验、能力纳管、运行配置兼容与说明、探测与全局模型提醒（只读）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loginName, CAPABILITIES, CONNECTION_TYPES, INSTALL_CANDIDATES, PLUGINS, PROVIDERS, autoName, compatible, countBy, filterCapabilities, globalModelNotice, manageAll, pluginSkillCaps, probe, rebuildTiers, runNotes, tiersValid, unmanage, manage, validateConnection, validateInstall } from '../src/m13-model.mjs';

const cand = file => INSTALL_CANDIDATES.find(c => c.file === file);
test('安装校验：新装、升级、宿主接口不兼容、原生模块、结构异常、同版本', () => {
  assert.equal(validateInstall(cand('demo-tracker-0.1.0.zip'), PLUGINS).kind, 'install');
  const up = validateInstall(cand('~/Downloads/zentao-plugin-1.1.0/'), PLUGINS);
  assert.equal(up.kind, 'update'); assert.equal(up.existing.version, '1.0.0');
  assert.match(validateInstall(cand('report-kit-2.0.0.zip'), PLUGINS).errors[0], /插件接口 \^2\.0/);
  assert.match(validateInstall(cand('native-helper-0.3.0.zip'), PLUGINS).errors[0], /原生模块/);
  assert.equal(validateInstall(cand('broken-plugin.zip'), PLUGINS).ok, false);
  assert.equal(validateInstall({ ...cand('~/Downloads/zentao-plugin-1.1.0/'), version: '1.0.0' }, PLUGINS).kind, 'same');
  assert.match(validateInstall({ id: 'mail', name: '邮件', version: '9.9.9', hostApi: '^1.0', permissions: [] }, PLUGINS).errors[0], /内置/);
});
test('一键纳管只处理新发现，冲突与不支持项保持原状', () => {
  const r = manageAll(CAPABILITIES);
  assert.deepEqual(r.managed.sort(), ['pdf-tools', 'postgres-readonly']);
  assert.equal(r.items.find(c => c.name === 'release-notes').state, 'conflict');
  assert.equal(r.items.find(c => c.name === 'jira').state, 'unsupported');
  const pg = r.items.find(c => c.name === 'postgres-readonly');
  assert.equal(pg.targets.claude.s, 'onrun', '项目级能力按次注入，不进共用目录');
  assert.equal(r.items.find(c => c.name === 'pdf-tools').targets.claude.s, 'configured');
});
test('取消纳管不改来源，只把目标退回待纳管；MCP 重新纳管仍为按次注入（审核 P09）', () => {
  const gh = CAPABILITIES.find(c => c.name === 'github');
  const u = unmanage(gh);
  assert.equal(u.targets.claude.s, 'source'); assert.equal(u.targets.codex.s, 'pending');
  assert.equal(manage(u).targets.codex.s, 'onrun');
  assert.deepEqual(manage(unmanage(gh)).targets, gh.targets);
  const fe = CAPABILITIES.find(c => c.name === 'frontend-design');
  assert.equal(manage(unmanage(fe)).targets.codex.s, 'configured', '用户级 Skill 链接到共用目录');
});
test('禅道只保留原有三个只读能力；浏览器打开页面按 M12 命令映射归为写入（审核 P02）', () => {
  const zt = PLUGINS.find(p => p.id === 'zentao'), br = PLUGINS.find(p => p.id === 'browser');
  assert.equal(zt.capabilities.length, 3); assert.ok(zt.capabilities.every(c => c.kind === '读取'));
  assert.equal(br.capabilities.find(c => c.name === '打开页面').kind, '写入');
  assert.equal(br.capabilities.find(c => c.name === '页面快照').kind, '读取');
});
test('连接表单按插件声明：禅道含 Token／密码认证，邮件分读取来源与 SMTP；必填与范围校验（审核 P03）', () => {
  assert.deepEqual(CONNECTION_TYPES.zentao[0].fields.find(f => f.key === 'auth').options.map(o => o[0]), ['token', 'password']);
  assert.deepEqual(CONNECTION_TYPES.mail.map(t => t.type), ['source', 'smtp']);
  assert.deepEqual(validateConnection(CONNECTION_TYPES.mail[0], { account: '', days: 30 }), ['请填写Foxmail 本机账号']);
  assert.match(validateConnection(CONNECTION_TYPES.mail[0], { account: 'a', days: 120 })[0], /1–100/);
});
test('插件自带 Skill 随插件状态派生：停用或卸载后消失、版本随插件（审核 P04）', () => {
  const ps = PLUGINS.map(p => ({ ...p, enabled: true }));
  assert.ok(pluginSkillCaps(ps).some(c => c.name === 'zentao-bug-analysis' && c.path === '禅道插件 1.0.0'));
  assert.ok(!pluginSkillCaps(ps.map(p => p.id === 'zentao' ? { ...p, enabled: false } : p)).some(c => c.plugin === 'zentao'));
  assert.ok(pluginSkillCaps(ps.map(p => p.id === 'zentao' ? { ...p, version: '1.1.0' } : p)).some(c => c.path === '禅道插件 1.1.0'));
  assert.ok(!CAPABILITIES.some(c => c.state === 'plugin'), '不再写死插件自带条目');
});
test('更换 Provider 时重建 Claude 档位，只保留属于新 Provider 的模型（审核 P07）', () => {
  const ds = PROVIDERS.find(p => p.id === 'deepseek'), mg = PROVIDERS.find(p => p.id === 'magpie');
  const old = { opus: 'deepseek-v4-pro', sonnet: 'deepseek-v4-pro', haiku: 'deepseek-v4-flash', smallFast: 'deepseek-v4-flash', subagent: 'deepseek-v4-pro' };
  assert.ok(tiersValid(ds, old)); assert.equal(tiersValid(mg, old), false);
  const t = rebuildTiers(mg, 'gpt-5.5', old);
  assert.ok(Object.values(t).every(v => v === 'gpt-5.5')); assert.ok(tiersValid(mg, t));
  assert.equal(rebuildTiers(ds, 'deepseek-v4-pro', { haiku: 'deepseek-legacy-chat' }).haiku, 'deepseek-v4-pro', '调用被拒绝的模型不保留');
});
test('筛选与计数：需处理包含冲突、悬空、不支持、缺变量、需认证；隐藏项不计', () => {
  assert.equal(countBy(CAPABILITIES, 'mcp').attention, 4);
  assert.equal(countBy(CAPABILITIES, 'skill').attention, 2);
  assert.equal(filterCapabilities(CAPABILITIES, { type: 'skill', filter: 'all', query: 'PDF' }).length, 1);
  const hidden = CAPABILITIES.map(c => c.name === 'old-helper' ? { ...c, hidden: true } : c);
  assert.equal(countBy(hidden, 'skill').attention, 1);
});
test('智能体兼容性与名称（P0.12：订阅/API 按登录方式命名）', () => {
  const ds = PROVIDERS.find(p => p.id === 'deepseek');
  assert.ok(compatible('codex', ds).ok); assert.ok(compatible('claude', ds).ok);
  assert.equal(compatible('claude', { type: 'custom', protocols: ['responses'] }).ok, false);
  assert.equal(autoName('claude', PROVIDERS.find(p => p.id === 'magpie')), 'Claude Code · Magpie');
  assert.equal(loginName('codex', 'subscription'), 'Codex · 订阅');
  assert.equal(loginName('claude', 'api'), 'Claude Code · API');
});
test('第三方 Claude 运行说明包含“不应用项目设置”，Codex 包含插件不可用', () => {
  const ds = PROVIDERS.find(p => p.id === 'deepseek');
  assert.ok(runNotes({ tool: 'claude' }, ds).some(n => n.includes('不应用项目')));
  assert.ok(runNotes({ tool: 'codex' }, ds).some(n => n.includes('原生插件')));
});
test('探测只给候选协议；失败分类明确', () => {
  assert.deepEqual(probe('https://x.test', 'k', 'ok').candidates, ['responses', 'anthropic']);
  assert.match(probe('https://x.test', 'k', 'unreachable').error, /不可达/);
  assert.match(probe('https://x.test', '', 'ok').error, /401/);
  assert.equal(probe('x.test', 'k', 'ok').ok, false);
  assert.equal(probe('https://x.test', 'k', 'empty').models.length, 0);
});
test('全局模型提醒：只读生成还原内容；原无键时提示删除；无变化不提醒', () => {
  assert.equal(globalModelNotice({ model: 'a', effort: 'high' }, { model: 'a', effort: 'high' }), null);
  assert.deepEqual(globalModelNotice({ model: 'a', effort: 'high' }, { model: 'b', effort: 'high' }).restore, ['model = "a"']);
  assert.match(globalModelNotice({ model: undefined }, { model: 'b' }).restore[0], /原来没有/);
});

// ---------- P0.5 ----------
import { INITIAL_DEFAULTS, INSTALL_CANDIDATES as IC, RUN_CONFIGS, SAMPLE_IMPORT, buildExport, checkToolPath, defaultChangeImpact, deleteImpact, effectiveConnection, importPreview, removedCapabilities } from '../src/m13-model.mjs';
const zt0 = PLUGINS.find(p => p.id === 'zentao');
const zt = { ...zt0, connections: [...zt0.connections, { id: 'zt-ops', type: 'zentao', name: '运维禅道', values: {} }] };
const prj = [{ id: 'ais', name: 'AIS' }, { id: 'smartdd', name: 'WillYou' }, { id: 'x', name: 'X' }];
test('连接：未记录的项目跟随全局默认；个性化即使选的是原默认也算个性化；关闭的项目不可用', () => {
  const b = { zentao: { smartdd: { zentao: { mode: 'custom', connectionId: 'zt-company' } }, x: { disabled: true } } };
  assert.equal(effectiveConnection(zt, INITIAL_DEFAULTS, b, 'ais', 'zentao').connection.id, 'zt-company');
  assert.equal(effectiveConnection(zt, INITIAL_DEFAULTS, b, 'ais', 'zentao').mode, 'follow');
  assert.equal(effectiveConnection(zt, INITIAL_DEFAULTS, b, 'smartdd', 'zentao').mode, 'custom');
  assert.equal(effectiveConnection(zt, INITIAL_DEFAULTS, b, 'x', 'zentao').disabled, true);
  const imp = defaultChangeImpact(zt, b, prj, 'zentao');
  assert.deepEqual(imp.follow.map(p => p.id), ['ais']); assert.deepEqual(imp.custom.map(p => p.id), ['smartdd']);
  const after = { ...INITIAL_DEFAULTS, zentao: { zentao: 'zt-ops' } };
  assert.equal(effectiveConnection(zt, after, b, 'ais', 'zentao').connection.id, 'zt-ops', '跟随全局的项目同步到新默认');
  assert.equal(effectiveConnection(zt, after, b, 'smartdd', 'zentao').connection.id, 'zt-company', '个性化项目保持');
});
test('删除连接：运行中任务在用时阻止；删全局默认需选新默认；个性化项目列出；唯一连接提示不可用', () => {
  const b = { zentao: { smartdd: { zentao: { mode: 'custom', connectionId: 'zt-ops' } } } };
  const r1 = deleteImpact(zt, INITIAL_DEFAULTS, b, prj, zt.connections[0]);
  assert.equal(r1.blocked, true); assert.equal(r1.runningUse[0].id, 'run-1');
  const r2 = deleteImpact(zt, INITIAL_DEFAULTS, b, prj, zt.connections[0], []);
  assert.equal(r2.needNewDefault, true); assert.deepEqual(r2.others.map(c => c.id), ['zt-ops']);
  const r3 = deleteImpact(zt, INITIAL_DEFAULTS, b, prj, zt.connections[1], []);
  assert.equal(r3.isDefault, false); assert.deepEqual(r3.customProjects.map(p => p.id), ['smartdd']);
  assert.equal(deleteImpact(zt0, INITIAL_DEFAULTS, {}, prj, zt0.connections[0], []).last, true);
});
test('插件更新：新版本删除能力且无旧名映射时提示', () => {
  const v11 = IC.find(c => c.version === '1.1.0'), v2 = IC.find(c => c.version === '2.0.0');
  assert.deepEqual(removedCapabilities(zt0, v11), []);
  assert.deepEqual(removedCapabilities(zt0, v2), ['查看详情与历史']);
  assert.deepEqual(removedCapabilities(zt0, { ...v2, legacyToolNames: { '查看详情与历史': '查询指派给我的 Bug' } }), []);
});
test('导出：勾选智能体自动带上供应商；默认不含 Key；订阅/API 智能体不导出（P0.12）', () => {
  const e = buildExport({ providers: PROVIDERS, configs: RUN_CONFIGS, selectedConfigs: ['rc-codex-ds', 'rc-cc-login'], selectedProviders: [], includeKey: false });
  assert.deepEqual(e.providers.map(p => p.id), ['deepseek']);
  assert.deepEqual(e.runConfigs.map(c => c.id), ['rc-codex-ds']);
  assert.ok(e.providers.every(p => !p.key)); assert.equal(e.includesKeys, false);
  assert.ok(!JSON.stringify(e).includes('3f9a'), '不含任何 Key 片段');
  assert.equal(buildExport({ providers: PROVIDERS, configs: RUN_CONFIGS, selectedConfigs: ['rc-codex-ds'], selectedProviders: [], includeKey: true }).providers[0].key.encrypted, true);
});
test('导入预览：同名不覆盖并加“（导入）”；未带 Key 标需要填写；非本格式拒绝', () => {
  const pv = importPreview(SAMPLE_IMPORT, { providers: PROVIDERS, configs: RUN_CONFIGS });
  assert.equal(pv.providers.find(p => p.id === 'deepseek').finalName, 'DeepSeek（导入）');
  assert.equal(pv.runConfigs.find(c => c.id === 'x1').finalName, 'Codex · DeepSeek（导入）');
  assert.ok(pv.providers.every(p => p.needKey));
  assert.equal(importPreview({ foo: 1 }, { providers: [], configs: [] }).ok, false);
});
test('本机工具自定义路径校验', () => {
  assert.equal(checkToolPath('').ok, false); assert.match(checkToolPath('/opt/missing/codex').error, /找不到/);
  assert.match(checkToolPath('/tmp/codex.txt').error, /不可执行/); assert.equal(checkToolPath('/opt/bin/codex').ok, true);
});

// ---------- P0.6 Code Agent 配置 ----------
import { CATALOG, CATALOG_GROUPS, detectProtocols, pairingNote, toolsFor } from '../src/m13-model.mjs';
test('供应商目录（P0.12）：不再有订阅组；加 Anthropic、OpenAI 官方；SMG 按用户提供的地址；未核实的标为占位', () => {
  assert.deepEqual(CATALOG_GROUPS.map(g => g[0]), ['vendor', 'custom']);
  assert.deepEqual(CATALOG.filter(c => c.group === 'vendor').map(c => c.id), ['anthropic', 'openai', 'deepseek', 'glm', 'smg', 'ultracloud', 'magpie']);
  assert.deepEqual(CATALOG.filter(c => c.verified === false).map(c => c.id), ['glm', 'ultracloud']);
  assert.deepEqual(toolsFor(CATALOG.find(c => c.id === 'smg')), ['claude'], 'SMG 只有 Anthropic 与 OpenAI 兼容接口，只适用 Claude Code');
});
test('适用工具：Codex 需 Responses、Claude Code 需 Anthropic；只有 OpenAI 兼容时都不能用', () => {
  const by = id => CATALOG.find(c => c.id === id);
  assert.deepEqual(toolsFor(by('deepseek')), ['claude', 'codex']);
  assert.deepEqual(toolsFor(by('anthropic')), ['claude']);
  assert.deepEqual(toolsFor(by('openai')), ['codex']);
  assert.deepEqual(toolsFor(by('glm')), ['claude']);
  assert.deepEqual(toolsFor(by('ultracloud')), []);
  assert.match(pairingNote(by('ultracloud')), /网关/);
  assert.deepEqual(toolsFor({ type: 'custom', protocols: ['responses', 'openai'] }), ['codex']);
});
test('自定义供应商检测协议（合成）', () => {
  assert.deepEqual(detectProtocols('https://x.test/anthropic').candidates, ['anthropic']);
  assert.deepEqual(detectProtocols('https://x.test/api/paas/v4').candidates, ['openai']);
  assert.deepEqual(detectProtocols('https://x.test/v1').candidates, ['responses', 'anthropic']);
  assert.equal(detectProtocols('x.test').ok, false);
});

test('会话生效规则（P0.8）：统一文案，运行中会话数提示重启', async () => {
  const { sessionEffect, runningSessions } = await import('../src/m13-model.mjs');
  assert.equal(runningSessions([{ status: 'running' }, { status: 'running', archived: true }, { status: 'stopped' }]), 1);
  assert.equal(sessionEffect('cap-off', 0), '新建或恢复的会话不再加载');
  assert.match(sessionEffect('plugin-off', 2), /即刻不能再调用.*2 个运行中的会话重启后完全生效/);
  assert.match(sessionEffect('plugin-update', 1), /立即使用新版本；1 个运行中的会话重启后完全生效/);
  assert.throws(() => sessionEffect('x'), /未知的生效类型/);
});

test('更新（P0.8）：只接受同一插件、不允许降级、只列变化', async () => {
  const { updateDiff } = await import('../src/m13-model.mjs');
  const zt = PLUGINS.find(p => p.id === 'zentao');
  const mis = validateInstall(cand('demo-tracker-0.1.0.zip'), PLUGINS, zt);
  assert.equal(mis.kind, 'mismatch'); assert.match(mis.errors[0], /这不是禅道的插件包/);
  const down = validateInstall(cand('zentao-plugin-0.9.0.zip'), PLUGINS, zt);
  assert.equal(down.ok, false); assert.equal(down.kind, 'downgrade'); assert.match(down.errors[0], /不支持安装更低的版本/);
  assert.equal(validateInstall(cand('~/Downloads/zentao-plugin-1.1.0/'), PLUGINS, zt).kind, 'update');
  const d = updateDiff(zt, cand('~/Downloads/zentao-plugin-1.1.0/'));
  assert.deepEqual([d.addedCaps, d.addedPerms, d.addedSkills, d.broken], [['下载附件'], ['联网：下载 Bug 附件'], ['zentao-daily-summary'], []]);
  const d2 = updateDiff(zt, cand('~/Downloads/zentao-plugin-2.0.0-drop/'));
  assert.deepEqual(d2.broken, ['查看详情与历史']); assert.equal(d2.empty, false);
});

test('受影响会话（P0.10 B3）：按插件可用项目、项目、技能作用域、纳管目标工具计数', async () => {
  const { affectedSessions, sessionEffect } = await import('../src/m13-model.mjs');
  const tasks = [{ status: 'running', project: 'ais', profile: 'cc-work' }, { status: 'running', project: 'smartdd', runner: 'codex' }, { status: 'stopped', project: 'ais', profile: 'cc-work' }];
  const zt = { id: 'zentao' };
  assert.equal(affectedSessions('plugin', zt, tasks, {}), 2);
  assert.equal(affectedSessions('plugin', zt, tasks, { zentao: { ais: { disabled: true } } }), 1);
  assert.equal(affectedSessions('project', 'ais', tasks), 1);
  assert.equal(affectedSessions('cap', { scope: 'user' }, tasks), 2);
  assert.equal(affectedSessions('cap', { scope: 'project', project: 'smartdd' }, tasks), 1);
  assert.equal(affectedSessions('manage', { from: 'claude', scope: 'user' }, tasks), 1); // 只算 Codex 会话
  assert.equal(affectedSessions('manage', [{ from: 'claude', scope: 'user' }, { from: 'codex', scope: 'user' }], tasks), 2);
  assert.equal(sessionEffect('project-off', 0), '本项目运行中的会话即刻不能再调用它，新建或恢复的会话不再加载');
  assert.throws(() => affectedSessions('x', null, tasks), /未知的影响范围/);
});

// ---------- P0.12 智能体自动生成 ----------
test('模型可用性按工具记录；下拉只列可用与未测试，推荐的排第一（需求第 6 项）', async () => {
  const { modelsFor, recommendedModel, availOf } = await import('../src/m13-model.mjs');
  const ds = PROVIDERS.find(p => p.id === 'deepseek'), mg = PROVIDERS.find(p => p.id === 'magpie');
  assert.deepEqual(modelsFor(ds, 'codex').map(m => m.id), ['deepseek-v4-pro', 'deepseek-v4-flash']);
  assert.equal(availOf(ds.models[1], 'codex'), 'untested'); assert.equal(availOf(ds.models[1], 'claude'), 'ok');
  assert.deepEqual(modelsFor(mg, 'codex').map(m => m.id), ['gpt-5.5'], 'Codex 中不可用的模型隐藏');
  assert.equal(recommendedModel(mg, 'claude'), 'claude-sonnet-5-5'); assert.equal(recommendedModel(mg, 'codex'), 'gpt-5.5');
});
test('新建智能体（P0.13/P0.15）：按 Code Agent 协议过滤供应商；不兼容的带原因；摘要按工具统计；同一 Code Agent＋供应商不重复；名称不重复', async () => {
  const { providersForTool, providerSummary, agentName, catalogItem, CODE_AGENTS } = await import('../src/m13-model.mjs');
  const glm = { ...catalogItem('glm'), protocols: ['anthropic', 'openai'] };
  const all = [...PROVIDERS, glm];
  assert.deepEqual(providersForTool('claude', all).compat.map(p => p.id), ['deepseek', 'magpie', 'glm']);
  const cx = providersForTool('codex', all); assert.deepEqual(cx.compat.map(p => p.id), ['deepseek', 'magpie']);
  assert.match(cx.incompat[0].reason, /OpenAI Responses/);
  assert.equal(providerSummary(PROVIDERS[0], 'codex').text, '1 个可用 · 1 个未测试');
  assert.equal(agentName(RUN_CONFIGS, 'claude', glm, 'glm-5'), 'Claude Code · GLM');
  const { existingAgent, nameTaken } = await import('../src/m13-model.mjs');
  assert.equal(existingAgent(RUN_CONFIGS, 'claude', 'deepseek').id, 'rc-cc-ds', '同一 Code Agent＋供应商已有智能体');
  assert.equal(existingAgent(RUN_CONFIGS, 'claude', 'login').id, 'rc-cc-login');
  assert.equal(existingAgent(RUN_CONFIGS, 'codex', 'login'), null);
  assert.equal(existingAgent(RUN_CONFIGS, 'claude', 'deepseek', 'rc-cc-ds'), null, '编辑自己时不算重复');
  assert.equal(nameTaken(RUN_CONFIGS, ' Codex · Magpie ').id, 'rc-codex-mp');
  assert.equal(agentName(RUN_CONFIGS, 'codex', null, null, 'subscription'), 'Codex · 订阅');
  assert.deepEqual(CODE_AGENTS.filter(a => a.supported).map(a => a.id), ['claude', 'codex']);
  assert.equal(CODE_AGENTS.length, 6);
});
test('排序（P0.13/P0.14）：上移下移与拖动；默认固定第一；设为默认即排第一；隐藏的不能设为默认；首页下拉按列表顺序', async () => {
  const { moveAgent, reorderAgent, homeAgents, withDefault, canBeDefault, agentModels } = await import('../src/m13-model.mjs');
  const ids = cs => cs.map(c => c.id);
  assert.deepEqual(ids(moveAgent(RUN_CONFIGS, 'rc-codex-ds', -1)).slice(0, 3), ['rc-cc-login', 'rc-codex-ds', 'rc-cc-ds']);
  assert.equal(moveAgent(RUN_CONFIGS, 'rc-cc-ds', -1), RUN_CONFIGS, '不能排到默认前面');
  assert.equal(moveAgent(RUN_CONFIGS, 'rc-cc-login', 1), RUN_CONFIGS, '默认不能移动');
  const r = reorderAgent(RUN_CONFIGS, 'rc-legacy-rj', 'rc-cc-login');
  assert.deepEqual(ids(r).slice(0, 2), ['rc-cc-login', 'rc-legacy-rj'], '拖到默认上方时放在默认之后');
  assert.equal(homeAgents(r)[1].id, 'rc-legacy-rj');
  const d = withDefault(RUN_CONFIGS, 'rc-codex-mp');
  assert.equal(d[0].id, 'rc-codex-mp'); assert.equal(d.filter(c => c.default).length, 1);
  assert.equal(canBeDefault(RUN_CONFIGS.find(c => c.id === 'rc-codex-mp')), false, '不在首页显示的不能设为默认');
  assert.deepEqual(agentModels(RUN_CONFIGS.find(c => c.id === 'rc-cc-ds')), ['deepseek-v4-pro', 'deepseek-v4-flash']);
});
test('订阅/API 检测（P0.13）：不自动添加；方式变化改名；退出登录保留标记并交接默认；重新登录恢复', async () => {
  const { syncLogin, homeAgents, makeLoginAgent } = await import('../src/m13-model.mjs');
  assert.equal(syncLogin(RUN_CONFIGS, 'codex', 'subscription').event, null, '没有订阅智能体时不自动添加');
  assert.equal(makeLoginAgent('codex', 'subscription').name, 'Codex · 订阅');
  const r = syncLogin(RUN_CONFIGS, 'claude', 'api');
  assert.equal(r.event.kind, 'switched'); assert.equal(r.configs.find(c => c.id === 'rc-cc-login').name, 'Claude Code · API');
  const out = syncLogin(RUN_CONFIGS, 'claude', 'none');
  const cc = out.configs.find(c => c.id === 'rc-cc-login');
  assert.ok(cc.loggedOut && !cc.visible && !cc.default);
  assert.equal(out.event.newDefault.id, 'rc-cc-ds');
  assert.ok(!homeAgents(out.configs).some(c => c.id === 'rc-cc-login'));
  const back = syncLogin(out.configs, 'claude', 'subscription');
  assert.equal(back.event.kind, 'restored'); assert.ok(!back.configs.find(c => c.id === 'rc-cc-login').loggedOut);
  assert.ok(back.configs.find(c => c.id === 'rc-cc-ds').default, '重新登录不抢回默认');
});
test('删除供应商：列出并删除使用它的智能体；默认交接；首页只列打开显示的', async () => {
  const { removeProviderImpact, removeAgent, homeAgents, withDefault } = await import('../src/m13-model.mjs');
  const cs = withDefault(RUN_CONFIGS, 'rc-cc-ds');
  const r = removeProviderImpact('deepseek', cs);
  assert.deepEqual(r.removed.map(c => c.id), ['rc-cc-ds', 'rc-codex-ds']);
  assert.equal(r.newDefault.id, 'rc-cc-login'); assert.ok(r.configs.every(c => c.provider !== 'deepseek'));
  assert.equal(removeAgent(RUN_CONFIGS, 'rc-codex-mp').newDefault, null, '删除非默认不交接');
  assert.ok(!homeAgents(RUN_CONFIGS).some(c => c.id === 'rc-codex-mp'));
  assert.equal(withDefault(RUN_CONFIGS, 'rc-codex-ds')[0].id, 'rc-codex-ds', '设为默认后排第一');
});
test('接入时自动测试推荐模型并写回可用性', async () => {
  const { autoTest, applyTest, catalogItem } = await import('../src/m13-model.mjs');
  const ds = { ...catalogItem('deepseek'), protocols: ['responses', 'anthropic'] };
  const t = autoTest(ds); assert.deepEqual(t, { claude: { model: 'deepseek-v4-pro', result: 'ok' }, codex: { model: 'deepseek-v4-pro', result: 'ok' } });
  const p = applyTest(ds, autoTest(ds, 'tools-fail'));
  assert.deepEqual(p.models[0].avail, { claude: 'bad', codex: 'ok' });
});
