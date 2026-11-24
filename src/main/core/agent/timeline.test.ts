import { describe, expect, it } from 'vitest';
import { TimelineProjector } from './timeline';

describe('回合活动的原生事件回放', () => {
  const turn = { nativeTurnId: 'turn-1', clientInputId: 'input-1' };

  it('Claude 从压缩开始到完成只更新一条记录，后续压缩使用新记录', () => {
    const projector = new TimelineProjector('claude-sdk');
    const system = (subtype: string, uuid: string, fields: object = {}) =>
      projector.project({ type: 'native', name: `system/${subtype}`,
        payload: { type: 'system', subtype, uuid, ...fields } });
    projector.project({ type: 'turn.started', ...turn });
    const [started] = system('status', 'start-1', { status: 'compacting' });
    expect(started).toMatchObject({ type: 'compaction', terminal: null, payload: { status: 'running' } });
    expect(system('status', 'start-1', { status: 'compacting' })).toEqual([]);
    const [completed] = system('status', 'status-1', { status: null, compact_result: 'success' });
    expect(completed).toMatchObject({ key: started.key, terminal: 'completed', payload: { status: 'completed' } });
    const boundary = system('compact_boundary', 'boundary-1', { compact_metadata: { trigger: 'auto' } });
    expect(boundary.every(item => item.key === started.key)).toBe(true);
    expect(system('compact_boundary', 'boundary-1')).toEqual([]);
    const [next] = system('status', 'start-2', { status: 'compacting' });
    expect(next.key).not.toBe(started.key);
    expect(system('status', 'fail-2', { status: null, compact_result: 'failed', compact_error: 'timeout' }))
      .toMatchObject([{ key: next.key, terminal: 'failed', payload: { status: 'failed', message: 'timeout' } }]);
  });

  it('Codex 同一原生条目原位更新，停止时结束仍在压缩的记录', () => {
    const projector = new TimelineProjector('codex-app-server');
    const started = (id: string, turnId = turn.nativeTurnId) => projector.project({
      type: 'native', name: 'item/started', payload: { turnId, item: { id, type: 'contextCompaction' } },
    });
    projector.project({ type: 'turn.started', ...turn });
    const [first] = started('compact-1');
    expect(first).toMatchObject({ type: 'compaction', terminal: null, payload: { status: 'running' } });
    expect(projector.project({ type: 'native', name: 'item/completed',
      payload: { turnId: turn.nativeTurnId, item: { id: 'compact-1', type: 'contextCompaction' } } }))
      .toMatchObject([{ key: first.key, terminal: 'completed', payload: { status: 'completed' } }]);
    expect(started('compact-1')).toEqual([]);
    const [second] = started('compact-2');
    expect(projector.project({ type: 'turn.completed', nativeTurnId: turn.nativeTurnId, status: 'interrupted' }))
      .toMatchObject([{ key: second.key, terminal: 'failed', payload: { status: 'interrupted' } }]);
    projector.project({ type: 'turn.started', nativeTurnId: 'turn-2', clientInputId: 'input-2' });
    expect(started('stale')).toEqual([]);
  });

  it('Codex 断流重试保持一条记录，真正恢复或限流失败后原位结算', () => {
    const projector = new TimelineProjector('codex-app-server');
    const report = (message: string, willRetry: boolean, httpStatusCode: number | null = null) =>
      projector.project({ type: 'native', name: 'error', payload: { turnId: turn.nativeTurnId, willRetry,
        error: { message, codexErrorInfo: { responseStreamDisconnected: { httpStatusCode } } } } });
    const output = (turnId: string) => projector.project({ type: 'native', name: 'item/agentMessage/delta',
      payload: { turnId, itemId: 'reply', delta: '继续输出' } });
    projector.project({ type: 'turn.started', ...turn });
    const [retry] = report('Reconnecting... 1/5', true);
    expect(retry).toMatchObject({ type: 'error', terminal: null, payload: { retry: { status: 'running', attempt: 1, maxAttempts: 5 } } });
    expect(report('Reconnecting... 2/5', true)).toMatchObject([{ key: retry.key, terminal: null,
      payload: { retry: { status: 'running', attempt: 2, maxAttempts: 5 } } }]);
    expect(output('earlier-turn')).toEqual([]);
    expect(output(turn.nativeTurnId)).toMatchObject([{ key: retry.key, terminal: 'completed',
      payload: { retry: { status: 'completed', attempt: 2 } } }]);
    expect(output(turn.nativeTurnId)).toEqual([]);
    const [again] = report('Reconnecting... 1/5', true);
    expect(report('Too Many Requests', false, 429)).toMatchObject([{ key: again.key, terminal: 'failed',
      payload: { retry: { status: 'failed' }, limited: { kind: 'rate' } } }]);
  });

  it('Claude 只按主回合输出结束重试，流中断也会收尾', () => {
    const projector = new TimelineProjector('claude-sdk');
    const retry = (attempt: number) => projector.project({ type: 'native', name: 'system/api_retry',
      payload: { type: 'system', subtype: 'api_retry', uuid: `retry-${attempt}`,
        attempt, max_retries: 4, retry_delay_ms: 750, error_status: 503, error: 'overloaded' } });
    const assistant = (model: string, parent_tool_use_id: string | null) => projector.project({
      type: 'native', name: 'assistant', payload: { type: 'assistant', parent_tool_use_id,
        message: { model, content: [{ type: 'text', text: '继续输出' }] } } });
    projector.project({ type: 'turn.started', ...turn });
    const [first] = retry(1);
    expect(first).toMatchObject({ type: 'error', terminal: null,
      payload: { retry: { status: 'running', attempt: 1, maxAttempts: 4, retryDelayMs: 750 } } });
    expect(retry(2)).toMatchObject([{ key: first.key, payload: { retry: { status: 'running', attempt: 2 } } }]);
    expect(assistant('<synthetic>', null)).toEqual([]);
    expect(assistant('claude', 'child')).toEqual([]);
    expect(assistant('claude', null)).toMatchObject([{ key: first.key, terminal: 'completed',
      payload: { retry: { status: 'completed' } } }]);
    const [later] = retry(3);
    expect(projector.project({ type: 'exit', code: 1, signal: null })).toMatchObject([{ key: later.key,
      terminal: 'failed', payload: { retry: { status: 'interrupted' } } }]);
  });

  it('Claude 将停止后报告的压缩失败更新为中断', () => {
    const projector = new TimelineProjector('claude-sdk');
    projector.project({ type: 'turn.started', ...turn });
    const [started] = projector.project({ type: 'native', name: 'system/status',
      payload: { type: 'system', subtype: 'status', status: 'compacting', uuid: 'compact-start' } });
    expect(projector.project({ type: 'native', name: 'system/status', turnInterrupted: true,
      payload: { type: 'system', subtype: 'status', status: null, compact_result: 'failed', uuid: 'compact-stop' } }))
      .toMatchObject([{ key: started.key, terminal: 'failed', payload: { status: 'interrupted' } }]);
    expect(projector.project({ type: 'turn.completed', nativeTurnId: turn.nativeTurnId, status: 'interrupted' })).toEqual([]);
  });

  it('其他驱动可以用同一活动契约，只结算本轮已经开始的活动', () => {
    const projector = new TimelineProjector('antigravity-acp');
    projector.project({ type: 'turn.started', ...turn });
    const [retry] = projector.project({ type: 'activity', nativeTurnId: turn.nativeTurnId,
      activity: { kind: 'retry', status: 'running' } });
    expect(retry).toMatchObject({ type: 'error', terminal: null, payload: { retry: { status: 'running' } } });
    expect(projector.project({ type: 'activity', nativeTurnId: 'other-turn',
      activity: { kind: 'retry', status: 'completed' } })).toEqual([]);
    expect(projector.project({ type: 'turn.completed', nativeTurnId: turn.nativeTurnId, status: 'failed', error: '连接失败' }))
      .toMatchObject([{ key: retry.key, terminal: 'failed', payload: { retry: { status: 'failed' }, message: '连接失败' } }]);
  });
});

it('keeps Antigravity effort fallback in the diagnostics for the affected turn', () => {
  const projector = new TimelineProjector('antigravity-acp');
  expect(projector.project({
    type: 'item.completed', nativeItemId: 'turn-1:effort', itemType: 'acpEffortFallback',
    payload: { detail: '当前模型未公布所选档位 high，本轮使用原生档位 medium。可以重新选择。' },
  })).toEqual([{
    key: 'turn-1:effort', type: 'system_notice', terminal: 'completed',
    payload: {
      severity: 'warning', title: '推理档位', code: 'configWarning', status: 'completed', diagnosticOnly: false,
      detail: '当前模型未公布所选档位 high，本轮使用原生档位 medium。可以重新选择。',
    },
  }]);
});

// M14-A59 时间线（投影层）、A71 计划卡来源、A76 待办只在执行器提供时出现。
describe('Claude 投影', () => {
  function claudeStream(model = 'claude-sonnet-5-5') {
    const projector = new TimelineProjector('claude-sdk');
    const stream = (event: object, parent?: string) => projector.project({ type: 'native', name: 'stream_event',
      payload: { type: 'stream_event', event, parent_tool_use_id: parent ?? null } });
    const messageStart = (id: string) => stream({ type: 'message_start', message: { id, model } });
    const thinkingStart = (index: number, parent?: string) => stream({ type: 'content_block_start', index,
      content_block: { type: 'thinking', thinking: '', signature: '' } }, parent);
    const thinking = (index: number, text: string, parent?: string) => stream({ type: 'content_block_delta', index,
      delta: { type: 'thinking_delta', thinking: text } }, parent);
    const signature = (index: number) => stream({ type: 'content_block_delta', index,
      delta: { type: 'signature_delta', signature: 'opaque-signature' } });
    const stop = (index: number) => stream({ type: 'content_block_stop', index });
    const snapshot = (id: string, uuid: string, content: object[]) => projector.project({ type: 'item.completed',
      nativeItemId: uuid, itemType: 'assistant', payload: { id, model, content } });
    return { projector, messageStart, thinkingStart, thinking, signature, stop, snapshot };
  }

  it('在工具前实时显示 Claude 进度，空快照和重复快照保留同一条完整记录', () => {
    const f = claudeStream();
    f.messageStart('msg1');
    expect(f.thinkingStart(0)).toEqual([]);
    expect(f.thinking(0, '')).toEqual([]);
    expect(f.signature(0)).toEqual([]);
    expect(f.snapshot('msg1', 'reasoning1', [{ type: 'thinking', thinking: '', signature: 'opaque-signature' }])).toEqual([]);
    expect(f.stop(0)).toEqual([]);
    expect(f.thinkingStart(1)).toEqual([]);
    const [preview] = f.thinking(1, '已取得结果');
    expect(preview).toMatchObject({ type: 'assistant_message', terminal: null,
      payload: { phase: 'commentary', text: '已取得结果' } });
    f.thinking(1, '，正在核对。');
    f.signature(1);
    const empty = [{ type: 'thinking', thinking: '', signature: 'opaque-signature' }];
    const [saved] = f.snapshot('msg1', 'update1', empty);
    expect(saved).toMatchObject({ key: preview.key, type: 'assistant_message', terminal: 'completed',
      payload: { phase: 'commentary', text: '已取得结果，正在核对。' } });
    expect(f.stop(1)).toEqual([]);
    expect(f.snapshot('msg1', 'update1', empty)).toEqual([]);
    const tools = f.snapshot('msg1', 'tool1', [{ type: 'tool_use', id: 'tool1', name: 'Bash', input: { command: 'printf fixture' } }]);
    expect(tools).toMatchObject([{ type: 'command_execution', payload: { status: 'running' } }]);
  });

  it('单个可读思考块实时保留在思考详情，子 Agent 增量不会串入主任务', () => {
    const f = claudeStream('claude-sonnet-4-6');
    f.messageStart('msg1');
    expect(f.thinkingStart(0)).toEqual([]);
    const [preview] = f.thinking(0, '已公开的思考摘要');
    expect(preview).toMatchObject({ type: 'reasoning', terminal: null, payload: { text: '已公开的思考摘要' } });
    expect(f.thinking(0, '子 Agent 内容', 'agent1')).toEqual([]);
    f.thinking(0, '，更多文字');
    const [saved] = f.stop(0);
    expect(saved).toMatchObject({ key: preview.key, terminal: 'completed', payload: { text: '已公开的思考摘要，更多文字' } });
    expect(f.snapshot('msg1', 'update1', [{ type: 'thinking', thinking: '' }])).toEqual([]);
    f.messageStart('msg2');
    f.thinkingStart(0);
    const [next] = f.thinking(0, '下一段');
    expect(next.key).not.toBe(preview.key);
    expect(next.payload.text).toBe('下一段');
  });

  it('中断时保存最后已收到的文字，并在下一轮清空块关联', () => {
    const f = claudeStream();
    f.messageStart('msg1');
    f.thinkingStart(0);
    const [preview] = f.thinking(0, '已经收到');
    f.thinking(0, '另一段文字');
    expect(f.projector.project({ type: 'turn.completed', nativeTurnId: 'turn1', status: 'interrupted' }))
      .toMatchObject([{ key: preview.key, terminal: 'completed', payload: { text: '已经收到另一段文字' } }]);
    expect(f.thinking(0, '迟到文字')).toEqual([]);
    f.messageStart('msg2');
    f.thinkingStart(0);
    expect(f.thinking(0, '下一轮')).toMatchObject([{ type: 'reasoning', payload: { text: '下一轮' } }]);
  });

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

  it('A59: Claude 钩子结果更新同一条提示，不发布原始 stdout 或迟到的进度', () => {
    const p = new TimelineProjector('claude-sdk');
    const hook = { hook_id: 'fixture-hook', hook_name: '用户检查', hook_event: 'PreToolUse' };
    const started = p.project({ type: 'native', name: 'system/hook_started', payload: hook })[0];
    expect(started).toMatchObject({ type: 'system_notice', terminal: null });
    const failed = p.project({ type: 'native', name: 'system/hook_response', payload: { ...hook, outcome: 'error', exit_code: 1, stdout: 'internal hook output' } })[0];
    expect(failed).toMatchObject({ key: started.key, terminal: 'failed', payload: { severity: 'warning', detail: 'PreToolUse · error · 退出码 1' } });
    expect(p.project({ type: 'native', name: 'system/hook_progress', payload: hook })).toEqual([]);
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

  it('A59: 钩子、MCP 启动和自动审批的终态修订原条目', () => {
    const x = p();
    const lifecycle = (name: string, payload: object) => x.project({ type: 'native', name, payload })[0];
    const hook = lifecycle('hook/started', { run: { id: 'hook-1', eventName: 'sessionStart', status: 'running' } });
    expect(hook).toMatchObject({ type: 'system_notice', terminal: null });
    const failed = lifecycle('hook/completed', { run: { id: 'hook-1', eventName: 'sessionStart', status: 'failed', statusMessage: 'cannot start hook' } });
    expect(failed).toMatchObject({ key: hook.key, terminal: 'failed', payload: { severity: 'warning', detail: expect.stringContaining('cannot start hook') } });
    expect(lifecycle('hook/started', { run: { id: 'hook-1', eventName: 'sessionStart', status: 'running' } })).toBeUndefined();

    const mcp = lifecycle('mcpServer/startupStatus/updated', { name: 'fixture-mcp', status: 'starting' });
    expect(mcp).toMatchObject({ type: 'system_notice', terminal: null });
    expect(lifecycle('mcpServer/startupStatus/updated', { name: 'fixture-mcp', status: 'failed', error: 'unavailable' })).toMatchObject({ key: mcp.key, terminal: 'failed', payload: { severity: 'warning', detail: expect.stringContaining('unavailable') } });
    expect(lifecycle('mcpServer/startupStatus/updated', { name: 'fixture-mcp', status: 'starting' })).toMatchObject({ key: mcp.key, terminal: null });

    const review = lifecycle('item/autoApprovalReview/started', { reviewId: 'review-1', review: { status: 'inProgress' } });
    expect(review).toMatchObject({ type: 'system_notice', terminal: null });
    expect(lifecycle('item/autoApprovalReview/completed', { reviewId: 'review-1', review: { status: 'denied', rationale: 'write denied' } })).toMatchObject({ key: review.key, terminal: 'completed', payload: { severity: 'warning', detail: expect.stringContaining('write denied') } });
  });

  it('A59: 原生文件搜索保留工作条目，未知条目类型报警一次', () => {
    const x = p();
    const completed = (id: string, type: string, fields: object = {}) => x.project({ type: 'item.completed', nativeItemId: id, itemType: type, payload: { id, type, ...fields } });
    expect(completed('files', 'fileSearch', { query: '*.ts', results: ['src/file.ts'] })).toEqual([
      expect.objectContaining({ key: 'files', type: 'file_search', terminal: 'completed', payload: expect.objectContaining({ input: expect.objectContaining({ pattern: '*.ts' }), output: expect.stringContaining('src/file.ts') }) }),
    ]);
    expect(completed('unexpected-1', 'newNativeType')).toEqual([expect.objectContaining({ type: 'system_notice', payload: expect.objectContaining({ severity: 'warning', code: 'unknownNativeItem', detail: expect.stringContaining('newNativeType') }) })]);
    expect(completed('unexpected-2', 'newNativeType')).toEqual([]);
    expect(x.project({ type: 'native', name: 'account/updated', payload: {} })).toEqual([]);
  });
});

describe('复核 1755 投影回归', () => {
  it('A60 projects an exhausted Codex quota window from the current turn without exposing quota meters', () => {
    const result = new TimelineProjector('codex-app-server');
    const earlier = Math.floor(Date.now() / 1000) + 60;
    const later = earlier + 60;
    const window = (usedPercent: number, resetsAt: number | null) => ({ usedPercent, windowDurationMins: 300, resetsAt });
    const report = (primary: unknown, secondary: unknown, limitId = 'codex') => result.project({
      type: 'native', name: 'account/rateLimits/updated', payload: { rateLimits: { limitId, primary, secondary } },
    });
    const error = (code: string, turnId = 'native-one') => result.project({ type: 'native', name: 'error',
      payload: { threadId: 'parent', turnId, error: { message: 'Original native message', codexErrorInfo: code }, willRetry: false },
    })[0].payload;
    result.project({ type: 'turn.started', nativeTurnId: 'native-one', clientInputId: 'first-input' });
    expect(report(window(100, earlier), null)).toEqual([]);
    expect(report(null, window(100, later))).toEqual([]);
    expect(report(window(100, later + 100), null, 'another-limit')).toEqual([]);
    expect(error('usageLimitExceeded')).toMatchObject({ limited: {
      kind: 'usage', resetAt: new Date(later * 1000).toISOString(),
    } });
    expect(error('tooManyRequests')).toMatchObject({ limited: { kind: 'rate' } });
    expect(error('tooManyRequests').limited).not.toHaveProperty('resetAt');
    expect(report(null, window(20, later))).toEqual([]);
    expect(error('usageLimitExceeded')).toMatchObject({ limited: {
      kind: 'usage', resetAt: new Date(earlier * 1000).toISOString(),
    } });
    result.project({ type: 'turn.started', nativeTurnId: 'native-two', clientInputId: 'next-input' });
    expect(error('usageLimitExceeded', 'native-two').limited).not.toHaveProperty('resetAt');
    report(window(100, 9e20), window(100, earlier - 120));
    expect(error('usageLimitExceeded', 'native-two').limited).not.toHaveProperty('resetAt');
    report(window(100, later), null);
    expect(error('usageLimitExceeded', 'native-one').limited).not.toHaveProperty('resetAt');
  });

  it('A60 maps the Codex terminal output limit without relabeling other or context errors', () => {
    const p = new TimelineProjector('codex-app-server');
    const error = (message: string, codexErrorInfo: string) => p.project({
      type: 'native', name: 'error',
      payload: { turnId: 'turn', error: { message, codexErrorInfo, additionalDetails: null }, willRetry: false },
    })[0];
    expect(error('Incomplete response returned, reason: max_output_tokens', 'other')).toMatchObject({
      type: 'error', payload: { code: 'other', limited: { kind: 'output' } },
    });
    expect(error('Incomplete response returned, reason: content_filter', 'other')?.payload).not.toHaveProperty('limited');
    expect(error('max_output_tokens mentioned in an ordinary error', 'other')?.payload).not.toHaveProperty('limited');
    expect(error('Context window too large', 'contextWindowExceeded')?.payload).toMatchObject({ limited: { kind: 'context' } });
  });
  it('A60 marks Codex retries that ended on HTTP 429 as a rate limit (D06-63)', () => {
    const p = new TimelineProjector('codex-app-server');
    p.project({ type: 'turn.started', nativeTurnId: 'turn', clientInputId: 'input' });
    const error = (info: unknown, willRetry = false) => p.project({
      type: 'native', name: 'error',
      payload: { turnId: 'turn', error: { message: 'exceeded retry limit, last status: 429 Too Many Requests', codexErrorInfo: info, additionalDetails: null }, willRetry },
    })[0];
    // Payload shape from attempt 365: response_too_many_failed_attempts with http_status_code 429.
    expect(error({ responseTooManyFailedAttempts: { httpStatusCode: 429 } })).toMatchObject({
      type: 'error', payload: { code: 'responseTooManyFailedAttempts', message: 'exceeded retry limit, last status: 429 Too Many Requests', limited: { kind: 'rate' } },
    });
    expect(error({ responseTooManyFailedAttempts: { httpStatusCode: 429 } })?.payload.limited).not.toHaveProperty('resetAt');
    expect(error({ responseTooManyFailedAttempts: { httpStatusCode: 503 } })?.payload).not.toHaveProperty('limited');
    expect(error({ responseTooManyFailedAttempts: { httpStatusCode: null } })?.payload).not.toHaveProperty('limited');
    expect(error({ responseStreamDisconnected: { httpStatusCode: 429 } }, true)?.payload).not.toHaveProperty('limited');
  });
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
