import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { AgentTaskService, type LaunchResolver } from './agent-task-service';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import type { DriverId } from './capabilities';
import { until } from './test-doubles';

// M14-A05 连续回合与中断、A11 请求面板后端、A16 发送失败、A43 草稿 CAS、A48 归档（阶段 2：U／I 层）。
class Inst implements DriverInstance {
  emitter = new Emitter(); turns: TurnInput[] = []; responses: [string, unknown][] = []; interrupts = 0;
  constructor(readonly driverId: DriverId) {}
  on = this.emitter.on.bind(this.emitter); emit = this.emitter.emit.bind(this.emitter);
  async open(o: DriverOpenOptions) { this.emit({ type: 'process', pid: 9 }); return { nativeId: o.resumeNativeId ?? 'n1', confirmed: true }; }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `nt-${this.turns.length}`; this.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
  finish(status: 'completed' | 'interrupted' = 'completed') { this.emit({ type: 'turn.completed', nativeTurnId: `nt-${this.turns.length}`, status }); }
  async respond(k: string, r: unknown) { this.responses.push([k, r]); }
  async interrupt() { this.interrupts++; this.finish('interrupted'); }
  steers: TurnInput[] = []; goals: unknown[] = []; steerFails = false;
  async steer(t: TurnInput) { if (this.steerFails) throw new DriverError('REJECTED', 'expectedTurnId 不匹配'); this.steers.push(t); }
  async goal(op: any) { this.goals.push(op); if (op.kind === 'set') this.emit({ type: 'goal', objective: op.objective, status: 'active' }); if (op.kind === 'pause') this.emit({ type: 'goal', objective: null, status: 'paused' }); if (op.kind === 'clear') this.emit({ type: 'goal', objective: null, status: 'cleared' }); }
  async close() { this.emit({ type: 'exit', code: 0, signal: null }); }
}
const dbs: Database.Database[] = [];
afterEach(() => dbs.splice(0).forEach(d => d.close()));
function setup(opts: { failOpen?: boolean } = {}) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db);
  const insts: Inst[] = [];
  const drv = (id: DriverId): AgentDriver => ({ id, command: id, create: () => { const i = new Inst(id); insts.push(i); return i; } });
  const runs = new AgentRunService({ store, drivers: new Map([['codex-app-server', drv('codex-app-server')], ['claude-sdk', drv('claude-sdk')]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'h', pid: 1, startedAt: null } });
  const launches: Parameters<LaunchResolver>[0][] = [];
  const resolveLaunch: LaunchResolver = async (i) => { launches.push(i); if (opts.failOpen) throw new Error('找不到 codex'); return { driverId: i.profileId === 'cc' ? 'claude-sdk' : 'codex-app-server', executable: { path: '/x', version: i.profileId === 'cc' ? '2.1.326' : '0.169.0' }, env: {}, stateRoot: '/s', compatibility: {}, extraArgs: [] }; };
  const svc = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: p => p === 'cc' ? 'claude-sdk' : 'codex-app-server' });
  return { db, store, runs, svc, insts, launches };
}
const id = (n: number) => `client-input-${n}`;

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
    expect(svc.snapshot(taskId).goal).toMatchObject({ objective: '修完断言', status: 'active' });
    await expect(svc.goal(taskId, { kind: 'pause' })).rejects.toThrow('不能暂停');
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
