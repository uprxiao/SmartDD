import Database from 'better-sqlite3';
import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runBundledMigrations } from '../../db/migrations';
import type { RunContext } from '../applications/run-registry';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { AgentTaskService } from './agent-task-service';
import { DelegationService } from './delegation-service';
import { GitWorkspaces, runWorkspaceCommand } from './git-workspaces';
import { directoryIdentity } from './directory-queue';
import { HostBusinessRequests } from './host-business-requests';
import { Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import type { DriverId } from './capabilities';
import { until, tick } from './test-doubles';
let pid = 50000;
const goals = new Map<string, { objective: string; status: string; createdAt: number; updatedAt: number }>();
class Instance implements DriverInstance {
  events = new Emitter(); on = this.events.on.bind(this.events); turns: TurnInput[] = []; history: string[] = []; options!: DriverOpenOptions; nativeId = ''; delayedExit = false;
  interrupts = 0;
  steers: TurnInput[] = [];
  constructor(readonly driverId: DriverId) {}
  async open(o: DriverOpenOptions) {
    this.options = o;
    this.nativeId = o.resumeNativeId ?? randomUUID();
    this.events.emit({ type: 'process', pid: ++pid });
    const goal = o.resumeNativeId ? goals.get(this.nativeId) : undefined;
    if (goal?.status === 'paused') this.events.emit({
      type: 'goal', objective: goal.objective, status: 'paused', nativeCreatedAt: goal.createdAt, nativeUpdatedAt: goal.updatedAt,
    });
    return { nativeId: this.nativeId, confirmed: true, defaultModel: 'test' };
  }
  async injectHistory(t: string) { this.history.push(t); }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `turn-${this.turns.length}`; this.events.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
  async steer(t: TurnInput) { this.steers.push(t); }
  finish(text = 'done') { const id = `turn-${this.turns.length}`; this.events.emit({ type: 'item.completed', nativeItemId: id, itemType: 'agentMessage', payload: { id, type: 'agentMessage', text } }); this.events.emit({ type: 'turn.completed', nativeTurnId: id, status: 'completed' }); }
  async respond() {} async interrupt() { this.interrupts++; } async close() { if (!this.delayedExit) this.exit(); }
  exit() { this.events.emit({ type: 'exit', code: 0, signal: null }); }
  async goal(op: { kind: string; objective?: string }) {
    if (op.kind === 'clear') { goals.delete(this.nativeId); this.events.emit({ type: 'goal', objective: null, status: 'cleared' }); return; }
    const old = goals.get(this.nativeId), g = { objective: op.objective ?? old?.objective ?? 'goal', status: op.kind === 'pause' ? 'paused' : 'active', createdAt: old?.createdAt ?? Date.now(), updatedAt: (old?.updatedAt ?? 0) + 1 };
    goals.set(this.nativeId, g); this.events.emit({ type: 'goal', objective: g.objective, status: g.status as 'active' | 'paused', nativeCreatedAt: g.createdAt, nativeUpdatedAt: g.updatedAt });
  }
  async goalState() { return goals.get(this.nativeId) ?? null; }
}
const cleanups: (() => Promise<void>)[] = []; afterEach(async () => { for (const f of cleanups.splice(0)) await f(); });
function fixture(command?: typeof runWorkspaceCommand) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'm14-delegation-'))), root = join(base, 'work'), home = join(base, 'home'), db = new Database(':memory:'); mkdirSync(root); mkdirSync(home); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db), instances: Instance[] = [];
  const driver: AgentDriver = { id: 'codex-app-server', command: 'fixture', create: () => { const i = new Instance('codex-app-server'); instances.push(i); return i; } };
  const runs = new AgentRunService({ store, drivers: new Map([['codex-app-server', driver]]), processes: { read: p => ({ pid: p, startedAt: 'fixture-process-birth' }), state: () => 'unknown' }, host: { instanceId: 'fixture', pid: process.pid, startedAt: null } });
  let revision = 'r1', drained = true, trustedRead = false;
  const profile = (id: string) => { if (!['main', 'child'].includes(id)) throw Error('unknown profile'); return { profileId: id, driverId: 'codex-app-server' as const, name: id, revision, available: true, trustedRead, models: ['test'] }; };
  const tasks = new AgentTaskService({ store, runs, profileDriver: () => 'codex-app-server', resolveLaunch: async () => ({ driverId: 'codex-app-server', executable: { path: '/fixture', version: '0.169.0' }, env: {}, stateRoot: join(root, 'state'), compatibility: {}, extraArgs: [] }) });
  const git = new GitWorkspaces({ store, home, command });
  const co = new DelegationService({ store, runs, tasks, git, profile, profiles: () => [profile('main'), profile('child')], roots: id => [git.workspace(id)?.path ?? root], project: () => ({ id: 'fixture-project', name: 'Fixture' }), drained: async () => drained });
  const taskId = tasks.create({ projectId: null, dirId: null, cwd: root, title: 'parent', profileId: 'main', tier: 'ask' }).taskId; co.setMode(taskId, true);
  cleanups.push(async () => { await co.close(); for (const t of store.tasksWithQueue()) for (const q of store.queuedTurns(t)) tasks.cancelQueued(t, q.turn_id); instances.forEach(i => { i.delayedExit = false; }); await runs.closeAll(); await tick(20); db.close(); rmSync(base, { recursive: true, force: true }); });
  const send = async (text: string, id = taskId) => { const r = await tasks.submit(id, { text, clientInputId: randomUUID(), expectedSelectionRevision: tasks.snapshot(id).selectionRevision }); await until(() => instances.some(i => i.turns.some(t => t.clientInputId === store.turn(r.turnId)?.client_input_id)), 5000); return instances.find(i => i.turns.some(t => t.clientInputId === store.turn(r.turnId)?.client_input_id))!; };
  const delegate = (requestKey: string = randomUUID(), id = taskId, workspaceMode?: 'worktree') => co.delegate(runs.runForTask(id)!.runId, { requestKey, profileId: 'child', profileRevision: revision, title: 'child', instructions: 'child work', workspaceMode });
  return { root, db, store, runs, tasks, git, co, taskId, instances, send, delegate, setRead: (value: boolean) => { trustedRead = value; }, setRevision: (s: string) => { revision = s; }, setDrained: (b: boolean) => { drained = b; } };
}
it('A20 refuses a stale listed target but keeps a prior request receipt across configuration changes', async () => {
  const f = fixture();
  await f.send('start');
  const run = f.runs.runForTask(f.taskId)!;
  const controller = new AbortController();
  const context = { run: { runId: run.runId, taskId: f.taskId }, signal: controller.signal } as RunContext;
  const call = (name: string, args: Record<string, unknown>) => f.co.call(context, name, args, controller.signal);
  const first = await call('wy_targets', {}) as { targets: { profileId: string; revision: string }[] };
  const revision = first.targets.find(target => target.profileId === 'child')!.revision;
  const request = { requestKey: 'a20-config-target', profileId: 'child', title: 'child', instructions: 'review fixture' };
  f.setRevision('r2');
  await expect(call('wy_delegate', request)).rejects.toThrow('profileRevision');
  await expect(call('wy_delegate', { ...request, profileRevision: revision })).rejects.toThrow('已经变化');
  expect(f.co.view(f.taskId).childrenTotal).toBe(0);
  const next = await call('wy_targets', {}) as typeof first;
  const freshRevision = next.targets.find(target => target.profileId === 'child')!.revision;
  const accepted = await call('wy_delegate', { ...request, profileRevision: freshRevision });
  f.setRevision('r3');
  await expect(call('wy_delegate', request)).resolves.toEqual(accepted);
  expect(f.co.view(f.taskId).childrenTotal).toBe(1);
});

it('A59 persists one delegated creation record with the selected target and later native binding', async () => {
  const f = fixture(), parent = await f.send('start');
  const request = { requestKey: 'a59-thread-created', profileId: 'child', profileRevision: 'r1', model: 'test', title: 'child', instructions: 'review fixture' };
  const parentRunId = f.runs.runForTask(f.taskId)!.runId;
  const accepted = await f.co.delegate(parentRunId, request);
  expect(await f.co.delegate(parentRunId, request)).toEqual(accepted);
  const creations = () => f.store.items(f.taskId).filter(item => item.type === 'thread_created');
  const [initial] = creations();
  expect(creations()).toHaveLength(1);
  expect(initial.payload).toMatchObject({ delegationId: accepted.delegationId, childTaskId: accepted.childTaskId,
    bindingId: null, target: { profileId: 'child', driverId: 'codex-app-server', name: 'child' }, model: 'test' });
  parent.finish();
  await until(() => f.instances.length === 2 && !!f.instances[1].turns.length, 5000);
  const bindingId = f.runs.runForTask(accepted.childTaskId)!.bindingId;
  expect(creations()).toHaveLength(1);
  expect(creations()[0]).toMatchObject({ itemId: initial.itemId, revision: initial.revision + 1, payload: { bindingId } });
});

it('A20 revalidates a listed target after the asynchronous Git preflight before accepting', async () => {
  const f = fixture();
  await f.send('start');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const detect = vi.spyOn(f.git, 'detect').mockImplementation(async () => {
    await gate;
    return { root: f.root, cwd: f.root, branch: 'main' };
  });
  vi.spyOn(f.git, 'sourceSnapshot').mockResolvedValue({ baseCommit: 'a'.repeat(40), uncommittedFiles: 0 });
  const result = f.delegate(undefined, undefined, 'worktree');
  expect(detect).toHaveBeenCalled();
  f.setRevision('r2');
  release();
  await expect(result).rejects.toThrow('已经变化');
  expect(f.co.view(f.taskId).childrenTotal).toBe(0);
});

it('A20 keeps the accepted receipt but never starts a child whose target changed during worktree preparation', async () => {
  const f = fixture();
  await f.send('start');
  vi.spyOn(f.git, 'detect').mockResolvedValue({ root: f.root, cwd: f.root, branch: 'main' });
  const baseCommit = 'a'.repeat(40);
  vi.spyOn(f.git, 'sourceSnapshot').mockResolvedValue({ baseCommit, uncommittedFiles: 0 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const prepare = vi.spyOn(f.git, 'create').mockImplementation(async ({ parentTaskId, childTaskId }) => {
    await gate;
    return { cwd: f.root, workspace: {
      workspace_id: 'worktree', task_id: parentTaskId, child_task_id: childTaskId, kind: 'git_worktree',
      repo_root: f.root, path: f.root, branch: 'fixture-worktree', base_commit: baseCommit,
      state: 'ready', deps_result: null,
    } };
  });
  const accepted = await f.delegate('a20-worktree-prepare', undefined, 'worktree');
  try {
    await until(() => prepare.mock.calls.length === 1, 5000);
    f.setRevision('r2');
  } finally {
    release();
  }
  await until(() => f.co.view(f.taskId).children[0]?.state === 'failed', 5000);
  const repeated = await f.delegate('a20-worktree-prepare', undefined, 'worktree');
  expect(repeated.childTaskId).toBe(accepted.childTaskId);
  expect(repeated.delegationId).toBe(accepted.delegationId);
  expect(f.instances).toHaveLength(1);
  expect(f.co.view(f.taskId).childrenTotal).toBe(1);
});

it('A20 rejects a delegated input when the target changes while the native owner is being opened', async () => {
  const f = fixture();
  const parent = await f.send('start');
  const accepted = await f.delegate('a20-native-open');
  const open = f.runs.open.bind(f.runs);
  vi.spyOn(f.runs, 'open').mockImplementation(async options => {
    const handle = await open(options);
    if (options.taskId === accepted.childTaskId) f.setRevision('r2');
    return handle;
  });
  parent.finish();
  await until(() => f.store.turns(accepted.childTaskId).some(turn => turn.status === 'failed'), 5000);
  expect(f.instances[1].turns).toEqual([]);
  expect((await f.co.observe(f.taskId, accepted.childTaskId))[0]?.delegationId).toBe(accepted.delegationId);
  await until(() => !f.runs.runForTask(accepted.childTaskId) && !f.runs.closingForTask(accepted.childTaskId), 5000);
});

it.each(['preparing', 'registered'] as const)('A74 does not drain a directory writer while its first turn is %s', async phase => {
  const f = fixture();
  const parent = await f.send('start');
  const child = await f.delegate('a74-first-turn');
  let arrived!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { arrived = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const open = f.runs.open.bind(f.runs);
  vi.spyOn(f.runs, 'open').mockImplementation(async options => {
    if (options.taskId !== child.childTaskId) return open(options);
    if (phase === 'preparing') return open({ ...options, integrate: async input => {
      arrived();
      await gate;
      return options.integrate?.(input);
    } });
    const handle = await open(options);
    arrived();
    await gate;
    return handle;
  });
  parent.finish();
  try {
    await entered;
    const owner = f.co.queue.forTask(child.childTaskId)!;
    expect(owner.state).toBe('active');
    expect(owner.run_id).toBeTruthy();
    // The parent has a different result to consume and queues while the writer has the slot.
    f.co.queue.enter(f.taskId, owner.directory_identity);
    await tick(80);
    expect(f.co.queue.forTask(child.childTaskId)?.state).toBe('active');
    expect(f.runs.runForTask(child.childTaskId)?.runId).toBe(owner.run_id);
    expect(f.runs.closingForTask(child.childTaskId)).toBeUndefined();
  } finally {
    release();
  }
  await until(() => f.instances.some(instance => instance !== parent && instance.turns.length === 1), 5000);
});

it('A74 an idle directory owner still hands off to a queued competitor', async () => {
  const f = fixture();
  const parent = await f.send('start');
  const run = f.runs.runForTask(f.taskId)!;
  const identity = directoryIdentity(f.root, [f.root]).identity;
  const owner = f.co.queue.enter(f.taskId, identity);
  expect(f.co.queue.acquire(owner.queue_id)).toBe(true);
  f.co.opened(f.taskId, run);
  parent.finish();
  await until(() => !f.runs.busy(run.runId), 2000);
  const other = f.tasks.create({ projectId: null, dirId: null, cwd: f.root, title: 'next writer', profileId: 'main', tier: 'ask' }).taskId;
  f.co.queue.enter(other, identity);
  await until(() => f.co.queue.get(owner.queue_id)?.state === 'released', 5000);
  expect(f.runs.runForTask(f.taskId)).toBeUndefined();
});

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

it.each([['ask', 'full'], ['full', 'ask']] as const)('A26 applies parent tier %s → %s on the delegated child’s next round', async (initial, next) => {
  const f = fixture();
  f.setRead(true);
  f.tasks.setSelection(f.taskId, { tier: initial }, f.tasks.snapshot(f.taskId).selectionRevision);
  await f.send('Start an isolated parent round');
  const parentRun = f.runs.runForTask(f.taskId)!;
  const { childTaskId } = await f.co.delegate(parentRun.runId, { requestKey: randomUUID(), profileId: 'child', profileRevision: 'r1', title: 'Child', instructions: 'Inspect the fixture', access: 'read' });
  await until(() => f.instances[1]?.turns.length === 1);
  const child = f.instances[1];
  expect(child.turns[0].tier).toBe(initial);
  expect(() => f.tasks.setSelection(childTaskId, { tier: next }, f.tasks.snapshot(childTaskId).selectionRevision)).toThrow('主任务决定');
  f.tasks.setSelection(f.taskId, { tier: next }, f.tasks.snapshot(f.taskId).selectionRevision);
  expect(child.turns).toHaveLength(1);
  expect(child.turns[0].tier).toBe(initial);
  child.finish();
  await until(() => f.co.observe(f.taskId, childTaskId)[0].resultRevision === 1);
  await f.co.send(parentRun.runId, childTaskId, randomUUID(), 'Continue in the same child task');
  const childTurns = () => f.instances.slice(1).flatMap(instance => instance.turns);
  await until(() => childTurns().length === 2);
  expect(childTurns()[1].tier).toBe(next);
});

it('A27 stops the original parent round before its tree can drain the native run', async () => {
  const f = fixture(), parent = await f.send('start a round');
  const child = await f.delegate();
  const run = f.runs.runForTask(f.taskId)!;
  const turnId = run.turnId!;
  await f.tasks.stop(f.taskId, true);
  await tick(35);
  expect(parent.interrupts).toBe(1);
  expect(f.runs.runForTask(f.taskId)?.runId).toBe(run.runId);
  expect(f.runs.stopProgress(f.taskId)).toMatchObject({runId:run.runId,closing:false});
  expect(f.co.observe(f.taskId,child.childTaskId)[0].state).toBe('canceled');
  parent.events.emit({type:'turn.completed',nativeTurnId:'turn-1',status:'interrupted'});
  await until(() => !f.runs.runForTask(f.taskId) && !f.runs.closingForTask(f.taskId),4000);
  expect(f.store.turn(turnId)?.status).toBe('interrupted');
});
it('A66/A68: Git child runs in the mapped host worktree; child result is committed by the host and only its attempt commits are advertised', async () => {
  const f = fixture(); const git = async (...args: string[]) => { const r = await runWorkspaceCommand(f.root, 'git', args); if (r.code) throw Error(r.stderr); return r.stdout.trim(); };
  await git('init', '-q', '-b', 'main'); await git('config', 'user.name', 'Fixture'); await git('config', 'user.email', 'fixture@example.invalid'); writeFileSync(join(f.root, 'a.txt'), 'base\n'); await git('add', '-A'); await git('commit', '-qm', 'base');
  const p = await f.send('start'); writeFileSync(join(f.root, 'dirty.txt'), 'parent dirty\n'); const c = await f.delegate(undefined,undefined,'worktree'); p.finish();
  await until(() => f.instances.length === 2, 8000); const child = f.instances[1], workspace = f.git.workspace(c.childTaskId)!;
  expect(child.options.cwd).toBe(workspace.path); expect(workspace.path).toContain('.willyou/worktrees/fixture-fixtur/main_willyou_child');
  expect(await git('status', '--porcelain')).toBe('?? dirty.txt');
  expect(c.uncommittedFiles).toBe(1);
  expect(c.message).toContain('1 个未提交文件');
  expect(child.turns[0].text).toContain(c.baseCommit!);
  writeFileSync(join(child.options.cwd, 'child.txt'), 'result\n'); child.finish('child result');
  await until(() => f.co.observe(f.taskId, c.childTaskId)[0].resultRevision === 1, 8000);
  const observed = f.co.observe(f.taskId, c.childTaskId)[0]; expect(observed.commitRange.commits).toHaveLength(1); expect(observed.commitRange.files).toContain('child.txt'); expect(observed.body?.chunk).toContain('child result');
}, 20_000);

it('F35 A21: four worktree children occupy the host limit, and a child cannot create another delegation', async () => {
  const f = fixture();
  const git = async (...args: string[]) => {
    const result = await runWorkspaceCommand(f.root, 'git', args);
    expect(result.code, result.stderr).toBe(0);
  };
  await git('init', '-q', '-b', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  await git('commit', '--allow-empty', '-qm', 'baseline');
  await f.send('keep the parent running while worktree children start');

  const firstFour: Awaited<ReturnType<typeof f.delegate>>[] = [];
  for (let index = 0; index < 4; index++) firstFour.push(await f.delegate(undefined, undefined, 'worktree'));
  await until(() => firstFour.every(child => f.runs.runForTask(child.childTaskId)?.turnId), 8000);
  const first = firstFour[0].childTaskId;
  await expect(f.delegate(undefined, first, 'worktree')).rejects.toThrow('子任务');
  expect(f.co.view(first).childrenTotal).toBe(0);

  const fifth = await f.delegate(undefined, undefined, 'worktree');
  await until(() => f.git.workspace(fifth.childTaskId)?.state === 'ready', 8000);
  expect(f.co.observe(f.taskId, fifth.childTaskId)[0].state).toBe('queued');
  expect(f.runs.runForTask(fifth.childTaskId)).toBeUndefined();

  (f.runs.runForTask(first)!.instance as Instance).finish('release one slot');
  await until(() => !!f.runs.runForTask(fifth.childTaskId)?.turnId, 8000);
  expect(f.co.observe(f.taskId, fifth.childTaskId)[0].state).toBe('running');
  expect(f.co.view(f.taskId).childrenTotal).toBe(5);
}, 25_000);

it('D06-64 reports an unsuccessful worktree commit to the parent once and preserves the child changes', async () => {
  const commit = vi.fn(async () => ({ stdout: '', stderr: 'Author identity unknown', code: 128 }));
  const f = fixture((cwd, command, args, timeout, options) =>
    options?.taskId && args[0] === 'commit' ? commit() : runWorkspaceCommand(cwd, command, args, timeout, options));
  const git = async (...args: string[]) => {
    const result = await runWorkspaceCommand(f.root, 'git', args);
    if (result.code) throw Error(result.stderr);
    return result.stdout.trim();
  };
  await git('init', '-q', '-b', 'main');
  await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-qm', 'base');
  const base = await git('rev-parse', 'HEAD');
  const parent = await f.send('start');
  const child = await f.delegate(undefined, undefined, 'worktree');
  parent.finish();
  await until(() => !!f.instances[1]?.turns.length, 6000);
  const worktree = f.instances[1].options.cwd;
  writeFileSync(join(worktree, 'child.txt'), 'child change');
  f.instances[1].finish('child result');
  await until(() => f.store.items(f.taskId).some(item => item.type === 'notification'), 3500);
  await tick(1100);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(f.store.items(f.taskId).filter(item => item.type === 'notification')).toMatchObject([
    { payload: { status: 'failed', summary: expect.stringContaining('Author identity unknown'), commits: null } },
  ]);
  expect(f.db.prepare("SELECT state FROM agent_intents WHERE action='child_result_commit'").all()).toEqual([{ state: 'needs_review' }]);
  expect(readFileSync(join(worktree, 'child.txt'), 'utf8')).toBe('child change');
  expect(await git('rev-parse', 'HEAD')).toBe(base);
}, 12_000);

it('A29/A32: native background work outlives the parent turn and retains the write slot until its own terminal event', async () => {
  const f = fixture(), p = await f.send('start'); await f.delegate();
  p.events.emit({ type: 'node.state', nodeId: 'native-child', state: 'running' }); p.finish();
  await tick(30); expect(f.instances).toHaveLength(1); expect(f.runs.nativeBusy(f.runs.runForTask(f.taskId)!.runId)).toBe(true);
  p.events.emit({ type: 'node.state', nodeId: 'native-child', state: 'completed' });
  await until(() => f.instances.length === 2, 4000);
});
it('A70: reopening the same paused goal preserves the wait and resumes it after the notification starts', async () => {
  const f = fixture(), p = await f.send('start'); await f.tasks.goal(f.taskId, { kind: 'set', objective: 'finish children' }); const c = await f.delegate(); p.finish();
  await until(() => f.instances.length === 2, 5000);
  expect(f.store.goal(f.taskId)).toMatchObject({ status: 'paused', pausedReason: 'waiting_children' });
  expect(f.db.prepare("SELECT state FROM agent_intents WHERE action='goal_pause'").get()).toEqual({ state: 'done' });
  f.instances[1].finish('result');
  await until(() => !!f.instances[2]?.turns.length, 4000);
  expect(f.store.goal(f.taskId)?.pausedReason).not.toBe('user');
  await until(() => f.store.goal(f.taskId)?.status === 'active', 4000);
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
  const c = await f.co.delegate(f.runs.runForTask(f.taskId)!.runId, { requestKey: 'read-verified-123', profileId: 'child', profileRevision: 'r1', title: 'reader', instructions: 'inspect', access: 'read' });
  await until(() => f.instances.length === 2, 4000);
  const child = f.instances[1]; expect(child.options.readOnly).toBe(true); expect(f.co.queue.forTask(c.childTaskId)).toBeUndefined();
  f.co.requestWrite(c.childTaskId); child.finish(); await tick(40);
  expect(f.instances).toHaveLength(2); expect(f.runs.busy(f.runs.runForTask(f.taskId)!.runId)).toBe(true);
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
 const parent=await f.send('start');if(goal)await f.tasks.goal(f.taskId,{kind:'set',objective:'merge and continue'});const child=await f.delegate(undefined,undefined,'worktree');parent.finish();await until(()=>f.instances.length===2,6000);
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
 const range=f.co.observe(f.taskId,f.child.childTaskId)[0].commitRange;
 const retry=await f.send('Please retry the merge');
 await f.git('cherry-pick','-x',...range.commits);
 retry.finish('now merged');
 await until(()=>f.co.view(f.taskId).children[0].merged,6000);
 expect(f.co.view(f.taskId).needsHandling).toBe(false);
},20_000);
it('E12/A05: a normal round end keeps the actual owner and binding alive when no directory handoff is needed',async()=>{
 const f=fixture(),first=await f.send('first'),run=f.runs.runForTask(f.taskId)!;first.finish();await tick(40);
 expect(f.runs.runForTask(f.taskId)?.runId).toBe(run.runId);expect(f.co.queue.forTask(f.taskId)).toBeUndefined();
 const second=await f.send('second');expect(second).toBe(first);expect(f.instances).toHaveLength(1);second.finish();
});
it.each(['Git', 'SVN', 'plain'] as const)('P1: independent tasks in the same %s directory overlap and retain their native sessions',async(kind)=>{
 const f=fixture();
 if(kind==='Git') expect((await runWorkspaceCommand(f.root,'git',['init','-q','-b','main'])).code).toBe(0);
 if(kind==='SVN') mkdirSync(join(f.root,'.svn'));
 const first=await f.send('first'), owner=f.runs.runForTask(f.taskId)!;
 const other=f.tasks.create({projectId:null,dirId:null,cwd:f.root,title:'other writer',profileId:'main',tier:'ask'}).taskId;
 const input=await f.tasks.submit(other,{text:'second writer',clientInputId:randomUUID(),expectedSelectionRevision:1});
 await until(()=>f.store.turn(input.turnId)?.status==='started',1200);
 expect(f.runs.busy(owner.runId)).toBe(true);
 expect(f.co.queue.forTask(f.taskId)).toBeUndefined();
 expect(f.co.queue.forTask(other)).toBeUndefined();
 first.finish();f.instances[1].finish();
 const next=await f.send('return');expect(next).toBe(first);expect(f.instances).toHaveLength(2);next.finish();
});

it('P1: another independent task can answer while a related parent and child hand off the same SVN directory', async () => {
  const f = fixture();
  mkdirSync(join(f.root, '.svn'));
  const parent = await f.send('parent');
  const childReceipt = await f.delegate();
  const otherId = f.tasks.create({ projectId: null, dirId: null, cwd: f.root, title: 'independent', profileId: 'main', tier: 'ask' }).taskId;
  const other = await f.send('independent', otherId), otherRunId = f.runs.runForTask(otherId)!.runId;
  expect(f.co.queue.forTask(childReceipt.childTaskId)?.state).toBe('queued');
  expect(f.co.queue.forTask(otherId)).toBeUndefined();
  parent.finish();
  await until(() => f.runs.runForTask(childReceipt.childTaskId)?.turnId != null, 5000);
  const child = f.instances[2];
  expect(f.runs.busy(otherRunId)).toBe(true);
  expect(f.co.queue.forTask(childReceipt.childTaskId)?.state).toBe('active');
  expect(child.history.join('\n')).toContain('修改前重新读取工作区与涉及文件');
  expect(other.history.join('\n')).not.toContain('宿主目录交接');
  child.finish('child complete');
  await until(() => f.runs.runForTask(f.taskId)?.turnId != null, 5000);
  expect(f.runs.runForTask(otherId)?.runId).toBe(otherRunId);
  other.finish();
  expect(f.instances[3].nativeId).toBe(parent.nativeId);
  f.instances[3].finish();
});

it('P1: concurrent Git parents with identically named delegations get two distinct worktrees', async () => {
  const f = fixture();
  const git = async (...args: string[]) => {
    const result = await runWorkspaceCommand(f.root, 'git', args);
    expect(result.code, result.stderr).toBe(0);
  };
  await git('init','-q','-b','main');
  await git('-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--allow-empty','-qm','base');
  const otherId = f.tasks.create({ projectId: null, dirId: null, cwd: f.root, title: 'second parent', profileId: 'main', tier: 'ask' }).taskId;
  f.co.setMode(otherId, true);
  const first = await f.send('first parent'), second = await f.send('second parent', otherId);
  const [a, b] = await Promise.all([f.delegate(undefined,undefined,'worktree'), f.delegate(randomUUID(), otherId,'worktree')]);
  first.finish(); second.finish();
  await until(() => [a, b].every(c => f.runs.runForTask(c.childTaskId)?.turnId), 8000);
  expect(f.git.workspace(a.childTaskId)?.path).not.toBe(f.git.workspace(b.childTaskId)?.path);
  expect([f.git.workspace(a.childTaskId)?.branch, f.git.workspace(b.childTaskId)?.branch].sort()).toEqual(['main_willyou_child', 'main_willyou_child-2']);
  expect(f.db.prepare('SELECT COUNT(*) AS count FROM agent_directory_queue').get()).toEqual({ count: 0 });
}, 20_000);

async function gitWithHeldInstall() {
  let releaseInstall!: () => void;
  const installing = new Promise<void>(resolve => { releaseInstall = resolve; });
  let installStarted = false;
  const f = fixture(async (cwd, command, args, timeout, options) => {
    if (command !== 'pnpm') return runWorkspaceCommand(cwd, command, args, timeout, options);
    installStarted = true;
    await installing;
    return { stdout: '', stderr: '', code: 0 };
  });
  cleanups.unshift(async () => releaseInstall());
  const git = async (...args: string[]) => {
    const result = await runWorkspaceCommand(f.root, 'git', args);
    expect(result.code, result.stderr).toBe(0);
    return result.stdout.trim();
  };
  await git('init', '-qb', 'main');
  await git('config', 'user.name', 'Fixture');
  await git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(f.root, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  await git('add', '-A');
  await git('commit', '-qm', 'baseline');
  return { ...f, gitCommand: git, base: await git('rev-parse', 'HEAD'), releaseInstall, installStarted: () => installStarted };
}

it.each([false,true])('G3: explicit worktree prepares while an independent turn is running (active goal=%s)',async activeGoal=>{
  const f=await gitWithHeldInstall();
  const otherId=f.tasks.create({projectId:null,dirId:null,cwd:f.root,title:'independent',profileId:'main',tier:'ask'}).taskId;
  const other=await f.send('existing turn',otherId),owner=f.runs.runForTask(otherId)!;
  if(activeGoal)await f.tasks.goal(otherId,{kind:'set',objective:'Independent goal'});
  const parent=await f.send('delegate explicitly');
  writeFileSync(join(f.root,'uncommitted.txt'),'PARENT_ONLY');
  const receipt=await f.delegate(undefined,undefined,'worktree');
  await until(f.installStarted,4000);
  expect(await f.co.beforeDispatch(otherId)).toBe(true);
  expect(f.runs.runForTask(f.taskId)?.turnId).toBeTruthy();
  const input=await f.tasks.submit(otherId,{text:'later',clientInputId:randomUUID(),expectedSelectionRevision:1});
  other.finish();
  await until(()=>f.store.turn(input.turnId)?.status==='started',4000);
  expect(f.runs.runForTask(otherId)?.runId).toBe(owner.runId);
  if(activeGoal)expect(f.store.goal(otherId)?.status).toBe('active');
  f.releaseInstall();
  await until(()=>!!f.runs.runForTask(receipt.childTaskId)?.turnId,4000);
  expect(receipt.baseCommit).toBe(f.base);
  expect(receipt.uncommittedFiles).toBe(1);
  expect(await f.gitCommand('rev-parse','HEAD')).toBe(f.base);
  expect(await f.gitCommand('status','--porcelain')).toBe('?? uncommitted.txt');
  parent.finish();
},15_000);

it('G3: Git defaults to serial shared writing, with visible uncommitted input and stable child session on rework',async()=>{
  const f=await gitWithHeldInstall(),parent=await f.send('parent');
  writeFileSync(join(f.root,'design.txt'),'UNCOMMITTED_DESIGN');
  const receipt=await f.delegate();
  expect(receipt.workspaceMode).toBe('shared');
  expect(f.runs.runForTask(receipt.childTaskId)).toBeUndefined();
  // The parent still holds the directory mid-turn, before it has a FIFO row; the card must not say nobody is writing.
  for (const id of [f.taskId, receipt.childTaskId]) {
    expect(f.co.view(id).writeQueue).toMatchObject({ activeCount:1, total:2,
      entries:[{ taskId:f.taskId, state:'active' }, { taskId:receipt.childTaskId, state:'queued' }] });
  }
  const parentRun=f.runs.runForTask(f.taskId)!;
  f.db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,run_id,changed_files_json,status) VALUES(?,?,?,?,'complete')").run(parentRun.turnId,f.taskId,parentRun.runId,JSON.stringify([{path:'design.txt'}]));
  parent.finish();
  await until(()=>!!f.runs.runForTask(receipt.childTaskId)?.turnId,4000);
  const first=f.instances[1];
  expect(first.options.cwd).toBe(f.root);
  expect(readFileSync(join(first.options.cwd,'design.txt'),'utf8')).toBe('UNCOMMITTED_DESIGN');
  expect(first.turns[0].text).toContain('宿主不提交');
  expect(first.turns[0].text).toContain('你是写入子任务');
  expect(first.turns[0].text).not.toContain('wy_request_write');
  const handoff=f.store.items(receipt.childTaskId).find(item=>item.payload?.code==='directoryHandoff');
  expect(handoff?.payload.detail).toContain('design.txt');
  first.finish('M14_REVIEW_TEXT');
  await until(()=>!!f.runs.runForTask(f.taskId)?.turnId,4000);
  // The parent's result card shows the child's message text, not the stored payload JSON.
  const notice=f.store.items(f.taskId).find(item=>item.type==='notification'&&item.payload?.sourceKind==='child_result');
  expect(notice?.payload.summary).toBe('M14_REVIEW_TEXT');
  await f.co.send(f.runs.runForTask(f.taskId)!.runId,receipt.childTaskId,'review-again','round two');
  expect(f.runs.runForTask(receipt.childTaskId)).toBeUndefined();
  f.instances[2].finish();
  await until(()=>!!f.runs.runForTask(receipt.childTaskId)?.turnId,4000);
  expect(f.instances[3].nativeId).toBe(first.nativeId);
  expect(await f.gitCommand('rev-parse','HEAD')).toBe(f.base);
  expect(f.git.workspace(receipt.childTaskId)).toBeUndefined();
},15_000);

async function waitingBusinessSlot() {
  const f = fixture(), parent = await f.send('parent');
  const origin = f.runs.runForTask(f.taskId)!;
  const requests = new HostBusinessRequests({ store: f.store, run: id => f.runs.runForTask(id), hasOwner: id => !!f.runs.runForTask(id) || !!f.runs.closingForTask(id), notify: () => {}, acquire: (id, _operation, signal) => f.co.acquireBusiness(id, signal) });
  f.tasks.attachBusiness(requests);
  let effects = 0, budgetAtEffect = 0;
  requests.register('fixture', { validate: async () => {}, execute: async (_record, _decision, context) => {
    effects++;
    budgetAtEffect = context.deadline - Date.now();
    return { ok: true };
  } });
  cleanups.unshift(() => requests.close());
  const request = requests.create({ ...origin, taskId: f.taskId }, { operationId: randomUUID(), kind: 'fixture', title: 'test write', review: { frozen: true }, data: {} });
  const child = await f.delegate(); parent.finish();
  await until(() => f.co.queue.forTask(child.childTaskId)?.state === 'active' && !!f.runs.runForTask(child.childTaskId)?.turnId, 5000);
  const start = performance.now();
  const approval = requests.respond(f.taskId, request.requestId, 1, { choice: 'allow' });
  void approval.catch(() => {});
  await until(() => f.co.queue.forTask(f.taskId)?.state === 'queued', 2000);
  return { ...f, child, requests, start, approval, request, effects: () => effects, budgetAtEffect: () => budgetAtEffect };
}

it.each(['stop', 'revoke'])('P3: %s releases the canceled business reservation from the real directory FIFO', async action => {
  const f = await waitingBusinessSlot();
  if (action === 'stop') await f.tasks.stop(f.taskId);
  else {
    const request = f.store.request(f.request.requestId)!;
    expect(await f.tasks.respond(f.taskId, request.request_id, request.revision, { choice: 'cancel' })).toMatchObject({ state: 'retired' });
  }
  expect(await f.approval).toMatchObject({ state: 'retired' });
  expect(f.co.queue.forTask(f.taskId)).toBeUndefined();
  expect(f.co.queue.forTask(f.child.childTaskId)?.state).toBe('active');
  f.instances[1].finish();
  await until(() => !f.co.queue.forTask(f.child.childTaskId), 5000);
  expect(f.effects()).toBe(0);
});

it.skipIf(process.env.M14_REVIEW_WALL_CLOCK !== '1')('P3: actual FIFO holds a business approval over 61 seconds and then starts a full execution budget', async () => {
  const f = await waitingBusinessSlot();
  await tick(61_050);
  const waitedMs = Math.round(performance.now() - f.start);
  expect(f.effects()).toBe(0);
  expect(f.co.queue.forTask(f.taskId)?.state).toBe('queued');
  expect(JSON.parse(f.store.request(f.request.requestId)!.payload_ref).phase).toBe('queued_for_slot');
  f.instances[1].finish();
  expect(await f.approval).toMatchObject({ state: 'finished' });
  expect(f.effects()).toBe(1);
  expect(f.budgetAtEffect()).toBeGreaterThan(59_000);
  const evidence = process.env.M14_REVIEW_WALL_CLOCK_RESULT;
  if (evidence) writeFileSync(evidence, JSON.stringify({ waitedMs, budgetAtEffect: f.budgetAtEffect(), effects: f.effects() }, null, 2) + '\n');
}, 80_000);
it('A28/A67: rework before the first result is merged includes the previous unmerged commits in its final range',async()=>{
 const f=await gitChildFixture(),first=f.co.observe(f.taskId,f.child.childTaskId)[0].commitRange;
 await f.co.send(f.runs.runForTask(f.taskId)!.runId,f.child.childTaskId,'rework-before-merge','fix the result');
 await until(()=>f.instances.length===4,6000);writeFileSync(join(f.instances[3].options.cwd,'second.txt'),'second change');f.instances[3].finish('fixed');
 await until(()=>f.co.observe(f.taskId,f.child.childTaskId)[0].resultRevision===2,6000);
 const second=f.co.observe(f.taskId,f.child.childTaskId)[0].commitRange;expect(second.commits).toHaveLength(2);expect(second.commits[0]).toBe(first.commits[0]);expect(second.base).toBe(first.base);
},20_000);
