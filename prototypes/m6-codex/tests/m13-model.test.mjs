// M13 原型模型单测：安装校验、能力纳管、运行配置兼容与说明、探测与全局模型提醒（只读）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, CONNECTION_TYPES, INSTALL_CANDIDATES, PLUGINS, PROVIDERS, autoName, compatible, countBy, filterCapabilities, globalModelNotice, manageAll, pluginSkillCaps, probe, rebuildTiers, runNotes, tiersValid, unmanage, manage, validateConnection, validateInstall } from '../src/m13-model.mjs';

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
test('运行配置兼容性与名称', () => {
  const ds = PROVIDERS.find(p => p.id === 'deepseek'), nc = PROVIDERS.find(p => p.id === 'native-claude');
  assert.ok(compatible('codex', ds).ok); assert.ok(compatible('claude', ds).ok);
  assert.equal(compatible('codex', nc).ok, false);
  assert.equal(compatible('claude', { type: 'custom', protocols: ['responses'] }).ok, false);
  assert.equal(autoName('claude', PROVIDERS.find(p => p.id === 'magpie')), 'Claude Code · Magpie');
  assert.equal(autoName('codex', PROVIDERS.find(p => p.id === 'native-codex')), 'Codex · 原有登录');
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
test('导出：勾选运行配置自动带上 Provider；默认不含 Key；原生登录只导出设定', () => {
  const e = buildExport({ providers: PROVIDERS, configs: RUN_CONFIGS, selectedConfigs: ['rc-codex-ds', 'rc-cc-native'], selectedProviders: [], includeKey: false });
  assert.deepEqual(e.providers.map(p => p.id).sort(), ['deepseek', 'native-claude']);
  assert.ok(e.providers.every(p => !p.key)); assert.equal(e.includesKeys, false);
  assert.deepEqual(Object.keys(e.providers.find(p => p.id === 'native-claude')).sort(), ['id', 'name', 'tool', 'type']);
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
