import { useEffect, useRef, useState } from 'react';
import type { FileDocument } from '@shared/files';
import { rpc } from '@renderer/lib/ipc';
import { createReviewTextClient, type ReviewTextClient } from './client';
import type { ReviewTextWindow } from './model.mjs';
import { ReviewTextPane } from './pane';

export function FileReviewText({ file }: { file: FileDocument }) {
  const identity = `${file.ref.id}:${file.revision.hash}`;
  const [retry, setRetry] = useState(0), [state, setState] = useState<{ identity: string; value?: ReviewTextWindow; error?: string; cancelled?: boolean }>({ identity });
  const [pending, setPending] = useState(false);
  const client = useRef<ReviewTextClient | null>(null), abort = useRef<AbortController | null>(null), current = useRef(0), request = useRef(0);
  useEffect(() => {
    const own = ++current.current, controller = abort.current = new AbortController();
    client.current = null; setState({ identity }); setPending(false);
    void createReviewTextClient(file, rpc.files, controller.signal).then(async ready => {
      if (controller.signal.aborted || current.current !== own) { await ready.destroy(); return; }
      client.current = ready; const value = await ready.window(0);
      if (!controller.signal.aborted && current.current === own) setState({ identity, value });
    }).catch(error => {
      if (current.current !== own) return;
      setState({ identity, ...(controller.signal.aborted ? { cancelled: true } : { error: error instanceof Error ? error.message : String(error) }) });
    });
    return () => { current.current++; request.current++; controller.abort(); client.current = null; };
  }, [identity, retry]);
  const page = async (index: number) => {
    const reader = client.current, own = current.current, ticket = ++request.current; if (!reader) return;
    setPending(true);
    try {
      const value = await reader.window(index);
      if (current.current === own && request.current === ticket) setState({ identity, value });
    } catch (error) {
      if (current.current === own && request.current === ticket) setState({ identity, error: error instanceof Error ? error.message : String(error) });
    } finally { if (current.current === own && request.current === ticket) setPending(false); }
  };
  const shown: typeof state = state.identity === identity ? state : { identity };
  return <section className="fw-review-text" data-state={shown.value ? 'ready' : shown.error ? 'error' : shown.cancelled ? 'cancelled' : 'loading'} data-bytes={file.revision.size} data-sha256={file.revision.hash} data-complete={Boolean(shown.value)}>
    {shown.value ? <ReviewTextPane value={shown.value} pending={pending} onPage={index => void page(index)} /> : <div className="fw-empty" role={shown.error ? 'alert' : 'status'}><p>{shown.error || (shown.cancelled ? '已取消读取，原始文件保持不变' : '正在读取只读文本…')}</p>{shown.error || shown.cancelled ? <button onClick={() => setRetry(value => value + 1)}>重新读取</button> : <button onClick={() => abort.current?.abort()}>取消读取</button>}</div>}
  </section>;
}
