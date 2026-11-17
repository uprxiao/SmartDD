import { describe, expect, it } from 'vitest';
import type { DriverEvent } from '../driver';
import { FakeAppServer, FakeChild, until } from '../test-doubles';
import { CodexAppServerInstance } from './codex-app-server';

const exe = { path: '/opt/codex', version: '0.169.0' };
function setup(extra?: (msg: any, s: FakeAppServer) => boolean) {
  const child = new FakeChild();
  let spawned: { command: string; args: string[]; options: any } | undefined;
  let turn = 0;
  const server = new FakeAppServer(child, (msg, s) => {
    if (extra?.(msg, s)) return;
    if (msg.method === 'initialize') s.reply(msg.id, { userAgent: 'fake' });
    else if (msg.method === 'thread/start') s.reply(msg.id, { thread: { id: 'thr-1' } });
    else if (msg.method === 'thread/resume') s.reply(msg.id, { thread: { id: msg.params.threadId } });
    else if (msg.method === 'turn/start') { const id = `turn-${++turn}`; s.notify('turn/started', { threadId: 'thr-1', turn: { id } }); s.reply(msg.id, { turn: { id } }); }
    else if (msg.method === 'turn/interrupt') { s.reply(msg.id, {}); s.notify('turn/completed', { threadId: 'thr-1', turn: { id: msg.params.turnId, status: 'interrupted' } }); }
  });
  const inst = new CodexAppServerInstance((command, args, options) => { spawned = { command, args, options }; return child.asChild(); });
  const events: DriverEvent[] = [];
  inst.on(e => events.push(e));
  return { child, server, inst, events, spawned: () => spawned! };
}

describe('Codex app-server 驱动', () => {
  it('初始化握手后新建线程，并按档位下发线程参数', async () => {
    const { inst, server, events, spawned } = setup();
    const r = await inst.open({ executable: exe, cwd: '/w', env: { PATH: '/bin' }, tier: 'ask', model: 'gpt-x', extraArgs: ['--disable', 'plugins'] });
    expect(r).toEqual({ nativeId: 'thr-1', confirmed: true });
    expect(spawned()).toMatchObject({ command: '/opt/codex', args: ['app-server', '--disable', 'plugins'], options: { cwd: '/w', env: { PATH: '/bin' } } });
    expect(server.received.map(m => m.method)).toEqual(['initialize', 'initialized', 'thread/start', 'skills/list']);
    expect(server.calls('thread/start')[0].params).toEqual({ cwd: '/w', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write', model: 'gpt-x' });
    expect(events).toContainEqual({ type: 'process', pid: 4242 });
    expect(events).toContainEqual({ type: 'session', nativeId: 'thr-1' });
  });

  it('每轮 turn/start 显式下发 reviewer=user，恢复的线程同样重新下发（A63）', async () => {
    const { inst, server } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', resumeNativeId: 'thr-old' });
    expect(server.calls('thread/resume')[0].params).toMatchObject({ threadId: 'thr-old', approvalsReviewer: 'user', approvalPolicy: 'on-request', excludeTurns: true });
    const t = await inst.startTurn({ clientInputId: 'in-1', text: '你好', tier: 'ask' });
    expect(t).toEqual({ nativeTurnId: 'turn-1' });
    const start = server.calls('turn/start')[0].params;
    expect(start).toMatchObject({ threadId: 'thr-old', clientUserMessageId: 'in-1', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandboxPolicy: { type: 'workspaceWrite' } });
    expect(start.input).toEqual([{ type: 'text', text: '你好', text_elements: [] }]);
  });

  it('完全访问与帮我批准的回合参数', async () => {
    const { inst, server } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'full' });
    expect(server.calls('thread/start')[0].params).toMatchObject({ approvalPolicy: 'never', sandbox: 'danger-full-access' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'auto' });
    expect(server.calls('turn/start')[0].params).toMatchObject({ approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', sandboxPolicy: { type: 'workspaceWrite' } });
  });

  it('流式增量、条目完成与回合终态', async () => {
    const { inst, server, events } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    server.notify('item/agentMessage/delta', { itemId: 'm1', delta: '你', turnId: 'turn-1' });
    server.notify('item/completed', { turnId: 'turn-1', item: { id: 'm1', type: 'agentMessage', text: '你好' } });
    server.notify('turn/completed', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'completed' } });
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(events.filter(e => e.type === 'turn.started')).toEqual([{ type: 'turn.started', nativeTurnId: 'turn-1', clientInputId: 'a' }]);
    expect(events).toContainEqual({ type: 'message.delta', nativeItemId: 'm1', text: '你' });
    expect(events).toContainEqual({ type: 'item.completed', nativeItemId: 'm1', itemType: 'agentMessage', payload: { id: 'm1', type: 'agentMessage', text: '你好' } });
    expect(events).toContainEqual({ type: 'turn.completed', nativeTurnId: 'turn-1', status: 'completed' });
    // 下一轮可以开始
    await inst.startTurn({ clientInputId: 'b', text: 'y', tier: 'ask' });
  });

  it('服务端审批请求原样转交并按原 id 回应；宿主不代办的请求明确拒绝', async () => {
    const { inst, server, events } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    server.request(7, 'item/commandExecution/requestApproval', { command: 'git commit', reason: '写 .git' });
    server.request(8, 'account/chatgptAuthTokens/refresh', {});
    await until(() => events.some(e => e.type === 'request'));
    expect(events).toContainEqual({ type: 'request', requestKey: '7', kind: 'command_approval', payload: { method: 'item/commandExecution/requestApproval', params: { command: 'git commit', reason: '写 .git' } } });
    await until(() => server.received.some(m => m.id === 8));
    expect(server.received.find(m => m.id === 8)).toMatchObject({ error: { code: -32601 } });
    await inst.respond('7', { decision: 'acceptForSession' });
    await until(() => server.received.some(m => m.id === 7 && m.result));
    expect(server.received.find(m => m.id === 7)).toEqual({ id: 7, result: { decision: 'acceptForSession' } });
    await expect(inst.respond('7', { decision: 'accept' })).rejects.toThrow('请求已结束');
    // 宿主回应后原生侧随后的 serverRequest/resolved 不再当作原生自行结束
    server.notify('serverRequest/resolved', { requestId: 7 });
    server.request(9, 'item/fileChange/requestApproval', {});
    await until(() => events.some(e => e.type === 'request' && e.requestKey === '9'));
    server.notify('serverRequest/resolved', { requestId: 9 });
    await until(() => events.some(e => e.type === 'request.resolved'));
    expect(events.filter(e => e.type === 'request.resolved')).toEqual([{ type: 'request.resolved', requestKey: '9' }]);
  });

  it('发送即停止：原生开始信号到达后立即中断一次', async () => {
    let hold: ((v: unknown) => void) | undefined;
    const { inst, server, events } = setup((msg, s) => {
      if (msg.method !== 'turn/start') return false;
      hold = () => { s.notify('turn/started', { turn: { id: 'turn-9' } }); s.reply(msg.id, { turn: { id: 'turn-9' } }); };
      return true;
    });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    const started = inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await until(() => !!hold);
    await inst.interrupt(); // 还没开始：只记下待停止
    expect(server.calls('turn/interrupt')).toHaveLength(0);
    hold!(undefined);
    await started;
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(server.calls('turn/interrupt')).toEqual([expect.objectContaining({ params: { threadId: 'thr-1', turnId: 'turn-9' } })]);
    expect(events.find(e => e.type === 'turn.completed')).toMatchObject({ status: 'interrupted' });
  });

  it('进程中途退出：在途调用失败、当前回合记失败并发出退出事件', async () => {
    const { inst, child, events } = setup((msg) => msg.method === 'turn/start' ? (setImmediate(() => child.exit(1)), true) : false);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await expect(inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' })).rejects.toThrow(/已退出/);
    expect(events).toContainEqual({ type: 'exit', code: 1, signal: null });
  });

  it('插话带 expectedTurnId；目标设定／暂停／清除带用户来源并转发原生目标更新', async () => {
    const { inst, server, events } = setup((msg, s) => {
      if (msg.method === 'turn/steer' || msg.method === 'thread/goal/set' || msg.method === 'thread/goal/clear') { s.reply(msg.id, {}); return true; }
      return false;
    });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await expect(inst.steer({ clientInputId: 's0', text: 'x', tier: 'ask' })).rejects.toThrow('没有进行中的回合');
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await inst.steer({ clientInputId: 's1', text: '顺便', tier: 'ask' });
    expect(server.calls('turn/steer')[0].params).toEqual({ threadId: 'thr-1', expectedTurnId: 'turn-1', clientUserMessageId: 's1', input: [{ type: 'text', text: '顺便', text_elements: [] }] });
    expect(events).toContainEqual({ type: 'steer.accepted', clientInputId: 's1', nativeTurnId: 'turn-1' });
    await inst.goal({ kind: 'set', objective: '全部通过' });
    await inst.goal({ kind: 'pause' });
    await inst.goal({ kind: 'clear' });
    expect(server.calls('thread/goal/set').map(m => m.params)).toEqual([{ threadId: 'thr-1', origin: 'user', objective: '全部通过', status: 'active' }, { threadId: 'thr-1', origin: 'user', status: 'paused' }]);
    expect(server.calls('thread/goal/clear')[0].params).toEqual({ threadId: 'thr-1', origin: 'user' });
    server.notify('thread/goal/updated', { threadId: 'thr-1', goal: { objective: '全部通过', status: 'usageLimited', timeUsedSeconds: 30 } });
    server.notify('thread/goal/cleared', { threadId: 'thr-1' });
    await until(() => events.filter(e => e.type === 'goal').length === 2);
    expect(events.filter(e => e.type === 'goal')).toEqual([{ type: 'goal', objective: '全部通过', status: 'limited', timeUsedSeconds: 30 }, { type: 'goal', objective: null, status: 'cleared' }]);
  });

  it('打开后公布命令与 Skill 目录；compact／review 走协议', async () => {
    const { inst, server, events } = setup((msg, s) => {
      if (msg.method === 'skills/list') { s.reply(msg.id, { data: [{ cwd: '/w', errors: [], skills: [{ name: 'pdf', description: 'PDF 工具', enabled: true }, { name: 'off', enabled: false }] }] }); return true; }
      if (msg.method === 'thread/compact/start' || msg.method === 'review/start') { s.reply(msg.id, {}); return true; }
      return false;
    });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await until(() => events.some(e => e.type === 'catalog'));
    expect(events.find(e => e.type === 'catalog')).toEqual({ type: 'catalog', commands: ['goal', 'compact', 'review'], skills: [{ name: 'pdf', description: 'PDF 工具' }] });
    await inst.command('compact'); await inst.command('review');
    expect(server.calls('thread/compact/start')[0].params).toEqual({ threadId: 'thr-1' });
    expect(server.calls('review/start')[0].params).toEqual({ threadId: 'thr-1', target: { type: 'uncommittedChanges' } });
  });

  it('原生自行开始的回合（目标续跑）不认领上一条用户输入', async () => {
    const { inst, server, events } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    server.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    server.notify('turn/started', { turn: { id: 'goal-turn' } });
    await until(() => events.filter(e => e.type === 'turn.started').length === 2);
    expect(events.filter(e => e.type === 'turn.started').at(-1)).toEqual({ type: 'turn.started', nativeTurnId: 'goal-turn', clientInputId: '' });
    await expect(inst.startTurn({ clientInputId: 'b', text: 'y', tier: 'ask' })).rejects.toThrow('上一轮尚未结束');
  });

  it('关闭以真实退出为准：忽略 SIGTERM 时升级 SIGKILL；仍不退出则不发 exit（复核 CR04）', async () => {
    for (const mode of ['ignores-term', 'never-exits'] as const) {
      const child = new FakeChild();
      const signals: string[] = [];
      child.kill = (sig: NodeJS.Signals = 'SIGTERM') => { signals.push(sig); if (mode === 'ignores-term' && sig === 'SIGKILL') child.exit(null, 'SIGKILL'); return true; };
      new FakeAppServer(child, (msg, s) => { if (msg.method === 'initialize') s.reply(msg.id, {}); else if (msg.method === 'thread/start') s.reply(msg.id, { thread: { id: 't' } }); });
      child.stdin.removeAllListeners('finish');
      const inst = new CodexAppServerInstance(() => child.asChild(), 20);
      const events: DriverEvent[] = []; inst.on(e => events.push(e));
      await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
      await inst.close();
      expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
      expect(events.some(e => e.type === 'exit')).toBe(mode === 'ignores-term');
    }
  });

  it('线程响应缺少 id 判协议错误', async () => {
    const { inst } = setup((msg, s) => msg.method === 'thread/start' ? (s.reply(msg.id, {}), true) : false);
    await expect(inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' })).rejects.toThrow('thread 响应缺少 id');
  });
});
