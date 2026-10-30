import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, GitBranch, Loader2, RotateCcw } from 'lucide-react';
import type { FileRoot } from '@shared/files';
import type { GitChange, GitEntry, GitStatus } from '@shared/file-git';
import { rpc } from '@renderer/lib/ipc';
import { FileTreeIcon } from './file-icon';
import { FileContextActions } from './file-actions';
import type { FileWorkspaceStore } from './workspace-store';

export function useGitStatus(root: FileRoot | null | undefined, revision: number) {
  const [retry, setRetry] = useState(0), [result, setResult] = useState<{ key: string; data: GitStatus | null; error: string } | null>(null);
  const key = root ? `${root.lease}:${root.generation}:${revision}:${retry}` : '';
  useEffect(() => {
    if (!root) return;
    const id = crypto.randomUUID(); let alive = true;
    const timer = setTimeout(() => {
      void rpc.files.gitStatus({ id, root: { lease: root.lease, generation: root.generation } }).then((data) => { if (alive) setResult({ key, data, error: '' }); }).catch((error) => { if (alive) setResult({ key, data: null, error: error instanceof Error ? error.message : String(error) }); });
    }, 150);
    return () => { alive = false; clearTimeout(timer); void rpc.files.cancelGit(id).catch(() => undefined); };
  }, [key]);
  const current = result?.key === key ? result : null;
  return { data: current?.data ?? null, error: current?.error ?? '', loading: Boolean(root && !current), refresh: () => setRetry((value) => value + 1) };
}
export const gitLabels: Record<GitChange, string> = { added: '新增', modified: '修改', deleted: '删除', renamed: '重命名', untracked: '未跟踪', ignored: '已忽略', conflict: '冲突' };
const letters: Record<GitChange, string> = { added: 'A', modified: 'M', deleted: 'D', renamed: 'R', untracked: 'U', ignored: '!', conflict: '!' };
export function GitStatusMark({ entry }: { entry?: GitEntry }) { return entry ? <span className={`fw-git-state fw-git-${entry.status}`} aria-label={`Git ${gitLabels[entry.status]}`} title={gitLabels[entry.status]}>{letters[entry.status]}</span> : null; }
export function FileChanges({ store, state, onBack, run }: { store: FileWorkspaceStore; state: ReturnType<typeof useGitStatus>; onBack: () => void; run: (action: () => Promise<unknown>) => void }) {
  const [generated, setGenerated] = useState(false), [query, setQuery] = useState(''), [top, setTop] = useState(0), [height, setHeight] = useState(400), host = useRef<HTMLDivElement>(null);
  const root = store.treeRoot, data = state.data?.state === 'ready' ? state.data : null;
  const all = data?.entries.filter((entry) => entry.status !== 'ignored') ?? [], hasGenerated = all.some((entry) => entry.generated === true);
  const entries = useMemo(() => all.filter((entry) => (!generated || entry.generated !== true) && (!query || entry.relativePath.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => a.relativePath.localeCompare(b.relativePath)), [data, generated, query]);
  useEffect(() => { const element = host.current; if (!element) return; const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => { setGenerated(false); setQuery(''); setTop(0); if (host.current) host.current.scrollTop = 0; }, [root?.lease]);
  const first = Math.max(0, Math.floor(top / 28) - 3), last = Math.min(entries.length, first + Math.ceil(height / 28) + 6);
  return <><div className="fw-changes-title"><button aria-label="返回全部文件" onClick={onBack}><ArrowLeft size={14} /></button><GitBranch size={14} /><span>变化文件</span><span>{entries.length}</span><button aria-label="刷新 Git 信息" onClick={state.refresh}><RotateCcw size={13} /></button></div>
    <label className="fw-filter"><input aria-label="筛选变化文件" placeholder="筛选变化文件…" value={query} onChange={(event) => { setQuery(event.target.value); if (host.current) host.current.scrollTop = 0; setTop(0); }} /></label>
    {hasGenerated && <label className="fw-generated"><input type="checkbox" checked={generated} onChange={(event) => setGenerated(event.target.checked)} />筛除生成文件 {generated ? '1' : ''}</label>}
    {state.loading && <p className="fw-git-message" role="status"><Loader2 size={13} className="animate-spin" />正在读取 Git 信息…</p>}
    {state.error && <p className="fw-git-message" role="alert">{state.error}<button onClick={state.refresh}>重试</button></p>}
    {state.data?.state === 'unavailable' && <p className="fw-git-message" role="status">{state.data.reason}</p>}
    {data?.truncated && <p className="fw-git-message" role="status">变化文件超过 20,000 项，仅显示本次读取范围。</p>}
    {data && !data.attributesAvailable && <p className="fw-git-message">无法读取 generated 属性，未知文件保持可见。</p>}
    {data && !entries.length && <p className="fw-git-message" role="status">{all.length ? '没有符合筛选的变化文件' : '当前目录没有变化文件'}</p>}
    <div className="fw-changes-list" ref={host} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const current = Number((event.target as HTMLElement).closest<HTMLElement>('[data-change-index]')?.dataset.changeIndex);
      if (!Number.isInteger(current) || !entries.length) return;
      const next = event.key === 'ArrowDown' ? Math.min(entries.length - 1, current + 1) : event.key === 'ArrowUp' ? Math.max(0, current - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : null;
      if (next === null) return; event.preventDefault();
      const node = host.current!; if (next * 28 < node.scrollTop || (next + 1) * 28 > node.scrollTop + node.clientHeight) { node.scrollTop = Math.max(0, next * 28 - node.clientHeight / 2); setTop(node.scrollTop); }
      requestAnimationFrame(() => node.querySelector<HTMLButtonElement>(`[data-change-index="${next}"]`)?.focus({ preventScroll: true }));
    }} onScroll={(event) => setTop(event.currentTarget.scrollTop)} role="list" aria-label="Git 变化文件"><div style={{ height: entries.length * 28, position: 'relative' }}>{root && entries.slice(first, last).map((entry, offset) => <FileContextActions key={entry.relativePath} target={{ kind: 'path', path: { lease: root.lease, generation: root.generation, relativePath: entry.relativePath }, directory: entry.directory }} absolutePath={`${root.canonicalPath}/${entry.relativePath}`} relativePath={entry.relativePath} origin="tree" run={run}><button type="button" data-change-index={first + offset} className="fw-tree-row fw-tree-virtual-row" style={{ top: (first + offset) * 28 }} title={`${entry.previousPath ? entry.previousPath + ' → ' : ''}${entry.relativePath} · ${gitLabels[entry.status]}`} onClick={(event) => { event.currentTarget.focus({ preventScroll: true }); void store.open(root, entry.relativePath); }} onDoubleClick={() => void store.open(root, entry.relativePath, true)}><FileTreeIcon path={entry.relativePath} /><span>{entry.relativePath}</span><GitStatusMark entry={entry} /></button></FileContextActions>)}</div></div>
  </>;
}
