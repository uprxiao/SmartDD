// 统一时间线投影（技术方案 T1.5 §4）：把两种执行器的原生条目映射为同一组规范条目类型。
// 只做映射与配对，不推断执行器没提供的内容（待办只在执行器提供结构化清单时出现）。
import type { SDKPartialAssistantMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentActivityError, AgentActivityStatus, AgentActivityUpdate, AgentRetryProgress } from '@shared/agent-activity';
import type { DriverEvent, TurnStatus } from './driver';
import type { DriverId } from './capabilities';

export type ItemType =
  | 'assistant_message' | 'reasoning' | 'proposed_plan' | 'todo_list' | 'command_execution' | 'file_change'
  | 'file_search' | 'web_search' | 'tool_call' | 'subagent' | 'compaction' | 'system_notice' | 'error';
export interface ItemUpsert { key: string; type: ItemType; payload: Record<string, unknown>; terminal?: 'completed' | 'failed' | null }

const FILE_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const SEARCH_TOOLS = new Set(['Glob', 'Grep', 'Read', 'LS']);
const WEB_TOOLS = new Set(['WebSearch', 'WebFetch']);
const TODO_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite']);
const text = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : JSON.stringify(v));
type CodexQuotaWindow = { usedPercent?: unknown; resetsAt?: unknown };

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

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

const CLAUDE_PROGRESS_MODELS = new Set([
  'claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5', 'claude-fable-5-1', 'claude-fable-5-2',
  'claude-mythos-5-1', 'claude-mythos-5-2',
]);
const CLAUDE_THINKING_UPDATE_MS = 100;

interface ClaudeThinkingBlock {
  key: string;
  text: string;
  signed: boolean;
  stopped: boolean;
  progress: boolean;
  published?: { text: string; terminal: ItemUpsert['terminal']; at: number };
}
interface ClaudeThinkingMessage {
  id: string;
  model: string;
  byIndex: Map<number, ClaudeThinkingBlock>;
  pendingSnapshots: ClaudeThinkingBlock[];
  snapshots: Set<string>;
}

function publishClaudeThinking(block: ClaudeThinkingBlock): ItemUpsert[] {
  if (!block.text.trim()) return [];
  const terminal = block.stopped ? 'completed' : null;
  if (block.published?.text === block.text && block.published.terminal === terminal) return [];
  const at = performance.now();
  // The first chunk establishes the row's position. Coalesce intermediate writes until completion.
  if (!terminal && block.published && at - block.published.at < CLAUDE_THINKING_UPDATE_MS) return [];
  block.published = { text: block.text, terminal, at };
  return [{ key: block.key, terminal, type: block.progress ? 'assistant_message' : 'reasoning',
    payload: { text: block.text, ...(block.progress ? { phase: 'commentary' } : {}) } }];
}

export class TimelineProjector {
  private readonly claudeTools = new Map<string, { type: ItemType; name: string; input: unknown }>();
  private readonly claudeThinkingMessages = new Map<string, ClaudeThinkingMessage>();
  private claudeThinkingMessage?: ClaudeThinkingMessage;
  private readonly todos = new Map<string, { id: string; subject: string; status: string }>();
  private readonly childLogs = new Map<string, string[]>();
  private readonly finals = new Map<string, { payload: Record<string, unknown>; terminal: 'completed' | 'failed' }>();
  private readonly childToolParent = new Map<string, string>();
  private readonly closedNotices = new Set<string>();
  private codexTurnId?: string;
  private codexQuota: { primary?: CodexQuotaWindow; secondary?: CodexQuotaWindow } = {};
  private activityTurnId?: string;
  private readonly compactions = new Map<string, AgentActivityStatus>();
  private retry?: AgentRetryProgress;
  private claudeCompactionId?: string;
  private readonly claudeActivityFrames = new Set<string>();

  private readonly acpTools = new Map<string, Record<string, unknown>>();
  constructor(private readonly driverId: DriverId) {}

  project(e: DriverEvent): ItemUpsert[] {
    if (e.type === 'turn.started' && this.activityTurnId !== e.nativeTurnId) {
      this.resetActivity();
      this.activityTurnId = e.nativeTurnId;
    }
    if (e.type === 'activity') return this.projectActivity(e.nativeTurnId, e.activity);
    const items = this.driverId === 'claude-sdk' ? this.claude(e)
      : this.driverId === 'antigravity-acp' ? this.acp(e) : this.codex(e);
    if (e.type === 'turn.completed' && e.nativeTurnId === this.activityTurnId)
      return [...items, ...this.finishActivity(e.status, e.error)];
    if (e.type === 'exit' || e.type === 'unusable')
      return [...items, ...this.finishActivity('unknown')];
    return items;
  }

  private resetActivity() {
    this.activityTurnId = undefined;
    this.compactions.clear();
    this.retry = undefined;
    this.claudeCompactionId = undefined;
  }

  private projectActivity(turnId: string | undefined, update: AgentActivityUpdate): ItemUpsert[] {
    if (!turnId || turnId !== this.activityTurnId) return [];
    const { status } = update;
    const terminal = status === 'running' ? null : status === 'completed' ? 'completed' : 'failed';
    if (update.kind === 'compaction') {
      const key = `compact:${turnId}:${update.id}`;
      const previous = this.compactions.get(update.id);
      if (previous && (previous !== 'running' || status === 'running')) return [];
      this.compactions.set(update.id, status);
      return [{ key, type: 'compaction', terminal, payload: { status, ...(update.message ? { message: update.message.slice(0, 2000) } : {}) } }];
    }
    if (status !== 'running' && !this.retry) return [];
    const retry: AgentRetryProgress = status === 'running'
      ? { status, attempt: update.attempt, maxAttempts: update.maxAttempts, retryDelayMs: update.retryDelayMs }
      : { ...this.retry, status };
    this.retry = status === 'running' ? retry : undefined;
    return [{ key: `retry:${turnId}`, type: 'error', terminal,
      payload: { retry, ...(update.code ? { code: update.code } : {}),
        ...(update.message ? { message: update.message.slice(0, 2000) } : {}),
        ...(status === 'failed' && update.limited ? { limited: update.limited } : {}) } }];
  }

  private finishActivity(status: TurnStatus, message?: string): ItemUpsert[] {
    const turnId = this.activityTurnId;
    const compactionStatus = status === 'completed' || status === 'failed' ? 'failed' : 'interrupted';
    const items = [...this.compactions].flatMap(([id, phase]) => phase === 'running'
      ? this.projectActivity(turnId, { kind: 'compaction', id, status: compactionStatus, message })
      : []);
    items.push(...this.projectActivity(turnId, { kind: 'retry', status: status === 'unknown' ? 'interrupted' : status, message }));
    this.resetActivity();
    return items;
  }

  private acp(event: DriverEvent): ItemUpsert[] {
    if (event.type !== 'item.completed') return [];
    const payload = event.payload as Record<string, unknown>;
    const key = event.nativeItemId;
    if (event.itemType === 'agentMessage') return [{ key, type: 'assistant_message', payload, terminal: 'completed' }];
    if (event.itemType === 'reasoning') return [{ key, type: 'reasoning', payload, terminal: 'completed' }];
    if (event.itemType === 'acpError') return [{ key, type: 'error', payload, terminal: 'failed' }];
    if (event.itemType === 'acpEffortFallback' && typeof payload.detail === 'string') {
      return this.lifecycleNotice(key, '推理档位', payload.detail, 'completed', 'warning', false,
        { code: 'configWarning', status: 'completed', diagnosticOnly: false });
    }
    if (event.itemType !== 'acpToolCall') return [];
    const update = { ...this.acpTools.get(key), ...payload };
    const terminal = update.status === 'completed' ? 'completed' : update.status === 'failed' ? 'failed' : null;
    if (terminal) this.acpTools.delete(key);
    else this.acpTools.set(key, update);
    return [{ key, type: 'tool_call', terminal, payload: { name: update.title, input: update.rawInput, status: update.status, output: update.rawOutput } }];
  }

  private todoItem(): ItemUpsert {
    return { key: 'todo', type: 'todo_list', payload: { entries: [...this.todos.values()] } };
  }

  private lifecycleNotice(key: string, title: string, detail: string, terminal: ItemUpsert['terminal'], severity: 'info' | 'warning', reusable = false, lifecycle?: {code: string; status: string; diagnosticOnly: boolean}): ItemUpsert[] {
    if (!reusable && this.closedNotices.has(key)) return [];
    if (!reusable && terminal) this.closedNotices.add(key);
    return [{ key, type: 'system_notice', payload: { severity, title, detail: detail.slice(0, 4000), ...lifecycle }, terminal }];
  }

  private claudeSystemActivity(p: { subtype?: string; status?: string | null; uuid?: string;
    compact_result?: 'success' | 'failed'; compact_error?: string; attempt?: number; max_retries?: number;
    retry_delay_ms?: number; error?: string }, turnId: string, turnInterrupted?: true): ItemUpsert[] {
    if (p.subtype === 'status' && p.status !== 'compacting' && !p.compact_result) return [];
    if (p.uuid) {
      if (this.claudeActivityFrames.has(p.uuid)) return [];
      this.claudeActivityFrames.add(p.uuid);
      if (this.claudeActivityFrames.size > 512)
        this.claudeActivityFrames.delete(this.claudeActivityFrames.values().next().value!);
    }
    if (p.subtype === 'api_retry') {
      return this.projectActivity(turnId, { kind: 'retry', status: 'running',
        attempt: positiveInteger(p.attempt), maxAttempts: positiveInteger(p.max_retries),
        retryDelayMs: typeof p.retry_delay_ms === 'number' && Number.isSafeInteger(p.retry_delay_ms) && p.retry_delay_ms >= 0 ? p.retry_delay_ms : undefined,
        code: typeof p.error === 'string' ? p.error : undefined });
    }
    if (p.subtype === 'compact_boundary') {
      const id = this.claudeCompactionId ?? p.uuid ?? `claude-${turnId}-${this.compactions.size}`;
      this.claudeCompactionId = undefined;
      return this.projectActivity(turnId, { kind: 'compaction', id, status: 'completed' });
    }
    if (p.status === 'compacting') {
      if (this.claudeCompactionId && this.compactions.get(this.claudeCompactionId) === 'running') return [];
      const id = this.claudeCompactionId = p.uuid ?? `claude-${turnId}-${this.compactions.size}`;
      return this.projectActivity(turnId, { kind: 'compaction', id, status: 'running' });
    }
    const id = this.claudeCompactionId;
    if (!id || !p.compact_result) return [];
    // A successful status can precede compact_boundary. Retain its identity until the boundary arrives.
    if (p.compact_result === 'failed') this.claudeCompactionId = undefined;
    const status = p.compact_result === 'success' ? 'completed' : turnInterrupted ? 'interrupted' : 'failed';
    return this.projectActivity(turnId, { kind: 'compaction', id, status,
      message: status === 'failed' && typeof p.compact_error === 'string' ? p.compact_error : undefined });
  }

  private claudeThinkingFrame(frame: SDKPartialAssistantMessage): ItemUpsert[] {
    if (frame?.parent_tool_use_id || !frame?.event) return [];
    const event = frame.event;
    if (event.type === 'message_start') {
      const { id, model } = event.message ?? {};
      if (typeof id !== 'string' || !id || typeof model !== 'string') { this.claudeThinkingMessage = undefined; return []; }
      const existing = this.claudeThinkingMessages.get(id);
      this.claudeThinkingMessage = existing ?? { id, model, byIndex: new Map(), pendingSnapshots: [], snapshots: new Set() };
      if (!existing) this.claudeThinkingMessages.set(id, this.claudeThinkingMessage);
      return [];
    }
    const message = this.claudeThinkingMessage;
    if (!message || !('index' in event)) return [];
    if (event.type === 'content_block_start' && event.content_block?.type === 'thinking') {
      if (message.byIndex.has(event.index)) return [];
      const previous = message.byIndex.get(event.index - 1);
      const model = message.model.replace(/\.(?=\d)/g, '-').replace(/-\d{8}$/, '');
      // In updates mode a signed, empty reasoning block can precede a separate progress block.
      // A lone thinking block may be a reasoning summary, so keep it in the thinking details.
      const progress = CLAUDE_PROGRESS_MODELS.has(model) && !!(previous?.stopped && previous.signed && previous.text === '');
      const block: ClaudeThinkingBlock = {
        key: `thinking:${message.id}:${event.index}`,
        text: typeof event.content_block.thinking === 'string' ? event.content_block.thinking : '',
        signed: !!event.content_block.signature, stopped: false, progress,
      };
      message.byIndex.set(event.index, block);
      message.pendingSnapshots.push(block);
      return publishClaudeThinking(block);
    }
    const block = message.byIndex.get(event.index);
    if (!block || block.stopped) return [];
    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'signature_delta') block.signed ||= !!event.delta.signature;
      if (event.delta?.type !== 'thinking_delta' || typeof event.delta.thinking !== 'string') return [];
      block.text += event.delta.thinking;
    } else if (event.type === 'content_block_stop') {
      block.stopped = true;
    } else return [];
    return publishClaudeThinking(block);
  }

  private claude(e: DriverEvent): ItemUpsert[] {
    if (e.type === 'native' && e.name === 'stream_event') {
      const frame = e.payload as SDKPartialAssistantMessage;
      const items = this.claudeThinkingFrame(frame);
      if (!frame?.parent_tool_use_id && frame?.event?.type === 'content_block_delta'
        && frame.event.delta?.type === 'text_delta' && frame.event.delta.text)
        items.push(...this.projectActivity(this.activityTurnId, { kind: 'retry', status: 'completed' }));
      return items;
    }
    if (e.type === 'turn.completed' || e.type === 'exit' || e.type === 'unusable') {
      const out: ItemUpsert[] = [];
      for (const message of this.claudeThinkingMessages.values()) for (const block of message.byIndex.values()) {
        block.stopped = true;
        out.push(...publishClaudeThinking(block));
      }
      this.claudeThinkingMessages.clear();
      this.claudeThinkingMessage = undefined;
      return out;
    }
    if (e.type === 'item.completed' && e.itemType === 'assistant') {
      const msg = e.payload as { id?: string; content?: any[]; model?: string; parentToolUseId?: string | null };
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
      const thinking = msg.id ? this.claudeThinkingMessages.get(msg.id) : undefined;
      const repeated = thinking?.snapshots.has(e.nativeItemId);
      if (msg.content?.some(block => block?.type === 'thinking')) thinking?.snapshots.add(e.nativeItemId);
      (msg.content ?? []).forEach((block: any, idx: number) => {
        const key = `${e.nativeItemId}:${idx}`;
        if (block?.type === 'text' && block.text) out.push({ key, type: 'assistant_message', payload: { text: block.text, model: msg.model ?? null }, terminal: 'completed' });
        else if (block?.type === 'thinking' && !repeated) {
          const streamed = thinking?.pendingSnapshots.shift();
          if (streamed) {
            if (typeof block.thinking === 'string' && block.thinking.trim()) streamed.text = block.thinking;
            streamed.signed ||= !!block.signature;
            streamed.stopped = true;
            out.push(...publishClaudeThinking(streamed));
          } else if (block.thinking) {
            out.push({ key, type: 'reasoning', payload: { text: block.thinking }, terminal: 'completed' });
          }
        }
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
      const failure = { code: 'rate_limit_rejected', message: `额度受限（${info.rateLimitType ?? '未知类型'}）`,
        limited: { kind: 'usage' as const, ...(resetAt ? { resetAt } : {}) } };
      if (this.retry) return this.projectActivity(this.activityTurnId, { kind: 'retry', status: 'failed', ...failure });
      return [{ key: `limit:${(e.payload as any).uuid ?? Date.now()}`, type: 'error', payload: failure, terminal: 'failed' }];
    }
    const native = e.type === 'native' ? e.payload as any : null;
    if (native?.type === 'assistant' && !native.parent_tool_use_id) {
      if (typeof native.error === 'string') {
        const code = native.error;
        const kind = code === 'rate_limit' ? 'rate' : code === 'max_output_tokens' ? 'output' : code === 'billing_error' ? 'usage' : undefined;
        const message = (native.message?.content ?? []).map((b: any) => b?.text ?? '').join('').slice(0, 2000) || code;
        const failure: AgentActivityError = { code, message, ...(kind ? { limited: { kind } } : {}) };
        if (this.retry) return this.projectActivity(this.activityTurnId, { kind: 'retry', status: 'failed', ...failure });
        return [{ key: `assistant-error:${native.uuid ?? Date.now()}`, type: 'error', payload: { ...failure }, terminal: 'failed' }];
      }
      const model = native.message?.model;
      if (typeof model === 'string' && model !== '<synthetic>')
        return this.projectActivity(this.activityTurnId, { kind: 'retry', status: 'completed' });
    }
    if (e.type === 'native' && this.activityTurnId && native?.type === 'system' && !native.parent_tool_use_id
      && ['status', 'compact_boundary', 'api_retry'].includes(native.subtype))
      return this.claudeSystemActivity(native, this.activityTurnId, e.turnInterrupted);
    if (e.type === 'native' && ['system/hook_started', 'system/hook_progress', 'system/hook_response'].includes(e.name)) {
      const p = e.payload as { hook_id?: string; hook_name?: string; hook_event?: string; outcome?: string; exit_code?: number };
      if (!p?.hook_id) return [];
      const done = e.name === 'system/hook_response';
      const failed = done && p.outcome !== 'success' && p.outcome !== 'cancelled';
      const detail = [p.hook_event, done ? p.outcome : '运行中', p.exit_code == null ? null : `退出码 ${p.exit_code}`].filter(Boolean).join(' · ');
      return this.lifecycleNotice(`hook:${p.hook_id}`, `钩子 · ${p.hook_name ?? p.hook_event ?? 'Claude'}`, detail, done ? failed ? 'failed' : 'completed' : null, failed ? 'warning' : 'info', false,
        { code: 'hookLifecycle', status: done ? p.outcome ?? 'unknown' : 'running', diagnosticOnly: !failed });
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'result' && (e.payload as any).is_error && (e.payload as any).subtype !== 'error_during_execution') {
      const p = e.payload as any;
      const failure = { code: p.subtype, message: text(p.result ?? p.errors ?? p.subtype) };
      if (this.retry) return this.projectActivity(this.activityTurnId, { kind: 'retry', status: 'failed', ...failure });
      return [{ key: `error:${p.uuid ?? p.session_id}`, type: 'error', payload: failure, terminal: 'failed' }];
    }
    return [];
  }

  private codex(e: DriverEvent): ItemUpsert[] {
    if (e.type === 'turn.started') {
      this.codexTurnId = e.nativeTurnId;
      this.codexQuota = {};
    }
    if (e.type === 'native' && e.name === 'account/rateLimits/updated') {
      const limits = (e.payload as { rateLimits?: { limitId?: unknown; primary?: CodexQuotaWindow | null; secondary?: CodexQuotaWindow | null } } | null)?.rateLimits;
      if (limits?.limitId === 'codex') {
        // Native account notifications can update one window at a time. Keep this data private to the current turn.
        if (limits.primary) this.codexQuota.primary = limits.primary;
        if (limits.secondary) this.codexQuota.secondary = limits.secondary;
      }
      return [];
    }
    if (e.type === 'native' && (e.name === 'item/started' || e.name === 'item/completed')) {
      const { turnId, item } = (e.payload as { turnId?: string; item?: any }) ?? {};
      if (item?.type === 'contextCompaction' && typeof item.id === 'string') {
        const status = e.name === 'item/started' ? 'running'
          : item.status === 'failed' || item.status === 'interrupted' ? item.status : 'completed';
        return this.projectActivity(turnId, { kind: 'compaction', id: item.id, status });
      }
      if (e.name === 'item/started') {
        const mapped = this.codexItem(item, false);
        return mapped ? [mapped] : [];
      }
      if (item?.type === 'agentMessage' && item.text)
        return this.projectActivity(turnId, { kind: 'retry', status: 'completed' });
    }
    if (e.type === 'native' && ['item/agentMessage/delta', 'item/reasoning/summaryTextDelta',
      'item/reasoning/textDelta', 'item/plan/delta'].includes(e.name)) {
      const p = e.payload as { turnId?: string; delta?: string } | null;
      return p?.delta ? this.projectActivity(p.turnId, { kind: 'retry', status: 'completed' }) : [];
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
      const p = e.payload as { run?: { id?: string; eventName?: string; status?: string; statusMessage?: string; entries?: {kind?: string; text?: string}[] } };
      const hook = p?.run;
      if (!hook?.id) return [];
      const done = e.name === 'hook/completed';
      const failed = done && ['failed','stopped'].includes(hook.status ?? '');
      const reason = Array.isArray(hook.entries) ? hook.entries.filter(x => x.kind === 'stop' && typeof x.text === 'string').map(x => x.text).join('\n') : '';
      return this.lifecycleNotice(`hook:${hook.id}`, `钩子 · ${hook.eventName ?? 'Codex'}`, reason || hook.statusMessage || hook.status || '', done ? failed ? 'failed' : 'completed' : null, failed ? 'warning' : 'info', false,
        { code: 'hookLifecycle', status: hook.status ?? (done ? 'unknown' : 'running'), diagnosticOnly: !failed });
    }
    if (e.type === 'native' && e.name === 'mcpServer/startupStatus/updated') {
      const p = e.payload as { name?: string; status?: string; error?: string };
      if (!p?.name || !p.status) return [];
      const failed = p.status === 'failed' || p.status === 'cancelled';
      return this.lifecycleNotice(`mcp-startup:${p.name}`, `MCP 启动 · ${p.name}`, p.error ?? p.status, failed ? 'failed' : p.status === 'ready' ? 'completed' : null, failed ? 'warning' : 'info', true,
        { code: 'mcpStartup', status: p.status, diagnosticOnly: p.status !== 'failed' });
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
      const message = text(p?.error?.message ?? p);
      if (p?.willRetry === true) {
        const count = /\b(\d+)\s*\/\s*(\d+)\b/u.exec(message);
        return this.projectActivity(p.turnId, { kind: 'retry', status: 'running', code, message,
          attempt: count ? positiveInteger(Number(count[1])) : undefined,
          maxAttempts: count ? positiveInteger(Number(count[2])) : undefined });
      }
      // 受限与普通失败分开（复核 CR18，需求 R02）：额度／限流与输出上限各自标明，保留原生事实。
      const outputLimit = code === 'other' && p?.willRetry !== true && p?.error?.message === 'Incomplete response returned, reason: max_output_tokens';
      // Codex reports a 429 that outlasted its own retries as an HTTP-status variant, not rateLimitExceeded (D06-63).
      const http429 = p?.willRetry !== true && info && typeof info === 'object' && (info as any)[code]?.httpStatusCode === 429;
      const kind = outputLimit ? 'output' : code === 'usageLimitExceeded' ? 'usage'
        : code === 'rateLimitExceeded' || code === 'tooManyRequests' || http429 ? 'rate' : code === 'contextWindowExceeded' ? 'context' : null;
      const resetAt = kind === 'usage' && this.codexTurnId && p?.turnId === this.codexTurnId
        ? this.codexQuotaReset() : undefined;
      const failure: AgentActivityError = { code, message, ...(kind ? { limited: { kind, ...(resetAt ? { resetAt } : {}) } } : {}) };
      if (this.retry && p?.turnId === this.activityTurnId)
        return this.projectActivity(p.turnId, { kind: 'retry', status: 'failed', ...failure });
      return [{ key: `error:${p?.turnId ?? ''}:${text(p?.error?.message).slice(0, 40)}`, type: 'error', payload: { ...failure }, terminal: 'failed' }];
    }
    return [];
  }

  private codexQuotaReset() {
    const resets = Object.values(this.codexQuota).flatMap(({ usedPercent, resetsAt }) => {
      if (typeof usedPercent !== 'number' || !Number.isFinite(usedPercent) || usedPercent < 100 ||
        typeof resetsAt !== 'number' || !Number.isSafeInteger(resetsAt) || resetsAt > 8_640_000_000_000) return [];
      return [resetsAt * 1000];
    });
    const lastReset = Math.max(0, ...resets);
    return lastReset > Date.now() ? new Date(lastReset).toISOString() : undefined;
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
      case 'fileSearch':
        return { key, type: 'file_search', payload: { input: { pattern: text(item.query), path: item.scope ?? null }, output: text(item.results).slice(0, 16_000), status }, terminal };
      case 'webSearch':
        return { key, type: 'web_search', payload: { query: text(item.query), status }, terminal };
      case 'collabAgentToolCall':
        return { key, type: 'subagent', payload: { kind: 'provider_native', tool: item.tool ?? null, status, prompt: item.prompt ?? null, nativeNodeIds: item.receiverThreadIds ?? [], agentsStates: item.agentsStates ?? {} }, terminal };
      case 'contextCompaction':
        return null; // Use the native notification above, which still carries turnId.
      case 'userMessage':
        return null; // 用户消息由宿主接受输入时记录。
      default: {
        const nativeType = typeof item.type === 'string' ? item.type.slice(0, 100) : '缺少类型';
        const noticeKey = `unknown-item:${nativeType}`;
        if (this.closedNotices.has(noticeKey)) return null;
        this.closedNotices.add(noticeKey);
        return { key: noticeKey, type: 'system_notice', payload: { severity: 'warning', code: 'unknownNativeItem', title: '收到未识别的 Codex 时间线条目', detail: nativeType }, terminal: 'completed' };
      }
    }
  }
}
