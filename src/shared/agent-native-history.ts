export type NativeChildBlock =
  | { kind: 'text'; text: string; markdown: boolean }
  | { kind: 'tool_call'; id: string; name: string; command?: string; input?: string }
  | { kind: 'tool_result'; id: string; output: string; failed: boolean; exitCode?: number }
  | { kind: 'notice' | 'raw'; text: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function displayValue(value: unknown): string {
  if (value == null) return '';
  return text(value) ?? JSON.stringify(value, null, 2) ?? '';
}

function toolOutput(value: unknown): string {
  if (!Array.isArray(value)) return displayValue(value);
  return value.map(part => {
    const block = record(part);
    return text(block?.text) ?? (block?.type === 'image' ? '[图片]' : displayValue(part));
  }).join('\n');
}

/** Interpret saved provider messages for display. Raw history remains available to the detail reader. */
export function nativeChildBlocks(value: unknown): NativeChildBlock[] {
  const payload = record(value);
  if (!payload) return typeof value === 'string' && value ? [{ kind: 'text', text: value, markdown: false }] : [];

  if (payload.type === 'thinking' || payload.type === 'redacted_thinking') return [];
  if (payload.type === 'reasoning') {
    const summary = Array.isArray(payload.summary) ? payload.summary.filter(part => typeof part === 'string').join('\n') : text(payload.summary);
    return summary ? [{ kind: 'notice', text: summary }] : [];
  }
  // Codex's thread/read history already combines command and output in one item.
  if (payload.type === 'commandExecution') {
    const id = text(payload.id) ?? '';
    const exitCode = typeof payload.exitCode === 'number' ? payload.exitCode : undefined;
    const call: NativeChildBlock = { kind: 'tool_call', id, name: '命令', command: text(payload.command) };
    const output = text(payload.aggregatedOutput);
    return output !== undefined || exitCode !== undefined
      ? [call, { kind: 'tool_result', id, output: output ?? '', failed: payload.status === 'failed' || (exitCode ?? 0) !== 0, exitCode }]
      : [call];
  }
  if (payload.type === 'system') {
    const status = payload.subtype === 'task_started' ? '子 Agent 已启动'
      : payload.subtype === 'task_notification' ? ({ completed: '子 Agent 已完成', failed: '子 Agent 失败', stopped: '子 Agent 已停止' } as Record<string, string>)[String(payload.status)] : undefined;
    const notice = status ?? text(payload.summary) ?? text(payload.text);
    if (notice) return [{ kind: 'notice', text: notice }];
  }

  const message = record(payload.message);
  const content = message?.content ?? payload.content;
  const markdown = payload.type !== 'user' && payload.type !== 'userMessage' && message?.role !== 'user' && payload.type !== 'system';
  if (Array.isArray(content)) {
    const blocks: NativeChildBlock[] = [];
    for (const part of content) {
      const block = record(part);
      const line = text(part) ?? text(block?.text);
      if (block?.type === 'tool_use') {
        const command = block.name === 'Bash' ? text(record(block.input)?.command) : undefined;
        blocks.push({ kind: 'tool_call', id: text(block.id) ?? '', name: text(block.name) ?? '工具', command,
          input: command === undefined ? displayValue(block.input) : undefined });
      } else if (block?.type === 'tool_result') {
        blocks.push({ kind: 'tool_result', id: text(block.tool_use_id) ?? '', output: toolOutput(block.content), failed: block.is_error === true });
      } else if (line && block?.type !== 'thinking' && block?.type !== 'redacted_thinking') {
        const previous = blocks.at(-1);
        if (previous?.kind === 'text') previous.text += '\n' + line;
        else blocks.push({ kind: 'text', text: line, markdown });
      } else if (block?.type && block.type !== 'thinking' && block.type !== 'redacted_thinking') {
        blocks.push({ kind: 'raw', text: displayValue(block) });
      }
    }
    return blocks;
  }

  const body = text(payload.text) ?? text(payload.summary) ?? text(content) ?? text(payload.message);
  return body ? [{ kind: 'text', text: body, markdown }] : [{ kind: 'raw', text: displayValue(payload) }];
}
