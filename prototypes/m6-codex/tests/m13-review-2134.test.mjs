// 复核 review-20261111-2134 K01：供应商详情的实际保存入口（applyProviderKey）——更换已有 Key 加身份修订号，首次填写不加；旧任务恢复因此提示来源变化。
import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../src/m13-model.mjs';
const { RUN_CONFIGS, PROVIDERS, PLUGINS, INITIAL_DEFAULTS } = M;
const ccDs = RUN_CONFIGS.find(c => c.tool === 'claude' && c.provider === 'deepseek');
const store = providers => ({ configs: RUN_CONFIGS, providers, plugins: PLUGINS, defaults: INITIAL_DEFAULTS, bindings: {} });

test('K01 更换已有 Key：修订号加 1，只保留脱敏后四位', () => {
  const ds = PROVIDERS.find(p => p.id === 'deepseek');
  const next = M.applyProviderKey(ds, 'sk-test-new-5678');
  assert.equal(next.rev, (ds.rev || 0) + 1);
  assert.equal(next.key, 'sk-•••• 5678'); assert.equal(next.needKey, false);
  assert.ok(!JSON.stringify(next).includes('sk-test-new'));
});
test('K01 首次填写 Key（原来缺 Key）：修订号不变', () => {
  const ds = { ...PROVIDERS.find(p => p.id === 'deepseek'), key: null, needKey: true };
  assert.equal(M.applyProviderKey(ds, 'sk-first-1234').rev || 0, ds.rev || 0);
});
test('K01 端到端：任务创建后经保存入口更换 Key，恢复识别为身份变化并要求重新选择', () => {
  const task = { project: 'ais', status: 'stopped', agent: M.agentSnapshot(ccDs, PROVIDERS) };
  const provs = PROVIDERS.map(p => p.id === 'deepseek' ? M.applyProviderKey(p, 'sk-test-new-5678') : p);
  const ch = M.identityChange(task.agent, ccDs, provs);
  assert.ok(ch); assert.match(ch.to, /DeepSeek（地址或 Key 已修改）/);
  assert.throws(() => M.resumedTask(task, ccDs, store(provs)), /来源已改变/);
});
test('K01 对照：缺 Key 时先填写再恢复（审核 Q03 流程）不触发身份变化', () => {
  const noKey = PROVIDERS.map(p => p.id === 'deepseek' ? { ...p, key: null, needKey: true } : p);
  const task = { project: 'ais', status: 'stopped', agent: M.agentSnapshot(ccDs, noKey) };
  const filled = noKey.map(p => p.id === 'deepseek' ? M.applyProviderKey(p, 'sk-first-1234') : p);
  assert.equal(M.identityChange(task.agent, ccDs, filled), null);
});
