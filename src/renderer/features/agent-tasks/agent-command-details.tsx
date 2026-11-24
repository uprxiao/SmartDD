import { useEffect, useLayoutEffect, useRef, useState } from 'react';

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

export function AgentCommandDetails({ command, output, exitCode, running }: {
  command: string; output: string; exitCode?: number; running: boolean;
}) {
  const outputRef = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    const element = outputRef.current;
    if (running && element && follow.current) element.scrollTop = element.scrollHeight;
  }, [output, running]);

  return <section className="agent-command-detail" aria-label="命令详情">
    {command && <><header>命令</header><CommandScript command={command}/></>}
    <header><span>输出</span>{exitCode !== undefined && <span className={exitCode === 0 ? undefined : 'failed'}>退出码 {exitCode}</span>}</header>
    {output ? <pre ref={outputRef} aria-label="命令输出" tabIndex={0} onScroll={event => {
      const element = event.currentTarget;
      follow.current = element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
    }}>{output}</pre> : <p>{running ? '等待输出' : '无输出'}</p>}
  </section>;
}
