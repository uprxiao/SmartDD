import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { AgentRunService } from './agent-run-service';
import { AgentTaskService, type LaunchResolver } from './agent-task-service';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import type { DriverId } from './capabilities';
import { until } from './test-doubles';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// M14-A05 连续回合与中断、A11 请求面板后端、A16 发送失败、A43 草稿 CAS、A48 归档（阶段 2：U／I 层）。
class Inst implements DriverInstance {
  emitter = new Emitter(); turns: TurnInput[] = []; responses: [string, unknown][] = []; interrupts = 0;
  constructor(readonly driverId: DriverId) {}
  on = this.emitter.on.bind(this.emitter); emit = this.emitter.emit.bind(this.emitter);
  async open(o: DriverOpenOptions) { this.opened = o; this.emit({ type: 'process', pid: 9 }); return { nativeId: o.resumeNativeId ?? 'n1', confirmed: true }; }
  async startTurn(t: TurnInput) { this.turns.push(t); const id = `nt-${this.turns.length}`; this.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
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
function setup(opts: { failOpen?: boolean; userData?: string; version?: string; openGate?: Promise<void>; launchModel?: string } = {}) {
  const db = new Database(':memory:'); dbs.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  const store = new AgentStore(db);
  const insts: Inst[] = [];
  const drv = (id: DriverId): AgentDriver => ({ id, command: id, create: () => { const i = new Inst(id); insts.push(i); return i; } });
  const runs = new AgentRunService({ store, drivers: new Map([['codex-app-server', drv('codex-app-server')], ['claude-sdk', drv('claude-sdk')]]), processes: { read: () => null, state: () => 'unknown' }, host: { instanceId: 'h', pid: 1, startedAt: null } });
  const launches: Parameters<LaunchResolver>[0][] = [];
  const resolveLaunch: LaunchResolver = async (i) => { launches.push(i); if (opts.openGate) await opts.openGate; if (opts.failOpen) throw new Error('找不到 codex'); return { driverId: i.profileId === 'cc' ? 'claude-sdk' : 'codex-app-server', executable: { path: '/x', version: opts.version ?? (i.profileId === 'cc' ? '2.1.326' : '0.169.0') }, env: {}, stateRoot: '/s', compatibility: {}, extraArgs: [], ...(opts.launchModel ? { model: opts.launchModel } : {}) }; };
  const svc = new AgentTaskService({ store, runs, resolveLaunch, profileDriver: p => p === 'cc' ? 'claude-sdk' : 'codex-app-server', userData: opts.userData });
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
    // 原生确认前只显示等待确认，不预写目标（复核 CR14）
    expect(svc.snapshot(taskId).goal).toBeNull();
    expect(svc.snapshot(taskId).goalPending).toMatchObject({ kind: 'set', objective: '修完断言' });
    insts[0].emit({ type: 'goal', objective: '修完断言', status: 'active' });
    expect(svc.snapshot(taskId).goal).toMatchObject({ objective: '修完断言', status: 'active' });
    expect(svc.snapshot(taskId).goalPending).toBeNull();
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

describe('附件随输入冻结', () => {
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
  it('CR03：启动运行期间按停止，返回后不派发；停止后的目标自行回合立即中断', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { svc, insts } = setup({ openGate: gate });
    const { taskId } = svc.create({ projectId: null, dirId: null, cwd: '/w', title: 't', profileId: 'cx', tier: 'ask' });
    await svc.submit(taskId, { clientInputId: id(1), text: 'do work', expectedSelectionRevision: 1 });
    expect(await svc.stop(taskId)).toEqual({ stopped: true });
    release();
    await until(() => insts.length === 1);
    await new Promise(res => setTimeout(res, 30));
    expect(insts[0].turns).toEqual([]);
    expect(svc.snapshot(taskId).queued.map(q => q.text)).toEqual(['do work']);
    // 目标被用户停止后，迟到的自行回合到达立即中断
    insts[0].emit({ type: 'turn.started', nativeTurnId: 'late-auto', clientInputId: '' });
    await until(() => insts[0].interrupts === 1);
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
    for (;;) { const c = svc.itemBody(taskId, item.itemId, off); body += c.chunk; off += c.chunk.length; if (c.done) break; }
    expect(JSON.parse(body).text).toBe(big);
    await expect(svc.submit(taskId, { clientInputId: id(2), text: 'x'.repeat(256 * 1024 + 1), expectedSelectionRevision: 1 })).rejects.toThrow('超过 256 KB');
  });
  it('CR12：Claude 档位跨越完全访问时重开并恢复原会话', async () => {
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
    for (;;) { const c = svc.requestBody(taskId, big.requestId, off); text += c.chunk; off += c.chunk.length; if (c.done) break; }
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
