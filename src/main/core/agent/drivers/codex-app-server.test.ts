import { describe, expect, it } from 'vitest';
import type { DriverEvent } from '../driver';
import { FakeAppServer, FakeChild, until } from '../test-doubles';
import { CodexAppServerInstance } from './codex-app-server';

const exe = { path: '/opt/codex', version: '0.169.0' };
function setup(extra?: (msg: any, s: FakeAppServer) => boolean) {
  const child = new FakeChild();
  let spawned: { command: string; args: string[]; options: any } | undefined;
  let turn = 0, threadId = 'thr-1';
  const server = new FakeAppServer(child, (msg, s) => {
    if (extra?.(msg, s)) return;
    if (msg.method === 'initialize') s.reply(msg.id, { userAgent: 'fake' });
    else if (msg.method === 'thread/start') s.reply(msg.id, { thread: { id: 'thr-1' } });
    else if (msg.method === 'thread/resume') { threadId = msg.params.threadId; s.reply(msg.id, { thread: { id: threadId } }); }
    else if (msg.method === 'turn/start') { const id = `turn-${++turn}`; s.notify('turn/started', { threadId, turn: { id } }); s.reply(msg.id, { turn: { id } }); }
    else if (msg.method === 'turn/interrupt') { s.reply(msg.id, {}); s.notify('turn/completed', { threadId, turn: { id: msg.params.turnId, status: 'interrupted' } }); }
  });
  const inst = new CodexAppServerInstance((command, args, options) => { spawned = { command, args, options }; return child.asChild(); });
  const events: DriverEvent[] = [];
  inst.on(e => events.push(e));
  return { child, server, inst, events, spawned: () => spawned! };
}

describe('Codex app-server 驱动', () => {
  it('uses the same verified account directory on the first turn and discovers a different account independently', async () => {
    const cache = new Map<string, Awaited<ReturnType<CodexAppServerInstance['modelCatalog']>>>();
    for (const [accountId, expectedQueries] of [['a', 1], ['a', 0], ['b', 1]] as const) {
      const f = setup((m, s) => {
        if (m.method === 'account/read') {
          expect(m.params).toEqual({ refreshToken: false });
          s.reply(m.id, { account: { type: 'chatgpt', accountId } });
        } else if (m.method === 'model/list') {
          s.reply(m.id, { data: [{ model: accountId, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }] });
        } else return false;
        return true;
      });
      await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask',
        modelCache: { read: id => cache.get(id), write: (id, rows) => { cache.set(id, rows); } } });
      expect((await f.inst.modelCatalog())[0]).toMatchObject({id:accountId, efforts:['medium']});
      expect(f.server.calls('account/read')).toHaveLength(1);
      expect(f.server.calls('model/list')).toHaveLength(expectedQueries);
    }
  });
  it('accepts a native catalogue after the five-second network fallback and follows visible pages', async () => {
    const f = setup((m, s) => {
      if (m.method !== 'model/list') return false;
      if (!m.params.cursor) {
        setTimeout(() => s.reply(m.id, { data: [{ model: 'first' }], nextCursor: 'second' }), 5050);
      } else {
        s.reply(m.id, { data: [{ model: 'first' }, { model: 'sol', isDefault: true, supportedReasoningEfforts: [{ reasoningEffort: 'medium' }] }], nextCursor: null });
      }
      return true;
    });
    await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    const models = await f.inst.modelCatalog();
    expect(models.map(model => model.id)).toEqual(['first', 'sol']);
    expect(models[1]).toMatchObject({ isDefault: true, efforts: ['medium'] });
    expect(f.server.calls('model/list').every(call => !call.params.includeHidden)).toBe(true);
  }, 9000);

  it('recovers from a temporary native refresh failure without accepting the built-in fallback as final', async () => {
    let calls = 0;
    const f = setup((m, s) => {
      if (m.method !== 'model/list') return false;
      if (++calls === 1) {
        f.child.stderr.write('codex_models_manager::manager: failed to refresh available models: request timed out\n');
        s.reply(m.id, { data: [{ model: 'fallback' }] });
      } else {
        s.reply(m.id, { data: [{ model: 'account-model' }] });
      }
      return true;
    });
    await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    expect((await f.inst.modelCatalog()).map(model => model.id)).toEqual(['account-model']);
    expect(calls).toBe(2);
  });
  it.each(['form', 'url'])('A09 accepts only cancel for a native MCP %s request', async mode => {
    const { inst, server, events } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    server.request(901, 'mcpServer/elicitation/request', { threadId: 'thr-1', mode });
    await until(() => events.some(e => e.type === 'request' && e.requestKey === '901' && e.kind === 'elicitation'));
    await expect(inst.respond('901', { action: 'accept', content: {} })).rejects.toThrow('只能取消');
    await expect(inst.respond('901', { action: 'cancel', content: {} })).rejects.toThrow('只能取消');
    expect(server.received.some(m => m.id === 901)).toBe(false);
    await inst.respond('901', { action: 'cancel' });
    await until(() => server.received.some(m => m.id === 901));
    expect(server.received.find(m => m.id === 901)?.result).toEqual({ action: 'cancel', content: null, _meta: null });
    await expect(inst.respond('901', { action: 'cancel' })).rejects.toThrow('已结束');
  });

  it.each(['thread/start', 'thread/resume'] as const)('保留宿主批准的 CLI 权限配置，同时保留原生审批档位（%s）', async method => {
    const f = setup();
    const permissions = 'wy_cli_abcdef012345';
    await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', codexCliPermissions: permissions, ...(method === 'thread/resume' ? { resumeNativeId: 'resumed' } : {}) });
    const params = f.server.calls(method)[0].params;
    expect(params).toMatchObject({ permissions, approvalPolicy: 'on-request', approvalsReviewer: 'user' });
    expect(params).not.toHaveProperty('sandbox');
    for (const [i, tier] of (['ask', 'full', 'auto'] as const).entries()) {
      await f.inst.startTurn({ clientInputId: tier, text: 'work', tier });
      f.server.notify('turn/completed', { threadId: method === 'thread/resume' ? 'resumed' : 'thr-1', turn: { id: `turn-${i + 1}`, status: 'completed' } });
      await until(() => f.events.filter(event => event.type === 'turn.completed').length === i + 1);
    }
    expect(f.server.calls('turn/start').map(call => call.params)).toMatchObject([
      { approvalPolicy: 'on-request', approvalsReviewer: 'user', permissions },
      { approvalPolicy: 'never', approvalsReviewer: 'user', sandboxPolicy: { type: 'dangerFullAccess' } },
      { approvalPolicy: 'on-request', approvalsReviewer: 'auto_review', permissions },
    ]);
    expect(f.server.calls('turn/start')[0].params).not.toHaveProperty('sandboxPolicy');
    expect(f.server.calls('turn/start')[1].params).not.toHaveProperty('permissions');
    expect(f.server.calls('turn/start')[2].params).not.toHaveProperty('sandboxPolicy');
  });

  it('starts in full access and selects the preloaded restricted profile on downgrade', async () => {
    const f = setup();
    const permissions = 'wy_cli_abcdef012345';
    await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'full', codexCliPermissions: permissions });
    expect(f.server.calls('thread/start')[0].params).toMatchObject({ sandbox: 'danger-full-access', approvalPolicy: 'never' });
    expect(f.server.calls('thread/start')[0].params).not.toHaveProperty('permissions');
    await f.inst.startTurn({ clientInputId: 'ask', text: 'work', tier: 'ask' });
    expect(f.server.calls('turn/start')[0].params).toMatchObject({ permissions, approvalPolicy: 'on-request', approvalsReviewer: 'user' });
    expect(f.server.calls('turn/start')[0].params).not.toHaveProperty('sandboxPolicy');
  });

  it('sends an explicit legacy turn sandbox on earlier versions', async () => {
    const f = setup();
    const permissions = 'wy_cli_abcdef012345';
    await f.inst.open({ executable: { ...exe, version: '0.167.1' }, cwd: '/w', env: {}, tier: 'ask', codexCliPermissions: permissions });
    expect(f.server.calls('thread/start')[0].params).toMatchObject({ permissions });
    await f.inst.startTurn({ clientInputId: 'ask', text: 'work', tier: 'ask' });
    expect(f.server.calls('turn/start')[0].params).toMatchObject({ sandboxPolicy: { type: 'workspaceWrite' }, approvalPolicy: 'on-request' });
    expect(f.server.calls('turn/start')[0].params).not.toHaveProperty('permissions');
  });

  it('A33: host read role overrides even full access every turn and refuses write escalation without an approval option', async () => {
    const f = setup(); await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'full', readOnly: true, codexCliPermissions: 'wy_cli_abcdef012345' });
    expect(f.server.calls('thread/start')[0].params).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only' });
    expect(f.server.calls('thread/start')[0].params).not.toHaveProperty('permissions');
    expect(f.spawned().args).toContain('features.hooks=false');
    await f.inst.startTurn({ clientInputId: 'read', text: 'inspect', tier: 'full' });
    expect(f.server.calls('turn/start')[0].params).toMatchObject({ approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } });
    f.server.request(800, 'item/permissions/requestApproval', { threadId: 'thr-1' });
    await until(() => f.server.received.some(m => m.id === 800 && m.error));
    expect(f.events.some(e => e.type === 'request' && e.requestKey === '800')).toBe(false);
  });
  it('M14 A29: child and foreign thread notifications cannot start/end the parent; only registered child requests keep their node scope', async () => {
    const { inst, server, events } = setup(); await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'parent', text: 'work', tier: 'ask' });
    server.notify('item/started', { threadId: 'thr-1', item: { type: 'collabAgentToolCall', id: 'spawn', senderThreadId: 'thr-1', receiverThreadIds: ['child'], agentsStates: { child: { status: 'running' } } } });
    server.notify('turn/started', { threadId: 'child', turn: { id: 'child-round' } });
    server.notify('turn/completed', { threadId: 'child', turn: { id: 'child-round', status: 'completed' } });
    server.notify('turn/completed', { threadId: 'foreign', turn: { id: 'foreign-round', status: 'completed' } });
    server.request(500, 'item/commandExecution/requestApproval', { threadId: 'child' }); server.request(501, 'item/commandExecution/requestApproval', { threadId: 'foreign' });
    await until(() => events.some(e => e.type === 'request' && e.requestKey === '500'));
    expect(events.filter(e => e.type === 'turn.started')).toHaveLength(1); expect(events.filter(e => e.type === 'turn.completed')).toHaveLength(0);
    expect(events.find(e => e.type === 'request' && e.requestKey === '500')).toMatchObject({ nodeId: 'child' }); expect(events.some(e => e.type === 'request' && e.requestKey === '501')).toBe(false);
    await expect(inst.nativeChildHistory('foreign')).rejects.toThrow('本运行');
  });
  it('M14 A70: recovery pauses an active persisted goal before thread/resume and never creates a model turn', async () => {
    const { inst, server } = setup((m, s) => { if (m.method === 'thread/goal/get') { s.reply(m.id, { goal: { objective: 'goal', status: 'active', createdAt: 1, updatedAt: 2 } }); return true; } if (m.method === 'thread/goal/set') { s.reply(m.id, {}); return true; } return false; });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', resumeNativeId: 'thr-old', recoverGoals: true });
    const methods = server.received.map(m => m.method); expect(methods.indexOf('thread/goal/set')).toBeLessThan(methods.indexOf('thread/resume'));
    expect(server.calls('thread/goal/set')[0].params.status).toBe('paused'); expect(server.calls('turn/start')).toHaveLength(0);
  });
  it('历史追加走已公布的 thread/inject_items，不发 turn/start，不更改后续用户文字', async () => {
    const { inst, server } = setup((msg, s) => { if (msg.method === 'thread/inject_items') { s.reply(msg.id, {}); return true; } return false; });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.injectHistory('历史事实，不是新的真人授权');
    expect(server.calls('turn/start')).toHaveLength(0);
    expect(server.calls('thread/inject_items')[0].params.items[0]).toMatchObject({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '历史事实，不是新的真人授权' }] });
    await inst.startTurn({ clientInputId: 'next', text: '原始输入', tier: 'ask', effort: 'high' });
    expect(server.calls('turn/start')[0].params).toMatchObject({ effort: 'high', input: [{ type: 'text', text: '原始输入', text_elements: [] }] });
  });
  it('初始化握手后新建线程，并按档位下发线程参数', async () => {
    const { inst, server, events, spawned } = setup();
    const r = await inst.open({ executable: exe, cwd: '/w', env: { PATH: '/bin' }, tier: 'ask', model: 'gpt-x', extraArgs: ['--disable', 'plugins'] });
    expect(r).toEqual({ nativeId: 'thr-1', confirmed: true });
    expect(spawned()).toMatchObject({ command: '/opt/codex', args: ['app-server', '--disable', 'plugins'], options: { cwd: '/w', env: { PATH: '/bin' } } });
    expect(server.received.map(m => m.method)).toEqual(['initialize', 'initialized', 'thread/start', 'skills/list']);
    expect(server.calls('thread/start')[0].params).toEqual({ cwd: '/w', approvalPolicy: 'on-request', approvalsReviewer: 'user', sandbox: 'workspace-write' });
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

  it('A59 ignores Codex deltas after the same item finalizes and from an earlier native turn', async () => {
    const { inst, server, events } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'first', text: 'first', tier: 'ask' });
    server.notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first-item', delta: 'first prefix' });
    server.notify('item/completed', { turnId: 'turn-1', item: { id: 'first-item', type: 'agentMessage', text: 'first complete' } });
    server.notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first-item', delta: 'late after final' });
    server.notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'other-item', delta: 'other active item' });
    server.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } });
    await until(() => events.some(event => event.type === 'turn.completed'));
    await inst.startTurn({ clientInputId: 'next', text: 'next', tier: 'ask' });
    server.notify('item/agentMessage/delta', { turnId: 'turn-1', itemId: 'first-item', delta: 'late after next start' });
    server.notify('item/agentMessage/delta', { turnId: 'turn-2', itemId: 'next-item', delta: 'next prefix' });
    await until(() => events.some(event => event.type === 'message.delta' && event.nativeItemId === 'next-item'));
    expect(events.filter(event => event.type === 'message.delta').map(event => event.text))
      .toEqual(['first prefix', 'other active item', 'next prefix']);
    expect(events.filter(event => event.type === 'item.completed')).toEqual([
      { type: 'item.completed', nativeItemId: 'first-item', itemType: 'agentMessage', payload: { id: 'first-item', type: 'agentMessage', text: 'first complete' } },
    ]);
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
    let releaseStart: (() => void) | undefined;
    const { inst, server, events } = setup((msg, s) => {
      if (msg.method === 'turn/interrupt') return true;
      if (msg.method !== 'turn/start') return false;
      releaseStart = () => {
        s.notify('turn/started', { turn: { id: 'turn-9' } });
        s.reply(msg.id, { turn: { id: 'turn-9' } });
      };
      return true;
    });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    const started = inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await until(() => !!releaseStart);
    await inst.interrupt(); // 还没开始：只记下待停止
    expect(server.calls('turn/interrupt')).toHaveLength(0);
    releaseStart!();
    await started;
    // 派发成功后的宿主停止检查可以在原生中断回执抵达前再次要求停止。
    const dispatchStop = inst.interrupt();
    await until(() => server.calls('turn/interrupt').length > 0);
    for (const call of server.calls('turn/interrupt')) server.reply(call.id, {});
    await dispatchStop;
    // 中断回执先到，终态尚未到时也复用原请求。
    const acknowledgedStop = inst.interrupt();
    for (const call of server.calls('turn/interrupt').slice(1)) server.reply(call.id, {});
    await acknowledgedStop;
    server.notify('turn/completed', { turn: { id: 'turn-9', status: 'interrupted' } });
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(server.calls('turn/interrupt')).toEqual([expect.objectContaining({ params: { threadId: 'thr-1', turnId: 'turn-9' } })]);
    expect(events.find(e => e.type === 'turn.completed')).toMatchObject({ status: 'interrupted' });

    server.notify('turn/started', { turn: { id: 'turn-10' } });
    await until(() => events.some(e => e.type === 'turn.started' && e.nativeTurnId === 'turn-10'));
    for (const call of server.calls('turn/interrupt').slice(1)) server.reply(call.id, {});
    expect(server.calls('turn/interrupt')).toHaveLength(1);
  });

  it('原生拒绝中断后仍可按原回合重试', async () => {
    const { inst, server, events } = setup((msg, s) => {
      if (msg.method !== 'turn/interrupt' || s.calls(msg.method).length > 1) return false;
      s.send({ id: msg.id, error: { code: -32000, message: 'temporarily unavailable' } });
      return true;
    });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await inst.interrupt();
    expect(events.some(e => e.type === 'diagnostic' && e.message.includes('temporarily unavailable'))).toBe(true);
    await inst.interrupt();
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(server.calls('turn/interrupt').map(call => call.params.turnId)).toEqual(['turn-1', 'turn-1']);
  });

  it('进程中途退出：在途调用失败、当前回合记失败并发出退出事件', async () => {
    const { inst, child, events } = setup((msg) => msg.method === 'turn/start' ? (setImmediate(() => child.exit(1)), true) : false);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await expect(inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' })).rejects.toThrow(/已退出/);
    expect(events).toContainEqual({ type: 'exit', code: 1, signal: null });
  });

  it.each([true,false])('A05 keeps the visible round status when exit precedes the interrupt reply (requested: %s)', async stopped => {
    const {inst,child,server,events}=setup(msg=>msg.method==='turn/interrupt');
    await inst.open({executable:exe,cwd:'/w',env:{},tier:'ask'});
    await inst.startTurn({clientInputId:'a',text:'work',tier:'ask'});
    const stopping=stopped ? inst.interrupt() : undefined;
    if(stopping)await until(()=>server.calls('turn/interrupt').length===1);
    child.exit(stopped?0:1);
    await stopping;
    expect(events.find(e=>e.type==='turn.completed')).toMatchObject({nativeTurnId:'turn-1',status:stopped?'interrupted':'failed'});
  });

  it('插话带 expectedTurnId；目标设定／暂停／清除带用户来源并转发原生目标更新', async () => {
    const { inst, server, events } = setup((msg, s) => {
      if (msg.method === 'turn/steer') { s.reply(msg.id, { turnId: 'turn-1' }); return true; }
      if (msg.method === 'thread/goal/set' || msg.method === 'thread/goal/clear') { s.reply(msg.id, {}); return true; }
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

  it.each([null, {}, { turnId: 'different-turn' }])('A55 does not acknowledge a steer without the original turn receipt: %j', async receipt => {
    const { inst, events } = setup((msg, server) => {
      if (msg.method !== 'turn/steer') return false;
      server.reply(msg.id, receipt);
      return true;
    });
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'first', text: 'Initial input', tier: 'ask' });
    await expect(inst.steer({ clientInputId: 'side-input', text: 'Additional input', tier: 'ask' })).rejects.toMatchObject({ code: 'PROTOCOL' });
    expect(events.some(event => event.type === 'steer.accepted')).toBe(false);
    await inst.close();
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

  it('NR09：未知的必需请求明确拒绝并标不支持，不转成待批准请求', async () => {
    const { inst, server, events } = setup();
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    server.request(41, 'future/required', { x: 1 });
    await until(() => server.received.some(m => m.id === 41));
    expect(server.received.find(m => m.id === 41)).toMatchObject({ error: { code: -32601 } });
    expect(events.some(e => e.type === 'request')).toBe(false);
    expect(events).toContainEqual({ type: 'native', name: 'request/unsupported', payload: { method: 'future/required' } });
  });

  it('FR03：新线程不带模型打开并报告原生默认；恢复的线程按需从配置／模型目录读取默认', async () => {
    const a = setup((m, s) => { if (m.method === 'thread/start') { s.reply(m.id, { thread: { id: 'thr-1' }, model: 'native-default' }); return true; } return false; });
    const r = await a.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', model: 'explicit' });
    expect(r).toEqual({ nativeId: 'thr-1', confirmed: true, defaultModel: 'native-default' });
    expect(a.server.calls('thread/start')[0].params.model).toBeUndefined();
    const b = setup((m, s) => {
      if (m.method === 'config/read') { s.reply(m.id, { config: { model: null } }); return true; }
      if (m.method === 'model/list') { s.reply(m.id, { data: [{ id: 'x', model: 'x', isDefault: false }, { id: 'd', model: 'gpt-default', isDefault: true }] }); return true; }
      return false;
    });
    const rb = await b.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', resumeNativeId: 'thr-old', model: 'sticky' });
    expect(rb.defaultModel).toBeUndefined();
    expect(b.server.calls('thread/resume')[0].params.model).toBe('sticky');
    expect(await b.inst.defaultModel()).toBe('gpt-default');
    expect(b.server.calls('config/read')[0].params).toEqual({ cwd: '/w' });
  });

  it('retains the native default when an older catalogue supplies only its id', async () => {
    const f = setup((m, s) => {
      if (m.method === 'config/read') { s.reply(m.id, { config: {} }); return true; }
      if (m.method === 'model/list') { s.reply(m.id, { data: [{ id: 'legacy-default', isDefault: true }] }); return true; }
      return false;
    });
    await f.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', resumeNativeId: 'old-thread' });
    expect(await f.inst.defaultModel()).toBe('legacy-default');
  });

  it('线程响应缺少 id 判协议错误', async () => {
    const { inst } = setup((msg, s) => msg.method === 'thread/start' ? (s.reply(msg.id, {}), true) : false);
    await expect(inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' })).rejects.toThrow('thread 响应缺少 id');
  });
});
