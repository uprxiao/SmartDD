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
import { nearestTreeScroll, treeSetInfo } from '@shared/file-tree-scroll.mjs';
import { fileAbsolutePath } from '@shared/file-root-location.mjs';

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
  const loadingFocus = useRef<{ lease: string; generation: number; path: string; navigate?: boolean } | null>(null);
  const loadedRows = useRef<{ lease: string; generation: number; rows: Row[] } | null>(null);
  useLayoutEffect(() => {
    anchor.current = '';
    const cancel = (event: Event) => {
      const key = event as KeyboardEvent;
      // A temporary native refresh may have moved owned focus to the tree
      // container. Keep navigation there until its real rows return.
      if (event.type === 'keydown' && event.target === host.current && loadingFocus.current &&
        (['Shift','Control','Meta','Alt','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End',' ','Enter'].includes(key.key) || (key.metaKey || key.ctrlKey) && key.key.toLowerCase() === 'a')) return;
      loadingFocus.current = null;
    };
    document.addEventListener('pointerdown', cancel, true); document.addEventListener('keydown', cancel, true);
    return () => { document.removeEventListener('pointerdown', cancel, true); document.removeEventListener('keydown', cancel, true); loadingFocus.current = null; loadedRows.current = null; focusEpoch.current++; if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); focusFrame.current = null; };
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
  const refreshing = rows.some(row => row.status === 'loading');
  if (root && !refreshing) loadedRows.current = { lease: root.lease, generation: root.generation, rows: rows.filter(row => row.entry) };
  if (root && refreshing && loadedRows.current?.lease === root.lease && loadedRows.current.generation === root.generation &&
    host.current?.contains(document.activeElement) && document.activeElement?.matches('[role=treeitem]')) {
    // Capture before React removes the old rows. A merged trigger ref can be
    // detached after the browser has already blurred the removed button.
    loadingFocus.current = { lease: root.lease, generation: root.generation, path: focused };
  }
  useLayoutEffect(() => {
    const pending = loadingFocus.current;
    if (!pending || !root || pending.lease !== root.lease || pending.generation !== root.generation || focused !== pending.path) return;
    if (document.activeElement !== document.body && document.activeElement !== host.current) { loadingFocus.current = null; return; }
    const button = buttons.current.get(pending.path);
    if (button?.isConnected && host.current?.clientHeight) {
      if (pending.navigate) { const top = nearestTreeScroll(rows.findIndex(row => row.path === pending.path), host.current.scrollTop, host.current.clientHeight, sticky.length * ROW); host.current.scrollTop = top; setScrollTop(top); store.scroll.set(root.lease, top); }
      loadingFocus.current = null; button.focus({ preventScroll: true });
    }
    else if (refreshing && host.current?.clientHeight && document.activeElement === document.body) host.current.focus({ preventScroll: true });
  }, [root, rows, focused, height]);
  const rememberButton = (path: string, element: HTMLButtonElement | null) => {
    if (element) { buttons.current.set(path, element); return; }
    const previous = buttons.current.get(path);
    if (root && previous === document.activeElement) {
      // A keyboard move can own the next row before its RAF runs. A native
      // refresh may remove the old DOM focus in between; retain the latest
      // logical target rather than restoring the row the user just left.
      const target = store.treeViews.get(root.lease)?.focused || path;
      const parents = ['', ...target.split('/').slice(0, -1).map((_, i) => target.split('/').slice(0, i + 1).join('/'))];
      if (parents.slice(1).every(parent => store.currentExpanded.includes(parent)) && parents.some(parent => store.directories.get(store.directoryKey(root, parent))?.state === 'loading')) loadingFocus.current = { lease: root.lease, generation: root.generation, path: target };
    }
    buttons.current.delete(path);
  };
  useEffect(() => {
    if (!root || !store.rootExpanded) return;
    for (const row of rows) if (row.status === 'loading' && !store.directories.has(store.directoryKey(root, row.parent))) void store.list(root, row.parent);
  }, [root, rows, store]);
  const pendingRestore = useRef<{ lease: string; generation: number; top: number } | null>(null);
  const restoreViewport = useRef<() => void>(() => undefined);
  restoreViewport.current = () => {
    const pending = pendingRestore.current, element = host.current;
    if (!pending || !root || pending.lease !== root.lease || pending.generation !== root.generation || store.treeRoot?.lease !== root.lease) return;
    // A new file location owns the viewport. Never apply an older ordinary
    // scroll restore after its one-shot reveal has finished.
    if (store.treeReveal) { pendingRestore.current = null; return; }
    if (!element?.isConnected || !store.rootExpanded || !element.clientHeight || rows.some(row => row.status === 'loading')) return;
    pendingRestore.current = null;
    element.scrollTop = Math.min(pending.top, Math.max(0, rows.length * ROW - element.clientHeight));
    setScrollTop(element.scrollTop); store.scroll.set(root.lease, element.scrollTop);
  };
  useLayoutEffect(() => {
    const element = host.current; if (!element) return;
    let mounted = true;
    const position = root ? store.scroll.get(root.lease) ?? 0 : 0;
    pendingRestore.current = root && position > 0 ? { lease: root.lease, generation: root.generation, top: position } : null;
    if (!position) element.scrollTop = 0;
    setScrollTop(position); if (element.clientHeight) setHeight(element.clientHeight);
    const observer = new ResizeObserver(() => { if (!mounted) return; if (element.clientHeight) setHeight(element.clientHeight); restoreViewport.current(); }); observer.observe(element);
    restoreViewport.current();
    return () => { mounted = false; observer.disconnect(); pendingRestore.current = null; };
  }, [root?.lease, root?.generation, store.rootExpanded, store]);
  const reveal = store.treeReveal;
  useLayoutEffect(() => {
    // Refresh can temporarily shrink the virtual list to one loading row.
    // Capture the last user position before the browser's clamp scroll event;
    // the ordinary pending-restore guard then ignores that synthetic reset.
    if (root && store.rootExpanded && !reveal && rows.some(row => row.status === 'loading') && !pendingRestore.current) {
      const top = store.scroll.get(root.lease) ?? 0;
      if (top > 0) pendingRestore.current = { lease: root.lease, generation: root.generation, top };
    }
    restoreViewport.current();
  }, [rows, height, reveal]);
  useLayoutEffect(() => {
    if (!reveal || !root || reveal.lease !== root.lease || reveal.generation !== root.generation || !store.rootExpanded) return;
    if (store.activeId !== reveal.tabId || store.active?.buffer?.instance !== reveal.bufferInstance) { store.completeTreeReveal(reveal.id); return; }
    const index = rows.findIndex(row => row.path === reveal.path);
    if (index < 0) {
      if (!rows.some(row => row.status === 'loading' && (!row.parent || reveal.path.startsWith(row.parent + '/')))) store.completeTreeReveal(reveal.id);
      return;
    }
    if (rows.slice(0, index).some(row => row.status === 'loading')) return;
    const entry = rows[index].entry, revision = store.active.buffer!.file.revision;
    if (entry?.kind !== 'file' || !entry.identity || entry.identity.device !== revision.device || entry.identity.inode !== revision.inode) { store.completeTreeReveal(reveal.id); return; }
    const element = host.current;
    if (!element?.clientHeight) return;
    const stickyHeight = Math.min(3, reveal.path.split('/').length - 1) * ROW;
    element.scrollTop = nearestTreeScroll(index, element.scrollTop, element.clientHeight, stickyHeight);
    setScrollTop(element.scrollTop);
    // Selection and DOM focus are separate: an editor/search result keeps its
    // focus while the tree reveals the authenticated current file once.
    store.completeTreeReveal(reveal.id, element.scrollTop);
  }, [store, reveal, root, rows, height]);
  const first = Math.max(0, Math.floor(scrollTop / ROW) - 4), end = Math.min(rows.length, Math.ceil((scrollTop + height) / ROW) + 4);
  const visible = rows.slice(first, end).map((row, index) => ({ row, index: first + index }));
  const focusIndex = rows.findIndex((row) => row.path === focused);
  if (focusIndex >= 0 && (focusIndex < first || focusIndex >= end)) visible.push({ row: rows[focusIndex], index: focusIndex });
  const navigable = rows.filter((row) => row.entry), firstVisible = rows[Math.min(rows.length - 1, Math.floor(scrollTop / ROW))];
  const sticky = firstVisible ? rows.filter((row, index) => row.entry?.kind === 'directory' && firstVisible.path.startsWith(`${row.path}/`) && index * ROW < scrollTop).slice(-3) : [];
  const positions = treeSetInfo(navigable);
  const keyboardRows = refreshing && loadingFocus.current && root && loadedRows.current && loadedRows.current.lease === root.lease && loadedRows.current.generation === root.generation
    ? loadedRows.current.rows.filter(row => row.path.split('/').slice(0,-1).every((_,i) => expanded.includes(row.path.split('/').slice(0,i+1).join('/')))) : navigable;
  const focus = (path: string) => {
    const index = rows.findIndex((row) => row.path === path);
    if (index < 0) { if (loadingFocus.current && keyboardRows.some(row => row.path === path)) {
      focusEpoch.current++; if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current); focusFrame.current = null;
      loadingFocus.current = { ...loadingFocus.current, path, navigate: true }; setFocused(path);
    } return; }
    if (!host.current) return;
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
  const open = (row: Row, pin = false) => { if (!root || !row.entry) return; if (row.entry.kind === 'directory') store.toggleDirectory(row.path); else if (row.entry.kind === 'file') void store.open(root, row.path, pin, { reveal: false }); };
  const selectPaths = (paths: string[]) => {
    setSelected(paths);
    // The host accepts one file from a multi-selection. Opening a visible
    // tree item must retain the user's range, focus and browsing position.
    const files = new Set(keyboardRows.filter(row => row.entry?.kind === 'file').map(row => row.path)), first = paths.find(path => files.has(path));
    if (root && first) void store.open(root, first, false, { reveal: false });
  };
  const browse = () => { pendingRestore.current = null; const element = host.current; if (root && element?.clientHeight) store.scroll.set(root.lease, element.scrollTop); store.cancelTreeReveal(); };
  return <div className="fw-tree-region" onWheelCapture={browse} onPointerDownCapture={browse} onKeyDownCapture={browse}>{root && <button type="button" className="fw-tree-row fw-root-folder" aria-expanded={store.rootExpanded} title={root.path} onClick={() => store.toggleRoot()} onKeyDown={(event) => {
    if (event.key === 'ArrowLeft' && store.rootExpanded || event.key === 'ArrowRight' && !store.rootExpanded) { event.preventDefault(); store.toggleRoot(); }
    else if ((event.key === 'ArrowDown' || event.key === 'ArrowRight') && store.rootExpanded && navigable[0]) { event.preventDefault(); focus(navigable[0].path); }
  }}>{store.rootExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<span>{root.path.split('/').filter(Boolean).at(-1) ?? root.label}</span></button>}<div hidden={!store.rootExpanded} className="fw-tree-scroll" role="tree" tabIndex={-1} aria-label="文件目录" aria-multiselectable="true" ref={host} onScroll={(event) => { if (pendingRestore.current || !store.rootExpanded || !event.currentTarget.clientHeight) return; const top = event.currentTarget.scrollTop; setScrollTop(top); if (root) store.scroll.set(root.lease, top); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || !event.target || (!(event.target as Element).closest('[role=treeitem]') && !(event.target === host.current && loadingFocus.current))) return;
      const index = Math.max(0, keyboardRows.findIndex((row) => row.path === focused)), row = keyboardRows[index]; if (!row) return;
      let next = index;
      if ((event.metaKey || event.ctrlKey) && event.key === ' ') { event.preventDefault(); anchor.current = row.path; setSelected(selected.includes(row.path) ? selected.filter((path) => path !== row.path) : [...selected, row.path]); return; }
      if (event.key === 'Enter') { event.preventDefault(); open(row); return; }
      if (event.key === ' ') { event.preventDefault(); anchor.current = row.path; setSelected([row.path]); open(row); return; }
      if (event.key === 'ArrowRight' && row.entry?.kind !== 'directory') return;
      if (event.key === 'ArrowRight' && row.entry?.kind === 'directory' && !expanded.includes(row.path) || event.key === 'ArrowLeft' && row.entry?.kind === 'directory' && expanded.includes(row.path)) { event.preventDefault(); store.toggleDirectory(row.path); return; }
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') next = Math.min(keyboardRows.length - 1, index + 1);
      else if (event.key === 'ArrowUp') next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = keyboardRows.length - 1;
      else if (event.key === 'ArrowLeft') next = Math.max(0, keyboardRows.findIndex((candidate) => candidate.path === row.parent));
      else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') { event.preventDefault(); anchor.current = row.path; selectPaths(keyboardRows.map((candidate) => candidate.path)); return; }
      else return;
      event.preventDefault(); event.stopPropagation(); focus(keyboardRows[next].path);
      if (event.shiftKey) { const found = keyboardRows.findIndex((candidate) => candidate.path === anchor.current), start = found < 0 ? index : found; anchor.current = keyboardRows[start].path; selectPaths(keyboardRows.slice(Math.min(start, next), Math.max(start, next) + 1).map((candidate) => candidate.path)); }
    }}>
    <div className="fw-tree-virtual" style={{ height: rows.length * ROW }}>{visible.map(({ row, index }) => { const node = row.status
      ? <div key={row.path} className={`fw-tree-status ${row.status}`} style={{ top: index * ROW, paddingLeft: 3 + row.depth * 16 }} role={row.status === 'error' ? 'alert' : 'status'} title={row.reason}>{row.name}{row.status === 'error' && <button onClick={() => root && void store.list(root, row.parent, true)}>重试</button>}</div>
      : <button key={row.path} ref={(element) => rememberButton(row.path, element)} role="treeitem" aria-level={row.depth + 1} aria-posinset={positions[row.path]?.pos} aria-setsize={positions[row.path]?.size} aria-expanded={row.entry?.kind === 'directory' ? expanded.includes(row.path) : undefined} aria-selected={selected.includes(row.path)} disabled={row.entry?.kind === 'unavailable'} tabIndex={focused === row.path || focusIndex < 0 && navigable[0]?.path === row.path ? 0 : -1} className={`fw-tree-row fw-tree-virtual-row ${store.active?.buffer?.file.absolutePath === fileAbsolutePath(root, row.path) ? 'selected' : ''}`} style={{ top: index * ROW, paddingLeft: 3 + row.depth * 16 }} title={row.entry?.reason ?? `${root?.path}/${row.path}`}
        draggable={row.entry?.kind === 'file'} onDragStart={event => { if (!root || row.entry?.kind !== 'file') { event.preventDefault(); return; } const drag = terminal?.startDrag({ lease: root.lease, generation: root.generation, relativePath: row.path }, row.entry.identity ?? undefined); if (!drag) { event.preventDefault(); return; } event.dataTransfer.setData(FILE_TERMINAL_DRAG_TYPE, drag.token); event.dataTransfer.effectAllowed = 'copy'; }} onDragEnd={() => endFileDrag()}
        onFocus={() => setFocused(row.path)} onClick={(event) => {
          setFocused(row.path);
          if (event.shiftKey) { let from = navigable.findIndex((candidate) => candidate.path === anchor.current); if (from < 0) from = Math.max(0, navigable.findIndex((candidate) => candidate.path === focused)); const to = navigable.indexOf(row); selectPaths(navigable.slice(Math.min(from, to), Math.max(from, to) + 1).map((candidate) => candidate.path)); }
          else if (event.metaKey || event.ctrlKey) selectPaths(selected.includes(row.path) ? selected.filter((path) => path !== row.path) : [...selected, row.path]);
          else { anchor.current = row.path; setSelected([row.path]); open(row); }
        }} onDoubleClick={() => { if (root && row.entry?.kind === 'file') void store.open(root, row.path, true, { reveal: false }); }}>
        {row.entry?.kind === 'directory' ? expanded.includes(row.path) ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : <span className="fw-tree-spacer" />}{row.entry?.kind !== 'directory' && <FileTreeIcon path={row.path} />}<span className="fw-tree-name">{row.name}</span><GitStatusMark entry={git?.get(row.path)} />
      </button>; return row.entry?.kind === 'file' && root ? <FileContextActions key={row.path} target={{ kind: 'path', path: { lease: root.lease, generation: root.generation, relativePath: row.path }, directory: false }} absolutePath={`${root.canonicalPath}/${row.path}`} relativePath={row.path} origin="tree" run={run}>{node}</FileContextActions> : node; })}</div>
  </div>{store.rootExpanded && sticky.length > 0 && <div className="fw-sticky-folders" aria-label="当前目录层级">{sticky.map((row) => <button className="fw-tree-row" key={row.path} onClick={() => focus(row.path)}><ChevronDown size={13} /><span>{row.name}</span></button>)}</div>}</div>;
}
