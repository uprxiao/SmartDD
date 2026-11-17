// Recheck of the 20 previous contracts against the repaired implementation.
// Only fixture/API adaptation is made; no production implementation is replaced.
import Database from 'better-sqlite3';
import { afterAll, afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import ts from 'typescript';
import { runBundledMigrations } from '../../../src/main/db/migrations';
import { AgentStore } from '../../../src/main/core/agent/agent-store';
import { AgentRunService } from '../../../src/main/core/agent/agent-run-service';
import { AgentTaskService, type LaunchResolver } from '../../../src/main/core/agent/agent-task-service';
import { DriverError, Emitter, type DriverInstance, type DriverOpenOptions, type TurnInput, type AgentDriver } from '../../../src/main/core/agent/driver';
import { CodexAppServerInstance } from '../../../src/main/core/agent/drivers/codex-app-server';
import { ClaudeSdkInstance, type SdkQueryFn } from '../../../src/main/core/agent/drivers/claude-sdk';
import { FakeAppServer, FakeChild, until, tick } from '../../../src/main/core/agent/test-doubles';
import { requestOptions, requestForm } from '../../../src/renderer/features/agent-tasks/agent-timeline';
import { evaluateCapabilities } from '../../../src/main/core/agent/capabilities';
import { prepareAttachment } from '../../../src/main/core/agent/attachments';

const observed: Record<string, unknown> = {};
const dbs: Database.Database[] = [];
afterAll(() => writeFileSync('docs/review/evidence-20261117-2354/probe-observations.json', JSON.stringify(observed, null, 2) + '\n'));
afterEach(() => { vi.useRealTimers(); for (const db of dbs.splice(0)) db.close(); });
function deferred<T = void>() { let resolve!: (v: T) => void; let reject!: (e: Error) => void; const promise = new Promise<T>((r, j) => { resolve = r; reject = j; }); return { promise, resolve, reject }; }

class Inst implements DriverInstance {
  readonly driverId = 'codex-app-server' as const;
  readonly e = new Emitter();
  turns: TurnInput[] = []; steers: TurnInput[] = []; interrupts = 0;
  steerError?: Error;
  on = this.e.on.bind(this.e);
  async open(o: DriverOpenOptions) { return { nativeId: o.resumeNativeId ?? 'native', confirmed: true }; }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `turn-${this.turns.length}`; this.e.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
  finish() { this.e.emit({ type: 'turn.completed', nativeTurnId: `turn-${this.turns.length}`, status: 'completed' }); }
  async respond() {}
  async steer(t: TurnInput) { this.steers.push(t); if (this.steerError) throw this.steerError; }
  async goal(op: any) { this.e.emit({ type: 'goal', objective: op.objective ?? null, status: op.kind === 'pause' ? 'paused' : 'active' }); }
  async interrupt() { this.interrupts++; this.e.emit({ type: 'turn.completed', nativeTurnId: `turn-${this.turns.length}`, status: 'interrupted' }); }
  async close() { this.e.emit({ type: 'exit', code: 0, signal: null }); }
}
function setup(launchGate?: Promise<void>, driver?: AgentDriver, fs?: { cwd: string; userData: string }, version?: string) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db), instances: Inst[] = [];
  const drv: AgentDriver = driver ?? { id: 'codex-app-server', command: 'codex', create() { const i = new Inst(); instances.push(i); return i; } };
  const runs = new AgentRunService({ store, drivers: new Map([[drv.id, drv]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'review', pid: process.pid, startedAt: null } });
  const resolveLaunch: LaunchResolver = async () => { await launchGate; return { driverId: drv.id, executable: { path: '/review/fake', version: version ?? (drv.id === 'claude-sdk' ? '2.1.326' : '0.169.0') }, env: {}, stateRoot: '/review/state', compatibility: {}, extraArgs: [] }; };
  const tasks = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: () => drv.id, userData: fs?.userData });
  const { taskId } = tasks.create({ projectId: null, dirId: null, cwd: fs?.cwd ?? '/review/work', title: 'review', profileId: 'review', tier: 'ask' });
  const submit = (n: number, text: string, mode?: 'steer', attachments?: any[]) => tasks.submit(taskId, { clientInputId: `review-input-${n}`, text, mode, attachments, expectedSelectionRevision: 1 });
  return { db, store, runs, tasks, taskId, instances, submit };
}

it('RC01: canceling application quit must not close running Agents', () => {
  // Compile the TWO actual registered callbacks from index.ts, without starting
  // Electron, loading daily data, or reproducing the callback implementation.
  const source = ts.createSourceFile('index.ts', readFileSync('src/main/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const callbacks: string[] = [];
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(source) === 'app.on' && n.arguments[0]?.getText(source) === "'before-quit'") callbacks.push(n.arguments[1].getText(source));
    ts.forEachChild(n, visit);
  }
  visit(source);
  const app = new EventEmitter(); let closes = 0; let prevented = false;
  const context = { app, agentWorkspace: { closeAll: async () => { closes++; }, tasks: { list: () => [] } }, ptys: { count: 1 }, dialog: { showMessageBoxSync: () => 1 }, quitConfirmed: false, quitPending: false };
  for (const c of callbacks) {
    const js = ts.transpileModule(`const cb = ${c};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const cb = new Function(...Object.keys(context), `${js}; return cb;`)(...Object.values(context));
    app.on('before-quit', cb);
  }
  app.emit('before-quit', { preventDefault() { prevented = true; } });
  observed.RC01 = { actualCallbacks: callbacks.length, dialog: 'cancel', prevented, agentCloseCalls: closes };
  expect(closes).toBe(0);
});

it('RC02a: Stop during launch resolution must prevent subsequent dispatch', async () => {
  const gate = deferred(), s = setup(gate.promise);
  await s.submit(1, 'do work');
  const stop = await s.tasks.stop(s.taskId);
  gate.resolve(); await tick(); await until(() => !(s.tasks as any).dispatching.has(s.taskId));
  observed.RC02a = { stop, dispatchedAfterStop: s.instances[0].turns.map(t => t.text), status: s.tasks.status(s.taskId) };
  expect(s.instances[0].turns).toHaveLength(0);
});

it('RC02b: an orphan goal turn after Stop must be interrupted as well', async () => {
  const s = setup(); await s.submit(1, 'work'); await until(() => s.instances[0]?.turns.length === 1);
  await s.tasks.goal(s.taskId, { kind: 'set', objective: 'finish' });
  await s.tasks.stop(s.taskId); const interruptsBefore = s.instances[0].interrupts;
  s.instances[0].e.emit({ type: 'turn.started', nativeTurnId: 'orphan-after-stop', clientInputId: '' });
  await tick();
  observed.RC02b = { interruptsBefore, interruptsAfter: s.instances[0].interrupts, goal: s.store.goal(s.taskId), status: s.tasks.status(s.taskId) };
  expect(s.instances[0].interrupts).toBeGreaterThan(interruptsBefore);
});

it('RC03: unknown steer receipt must never be automatically resent as a new turn', async () => {
  const s = setup(); await s.submit(1, 'a'); await until(() => s.instances[0]?.turns.length === 1);
  s.instances[0].steerError = new DriverError('TIMEOUT', 'response lost after native consumption');
  const receipt = await s.submit(2, 'perform side effect', 'steer');
  s.instances[0].finish(); await tick(); await until(() => !(s.tasks as any).dispatching.has(s.taskId));
  observed.RC03 = { receipt, steered: s.instances[0].steers.map(t => t.text), normalTurns: s.instances[0].turns.map(t => t.text) };
  expect(s.instances[0].turns.filter(t => t.text === 'perform side effect')).toHaveLength(0);
});

it('RC04: a 36 KB input below the 256 KiB text contract must arrive intact', async () => {
  const s = setup(), text = '中'.repeat(12000); await s.submit(1, text); await until(() => s.instances[0]?.turns.length === 1);
  const turn = s.db.prepare('SELECT input_ref FROM agent_turns').get() as any;
  observed.RC04 = { submittedBytes: Buffer.byteLength(text), sentText: s.instances[0].turns[0].text, storedKeys: Object.keys(JSON.parse(turn.input_ref)) };
  expect(s.instances[0].turns[0].text === text).toBe(true);
});

it('RC05: user questions and elicitation must produce their own answer shapes', () => {
  const base = { requestId: 'r', revision: 1, origin: {}, status: 'pending' };
  const cx = requestOptions({ ...base, kind: 'user_input', payload: { method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q1', header: 'Pick', question: 'Which?', options: [{ label: 'A', description: 'A' }] }] } } }, 'codex-app-server');
  const cc = requestOptions({ ...base, kind: 'user_input', payload: { tool: 'AskUserQuestion', input: { questions: [{ header: 'Pick', question: 'Which?', options: [{ label: 'A', description: 'A' }], multiSelect: false }] } } }, 'claude-sdk');
  const el = requestOptions({ ...base, kind: 'elicitation', payload: { method: 'mcpServer/elicitation/request', params: { message: 'name', requestedSchema: { type: 'object', properties: { name: { type: 'string' } } } } } }, 'codex-app-server');
  observed.RC05 = { codex: cx.map(o => o.result('A')), claude: cc.map(o => o.result('A')), elicitation: el.map(o => o.result('A')) };
  // The UI now uses requestForm rather than approval options for questions.
  // Keep the old protocol requirement: the actual answer must have answers.
  const form = requestForm({ ...base, kind: 'user_input', payload: { method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q1', header: 'Pick', question: 'Which?', options: [{ label: 'A', description: 'A' }] }] } } }, 'codex-app-server');
  const answer = form?.kind === 'questions' ? form.toResult({ q1: ['A'] }) : null;
  observed.RC05 = { ...(observed.RC05 as object), codexFormAnswer: answer };
  expect(answer).toEqual({ answers: { q1: { answers: ['A'] } } });
});

it('RC06: approval UI must not offer decisions missing from availableDecisions', () => {
  const request = { requestId: 'r', kind: 'command_approval', revision: 1, origin: {}, status: 'pending', payload: { method: 'item/commandExecution/requestApproval', params: { command: 'write', availableDecisions: ['decline'] } } };
  const results = requestOptions(request, 'codex-app-server').map(o => o.result('') as any);
  observed.RC06 = { availableDecisions: ['decline'], uiResults: results };
  expect(results.every(r => r.decision === 'decline')).toBe(true);
});

// A scripted SDK stream exercises the REAL Claude driver. Native responses,
// including model and capability events, come from the test peer only.
function sdkPeer(script: (emit: (v: any) => void, turn: number, message: any) => void | Promise<void> = () => {}) {
  const state = { options: null as any, prompts: [] as any[], model: '', models: [] as (string | undefined)[], modes: [] as string[] };
  const messages: any[] = [], waiters: ((x: IteratorResult<any>) => void)[] = [];
  let done = false;
  const emit = (v: any) => { const w = waiters.shift(); if (w) w({ value: v, done: false }); else messages.push(v); };
  const fn: SdkQueryFn = ({ prompt, options }) => {
    state.options = options; state.model = String(options.model ?? 'native-default');
    void (async () => { let n = 0; for await (const m of prompt) { state.prompts.push(m); n++; emit({ type: 'system', subtype: 'init', session_id: options.sessionId }); await script(emit, n, m); emit({ type: 'assistant', uuid: `m${n}`, parent_tool_use_id: null, message: { model: state.model, content: [{ type: 'text', text: `model=${state.model}` }] } }); emit({ type: 'result', subtype: 'success', is_error: false }); } done = true; for (const w of waiters.splice(0)) w({ value: undefined, done: true }); })();
    return {
      [Symbol.asyncIterator]: () => ({ next: () => messages.length ? Promise.resolve({ value: messages.shift(), done: false }) : done ? Promise.resolve({ value: undefined, done: true }) : new Promise(r => waiters.push(r)) }),
      interrupt: async () => {},
      setPermissionMode: async (mode: string) => { if (mode === 'bypassPermissions' && !options.allowDangerouslySkipPermissions) throw new Error('bypassPermissions was not enabled at launch'); state.modes.push(mode); },
      setModel: async (model?: string) => { state.models.push(model); state.model = model ?? 'native-default'; },
    } as any;
  };
  return { state, fn, emit };
}

it('RC07: changing Claude model inside the same task must change actual SDK model', async () => {
  const peer = sdkPeer(), driver = new ClaudeSdkInstance(async () => peer.fn), ended: string[] = [];
  driver.on(e => { if (e.type === 'turn.completed') ended.push(e.nativeTurnId); });
  await driver.open({ executable: { path: '/fake', version: '2.1.326' }, cwd: '/w', env: {}, tier: 'ask', model: 'opus' });
  await driver.startTurn({ clientInputId: 'a', text: 'one', tier: 'ask', model: 'opus' }); await until(() => ended.length === 1);
  await driver.startTurn({ clientInputId: 'b', text: 'two', tier: 'ask', model: 'sonnet' }); await until(() => ended.length === 2);
  observed.RC07 = { selected: 'sonnet', actualModel: peer.state.model, setModelCalls: peer.state.models };
  await driver.close();
  expect(peer.state.model).toBe('sonnet');
});

it('RC08: starting in ask must allow a confirmed later full tier via close and resume', async () => {
  const insts: Inst[] = [], opened: DriverOpenOptions[] = [];
  const drv: AgentDriver = { id: 'claude-sdk', command: 'claude', create() {
    const i = new Inst(); (i as any).driverId = 'claude-sdk'; insts.push(i);
    i.open = async o => { opened.push(o); return { nativeId: o.resumeNativeId ?? 'native', confirmed: true }; }; return i;
  } };
  const s = setup(undefined, drv); await s.submit(1, 'one'); await until(() => insts[0]?.turns.length === 1); insts[0].finish();
  s.tasks.setSelection(s.taskId, { tier: 'full' }, 1);
  await s.tasks.submit(s.taskId, { clientInputId: 'review-input-2', text: 'two', expectedSelectionRevision: 2 });
  await until(() => insts[1]?.turns.length === 1);
  observed.RC08 = { instances: insts.length, reopenedTier: opened[1].tier, resumedNativeId: opened[1].resumeNativeId, deliveredTier: insts[1].turns[0].tier };
  expect(opened[1]).toMatchObject({ tier: 'full', resumeNativeId: 'native' });
  expect(insts[1].turns[0].tier).toBe('full');
});

it('RC09: nested Claude assistant output must not be persisted as the parent answer', async () => {
  const peer = sdkPeer(emit => emit({ type: 'assistant', uuid: 'child', parent_tool_use_id: 'agent-tool-1', session_id: 'child-session', message: { content: [{ type: 'text', text: 'CHILD INTERNAL ANSWER' }] } }));
  const s = setup(undefined, { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance(async () => peer.fn) });
  await s.submit(1, 'delegate'); await until(() => s.tasks.status(s.taskId) === 'completed');
  const items = s.store.items(s.taskId).filter(i => i.type === 'assistant_message');
  observed.RC09 = { topLevelAnswers: items.map(i => ({ turnId: i.turnId, text: (i.payload as any).text })) };
  await s.runs.closeAll();
  expect(items.some(i => (i.payload as any).text === 'CHILD INTERNAL ANSWER')).toBe(false);
});

it('RC10: Claude native goal clear must clear the displayed goal', async () => {
  const peer = sdkPeer(emit => emit({ type: 'active_goal', value: null, uuid: 'g-clear' }));
  const s = setup(undefined, { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance(async () => peer.fn) });
  await s.tasks.goal(s.taskId, { kind: 'set', objective: 'finish once' }); await until(() => s.tasks.status(s.taskId) === 'completed');
  observed.RC10 = { nativeGoal: null, projectedGoal: s.store.goal(s.taskId) };
  await s.runs.closeAll();
  expect(s.store.goal(s.taskId)).toBeNull();
});

it('RC11: close must wait for actual ChildProcess exit before dropping run ownership', async () => {
  const child = new FakeChild();
  const server = new FakeAppServer(child, (m, p) => { if (m.id) p.reply(m.id, m.method === 'initialize' ? {} : { thread: { id: 'native' } }); });
  // Simulate a real stubborn process: neither stdin EOF nor SIGTERM proves exit.
  child.stdin.removeAllListeners('finish');
  child.kill = (() => { child.killed = true; return true; }) as any;
  const s = setup(undefined, { id: 'codex-app-server', command: 'codex', create: () => new CodexAppServerInstance(() => child.asChild()) });
  const h = await s.runs.open({ taskId: s.taskId, driverId: 'codex-app-server', profileId: 'review', executable: { path: '/fake', version: '0.169.0' }, cwd: '/w', env: {}, stateRoot: '/s', compatibility: {}, tier: 'ask' });
  vi.useFakeTimers();
  const closing = s.runs.close(h.runId); await vi.advanceTimersByTimeAsync(15001); await closing;
  observed.RC11 = { childExitCode: child.exitCode, sentSigterm: child.killed, activeRunRemoved: !s.runs.active(h.runId), storedState: s.store.run(h.runId)?.state };
  // Remove test listeners before restoring clocks / closing the in-memory DB.
  child.removeAllListeners(); server.child.stdout.destroy();
  expect(s.runs.active(h.runId)).toBeDefined();
});

it('RC12: unavailable goal capability must be refused rather than invoked', async () => {
  const s = setup(undefined, undefined, undefined, '0.167.1'); await s.tasks.setSelection(s.taskId, { tier: 'full' }, 1); await s.tasks.submit(s.taskId, { clientInputId: 'review-capability-goal', text: 'a', expectedSelectionRevision: 2 }); await until(() => s.instances[0]?.turns.length === 1); s.instances[0].finish();
  const run = s.runs.runForTask(s.taskId)!;
  const cap = evaluateCapabilities('codex-app-server', run.version).capabilities.goal;
  let error: string | undefined;
  try { await s.tasks.goal(s.taskId, { kind: 'set', objective: 'unsupported goal' }); } catch (e) { error = (e as Error).message; }
  observed.RC12 = { evaluatedCapability: cap, error, goal: s.store.goal(s.taskId) };
  expect(error).toBeDefined();
});

it('RC13: a queued project image must be rechecked before a host read after a symlink change', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-review-queued-'))), cwd = join(root, 'work'), userData = join(root, 'ud');
  mkdirSync(cwd); mkdirSync(userData);
  const image = join(cwd, 'picture.png'), outside = join(root, 'outside-secret.txt');
  writeFileSync(image, 'original project image'); writeFileSync(outside, 'REVIEW_SYNTHETIC_OUTSIDE_SECRET');
  const gate = deferred();
  const peer = sdkPeer(async (_, n) => { if (n === 1) await gate.promise; });
  const s = setup(undefined, { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance(async () => peer.fn) }, { cwd, userData });
  await s.submit(1, 'wait'); await until(() => peer.state.prompts.length === 1);
  const a = prepareAttachment({ cwd, userData, name: 'picture.png', sourcePath: image });
  await s.submit(2, 'look at the attached project image', undefined, [a]);
  rmSync(image); symlinkSync(outside, image); gate.resolve();
  await until(() => peer.state.prompts.length === 2);
  const content = peer.state.prompts[1].message.content;
  const imageBytes = Buffer.from(content.find((b: any) => b.type === 'image').source.data, 'base64').toString();
  observed.RC13 = { acceptedKind: a.kind, acceptedPath: a.relativePath, actualImageBytesGivenToSdk: imageBytes, outsideProject: !realpathSync(image).startsWith(cwd + '/') };
  await until(() => s.tasks.status(s.taskId) === 'completed'); await s.runs.closeAll(); rmSync(root, { recursive: true, force: true });
  expect(imageBytes).not.toBe('REVIEW_SYNTHETIC_OUTSIDE_SECRET');
});

it('RC14: launch errors must remain visible in the snapshot-backed timeline', async () => {
  const s = setup();
  (s.tasks as any).d.resolveLaunch = async () => { throw new Error('REVIEW: CLI missing at selected path'); };
  await s.submit(1, 'hello'); await until(() => s.tasks.status(s.taskId) === 'failed');
  const snap = s.tasks.snapshot(s.taskId), errors = s.store.events(s.taskId).filter(e => e.type === 'task.error');
  observed.RC14 = { status: snap.status, persistedErrorEvent: errors[0]?.payload, itemTypes: snap.items.map(i => i.type) };
  expect(snap.items.some(i => i.type === 'error' && String((i.payload as any).message).includes('CLI missing'))).toBe(true);
});

it('RC18: SDK failure before a start signal must release the task dispatch latch', async () => {
  const failed = deferred<never>(), prompts: any[] = [];
  const fn: SdkQueryFn = ({ prompt }) => {
    void (async () => { for await (const m of prompt) prompts.push(m); })();
    return {
      [Symbol.asyncIterator]: () => ({ next: () => failed.promise }),
      interrupt: async () => {}, setPermissionMode: async () => {},
    };
  };
  const s = setup(undefined, { id: 'claude-sdk', command: 'claude', create: () => new ClaudeSdkInstance(async () => fn) });
  await s.submit(1, 'first'); await until(() => prompts.length === 1);
  // Reject the real consume() iterator after dispatch began, before any init / assistant frame.
  // It emits a failed turn but startTurn() currently leaves its start promise pending.
  failed.reject(new Error('SDK stream failed before native start'));
  await until(() => s.tasks.status(s.taskId) === 'failed');
  await s.submit(2, 'retry after failure'); await tick(20);
  observed.RC18 = { firstStatus: s.store.turns(s.taskId)[0].status, dispatchLatchStillHeld: (s.tasks as any).dispatching.has(s.taskId), inputsSent: prompts.map(p => p.message.content), queued: s.tasks.snapshot(s.taskId).queued.map(q => q.text) };
  await s.runs.closeAll();
  expect((s.tasks as any).dispatching.has(s.taskId)).toBe(false);
});

it('RC19: native usage limits must project a limited / paused state, not ordinary failure', async () => {
  const s = setup(); await s.submit(1, 'a'); await until(() => s.instances[0]?.turns.length === 1);
  s.instances[0].e.emit({ type: 'native', name: 'error', payload: { turnId: 'turn-1', error: { codexErrorInfo: 'usageLimitExceeded', message: 'REVIEW usage exhausted' } } });
  s.instances[0].e.emit({ type: 'turn.completed', nativeTurnId: 'turn-1', status: 'failed', error: 'usageLimitExceeded' });
  const snap = s.tasks.snapshot(s.taskId);
  observed.RC19 = { nativeError: 'usageLimitExceeded', taskStatus: snap.status, turnStatus: snap.turns[0].status, items: snap.items.filter(i => i.type === 'error').map(i => i.payload) };
  expect(snap.status).toBe('limited');
});
