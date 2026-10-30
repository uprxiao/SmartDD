import { useEffect, useRef, useState } from 'react';
import { fileSearchEvent } from '@shared/events';
import type { FileRoot, FileSearchResult, FileSearchRow } from '@shared/files';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { events, rpc } from '@renderer/lib/ipc';
import type { FileFuzzyResult } from './file-fuzzy-model.mjs';
import { searchWithSessionFallback, type SearchProtocolState } from './search-protocol';
import { limitNameResults, NAME_RESULT_LIMIT } from '@shared/file-name-results.mjs';

export type NameMatch = { path: string; file_name: string } & FileFuzzyResult;
export interface SearchState { phase: 'idle' | 'waiting' | 'searching' | 'partial' | 'done' | 'error'; names: NameMatch[]; rows: FileSearchRow[]; result: FileSearchResult | null; error: string; nameResult?: { total: number; truncated: boolean; limit: number } }
const initial = (): SearchState => ({ phase: 'idle', names: [], rows: [], result: null, error: '' });

export function useFileSearch(root: FileRoot | null, kind: 'name' | 'content', query: string, mask = '', enabled = true, priorityFolders: readonly string[] = []) {
  const [state, setState] = useState<SearchState>(initial), [revision, setRevision] = useState(0), [slow, setSlow] = useState(false);
  const key = JSON.stringify([root?.lease, root?.generation, kind, query, mask, enabled, kind === 'content' ? priorityFolders : []]);
  const [stateKey, setStateKey] = useState('');
  const protocol = useRef<SearchProtocolState>({ session: 'unknown' });
  useEffect(() => {
    setStateKey(key);
    setSlow(false);
    if (!root || !enabled || !query.trim()) { setState(initial()); return; }
    const id = crypto.randomUUID(); let current = true, progressClosed = false, nameFinished = false, worker: Worker | null = null;
    const progressRows: FileSearchRow[] = [];
    let workerDeadline: ReturnType<typeof setTimeout> | undefined;
    const spinner = setTimeout(() => { if (current) setSlow(true); }, 500);
    setState({ ...initial(), phase: 'waiting' });
    const off = events.on(fileSearchEvent, (event) => {
      if (!current || progressClosed || event.id !== id || event.lease !== root.lease || event.generation !== root.generation) return;
      progressRows.push(event.row); const rows = [...progressRows];
      // Different IPC channels and React update lanes may finish in another
      // order. The final result is authoritative, including queued updates.
      setState((old) => current && !progressClosed ? { ...old, phase: 'partial', rows } : old);
    });
    const timer = setTimeout(() => {
      if (!current) return;
      setState((old) => ({ ...old, phase: 'searching', rows: [], names: [] }));
      void searchWithSessionFallback(rpc.files, { id, root: { lease: root.lease, generation: root.generation }, kind, query, mask, ...(kind === 'content' ? { roots: [{ lease: root.lease, generation: root.generation }], fileMask: mask, priorityFolders: [...priorityFolders] } : {}) }, protocol.current, () => current).then((result) => {
        if (!current || !result) return;
        progressClosed = true;
        if (kind === 'content') { setState({ phase: 'done', rows: result.rows, names: [], result, error: '' }); clearTimeout(spinner); setSlow(false); return; }
        worker = new Worker(new URL('./name-search.worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<{ ranked?: NameMatch[]; error?: string; total?: number; truncated?: boolean; limit?: number; stage?: 'updated' | 'completed'; sessionId?: string }>) => {
          if (!current || nameFinished || event.data.sessionId !== undefined && event.data.sessionId !== id) return;
          const complete = event.data.stage !== 'updated';
          const window = limitNameResults(event.data.ranked ?? []), total = event.data.total ?? window.total;
          const valid = Number.isSafeInteger(total) && total >= 0 && window.ranked.length === Math.min(total, NAME_RESULT_LIMIT)
            && new Set(window.ranked.map(row => row.path)).size === window.ranked.length
            && (event.data.limit === undefined || event.data.limit === NAME_RESULT_LIMIT)
            && (event.data.truncated === undefined || event.data.truncated === (total > window.ranked.length));
          if (complete || event.data.error || !valid) { nameFinished = true; worker?.terminate(); worker = null; clearTimeout(workerDeadline); clearTimeout(spinner); setSlow(false); }
          setState({ phase: event.data.error || !valid ? 'error' : complete ? 'done' : 'partial', rows: [], names: valid ? window.ranked : [], result, error: event.data.error ?? (!valid ? '名称匹配返回了无效的结果范围，请重试' : ''), nameResult: valid ? { total, limit: NAME_RESULT_LIMIT, truncated: total > window.ranked.length } : undefined });
        };
        worker.onerror = () => { if (!current || nameFinished) return; nameFinished = true; worker?.terminate(); worker = null; clearTimeout(workerDeadline); clearTimeout(spinner); setSlow(false); setState({ ...initial(), phase: 'error', error: '名称匹配进程出错，请重试' }); };
        workerDeadline = setTimeout(() => { if (!current || nameFinished) return; nameFinished = true; worker?.terminate(); worker = null; clearTimeout(spinner); setSlow(false); setState({ ...initial(), phase: 'error', error: '名称匹配超时，请缩小查询后重试' }); }, 5000);
        worker.postMessage({ paths: result.paths, query, sessionId: id, updates: true });
      }).catch((error) => { if (current) { progressClosed = true; clearTimeout(spinner); setSlow(false); setState((old) => current ? { ...old, phase: 'error', ...(kind === 'content' ? { rows: [...progressRows] } : {}), error: rpcErrorMessage(error) } : old); } });
    }, 50);
    return () => { current = false; progressClosed = true; off(); clearTimeout(timer); clearTimeout(spinner); clearTimeout(workerDeadline); worker?.terminate(); void rpc.files.cancelSearch(id).catch(() => undefined); };
  }, [key, root?.lease, root?.generation, kind, query, mask, enabled, revision]);
  // Never render another query/root's data, including the render before this
  // request's effect and its debounce timer have started.
  return { ...(stateKey === key ? state : initial()), slow: stateKey === key && slow, retry: () => setRevision((value) => value + 1) };
}
