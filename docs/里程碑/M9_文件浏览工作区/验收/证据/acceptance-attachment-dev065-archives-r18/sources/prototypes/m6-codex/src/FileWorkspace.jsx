import FileHtmlPreview from './FileHtmlPreview';
import { prototypeAttachmentFile, attachmentExamples } from './file-attachment-presentation.mjs';
import { isNonLocalFileSource, NONLOCAL_WORKSPACE_MESSAGE } from '../../../src/shared/file-source-boundary.mjs';
import FileMcpViewer from './FileMcpViewer';
import FileLanguageTools, { LANGUAGE_ACTIONS } from './FileLanguageTools';
import { FILE_DRAG_TYPE, beginFileDrag, endFileDrag } from './file-drag-model.mjs';
import { composing as imeComposing } from './file-ime.mjs';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { File, FileCode2, FileText, FileSearch, FolderOpen, Folder, ChevronDown, ChevronRight, X, Plus, Search, PanelRight, Maximize2, Minimize2, Code2, Copy, ExternalLink, Check, AlertCircle, RotateCcw, Save, Download, Sun, Moon, Settings2, MoreHorizontal, Undo2, Redo2, WrapText, TextSelect, Image, FileSpreadsheet, FileSliders, Play, Pause, ZoomIn, ZoomOut, ArrowLeft, ArrowRight, Pin } from 'lucide-react';
import { treeSetInfo, FILES, FILE_BY_PATH, SAMPLE_MD, fileKey, initialWorkspace, openFile, closeFile, restoreFile, treeRows, directoryChildren, treeKeyboardIntent, searchTreeRows, migratePrototypeSaved, openDocument, readRootView, updateRootView } from './file-workspace-model.mjs';
import iconMap from './m9-icon-map.json';
import { FileArtifactPreview } from './FileArtifactPreview';
import { createOfficeDocument, serializeOffice } from './file-office-model.mjs';
import { FileMarkdown } from './FileMarkdown';
import { localFind } from './file-markdown-model.mjs';
import { normalizeReference, formatReference, pasteData, referenceStaleness, selectionLineRange, textFingerprint, REF_LIMITS } from './file-reference-model.mjs';
import { workspaceScope, searchFiles, serializeWorkspaceStore, documentKey, fileScenario, setFileScenario, editDraft, commitDraft, acceptDisk, captureSelection, selectionIsCurrent, applyExternalFileChange, queueSyntheticFile, refreshSyntheticDirectory, artifactModel, updateArtifactCell, updateArtifactSlide } from './file-workspace-model.mjs';
import { FileWorkspaceTree } from './FileWorkspaceTree';
import { FileCodeTextarea, FilePrototypeBlame } from './FileCodeTextarea';
import { createFixtureFileProvider, largeDirectoryFixture, latestRequestGate } from './file-interaction-model.mjs';
import { MISSING_PROTOTYPE_APPLICATION, prototypeApplicationChoices, prototypeOpenApplication, prototypeRevealTarget } from './file-actions-model.mjs';
import { normalizeSearchHistory, readSearchHistories, writeSearchHistory } from './file-search-history-model.mjs';
import './file-workspace.css';
const LARGE_FILES = largeDirectoryFixture();
const STORAGE = 'willyou-m9-prototype-v1';
const load = () => {
  try {
    const saved=JSON.parse(localStorage.getItem(STORAGE)) || {};
    return {...saved,saved:migratePrototypeSaved(saved.saved)};
  } catch {
    return {};
  }
};
const isText = f => ['code', 'markdown', 'html', 'svg', 'large'].includes(f?.kind);
function Icon({
  file,
  size = 16
}) {
  const path = typeof file === 'string' ? file : file?.path || '';
  const name = path.split('/').pop().toLowerCase();
  const ext = name.split('.').slice(1);
  let type = iconMap.fileNameTokens[name];
  for (let i = 0; !type && i < ext.length; i++) {
    const suffix = ext.slice(i).join('.');
    type = iconMap.completeExtensionOverrides[suffix] || iconMap.extensionTokens[suffix];
  }
  type = type || iconMap.defaultType;
  const colors = iconMap.palette[iconMap.colorRoles[type]];
  return <svg className="fw-file-icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{
    '--file-light': colors?.light || 'currentColor',
    '--file-dark': colors?.dark || 'currentColor'
  }}><use href={iconMap.spriteUrl + '#' + iconMap.idPrefix + type} /></svg>;
}
const Button = ({
  icon: C,
  label,
  onClick,
  active,
  disabled
}) => <button className={'fw-icon ' + (active ? 'active' : '')} title={label} aria-label={label} onClick={onClick} disabled={disabled}><C size={17} strokeWidth={1.65} /></button>;
function ContentSearch({
  onClose,
  onOpen,
  scope,
  searchScenario = 'ready',
  files = FILES
}) {
  const loadHistory = () => normalizeSearchHistory(readSearchHistories(localStorage).find(item => item.scope === scope));
  const [query, setQuery] = useState(''),
    [mask, setMask] = useState(''),
    [selected, setSelected] = useState(0),
    [history, setHistory] = useState(loadHistory);
  const [hits, setHits] = useState([]),
    [busy, setBusy] = useState(false),
    [spinner, setSpinner] = useState(false),
    [error, setError] = useState(''), [capped,setCapped]=useState(false), [attempt,setAttempt]=useState(0);
  const provider=useMemo(()=>createFixtureFileProvider(files),[files]), gate=useRef(latestRequestGate());
  const input = useRef(null),
    historyIndex = useRef(-1),
    historyDraft = useRef(''), resultsRef = useRef(null);
  useEffect(() => {
    setHistory(loadHistory()); historyIndex.current = -1; historyDraft.current = '';
    setQuery(''); setMask(''); setSelected(0);
  }, [scope]);
  useEffect(()=>{resultsRef.current?.querySelector('[aria-selected=true]')?.scrollIntoView({block:'nearest'});},[selected]);
  const remember = (rememberQuery = false) => {
    const next = {
      queries: rememberQuery && query ? [query, ...history.queries.filter(x => x !== query)].slice(0, 30) : history.queries,
      masks: mask.trim() ? [mask.trim(), ...history.masks.filter(x => x !== mask.trim())].slice(0, 20) : history.masks
    };
    setHistory(next);
    try {
      writeSearchHistory(localStorage, scope, next);
    } catch {
      setError('原型搜索历史未能保存。');
    }
  };
  useEffect(() => {
    const token=gate.current.start(scope+':'+query+':'+mask);
    setHits([]);setError('');setCapped(false);setSelected(0);setSpinner(false);
    if(!query.trim()){setBusy(false);return()=>gate.current.cancel();}
    setBusy(true);
    const spin=setTimeout(()=>{if(gate.current.accepts(token))setSpinner(true);},500);
    const work=setTimeout(()=>provider.content(query,mask,{signal:token.signal,mode:searchScenario==='error'&&attempt>0?'ready':searchScenario,onChunk:batch=>{if(gate.current.accepts(token))setHits(old=>[...old,...batch]);}}).then(result=>{
      if(gate.current.accepts(token)){setHits(result.hits);setCapped(result.capped);}
    }).catch(error=>{if(gate.current.accepts(token))setError(error.message);}).finally(()=>{
      if(gate.current.accepts(token)){setBusy(false);setSpinner(false);clearTimeout(spin);}
    }),50);
    return()=>{gate.current.cancel();clearTimeout(work);clearTimeout(spin);};
  },[provider,query,mask,scope,searchScenario,attempt]);
  const pick = r => {
    if (!r || busy) return;
    remember(true);
    onOpen(r.path, query, r.number, r.column);
  };
  const keydown = e => {
    if (imeComposing(e)) return;
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
    if (e.key === 'ArrowUp' && e.target === input.current && (selected === 0 || !hits.length)) {
      e.preventDefault();
      if (historyIndex.current === -1) historyDraft.current = query;
      if (historyIndex.current + 1 < history.queries.length) setQuery(history.queries[++historyIndex.current]);
      return;
    }
    if (e.key === 'ArrowDown' && e.target === input.current && historyIndex.current >= 0) {
      e.preventDefault();
      historyIndex.current--;
      setQuery(historyIndex.current < 0 ? historyDraft.current : history.queries[historyIndex.current]);
      return;
    }
    if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
      e.preventDefault();
      setSelected(i => Math.max(0, Math.min(hits.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))));
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      pick(hits[selected]);
    }
  };
  return <div className="fw-modal-scrim" onClick={onClose}><section className="fw-dialog fw-search-dialog" role="dialog" aria-modal="true" aria-label="在文件中搜索" onClick={e => e.stopPropagation()} onKeyDown={keydown}>
    <div className="fw-find"><Search size={18} /><input ref={input} aria-label="搜索文件内容" autoFocus maxLength={256} placeholder="搜索所有文件中的文本…" value={query} onChange={e => {
          setQuery(e.target.value);
          setSelected(0);
          historyIndex.current = -1;
        }} /><Button icon={X} label="关闭内容搜索" onClick={onClose} /></div>
    <div className="fw-search-mask"><label>文件范围<input aria-label="文件范围" list="m9-file-masks" maxLength={256} value={mask} onChange={e => setMask(e.target.value)} onKeyDown={e => {
            if(imeComposing(e))return;
            if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) e.stopPropagation();
            if (e.key === 'Enter') {
              remember();
              input.current?.focus();
            }
          }} placeholder="*.ts" /><datalist id="m9-file-masks">{history.masks.map(m => <option key={m} value={m} />)}</datalist></label><span>{spinner ? '搜索中…' : hits.length + ' 条匹配'}{capped ? '（仅显示前100行）' : ''}</span></div>
    <div className="fw-search-results" ref={resultsRef} role="listbox" aria-label="搜索结果" aria-busy={busy}>{hits.map((r, i) => <button key={r.path + ':' + r.number} role="option" aria-selected={selected === i} onMouseEnter={() => setSelected(i)} onClick={() => pick(r)}><code>{r.line.slice(0, r.column - 1)}<mark>{r.line.slice(r.column - 1, r.column - 1 + query.length)}</mark>{r.line.slice(r.column - 1 + query.length)}</code><span title={r.path}><Icon file={r.path} />{r.path}<small>:{r.number}:{r.column}</small></span></button>)}{error && <p role="alert">{error}<button onClick={()=>setAttempt(v=>v+1)}>重试搜索</button></p>}{query && !hits.length && !busy && !error && <p>没有匹配内容</p>}{!query && <p>搜索当前目录中的文件内容；↑ 可访问本目录的查询历史。</p>}</div>
    <small>↑↓ 选择 · Enter 打开 · Esc 关闭。原型以可取消的异步批次搜索合成文件；不是实际 rg 后端。</small>
  </section></div>;
}
function Media({
  kind,
  name,
  onCopy,
  onDownload
}) {
  const [playing, setPlaying] = useState(false),
    [position, setPosition] = useState(0),
    [speed, setSpeed] = useState(1),
    [muted, setMuted] = useState(false),
    [volume, setVolume] = useState(.75),
    [expanded, setExpanded] = useState(false),
    [pip, setPip] = useState(false),
    [menu, setMenu] = useState(false),
    [volumeOpen, setVolumeOpen] = useState(false);
  const resume = useRef(false);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => setPosition(p => {
      if (p >= 20) {
        setPlaying(false);
        return 20;
      }
      return Math.min(20, p + .1 * speed);
    }), 100);
    return () => clearInterval(timer);
  }, [playing, speed]);
  const toggle = () => {
    if (position >= 20) setPosition(0);
    setPlaying(p => !p);
  };
  const release = () => {
    if (resume.current) setPlaying(true);
    resume.current = false;
  };
  const time = n => Math.floor(n / 60) + ':' + String(Math.floor(n % 60)).padStart(2, '0');
  return <div className={'fw-media ' + (expanded ? 'fw-media-expanded' : '') + (pip ? ' fw-media-pip' : '')}>
  {kind === 'video' ? <div className="fw-video-frame" tabIndex={0} aria-label="视频画面" onKeyDown={e => {
      if (!e.nativeEvent.isComposing && e.keyCode !== 229 && [' ', 'Enter'].includes(e.key)) {
        e.preventDefault();
        if (!e.repeat) toggle();
      }
    }}><img src="/assets/app-icon.png" alt="WillYou 演示画面" /><h2>文件工作区</h2><p>媒体控件交互示例</p></div> : <strong>{name} · WAV</strong>}
  <div className="fw-media-bar"><Button icon={playing ? Pause : Play} label={playing ? '暂停' : '播放'} onClick={toggle} /><input aria-label="播放进度" type="range" min={0} max={20} step={.1} value={position} onPointerDown={() => {
        resume.current = playing;
        setPlaying(false);
      }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onChange={e => setPosition(+e.target.value)} /><span>{time(position)} / {time(20)}</span>
  {kind === 'video' && <><button aria-label="视频音量" aria-expanded={volumeOpen} onClick={() => setVolumeOpen(!volumeOpen)}>{muted ? '静音中' : '声音'}</button>{volumeOpen && <span className="fw-volume"><button aria-label={muted ? '取消静音' : '静音'} onClick={() => setMuted(!muted)}>{muted ? '取消静音' : '静音'}</button><input aria-label="音量" type="range" min={0} max={1} step={.01} value={muted ? 0 : volume} onChange={e => {
            setVolume(+e.target.value);
            setMuted(false);
          }} /></span>}<button onClick={() => setPip(!pip)}>{pip ? '退出画中画' : '画中画（模拟）'}</button><Button icon={expanded ? Minimize2 : Maximize2} label={expanded ? '退出全屏示例' : '全屏示例'} onClick={() => setExpanded(!expanded)} /></>}
  <Button icon={MoreHorizontal} label="媒体菜单" onClick={() => setMenu(!menu)} /></div>
  {menu && <div className="fw-media-options">{kind === 'audio' && <button onClick={() => {
        onCopy();
        setMenu(false);
      }}>复制路径</button>}<button onClick={() => {
        onDownload();
        setMenu(false);
      }}>{kind === 'video' ? '视频另存为' : '另存副本'}</button>{kind === 'video' && <label>播放速度 <select aria-label="播放速度" value={speed} onChange={e => setSpeed(+e.target.value)}>{[.25, .5, .75, 1, 1.25, 1.5, 1.75, 2].map(v => <option key={v} value={v}>{v}×</option>)}</select></label>}</div>}
  <small>模拟时间轴和控件；不播放真实文件。系统全屏、画中画可用性与 codec 尚未验证。</small></div>;
}
export function FileWorkspace(props) {
  // Historical/foreign task identities never select the synthetic local tree.
  // Keep the source state untouched; switching back to a local task is reversible.
  if (isNonLocalFileSource(props.task) || isNonLocalFileSource(props.project)) return <section className="file-workspace" aria-label="文件工作区"><div className="fw-empty" role="alert"><AlertCircle size={20}/><p>{NONLOCAL_WORKSPACE_MESSAGE}</p><p>项目的服务器配置仍可用于已有终端功能。</p><button onClick={props.onClose}>关闭文件工作区</button></div></section>;
  return <LocalFileWorkspace {...props}/>;
}
function LocalFileWorkspace({
  task,
  project,
  dark,
  onTheme,
  onClose
}) {
  const [store, setStore] = useState(load),
    [query, setQueryLocal] = useState(''),
    [menu, setMenuState] = useState(null),
    [confirm, setConfirm] = useState(null),
    [demo, setDemo] = useState(false),
    [attachmentExample, setAttachmentExample] = useState('plain'),
    [full, setFull] = useState(false),
    [searchMode, setSearchMode] = useState(false),
    [status, setStatus] = useState(''),
    [auto, setAuto] = useState(true),
    [find, setFind] = useState(''),
    [findIndex, setFindIndex] = useState(0),
    [focusedPath, setFocusedPathLocal] = useState('AGENTS.md'),
    [searchCollapsed, setSearchCollapsed] = useState([]),
    [appsState, setAppsState] = useState('ready'),
    [appsScenario, setAppsScenario] = useState('ready'),
    [appsAttempt, setAppsAttempt] = useState(0),
    [rememberApp, setRememberApp] = useState(false),
    [treeDataset, setTreeDataset] = useState('normal'),
    [searchScenario, setSearchScenario] = useState('ready'),
    [workspaceConflict, setWorkspaceConflict] = useState(null),
    [rootScenario, setRootScenario] = useState('multiple'),
    [finding, setFinding] = useState(false),
    [context, setContext] = useState(''),
    [rich, setRich] = useState(null),
    [dock, setDock] = useState('right'),
    [contentSearch, setContentSearch] = useState(false),
    [wrap, setWrap] = useState(false),
    [selection, setSelection] = useState(null),
    [aiState, setAiState] = useState(null),
    [refs, setRefs] = useState([]), [refOptions, setRefOptions] = useState({ includeText: true, style: 'plain' }), [refPreview, setRefPreview] = useState(false), [refBusy, setRefBusy] = useState(false),
    [terminalBracketed, setTerminalBracketed] = useState(false),
    [composing, setComposing] = useState(false),
    [selectedRows, setSelectedRowsLocal] = useState([]),
    [reveal, setReveal] = useState(null),
    [imageOverlay, setImageOverlay] = useState(false),
    [changedOnly, setChangedOnly] = useState(false),
    [hideGenerated, setHideGenerated] = useState(false),
    [blame, setBlame] = useState(false),
    [extension, setExtension] = useState(false),
    [symbol, setSymbol] = useState(null);
  const roots = rootScenario==='none'?[]:[{
    id: 'main',
    hostId: task.hostId || 'local',
    label: project.name || 'WillYou',
    path: task.cwd || project.path || '/workspace/SmartDD'
  }, ...(rootScenario==='single'?[]:[{
    id: 'extra',
    hostId: task.hostId || 'local',
    label: '共享文档',
    path: rootScenario==='nested' ? (task.cwd || project.path || '/workspace/SmartDD')+'/docs' : '/workspace/shared-docs'
  }])];
  const scope = workspaceScope(task.id, roots);
  const createState=()=>roots.length?initialWorkspace():{...initialWorkspace(),tabs:[],active:null};
  const state = store[scope] || createState(),
    set = fn => setStore(old => {
      const previous=old[scope]||createState();
      const next=typeof fn==='function'?fn(previous):fn;
      return {...old,[scope]:next.expanded!==previous.expanded?updateRootView(next,{expanded:next.expanded}):next};
    });
  function dragFile(event, rootId, path, allowTabReorder = false) {
    const selectedRoot = roots.find(root => root.id === rootId), source = getFile(rootId, path);
    if (!selectedRoot || !source || source.kind === 'missing' || ['missing', 'root-missing'].includes(fileScenario(state, fileKey(rootId, path)))) {
      if (!allowTabReorder) event.preventDefault();
      endFileDrag(); note(allowTabReorder ? '文件已删除或目录不可用，仅可调整标签顺序，不能投递路径。' : '文件已删除或目录不可用，未开始拖放。'); return;
    }
    const result = beginFileDrag({ taskId: task.id, rootPath: selectedRoot.path, relativePath: path });
    if (!result.ok) { if (!allowTabReorder) event.preventDefault(); note('文件路径含不支持的字符，不能投递路径。'); return; }
    event.dataTransfer.setData(FILE_DRAG_TYPE, result.token);
    event.dataTransfer.effectAllowed = 'copyMove';
  }
  function finishFileDrag() { endFileDrag(); dragged.current = null; }
  function filesForRoot(id=state.root) {
    const defaults=rootScenario==='nested'&&id==='extra'?FILES.filter(f=>f.path.startsWith('docs/')).map(f=>({...f,path:f.path.slice(5)})):FILES;
    return treeDataset==='empty'?[]:[...defaults, ...(treeDataset==='large'?LARGE_FILES:[]), ...(state.syntheticFiles?.[id] || [])];
  }
  const activeFiles = useMemo(()=>filesForRoot(),[rootScenario,state.root,state.syntheticFiles,treeDataset]);
  const treeSourceKey = scope + ':' + state.root + ':' + treeDataset + ':' + (state.syntheticFiles?.[state.root]?.length || 0);
  function getFile(id,path) {return filesForRoot(id).find(f=>f.path===path);}
  function setQuery(value) {const next=typeof value==='function'?value(query):value;setQueryLocal(next);set(s=>updateRootView(s,{query:next}));}
  function setSelectedRows(value) {const next=typeof value==='function'?value(selectedRows):value;setSelectedRowsLocal(next);set(s=>updateRootView(s,{selected:next}));}
  function setFocusedPath(value) {setFocusedPathLocal(value);set(s=>updateRootView(s,{focused:value}));}
  const current = state.tabs.find(t => fileKey(t.root, t.path) === state.active),
    file = prototypeAttachmentFile(getFile(current?.root,current?.path), current?.attachment),
    draft = state.drafts[state.active],
    identity = documentKey(roots, state.active),
    revision = state.revisions?.[state.active] || 0,
    text = draft?.text ?? store.saved?.[identity] ?? file?.text ?? '',
    scenario = fileScenario(state),
    mode = state.mode[state.active] || (!current?.attachment && /\.(?:csv|tsv|html?|tex)$/i.test(current?.path || '') ? 'source' : 'render');
  const editor = useRef(null),
    filter = useRef(null),
    host = useRef(null),
    compose = useRef(false),
    dragged = useRef(null),
    timer = useRef(null),
    historyRef = useRef({}),
    anchor = useRef(null), menuRef = useRef(null), triggerRef = useRef(null), pointerRef = useRef(null), treeRef = useRef(null), treeApiRef = useRef(null);
  const root = roots.find(r => r.id === state.root) || roots[0] || {id:'none',path:'',label:'无工作目录',hostId:'local'},
    activeRoot = roots.find(r => r.id === current?.root) || root;
  const effective = scenario === 'ready' ? file?.kind : scenario;
  function setMenu(next) {
    if (!next) { setMenuState(null); if(triggerRef.current?.isConnected)triggerRef.current.focus({preventScroll:true}); return; }
    if (next.type === 'external' && menu?.type !== 'external') setRememberApp(false);
    if (!menu) triggerRef.current = document.activeElement;
    const target = document.activeElement?.getBoundingClientRect();
    const location = next.point || (pointerRef.current && performance.now()-pointerRef.current.time<400 ? pointerRef.current : { x:target?.left||0, y:target?.bottom||0 });
    setMenuState({...next, root:next.root || (next.type==='file'?state.root:current?.root||state.root), point:location});
  }
  useLayoutEffect(() => {
    if(!menu || !menuRef.current) return;
    const el=menuRef.current, r=el.getBoundingClientRect();
    el.style.left=Math.max(8,Math.min(menu.point.x,innerWidth-r.width-8))+'px';
    el.style.top=Math.max(8,Math.min(menu.point.y,innerHeight-r.height-8))+'px';
    if(!el.contains(document.activeElement)||document.activeElement?.disabled)el.querySelector('button:not(:disabled)')?.focus();
  },[menu,appsState]);
  useEffect(()=>{
    if(!['file','external'].includes(menu?.type))return;
    if(appsScenario==='unavailable'){setAppsState('unavailable');return;}
    setAppsState('loading');
    if(appsScenario==='loading')return;
    const timer=setTimeout(()=>setAppsState(appsScenario==='error'&&appsAttempt===0?'error':'ready'),160);
    return()=>clearTimeout(timer);
  },[menu?.type,menu?.path,menu?.root,appsScenario,appsAttempt]);
  const menuRoot=roots.find(r=>r.id===menu?.root)||activeRoot;
  const applications = prototypeApplicationChoices(store.fileOpener);
  const modalActive=!!(confirm||contentSearch||aiState);
  useEffect(() => {
    if(!modalActive)return;
    const previous=document.activeElement, dialog=host.current?.querySelector('[role=dialog]');
    if(!dialog)return;
    dialog.querySelector('input,textarea,button')?.focus();
    const trap=e=>{
      if(e.key!=='Tab')return;
      const items=[...dialog.querySelectorAll('input:not(:disabled),textarea:not(:disabled),button:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
      if(!items.length)return;
      const index=items.indexOf(document.activeElement);
      if((e.shiftKey&&index<=0)||(!e.shiftKey&&index===items.length-1)){e.preventDefault();items[e.shiftKey?items.length-1:0].focus();}
    };
    dialog.addEventListener('keydown',trap);
    return()=>{dialog.removeEventListener('keydown',trap);if(previous?.isConnected)previous.focus();};
  },[modalActive,contentSearch,confirm?.type,aiState?.phase]);
  function changeRoot(id) {
    const next=readRootView(state,id);
    set(s=>({...s,root:id,expanded:next.expanded,rootStates:{...s.rootStates,[s.root]:{expanded:s.expanded,selected:selectedRows,query,focused:focusedPath,scrollTop:treeRef.current?.scrollTop||0}}}));
    setQueryLocal(next.query);setSelectedRowsLocal(next.selected);setFocusedPathLocal(next.focused);anchor.current=null;
    requestAnimationFrame(()=>{if(treeRef.current)treeRef.current.scrollTop=next.scrollTop;});
  }
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE, JSON.stringify(serializeWorkspaceStore(store)));
    } catch {
      setStatus('原型存储已满；当前页内容仍保留。');
    }
  }, [store]);
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!reveal || !editor.current) return;
    const offset = text.split('\n').slice(0, reveal.number - 1).join('\n').length + (reveal.number > 1 ? 1 : 0) + Math.max(0, (reveal.column || 1) - 1);
    editor.current.focus();
    editor.current.setSelectionRange(offset, offset + reveal.query.length);
    editor.current.scrollTop = Math.max(0, (reveal.number - 3) * 21);
    setReveal(null);
  }, [reveal, text, mode]);
  useLayoutEffect(() => {
    const view=readRootView(state);
    setQueryLocal(view.query);setSelectedRowsLocal(view.selected);setFocusedPathLocal(view.focused);
    setMenuState(null);setRich(null);anchor.current=null;setSearchCollapsed([]);
    const frame=requestAnimationFrame(()=>{if(treeRef.current)treeRef.current.scrollTop=view.scrollTop;});
    return()=>cancelAnimationFrame(frame);
  }, [scope]);
  useEffect(() => {
    setSelection(null);
    setAiState(null);
  }, [identity, revision]);
  function scenarioText(value, label) {
    if(['xlsx','pptx'].includes(file?.kind)) {
      const doc=createOfficeDocument(file.kind,value);
      if(file.kind==='xlsx')doc.sheets[0].cells[0][0]=label;
      else {doc.slides[0].title+=' · '+label;const title=doc.slides[0].elements.find(e=>e.kind==='text');if(title)title.text+=' · '+label;}
      return serializeOffice(doc);
    }
    return value + '\n' + label;
  }
  function setScenario(value, key = state.active) {
    const diskText = value === 'conflict' ? scenarioText(store.saved?.[documentKey(roots, key)] ?? getFile(key?.split('\u0000')[0],key?.split('\u0000')[1])?.text ?? '', '外部更新') : undefined;
    set(s => setFileScenario(s, key, value, diskText));
  }
  function note(message) {
    setStatus(message);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setStatus(''), 3500);
  }
  function openApplication(appId, remember = false, rootId = menu?.root || current?.root, path = menu?.path ?? current?.path) {
    const targetRoot = roots.find(candidate => candidate.id === rootId);
    const missing = !targetRoot || !path || ['missing', 'root-missing'].includes(fileScenario(state, fileKey(rootId, path)));
    const result = prototypeOpenApplication(store.fileOpener, appId, remember, { available: appsState === 'ready', missing });
    if (!result.ok) note(result.error);
    else {
      if (remember) setStore(previous => ({ ...previous, fileOpener: result.preference }));
      note(`${result.app.name}：原型模拟打开 ${targetRoot.path}/${path}；未启动外部应用。`);
    }
    setMenu(null);
  }
  function revealTarget(rootId, path = '', directory = false) {
    const targetRoot = roots.find(candidate => candidate.id === rootId);
    const result = prototypeRevealTarget(targetRoot?.path, path, { directory, missing: ['missing', 'root-missing'].includes(fileScenario(state, fileKey(rootId, path))) });
    note(result.ok ? `文件管理器（模拟）：显示 ${result.parent}；定位 ${result.selected}${directory ? '（目录）' : ''}。未启动 Finder。` : result.error);
    setMenu(null);
  }
  function open(path, pin = false, rootId = state.root) {
    set(s => { const next=openDocument(s, roots, rootId, path, pin);const ancestors=path.split('/').slice(0,-1).map((_,i)=>path.split('/').slice(0,i+1).join('/'));return {...next,expanded:[...new Set([...next.expanded,...ancestors])]}; });
    setRich(null);
    setMenu(null);
  }
  function save(key = state.active, override = false) {
    if (state.tabs.find(t => fileKey(t.root, t.path) === key)?.attachment) { note('本机附件为只读，可通过来源下载或另存副本。'); return false; }
    if (fileScenario(state,key) === 'input-interrupted') { note('输入已中断，请返回编辑器继续输入或撤销后再保存'); return false; }
    if (!state.drafts[key]) return true;
    const outcome = commitDraft({
      ...store,
      [scope]: state
    }, scope, roots, key, {
      override
    });
    if (outcome.result === 'conflict') {
      setStore(old => commitDraft(old, scope, roots, key, {
        override
      }).store);
      setConfirm({
        type: 'conflict',
        key
      });
      return;
    }
    if (outcome.result === 'save-error') {
      note('保存失败：文件不可写。修改仍保留，可重试或另存为。');
      return;
    }
    if (outcome.result !== 'saved') return false;
    setStore(old => commitDraft(old, scope, roots, key, {
      override
    }).store);
    note('已保存到原型示例数据');
    return true;
  }
  useEffect(() => {
    if (!auto || !draft || scenario !== 'ready' || composing) return;
    const id = setTimeout(() => save(), ['xlsx', 'pptx'].includes(file?.kind) ? 500 : 3000);
    return () => clearTimeout(id);
  }, [text, auto, scenario, state.active, scope, composing]);
  function edit(value, record = true) {
    if (current?.attachment) return;
    if (value === text) return;
    if (record) {
      const h = historyRef.current[identity] || {
        undo: [],
        redo: []
      };
      h.undo.push(text);
      h.redo = [];
      historyRef.current[identity] = h;
    }
    const key = state.active;
    set(s => editDraft(s, key, value, store.saved?.[identity] ?? file?.text ?? ''));
  }
  function undo(redo = false) {
    const h = historyRef.current[identity];
    if (!h) return;
    const from = redo ? h.redo : h.undo,
      to = redo ? h.undo : h.redo;
    if (!from.length) return;
    to.push(text);
    edit(from.pop(), false);
  }
  function switchMode() {
    if (draft && !save()) return;
    set(s => ({
      ...s,
      mode: {
        ...s.mode,
        [s.active]: mode === 'source' ? 'render' : 'source'
      }
    }));
    setRich(null);
  }
  function close(key, trigger) {
    const previousFocus = document.activeElement;
    const restoreFocus = trigger === previousFocus || Boolean(host.current?.contains(previousFocus));
    if (state.drafts[key]) {
      if (!save(key)) {
        setConfirm({
          type: 'close',
          key
        });
        return;
      }
    }
    set(s => closeFile(s, key));
    try { state.tabs.find(t => fileKey(t.root, t.path) === key)?.attachment?.onClose?.(); } catch { note('附件已关闭，但来源回调失败（原型模拟）。'); }
    if (restoreFocus) requestAnimationFrame(() => {
      if (previousFocus?.isConnected && previousFocus !== trigger) return;
      if (document.activeElement !== document.body && document.activeElement !== trigger) return;
      (host.current?.querySelector('[role="tab"][aria-selected="true"]') ?? host.current?.querySelector('[aria-label="查找并打开文件"]'))?.focus();
    });
  }
  function discard(key) {
    set(s => {
      const drafts = {
        ...s.drafts
      };
      delete drafts[key];
      return closeFile({
        ...s,
        drafts
      }, key);
    });
    setConfirm(null);
  }
  function reorder(key) {
    const source = dragged.current;
    if (!source || source === key) return;
    set(s => {
      const tabs = [...s.tabs],
        a = tabs.findIndex(t => fileKey(t.root, t.path) === source),
        b = tabs.findIndex(t => fileKey(t.root, t.path) === key);
      if (a < 0 || b < 0) return s;
      const [t] = tabs.splice(a, 1);
      tabs.splice(b, 0, {
        ...t,
        preview: false
      });
      return {
        ...s,
        tabs
      };
    });
  }
  function resize(e) {
    e.preventDefault();
    const start = e.clientX,
      w = state.width;
    const move = ev => set(s => ({
      ...s,
      tree: w + start - ev.clientX >= 100,
      width: Math.max(200, Math.min(host.current.clientWidth * .6, w + start - ev.clientX))
    }));
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }
  // ---- 文件/选区 → 终端输入（M9 GAP-07）。只“放入”输入，不回车；不调用模型；不解析终端输出。----
  const taskRunning = task?.status === 'running' && !task?.archived;
  const rangeText = (source, range) => source.split('\n').slice(range.startLine - 1, range.endLine).join('\n');
  function addRef(kind, { path, range, selection, noteText } = {}) {
    const selectedText = selection ? rangeText(selection.source, range) : '';
    const n = normalizeReference({ kind, relativePath: path, range, revision, selectedTextHash: selection ? textFingerprint(selectedText) : undefined, note: noteText });
    if (!n.ok) return note('无法添加引用：' + n.error);
    setRefs(list => list.some(x => x.ref.kind === n.ref.kind && x.ref.relativePath === n.ref.relativePath && JSON.stringify(x.ref.range) === JSON.stringify(n.ref.range)) ? list : [...list, { id: 'ref-' + Date.now() + '-' + list.length, ref: n.ref, selectedText }]);
    note('已加入终端引用（尚未放入终端）。');
  }
  const refCurrent = item => {
    const f = getFile(state.root, item.ref.relativePath); if (!f) return { missing: true };
    const active = current && current.path === item.ref.relativePath;
    return { revision: active ? revision : undefined, selectedTextHash: active && item.ref.range ? textFingerprint(rangeText(text, item.ref.range)) : undefined };
  };
  const refTexts = items => { const parts = []; for (const item of items) { const f = formatReference(item.ref, { style: refOptions.style, includeText: refOptions.includeText && item.ref.kind !== 'file', selectedText: item.selectedText }); if (!f.ok) return { ok: false, error: f.error }; parts.push(f.text); } return { ok: true, text: parts.join('\n\n') }; };
  const insertError = code => ({ 'task-not-running': '任务未运行，无法放入终端输入。', 'terminal-no-response': '插入结果未知，请先检查终端输入；内容已保留，不会自动重发。', 'too-large': '内容超过 ' + REF_LIMITS.maxTotalChars + ' 字符，请取消“包含所选文字”或减少引用。', empty: '没有可放入的内容。', 'pty-not-owned-by-task': '终端与当前任务不匹配，已拒绝。', 'no-terminal': '当前任务没有终端。' }[code] || '无法放入终端：' + code);
  async function sendToTerminal(textToSend) {
    const requestId = 'ins-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6); setRefBusy(true);
    const result = await new Promise(resolve => {
      const timer = setTimeout(() => { window.removeEventListener('m9:terminal-insert-result', handler); resolve({ ok: false, error: 'terminal-no-response' }); }, 1500);
      const handler = event => { if (event.detail?.requestId !== requestId) return; clearTimeout(timer); window.removeEventListener('m9:terminal-insert-result', handler); resolve(event.detail); };
      window.addEventListener('m9:terminal-insert-result', handler);
      window.dispatchEvent(new CustomEvent('m9:terminal-insert', { detail: { taskId: task.id, text: textToSend, requestId } }));
    });
    setRefBusy(false);
    if (!result.ok) { note(insertError(result.error)); return { ...result, requestId }; }
    note('已放入终端输入，未发送。' + (result.collapsed ? '此终端未启用括号粘贴，换行已折叠为空格。' : '') + (result.sanitized ? ' 已移除不安全的控制字符。' : '') + '请在终端检查后按 Enter。');
    return { ...result, requestId };
  }
  async function insertRefs() {
    if (!refs.length || refBusy) return;
    const built = refTexts(refs); if (!built.ok) return note(insertError(built.error));
    const result = await sendToTerminal(built.text); if (result.ok) setRefs([]);
  }
  async function requestCliEdit() {
    if (!aiState || refBusy) return;
    const request = aiState, sel = request.selection;
    if (!selectionIsCurrent(sel, { scope, identity, revision, text })) return note('文件或选区已变化，请重新选择。');
    const range = selectionLineRange(sel.source, sel.start, sel.end); if (!range) return note('选区无效。');
    const item = { ref: { kind: 'range', relativePath: current.path, range, revision, selectedTextHash: textFingerprint(rangeText(sel.source, range)), note: request.instruction.trim() }, selectedText: rangeText(sel.source, range) };
    const built = refTexts([item]); if (!built.ok) return note(insertError(built.error));
    const result = await sendToTerminal(built.text);
    // Handoff ends at insertion. Closing this draft cannot stop or undo terminal work.
    if (result.ok) setAiState(current => current === request ? null : current);
  }
  function simulateExternalChange() {
    if (!current || !file || !isText(file)) return;
    const disk = store.saved?.[identity] ?? file.text ?? '';
    const changed = scenarioText(disk, '独立外部更新示例');
    delete historyRef.current[identity];
    setStore(old => applyExternalFileChange({ ...old, [scope]: old[scope] || state }, scope, roots, state.active, changed));
    note(draft ? '检测到示例外部更新；未保存的手工草稿已保留，请处理普通文件冲突。' : '示例文件已刷新到最新内容。此操作不关联任何终端请求。');
  }
  function simulateDirectoryAddition() {
    const count = (state.syntheticFiles?.[state.root]?.length || 0) + (state.pendingFiles?.[state.root]?.length || 0) + 1;
    const file = { path: 'external-update-' + count + '.md', kind: 'markdown', text: '# 外部新增文件示例\n\n这是独立的合成目录更新，不来自终端执行。\n' };
    set(s => queueSyntheticFile(s, s.root, file));
    note('已模拟外部新增 ' + file.path + '；刷新示例目录后可见。未访问真实磁盘。');
  }
  function refreshDirectory() {
    set(s => refreshSyntheticDirectory(s, s.root));
    note('示例目录已刷新。正式应用将读取磁盘并监听变化；此页仅演示合成数据。');
  }
  async function copy(value) {
    try {
      await navigator.clipboard.writeText(value);
      note('已复制路径');
    } catch {
      setContext(value);
      note('复制权限不可用，路径已显示在下方供选择。');
    }
    setMenu(null);
  }
  function download(path, rootId = current?.root || state.root) {
    const callback = state.tabs.find(t => t.root === rootId && t.path === path)?.attachment?.onDownload;
    if (callback) { callback(); setMenu(null); return; }
    const item = getFile(rootId,path);
    if(!item)return note('示例目录中没有该文件。');
    const key = fileKey(rootId, path);
    const blob = new Blob([state.drafts[key]?.text ?? store.saved?.[documentKey(roots, key)] ?? item.text], {
      type: 'text/plain'
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = path.split('/').pop() + (isText(item) ? '' : '.preview.txt');
    a.click();
    URL.revokeObjectURL(a.href);
    setMenu(null);
    note(isText(item) ? '已下载原型示例内容' : '已下载交互示例文本，不是实际文档文件');
  }
  function keys(e) {
    if (compose.current || imeComposing(e) || e.defaultPrevented) return;
    if (e.target.closest('[role=dialog], [role=menu]')) { if(e.key==='Escape'){e.stopPropagation();setMenu(null);setConfirm(null);setAiState(null);setContentSearch(false);} return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f' && !rich && isText(file) && !e.target.closest('input,select')) {
      e.preventDefault();
      e.stopPropagation();setFinding(true);
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      set(s => restoreFile(s));
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase()==='g' && finding){e.preventDefault();navigateFind(e.shiftKey?-1:1);}
    if(e.key==='F3'&&finding){e.preventDefault();navigateFind(e.shiftKey?-1:1);}
    if (e.key === 'Escape') {
      setMenu(null);
      setFinding(false);
      setConfirm(null);
    }
  }
  useEffect(() => { window.dispatchEvent(new CustomEvent('m9:terminal-config', { detail: { taskId: task.id, bracketed: terminalBracketed } })); }, [task.id, terminalBracketed]);
  useEffect(() => () => endFileDrag(), [scope, state.root]);
  const searchWasOpen=useRef(false);
  useEffect(()=>{ // 全文搜索关闭后：若焦点已丢到 body（Esc/点遮罩），回到工具栏触发按钮；打开结果时不抢编辑器焦点
    if(searchWasOpen.current&&!contentSearch)requestAnimationFrame(()=>{if(!document.activeElement||document.activeElement===document.body)document.querySelector('[aria-label="在文件中搜索"]')?.focus();});
    searchWasOpen.current=contentSearch;
  },[contentSearch]);
  const findResults=localFind(text,find);
  function navigateFind(delta){
    if(!findResults.matches.length)return;
    const next=(findIndex+delta+findResults.matches.length)%findResults.matches.length;setFindIndex(next);
    const hit=findResults.matches[next], line=text.slice(0,hit.from).split('\n').length;
    if(editor.current){editor.current.setSelectionRange(hit.from,hit.to);editor.current.scrollTop=Math.max(0,(line-3)*21);}
    else host.current?.querySelector('[data-md-line="'+line+'"]')?.scrollIntoView({block:'center'});
  }
  return <aside ref={host} className={'file-workspace ' + (full ? 'fw-full' : '') + (dock === 'bottom' ? ' fw-bottom' : '')} aria-label="M9 文件工作区原型" onKeyDown={keys} onPointerDownCapture={e=>{pointerRef.current={x:e.clientX,y:e.clientY,time:performance.now()};}}>
  <div className="fw-tabs" role="tablist" aria-label="文件标签" onKeyDown={e=>{if(imeComposing(e)||!e.target.matches('[role=tab]'))return;const tabs=[...e.currentTarget.querySelectorAll('[role=tab]')],i=tabs.indexOf(e.target);if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next]?.click();tabs[next]?.focus();}}}>{state.tabs.map(t => {
        const key = fileKey(t.root, t.path);
        return <div key={key} className={'fw-tab ' + (key === state.active ? 'selected ' : '') + (t.preview ? 'preview' : '')} draggable onDragStart={e => { dragged.current = key; e.dataTransfer.setData('application/x-willyou-prototype-tab', key); dragFile(e, t.root, t.path, true); }} onDragEnd={finishFileDrag} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); reorder(key); }} onContextMenu={e => {
          e.preventDefault();
          setMenu({
            type: 'tab',
            key
          });
        }}><button role="tab" tabIndex={key===state.active?0:-1} aria-selected={key === state.active} onClick={() => {
            set(s => ({
              ...s,
              active: key
            }));
            setRich(null);
          }} onDoubleClick={() => open(t.path, true, t.root)} title={roots.find(r => r.id === t.root)?.path + '/' + t.path}><Icon file={t.path} /><span>{key===state.active&&rich?'格式演示 · '+rich.toUpperCase():t.path.split('/').pop()}</span>{state.drafts[key] && <span className="fw-dirty" aria-label="未保存" />}</button><button className="fw-tab-close" aria-label={'关闭 ' + t.path} onMouseDown={event => { if (event.button === 0) event.preventDefault(); }} onClick={event => close(key, event.currentTarget)}><X size={14} /></button></div>;
      })}<Button icon={Plus} label="查找并打开文件" onClick={() => {
        set(s => ({
          ...s,
          tree: true
        }));
        requestAnimationFrame(()=>filter.current?.focus());
      }} /><span className="fw-push" /><Button icon={full ? Minimize2 : Maximize2} label={full ? '退出文件聚焦' : '聚焦文件工作区'} onClick={() => setFull(!full)} /><Button icon={PanelRight} label="隐藏文件工作区" onClick={onClose} /></div>
  <div className="fw-toolbar"><div className="fw-breadcrumb">{(rich?['会话产物查看器演示',rich.toUpperCase()]:[activeRoot.label, ...(current?.path.split('/') || [])]).map((part, i, arr) => <span key={i}><button title={activeRoot.path + '/' + arr.slice(1, i + 1).join('/')} className={i === arr.length - 1 ? 'current' : ''} disabled={!!rich} onClick={() => setMenu(menu?.type === 'crumb' ? null : {
            type: 'crumb',
            prefix: i===arr.length-1 && current ? current.path.split('/').slice(0,-1).join('/') : arr.slice(1, i + 1).join('/'),
            root: current?.root || state.root
          })}>{part}</button>{i < arr.length - 1 && <ChevronRight size={13} />}</span>)}</div><div className="fw-tools"><Button icon={FileSearch} label="在文件中搜索" active={searchMode} onClick={() => setContentSearch(true)} />{!rich && file && ['markdown', 'svg', 'html', 'tex'].includes(file.kind) && <Button icon={Code2} label={mode === 'source' ? file.kind === 'svg' ? '查看图像' : file.kind === 'tex' ? '编译并查看 PDF' : '查看文档' : '查看源码'} active={mode === 'source'} onClick={switchMode} />}{!rich && /\.(?:csv|tsv)$/i.test(current?.path || '') && <Button icon={Code2} label={mode === 'source' ? '查看表格' : '查看源码'} active={mode === 'source'} onClick={switchMode} />}<Button icon={MoreHorizontal} label="文件查看选项" onClick={() => setMenu({
          type: 'viewer'
        })} /><Button icon={FolderOpen} label="切换文件目录" active={state.tree} onClick={() => set(s => ({
          ...s,
          tree: !s.tree
        }))} /><div className="fw-open-button"><button aria-label={applications.preferred ? `使用 ${applications.preferred.name} 打开（原型模拟）` : "打开文件（原型模拟）"} title={applications.preferredUnavailable ? "首选应用不可用，请选择打开方式" : "打开文件（原型模拟）"} disabled={!current || appsState!=='ready' || !applications.preferred} onClick={()=>openApplication(applications.preferred?.id, false, current?.root, current?.path)}><ExternalLink size={14} /><span>打开</span></button><button aria-label="打开方式" onClick={() => setMenu(menu?.type === 'external' ? null : {
          type: 'external'
        })}><ChevronDown size={12} /></button></div></div></div>
  <div className="fw-body"><section className="fw-content" aria-label="文件内容">
   {current?.attachment && <div className="fw-save-strip" role="status">本机附件为只读，仅在当前会话保留；关闭或重启后请从原来源重新打开。</div>}
   {finding && !rich && isText(file) && <div className="fw-find"><Search size={15}/><input autoFocus aria-label="查找当前文件" value={find} onChange={e=>{setFind(e.target.value);setFindIndex(0);}} onKeyDown={e=>{if(imeComposing(e))return;if(e.key==='Enter'){e.preventDefault();navigateFind(e.shiftKey?-1:1);}if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setFinding(false);editor.current?.focus();}}} placeholder="查找当前文件"/><button aria-label="上一个匹配" disabled={!findResults.matches.length} onClick={()=>navigateFind(-1)}><ArrowLeft size={14}/></button><button aria-label="下一个匹配" disabled={!findResults.matches.length} onClick={()=>navigateFind(1)}><ArrowRight size={14}/></button><span>{findResults.matches.length?Math.min(findIndex+1,findResults.matches.length):0} / {Math.min(999,findResults.matches.length)}{findResults.matches.length>999?'+':''}</span><Button icon={X} label="关闭查找" onClick={()=>{setFinding(false);editor.current?.focus();}}/></div>}

   {workspaceConflict?.scope === scope && <div role="alert" className="fw-save-strip"><AlertCircle size={15}/><span>另一窗口更新了标签；当前标签、选择与草稿已保留。保存当前窗口标签会采用此窗口的布局。</span><button onClick={() => { setWorkspaceConflict(null); note('已采用当前窗口的标签布局（原型模拟）；未保存任何文件内容。'); }}>保存当前窗口标签</button><button disabled={Object.keys(state.drafts).length > 0} onClick={() => { set(s => { const tabs = [...workspaceConflict.tabs, ...s.tabs.filter(t => t.preview && !workspaceConflict.tabs.some(remote => fileKey(remote.root,remote.path) === fileKey(t.root,t.path)))]; return { ...s, tabs, active: tabs.some(t => fileKey(t.root,t.path) === s.active) ? s.active : tabs[0] ? fileKey(tabs[0].root,tabs[0].path) : null }; }); setWorkspaceConflict(null); note('已读取另一窗口的标签顺序（原型模拟）；文件内容未改变。'); }}>读取最新标签</button></div>}
   {draft && <div className="fw-save-strip" role={scenario === 'input-interrupted' ? 'alert' : undefined}><span>{scenario === 'input-interrupted' ? '输入已中断，请返回编辑器继续输入或撤销后再保存' : scenario === 'save-error' ? '保存失败，修改已保留' : scenario === 'conflict' ? '文件已被外部修改' : '未保存的修改'}</span><button disabled={scenario === 'input-interrupted'} onClick={() => save()}>保存</button>{scenario === 'conflict' && <button onClick={() => setConfirm({
            type: 'conflict',
            key: state.active
          })}>查看差异</button>}</div>}
   {file && !rich && isText(file) && <div className="fw-editor-tools"><Button icon={Undo2} label="撤销" disabled={!historyRef.current[identity]?.undo.length} onClick={() => undo()} /><Button icon={Redo2} label="重做" disabled={!historyRef.current[identity]?.redo.length} onClick={() => undo(true)} /><Button icon={WrapText} label="自动换行" active={wrap} onClick={() => setWrap(!wrap)} /><Button icon={Copy} label="复制文件内容" onClick={() => copy(text)} /><span className="fw-push" /><button onClick={() => {
            setAiState({
              phase: 'request',
              selection,
              instruction: ''
            });
          }} disabled={!selection || file.kind === 'large'}>编辑所选文本</button></div>}

   <FileLanguageTools command={symbol} onCommand={setSymbol} path={current?.path} onOpen={path=>open(path,true)} />
   {extension ? <FileMcpViewer key={current?.path} name={current?.path?.split('/').pop()} text={text} onEdit={edit} onSave={override=>save(state.active,Boolean(override))} onScenario={setScenario} initialSettings={extension==='settings'} onDefault={()=>setExtension(false)} /> : !file ? <div className="fw-empty"><File size={30} /><p>选择文件以开始浏览</p><button onClick={() => set(s => restoreFile(s))} disabled={!state.closed.length}>重新打开关闭的文件</button></div> : effective === 'loading' ? <div className="fw-empty" aria-busy="true"><span className="fw-loading" />正在读取文件…<button onClick={() => setScenario('ready')}>完成加载（模拟）</button></div> : ['missing', 'unreadable', 'too-large', 'unsupported', 'root-missing'].includes(effective) ? <div className="fw-empty"><AlertCircle size={28} /><h2>{{
              missing: '文件不存在',
              unreadable: '无法读取文件',
              'too-large': '文件过大',
              unsupported: '不支持预览此文件',
              'root-missing': '工作目录不可用'
            }[effective]}</h2><p>{{
              missing: '文件可能已移动或删除。现有草稿会保留。',
              unreadable: '检查文件权限后重试。',
              'too-large': '此示例超过文本预览限制，请使用外部应用。',
              unsupported: '可以通过外部应用打开此文件。',
              'root-missing': '重新连接或更新项目目录后重试。'
            }[effective]}</p><button className="fw-pill" onClick={() => setScenario('ready')}><RotateCcw size={15} />重试</button><button onClick={() => setMenu({
            type: 'external'
          })}>使用外部应用打开</button></div> : rich ? <FileArtifactPreview path={current.path} onInsertContext={sendToTerminal} key={rich + state.active} kind={rich} readOnly onDownload={() => download(current.path)} /> : /\.(?:csv|tsv)$/i.test(current.path) && mode !== 'source' ? <FileArtifactPreview path={current.path} kind={current.path.split('.').at(-1).toLowerCase()} initialValue={text} readOnly /> : file.kind === 'svg' && mode !== 'source' ? <div className="fw-image"><img draggable onDragStart={e => dragFile(e, current.root, current.path)} onDragEnd={finishFileDrag} src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text)} alt="SVG 文件预览" /></div> : file.kind === 'html' && mode !== 'source' ? <FileHtmlPreview text={text} /> : file.kind === 'markdown' && mode !== 'source' ? <FileMarkdown key={identity + ':' + (state.reloads?.[state.active] || 0)} text={text} findQuery={finding?find:''} path={current.path} overlay={imageOverlay} readOnly={!!current?.attachment || scenario === 'conflict'} onEdit={edit} onSelect={(start,end) => setSelection(captureSelection({scope, identity, revision, text, start, end}))} onOpenFile={path => { const resolved = getFile(current.root,path) ? path : path.startsWith('assets/') ? 'resources/app-icon.png' : null; resolved ? open(resolved,true,current.root) : note('示例目录中没有该目标：'+path); }} onImageReference={image => setContext('图片引用（待发送）：' + image.alt + ' · ' + image.path)} onImageAction={note} onComposition={value => { compose.current=value; setComposing(value); }} /> : (['code', 'html', 'svg', 'large', 'markdown'].includes(file.kind) || file.kind === 'tex' && mode === 'source') ? <div className="fw-editor"><div className="fw-line-numbers" aria-hidden="true">{text.split('\n').map((_, i) => <div key={i}>{i + 1}</div>)}</div>{blame && <FilePrototypeBlame text={text} />}<FileCodeTextarea filename={current.path} ref={editor} aria-label="文件编辑器" spellCheck={false} value={text} readOnly={!!current?.attachment || file.kind === 'large'} onChange={e => edit(e.target.value)} style={{
            whiteSpace: wrap ? 'pre-wrap' : 'pre'
          }} onContextMenu={e => {
            e.preventDefault();
            setMenu({
              type: 'code'
            });
          }} onSelect={e => setSelection(captureSelection({
            scope: scope,
            identity,
            revision,
            text: e.currentTarget.value,
            start: e.currentTarget.selectionStart,
            end: e.currentTarget.selectionEnd
          }))} onCompositionStart={() => {
            compose.current = true;
            setComposing(true);
          }} onCompositionEnd={() => {
            compose.current = false;
            setComposing(false);
          }} />{file.kind === 'large' && <div className="fw-readonly">10–20 MiB 文本：只读预览示例</div>}</div> : file.kind === 'image' ? <div className="fw-image"><img draggable onDragStart={e => dragFile(e, current.root, current.path)} onDragEnd={finishFileDrag} src={file.text} alt={file.path} /></div> : ['audio', 'video'].includes(file.kind) ? <Media key={identity} kind={file.kind} name={file.path.split('/').pop()} onCopy={() => copy(activeRoot.path + '/' + current.path)} onDownload={() => download(current.path)} /> : <FileArtifactPreview path={current.path} onInsertContext={sendToTerminal} key={scope + ':' + identity + ':' + (state.reloads?.[state.active] || 0)} kind={file.kind} readOnly={!!current?.attachment || scenario==='conflict'} initialValue={text} onDraft={edit} onDownload={() => download(current.path)} />}
  </section>{state.tree && <><div className="fw-tree-resizer" role="separator" tabIndex={0} aria-label="调整目录宽度" aria-orientation="vertical" aria-valuenow={Math.round(state.width)} aria-valuemin={200} aria-valuemax={Math.max(200,Math.round((host.current?.clientWidth||1000)*.6))} onPointerDown={resize} onKeyDown={e => {
          if (['ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            set(s => ({
              ...s,
              width: Math.max(200, Math.min(Math.max(200,(host.current?.clientWidth||1000)*.6), s.width + (e.key === 'ArrowLeft' ? 10 : -10)))
            }));
          }
        }} /><aside className="fw-tree" style={{
          width: state.width
        }} aria-label="目录树"><label className="fw-filter"><Search size={14} /><input ref={filter} placeholder={searchMode ? '搜索文件内容…' : '筛选文件…'} aria-label="筛选文件" value={query} onChange={e => {setQuery(e.target.value);setSelectedRows([]);anchor.current=null;setSearchCollapsed([]);}} onKeyDown={e => {
              if(imeComposing(e))return;
              if (e.key === 'Escape') {
                e.stopPropagation();
                setQuery('');
              }
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                treeApiRef.current?.focusFirst();
              }
            }} />{query && <button aria-label="清除筛选" onClick={() => setQuery('')}><X size={13} /></button>}</label>{changedOnly && <label className="fw-generated"><input type="checkbox" checked={hideGenerated} onChange={e => setHideGenerated(e.target.checked)} />筛除生成文件 {hideGenerated ? "1" : ""}</label>}{roots.length>1&&<div className="fw-root"><button aria-label="选择工作目录" aria-haspopup="menu" onClick={()=>setMenu({type:'roots'})}><Folder size={14}/><span title={root.path}>{root.label}</span><ChevronDown size={12}/></button></div>}{!roots.length&&<p className="fw-no-results">当前任务没有可用工作目录。请在项目中配置目录。</p>}{roots.length>0&&<FileWorkspaceTree key={treeSourceKey} files={activeFiles} scope={treeSourceKey} rootPath={root.path} query={query} searchScenario={searchScenario} expanded={state.expanded} selected={selectedRows} focused={focusedPath} activePath={current?.root===state.root?current.path:null} scrollRef={treeRef} apiRef={treeApiRef} initialScrollTop={readRootView(state).scrollTop} onScrollPosition={scrollTop=>set(s=>updateRootView(s,{scrollTop}))} onExpandedChange={expanded=>set(s=>({...s,expanded}))} onSelectedChange={setSelectedRows} onFocusedChange={setFocusedPath} onOpen={(path,pin)=>open(path,pin)} onMenu={(path,point)=>setMenu({type:'file',path,root:state.root,point})} onDrag={(event,path)=>dragFile(event,state.root,path)} onDragEnd={finishFileDrag} changedOnly={changedOnly} hideGenerated={hideGenerated} large={treeDataset==='large'} renderIcon={path=><Icon file={path}/>} />}</aside></>}</div>
  {refs.length > 0 && (() => { const built = refTexts(refs); const preview = built.ok ? pasteData(built.text, { bracketedPaste: terminalBracketed }) : null; return <section className="fw-refs" aria-label="待放入终端的引用"><header><strong>终端引用（{refs.length}）</strong><span className="fw-push" />
    <label><input type="checkbox" checked={refOptions.includeText} onChange={e => setRefOptions(o => ({ ...o, includeText: e.target.checked }))} />包含所选文字（≤{REF_LIMITS.maxSelectedChars} 字符）</label>
    <label>格式<select aria-label="引用格式" value={refOptions.style} onChange={e => setRefOptions(o => ({ ...o, style: e.target.value }))}><option value="plain">通用：路径:L起-止</option><option value="at">@路径（需 CLI 支持，未验证）</option></select></label></header>
    <ul>{refs.map(item => { const st = referenceStaleness(item.ref, refCurrent(item)); const f = formatReference(item.ref, { style: refOptions.style }); return <li key={item.id}><File size={13} /><span title={item.ref.relativePath}>{f.ok ? f.text.split('\n')[0] : item.ref.relativePath}</span>{st === 'stale' && <em title="文件或所选内容在加入引用后已变化">位置可能已变</em>}{st === 'missing' && <em role="alert">文件不存在</em>}<button aria-label={'移除引用 ' + item.ref.relativePath} onClick={() => setRefs(list => list.filter(x => x.id !== item.id))}><X size={12} /></button></li>; })}</ul>
    {!built.ok && <p role="alert">{insertError(built.error)}</p>}
    {refPreview && preview && <div className="fw-refs-preview"><small>将放入终端的文本（{preview.mode === 'bracketed' ? '括号粘贴，换行保留' : '普通输入，换行折叠为空格'}）{preview.sanitized.changed ? ' · 已移除 ' + Object.values(preview.sanitized.removed).reduce((a, b) => a + b, 0) + ' 个不安全字符' : ''}</small><pre aria-label="将放入终端的文本">{preview.sanitized.text}</pre></div>}
    <div className="fw-refs-actions"><button onClick={() => setRefPreview(v => !v)}>{refPreview ? '隐藏预览' : '预览'}</button><button onClick={() => setRefs([])}>清空</button><button disabled={!built.ok || refBusy || !taskRunning} title={taskRunning ? '' : '任务未运行'} onClick={insertRefs}>放入终端输入（不发送）</button>{!taskRunning && <small role="status">任务未运行，无法放入终端输入。</small>}</div></section>; })()}
  <footer className="fw-footer"><button onClick={() => setDemo(!demo)}><Settings2 size={13} />M9 交互样例<ChevronDown size={12} /></button><span role="status">{status || '示例数据 · 未连接真实文件'}</span><span className="fw-push" />{current && <span>{current.preview ? '预览' : '已固定'} · UTF-8</span>}<Button icon={dark ? Sun : Moon} label="切换原型主题" onClick={onTheme} /></footer>
  {demo && <div className="fw-demo"><button onClick={() => {
    if (!roots.length) return;
    const example = attachmentExamples.find(item => item.id === attachmentExample) || attachmentExamples[0], {path,kind,text,mimeType} = example, rootId = state.root, attachment = { key: 'prototype-local-attachment:' + example.id, mimeType, onDownload: () => note('已调用附件来源下载回调（原型模拟），未读取或下载真实文件。'), onClose: () => note('已通知附件来源关闭（原型模拟）；此标签不会恢复。') };
    set(s => { const withFile = { ...s, syntheticFiles: { ...s.syntheticFiles, [rootId]: [...(s.syntheticFiles?.[rootId] || []).filter(f => f.path !== path), { path, kind, text }] } }; const opened = openFile(withFile, rootId, path, true); return { ...opened, tabs: opened.tabs.map(t => t.root === rootId && t.path === path ? { ...t, attachment } : t), mode: {...opened.mode, [fileKey(rootId,path)]: 'render'} }; });
  }}>模拟只读附件回调</button><label>附件样例<select aria-label="本机附件来源场景" value={attachmentExample} onChange={e=>setAttachmentExample(e.target.value)}>{attachmentExamples.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label><button onClick={() => setWorkspaceConflict({ scope, tabs: state.tabs.filter(t => !t.preview).reverse() })}>模拟标签持久化冲突</button><label>目录样例<select aria-label="工作目录场景" value={rootScenario} onChange={e=>setRootScenario(e.target.value)}><option value="multiple">多根</option><option value="single">单根</option><option value="nested">嵌套根</option><option value="none">无根</option></select></label><label>场景<select aria-label="文件状态场景" value={scenario} onChange={e => {
          if (['conflict', 'save-error', 'input-interrupted'].includes(e.target.value) && file) edit(scenarioText(text, e.target.value === 'input-interrupted' ? '未确认候选' : '本地修改'));
          setScenario(e.target.value);
        }}>{[['ready', '正常'], ['loading', '读取中'], ['conflict', '外部修改冲突'], ['save-error', '保存失败'], ['input-interrupted', '输入中断（模拟）'], ['missing', '已删除'], ['unreadable', '无读取权限'], ['too-large', '过大'], ['unsupported', '未知二进制'], ['root-missing', '根不可用']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} />自动保存（3秒）</label><button onClick={() => set(s => restoreFile(s))} disabled={!state.closed.length}><RotateCcw size={14} />恢复关闭标签</button><button onClick={() => setMenu({
        type: 'formats'
      })}>全部格式与入口</button><label>树数据<select aria-label="文件树数据场景" value={treeDataset} onChange={e=>{setTreeDataset(e.target.value);setQuery('');}}><option value="normal">普通样本</option><option value="large">6,000文件 / 懒加载</option><option value="empty">空目录</option></select></label><label>搜索服务<select aria-label="搜索服务场景" value={searchScenario} onChange={e=>setSearchScenario(e.target.value)}><option value="ready">正常异步</option><option value="slow">慢响应</option><option value="error">失败</option></select></label><label>外开能力<select aria-label="外部应用能力场景" value={appsScenario} onChange={e=>{setAppsScenario(e.target.value);setAppsAttempt(0);}}><option value="ready">可用</option><option value="loading">加载中</option><option value="error">读取失败</option><option value="unavailable">无能力</option></select></label><button onClick={() => { setStore(previous => ({ ...previous, fileOpener: MISSING_PROTOTYPE_APPLICATION })); setAppsScenario('ready'); setAppsState('ready'); }}>模拟首选应用不可用</button><label><input type="checkbox" checked={changedOnly} onChange={e => {
          setChangedOnly(e.target.checked);
          setQuery('');
        }} />变化文件上下文</label><label><input type="checkbox" checked={imageOverlay} onChange={e => setImageOverlay(e.target.checked)} />图片新叠层（模拟开关）</label><label><input type="checkbox" checked={terminalBracketed} onChange={e => setTerminalBracketed(e.target.checked)} />演示终端启用括号粘贴（多行引用）</label><button disabled={!current || !isText(file)} onClick={simulateExternalChange}>模拟外部修改当前文件</button><button disabled={!roots.length} onClick={simulateDirectoryAddition}>模拟外部新增文件</button><button disabled={!roots.length} onClick={refreshDirectory}>刷新示例目录</button><button onClick={() => note('原型状态已在本浏览器保存；刷新可检查恢复。')}>检查恢复</button></div>}
  {context && <div className="fw-context"><File size={14} /><span>{context}</span><Button icon={X} label="移除文件引用" onClick={() => setContext('')} /></div>}
  {contentSearch && <ContentSearch key={treeSourceKey} files={activeFiles} searchScenario={searchScenario} scope={JSON.stringify([root.hostId, [root.path]])} onClose={() => setContentSearch(false)} onOpen={(path, line, number, column) => {
      open(path, true);
      set(s => ({
        ...s,
        mode: {
          ...s.mode,
          [fileKey(state.root, path)]: 'source'
        }
      }));
      setFinding(true);
      setFind(line);
      setReveal({
        number,
        column,
        query: line
      });
      setContentSearch(false);
    }} />}
  {menu && <><div className="fw-dismiss" onClick={() => setMenu(null)} /><div ref={menuRef} className={'fw-menu fw-positioned-menu ' + (menu.type === 'formats' ? 'fw-format-menu' : '')} role="menu" aria-label="文件操作菜单" onKeyDown={e=>{e.stopPropagation();const items=[...e.currentTarget.querySelectorAll('button:not(:disabled)')],i=items.indexOf(document.activeElement);if(e.key==='Escape'||e.key==='Tab'){setMenu(null);if(e.key==='Escape')e.preventDefault();}if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus();}}}>
   {menu.type==='roots'&&<><strong>选择工作目录</strong>{roots.map(r=><button key={r.id} role="menuitemradio" aria-checked={state.root===r.id} title={r.path} onClick={()=>{changeRoot(r.id);setMenu(null);}}><Folder size={15}/><span>{r.label}</span><small>{r.path}</small>{state.root===r.id&&<Check size={14}/>}</button>)}</>}
   {menu.type === 'viewer' && <><strong>文件查看选项</strong><button onClick={() => {
            setWrap(!wrap);
            setMenu(null);
          }}>自动换行 {wrap ? '已开' : '已关'}</button><button onClick={() => {
            setBlame(!blame);
            setMenu(null);
          }}>只读行归属（示例）</button><button onClick={() => {
            setExtension(!extension);
            setMenu(null);
          }}>自动选择查看器（原型）</button><button onClick={()=>{setExtension(false);setMenu(null)}}>内置文件查看器</button><button onClick={()=>{setExtension('settings');setMenu(null)}}>管理扩展文件查看器…</button><button onClick={() => copy(activeRoot.path + '/' + current?.path)}>复制路径</button><button onClick={() => copy(text)}>复制文件内容</button><button disabled={!current} onClick={() => revealTarget(current?.root, current?.path)}>在 Finder 中显示</button></>}
   {menu.type === 'code' && <>{Object.entries(LANGUAGE_ACTIONS).map(([kind,label])=><button key={kind} onClick={()=>{setSymbol(kind);setMenu(null)}}>{kind==='references'?'查找':'转到'}{label}</button>)}<button onClick={()=>{setSymbol('settings');setMenu(null)}}>语言服务设置…</button><button disabled={!selection} onClick={() => {
            setAiState({
              phase: 'request',
              selection,
              instruction: ''
            });
            setMenu(null);
          }}>请 CLI 修改所选文本…</button><button disabled={!selection} onClick={() => { const range = selectionLineRange(selection.source, selection.start, selection.end); addRef('range', { path: current.path, range, selection }); setMenu(null); }}>添加所选内容到终端引用</button><button onClick={() => copy(selection?.text || text)}>复制</button></>}
   {menu.type === 'file' && <><strong>{menu.path.split('/').pop()}</strong><button disabled={appsState!=='ready' || !applications.preferred} onClick={()=>openApplication(applications.preferred?.id)}>{applications.preferred ? `使用 ${applications.preferred.name} 打开` : '首选应用不可用'}</button>{appsState==='loading'&&<small>正在读取可用应用…</small>}{appsState==='error'&&<><small role="alert">无法获取可用应用。输入和文件已保留。</small><button onClick={()=>setAppsAttempt(v=>v+1)}>重新读取应用列表</button></>}{appsState==='unavailable'&&<small>此宿主未提供外部应用能力。</small>}<button onClick={() => setMenu({
            type: 'external',
            path: menu.path, root:menu.root
          })}><ExternalLink size={15} />打开方式</button>{!menu.folder && <button disabled={appsState==='unavailable'} onClick={() => download(menu.path, menu.root)}><Download size={15} />另存为…</button>}<button onClick={() => copy(menuRoot.path + '/' + menu.path)}><Copy size={15} />复制路径</button><button onClick={() => revealTarget(menu.root, menu.path, Boolean(menu.folder))}><FolderOpen size={15} />在 Finder 中显示</button><button onClick={() => {
            addRef('file', { path: menu.path });
            setMenu(null);
          }}>添加到终端引用</button></>}
   {menu.type === 'tab' && <><button onClick={() => {
            set(s => ({
              ...s,
              tabs: s.tabs.map(t => fileKey(t.root, t.path) === menu.key ? {
                ...t,
                preview: false
              } : t)
            }));
            setMenu(null);
          }}><Pin size={15} />固定标签</button><button onClick={() => {
            close(menu.key);
            setMenu(null);
          }}>关闭标签</button><button onClick={() => {
            set(s => restoreFile(s));
            setMenu(null);
          }}>重新打开关闭的标签</button><button onClick={() => {
            setDock(dock === 'right' ? 'bottom' : 'right');
            setMenu(null);
          }}>{dock === 'right' ? '移到底部面板' : '移到右侧面板'}</button></>}
   {menu.type === 'crumb' && <><strong>{menu.prefix||activeRoot.label}</strong>{menu.prefix&&<button onClick={()=>setMenu({...menu,prefix:menu.prefix.split('/').slice(0,-1).join('/')})}><Folder size={15}/>上级目录</button>}{directoryChildren(filesForRoot(menu.root),menu.prefix).map(f=><button key={f.path} onClick={()=>f.folder?setMenu({...menu,prefix:f.path}):open(f.path,false,menu.root)}>{f.folder?<Folder size={15}/>:<Icon file={f}/>} {f.name}</button>)}{!directoryChildren(filesForRoot(menu.root),menu.prefix).length&&<p>此目录为空</p>}<hr/><button onClick={()=>copy(activeRoot.path+(menu.prefix?'/'+menu.prefix:''))}>复制目录路径</button><button onClick={()=>revealTarget(menu.root, menu.prefix, true)}>在文件管理器中显示</button></>}
   {menu.type === 'external' && <><strong>打开方式</strong>{appsState!=='ready'&&<p>{appsState==='loading'?'正在读取可用应用…':appsState==='error'?'读取应用失败':'此宿主未提供外部应用能力'}</p>}{appsState==='error'&&<button onClick={()=>setAppsAttempt(v=>v+1)}>重新读取应用列表</button>}{applications.preferredUnavailable && <p role="status">首选应用当前不可用，请选择其它应用。</p>}{applications.apps.map(app => <button disabled={appsState!=='ready'} key={app.id} onClick={() => openApplication(app.id, rememberApp)}><ExternalLink size={15} />{app.name}{app.systemDefault ? '（系统默认）' : ''}{applications.preferred?.id===app.id && <Check size={14}/>}</button>)}<hr/><button role="menuitemcheckbox" aria-checked={rememberApp} onClick={() => setRememberApp(value => !value)}>{rememberApp && <Check size={14}/>}记住选择的应用</button><button onClick={() => copy(menuRoot.path + '/' + (menu.path || current?.path || ''))}><Copy size={15} />复制路径</button></>}
   {menu.type === 'formats' && <><strong>文件类型 / 会话产物入口（模拟）</strong>{filesForRoot().map(f => <button key={f.path} onClick={() => open(f.path, true)}><Icon file={f} />{f.path}</button>)}<hr />{['csv', 'tsv', 'ipynb', 'tex', 'pdf', 'pdf-review', 'docx', 'xlsx', 'pptx'].map(kind => <button key={kind} onClick={() => {
            setRich(kind);
            setMenu(null);
          }}>以会话产物打开 {kind.toUpperCase()}</button>)}</>}
  </div></>}
  {aiState && <div className="fw-modal-scrim"><section className="fw-dialog" role="dialog" aria-modal="true" aria-label="请 CLI 修改所选文本"><h2>请 CLI 修改所选文本</h2><p>把“位置＋所选文字＋你的指令”放入终端输入，由你检查后按 Enter。CLI 按自身权限与指令操作文件，WillYou 不再审批。投递后即结束交接；取消这里只关闭指令草稿，不停止 CLI。此原型使用合成数据，不读写真实磁盘。</p><pre className="fw-ai-selection">{aiState.selection?.text}</pre><textarea aria-label="修改指令" className="fw-ai-prompt" placeholder="描述你希望 CLI 怎样修改…" value={aiState.instruction} onChange={e => setAiState(a => ({ ...a, instruction: e.target.value }))} />{!taskRunning && <p role="alert" className="fw-readonly">任务未运行，无法放入终端输入。</p>}<div className="fw-dialog-actions"><button onClick={() => setAiState(null)}>取消</button><button disabled={!aiState.instruction.trim() || !taskRunning || refBusy} onClick={requestCliEdit}>放入终端输入（不发送）</button></div></section></div>}
  {confirm && <div className="fw-modal-scrim"><section className="fw-dialog" role="dialog" aria-modal="true" aria-label={confirm.type === 'close' ? '保留未保存修改' : '文件修改冲突'}>{confirm.type === 'close' ? <><h2>仍有未保存的修改</h2><p>可以继续查看并保存，或者放弃此文件的修改。</p><div className="fw-dialog-actions"><button onClick={() => setConfirm(null)}>继续查看</button><button className="fw-danger" onClick={() => discard(confirm.key)}>放弃修改并关闭</button></div></> : <><h2>文件已在外部更改</h2><p>请核对本地草稿与磁盘版本。选择前不会覆盖任何一方。</p><div className="fw-conflict-columns"><div><strong>磁盘版本（模拟）</strong><pre>{state.fileStates?.[confirm.key]?.diskText ?? ''}</pre></div><div><strong>本地草稿</strong><pre>{state.drafts[confirm.key]?.text ?? ''}</pre></div></div><div className="fw-dialog-actions"><button onClick={() => setConfirm(null)}>继续编辑</button><button onClick={() => {
              const diskText = state.fileStates?.[confirm.key]?.diskText;
              if (diskText === undefined) {
                note('磁盘示例尚未读取，保留当前修改。');
                return;
              }
              const targetIdentity = documentKey(roots, confirm.key);
              delete historyRef.current[targetIdentity];
              setStore(old => ({
                ...old,
                [scope]: acceptDisk(old[scope] || state, confirm.key),
                saved: {
                  ...old.saved,
                  [targetIdentity]: diskText
                }
              }));
              setConfirm(null);
            }}>采用磁盘版本</button><button onClick={() => {
              save(confirm.key, true);
              setConfirm(null);
            }}>保留本地并保存</button></div></>}</section></div>}
 </aside>;
}
