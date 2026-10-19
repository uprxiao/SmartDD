import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { EMPTY_DIRS, rankedTreeRows, treeKeyboardIntent, treeSetInfo } from './file-workspace-model.mjs';
import { composing } from './file-ime.mjs';
import { createFixtureFileProvider, latestRequestGate, loadedTreeRows, nearestTreeScroll, stickyTreeAncestors, TREE_ROW_HEIGHT, virtualTreeWindow } from './file-interaction-model.mjs';

const CHANGED = { 'AGENTS.md': 'M', 'src/main.ts': 'M', 'package.json': 'A', 'CHANGELOG.md': 'M' };
export function FileWorkspaceTree({ files, scope, rootPath, query, searchScenario, expanded, selected, focused, activePath, revealRequest, onRevealComplete, scrollRef, apiRef, initialScrollTop = 0, normalScrollTop, onScrollPosition, onSearchScrollPosition, onExpandedChange, onSelectedChange, onFocusedChange, onOpen, onMenu, onDrag, onDragEnd, changedOnly, hideGenerated, large, renderIcon, fixtureProvider }) {
  // The prototype already cancels an unconfirmed collapsed read. An optional
  // synthetic provider lets its acceptance harness prove inverse delivery too.
  const provider = useMemo(() => fixtureProvider ?? createFixtureFileProvider(files, {
    emptyDirs: [...(files.length ? EMPTY_DIRS : []), ...(large ? ['大目录/空目录', '大目录/读取失败'] : [])],
    failDirectories: large ? ['大目录/读取失败'] : [],
  }), [files, large, fixtureProvider]);
  const [cache, setCache] = useState({}), [retry, setRetry] = useState(0);
  const [search, setSearch] = useState({ state: 'idle', candidates: [] }), [collapsed, setCollapsed] = useState([]), [searchAttempt,setSearchAttempt]=useState(0);
  const [scrollTop, setScrollTop] = useState(initialScrollTop), [height, setHeight] = useState(400);
  const [tooltip, setTooltip] = useState(null);
  const [rootExpanded, setRootExpanded] = useState(true);
  const requests = useRef(new Map()), gate = useRef(latestRequestGate()), cacheRef = useRef(cache), anchor = useRef(null);
  const pendingFocus = useRef(null), timer = useRef(null), tipElement = useRef(null), region = useRef(null), savedScroll = useRef(normalScrollTop ?? initialScrollTop), wasSearch = useRef(!!query.trim()), lastQuery = useRef(query), initialRestore = useRef(initialScrollTop>0?initialScrollTop:null);
  const current = useRef({}); current.current = { expanded, onScrollPosition, onFocusedChange, onSelectedChange, onExpandedChange, scope };
  cacheRef.current = cache;
  const clearTooltip = () => { clearTimeout(timer.current); timer.current = null; tipElement.current = null; setTooltip(null); };
  useEffect(() => {
    if (!rootExpanded) {
      if (requests.current.size) {
        const paths = [...requests.current.keys()]; for (const controller of requests.current.values()) controller.abort(); requests.current.clear();
        setCache(old => { const next = { ...old }; for (const path of paths) if (next[path]?.state === 'loading') delete next[path]; return next; });
      }
      return;
    }
    const load = path => {
      if (requests.current.has(path) || ['ready','error'].includes(cacheRef.current[path]?.state)) return;
      const controller = new AbortController(); requests.current.set(path, controller);
      setCache(old => ({ ...old, [path]: { state: 'loading' } }));
      provider.list(path, { signal: controller.signal }).then(entries => {
        if (!controller.signal.aborted) setCache(old => ({ ...old, [path]: { state: 'ready', entries } }));
      }).catch(error => {
        if (!controller.signal.aborted && error.name !== 'AbortError') setCache(old => ({ ...old, [path]: { state: 'error', error: error.message } }));
      }).finally(() => { if (requests.current.get(path) === controller) requests.current.delete(path); });
    };
    load('');
    // Only expand directories whose parent entries are already loaded.
    const visible = loadedTreeRows(cache, expanded);
    for (const row of visible) if (row.folder && expanded.includes(row.path)) load(row.path);
    for (const [path, controller] of requests.current) {
      if (path && !visible.some(row => row.folder && row.path === path && expanded.includes(path))) {
        controller.abort(); requests.current.delete(path);
        setCache(old => { const next = { ...old }; delete next[path]; return next; });
      }
    }
  }, [provider, expanded, cache, retry, rootExpanded]);
  // Promise callbacks must survive cache renders; request identity owns completion.
  useEffect(() => () => { for (const controller of requests.current.values()) controller.abort(); requests.current.clear(); gate.current.cancel(); clearTimeout(timer.current); }, [provider]);

  useEffect(() => {
    const token = gate.current.start(scope + ':' + query);
    clearTooltip(); setCollapsed([]);
    if (!query.trim()) { setSearch({ state: 'idle', candidates: [] }); return () => gate.current.cancel(); }
    setSearch({ state: 'loading', candidates: [] });
    const debounce = setTimeout(() => provider.names(query, { signal: token.signal, mode: searchScenario==='error'&&searchAttempt>0?'ready':searchScenario }).then(candidates => {
      if (gate.current.accepts(token)) setSearch({ state: 'ready', candidates });
    }).catch(error => {
      if (gate.current.accepts(token)) setSearch({ state: 'error', candidates: [], error: error.message });
    }), 50);
    return () => { clearTimeout(debounce); gate.current.cancel(); };
  }, [provider, scope, query, searchScenario, searchAttempt]);
  useEffect(()=>setSearchAttempt(0),[query,searchScenario]);

  const rows = useMemo(() => (query.trim() ? rankedTreeRows(search.candidates, collapsed) : loadedTreeRows(cache, expanded))
    .filter(row => !changedOnly || row.folder || CHANGED[row.path])
    .filter(row => !changedOnly || !hideGenerated || row.path !== 'package.json'), [cache, expanded, query, search.candidates, collapsed, changedOnly, hideGenerated]);
  const navigable = useMemo(() => rows.filter(row => !row.status), [rows]);
  const positions = useMemo(() => treeSetInfo(navigable), [navigable]);
  const rowIndex = useMemo(() => new Map(rows.map((row, i) => [row.path, i])), [rows]);
  const windowed = virtualTreeWindow(rows, scrollTop, height), sticky = stickyTreeAncestors(rows, scrollTop);
  const effectiveExpanded = query.trim() ? navigable.filter(row => row.folder && !collapsed.includes(row.path)).map(row => row.path) : expanded;
  const renderRows = windowed.rows.map((row, i) => ({ row, index: i + windowed.start }));
  const focusedIndex = rowIndex.get(focused);
  if (focusedIndex !== undefined && (focusedIndex < windowed.start || focusedIndex >= windowed.end)) renderRows.push({ row: rows[focusedIndex], index: focusedIndex });
  function scrollTo(value) { if (scrollRef.current) scrollRef.current.scrollTop = value; setScrollTop(value); }
  function focusPath(path, takeFocus = true) {
    const index = rowIndex.get(path); if (index === undefined) return;
    const element = scrollRef.current;
    scrollTo(nearestTreeScroll(index, element?.scrollTop || 0, element?.clientHeight || height, sticky.length * TREE_ROW_HEIGHT));
    if (takeFocus) { pendingFocus.current = path; onFocusedChange(path); }
  }
  apiRef.current = { owner: region, focusFirst: () => navigable[0] && focusPath(navigable[0].path), reveal: path => focusPath(path, false) };
  useEffect(()=>()=>{if(apiRef.current?.owner===region)apiRef.current=null;},[]);
  useLayoutEffect(() => {
    if (!pendingFocus.current) return;
    const element = [...(scrollRef.current?.querySelectorAll('[role=treeitem]') || [])].find(el => el.dataset.path === pendingFocus.current);
    if (element) { element.focus({ preventScroll: true }); pendingFocus.current = null; }
  }, [rows, scrollTop, focused]);
  useLayoutEffect(() => {
    const element = scrollRef.current; if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.clientHeight)); observer.observe(element);
    scrollTo(initialScrollTop);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const searching = !!query.trim();
    if (searching && !wasSearch.current) { savedScroll.current = scrollRef.current?.scrollTop || 0; scrollTo(0); }
    if (!searching && wasSearch.current) scrollTo(savedScroll.current);
    if (lastQuery.current !== query) { initialRestore.current = null; if (searching && wasSearch.current) scrollTo(0); }
    wasSearch.current = searching; lastQuery.current = query;
  }, [query]);
  useLayoutEffect(() => {
    const value = initialRestore.current, element = scrollRef.current;
    if (value === null || !element?.clientHeight || rows.some(row=>row.status==='loading') || query.trim() && search.state !== 'ready') return;
    element.scrollTop = Math.min(value, Math.max(0, rows.length * TREE_ROW_HEIGHT - element.clientHeight));
    setScrollTop(element.scrollTop); initialRestore.current = null;
  }, [rows, height, query, search.state]);
  const revealDone = useRef(null);
  const revealKey = revealRequest === undefined ? activePath : revealRequest?.id;
  const revealPath = revealRequest?.path ?? activePath;
  function finishReveal() { revealDone.current = revealKey; if (revealRequest) onRevealComplete?.(revealRequest.id); }
  function browse() { initialRestore.current = null; finishReveal(); }
  useEffect(() => {
    if (!revealKey || !revealPath || query.trim() || revealDone.current === revealKey) return;
    if (!rootExpanded) { setRootExpanded(true); return; }
    const parents = revealPath.split('/').slice(0,-1).map((_,i) => revealPath.split('/').slice(0,i+1).join('/'));
    if (parents.some(path => !expanded.includes(path))) { onExpandedChange([...new Set([...expanded, ...parents])]); return; }
    const index = rowIndex.get(revealPath);
    if (index === undefined) { if (!rows.some(row=>row.status==='loading')) finishReveal(); return; }
    if (rows.slice(0,index).some(row=>row.status==='loading') || !scrollRef.current?.clientHeight) return;
    if (!rows[index].folder && !rows[index].status) { focusPath(revealPath, false); onSelectedChange([revealPath]); }
    finishReveal();
  }, [revealKey, revealPath, query, rowIndex, expanded, rootExpanded, height]);
  useEffect(() => { clearTooltip(); }, [rows, changedOnly, hideGenerated]);
  useEffect(() => {
    const close = () => clearTooltip();
    const key = event => { if (event.key === 'Escape') close(); };
    window.addEventListener('keydown', key, true); window.addEventListener('resize', close); window.addEventListener('scroll', close, true);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('resize', close); window.removeEventListener('scroll', close, true); };
  }, []);
  function tooltipFor(event, path, keyboard = false) {
    if (event.pointerType === 'touch' || event.buttons || event.target.closest('.fw-git-state,input,[data-tooltip-ignore]')) return;
    if (keyboard && !event.currentTarget.matches(':focus-visible')) return;
    const element = event.currentTarget; clearTimeout(timer.current); tipElement.current = element;
    timer.current = setTimeout(() => {
      if (!element.isConnected || tipElement.current !== element) return;
      const box = element.getBoundingClientRect();
      setTooltip({ path, x: Math.max(8, Math.min(box.left, innerWidth - 328)), y: Math.max(8, Math.min(box.bottom + 5, innerHeight - 112)) });
    }, 500);
  }
  function toggle(path, expand = !effectiveExpanded.includes(path)) {
    clearTooltip();
    if (query.trim()) setCollapsed(old => expand ? old.filter(item => item !== path) : [...new Set([...old, path])]);
    else onExpandedChange(expand ? [...new Set([...expanded, path])] : expanded.filter(item => item !== path));
  }
  function selectPaths(paths) {
    onSelectedChange(paths);
    const files = new Set(navigable.filter(row => !row.folder).map(row => row.path)), first = paths.find(path => files.has(path));
    if (first) onOpen(first, false);
  }
  function select(event, row) {
    clearTooltip(); onFocusedChange(row.path);
    if (row.folder && !event.metaKey && !event.ctrlKey && !event.shiftKey) { onSelectedChange([row.path]); anchor.current = row.path; toggle(row.path); return; }
    let next = [row.path];
    if (event.shiftKey) {
      let from = navigable.findIndex(item => item.path === anchor.current); const to = navigable.indexOf(row);
      if (from < 0) from = Math.max(0, navigable.findIndex(item => item.path === focused));
      next = navigable.slice(Math.min(from,to), Math.max(from,to)+1).map(item => item.path);
    } else if (event.metaKey || event.ctrlKey) next = selected.includes(row.path) ? selected.filter(path => path !== row.path) : [...selected,row.path];
    else anchor.current = row.path;
    selectPaths(next);
  }
  function keydown(event) {
    if (composing(event) || event.defaultPrevented || !event.target.closest('[role=treeitem]')) return;
    clearTooltip();
    const intent = treeKeyboardIntent(navigable, effectiveExpanded, event.target.dataset.path || focused, event.key, { shift:event.shiftKey, toggle:event.metaKey || event.ctrlKey, anchor:anchor.current, selected });
    if (!Object.keys(intent).length) return;
    event.preventDefault(); event.stopPropagation();
    if (intent.expand) toggle(intent.expand,true); if (intent.collapse) toggle(intent.collapse,false);
    if (intent.selected) selectPaths(intent.selected); if (intent.anchor) anchor.current = intent.anchor;
    if (intent.focus) focusPath(intent.focus);
  }
  function retryDirectory(path) { setCache(old => { const next = { ...old }; delete next[path]; return next; }); setRetry(value => value + 1); }
  return <div className="fw-tree-region" ref={region} data-loaded-directories={Object.keys(cache).length} data-total-rows={rows.length} onWheelCapture={browse} onPointerDownCapture={browse} onKeyDownCapture={browse}>
    {!query.trim() && <button className="fw-tree-row fw-root-folder" aria-expanded={rootExpanded} title={rootPath} onClick={()=>setRootExpanded(value=>!value)}>{rootExpanded?<ChevronDown size={13}/>:<ChevronRight size={13}/>}<span>{rootPath.split('/').filter(Boolean).at(-1)}</span></button>}
    <div hidden={!query.trim()&&!rootExpanded} className="fw-tree-scroll" role="tree" aria-label="文件目录" aria-multiselectable="true" aria-busy={cache['']?.state==='loading'||search.state==='loading'} ref={scrollRef} onKeyDown={keydown} onScroll={event => {
      clearTooltip(); const value = event.currentTarget.scrollTop; setScrollTop(value);
      if (!query.trim()) { savedScroll.current = value; onScrollPosition?.(value); } else if (initialRestore.current === null) onSearchScrollPosition?.(value);
    }}>
      <div className="fw-tree-virtual" style={{ height: windowed.total }}>
        {renderRows.map(({row,index}) => row.status ? <div key={row.path} className={'fw-tree-status '+row.status} style={{top:index*TREE_ROW_HEIGHT,paddingLeft:3+row.depth*16}} role={row.status==='error'?'alert':'status'}>{row.name}{row.status==='error'&&<button onClick={()=>retryDirectory(row.parent)}>重试</button>}</div> : <button key={row.path} role="treeitem" aria-expanded={row.folder?effectiveExpanded.includes(row.path):undefined} aria-selected={selected.includes(row.path)} aria-level={row.depth+1} aria-posinset={positions[row.path]?.pos} aria-setsize={positions[row.path]?.size} aria-describedby={tooltip?.path===row.path?'m9-tree-path-tooltip':undefined} data-path={row.path}
          tabIndex={focused===row.path||(!rowIndex.has(focused)&&navigable[0]?.path===row.path)?0:-1} className={'fw-tree-row fw-tree-virtual-row '+(activePath===row.path?'selected':'')} style={{top:index*TREE_ROW_HEIGHT,paddingLeft:3+row.depth*16}}
          onFocus={event=>{onFocusedChange(row.path);tooltipFor(event,row.path,true);}} onBlur={clearTooltip} onPointerEnter={event=>tooltipFor(event,row.path)} onPointerMove={event=>{if(event.target.closest('.fw-git-state'))clearTooltip();}} onPointerLeave={event=>{if(!event.relatedTarget?.closest?.('.fw-path-tooltip'))clearTooltip();}} onPointerDown={clearTooltip} onClick={event=>select(event,row)} onDoubleClick={()=>!row.folder&&onOpen(row.path,true)} draggable={!row.folder} onDragStart={event=>{clearTooltip();onDrag(event,row.path);}} onDragEnd={onDragEnd}
          onKeyDown={event=>{if(composing(event))return;if((event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))&&!row.folder){event.preventDefault();const box=event.currentTarget.getBoundingClientRect();onMenu(row.path,{x:box.left,y:box.bottom});}if(event.key==='Enter'){event.preventDefault();row.folder?toggle(row.path):onOpen(row.path,true);}}}
          onContextMenu={event=>{if(row.folder)return;event.preventDefault();clearTooltip();onMenu(row.path,{x:event.clientX,y:event.clientY});}}>
          {row.folder?(effectiveExpanded.includes(row.path)?<ChevronDown size={13}/>:<ChevronRight size={13}/>):<span className="fw-tree-spacer"/>}{!row.folder&&renderIcon(row.path)}<span className="fw-tree-name">{query&&row.indices?.length?row.name.split('').map((c,i)=><span key={i} className={row.indices.includes(i)?'fw-fuzzy-hit':''}>{c}</span>):row.name}</span>{!row.folder&&CHANGED[row.path]&&<small className="fw-git-state" aria-label="Git 状态示例">{CHANGED[row.path]}</small>}
        </button>)}
      </div>
      {!query.trim()&&cache['']?.state==='loading'&&<p className="fw-no-results" role="status">正在读取目录…</p>}
      {!query.trim()&&cache['']?.state==='error'&&<p role="alert">无法读取目录 <button onClick={()=>retryDirectory('')}>重试</button></p>}
      {query.trim()&&search.state==='loading'&&<p className="fw-no-results" role="status">正在筛选文件…</p>}
      {query.trim()&&search.state==='error'&&<p className="fw-no-results" role="alert">{search.error}<button onClick={()=>setSearchAttempt(v=>v+1)}>重试</button></p>}
      {!rows.length&&(query.trim()?search.state==='ready':cache['']?.state==='ready')&&<p className="fw-no-results">{query.trim()?'未找到匹配的文件':'此目录为空'}</p>}
    </div>
    {(query.trim()||rootExpanded)&&sticky.length>0&&<div className="fw-sticky-folders" aria-label="当前目录层级">{sticky.map(row=><button key={row.path} className="fw-tree-row" tabIndex={-1} onClick={()=>focusPath(row.path)} style={{paddingLeft:3+row.depth*16}}><ChevronDown size={13}/><span>{row.name}</span></button>)}</div>}
    {tooltip&&<div id="m9-tree-path-tooltip" className="fw-path-tooltip" role="tooltip" style={{left:tooltip.x,top:tooltip.y}} onPointerLeave={clearTooltip} onPointerDown={event=>event.stopPropagation()}>{rootPath}/{tooltip.path}</div>}
  </div>;
}
