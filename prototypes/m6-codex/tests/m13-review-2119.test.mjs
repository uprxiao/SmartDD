// 审核 review-20261111-2119 F01 定向回归：原智能体 ID 不变、模型来源已变时，恢复须提示并由用户重新选择（需求 5.3「任务记录与恢复」）。
import test from 'node:test'; import assert from 'node:assert/strict';
import * as M from '../src/m13-model.mjs';
const { RUN_CONFIGS, PROVIDERS, PLUGINS, INITIAL_DEFAULTS } = M;
const login = RUN_CONFIGS.find(c => c.id === 'rc-cc-login');
const codexDs = RUN_CONFIGS.find(c => c.id === 'rc-codex-ds');
const store = (over = {}) => ({ configs: RUN_CONFIGS, providers: PROVIDERS, plugins: PLUGINS, defaults: INITIAL_DEFAULTS, bindings: {}, ...over });
const other = PROVIDERS.find(p => p.id !== 'deepseek' && (p.protocols || []).includes('responses')) || { id: 'acme', name: 'Acme', protocols: ['responses'], key: 'sk', models: [{ id: 'acme-1', name: 'acme-1' }] };
const provs = PROVIDERS.some(p => p.id === other.id) ? PROVIDERS : [...PROVIDERS, other];

test('F01 同一 ID 从订阅改为供应商：识别为身份变化，显示原来源 → 新来源', () => {
  const snap = M.agentSnapshot(login, PROVIDERS);
  const edited = { ...login, source: 'provider', provider: 'deepseek', model: 'deepseek-v4-pro', models: ['deepseek-v4-pro'] };
  const ch = M.identityChange(snap, edited, PROVIDERS);
  assert.ok(ch, '应识别为身份变化');
  assert.match(ch.from, /订阅/); assert.match(ch.to, /DeepSeek/);
});
test('F01 同一 ID 从供应商 A 改为 B：识别为身份变化', () => {
  const snap = M.agentSnapshot(codexDs, provs);
  const ch = M.identityChange(snap, { ...codexDs, provider: other.id, model: other.models[0].id, models: [other.models[0].id] }, provs);
  assert.ok(ch); assert.match(ch.to, new RegExp(other.name));
});
test('F01 同一供应商的地址、协议或 Key 被替换（修订号变化）：识别为身份变化，快照不含 Key 原文', () => {
  const snap = M.agentSnapshot(codexDs, PROVIDERS);
  assert.ok(!JSON.stringify(snap).includes('sk-'), '快照不写 Key');
  const bumped = PROVIDERS.map(p => p.id === 'deepseek' ? { ...p, rev: (p.rev || 0) + 1 } : p);
  assert.ok(M.identityChange(snap, codexDs, bumped));
});
test('F01 订阅↔API 登录方式变化：识别为身份变化', () => {
  const snap = M.agentSnapshot(login, PROVIDERS);
  assert.ok(M.identityChange(snap, { ...login, method: 'api', name: 'Claude Code · API' }, PROVIDERS));
});
test('F01 对照：只改名称、排序、默认模型或勾选模型，不算身份变化', () => {
  const snap = M.agentSnapshot(codexDs, PROVIDERS);
  assert.equal(M.identityChange(snap, { ...codexDs, name: '改过的名字', default: false, model: 'deepseek-v4-flash', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] }, PROVIDERS), null);
  assert.equal(M.identityChange(M.agentSnapshot(login, PROVIDERS), { ...login, name: '我的订阅' }, PROVIDERS), null);
});
test('F01 主流程复核：身份已变时未经用户明确选择不能恢复；明确选择后按新来源恢复', () => {
  const task = { project: 'ais', status: 'stopped', agent: M.agentSnapshot(login, PROVIDERS) };
  const edited = { ...login, source: 'provider', provider: 'deepseek', model: 'deepseek-v4-pro', models: ['deepseek-v4-pro'] };
  assert.throws(() => M.resumedTask(task, edited, store()), /来源已改变/);
  const r = M.resumedTask(task, edited, store(), { confirmedIdentity: true });
  assert.equal(r.task.agent.source, 'provider'); assert.equal(r.task.agent.providerId, 'deepseek');
});
test('F01 对照：身份未变时恢复不需要额外确认（保留 Q01 模型沿用）', () => {
  const task = { project: 'ais', agent: M.agentSnapshot(codexDs, PROVIDERS) };
  const r = M.resumedTask(task, { ...codexDs, model: 'deepseek-v4-flash', models: ['deepseek-v4-pro', 'deepseek-v4-flash'] }, store());
  assert.equal(r.task.agent.runModel, 'deepseek-v4-pro');
});
