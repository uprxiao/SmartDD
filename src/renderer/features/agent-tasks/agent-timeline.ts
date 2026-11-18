// 新任务区时间线的纯函数（便于单测）：按回合分组，工作条目聚合为“工作了 Ns”，
// 用户消息、最终回答、待处理请求、错误与计划保持可见（技术方案 T1.5 §4、需求 R01）。

export interface TimelineItem { itemId: string; turnId: string | null; type: string; ordinal: number; revision: number; payload: any; terminal: string | null; createdAt: string; updatedAt: string }
export interface TurnInfo { turn_id: string; status: string; accepted_at: string; started_at: string | null; ended_at: string | null; error_code: string | null; source_kind?: string; run_id?: string | null; native_turn_id?: string | null }
export interface TimelineRequest { requestId: string; kind: string; revision: number; payload: any; origin: { turnId?: string | null; nodeId?: string }; status: string; ownerTaskId?: string; ownerName?: string; driverId?: string; targetTaskTitle?: string }

interface TimelineSlice { items: TimelineItem[]; turns: TurnInfo[] }
const TIMELINE_ITEMS = 2000;
const TIMELINE_BYTES = 8 * 1024 * 1024;
const utf8 = new TextEncoder();
const rowSizes = new WeakMap<object, number>();

function rowBytes(row: object) {
  const cached = rowSizes.get(row);
  if (cached !== undefined) return cached;
  const bytes = utf8.encode(JSON.stringify(row)).byteLength + 1;
  rowSizes.set(row, bytes);
  return bytes;
}

/** Keep the most recently requested older page and the live snapshot within a joint budget. */
export function retainOlderTimeline(older: TimelineSlice, current: TimelineSlice) {
  if (!older.items.length) return { items: [], turns: [], clipped: false };
  const items: TimelineItem[] = [];
  const turns: TurnInfo[] = [];
  const itemIds = new Set(current.items.map(item => item.itemId));
  const turnIds = new Set(current.turns.map(turn => turn.turn_id));
  const olderTurns = new Map(older.turns.map(turn => [turn.turn_id, turn]));
  let bytes = '{"items":[],"turns":[]}'.length;
  for (const row of [...current.items, ...current.turns]) bytes += rowBytes(row);
  for (const item of older.items) {
    if (itemIds.has(item.itemId)) continue;
    const turn = item.turnId && !turnIds.has(item.turnId) ? olderTurns.get(item.turnId) : undefined;
    bytes += rowBytes(item);
    if (turn) bytes += rowBytes(turn);
    if (items.length + current.items.length >= TIMELINE_ITEMS || bytes > TIMELINE_BYTES) {
      return { items, turns, clipped: true };
    }
    itemIds.add(item.itemId);
    items.push(item);
    if (turn) { turnIds.add(turn.turn_id); turns.push(turn); }
  }
  return { items, turns, clipped: false };
}

const VISIBLE = new Set(['user_message', 'assistant_message', 'proposed_plan', 'error', 'todo_list', 'compaction', 'system_notice', 'files_changed']);
const WORK = new Set(['reasoning', 'command_execution', 'file_change', 'file_search', 'web_search', 'tool_call', 'subagent']);

export type Row =
  | { kind: 'item'; item: TimelineItem }
  | { kind: 'work'; id: string; items: TimelineItem[]; running: boolean; seconds: number }
  | { kind: 'footer'; id: string; label: string; failed: boolean };

export interface TurnGroup { key: string; turnId: string | null; status: string | null; rows: Row[]; seconds: number; failed: boolean; failureCode: string | null }

/** 回合耗时：宿主观测的开始到结束（未结束按 now）；重叠工具不重复累计。 */
export function turnSeconds(t: TurnInfo | undefined, now = Date.now()) {
  if (!t?.started_at) return 0;
  const end = t.ended_at ? Date.parse(t.ended_at) : now;
  return Math.max(0, Math.round((end - Date.parse(t.started_at)) / 1000));
}
export function formatDuration(s: number) { return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`; }

export function buildTimeline(items: TimelineItem[], turns: TurnInfo[], now = Date.now()): TurnGroup[] {
  const byTurn = new Map<string, { turnId: string | null; items: TimelineItem[] }>();
  for (const it of [...items].sort((a, b) => a.ordinal - b.ordinal)) {
    const k = it.turnId ?? `host:${it.itemId}`;
    if (!byTurn.has(k)) byTurn.set(k, { turnId: it.turnId ?? null, items: [] });
    byTurn.get(k)!.items.push(it);
  }
  const turnMap = new Map(turns.map(t => [t.turn_id, t]));
  const order = [...byTurn.keys()];
  const groups: TurnGroup[] = [];
  for (const key of order) {
    const { items: list, turnId } = byTurn.get(key)!;
    const turn = turnId ? turnMap.get(turnId) : undefined;
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
      // 过程正文随回合展开，但会隔开工具分组；最终回答独立显示。
      if (it.type === 'assistant_message' && it.payload?.phase === 'commentary') { work.push(it); return; }
      flush(false);
      if (VISIBLE.has(it.type) || !WORK.has(it.type)) rows.push({ kind: 'item', item: it });
      if (idx === list.length - 1) flush(true);
    });
    flush(true);
    const limited = list.find(it => it.type === 'error' && it.payload?.limited)?.payload.limited.kind;
    if (turn && (turn.status === 'interrupted' || turn.status === 'failed' || turn.status === 'unknown' || turn.status === 'completed' && limited && limited !== 'output')) {
      // An output limit leaves a partial answer. An exhausted quota pauses work.
      const label = turn.status === 'interrupted' ? '已停止'
        : turn.status === 'unknown' ? '接收结果未知'
          : limited === 'output' ? '已达到输出长度上限' : limited ? '已暂停' : '已失败';
      rows.push({ kind: 'footer', id: `footer:${key}`, label: `${label} · 共工作 ${formatDuration(turnSeconds(turn, now))}`, failed: !limited && turn.status !== 'interrupted' });
    }
    groups.push({ key, turnId, status: turn?.status ?? null, rows, seconds: turnSeconds(turn, now), failed: turn?.status === 'failed' && !limited, failureCode: turn?.error_code ?? null });
  }
  return groups;
}

const toolSummaryLabels: Record<string, (n: number) => string> = {
  read: n => `读取了 ${n} 个文件`,
  file_search: n => `搜索了 ${n} 次文件`,
  command_execution: n => `运行了 ${n} 条命令`,
  file_change: n => `修改了 ${n} 次文件`,
  web_search: n => `搜索了 ${n} 次网页`,
  tool_call: n => `调用了 ${n} 次工具`,
};

/** Consecutive successful tools form one expandable row. Prose, live and failed work are boundaries. */
export function workSegments(items: readonly TimelineItem[]) {
  const segments: Array<{ kind:'tools'; items:TimelineItem[] } | { kind:'single'; item:TimelineItem }> = [];
  for (const item of items) {
    const p = item.payload;
    const successfulTool = Object.hasOwn(toolSummaryLabels, item.type) && item.terminal === 'completed'
      && (!p?.status || p.status === 'completed') && (p?.exitCode == null || p.exitCode === 0);
    if (!successfulTool) {
      segments.push({ kind:'single', item });
      continue;
    }
    const previous = segments.at(-1);
    if (previous?.kind === 'tools') previous.items.push(item);
    else segments.push({ kind:'tools', items:[item] });
  }
  return segments;
}

export function summarizeTools(items: readonly TimelineItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const action = item.type === 'file_search' && (item.payload?.input?.file_path || item.payload?.name === 'Read') ? 'read' : item.type;
    counts.set(action, (counts.get(action) ?? 0) + 1);
  }
  return [...counts].map(([action, count]) => toolSummaryLabels[action](count)).join('，');
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
  // 提问与 MCP 表单由 requestForm 处理，不套用批准选项（复核 CR09）。
  if (r.kind === 'host_business') {
    if (r.payload.phase === 'executing') return [];
    if (r.payload.phase === 'queued_for_slot') return [{ key: 'revoke', label: '撤销批准', result: () => ({ choice: 'cancel' }), deny: true }];
    const deny = { key: 'deny', label: r.status === 'approved_pending_bind' ? '撤销授权' : '拒绝', result: () => ({ choice: 'deny' }), deny: true };
    if (r.status === 'approved_pending_bind') return [{ ...deny, key: 'revoke' }];
    return [...(r.payload.options ?? [{ label: '批准', value: 'allow' }]).map((o: { label: string; value: string }) => ({ key: o.value, label: o.label, result: () => ({ choice: o.value }) })), deny];
  }
  if (requestForm(r, driverId)) return [];
  // 未知种类的请求不给通用批准，只能拒绝（复核 NR09）。
  if (r.kind === 'other') return [{ key: 'deny', label: '拒绝（WillYou 不支持该请求）', result: () => (driverId === 'claude-sdk' ? { behavior: 'deny', message: 'WillYou 不支持该请求' } : { decision: 'decline' }), deny: true }];
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
  // 原生给出的可选决定按顺序原样列出（复核 CR16）；“拒绝并中断本轮”不提供（需求 R01，停止统一用停止键）。
  const available = r.payload?.params?.availableDecisions;
  if (Array.isArray(available) && available.length) {
    const label = (d: unknown) => typeof d === 'string'
      ? ({ accept: '批准一次', acceptForSession: '本会话内同类都允许', decline: '拒绝' } as Record<string, string>)[d] ?? d
      : d && typeof d === 'object' && 'acceptWithExecpolicyAmendment' in d ? '批准并记住这条命令规则'
        : d && typeof d === 'object' && 'applyNetworkPolicyAmendment' in d ? '批准并更新网络规则' : '其他选项';
    const listed = available.filter(d => d !== 'cancel').map((d, i) => ({ key: `d${i}:${typeof d === 'string' ? d : Object.keys(d as object)[0]}`, label: label(d), result: () => ({ decision: d }), deny: d === 'decline' }));
    // Codex 0.169 对提升权限的命令只列 cancel（拒绝并中断本轮）。需求不提供“拒绝并停止”，而 decline 已在真实冒烟中被接受（命令不执行、回合继续），
    // 所以原生只给 cancel 时仍提供“拒绝”＝decline；停止本轮用停止键。
    if (!available.includes('decline') && available.includes('cancel')) listed.push({ key: 'decline', label: '拒绝', result: () => ({ decision: 'decline' }), deny: true });
    return listed;
  }
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

/** 需要用户填写的请求（复核 CR09）：Agent 提问、MCP 表单。不套用“批准／拒绝”。 */
export interface FormQuestion { id: string; header: string; question: string; options: { label: string; description?: string }[]; multi: boolean; allowOther: boolean; secret?: boolean }
export interface FormField { name: string; title: string; type: 'string' | 'number' | 'boolean' | 'enum'; options?: string[]; required: boolean }
export type RequestForm =
  | { kind: 'questions'; questions: FormQuestion[]; toResult: (answers: Record<string, string[]>) => unknown; decline: () => unknown }
  | { kind: 'elicitation'; message: string; url?: string; fields: FormField[]; toResult: (action: 'accept' | 'decline' | 'cancel', content: Record<string, unknown> | null) => unknown };

export function requestForm(r: TimelineRequest, driverId: string): RequestForm | null {
  const p = r.payload ?? {};
  if (driverId === 'claude-sdk' && r.kind === 'user_input' && Array.isArray(p.input?.questions)) {
    const input = p.input;
    const questions: FormQuestion[] = input.questions.map((q: any, i: number) => ({ id: String(q.question ?? i), header: String(q.header ?? ''), question: String(q.question ?? ''), options: (q.options ?? []).map((o: any) => ({ label: String(o.label), description: o.description })), multi: !!q.multiSelect, allowOther: true }));
    // AskUserQuestion：答案按问题原文为键、多选以逗号分隔，随原入参交回（锁定 SDK 合同）。
    return { kind: 'questions', questions, toResult: answers => ({ behavior: 'allow', updatedInput: { ...input, answers: Object.fromEntries(questions.map(q => [q.question, (answers[q.id] ?? []).join(', ')])) } }), decline: () => ({ behavior: 'deny', message: '用户没有回答' }) };
  }
  if (driverId === 'codex-app-server' && r.kind === 'user_input' && Array.isArray(p.params?.questions)) {
    const questions: FormQuestion[] = p.params.questions.map((q: any) => ({ id: String(q.id), header: String(q.header ?? ''), question: String(q.question ?? ''), options: (q.options ?? []).map((o: any) => ({ label: String(o.label), description: o.description })), multi: false, allowOther: !!q.isOther || !(q.options ?? []).length, secret: !!q.isSecret }));
    return { kind: 'questions', questions, toResult: answers => ({ answers: Object.fromEntries(questions.map(q => [q.id, { answers: answers[q.id] ?? [] }])) }), decline: () => ({ answers: {} }) };
  }
  if (driverId === 'codex-app-server' && r.kind === 'elicitation') {
    const params = p.params ?? {}, schema = params.requestedSchema ?? params.request?.requestedSchema ?? {};
    const required = new Set<string>(Array.isArray(schema.required) ? schema.required : []);
    const fields: FormField[] = Object.entries(schema.properties ?? {}).map(([name, s]: [string, any]) => ({
      name, title: String(s?.title ?? s?.description ?? name), required: required.has(name),
      type: Array.isArray(s?.enum) ? 'enum' : s?.type === 'boolean' ? 'boolean' : s?.type === 'number' || s?.type === 'integer' ? 'number' : 'string', options: Array.isArray(s?.enum) ? s.enum.map(String) : undefined,
    }));
    return { kind: 'elicitation', message: String(params.message ?? params.request?.message ?? `${params.serverName ?? 'MCP 服务'} 需要你提供信息`), url: typeof params.url === 'string' ? params.url : undefined, fields, toResult: (action, content) => ({ action, content: action === 'accept' ? content : null, _meta: null }) };
  }
  return null;
}
