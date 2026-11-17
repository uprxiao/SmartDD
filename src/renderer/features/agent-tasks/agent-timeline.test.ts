import { describe, expect, it } from 'vitest';
import { buildTimeline, requestOptions, requestTitle, workLabel, type TimelineItem } from './agent-timeline';

// M14-A52 统一时间线与工作折叠、A60 终态尾注、A11 请求选项（界面逻辑层）。
const item = (o: Partial<TimelineItem> & { type: string; ordinal: number }): TimelineItem => ({ itemId: `i${o.ordinal}`, turnId: 't1', revision: 1, payload: {}, terminal: 'completed', createdAt: '', updatedAt: '', ...o });
const turn = (status: string, s = '2026-11-17T00:00:00Z', e: string | null = '2026-11-17T00:00:12Z') => ({ turn_id: 't1', status, accepted_at: s, started_at: s, ended_at: e, error_code: null });

describe('时间线分组', () => {
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
});
