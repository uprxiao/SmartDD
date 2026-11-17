// V17（AR10 待决，Codex 部分）：目标进行中切换执行器的原生行为。
// A：不暂停直接“切走”（宿主不再发输入）——Codex 是否在后台继续开回合；B：回合结束即暂停后关闭 app-server，
// 新进程 thread/resume 后 thread/goal/get 是否仍为 paused、目标是否保留，set active 后是否接着做（文件数延续）。
import {mkdirSync, rmSync, readdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {openCodex} from './lib/agents.mjs';
const out = join(import.meta.dirname, 'evidence', 'v17-codex'); rmSync(out, {recursive: true, force: true}); mkdirSync(out, {recursive: true});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OBJ = '在当前目录依次创建 01.txt 到 12.txt（内容为编号），每一轮只创建一个文件，创建前先运行 sleep 4，然后结束这一轮；12 个文件都存在时目标完成。';
const R = {};
const files = d => readdirSync(d).filter(f => /^\d+\.txt$/.test(f)).length;
for (const variant of ['A-no-pause', 'B-pause-then-resume']) {
  const cwd = join(out, variant); mkdirSync(cwd, {recursive: true});
  const c = await openCodex({cwd, out, actor: variant});
  const started = () => c.events.filter(x => x.method === 'turn/started').length, completed = () => c.events.filter(x => x.method === 'turn/completed').length;
  const until = async (pred, ms) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (pred()) return true; await sleep(250); } return false; };
  let threadId;
  try {
    await c.start({sandbox: 'workspace-write', approvalPolicy: 'never'}); threadId = c.threadId;
    await c.rpc('thread/goal/set', {threadId, objective: OBJ, status: 'active'});
    await until(() => completed() >= 2, 120000);
    if (variant === 'A-no-pause') {
      const at = started(), f0 = files(cwd); await sleep(30000);
      R[variant] = {turnsAfterSwitchAway30s: started() - at, filesBefore: f0, filesAfter: files(cwd), goal: [...c.events].reverse().find(x => x.method === 'thread/goal/updated')?.params?.goal?.status};
      await c.rpc('thread/goal/clear', {threadId}).catch(() => {});
    } else {
      // 回合结束事件到达时暂停（照 V16 run3 的事件驱动方式）
      let paused = false;
      const orig = c.events.push.bind(c.events);
      c.events.push = (...xs) => { const n = orig(...xs); for (const x of xs) { if (x.method === 'turn/completed' && !paused) { paused = true; c.rpc('thread/goal/set', {threadId, status: 'paused'}).catch(() => {}); } else if (x.method === 'turn/started' && paused) c.rpc('turn/interrupt', {threadId, turnId: x.params.turn.id}).catch(() => {}); } return n; };
      await until(() => paused, 60000); await sleep(15000);
      R[variant] = {pausedAt: files(cwd)};
    }
  } finally { await c.close(); }
  if (variant === 'B-pause-then-resume') {
    // “切回”：新进程恢复同一线程
    const c2 = await openCodex({cwd, out, actor: variant + '-resumed'});
    try {
      await c2.resume(threadId, {sandbox: 'workspace-write', approvalPolicy: 'never'});
      const g = await c2.rpc('thread/goal/get', {threadId}).catch(e => ({error: e.message.slice(0, 200)}));
      R[variant].afterResumeGoal = {status: g?.goal?.status ?? null, objectiveKept: (g?.goal?.objective || '').includes('12.txt'), error: g?.error};
      const f1 = files(cwd); const startedBefore = c2.events.filter(x => x.method === 'turn/started').length;
      await sleep(10000); R[variant].autoTurnsWhilePausedAfterResume = c2.events.filter(x => x.method === 'turn/started').length - startedBefore;
      await c2.rpc('thread/goal/set', {threadId, status: 'active'}).catch(e => R[variant].resumeErr = e.message.slice(0, 200));
      const t0 = Date.now(); while (Date.now() - t0 < 60000 && files(cwd) < f1 + 2) await sleep(500);
      R[variant].afterSetActive = {filesBefore: f1, filesAfter: files(cwd), continued: files(cwd) > f1};
      await c2.rpc('thread/goal/clear', {threadId}).catch(() => {});
    } finally { await c2.close(); }
  }
  console.log(variant, JSON.stringify(R[variant]));
  writeFileSync(join(out, 'summary.json'), JSON.stringify(R, null, 2));
}
