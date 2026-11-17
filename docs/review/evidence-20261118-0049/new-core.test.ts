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
import { CodexAppServerInstance } from '../../../src/main/core/agent/drivers/codex-app-server';
import { FakeAppServer, FakeChild } from '../../../src/main/core/agent/test-doubles';
import { requestOptions } from '../../../src/renderer/features/agent-tasks/agent-timeline';

const observations: Record<string, unknown> = {};
const dbs: Database.Database[] = [], roots: string[] = [];
afterAll(() => writeFileSync('docs/review/evidence-20261118-0049/new-core-observations.json', JSON.stringify(observations, null, 2) + '\n'));
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

it('F01a: three native requests must share the overall snapshot budget', async () => {
  const s = setup({ driverId: 'claude-sdk' }); await s.submit(1, 'plans'); await until(() => s.insts[0]?.turns.length === 1);
  for (let n = 0; n < 3; n++) s.insts[0].e.emit({ type: 'request', requestKey: String(n), kind: 'plan_approval', payload: { input: { plan: 'P'.repeat(90 * 1024) } } });
  const snap = s.svc.snapshot(s.taskId), bytes = Buffer.byteLength(JSON.stringify(snap));
  observations.F01a = { requestCount: snap.requests.length, responseBytes: bytes, limit: 256 * 1024 }; await s.runs.closeAll();
  expect(bytes).toBeLessThanOrEqual(256 * 1024);
});

it('F01b: a valid near-limit draft plus timeline must keep snapshot bounded', async () => {
  const s = setup(); await s.submit(1, 'U'.repeat(20 * 1024)); await until(() => s.insts[0]?.turns.length === 1);
  s.svc.saveDraft(s.taskId, { text: 'D'.repeat(255 * 1024) }, 0);
  const bytes = Buffer.byteLength(JSON.stringify(s.svc.snapshot(s.taskId)));
  observations.F01b = { draftBytes: 255 * 1024, responseBytes: bytes, limit: 256 * 1024 }; await s.runs.closeAll();
  expect(bytes).toBeLessThanOrEqual(256 * 1024);
});

it('F01c: Chinese request body range must respect byte rather than UTF16 length', async () => {
  const s = setup({ driverId: 'claude-sdk' }); await s.submit(1, 'plan'); await until(() => s.insts[0]?.turns.length === 1);
  s.insts[0].e.emit({ type: 'request', requestKey: 'c', kind: 'plan_approval', payload: { input: { plan: '中'.repeat(160 * 1024) } } });
  const req = s.svc.snapshot(s.taskId).requests[0], c = s.svc.requestBody(s.taskId, req.requestId, 0);
  const bytes = Buffer.byteLength(c.chunk), responseBytes = Buffer.byteLength(JSON.stringify(c));
  observations.F01c = { chunkChars: c.chunk.length, chunkBytes: bytes, responseBytes, rangeLimit: 128 * 1024, responseLimit: 256 * 1024 }; await s.runs.closeAll();
  expect(bytes).toBeLessThanOrEqual(128 * 1024); expect(responseBytes).toBeLessThanOrEqual(256 * 1024);
});

it('F02: a user Stop while waiting for unusable run exit must prevent queued auto-send', async () => {
  const s = setup(); await s.submit(1, 'first'); await until(() => s.insts[0]?.turns.length === 1); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const first = s.insts[0]; first.emitExit = false; first.finish(); first.e.emit({ type: 'unusable', reason: 'stream ended' }); await tick();
  const queued = await s.submit(2, 'must remain queued after Stop');
  await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const beforeStop = s.svc.status(s.taskId); await s.svc.stop(s.taskId);
  first.e.emit({ type: 'exit', code: 0, signal: null }); await tick(); await tick(); await tick();
  observations.F02 = { beforeStop, afterExplicitStopAndExit: s.svc.status(s.taskId), queuedStatus: s.store.turn(queued.turnId)?.status, totalInstances: s.insts.length, secondInstanceInputs: s.insts[1]?.turns.map(t => t.text) ?? [] };
  await s.runs.closeAll(); expect(s.store.turn(queued.turnId)?.status).toBe('accepted');
});

it('F03: restoring Codex native default must replace the sticky explicit model', async () => {
  const child = new FakeChild(); let turn = 0, stickyModel = 'native-default'; const models: string[] = [];
  const server = new FakeAppServer(child, (m, p) => {
    if (m.method === 'initialize') p.reply(m.id, {});
    else if (m.method === 'thread/start' || m.method === 'thread/resume') { stickyModel = m.params.model ?? 'native-default'; p.reply(m.id, { thread: { id: 't' }, model: stickyModel }); }
    else if (m.method === 'skills/list') p.reply(m.id, { data: [] });
    else if (m.method === 'turn/start') { stickyModel = m.params.model ?? stickyModel; models.push(stickyModel); const id = 'n' + (++turn); p.notify('turn/started', { threadId: 't', turn: { id } }); p.reply(m.id, { turn: { id } }); }
  });
  const driver: AgentDriver = { id: 'codex-app-server', command: 'codex', create: () => new CodexAppServerInstance(() => child.asChild()) };
  const s = setup({ driver });
  await s.submit(1, 'a'); await until(() => models.length === 1);
  server.notify('turn/completed', { threadId: 't', turn: { id: 'n1', status: 'completed' } }); await until(() => s.svc.status(s.taskId) === 'completed');
  s.svc.setSelection(s.taskId, { model: 'explicit-other' }, 1); await s.submit(2, 'b'); await until(() => models.length === 2);
  server.notify('turn/completed', { threadId: 't', turn: { id: 'n2', status: 'completed' } }); await until(() => s.svc.status(s.taskId) === 'completed');
  s.svc.setSelection(s.taskId, { model: null }, 2); await s.submit(3, 'c'); await until(() => models.length === 3);
  observations.F03 = { modelSelectionAfterReset: s.svc.snapshot(s.taskId).selection.model ?? 'default', nativeModels: models, wireModels: server.calls('turn/start').map(c => c.params.model ?? '<omitted>') };
  await s.runs.closeAll(); expect(models).toEqual(['native-default', 'explicit-other', 'native-default']);
});

it('F04: accepted input receipt must survive subsequent selection changes', async () => {
  const s = setup(); const a = await s.submit(1, 'original'); await until(() => s.insts[0]?.turns.length === 1);
  s.svc.setSelection(s.taskId, { model: 'other' }, 1);
  let receipt: unknown, error: string | undefined;
  try { receipt = await s.svc.submit(s.taskId, { clientInputId: 'residual-input-1', text: 'original', expectedSelectionRevision: 1 }); } catch (e) { error = (e as Error).message; }
  observations.F04 = { originalTurnId: a.turnId, receipt, error }; await s.runs.closeAll();
  expect(error).toBeUndefined(); expect(receipt).toMatchObject({ turnId: a.turnId, duplicate: true });
});

it('F05: SDK active_goal must outrank a later compatibility text acknowledgement', async () => {
  const peer = sdkPeer(), s = setup({ driver: peer.driver }); await s.submit(1, '/goal target'); await until(() => peer.inputs.length === 1);
  peer.feeds[0].emit({ type: 'active_goal', value: { condition: 'native canonical target' } });
  peer.feeds[0].emit({ type: 'assistant', uuid: 'ack', message: { content: [{ type: 'text', text: 'Goal set: other target' }] } });
  await tick(); observations.F05 = { nativeTarget: 'native canonical target', goalAfterText: s.store.goal(s.taskId)?.objective };
  await s.runs.closeAll(); expect(s.store.goal(s.taskId)?.objective).toBe('native canonical target');
});

it('F08: reviewer capability must guard native review command as well as ordinary submit', async () => {
  const calls: string[] = [], version = '0.167.1';
  const driver: AgentDriver = { id: 'codex-app-server', command: 'codex', create: () => new class extends Inst { constructor() { super('codex-app-server'); } async command(name: 'review' | 'compact') { calls.push(name); } }() };
  const s = setup({ driver, version, capabilities: evaluateCapabilities('codex-app-server', version).capabilities });
  let error: string | undefined;
  try { await s.svc.command(s.taskId, 'review'); } catch (e) { error = (e as Error).message; }
  observations.F08 = { tier: s.svc.snapshot(s.taskId).selection.tier, reviewer: s.runs.runForTask(s.taskId)?.capabilities.approvalsReviewer, commandsCalled: calls, error };
  await s.runs.closeAll(); expect(calls).toEqual([]); expect(error).toContain('不可用');
});

it('F01d: event page must respect its 256 KiB byte limit', () => {
  const s = setup();
  for (let n = 0; n < 20; n++) s.store.addHostItem(s.taskId, null, 'system_notice', { detail: 'e'.repeat(20 * 1024) });
  const events = s.svc.events(s.taskId, 0), bytes = Buffer.byteLength(JSON.stringify(events));
  observations.F01d = { count: events.length, pageBytes: bytes, limit: 256 * 1024 };
  expect(bytes).toBeLessThanOrEqual(256 * 1024);
});

it('F01e: live durable notification must keep the stored event byte limit', async () => {
  const s = setup({ driverId: 'claude-sdk' }); await s.submit(1, 'plan'); await until(() => s.insts[0]?.turns.length === 1);
  let emittedBytes = 0;
  const off = s.store.subscribe(e => { if (e.type === 'request.opened') emittedBytes = Buffer.byteLength(JSON.stringify(e.payload)); });
  s.insts[0].e.emit({ type: 'request', requestKey: 'event', kind: 'plan_approval', payload: { input: { plan: 'p'.repeat(40 * 1024) } } });
  off(); observations.F01e = { emittedPayloadBytes: emittedBytes, eventLimit: 32 * 1024 }; await s.runs.closeAll();
  expect(emittedBytes).toBeLessThanOrEqual(32 * 1024);
});
