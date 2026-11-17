import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { AgentTaskService } from './agent-task-service';
import { DelegationService } from './delegation-service';
import { GitWorkspaces, runWorkspaceCommand } from './git-workspaces';
import { Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import type { DriverId } from './capabilities';
import { until, tick } from './test-doubles';
let pid = 50000;
const goals = new Map<string, { objective: string; status: string; createdAt: number; updatedAt: number }>();
class Instance implements DriverInstance {
  events = new Emitter(); on = this.events.on.bind(this.events); turns: TurnInput[] = []; history: string[] = []; options!: DriverOpenOptions; nativeId = ''; delayedExit = false;
  constructor(readonly driverId: DriverId) {}
  async open(o: DriverOpenOptions) { this.options = o; this.nativeId = o.resumeNativeId ?? randomUUID(); this.events.emit({ type: 'process', pid: ++pid }); return { nativeId: this.nativeId, confirmed: true, defaultModel: 'test' }; }
  async injectHistory(t: string) { this.history.push(t); }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `turn-${this.turns.length}`; this.events.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
  finish(text = 'done') { const id = `turn-${this.turns.length}`; this.events.emit({ type: 'item.completed', nativeItemId: id, itemType: 'agentMessage', payload: { id, type: 'agentMessage', text } }); this.events.emit({ type: 'turn.completed', nativeTurnId: id, status: 'completed' }); }
  async respond() {} async interrupt() {} async close() { if (!this.delayedExit) this.exit(); }
  exit() { this.events.emit({ type: 'exit', code: 0, signal: null }); }
  async goal(op: { kind: string; objective?: string }) {
    if (op.kind === 'clear') { goals.delete(this.nativeId); this.events.emit({ type: 'goal', objective: null, status: 'cleared' }); return; }
    const old = goals.get(this.nativeId), g = { objective: op.objective ?? old?.objective ?? 'goal', status: op.kind === 'pause' ? 'paused' : 'active', createdAt: old?.createdAt ?? Date.now(), updatedAt: (old?.updatedAt ?? 0) + 1 };
    goals.set(this.nativeId, g); this.events.emit({ type: 'goal', objective: g.objective, status: g.status as 'active' | 'paused', nativeCreatedAt: g.createdAt, nativeUpdatedAt: g.updatedAt });
  }
  async goalState() { return goals.get(this.nativeId) ?? null; }
}
const cleanups: (() => Promise<void>)[] = []; afterEach(async () => { for (const f of cleanups.splice(0)) await f(); });
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'm14-delegation-'))), root = join(base, 'work'), home = join(base, 'home'), db = new Database(':memory:'); mkdirSync(root); mkdirSync(home); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db), instances: Instance[] = [];
  const driver: AgentDriver = { id: 'codex-app-server', command: 'fixture', create: () => { const i = new Instance('codex-app-server'); instances.push(i); return i; } };
  const runs = new AgentRunService({ store, drivers: new Map([['codex-app-server', driver]]), processes: { read: p => ({ pid: p, startedAt: 'fixture-process-birth' }), state: () => 'unknown' }, host: { instanceId: 'fixture', pid: process.pid, startedAt: null } });
  let revision = 'r1', drained = true, trustedRead = false;
  const profile = (id: string) => { if (!['main', 'child'].includes(id)) throw Error('unknown profile'); return { profileId: id, driverId: 'codex-app-server' as const, name: id, revision, available: true, trustedRead, models: ['test'] }; };
  const tasks = new AgentTaskService({ store, runs, profileDriver: () => 'codex-app-server', resolveLaunch: async () => ({ driverId: 'codex-app-server', executable: { path: '/fixture', version: '0.169.0' }, env: {}, stateRoot: join(root, 'state'), compatibility: {}, extraArgs: [] }) });
  const git = new GitWorkspaces({ store, home });
  const co = new DelegationService({ store, runs, tasks, git, profile, profiles: () => [profile('main'), profile('child')], roots: id => [git.workspace(id)?.path ?? root], project: () => ({ id: 'fixture-project', name: 'Fixture' }), drained: async () => drained });
  const taskId = tasks.create({ projectId: null, dirId: null, cwd: root, title: 'parent', profileId: 'main', tier: 'ask' }).taskId; co.setMode(taskId, true);
  cleanups.push(async () => { await co.close(); for (const t of store.tasksWithQueue()) for (const q of store.queuedTurns(t)) tasks.cancelQueued(t, q.turn_id); instances.forEach(i => { i.delayedExit = false; }); await runs.closeAll(); await tick(20); db.close(); rmSync(base, { recursive: true, force: true }); });
  const send = async (text: string) => { const r = await tasks.submit(taskId, { text, clientInputId: randomUUID(), expectedSelectionRevision: tasks.snapshot(taskId).selectionRevision }); await until(() => instances.some(i => i.turns.some(t => t.clientInputId === store.turn(r.turnId)?.client_input_id)), 5000); return instances.find(i => i.turns.some(t => t.clientInputId === store.turn(r.turnId)?.client_input_id))!; };
  const delegate = (requestKey: string = randomUUID()) => co.delegate(runs.runForTask(taskId)!.runId, { requestKey, profileId: 'child', title: 'child', instructions: 'child work' });
  return { root, db, store, runs, tasks, git, co, taskId, instances, send, delegate, setRead: (value: boolean) => { trustedRead = value; }, setRevision: (s: string) => { revision = s; }, setDrained: (b: boolean) => { drained = b; } };
}
it('A19/A24/A32: delegation is durable/idempotent and returns before the child starts; release requires actual exit plus independent drain', async () => {
  const f = fixture(), parent = await f.send('start'); parent.delayedExit = true; f.setDrained(false);
  const receipt = await f.delegate('same-request-123'); expect(receipt.state).toBe('queued');
  expect(await f.delegate('same-request-123')).toEqual(receipt);
  expect(f.co.view(f.taskId).children).toHaveLength(1); expect(f.instances).toHaveLength(1);
  parent.finish(); await tick(30); expect(f.instances).toHaveLength(1);
  parent.exit(); await tick(30); expect(f.instances).toHaveLength(1);
  f.setDrained(true); await until(() => f.instances.length === 2, 4000);
  expect(f.instances[1].turns[0].text).toContain('来源 delegation');
  expect(f.co.view(receipt.childTaskId).parentTaskId).toBe(f.taskId);
  expect(() => f.co.setMode(receipt.childTaskId, true)).toThrow('子任务');
});
it('A24/A31/A32: two children and a new parent input share FIFO; the parent cannot reacquire ahead of either child', async () => {
  const f = fixture(), p = await f.send('start'); const c1 = await f.delegate(), c2 = await f.delegate();
  await f.tasks.submit(f.taskId, { clientInputId: randomUUID(), text: 'parent later', expectedSelectionRevision: f.tasks.snapshot(f.taskId).selectionRevision });
  p.finish(); await until(() => f.instances.length === 2, 5000); expect(f.instances[1].turns[0].text).toContain('child work');
  f.instances[1].finish('child one'); await until(() => f.instances.length === 3, 5000);
  expect(f.runs.runForTask(c2.childTaskId)).toBeTruthy(); expect(f.runs.runForTask(f.taskId)).toBeUndefined();
  f.instances[2].finish('child two'); await until(() => f.instances.length === 4, 5000);
  expect(f.instances[3].turns[0].text).toBe('parent later'); expect(f.instances[3].history[0]).toContain('重新读取');
  expect(f.co.observe(f.taskId, c1.childTaskId)[0].resultRevision).toBe(1);
});
it('A25/A27/A28: stop cancels queued children, mode closes only after children drain, and unrelated tasks cannot observe results', async () => {
  const f = fixture(), p = await f.send('start'), c = await f.delegate();
  f.co.setMode(f.taskId, false); expect(f.co.view(f.taskId).mode).toBe('multi');
  await f.co.cancel(f.taskId, c.childTaskId); expect(f.co.observe(f.taskId, c.childTaskId)[0].state).toBe('canceled');
  expect(() => f.co.observe('unrelated', c.childTaskId)).toThrow('本任务');
  await expect(f.delegate()).rejects.toThrow('未开启'); p.finish();
});
it('A66/A68: Git child runs in the mapped host worktree; child result is committed by the host and only its attempt commits are advertised', async () => {
  const f = fixture(); const git = async (...args: string[]) => { const r = await runWorkspaceCommand(f.root, 'git', args); if (r.code) throw Error(r.stderr); return r.stdout.trim(); };
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid'); writeFileSync(join(f.root, 'a.txt'), 'base\n'); await git('add', '-A'); await git('commit', '-qm', 'base');
  const p = await f.send('start'); writeFileSync(join(f.root, 'dirty.txt'), 'parent dirty\n'); const c = await f.delegate(); p.finish();
  await until(() => f.instances.length === 2, 8000); const child = f.instances[1], workspace = f.git.workspace(c.childTaskId)!;
  expect(child.options.cwd).toBe(workspace.path); expect(workspace.path).toContain('.willyou/worktrees/fixture-fixtur/main_willyou_child');
  expect(await git('status', '--porcelain')).toBe('');
  writeFileSync(join(child.options.cwd, 'child.txt'), 'result\n'); child.finish('child result');
  await until(() => f.co.observe(f.taskId, c.childTaskId)[0].resultRevision === 1, 8000);
  const observed = f.co.observe(f.taskId, c.childTaskId)[0]; expect(observed.commitRange.commits).toHaveLength(1); expect(observed.commitRange.files).toContain('child.txt'); expect(observed.body?.chunk).toContain('child result');
}, 20_000);

it('A29/A32: native background work outlives the parent turn and retains the write slot until its own terminal event', async () => {
  const f = fixture(), p = await f.send('start'); await f.delegate();
  p.events.emit({ type: 'node.state', nodeId: 'native-child', state: 'running' }); p.finish();
  await tick(30); expect(f.instances).toHaveLength(1); expect(f.runs.nativeBusy(f.runs.runForTask(f.taskId)!.runId)).toBe(true);
  p.events.emit({ type: 'node.state', nodeId: 'native-child', state: 'completed' });
  await until(() => f.instances.length === 2, 4000);
});
it('A70: pause intent precedes release; a child result resumes the identical native goal only after its notification turn starts', async () => {
  const f = fixture(), p = await f.send('start'); await f.tasks.goal(f.taskId, { kind: 'set', objective: 'finish children' }); const c = await f.delegate(); p.finish();
  await until(() => f.instances.length === 2, 5000);
  expect(f.store.goal(f.taskId)).toMatchObject({ status: 'paused', pausedReason: 'waiting_children' });
  expect(f.db.prepare("SELECT state FROM agent_intents WHERE action='goal_pause'").get()).toEqual({ state: 'done' });
  f.instances[1].finish('result'); await until(() => f.instances.length === 3 && f.store.goal(f.taskId)?.status === 'active', 5000);
  expect(f.instances[2].nativeId).toBe(p.nativeId); expect(f.db.prepare('SELECT source_kind FROM agent_turns WHERE task_id=? ORDER BY rowid DESC LIMIT 1').get(f.taskId)).toEqual({ source_kind: 'notification' });
  expect(f.co.observe(f.taskId, c.childTaskId)[0].state).toBe('delivered');
  expect(f.db.prepare("SELECT state FROM agent_intents WHERE action='goal_resume'").get()).toEqual({ state: 'done' });
});
it('A70: user stop while waiting preserves the result without waking or restoring the goal', async () => {
  const f = fixture(), p = await f.send('start'); await f.tasks.goal(f.taskId, { kind: 'set', objective: 'goal' }); await f.delegate(); p.finish(); await until(() => f.instances.length === 2, 5000);
  await f.tasks.stop(f.taskId); f.instances[1].finish('late result'); await tick(100);
  expect(f.instances).toHaveLength(2); expect(f.store.goal(f.taskId)).toMatchObject({ status: 'paused', pausedReason: 'user' }); expect(f.store.items(f.taskId).some(i => i.type === 'notification')).toBe(true);
});
it('A70: a different native revision declines automatic recovery and leaves a manual continuation', async () => {
  const f = fixture(), p = await f.send('start'); await f.tasks.goal(f.taskId, { kind: 'set', objective: 'goal' }); await f.delegate(); p.finish(); await until(() => f.instances.length === 2, 5000);
  const g = goals.get(p.nativeId)!; goals.set(p.nativeId, { ...g, updatedAt: g.updatedAt + 1 });
  f.instances[1].finish('result'); await until(() => f.store.goal(f.taskId)?.pausedReason === 'user', 5000);
  expect(f.store.goal(f.taskId)?.status).toBe('paused'); expect(f.db.prepare("SELECT 1 FROM agent_intents WHERE action='goal_resume' AND state='done'").get()).toBeUndefined();
});

it('A33: only host-verified read roles run beside a writer; promotion closes read ownership before FIFO write admission', async () => {
  const f = fixture(); f.setRead(true); const p = await f.send('parent writer');
  const c = await f.co.delegate(f.runs.runForTask(f.taskId)!.runId, { requestKey: 'read-verified-123', profileId: 'child', title: 'reader', instructions: 'inspect', access: 'read' });
  await until(() => f.instances.length === 2, 4000);
  const child = f.instances[1]; expect(child.options.readOnly).toBe(true); expect(f.co.queue.forTask(c.childTaskId)?.kind).toBe('read');
  f.co.requestWrite(c.childTaskId); child.finish(); await tick(40);
  expect(f.instances).toHaveLength(2); expect(f.co.queue.forTask(f.taskId)?.state).toBe('active');
  p.finish(); await until(() => f.instances.length >= 3, 5000);
  expect(f.instances[2].options.readOnly).toBe(false); expect(f.co.queue.forTask(c.childTaskId)?.kind).toBe('write');
});
it('A28: terminal child rework is atomic, reuses its native binding, and explicitly clears an earlier stop', async () => {
  const f = fixture(), p = await f.send('start'), c = await f.delegate(); p.finish(); await until(() => f.instances.length === 2, 5000);
  const child = f.instances[1]; child.finish('done'); await until(() => f.instances.length === 3, 5000);
  await f.tasks.stop(c.childTaskId);
  const parentRun = f.runs.runForTask(f.taskId)!;
  const receipt = await f.co.send(parentRun.runId, c.childTaskId, 'rework-12345678', 'fix again');
  expect(await f.co.send(parentRun.runId, c.childTaskId, 'rework-12345678', 'fix again')).toMatchObject({ duplicate: true });
  f.instances[2].finish(); await until(() => f.instances.length === 4, 5000);
  expect(f.instances[3].nativeId).toBe(child.nativeId); expect(receipt).toHaveProperty('attemptId'); expect(f.instances[3].turns[0].text).toContain('fix again');
});
async function gitChildFixture(goal=false) {
 const f=fixture(),git=async(...args:string[])=>{const r=await runWorkspaceCommand(f.root,'git',args);if(r.code)throw Error(r.stderr);return r.stdout.trim();};
 await git('init','-q','-b','main');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.invalid');writeFileSync(join(f.root,'base.txt'),'base');await git('add','-A');await git('commit','-qm','base');
 const parent=await f.send('start');if(goal)await f.tasks.goal(f.taskId,{kind:'set',objective:'merge and continue'});const child=await f.delegate();parent.finish();await until(()=>f.instances.length===2,6000);
 writeFileSync(join(f.instances[1].options.cwd,'result.txt'),'child change');f.instances[1].finish('child done');await until(()=>f.instances.length===3,6000);
 return {...f,git,child};
}
it('A67/A70: an active goal still reaches a stable merge check and resumes after a proven merge',async()=>{
 const f=await gitChildFixture(true),range=f.co.observe(f.taskId,f.child.childTaskId)[0].commitRange;
 await f.git('cherry-pick','-x',...range.commits);f.instances[2].finish('merged');
 await until(()=>f.instances.length===4&&f.store.goal(f.taskId)?.status==='active',6000);
 expect(f.co.observe(f.taskId,f.child.childTaskId)[0].mergeCheck.pass).toBe(true);expect(f.co.view(f.taskId).needsHandling).toBe(false);
 await f.runs.goal(f.runs.runForTask(f.taskId)!.runId,{kind:'clear'});f.instances[3].finish('continued');
},20_000);
it('A67: exactly two failed merge rounds produce a persistent needs-attention state without another automatic retry',async()=>{
 const f=await gitChildFixture();f.instances[2].finish('not merged');await until(()=>f.instances.length===4,6000);f.instances[3].finish('still not merged');
 await until(()=>f.co.view(f.taskId).needsHandling,6000);await tick(40);
 expect(f.instances).toHaveLength(4);expect(f.tasks.snapshot(f.taskId).status).toBe('needs_attention');expect(f.co.view(f.taskId).children[0].needsHandling).toBe(true);
},20_000);
it('E12/A05: a normal round end keeps the actual owner and binding alive when no directory handoff is needed',async()=>{
 const f=fixture(),first=await f.send('first'),run=f.runs.runForTask(f.taskId)!;first.finish();await tick(40);
 expect(f.runs.runForTask(f.taskId)?.runId).toBe(run.runId);expect(f.co.queue.forTask(f.taskId)?.state).toBe('active');
 const second=await f.send('second');expect(second).toBe(first);expect(f.instances).toHaveLength(1);second.finish();
});
it('A31/E12: an idle owner yields to a newly queued independent task and resumes its same native binding on the next input',async()=>{
 const f=fixture(),first=await f.send('first');first.finish();await tick(20);
 const other=f.tasks.create({projectId:null,dirId:null,cwd:f.root,title:'other writer',profileId:'main',tier:'ask'}).taskId;
 await f.tasks.submit(other,{text:'second writer',clientInputId:randomUUID(),expectedSelectionRevision:1});await until(()=>f.instances.length===2,4000);expect(f.runs.runForTask(f.taskId)).toBeUndefined();f.instances[1].finish();
 const resumed=await f.send('return');expect(resumed.nativeId).toBe(first.nativeId);expect(f.instances).toHaveLength(3);resumed.finish();
});
it('A28/A67: rework before the first result is merged includes the previous unmerged commits in its final range',async()=>{
 const f=await gitChildFixture(),first=f.co.observe(f.taskId,f.child.childTaskId)[0].commitRange;
 await f.co.send(f.runs.runForTask(f.taskId)!.runId,f.child.childTaskId,'rework-before-merge','fix the result');
 await until(()=>f.instances.length===4,6000);writeFileSync(join(f.instances[3].options.cwd,'second.txt'),'second change');f.instances[3].finish('fixed');
 await until(()=>f.co.observe(f.taskId,f.child.childTaskId)[0].resultRevision===2,6000);
 const second=f.co.observe(f.taskId,f.child.childTaskId)[0].commitRange;expect(second.commits).toHaveLength(2);expect(second.commits[0]).toBe(first.commits[0]);expect(second.base).toBe(first.base);
},20_000);
