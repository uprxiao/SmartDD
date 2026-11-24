import { ChevronRight, Columns2, FileDiff, ListTree, Rows2, WrapText } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { agentTaskEvent } from '@shared/events';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import { events, rpc } from '@renderer/lib/ipc';
import { panelsFor } from './workspace-panels-store';
import './turn-diff-surface.css';

const TurnPatchView = lazy(() => import('./turn-patch-view'));
type DiffPage = Awaited<ReturnType<typeof rpc.agentTasks.changePage>>;
type DiffSummary = DiffPage['items'][number];
type FilePage = Awaited<ReturnType<typeof rpc.agentTasks.changeFiles>>;
type DiffFile = FilePage['files'][number];
type Patch = Awaited<ReturnType<typeof rpc.agentTasks.changePatch>>;

function FileLabel({ file }: { file: DiffFile }) {
  const slash = file.path.lastIndexOf('/');
  return <>
    <span className="agent-diff-file-name" title={file.path}>
      <b>{file.path.slice(slash + 1)}</b>
      {slash >= 0 && <small>{file.path.slice(0, slash)}</small>}
    </span>
    <span className="agent-diff-counts">
      {file.binary ? <small>二进制</small> : <>
        <span className="added" aria-label={`新增 ${file.added} 行`}>+{file.added}</span>
        <span className="removed" aria-label={`删除 ${file.removed} 行`}>−{file.removed}</span>
      </>}
    </span>
  </>;
}

function DiffFileContent({ taskId, turnId, path, split, wrap }: {
  taskId: string; turnId: string; path: string; split: boolean; wrap: boolean;
}) {
  const [content, setContent] = useState<Patch | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const read = async () => {
      const preview = await rpc.agentTasks.changePatch(taskId, turnId, path);
      if (!preview.bodyHash) return preview;
      let offset = 0;
      const chunks: string[] = [];
      while (alive && chunks.length < 1000) {
        const chunk = await rpc.agentTasks.changePatchBody(taskId, turnId, path, preview.bodyHash, offset);
        chunks.push(chunk.chunk);
        if (chunk.done) return JSON.parse(chunks.join('')) as Patch;
        if (chunk.next <= offset) throw new Error('差异正文读取未推进');
        offset = chunk.next;
      }
      if (alive) throw new Error('差异正文超过本次读取预算');
      return null;
    };
    void read().then(value => { if (alive) setContent(value); }).catch(failure => {
      if (alive) setError(rpcErrorMessage(failure));
    });
    return () => { alive = false; };
  }, [taskId, turnId, path]);

  if (error) return <p className="agent-diff-message" role="alert">{error}</p>;
  if (!content) return <p className="agent-diff-message" role="status">正在读取差异…</p>;
  return <section className="agent-diff-file-body" aria-label="只读差异">
    {content.reason && <p className="agent-diff-message" role="status">{content.reason}</p>}
    {content.patch !== null && <Suspense fallback={<p className="agent-diff-message" role="status">正在绘制差异…</p>}>
      <TurnPatchView path={path} patch={content.patch} before={content.beforeText} after={content.afterText} split={split} wrap={wrap}/>
    </Suspense>}
  </section>;
}

function DiffFiles({ taskId, turnId, tree, split, wrap }: {
  taskId: string; turnId: string; tree: boolean; split: boolean; wrap: boolean;
}) {
  const [page, setPage] = useState<FilePage | null>(null);
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadingMore, setLoadingMore] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const activeFile = useRef<HTMLElement>(null);
  const revealPath = useRef<string | null>(null);
  useEffect(() => {
    let alive = true;
    void rpc.agentTasks.changeFiles(taskId, turnId, 0).then(value => {
      if (!alive) return;
      setPage(value);
      setPath(value.files[0]?.path ?? null);
    }).catch(failure => { if (alive) setError(rpcErrorMessage(failure)); });
    return () => { alive = false; };
  }, [taskId, turnId]);

  const scrollToFile = () => {
    if (scroller.current && activeFile.current) {
      scroller.current.scrollTop += activeFile.current.getBoundingClientRect().top - scroller.current.getBoundingClientRect().top;
    }
  };
  useLayoutEffect(() => {
    if (path && revealPath.current === path) {
      revealPath.current = null;
      scrollToFile();
    }
  }, [path]);

  const loadMore = async () => {
    if (!page?.hasMore || loadingMore) return;
    setLoadingMore(true);
    setError('');
    try {
      const more = await rpc.agentTasks.changeFiles(taskId, turnId, page.next);
      setPage({ ...more, files: [...page.files, ...more.files] });
    } catch (failure) {
      setError(rpcErrorMessage(failure));
    } finally {
      setLoadingMore(false);
    }
  };

  return <div className="agent-diff-main">
    <div className="agent-diff-file-scroll" ref={scroller}>
      {error && <p className="agent-diff-message" role="alert">{error}</p>}
      {!page && !error && <p className="agent-diff-message" role="status">正在读取改动文件…</p>}
      {page?.files.map(file => {
        const open = path === file.path;
        return <article className="agent-diff-file" key={file.path} ref={open ? activeFile : undefined}>
          <button className="agent-diff-file-heading" type="button" aria-expanded={open} onClick={() => setPath(open ? null : file.path)}>
            <ChevronRight size={14} aria-hidden/><FileDiff size={14} aria-hidden/><FileLabel file={file}/>
          </button>
          {open && <DiffFileContent taskId={taskId} turnId={turnId} path={file.path} split={split} wrap={wrap}/>}
        </article>;
      })}
      {page?.hasMore && <button className="agent-diff-more" type="button" disabled={loadingMore} onClick={() => void loadMore()}>加载更多文件</button>}
    </div>
    {tree && <nav className="agent-diff-file-list" aria-label="改动文件">
      {page?.files.map(file => <button key={file.path} type="button" aria-current={path === file.path || undefined} onClick={() => {
        if (path === file.path) scrollToFile();
        else { revealPath.current = file.path; setPath(file.path); }
      }}><FileLabel file={file}/></button>)}
    </nav>}
  </div>;
}

export const TurnDiffSurface = observer(function TurnDiffSurface({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const panels = panelsFor({ kind: 'task', taskId });
  const selected = panels.diffTurn;
  const [page, setPage] = useState<DiffPage | null>(null);
  const [exact, setExact] = useState<DiffSummary | null>(null);
  const [selectionError, setSelectionError] = useState('');
  const [leaseError, setLeaseError] = useState('');
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [split, setSplit] = useState(false);
  const [wrap, setWrap] = useState(true);
  const [tree, setTree] = useState(false);

  useEffect(() => {
    let alive = true;
    setSelectionError('');
    const loadExact = () => {
      if (!selected) return;
      void rpc.agentTasks.changeTurn(taskId, selected).then(value => {
        if (alive) { setExact(value); setSelectionError(''); }
      }).catch(failure => {
        if (alive) { setExact(null); setSelectionError(rpcErrorMessage(failure)); }
      });
    };
    const loadLatest = () => {
      void rpc.agentTasks.changePage(taskId).then(latest => {
        if (!alive) return;
        setPage(previous => {
          if (!previous) return latest;
          const seen = new Set(latest.items.map(row => row.turnId));
          const older = previous.items.filter(row => !seen.has(row.turnId));
          return { items: [...latest.items, ...older], next: older.length ? previous.next : latest.next };
        });
      }).catch(failure => { if (alive) setSelectionError(rpcErrorMessage(failure)); });
    };
    loadExact();
    loadLatest();
    const off = events.on(agentTaskEvent, event => {
      if (event.taskId !== taskId || event.type !== 'diff.changed') return;
      loadExact();
      loadLatest();
    });
    return () => { alive = false; off(); };
  }, [taskId, selected]);

  const loadOlder = async () => {
    if (!page?.next || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const more = await rpc.agentTasks.changePage(taskId, page.next);
      setPage(previous => {
        if (!previous) return more;
        const seen = new Set(previous.items.map(row => row.turnId));
        return { items: [...previous.items, ...more.items.filter(row => !seen.has(row.turnId))], next: more.next };
      });
    } catch (failure) {
      setSelectionError(rpcErrorMessage(failure));
    } finally {
      setLoadingOlder(false);
    }
  };
  const listed = page?.items.find(row => row.turnId === selected);
  const turn = selected ? exact?.turnId === selected ? exact : listed : page?.items[0];
  const hasFiles = turn?.status === 'complete' && turn.filesTotal > 0;

  useEffect(() => {
    setLeaseError('');
    if (!hasFiles || !turn) return;
    let alive = true;
    let token: string | undefined;
    const renew = () => {
      void rpc.agentTasks.holdDiff(taskId, turn.turnId).then(receipt => {
        if (!alive) { void rpc.agentTasks.releaseDiff(taskId, receipt).catch(() => {}); return; }
        if (token) void rpc.agentTasks.releaseDiff(taskId, token).catch(() => {});
        token = receipt;
      }).catch(failure => { if (alive) setLeaseError(rpcErrorMessage(failure)); });
    };
    renew();
    const timer = setInterval(renew, 30_000);
    return () => {
      alive = false;
      clearInterval(timer);
      if (token) void rpc.agentTasks.releaseDiff(taskId, token).catch(() => {});
    };
  }, [taskId, turn?.turnId, hasFiles]);

  if (!turn) return <div className="agent-panel-empty"><FileDiff/><p role={selectionError ? 'alert' : 'status'}>{selectionError || (selected || !page ? '正在读取指定轮次' : '还没有本轮改动')}</p></div>;
  const options = listed || !selected ? page?.items ?? [turn] : [turn, ...page?.items ?? []];
  return <div className="agent-diff-surface">
    <header className="agent-diff-toolbar">
      <select aria-label="差异回合" value={turn.turnId} onChange={event => { panels.diffTurn = event.target.value; }}>
        {options.map(row => <option key={row.turnId} value={row.turnId}>改动记录 {row.recordNumber}{row.status === 'complete' ? '' : ` · ${row.reason ?? '正在捕获快照'}`}</option>)}
      </select>
      {page?.next && <button type="button" disabled={loadingOlder} onClick={() => void loadOlder()}>加载更早轮次</button>}
      {hasFiles && <div className="agent-diff-controls" aria-label="差异显示">
        <div className="agent-diff-layout-toggle" role="group" aria-label="差异布局">
          <button type="button" title="单栏差异" aria-label="单栏差异" aria-pressed={!split} onClick={() => setSplit(false)}><Rows2 size={15}/></button>
          <button type="button" title="并排差异" aria-label="并排差异" aria-pressed={split} onClick={() => setSplit(true)}><Columns2 size={15}/></button>
        </div>
        <button type="button" title="自动换行" aria-label="自动换行" aria-pressed={wrap} onClick={() => setWrap(value => !value)}><WrapText size={15}/></button>
        <button type="button" title={tree ? '收起改动文件' : '显示改动文件'} aria-label={tree ? '收起改动文件' : '显示改动文件'} aria-expanded={tree} onClick={() => setTree(value => !value)}><ListTree size={15}/></button>
      </div>}
    </header>
    {(selectionError || leaseError) && <p className="agent-diff-message" role="alert">{selectionError || leaseError}</p>}
    {turn.status !== 'complete' ? <div className="agent-diff-message" role="status">
      <p>{turn.reason ?? '正在捕获快照'}</p>
      {turn.preparing && <p>后台准备中 · {turn.progress?.files ?? 0} 个文件 · {Math.round((turn.progress?.bytes ?? 0) / 1024)} KiB
        {!readOnly && <button type="button" onClick={() => void rpc.agentTasks.cancelDiff(taskId, turn.turnId).catch(failure => setSelectionError(rpcErrorMessage(failure)))}>取消快照</button>}
      </p>}
    </div> : hasFiles ? <DiffFiles key={turn.turnId} taskId={taskId} turnId={turn.turnId} tree={tree} split={split} wrap={wrap}/>
      : <p className="agent-diff-message" role="status">本轮没有文件改动</p>}
    <footer>改动记录可能包含该时段的用户及外部修改。回退请用 Git／SVN 命令。</footer>
  </div>;
});
