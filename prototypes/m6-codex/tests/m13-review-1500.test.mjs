// 审核 review-20261111-1500 定向回归（P0.16）：先红后绿，红测记录保留在原型说明的证据目录。
import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../src/m13-model.mjs';
const { RUN_CONFIGS, PROVIDERS, PLUGINS, INITIAL_DEFAULTS, TOOLS } = M;

test('N01 任务快照：记录智能体的工具、供应商、默认模型与勾选模型；恢复只列同工具可用的', () => {
  const s = M.agentSnapshot(RUN_CONFIGS.find(c => c.id === 'rc-codex-ds'), PROVIDERS);
  assert.deepEqual([s.agentId, s.tool, s.providerName, s.model], ['rc-codex-ds', 'codex', 'DeepSeek', 'deepseek-v4-pro']);
  assert.ok(M.resumeAgents(RUN_CONFIGS, TOOLS, 'codex').every(c => c.tool === 'codex'));
});
test('N02 Claude 档位一律等于默认模型；隐藏的模型不能留在勾选里', () => {
  const t = M.uniformTiers('deepseek-v4-pro');
  assert.deepEqual(Object.values(t), Array(5).fill('deepseek-v4-pro'));
  const ds = PROVIDERS.find(p => p.id === 'deepseek');
  const bad = { ...ds, models: ds.models.map(m => m.id === 'deepseek-v4-flash' ? { ...m, avail: { ...m.avail, claude: 'bad' } } : m) };
  assert.deepEqual(M.cleanPicked(bad, 'claude', ['deepseek-v4-pro', 'deepseek-v4-flash'], 'deepseek-v4-flash'), { picked: ['deepseek-v4-pro'], model: 'deepseek-v4-pro' });
});
test('N03 导出保留勾选的模型、各协议地址与推荐模型；连续导入两次不重名', () => {
  const e = M.buildExport({ providers: PROVIDERS, configs: RUN_CONFIGS, selectedConfigs: ['rc-cc-ds'], selectedProviders: [], includeKey: false });
  assert.deepEqual(e.runConfigs[0].models, ['deepseek-v4-pro', 'deepseek-v4-flash']);
  assert.deepEqual(Object.keys(e.providers[0].endpoints).sort(), ['anthropic', 'responses']);
  assert.equal(e.providers[0].recommended, 'deepseek-v4-pro');
  const once = M.importPreview(M.SAMPLE_IMPORT, { providers: PROVIDERS, configs: RUN_CONFIGS });
  const after = { providers: [...PROVIDERS, ...once.providers.map(p => ({ ...p, name: p.finalName }))], configs: [...RUN_CONFIGS, ...once.runConfigs.map(c => ({ ...c, name: c.finalName }))] };
  const twice = M.importPreview(M.SAMPLE_IMPORT, after);
  const names = [...after.configs.map(c => c.name), ...twice.runConfigs.map(c => c.finalName)];
  assert.equal(new Set(names).size, names.length, '智能体名称不重复');
  const pnames = [...after.providers.map(p => p.name), ...twice.providers.map(p => p.finalName)];
  assert.equal(new Set(pnames).size, pnames.length, '供应商名称不重复');
});
test('N04 默认智能体的工具没了：从上往下第一个可用的设为默认并排第一；工具恢复不抢回', () => {
  const cs = M.withDefault(RUN_CONFIGS, 'rc-codex-ds');
  const noCodex = TOOLS.map(t => t.id === 'codex' ? { ...t, installed: false } : t);
  const r = M.reconcileDefault(cs, noCodex);
  assert.equal(r.newDefault.id, 'rc-cc-login'); assert.equal(r.configs[0].id, 'rc-cc-login');
  assert.equal(M.nextDefault(cs, [], noCodex)?.tool, 'claude', '交接时跳过工具未安装的');
  assert.equal(M.reconcileDefault(r.configs, TOOLS).newDefault, null, '工具恢复不抢回默认');
});
test('N05 插件更新：权限等元数据按新包；新版本清空能力或 Skill 时生效并提示删除', () => {
  const zt = { ...PLUGINS.find(p => p.id === 'zentao'), enabled: false, connections: [{ id: 'c1' }] };
  const cand = M.INSTALL_CANDIDATES.find(c => c.id === 'zentao' && c.version === '1.1.0');
  const u = M.applyPluginUpdate(zt, cand);
  assert.deepEqual(u.permissions, cand.permissions); assert.equal(u.enabled, false); assert.deepEqual(u.connections, [{ id: 'c1' }]);
  const empty = M.applyPluginUpdate(zt, { ...cand, capabilities: [], skills: [] });
  assert.deepEqual([empty.capabilities, empty.skills], [[], []]);
  assert.equal(M.removedCapabilities(zt, { ...cand, capabilities: [] }).length, zt.capabilities.length);
});
test('N06 邮件草稿按项目：项目关闭时只读；发件账号用本项目生效的 SMTP 连接', () => {
  const mail = { ...PLUGINS.find(p => p.id === 'mail'), enabled: true, connections: [{ id: 'mail-local', type: 'source', name: '本机' }, { id: 'smtp-a', type: 'smtp', name: '公司邮箱' }, { id: 'smtp-b', type: 'smtp', name: '个人邮箱' }] };
  const defaults = { mail: { source: 'mail-local', smtp: 'smtp-a' } };
  assert.equal(M.mailDraftState({ project: 'ais' }, mail, defaults, { mail: { ais: { disabled: true } } }).projectClosed, true);
  assert.equal(M.mailDraftState({ project: 'smartdd' }, mail, defaults, { mail: { smartdd: { smtp: { mode: 'custom', connectionId: 'smtp-b' } } } }).sender.id, 'smtp-b');
  assert.equal(M.mailDraftState({ project: 'x' }, { ...mail, connections: mail.connections.filter(c => c.type !== 'smtp') }, { mail: { source: 'mail-local' } }, {}).sender, null);
});
test('N07 删除连接只看运行中任务启动时的连接：任务停止后不再阻止', () => {
  const zt = PLUGINS.find(p => p.id === 'zentao');
  assert.equal(M.deleteImpact(zt, INITIAL_DEFAULTS, {}, [], zt.connections[0]).blocked, false, '不再用写死的运行任务');
  const task = { id: 't', title: 't', project: 'ais', status: 'running', pluginSnapshot: [{ id: 'zentao', name: '禅道', version: '1.0.0', connections: [{ type: 'zentao', connectionId: zt.connections[0].id }] }] };
  assert.equal(M.deleteImpact(zt, INITIAL_DEFAULTS, {}, [], zt.connections[0], M.runningPluginUses([task])).blocked, true);
  assert.equal(M.deleteImpact(zt, INITIAL_DEFAULTS, {}, [], zt.connections[0], M.runningPluginUses([{ ...task, status: 'stopped' }])).blocked, false);
});
test('N08 SMG 测试判定：错误事件、截断流不算可用；读取正文也受超时约束', async () => {
  const L = await import('../src/m13-live.mjs');
  const ev = (t, d) => `event: ${t}\ndata: ${JSON.stringify({ type: t, ...d })}\n\n`;
  const ok = ev('message_start', { message: {} }) + ev('content_block_start', { index: 0, content_block: { type: 'tool_use', name: 'wy_ping', input: {} } }) + ev('content_block_stop', { index: 0 }) + ev('message_delta', { delta: { stop_reason: 'tool_use' } }) + ev('message_stop', {});
  assert.equal(L.judgeSse(ok).result, 'ok');
  const err = ev('message_start', { message: {} }) + ev('content_block_start', { index: 0, content_block: { type: 'tool_use', name: 'wy_ping', input: {} } }) + ev('error', { error: { type: 'overloaded_error', message: 'Overloaded' } });
  assert.equal(L.judgeSse(err).result, 'bad');
  assert.equal(L.judgeSse(ok.split('event: message_stop')[0]).result, 'bad', '没有 message_stop 视为截断');
  const hang = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('event: message_start\n')); } }));
  await assert.rejects(L.readBody(hang, 300), /超时/);
});
