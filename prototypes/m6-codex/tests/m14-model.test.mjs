import test from 'node:test';
import assert from 'node:assert/strict';
import * as AGENTS_MODULE from '../src/m14-model.mjs';
import { classifyToken, routeLink, inlineSegments, unionSeconds, formatDuration, SCENARIOS, deriveRows, summarizeGroup, entryLabel, thoughtHeading, AGENTS } from '../src/m14-model.mjs';

test('D2：只有文件名不做链接，含路径或 file:// 才是链接', () => {
  assert.equal(classifyToken('notes.txt'), null);
  assert.equal(classifyToken('CHANGELOG.md'), null);
  assert.equal(classifyToken('src/main.ts:40:5').kind, 'path');
  assert.equal(classifyToken('file:///workspace/SmartDD/package.json').kind, 'path');
  assert.equal(classifyToken('https://qa.example.test/').kind, 'url');
  assert.equal(classifyToken('javascript:run').kind, 'protocol');
});
test('R13 路由：文件定位行列、目录定位、网页新标签', () => {
  assert.deepEqual(routeLink('/workspace/SmartDD/src/main.ts:12'), { ok: true, action: 'file', path: 'src/main.ts', line: 12, column: undefined, label: '打开并定位到第 12 行' });
  assert.equal(routeLink('src/renderer/App.tsx:40:5').column, 5);
  assert.equal(routeLink('docs/').action, 'reveal');
  assert.equal(routeLink('https://qa.example.test/').action, 'browser');
});
test('R13 拒绝：根外、越界、已删除、未知协议、无项目打开网页', () => {
  for (const h of ['/etc/hosts', '../../secret/key.txt', 'fixtures/已删除.md', 'javascript:run']) assert.equal(routeLink(h).ok, false, h);
  assert.match(routeLink('https://qa.example.test/', { hasProject: false }).reason, /关联项目/);
});
test('消息切片：行内代码里的纯文件名保持代码样式，路径变链接', () => {
  const segs = inlineSegments('见 `src/main.ts:1` 和 `notes.txt`');
  assert.equal(segs.find(s => s.v === 'src/main.ts:1').t, 'link');
  assert.equal(segs.find(s => s.v === 'notes.txt').t, 'code');
});
test('工作耗时取区间并集，重叠不重复累计', () => {
  assert.equal(unionSeconds([[0, 10], [5, 12], [20, 25]]), 17);
  assert.equal(formatDuration(134), '2 分 14 秒');
});
test('每个演示状态都有轮次，且没有回退操作', () => {
  for (const s of SCENARIOS) { assert.ok(s.turns.length, s.id); assert.ok(!JSON.stringify(s).includes('回退按钮'), s.id); }
});
const kinds = (t, ui) => deriveRows(t, ui).map(r => r.kind);
const turn = id => SCENARIOS.find(s => s.id === id).turns[0];
test('T3 规则：正常结束整轮折叠，只露最终回答和改动；展开后按时间顺序', () => {
  assert.deepEqual(kinds(turn('done')), ['turn-fold', 'final', 'changes']);
  const open = kinds(turn('done'), { expandedTurns: new Set(['t1']) });
  assert.equal(open[0], 'turn-fold'); assert.ok(open.includes('message') && open.includes('work-toggle')); assert.equal(open.at(-2), 'final');
});
test('T3 规则：运行中不折叠，轮首“工作中”，末尾实时行或“思考中”', () => {
  assert.deepEqual(kinds(turn('starting')), ['working', 'thinking']);
  const r = kinds(turn('running')); assert.equal(r[0], 'working'); assert.equal(r.at(-1), 'work-live');
  assert.ok(!kinds(turn('approval')).includes('thinking'), '待审批时不显示思考中');
  assert.equal(deriveRows(turn('team')).at(-1).label, '等待 3 个子任务');
});
test('T3 规则：停止和失败的轮次不折叠', () => {
  assert.equal(deriveRows(turn('stopped'))[0].label, '你在 1 分 3 秒后停止了');
  assert.ok(kinds(turn('failed')).includes('error'));
});
test('T3 summarizeToolGroup：思考不计入，取优先级最高两类，其余写“其他 N 项操作”', () => {
  const r = { kind: 'read', path: 'a' }, c = { kind: 'command', cmd: 'x' }, th = { kind: 'thought', text: '**t**' }, ed = { kind: 'edit', path: 'p' }, sr = { kind: 'search', query: 'q' };
  assert.equal(summarizeGroup([th]), '思考'); assert.equal(summarizeGroup([th, th]), '思考（×2）');
  assert.equal(summarizeGroup([th, c, c, c, c]), '运行了 4 条命令');
  assert.equal(summarizeGroup([r, r, r, c]), '读取了 3 个文件，运行了 1 条命令');
  assert.equal(summarizeGroup([r, c, ed, sr]), '运行了 1 条命令，修改了 1 个文件，以及其他 2 项操作');
});
test('实时标签只写程序名；思考取 **标题**', () => {
  assert.equal(entryLabel({ kind: 'command', cmd: 'pnpm test:release' }, true), '正在运行 pnpm');
  assert.equal(thoughtHeading('**检查打包配置**\n正文'), '检查打包配置');
});
test('多 Agent 协作（Git）：只读并行、等待批准、写入在工作副本里同时运行，末尾为“等待 3 个子任务”', () => {
  const t = SCENARIOS.find(s => s.id === 'team-worktree');
  const rows = deriveRows(t.turns[0]);
  assert.equal(rows.at(-1).label, '等待 3 个子任务');
  const sub = rows.find(r => r.kind === 'subagents').entry.rows;
  assert.deepEqual(sub.map(r => [r.access, r.state]), [['只读', 'running'], ['只读', 'waiting'], ['写入', 'running'], ['写入', 'queued']]);
  assert.match(sub[2].branch, /^feature\/0\.1\.6_willyou_[a-z0-9-]+$/);
  assert.ok(!sub[0].branch && !sub[1].branch, '只读子任务不建工作副本');
  assert.equal(t.childApprovals.length, 1);
  assert.equal(t.vcs, 'git');
  const shared = SCENARIOS.find(s => s.id === 'team');
  assert.equal(shared.children[2].state, 'queued');
  assert.ok(shared.children.every(child => !child.branch));
});

test('P0.7：业务审批在场时不显示“思考中”；计划与压缩在折叠后仍露出', () => {
  const biz = SCENARIOS.find(s => s.id === 'business').turns[0];
  assert.ok(!kinds(biz).includes('thinking')); assert.equal(kinds(biz).at(-1), 'business');
  const plan = SCENARIOS.find(s => s.id === 'plan').turns[0];
  assert.ok(kinds(plan).includes('plan'));
  assert.equal(SCENARIOS.find(s => s.id === 'plan').pending, 'plan');
  const cp = SCENARIOS.find(s => s.id === 'compaction').turns[1];
  assert.ok(kinds(cp).includes('compaction'));
});
test('P0.7：系统提示随整轮折叠；演示用 openFold 默认展开、点击可收起', () => {
  const t = SCENARIOS.find(s => s.id === 'extensions').turns[0];
  assert.deepEqual(deriveRows(t).filter(row => row.kind === 'sysnote').map(row => row.entry.id), ['n3']);
  assert.ok(!kinds(t, { expandedTurns: new Set([t.id]) }).includes('sysnote'));
});
test('A59：寒暄结束后直接显示回答，有实际文件变化或快照状态时才生成改动行', () => {
  const t = { id: 'hello', state: 'done', entries: [{ id: 'mcp', kind: 'sysnote', diagnostic: true }], final: ['你好！'], changes: [] };
  assert.deepEqual(kinds(t), ['final']);
  assert.ok(kinds({ ...t, changes: [{path:'notes.txt'}] }).includes('changes'));
  assert.ok(kinds({ ...t, diffState: {kind:'reclaimed'} }).includes('changes'));
});
test('P0.7：正在停止时轮首写“正在停止…”，不再显示“思考中”', () => {
  const t = SCENARIOS.find(s => s.id === 'stopping').turns[0];
  const rows = deriveRows(t); assert.equal(rows[0].label, '正在停止…'); assert.ok(!rows.some(r => r.kind === 'thinking'));
});
test('P0.7：内置子 Agent 运行时末行为“等待内置子 Agent”', () => {
  assert.equal(deriveRows(SCENARIOS.find(s => s.id === 'native').turns[0]).at(-1).label, '等待内置子 Agent');
});
test('P0.8：额度用完按“暂停”显示（照 T3），保留工作过程；输出长度上限单独成状态', () => {
  const lim = SCENARIOS.find(s => s.id === 'limited'); assert.equal(lim.status, 'limited');
  const rows = deriveRows(lim.turns[0]); assert.match(rows[0].label, /额度用完/); assert.ok(rows.some(r => r.kind === 'work-toggle'));
  assert.ok(SCENARIOS.find(s => s.id === 'length').turns[0].length);
});
test('P0.8：演示数据里不再有主动额度提示／压缩建议；M12 跨任务授权取代浏览器逐次审批', () => {
  const all = JSON.stringify(SCENARIOS);
  assert.ok(!all.includes('额度剩余') && !all.includes('建议先压缩'));
  assert.ok(!SCENARIOS.some(s => s.id === 'browser-access')); assert.ok(SCENARIOS.some(s => s.id === 'access'));
});
test('P0.9：停止／失败的轮次末尾有“共工作 N”行，正常完成的不重复加', () => {
  const stopped = deriveRows(SCENARIOS.find(s => s.id === 'stopped').turns[0]); assert.equal(stopped.at(-1).label, '已停止 · 共工作 1 分 3 秒');
  assert.match(deriveRows(SCENARIOS.find(s => s.id === 'failed').turns[0]).at(-1).label, /^已失败 · 共工作/);
  assert.ok(!kinds(SCENARIOS.find(s => s.id === 'done').turns[0]).includes('turn-footer'));
});
test('P0.9：额度用完的轮次不加末行，保留“已暂停”轮首', () => {
  assert.ok(!kinds(SCENARIOS.find(s => s.id === 'limited').turns[0]).includes('turn-footer'));
});
test('P0.10：协作的运行中与完成阶段，所有子任务都带自己的时间线（都能点开）', () => {
  for (const id of ['team', 'team-done']) { const sc = SCENARIOS.find(s => s.id === id); assert.ok(sc.children.length === 3); assert.ok(sc.children.every(c => c.turns?.length), id); }
  assert.ok(!SCENARIOS.some(s => s.id === 'multi' || s.id === 'multi-done'));
  assert.ok(SCENARIOS.find(s => s.id === 'team-done').children.every(c => c.state === 'done'));
});
test('P0.13：SVN 项目写入子任务排队、不建工作副本', () => {
  const sc = SCENARIOS.find(s => s.id === 'team-svn');
  const sub = deriveRows(sc.turns[0]).find(r => r.kind === 'subagents').entry.rows;
  assert.equal(sc.vcs, 'svn');
  assert.deepEqual(sub.map(r => r.state), ['running', 'waiting', 'queued']);
  assert.ok(sub.every(r => !r.branch));
});
test('P0.13：合并由主 Agent 完成，宿主核对结果在折叠后仍露出；未通过两次标“需要你处理”', () => {
  const done = SCENARIOS.find(s => s.id === 'team-done').turns[1];
  assert.ok(done.entries.some(e => e.kind === 'command' && /^git cherry-pick /.test(e.cmd)));
  assert.ok(kinds(done).includes('sysnote'));
  const mc = SCENARIOS.find(s => s.id === 'merge-check');
  assert.ok(mc.mergeIssue);
  assert.equal(mc.turns.flatMap(t => deriveRows(t)).filter(r => r.kind === 'sysnote').length, 2);
  assert.ok(!JSON.stringify(mc).match(/reset --hard|checkout -- \.|clean -fd/) || JSON.stringify(mc).includes('不会执行 reset'));
});
test('P0.20：共用目录原子任务连续审查、修改、再审查', () => {
  const sc = SCENARIOS.find(s => s.id === 'team-rework');
  assert.equal(sc.children.length, 1);
  assert.equal(sc.children[0].turns.length, 3);
  assert.ok(!sc.children[0].branch);
  assert.ok(sc.turns[0].entries.some(e => e.kind === 'tool' && e.name.startsWith('wy_send')));
});
test('P0.13：目标条目独立成行、折叠后仍露出；Claude 目标只能清除', () => {
  for (const id of ['goal', 'goal-wait', 'goal-claude']) { const sc = SCENARIOS.find(s => s.id === id); assert.ok(kinds(sc.turns.at(-1)).includes('goal'), id); }
  assert.equal(SCENARIOS.find(s => s.id === 'goal-wait').turns[0].entries.find(e => e.kind === 'goal').status, 'waiting-children');
  assert.equal(SCENARIOS.find(s => s.id === 'goal-claude').turns[0].entries.find(e => e.kind === 'goal').agent, 'claude');
});
test('P0.14（评审）：命令能力与目标演示执行器、压缩不显示 token、不做到点自动继续', () => {
  const cap = id => AGENTS.find(a => a.id === id).caps;
  assert.ok(cap('cc-sub').goal && cap('cx-ds').goal && !cap('oc')?.goal && !cap('cc-rj')?.goal);
  assert.equal(SCENARIOS.find(s => s.id === 'goal').agent, 'cx-ds');
  assert.equal(SCENARIOS.find(s => s.id === 'goal-claude').agent, 'cc-sub');
  assert.ok(!JSON.stringify(SCENARIOS.find(s => s.id === 'compaction')).includes('tokens'));
});
test('P0.15（复核 RR08）：/review 只属 Codex、/init 只属 Claude', () => {
  const cap = id => AGENTS.find(a => a.id === id).caps;
  assert.ok(cap('cx-ds').review && !cap('cx-ds').init);
  assert.ok(cap('cc-sub').init && !cap('cc-sub').review && cap('cc-ds').init);
});
test('P0.17（复核 AR01）：档位只有请求批准、帮我批准、完全访问', () => {
  const { PERMISSIONS } = AGENTS_MODULE;
  assert.deepEqual(PERMISSIONS.map(p => p.id), ['ask', 'auto', 'full']);
});
test('RF01 目标状态按任务隔离：清除 A 不解锁同执行器同文字的 B，新目标不继承旧状态', async () => {
  const { goalLock, setGoalStatus, GOAL_STATE } = AGENTS_MODULE;
  GOAL_STATE.clear();
  const mk = (id, rev = 1) => ({ turns: [{ entries: [{ id, rev, kind: 'goal', agent: 'codex', status: 'active', objective: '让 pnpm test:release 全部通过' }] }] });
  const A = mk('goal-a'), B = mk('goal-b');
  assert.equal(goalLock('task-A', A).status, 'active');
  assert.equal(goalLock('task-B', B).status, 'active');
  setGoalStatus('task-A', A.turns[0].entries[0], 'cleared');
  assert.equal(goalLock('task-A', A), null, 'A 清除后解锁');
  assert.equal(goalLock('task-B', B).status, 'active', 'B 仍锁定');
  setGoalStatus('task-A', A.turns[0].entries[0], 'paused');
  setGoalStatus('task-B', B.turns[0].entries[0], 'paused');
  setGoalStatus('task-A', A.turns[0].entries[0], 'cleared');
  assert.equal(goalLock('task-B', B).status, 'paused', 'A 的暂停／清除不改 B');
  // 同一演示场景在两个任务中（目标 ID 相同）也互不影响
  assert.equal(goalLock('task-C', A).status, 'active');
  setGoalStatus('task-B', B.turns[0].entries[0], 'cleared');
  assert.equal(goalLock('task-B', B), null, '清除 B 后才解锁');
  // 同文字新目标（新修订）不继承旧的 cleared
  assert.equal(goalLock('task-A', mk('goal-a', 2)).status, 'active');
  assert.equal(goalLock('task-A', { turns: [{ entries: [{ id: 'g', kind: 'goal', status: 'complete' }] }] }), null, '已完成不锁定');
  GOAL_STATE.clear();
});
test('演示场景的目标条目 ID 唯一', () => {
  const ids = SCENARIOS.flatMap(s => (s.turns || []).flatMap(t => (t.entries || []).filter(e => e.kind === 'goal').map(e => e.id)));
  assert.equal(new Set(ids).size, ids.length);
});
