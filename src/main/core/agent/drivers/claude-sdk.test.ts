import { describe, expect, it } from 'vitest';
import type { DriverEvent } from '../driver';
import { until } from '../test-doubles';
import { ClaudeSdkInstance, type SdkQuery, type SdkQueryFn } from './claude-sdk';

const exe = { path: '/Users/me/.local/bin/claude', version: '2.1.326' };
type Turn = (ctx: { options: any; emit: (m: any) => void; ask: (tool: string, input: any) => Promise<any>; interrupted: () => boolean }) => Promise<void>;

/** SDK 替身：读取流式输入，每条用户消息按脚本产生消息；记录 options 与权限模式切换。 */
function fakeSdk(turns: Turn[]) {
  const state = { options: undefined as any, modes: [] as string[], interrupts: 0, closed: false, prompts: [] as any[] };
  const fn: SdkQueryFn = ({ prompt, options }) => {
    state.options = options;
    const out: any[] = []; const waiters: ((v: IteratorResult<any>) => void)[] = []; let done = false; let interrupted = false;
    const emit = (m: any) => { const w = waiters.shift(); if (w) w({ value: m, done: false }); else out.push(m); };
    (async () => {
      let n = 0;
      for await (const msg of prompt) {
        state.prompts.push(msg);
        if (n === 0) emit({ type: 'system', subtype: 'init', session_id: options.resume ?? options.sessionId, slash_commands: ['compact', 'init', 'statusline', 'pdf'], terminal_slash_commands: ['statusline'], skills: ['pdf'] });
        interrupted = false;
        await turns[n++]?.({ options, emit, ask: (tool, input) => (options as any).canUseTool(tool, input, { signal: new AbortController().signal, title: `想用 ${tool}` }), interrupted: () => interrupted });
      }
      done = true; for (const w of waiters.splice(0)) w({ value: undefined, done: true });
    })();
    const q: SdkQuery = {
      [Symbol.asyncIterator]: () => ({ next: () => out.length ? Promise.resolve({ value: out.shift(), done: false }) : done ? Promise.resolve({ value: undefined, done: true }) : new Promise(r => waiters.push(r)) }),
      interrupt: async () => { state.interrupts++; interrupted = true; },
      setPermissionMode: async m => { state.modes.push(m); },
      setModel: async (m?: string) => { await (wrapper as any).setModelHook?.(m); },
      close: () => { state.closed = true; },
    };
    return q;
  };
  const wrapper = { fn, state } as any;
  return wrapper as { fn: SdkQueryFn; state: typeof state };
}
const ok = (text: string): Turn => async ({ emit }) => {
  emit({ type: 'stream_event', uuid: 'u1', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } } });
  emit({ type: 'assistant', uuid: 'a1', message: { role: 'assistant', content: [{ type: 'text', text }] } });
  emit({ type: 'result', subtype: 'success', is_error: false, session_id: 's' });
};
function make(turns: Turn[]) {
  const sdk = fakeSdk(turns);
  const inst = new ClaudeSdkInstance(async () => sdk.fn);
  const events: DriverEvent[] = [];
  inst.on(e => events.push(e));
  return { inst, sdk, events };
}

describe('复核 1755：目标确认只认目标命令那一轮', () => {
  it('NR13：普通回答引用 Goal set／Goal cleared 不改变目标；/goal 那一轮的确认才生效', async () => {
    const { inst, events } = make([
      async ({ emit }) => { emit({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'text', text: 'Goal set: quoted example only' }] } }); emit({ type: 'result', subtype: 'success' }); },
      async ({ emit }) => { emit({ type: 'assistant', uuid: 'b', message: { content: [{ type: 'text', text: 'Goal set: 真目标' }] } }); emit({ type: 'result', subtype: 'success' }); },
      async ({ emit }) => { emit({ type: 'assistant', uuid: 'c', message: { content: [{ type: 'text', text: 'Goal cleared: fake' }] } }); emit({ type: 'result', subtype: 'success' }); },
    ]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: '1', text: '讲讲 goal 怎么用', tier: 'ask' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 1);
    await inst.startTurn({ clientInputId: '2', text: '/goal 真目标', tier: 'ask' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 2);
    await inst.startTurn({ clientInputId: '3', text: '随便聊聊', tier: 'ask' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 3);
    expect(events.filter(e => e.type === 'goal')).toEqual([{ type: 'goal', objective: '真目标', status: 'active' }]);
  });
});

describe('复核 2251：停止只作用于正在开始的这一轮', () => {
  it('SR01：切换模型期间按停止，输入不写出、按未发出退回；空闲时的停止不中断下一轮', async () => {
    const { inst, sdk, events } = make([ok('一'), ok('二')]);
    let release!: () => void;
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.interrupt(); // 空闲时按停止
    await inst.startTurn({ clientInputId: '1', text: 'a', tier: 'ask' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 1);
    expect(events.find(e => e.type === 'turn.completed')).toMatchObject({ status: 'completed' });
    expect(sdk.state.interrupts).toBe(0);
    (sdk as any).setModelHook = () => new Promise<void>(r => { release = r; });
    const pending = inst.startTurn({ clientInputId: '2', text: 'b', tier: 'ask', model: 'other' });
    await until(() => !!release);
    await inst.interrupt();
    release();
    await expect(pending).rejects.toMatchObject({ code: 'STATE' });
    expect(sdk.state.prompts).toHaveLength(1);
  });
});

describe('复核 2127：结构化目标事实优先', () => {
  it('FR07：同一 /goal 轮次先到 active_goal，后到的兼容文字不覆盖；较晚的结构化清除仍生效', async () => {
    const { inst, events } = make([
      async ({ emit }) => {
        emit({ type: 'active_goal', value: { condition: 'native canonical target' } });
        emit({ type: 'assistant', uuid: 'a', message: { content: [{ type: 'text', text: 'Goal set: other target' }] } });
        emit({ type: 'active_goal', value: null });
        emit({ type: 'result', subtype: 'success' });
      },
      async ({ emit }) => { emit({ type: 'assistant', uuid: 'b', message: { content: [{ type: 'text', text: 'Goal set: 文字后备' }] } }); emit({ type: 'result', subtype: 'success' }); },
    ]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: '1', text: '/goal native canonical target', tier: 'ask' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 1);
    await inst.startTurn({ clientInputId: '2', text: '/goal 文字后备', tier: 'ask' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 2);
    expect(events.filter(e => e.type === 'goal')).toEqual([
      { type: 'goal', objective: 'native canonical target', status: 'active' },
      { type: 'goal', objective: null, status: 'cleared' },
      { type: 'goal', objective: '文字后备', status: 'active' },
    ]);
  });
});

describe('Claude SDK 驱动', () => {
  it('使用本机 claude、预分配会话 ID，等 system/init 才确认原生身份', async () => {
    const { inst, sdk, events } = make([ok('好')]);
    const r = await inst.open({ executable: exe, cwd: '/w', env: { HOME: '/h' }, tier: 'ask', model: 'opus', settingSources: ['project', 'local'] });
    expect(r.confirmed).toBe(false);
    expect(r.nativeId).toMatch(/^[0-9a-f-]{36}$/);
    expect(sdk.state.options).toMatchObject({ pathToClaudeCodeExecutable: exe.path, cwd: '/w', env: { HOME: '/h' }, model: 'opus', permissionMode: 'default', settingSources: ['project', 'local'], includePartialMessages: true, sessionId: r.nativeId });
    expect(sdk.state.options.allowDangerouslySkipPermissions).toBeUndefined();
    expect(events.some(e => e.type === 'session')).toBe(false);
    const t = await inst.startTurn({ clientInputId: 'in-1', text: '你好', tier: 'ask', model: 'opus' });
    expect(t.nativeTurnId).toBe(`${r.nativeId}:1`);
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(events).toContainEqual({ type: 'session', nativeId: r.nativeId });
    expect(events).toContainEqual({ type: 'catalog', commands: ['compact', 'init'], skills: [{ name: 'pdf' }] });
    expect(events).toContainEqual({ type: 'message.delta', nativeItemId: 'u1', text: '好' });
    expect(events).toContainEqual(expect.objectContaining({ type: 'item.completed', nativeItemId: 'a1', itemType: 'assistant' }));
    expect(events).toContainEqual({ type: 'turn.completed', nativeTurnId: t.nativeTurnId, status: 'completed' });
    expect(sdk.state.prompts[0]).toEqual({ type: 'user', message: { role: 'user', content: '你好' }, parent_tool_use_id: null });
  });

  it('恢复会话用 resume；完全访问显式允许绕过；帮我批准拒绝', async () => {
    const a = make([]);
    await a.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'full', resumeNativeId: 'sess-1' });
    expect(a.sdk.state.options).toMatchObject({ resume: 'sess-1', permissionMode: 'bypassPermissions', allowDangerouslySkipPermissions: true });
    expect(a.sdk.state.options.sessionId).toBeUndefined();
    const b = make([]);
    await expect(b.inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'auto' })).rejects.toThrow('Claude 不支持该档位');
  });

  it('同一会话不切换权限档位（须重开，复核 CR12）；换模型在下一轮前用 setModel 应用（复核 CR11）', async () => {
    const { inst, sdk, events } = make([ok('1'), ok('2'), ok('3')]);
    const models: (string | undefined)[] = [];
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask', model: 'opus' });
    (sdk as any).setModelHook = (m: string | undefined) => models.push(m);
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask', model: 'opus' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 1);
    await expect(inst.startTurn({ clientInputId: 'b', text: 'y', tier: 'full', model: 'opus' })).rejects.toThrow('需要重开会话');
    expect(sdk.state.modes).toEqual([]);
    await inst.startTurn({ clientInputId: 'c', text: 'z', tier: 'ask', model: 'sonnet' });
    await until(() => events.filter(e => e.type === 'turn.completed').length === 2);
    await inst.startTurn({ clientInputId: 'd', text: 'w', tier: 'ask' });
    expect(models).toEqual(['sonnet', undefined]);
  });

  it('开始信号前流失败：startTurn 被拒绝而不是一直挂起（复核 CR07）', async () => {
    const sdk = fakeSdk([]);
    const failing: SdkQueryFn = (p) => { const q = sdk.fn(p); return { ...q, [Symbol.asyncIterator]: () => ({ next: () => new Promise((_, reject) => setTimeout(() => reject(new Error('boom')), 5)) }) } as SdkQuery; };
    const inst = new ClaudeSdkInstance(async () => failing);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await expect(inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' })).rejects.toThrow('回合开始前失败');
    await expect(inst.startTurn({ clientInputId: 'b', text: 'y', tier: 'ask' })).rejects.toThrow('已结束');
  });

  it('子 Agent 消息带父工具身份，流式增量不进主任务；目标以原生确认为准（复核 CR13、CR14）', async () => {
    const { inst, events } = make([async ({ emit }) => {
      emit({ type: 'stream_event', uuid: 'c', parent_tool_use_id: 'agent-1', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '子过程' } } });
      emit({ type: 'assistant', uuid: 'ca', parent_tool_use_id: 'agent-1', message: { content: [{ type: 'text', text: 'CHILD' }] } });
      emit({ type: 'assistant', uuid: 'g', message: { content: [{ type: 'text', text: 'Goal set: 修完断言' }] } });
      emit({ type: 'active_goal', value: null, uuid: 'x', session_id: 's' });
      emit({ type: 'result', subtype: 'success', is_error: false });
    }]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: '/goal 修完断言', tier: 'ask' });
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(events.some(e => e.type === 'message.delta')).toBe(false);
    expect(events.find(e => e.type === 'item.completed' && e.nativeItemId === 'ca')).toMatchObject({ payload: { parentToolUseId: 'agent-1' } });
    expect(events.filter(e => e.type === 'goal')).toEqual([{ type: 'goal', objective: '修完断言', status: 'active' }, { type: 'goal', objective: null, status: 'cleared' }]);
  });

  it('canUseTool 挂起为宿主请求；回应原样交回 SDK（含计划批准）', async () => {
    let answer: any;
    const { inst, events } = make([async ({ emit, ask }) => {
      emit({ type: 'assistant', uuid: 'a0', message: { content: [] } });
      answer = await ask('ExitPlanMode', { plan: '1. 改 a\n2. 改 b' });
      emit({ type: 'result', subtype: 'success', is_error: false });
    }]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'full' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'full' });
    await until(() => events.some(e => e.type === 'request'));
    const req = events.find(e => e.type === 'request') as Extract<DriverEvent, { type: 'request' }>;
    expect(req).toMatchObject({ kind: 'plan_approval', payload: { tool: 'ExitPlanMode', input: { plan: '1. 改 a\n2. 改 b' }, title: '想用 ExitPlanMode' } });
    await expect(inst.respond(req.requestKey, { behavior: 'maybe' })).rejects.toThrow('回应格式不正确');
    await expect(inst.respond(req.requestKey, { behavior: 'deny' })).rejects.toThrow('拒绝须附原因');
    await inst.respond(req.requestKey, { behavior: 'deny', message: '先别改 b' });
    await until(() => !!answer);
    expect(answer).toEqual({ behavior: 'deny', message: '先别改 b' });
    expect(events).not.toContainEqual({ type: 'request.resolved', requestKey: req.requestKey });
    await expect(inst.respond(req.requestKey, { behavior: 'allow' })).rejects.toThrow('请求已结束');
  });

  it('批准时未改输入则沿用原输入', async () => {
    let answer: any;
    const { inst, events } = make([async ({ emit, ask }) => { emit({ type: 'assistant', uuid: 'a', message: {} }); answer = await ask('Bash', { command: 'ls' }); emit({ type: 'result', subtype: 'success' }); }]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await until(() => events.some(e => e.type === 'request'));
    const req = events.find(e => e.type === 'request') as Extract<DriverEvent, { type: 'request' }>;
    expect(req.kind).toBe('command_approval');
    await inst.respond(req.requestKey, { behavior: 'allow' });
    await until(() => !!answer);
    expect(answer).toEqual({ behavior: 'allow', updatedInput: { command: 'ls' } });
  });

  it('中断：已开始的回合调用 SDK interrupt，终态记为中断', async () => {
    const { inst, sdk, events } = make([async ({ emit, interrupted }) => {
      emit({ type: 'assistant', uuid: 'a', message: {} });
      await until(() => interrupted());
      emit({ type: 'result', subtype: 'error_during_execution', is_error: true });
    }]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await inst.interrupt();
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(sdk.state.interrupts).toBe(1);
    expect(events.find(e => e.type === 'turn.completed')).toMatchObject({ status: 'interrupted' });
  });

  it('失败结果映射为失败；上一轮未结束时拒绝新输入', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const { inst, events } = make([async ({ emit }) => { emit({ type: 'assistant', uuid: 'a', message: {} }); await gate; emit({ type: 'result', subtype: 'error_max_turns', is_error: true }); }]);
    await inst.open({ executable: exe, cwd: '/w', env: {}, tier: 'ask' });
    await inst.startTurn({ clientInputId: 'a', text: 'x', tier: 'ask' });
    await expect(inst.startTurn({ clientInputId: 'b', text: 'y', tier: 'ask' })).rejects.toThrow('上一轮尚未结束');
    release();
    await until(() => events.some(e => e.type === 'turn.completed'));
    expect(events.find(e => e.type === 'turn.completed')).toMatchObject({ status: 'failed', error: 'error_max_turns' });
  });
});
