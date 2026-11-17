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
export class TimelineProjector {
  private readonly claudeTools = new Map<string, { type: ItemType; name: string; input: unknown }>();
  private readonly todos = new Map<string, { id: string; subject: string; status: string }>();

  constructor(private readonly driverId: 'claude-sdk' | 'codex-app-server') {}

  project(e: DriverEvent): ItemUpsert[] {
    return this.driverId === 'claude-sdk' ? this.claude(e) : this.codex(e);
  }

  private todoItem(): ItemUpsert {
    return { key: 'todo', type: 'todo_list', payload: { entries: [...this.todos.values()] } };
  }

  private claude(e: DriverEvent): ItemUpsert[] {
    if (e.type === 'item.completed' && e.itemType === 'assistant') {
      const msg = e.payload as { content?: any[]; model?: string };
      const out: ItemUpsert[] = [];
      (msg.content ?? []).forEach((block: any, idx: number) => {
        const key = `${e.nativeItemId}:${idx}`;
        if (block?.type === 'text' && block.text) out.push({ key, type: 'assistant_message', payload: { text: block.text, model: msg.model ?? null }, terminal: 'completed' });
        else if (block?.type === 'thinking' && block.thinking) out.push({ key, type: 'reasoning', payload: { text: block.thinking }, terminal: 'completed' });
        else if (block?.type === 'tool_use') {
          const type = claudeToolType(block.name);
          this.claudeTools.set(block.id, { type, name: block.name, input: block.input });
          if (TODO_TOOLS.has(block.name)) return; // 只在成功结果后改清单（V10b，RR03）
          out.push({ key: `tool:${block.id}`, type, payload: { name: block.name, input: block.input, status: 'running', ...(type === 'proposed_plan' ? { plan: text(block.input?.plan) } : {}) }, terminal: null });
        }
      });
      return out;
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'user') {
      const content = (e.payload as any).message?.content;
      if (!Array.isArray(content)) return [];
      const out: ItemUpsert[] = [];
      for (const block of content) {
        if (block?.type !== 'tool_result') continue;
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
        out.push({ key: `tool:${block.tool_use_id}`, type: tool.type, payload: { name: tool.name, input: tool.input, output: output.slice(0, 16_000), status: failed ? 'failed' : 'completed', ...(tool.type === 'proposed_plan' ? { plan: text((tool.input as any)?.plan) } : {}) }, terminal: failed ? 'failed' : 'completed' });
      }
      return out;
    }
    if (e.type === 'native' && (e.payload as any)?.type === 'system' && (e.payload as any).subtype === 'compact_boundary') {
      return [{ key: `compact:${(e.payload as any).uuid ?? Date.now()}`, type: 'compaction', payload: {}, terminal: 'completed' }];
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
    if (e.type === 'native' && ['warning', 'configWarning', 'deprecationNotice', 'guardianWarning'].includes(e.name)) {
      const p = e.payload as any;
      return [{ key: `notice:${e.name}:${text(p?.summary ?? p?.message).slice(0, 80)}`, type: 'system_notice', payload: { severity: 'warning', code: e.name, detail: text(p?.summary ?? p?.message ?? p) }, terminal: 'completed' }];
    }
    if (e.type === 'native' && e.name === 'error') {
      const p = e.payload as any;
      return [{ key: `error:${p?.turnId ?? ''}:${text(p?.error?.message).slice(0, 40)}`, type: 'error', payload: { code: text(p?.error?.codexErrorInfo ?? 'error'), message: text(p?.error?.message ?? p) }, terminal: 'failed' }];
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
        return { key, type: 'subagent', payload: { kind: 'provider_native', tool: item.tool ?? null, status, prompt: item.prompt ?? null }, terminal };
      case 'contextCompaction':
        return done ? { key, type: 'compaction', payload: {}, terminal } : null;
      default:
        return null; // userMessage 由宿主在本地接受时记录；其他类型留在原生诊断
    }
  }
}
