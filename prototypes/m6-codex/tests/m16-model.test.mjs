import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultDraft, makeRun, nextOccurrence, seedPlans, validateDraft } from '../src/m16-model.mjs';

const projects = [
  { id: 'smartdd', dirs: [{ id: 'git', isDefault: true, available: true, vcs: 'Git' }] },
  { id: 'ais', dirs: [{ id: 'svn', isDefault: true, available: true, vcs: 'SVN' }] },
];
const tasks = [{ id: 'review', project: 'smartdd' }, { id: 'other', project: 'ais' }];
const now = Date.parse('2026-11-27T03:00:00Z'); // Friday, 11:00 in Shanghai
const draft = { ...defaultDraft(projects, now), name: '日报', prompt: '整理摘要' };
const time = { time: '09:00', zone: 'Asia/Shanghai' };

test('fixed daily and working-day times use the selected timezone', () => {
  assert.equal(nextOccurrence({ ...time, type: 'daily' }, now), Date.parse('2026-11-28T01:00:00Z'));
  assert.equal(nextOccurrence({ ...time, type: 'workdays' }, now), Date.parse('2026-11-30T01:00:00Z'));
});
test('weekly selection and interval return a future occurrence', () => {
  assert.equal(nextOccurrence({ ...time, type: 'weekly', days: [1, 3] }, now), Date.parse('2026-11-30T01:00:00Z'));
  assert.equal(nextOccurrence({ ...time, type: 'weekly', days: [] }, now), null);
  assert.equal(nextOccurrence({ type: 'interval', minutes: 60 }, now), now + 3600000);
  assert.equal(nextOccurrence({ type: 'interval', minutes: 0 }, now), null);
});
test('one-time scheduling requires a future wall time', () => {
  assert.equal(nextOccurrence({ ...time, type: 'once', date: '2026-11-28' }, now), Date.parse('2026-11-28T01:00:00Z'));
  assert.equal(nextOccurrence({ ...time, type: 'once', date: '2026-11-25' }, now), null);
  assert.equal(nextOccurrence({ ...time, type: 'once', date: '2026-12-32' }, now), null);
});
test('creation enforces essential fields and worktree requires Git', () => {
  assert.equal(validateDraft(draft, projects, tasks, now), '');
  assert.equal(validateDraft({ ...draft, name: '' }, projects, tasks, now), '请输入计划名称');
  assert.equal(validateDraft({ ...draft, workspace: 'worktree', projectId: 'ais', dirId: 'svn' }, projects, tasks, now), '新建工作树需要 Git 目录和基准分支');
});
test('a bound task must belong to the selected project', () => {
  assert.equal(validateDraft({ ...draft, destination: 'existing', taskId: 'other' }, projects, tasks, now), '请选择该项目中的任务');
  assert.equal(validateDraft({ ...draft, destination: 'existing', taskId: 'review' }, projects, tasks, now), '');
});
test('runs show independent identities, reuse, specified-task binding and skipped run without a task', () => {
  const plan = { ...draft, id: 'p' };
  const run = (patch, id, status = 'running') => makeRun({ ...plan, ...patch }, id, 'scheduled', now, status, now);
  assert.notEqual(run({}, 'one').taskId, run({}, 'two').taskId);
  assert.equal(run({ destination: 'reuse' }, 'one').taskId, run({ destination: 'reuse' }, 'two').taskId);
  assert.equal(run({ destination: 'existing', taskId: 'review' }, 'one').taskId, 'review');
  assert.equal(run({}, 'skip', 'skipped').taskId, null);
});
test('sample plans use an existing project and directory', () => {
  const { plans, runs } = seedPlans(projects, now);
  assert.equal(plans.length, 3);
  for (const plan of plans) assert.equal(validateDraft(plan, projects, tasks, now), '');
  for (const run of runs) assert.ok(plans.some(plan => plan.id === run.planId));
});
