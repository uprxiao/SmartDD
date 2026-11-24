import { ChevronRight, Info, SquareTerminal, Wrench } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { nativeChildBlocks, type NativeChildBlock } from '@shared/agent-native-history';
import { AgentCommandDetails } from './agent-command-details';
import type { TimelineItem } from './agent-timeline';

type NativeItem = TimelineItem & { nodeId?: string | null };
type Entry = NativeChildBlock & { item: NativeItem; key: string };
type Call = Extract<Entry, { kind: 'tool_call' }>;
type Result = Extract<Entry, { kind: 'tool_result' }>;

function blocksFor(item: NativeItem): NativeChildBlock[] {
  if (!item.payload?.truncated) return nativeChildBlocks(item.payload);
  const preview = item.payload.nativePreview;
  return Array.isArray(preview) && preview.length ? preview : [{ kind: 'raw', text: '' }];
}

function toolKey(entry: Call | Result): string {
  return entry.id ? JSON.stringify([entry.item.nodeId ?? null, entry.id]) : '';
}

function NativeToolEntry({ call, result, completeness }: { call?: Call; result?: Result; completeness: ReactNode }) {
  const [open, setOpen] = useState(false);
  const command = call?.command;
  const firstLine = command?.trimStart().split(/\r?\n/, 1)[0];
  const Icon = command !== undefined ? SquareTerminal : Wrench;
  return <li className="agent-native-tool-row">
    <details onToggle={event => {
      if (event.target === event.currentTarget) setOpen(event.currentTarget.open);
    }}>
      <summary>
        <Icon size={14} aria-hidden />
        <b>{call?.name ?? '工具输出'}</b>
        {firstLine && <code title={firstLine}>{firstLine}</code>}
        {result && <small className={result.failed ? 'failed' : undefined}>{result.failed ? '失败' : '已完成'}</small>}
        <ChevronRight size={13} className="agent-native-chevron" aria-hidden />
      </summary>
      {open && <div className="agent-native-tool-body">
        {call && command !== undefined
          ? <AgentCommandDetails command={command} output={result?.output ?? ''} exitCode={result?.exitCode}
            outputAvailable={!!result} running={false} startedAt={call.item.createdAt} now={Date.now()} />
          : <>
            {call?.input && <><small>参数</small><pre aria-label="工具参数" tabIndex={0}>{call.input}</pre></>}
            {result && <><small>输出</small><pre aria-label="工具输出" tabIndex={0}>{result.output || '无输出'}</pre></>}
          </>}
        {completeness}
      </div>}
    </details>
  </li>;
}

export function NativeChildTimeline({ items, summary, markdown, completeness }: {
  items: NativeItem[];
  summary?: string;
  markdown: (text: string) => ReactNode;
  completeness: (item: NativeItem) => ReactNode;
}) {
  const entries: Entry[] = items.flatMap(item => blocksFor(item).map((block, index) => ({
    ...block, item, key: item.itemId + ':' + index,
  })));
  const calls = new Map<string, Call>();
  const results = new Map<string, Result>();
  for (const entry of entries) {
    if (entry.kind === 'tool_call') {
      const id = toolKey(entry);
      if (id && !calls.has(id)) calls.set(id, entry);
    }
    if (entry.kind === 'tool_result') {
      const id = toolKey(entry);
      if (id) results.set(id, entry);
    }
  }
  const finalText = summary?.trim() ?? '';
  const shownResult = finalText && entries.some(entry => {
    if (entry.kind !== 'text' || !entry.markdown || !entry.text.trim()) return false;
    return entry.item.payload?.truncated ? finalText.startsWith(entry.text.trim()) : finalText === entry.text.trim();
  });

  return <ol className="agent-native-timeline" aria-label="子 Agent 时间线">
    {entries.map(entry => {
      if (entry.kind === 'tool_call') {
        const id = toolKey(entry), result = results.get(id);
        if (id && calls.get(id) !== entry) return null;
        return <NativeToolEntry key={entry.key} call={entry} result={result} completeness={<>
          {completeness(entry.item)}
          {result && result.item.itemId !== entry.item.itemId && completeness(result.item)}
        </>} />;
      }
      if (entry.kind === 'tool_result') {
        const id = toolKey(entry);
        if (id && (calls.has(id) || results.get(id) !== entry)) return null;
        return <NativeToolEntry key={entry.key} result={entry} completeness={completeness(entry.item)} />;
      }
      return <li key={entry.key} className={'agent-native-entry ' + entry.kind}>
        {entry.kind === 'text' && (entry.markdown ? markdown(entry.text) : <p>{entry.text}</p>)}
        {entry.kind === 'notice' && <p><Info size={13} aria-hidden />{entry.text}</p>}
        {entry.kind === 'raw' && entry.text && <details><summary>原生记录</summary><pre tabIndex={0}>{entry.text}</pre></details>}
        {completeness(entry.item)}
      </li>;
    })}
    {finalText && !shownResult && <li className="agent-native-entry text">{markdown(finalText)}</li>}
  </ol>;
}
