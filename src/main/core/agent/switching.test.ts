import Database from 'better-sqlite3';
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { AgentTaskService, type LaunchResolver } from './agent-task-service';
import { Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import type { DriverId } from './capabilities';
import { HandoffService } from './handoff';
import { until } from './test-doubles';

class Instance implements DriverInstance {
  readonly events = new Emitter(); on = this.events.on.bind(this.events);
  readonly turns: TurnInput[] = []; readonly history: string[] = []; opened!: DriverOpenOptions; nativeId = ''; delayedExit = false;
  constructor(readonly driverId: DriverId) {}
  async open(o: DriverOpenOptions) { this.opened = o; this.nativeId = o.resumeNativeId ?? randomUUID(); return { nativeId: this.nativeId, confirmed: true, defaultModel: 'native-default' }; }
  async modelCatalog() { return [{ id: 'native-default', name: 'Native model', efforts: ['low', 'high'], defaultEffort: 'low' }]; }
  async injectHistory(text: string) { this.history.push(text); }
  async startTurn(t: TurnInput) { this.turns.push(t); const nativeTurnId = `t${this.turns.length}`; this.events.emit({ type: 'turn.started', nativeTurnId, clientInputId: t.clientInputId }); return { nativeTurnId }; }
  finish(text: string) {
    const nativeTurnId = `t${this.turns.length}`;
    this.events.emit({ type: 'item.completed', nativeItemId: nativeTurnId, itemType: this.driverId === 'codex-app-server' ? 'agentMessage' : 'assistant', payload: this.driverId === 'codex-app-server' ? { id: nativeTurnId, type: 'agentMessage', text } : { content: [{ type: 'text', text }] } });
    this.events.emit({ type: 'turn.completed', nativeTurnId, status: 'completed' });
  }
  async respond() {} async interrupt() {}
  async close() { if (!this.delayedExit) this.events.emit({ type: 'exit', code: 0, signal: null }); }
}
const fixtures: { db: Database.Database; runs: AgentRunService }[] = [];
afterEach(async () => { for (const f of fixtures.splice(0)) { await f.runs.closeAll(); await new Promise(r => setTimeout(r, 0)); f.db.close(); } });
function setup(resolve?: LaunchResolver) {
  const db = new Database(':memory:'); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db), instances: Instance[] = [];
  const make = (id: DriverId): AgentDriver => ({ id, command: 'fake', create: () => { const i = new Instance(id); instances.push(i); return i; } });
  const runs = new AgentRunService({ store, drivers: new Map([['codex-app-server', make('codex-app-server')], ['claude-sdk', make('claude-sdk')]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'test', pid: process.pid, startedAt: null } });
  const driver = (id: string) => id === 'a' ? 'codex-app-server' as const : 'claude-sdk' as const;
  const service = new AgentTaskService({ store, runs, profileDriver: driver, resolveLaunch: resolve ?? (async i => ({ driverId: driver(i.profileId), executable: { path: '/synthetic', version: i.profileId === 'a' ? '0.169.0' : '2.1.326' }, env: {}, stateRoot: `/state/${i.profileId}`, compatibility: { account: i.profileId }, settingSources: ['project'], extraArgs: [] })) });
  const { taskId } = service.create({ projectId: null, dirId: null, cwd: '/work', title: 'switch test', profileId: 'a', tier: 'ask' });
  fixtures.push({ db, runs });
  const send = async (text: string) => { const r = await service.submit(taskId, { clientInputId: randomUUID(), text, expectedSelectionRevision: service.snapshot(taskId).selectionRevision }); await until(() => instances.at(-1)?.turns.at(-1)?.clientInputId === store.turn(r.turnId)?.client_input_id); return instances.at(-1)!; };
  const change = (profile: string) => service.switchProfile(taskId, profile, service.snapshot(taskId).selectionRevision);
  return { db, store, runs, service, instances, taskId, send, change };
}

it('A14/A15: A→B→A preserves task and draft; new B gets full history, returning A resumes and gets only missing B history', async () => {
  const s = setup();
  s.service.saveDraft(s.taskId, { text: 'unsent draft' }, 0);
  const a = await s.send('fact-alpha'); a.finish('answer-alpha');
  await s.change('b');
  const b = await s.send('fact-beta');
  expect(b.opened.resumeNativeId).toBeUndefined();
  expect(b.turns[0].text).toBe('fact-beta');
  expect(b.history[0]).toContain('fact-alpha');
  expect(b.history[0]).toContain('不是新的真人授权');
  b.finish('answer-beta');
  await s.change('a');
  const again = await s.send('continue');
  expect(again.opened.resumeNativeId).toBe(a.nativeId);
  expect(again.turns[0].text).toBe('continue');
  expect(again.history[0]).toContain('fact-beta');
  expect(again.history[0]).not.toContain('fact-alpha');
  expect(s.store.draft(s.taskId)?.draft).toEqual({ text: 'unsent draft' });
  expect(s.db.prepare('SELECT kind,delivery_state FROM agent_transfers ORDER BY rowid').all()).toEqual([{ kind: 'full', delivery_state: 'accepted' }, { kind: 'incremental', delivery_state: 'accepted' }]);
});

it('A14: a busy task, a stale revision, and a live goal cannot switch; models remain selectable under a goal', async () => {
  const s = setup(), a = await s.send('work');
  await expect(s.change('b')).resolves.toMatchObject({ ok: true, selection: { profileId: 'a', pendingSwitch: { profileId: 'b' } } });
  await s.change('a'); // Selecting the current profile cancels the pending request.
  a.finish('done');
  await expect(s.service.switchProfile(s.taskId, 'b', 0)).resolves.toMatchObject({ ok: false });
  s.store.upsertGoal({ taskId: s.taskId, bindingId: s.runs.runForTask(s.taskId)!.bindingId, objective: 'goal', status: 'paused', pausedReason: 'waiting_children' });
  await expect(s.change('b')).rejects.toThrow('清除目标');
  expect(s.service.setSelection(s.taskId, { model: 'another' }, s.service.snapshot(s.taskId).selectionRevision).ok).toBe(true);
  s.store.upsertGoal({ taskId: s.taskId, bindingId: s.runs.runForTask(s.taskId)!.bindingId, objective: null, status: 'cleared' });
  await expect(s.change('b')).resolves.toMatchObject({ ok: true });
});

it('A14: a busy selection is persisted, then applied only after the native turn ends', async () => {
  const s = setup(), a = await s.send('work');
  await s.change('b');
  expect(s.service.snapshot(s.taskId).selection.profileId).toBe('a');
  a.finish('done');
  await until(() => s.service.snapshot(s.taskId).selection.profileId === 'b');
  expect(s.service.snapshot(s.taskId).selection.pendingSwitch).toBeUndefined();
  expect(s.runs.runForTask(s.taskId)).toBeUndefined(); // Selecting a target does not start it.
});

it('A14: the old native owner must actually exit before selection changes', async () => {
  const s = setup(), a = await s.send('work'); a.finish('done'); a.delayedExit = true;
  await expect(s.change('b')).rejects.toThrow('仍在退出');
  expect(s.service.snapshot(s.taskId).selection.profileId).toBe('a');
  a.events.emit({ type: 'exit', code: 0, signal: null });
  await expect(s.change('b')).resolves.toMatchObject({ ok: true });
});

it('A07: extension preferences belong to task/profile, not the last selected executor', async () => {
  const s = setup(); s.service.setSelection(s.taskId, { carryExtensions: false }, 1);
  await s.change('b'); expect(s.service.snapshot(s.taskId).selection.carryExtensions).toBe(true);
  await s.change('a'); expect(s.service.snapshot(s.taskId).selection.carryExtensions).toBe(false);
});

it('A18: omissions are explicit and original content survives; unsent/unknown transfers do not claim coverage', async () => {
  const s = setup(), a = await s.send('fact-one'); a.finish('x'.repeat(10000));
  await s.change('b');
  // Open B with a normal turn, then use a fresh target binding to exercise zero-budget preparation.
  const b = await s.send('fact-two'); b.finish('fact-two-result');
  const binding = s.store.createBinding({ task_id: s.taskId, driver_id: 'codex-app-server', profile_id: 'other', continuation_hash: 'f'.repeat(64), state_root: '/other', cwd_identity: '/work' });
  const turn = s.store.acceptTurn({ taskId: s.taskId, clientInputId: randomUUID(), text: 'go', sourceKind: 'user' }).turn;
  const h = new HandoffService(s.store), transfer = h.prepare(s.taskId, binding, turn.turn_id, 0)!;
  expect(transfer.text).toBe(''); expect(transfer.omissions.length).toBeGreaterThan(0); expect(transfer.covered).toEqual([]);
  h.delivered(transfer.id, 'unknown');
  expect(s.db.prepare('SELECT delivery_state FROM agent_transfers WHERE transfer_id=?').get(transfer.id)).toEqual({ delivery_state: 'unknown' });
  expect(s.store.items(s.taskId).some(i => i.type === 'assistant_message' && i.payload.text === 'x'.repeat(10000))).toBe(true);
});

it('A18 describes the first handoff as full even when a fresh target has native startup notices', async () => {
  const s = setup();
  const a = await s.send('first source input');
  a.finish('first source response');
  const target = s.store.createBinding({ task_id: s.taskId, driver_id: 'codex-app-server', profile_id: 'new-target',
    continuation_hash: 'd'.repeat(64), state_root: '/fixture/target', cwd_identity: '/work' });
  const runId = 'new-target-run';
  s.store.insertRun({ runId, taskId: s.taskId, bindingId: target, generation: 1, projectId: null, driverId: 'codex-app-server',
    owner: { instanceId: 'test', pid: process.pid, startedAt: null }, launchPlanHash: 'c'.repeat(64) });
  s.store.upsertItem({ taskId: s.taskId, runId, turnId: null, nativeKey: 'startup-notice', type: 'system_notice',
    payload: { detail: 'Target process started' }, terminalState: 'completed' });
  const first = new HandoffService(s.store).prepare(s.taskId, target, null, 256 * 1024)!;
  expect(first.text).toContain('first source response');
  expect(first.text).not.toContain('Target process started');
  expect(s.db.prepare('SELECT kind FROM agent_transfers WHERE transfer_id=?').get(first.id)).toEqual({ kind: 'full' });
});

it('P2: a 30-round switch favors the newest history and preserves chronological order within the input budget', async () => {
  const s = setup();
  const answer = (round: number) => `handoff-answer-${round}: ` + 'x'.repeat(8 * 1024);
  for (let round = 0; round < 30; round++) {
    const a = await s.send(`question-${round}`);
    a.finish(answer(round));
    await until(() => s.service.status(s.taskId) === 'completed');
  }
  await s.change('b');
  const prompt = '新'.repeat(4096);
  const b = await s.send(prompt);
  const history = b.history[0] ?? '';
  const included = Array.from(history.matchAll(/handoff-answer-(\d+):/g), match => Number(match[1]));
  expect(included.at(-1)).toBe(29);
  expect(included[0]).toBeGreaterThan(0);
  expect(included).toEqual(Array.from({ length: 30 - included[0] }, (_, i) => included[0] + i));
  expect(Buffer.byteLength(history)).toBeGreaterThan(128 * 1024);
  expect(Buffer.byteLength(history) + Buffer.byteLength(prompt)).toBeLessThanOrEqual(256 * 1024);
  expect(history).toContain('较早');
});

it('A14: stop cancels an unapplied switch', async () => {
  const s = setup(), a = await s.send('work'); await s.change('b');
  await s.service.stop(s.taskId);
  a.finish('stopped result');
  await new Promise(r => setTimeout(r, 0));
  expect(s.service.snapshot(s.taskId).selection.profileId).toBe('a');
  expect(s.service.snapshot(s.taskId).selection.pendingSwitch).toBeUndefined();
});

it('A14: stopping during asynchronous target preflight cancels the switch and retry still returns the original input receipt', async () => {
  let release!: () => void;
  const s = setup(async i => {
    if (i.profileId === 'b') await new Promise<void>(r => { release = r; });
    return { driverId: i.profileId === 'a' ? 'codex-app-server' : 'claude-sdk', executable: { path: '/synthetic', version: i.profileId === 'a' ? '0.169.0' : '2.1.326' }, env: {}, stateRoot: '/state', compatibility: {}, extraArgs: [] };
  });
  const a = await s.send('first'); a.finish('done');
  const turn = s.store.turns(s.taskId)[0];
  const switching = s.change('b');
  await until(() => !!release);
  await expect(s.service.submit(s.taskId, { clientInputId: turn.client_input_id, text: 'different', expectedSelectionRevision: -1 })).resolves.toMatchObject({ duplicate: true, turnId: turn.turn_id });
  await s.service.stop(s.taskId); release();
  await expect(switching).rejects.toThrow('切换已被停止');
  expect(s.service.snapshot(s.taskId).selection.profileId).toBe('a');
});

it('A14: a restored idle pending selection is applied before accepting a new input under the old selection', async () => {
  const s = setup();
  s.store.updateSelection(s.taskId, { pendingSwitch: { profileId: 'b' } }, 1);
  await expect(s.service.submit(s.taskId, { clientInputId: randomUUID(), text: 'new', expectedSelectionRevision: 2 })).rejects.toThrow('模型或权限已变化');
  expect(s.service.snapshot(s.taskId).selection.profileId).toBe('b');
  expect(s.store.turns(s.taskId)).toHaveLength(0);
});

it('A14: validation is repeated immediately before dispatch, so stale configuration never receives the new input', async () => {
  let current = true;
  const s = setup(async i => ({ driverId: 'codex-app-server', executable: { path: '/synthetic', version: '0.169.0' }, env: {}, stateRoot: '/state', compatibility: {}, extraArgs: [], assertCurrent() { if (!current) throw new Error('configuration changed'); } }));
  const a = await s.send('first'); a.finish('done'); current = false;
  const receipt = await s.service.submit(s.taskId, { clientInputId: randomUUID(), text: 'must not send', expectedSelectionRevision: 1 });
  await until(() => s.store.turn(receipt.turnId)?.status === 'failed');
  expect(a.turns).toHaveLength(1);
  expect(s.store.items(s.taskId).some(i => i.type === 'error' && i.payload.message.includes('configuration changed'))).toBe(true);
});

it('A03: only a published reasoning effort is dispatched; obsolete settings are visibly skipped', async () => {
  const s = setup(), a = await s.send('first'); a.finish('done');
  await until(() => !!s.service.snapshot(s.taskId).run?.models?.length);
  s.service.setSelection(s.taskId, { effort: 'high' }, 1);
  const b = await s.send('second'); expect(b.turns.at(-1)?.effort).toBe('high'); b.finish('done');
  s.service.setSelection(s.taskId, { effort: 'not-published' }, s.service.snapshot(s.taskId).selectionRevision);
  await s.send('third');
  expect(a.turns.at(-1)?.effort).toBe('low');
  expect(s.store.items(s.taskId).some(i => i.type === 'system_notice' && i.payload.code === 'settingSkipped')).toBe(true);
});
