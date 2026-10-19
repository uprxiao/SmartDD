import { rootRelativePath } from '@shared/file-root-location.mjs';
import { searchPriorityFolders } from '@shared/file-search-priority.mjs';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { FileSearch, Loader2, Search, X } from 'lucide-react';
import type { FileSearchRow } from '@shared/files';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@renderer/lib/ui/dialog';
import type { FileWorkspaceStore } from './workspace-store';
import { FileTreeIcon } from './file-icon';
import { useFileSearch } from './file-search';
import { readSearchHistory, rememberSearchHistory, searchHistoryKey } from './search-history';
import { nameResultNotice } from '@shared/file-name-results.mjs';
import { FILE_SEARCH_INPUT_LIMIT, clampFileSearchInput } from '@shared/file-search-input.mjs';
import type { FileBuffer } from './file-buffer';

function Highlight({ text, ranges }: { text: string; ranges: { from: number; to: number }[] }) {
  const pieces: ReactNode[] = []; let from = 0;
  ranges.forEach((range, index) => { pieces.push(text.slice(from, range.from), <mark key={index}>{text.slice(range.from, range.to)}</mark>); from = range.to; }); pieces.push(text.slice(from));
  return <>{pieces}</>;
}
export function FileNameFilter({ store, children }: { store: FileWorkspaceStore; children: ReactNode }) {
  return <ScopedNameFilter key={store.treeRoot?.lease ?? 'unavailable'} store={store}>{children}</ScopedNameFilter>;
}
function ScopedNameFilter({ store, children }: { store: FileWorkspaceStore; children: ReactNode }) {
  const root = store.treeRoot, saved = root ? store.nameSearchViews.get(root.lease) : undefined;
  const initial = saved && saved.query === store.filter ? saved : { query: store.filter, cursor: 0, top: 0 };
  const input = useRef<HTMLInputElement>(null), composing = useRef(false), [query, setQuery] = useState(store.filter), [cursor, setCursor] = useState(initial.cursor), [top, setTop] = useState(initial.top), [height, setHeight] = useState(400);
  const host = useRef<HTMLDivElement>(null), search = useFileSearch(root, 'name', query);
  const restoring = useRef<typeof initial | null>(query.trim() ? initial : null);
  const remember = (nextTop: number, nextCursor = cursor) => { if (root) store.nameSearchViews.set(root.lease, { query, top: nextTop, cursor: nextCursor }); };
  const cancelRestore = () => { restoring.current = null; remember(host.current?.scrollTop ?? top); };
  const changeQuery = (value: string) => {
    restoring.current = null; setQuery(value); setCursor(0); setTop(0); if (host.current) host.current.scrollTop = 0;
    if (root) store.nameSearchViews.set(root.lease, { query: value, top: 0, cursor: 0 });
  };
  useLayoutEffect(() => {
    const saved = restoring.current, node = host.current;
    if (!saved || !node?.clientHeight || search.phase !== 'done') return;
    const nextCursor = Math.min(saved.cursor, Math.max(0, search.names.length - 1));
    node.scrollTop = Math.min(saved.top, Math.max(0, search.names.length * 42 - node.clientHeight));
    setTop(node.scrollTop); setCursor(nextCursor); remember(node.scrollTop, nextCursor); restoring.current = null;
  }, [query, search.phase, search.names, height]);
  useEffect(() => { const node = host.current; if (!node) return; const observer = new ResizeObserver(() => setHeight(node.clientHeight)); observer.observe(node); return () => observer.disconnect(); }, [Boolean(query.trim())]);
  const choose = (index: number, pin = false) => { cancelRestore(); setCursor(index); remember(host.current?.scrollTop ?? top, index); const row = search.names[index]; if (root && row) void store.open(root, row.path, pin); };
  const first = Math.max(0, Math.floor(top / 42) - 4), last = Math.min(search.names.length, Math.ceil((top + height) / 42) + 4);
  return <><div className="fw-filter"><Search size={14} /><input ref={input} aria-label="筛选文件" placeholder="筛选文件…" maxLength={256} value={store.filter}
    onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; changeQuery(event.currentTarget.value); }}
    onChange={(event) => { store.setFilter(event.target.value); if (!composing.current) changeQuery(event.target.value); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'Escape' && store.filter) { event.preventDefault(); store.setFilter(''); changeQuery(''); }
      if (event.key === 'Enter') { event.preventDefault(); choose(cursor); }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && search.names.length) { event.preventDefault(); cancelRestore(); const next = Math.max(0, Math.min(search.names.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1))); setCursor(next); if (host.current && (next * 42 < top || (next + 1) * 42 > top + height)) host.current.scrollTop = Math.max(0, next * 42 - height / 2); remember(host.current?.scrollTop ?? top, next); }
    }} />{store.filter && <button aria-label="清除文件筛选" onClick={() => { store.setFilter(''); changeQuery(''); input.current?.focus(); }}><X size={13} /></button>}</div>
    {query.trim() && search.phase === 'done' && search.nameResult?.truncated && <div role="status" className="fw-search-status fw-name-limit">{nameResultNotice(search.nameResult)}</div>}
    {!query.trim() ? children : <div className="fw-name-results" ref={host} role="listbox" aria-label="文件名搜索结果" aria-busy={['waiting', 'searching', 'partial'].includes(search.phase)} onWheelCapture={cancelRestore} onPointerDownCapture={cancelRestore} onScroll={(event) => { if (!restoring.current) { setTop(event.currentTarget.scrollTop); remember(event.currentTarget.scrollTop); } }}>
      {search.slow && <div role="status" className="fw-search-status"><Loader2 size={15} className="animate-spin" />正在搜索…</div>}
      {search.phase === 'error' && <div role="alert" className="fw-search-status">{search.error}<button onClick={search.retry}>重试</button></div>}
      {search.phase === 'done' && !search.names.length && <div role="status" className="fw-search-status">没有匹配文件</div>}
      {search.result?.skipped ? <div className="fw-search-status" title={search.result.issues.map((issue) => `${issue.path}: ${issue.reason}`).join('\n')}>有 {search.result.skipped} 项无法读取</div> : null}
      <div style={{ height: search.names.length * 42, position: 'relative' }}>{search.names.slice(first, last).map((match, offset) => <button key={match.path} role="option" aria-selected={cursor === first + offset} className="fw-name-result" style={{ top: (first + offset) * 42 }} title={`${root?.path}/${match.path}`} onClick={() => choose(first + offset)} onDoubleClick={() => choose(first + offset, true)}><FileTreeIcon path={match.path} /><span><span><Highlight text={match.file_name} ranges={match.fragments.map((fragment) => ({ from: fragment.start, to: fragment.end }))} /></span><small>{match.path}</small></span></button>)}</div>
    </div>}</>;
}

export function FileContentSearch({ store, onClose }: { store: FileWorkspaceStore; onClose: (opened?: FileBuffer) => void }) {
  const historyKey = searchHistoryKey(store.scope, store.treeRoot);
  return <ScopedContentSearch key={historyKey} store={store} onClose={onClose} historyKey={historyKey} />;
}
function ScopedContentSearch({ store, onClose, historyKey }: { store: FileWorkspaceStore; onClose: (opened?: FileBuffer) => void; historyKey: string }) {
  const [query, setQuery] = useState(''), [submitted, setSubmitted] = useState(''), [mask, setMask] = useState(''), [cursor, setCursor] = useState(0), [error, setError] = useState('');
  const [history, setHistory] = useState(() => readSearchHistory(historyKey)), [historyAt, setHistoryAt] = useState(-1);
  const draft = useRef(''), composing = useRef(false), queryInput = useRef<HTMLInputElement>(null), results = useRef<HTMLDivElement>(null);
  const maskHistoryAt = useRef(-1), maskHistoryDraft = useRef('');
  const alive = useRef(true);
  const returnFocus = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const activePath = store.active?.buffer?.file.absolutePath;
  const priorities = searchPriorityFolders(activePath ? rootRelativePath(store.treeRoot, activePath) : null);
  const search = useFileSearch(store.treeRoot, 'content', submitted, mask.trim(), true, priorities), [maskDraft, setMaskDraft] = useState('');
  useEffect(() => { setCursor(0); setError(''); }, [submitted, mask]);
  const remember = () => setHistory(rememberSearchHistory(historyKey, history, query, mask));
  const open = async (row: FileSearchRow) => {
    const root = store.treeRoot; if (!root) return;
    remember(); setError('');
    try {
      await store.openSearchRow(root, row);
      if (alive.current && store.treeRoot === root && store.active?.route.relativePath === row.relativePath) { returnFocus.current = false; onClose(store.active.buffer ?? undefined); }
    } catch (failure) { if (alive.current) setError(rpcErrorMessage(failure)); }
  };
  useEffect(() => { queryInput.current?.focus(); }, []);
  return <Dialog open onOpenChange={(isOpen) => { if (!isOpen) { remember(); onClose(); } }}><DialogContent className="fw-search-dialog" finalFocus={() => returnFocus.current}><DialogHeader showCloseButton={false}><DialogTitle>在文件中搜索</DialogTitle></DialogHeader>
    <div className="fw-find"><FileSearch size={16} /><input ref={queryInput} aria-label="全文搜索内容" placeholder="搜索文本" value={query} maxLength={FILE_SEARCH_INPUT_LIMIT} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; const value = clampFileSearchInput(event.currentTarget.value); setQuery(value); setSubmitted(value); }} onChange={(event) => { const value = composing.current ? event.target.value : clampFileSearchInput(event.target.value); setQuery(value); setHistoryAt(-1); if (!composing.current) setSubmitted(value); }} onKeyDown={(event) => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      const historyUp = event.key === 'ArrowUp' && (event.altKey || historyAt >= 0 || cursor === 0 || !search.rows.length);
      const historyDown = event.key === 'ArrowDown' && (event.altKey || historyAt >= 0);
      if (historyUp || historyDown) { event.preventDefault(); if (historyAt === -1) draft.current = query; const next = Math.min(history.query.length - 1, Math.max(-1, historyAt + (historyUp ? 1 : -1))); setHistoryAt(next); const value = next === -1 ? draft.current : history.query[next]; setQuery(value); setSubmitted(value); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const next = Math.max(0, Math.min(search.rows.length - 1, cursor + (event.key === 'ArrowDown' ? 1 : -1))); setCursor(next); results.current?.querySelector(`[data-search-row="${next}"]`)?.scrollIntoView({ block: 'nearest' }); }
      if (event.key === 'Enter') { event.preventDefault(); remember(); if (search.rows[cursor]) void open(search.rows[cursor]); }
    }} /><button aria-label="关闭全文搜索" onClick={() => { remember(); onClose(); }}><X size={16} /></button></div>
    <div className="fw-search-mask"><label>文件掩码<input aria-label="搜索文件掩码" placeholder="如 *.ts" list="m9-mask-history" maxLength={FILE_SEARCH_INPUT_LIMIT} value={maskDraft} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; const value = clampFileSearchInput(event.currentTarget.value); setMaskDraft(value); setMask(value); }} onChange={(event) => { maskHistoryAt.current = -1; const value = composing.current ? event.target.value : clampFileSearchInput(event.target.value); setMaskDraft(value); if (!composing.current) setMask(value); }} onKeyDown={(event) => {
      if (composing.current || event.nativeEvent.isComposing || event.keyCode === 229) return;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.stopPropagation(); event.preventDefault(); if (!history.mask.length) return;
        if (maskHistoryAt.current < 0) maskHistoryDraft.current = maskDraft;
        const next = maskHistoryAt.current < 0 ? 0 : Math.max(-1, Math.min(history.mask.length - 1, maskHistoryAt.current + (event.key === 'ArrowDown' ? 1 : -1)));
        maskHistoryAt.current = next; const value = next < 0 ? maskHistoryDraft.current : history.mask[next]; setMaskDraft(value); setMask(value); return;
      }
      if (event.key === 'Enter') { event.stopPropagation(); event.preventDefault(); maskHistoryAt.current = -1; remember(); queryInput.current?.focus(); }
    }} /></label><datalist id="m9-mask-history">{history.mask.map((value) => <option key={value} value={value} />)}</datalist><span>{store.treeRoot?.label}</span></div>
    {error && <p role="alert">{error}</p>}
    <div ref={results} className="fw-search-results" role="listbox" aria-label="全文搜索结果" aria-busy={['waiting', 'searching', 'partial'].includes(search.phase)}>
      {search.rows.map((row, index) => <button key={`${row.relativePath}:${row.line}`} data-search-row={index} role="option" aria-selected={cursor === index} onClick={() => void open(row)}><span><FileTreeIcon path={row.relativePath} />{row.relativePath}<small>:{row.line}</small></span><code><Highlight text={row.text} ranges={row.ranges} /></code></button>)}
      {search.slow && <p role="status"><Loader2 size={12} className="inline animate-spin" aria-hidden /> 正在搜索…</p>}{search.phase === 'idle' && <p>输入要查找的文本</p>}{search.phase === 'done' && !search.rows.length && <p>没有匹配结果</p>}
      {search.phase === 'error' && <p role="alert">{search.rows.length ? '搜索中断，以下仅为部分结果。' : ''}{search.error} <button onClick={search.retry}>重试</button></p>}
    </div><small>{search.result?.limited ? '显示前 100 个匹配行，可能还有更多结果。' : search.result ? `已检查 ${search.result.searched} 个文件。` : search.phase === 'partial' ? '正在接收匹配行…' : ''}{search.result?.skipped ? ` ${search.result.skipped} 项未搜索（如二进制、编码、大小或权限限制）。` : ''} {history.query.length > 0 && '↑/↓ 选择结果；首条处 ↑ 浏览历史，↓ 返回当前草稿。'}</small>
    {search.result?.issues.length ? <details className="fw-search-issues"><summary>查看未搜索项目</summary>{search.result.issues.map((issue, index) => <p key={index}>{issue.path}：{issue.reason}</p>)}</details> : null}
  </DialogContent></Dialog>;
}
