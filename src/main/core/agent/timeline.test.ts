import { describe, expect, it } from 'vitest';
import { TimelineProjector } from './timeline';

// M14-A59 时间线（投影层）、A71 计划卡来源、A76 待办只在执行器提供时出现。
describe('Claude 投影', () => {
  it('文本、思考、工具调用与结果配对；结果失败标失败', () => {
    const p = new TimelineProjector('claude-sdk');
    const a = p.project({ type: 'item.completed', nativeItemId: 'u1', itemType: 'assistant', payload: { model: 'm', content: [
      { type: 'thinking', thinking: '先看看' }, { type: 'text', text: '我来跑命令' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }, { type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'a.ts' } }] } });
    expect(a.map(x => [x.key, x.type, x.terminal])).toEqual([['u1:0', 'reasoning', 'completed'], ['u1:1', 'assistant_message', 'completed'], ['tool:t1', 'command_execution', null], ['tool:t2', 'file_change', null]]);
    const r = p.project({ type: 'native', name: 'user', payload: { type: 'user', message: { content: [
      { type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: 'a\nb' }] }, { type: 'tool_result', tool_use_id: 't2', is_error: true, content: '拒绝' }] } } });
    expect(r).toEqual([
      { key: 'tool:t1', type: 'command_execution', payload: { name: 'Bash', input: { command: 'ls' }, output: 'a\nb', status: 'completed' }, terminal: 'completed' },
      { key: 'tool:t2', type: 'file_change', payload: { name: 'Edit', input: { file_path: 'a.ts' }, output: '拒绝', status: 'failed' }, terminal: 'failed' },
    ]);
  });
  it('ExitPlanMode 成为计划条目', () => {
    const p = new TimelineProjector('claude-sdk');
    const a = p.project({ type: 'item.completed', nativeItemId: 'u', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'p1', name: 'ExitPlanMode', input: { plan: '1. 改 a' } }] } });
    expect(a[0]).toMatchObject({ type: 'proposed_plan', payload: { plan: '1. 改 a', status: 'running' } });
  });
  it('待办：只有成功结果才改清单，失败保留原状态（RR03）', () => {
    const p = new TimelineProjector('claude-sdk');
    expect(p.project({ type: 'item.completed', nativeItemId: 'u', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'c1', name: 'TaskCreate', input: { subject: '写测试' } }] } })).toEqual([]);
    const created = p.project({ type: 'native', name: 'user', payload: { type: 'user', tool_use_result: { task: { id: '1' } }, message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: 'ok' }] } } });
    expect(created).toEqual([{ key: 'todo', type: 'todo_list', payload: { entries: [{ id: '1', subject: '写测试', status: 'pending' }] } }]);
    p.project({ type: 'item.completed', nativeItemId: 'v', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'u1', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }] } });
    expect(p.project({ type: 'native', name: 'user', payload: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u1', is_error: true, content: 'x' }] } } })).toEqual([]);
    p.project({ type: 'item.completed', nativeItemId: 'w', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'u2', name: 'TaskUpdate', input: { taskId: '1', status: 'completed' } }] } });
    expect(p.project({ type: 'native', name: 'user', payload: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'u2', content: 'ok' }] } } })[0].payload).toEqual({ entries: [{ id: '1', subject: '写测试', status: 'completed' }] });
  });
  it('执行出错的结果成为错误条目；用户中断不算错误', () => {
    const p = new TimelineProjector('claude-sdk');
    expect(p.project({ type: 'native', name: 'result', payload: { type: 'result', subtype: 'error_max_turns', is_error: true, uuid: 'r' } })).toEqual([{ key: 'error:r', type: 'error', payload: { code: 'error_max_turns', message: 'error_max_turns' }, terminal: 'failed' }]);
    expect(p.project({ type: 'native', name: 'result', payload: { type: 'result', subtype: 'error_during_execution', is_error: true } })).toEqual([]);
  });
});

describe('Codex 投影', () => {
  const p = () => new TimelineProjector('codex-app-server');
  it('命令开始时为运行中，完成后同一条目带输出与退出码', () => {
    const x = p();
    expect(x.project({ type: 'native', name: 'item/started', payload: { item: { id: 'c1', type: 'commandExecution', command: 'ls', cwd: '/w' } } })).toEqual([{ key: 'c1', type: 'command_execution', payload: { command: 'ls', cwd: '/w', output: '', exitCode: null, status: 'running' }, terminal: null }]);
    expect(x.project({ type: 'item.completed', nativeItemId: 'c1', itemType: 'commandExecution', payload: { id: 'c1', type: 'commandExecution', command: 'ls', cwd: '/w', aggregatedOutput: 'a', exitCode: 0, status: 'completed' } })[0]).toMatchObject({ key: 'c1', payload: { output: 'a', exitCode: 0, status: 'completed' }, terminal: 'completed' });
  });
  it('原生 plan 条目按普通回答显示并保留 nativeType；turn/plan/updated 归待办', () => {
    const x = p();
    expect(x.project({ type: 'item.completed', nativeItemId: 'p', itemType: 'plan', payload: { id: 'p', type: 'plan', text: '1. 做 a' } })[0]).toEqual({ key: 'p', type: 'assistant_message', payload: { text: '1. 做 a', nativeType: 'plan' }, terminal: 'completed' });
    expect(x.project({ type: 'native', name: 'turn/plan/updated', payload: { plan: [{ step: '写代码', status: 'inProgress' }] } })).toEqual([{ key: 'todo', type: 'todo_list', payload: { entries: [{ id: '0', subject: '写代码', status: 'inProgress' }] } }]);
  });
  it('拒绝的文件改动标失败；用户消息由宿主记录，不重复投影', () => {
    const x = p();
    expect(x.project({ type: 'item.completed', nativeItemId: 'f', itemType: 'fileChange', payload: { id: 'f', type: 'fileChange', status: 'declined', changes: [{ path: 'a.ts', kind: { type: 'update' } }] } })[0]).toEqual({ key: 'f', type: 'file_change', payload: { changes: [{ path: 'a.ts', kind: 'update' }], status: 'declined' }, terminal: 'failed' });
    expect(x.project({ type: 'item.completed', nativeItemId: 'u', itemType: 'userMessage', payload: { id: 'u', type: 'userMessage' } })).toEqual([]);
    expect(x.project({ type: 'native', name: 'item/started', payload: { item: { id: 'm', type: 'agentMessage' } } })).toEqual([]);
  });
  it('告警与错误通知', () => {
    const x = p();
    expect(x.project({ type: 'native', name: 'configWarning', payload: { summary: '忽略 2 项设置' } })[0]).toMatchObject({ type: 'system_notice', payload: { severity: 'warning', code: 'configWarning', detail: '忽略 2 项设置' } });
    expect(x.project({ type: 'native', name: 'error', payload: { turnId: 't', error: { message: 'usage limit' } } })[0]).toMatchObject({ type: 'error', payload: { message: 'usage limit' } });
  });
});

describe('复核 1755 投影回归', () => {
  it('NR08：Claude 额度拒绝与输出上限标为受限并保留重置时间', () => {
    const p = new TimelineProjector('claude-sdk');
    const a = p.project({ type: 'native', name: 'rate_limit_event', payload: { type: 'rate_limit_event', uuid: 'r', rate_limit_info: { status: 'rejected', resetsAt: 1800000000, rateLimitType: 'five_hour' } } });
    expect(a[0]).toMatchObject({ type: 'error', payload: { limited: { kind: 'usage', resetAt: new Date(1800000000 * 1000).toISOString() } } });
    expect(p.project({ type: 'native', name: 'rate_limit_event', payload: { type: 'rate_limit_event', rate_limit_info: { status: 'allowed_warning' } } })).toEqual([]);
    const b = p.project({ type: 'native', name: 'assistant', payload: { type: 'assistant', uuid: 'x', error: 'max_output_tokens', message: { content: [{ type: 'text', text: '部分输出' }] } } });
    expect(b[0]).toMatchObject({ type: 'error', payload: { code: 'max_output_tokens', limited: { kind: 'output' } } });
  });
  it('NR11：子 Agent 已有结果后，迟到的内部消息不把节点改回运行中', () => {
    const p = new TimelineProjector('claude-sdk');
    p.project({ type: 'item.completed', nativeItemId: 'u', itemType: 'assistant', payload: { content: [{ type: 'tool_use', id: 'ag', name: 'Agent', input: { description: 'd' } }] } });
    const done = p.project({ type: 'native', name: 'user', payload: { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'ag', content: '完成' }] } } });
    expect(done[0]).toMatchObject({ terminal: 'completed', payload: { status: 'completed' } });
    const late = p.project({ type: 'item.completed', nativeItemId: 'c', itemType: 'assistant', payload: { parentToolUseId: 'ag', content: [{ type: 'text', text: '迟到的进度' }] } });
    expect(late[0]).toMatchObject({ terminal: 'completed', payload: { status: 'completed', childLog: ['迟到的进度'] } });
  });
});
