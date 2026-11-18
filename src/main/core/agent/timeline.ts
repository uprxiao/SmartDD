// 统一时间线投影（技术方案 T1.5 §4）：把两种执行器的原生条目映射为同一组规范条目类型。
// 只做映射与配对，不推断执行器没提供的内容（待办只在执行器提供结构化清单时出现）。
import type { DriverEvent } from './driver';

export type ItemType =
  | 'assistant_message' | 'reasoning' | 'proposed_plan' | 'todo_list' | 'command_execution' | 'file_change'
  | 'file_search' | 'web_search' | 'tool_call' | 'subagent' | 'compaction' | 'system_notice' | 'error';
export interface ItemUpsert { key: string; type: ItemType; payload: Record<string, unknown>; terminal?: 'completed' | 'failed' | null }

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Glob', 'Grep', 'Read', 'LS']);
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);
const TODO_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite']);
const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));

function claudeToolType(name: string): ItemType {
  if (name === 'Bash') return 'command_execution';
  if (FILE_TOOLS.has(name)) return 'file_change';
  if (SEARCH_TOOLS.has(name)) return 'file_search';
  if (WEB_TOOLS.has(name)) return 'web_search';
  if (name === 'ExitPlanMode') return 'proposed_plan';
  if (name === 'Agent' || name === 'Task') return 'subagent';
  return 'tool_call';
}

/** 每个运行一个投影器实例：保存工具调用与结果的配对，以及聚合的待办清单。 */
/** 计划条目只存一份计划正文（复核 T02）：入参里的 plan 移到顶层，不重复内联而让历史正文翻倍。 */
function planFields(input: unknown) {
  const { plan, ...rest } = (input ?? {}) as Record<string, unknown>;
  return { input: rest, plan: text(plan) };
}

export class TimelineProjector {
  private readonly claudeTools = new Map<string, { type: ItemType; name: string; input: unknown }>();
  private readonly todos = new Map<string, { id: string; subject: string; status: string }>();
  private readonly childLogs = new Map<string, string[]>();
  private readonly finals = new Map<string, { payload: Record<string, unknown>; terminal: 'completed' | 'failed' }>();
  private readonly childToolParent = new Map<string, string>();
  private readonly closedNotices = new Set<string>();

  constructor(private readonly driverId: 'claude-sdk' | 'codex-app-server') {}

  project(e: DriverEvent): ItemUpsert[] {
    return this.driverId === 'claude-sdk' ? this.claude(e) : this.codex(e);
  }

  private todoItem(): ItemUpsert {
    return { key: 'todo', type: 'todo_list', payload: { entries: [...this.todos.values()] } };
  }

  private lifecycleNotice(key: string, title: string, detail: string, terminal: ItemUpsert['terminal'], severity: 'info' | 'warning', reusable = false): ItemUpsert[] {
    if (!reusable && this.closedNotices.has(key)) return [];
    if (!reusable && terminal) this.closedNotices.add(key);
    return [{ key, type: 'system_notice', payload: { severity, title, detail: detail.slice(0, 4000) }, terminal }];
  }

  private claude(e: DriverEvent): ItemUpsert[] {
    if (e.type === 'item.completed' && e.itemType === 'assistant') {
      const msg = e.payload as { content?: any[]; model?: string; parentToolUseId?: string | null };
      // 原生子 Agent 的内部消息归子节点，不登记为主任务回答（复核 CR13，技术方案 §4）。
      if (msg.parentToolUseId) {
        const parent = this.claudeTools.get(msg.parentToolUseId);
        const log = this.childLogs.get(msg.parentToolUseId) ?? [];
        for (const b of msg.content ?? []) {
          if (b?.type === 'text' && b.text) log.push(String(b.text).slice(0, 4000));
          else if (b?.type === 'tool_use') { log.push(`调用 ${b.name}`); this.childToolParent.set(b.id, msg.parentToolUseId); }
        }
        this.childLogs.set(msg.parentToolUseId, log.slice(-50));
        // 终态单调（复核 NR11）：子节点已有结果后，迟到的内部消息只追加记录，不恢复运行中。
        const final = this.finals.get(msg.parentToolUseId);
        if (final) return [{ key: `tool:${msg.parentToolUseId}`, type: 'subagent', payload: { ...final.payload, nativeNodeIds: [msg.parentToolUseId], childLog: log.slice(-50), childLogPreviewOnly: true }, terminal: final.terminal }];
        return parent ? [{ key: `tool:${msg.parentToolUseId}`, type: 'subagent', payload: { name: parent.name, input: parent.input, status: 'running', nativeNodeIds: [msg.parentToolUseId], childLog: log.slice(-50), childLogPreviewOnly: true }, terminal: null }] : [];
      }
      const out: ItemUpsert[] = [];
      (msg.content ?? []).forEach((block: any, idx: number) => {
        const key = `${e.nativeItemId}:${idx}`;
        if (block?.type === 'text' && block.text) out.push({ key, type: 'assistant_message', payload: { text: block.text, model: msg.model ?? null }, terminal: 'completed' });
        else if (block?.type === 'thinking' && block.thinking) out.push({ key, type: 'reasoning', payload: { text: block.thinking }, terminal: 'completed' });
        else if (block?.type === 'tool_use') {
          const type = claudeToolType(block.name);
          this.claudeTools.set(block.id, { type, name: block.name, input: block.input });
          if (TODO_TOOLS.has(block.name)) return; // 只在成功结果后改清单（V10b，RR03）
          out.push({ key: `tool:${block.id}`, type, payload: { name: block.name, status: 'running', ...(type === 'subagent' ? { nativeNodeIds: [block.id], kind: 'provider_native' } : {}), ...(type === 'proposed_plan' ? planFields(block.input) : { input: block.input }) }, terminal: null });
        }
      });
      return out;
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'user') {
      const content = (e.payload as any).message?.content;
      if (!Array.isArray(content)) return [];
      const out: ItemUpsert[] = [];
      if (typeof (e.payload as any).parent_tool_use_id === 'string') return []; // 子 Agent 内部工具结果不进主时间线
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
        if (this.childToolParent.has(block.tool_use_id)) continue;
        const tool = this.claudeTools.get(block.tool_use_id);
        if (!tool) continue;
        const failed = !!block.is_error;
        if (TODO_TOOLS.has(tool.name)) {
          if (failed) continue;
          const input = tool.input as any;
          if (tool.name === 'TodoWrite' && Array.isArray(input?.todos)) { this.todos.clear(); input.todos.forEach((t: any, i: number) => this.todos.set(String(i), { id: String(i), subject: text(t.content), status: text(t.status) })); }
          else if (tool.name === 'TaskCreate') { const id = String((e.payload as any).tool_use_result?.task?.id ?? this.todos.size + 1); this.todos.set(id, { id, subject: text(input?.subject), status: 'pending' }); }
          else if (tool.name === 'TaskUpdate' && input?.taskId != null) { const cur = this.todos.get(String(input.taskId)); if (cur) this.todos.set(cur.id, { ...cur, status: text(input.status ?? cur.status) }); }
          out.push(this.todoItem());
          continue;
        }
        const output = Array.isArray(block.content) ? block.content.map((c: any) => c?.text ?? '').join('\n') : text(block.content);
        const finalPayload = { name: tool.name, input: tool.input, output: output.slice(0, 16_000), status: failed ? 'failed' : 'completed' };
        if (tool.type === 'subagent') this.finals.set(block.tool_use_id, { payload: finalPayload, terminal: failed ? 'failed' : 'completed' });
        out.push({ key: `tool:${block.tool_use_id}`, type: tool.type, payload: { name: tool.name, output: output.slice(0, 16_000), status: failed ? 'failed' : 'completed', ...(tool.type === 'subagent' ? { nativeNodeIds: [block.tool_use_id], childLog: this.childLogs.get(block.tool_use_id) ?? [], childLogPreviewOnly: true } : {}), ...(tool.type === 'proposed_plan' ? planFields(tool.input) : { input: tool.input }) }, terminal: failed ? 'failed' : 'completed' });
      }
      return out;
    }
    // Claude 受限（复核 NR08）：rate_limit_event 拒绝、assistant.error 的 rate_limit／max_output_tokens，分别标额度／限流与输出上限。
    if (e.type === 'native' && (e.payload as any)?.type === 'rate_limit_event' && (e.payload as any).rate_limit_info?.status === 'rejected') {
      const info = (e.payload as any).rate_limit_info;
      const resetAt = typeof info.resetsAt === 'number' ? new Date(info.resetsAt * (info.resetsAt < 1e12 ? 1000 : 1)).toISOString() : undefined;
      return [{ key: `limit:${(e.payload as any).uuid ?? Date.now()}`, type: 'error', payload: { code: 'rate_limit_rejected', message: `额度受限（${info.rateLimitType ?? '未知类型'}）`, limited: { kind: 'usage', ...(resetAt ? { resetAt } : {}) } }, terminal: 'failed' }];
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'assistant' && typeof (e.payload as any).error === 'string' && !(e.payload as any).parent_tool_use_id) {
      const err = (e.payload as any).error as string;
      const limited = err === 'rate_limit' ? { kind: 'rate' } : err === 'max_output_tokens' ? { kind: 'output' } : err === 'billing_error' ? { kind: 'usage' } : null;
      const text = ((e.payload as any).message?.content ?? []).map((b: any) => b?.text ?? '').join('').slice(0, 2000);
      return [{ key: `assistant-error:${(e.payload as any).uuid ?? Date.now()}`, type: 'error', payload: { code: err, message: text || err, ...(limited ? { limited } : {}) }, terminal: 'failed' }];
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'system' && (e.payload as any).subtype === 'compact_boundary') {
      return [{ key: `compact:${(e.payload as any).uuid ?? Date.now()}`, type: 'compaction', payload: {}, terminal: 'completed' }];
    }
    if (e.type === 'native' && ['system/hook_started', 'system/hook_progress', 'system/hook_response'].includes(e.name)) {
      const p = e.payload as { hook_id?: string; hook_name?: string; hook_event?: string; outcome?: string; exit_code?: number };
      if (!p?.hook_id) return [];
      const done = e.name === 'system/hook_response';
      const failed = done && p.outcome !== 'success';
      const detail = [p.hook_event, done ? p.outcome : '运行中', p.exit_code == null ? null : `退出码 ${p.exit_code}`].filter(Boolean).join(' · ');
      return this.lifecycleNotice(`hook:${p.hook_id}`, `钩子 · ${p.hook_name ?? p.hook_event ?? 'Claude'}`, detail, done ? failed ? 'failed' : 'completed' : null, failed ? 'warning' : 'info');
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'result' && (e.payload as any).is_error && (e.payload as any).subtype !== 'error_during_execution') {
      const p = e.payload as any;
      return [{ key: `error:${p.uuid ?? p.session_id}`, type: 'error', payload: { code: p.subtype, message: text(p.result ?? p.errors ?? p.subtype) }, terminal: 'failed' }];
    }
    return [];
  }

  private codex(e: DriverEvent): ItemUpsert[] {
    if (e.type === 'native' && e.name === 'item/started') {
      const item = (e.payload as any)?.item;
      const mapped = item && this.codexItem(item, false);
      return mapped ? [mapped] : [];
    }
    if (e.type === 'item.completed') {
      const mapped = this.codexItem(e.payload as any, true);
      return mapped ? [mapped] : [];
    }
    if (e.type === 'native' && e.name === 'turn/plan/updated') {
      const plan = (e.payload as any)?.plan;
      if (!Array.isArray(plan)) return [];
      this.todos.clear();
      plan.forEach((s: any, i: number) => this.todos.set(String(i), { id: String(i), subject: text(s.step), status: text(s.status) }));
      return [this.todoItem()];
    }
    if (e.type === 'native' && e.name === 'request/unsupported') {
      return [{ key: `unsupported:${text((e.payload as any)?.method)}:${Date.now()}`, type: 'system_notice', payload: { severity: 'warning', code: 'unsupportedRequest', detail: `执行器发来 WillYou 不支持的请求（${text((e.payload as any)?.method)}），已拒绝` }, terminal: 'completed' }];
    }
    if (e.type === 'native' && (e.name === 'hook/started' || e.name === 'hook/completed')) {
      const p = e.payload as { run?: { id?: string; eventName?: string; status?: string; statusMessage?: string } };
      const hook = p?.run;
      if (!hook?.id) return [];
      const done = e.name === 'hook/completed';
      const failed = done && hook.status !== 'completed';
      return this.lifecycleNotice(`hook:${hook.id}`, `钩子 · ${hook.eventName ?? 'Codex'}`, hook.statusMessage ?? hook.status ?? '', done ? failed ? 'failed' : 'completed' : null, failed ? 'warning' : 'info');
    }
    if (e.type === 'native' && e.name === 'mcpServer/startupStatus/updated') {
      const p = e.payload as { name?: string; status?: string; error?: string };
      if (!p?.name || !p.status) return [];
      const failed = p.status === 'failed' || p.status === 'cancelled';
      return this.lifecycleNotice(`mcp-startup:${p.name}`, `MCP 启动 · ${p.name}`, p.error ?? p.status, failed ? 'failed' : p.status === 'ready' ? 'completed' : null, failed ? 'warning' : 'info', true);
    }
    if (e.type === 'native' && (e.name === 'item/autoApprovalReview/started' || e.name === 'item/autoApprovalReview/completed')) {
      const p = e.payload as { reviewId?: string; review?: { status?: string; rationale?: string } };
      if (!p?.reviewId) return [];
      const done = e.name === 'item/autoApprovalReview/completed';
      const detail = [p.review?.status, p.review?.rationale].filter(Boolean).join(' · ');
      return this.lifecycleNotice(`auto-review:${p.reviewId}`, '自动审批检查', detail, done ? 'completed' : null, done && p.review?.status !== 'approved' ? 'warning' : 'info');
    }
    if (e.type === 'native' && ['warning', 'configWarning', 'deprecationNotice', 'guardianWarning'].includes(e.name)) {
      const p = e.payload as any;
      return [{ key: `notice:${e.name}:${text(p?.summary ?? p?.message).slice(0, 80)}`, type: 'system_notice', payload: { severity: 'warning', code: e.name, detail: text(p?.summary ?? p?.message ?? p) }, terminal: 'completed' }];
    }
    if (e.type === 'native' && e.name === 'error') {
      const p = e.payload as any;
      const info = p?.error?.codexErrorInfo;
      const code = typeof info === 'string' ? info : info && typeof info === 'object' ? Object.keys(info)[0] : 'error';
      // 受限与普通失败分开（复核 CR18，需求 R02）：额度／限流与输出上限各自标明，保留原生事实。
      const limited = code === 'usageLimitExceeded' ? { kind: 'usage' } : code === 'rateLimitExceeded' || code === 'tooManyRequests' ? { kind: 'rate' } : code === 'contextWindowExceeded' ? { kind: 'context' } : null;
      return [{ key: `error:${p?.turnId ?? ''}:${text(p?.error?.message).slice(0, 40)}`, type: 'error', payload: { code, message: text(p?.error?.message ?? p), ...(limited ? { limited } : {}) }, terminal: 'failed' }];
    }
    return [];
  }

  private codexItem(item: any, done: boolean): ItemUpsert | null {
    if (!item || typeof item.id !== 'string') return null;
    const key = item.id, status = done ? (item.status === 'declined' ? 'declined' : item.status === 'failed' ? 'failed' : 'completed') : 'running';
    const terminal = done ? (status === 'completed' ? 'completed' : 'failed') : null;
    switch (item.type) {
      case 'agentMessage':
        return done ? { key, type: 'assistant_message', payload: { text: text(item.text), phase: item.phase ?? null }, terminal } : null;
      case 'plan': // Codex 不出计划卡：原生 plan 按普通回答显示，保留 nativeType（需求 R02）
        return done ? { key, type: 'assistant_message', payload: { text: text(item.text), nativeType: 'plan' }, terminal } : null;
      case 'reasoning':
        return done ? { key, type: 'reasoning', payload: { text: [...(item.summary ?? []), ...(item.content ?? [])].map(text).join('\n') }, terminal } : null;
      case 'commandExecution':
        return { key, type: 'command_execution', payload: { command: text(item.command), cwd: item.cwd ?? null, output: text(item.aggregatedOutput).slice(0, 16_000), exitCode: item.exitCode ?? null, status }, terminal };
      case 'fileChange':
        return { key, type: 'file_change', payload: { changes: (item.changes ?? []).map((c: any) => ({ path: c.path, kind: c.kind?.type ?? c.kind })), status }, terminal };
      case 'mcpToolCall': case 'dynamicToolCall':
        return { key, type: 'tool_call', payload: { name: `${item.server ? item.server + '/' : ''}${item.tool ?? item.name ?? ''}`, input: item.arguments ?? null, output: item.result ?? item.error ?? null, status }, terminal };
      case 'webSearch':
        return { key, type: 'web_search', payload: { query: text(item.query), status }, terminal };
      case 'collabAgentToolCall':
        return { key, type: 'subagent', payload: { kind: 'provider_native', tool: item.tool ?? null, status, prompt: item.prompt ?? null, nativeNodeIds: item.receiverThreadIds ?? [], agentsStates: item.agentsStates ?? {} }, terminal };
      case 'contextCompaction':
        return done ? { key, type: 'compaction', payload: {}, terminal } : null;
      default:
        return null; // userMessage 由宿主在本地接受时记录；其他类型留在原生诊断
    }
  }
}
