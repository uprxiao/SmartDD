import Database from 'better-sqlite3';
import {randomUUID} from 'node:crypto';
import {HostBusinessRequests} from './host-business-requests';
import {attachBrowserLoginRequests} from './business-browser-login';
import {taskApplicationScope} from './task-application-scope';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { AgentTaskService, type LaunchResolver } from './agent-task-service';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverModel, type DriverOpenOptions, type TurnInput } from './driver';
import type { DriverId } from './capabilities';
import { until } from './test-doubles';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { providerModelOptions } from '@shared/agent-model-choice';
import { modelHubEndpoints } from '@shared/provider-catalog';

// M14-A05 连续回合与中断、A11 请求面板后端、A16 发送失败、A43 草稿 CAS、A48 归档（阶段 2：U／I 层）。
class Inst implements DriverInstance {
  emitter = new Emitter(); turns: TurnInput[] = []; responses: [string, unknown][] = []; interrupts = 0;
  constructor(readonly driverId: DriverId) {}
  on = this.emitter.on.bind(this.emitter); emit = this.emitter.emit.bind(this.emitter);
  nativeDefault?: string; lazyDefault?: string; newNativeId = 'n1';
  modelCatalog?: (onFallback?: (models: DriverModel[]) => void) => Promise<DriverModel[]>;
  nativeSelection?: { model: string; effort: string };
  publishesGoal = false;
  async open(o: DriverOpenOptions) { this.opened = o; this.emit({ type: 'process', pid: 9 }); if (this.publishesGoal) this.emit({ type: 'catalog', commands: ['goal'], skills: [] }); return { nativeId: o.resumeNativeId ?? this.newNativeId, confirmed: true, ...(this.nativeDefault ? { defaultModel: this.nativeDefault } : {}), ...(this.nativeSelection ? { nativeSelection: this.nativeSelection } : {}) }; }
  async defaultModel() { return this.lazyDefault; }
  histories: string[] = [];
  async injectHistory(text: string) { this.histories.push(text); }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `nt-${this.turns.length}`; this.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
  setTurnTier?: (current: TurnInput['tier'], next: TurnInput['tier']) => Promise<boolean>;
  finish(status: 'completed' | 'interrupted' = 'completed') { this.emit({ type: 'turn.completed', nativeTurnId: `nt-${this.turns.length}`, status }); }
  async respond(k: string, r: unknown) { this.responses.push([k, r]); }
  async interrupt() { this.interrupts++; this.finish('interrupted'); }
  steers: TurnInput[] = []; goals: unknown[] = []; steerFails = false;
  async steer(t: TurnInput) { if (this.steerFails) throw new DriverError('REJECTED', 'expectedTurnId 不匹配'); this.steers.push(t); }
  commands: string[] = [];
  async command(n: string) { this.commands.push(n); }
  async goal(op: any) { this.goals.push(op); if (op.kind === 'set') this.emit({ type: 'goal', objective: op.objective, status: 'active' }); if (op.kind === 'pause') this.emit({ type: 'goal', objective: null, status: 'paused' }); if (op.kind === 'clear') this.emit({ type: 'goal', objective: null, status: 'cleared' }); }
  noExitOnClose = false; opened?: DriverOpenOptions;
  async close() { if (!this.noExitOnClose) this.emit({ type: 'exit', code: 0, signal: null }); }
}
const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(d => d.close()));
function setup(opts: { publishesGoal?: boolean; distinctNativeIds?: boolean; failOpen?: boolean; userData?: string; version?: string; openGate?: Promise<void>; modelCatalog?: Inst['modelCatalog']; nativeSelection?: Inst['nativeSelection']; launchModel?: string; nativeDefault?: string; lazyDefault?: string; artifactDir?: string; modelsWithoutImageInput?: ReadonlySet<string>; profileModelSettings?: ConstructorParameters<typeof AgentTaskService>[0]['profileModelSettings'] } = {}) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db, { artifactDir: opts.artifactDir });
  const insts: Inst[] = [];
  const drv = (id: DriverId): AgentDriver => ({ id, command: id, create: () => { const i = new Inst(id); i.publishesGoal = opts.publishesGoal === true; if (opts.distinctNativeIds) i.newNativeId = `n${insts.length + 1}`; i.nativeDefault = opts.nativeDefault; i.modelCatalog = opts.modelCatalog; i.nativeSelection = opts.nativeSelection; i.lazyDefault = 'lazyDefault' in opts ? opts.lazyDefault : 'inst-default'; insts.push(i); return i; } });
  const runs = new AgentRunService({ store, drivers: new Map([['codex-app-server', drv('codex-app-server')], ['claude-sdk', drv('claude-sdk')], ['antigravity-acp', drv('antigravity-acp')]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'h', pid: 1, startedAt: null } });
  const launches: Parameters<LaunchResolver>[0][] = [];
  const driverFor = (profileId: string): DriverId => profileId === 'cc' ? 'claude-sdk' : profileId === 'gemini' ? 'antigravity-acp' : 'codex-app-server';
  const resolveLaunch: LaunchResolver = async (i) => { launches.push(i); if (opts.openGate) await opts.openGate; if (opts.failOpen) throw new Error('找不到 codex'); return { driverId: driverFor(i.profileId), executable: { path: '/x', version: opts.version ?? (i.profileId === 'cc' ? '2.1.326' : i.profileId === 'gemini' ? '1.5.14' : '0.169.0') }, env: {}, stateRoot: '/s', compatibility: {}, extraArgs: [], modelsWithoutImageInput: opts.modelsWithoutImageInput, ...(opts.launchModel ? { model: opts.launchModel } : {}) }; };
  const svc = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: driverFor, userData: opts.userData, profileModelSettings: opts.profileModelSettings });
  return { db, store, runs, svc, insts, launches, resolveLaunch };
}
const id = (n: number) => `client-input-${n}`;

it('keeps a stopped task stopped when a child result is recovered after restart', async () => {
  const { svc, store, runs, insts, resolveLaunch } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'Stopped parent', profileId: 'cd', tier: 'ask' });
  store.tx(emit => emit(taskId, 'task.user_stopped', { subtree: true }));
  expect(store.queuedTurns(taskId)).toHaveLength(0);

  const restored = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: () => 'codex-app-server' });
  let continued = false;
  restored.attachCoordination({
    beforeDispatch: async () => continued, opened() {}, async settleClosedRun() {}, assertTargetCurrent() {},
    blocked: () => false, waitingChildren: () => false, hasUnfinishedChildren: () => false,
    userContinued: () => { continued = true; }, async userStopped() {},
  });
  const result = restored.enqueueHost(taskId, 'child-result-fixture', 'Recovered child result', 'notification');
  await Promise.resolve();
  expect(restored.status(taskId)).toBe('stopped');
  expect(store.turn(result.turn.turn_id)?.status).toBe('accepted');
  expect(insts).toHaveLength(0);

  await restored.submit(taskId, { clientInputId: id(911), text: 'Continue the recovered task', expectedSelectionRevision: 1 });
  await until(() => insts[0]?.turns[0]?.clientInputId === 'child-result-fixture');
  insts[0].finish();
  await until(() => insts[0]?.turns[1]?.clientInputId === id(911));
  insts[0].finish();
  await runs.closeAll();
});

it('opens a branch at the chosen reply with a new identity and hands off only the preceding conversation', async () => {
  const { svc, store, insts } = setup({ distinctNativeIds: true });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: '原会话', profileId: 'cc', tier: 'ask' });
  const first = await svc.submit(taskId, { clientInputId: id(960), text: '第一轮口令是琥珀', expectedSelectionRevision: 1 });
  await until(() => store.turn(first.turnId)?.status === 'started' && !svc.isDispatching(taskId));
  const second = await svc.submit(taskId, { clientInputId: id(961), text: '下一轮才提交的内容', expectedSelectionRevision: 1 });
  const driver = insts[0];
  store.upsertItem({ taskId, turnId: first.turnId, runId: store.turn(first.turnId)!.run_id, nativeKey: 'branch-answer', type: 'assistant_message', payload: { text: '记住琥珀' }, terminalState: 'completed' });
  driver.finish();
  await until(() => store.turn(second.turnId)?.status === 'started' && !svc.isDispatching(taskId));
  store.upsertItem({ taskId, turnId: second.turnId, runId: store.turn(second.turnId)!.run_id, nativeKey: 'later-answer', type: 'assistant_message', payload: { text: '后来回复' }, terminalState: 'completed' });
  driver.finish();
  await until(() => store.turn(second.turnId)?.status === 'completed');
  const reply = svc.snapshot(taskId).items.find(item => item.type === 'assistant_message' && item.payload.text === '记住琥珀')!;
  const { taskId: branchedId } = svc.branchFromReply(taskId, reply.itemId);
  expect(branchedId).not.toBe(taskId);
  expect(insts).toHaveLength(1);
  expect(svc.snapshot(branchedId).items.map(item => item.payload.text)).toEqual(['第一轮口令是琥珀', '记住琥珀']);
  expect(svc.snapshot(taskId).items.some(item => item.payload.text === '后来回复')).toBe(true);
  const next = await svc.submit(branchedId, { clientInputId: id(962), text: '口令是什么？', expectedSelectionRevision: 1 });
  await until(() => store.turn(next.turnId)?.status === 'started' && !svc.isDispatching(branchedId));
  const branchDriver = insts[1];
  expect(branchDriver.opened?.resumeNativeId).toBeUndefined();
  expect(branchDriver.turns[0].text).toBe('口令是什么？');
  expect(branchDriver.histories).toHaveLength(1);
  expect(branchDriver.histories[0]).toContain('第一轮口令是琥珀');
  expect(branchDriver.histories[0]).toContain('记住琥珀');
  expect(branchDriver.histories[0]).not.toMatch(/下一轮才提交的内容|后来回复/);
});

it('keeps reply likes local and reversible without changing the reply time or body', async () => {
  const { svc, store } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: '点赞', profileId: 'cc', tier: 'ask' });
  const { turn } = store.acceptTurn({ taskId, clientInputId: id(965), text: '问题', sourceKind: 'user' });
  const itemId = store.upsertItem({ taskId, turnId: turn.turn_id, runId: null, nativeKey: 'liked-answer', type: 'assistant_message', payload: { text: '回答' }, terminalState: 'completed' });
  store.endTurn(turn.turn_id, 'completed');
  const getReply = () => svc.snapshot(taskId).items.find(item => item.itemId === itemId)!;
  const initial = getReply();
  expect(svc.setReplyLiked(taskId, itemId, true)).toEqual({ liked: true });
  expect(getReply()).toEqual({ ...initial, liked: true });
  const { taskId: other } = svc.branchFromReply(taskId, itemId);
  expect(svc.snapshot(other).items.find(item => item.type === 'assistant_message')?.liked).not.toBe(true);
  expect(svc.setReplyLiked(taskId, itemId, false)).toEqual({ liked: false });
  expect(getReply()).toEqual(initial);
});

it('validates a saved Claude model ID against the native alias before sending the first effort', async () => {
  const { svc, store, insts } = setup({
    modelCatalog: async () => [{ id:'opus', resolvedId:'claude-opus-5-5', name:'Opus', efforts:['medium'] }],
  });
  const model = 'claude-opus-5-5';
  const { taskId } = svc.create({ projectId:null, dirId:null, cwd:'/w', title:'Claude subscription', profileId:'cc', tier:'ask', model, effort:'medium' });
  const { turnId } = await svc.submit(taskId, { clientInputId:id(976), text:'first turn', expectedSelectionRevision:1 });
  await until(() => store.turn(turnId)?.status === 'started' && !svc.isDispatching(taskId));
  expect(insts[0].opened?.model).toBe(model);
  expect(insts[0].turns[0]).toMatchObject({ model, effort:'medium' });
  insts[0].finish();
  await until(() => store.turn(turnId)?.status === 'completed');

  const current = svc.snapshot(taskId);
  expect(svc.setSelection(taskId, { model:null, effort:null }, current.selectionRevision).ok).toBe(true);
  const next = await svc.submit(taskId, { clientInputId:id(977), text:'executor default', expectedSelectionRevision:svc.snapshot(taskId).selectionRevision });
  await until(() => store.turn(next.turnId)?.status === 'started');
  expect(insts[0].turns[1]).toMatchObject({ model:undefined, effort:undefined });
});

it('sends the first Claude turn with the selected DeepSeek level and keeps each model setting on resume', async () => {
  const flash = 'deepseek-flash', pro = 'deepseek-v4-pro', other = 'unverified';
  const models = [flash, pro, other];
  const provider = {
    id: 'deepseek', name: 'DeepSeek', preset: 'deepseek', endpoints: { anthropic: 'https://api.deepseek.com/anthropic' },
    identityRevision: 1, authType: 'bearer' as const, hasKey: true, recommended: {}, refreshedAt: null,
    models: models.map(model => ({ id: model, name: model, contextWindow: null, offline: false, availability: { claude: 'available' as const, codex: 'untested' as const } })),
  };
  const { svc, store, runs, insts } = setup({
    launchModel: flash,
    modelCatalog: async () => models.map(id => ({ id, name: id, efforts: ['medium'], defaultEffort: 'medium' })),
    profileModelSettings: () => ({ defaultModel: flash, providerBacked: true, options: providerModelOptions(provider, { kind: 'claude', models }) }),
  });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'DeepSeek effort', profileId: 'cc', tier: 'ask', effort: 'low' });
  const revision = () => svc.snapshot(taskId).selectionRevision;
  const turns = [
    { model: flash, expected: 'low' }, { model: pro, effort: 'max', expected: 'max' },
    { model: other, effort: 'medium', expected: undefined }, { model: flash, expected: 'low' },
  ];
  for (const [index, choice] of turns.entries()) {
    if (index) expect((await svc.switchProfile(taskId, 'cc', revision(), choice.model, choice.effort)).ok).toBe(true);
    const { turnId } = await svc.submit(taskId, { clientInputId: id(930 + index), text: 'check effort', expectedSelectionRevision: revision() });
    await until(() => store.turn(turnId)?.status === 'started' && !svc.isDispatching(taskId));
    const instance = insts.at(-1)!;
    expect(instance.turns.at(-1)?.model).toBe(choice.model);
    expect(instance.turns.at(-1)?.effort).toBe(choice.expected);
    instance.finish();
    await until(() => store.turn(turnId)?.status === 'completed');
    if (index === 2) await runs.close(runs.runForTask(taskId)!.runId);
  }
  expect(insts.at(-1)?.opened?.resumeNativeId).toBe('n1');
});

it('uses Model Hub medium on both turns and after resuming a binding with legacy none', async () => {
  const model = 'gpt-6.1-sol';
  const provider = {
    id: 'provider', name: 'Model Hub', preset: 'ultracloud', endpoints: modelHubEndpoints,
    identityRevision: 1, authType: 'bearer' as const, hasKey: true, recommended: {}, refreshedAt: null,
    models: [{ id: model, name: model, contextWindow: null, offline: false, availability: { claude: 'untested' as const, codex: 'available' as const } }],
  };
  const options = providerModelOptions(provider, { kind: 'codex', models: [model] });
  const { svc, insts, runs, store } = setup({
    launchModel: model, nativeDefault: model, nativeSelection: { model, effort: 'none' },
    modelCatalog: async () => [{ id: model, name: model, efforts: [], defaultEffort: 'none' }],
    profileModelSettings: () => ({ defaultModel: model, options }),
  });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'Model Hub', profileId: 'hub', tier: 'ask', model, effort: 'none' });
  for (const [round, instanceIndex, turnCount] of [[0, 0, 1], [1, 0, 2], [2, 1, 1]]) {
    const { turnId } = await svc.submit(taskId, { clientInputId: id(900 + round), text: 'check effort', expectedSelectionRevision: 1 });
    await until(() => store.turn(turnId)?.status === 'started' && !svc.isDispatching(taskId));
    expect(insts[instanceIndex].turns.at(-1)).toMatchObject({ model, effort: 'medium' });
    expect(insts[instanceIndex].turns).toHaveLength(turnCount);
    insts[instanceIndex].finish();
    await until(() => store.turn(turnId)?.status === 'completed');
    if (round === 1) await runs.close(runs.runForTask(taskId)!.runId);
  }
  expect(insts[1].opened?.resumeNativeId).toBe('n1');
});

it('remembers distinct efforts across models and profiles and clears only the selected pair on reset', async () => {
  const { svc } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'effort preferences', profileId: 'a', tier: 'ask', model: 'one', effort: 'high' });
  const choice = (profile: string, model: string, effort?: string | null) =>
    svc.switchProfile(taskId, profile, svc.snapshot(taskId).selectionRevision, model, effort);
  expect((await choice('a', 'two', 'low')).selection.effort).toBe('low');
  expect((await choice('b', 'one', 'medium')).selection.effort).toBe('medium');
  expect((await choice('a', 'one')).selection.effort).toBe('high');
  expect((await choice('a', 'one', null)).selection.effort).toBeUndefined();
  expect((await choice('a', 'two')).selection.effort).toBe('low');
  expect((await choice('a', 'one')).selection.effort).toBeUndefined();
  expect((await choice('b', 'one')).selection.effort).toBe('medium');
});

it('shows the first accepted input in the conversation while the executor starts and keeps a follow-up queued', async () => {
  let release!: () => void;
  const openGate = new Promise<void>(resolve => { release = resolve; });
  const { svc, insts } = setup({ openGate });
  const { taskId } = svc.create({ projectId:null, dirId:null, cwd:'/w', title:'first send', profileId:'cx', tier:'ask' });
  const first = await svc.submit(taskId, {clientInputId:id(321), text:'first message', expectedSelectionRevision:1});
  const followup = await svc.submit(taskId, {clientInputId:id(322), text:'follow-up', expectedSelectionRevision:1});
  const pending = svc.snapshot(taskId);
  expect(pending.preparingTurnId).toBe(first.turnId);
  expect(pending.queued.map(row => row.turnId)).toEqual([followup.turnId]);
  expect(pending.items.some(row => row.type === 'user_message' && row.turnId === first.turnId)).toBe(true);
  await svc.stop(taskId);
  release();
  await until(() => !svc.isDispatching(taskId));
  expect(svc.snapshot(taskId).preparingTurnId).toBeNull();
  expect(svc.snapshot(taskId).queued.map(row => row.turnId)).toEqual([first.turnId, followup.turnId]);
  expect(insts.flatMap(instance => instance.turns)).toEqual([]);
});

it('A14 sends with an exact native model and effort while the cold catalog is still pending', async () => {
  const selection = { model:'gpt-6.2-sol', effort:'medium' };
  let publish!: (models: DriverModel[]) => void;
  const catalog = new Promise<DriverModel[]>(resolve => { publish = resolve; });
  const { svc, insts } = setup({ nativeDefault: selection.model, nativeSelection: selection, modelCatalog: () => catalog });
  const { taskId } = svc.create({ projectId:null, dirId:null, cwd:'/w', title:'cold', profileId:'cx', tier:'ask', ...selection });
  try {
    await svc.submit(taskId, { clientInputId:id(123), text:'first message', expectedSelectionRevision:1 });
    await until(() => insts[0]?.turns.length === 1 && !svc.isDispatching(taskId));
    expect(insts[0].turns[0]).toMatchObject({ text:'first message', ...selection });
  } finally { publish([{ id:selection.model, name:'Sol', efforts:[selection.effort] }]); }
});

it('feedback replay sends the subscription default when thread/start has confirmed it while catalog refresh is held', async () => {
  const selection = { model: 'gpt-6.2-sol', effort: 'medium' };
  const fallback = [{ id: 'registry-fallback', name: 'Registry fallback', efforts: ['low'] }];
  const confirmed = [{ id: selection.model, name: 'Sol', efforts: [selection.effort] }];
  let releaseCatalog!: (models: DriverModel[]) => void;
  const catalog = new Promise<DriverModel[]>(resolve => { releaseCatalog = resolve; });
  let firstPage: ((rows: DriverModel[]) => void) | undefined;
  const { svc, store, insts } = setup({
    nativeDefault: selection.model,
    nativeSelection: selection,
    modelCatalog: callback => { firstPage = callback; return catalog; },
  });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'cold catalog', profileId: 'cx', tier: 'ask',
    ...selection, initialCodexDefault: true });
  const { turnId } = await svc.submit(taskId, { clientInputId: id(301), text: 'first message', expectedSelectionRevision: 1 });
  try {
    await until(() => !!firstPage);
    firstPage?.(fallback);
    // No catalogue refresh has completed, but the same native thread already confirmed these settings.
    await until(() => store.turn(turnId)?.status === 'started', 800);
    expect(insts[0].turns).toHaveLength(1);
    expect(insts[0].turns[0]).toMatchObject({ text: 'first message', ...selection });
  } finally {
    releaseCatalog(confirmed);
    await until(() => !svc.isDispatching(taskId));
  }
});

it.each([true,false])('A14 waits for the live first-turn catalog and combines the model and effort (offered=%s)', async offered => {
  let publish!: (models: DriverModel[]) => void;
  const catalog = new Promise<DriverModel[]>(resolve => { publish = resolve; });
  const {svc,insts} = setup({nativeDefault:'native-default',nativeSelection:{model:'gpt-6.2-sol',effort:'medium'},modelCatalog:()=>catalog});
  const {taskId} = svc.create({projectId:null,dirId:null,cwd:'/w',title:'subscription',profileId:'cx',tier:'ask',
    model:'gpt-6.2-sol', effort:'medium', initialCodexDefault:true});
  await svc.submit(taskId,{clientInputId:id(124),text:'first',expectedSelectionRevision:1});
  await until(()=>!!insts[0]?.opened);
  expect(insts[0].turns).toEqual([]);
  publish([{id:'gpt-6.2-sol',name:'GPT-6.2-Sol',efforts:offered?['medium']:['low']}]);
  await until(()=>insts[0].turns.length===1 && !svc.isDispatching(taskId));
  expect(insts[0].turns[0].model).toBe(offered ? 'gpt-6.2-sol' : 'native-default');
  expect(insts[0].turns[0].effort).toBe(offered ? 'medium' : undefined);
  expect(svc.snapshot(taskId).selection.initialCodexDefault).toBeUndefined();
  expect(svc.snapshot(taskId).selection.model).toBe(offered ? 'gpt-6.2-sol' : undefined);
});

it.each(['resumed selection', 'native fallback', 'unsupported fallback'])('A14 sends after returning to Codex with %s', async evidence => {
  const selection = { model: 'gpt-6.2-sol', effort: 'medium' };
  const models = [{ id: selection.model, name: 'Sol', efforts: ['medium'] }];
  let finishRefresh!: (models: DriverModel[]) => void;
  const refresh = new Promise<DriverModel[]>(resolve => { finishRefresh = resolve; });
  let reads = 0;
  let firstPage: ((models: DriverModel[]) => void) | undefined;
  const { svc, insts, store } = setup({
    nativeSelection: evidence === 'resumed selection' ? selection : { ...selection, effort: 'low' },
    modelCatalog: onFallback => {
      if (++reads < 3) return Promise.resolve(models);
      firstPage = onFallback;
      return refresh;
    },
  });
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'Switcher', profileId: 'cx', tier: 'ask', ...selection });
  const send = (n: number) => svc.submit(taskId, { clientInputId: id(n), text: 'next message', expectedSelectionRevision: svc.snapshot(taskId).selectionRevision });
  const switchTo = (profile: string) => svc.switchProfile(taskId, profile, svc.snapshot(taskId).selectionRevision);
  for (const [index, profile] of [[0, 'cc'], [1, 'cx']] as const) {
    await send(140 + index);
    await until(() => insts[index]?.turns.length === 1 && !svc.isDispatching(taskId));
    insts[index].finish();
    expect(await switchTo(profile)).toMatchObject({ ok: true });
  }
  try {
    const { turnId } = await send(142);
    await until(() => reads === 3);
    expect(insts[2].opened?.resumeNativeId).toBe(insts[0].opened?.resumeNativeId ?? 'n1');
    if (evidence !== 'resumed selection') firstPage?.(evidence === 'native fallback' ? models : [{ ...models[0], efforts: ['low'] }]);
    if (evidence === 'unsupported fallback') {
      await new Promise(resolve => setImmediate(resolve));
      expect(insts[2].turns).toEqual([]);
      finishRefresh(models);
    }
    await until(() => store.turn(turnId)?.status === 'started' && !svc.isDispatching(taskId));
    expect(insts[2].turns).toHaveLength(1);
    expect(insts[2].turns[0]).toMatchObject(selection);
  } finally {
    finishRefresh(models);
    await until(() => !svc.isDispatching(taskId));
  }
});

it('A59 keeps overlapping foreground request waits separate from work in live and historical turns', async () => {
  const { db, svc, store, runs, insts } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'approval timing', profileId: 'cx', tier: 'ask' });
  const { turnId } = await svc.submit(taskId, { clientInputId: id(59), text: 'check timing', expectedSelectionRevision: 1 });
  await until(() => store.turn(turnId)?.status === 'started' && !svc.isDispatching(taskId));
  const { bindingId, runId, generation } = runs.runForTask(taskId)!;
  const origin = { taskId, bindingId, runId, generation, turnId };
  const epoch = Date.parse('2026-11-19T00:00:00Z');
  const at = (seconds: number) => new Date(epoch + seconds * 1000).toISOString();
  db.prepare('UPDATE agent_turns SET started_at=? WHERE turn_id=?').run(at(0), turnId);
  const request = (nativeRequest: string, opened: number, end?: number, nodeId?: string) => {
    const requestId = store.insertNativeRequest({ taskId, origin: { ...origin, nativeRequest, nodeId }, kind: 'command_approval', payload: {} });
    if (end !== undefined) store.resolveRequest(requestId, { decision: 'decline' });
    db.prepare('UPDATE agent_requests SET created_at=?,updated_at=? WHERE request_id=?').run(at(opened), at(end ?? opened), requestId);
    return requestId;
  };
  request('starts-before-foreground', -1, 5);
  request('overlapping-foreground', 3, 7);
  request('child-does-not-pause-parent', 7, 9, 'native-child');
  db.prepare("UPDATE agent_requests SET class='host_business' WHERE request_id=?")
    .run(request('asynchronous-business', 7, 9));
  request('second-foreground', 9);
  expect(svc.snapshot(taskId).turns[0]).toMatchObject({ native_wait_ms: 7000, native_wait_since: epoch + 9000 });

  insts[0].finish();
  db.prepare('UPDATE agent_turns SET ended_at=? WHERE turn_id=?').run(at(12), turnId);
  const page = svc.history(taskId, Number.MAX_SAFE_INTEGER);
  expect(page.turns[0]).toMatchObject({ native_wait_ms: 10000 });
  expect(page.turns[0]).not.toHaveProperty('native_wait_since');
});

it.each(['resolveLaunch', 'integrate'] as const)('A14 waits for the in-progress run before clearing a goal during %s', async phase => {
  const { svc, store, runs, insts } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'resume and clear', profileId: 'cx', tier: 'ask' });
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waitAtGate = () => { entered(); return gate; };
  const deps = (svc as unknown as { d: { resolveLaunch: LaunchResolver } }).d;
  const original = deps.resolveLaunch;
  const launch = vi.spyOn(deps, 'resolveLaunch').mockImplementation(async params => {
    if (phase === 'resolveLaunch') await waitAtGate();
    const plan = await original(params);
    return { ...plan, integrate: async () => { if (phase === 'integrate') await waitAtGate(); return undefined; } };
  });
  const receipt = await svc.submit(taskId, { clientInputId: id(52), text: 'child result', expectedSelectionRevision: 1 });
  await reached;
  const instance = insts[0];
  const goal = instance && vi.spyOn(instance, 'goal').mockImplementation(async () => {
    if (!instance.opened) throw new DriverError('STATE', '会话尚未打开');
  });
  const cleared = svc.goal(taskId, { kind: 'clear' }).then(value => ({ value }), error => ({ error }));
  await new Promise<void>(resolve => setImmediate(resolve));
  try {
    expect(launch).toHaveBeenCalledOnce();
    expect(goal?.mock.calls ?? []).toHaveLength(0);
  } finally {
    release();
    await cleared;
    await until(() => !svc.isDispatching(taskId));
  }
  await expect(cleared).resolves.toEqual({ value: { ok: true } });
  expect(insts).toHaveLength(1);
  expect(insts[0].turns).toHaveLength(1);
  expect(store.turn(receipt.turnId)?.run_id).toBe(runs.runForTask(taskId)?.runId);
  if (goal) expect(goal).toHaveBeenCalledExactlyOnceWith({ kind: 'clear' });
  else expect(insts[0].goals).toEqual([{ kind: 'clear' }]);
});

it.each(['integrate', 'beforeFork'] as const)('A04 cancels a stopped run without forking during %s', async phase => {
  const { svc, store, runs, insts } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'prepare and stop', profileId: 'cc', tier: 'ask' });
  let entered!: () => void;
  let release!: () => void;
  const reached = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const waitAtGate = () => { entered(); return gate; };
  const cancelBeforeFork = vi.fn(async () => {});
  const beforeFork = vi.fn(async () => { if (phase === 'beforeFork') await waitAtGate(); });
  const resolveLaunch = (svc as unknown as { d: { resolveLaunch: LaunchResolver } }).d;
  const original = resolveLaunch.resolveLaunch;
  vi.spyOn(resolveLaunch, 'resolveLaunch').mockImplementationOnce(async params => ({
    ...await original(params),
    integrate: async () => {
      if (phase === 'integrate') await waitAtGate();
      return { beforeFork, cancelBeforeFork, attached: async () => {}, exited: async () => {} };
    },
  }));
  const receipt = await svc.submit(taskId, { clientInputId: id(49), text: 'still in the queue', expectedSelectionRevision: 1 });
  await reached;
  const run = runs.runForTask(taskId)!;
  const open = vi.spyOn(insts[0], 'open');
  vi.spyOn(insts[0], 'close').mockResolvedValueOnce();
  expect(store.run(run.runId)?.pid).toBeNull();
  await expect(svc.stop(taskId)).resolves.toEqual({ stopped: true });
  release();
  await until(() => open.mock.calls.length > 0 || store.run(run.runId)?.state === 'stopped');

  expect(open).not.toHaveBeenCalled();
  expect(beforeFork).toHaveBeenCalledTimes(phase === 'beforeFork' ? 1 : 0);
  expect(cancelBeforeFork).toHaveBeenCalledOnce();
  expect(store.run(run.runId)).toMatchObject({ state: 'stopped', pid: null, error_code: null });
  expect(store.turn(receipt.turnId)?.status).toBe('accepted');
  expect(svc.snapshot(taskId).items.filter(item => item.type === 'error')).toEqual([]);
});

it('A71 saves the complete current plan of the selected project task only', async () => {
  const artifactDir = mkdtempSync(join(tmpdir(), 'willyou-a71-plan-'));
  try {
    const { db, svc, store, insts } = setup({ artifactDir });
    db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('project', 'Fixture project', 1, 1);
    const create = () => svc.create({ projectId: 'project', dirId: null, cwd: '/w', title: 'plan task', profileId: 'cc', tier: 'ask' }).taskId;
    const taskId = create(), other = create();
    await svc.submit(taskId, { clientInputId: id(1), text: 'plan', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const plan = '# 迁移计划\n\n' + '完整内容🙂\n'.repeat(40_000) + '尾行\n';
    const addPlan = (nativeItemId: string, content: string) => insts[0].emit({ type: 'item.completed',
      nativeItemId, itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: nativeItemId, name: 'ExitPlanMode', input: { plan: content } }] } });
    const plans = () => svc.snapshot(taskId).items.filter(entry => entry.type === 'proposed_plan');
    addPlan('plan-one', plan);
    await until(() => plans().length === 1);
    const [item] = plans();
    expect(item.payload.truncated).toBe(true);
    expect(svc.planForSaving(taskId, item.itemId, item.revision)).toEqual({ projectId: 'project', text: plan });
    expect(() => svc.planForSaving(other, item.itemId, item.revision)).toThrow('任务的计划不存在');
    expect(() => svc.planForSaving(taskId, item.itemId, item.revision + 1)).toThrow('计划已更新');
    const notice = store.addHostItem(taskId, null, 'system_notice', { plan: 'not a plan' });
    expect(() => svc.planForSaving(taskId, notice, 1)).toThrow('任务的计划不存在');
    addPlan('plan-two', 'X'.repeat(1200 * 1024));
    await until(() => plans().length === 2);
    const [, oversized] = plans();
    expect(svc.planForSaving(taskId, oversized.itemId, oversized.revision).text).toBe('X'.repeat(1200 * 1024));
    rmSync(join(artifactDir, taskId, `${oversized.itemId}.r${oversized.revision}.json`));
    expect(() => svc.planForSaving(taskId, oversized.itemId, oversized.revision)).toThrow('原文文件丢失');
  } finally { rmSync(artifactDir, { recursive: true, force: true }); }
});

it('A65: only a writable native run contributes a before and after snapshot', async () => {
  const { svc, runs, store, insts } = setup();
  const create = (title: string, profileId: string) => svc.create({ projectId: null, dirId: null, cwd: '/w', title, profileId, tier: 'ask' }).taskId;
  const reader = create('read side of shared workspace', 'cx');
  const writer = create('write side of shared workspace', 'cc');
  let readOnly = true;
  svc.attachCoordination({ beforeDispatch: async () => true, opened() {}, assertTargetCurrent() {}, settleClosedRun: async () => {},
    waitingChildren: () => false, blocked: () => false, userContinued() {}, userStopped: async () => {}, hasUnfinishedChildren: () => false,
    readOnly: taskId => taskId === reader && readOnly });
  const before = vi.fn(async (_taskId: string, _turnId: string, _runId: string) => {});
  const after = vi.fn(async (_taskId: string, _turnId: string) => {});
  svc.attachDiffs({ before, after, capturing: () => false, beginTaskRemoval: () => () => {} });

  const read = await svc.submit(reader, { clientInputId: id(12), text: 'read files', expectedSelectionRevision: 1 });
  await until(() => insts[0]?.turns.length === 1);
  const write = await svc.submit(writer, { clientInputId: id(13), text: 'modify files', expectedSelectionRevision: 1 });
  await until(() => insts[1]?.turns.length === 1);
  expect(insts[0].opened?.readOnly).toBe(true);
  readOnly = false;
  insts[0].finish();
  insts[1].finish();
  await until(() => store.turn(read.turnId)?.status === 'completed' && after.mock.calls.length > 0);
  expect(before.mock.calls).toEqual([[writer, write.turnId, runs.runForTask(writer)?.runId, false]]);
  expect(after.mock.calls).toEqual([[writer, write.turnId, false]]);

  await runs.close(runs.runForTask(reader)!.runId);
  vi.spyOn(runs, 'injectHistory').mockResolvedValue(undefined);
  const promoted = await svc.submit(reader, { clientInputId: id(14), text: 'modify only after the run changes', expectedSelectionRevision: 1 });
  await until(() => insts[2]?.turns.length === 1 || ['failed', 'unknown', 'canceled'].includes(store.turn(promoted.turnId)?.status ?? ''));
  expect(svc.snapshot(reader).items.filter(item => item.type === 'error').map(item => item.payload)).toEqual([]);
  expect(insts[2]?.turns).toHaveLength(1);
  insts[2].finish();
  expect(before).toHaveBeenLastCalledWith(reader, promoted.turnId, runs.runForTask(reader)?.runId, false);
  expect(after).toHaveBeenLastCalledWith(reader, promoted.turnId, false);
});

it('A05 dispatches another foreground turn while an earlier native background node is running', async () => {
  const { svc, store, insts, runs } = setup();
  const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'background', profileId: 'cc', tier: 'ask' });
  const before = vi.fn(async () => {});
  const after = vi.fn(async () => {});
  svc.attachDiffs({ before, after, capturing: () => false, beginTaskRemoval: () => () => {} });
  const first = await svc.submit(taskId, { clientInputId: id(51), text: 'Start background work', expectedSelectionRevision: 1 });
  await until(() => insts[0]?.turns.length === 1);
  const runId = runs.runForTask(taskId)!.runId;
  insts[0].emit({ type: 'item.completed', nativeItemId: 'launch', itemType: 'assistant', payload: {
    content: [{ type: 'tool_use', id: 'background-job', name: 'Bash', input: { command: 'git pull', run_in_background: true } }],
  } });
  insts[0].emit({ type: 'node.state', nodeId: 'native-task-id', state: 'running' });
  insts[0].emit({ type: 'node.state', nodeId: 'background-job', replacesNodeId: 'native-task-id', state: 'running', nativeTask: { kind: 'command', background: true } });
  insts[0].finish();
  const parent = svc.snapshot(taskId);
  expect(parent).toMatchObject({ status: 'working', run: { busy: false }, backgroundWork: [
    { runId, turnId: first.turnId, terminal: null, payload: { status: 'running', background: true } },
  ] });
  const second = await svc.submit(taskId, { clientInputId: id(52), text: 'Follow up in the foreground', expectedSelectionRevision: 1 });
  await until(() => insts[0]?.turns.length === 2);
  expect(after).toHaveBeenCalledWith(taskId, first.turnId, true);
  expect(before).toHaveBeenLastCalledWith(taskId, second.turnId, runId, true);
  expect(runs.runForTask(taskId)?.runId).toBe(runId);
  expect(runs.nativeBusy(runId)).toBe(true);
  expect(store.turn(second.turnId)?.status).toBe('started');
  insts[0].emit({ type: 'node.state', nodeId: 'background-job', state: 'completed', nativeTask: { kind: 'command', background: true, output: 'Updated\n' } });
  insts[0].finish();
  const settled = svc.snapshot(taskId);
  expect(settled.backgroundWork ?? []).toEqual([]);
  expect(runs.nativeBusy(runId)).toBe(false);
  expect(settled.items.find(item => item.itemId === parent.backgroundWork?.[0].itemId)).toMatchObject({
    turnId: first.turnId, terminal: 'completed', payload: { status: 'completed', output: 'Updated\n' },
  });
});

it('A44 bounds event catch-up to its captured watermark and only refreshes explicitly requested history in the same task', () => {
  const { svc, store } = setup();
  const create = (title: string) => svc.create({ projectId: null, dirId: null, cwd: '/w', title, profileId: 'cx', tier: 'ask' }).taskId;
  const taskId = create('history'), other = create('different task');
  const start = store.watermark(taskId);
  const local = store.addHostItem(taskId, null, 'system_notice', { detail: 'in the requested task' });
  const through = store.watermark(taskId);
  const future = store.addHostItem(taskId, null, 'system_notice', { detail: 'after the captured watermark' });
  const foreign = store.addHostItem(other, null, 'system_notice', { detail: 'different task' });
  expect(svc.events(taskId, start, 128, through).map(event => [event.seq, event.itemId])).toEqual([[through, local]]);
  expect(svc.events(taskId, through).map(event => event.itemId)).toEqual([future]);
  expect(() => svc.events(taskId, through, 128, start)).toThrow('事件序号范围无效');
  expect(svc.historyItems(taskId, [foreign, local]).map(item => item.itemId)).toEqual([local]);
  expect(() => svc.historyItems(taskId, Array(9).fill(local))).toThrow('历史条目查询超出范围');
  const oversized = Object.fromEntries(Array.from({ length: 50 }, (_, i) => ['key'.repeat(380) + i, 'test']));
  const ids = Array.from({ length: 8 }, () => store.addHostItem(taskId, null, 'system_notice', oversized));
  const previews = svc.historyItems(taskId, ids);
  expect(previews).toHaveLength(ids.length);
  expect(previews.every(item => item.payload.truncated)).toBe(true);
  expect(Buffer.byteLength(JSON.stringify(previews))).toBeLessThan(256 * 1024);
  for (let index = 0; index < 25; index++) store.addHostItem(taskId, null, 'system_notice', { detail: '页'.repeat(6000) });
  const snapshot = svc.snapshot(taskId);
  expect(snapshot.historyCursor).toEqual(expect.any(String));
  const page = svc.history(taskId, snapshot.historyCursor!);
  expect(page.items.at(-1)?.ordinal).toBe(snapshot.items[0].ordinal - 1);
  expect(() => svc.history(other, snapshot.historyCursor!)).toThrow('历史游标无效');
});

describe('目标与插话', () => {
  it('Codex 目标：设定后原生自行开出的回合按系统来源记录并计轮；停止键暂停目标；清除', async () => {
    const { svc, insts, db } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.goal(taskId, { kind: 'set', objective: '让测试全部通过' });
    expect(insts[0].goals).toEqual([{ kind: 'set', objective: '让测试全部通过' }]);
    expect(svc.snapshot(taskId).goal).toMatchObject({ objective: '让测试全部通过', status: 'active', revision: 1 });
    insts[0].emit({ type: 'turn.started', nativeTurnId: 'auto-1', clientInputId: '' });
    insts[0].emit({ type: 'item.completed', nativeItemId: 'm', itemType: 'agentMessage', payload: { id: 'm', type: 'agentMessage', text: '第 1 轮' } });
    expect(db.prepare("SELECT source_kind,status FROM agent_turns").get()).toEqual({ source_kind: 'system', status: 'started' });
    expect(db.prepare("SELECT turn_id IS NOT NULL AS t FROM agent_items WHERE type='assistant_message'").get()).toEqual({ t: 1 });
    expect(svc.snapshot(taskId).goal?.turns).toBe(1);
    await svc.stop(taskId);
    expect(insts[0].goals.at(-1)).toEqual({ kind: 'pause' });
    expect(svc.snapshot(taskId).goal).toMatchObject({ status: 'paused', pausedReason: 'user' });
    await svc.goal(taskId, { kind: 'clear' });
    expect(svc.snapshot(taskId).goal).toBeNull();
  });
  it('目标续跑的回合进行中，用户新输入排队而不是记未知；续跑结束后发出', async () => {
    const { svc, insts, db } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.goal(taskId, { kind: 'set', objective: 'x' });
    insts[0].emit({ type: 'turn.started', nativeTurnId: 'auto-1', clientInputId: '' });
    const r = await svc.submit(taskId, { clientInputId: id(9), text: '新问题', expectedSelectionRevision: 1 });
    expect(r.status).toBe('queued');
    insts[0].emit({ type: 'turn.completed', nativeTurnId: 'auto-1', status: 'completed' });
    await until(() => insts[0].turns.length === 1);
    expect(insts[0].turns[0].text).toBe('新问题');
    expect(db.prepare("SELECT status FROM agent_turns WHERE client_input_id=?").get(id(9))).toEqual({ status: 'started' });
  });
  it('驱动在发送前拒绝时放回排队', async () => {
    const { svc, insts, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    insts[0].startTurn = async () => { throw new DriverError('STATE', '上一轮尚未结束'); };
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 });
    await until(() => store.events(taskId, 0, 128).some(e => e.type === 'turn.requeued'));
    expect(svc.snapshot(taskId).queued.map(q => q.text)).toEqual(['b']);
  });
  it('Claude 目标以 /goal 文字发送，不能暂停', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.goal(taskId, { kind: 'set', objective: '修完断言' });
    await until(() => insts[0]?.turns.length === 1);
    expect(insts[0].turns[0].text).toBe('/goal 修完断言');
    // 原生确认前只显示等待确认，不预写目标（复核 CR14）
    expect(svc.snapshot(taskId).goal).toBeNull();
    expect(svc.snapshot(taskId).goalPending).toMatchObject({ kind: 'set', objective: '修完断言' });
    insts[0].emit({ type: 'goal', objective: '修完断言', status: 'active' });
    expect(svc.snapshot(taskId).goal).toMatchObject({ objective: '修完断言', status: 'active' });
    expect(svc.snapshot(taskId).goalPending).toBeNull();
    await expect(svc.goal(taskId, { kind: 'pause' })).rejects.toThrow('不能暂停');
  });
  it('requires the current Gemini session to advertise its native goal command', async () => {
    const { svc, insts, runs } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'Gemini', profileId: 'gemini', tier: 'ask' });
    await expect(svc.goal(taskId, { kind: 'set', objective: '核对结果' })).rejects.toThrow('没有公布目标命令');
    expect(insts[0].turns).toHaveLength(0);
    expect(svc.snapshot(taskId)).toMatchObject({ run: { goal: false }, goal: null, goalPending: null });
    await runs.closeAll();
  });

  it('queues Gemini clear before interrupting, then clears the native goal before dispatching ordinary queued input', async () => {
    const { svc, insts, runs } = setup({ publishesGoal: true });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'Gemini', profileId: 'gemini', tier: 'ask' });
    const objective = '查完两项后核对结果';
    await svc.goal(taskId, { kind: 'set', objective });
    const native = insts[0];
    await until(() => native.turns.length === 1 && !svc.isDispatching(taskId));
    expect(native.turns[0]).toMatchObject({ text: '/goal ' + objective, goal: { kind: 'set', objective } });
    expect(svc.snapshot(taskId).goalPending).toMatchObject({ kind: 'set', queued: false });
    native.emit({ type: 'goal', status: 'active', objective });
    expect(svc.list()[0]).toMatchObject({ goalRunning: true });
    const ordinary = await svc.submit(taskId, { clientInputId: id(519), text: '以后再查第三项', expectedSelectionRevision: 1 });
    expect(ordinary.status).toBe('queued');
    const cleared = await svc.goal(taskId, { kind: 'clear' });
    expect(cleared).toMatchObject({ status: 'queued' });
    expect(native.interrupts).toBe(1);
    await until(() => native.turns.length === 2 && !svc.isDispatching(taskId));
    expect(native.turns[1].goal?.kind).toBe('clear');
    expect(svc.snapshot(taskId)).toMatchObject({ goal: { status: 'active' }, goalPending: { kind: 'clear' } });
    native.emit({ type: 'goal', objective: null, status: 'cleared' });
    native.finish();
    await until(() => native.turns.length === 3);
    expect(native.turns[2]).toMatchObject({ text: '以后再查第三项', clientInputId: id(519) });
    expect(svc.snapshot(taskId)).toMatchObject({ goal: null, goalPending: null });
    native.finish();
    await runs.closeAll();
  });

  it('recovers the confirmed Gemini objective when the same native session opens again', async () => {
    const { svc, store, insts, runs } = setup({ publishesGoal: true, distinctNativeIds: true });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'Resume Gemini', profileId: 'gemini', tier: 'ask' });
    const objective = '恢复已确认的检查目标';
    await svc.goal(taskId, { kind: 'set', objective });
    await until(() => insts[0]?.turns.length === 1 && !svc.isDispatching(taskId));
    insts[0].emit({ type: 'goal', status: 'active', objective });
    insts[0].finish();
    const goal = store.goal(taskId);
    expect(goal).toMatchObject({ objective, status: 'active', turns: 1 });
    expect(svc.list()[0].goalRunning).toBe(false);
    await runs.close(runs.runForTask(taskId)!.runId);

    await svc.submit(taskId, { clientInputId: id(520), text: '继续检查', expectedSelectionRevision: 1 });
    await until(() => insts[1]?.turns.length === 1 && !svc.isDispatching(taskId));
    expect(insts[1].opened).toMatchObject({ resumeNativeId: insts[0].newNativeId, resumedGoal: objective });
    expect(store.goal(taskId)).toMatchObject({ bindingId: goal?.bindingId, objective, status: 'active', turns: 2 });
    insts[1].finish();
    await runs.closeAll();
  });

  it('A69: a Claude /goal turn that ends without a recognised reply shows the goal state as unknown (D06-66)', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.goal(taskId, { kind: 'set', objective: '修完断言' });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    expect(svc.snapshot(taskId).goal).toBeNull();
    expect(svc.snapshot(taskId).goalPending).toBeNull();
    expect(svc.snapshot(taskId).goalUnknown).toMatchObject({ kind: 'set', objective: '修完断言' });
    // A later recognised goal event replaces the unknown state.
    insts[0].emit({ type: 'goal', objective: '修完断言', status: 'active' });
    expect(svc.snapshot(taskId).goalUnknown).toBeNull();
  });
  it('插话：支持的版本并入当前回合；被原生拒绝则保留排队并说明原因', async () => {
    const { svc, insts, db } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    expect(svc.snapshot(taskId).run?.steer).toBe(true);
    const s = await svc.submit(taskId, { clientInputId: id(2), text: '顺便看下 b', expectedSelectionRevision: 1, mode: 'steer' });
    expect(s.status).toBe('steered');
    expect(insts[0].steers.map(x => x.text)).toEqual(['顺便看下 b']);
    insts[0].steerFails = true;
    const q = await svc.submit(taskId, { clientInputId: id(3), text: 'c', expectedSelectionRevision: 1, mode: 'steer' });
    expect(q).toMatchObject({ status: 'queued', steerRefused: expect.stringContaining('插话未被接受') });
    insts[0].finish();
    expect(db.prepare("SELECT status FROM agent_turns WHERE client_input_id=?").get(id(2))).toEqual({ status: 'completed' });
    await until(() => insts[0].turns.length === 2);
    expect(insts[0].turns[1].text).toBe('c');
  });
});

describe('附件随输入冻结', () => {
  it('A18 reports an image not sent to the frozen text-only model and preserves its original bytes', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-a18-input-')));
    try {
      const cwd = join(root, 'work'), userData = join(root, 'user-data'), path = join(root, 'synth.png');
      mkdirSync(cwd); mkdirSync(userData); writeFileSync(path, 'fixture bytes');
      const { svc, store, insts } = setup({ userData, launchModel: 'text-only', modelsWithoutImageInput: new Set(['text-only']) });
      const { taskId } = svc.create({ projectId: null, dirId: null, cwd, title: 'modalities', profileId: 'cx', tier: 'ask' });
      const picture = svc.prepareAttachment(taskId, null, { sourcePath: path, name: 'synth.png' });
      const first = await svc.submit(taskId, { clientInputId: id(11), text: 'Use this if you can', attachments: [picture], expectedSelectionRevision: 1 });
      await until(() => store.items(taskId).some(item => item.payload.code === 'modelDoesNotAcceptImages'));
      expect(insts[0].turns[0]).toMatchObject({ model: 'text-only', images: [], text: expect.stringContaining('未发送图像内容') });
      expect(insts[0].turns[0].text).not.toContain('已附上');
      expect(store.items(taskId).filter(item => item.payload.code === 'modelDoesNotAcceptImages')).toEqual([expect.objectContaining({ turnId: first.turnId })]);
      expect(readFileSync(picture.storedPath!, 'utf8')).toBe('fixture bytes');
      insts[0].finish();

      const updated = svc.setSelection(taskId, { model: 'with-images' }, 1);
      expect(updated.ok).toBe(true);
      await svc.submit(taskId, { clientInputId: id(12), text: 'Look again', attachments: [picture], expectedSelectionRevision: updated.revision });
      await until(() => insts[0].turns.length === 2);
      expect(insts[0].turns[1]).toMatchObject({ model: 'with-images', images: [{ path: picture.storedPath, mime: 'image/png' }], text: expect.stringContaining('已附上') });
      expect(store.items(taskId).filter(item => item.payload.code === 'modelDoesNotAcceptImages')).toHaveLength(1);
      insts[0].finish();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it('排队的输入保留自己的附件；执行器收到注明附件的文字与图片路径', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-tsa-'))), cwd = join(root, 'w'), ud = join(root, 'ud');
    mkdirSync(cwd); mkdirSync(ud); writeFileSync(join(cwd, 'a.ts'), 'x'); writeFileSync(join(root, 'pic.png'), 'png');
    const { svc, insts } = setup({ userData: ud });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd, title: 't', profileId: 'cx', tier: 'ask' });
    const ref = svc.prepareAttachment(taskId, null, { name: 'a.ts', sourcePath: join(cwd, 'a.ts') });
    const pic = svc.prepareAttachment(taskId, null, { name: 'pic.png', sourcePath: join(root, 'pic.png') });
    await svc.submit(taskId, { clientInputId: id(1), text: '先看这个', expectedSelectionRevision: 1, attachments: [ref] });
    await until(() => insts[0]?.turns.length === 1);
    await svc.submit(taskId, { clientInputId: id(2), text: '再看图', expectedSelectionRevision: 1, attachments: [pic] });
    expect(insts[0].turns[0].text).toBe('先看这个\n\n附件：\n- 项目文件：a.ts');
    expect(insts[0].turns[0].images).toEqual([]);
    insts[0].finish();
    await until(() => insts[0].turns.length === 2);
    expect(insts[0].turns[1].text).toBe('再看图\n\n附件：\n- 图片：pic.png（已附上）');
    expect(insts[0].turns[1].images).toEqual([{ path: pic.storedPath, mime: 'image/png' }]);
    await expect(svc.submit(taskId, { clientInputId: id(3), text: 'x', expectedSelectionRevision: 1, attachments: [{ ...ref, relativePath: '../pic.png' }] })).rejects.toThrow('附件已不在项目内');
  });
});

describe('输入框命令', () => {
  it('Codex compact／review 走协议；Claude 命令作为文字发送；Codex 未公布的命令拒绝', async () => {
    const { svc, insts } = setup();
    const cx = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' }).taskId;
    await svc.command(cx, 'review');
    expect(insts[0].commands).toEqual(['review']);
    await expect(svc.command(cx, 'init')).rejects.toThrow('没有公布 /init');
    const cc = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' }).taskId;
    await svc.command(cc, 'compact');
    await until(() => insts[1]?.turns.length === 1);
    expect(insts[1].turns[0].text).toBe('/compact');
    await expect(svc.command(cc, 'bad name')).rejects.toThrow('命令无效');
  });
});

it('previews a saved draft and reads the original image from its own message after the project file changes', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-image-preview-')));
  const cwd = join(root, 'project'), userData = join(root, 'data');
  mkdirSync(cwd); mkdirSync(userData);
  const { svc, runs } = setup({ userData });
  const create = (title: string) => svc.create({ projectId: null, dirId: null, cwd, title, profileId: 'cx', tier: 'ask' }).taskId;
  const taskId = create('image owner'), other = create('other task');
  const photo = join(cwd, 'shot.png');
  const original = Buffer.alloc(120 * 1024, 42);
  writeFileSync(photo, original);
  try {
    const attachment = svc.prepareAttachment(taskId, null, { name: 'shot.png', sourcePath: photo });
    const draft = { kind: 'draft', attachmentId: attachment.id } as const;
    svc.saveDraft(taskId, { text: 'saved', attachments: [attachment] }, 0);
    const firstDraft = await svc.attachmentImage(taskId, draft, 0);
    expect(firstDraft).toMatchObject({ mime: 'image/png', totalBytes: original.length });
    expect(JSON.stringify(firstDraft).length).toBeLessThan(128 * 1024);

    const { turnId } = await svc.submit(taskId, { clientInputId: id(1), text: 'image', expectedSelectionRevision: 1, attachments: [attachment] });
    writeFileSync(photo, 'changed after send');
    await expect(svc.attachmentImage(taskId, draft, firstDraft.next, firstDraft.revision)).rejects.toThrow('图片内容已变化');
    const message = { kind: 'message', turnId, index: 0 } as const;
    const first = await svc.attachmentImage(taskId, message, 0);
    const second = await svc.attachmentImage(taskId, message, first.next, first.revision);
    expect(Buffer.concat([Buffer.from(first.base64, 'base64'), Buffer.from(second.base64, 'base64')])).toEqual(original);
    await expect(svc.attachmentImage(other, message, 0)).rejects.toThrow('图片附件不可用');
    await expect(svc.attachmentImage(taskId, { ...message, index: 5 }, 0)).rejects.toThrow('图片附件不可用');
  } finally {
    await runs.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});

it('resolves same-name attachment references and copies from the exact historical turn', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-file-preview-')));
  const cwd = join(root, 'project'), userData = join(root, 'data');
  mkdirSync(cwd); mkdirSync(userData);
  const { svc, store } = setup({ userData });
  const create = () => svc.create({ projectId: null, dirId: null, cwd, title: 'File preview', profileId: 'cx', tier: 'ask' }).taskId;
  const taskId = create();
  try {
    const internal = join(cwd, 'note.md'), outside = join(root, 'note.md');
    writeFileSync(internal, 'PROJECT_NOTE');
    writeFileSync(outside, 'COPIED_NOTE');
    const attachments = [internal, outside].map(sourcePath => svc.prepareAttachment(taskId, null, {
      name: 'note.md', mime: 'text/markdown', sourcePath,
    }));
    const longName = `${'long-note-'.repeat(16)}.md`;
    const longCopy = svc.prepareAttachment(taskId, null, { name: longName, dataBase64: Buffer.from('LONG_NOTE').toString('base64') });
    expect(longCopy.name).toBe(`${longName.slice(0, 117)}.md`);
    const { turn: { turn_id: turnId } } = store.acceptTurn({ taskId, clientInputId: id(831), text: 'Notes', sourceKind: 'user', attachments: [...attachments, longCopy] });
    const project = await svc.messageAttachmentFile(taskId, turnId, 0);
    expect(project).toEqual({ root: cwd, relativePath: 'note.md', mimeType: 'text/markdown' });
    const copy = await svc.messageAttachmentFile(taskId, turnId, 1);
    expect(copy.root).toBe(join(userData, 'agent-attachments', attachments[1].id));
    expect(readFileSync(join(copy.root, copy.relativePath), 'utf8')).toBe('COPIED_NOTE');
    await expect(svc.messageAttachmentFile(create(), turnId, 0)).rejects.toThrow('文件附件不可用');
    await expect(svc.messageAttachmentFile(taskId, turnId, 2)).resolves.toMatchObject({ relativePath: longCopy.name });
    await expect(svc.messageAttachmentFile(taskId, turnId, 3)).rejects.toThrow('文件附件不可用');
    rmSync(internal);
    await expect(svc.messageAttachmentFile(taskId, turnId, 0)).rejects.toThrow('附件文件已找不到');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('复核 1620 回归', () => {
  it('CR01：排队期间项目内图片被换成指向根外的软链，派发仍只读接受时冻结的副本', async () => {
    const { rmSync, symlinkSync, readFileSync } = await import('node:fs');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-cr01-'))), cwd = join(root, 'w'), ud = join(root, 'ud');
    mkdirSync(cwd); mkdirSync(ud); writeFileSync(join(cwd, 'shot.png'), 'LEGIT'); writeFileSync(join(root, 'secret.png'), 'REVIEW_SYNTHETIC_OUTSIDE_SECRET');
    const { svc, insts } = setup({ userData: ud });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd, title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const att = svc.prepareAttachment(taskId, null, { name: 'shot.png', sourcePath: join(cwd, 'shot.png') });
    await svc.submit(taskId, { clientInputId: id(2), text: '看图', expectedSelectionRevision: 1, attachments: [att] });
    rmSync(join(cwd, 'shot.png')); symlinkSync(join(root, 'secret.png'), join(cwd, 'shot.png'));
    insts[0].finish();
    await until(() => insts[0].turns.length === 2);
    const img = insts[0].turns[1].images![0];
    expect(img.path.startsWith(join(ud, 'agent-attachments'))).toBe(true);
    expect(readFileSync(img.path, 'utf8')).toBe('LEGIT');
  });
  it('CR02：插话超时（可能已被接受）记未知，原回合结束后不再重发', async () => {
    const { svc, insts, db } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].steer = async () => { throw new DriverError('TIMEOUT', 'turn/steer 超时'); };
    const r = await svc.submit(taskId, { clientInputId: id(2), text: 'perform side effect', expectedSelectionRevision: 1, mode: 'steer' });
    expect(r.status).toBe('unknown');
    insts[0].finish();
    await new Promise(res => setTimeout(res, 30));
    expect(insts[0].turns.map(t => t.text)).toEqual(['a']);
    expect(db.prepare('SELECT status FROM agent_turns WHERE client_input_id=?').get(id(2))).toEqual({ status: 'unknown' });
  });
  it('CR03：档案解析期间按停止，解析完成后不创建运行或派发输入', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { svc, insts } = setup({ openGate: gate });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'do work', expectedSelectionRevision: 1 });
    expect(await svc.stop(taskId)).toEqual({ stopped: true });
    release();
    await until(() => !svc.isDispatching(taskId));
    expect(insts).toHaveLength(0);
    expect(svc.snapshot(taskId).queued.map(q => q.text)).toEqual(['do work']);
  });
  it('CR03：已经打开的运行按停止后，迟到的目标自行回合立即中断', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'do work', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    expect(await svc.stop(taskId)).toEqual({ stopped: true });
    const interrupts = insts[0].interrupts;
    insts[0].emit({ type: 'turn.started', nativeTurnId: 'late-auto', clientInputId: '' });
    await until(() => insts[0].interrupts === interrupts + 1);
  });
  it('CR04：关闭后进程未退出则保留占用（stopping），同任务不能开新运行', async () => {
    const { svc, insts, db, runs } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    insts[0].noExitOnClose = true;
    const run = runs.runForTask(taskId)!;
    await runs.close(run.runId);
    expect(db.prepare('SELECT state FROM capability_runs WHERE run_id=?').get(run.runId)).toEqual({ state: 'stopping' });
    expect(runs.closingForTask(taskId)?.runId).toBe(run.runId);
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 });
    await new Promise(res => setTimeout(res, 30));
    expect(insts).toHaveLength(1);
    expect(svc.snapshot(taskId).queued.map(q => q.text)).toEqual(['b']);
    insts[0].emit({ type: 'exit', code: 0, signal: null });
    await until(() => insts.length === 2 && insts[1].turns.length === 1);
  });
  it('CR06：超过 32 KiB 的输入原样送达；超过 256 KB 接受前拒绝', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const big = '中'.repeat(12_000);
    await svc.submit(taskId, { clientInputId: id(1), text: big, expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    expect(insts[0].turns[0].text).toBe(big);
    const item = svc.snapshot(taskId).items.find(i => i.type === 'user_message')!;
    expect(item.payload.truncated).toBe(true);
    let off = 0, body = '';
    for (;;) { const c = svc.itemBody(taskId, item.itemId, off); body += c.chunk; off = c.next; if (c.done) break; }
    expect(JSON.parse(body).text).toBe(big);
    await expect(svc.submit(taskId, { clientInputId: id(2), text: 'x'.repeat(256 * 1024 + 1), expectedSelectionRevision: 1 })).rejects.toThrow('超过 256 KB');
  });
  it.each([
    ['cc', 'full', true], ['cd', 'auto', true], ['cd', 'full', false],
  ] as const)('applies or defers the selected permission for %s to %s', async (profileId, tier, applied) => {
    const { svc, insts, runs } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId, tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'first', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1 && !svc.isDispatching(taskId));
    const driver = insts[0];
    driver.setTurnTier = vi.fn(async () => applied);
    expect(svc.setSelection(taskId, { tier }, 0).ok).toBe(false);
    expect(driver.setTurnTier).not.toHaveBeenCalled();
    expect(svc.setSelection(taskId, { tier }, 1).ok).toBe(true);
    await until(() => !!vi.mocked(driver.setTurnTier!).mock.calls.length);
    await until(() => !svc.snapshot(taskId).run?.tierChanging);
    expect(driver.setTurnTier).toHaveBeenCalledWith('ask', tier);
    expect(svc.snapshot(taskId).run?.tier).toBe(applied ? tier : 'ask');
    expect(svc.snapshot(taskId).selection.tier).toBe(tier);
    driver.finish();
    await svc.submit(taskId, { clientInputId: id(2), text: 'second', expectedSelectionRevision: 2 });
    await until(() => insts[0]?.turns.length === 2 && !svc.isDispatching(taskId));
    expect(insts[0].turns[1].tier).toBe(tier);
    await runs.closeAll();
  });
  it('CR12：Claude 未切换生效时，下一轮重开并恢复原会话', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    svc.setSelection(taskId, { tier: 'full' }, 1);
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 2 });
    await until(() => insts.length === 2 && insts[1].turns.length === 1);
    expect(insts[1].opened).toMatchObject({ tier: 'full', resumeNativeId: 'n1' });
  });
  it('CR15：低于最低版本的可选能力被冻结为不可用，目标命令拒绝', async () => {
    const { svc } = setup({ version: '0.167.1' });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await expect(svc.goal(taskId, { kind: 'set', objective: 'x' })).rejects.toThrow(/目标不可用：版本低于最低已验证版本 0.169.0/);
    expect(svc.snapshot(taskId).run).toMatchObject({ goal: false, steer: false });
  });
  it('CR17／CR18：启动失败原因进时间线；额度受限与普通失败分开', async () => {
    const a = setup({ failOpen: true });
    const t1 = a.svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' }).taskId;
    await a.svc.submit(t1, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => a.svc.status(t1) === 'failed');
    expect(a.svc.snapshot(t1).items.find(i => i.type === 'error')?.payload).toMatchObject({ message: '找不到 codex' });
    const b = setup();
    const t2 = b.svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' }).taskId;
    await b.svc.submit(t2, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => b.insts[0]?.turns.length === 1);
    b.insts[0].emit({ type: 'native', name: 'error', payload: { turnId: 'nt-1', error: { message: 'You have hit your usage limit', codexErrorInfo: 'usageLimitExceeded' } } });
    b.insts[0].emit({ type: 'turn.completed', nativeTurnId: 'nt-1', status: 'failed', error: 'usage' });
    await until(() => b.svc.status(t2) === 'limited');
  });
});

describe('容量与分页（技术方案 §3.1）', () => {
  it('任务状态不重复物化完整回合历史，快照仍保留原回合及同时间顺序', () => {
    const { svc, store, db } = setup();
    const insert = db.prepare('INSERT INTO agent_turns(turn_id,task_id,client_input_id,input_ref,source_kind,status,accepted_at) VALUES(?,?,?,?,?,?,?)');
    const expected = new Map<string, string>();
    const make = (title: string, states: string[], status: string) => {
      const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title, profileId: 'cx', tier: 'ask' });
      states.forEach((state, i) => insert.run(taskId + '-' + i, taskId, id(i), '{"text":"synthetic"}', 'user', state, '2026-01-01T00:00:00.000Z'));
      expected.set(taskId, status);
      return taskId;
    };
    make('idle', [], 'idle');
    make('canceled', ['canceled'], 'idle');
    const completed = make('last completed', ['failed','completed','canceled'], 'completed');
    const failed = make('last failed', ['completed','failed'], 'failed');
    make('interrupted', ['completed','interrupted','canceled'], 'stopped');
    make('unknown', ['unknown'], 'failed');
    make('accepted', ['accepted','completed'], 'working');
    make('dispatching', ['dispatching','completed'], 'working');
    make('started', ['started','canceled'], 'working');
    const turns = vi.spyOn(store, 'turns');
    try {
      expect(new Map(svc.list().map(task => [task.taskId, task.status]))).toEqual(expected);
      expect(turns).not.toHaveBeenCalled();
      const snap = svc.snapshot(completed);
      expect(snap.status).toBe('completed');
      expect(snap.turns.map(turn => turn.status)).toEqual(['failed','completed','canceled']);
      expect(turns).toHaveBeenCalledTimes(1);
      db.prepare("UPDATE agent_turns SET status='completed' WHERE turn_id=?").run(failed + '-1');
      expect(svc.status(failed)).toBe('completed'); // live ledger, not cached state
    } finally { turns.mockRestore(); }
  });

  it('事件追加复用固定语句，跨任务水位、嵌套提交和回滚通知保持原合同', () => {
    const { svc, store, db } = setup();
    const prepares = vi.spyOn(db, 'prepare');
    const seen: Array<{ taskId: string; seq: number; type: string }> = [];
    const unsubscribe = store.subscribe(({ taskId, seq, type }) => seen.push({ taskId, seq, type }));
    try {
      const task = () => svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'fixture', profileId: 'cx', tier: 'ask' }).taskId;
      const a = task(), b = task();
      seen.length = 0;
      store.tx(emit => {
        emit(a, 'fixture.outer', {});
        store.tx(nested => { nested(a, 'fixture.inner', {}); nested(b, 'fixture.inner', {}); });
        expect(seen).toEqual([]);
      });
      expect(seen).toEqual([
        { taskId: a, seq: 2, type: 'fixture.outer' },
        { taskId: a, seq: 3, type: 'fixture.inner' },
        { taskId: b, seq: 2, type: 'fixture.inner' },
      ]);
      expect(() => store.tx(emit => { emit(a, 'fixture.rollback', {}); throw new Error('rollback fixture'); })).toThrow('rollback fixture');
      expect(store.watermark(a)).toBe(3);
      expect(seen).toHaveLength(3);
      store.tx(emit => emit(a, 'fixture.after', {}));
      expect(seen.at(-1)).toEqual({ taskId: a, seq: 4, type: 'fixture.after' });
      expect(db.prepare('SELECT task_id,seq FROM agent_events ORDER BY task_id,seq').all()).toHaveLength(6);
      expect(prepares.mock.calls.filter(([sql]) => sql === 'SELECT COALESCE(MAX(seq),0)+1 AS seq FROM agent_events WHERE task_id=?')).toHaveLength(1);
      expect(prepares.mock.calls.filter(([sql]) => sql === 'INSERT INTO agent_events(task_id,seq,event_type,item_id,revision,payload,created_at) VALUES(?,?,?,?,?,?,?)')).toHaveLength(1);
    } finally { unsubscribe(); prepares.mockRestore(); }
  });

  it('任务状态仅解码最近 200 条可见历史中属于末轮的错误，保留原边界与真值语义', () => {
    const { svc, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const first = store.acceptTurn({ taskId, clientInputId: id(1), text: 'first', sourceKind: 'user' }).turn.turn_id;
    store.addHostItem(taskId, first, 'error', { limited: { kind: 'quota' }, detail: 'unrelated-status-body' });
    store.endTurn(first, 'failed');
    const last = store.acceptTurn({ taskId, clientInputId: id(2), text: 'last', sourceKind: 'user' }).turn.turn_id;
    store.endTurn(last, 'completed');
    store.addHostItem(taskId, last, 'error', { limited: false });
    store.addHostItem(taskId, last, 'system_notice', { detail: 'unrelated-status-body' });

    const parse = vi.spyOn(JSON, 'parse');
    try {
      expect(svc.status(taskId)).toBe('completed');
      expect(parse.mock.calls.filter(([body]) => typeof body === 'string' && body.includes('unrelated-status-body'))).toHaveLength(0);
    } finally { parse.mockRestore(); }

    // 与旧实现相同：先按可见条目位次取最近 200 条，再限定最后一轮和 error。
    store.addHostItem(taskId, last, 'error', { limited: {} }); // JS 中空对象仍是真值。
    for (let i = 0; i < 199; i++) store.addHostItem(taskId, last, 'system_notice', { detail: `n${i}` });
    store.upsertItem({ taskId, turnId: last, runId: null, nativeKey: 'child-only', type: 'subagent_message', payload: { text: 'child' }, terminalState: 'completed' });
    expect(svc.status(taskId)).toBe('limited');
    store.addHostItem(taskId, last, 'system_notice', { detail: 'moves error beyond 200' });
    expect(svc.status(taskId)).toBe('completed');
  });

  it('快照按字节预算停止读取历史正文，不预先解码未返回的旧条目', () => {
    const { svc, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const marker = 'm16-snapshot-history-body:';
    for (let i = 0; i < 80; i++) {
      store.addHostItem(taskId, null, 'system_notice', { detail: marker + i + ':' + 'a'.repeat(16 * 1024) });
    }
    const parse = vi.spyOn(JSON, 'parse');
    let snap!: ReturnType<typeof svc.snapshot>;
    try {
      snap = svc.snapshot(taskId);
      expect(snap.hasOlder).toBe(true);
      expect(snap.items.at(-1)?.ordinal).toBe(80);
      expect(snap.items.length).toBeLessThan(80);
      expect(parse.mock.calls.filter(([body]) => typeof body === 'string' && body.includes(marker)).length).toBeLessThanOrEqual(snap.items.length + 1);
    } finally { parse.mockRestore(); }
    expect(snap.items).toEqual(store.items(taskId).slice(-snap.items.length));
    const older = svc.history(taskId, snap.items[0].ordinal);
    expect(older.items.at(-1)?.ordinal).toBe(snap.items[0].ordinal - 1);
  });

  it('快照只带最近 2000 条，更早的按页读取', () => {
    const { svc, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    for (let i = 0; i < 2105; i++) store.addHostItem(taskId, null, 'system_notice', { detail: `n${i}` });
    const snap = svc.snapshot(taskId);
    // 先受字节预算约束（IPC 响应 256 KiB），条数上限 2000 作为第二道边界
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThan(256 * 1024);
    expect(snap.items.at(-1)!.ordinal).toBe(2105);
    expect(snap.hasOlder).toBe(true);
    const first = snap.items[0].ordinal;
    const page = svc.history(taskId, first);
    expect(page.items.at(-1)!.ordinal).toBe(first - 1);
    expect(page.items.length).toBeLessThanOrEqual(100);
    expect(svc.history(taskId, 1)).toMatchObject({ items: [], hasOlder: false });
  });
});

describe('复核 1755 回归', () => {
  it('NR01：同一输入标识重试不重新冻结，已接受的图片副本不变', async () => {
    const { readFileSync } = await import('node:fs');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-nr01-'))), cwd = join(root, 'w'), ud = join(root, 'ud');
    mkdirSync(cwd); mkdirSync(ud); writeFileSync(join(cwd, 'p.png'), 'IMAGE_A');
    const { svc, insts, db } = setup({ userData: ud });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd, title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const att = svc.prepareAttachment(taskId, null, { name: 'p.png', sourcePath: join(cwd, 'p.png') });
    const first = await svc.submit(taskId, { clientInputId: id(2), text: '图', expectedSelectionRevision: 1, attachments: [att] });
    const stored = JSON.parse((db.prepare('SELECT input_ref FROM agent_turns WHERE turn_id=?').get(first.turnId) as any).input_ref).attachments[0].storedPath;
    writeFileSync(join(cwd, 'p.png'), 'IMAGE_B');
    const again = await svc.submit(taskId, { clientInputId: id(2), text: '图', expectedSelectionRevision: 1, attachments: [att] });
    expect(again).toMatchObject({ duplicate: true, turnId: first.turnId });
    expect(readFileSync(stored, 'utf8')).toBe('IMAGE_A');
  });
  it('NR03：上一轮先结束、start 回执后到时，排队输入仍自动发出且只发一次', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'first', expectedSelectionRevision: 1 });
    await until(() => insts.length === 1);
    const inst = insts[0];
    let release!: () => void;
    inst.startTurn = async (t) => { inst.turns.push(t); const nid = `nt-${inst.turns.length}`; inst.emit({ type: 'turn.started', nativeTurnId: nid, clientInputId: t.clientInputId }); if (inst.turns.length === 1) { await new Promise<void>(r => { release = r; }); } return { nativeTurnId: nid }; };
    await svc.submit(taskId, { clientInputId: id(2), text: 'override', expectedSelectionRevision: 1 }).catch(() => {});
    // 重新排一次：第一条 start 回执挂起期间原生先完成，第二条已排队
    await until(() => inst.turns.length >= 1 && !!release);
    inst.emit({ type: 'turn.completed', nativeTurnId: 'nt-1', status: 'completed' });
    release();
    await until(() => inst.turns.length === 2);
    await new Promise(r => setTimeout(r, 30));
    expect(inst.turns.map(t => t.text)).toEqual(['first', 'override']);
  });
  it('NR04：执行器实例不可再用时运行退役，下一条输入恢复会话后发出', async () => {
    const { svc, insts, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    insts[0].emit({ type: 'unusable', reason: 'SDK 流已结束' });
    await until(() => insts.length === 1 && svc.snapshot(taskId).run === null);
    expect(store.items(taskId).some(i => i.type === 'system_notice' && i.payload.code === 'runUnusable')).toBe(true);
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 });
    await until(() => insts.length === 2 && insts[1].turns.length === 1);
    expect(insts[1].opened?.resumeNativeId).toBe('n1');
  });
  it('NR05：指定 A→B→默认，恢复默认用档案默认模型而不是最初的显式选择', async () => {
    const { svc, insts } = setup({ launchModel: 'profile-default' });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask', model: 'opus' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1); insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
    svc.setSelection(taskId, { model: 'sonnet' }, 1);
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 2 });
    await until(() => insts[0].turns.length === 2); insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
    svc.setSelection(taskId, { model: null }, 2);
    await svc.submit(taskId, { clientInputId: id(3), text: 'c', expectedSelectionRevision: 3 });
    await until(() => insts[0].turns.length === 3);
    expect(insts[0].turns.map(t => t.model)).toEqual(['opus', 'sonnet', 'profile-default']);
  });
  it('NR06：40 KiB 计划完整保存，快照给预览并标截断，范围读取得到全文；快照与分页守字节上限', async () => {
    const { svc, insts, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    // 40 KiB 计划在快照里完整显示；批准时即使客户端交回被截短的入参，执行器收到的仍是宿主保存的完整原文
    const plan = 'P'.repeat(40 * 1024);
    insts[0].emit({ type: 'request', requestKey: '9', kind: 'plan_approval', payload: { tool: 'ExitPlanMode', input: { plan } } });
    const [req] = svc.snapshot(taskId).requests as any[];
    expect(req.detailTruncated).toBeUndefined();
    expect(req.payload.input.plan).toBe(plan);
    await svc.respond(taskId, req.requestId, req.revision, { behavior: 'allow', updatedInput: { plan: 'P'.repeat(100) } });
    expect(insts[0].responses.at(-1)).toEqual(['9', { behavior: 'allow', updatedInput: { plan } }]);
    // 超过 96 KiB 的请求：快照给预览并标截断，范围读取得到全文
    const huge = 'H'.repeat(120 * 1024);
    insts[0].emit({ type: 'request', requestKey: '10', kind: 'plan_approval', payload: { tool: 'ExitPlanMode', input: { plan: huge } } });
    const big = (svc.snapshot(taskId).requests as any[]).find(r => r.payload.input.plan.startsWith('H'));
    expect(big.detailTruncated).toBe(true);
    let off = 0, text = '';
    for (;;) { const c = svc.requestBody(taskId, big.requestId, off); text += c.chunk; off = c.next; if (c.done) break; }
    expect(JSON.parse(text).input.plan).toBe(huge);
    await svc.respond(taskId, big.requestId, big.revision, { behavior: 'deny', message: 'no' });
    insts[0].finish(); await until(() => svc.status(taskId) !== 'working' && svc.status(taskId) !== 'waiting');
    for (let i = 0; i < 2; i++) store.addHostItem(taskId, null, 'system_notice', { detail: 'x'.repeat(150 * 1024) });
    store.addHostItem(taskId, null, 'system_notice', { detail: 'y'.repeat(300 * 1024) });
    expect(Buffer.byteLength(JSON.stringify(svc.snapshot(taskId)))).toBeLessThan(256 * 1024);
    const last = svc.snapshot(taskId).items.at(-1)!;
    expect(last.payload).toMatchObject({ truncated: true });
    expect(Buffer.byteLength(JSON.stringify(svc.history(taskId, last.ordinal + 1)))).toBeLessThan(256 * 1024);
  });
  it('NR09：不能保证审批交还的 Codex 版本拒绝请求批准档位并写明原因', async () => {
    const { svc, store } = setup({ version: '0.167.1' });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => svc.status(taskId) === 'failed');
    expect(store.items(taskId).find(i => i.type === 'error')?.payload.message).toMatch(/请求批准档位不可用：版本低于最低已验证版本 0.169.0/);
  });
  it('NR12：附件来自其他目录时拒绝，不按新目录重新解释同名文件', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-nr12-'))), a = join(root, 'a'), b = join(root, 'b'), ud = join(root, 'ud');
    for (const d of [a, b, ud]) mkdirSync(d);
    writeFileSync(join(a, 'same.png'), 'PROJECT_A'); writeFileSync(join(b, 'same.png'), 'PROJECT_B');
    const { svc } = setup({ userData: ud });
    const att = svc.prepareAttachment(null, a, { name: 'same.png', sourcePath: join(a, 'same.png') });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: b, title: 't', profileId: 'cx', tier: 'ask' });
    await expect(svc.submit(taskId, { clientInputId: id(1), text: 'x', expectedSelectionRevision: 1, attachments: [att] })).rejects.toThrow('附件来自其他目录');
  });
});

describe('复核 2127 回归', () => {
  const unusableWithQueue = async () => {
    const env = setup();
    const { taskId } = env.svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await env.svc.submit(taskId, { clientInputId: id(1), text: 'first', expectedSelectionRevision: 1 });
    await until(() => env.insts[0]?.turns.length === 1);
    const first = env.insts[0]; first.noExitOnClose = true; first.finish();
    await until(() => env.svc.status(taskId) === 'completed');
    first.emit({ type: 'unusable', reason: 'stream ended' });
    await until(() => !!(env.runs as any).closingForTask(taskId));
    const queued = await env.svc.submit(taskId, { clientInputId: id(2), text: 'second', expectedSelectionRevision: 1 });
    await until(() => env.store.items(taskId).some(i => i.payload?.code === 'waitingPreviousRun'));
    return { ...env, taskId, first, queued };
  };
  it('FR01：等待旧运行退出期间按了停止，旧进程退出后排队输入仍保留，不自动发出', async () => {
    const { svc, store, insts, taskId, first, queued } = await unusableWithQueue();
    await svc.stop(taskId);
    first.emit({ type: 'exit', code: 0, signal: null });
    await new Promise(r => setTimeout(r, 30));
    expect(store.turn(queued.turnId)?.status).toBe('accepted');
    expect(insts).toHaveLength(1);
  });
  it('FR01：没有停止时，旧进程真实退出后排队输入自动发出', async () => {
    const { store, insts, first, queued } = await unusableWithQueue();
    first.emit({ type: 'exit', code: 0, signal: null });
    await until(() => insts.length === 2 && insts[1].turns.length === 1);
    expect(insts[1].turns[0].text).toBe('second');
    expect(store.turn(queued.turnId)?.status).not.toBe('accepted');
  });
  it('FR02：多个大请求、大草稿、中文正文分段、事件页与单个事件都按最终字节守上限', async () => {
    const { svc, insts, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    for (let k = 0; k < 3; k++) insts[0].emit({ type: 'request', requestKey: `p${k}`, kind: 'plan_approval', payload: { tool: 'ExitPlanMode', input: { plan: String(k).repeat(90 * 1024) } } });
    let snap = svc.snapshot(taskId) as any;
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThanOrEqual(256 * 1024);
    expect(snap.requests).toHaveLength(3);
    expect(snap.requests.some((r: any) => r.detailTruncated)).toBe(true);
    // 中文正文：每段不超过 128 KiB 字节，拼起来与原文一致
    const zh = '中文😀"\\'.repeat(40_000);
    insts[0].emit({ type: 'request', requestKey: 'zh', kind: 'plan_approval', payload: { tool: 'ExitPlanMode', input: { plan: zh } } });
    const zr = (svc.snapshot(taskId) as any).requests.find((r: any) => r.payload?.input?.plan?.startsWith?.('中') || r.bytes > 300_000);
    let off = 0, text = '';
    for (;;) { const c = svc.requestBody(taskId, zr.requestId, off); expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThanOrEqual(128 * 1024); text += c.chunk; if (c.done) break; off = c.next; }
    expect(JSON.parse(text).input.plan).toBe(zh);
    for (const r of store.pendingRequests(taskId)) store.retireRequest(r.requestId, 'user-stop');
    insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
    // 255 KiB 草稿＋20 KiB 消息：快照不超限、草稿不丢，可分段读回
    const draftText = 'D'.repeat(255 * 1024 - 64);
    svc.saveDraft(taskId, { text: draftText }, 0);
    store.addHostItem(taskId, null, 'system_notice', { detail: 'm'.repeat(20 * 1024) });
    snap = svc.snapshot(taskId);
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThanOrEqual(256 * 1024);
    expect(snap.draft.truncated).toBe(true);
    off = 0; text = '';
    for (;;) { const c = svc.draftBody(taskId, off); text += c.chunk; if (c.done) break; off = c.next; }
    expect(JSON.parse(text).text).toBe(draftText);
    // 事件页与单个事件
    const before = store.watermark(taskId);
    for (let k = 0; k < 20; k++) store.addHostItem(taskId, null, 'system_notice', { detail: String(k).repeat(20 * 1024) });
    const page = svc.events(taskId, before);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(256 * 1024);
    expect(page.every(e => Buffer.byteLength(JSON.stringify(e)) <= 32 * 1024)).toBe(true);
  });
  it('FR03：Codex 原生登录（档案无默认）下 默认→显式→默认，恢复默认时显式发出执行器默认模型', async () => {
    const { svc, insts } = setup({ nativeDefault: 'native-default' });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1); insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
    svc.setSelection(taskId, { model: 'explicit-other' }, 1);
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 2 });
    await until(() => insts[0].turns.length === 2); insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
    svc.setSelection(taskId, { model: null }, 2);
    await svc.submit(taskId, { clientInputId: id(3), text: 'c', expectedSelectionRevision: 3 });
    await until(() => insts[0].turns.length === 3);
    expect(insts[0].turns.map(t => t.model)).toEqual(['native-default', 'explicit-other', 'native-default']);
  });
  it('FR03：恢复的线程按需向执行器查询默认；查不到时拒绝并说明，不靠省略字段', async () => {
    for (const lazy of ['cfg-default', undefined]) {
      const { svc, insts, store } = setup({ lazyDefault: lazy });
      const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask', model: 'explicit' });
      await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
      await until(() => insts[0]?.turns.length === 1); insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
      svc.setSelection(taskId, { model: null }, 1);
      await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 2 });
      if (lazy) { await until(() => insts[0].turns.length === 2); expect(insts[0].turns[1].model).toBe('cfg-default'); }
      else { await until(() => svc.status(taskId) === 'failed'); expect(store.items(taskId).find(i => i.type === 'error')?.payload.message).toMatch('无法确定执行器默认模型'); expect(insts[0].turns).toHaveLength(1); }
    }
  });
  it('FR06：模型修订变化后重发同一输入仍返回原收据，新输入用旧修订仍拒绝', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const a = await svc.submit(taskId, { clientInputId: id(1), text: 'original', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    svc.setSelection(taskId, { model: 'other' }, 1);
    await expect(svc.submit(taskId, { clientInputId: id(1), text: 'original', expectedSelectionRevision: 1 })).resolves.toMatchObject({ duplicate: true, turnId: a.turnId });
    expect(insts[0].turns).toHaveLength(1);
    await expect(svc.submit(taskId, { clientInputId: id(2), text: 'new', expectedSelectionRevision: 1 })).rejects.toThrow('模型或权限已变化');
  });
  it('FR08：缺审批交还能力的 Codex 版本，/review 与普通发送同样拒绝；完全访问正常', async () => {
    const { svc, insts } = setup({ version: '0.167.1' });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await expect(svc.command(taskId, 'review')).rejects.toThrow(/请求批准档位不可用/);
    expect(insts[0]?.commands ?? []).toEqual([]);
    svc.setSelection(taskId, { tier: 'full' }, 1);
    await expect(svc.command(taskId, 'review')).rejects.toThrow('档位已变化');
    await svc.submit(taskId, { clientInputId: id(1), text: 'x', expectedSelectionRevision: 2 });
    await until(() => insts[0].turns.length === 1); insts[0].finish(); await until(() => svc.status(taskId) === 'completed');
    await expect(svc.command(taskId, 'review')).resolves.toEqual({ ok: true });
    expect(insts[0].commands).toEqual(['review']);
  });
});

describe('复核 2251 回归', () => {
  const firstTurnDone = async (env: ReturnType<typeof setup>, taskId: string, n = 0) => { await until(() => env.insts[n]?.turns.length >= 1); env.insts[n].finish(); await until(() => env.svc.status(taskId) === 'completed'); };
  it('SR01：恢复线程查询默认模型期间按停止，不再发出新输入', async () => {
    const env = setup();
    const { svc, insts, store, runs } = env;
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask', model: 'explicit' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await firstTurnDone(env, taskId);
    await runs.close(svc.snapshot(taskId).run!.runId);
    svc.setSelection(taskId, { model: null }, 1);
    let release!: (m: string) => void;
    const origCreate = (runs as any).deps.drivers.get('codex-app-server').create;
    (runs as any).deps.drivers.get('codex-app-server').create = () => { const i = origCreate(); i.defaultModel = () => new Promise<string>(r => { release = r; }); return i; };
    const queued = await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 2 });
    await until(() => !!release);
    await svc.stop(taskId);
    release('cfg-default');
    await new Promise(r => setTimeout(r, 30));
    expect(insts[1].turns).toHaveLength(0);
    expect(store.turn(queued.turnId)?.status).toBe('accepted');
  });
  it('SR01：启动解析期间按停止、随后才发现旧运行在退出，旧进程退出后仍不自动发出', async () => {
    let releaseLaunch!: () => void;
    const gate = new Promise<void>(r => { releaseLaunch = r; });
    const env = setup();
    const { svc, insts, store, runs } = env;
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await firstTurnDone(env, taskId);
    const first = insts[0]; first.noExitOnClose = true;
    // 第二条输入的启动解析挂起；期间旧运行变为不可用并开始退出，用户按停止
    const origResolve = (svc as any).d.resolveLaunch;
    (svc as any).d.resolveLaunch = async (i: any) => { await gate; return origResolve(i); };
    await runs.close(svc.snapshot(taskId).run!.runId);
    const queued = await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 });
    await svc.stop(taskId);
    releaseLaunch();
    await new Promise(r => setTimeout(r, 30));
    first.emit({ type: 'exit', code: 0, signal: null });
    await new Promise(r => setTimeout(r, 30));
    expect(insts).toHaveLength(1);
    expect(store.turn(queued.turnId)?.status).toBe('accepted');
  });
  it('SR02：上限内的文字与大量转义字符的草稿完整保存并逐字读回；超限明确拒绝且原草稿与修订不变', () => {
    const { svc, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    let rev = 0;
    for (const text of ['x'.repeat(256 * 1024), '"'.repeat(130 * 1024), '\u0001'.repeat(256 * 1024)]) {
      const r = svc.saveDraft(taskId, { text, attachments: [] }, rev) as any;
      expect(r.ok).toBe(true); rev = r.revision;
      let off = 0, body = '';
      for (;;) { const c = svc.draftBody(taskId, off, rev); body += c.chunk; if (c.done) break; off = c.next; }
      expect(JSON.parse(body).text).toBe(text);
    }
    const before = store.draft(taskId);
    expect(() => svc.saveDraft(taskId, { text: 'y'.repeat(256 * 1024 + 1) }, rev)).toThrow('草稿超过 256 KB');
    expect(store.draft(taskId)).toEqual(before);
  });
  it('SR02：旧版本截断写入的草稿如实标为受损，不当作空草稿', () => {
    const { svc, db } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    db.prepare('UPDATE agent_tasks SET draft_json=?, draft_revision=3 WHERE task_id=?').run(JSON.stringify({ truncated: true, bytes: 300000, sha256: 'ab', head: '{"text":"abc' }), taskId);
    expect(svc.snapshot(taskId).draft).toMatchObject({ damaged: true, revision: 3, draft: null });
    expect(() => svc.draftBody(taskId, 0)).toThrow('草稿已受损');
  });
  it('SR03：真正关闭后恢复同一绑定，默认选择下查执行器默认；查不到则拒绝且不发出', async () => {
    for (const lazy of ['cfg-default', undefined]) {
      for (const order of ['before', 'after'] as const) {
        const env = setup({ lazyDefault: lazy });
        const { svc, insts, runs, store } = env;
        const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask', model: 'explicit-b' });
        await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
        await firstTurnDone(env, taskId);
        if (order === 'before') svc.setSelection(taskId, { model: null }, 1);
        await runs.close(svc.snapshot(taskId).run!.runId);
        if (order === 'after') svc.setSelection(taskId, { model: null }, 1);
        await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 2 });
        if (lazy) { await until(() => insts[1]?.turns.length === 1); expect(insts[1].opened?.resumeNativeId).toBe('n1'); expect(insts[1].turns[0].model).toBe('cfg-default'); }
        else { await until(() => svc.status(taskId) === 'failed'); expect(insts[1]?.turns ?? []).toHaveLength(0); expect(store.items(taskId).find(i => i.type === 'error')?.payload.message).toMatch('无法确定执行器默认模型'); }
      }
    }
  });
  it('SR04：40 个约 90 KiB 的中文请求，快照仍守上限，全部请求可读取全文；单个正常请求仍完整显示', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].emit({ type: 'request', requestKey: 'small', kind: 'command_approval', payload: { command: 'ls' } });
    for (let k = 0; k < 40; k++) insts[0].emit({ type: 'request', requestKey: `r${k}`, kind: 'command_approval', payload: { command: `echo ${k} ` + '中'.repeat(30 * 1024) } });
    const snap = svc.snapshot(taskId) as any;
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThanOrEqual(256 * 1024);
    expect(snap.requestsTotal).toBe(41);
    expect(snap.requests[0]).toMatchObject({ payload: { command: 'ls' } });
    expect(snap.requests[0].detailTruncated).toBeUndefined();
    expect(snap.requests.length).toBe(41);
    for (const r of snap.requests.slice(1)) {
      expect(r.detailTruncated).toBe(true);
      let off = 0, body = '';
      for (;;) { const c = svc.requestBody(taskId, r.requestId, off, r.revision); body += c.chunk; if (c.done) break; off = c.next; }
      expect(JSON.parse(body).command.startsWith('echo ')).toBe(true);
    }
  });
});

describe('复核 2327 回归', () => {
  it('T02：约 600 KiB 的计划经真实投影入库后可读回完整原文；超过上限的保留结构并标不完整', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'plan', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const plan = '# 计划\n' + '步骤：改代码。'.repeat(600 * 1024 / 21);
    insts[0].emit({ type: 'item.completed', nativeItemId: 'a1', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan, extra: 1 } }] } });
    const read = (itemId: string, rev: number) => { let off = 0, body = ''; for (;;) { const c = svc.itemBody(taskId, itemId, off, rev); body += c.chunk; if (c.done) return JSON.parse(body); off = c.next; } };
    const item = () => svc.snapshot(taskId).items.find(i => i.type === 'proposed_plan')!;
    await until(() => !!item());
    const full = read(item().itemId, item().revision);
    expect(Buffer.byteLength(plan)).toBeGreaterThan(600 * 1024 - 100);
    expect(full.plan).toBe(plan);
    expect(full.input).toEqual({ extra: 1 });
    expect(full.storedTruncated).toBeUndefined();
    const huge = 'H'.repeat(1200 * 1024);
    insts[0].emit({ type: 'item.completed', nativeItemId: 'a2', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'p2', name: 'ExitPlanMode', input: { plan: huge } }] } });
    await until(() => svc.snapshot(taskId).items.filter(i => i.type === 'proposed_plan').length === 2);
    const big = svc.snapshot(taskId).items.filter(i => i.type === 'proposed_plan')[1];
    const bigFull = read(big.itemId, big.revision);
    expect(bigFull).toMatchObject({ storedTruncated: true, name: 'ExitPlanMode' });
    expect(huge.startsWith(bigFull.plan)).toBe(true);
    expect(bigFull.plan.length).toBeGreaterThan(1000);
  });
});

describe('复核 2354 回归', () => {
  const read = (svc: AgentTaskService, taskId: string, itemId: string, rev: number) => { let off = 0, body = ''; for (;;) { const c = svc.itemBody(taskId, itemId, off, rev); expect(Buffer.byteLength(JSON.stringify(c))).toBeLessThanOrEqual(128 * 1024); body += c.chunk; if (c.done) return JSON.parse(body); off = c.next; } };
  it('U01：超限正文转 artifact，经正文接口逐字读回首尾；快照、历史、事件仍守上限', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'm14-art-')));
    const { svc, insts, store } = setup({ artifactDir: dir });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'go', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const text = 'BEGIN_' + '中a'.repeat(500 * 1024) + '_FULL_TAIL';
    const plan = 'PLAN_' + 'p'.repeat(1200 * 1024) + '_PLAN_TAIL';
    const before = store.watermark(taskId);
    insts[0].emit({ type: 'item.completed', nativeItemId: 'big', itemType: 'assistant', payload: { content: [{ type: 'text', text }, { type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan } }] } });
    await until(() => svc.snapshot(taskId).items.some(i => i.type === 'proposed_plan'));
    const snap = svc.snapshot(taskId);
    expect(Buffer.byteLength(JSON.stringify(snap))).toBeLessThanOrEqual(256 * 1024);
    const msg = snap.items.find(i => i.type === 'assistant_message' && String(i.payload.text).startsWith('BEGIN_'))!;
    const pl = snap.items.find(i => i.type === 'proposed_plan')!;
    expect(msg.payload.truncated).toBe(true);
    expect(read(svc, taskId, msg.itemId, msg.revision).text).toBe(text);
    const fullPlan = read(svc, taskId, pl.itemId, pl.revision);
    expect(fullPlan.plan).toBe(plan);
    expect(fullPlan.storedTruncated).toBeUndefined();
    expect(Buffer.byteLength(JSON.stringify(svc.history(taskId, pl.ordinal + 1)))).toBeLessThanOrEqual(256 * 1024);
    const events = svc.events(taskId, before);
    expect(Buffer.byteLength(JSON.stringify(events))).toBeLessThanOrEqual(256 * 1024);
    expect(events.every(e => Buffer.byteLength(JSON.stringify(e)) <= 32 * 1024)).toBe(true);
    // 库内只存预览与引用
    const row = store.itemById(taskId, pl.itemId)!;
    expect(Buffer.byteLength(row.payloadJson)).toBeLessThanOrEqual(256 * 1024);
    expect(JSON.parse(row.payloadJson).artifact.file).toBe(`${taskId}/${pl.itemId}.r1.json`);
  });
  it('U01：同一条目更新后引用新修订、旧文件清理；文件丢失、被改、越界引用都明确报错', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'm14-art-')));
    const { readdirSync, writeFileSync: wf, rmSync } = await import('node:fs');
    const { svc, store, db } = setup({ artifactDir: dir });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const itemId = store.addHostItem(taskId, null, 'system_notice', { detail: 'D'.repeat(1100 * 1024) + '_END' });
    expect(read(svc, taskId, itemId, 1).detail.endsWith('_END')).toBe(true);
    const file = join(dir, taskId, `${itemId}.r1.json`);
    wf(file, readFileSync(file, 'utf8').replace('_END', '_BAD'));
    expect(() => svc.itemBody(taskId, itemId, 0, 1)).toThrow('原文文件已损坏');
    rmSync(file);
    expect(() => svc.itemBody(taskId, itemId, 0, 1)).toThrow('原文文件丢失');
    const ref = JSON.parse(store.itemById(taskId, itemId)!.payloadJson);
    db.prepare('UPDATE agent_items SET payload_ref=? WHERE item_id=?').run(JSON.stringify({ ...ref, artifact: { ...ref.artifact, file: '../../etc/passwd' } }), itemId);
    expect(() => svc.itemBody(taskId, itemId, 0, 1)).toThrow('原文引用无效');
    expect(readdirSync(join(dir, taskId)).filter(f => f.endsWith('.tmp'))).toEqual([]);
  });
  it('U01：同一原生条目更新后引用新修订的原文，旧修订文件被清理', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'm14-art-')));
    const { readdirSync } = await import('node:fs');
    const { svc, insts } = setup({ artifactDir: dir });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'go', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const big = (tag: string) => ({ content: [{ type: 'text', text: tag + 'x'.repeat(1100 * 1024) + tag }] });
    insts[0].emit({ type: 'item.completed', nativeItemId: 'same', itemType: 'assistant', payload: big('V1') });
    await until(() => svc.snapshot(taskId).items.some(i => i.type === 'assistant_message'));
    insts[0].emit({ type: 'item.completed', nativeItemId: 'same', itemType: 'assistant', payload: big('V2') });
    await until(() => svc.snapshot(taskId).items.find(i => i.type === 'assistant_message')!.revision === 2);
    const it2 = svc.snapshot(taskId).items.find(i => i.type === 'assistant_message')!;
    expect(read(svc, taskId, it2.itemId, 2).text.startsWith('V2')).toBe(true);
    expect(() => svc.itemBody(taskId, it2.itemId, 0, 1)).toThrow('条目已更新');
    expect(readdirSync(join(dir, taskId)).sort()).toEqual([`${it2.itemId}.r2.json`]);
  });
  it('U01：没有 artifact 目录时降级为结构化截短并标不完整，不冒充完整保存', () => {
    const { svc, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const itemId = store.addHostItem(taskId, null, 'system_notice', { detail: 'D'.repeat(1100 * 1024) });
    expect(read(svc, taskId, itemId, 1)).toMatchObject({ storedTruncated: true });
  });
  it('A45 保留超限条目的预览并说明正文不完整，即使私有正文目录无法创建', async () => {
    const root = mkdtempSync(join(tmpdir(), 'm14-art-unavailable-'));
    const artifactDir = join(root, 'agent-artifacts');
    const { rmSync, writeFileSync } = await import('node:fs');
    writeFileSync(artifactDir, '阻止目录创建的隔离夹具');
    const { svc, store } = setup({ artifactDir });
    try {
      const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
      const detail = '开头😀' + '中'.repeat(400_000) + '完整结尾';
      const itemId = store.addHostItem(taskId, null, 'system_notice', { detail });
      const fallback = read(svc, taskId, itemId, 1);
      expect(fallback).toMatchObject({ storedTruncated: true, detail: expect.stringContaining('开头😀') });
      expect(fallback.detail).not.toContain('完整结尾');
      expect(fallback.artifact).toBeUndefined();
    } finally { rmSync(root, { recursive:true, force:true }); }
  });
});

describe('复核 0018 回归', () => {
  const read = (svc: AgentTaskService, taskId: string, itemId: string, rev: number) => { let off = 0, body = ''; for (;;) { const c = svc.itemBody(taskId, itemId, off, rev); body += c.chunk; if (c.done) return JSON.parse(body); off = c.next; } };
  const files = async (dir: string) => { const { readdirSync, existsSync } = await import('node:fs'); return existsSync(dir) ? readdirSync(dir).sort() : []; };
  it('V01：大量短字段的结构化正文也保留原文引用，可完整读回；快照守界、没有无引用文件', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'm14-v01-')));
    const { svc, store } = setup({ artifactDir: dir });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const rows = Array.from({ length: 60_000 }, (_, k) => ({ k, v: 'ab' }));
    const itemId = store.addHostItem(taskId, null, 'system_notice', { code: 'rows', rows });
    const row = JSON.parse(store.itemById(taskId, itemId)!.payloadJson);
    expect(row.artifact.file).toBe(`${taskId}/${itemId}.r1.json`);
    expect(Buffer.byteLength(store.itemById(taskId, itemId)!.payloadJson)).toBeLessThanOrEqual(256 * 1024);
    expect(read(svc, taskId, itemId, 1).rows).toEqual(rows);
    expect(Buffer.byteLength(JSON.stringify(svc.snapshot(taskId)))).toBeLessThanOrEqual(256 * 1024);
    expect(svc.snapshot(taskId).items.find(i => i.itemId === itemId)!.payload.truncated).toBe(true);
    expect(await files(join(dir, taskId))).toEqual([`${itemId}.r1.json`]);
  });
  it('V02：转义后超过内联上限的合法用户输入，时间线逐字读回；幂等重试不重复写文件；投递原文不变', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'm14-v02-')));
    const { svc, insts, store } = setup({ artifactDir: dir });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    const text = '\u0001'.repeat(256 * 1024);
    const a = await svc.submit(taskId, { clientInputId: id(1), text, expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    expect(insts[0].turns[0].text).toBe(text);
    const msg = svc.snapshot(taskId).items.find(i => i.type === 'user_message')!;
    expect(msg.payload.truncated).toBe(true);
    expect(read(svc, taskId, msg.itemId, msg.revision).text).toBe(text);
    await expect(svc.submit(taskId, { clientInputId: id(1), text, expectedSelectionRevision: 1 })).resolves.toMatchObject({ duplicate: true, turnId: a.turnId });
    expect(await files(join(dir, taskId))).toEqual([`${msg.itemId}.r1.json`]);
    expect(store.items(taskId).filter(i => i.type === 'user_message')).toHaveLength(1);
  });
  it('V03：改名失败时删掉临时文件并标不完整；事务回滚删掉本次写出的文件；正常更新与旧文件清理不受影响', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'm14-v03-')));
    const { svc, insts, store } = setup({ artifactDir: dir });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'go', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const big = (tag: string) => ({ content: [{ type: 'text', text: tag + 'x'.repeat(1100 * 1024) }] });
    insts[0].emit({ type: 'item.completed', nativeItemId: 'same', itemType: 'assistant', payload: big('V1') });
    await until(() => svc.snapshot(taskId).items.some(i => i.type === 'assistant_message'));
    const itemId = svc.snapshot(taskId).items.find(i => i.type === 'assistant_message')!.itemId;
    // 让第 2 修订的目标路径变成目录，改名必然失败
    mkdirSync(join(dir, taskId, `${itemId}.r2.json`));
    insts[0].emit({ type: 'item.completed', nativeItemId: 'same', itemType: 'assistant', payload: big('V2') });
    await until(() => svc.snapshot(taskId).items.find(i => i.itemId === itemId)!.revision === 2);
    expect(read(svc, taskId, itemId, 2)).toMatchObject({ storedTruncated: true });
    expect((await files(join(dir, taskId))).filter(f => f.endsWith('.tmp'))).toEqual([]);
    // 第 3 修订正常写入：引用新文件，第 1 修订的旧文件已在第 2 修订提交时清理
    insts[0].emit({ type: 'item.completed', nativeItemId: 'same', itemType: 'assistant', payload: big('V3') });
    await until(() => svc.snapshot(taskId).items.find(i => i.itemId === itemId)!.revision === 3);
    expect(read(svc, taskId, itemId, 3).text.startsWith('V3')).toBe(true);
    // 剩下的只有注入故障用的 r2 目录与当前 r3 原文；r1 已清理
    expect(await files(join(dir, taskId))).toEqual([`${itemId}.r2.json`, `${itemId}.r3.json`]);
    // 事务回滚：外键不存在的运行，插入失败，本次写出的文件被删除
    const before = await files(join(dir, taskId));
    expect(() => store.upsertItem({ taskId, turnId: null, runId: 'no-such-run', nativeKey: 'k-rollback', type: 'assistant_message', payload: { text: 'R'.repeat(1100 * 1024) } })).toThrow();
    expect(await files(join(dir, taskId))).toEqual(before);
  });
});

describe('宿主重启恢复', () => {
  it('上一实例的运行收口为 orphaned，进行中的回合记未知，排队输入保留但暂停', async () => {
    const { db, store, svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 });
    insts[0].emit({ type: 'request', requestKey: '1', kind: 'command_approval', payload: {} });
    const orphans = store.recoverOrphanRuns('new-host');
    expect(orphans).toHaveLength(1);
    expect(db.prepare('SELECT state,error_code FROM capability_runs').get()).toEqual({ state: 'orphaned', error_code: 'HOST_RESTARTED' });
    expect(db.prepare("SELECT status,error_code FROM agent_turns WHERE client_input_id=?").get(id(1))).toEqual({ status: 'unknown', error_code: 'HOST_RESTARTED' });
    expect(store.pendingRequests(taskId)).toEqual([]);
    expect(store.recoverOrphanRuns('new-host')).toEqual([]);
    // 新宿主的任务服务：排队输入不自动发出
    const runs2 = new AgentRunService({ store, drivers: new Map(), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'new-host', pid: 2, startedAt: null } });
    const svc2 = new AgentTaskService({ store, runs: runs2, resolveLaunch: async () => { throw new Error('不应打开'); }, profileDriver: () => 'codex-app-server' });
    expect(svc2.snapshot(taskId).queued.map(q => q.text)).toEqual(['b']);
    expect(svc2.status(taskId)).toBe('stopped');
  });
});

describe('任务服务', () => {
  it('新建任务只建任务与草稿，不隐式启动；首次提交才打开运行', async () => {
    const { svc, insts, launches } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: '  ', profileId: 'cx', tier: 'ask' });
    expect(insts).toHaveLength(0);
    expect(svc.snapshot(taskId)).toMatchObject({ title: '新任务', status: 'idle', run: null, selectionRevision: 1 });
    const r = await svc.submit(taskId, { clientInputId: id(1), text: '你好', expectedSelectionRevision: 1 });
    expect(r).toMatchObject({ duplicate: false, status: 'accepted' });
    await until(() => insts[0]?.turns.length === 1);
    expect(launches[0]).toMatchObject({ profileId: 'cx', cwd: '/w' });
    expect(svc.status(taskId)).toBe('working');
  });

  it('运行中提交进入排队，本轮结束后按顺序自动派发', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    expect((await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 })).status).toBe('queued');
    expect((await svc.submit(taskId, { clientInputId: id(3), text: 'c', expectedSelectionRevision: 1 })).status).toBe('queued');
    expect(svc.snapshot(taskId).queued.map(q => q.text)).toEqual(['b', 'c']);
    insts[0].finish();
    await until(() => insts[0].turns.length === 2);
    expect(insts[0].turns[1].text).toBe('b');
    insts[0].finish();
    await until(() => insts[0].turns.length === 3);
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
  });

  it('停止只停本轮：排队输入保留且不自动派发，可单条取消；再次提交恢复派发', async () => {
    const { svc, insts, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    const q = await svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 });
    insts[0].emit({ type: 'request', requestKey: '3', kind: 'command_approval', payload: {} });
    await svc.stop(taskId);
    expect(insts[0].interrupts).toBe(1);
    expect(store.pendingRequests(taskId)).toEqual([]);
    await new Promise(r => setTimeout(r, 30));
    expect(insts[0].turns).toHaveLength(1);
    expect(svc.status(taskId)).toBe('stopped');
    svc.cancelQueued(taskId, q.turnId);
    expect(() => svc.cancelQueued(taskId, q.turnId)).toThrow('已发出或不存在');
    await svc.submit(taskId, { clientInputId: id(4), text: 'd', expectedSelectionRevision: 1 });
    await until(() => insts[0].turns.length === 2);
    expect(insts[0].turns[1].text).toBe('d');
  });

  it('选择 CAS：修订不符拒绝发送；Claude 选帮我批准降为请求批准', async () => {
    const { svc } = setup();
    const { taskId, tierNotice } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cc', tier: 'auto' });
    expect(tierNotice).toContain('帮我批准不适用');
    expect(svc.snapshot(taskId).selection.tier).toBe('ask');
    expect(svc.setSelection(taskId, { tier: 'full' }, 1)).toMatchObject({ ok: true, revision: 2, selection: { tier: 'full' } });
    expect(svc.setSelection(taskId, { model: 'opus' }, 1)).toMatchObject({ ok: false, revision: 2 });
    await expect(svc.submit(taskId, { clientInputId: id(1), text: 'x', expectedSelectionRevision: 1 })).rejects.toThrow('模型或权限已变化');
    expect(() => svc.setSelection(taskId, { tier: 'edits' as never }, 2)).toThrow('不支持的权限档位');
  });

  it('草稿 CAS 冲突返回服务端版本，不覆盖', () => {
    const { svc } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    expect(svc.saveDraft(taskId, { text: '一' }, 0)).toEqual({ ok: true, revision: 1 });
    expect(svc.saveDraft(taskId, { text: '二' }, 0)).toEqual({ ok: false, revision: 1, draft: { text: '一' } });
    expect(svc.snapshot(taskId).draft).toEqual({ draft: { text: '一' }, revision: 1 });
  });

  it('请求回应走当前运行；状态为等待你处理', async () => {
    const { svc, insts, store } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    insts[0].emit({ type: 'request', requestKey: '7', kind: 'command_approval', payload: { method: 'm', params: { command: 'git commit' } } });
    expect(svc.status(taskId)).toBe('waiting');
    const [req] = svc.snapshot(taskId).requests;
    await expect(svc.respond(taskId, req.requestId, 2, { decision: 'accept' })).rejects.toThrow('请求已更新');
    await svc.respond(taskId, req.requestId, 1, { decision: 'accept' });
    expect(insts[0].responses).toEqual([['7', { decision: 'accept' }]]);
    expect(store.pendingRequests(taskId)).toEqual([]);
  });

  it('打开运行失败：该输入标失败并写入原因，排队暂停', async () => {
    const { svc, store } = setup({ failOpen: true });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => svc.status(taskId) === 'failed');
    expect(store.events(taskId).map(e => e.type)).toContain('task.error');
    expect(store.events(taskId).find(e => e.type === 'task.error')?.payload).toMatchObject({ message: '找不到 codex' });
  });

  it('归档：运行中拒绝，空闲时关闭运行并从列表移除；重复提交同一输入返回原收据', async () => {
    const { svc, insts } = setup();
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 });
    await until(() => insts[0]?.turns.length === 1);
    expect(await svc.submit(taskId, { clientInputId: id(1), text: 'a', expectedSelectionRevision: 1 })).toMatchObject({ duplicate: true });
    await expect(svc.archive(taskId)).rejects.toThrow('请先停止');
    insts[0].finish();
    await until(() => svc.status(taskId) === 'completed');
    await svc.archive(taskId);
    expect(svc.list()).toEqual([]);
    await expect(svc.submit(taskId, { clientInputId: id(2), text: 'b', expectedSelectionRevision: 1 })).rejects.toThrow('任务已归档');
  });
});

it('A29/A45: native child messages have independent scoped pagination and cannot crowd the main timeline out of its snapshot',async()=>{
 const f=setup(),{taskId}=f.svc.create({projectId:null,dirId:null,cwd:'/w',title:'native logs',profileId:'cx',tier:'ask'});
 await f.svc.submit(taskId,{clientInputId:id(999),text:'start',expectedSelectionRevision:1});await until(()=>f.insts[0]?.turns.length===1);
 const runId=f.runs.runForTask(taskId)!.runId,parent=f.store.upsertItem({taskId,turnId:null,runId,nativeKey:'native-parent',type:'subagent',payload:{nativeNodeIds:['child'],status:'completed'},terminalState:'completed'});
 f.insts[0].emit({type:'node.state',nodeId:'child',state:'running'});
 for(let n=0;n<120;n++)f.store.upsertItem({taskId,turnId:null,runId,nativeKey:'child-'+n,nodeId:'child',type:'subagent_message',payload:{text:'child '+n}});
 f.store.upsertItem({taskId,turnId:null,runId,nativeKey:'foreign',nodeId:'another-child',type:'subagent_message',payload:{text:'foreign'}});
 expect(f.svc.snapshot(taskId).items.map(i=>i.type)).toEqual(['user_message','subagent']);expect(f.svc.snapshot(taskId).hasOlder).toBe(false);
 const first=f.svc.nativeHistory(taskId,parent);expect(first.items).toHaveLength(50);expect(first.total).toBe(120);expect(first.items.some(i=>i.payload.text==='foreign')).toBe(false);
 expect(first).toMatchObject({states:['running'],stopRunId:runId});
 await expect(f.svc.stop(taskId,false,'different-run')).rejects.toThrow('所属运行已结束或变化');
 expect(f.insts[0].interrupts).toBe(0);
 f.insts[0].emit({type:'node.state',nodeId:'child',state:'completed'});
 expect(f.svc.nativeHistory(taskId,parent)).toMatchObject({states:['completed'],stopRunId:null});
 const second=f.svc.nativeHistory(taskId,parent,first.nextOrdinal!);expect(second.items).toHaveLength(50);const third=f.svc.nativeHistory(taskId,parent,second.nextOrdinal!);expect(third.items).toHaveLength(20);expect(third.hasMore).toBe(false);
 await f.runs.closeAll();
});

it('keeps a long native tool result associated with its call without loading the full body in the history page', async () => {
  const f = setup(), { taskId } = f.svc.create({ projectId: null, dirId: null, cwd: '/w', title: 'native output', profileId: 'cx', tier: 'ask' });
  await f.svc.submit(taskId, { clientInputId: id(998), text: 'start', expectedSelectionRevision: 1 });
  await until(() => f.insts[0]?.turns.length === 1);
  const runId = f.runs.runForTask(taskId)!.runId;
  try {
    const parent = f.store.upsertItem({ taskId, turnId: null, runId, nativeKey: 'native-parent', type: 'subagent', payload: { nativeNodeIds: ['child'] } });
    const body = { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'bash-call',
      content: [{ type: 'text', text: `${'命令输出\n'.repeat(1000)}完整结果尾部` }], is_error: true }] } };
    const result = f.store.upsertItem({ taskId, turnId: null, runId, nodeId: 'child', nativeKey: 'long-result', type: 'subagent_message', payload: body });
    const [entry] = f.svc.nativeHistory(taskId, parent).items;
    expect(entry).toMatchObject({ itemId: result, nodeId: 'child', payload: { truncated: true,
      nativePreview: [{ kind: 'tool_result', id: 'bash-call', output: expect.stringContaining('命令输出'), failed: true }] } });
    expect(Buffer.byteLength(JSON.stringify(entry.payload))).toBeLessThanOrEqual(4096);
    expect(JSON.stringify(entry.payload)).not.toContain('完整结果尾部');
    expect(JSON.parse(f.svc.itemBody(taskId, result, 0, entry.revision).chunk)).toEqual(body);
  } finally {
    await f.runs.closeAll();
  }
});

describe('S1/S2 排队输入与确认未发送的重试', () => {
  const sender = {} as import('../applications/execution-context').ApplicationUiSender;
  it('edits the same input and preserves frozen attachment bytes into one verified steer', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'm14-queue-edit-'))), cwd = join(root, 'w'), ud = join(root, 'ud');
    mkdirSync(cwd); mkdirSync(ud);
    const image = join(cwd, 'p.png');
    writeFileSync(image, 'old image bytes');
    const { svc, insts, store } = setup({ userData: ud });
    const {taskId} = svc.create({ projectId:null, dirId:null, cwd, profileId:'cx', tier:'ask', title:'queue' });
    await svc.submit(taskId,{clientInputId:id(8),text:'first',expectedSelectionRevision:1});
    await until(() => insts[0]?.turns.length === 1);
    const attachment = svc.prepareAttachment(taskId,null,{name:'p.png',sourcePath:image});
    const receipt = await svc.submit(taskId,{clientInputId:id(9),text:'before edit',attachments:[attachment],expectedSelectionRevision:1});
    const before = svc.snapshot(taskId).queued[0];
    const item = store.items(taskId).find(i => i.turnId === receipt.turnId)!;
    const frozen = JSON.parse(store.inputForTurn(receipt.turnId)!.input_ref).attachments[0].storedPath;
    writeFileSync(image,'new image bytes');
    svc.editQueued(taskId,receipt.turnId,before.version,'edited text');
    const after = svc.snapshot(taskId).queued[0];
    expect(after).toMatchObject({turnId:before.turnId,acceptedAt:before.acceptedAt,attachmentCount:1,text:'edited text'});
    expect(after.version).not.toBe(before.version);
    expect(store.itemById(taskId,item.itemId)?.revision).toBe(item.revision+1);
    expect(store.turn(receipt.turnId)?.client_input_id).toBe(id(9));
    expect(() => svc.editQueued(taskId,receipt.turnId,before.version,'stale')).toThrow(/已变化/);
    await expect(svc.sendQueued(taskId,receipt.turnId,before.version,1,sender)).rejects.toThrow(/已变化/);
    insts[0].steerFails = true;
    await expect(svc.sendQueued(taskId,receipt.turnId,after.version,1,sender)).rejects.toThrow(/expectedTurnId/);
    expect(svc.snapshot(taskId).queued[0]).toEqual(after);
    insts[0].steerFails = false;
    await expect(svc.sendQueued(taskId,receipt.turnId,after.version,1,sender)).resolves.toEqual({status:'steered'});
    expect(insts[0].steers).toHaveLength(1);
    expect(insts[0].steers[0]).toMatchObject({ clientInputId:id(9),text:expect.stringContaining('edited text'),images:[{path:frozen,mime:'image/png'}] });
    expect(readFileSync(frozen,'utf8')).toBe('old image bytes');
    await expect(svc.sendQueued(taskId,receipt.turnId,after.version,1,sender)).rejects.toThrow(/没有可操作/);
  });

  it('retains the paused FIFO, refuses jumping the queue, and allows manual send of its head', async () => {
    const {svc,store,insts} = setup();
    const {taskId} = svc.create({projectId:null,dirId:null,cwd:'/w',profileId:'cx',tier:'ask',title:'idle queue'});
    await svc.stop(taskId);
    const first = store.acceptTurn({taskId,clientInputId:id(2),text:'first',sourceKind:'user'}).turn.turn_id;
    const second = store.acceptTurn({taskId,clientInputId:id(3),text:'second',sourceKind:'user'}).turn.turn_id;
    const [a,b] = svc.snapshot(taskId).queued;
    await expect(svc.sendQueued(taskId,second,b.version,1,sender)).rejects.toThrow(/队列顺序/);
    expect(insts).toHaveLength(0);
    svc.cancelQueued(taskId,second);
    await svc.sendQueued(taskId,first,a.version,1,sender);
    await until(() => insts[0]?.turns.length === 1);
    expect(insts[0].turns[0].text).toBe('first');
  });

  it('retries a known unsent input once and rejects retry of unknown delivery', async () => {
    const {svc,store,insts} = setup();
    const {taskId} = svc.create({projectId:null,dirId:null,cwd:'/w',profileId:'cx',tier:'ask',title:'retry'});
    const failed = store.acceptTurn({taskId,clientInputId:id(4),text:'original',sourceKind:'user'}).turn.turn_id;
    store.endTurn(failed,'failed','OPEN_FAILED');
    const unknown = store.acceptTurn({taskId,clientInputId:id(5),text:'unknown',sourceKind:'user'}).turn.turn_id;
    store.endTurn(unknown,'unknown','TIMEOUT');
    expect(() => svc.retryFailedInput(taskId,unknown,1,sender)).toThrow(/未发送/);
    const retry = svc.retryFailedInput(taskId,failed,1,sender);
    expect(svc.retryFailedInput(taskId,failed,1,sender)).toEqual(retry);
    await until(() => insts[0]?.turns.length === 1);
    expect(insts[0].turns[0].text).toBe('original');
    expect(store.turn(retry.turnId)?.client_input_id).not.toBe(id(4));
  });
});

describe('M16 real AgentStore scheduled acceptance boundary',()=>{
  const config={title:'定时摘要',prompt:'用原始回合完成摘要',projectId:null,dirId:null,cwd:'/w',workspace:'directory' as const,baseRef:null,destination:'existing' as const,boundTask:'',profileId:'cd',tier:'ask' as const,delegation:false,notifyCompleted:false};
  async function fixture(){const f=setup(),{ScheduleStore}=await import('../schedules/store');const task=f.svc.create({projectId:null,dirId:null,cwd:'/w',title:'定时',profileId:'cd',tier:'ask'});const ledger=new ScheduleStore(f.db),p=ledger.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...config,boundTask:task.taskId},grace:60,enabled:true});const c=ledger.claim(p.id,{now:Date.now(),trigger:'manual',expected:p.revision,requestId:'manual'});if(!('run'in c))throw Error('claim');ledger.begin(c.run.id,Date.now());return{...f,ledger,taskId:task.taskId,p,run:c.run};}
  it('commits the actual task turn, scheduled provenance and persistent occurrence before notifying or kicking the driver',async()=>{const f=await fixture();const kick=vi.spyOn(f.svc,'kick').mockImplementation(()=>{}),events:any[]=[];const off=f.store.subscribe(e=>{if(e.type==='turn.accepted'){events.push(e);expect(f.ledger.run(f.run.id)?.turnId).toBe((e.payload as any).turnId);}});const accepted=f.svc.acceptScheduledOccurrence(f.ledger,f.run.id,f.store.task(f.taskId)!.selection_revision);expect(accepted?.taskId).toBe(f.taskId);expect(f.store.scheduledOrigin(accepted?.turnId)?.occurrence_id).toBe(f.run.id);expect(f.store.turnByClientInput(f.taskId,f.run.inputId)?.source_kind).toBe('system');expect(events).toHaveLength(1);expect(kick).toHaveBeenCalledOnce();off();});
  it('skips a scheduled attempt when a real ordinary input already owns the task; never appends a second input',async()=>{const f=await fixture();f.store.acceptTurn({taskId:f.taskId,clientInputId:'ordinary-input',text:'ordinary',sourceKind:'user'});expect(f.svc.acceptScheduledOccurrence(f.ledger,f.run.id,f.store.task(f.taskId)!.selection_revision)).toBeUndefined();expect(f.store.turns(f.taskId)).toHaveLength(1);expect(f.ledger.run(f.run.id)?.status).toBe('skipped');});
  it('rolls back actual acceptance if the ledger receipt write fails',async()=>{const f=await fixture();const kick=vi.spyOn(f.svc,'kick'),events:any[]=[];const off=f.store.subscribe(e=>{if(e.type==='turn.accepted')events.push(e);});vi.spyOn(f.ledger,'accept').mockImplementation(()=>{throw new Error('simulated receipt storage failure');});expect(()=>f.svc.acceptScheduledOccurrence(f.ledger,f.run.id,f.store.task(f.taskId)!.selection_revision)).toThrow(/storage failure/);expect(f.store.turns(f.taskId)).toEqual([]);expect(f.ledger.run(f.run.id)?.status).toBe('dispatching');expect(events).toHaveLength(0);expect(kick).not.toHaveBeenCalled();off();});
});

describe('M16 scheduler lifecycle with actual AgentTaskService and fixture driver',()=>{
  const baseConfig={title:'定时摘要',prompt:'固定原始提示词',projectId:null,dirId:null,cwd:null,workspace:'directory' as const,baseRef:null,destination:'new' as const,boundTask:null,profileId:'cd',tier:'ask' as const,delegation:false,notifyCompleted:false};
  async function host(options:Parameters<typeof setup>[0]={}){const f=setup({distinctNativeIds:true,...options}),root=mkdtempSync(join(tmpdir(),'m16-scheduler-i-'));const {ScheduleService}=await import('../schedules/service');let compatibility='fixture-profile';const delivered:unknown[]=[];const agent={store:f.store,tasks:f.svc,runs:f.runs,delegations:{setMode:()=>{}}} as unknown as import('./wiring').AgentWorkspace;const schedule=new ScheduleService({agent,home:root,userData:root,profile:()=>({available:true,compatibility}),changed:()=>{},notify:n=>delivered.push(n)});return{...f,root,schedule,agent,delivered,setCompatibility:(value:string)=>{compatibility=value;},async close(){await schedule.stop();await f.runs.closeAll();rmSync(root,{recursive:true,force:true});}};}
  it('A27 simulated suspension and resume use the current clock and preserve the consumed occurrence after rollback',async()=>{
    const f=await host();const start=Date.parse('2026-11-25T10:00:00Z'),due=start+60000;let clock=start;
    const now=vi.spyOn(Date,'now').mockImplementation(()=>clock);
    try{
      const once={type:'once' as const,zone:'UTC',date:'2026-11-25',time:'10:01'};
      const inside=f.schedule.store.save({schedule:once,config:{...baseConfig,title:'wake within grace',compatibility:'fixture-profile'},grace:10,enabled:true},start);
      const outside=f.schedule.store.save({schedule:once,config:{...baseConfig,title:'wake outside grace',compatibility:'fixture-profile'},grace:0,enabled:true},start);
      f.schedule.start();expect(f.schedule.store.history(inside.id)).toEqual([]);expect(f.schedule.store.history(outside.id)).toEqual([]);
      clock=due+5*60000;
      // Advance the injected wall clock without running the scheduler or OS timers.
      expect(f.schedule.store.history(inside.id)).toEqual([]);expect(f.schedule.store.history(outside.id)).toEqual([]);expect(f.insts).toHaveLength(0);
      f.schedule.tick('resume');await until(()=>f.insts.length===1&&f.insts[0].turns.length===1);
      const accepted=f.schedule.store.history(inside.id)[0],missed=f.schedule.store.history(outside.id)[0];
      expect(accepted).toMatchObject({trigger:'scheduled',due,claimedAt:clock});expect(accepted.turnId).toBeTruthy();
      expect(missed).toMatchObject({trigger:'scheduled',due,status:'skipped',reason:'missed_grace',taskId:null,turnId:null});
      f.insts[0].finish();await until(()=>f.schedule.store.run(accepted.id)?.status==='completed');
      clock=start;f.schedule.tick('resume');clock=due+6*60000;f.schedule.tick('resume');
      expect(f.schedule.store.history(inside.id).map(r=>r.id)).toEqual([accepted.id]);expect(f.schedule.store.history(outside.id).map(r=>r.id)).toEqual([missed.id]);expect(f.insts).toHaveLength(1);
    }finally{now.mockRestore();await f.close();}
  });
  it('A24 fifty plans with ten due together create one receipt per due plan without serial model waits',async()=>{
    const f=await host();try{
      const now=Date.now(),plans=Array.from({length:50},(_,i)=>f.schedule.store.save({schedule:{type:'interval',zone:'UTC',minutes:1},config:{...baseConfig,title:'plan-'+i,compatibility:'fixture-profile'},grace:60,enabled:true},i<10?now-60000:now));
      f.schedule.start();
      await until(()=>f.insts.length===10&&f.insts.every(i=>i.turns.length===1));
      expect(f.schedule.store.active()).toHaveLength(10);
      expect(new Set(f.schedule.store.active().map(r=>r.taskId)).size).toBe(10);
      expect(plans.slice(10).every(p=>f.schedule.store.history(p.id).length===0)).toBe(true);
      for(const plan of plans.slice(0,10)){const rows=f.schedule.store.history(plan.id);expect(rows).toHaveLength(1);expect(rows[0].claimedAt-rows[0].due).toBeLessThanOrEqual(5000);}
      f.schedule.tick();expect(f.schedule.store.active()).toHaveLength(10);
      for(const inst of f.insts)inst.finish();await until(()=>f.schedule.store.active().length===0);
    }finally{await f.close();}
  });
  it('A30 dispatches two actual task receipts independently before either model finishes',async()=>{const f=await host();try{f.schedule.start();const create=(title:string)=>f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,title},grace:60,enabled:false});const p=await create('计划甲'),q=await create('计划乙');const a=f.schedule.runNow(p.id,p.revision,'request-a'),b=f.schedule.runNow(q.id,q.revision,'request-b');if(!('run'in a)||!('run'in b))throw Error('claim missing');await until(()=>f.insts.length===2&&f.insts.every(i=>i.turns.length===1));const runs=[f.schedule.store.run(a.run.id)!,f.schedule.store.run(b.run.id)!];expect(runs[0].taskId).not.toBe(runs[1].taskId);expect(runs.every(r=>r.status==='running'&&!!r.turnId)).toBe(true);expect(f.insts.every(i=>i.turns[0].text===baseConfig.prompt)).toBe(true);f.insts[1].finish();await until(()=>f.schedule.store.run(b.run.id)?.status==='completed'||f.schedule.store.run(a.run.id)?.status==='completed');expect(f.schedule.store.active()).toHaveLength(1);f.insts[0].finish();await until(()=>f.schedule.store.active().length===0);}finally{await f.close();}});
  it('A15 independent-new plans create distinct task, input, real driver binding and native conversation',async()=>{
    const f=await host();try{
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:baseConfig,grace:60,enabled:false});
      const one=f.schedule.runNow(p.id,p.revision,'first');if(!('run'in one))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();await until(()=>f.schedule.store.run(one.run.id)?.status==='completed');
      const two=f.schedule.runNow(p.id,p.revision,'second');if(!('run'in two))throw Error();
      await until(()=>f.insts[1]?.turns.length===1);f.insts[1].finish();await until(()=>f.schedule.store.run(two.run.id)?.status==='completed');
      expect(one.run.taskId).not.toBe(two.run.taskId);expect(one.run.inputId).not.toBe(two.run.inputId);
      expect(f.schedule.store.run(one.run.id)?.turnId).not.toBe(f.schedule.store.run(two.run.id)?.turnId);
      const bound=f.db.prepare('SELECT task_id,native_id FROM agent_bindings WHERE task_id IN (?,?)').all(one.run.taskId,two.run.taskId) as {task_id:string;native_id:string}[];
      expect(new Set(bound.map(t=>t.native_id)).size).toBe(2);expect(f.insts[1].opened?.resumeNativeId).toBeUndefined();
    }finally{await f.close();}
  });
  it('A12/A16 waits for the exact ended turn’s diff settlement before the schedule finishes and allows next reuse',async()=>{
    const f=await host();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
    try{
      f.svc.attachDiffs({before:async()=>{},after:async()=>gate,capturing:()=>true,beginTaskRemoval:()=>()=>{}});
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,destination:'reuse'},grace:60,enabled:false});
      const one=f.schedule.runNow(p.id,p.revision,'one');if(!('run'in one))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();
      const run=f.schedule.store.run(one.run.id)!;await until(()=>f.svc.isSettlingTurn(one.run.taskId!,run.turnId!));
      expect(f.schedule.store.run(one.run.id)?.status).toBe('running');
      expect(f.schedule.runNow(p.id,p.revision,'during-settlement').kind).toBe('busy');
      release();await until(()=>f.schedule.store.run(one.run.id)?.status==='completed');
      const two=f.schedule.runNow(p.id,p.revision,'after-settlement');expect(two.kind).toBe('claimed');
      await until(()=>f.insts[0]?.turns.length===2);f.insts[0].finish();
    }finally{release();await f.close();}
  });
  it('A16 reuse binds exactly once and appends a distinct turn with the original actual native session',async()=>{
    const f=await host();try{
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,destination:'reuse'},grace:60,enabled:false});
      const one=f.schedule.runNow(p.id,p.revision,'first');if(!('run'in one))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();await until(()=>f.schedule.store.run(one.run.id)?.status==='completed');
      const retained=f.schedule.store.plan(p.id)!;expect(retained.boundTask).toBe(one.run.taskId);
      const two=f.schedule.runNow(p.id,p.revision,'second');if(!('run'in two))throw Error();
      await until(()=>f.insts[0]?.turns.length===2);expect(two.run.taskId).toBe(one.run.taskId);expect(two.run.inputId).not.toBe(one.run.inputId);
      f.insts[0].finish();await until(()=>f.schedule.store.run(two.run.id)?.status==='completed');
      expect(f.schedule.store.run(one.run.id)?.turnId).not.toBe(f.schedule.store.run(two.run.id)?.turnId);
      expect(f.insts).toHaveLength(1);expect(f.store.turns(one.run.taskId!)).toHaveLength(2);
    }finally{await f.close();}
  });
  it('A29 preserves a completed manual request receipt across edit, archive and a new ledger instance',async()=>{
    const f=await host();try{
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:baseConfig,grace:60,enabled:false});
      const first=f.schedule.runNow(p.id,p.revision,'durable-id');
      expect(f.schedule.runNow(p.id,p.revision,'durable-id')).toEqual(first);
      if(!('run'in first))throw Error('missing run');
      await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();
      await until(()=>f.schedule.store.run(first.run.id)?.status==='completed');
      const edited=await f.schedule.save({id:p.id,revision:p.revision,schedule:p.schedule,config:{...baseConfig,title:'新版配置'},grace:60,enabled:false});
      f.schedule.archive(p.id,edited.revision);
      const {ScheduleStore}=await import('../schedules/store');const reopened=new ScheduleStore(f.db);
      expect(reopened.claim(p.id,{now:Date.now(),expected:p.revision,trigger:'manual',requestId:'durable-id'})).toEqual(first);
      expect(()=>reopened.claim(p.id,{now:Date.now(),expected:edited.revision,trigger:'manual',requestId:'durable-id'})).toThrow();
      expect(reopened.claim(p.id,{now:Date.now(),expected:edited.revision,trigger:'manual',requestId:'new-id'}).kind).toBe('unavailable');
      expect(reopened.history(p.id)).toHaveLength(1);
      expect(f.store.turns(first.run.taskId!)).toHaveLength(1);
    }finally{await f.close();}
  });
  it('A33 retries once before any acceptance with stable identities, never starts a third preparation after repeat failure',async()=>{
    const f=await host();try{
      f.schedule.start();const create=(title:string)=>f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,title},grace:60,enabled:false});
      const prep=vi.spyOn(f.schedule.workspaces,'prepare');prep.mockRejectedValueOnce(new Error('isolated known-before-submit fixture'));
      const plan=await create('retry');const first=f.schedule.runNow(plan.id,plan.revision,'one');if(!('run'in first))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);expect(prep).toHaveBeenCalledTimes(2);
      expect(prep.mock.calls.map(([r])=>[r.id,r.taskId,r.inputId])).toEqual([[first.run.id,first.run.taskId,first.run.inputId],[first.run.id,first.run.taskId,first.run.inputId]]);
      expect(f.schedule.store.run(first.run.id)?.attempts).toBe(2);
      expect(f.store.turns(first.run.taskId!)).toHaveLength(1);
      f.insts[0].finish();await until(()=>f.schedule.store.run(first.run.id)?.status==='completed');
      prep.mockReset();prep.mockRejectedValue(new Error('fixture still fails before submit'));
      const second=await create('failed');const claim=f.schedule.runNow(second.id,second.revision,'two');if(!('run'in claim))throw Error();
      await until(()=>f.schedule.store.run(claim.run.id)?.status==='failed');
      expect(prep).toHaveBeenCalledTimes(2);expect(f.schedule.store.run(claim.run.id)?.attempts).toBe(2);
      expect(f.store.turns(claim.run.taskId!)).toHaveLength(0);
    }finally{await f.close();}
  });
  it('A33/A34 startup retries a proved pre-accept dispatch once with the same reserved identities',async()=>{
    const f=await host();try{
      const p=f.schedule.store.save({schedule:{type:'interval',zone:'UTC',minutes:60},config:{...baseConfig,compatibility:'fixture-profile'},grace:60,enabled:false});
      const c=f.schedule.store.claim(p.id,{now:Date.now(),expected:p.revision,trigger:'manual',requestId:'before-crash'});if(!('run'in c))throw Error();
      f.schedule.store.begin(c.run.id,Date.now());expect(f.store.task(c.run.taskId!)).toBeUndefined();
      f.schedule.start();
      await until(()=>f.insts[0]?.turns.length===1);
      const run=f.schedule.store.run(c.run.id)!;expect(run.attempts).toBe(2);expect(run.taskId).toBe(c.run.taskId);expect(run.inputId).toBe(c.run.inputId);
      expect(f.store.turns(run.taskId!)).toHaveLength(1);f.insts[0].finish();await until(()=>f.schedule.store.run(run.id)?.status==='completed');
    }finally{await f.close();}
  });
  it('A34 an already accepted durable turn is reconciled after startup, never replaced by a second input',async()=>{
    const f=await host();try{
      const p=f.schedule.store.save({schedule:{type:'interval',zone:'UTC',minutes:60},config:{...baseConfig,compatibility:'fixture-profile'},grace:60,enabled:false});
      const c=f.schedule.store.claim(p.id,{now:Date.now(),expected:p.revision,trigger:'manual',requestId:'after-accept'});if(!('run'in c))throw Error();
      f.schedule.store.begin(c.run.id,Date.now());const task=f.svc.create({clientTaskId:c.run.taskId!,projectId:null,dirId:null,cwd:f.root,title:'reserved',profileId:'cd',tier:'ask'});
      const spy=vi.spyOn(f.svc,'kick').mockImplementation(()=>{});
      const accepted=f.svc.acceptScheduledOccurrence(f.schedule.store,c.run.id,f.store.task(task.taskId)!.selection_revision);
      expect(accepted?.taskId).toBe(task.taskId);spy.mockRestore();
      f.schedule.start();expect(f.schedule.store.run(c.run.id)?.turnId).toBe(accepted?.turnId);
      expect(f.store.turns(task.taskId)).toHaveLength(1);
      f.svc.kick(task.taskId);await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();
      await until(()=>f.schedule.store.run(c.run.id)?.status==='completed');expect(f.store.turns(task.taskId)).toHaveLength(1);
    }finally{await f.close();}
  });
  it('A32 scheduled-vs-ordinary acceptance in both orders respects the ordinary task receipt queue',async()=>{
    const f=await host();try{
      f.schedule.start();const task=f.svc.create({projectId:null,dirId:null,cwd:f.root,title:'bound',profileId:'cd',tier:'ask'});
      const create=()=>f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,cwd:f.root,destination:'existing',boundTask:task.taskId},grace:60,enabled:false});
      const p=await create(),q=await create();
      const a=f.schedule.runNow(p.id,p.revision,'a');const b=f.schedule.runNow(q.id,q.revision,'b');
      expect(b.kind).toBe('busy');if(!('run'in a))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);
      const ordinary=f.store.acceptTurn({taskId:task.taskId,clientInputId:'ordinary-after',text:'ordinary after',sourceKind:'user'});
      expect(f.store.turn(ordinary.turn.turn_id)?.status).toBe('accepted');
      expect(f.insts[0].turns).toHaveLength(1);
      f.insts[0].finish();await until(()=>f.schedule.store.run(a.run.id)?.status==='completed');
      expect(f.schedule.runNow(q.id,q.revision,'ordinary-occupies').kind).toBe('busy');
      expect(f.schedule.store.history(q.id)).toHaveLength(0);
    }finally{await f.close();}
  });
  it('A18 rejects changed binding identity, exposes diff, rejects stale confirmation and uses only future config after exact confirmation',async()=>{
    const f=await host();try{
      f.schedule.start();const task=f.svc.create({projectId:null,dirId:null,cwd:f.root,title:'bound',profileId:'cd',tier:'ask'});
      const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,destination:'existing',boundTask:task.taskId,cwd:f.root},grace:60,enabled:false});
      f.setCompatibility('provider-identity-2');
      const result=f.schedule.runNow(p.id,p.revision,'first');if(!('run'in result))throw Error();
      await until(()=>f.schedule.store.run(result.run.id)?.status==='failed');
      expect(f.store.turns(task.taskId)).toEqual([]);const damaged=f.schedule.store.plan(p.id)!;expect(damaged.repair).toBeTruthy();
      const diff=f.schedule.bindingPreview(p.id,damaged.revision);
      expect(diff.before.compatibility).toBe('fixture-profile');expect(diff.after.compatibility).toBe('provider-identity-2');
      f.setCompatibility('provider-identity-3');expect(()=>f.schedule.reconfirm(p.id,damaged.revision,diff.token)).toThrow();
      const current=f.schedule.bindingPreview(p.id,damaged.revision);
      const confirmed=f.schedule.reconfirm(p.id,damaged.revision,current.token);expect(confirmed.config.compatibility).toBe('provider-identity-3');expect(confirmed.repair).toBeNull();
      expect(f.schedule.store.run(result.run.id)?.snapshot.config.compatibility).toBe('fixture-profile');
      const next=f.schedule.runNow(p.id,confirmed.revision,'confirmed');if(!('run'in next))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();await until(()=>f.schedule.store.run(next.run.id)?.status==='completed');
    }finally{await f.close();}
  });
  it.each(['existing','reuse'] as const)('M16 A18 %s detects live profile, permission, directory, delegation and launch identity changes before acceptance',async destination=>{
    const f=await host();try{
      f.schedule.start();
      for(const kind of ['agent-provider','permission','cwd','delegation','endpoint-account'] as const){
        const cwd=join(f.root,kind);mkdirSync(cwd,{recursive:true});
        const actual=destination==='existing'?f.svc.create({projectId:null,dirId:null,cwd,title:kind,profileId:'cd',tier:'ask'}):null;
        const plan=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,title:kind,cwd,destination,boundTask:actual?.taskId??null},grace:60,enabled:false});
        const initial=f.schedule.runNow(plan.id,plan.revision,randomUUID());if(!('run'in initial))throw Error();
        await until(()=>f.insts.some(inst=>inst.turns.some(t=>t.clientInputId===initial.run.inputId)));
        f.insts.find(inst=>inst.turns.some(t=>t.clientInputId===initial.run.inputId))!.finish();
        await until(()=>f.schedule.store.run(initial.run.id)?.status==='completed');
        const old=f.schedule.store.run(initial.run.id)!,taskId=old.taskId!,selection=f.store.task(taskId)!;
        const before=f.store.turns(taskId).length, revision=f.schedule.store.plan(plan.id)!.revision;
        if(kind==='agent-provider')f.store.updateSelection(taskId,{profileId:'cc',driverId:'claude-sdk'},selection.selection_revision);
        if(kind==='permission')f.store.updateSelection(taskId,{tier:'full'},selection.selection_revision);
        if(kind==='cwd'){const different=join(cwd,'moved');mkdirSync(different);f.db.prepare('UPDATE tasks SET cwd=? WHERE id=?').run(different,taskId);}
        if(kind==='delegation')f.store.tx(emit=>emit(taskId,'delegation.enabled',{enabled:true}));
        if(kind==='endpoint-account')f.setCompatibility('changed-endpoint-account');
        f.schedule.auditConfigurations();
        const repaired=f.schedule.store.plan(plan.id)!;expect(repaired.repair,kind).toBeTruthy();expect(repaired.revision).toBeGreaterThan(revision);
        expect(f.schedule.runNow(plan.id,repaired.revision,randomUUID()).kind).toBe('repair');expect(f.store.turns(taskId)).toHaveLength(before);
        const preview=f.schedule.bindingPreview(plan.id,repaired.revision);
        if(kind==='agent-provider')expect(preview.after.profileId).toBe('cc');
        if(kind==='permission')expect(preview.after.tier).toBe('full');
        if(kind==='cwd')expect(preview.after.cwd).toBe(join(cwd,'moved'));
        if(kind==='delegation')expect(preview.after.delegation).toBe(true);
        if(kind==='endpoint-account')expect(preview.after.compatibility).toBe('changed-endpoint-account');
        expect(f.schedule.store.plan(plan.id)?.revision).toBe(repaired.revision);
        const confirmed=f.schedule.reconfirm(plan.id,repaired.revision,preview.token);expect(confirmed.repair).toBeNull();
        expect(f.schedule.store.run(old.id)?.actualConfig).toEqual(old.actualConfig);expect(f.schedule.store.run(old.id)?.snapshot).toEqual(old.snapshot);
      }
    }finally{await f.close();}
  },20000);
  it('A17 existing and reuse follow the current compatible model/effort on the same real task and keep old actual snapshots',async()=>{
    const f=await host({modelCatalog:async()=>['first-model','second-model'].map(id=>({id,name:id,efforts:['medium','high'],defaultEffort:'medium'}))});try{
      f.schedule.start();
      for(const destination of ['existing','reuse'] as const){
        const task=destination==='existing'?f.svc.create({projectId:null,dirId:null,cwd:f.root,title:'bound',profileId:'cd',tier:'ask',model:'first-model',effort:'medium'}):null;
        const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,destination,boundTask:task?.taskId??null,cwd:f.root,model:destination==='existing'?'second-model':'first-model',effort:destination==='existing'?'high':'medium'},grace:60,enabled:false});
        expect(p.config).toMatchObject({model:'first-model',effort:'medium'});
        const first=f.schedule.runNow(p.id,p.revision,`${destination}-first`);if(!('run'in first))throw Error();
        await until(()=>f.insts.some(i=>i.turns.some(t=>t.clientInputId===first.run.inputId)));
        const inst=f.insts.find(i=>i.turns.some(t=>t.clientInputId===first.run.inputId))!;inst.finish();await until(()=>f.schedule.store.run(first.run.id)?.status==='completed');
        const taskId=first.run.taskId!,prior=f.schedule.store.run(first.run.id)!;
        expect(prior.actualConfig).toMatchObject({model:'first-model',effort:'medium'});expect(realpathSync(prior.actualConfig!.cwd)).toBe(realpathSync(f.root));
        const selection=f.svc.snapshot(taskId);expect(f.svc.setSelection(taskId,{model:'second-model',effort:'high'},selection.selectionRevision).ok).toBe(true);
        await until(()=>!f.svc.isDispatching(taskId));
        expect(f.schedule.store.plan(p.id)?.repair).toBeNull();
        const current=f.schedule.store.plan(p.id)!;const next=f.schedule.runNow(p.id,current.revision,`${destination}-second`);if(!('run'in next))throw Error();
        await until(()=>inst.turns.some(t=>t.clientInputId===next.run.inputId));
        expect(next.run.taskId).toBe(taskId);expect(inst.turns.at(-1)).toMatchObject({model:'second-model',effort:'high'});
        inst.finish();await until(()=>f.schedule.store.run(next.run.id)?.status==='completed');
        expect(f.schedule.store.run(next.run.id)?.actualConfig).toMatchObject({cwd:prior.actualConfig!.cwd,model:'second-model',effort:'high'});
        expect(f.schedule.store.run(prior.id)?.actualConfig).toEqual(prior.actualConfig);
      }
    }finally{await f.close();}
  });
  it.each(['existing','reuse'] as const)('A19 archive of the actual %s bound task repairs the plan, keeps original history and never accepts a replacement task',async destination=>{
    const f=await host();try{
      f.schedule.start();const task=destination==='existing'?f.svc.create({projectId:null,dirId:null,cwd:f.root,title:'do not replace',profileId:'cd',tier:'ask'}):null;
      const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,destination,boundTask:task?.taskId??null,cwd:f.root},grace:60,enabled:false});
      const first=f.schedule.runNow(p.id,p.revision,'first');if(!('run'in first))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);f.insts[0].finish();await until(()=>f.schedule.store.run(first.run.id)?.status==='completed');
      const taskId=first.run.taskId!;expect(taskId).toBeTruthy();if(task)expect(taskId).toBe(task.taskId);
      expect(f.schedule.store.plan(p.id)?.boundTask).toBe(taskId);
      await f.svc.archive(taskId);await until(()=>!!f.schedule.store.plan(p.id)?.repair);
      const current=f.schedule.store.plan(p.id)!;expect(current.boundTask).toBe(taskId);expect(f.schedule.runNow(p.id,current.revision,'not-a-replacement').kind).toBe('repair');
      expect(f.schedule.store.history(p.id)).toHaveLength(1);expect(f.schedule.detail(first.run.id).target).toMatchObject({taskId,archived:true});
      expect(f.store.turns(taskId)).toHaveLength(1);expect(f.insts).toHaveLength(1);
    }finally{await f.close();}
  });
  it('M16 A44/B12 keeps a scheduled login occurrence occupied until the same-task approved continuation completes',async()=>{
    const f=await host();let wake=false,openLogin!:Function;
    const requests=new HostBusinessRequests({store:f.store,run:taskId=>f.runs.runForTask(taskId),hasOwner:taskId=>!!(f.runs.runForTask(taskId)??f.runs.closingForTask(taskId)),currentTurn:runId=>f.runs.active(runId)?.turnId,notify:(taskId,id,text,shouldWake,parentTurnId)=>f.svc.enqueueHost(taskId,id,text,'notification',shouldWake,parentTurnId),wakeLogin:taskId=>{if(wake)f.svc.kick(taskId);}});
    f.svc.attachBusiness(requests);
    try{
      attachBrowserLoginRequests({store:f.store,requests,tasks:f.svc,browser:{attachLoginGuard:()=>{},attachLoginRequest:(fn:Function)=>{openLogin=fn;},checkLoginReady:async()=>'ready',assertLoginTabIdentity:()=>{},validateLoginTab:()=>{}} as any,assertEnabled:()=>{}});
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:baseConfig,grace:60,enabled:false});
      const c=f.schedule.runNow(p.id,p.revision,'login-test');if(!('run'in c))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);const first=f.schedule.store.run(c.run.id)!,taskId=first.taskId!,root=first.turnId!,native=f.runs.runForTask(taskId)!,scope=taskApplicationScope(f.db,taskId)!;
      const request=openLogin({runId:native.runId,taskId,projectId:scope,operationId:randomUUID()},{pageId:randomUUID(),projectId:scope,profileId:'browser-fixture',origin:'https://example.invalid',readySelector:'#ready',checkpoint:'resume fixture'});
      expect(f.store.pendingRequests(taskId)[0].origin.turnId).toBe(root);
      f.insts[0].finish();await until(()=>f.store.turn(root)?.status==='completed');await f.runs.close(native.runId);
      await until(()=>!f.runs.runForTask(taskId)&&!f.runs.closingForTask(taskId));
      const frame={};const sender={sender:{isDestroyed:()=>false,mainFrame:frame},senderFrame:frame} as any;
      expect(await requests.respond(taskId,request.requestId,1,{choice:'allow'},sender)).toMatchObject({state:'approved_pending_bind'});
      f.schedule.reconcile();expect(f.schedule.store.run(c.run.id)?.status).toBe('waiting');
      expect(f.schedule.detail(c.run.id).requests).toMatchObject([{taskId,turnId:root,requestId:request.requestId}]);
      expect(f.schedule.runNow(p.id,p.revision,'still-occupied').kind).toBe('busy');
      wake=true;f.svc.kick(taskId);await until(()=>f.insts.length===2&&f.insts[1].turns.length===1,5000);
      const continuation=f.store.turns(taskId).at(-1)!;expect(f.store.scheduledOrigin(continuation.turn_id)?.root_turn_id).toBe(root);
      expect(f.schedule.store.run(c.run.id)?.status).toBe('running');f.insts[1].finish();await until(()=>f.schedule.store.run(c.run.id)?.status==='completed',5000);
    }finally{await requests.close();await f.close();}
  },15000);
  it('M16 A36 can stop an occurrence whose original turn ended while an owned unexecuted host request waits',async()=>{
    const f=await host();
    const requests=new HostBusinessRequests({store:f.store,run:taskId=>f.runs.runForTask(taskId),hasOwner:taskId=>!!(f.runs.runForTask(taskId)??f.runs.closingForTask(taskId)),currentTurn:runId=>f.runs.active(runId)?.turnId,notify:(taskId,id,text,wake,parentTurnId)=>f.svc.enqueueHost(taskId,id,text,'notification',wake,parentTurnId)});
    f.svc.attachBusiness(requests);f.agent.requests=requests;
    const executed=vi.fn(async()=>({status:'ok'}));requests.register('browser_login',{needsRun:true,validate:async()=>{},execute:executed});
    try{
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,destination:'reuse'},grace:60,enabled:true});
      const claim=f.schedule.runNow(p.id,p.revision,'stop-waiting');if(!('run'in claim))throw Error();
      await until(()=>f.insts[0]?.turns.length===1);const occurrence=f.schedule.store.run(claim.run.id)!,taskId=occurrence.taskId!,live=f.runs.runForTask(taskId)!;
      const request=requests.create({taskId,runId:live.runId,bindingId:live.bindingId,generation:live.generation},{operationId:randomUUID(),kind:'browser_login',title:'Owned waiting fixture',review:{},data:{}});
      f.insts[0].finish();await until(()=>f.store.turn(occurrence.turnId!)?.status==='completed'&&f.schedule.store.run(occurrence.id)?.status==='waiting');
      await f.runs.close(live.runId);await f.schedule.stopRun(occurrence.id);
      await until(()=>f.schedule.store.run(occurrence.id)?.status==='stopped');
      expect(f.store.request(request.requestId)?.status).toBe('retired');expect(executed).not.toHaveBeenCalled();expect(f.schedule.store.plan(p.id)?.enabled).toBe(true);
      const ordinary=await f.svc.submit(taskId,{clientInputId:'new_ordinary_after_scoped_stop',text:'ordinary',expectedSelectionRevision:f.svc.snapshot(taskId).selectionRevision});
      await until(()=>f.store.turn(ordinary.turnId)?.status==='started');await expect(f.schedule.stopRun(occurrence.id)).rejects.toThrow();
      expect(f.store.turn(ordinary.turnId)?.status).toBe('started');f.insts.at(-1)!.finish();
    }finally{await requests.close();await f.close();}
  },15000);
  it('ordinary task Stop retires the exact scheduled waiting host request without a stranded scheduled notification or swallowing ordinary queued input',async()=>{
    const f=await host();
    const requests=new HostBusinessRequests({
      store:f.store,run:taskId=>f.runs.runForTask(taskId),
      hasOwner:taskId=>!!(f.runs.runForTask(taskId)??f.runs.closingForTask(taskId)),
      currentTurn:runId=>f.runs.active(runId)?.turnId,
      notify:(taskId,id,text,wake,parentTurnId)=>f.svc.enqueueHost(taskId,id,text,'notification',wake,parentTurnId),
    });
    f.svc.attachBusiness(requests);f.agent.requests=requests;
    const executed=vi.fn(async()=>({status:'ok'})),retired=vi.fn();
    // Not browser_login: retirement must exercise the actual generic host
    // business-retired notification path, not its browser-login exception.
    requests.register('mail_send',{validate:async()=>{},execute:executed,retire:retired});
    try{
      f.schedule.start();
      const p=await f.schedule.save({
        schedule:{type:'interval',minutes:60,zone:'UTC'},
        config:{...baseConfig,destination:'reuse'},grace:60,enabled:true,
      });
      const claim=f.schedule.runNow(p.id,p.revision,'ordinary-stop-waiting');
      if(!('run'in claim))throw Error('scheduled claim absent');
      await until(()=>f.insts[0]?.turns.length===1);
      const occurrence=f.schedule.store.run(claim.run.id)!;
      const taskId=occurrence.taskId!,root=occurrence.turnId!,live=f.runs.runForTask(taskId)!;
      const req=requests.create({
        taskId,runId:live.runId,bindingId:live.bindingId,generation:live.generation,
      },{
        operationId:randomUUID(),kind:'mail_send',title:'Synthetic owned send waiting',
        review:{},data:{},
      });
      expect(f.store.pendingRequests(taskId).find(r=>r.requestId===req.requestId)?.origin.turnId).toBe(root);
      f.insts[0].finish();
      await until(()=>f.store.turn(root)?.status==='completed'&&f.schedule.store.run(occurrence.id)?.status==='waiting');

      // Genuine durable ordinary queue as an independent setup condition; do not
      // kick between placing it and issuing Stop (matches an accepted queued
      // user input at the moment of the user's existing Stop action).
      const ordinary=f.store.acceptTurn({
        taskId,clientInputId:'ordinary-queue-before-scheduled-stop',
        text:'keep this ordinary queued input',sourceKind:'user',
      }).turn;
      expect(f.store.scheduledOrigin(ordinary.turn_id)).toBeUndefined();
      expect(f.store.turn(ordinary.turn_id)?.status).toBe('accepted');

      // Same API/expectedRunId as agent-task-view.tsx:1608 "停止本轮".
      await f.svc.stop(taskId,false,f.runs.runForTask(taskId)?.runId);
      expect(f.store.request(req.requestId)?.status).toBe('retired');
      expect(retired).toHaveBeenCalledOnce();expect(executed).not.toHaveBeenCalled();
      expect(f.store.turn(ordinary.turn_id)?.status).toBe('accepted');
      const follow=f.store.turnByClientInput(taskId,'business-retired-'+req.requestId);
      expect(follow).toBeDefined();
      expect(f.store.scheduledOrigin(follow!.turn_id)).toMatchObject({occurrence_id:occurrence.id,root_turn_id:root});
      // This is the regression. Current C21 leaves follow.status='accepted'
      // while ordinary Stop has paused the task, and reconcile stays running.
      f.schedule.reconcile();
      expect(f.schedule.store.run(occurrence.id)?.status).toBe('stopped');
      expect(f.store.turn(follow!.turn_id)?.status).toBe('canceled');
      expect(f.schedule.store.plan(p.id)?.enabled).toBe(true);
      expect(f.store.turn(ordinary.turn_id)?.status).toBe('accepted');

      // Resume the retained ordinary queue through the existing normal user
      // submission path. It must not inherit any old occurrence authority,
      // rerun the retired request, or be stopped by requesting the old run.
      const later=await f.svc.submit(taskId,{
        clientInputId:'ordinary-after-scheduled-stop',
        text:'a later ordinary input',expectedSelectionRevision:f.svc.snapshot(taskId).selectionRevision,
      });
      await until(()=>f.store.turn(ordinary.turn_id)?.status==='started');
      expect(f.store.scheduledOrigin(ordinary.turn_id)).toBeUndefined();
      await expect(f.schedule.stopRun(occurrence.id)).rejects.toThrow();
      expect(f.store.turn(ordinary.turn_id)?.status).toBe('started');
      const firstInst=f.insts.find(i=>i.turns.some(t=>t.clientInputId===ordinary.client_input_id))!;
      firstInst.finish();
      await until(()=>f.store.turn(later.turnId)?.status==='started');
      expect(f.store.scheduledOrigin(later.turnId)).toBeUndefined();
      const laterInst=f.insts.find(i=>i.turns.some(t=>t.clientInputId==='ordinary-after-scheduled-stop'))!;
      laterInst.finish();
      await until(()=>f.store.turn(later.turnId)?.status==='completed');
      expect(f.schedule.store.run(occurrence.id)?.status).toBe('stopped');
      expect(executed).not.toHaveBeenCalled();
    }finally{await requests.close();await f.close();}
  },15000);

  it('A50 persists repair and failure notices independently while respecting system preference, without duplicate on reconcile',async()=>{
    const f=await host();try{
      f.schedule.start();const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:baseConfig,grace:60,enabled:false});
      f.schedule.setNotifyEnabled(false);f.setCompatibility('changed');
      const result=f.schedule.runNow(p.id,p.revision,'fail');if(!('run'in result))throw Error();
      await until(()=>f.schedule.store.run(result.run.id)?.status==='failed');
      const notices=f.schedule.listNotices();expect(notices.map(n=>n.status).sort()).toEqual(['failed','repair']);
      expect(notices.find(n=>n.status==='repair')?.runId).toBeNull();expect(notices.find(n=>n.status==='failed')?.runId).toBe(result.run.id);
      expect(f.delivered).toEqual([]);f.schedule.reconcile();f.schedule.reconcile();expect(f.schedule.listNotices()).toEqual(notices);
      expect(f.schedule.runNow(p.id,f.schedule.store.plan(p.id)!.revision,'no-effect').kind).toBe('repair');
      expect(f.schedule.store.history(p.id)).toHaveLength(1);
    }finally{await f.close();}
  });
  it('M16 A50 recovers an uncertain preaccept occurrence without a confirmed turn as its original run notification',async()=>{
    const f=await host();try{
      const p=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:baseConfig,grace:60,enabled:false});
      const claim=f.schedule.store.claim(p.id,{now:Date.now(),trigger:'manual',expected:p.revision,requestId:'original-preaccept'});
      if(!('run'in claim))throw Error('missing initial claim');
      const id=claim.run.id;f.schedule.store.begin(id,Date.now());expect(f.schedule.store.retryUnaccepted(id)).toBe(true);f.schedule.store.begin(id,Date.now());
      expect(f.schedule.store.run(id)).toMatchObject({status:'dispatching',attempts:2,turnId:null});
      // Second interrupted preparation: restart cannot prove that submission was accepted.
      f.schedule.start();
      const run=f.schedule.store.run(id)!;expect(run).toMatchObject({status:'unknown',turnId:null});expect(f.insts).toHaveLength(0);
      expect(f.schedule.detail(id)).toMatchObject({target:null,result:null,requests:[],items:[]});
      const notices=f.schedule.listNotices();expect(notices).toMatchObject([{runId:id,planId:p.id,turnId:null,status:'unknown'}]);
      f.schedule.reconcile();expect(f.schedule.listNotices()).toEqual(notices);
      expect(f.schedule.runNow(p.id,p.revision,'never-replay-unknown').kind).toBe('busy');
    }finally{await f.close();}
  });
  it('A31/A35/A50 waiting and unknown are occupied, request identity deduplicates, and the known failed run can be rerun independently',async()=>{
    const f=await host();try{
      f.schedule.start();const plan=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:baseConfig,grace:60,enabled:false});
      const one=f.schedule.runNow(plan.id,plan.revision,'one');if(!('run'in one))throw Error();await until(()=>f.insts[0]?.turns.length===1);
      const inst=f.insts[0];inst.emit({type:'request',requestKey:'first-approval',kind:'command_approval',payload:{command:'echo test fixture'}});
      await until(()=>f.schedule.store.run(one.run.id)?.status==='waiting');const req=f.store.pendingRequests(one.run.taskId!)[0];
      expect(f.schedule.runNow(plan.id,plan.revision,'while-waiting').kind).toBe('busy');f.schedule.reconcile();f.schedule.reconcile();
      expect(f.schedule.listNotices().filter(n=>n.status==='waiting')).toMatchObject([{runId:one.run.id,requestId:req.requestId}]);
      await f.svc.respond(one.run.taskId!,req.requestId,req.revision,{decision:'decline'});
      await until(()=>f.schedule.store.run(one.run.id)?.status==='running');
      inst.emit({type:'turn.completed',nativeTurnId:'nt-1',status:'unknown',error:'fixture unknown acknowledgement'});
      await until(()=>f.schedule.store.run(one.run.id)?.status==='unknown');expect(f.schedule.runNow(plan.id,plan.revision,'while-unknown').kind).toBe('busy');
      expect(f.schedule.listNotices().filter(n=>n.status==='unknown')).toHaveLength(1);
      // Explicit isolated fixture receipt recovery of the same accepted turn,
      // never a new request or model invocation.
      const run=f.schedule.store.run(one.run.id)!;f.db.prepare("UPDATE agent_turns SET status='failed' WHERE turn_id=?").run(run.turnId);f.schedule.reconcile();
      expect(f.schedule.store.run(one.run.id)?.status).toBe('failed');expect(f.schedule.runNow(plan.id,plan.revision,'while-unknown').kind).toBe('busy');
      const next=f.schedule.runNow(plan.id,plan.revision,'after-confirmed-failure');if(!('run'in next))throw Error();await until(()=>f.insts[1]?.turns.length===1);f.insts[1].finish();
      await until(()=>f.schedule.store.run(next.run.id)?.status==='completed');expect(next.run.id).not.toBe(one.run.id);expect(next.run.taskId).not.toBe(one.run.taskId);expect(f.schedule.listNotices().filter(n=>n.status==='completed')).toHaveLength(0);
    }finally{await f.close();}
  });
  it('A41/A49 history and recent results use the actual final owned parent turn and exact observed file rows, never a later ordinary turn',async()=>{
    const f=await host();try{
      f.schedule.start();const plan=await f.schedule.save({schedule:{type:'interval',minutes:60,zone:'UTC'},config:{...baseConfig,notifyCompleted:true,destination:'reuse'},grace:60,enabled:false});
      const c=f.schedule.runNow(plan.id,plan.revision,'one');if(!('run'in c))throw Error();await until(()=>f.insts[0]?.turns.length===1);
      const run=f.schedule.store.run(c.run.id)!,taskId=run.taskId!,root=run.turnId!,inst=f.insts[0];
      const reply=(turnId:string,key:string,text:string)=>f.store.upsertItem({taskId,turnId,runId:null,nativeKey:key,type:'assistant_message',payload:{text},terminalState:'completed'});
      reply(root,'early','EARLY PARENT');const continuation=f.svc.enqueueHost(taskId,'owned-result','child result notification','notification',true,root).turn.turn_id;
      inst.finish();await until(()=>inst.turns.length===2);expect(f.schedule.store.run(run.id)?.status).toBe('running');reply(continuation,'final','FINAL OWNED PARENT');
      const change=(turnId:string,path:string)=>f.db.prepare("INSERT INTO agent_turn_changes(turn_id,task_id,changed_files_json,status) VALUES(?,?,?,'complete')").run(turnId,taskId,JSON.stringify([{path,added:1,removed:0,binary:false}]));change(continuation,'owned.txt');
      inst.finish();await until(()=>f.schedule.store.run(run.id)?.status==='completed');
      const ordinary=await f.svc.submit(taskId,{clientInputId:'ordinary-later',text:'later ordinary',expectedSelectionRevision:f.svc.snapshot(taskId).selectionRevision});
      await until(()=>inst.turns.length===3);reply(ordinary.turnId,'later','LATER ORDINARY');change(ordinary.turnId,'unrelated.txt');inst.finish();
      await until(()=>f.store.turn(ordinary.turnId)?.status==='completed');
      // Long, later ordinary history must not evict the scheduled occurrence's
      // own exact result when the normal task timeline's 2000-row cap is hit.
      const lastOrdinal=(f.db.prepare('SELECT MAX(ordinal) n FROM agent_items WHERE task_id=?').get(taskId) as {n:number}).n;
      const insert=f.db.prepare("INSERT INTO agent_items(item_id,task_id,turn_id,type,ordinal,payload_ref,terminal_state,created_at,updated_at) VALUES(?,?,?,'assistant_message',?,?,'completed',?,?)");
      f.db.transaction(()=>{for(let i=1;i<=2001;i++){const at=new Date().toISOString();insert.run(`later-fixture-${i}`,taskId,ordinary.turnId,lastOrdinal+i,JSON.stringify({text:`later unrelated ${i}`}),at,at);}})();
      const detail=f.schedule.detail(run.id);expect(detail.result?.payload.text).toBe('FINAL OWNED PARENT');expect(detail.changes).toMatchObject([{turnId:continuation,files:['owned.txt'],total:1}]);
      expect(detail.items.some(i=>i.payload.text==='LATER ORDINARY')).toBe(false);
      expect(f.schedule.history(plan.id)[0].summary).toBe('FINAL OWNED PARENT');expect(f.schedule.list().find(p=>p.id===plan.id)?.recent?.summary).toBe('FINAL OWNED PARENT');
      expect(f.schedule.listNotices().filter(n=>n.status==='completed')).toMatchObject([{runId:run.id,turnId:root}]);f.schedule.reconcile();expect(f.schedule.listNotices()).toHaveLength(1);
    }finally{await f.close();}
  });
  it('A26/A39 does not repeatedly scan an empty plan set, and freezes future claims while quit is pending',async()=>{const f=await host();vi.useFakeTimers();try{const due=vi.spyOn(f.schedule.store,'due');f.schedule.start();expect(due).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(30000);expect(due).toHaveBeenCalledTimes(1);const plan=await f.schedule.save({schedule:{type:'interval',minutes:1,zone:'UTC'},config:baseConfig,grace:60,enabled:true});f.schedule.pauseClaims();await vi.advanceTimersByTimeAsync(61000);expect(f.schedule.store.history(plan.id)).toHaveLength(0);f.schedule.resumeClaims();expect(f.schedule.store.history(plan.id)).toHaveLength(1);f.schedule.pauseClaims();}finally{vi.useRealTimers();await f.close();}});
  it('A37/A38/A39 pause, edit or archive during actual isolated preparation rejects the old occurrence with no accepted input or empty new task',async()=>{
    for(const action of ['pause','edit','archive'] as const){
      const f=await host();let release!:()=>void;const gate=new Promise<void>(r=>release=r);
      try{
        const p=f.schedule.store.save({schedule:{type:'interval',minutes:1,zone:'UTC'},config:{...baseConfig,compatibility:'fixture-profile'},grace:60,enabled:true},Date.now()-60000);
        const prepare=f.schedule.workspaces.prepare.bind(f.schedule.workspaces);const called=vi.spyOn(f.schedule.workspaces,'prepare').mockImplementation(async r=>{await gate;return prepare(r);});
        f.schedule.start();await until(()=>called.mock.calls.length===1);const run=f.schedule.store.history(p.id)[0];expect(run.status).toBe('dispatching');
        if(action==='pause')f.schedule.setEnabled(p.id,p.revision,false);
        else if(action==='archive')f.schedule.archive(p.id,p.revision);
        else await f.schedule.save({id:p.id,revision:p.revision,schedule:p.schedule,config:{...baseConfig,prompt:'next only'},grace:60,enabled:true});
        release();await until(()=>f.schedule.store.run(run.id)?.status==='skipped');
        expect(f.store.turns(run.taskId!)).toHaveLength(0);expect(f.store.task(run.taskId!)).toBeUndefined();expect(f.insts).toHaveLength(0);expect(f.schedule.store.run(run.id)?.snapshot.config.prompt).toBe(baseConfig.prompt);
      }finally{release();await f.close();}
    }
  });
});
