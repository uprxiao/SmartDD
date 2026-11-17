// V16（RV05，Codex 部分）：目标＋异步子任务的完整链路（照 T3 goalsPausedForWake）。
// 宿主：主回合结束且有待唤醒子任务 → thread/goal/set paused；子任务完成（45 秒后脚本写 child.txt）→ 发唤醒消息开一轮并 set active。
import {mkdirSync, writeFileSync, readFileSync, rmSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v16-codex');
const extraTurnsAfterPause = () => pausedAt === null ? null : c.events.filter(x => x.method === 'turn/started' && x._t > pausedAtMs).length; let pausedAtMs = 0; rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const cwd = join(out, 'repo'); mkdirSync(cwd, {recursive: true});
const log = join(out, 'delegate.jsonl'); const sleep = ms => new Promise(r => setTimeout(r, ms));
const c = await openCodex({cwd, out, actor: 'codex-goal-wait', mcp: {name: 'wy', command: process.execPath, args: [join(import.meta.dirname, 'lib', 'delegate-stub-mcp.mjs'), log]}});
const R = {}; const t0 = Date.now(); const ts = () => Math.round((Date.now() - t0) / 1000);
const turns = () => c.events.filter(x => x.method === 'turn/started').length, done = () => c.events.filter(x => x.method === 'turn/completed').length;
const goalSt = () => [...c.events].reverse().find(x => x.method === 'thread/goal/updated')?.params?.goal?.status;
let childDone = false; setTimeout(() => { writeFileSync(join(cwd, 'child.txt'), 'done-by-child\n'); childDone = true; }, 45000);
let pausedForWake = false, pausedAt = null;
// 宿主规则（事件驱动，照 T3 在回合终结事件处理）：turn/completed 到达时若已委派且子任务未完成、目标 active → 立即暂停
// run1 用 200ms 轮询会被 Codex 毫秒级续轮抢先，未能暂停（保留 evidence/v16-codex-run1-polling）
const origPush = c.events.push.bind(c.events);
// RR02：照 T3 CodexAdapterV2（“Pause orphan goal turns so they cannot work without an owning run”）——暂停后、唤醒前到达的 turn/started 是孤立回合，立即再暂停并 turn/interrupt
const orphan = {turns: [], interruptsSent: 0, interruptErrors: [], workItems: []}; let woke = false;
c.events.push = (...xs) => { for (const x of xs) x._t = Date.now(); const n = origPush(...xs);
  for (const x of xs) {
    if (x.method === 'turn/completed' && !pausedForWake && existsSync(log) && !childDone && goalSt() !== 'paused') { pausedForWake = true; pausedAt = ts(); pausedAtMs = Date.now(); c.rpc('thread/goal/set', {threadId: c.threadId, status: 'paused'}).then(r => R.pauseResp = r?.goal?.status).catch(e => R.pauseErr = e.message); }
    else if (x.method === 'turn/started' && pausedForWake && !woke) { const tid = x.params.turn.id; orphan.turns.push(tid); c.rpc('thread/goal/set', {threadId: c.threadId, status: 'paused'}).catch(() => {}).then(() => c.rpc('turn/interrupt', {threadId: c.threadId, turnId: tid})).then(() => orphan.interruptsSent++).catch(e => orphan.interruptErrors.push(e.message.slice(0, 120))); }
    else if (x.method === 'item/started' && orphan.turns.includes(x.params?.turnId) && ['commandExecution', 'fileChange', 'mcpToolCall'].includes(x.params?.item?.type)) orphan.workItems.push(x.params.item.type);
  }
  return n; };
const watcher = setInterval(() => {}, 1000);
try {
  await c.start({sandbox: 'workspace-write', approvalPolicy: 'never'});
  await c.rpc('thread/goal/set', {threadId: c.threadId, objective: '用 wy_delegate 把“在 child.txt 写入 done-by-child”派给子任务（target claude）；不要自己写 child.txt，也不要轮询或 sleep 等待；子任务完成会唤醒你，之后把 child.txt 的内容写进 result.txt。result.txt 内容等于 child.txt 时目标完成。', status: 'active'});
  while (!childDone) await sleep(500);
  R.beforeWake = {turnsStartedAfterPause: extraTurnsAfterPause(), turnsStarted: turns(), turnsCompleted: done(), goal: goalSt(), pausedForWake, pausedAtSec: pausedAt, delegateCalls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').length : 0, resultExists: existsSync(join(cwd, 'result.txt'))};
  R.orphan = {...orphan, turnStatuses: orphan.turns.map(id => c.events.find(x => x.method === 'turn/completed' && x.params?.turn?.id === id)?.params?.turn?.status ?? 'not-completed')};
  woke = true;
  const before = turns();
  // 唤醒：照 T3，子任务完成作为新一轮输入送达，并恢复目标
  await c.rpc('turn/start', {threadId: c.threadId, input: [{type: 'text', text: '【WillYou】子任务 k1 已完成：child.txt 已写好。请继续你的目标。', text_elements: []}]});
  if (pausedForWake) await c.rpc('thread/goal/set', {threadId: c.threadId, status: 'active'}).catch(e => R.resumeErr = e.message);
  const t1 = Date.now(); while (Date.now() - t1 < 120000 && goalSt() !== 'complete') await sleep(500);
  R.afterWake = {newTurns: turns() - before, goal: goalSt(), result: existsSync(join(cwd, 'result.txt')) ? readFileSync(join(cwd, 'result.txt'), 'utf8').trim() : null, secs: ts()};
} finally { clearInterval(watcher); await c.close(); }
console.log(JSON.stringify(R)); writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
