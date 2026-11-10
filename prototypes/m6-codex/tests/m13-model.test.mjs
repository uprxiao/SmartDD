// M13 原型模型单测：安装校验、能力纳管、运行配置兼容与说明、探测与全局模型提醒（只读）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, INSTALL_CANDIDATES, PLUGINS, PROVIDERS, autoName, compatible, countBy, filterCapabilities, globalModelNotice, manageAll, probe, runNotes, unmanage, manage, validateInstall } from '../src/m13-model.mjs';

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
test('取消纳管不改来源，只把目标退回待纳管', () => {
  const gh = CAPABILITIES.find(c => c.name === 'github');
  const u = unmanage(gh);
  assert.equal(u.targets.claude.s, 'source'); assert.equal(u.targets.codex.s, 'pending');
  assert.equal(manage(u).targets.codex.s, 'configured');
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
