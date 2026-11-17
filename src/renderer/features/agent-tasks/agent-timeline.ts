// 新任务区时间线的纯函数（便于单测）：按回合分组，工作条目聚合为“工作了 Ns”，
// 用户消息、最终回答、待处理请求、错误与计划保持可见（技术方案 T1.5 §4、需求 R01）。

export interface TimelineItem { itemId: string; turnId: string | null; type: string; ordinal: number; revision: number; payload: any; terminal: string | null; createdAt: string; updatedAt: string }
export interface TurnInfo { turn_id: string; status: string; accepted_at: string; started_at: string | null; ended_at: string | null; error_code: string | null }
export interface TimelineRequest { requestId: string; kind: string; revision: number; payload: any; origin: { turnId?: string | null }; status: string }

const VISIBLE = new Set(['user_message', 'assistant_message', 'proposed_plan', 'error', 'todo_list', 'compaction', 'system_notice']);
const WORK = new Set(['reasoning', 'command_execution', 'file_change', 'file_search', 'web_search', 'tool_call', 'subagent']);

export type Row =
  | { kind: 'item'; item: TimelineItem }
  | { kind: 'work'; id: string; items: TimelineItem[]; running: boolean; seconds: number }
  | { kind: 'footer'; id: string; label: string; failed: boolean };

export interface TurnGroup { turnId: string | null; status: string | null; rows: Row[] }

/** 回合耗时：宿主观测的开始到结束（未结束按 now）；重叠工具不重复累计。 */
export function turnSeconds(t: TurnInfo | undefined, now = Date.now()) {
  if (!t?.started_at) return 0;
  const end = t.ended_at ? Date.parse(t.ended_at) : now;
  return Math.max(0, Math.round((end - Date.parse(t.started_at)) / 1000));
}
export function formatDuration(s: number) { return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`; }

export function buildTimeline(items: TimelineItem[], turns: TurnInfo[], now = Date.now()): TurnGroup[] {
  const byTurn = new Map<string | null, TimelineItem[]>();
  for (const it of [...items].sort((a, b) => a.ordinal - b.ordinal)) {
    const k = it.turnId ?? null;
    if (!byTurn.has(k)) byTurn.set(k, []);
    byTurn.get(k)!.push(it);
  }
  const turnMap = new Map(turns.map(t => [t.turn_id, t]));
  const order: (string | null)[] = [...byTurn.keys()];
  const groups: TurnGroup[] = [];
  for (const key of order) {
    const list = byTurn.get(key)!;
    const turn = key ? turnMap.get(key) : undefined;
    const live = !!turn && ['dispatching', 'started'].includes(turn.status);
    const rows: Row[] = [];
    let work: TimelineItem[] = [];
    const flush = (last: boolean) => {
      if (!work.length) return;
      const running = work.some(w => !w.terminal) || (last && live);
      rows.push({ kind: 'work', id: `work:${work[0].itemId}`, items: work, running, seconds: turnSeconds(turn, now) });
      work = [];
    };
    list.forEach((it, idx) => {
      if (WORK.has(it.type)) { work.push(it); return; }
      // 中间过程说明（Codex commentary）归入工作折叠，最终回答保持可见
      if (it.type === 'assistant_message' && it.payload?.phase === 'commentary') { work.push(it); return; }
      flush(false);
      if (VISIBLE.has(it.type) || !WORK.has(it.type)) rows.push({ kind: 'item', item: it });
      if (idx === list.length - 1) flush(true);
    });
    flush(true);
    if (turn && (turn.status === 'interrupted' || turn.status === 'failed' || turn.status === 'unknown')) {
      const label = turn.status === 'interrupted' ? '已停止' : turn.status === 'unknown' ? '结果未知 · 正在核对' : '已失败';
      rows.push({ kind: 'footer', id: `footer:${key}`, label: `${label} · 共工作 ${formatDuration(turnSeconds(turn, now))}`, failed: turn.status !== 'interrupted' });
    }
    groups.push({ turnId: key, status: turn?.status ?? null, rows });
  }
  return groups;
}

/** 工作条目的单行摘要。 */
export function workLabel(it: TimelineItem): string {
  const p = it.payload ?? {};
  switch (it.type) {
    case 'command_execution': return `${p.status === 'running' ? '正在运行' : p.status === 'declined' ? '已拒绝运行' : p.status === 'failed' ? '运行失败' : '运行了'} ${p.command ?? p.input?.command ?? ''}`.trim();
    case 'file_change': {
      const paths: string[] = p.changes?.map((c: any) => c.path) ?? (p.input?.file_path ? [p.input.file_path] : []);
      return `${p.status === 'running' ? '正在修改' : p.status === 'declined' ? '已拒绝修改' : p.status === 'failed' ? '未能修改' : '修改了'} ${paths.join('、')}`.trim();
    }
    case 'file_search': return `${p.status === 'running' ? '正在查看' : '查看了'} ${p.input?.file_path ?? p.input?.pattern ?? p.input?.path ?? ''}`.trim();
    case 'web_search': return `搜索 ${p.query ?? p.input?.query ?? p.input?.url ?? ''}`.trim();
    case 'reasoning': return '思考';
    case 'subagent': return `子 Agent ${p.input?.description ?? p.tool ?? ''}`.trim();
    case 'assistant_message': return String(p.text ?? '').split('\n')[0].slice(0, 120);
    default: return `${p.status === 'running' ? '正在调用' : '调用了'} ${p.name ?? '工具'}`;
  }
}

/** 请求面板的选项：原生选项原样回传，不压成布尔值（技术方案 §3 respond）。 */
export interface RequestOption { key: string; label: string; result: (reason: string) => unknown; deny?: boolean }
export function requestOptions(r: TimelineRequest, driverId: string): RequestOption[] {
  if (driverId === 'claude-sdk') {
    const input = r.payload?.input;
    if (r.kind === 'plan_approval') return [
      { key: 'approve', label: '批准并开始', result: () => ({ behavior: 'allow', updatedInput: input }) },
      { key: 'revise', label: '继续修改（须写意见）', result: reason => ({ behavior: 'deny', message: reason ? `请按意见修改计划：${reason}` : '请修改计划' }), deny: true },
      { key: 'deny', label: '拒绝', result: reason => ({ behavior: 'deny', message: reason || '用户拒绝了计划' }), deny: true },
    ];
    return [
      { key: 'once', label: '批准', result: () => ({ behavior: 'allow', updatedInput: input }) },
      { key: 'deny', label: '拒绝', result: reason => ({ behavior: 'deny', message: reason || '用户拒绝' }), deny: true },
    ];
  }
  const method = r.payload?.method as string | undefined;
  if (r.kind === 'permission_approval') return [
    { key: 'turn', label: '本轮允许', result: () => ({ permissions: r.payload?.params?.permissions ?? {}, scope: 'turn' }) },
    { key: 'deny', label: '拒绝', result: () => ({ permissions: {}, scope: 'turn' }), deny: true },
  ];
  if (method === 'execCommandApproval' || method === 'applyPatchApproval') return [
    { key: 'once', label: '批准一次', result: () => ({ decision: 'approved' }) },
    { key: 'session', label: '本会话内同类都允许', result: () => ({ decision: 'approved_for_session' }) },
    { key: 'deny', label: '拒绝', result: () => ({ decision: 'denied' }), deny: true },
  ];
  return [
    { key: 'once', label: '批准一次', result: () => ({ decision: 'accept' }) },
    { key: 'session', label: '本会话内同类都允许', result: () => ({ decision: 'acceptForSession' }) },
    { key: 'deny', label: '拒绝', result: () => ({ decision: 'decline' }), deny: true },
  ];
}
export function requestTitle(r: TimelineRequest): { title: string; detail: string } {
  const p = r.payload ?? {}, params = p.params ?? {};
  if (r.kind === 'plan_approval') return { title: 'Claude 交出了计划，是否开始执行？', detail: String(p.input?.plan ?? '') };
  if (r.kind === 'command_approval') return { title: '是否允许运行命令？', detail: String(params.command ?? p.input?.command ?? '') + (params.reason ? `\n原因：${params.reason}` : '') };
  if (r.kind === 'file_approval') return { title: '是否允许修改文件？', detail: String(p.input?.file_path ?? params.reason ?? '') };
  if (r.kind === 'user_input') return { title: 'Agent 有问题要问你', detail: JSON.stringify(params.questions ?? p.input?.questions ?? params, null, 1).slice(0, 2000) };
  return { title: p.title ?? '是否允许这项操作？', detail: JSON.stringify(params ?? p.input ?? {}, null, 1).slice(0, 2000) };
}
