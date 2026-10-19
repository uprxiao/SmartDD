import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, Loader2 } from 'lucide-react';
import type { FileRoot } from '@shared/files';
import { Popover, PopoverContent, PopoverTrigger } from '@renderer/lib/ui/popover';
import { FileTreeIcon } from './file-icon';
import type { FileWorkspaceStore } from './workspace-store';
import { FileContextActions } from './file-actions';
import type { GitRepositoryInfo } from '@shared/file-git';
import { fileAbsolutePath, rootRelativePath } from '@shared/file-root-location.mjs';

export function FileBreadcrumb({ store, run, repository }: { store: FileWorkspaceStore; run: (action: () => Promise<unknown>) => void; repository?: GitRepositoryInfo }) {
  // Issuing root/ref own every native action, even when the display root is a
  // deeper registered ancestor or the user browses a different tree.
  const root = store.activeRoot ?? (!store.active ? store.treeRoot : undefined);
  const file = store.active?.buffer?.file, route = store.active?.route;
  const location = store.activeLocation, displayRoot = location?.root ?? root;
  const baseDirectory = root && displayRoot ? rootRelativePath(root, displayRoot.canonicalPath) ?? '' : '';
  const displayPath = location?.relativePath ?? route?.relativePath;
  const [open, setOpen] = useState<number | null>(null), [directory, setDirectory] = useState('');
  const node = useRef<HTMLDivElement>(null);
  const parts = displayRoot ? [displayRoot.label || displayRoot.path.split('/').filter(Boolean).at(-1) || '/', ...(displayPath?.split('/') ?? [])] : [route?.relativePath ?? '本机文件'];
  const sourcePath = (index: number) => [baseDirectory, ...parts.slice(1, index + 1)].filter(Boolean).join('/');
  const referenceRelativePath = file && store.treeRoot ? rootRelativePath(store.treeRoot, file.absolutePath) : null;
  const referencePath = referenceRelativePath !== null && store.treeRoot ? { lease: store.treeRoot.lease, generation: store.treeRoot.generation, relativePath: referenceRelativePath } : undefined;
  useEffect(() => { setOpen(null); if (node.current) node.current.scrollLeft = node.current.scrollWidth; }, [route?.relativePath, root?.lease, displayRoot?.lease]);
  return <div ref={node} className="fw-breadcrumb" aria-label="文件路径" title={file?.absolutePath ?? root?.path ?? route?.sourcePath} onCopy={(event) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !node.current?.contains(selection.anchorNode) || !node.current.contains(selection.focusNode)) return;
    const selected = selection.toString(); if (!selected) return;
    event.preventDefault(); event.clipboardData.setData('text/plain', selected === parts.join('›') ? file?.absolutePath ?? root?.path ?? selected : selected.replaceAll('›', '/'));
  }}>
    {parts.map((part, index) => <span key={`${root?.lease}:${index}`}>
      {index > 0 && <span className="fw-crumb-chevron" aria-hidden>›</span>}
      {root ? <Popover open={open === index} onOpenChange={(value) => {
        if (!value) { setOpen((current) => current === index ? null : current); return; }
        const selection = window.getSelection(); if (selection && !selection.isCollapsed && node.current?.contains(selection.anchorNode)) return;
        setDirectory(sourcePath(index === parts.length - 1 && route ? index - 1 : index)); setOpen(index);
      }}><FileContextActions target={file && index === parts.length - 1 ? { kind: 'document', ref: file.ref } : { kind: 'path', path: { lease: root.lease, generation: root.generation, relativePath: sourcePath(index) }, directory: !route || index < parts.length - 1 }} absolutePath={fileAbsolutePath(root, sourcePath(index)) ?? root.canonicalPath} relativePath={parts.slice(1, index + 1).join('/')} sourceRelativePath={sourcePath(index)} referencePath={index === parts.length - 1 ? referencePath : undefined} origin="breadcrumb" repository={repository} buffer={index === parts.length - 1 ? store.active?.buffer ?? undefined : undefined} run={run}><PopoverTrigger className={index === parts.length - 1 ? 'current' : ''} title={displayRoot ? fileAbsolutePath({ path: displayRoot.path }, parts.slice(1, index + 1).join('/')) ?? displayRoot.path : ''}>{part}</PopoverTrigger></FileContextActions>
        <PopoverContent className="fw-breadcrumb-popup" align="start" sideOffset={1} aria-label={`${part} 目录内容`}><BreadcrumbDirectory store={store} root={root} baseDirectory={baseDirectory} displayLabel={displayRoot?.label ?? root.label} directory={directory} onDirectory={setDirectory} onChoose={(path) => { setOpen(null); void store.open(root, path); }} /></PopoverContent>
      </Popover> : <span className="current">{part}</span>}
    </span>)}
  </div>;
}

function BreadcrumbDirectory({ store, root, baseDirectory, displayLabel, directory, onDirectory, onChoose }: { store: FileWorkspaceStore; root: FileRoot; baseDirectory: string; displayLabel: string; directory: string; onDirectory: (path: string) => void; onChoose: (path: string) => void }) {
  const list = useRef<HTMLDivElement>(null), [top, setTop] = useState(0);
  const state = store.directories.get(store.directoryKey(root, directory));
  useEffect(() => { setTop(0); if (list.current) list.current.scrollTop = 0; void store.list(root, directory); }, [store, root.lease, directory]);
  const entries = state?.state === 'ready' ? state.entries : [], first = Math.max(0, Math.floor(top / 28) - 3), last = Math.min(entries.length, first + 19);
  useEffect(() => {
    const active = store.active?.route.relativePath, index = entries.findIndex((entry) => entry.relativePath === active || entry.kind === 'directory' && active?.startsWith(entry.relativePath + '/'));
    if (index < 0 || !list.current) return;
    const value = Math.max(0, index * 28 - 140); list.current.scrollTop = value; setTop(value);
  }, [directory, root.lease, entries]);
  return <>
    <div className="fw-breadcrumb-location">{directory !== baseDirectory && <button aria-label="上级目录" onClick={() => onDirectory(directory.split('/').slice(0, -1).join('/'))}><ChevronLeft size={14} /></button>}<span title={fileAbsolutePath(root, directory) ?? root.path}>{(baseDirectory ? directory.slice(baseDirectory.length + 1) : directory) || displayLabel}</span></div>
    {!state || state.state === 'loading' ? <p role="status"><Loader2 size={14} className="animate-spin" />正在读取目录…</p> : state.state === 'error' ? <p role="alert">{state.message}<button onClick={() => void store.list(root, directory, true)}>重试</button></p> : !entries.length ? <p role="status">此目录为空</p> : <div ref={list} className="fw-breadcrumb-list" onScroll={(event) => setTop(event.currentTarget.scrollTop)} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229) return;
      const focused = Number((event.target as HTMLElement).closest<HTMLElement>('[data-crumb-index]')?.dataset.crumbIndex);
      if (!Number.isInteger(focused)) return;
      let next: number;
      if (event.key === 'ArrowDown') next = Math.min(entries.length - 1, focused + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, focused - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = entries.length - 1;
      else if (event.key === 'ArrowLeft' && directory !== baseDirectory) { event.preventDefault(); onDirectory(directory.split('/').slice(0, -1).join('/')); return; }
      else return;
      event.preventDefault(); const parent = list.current!;
      if (next * 28 < parent.scrollTop || (next + 1) * 28 > parent.scrollTop + parent.clientHeight) { parent.scrollTop = Math.max(0, next * 28 - 140); setTop(parent.scrollTop); }
      requestAnimationFrame(() => parent.querySelector<HTMLButtonElement>(`[data-crumb-index="${next}"]`)?.focus({ preventScroll: true }));
    }}><div style={{ height: entries.length * 28, position: 'relative' }}>{entries.slice(first, last).map((entry, offset) => <button key={entry.relativePath} type="button" data-crumb-index={first + offset} className="fw-tree-row" style={{ top: (first + offset) * 28 }} aria-current={entry.relativePath === store.active?.route.relativePath ? 'page' : undefined} disabled={entry.kind === 'unavailable'} title={entry.reason ?? `${root.path}/${entry.relativePath}`} onClick={() => entry.kind === 'directory' ? onDirectory(entry.relativePath) : onChoose(entry.relativePath)}>{entry.kind === 'directory' ? <FolderOpen size={14} /> : <FileTreeIcon path={entry.relativePath} />}<span>{entry.name}</span>{entry.kind === 'directory' && <ChevronRight size={13} />}</button>)}</div></div>}
  </>;
}
