import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore, sha256 } from './agent-store';
import { AgentRunService, type OpenRunInput } from './agent-run-service';
import { DriverError, Emitter, type AgentDriver, type DriverInstance, type DriverOpenOptions, type TurnInput } from './driver';
import { evaluateCapabilities, type DriverId } from './capabilities';
import type { ProcessIdentityReader } from '../applications/process-identity';

// M14-A04 启动门闩与实际 owner、A13 新绑定、A16 发送前失败与接收未知、A64 运行身份接口（阶段 1：U／I 层）。
class ScriptedInstance implements DriverInstance {
  readonly emitter = new Emitter();
  opened?: DriverOpenOptions; turns: TurnInput[] = []; responses: [string, unknown][] = []; closed = false; interrupted = 0;
  startError?: Error; nativeId = 'native-1'; confirmed = true;
  constructor(readonly driverId: DriverId) {}
  on = this.emitter.on.bind(this.emitter);
  emit = this.emitter.emit.bind(this.emitter);
  async open(o: DriverOpenOptions) { this.opened = o; this.emit({ type: 'process', pid: 777 }); const id = o.resumeNativeId ?? this.nativeId; if (this.confirmed) this.emit({ type: 'session', nativeId: id }); return { nativeId: id, confirmed: this.confirmed }; }
  async startTurn(t: TurnInput) { if (this.startError) throw this.startError; this.turns.push(t); const id = `nt-${this.turns.length}`; this.emit({ type: 'turn.started', nativeTurnId: id, clientInputId: t.clientInputId }); return { nativeTurnId: id }; }
  async respond(k: string, r: unknown) { this.responses.push([k, r]); }
  async interrupt() { this.interrupted++; }
  async close() { this.closed = true; this.emit({ type: 'exit', code: 0, signal: null }); }
}

const open: Database.Database[] = [];
afterEach(() => open.splice(0).forEach(d => d.close()));
function setup() {
  const db = new Database(':memory:'); open.push(db); db.pragma('foreign_keys=ON'); runBundledMigrations(db);
  db.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p1','项目',1,1)");
  const store = new AgentStore(db);
  const instances: ScriptedInstance[] = [];
  const driver = (id: DriverId): AgentDriver => ({ id, command: id, create: () => { const i = new ScriptedInstance(id); instances.push(i); return i; } });
  const processes: ProcessIdentityReader = { read: pid => ({ pid, startedAt: `darwin-proc-v1:${pid}:1` }), state: () => 'running' };
  const service = new AgentRunService({ store, drivers: new Map([['claude-sdk', driver('claude-sdk')], ['codex-app-server', driver('codex-app-server')]]), processes, host: { instanceId: 'host-1', pid: process.pid, startedAt: 'darwin-proc-v1:1:1' } });
  const taskId = store.createTask({ projectId: 'p1', dirId: null, cwd: '/w', title: '新任务', selection: { driverId: 'codex-app-server', profileId: 'cx', tier: 'ask' } });
  const base: OpenRunInput = { taskId, driverId: 'codex-app-server', profileId: 'cx', executable: { path: '/opt/codex', version: '0.169.0' }, cwd: '/w', env: { PATH: '/bin' }, stateRoot: '/h/.codex', compatibility: { extensions: true }, tier: 'ask' };
  return { db, store, service, instances, taskId, base };
}

describe('运行服务', () => {
  it('A15/A33: ordinary bindings keep the phase-3 identity, while a read role cannot resume a writable native binding', async () => {
    const f=setup(), hash=sha256(JSON.stringify({driver:f.base.driverId,profile:f.base.profileId,stateRoot:f.base.stateRoot,cwd:f.base.cwd,compatibility:f.base.compatibility}));
    const binding=f.store.createBinding({task_id:f.taskId,driver_id:f.base.driverId,profile_id:f.base.profileId,continuation_hash:hash,state_root:f.base.stateRoot,cwd_identity:f.base.cwd});
    f.store.freezeBinding(binding,{compatibility:f.base.compatibility,stateRoot:f.base.stateRoot,cwd:f.base.cwd});f.store.confirmNative(binding,'original-thread');
    const write=await f.service.open(f.base);expect(write.bindingId).toBe(binding);expect(f.instances[0].opened?.resumeNativeId).toBe('original-thread');await f.service.close(write.runId);
    const read=await f.service.open({...f.base,readOnly:true});expect(read.bindingId).not.toBe(binding);expect(f.instances[1].opened?.readOnly).toBe(true);await f.service.close(read.runId);
  });
  it('A04/A32: an integration failure before any native open has an explicit unforked drain receipt', async () => {
    const f=setup();await expect(f.service.open({...f.base,integrate:async()=>{throw Error('prepare failed before fork');}})).rejects.toThrow('prepare failed');
    const row=f.db.prepare('SELECT run_id,error_code,pid FROM capability_runs').get() as {run_id:string;error_code:string;pid:null};
    expect(row.error_code).toBe('OPEN_FAILED_UNFORKED');expect(row.pid).toBeNull();expect(await f.service.drainNativeGroup(row.run_id)).toBe(true);
  });
  it('新任务在同一事务写 tasks 与 agent_tasks，旧列表不受影响', () => {
    const { db, taskId } = setup();
    expect(db.prepare('SELECT runner,title FROM tasks WHERE id=?').get(taskId)).toEqual({ runner: 'codex', title: '新任务' });
    expect(db.prepare('SELECT mode,selection_revision FROM agent_tasks WHERE task_id=?').get(taskId)).toEqual({ mode: 'single', selection_revision: 1 });
    expect(db.prepare("SELECT event_type FROM agent_events WHERE task_id=?").all(taskId)).toEqual([{ event_type: 'task.created' }]);
  });

  it('打开运行：登记绑定、代次与本宿主 owner，原生 PID 只取自本宿主启动的进程', async () => {
    const { db, service, base, taskId } = setup();
    const h = await service.open(base);
    expect(h).toMatchObject({ taskId, generation: 1, driverId: 'codex-app-server', tier: 'ask' });
    const run = db.prepare('SELECT * FROM capability_runs WHERE run_id=?').get(h.runId) as any;
    expect(run).toMatchObject({ task_id: taskId, binding_id: h.bindingId, generation: 1, driver_id: 'codex-app-server', state: 'active', pid: 777, process_started_at: 'darwin-proc-v1:777:1', owner_instance_id: 'host-1', owner_pid: process.pid, binding_mode: 'run' });
    expect(run.launch_plan_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(db.prepare('SELECT native_id,native_confirmed_at IS NOT NULL AS c FROM agent_bindings WHERE binding_id=?').get(h.bindingId)).toEqual({ native_id: 'native-1', c: 1 });
    await expect(service.open(base)).rejects.toThrow('该任务已有运行中的执行器');
  });

  it('同一兼容身份再次打开恢复原生会话并升代次；兼容身份变化新建绑定', async () => {
    const { service, base, instances } = setup();
    const a = await service.open(base);
    await service.close(a.runId);
    const b = await service.open(base);
    expect(b.bindingId).toBe(a.bindingId);
    expect(b.generation).toBe(2);
    expect(instances[1].opened?.resumeNativeId).toBe('native-1');
    await service.close(b.runId);
    const c = await service.open({ ...base, compatibility: { extensions: false } });
    expect(c.bindingId).not.toBe(a.bindingId);
    expect(c.generation).toBe(1);
    expect(instances[2].opened?.resumeNativeId).toBeUndefined();
  });

  it('A62: 缺少可选协议方法时可以聊天，恢复旧绑定时保留原生会话身份', async () => {
    const { db, store, service, base, instances } = setup();
    const { capabilities } = evaluateCapabilities(base.driverId, base.executable.version, name => name !== 'resume' && name !== 'mcp');
    const input = { ...base, capabilities };
    const run = await service.open(input);
    await service.submit(run.runId, { clientInputId: 'basic-input', text: '基本对话' });
    expect(instances[0].turns).toEqual([expect.objectContaining({ text: '基本对话' })]);
    await service.close(run.runId);

    await expect(service.open(input)).rejects.toThrow('当前执行器不支持恢复原生会话');
    expect(instances).toHaveLength(1);
    expect(store.binding(run.bindingId)).toMatchObject({ native_id: 'native-1' });
    expect(db.prepare('SELECT run_id FROM capability_runs').all()).toEqual([{ run_id: run.runId }]);
  });

  it('预分配身份未确认前不恢复：只确认后才写入原生身份', async () => {
    const { service, base, instances, store } = setup();
    const svcDrivers = (service as any).deps.drivers as Map<DriverId, AgentDriver>;
    svcDrivers.set('claude-sdk', { id: 'claude-sdk', command: 'claude', create: () => { const i = new ScriptedInstance('claude-sdk'); i.confirmed = false; instances.push(i); return i; } });
    const h = await service.open({ ...base, driverId: 'claude-sdk', profileId: 'cc', tier: 'ask' });
    expect(store.binding(h.bindingId)).toMatchObject({ native_id: null, native_confirmed_at: null });
    instances[0].emit({ type: 'session', nativeId: 'sess-9' });
    expect(store.binding(h.bindingId)).toMatchObject({ native_id: 'sess-9' });
    expect(() => store.confirmNative(h.bindingId, 'other')).toThrow('绑定已确认为其他原生会话');
  });

  it('Claude 选帮我批准：降为请求批准并返回说明', async () => {
    const { service, base, instances } = setup();
    const h = await service.open({ ...base, driverId: 'claude-sdk', profileId: 'cc', tier: 'auto' });
    expect(h.tier).toBe('ask');
    expect(h.tierNotice).toContain('帮我批准不适用');
    expect(instances[0].opened?.tier).toBe('ask');
    await expect(service.open({ ...base, taskId: base.taskId, tier: 'edits' as never })).rejects.toThrow('不支持的权限档位');
  });

  it('提交输入：持久接受后派发，重复提交返回原收据', async () => {
    const { db, service, base, instances } = setup();
    const h = await service.open(base);
    const r1 = await service.submit(h.runId, { clientInputId: 'in-1', text: '你好' });
    expect(r1).toMatchObject({ duplicate: false, status: 'started', nativeTurnId: 'nt-1' });
    const r2 = await service.submit(h.runId, { clientInputId: 'in-1', text: '你好' });
    expect(r2).toMatchObject({ duplicate: true, turnId: r1.turnId });
    expect(instances[0].turns).toHaveLength(1);
    await expect(service.submit(h.runId, { clientInputId: 'in-2', text: '再来' })).rejects.toThrow('上一轮尚未结束');
    expect(db.prepare("SELECT status,error_code FROM agent_turns WHERE client_input_id='in-2'").get()).toEqual({ status: 'canceled', error_code: 'BUSY' });
    instances[0].emit({ type: 'item.completed', nativeItemId: 'm1', itemType: 'agentMessage', payload: { id: 'm1', type: 'agentMessage', text: '你好呀' } });
    instances[0].emit({ type: 'item.completed', nativeItemId: 'm1', itemType: 'agentMessage', payload: { id: 'm1', type: 'agentMessage', text: '你好呀！' } });
    instances[0].emit({ type: 'turn.completed', nativeTurnId: 'nt-1', status: 'completed' });
    expect(db.prepare('SELECT status,native_turn_id FROM agent_turns WHERE turn_id=?').get(r1.turnId)).toEqual({ status: 'completed', native_turn_id: 'nt-1' });
    expect(db.prepare('SELECT ordinal,revision,type,payload_ref FROM agent_items ORDER BY ordinal').all()).toEqual([
      { ordinal: 1, revision: 1, type: 'user_message', payload_ref: JSON.stringify({ text: '你好', sourceKind: 'user' }) },
      { ordinal: 2, revision: 1, type: 'user_message', payload_ref: JSON.stringify({ text: '再来', sourceKind: 'user' }) },
      { ordinal: 3, revision: 2, type: 'assistant_message', payload_ref: JSON.stringify({ text: '你好呀！', phase: null }) },
    ]);
    const seqs = (db.prepare('SELECT seq FROM agent_events ORDER BY seq').all() as { seq: number }[]).map(r => r.seq);
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  });

  it('发送前协议拒绝记失败；超时或断开记未知且不自动重发（A16）', async () => {
    const { db, service, base, instances } = setup();
    const h = await service.open(base);
    instances[0].startError = new DriverError('REJECTED', 'turn/start: bad');
    await expect(service.submit(h.runId, { clientInputId: 'a', text: 'x' })).rejects.toThrow('bad');
    instances[0].startError = new DriverError('TIMEOUT', 'turn/start 超时');
    await expect(service.submit(h.runId, { clientInputId: 'b', text: 'y' })).rejects.toThrow('超时');
    expect(db.prepare('SELECT client_input_id,status,error_code FROM agent_turns ORDER BY accepted_at,rowid').all()).toEqual([
      { client_input_id: 'a', status: 'failed', error_code: 'REJECTED' },
      { client_input_id: 'b', status: 'unknown', error_code: 'TIMEOUT' },
    ]);
    // 同一 clientInputId 不会被当作新输入再次发送
    const again = await service.submit(h.runId, { clientInputId: 'b', text: 'y' });
    expect(again).toMatchObject({ duplicate: true, status: 'unknown' });
  });

  it('原生请求：按来源核对运行与代次，旧代次回应拒绝，运行结束请求退役', async () => {
    const { db, service, base, instances, taskId } = setup();
    const h = await service.open(base);
    await service.submit(h.runId, { clientInputId: 'a', text: 'x' });
    instances[0].emit({ type: 'request', requestKey: '7', kind: 'command_approval', payload: { method: 'item/commandExecution/requestApproval', params: { command: 'git commit' } } });
    const req = db.prepare('SELECT request_id,origin_json,status FROM agent_requests').get() as any;
    expect(JSON.parse(req.origin_json)).toMatchObject({ taskId, runId: h.runId, generation: 1, nativeRequest: '7' });
    await expect(service.respond(req.request_id, { taskId, runId: h.runId, generation: 2, revision: 1 }, { decision: 'accept' })).rejects.toThrow('已结束的运行');
    await expect(service.respond(req.request_id, { taskId, runId: h.runId, generation: 1, revision: 9 }, { decision: 'accept' })).rejects.toThrow('请求已更新');
    await service.respond(req.request_id, { taskId, runId: h.runId, generation: 1, revision: 1 }, { decision: 'accept' });
    expect(instances[0].responses).toEqual([['7', { decision: 'accept' }]]);
    expect(db.prepare('SELECT status FROM agent_requests').get()).toEqual({ status: 'resolved' });
    await expect(service.respond(req.request_id, { taskId, runId: h.runId, generation: 1, revision: 1 }, { decision: 'accept' })).rejects.toThrow('请求已结束');
    // 第二个请求在运行退出时退役，进行中的回合记未知
    instances[0].emit({ type: 'request', requestKey: '8', kind: 'file_approval', payload: {} });
    instances[0].emit({ type: 'exit', code: 1, signal: null });
    expect(db.prepare("SELECT status FROM agent_requests WHERE json_extract(origin_json,'$.nativeRequest')='8'").get()).toEqual({ status: 'retired' });
    expect(db.prepare("SELECT state,error_code FROM capability_runs WHERE run_id=?").get(h.runId)).toEqual({ state: 'failed', error_code: 'EXIT_1' });
    expect(db.prepare("SELECT status,error_code FROM agent_turns").get()).toEqual({ status: 'unknown', error_code: 'RUN_ENDED' });
  });

  it('宿主回应期间原生侧发出的结束通知不把请求记成退役', async () => {
    const { db, service, base, instances, taskId } = setup();
    const h = await service.open(base);
    await service.submit(h.runId, { clientInputId: 'a', text: 'x' });
    instances[0].respond = async (k: string) => { instances[0].emit({ type: 'request.resolved', requestKey: k }); };
    instances[0].emit({ type: 'request', requestKey: '5', kind: 'command_approval', payload: {} });
    const { request_id } = db.prepare('SELECT request_id FROM agent_requests').get() as { request_id: string };
    await service.respond(request_id, { taskId, runId: h.runId, generation: 1, revision: 1 }, { decision: 'decline' });
    expect(db.prepare('SELECT status,decision_ref FROM agent_requests').get()).toEqual({ status: 'resolved', decision_ref: JSON.stringify({ decision: 'decline' }) });
  });

  it('回合结束时本回合挂起的原生请求退役；原生自行结束的请求不算用户回应', async () => {
    const { db, service, base, instances } = setup();
    const h = await service.open(base);
    await service.submit(h.runId, { clientInputId: 'a', text: 'x' });
    instances[0].emit({ type: 'request', requestKey: '1', kind: 'command_approval', payload: {} });
    instances[0].emit({ type: 'request', requestKey: '2', kind: 'command_approval', payload: {} });
    instances[0].emit({ type: 'request.resolved', requestKey: '1' });
    instances[0].emit({ type: 'turn.completed', nativeTurnId: 'nt-1', status: 'interrupted' });
    expect(db.prepare("SELECT json_extract(origin_json,'$.nativeRequest') AS k,status FROM agent_requests ORDER BY k").all()).toEqual([{ k: '1', status: 'retired' }, { k: '2', status: 'retired' }]);
  });

  it.each(['completed', 'forced'] as const)('父回合停止后，继续等待原生子收口或由用户强制停止（%s）', async childEnd => {
    const { store, service, base, instances } = setup();
    const h = await service.open(base);
    const native = instances[0];
    await service.submit(h.runId, { clientInputId: 'parent-input', text: '开始' });
    native.emit({ type: 'node.state', nodeId: 'active-child', state: 'running' });
    await service.interrupt(h.runId, true);
    const stop = service.stopProgress(base.taskId)!;
    native.emit({ type: 'turn.completed', nativeTurnId: 'nt-1', status: 'interrupted' });
    expect(service.stopProgress(base.taskId)).toEqual(stop);
    expect(service.nativeBusy(h.runId)).toBe(true);
    expect(native.closed).toBe(false);
    if (childEnd === 'completed') {
      native.emit({ type: 'node.state', nodeId: 'active-child', state: 'completed' });
      expect(service.stopProgress(base.taskId)).toBeNull();
      expect(native.closed).toBe(false);
      return;
    }
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(stop.forceAt - 1);
      await expect(service.forceStop(base.taskId, h.runId, stop.requestedAt)).rejects.toThrow('仍在等待原生响应');
      clock.mockReturnValue(stop.forceAt);
      expect(native.closed).toBe(false);
      await service.forceStop(base.taskId, h.runId, stop.requestedAt);
      expect(native.closed).toBe(true);
      expect(store.run(h.runId)?.state).toBe('stopped');
      expect(service.stopProgress(base.taskId)).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });

  it('正常关闭：运行记 stopped；打开失败记 failed 且不留在线运行', async () => {
    const { db, service, base, instances } = setup();
    const h = await service.open(base);
    await service.close(h.runId);
    expect(instances[0].closed).toBe(true);
    expect(db.prepare('SELECT state,error_code,ended_at IS NOT NULL AS e FROM capability_runs WHERE run_id=?').get(h.runId)).toEqual({ state: 'stopped', error_code: null, e: 1 });
    const drivers = (service as any).deps.drivers as Map<DriverId, AgentDriver>;
    drivers.set('codex-app-server', { id: 'codex-app-server', command: 'codex', create: () => { const i = new ScriptedInstance('codex-app-server'); i.open = async () => { throw new DriverError('EXITED', '无法启动 Codex'); }; return i; } });
    await expect(service.open(base)).rejects.toThrow('无法启动 Codex');
    expect(db.prepare("SELECT state,error_code FROM capability_runs WHERE generation=2").get()).toEqual({ state: 'failed', error_code: 'EXITED' });
    expect(service.active(h.runId)).toBeUndefined();
  });

  it('NR02：打开失败但原生进程已启动且未退出时保留占用，不准同任务新开运行', async () => {
    const { db, service, base } = setup();
    const drivers = (service as any).deps.drivers as Map<DriverId, AgentDriver>;
    drivers.set('codex-app-server', { id: 'codex-app-server', command: 'codex', create: () => { const i = new ScriptedInstance('codex-app-server'); i.open = async () => { i.emit({ type: 'process', pid: 555 }); throw new DriverError('PROTOCOL', 'thread 响应缺少 id'); }; i.close = async () => {}; return i; } });
    await expect(service.open(base)).rejects.toThrow('thread 响应缺少 id');
    expect(db.prepare('SELECT state FROM capability_runs').get()).toEqual({ state: 'stopping' });
    await expect(service.open(base)).rejects.toThrow('上一运行仍在退出');
  });

  it('已归档任务与旧任务不能打开运行', async () => {
    const { db, service, base } = setup();
    db.prepare("UPDATE agent_tasks SET archived_at='2026-11-17' WHERE task_id=?").run(base.taskId);
    await expect(service.open(base)).rejects.toThrow('任务已归档');
    db.exec("INSERT INTO tasks(id,cwd,runner,title,created_at,updated_at) VALUES('legacy','/w','claude','旧任务',1,1)");
    await expect(service.open({ ...base, taskId: 'legacy' })).rejects.toThrow('不是新任务');
  });
});
