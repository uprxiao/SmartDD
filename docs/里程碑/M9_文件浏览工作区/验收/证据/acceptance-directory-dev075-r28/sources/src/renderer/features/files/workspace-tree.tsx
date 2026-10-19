import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { FileEntry } from '@shared/files';
import type { FileWorkspaceStore } from './workspace-store';
import { FileTreeIcon } from './file-icon';
import { FileContextActions } from './file-actions';
import type { GitEntry } from '@shared/file-git';
import { GitStatusMark } from './git-metadata';
import { useFileTerminalContext } from './terminal-context/context';
import { FILE_TERMINAL_DRAG_TYPE, endFileDrag } from './terminal-context/store';

interface Row { path: string; name: string; depth: number; entry?: FileEntry; parent: string; status?: 'loading' | 'error' | 'empty'; reason?: string }
const ROW = 28;
export function WorkspaceTree({ store, run, git }: { store: FileWorkspaceStore; run: (action: () => Promise<unknown>) => void; git?: Map<string, GitEntry> }) {
  const terminal = useFileTerminalContext();
  const root = store.treeRoot, host = useRef<HTMLDivElement>(null), buttons = useRef(new Map<string, HTMLButtonElement>());
  const [scrollTop, setScrollTop] = useState(0), [height, setHeight] = useState(400), [, redrawSelection] = useState(0);
  const view = root ? store.treeViews.get(root.lease) : undefined, focused = view?.focused ?? '', selected = view?.selected ?? [];
  const updateSelection = (change: (current: { focused: string; selected: string[] }) => { focused: string; selected: string[] }) => {
    if (!root) return;
    store.treeViews.set(root.lease, change(store.treeViews.get(root.lease) ?? { focused: '', selected: [] }));
    redrawSelection(value => value + 1);
  };
  const setFocused = (path: string) => updateSelection(current => ({ ...current, focused: path }));
  const setSelected = (value: string[] | ((current: string[]) => string[])) => updateSelection(current => ({ ...current, selected: typeof value === 'function' ? value(current.selected) : value }));
  const anchor = useRef('');
  const focusFrame = useRef<number | null>(null), focusEpoch = useRef(0);
  useLayoutEffect(() => {
    anchor.current = '';
    return () => { focusEpoch.current++; if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); focusFrame.current = null; };
  }, [root?.lease, store]);
  const expanded = store.currentExpanded;
  const rows = useMemo(() => {
    const result: Row[] = [];
    if (!root) return result;
    const visit = (path: string, depth: number) => {
      const state = store.directories.get(store.directoryKey(root, path));
      if (!state || state.state === 'loading') { result.push({ path: `${path}/:loading`, parent: path, name: '正在读取…', depth, status: 'loading' }); return; }
      if (state.state === 'error') { result.push({ path: `${path}/:error`, parent: path, name: '读取失败', reason: state.message, depth, status: 'error' }); return; }
      if (!state.entries.length) { result.push({ path: `${path}/:empty`, parent: path, name: path ? '空目录' : '此目录为空', depth, status: 'empty' }); return; }
      for (const entry of state.entries) { result.push({ path: entry.relativePath, name: entry.name, depth, entry, parent: path }); if (entry.kind === 'directory' && expanded.includes(entry.relativePath)) visit(entry.relativePath, depth + 1); }
    };
    visit('', 0); return result;
  }, [store.snapshot(), root, expanded]);
  useEffect(() => {
    if (!root || !store.rootExpanded) return;
    for (const row of rows) if (row.status === 'loading' && !store.directories.has(store.directoryKey(root, row.parent))) void store.list(root, row.parent);
  }, [root, rows, store]);
  useLayoutEffect(() => {
    const element = host.current; if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element);
    const position = root ? store.scroll.get(root.lease) ?? 0 : 0; element.scrollTop = position; setScrollTop(position);
    return () => observer.disconnect();
  }, [root?.lease, store]);
  const first = Math.max(0, Math.floor(scrollTop / ROW) - 4), end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 4);
  const visible = rows.slice(first, end).map((row, index) => ({ row, index: first + index }));
  const focusIndex = rows.findIndex((row) => row.path === focused);
  if (focusIndex >= 0 && (focusIndex < first || focusIndex >= end)) visible.push({ row: rows[focusIndex], index: focusIndex });
  const navigable = rows.filter((row) => row.entry), firstVisible = rows[Math.min(rows.length - 1, Math.floor(scrollTop / ROW))];
  const sticky = firstVisible ? rows.filter((row, index) => row.entry?.kind === 'directory' && firstVisible.path.startsWith(`${row.path}/`) && index * ROW < scrollTop).slice(-3) : [];
  const focus = (path: string) => {
    const index = rows.findIndex((row) => row.path === path); if (index < 0 || !host.current) return;
    const top = index * ROW, bottom = top + ROW;
    if (top < host.current.scrollTop + sticky.length * ROW) host.current.scrollTop = Math.max(0, top - sticky.length * ROW);
    else if (bottom > host.current.scrollTop + height) host.current.scrollTop = bottom - height;
    setScrollTop(host.current.scrollTop); setFocused(path);
    if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
    const epoch = ++focusEpoch.current, lease = root?.lease;
    focusFrame.current = requestAnimationFrame(() => {
      if (epoch !== focusEpoch.current || store.treeRoot?.lease !== lease) return;
      focusFrame.current = null;
      const button = buttons.current.get(path); if (button?.isConnected) button.focus({ preventScroll: true });
    });
  };
  const open = (row: Row, pin = false) => { if (!root || !row.entry) return; if (row.entry.kind === 'directory') store.toggleDirectory(row.path); else if (row.entry.kind === 'file') void store.open(root, row.path, pin); };
  return <div className="fw-tree-region">{root && <button type="button" className="fw-tree-row fw-root-folder" aria-expanded={store.rootExpanded} title={root.path} onClick={() => store.toggleRoot()} onKeyDown={(event) => {
    if (event.key === 'ArrowLeft' && store.rootExpanded || event.key === 'ArrowRight' && !store.rootExpanded) { event.preventDefault(); store.toggleRoot(); }
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowRight') && store.rootExpanded && navigable[0]) { event.preventDefault(); focus(navigable[0].path); }
  }}>{store.rootExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{root.path.split('/').filter(Boolean).at(-1) ?? root.label}</span></button>}<div hidden={!store.rootExpanded} className="fw-tree-scroll" role="tree" aria-label="文件目录" aria-multiselectable="true" ref={host} onScroll={(event) => { const top = event.currentTarget.scrollTop; setScrollTop(top); if (root) store.scroll.set(root.lease, top); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || !event.target || !(event.target as Element).closest('[role=treeitem]')) return;
      const index = Math.max(0, navigable.findIndex((row) => row.path === focused)), row = navigable[index]; if (!row) return;
      let next = index;
      if ((event.metaKey || event.ctrlKey) && event.key === ' ') { event.preventDefault(); setSelected((old) => old.includes(row.path) ? old.filter((path) => path !== row.path) : [...old, row.path]); return; }
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(row); return; }
      if (event.key === 'ArrowRight' && row.entry?.kind !== 'directory') return;
      if (event.key === 'ArrowRight' && row.entry?.kind === 'directory' && !expanded.includes(row.path) || event.key === 'ArrowLeft' && row.entry?.kind === 'directory' && expanded.includes(row.path)) { event.preventDefault(); store.toggleDirectory(row.path); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(navigable.length - 1, index + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = navigable.length - 1;
      else if (event.key === 'ArrowLeft') next = Math.max(0, navigable.findIndex((candidate) => candidate.path === row.parent));
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); setSelected(navigable.map((candidate) => candidate.path)); return; }
      else return;
      event.preventDefault(); event.stopPropagation(); focus(navigable[next].path);
      if (event.shiftKey) { const start = Math.max(0, navigable.findIndex((candidate) => candidate.path === (anchor.current || row.path))); setSelected(navigable.slice(Math.min(start, next), Math.max(start, next) + 1).map((candidate) => candidate.path)); }
    }}>
    <div className="fw-tree-virtual" style={{ height: rows.length * ROW }}>{visible.map(({ row, index }) => { const node = row.status
      ? <div key={row.path} className={`fw-tree-status ${row.status}`} style={{ top: index * ROW, paddingLeft: 3 + row.depth * 16 }} role={row.status === 'error' ? 'alert' : 'status'} title={row.reason}>{row.name}{row.status === 'error' && <button onClick={() => root && void store.list(root, row.parent, true)}>重试</button>}</div>
      : <button key={row.path} ref={(element) => { if (element) buttons.current.set(row.path, element); else buttons.current.delete(row.path); }} role="treeitem" aria-level={row.depth + 1} aria-expanded={row.entry?.kind === 'directory' ? expanded.includes(row.path) : undefined} aria-selected={selected.includes(row.path)} disabled={row.entry?.kind === 'unavailable'} tabIndex={focused === row.path || focusIndex < 0 && navigable[0]?.path === row.path ? 0 : -1} className={`fw-tree-row fw-tree-virtual-row ${store.active?.buffer?.file.absolutePath === `${root?.canonicalPath}/${row.path}` ? 'selected' : ''}`} style={{ top: index * ROW, paddingLeft: 3 + row.depth * 16 }} title={row.entry?.reason ?? `${root?.path}/${row.path}`}
        draggable={row.entry?.kind === 'file'} onDragStart={event => { if (!root || row.entry?.kind !== 'file') { event.preventDefault(); return; } const drag = terminal?.startDrag({ lease: root.lease, generation: root.generation, relativePath: row.path }, row.entry.identity ?? undefined); if (!drag) { event.preventDefault(); return; } event.dataTransfer.setData(FILE_TERMINAL_DRAG_TYPE, drag.token); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => endFileDrag()}
        onFocus={() => setFocused(row.path)} onClick={(event) => {
          setFocused(row.path);
          if (event.shiftKey) { const from = Math.max(0, navigable.findIndex((candidate) => candidate.path === anchor.current)), to = navigable.indexOf(row); setSelected(navigable.slice(Math.min(from, to), Math.max(from, to) + 1).map((candidate) => candidate.path)); }
          else if (event.metaKey || event.ctrlKey) setSelected((old) => old.includes(row.path) ? old.filter((path) => path !== row.path) : [...old, row.path]);
          else { anchor.current = row.path; setSelected([row.path]); open(row); }
        }} onDoubleClick={() => { if (root && row.entry?.kind === 'file') void store.open(root, row.path, true); }}>
        {row.entry?.kind === 'directory' ? expanded.includes(row.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="fw-tree-spacer" />}{row.entry?.kind !== 'directory' && <FileTreeIcon path={row.path} />}<span>{row.name}</span><GitStatusMark entry={git?.get(row.path)} />
      </button>; return row.entry?.kind === 'file' && root ? <FileContextActions key={row.path} target={{ kind: 'path', path: { lease: root.lease, generation: root.generation, relativePath: row.path }, directory: false }} absolutePath={`${root.canonicalPath}/${row.path}`} relativePath={row.path} origin="tree" run={run}>{node}</FileContextActions> : node; })}</div>
  </div>{store.rootExpanded && sticky.length > 0 && <div className="fw-sticky-folders" aria-label="当前目录层级">{sticky.map((row) => <button className="fw-tree-row" key={row.path} onClick={() => focus(row.path)}><ChevronDown size={13} /><span>{row.name}</span></button>)}</div>}</div>;
}
