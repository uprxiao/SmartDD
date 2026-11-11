// 审核 review-20261111-2023 定向回归（Q01–Q03）：先红后绿，红测记录保留在原型说明的证据目录。
import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../src/m13-model.mjs';
const { RUN_CONFIGS, PROVIDERS, PLUGINS, INITIAL_DEFAULTS } = M;
const codexDs = RUN_CONFIGS.find(c => c.id === 'rc-codex-ds');
const store = (over = {}) => ({ configs: RUN_CONFIGS, providers: PROVIDERS, plugins: PLUGINS, defaults: INITIAL_DEFAULTS, bindings: {}, ...over });

test('Q01 恢复：上次模型仍在所选智能体允许列表时保留，不换成现在的默认', () => {
  const task = { project: 'ais', agent: M.agentSnapshot(codexDs, PROVIDERS) };
  const edited = { ...codexDs, model: 'deepseek-v4-flash', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] };
  const r = M.resumedTask(task, edited, store({ configs: RUN_CONFIGS.map(c => c.id === edited.id ? edited : c) }));
  assert.equal(r.lost, false);
  assert.equal(r.task.agent.runModel, 'deepseek-v4-pro');
});
test('Q01 恢复：上次模型已不在允许列表时用所选智能体默认，并提示', () => {
  const task = { project: 'ais', agent: M.agentSnapshot(codexDs, PROVIDERS) };
  const edited = { ...codexDs, model: 'deepseek-v4-flash', models: ['deepseek-v4-flash'] };
  const r = M.resumedTask(task, edited, store());
  assert.equal(r.lost, true);
  assert.equal(r.task.agent.runModel, 'deepseek-v4-flash');
});
test('Q02 恢复：按当前插件状态与生效连接重新生成快照（全局默认改为 B 后恢复用 B）', () => {
  const zt = PLUGINS.find(p => p.id === 'zentao');
  // 与 useM13State 一致：启动时插件为启用状态（PLUGINS 常量本身不带 enabled）
  const plugins = PLUGINS.map(p => ({ ...p, enabled: true, ...(p.id === 'zentao' ? { connections: [...zt.connections, { id: 'zt-b', type: 'zentao', name: '审核连接B', values: {}, status: 'ok' }] } : {}) }));
  const task = { project: 'ais', status: 'stopped', agent: M.agentSnapshot(codexDs, PROVIDERS), pluginSnapshot: M.pluginSnapshot(plugins, INITIAL_DEFAULTS, {}, 'ais') };
  assert.equal(task.pluginSnapshot.find(p => p.id === 'zentao').connections[0].connectionId, 'zt-company');
  const r = M.resumedTask(task, codexDs, store({ plugins, defaults: { ...INITIAL_DEFAULTS, zentao: { zentao: 'zt-b' } } }));
  assert.equal(r.task.pluginSnapshot.find(p => p.id === 'zentao').connections[0].connectionId, 'zt-b');
  const uses = M.runningPluginUses([r.task]);
  assert.ok(uses.some(u => u.connectionId === 'zt-b') && !uses.some(u => u.connectionId === 'zt-company'), '删除保护按恢复后的连接判断');
});
test('Q03 启动预检：供应商缺 Key 或已删除时拒绝，订阅智能体不受影响', () => {
  const noKey = PROVIDERS.map(p => p.id === 'deepseek' ? { ...p, key: null, needKey: true } : p);
  assert.match(M.launchBlock(codexDs, noKey)?.reason || '', /Key/);
  assert.equal(M.launchBlock(codexDs, noKey).providerId, 'deepseek');
  assert.match(M.launchBlock(codexDs, PROVIDERS.filter(p => p.id !== 'deepseek'))?.reason || '', /供应商已删除/);
  assert.equal(M.launchBlock(codexDs, PROVIDERS), null);
  assert.equal(M.launchBlock(RUN_CONFIGS.find(c => c.id === 'rc-cc-login'), noKey), null);
});
