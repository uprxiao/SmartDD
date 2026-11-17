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
afterAll(() => writeFileSync('docs/review/evidence-20261118-0049/boundary-core-observations.json', JSON.stringify(observations, null, 2) + '\n'));
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
function setup(o: { driverId?: 'codex-app-server' | 'claude-sdk'; driver?: AgentDriver; cwd?: string; userData?: string; model?: string; capabilities?: any; version?: string; launchGate?: () => Promise<void> } = {}) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db), insts: Inst[] = [], driverId = o.driver?.id ?? o.driverId ?? 'codex-app-server';
  const driver: AgentDriver = o.driver ?? { id: driverId, command: 'fake', create: () => { const i = new Inst(driverId); insts.push(i); return i; } };
  const runs = new AgentRunService({ store, drivers: new Map([[driverId, driver]]), processes: { read: p => ({ pid: p, startedAt: 'review-owned-process' }), state: () => 'running' }, host: { instanceId: 'review-1755', pid: process.pid, startedAt: null } });
  const resolveLaunch: LaunchResolver = async ({ model }) => { await o.launchGate?.(); return ({ driverId, executable: { path: '/review/fake', version: o.version ?? (driverId === 'claude-sdk' ? '2.1.326' : '0.169.0') }, env: {}, stateRoot: '/review/state', compatibility: {}, extraArgs: [], model, capabilities: o.capabilities }); };
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

it('Q01a: Stop during default-model lookup must prevent the next native turn from starting', async () => {
  const lookup = gate<void>(), peer = nativePeer(true, lookup.promise), s = setup({ driver: peer.driver });
  await s.submit(1, 'first'); await until(() => peer.models.length === 1); peer.finish(); await until(() => s.svc.status(s.taskId) === 'completed');
  await until(() => !(s.svc as any).dispatching.has(s.taskId));
  s.svc.setSelection(s.taskId, { model: 'explicit' }, 1); await s.runs.close(s.runs.runForTask(s.taskId)!.runId);
  await s.submit(2, 'resumed-explicit'); await until(() => peer.models.length === 2); peer.finish(); await until(() => s.svc.status(s.taskId) === 'completed');
  await until(() => !(s.svc as any).dispatching.has(s.taskId));
  s.svc.setSelection(s.taskId, { model: null }, 2); const queued = await s.submit(3, 'must not start after Stop');
  await until(() => peer.peers.at(-1)!.server.calls('config/read').length === 1);
  await s.svc.stop(s.taskId); lookup.resolve(); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  observations.Q01a = { stoppedDuringLookup: true, resumedRealDriver: true, nativeModels: peer.models, nativeStarts: peer.peers.reduce((n, p) => n + p.server.calls('turn/start').length, 0), thirdStatus: s.store.turn(queued.turnId)?.status, interruptedAfterStarting: peer.peers.at(-1)!.server.calls('turn/interrupt').length };
  await s.runs.closeAll(); expect(peer.models).toHaveLength(2); expect(s.store.turn(queued.turnId)?.status).toBe('accepted');
});

it('Q01b: Stop during launch resolution must not be mistaken for permission to auto-resume after exit', async () => {
  const lookup = gate<void>(); let hold: Promise<void> | undefined, resolving = 0;
  const s = setup({ launchGate: async () => { resolving++; await hold; } });
  await s.submit(1, 'first'); await until(() => s.insts[0]?.turns.length === 1); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const first = s.insts[0]; first.emitExit = false; first.finish(); first.e.emit({ type: 'unusable', reason: 'ended' }); await tick();
  hold = lookup.promise; const queued = await s.submit(2, 'second'); await until(() => resolving === 2);
  await s.svc.stop(s.taskId); lookup.resolve(); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const markedStopSeq = (s.svc as any).blockedByClosing.get(s.taskId), currentStopSeq = (s.svc as any).stopSeq.get(s.taskId);
  first.e.emit({ type: 'exit', code: 0, signal: null }); await tick(); await tick();
  observations.Q01b = { stoppedBeforeClosingMarkerWasRecorded: true, markedStopSeq, currentStopSeq, instances: s.insts.length, secondStatus: s.store.turn(queued.turnId)?.status, resentInputs: s.insts[1]?.turns.map(t => t.text) ?? [] };
  await s.runs.closeAll(); expect(s.insts).toHaveLength(1); expect(s.store.turn(queued.turnId)?.status).toBe('accepted');
});

function nativePeer(defaultKnown: boolean, holdConfig?: Promise<void>) {
  const peers: { child: FakeChild; server: FakeAppServer }[] = [], models: string[] = []; let sticky = 'native-default', turn = 0;
  const driver: AgentDriver = { id: 'codex-app-server', command: 'codex', create: () => {
    const child = new FakeChild(), server = new FakeAppServer(child, (m, p) => {
      if (m.method === 'initialize') p.reply(m.id, {});
      else if (m.method === 'thread/start') { sticky = m.params.model ?? 'native-default'; p.reply(m.id, { thread: { id: 'thread-sticky' }, model: sticky }); }
      else if (m.method === 'thread/resume') { sticky = m.params.model ?? sticky; p.reply(m.id, { thread: { id: 'thread-sticky' }, model: sticky }); }
      else if (m.method === 'skills/list') p.reply(m.id, { data: [] });
      else if (m.method === 'turn/interrupt') { p.reply(m.id, {}); p.notify('turn/completed', { threadId: 'thread-sticky', turn: { id: m.params.turnId, status: 'interrupted' } }); }
      else if (m.method === 'config/read') { void Promise.resolve(holdConfig).then(() => p.reply(m.id, { config: { model: defaultKnown ? 'native-default' : null } })); }
      else if (m.method === 'model/list') p.reply(m.id, { data: defaultKnown ? [{ id: 'native-default', model: 'native-default', isDefault: true }] : [] });
      else if (m.method === 'turn/start') { sticky = m.params.model ?? sticky; models.push(sticky); const id = 't' + (++turn); p.notify('turn/started', { threadId: 'thread-sticky', turn: { id } }); p.reply(m.id, { turn: { id } }); }
    });
    peers.push({ child, server }); return new CodexAppServerInstance(() => child.asChild());
  } };
  return { driver, peers, models, finish: () => peers.at(-1)!.server.notify('turn/completed', { threadId: 'thread-sticky', turn: { id: 't' + turn, status: 'completed' } }) };
}
for (const known of [true, false]) it(`Q02: resume in default selection must ${known ? 'resolve and restore native default' : 'refuse when native default cannot be determined'}`, async () => {
  const peer = nativePeer(known), s = setup({ driver: peer.driver });
  await s.submit(1, 'a'); await until(() => peer.models.length === 1); peer.finish(); await until(() => s.svc.status(s.taskId) === 'completed');
  s.svc.setSelection(s.taskId, { model: 'explicit-other' }, 1); await s.submit(2, 'b'); await until(() => peer.models.length === 2); peer.finish(); await until(() => s.svc.status(s.taskId) === 'completed');
  await until(() => !(s.svc as any).dispatching.has(s.taskId)); await s.runs.close(s.runs.runForTask(s.taskId)!.runId);
  s.svc.setSelection(s.taskId, { model: null }, 2); await s.submit(3, 'c'); await until(() => !(s.svc as any).dispatching.has(s.taskId));
  const newest = peer.peers.at(-1)!, resume = newest.server.calls('thread/resume')[0];
  observations['Q02-' + known] = { knownDefault: known, selection: s.svc.snapshot(s.taskId).selection.model ?? 'default', resumedThread: resume?.params.threadId, models: peer.models, defaultQueries: newest.server.calls('config/read').length + newest.server.calls('model/list').length, status: s.svc.status(s.taskId) };
  await s.runs.closeAll();
  if (known) expect(peer.models.at(-1)).toBe('native-default'); else expect(peer.models).toHaveLength(2);
});

it('Q03: previews of many pending requests must remain within aggregate snapshot budget', async () => {
  const s = setup({ driverId: 'claude-sdk' }); await s.submit(1, 'parallel commands'); await until(() => s.insts[0]?.turns.length === 1);
  for (let n = 0; n < 40; n++) s.insts[0].e.emit({ type: 'request', requestKey: 'parallel-' + n, kind: 'command_approval', payload: { tool: 'Bash', input: { command: '中'.repeat(30 * 1024) } } });
  const snap = s.svc.snapshot(s.taskId), bytes = Buffer.byteLength(JSON.stringify(snap));
  observations.Q03 = { pendingCount: snap.requests.length, responseBytes: bytes, max: 256 * 1024, visibleItems: snap.items.length, hasOlder: snap.hasOlder };
  await s.runs.closeAll(); expect(bytes).toBeLessThanOrEqual(256 * 1024);
});

for (const text of ['D'.repeat(256 * 1024), '"'.repeat(130 * 1024)]) it(`Q04: saving a valid ${Buffer.byteLength(text)} byte draft must preserve its original`, () => {
  const s = setup(), receipt = s.svc.saveDraft(s.taskId, { text }, 0); let off = 0, body = '';
  for (;;) { const c = s.svc.draftBody(s.taskId, off); body += c.chunk; if (c.done) break; off = c.next; }
  const restored = JSON.parse(body);
  observations['Q04-' + text.length] = { rawTextBytes: Buffer.byteLength(text), draftJsonBytes: Buffer.byteLength(JSON.stringify({ text })), saveReceipt: receipt, storedTruncated: restored.truncated ?? false, restoredTextChars: restored.text?.length ?? 0, storedFields: Object.keys(restored) };
  expect(receipt.ok).toBe(true); expect(restored.text?.length).toBe(text.length);
});
