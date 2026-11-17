// RV06 回归：V10b 完整 Claude 录制 → 一张三项待办且状态正确；V14 Codex 目标通知 → 无未映射、清除可见；V14 Claude “Goal set:” → 目标投影。
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {normalizer} from './timeline.mjs';
const probes = join(import.meta.dirname, '..', '..', '复核_20261116', 'probes', 'evidence');
const lines = f => readFileSync(f, 'utf8').trim().split('\n').map(l => JSON.parse(l));
// 1. 待办
const claudeTodo = lines(join(probes, 'v10b', 'native.jsonl')).filter(e => e.driver === 'claude' && e.actor === 'claude-todo');
const n1 = normalizer('claude-todo'); const out1 = claudeTodo.flatMap(e => n1(e));
const todos = out1.filter(o => o.kind === 'item' && o.type === 'todo_list');
assert.equal(new Set(todos.map(o => o.id)).size, 1, '只有一张待办');
const last = todos.at(-1).data.items;
assert.deepEqual(last.map(x => [x.id, x.subject, x.status]), [['1', 'Create a.txt', 'completed'], ['2', 'Create b.txt', 'completed'], ['3', 'Create c.txt', 'completed']]);
assert.ok(todos.some(o => o.data.items.some(x => x.status === 'in_progress')), '过程中出现进行中状态');
assert.equal(out1.filter(o => o.kind === 'unmapped').length, 0);
// 2. Codex 目标
const codexGoal = lines(join(probes, 'v14', 'native.jsonl')).filter(e => e.driver === 'codex');
const n2 = normalizer('codex-goal'); const out2 = codexGoal.flatMap(e => n2(e));
const goalRaw = codexGoal.filter(e => /^thread\/goal\//.test(e.method || '')).length;
const goals = out2.filter(o => o.kind === 'goal');
assert.equal(goals.length, goalRaw, '每条目标通知都有投影'); assert.ok(goalRaw >= 10);
assert.ok(goals.some(g => g.status === 'paused') && goals.at(-1).cleared, '暂停与清除可见');
assert.equal(out2.filter(o => o.kind === 'unmapped' && /goal/.test(o.reason)).length, 0);
// 3. Claude 目标确认文字
const claudeGoal = lines(join(probes, 'v14-run1', 'native.jsonl')).filter(e => e.driver === 'claude');
const n3 = normalizer('claude-goal'); const out3 = claudeGoal.flatMap(e => n3(e));
const cg = out3.filter(o => o.kind === 'goal');
assert.ok(cg.length >= 1 && cg[0].status === 'active' && /a\.txt/.test(cg[0].objective));
assert.ok(!out3.some(o => o.kind === 'item' && o.type === 'assistant_message' && /^Goal set: /.test(o.text)), '确认文字不重复成消息');
// 4. RR03 合成故障夹具：创建成功 → 请求 completed → 返回失败 → 状态仍为 pending 且带错误；再次成功更新 → completed、错误清除
{ const n = normalizer('fx'); const A = (content) => ({driver: 'claude', type: 'assistant', uuid: 'a' + Math.random(), message: {content}}); const U = (content, r) => ({driver: 'claude', type: 'user', uuid: 'u' + Math.random(), message: {content}, ...(r ? {tool_use_result: r} : {})});
  const ev = [A([{type: 'tool_use', id: 't1', name: 'TaskCreate', input: {subject: 'X'}}]), U([{type: 'tool_result', tool_use_id: 't1', content: 'Task #1 created successfully: X'}], {task: {id: '1', subject: 'X'}}),
    A([{type: 'tool_use', id: 't2', name: 'TaskUpdate', input: {taskId: '1', status: 'completed'}}]), U([{type: 'tool_result', tool_use_id: 't2', content: '更新失败，未生效', is_error: true}])];
  const out = ev.flatMap(e => n(e)).filter(o => o.kind === 'item' && o.type === 'todo_list');
  const after = out.at(-1).data.items[0]; assert.equal(after.status, 'pending'); assert.equal(after.lastError.requested, 'completed');
  const out2 = [A([{type: 'tool_use', id: 't3', name: 'TaskUpdate', input: {taskId: '1', status: 'completed'}}]), U([{type: 'tool_result', tool_use_id: 't3', content: 'Updated task #1 status'}], {success: true, taskId: '1', statusChange: {from: 'pending', to: 'completed'}})].flatMap(e => n(e)).filter(o => o.kind === 'item');
  const fin = out2.at(-1).data.items[0]; assert.equal(fin.status, 'completed'); assert.ok(!fin.lastError);
}
// 5. AR04：Codex 原生 plan 条目不生成计划卡（普通回答＋nativeType），Claude ExitPlanMode 仍为计划卡
{ const n = normalizer('cx'); const out = n({driver: 'codex', method: 'item/completed', params: {turnId: 't', item: {type: 'plan', id: 'p1', text: '1. 改构建\n2. 跑测试'}}});
  const it = out.find(o => o.kind === 'item'); assert.equal(it.type, 'assistant_message'); assert.equal(it.data.nativeType, 'plan');
  const c = normalizer('cl'); const o2 = c({driver: 'claude', type: 'assistant', uuid: 'a', message: {content: [{type: 'tool_use', id: 'x', name: 'ExitPlanMode', input: {plan: '# 计划'}}]}});
  assert.equal(o2.find(o => o.kind === 'item').type, 'proposed_plan'); }
console.log(JSON.stringify({todoCards: 1, todoItems: last.length, codexGoalEvents: goals.length, claudeGoal: cg.length}));
