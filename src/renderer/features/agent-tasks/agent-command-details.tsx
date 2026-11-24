import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { agentTaskLiveEvent, type AgentCommandPreview } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';
import { formatDuration } from './agent-timeline';

function useCommandPreview(taskId?: string, runId?: string, itemKey?: string) {
  const identity = taskId && runId && itemKey ? JSON.stringify([taskId, runId, itemKey]) : undefined;
  const [current, setCurrent] = useState<{ identity: string; preview: AgentCommandPreview }>();
  useEffect(() => {
    if (!identity || !taskId || !runId || !itemKey) return;
    let active = true;
    const accept = (preview: AgentCommandPreview) => {
      if (active) setCurrent(previous => previous?.identity === identity && previous.preview.revision >= preview.revision
        ? previous : { identity, preview });
    };
    const off = events.on(agentTaskLiveEvent, frame => {
      if (frame.taskId === taskId && frame.runId === runId && frame.itemKey === itemKey && frame.commandRevision !== undefined) {
        accept({ text: frame.text, revision: frame.commandRevision, truncated: frame.previewIncomplete === true });
      }
    });
    void rpc.agentTasks.commandPreview(taskId, runId, itemKey).then(preview => { if (preview) accept(preview); }).catch(() => {});
    return () => { active = false; off(); };
  }, [identity, taskId, runId, itemKey]);
  return identity && current?.identity === identity ? current.preview : undefined;
}

function CommandScript({ command }: { command: string }) {
  const [highlight, setHighlight] = useState<{ command: string; html: string }>();
  useEffect(() => {
    if (typeof Worker === 'undefined') return;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../files/code/worker.ts', import.meta.url), { type: 'module' });
    } catch {
      return;
    }
    worker.onmessage = ({ data }) => {
      if (data.type === 'snippet' && typeof data.html === 'string') setHighlight({ command, html: data.html });
      worker.terminate();
    };
    worker.onerror = () => worker.terminate();
    worker.postMessage({ type: 'snippet', source: command, language: 'bash' });
    return () => worker.terminate();
  }, [command]);
  return <pre aria-label="完整命令" tabIndex={0}>
    {highlight?.command === command ? <code dangerouslySetInnerHTML={{ __html: highlight.html }}/> : <code>{command}</code>}
  </pre>;
}

export function AgentCommandDetails({ command, output, outputAvailable = true, outputTruncated, exitCode, running, taskId, runId, itemKey, startedAt, heartbeatAt, elapsedSeconds, now }: {
  command: string; output: string; outputAvailable?: boolean; outputTruncated?: boolean; exitCode?: number; running: boolean;
  taskId?: string; runId?: string | null; itemKey?: string; startedAt: string; heartbeatAt?: number; elapsedSeconds?: number; now: number;
}) {
  const preview = useCommandPreview(taskId, runId ?? undefined, running ? itemKey : undefined);
  const shown = preview?.text ?? output;
  const truncated = preview?.truncated ?? outputTruncated;
  const lastHeartbeat = heartbeatAt === undefined ? undefined : Math.max(0, Math.floor((now - heartbeatAt) / 1000));
  const start = Date.parse(startedAt);
  const elapsed = Math.max(Number.isFinite(start) ? Math.floor((now - start) / 1000) : 0,
    (elapsedSeconds ?? 0) + (lastHeartbeat ?? 0));
  const outputRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const element = outputRef.current;
    if (running && element && follow.current) element.scrollTop = element.scrollHeight;
  }, [shown, running]);

  return <section className="agent-command-detail" aria-label="命令详情">
    {command && <><header>命令</header><CommandScript command={command}/></>}
    <header><span>输出</span>{exitCode !== undefined && <span className={exitCode === 0 ? undefined : 'failed'}>退出码 {exitCode}</span>}</header>
    {running && <p>已运行 {formatDuration(elapsed)}{lastHeartbeat !== undefined && ` · 最近心跳 ${formatDuration(lastHeartbeat)}前`}</p>}
    {truncated && <p>较早输出已省略</p>}
    {shown ? <pre ref={outputRef} aria-label="命令输出" tabIndex={0} onScroll={event => {
      const element = event.currentTarget;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
    }}>{shown}</pre> : <p>{running ? '等待输出' : outputAvailable ? '无输出' : '暂无工具结果'}</p>}
  </section>;
}
