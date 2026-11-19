import { describe, expect, it } from 'vitest';
import { buildTimeline, retainOlderTimeline, requestForm, requestOptions, requestTitle, workLabel, type TimelineItem } from './agent-timeline';

// M14-A52 统一时间线与工作折叠、A60 终态尾注、A11 请求选项（界面逻辑层）。
const item = (o: Partial<TimelineItem> & { type: string; ordinal: number }): TimelineItem => ({ itemId: `i${o.ordinal}`, turnId: 't1', revision: 1, payload: {}, terminal: 'completed', createdAt: '', updatedAt: '', ...o });
const turn = (status: string, s = '2026-11-17T00:00:00Z', e: string | null = '2026-11-17T00:00:12Z') => ({ turn_id: 't1', status, accepted_at: s, started_at: s, ended_at: e, error_code: null });

describe('A45 历史显示预算', () => {
  it('保留当前快照和刚请求的较早记录，不重复计入快照条目', () => {
    const items = Array.from({ length: 2110 }, (_, i) => item({ type: 'assistant_message', ordinal: i + 1 }));
    const current = { items: items.slice(-110), turns: [turn('completed')] };
    const result = retainOlderTimeline({ items, turns: [turn('started')] }, current);
    expect(result.clipped).toBe(true);
    expect(result.items.map(row => row.ordinal)).toEqual(items.slice(0, 1890).map(row => row.ordinal));
    expect(result.turns).toEqual([]);
  });

  it('按 UTF-8 序列化字节累计条目和回合信息，达到大小上限时继续保持最早载入的页', () => {
    const payload = { text: '甲😀'.repeat(1600) };
    const items = Array.from({ length: 1000 }, (_, i) => item({ type: 'assistant_message', ordinal: i + 1, payload, turnId: `t${i}` }));
    const turns = items.map(row => ({ ...turn('completed'), turn_id: row.turnId! }));
    const current = { items: items.slice(-10), turns: turns.slice(-10) };
    const result = retainOlderTimeline({ items, turns }, current);
    expect(result.clipped).toBe(true);
    expect(result.items[0]?.ordinal).toBe(1);
    expect(result.turns).toHaveLength(result.items.length);
    const size = (extraItems: TimelineItem[] = [], extraTurns: typeof turns = []) => new TextEncoder().encode(JSON.stringify({ items: [...result.items, ...extraItems, ...current.items], turns: [...result.turns, ...extraTurns, ...current.turns] })).byteLength;
    expect(size()).toBeLessThanOrEqual(8 * 1024 * 1024);
    const next = result.items.length;
    expect(size([items[next]], [turns[next]])).toBeGreaterThan(8 * 1024 * 1024);
  });
});

describe('时间线分组', () => {
  it('任务级切换条目保持各自的时间顺序，不把后一次切换提前到第一次', () => {
    const groups = buildTimeline([
      item({ type: 'provider_switch', ordinal: 1, turnId: null }),
      item({ type: 'user_message', ordinal: 2, turnId: 'a' }),
      item({ type: 'handoff', ordinal: 3, turnId: 'a' }),
      item({ type: 'assistant_message', ordinal: 4, turnId: 'a' }),
      item({ type: 'provider_switch', ordinal: 5, turnId: null }),
      item({ type: 'user_message', ordinal: 6, turnId: 'b' }),
    ], []);
    expect(groups.map(g => g.rows[0].kind === 'item' ? g.rows[0].item.ordinal : -1)).toEqual([1, 2, 5, 6]);
    expect(new Set(groups.map(g => g.key)).size).toBe(4);
  });
  it('工作条目聚合为一行，用户消息与最终回答保持可见；commentary 归入工作', () => {
    const g = buildTimeline([
      item({ type: 'user_message', ordinal: 1, payload: { text: '跑测试' } }),
      item({ type: 'assistant_message', ordinal: 2, payload: { text: '我先看看', phase: 'commentary' } }),
      item({ type: 'command_execution', ordinal: 3, payload: { command: 'pnpm test', status: 'completed' } }),
      item({ type: 'file_change', ordinal: 4, payload: { changes: [{ path: 'a.ts' }], status: 'completed' } }),
      item({ type: 'assistant_message', ordinal: 5, payload: { text: '通过了', phase: 'final_answer' } }),
    ], [turn('completed')]);
    expect(g).toHaveLength(1);
    expect(g[0].rows.map(r => r.kind === 'item' ? r.item.type : r.kind)).toEqual(['user_message', 'work', 'assistant_message']);
    const work = g[0].rows[1];
    expect(work.kind === 'work' && work.items.length).toBe(3);
    expect(work.kind === 'work' && work.seconds).toBe(12);
    expect(work.kind === 'work' && work.running).toBe(false);
  });
  it('运行中的回合最后一段工作显示为工作中', () => {
    const g = buildTimeline([item({ type: 'user_message', ordinal: 1 }), item({ type: 'command_execution', ordinal: 2, terminal: null, payload: { status: 'running', command: 'ls' } })], [turn('started', '2026-11-17T00:00:00Z', null)], Date.parse('2026-11-17T00:00:05Z'));
    expect(g[0].rows[1]).toMatchObject({ kind: 'work', running: true, seconds: 5 });
  });
  it('停止、失败与结果未知的回合写尾注，正常完成不写', () => {
    expect(buildTimeline([item({ type: 'user_message', ordinal: 1 })], [turn('interrupted')])[0].rows.at(-1)).toEqual({ kind: 'footer', id: 'footer:t1', label: '已停止 · 共工作 12 秒', failed: false });
    expect(buildTimeline([item({ type: 'user_message', ordinal: 1 })], [turn('failed')])[0].rows.at(-1)).toMatchObject({ label: '已失败 · 共工作 12 秒', failed: true });
    expect(buildTimeline([item({ type: 'user_message', ordinal: 1 })], [turn('unknown')])[0].rows.at(-1)).toMatchObject({ label: expect.stringContaining('结果未知') });
    expect(buildTimeline([item({ type: 'user_message', ordinal: 1 })], [turn('completed')])[0].rows.some(r => r.kind === 'footer')).toBe(false);
  });
  it('额度或限流暂停与输出上限分别呈现，保留部分回答', () => {
    for (const kind of ['usage','rate','output']) {
      const rows = buildTimeline([
        item({type:'assistant_message',ordinal:1,payload:{text:'部分回答'}}),
        item({type:'error',ordinal:2,payload:{limited:{kind}}}),
      ],[turn('failed')])[0].rows;
      expect(rows[0]).toMatchObject({kind:'item',item:{payload:{text:'部分回答'}}});
      expect(rows.at(-1)).toMatchObject({label:expect.stringContaining(kind === 'output' ? '已达到输出长度上限' : '已暂停'),failed:false});
    }
  });
  it('工作行摘要', () => {
    expect(workLabel(item({ type: 'command_execution', ordinal: 1, payload: { command: 'ls', status: 'running' } }))).toBe('正在运行 ls');
    expect(workLabel(item({ type: 'file_change', ordinal: 1, payload: { input: { file_path: 'a.ts' }, status: 'failed' } }))).toBe('未能修改 a.ts');
    expect(workLabel(item({ type: 'tool_call', ordinal: 1, payload: { name: 'mcp/x', status: 'completed' } }))).toBe('调用了 mcp/x');
  });
});

describe('请求面板选项', () => {
  const codex = { requestId: 'r', kind: 'command_approval', revision: 1, payload: { method: 'item/commandExecution/requestApproval', params: { command: 'git commit', reason: '写 .git' } }, origin: {}, status: 'pending' };
  it('Codex 命令审批：原生决定原样回传，没有“拒绝并停止”', () => {
    const o = requestOptions(codex, 'codex-app-server');
    expect(o.map(x => x.label)).toEqual(['批准一次', '本会话内同类都允许', '拒绝']);
    expect(o.map(x => x.result(''))).toEqual([{ decision: 'accept' }, { decision: 'acceptForSession' }, { decision: 'decline' }]);
    expect(requestTitle(codex)).toEqual({ title: '是否允许运行命令？', detail: 'git commit\n原因：写 .git' });
  });
  it('Claude 计划批准：批准并开始／继续修改（带意见）／拒绝', () => {
    const plan = { requestId: 'p', kind: 'plan_approval', revision: 1, payload: { tool: 'ExitPlanMode', input: { plan: '1. 改 a' } }, origin: {}, status: 'pending' };
    const o = requestOptions(plan, 'claude-sdk');
    expect(o.map(x => x.key)).toEqual(['approve', 'revise', 'deny']);
    expect(o[0].result('')).toEqual({ behavior: 'allow', updatedInput: { plan: '1. 改 a' } });
    expect(o[1].result('先别改 b')).toEqual({ behavior: 'deny', message: '请按意见修改计划：先别改 b' });
    expect(requestTitle(plan).detail).toBe('1. 改 a');
  });
  it('Codex 权限提升请求：本轮允许或拒绝', () => {
    const r = { requestId: 'x', kind: 'permission_approval', revision: 1, payload: { method: 'item/permissions/requestApproval', params: { permissions: { network: true } } }, origin: {}, status: 'pending' };
    expect(requestOptions(r, 'codex-app-server').map(x => x.result(''))).toEqual([{ permissions: { network: true }, scope: 'turn' }, { permissions: {}, scope: 'turn' }]);
  });
  it('A45: 权限审批完整显示原文，Claude 工具和文件审批显示实际全量入参', () => {
    const scope = { fileSystem: { read: ['目录😀'.repeat(40_000), '最后一项审阅目标'] } };
    const base = { requestId: 'long-request', revision: 1, origin: {}, status: 'pending' };
    const native = { ...base, kind: 'permission_approval', payload: { params: { permissions: scope } } };
    expect(JSON.parse(requestTitle(native).detail)).toEqual(native.payload.params);
    const input = { file_path: './受控测试.txt', content: '正文😀'.repeat(40_000) + '正文末尾' };
    for (const kind of ['tool_approval', 'file_approval']) {
      const claude = { ...base, kind, payload: { input } };
      expect(JSON.parse(requestTitle(claude).detail)).toEqual(input);
    }
  });
});

describe('复核 1620：请求表单与原生决定', () => {
  const base = { requestId: 'r', revision: 1, origin: {}, status: 'pending' };
  it('CR09：Codex 提问按 questions→answers 回传，Claude AskUserQuestion 带 answers 交回原入参', () => {
    const cx = requestForm({ ...base, kind: 'user_input', payload: { method: 'item/tool/requestUserInput', params: { questions: [{ id: 'q1', header: 'Pick', question: 'Which?', options: [{ label: 'A', description: 'a' }] }] } } }, 'codex-app-server')!;
    expect(cx.kind).toBe('questions');
    expect(cx.kind === 'questions' && cx.toResult({ q1: ['A'] })).toEqual({ answers: { q1: { answers: ['A'] } } });
    const input = { questions: [{ header: 'Pick', question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }] };
    const cc = requestForm({ ...base, kind: 'user_input', payload: { tool: 'AskUserQuestion', input } }, 'claude-sdk')!;
    expect(cc.kind === 'questions' && cc.toResult({ 'Which?': ['A', 'B'] })).toEqual({ behavior: 'allow', updatedInput: { ...input, answers: { 'Which?': 'A, B' } } });
    expect(requestOptions({ ...base, kind: 'user_input', payload: { tool: 'AskUserQuestion', input } }, 'claude-sdk')).toEqual([]);
  });
  it.each(['claude-sdk', 'codex-app-server'])('A09 %s 原生表单和 URL 请求只提供取消', driverId => {
    const url = 'http://127.0.0.1/private-form';
    const request = { ...base, kind: 'elicitation', payload: { params: { serverName: 'MCP fixture', mode: 'url', message: 'External input', url } } };
    const form = { ...request, payload: { params: { serverName: 'MCP fixture', mode: 'form', message: 'Provide name', requestedSchema: { type: 'object' } } } };
    for (const item of [request, form]) {
      expect(requestForm(item, driverId)).toBeNull();
      const options = requestOptions(item, driverId);
      expect(options.map(option => option.label)).toEqual(['取消 MCP 请求']);
      expect(options[0]?.result('')).toEqual({ action: 'cancel' });
      expect(requestTitle(item).detail).toContain('只能取消');
    }
    expect(requestTitle(request)).toEqual({ title: 'MCP 服务请求打开网页', detail: `MCP fixture\nExternal input\n${url}\n此版本无法完成 MCP 网页请求，只能取消。` });
  });
  it('CR16：只列原生给出的决定（不含“拒绝并中断”），修订型决定原样回传', () => {
    const amend = { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['git', 'status'] } };
    const o = requestOptions({ ...base, kind: 'command_approval', payload: { method: 'item/commandExecution/requestApproval', params: { availableDecisions: ['accept', amend, 'decline', 'cancel'] } } }, 'codex-app-server');
    expect(o.map(x => x.label)).toEqual(['批准一次', '批准并记住这条命令规则', '拒绝']);
    expect(o.map(x => x.result(''))).toEqual([{ decision: 'accept' }, { decision: amend }, { decision: 'decline' }]);
    // 真实 Codex 0.169：只列 accept、修订型与 cancel 时，仍提供“拒绝”＝decline，不提供 cancel
    const real = requestOptions({ ...base, kind: 'command_approval', payload: { params: { availableDecisions: ['accept', amend, 'cancel'] } } }, 'codex-app-server');
    expect(real.map(x => x.result(''))).toEqual([{ decision: 'accept' }, { decision: amend }, { decision: 'decline' }]);
    expect(requestOptions({ ...base, kind: 'command_approval', payload: { params: { availableDecisions: ['decline'] } } }, 'codex-app-server').map(x => x.result(''))).toEqual([{ decision: 'decline' }]);
  });
});
