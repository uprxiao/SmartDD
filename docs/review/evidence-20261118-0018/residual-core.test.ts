// Review-owned boundary tests against the actual working-tree implementation.
// No model, GUI, user credentials, or production database is used.
import Database from 'better-sqlite3';
import { afterAll, afterEach, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runBundledMigrations } from '../../../src/main/db/migrations';
import { AgentStore } from '../../../src/main/core/agent/agent-store';
import { AgentRunService } from '../../../src/main/core/agent/agent-run-service';
import { AgentTaskService, type LaunchResolver } from '../../../src/main/core/agent/agent-task-service';
import { DriverError, Emitter, type DriverInstance, type DriverOpenOptions, type TurnInput, type AgentDriver } from '../../../src/main/core/agent/driver';
import { ClaudeSdkInstance, type SdkQueryFn } from '../../../src/main/core/agent/drivers/claude-sdk';
import { evaluateCapabilities } from '../../../src/main/core/agent/capabilities';
import { until, tick } from '../../../src/main/core/agent/test-doubles';
import { requestOptions } from '../../../src/renderer/features/agent-tasks/agent-timeline';

const observations: Record<string, unknown> = {};
const dbs: Database.Database[] = [], roots: string[] = [];
afterAll(() => writeFileSync('docs/review/evidence-20261118-0018/residual-observations.json', JSON.stringify(observations, null, 2) + '\n'));
afterEach(() => { for (const db of dbs.splice(0)) db.close(); for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function gate<T = void>() { let resolve!: (v: T) => void, reject!: (e: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }
class Inst implements DriverInstance {
  e = new Emitter(); turns: TurnInput[] = []; closed = false; openError?: Error; emitExit = true;
  startGate?: Promise<void>;
  constructor(readonly driverId: 'codex-app-server' | 'claude-sdk') {}
  on = this.e.on.bind(this.e);
  async open(o: DriverOpenOptions) { this.e.emit({ type: 'process', pid: 9191 }); if (this.openError) throw this.openError; return { nativeId: o.resumeNativeId ?? 'native-review', confirmed: true }; }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `t${this.turns.length}`; this.e.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); await this.startGate; return { nativeTurnId: id }; }
  finish() { this.e.emit({ type: 'turn.completed', nativeTurnId: `t${this.turns.length}`, status: 'completed' }); }
  async respond() {}
  async interrupt() { this.e.emit({ type: 'turn.completed', nativeTurnId: `t${this.turns.length}`, status: 'interrupted' }); }
  async close() { this.closed = true; if (this.emitExit) this.e.emit({ type: 'exit', code: 0, signal: null }); }
}
function setup(o: { driverId?: 'codex-app-server' | 'claude-sdk'; driver?: AgentDriver; cwd?: string; userData?: string; model?: string; capabilities?: any; version?: string } = {}) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db), insts: Inst[] = [], driverId = o.driver?.id ?? o.driverId ?? 'codex-app-server';
  const driver: AgentDriver = o.driver ?? { id: driverId, command: 'fake', create: () => { const i = new Inst(driverId); insts.push(i); return i; } };
  const runs = new AgentRunService({ store, drivers: new Map([[driverId, driver]]), processes: { read: p => ({ pid: p, startedAt: 'review-owned-process' }), state: () => 'running' }, host: { instanceId: 'review-1755', pid: process.pid, startedAt: null } });
  const resolveLaunch: LaunchResolver = async ({ model }) => ({ driverId, executable: { path: '/review/fake', version: o.version ?? (driverId === 'claude-sdk' ? '2.1.326' : '0.169.0') }, env: {}, stateRoot: '/review/state', compatibility: {}, extraArgs: [], model, capabilities: o.capabilities });
  const svc = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: () => driverId, userData: o.userData });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: o.cwd ?? '/review/work', title: 'review', profileId: 'p', tier: 'ask', model: o.model });
  const submit = (n: number, text: string, attachments?: any[]) => svc.submit(taskId, { clientInputId: `residual-input-${n}`, text, attachments, expectedSelectionRevision: svc.snapshot(taskId).selectionRevision });
  return { db, store, runs, svc, taskId, insts, submit, resolveLaunch, driverId };
}
function filesystem() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-recheck-'))); roots.push(root);
  const cwd = join(root, 'work'), other = join(root, 'other'), userData = join(root, 'ud'); for (const d of [cwd, other, userData]) mkdirSync(d);
  return { root, cwd, other, userData };
}
class Feed {
  values: any[] = []; waiters: { resolve(v: IteratorResult<any>): void; reject(e: Error): void }[] = []; done = false;
  emit(v: any) { const w = this.waiters.shift(); if (w) w.resolve({ value: v, done: false }); else this.values.push(v); }
  fail(e: Error) { for (const w of this.waiters.splice(0)) w.reject(e); }
  end() { this.done = true; for (const w of this.waiters.splice(0)) w.resolve({ value: undefined, done: true }); }
  next(): Promise<IteratorResult<any>> { return this.values.length ? Promise.resolve({ value: this.values.shift(), done: false }) : this.done ? Promise.resolve({ value: undefined, done: true }) : new Promise((resolve, reject) => this.waiters.push({ resolve, reject })); }
}
function sdkPeer() {
  const feeds: Feed[] = [], inputs: any[] = [], options: any[] = [];
  const fn: SdkQueryFn = ({ prompt, options: opts }) => {
    const feed = new Feed(); feeds.push(feed); options.push(opts);
    void (async () => { for await (const p of prompt) { inputs.push(p); feed.emit({ type: 'system', subtype: 'init', session_id: opts.sessionId ?? opts.resume }); } })();
    return { [Symbol.asyncIterator]: () => feed, interrupt: async () => {}, setPermissionMode: async () => {}, setModel: async () => {}, close: () => feed.end() };
  };
  return { feeds, inputs, options, driver: { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance(async () => fn) } as AgentDriver };
}

it('N01: retrying an accepted input must not replace its frozen image contents', async () => {
  const fs = filesystem(), image = join(fs.cwd, 'picture.png'); writeFileSync(image, 'IMAGE_A');
  const s = setup(fs); await s.submit(1, 'busy'); await until(() => s.insts[0]?.turns.length === 1); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const a = s.svc.prepareAttachment(s.taskId, null, { name: 'picture.png', sourcePath: image });
  const first = await s.submit(2, 'look', [a]);
  const frozen = JSON.parse((s.store.turn(first.turnId) as any).input_ref).attachments[0].storedPath;
  const before = readFileSync(frozen, 'utf8'); writeFileSync(image, 'IMAGE_B');
  const repeated = await s.submit(2, 'look', [a]);
  const after = readFileSync(frozen, 'utf8'); observations.N01 = { before, after, duplicate: repeated.duplicate, sameTurn: first.turnId === repeated.turnId };
  expect(after).toBe(before);
});

it('N02: failed open must retain an owner whose close has not observed exit', async () => {
  const native = new Inst('codex-app-server'); native.openError = new DriverError('PROTOCOL', 'thread response invalid'); native.emitExit = false;
  const s = setup({ driver: { id: 'codex-app-server', command: 'fake', create: () => native } });
  let error: string | undefined;
  try { await s.runs.open({ taskId: s.taskId, driverId: s.driverId, profileId: 'p', executable: { path: '/fake', version: '0.169.0' }, cwd: '/w', env: {}, stateRoot: '/s', compatibility: {}, tier: 'ask' }); } catch (e) { error = (e as Error).message; }
  const retained = s.runs.runForTask(s.taskId) ?? s.runs.closingForTask(s.taskId);
  observations.N02 = { error, closeRequested: native.closed, nativeExitObserved: false, retainedOwner: !!retained, storedRuns: s.db.prepare('SELECT state,pid FROM capability_runs').all() };
  expect(retained).toBeDefined();
});

it('N03: completion before the start receipt resolves must still drain the next queued input', async () => {
  const s = setup(), ack = gate();
  // Gate just the first start receipt, independently of native turn notifications.
  const drv = (s.runs as any).deps.drivers.get(s.driverId) as AgentDriver, create = drv.create;
  drv.create = () => { const i = create() as Inst; i.startGate = ack.promise; return i; };
  await s.submit(1, 'first'); await until(() => s.insts[0]?.turns.length === 1);
  await s.submit(2, 'second'); s.insts[0].finish(); await tick();
  s.insts[0].startGate = undefined; ack.resolve(); await until(() => !(s.svc as any).dispatching.has(s.taskId)); await tick();
  observations.N03 = { sent: s.insts[0].turns.map(t => t.text), queued: s.svc.snapshot(s.taskId).queued.map(q => q.text), status: s.svc.status(s.taskId) };
  expect(s.insts[0].turns.map(t => t.text)).toEqual(['first', 'second']);
});

it('N04: a terminal SDK stream must not silently strand an explicit retry on the dead query', async () => {
  const peer = sdkPeer(), s = setup({ driver: peer.driver }); await s.submit(1, 'one'); await until(() => peer.inputs.length === 1); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  peer.feeds[0].fail(new Error('SDK transport ended while native process has not exited')); await until(() => s.svc.status(s.taskId) === 'failed');
  await s.submit(2, 'explicit retry'); await tick(); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const snap = s.svc.snapshot(s.taskId), silentlyStranded = peer.inputs.length === 1 && peer.feeds.length === 1 && snap.status === 'working' && snap.queued.length === 1;
  observations.N04 = { queries: peer.feeds.length, sent: peer.inputs.map(p => p.message.content), queued: snap.queued.map(q => q.text), status: snap.status, dispatchLatchReleased: !(s.svc as any).dispatching.has(s.taskId) };
  await s.runs.closeAll(); expect(silentlyStranded).toBe(false);
});

it('N05: clearing an explicit model must restore default rather than the initial explicit model', async () => {
  const s = setup({ driverId: 'claude-sdk', model: 'opus' }); await s.submit(1, 'one'); await until(() => s.insts[0]?.turns.length === 1); await until(() => !(s.svc as any).dispatching.has(s.taskId)); s.insts[0].finish();
  s.svc.setSelection(s.taskId, { model: 'sonnet' }, 1); await s.submit(2, 'two'); await until(() => s.insts[0].turns.length === 2); await until(() => !(s.svc as any).dispatching.has(s.taskId)); s.insts[0].finish();
  s.svc.setSelection(s.taskId, { model: null }, 2); await s.submit(3, 'three'); await until(() => s.insts[0].turns.length === 3);
  observations.N05 = { selected: s.svc.snapshot(s.taskId).selection, deliveredModels: s.insts[0].turns.map(t => t.model ?? 'DEFAULT') };
  expect(s.insts[0].turns[2].model).toBeUndefined();
});

it('N06a: an approval must not execute a full plan while its snapshot displays a truncated shell', async () => {
  const peer = sdkPeer(), s = setup({ driver: peer.driver }); await s.submit(1, 'plan'); await until(() => peer.inputs.length === 1);
  const plan = 'P'.repeat(40 * 1024), response = peer.options[0].canUseTool('ExitPlanMode', { plan }, { signal: new AbortController().signal });
  const req = s.svc.snapshot(s.taskId).requests[0], shown = req.payload.input?.plan;
  await s.svc.respond(s.taskId, req.requestId, req.revision, requestOptions(req as any, 'claude-sdk')[0].result(''));
  const native = await response;
  observations.N06a = { actualPlanBytes: plan.length, snapshotTruncated: req.payload.truncated, displayedPlanBytes: shown?.length ?? 0, nativeAllowed: native.behavior, nativeAllowedPlanBytes: native.updatedInput?.plan?.length };
  await s.runs.closeAll(); expect(shown).toBe(plan);
});

it('N06b: snapshot IPC response must respect the documented 256 KiB boundary', () => {
  const s = setup(); for (let n = 0; n < 2; n++) s.store.acceptTurn({ taskId: s.taskId, clientInputId: `large-${n}`, text: 'X'.repeat(150 * 1024), sourceKind: 'user' });
  const bytes = Buffer.byteLength(JSON.stringify(s.svc.snapshot(s.taskId))); observations.N06b = { snapshotBytes: bytes, contractBytes: 256 * 1024 };
  expect(bytes).toBeLessThanOrEqual(256 * 1024);
});

it('N06c: a single large history item must use a bounded reference or preview', () => {
  const s = setup(); s.store.addHostItem(s.taskId, null, 'system_notice', { detail: 'X'.repeat(300 * 1024) });
  const bytes = Buffer.byteLength(JSON.stringify(s.svc.history(s.taskId, Number.MAX_SAFE_INTEGER))); observations.N06c = { historyBytes: bytes, contractBytes: 256 * 1024 };
  expect(bytes).toBeLessThanOrEqual(256 * 1024);
});

for (const error of ['rate_limit', 'max_output_tokens']) it(`N08: Claude ${error} must retain its specific limited reason`, async () => {
  const peer = sdkPeer(), s = setup({ driver: peer.driver }); await s.submit(1, 'work'); await until(() => peer.inputs.length === 1);
  if (error === 'rate_limit') peer.feeds[0].emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', resetsAt: 1900000000 }, uuid: 'limit' });
  peer.feeds[0].emit({ type: 'assistant', error, uuid: 'partial', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'partial answer' }] } });
  peer.feeds[0].emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: error });
  await until(() => s.svc.status(s.taskId) === 'failed' || s.svc.status(s.taskId) === 'limited');
  const snap = s.svc.snapshot(s.taskId); observations[`N08-${error}`] = { nativeReason: error, status: snap.status, payloads: snap.items.map(i => ({ type: i.type, payload: i.payload })) };
  await s.runs.closeAll(); expect(snap.status).toBe('limited');
});

it('N09a: missing reviewer capability must stop an ask-tier launch from claiming the guarantee', async () => {
  const version = '0.167.1', caps = evaluateCapabilities('codex-app-server', version).capabilities;
  const s = setup({ capabilities: caps, version }); await s.submit(1, 'write'); await tick(); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  observations.N09a = { reviewer: s.runs.runForTask(s.taskId)?.capabilities.approvalsReviewer, nativeTurns: s.insts[0]?.turns.length ?? 0, status: s.svc.status(s.taskId) };
  // A verified runtime probe may enable the capability; otherwise it must not dispatch.
  expect((s.insts[0]?.turns.length ?? 0) === 0 || s.runs.runForTask(s.taskId)?.capabilities.approvalsReviewer.state === 'enabled').toBe(true);
});

it('N09b: an unknown mandatory native request must never receive generic approval choices', () => {
  const options = requestOptions({ requestId: 'new', kind: 'other', revision: 1, status: 'pending', origin: {}, payload: { method: 'future/required', params: {} } }, 'codex-app-server');
  observations.N09b = { results: options.map(o => o.result('')) }; expect(options.every(o => o.deny === true && (o.result('') as any).decision === 'decline')).toBe(true);
});

it('N11: a late child message must not reopen an already completed native child', async () => {
  const s = setup({ driverId: 'claude-sdk' }); await s.submit(1, 'delegate'); await until(() => s.insts[0]?.turns.length === 1);
  const emit = s.insts[0].e.emit.bind(s.insts[0].e);
  emit({ type: 'item.completed', nativeItemId: 'parent', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'child-tool', name: 'Agent', input: { prompt: 'x' } }] } });
  emit({ type: 'native', name: 'user', payload: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'child-tool', content: 'done' }] } } });
  const before = s.store.items(s.taskId).find(i => i.type === 'subagent')!;
  emit({ type: 'item.completed', nativeItemId: 'late', itemType: 'assistant', payload: { parentToolUseId: 'child-tool', content: [{ type: 'text', text: 'late progress' }] } });
  const after = s.store.items(s.taskId).find(i => i.type === 'subagent')!;
  observations.N11 = { before: { terminal: before.terminal, status: before.payload.status }, after: { terminal: after.terminal, status: after.payload.status } };
  expect(after.terminal).toBe('completed');
});

it('N12: a home attachment prepared in project A must not silently resolve against project B', async () => {
  const fs = filesystem(); writeFileSync(join(fs.cwd, 'same.png'), 'PROJECT_A'); writeFileSync(join(fs.other, 'same.png'), 'PROJECT_B');
  const s = setup(fs), a = s.svc.prepareAttachment(null, fs.cwd, { name: 'same.png', sourcePath: join(fs.cwd, 'same.png') });
  const b = s.svc.create({ projectId: null, dirId: null, cwd: fs.other, title: 'B', profileId: 'p', tier: 'ask' });
  let rejected = false, actual: string | undefined;
  try { await s.svc.submit(b.taskId, { clientInputId: 'home-cross-project', text: 'attached', attachments: [a], expectedSelectionRevision: 1 }); }
  catch { rejected = true; }
  if (!rejected) { await until(() => s.insts[0]?.turns.length === 1); actual = readFileSync(s.insts[0].turns[0].images![0].path, 'utf8'); }
  observations.N12 = { preparedIn: 'A', target: 'B', acceptedRelativePath: a.relativePath, rejected, actualImageGivenToDriver: actual };
  // Either reject a stale origin or preserve the explicitly selected file; never reinterpret it.
  expect(rejected || actual === 'PROJECT_A').toBe(true);
});

it('N13a: ordinary model text that quotes Goal set must not create a native goal', async () => {
  const peer = sdkPeer(), s = setup({ driver: peer.driver }); await s.submit(1, 'quote a command response'); await until(() => peer.inputs.length === 1);
  peer.feeds[0].emit({ type: 'assistant', uuid: 'ordinary-model-answer', parent_tool_use_id: null, message: { model: 'real-provider-model', content: [{ type: 'text', text: 'Goal set: quoted example only' }] } });
  await tick(); observations.N13a = { goalCommandIssued: false, nativeActiveGoalReceived: false, projectedGoal: s.store.goal(s.taskId) };
  await s.runs.closeAll(); expect(s.store.goal(s.taskId)).toBeNull();
});

it('N13b: ordinary model text that quotes Goal cleared must not clear a real native goal', async () => {
  const peer = sdkPeer(), s = setup({ driver: peer.driver }); await s.submit(1, 'quote a response'); await until(() => peer.inputs.length === 1);
  peer.feeds[0].emit({ type: 'active_goal', value: { condition: 'actual unfinished goal', iterations: 1, set_at: 1 }, uuid: 'native-goal' }); await tick();
  peer.feeds[0].emit({ type: 'assistant', uuid: 'ordinary-model-clear', parent_tool_use_id: null, message: { model: 'real-provider-model', content: [{ type: 'text', text: 'Goal cleared: actual unfinished goal' }] } });
  await tick(); observations.N13b = { nativeGoalStillActive: true, projectedGoal: s.store.goal(s.taskId) };
  await s.runs.closeAll(); expect(s.store.goal(s.taskId)?.status).toBe('active');
});
