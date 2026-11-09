import { DocxPages } from '../../../src/shared/DocxPages';
import { PPTX_STATIC_PREVIEW_NOTICE, XLSX_DRAWING_PREVIEW_NOTICE } from '../../../src/shared/office-preview-notices.mjs';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Download, Undo2, Redo2, List, Grid2X2, Plus, Type, Image, Table2, BarChart3, Shapes, SlidersHorizontal, MessageSquare, ChevronDown, X, Check, Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, Eye, EyeOff, Copy, Trash2 } from 'lucide-react';
import { cellAddress, selectionRange, rangeCells, officeCapabilities, createOfficeHistory, serializeOffice, editOffice, displayCell, cellValue, officeDirty, presentationShortcut,workbookDrawingModel } from './file-office-model.mjs';
import { createOfficeContexts, addOfficeContext, beginOfficeContexts, startOfficeContext, finishOfficeContext, officeContextResult, formatOfficeContext, deliverOfficeContext } from './file-office-context-model.mjs';
import './file-office.css';
import { FileOfficeFidelity } from './FileOfficeFidelity';
import { OFFICE_SIGNED_EDIT_WARNING } from '../../../src/renderer/features/files/office/fidelity-details';
import { SlideTable } from './SlideTable';
import { docxRoute as resolveDocxRoute } from '../../../src/shared/file-docx-route.mjs';
import { PptxImagePlacement } from '../../../src/shared/pptx-image-placement';
import {WORKBOOK_CHARTS,WORKBOOK_SHAPES} from '../../../src/shared/file-workbook-drawing';
import {WorkbookVector} from '../../../src/renderer/features/files/office/workbook-vector';
import {composing as imeComposing} from './file-ime.mjs';

const COLORS = ['#263d3a', '#14806e', '#c35b55', '#5779a8', '#b68538', '#ffffff'];
const SHAPES = ['rect', 'circle', 'triangle', 'diamond', 'star', 'arrow', 'left-arrow', 'plus', 'chevron', 'callout', 'line'];
const CHARTS = ['bar', 'line', 'pie', 'area', 'scatter', 'histogram', 'waterfall', 'funnel', 'treemap'];
const isInput = el => {
  if (el?.closest?.('input,textarea,select,[role="menu"],iframe,object,embed')) return true;
  const editable = el?.closest?.('[contenteditable]');
  return !!editable && (['', 'true', 'plaintext-only'].includes(editable.getAttribute('contenteditable').trim().toLowerCase()) || editable.isContentEditable);
};
function Tool({ icon: Icon, label, active, ...props }) { return <button type="button" className={'fo-tool ' + (active ? 'active' : '')} title={label} aria-label={label} aria-pressed={active === undefined ? undefined : active} {...props}>{Icon ? <Icon size={15} /> : label}</button>; }
function Field({ label, children }) { return <label className="fo-field"><span>{label}</span>{children}</label>; }

// Synthetic, self-contained Office workspace. onDraft is JSON, never Office bytes.
export function FileOfficePreview({ kind, path = `synthetic.${kind}`, readOnly = false, initialValue = '', onDraft = () => {}, onDownload = () => {}, hostOptions = {}, onStateChange, onInsertContext, onResourceRead, onArtifactSearch }) {
  const spreadsheet = ['xlsx', 'xlsm', 'csv', 'tsv'].includes(kind), presentation = kind === 'pptx';
  const sourceControlName = useId();
  const [history, setHistory] = useState(() => createOfficeHistory(kind, initialValue));
  const [generationTool, setGenerationTool] = useState(null), [generationTarget, setGenerationTarget] = useState(null), [generationDraft, setGenerationDraft] = useState(''), [generationSaved, setGenerationSaved] = useState(false);
  const [hostState, setHost] = useState(() => ({ sourceKind: 'static', sourceKey: path, isEditing: false, sourceState: 'live', hasLiveController: true, manualEditUiEnabled: false, artifactSearchEnabled: false, manualEditing: false, sourceBytes: true, canRead: true, canWrite: true, libraryFile: false, template: false, annotationsEnabled: false, docxRoute: 'popcorn', hasRedlines: true, redlinesEnabled: true, ...hostOptions }));
  // Retain the old route example as an initial preset. Actual routing consumes
  // the same independent capabilities and source identity as the file host.
  const documentHostFlag = typeof hostState.documentHostFlag === 'boolean' ? hostState.documentHostFlag : hostState.docxRoute === 'popcorn';
  const renderFlag = typeof hostState.renderFlag === 'boolean' ? hostState.renderFlag : hostState.docxRoute === 'popcorn';
  const host = kind === 'docx' ? { ...hostState, docxRoute: resolveDocxRoute({ importKind: kind, isAttachmentPreview: hostState.isAttachmentPreview === true, documentHostFlag, renderFlag, hostId: hostState.hostId ?? 'local-file' }) } : hostState;
  const caps = officeCapabilities(kind, { ...host, readOnly:readOnly||host.signed });
  const hostKey=JSON.stringify(hostOptions),sourceGeneration=JSON.stringify([path,host.sourceKind,host.sourceKey,host.sourceState,host.hasLiveController,host.isEditing,host.manualEditUiEnabled]);
  const currentSource=useRef(sourceGeneration);currentSource.current=sourceGeneration;
  useEffect(()=>{const replaces=(hostOptions.sourceKind!==undefined && hostOptions.sourceKind!==host.sourceKind)||(hostOptions.sourceKey!==undefined && hostOptions.sourceKey!==host.sourceKey);if(replaces && (officeDirty(latest.current)||editingCellRef.current||sheetTextDraft)){setNotice("来源未切换：请先保存或处理当前草稿。");return;}setHost(previous=>({...previous,...hostOptions}));},[hostKey]);
  const [sheetId, setSheetId] = useState(history.doc.sheets[0].id), [slideId, setSlideId] = useState(history.doc.slides[0].id);
  const [selection, setSelection] = useState({ row: 0, col: 0 }), [extent, setExtent] = useState({ row: 0, col: 0 });
  const [editingCell, setEditingCell] = useState(null), [cellInput, setCellInput] = useState('');
  const editingCellRef = useRef(editingCell); editingCellRef.current = editingCell;
  const [elementId, setElementId] = useState(null), [textEditing, setTextEditing] = useState(false);
  const [floatingId,setFloatingId]=useState(null);
  const [sheetTextTool,setSheetTextTool]=useState(null),[sheetTextDraft,setSheetTextDraft]=useState(null);const sheetTextComposing=useRef(false),sheetTextBlurred=useRef(false);
  const [zoom, setZoom] = useState(100), [grid, setGrid] = useState(false), [thumbs, setThumbs] = useState(true), [formatOpen, setFormatOpen] = useState(false);
  const [menu, setMenu] = useState(null), [rename, setRename] = useState(null), [request, setRequest] = useState(''), [review, setReview] = useState(false);
  const contextScope = kind + ':' + path;
  const [contexts, setContexts] = useState(() => createOfficeContexts(contextScope)), [commentAnchor, setCommentAnchor] = useState(null);
  const contextsRef = useRef(contexts), scopeRef = useRef(contextScope), mounted = useRef(true), requestRef = useRef(null);
  const contextGeneration = useRef({ scope: contextScope, value: 0 }), annotateRef = useRef(caps.annotate);
  if (contextGeneration.current.scope !== contextScope) contextGeneration.current = { scope: contextScope, value: contextGeneration.current.value + 1 };
  annotateRef.current = caps.annotate;
  scopeRef.current = contextScope;
  const [redlines, setRedlines] = useState(true), [docPage, setDocPage] = useState(0), [docked, setDocked] = useState(false), [notice, setNotice] = useState('');
  const [docxBytes,setDocxBytes]=useState(null),[docxError,setDocxError]=useState('');
  const docxPosition=useRef({page:1,zoom:100});
  useEffect(()=>{
    if(kind!=='docx'||host.docxRoute!=='legacy')return;
    const resource=docxBytes?{bytes:docxBytes,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',name:path.split('/').pop()}:null;
    const release=onResourceRead?.(resource);return()=>release?.();
  },[docxBytes,kind,host.docxRoute,path]);
  useEffect(()=>{
    if(kind!=='docx'||host.docxRoute!=='legacy')return;
    const abort=new AbortController();setDocxBytes(null);setDocxError('');
    const name=host.docxPageCount===1?'one-page-clean.docx':host.hasRedlines?'three-page-tracked.docx':'three-page-clean.docx';
    const hashes={'one-page-clean.docx':'b6fc58f1c1478c224bd7459314a2d3c0f0760719c445de3141c4081bfdb71da3','three-page-clean.docx':'aa31450a5b7d5f46bd137d0d441a506c935116644339d50d0a1adfcf4e6d5029','three-page-tracked.docx':'876c3ca9b38803006a4ad67bddbba8b390319d211390b66122c9de69e5a9d16b'};
    (async()=>{const response=await fetch('/assets/m9-docx/'+name,{signal:abort.signal});if(!response.ok)throw new Error('DOCX 示例读取失败');const bytes=new Uint8Array(await response.arrayBuffer());const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');abort.signal.throwIfAborted();if(hash!==hashes[name])throw new Error('DOCX 示例内容校验失败');docxPosition.current={page:1,zoom:100};setDocPage(0);setCommentAnchor(null);setDocxBytes(bytes);})().catch(error=>{if(!abort.signal.aborted)setDocxError(String(error));});
    return()=>abort.abort();
  },[kind,host.docxRoute,host.docxPageCount,host.hasRedlines]);
  const formulaRef = useRef(null), root = useRef(null), viewport = useRef(null), docNodes = useRef([]), dragSelection = useRef(null), sheetDrag = useRef(null), elementDrag = useRef(null), latest = useRef(history), draftCallback = useRef(onDraft);
  latest.current = history; draftCallback.current = onDraft;
  const doc = history.doc, sheet = doc.sheets.find(s => s.id === sheetId) || doc.sheets[0], slide = doc.slides.find(s => s.id === slideId) || doc.slides[0];
  const range = selectionRange(selection, extent), element = slide.elements.find(e => e.id === elementId), dirty = officeDirty(history);
  const generationHandoff = presentation && typeof onInsertContext === 'function' && !readOnly && !host.libraryFile && !host.template && host.canRead !== false && host.sourceBytes !== false && !host.interactionsDisabled;
  const generationEnabled = generationHandoff && caps.editable;
  const generationEnabledRef = useRef(generationHandoff); generationEnabledRef.current = generationHandoff;
  const generationCurrent = useRef(null); generationCurrent.current = { slideId: slide.id, elementId, enabled: generationEnabled };
  const generationValid = () => !!generationTarget && !generationTarget.invalidated && generationCurrent.current.enabled && sourceGeneration === currentSource.current && generationTarget.scope === sourceGeneration && latest.current.version === generationTarget.version && generationCurrent.current.slideId === generationTarget.slideId && generationCurrent.current.elementId === generationTarget.elementId;
  useEffect(()=>{if(generationTarget&&!generationTarget.invalidated&&!generationValid())setGenerationTarget(value=>value?{...value,invalidated:true}:value);},[generationTarget,elementId,slide.id,history.version,generationEnabled,sourceGeneration]);
  const activeStyle = sheet.formats[cellAddress(selection.row, selection.col)] || {};
  const floatingObject=spreadsheet ? sheet.objects.find(object=>object.id===floatingId) : null;
  useEffect(()=>{setFloatingId(null);},[sheet.id,path,sourceGeneration]);
  useEffect(()=>{if(floatingId&&!sheet.objects.some(object=>object.id===floatingId))setFloatingId(null);},[sheet.objects,floatingId]);
  useEffect(()=>{if(sheetTextTool&&(!caps.format||sheetTextTool.scope!==sourceGeneration||sheetTextTool.sheetId!==sheet.id||sheetTextTool.version!==history.version||sheetTextTool.zoom!==zoom))setSheetTextTool(null);},[sheetTextTool,caps.format,sourceGeneration,sheet.id,history.version,zoom]);
  const commit = action => {
    if (sourceGeneration !== currentSource.current) return;
    const previous = latest.current, next = editOffice(previous, action, caps);
    latest.current = next; setHistory(next);
    if (next.doc !== previous.doc) draftCallback.current(serializeOffice(next.doc));
    if (next.error) setNotice(next.error);
  };
  const previewDraft = action => { const next = editOffice(latest.current, action, caps); if (!next.error) draftCallback.current(serializeOffice(next.doc)); };
  const changeCellInput = value => { if(!caps.editable || floatingObject || sourceGeneration!==currentSource.current)return;setCellInput(value); if (editingCell) previewDraft({ type: 'cell', sheetId: sheet.id, ...editingCell, value }); };
  const updateElement = patch => commit({ type: 'element-update', slideId: slide.id, elementId, patch });
  const format = patch => {if(!floatingObject)commit({ type: 'format', sheetId: sheet.id, range, patch });};
  const runRange = (type, extra = {}) => { if(floatingObject)return;commit({ type, sheetId: sheet.id, range, ...extra }); setMenu(null); };
  const openMenu = (event, type, extra = {}) => { event.preventDefault(); event.stopPropagation(); if (type === 'element' && !slide.elements.some(item => item.id === extra.elementId)) { setMenu(null); return; } const rect = root.current.getBoundingClientRect(); setMenu({ type, x: Math.max(8, Math.min(event.clientX - rect.left, rect.width - 240)), y: Math.max(40, Math.min(event.clientY - rect.top, rect.height - 280)), ...extra }); };
  const fit = () => setZoom(Math.max(25, Math.min(100, ((viewport.current?.clientWidth || 720) - 40) / (presentation ? 680 : 620) * 100)));
  useEffect(() => { const end = () => { dragSelection.current = null; }; window.addEventListener('pointerup', end); return () => window.removeEventListener('pointerup', end); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const next = createOfficeContexts(contextScope); contextsRef.current = next; setContexts(next);
    setRequest(''); setCommentAnchor(null);
  }, [contextScope]);
  useEffect(() => { onStateChange?.({ dirty, version: history.version, canEdit: caps.editable, sourceState: host.sourceState, sourceKind:host.sourceKind, sourceKey:host.sourceKey, format: caps.format, artifactSearchEnabled:caps.search, error: history.error }); }, [dirty, history.version, caps.editable, caps.format, caps.search, host.sourceState, host.sourceKind, host.sourceKey, history.error, onStateChange]);
  useEffect(() => { if (!doc.sheets.some(s => s.id === sheetId)) { setSheetId(doc.sheets[0].id); setSelection({ row: 0, col: 0 }); setExtent({ row: 0, col: 0 }); } if (!doc.slides.some(s => s.id === slideId)) setSlideId(doc.slides[0].id); }, [doc, sheetId, slideId]);
  useEffect(() => { if (!caps.editable) { setTextEditing(false); setMenu(null); } if (!caps.format) setFormatOpen(false); if (!caps.annotate) setReview(false); }, [caps.editable, caps.format, caps.annotate]);
  const selectCell = (row, col, extend = false) => { if(sheetTextDraft&&!finishSheetText())return;setFloatingId(null);setSheetTextTool(null);if (!extend) setSelection({ row, col }); setExtent({ row, col }); };
  const primaryEnter = event => event.metaKey || event.ctrlKey && !/Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const beginCell = (row, col, initial, source = 'cell') => { if (!caps.editable || floatingObject) return; const same = row === selection.row && col === selection.col; if (!same) selectCell(row, col); const next = { row, col, source, range: same ? range : { r1: row, r2: row, c1: col, c2: col } }; editingCellRef.current = next; setEditingCell(next); setCellInput(initial ?? sheet.cells[row][col]); };
  const finishCell = (cancel = false, key, shift = false, fill = false) => {
    const active = editingCellRef.current; if (!active || !cancel && (!caps.editable || sourceGeneration!==currentSource.current)) return;
    // Focus restoration can synchronously blur the old input. Finish this
    // editing session once so Escape cannot be followed by a stale blur commit.
    editingCellRef.current = null;
    if (!cancel) commit(fill && active.source === 'cell' ? { type: 'input-range', sheetId: sheet.id, range: active.range, value: cellInput } : { type: 'cell', sheetId: sheet.id, ...active, value: cellInput }); else draftCallback.current(serializeOffice(latest.current.doc));
    const current = active; setEditingCell(null);
    if (key && key !== 'Escape' && !fill) selectCell(Math.min(sheet.cells.length - 1, Math.max(0, current.row + (key === 'ArrowUp' || key === 'Enter' && shift ? -1 : key === 'Enter' || key === 'ArrowDown' ? 1 : 0))), Math.min(sheet.cells[0].length - 1, Math.max(0, current.col + (key === 'ArrowLeft' || key === 'Tab' && shift ? -1 : key === 'Tab' || key === 'ArrowRight' ? 1 : 0))));
    if (active.source !== 'formula' || cancel) root.current?.focus({ preventScroll: true });
  };
  const selectFloating=object=>{
    if(sheetTextDraft&&sheetTextDraft.id!==object.id&&!finishSheetText())return;
    if(editingCellRef.current){finishCell();if(latest.current.error)return;}
    dragSelection.current=null;setMenu(null);setFormatOpen(false);setFloatingId(object.id);
  };
  const finishSheetText=(cancel=false)=>{
    if(!sheetTextDraft)return true;if(sheetTextComposing.current)return false;
    if(cancel){draftCallback.current(serializeOffice(latest.current.doc));setSheetTextDraft(null);return true;}
    if(!caps.format||sourceGeneration!==currentSource.current)return false;
    commit({type:'sheet-object-text',sheetId:sheetTextDraft.sheetId,objectId:sheetTextDraft.id,text:sheetTextDraft.text});if(latest.current.error)return false;setSheetTextDraft(null);return true;
  };
  const insertWorkbookObject=(objectKind,extra={})=>{
    if(!caps.format||sourceGeneration!==currentSource.current||!finishSheetText())return;
    if(editingCellRef.current){finishCell();if(latest.current.error)return;}
    commit({type:'insert-sheet-object',sheetId:sheet.id,kind:objectKind,range,...extra});if(latest.current.error)return;
    const added=latest.current.doc.sheets.find(s=>s.id===sheet.id).objects.at(-1);setFloatingId(added.id);setMenu(null);setFormatOpen(false);setSheetTextTool(null);
    if(objectKind==='text')setSheetTextDraft({id:added.id,sheetId:sheet.id,text:added.text,frame:added.frame});
  };
  const startWorkbookText=()=>{
    if(!caps.format||!finishSheetText())return;if(editingCellRef.current){finishCell();if(latest.current.error)return;}
    const area=viewport.current;setFloatingId(null);setSheetTextTool({scope:sourceGeneration,sheetId:sheet.id,version:latest.current.version,zoom,scrollX:area.scrollLeft,scrollY:area.scrollTop,width:Math.max(1,area.clientWidth-36*zoom/100),height:Math.max(1,area.clientHeight-27*zoom/100)});
  };
  const navigateSheet=id=>{if(!finishSheetText())return;if(editingCellRef.current)finishCell();setSheetId(id);setFloatingId(null);setSheetTextTool(null);setSelection({row:0,col:0});setExtent({row:0,col:0});setEditingCell(null);};
  const captureGeneration = added => { setGenerationTarget({ id: crypto.randomUUID(), scope: sourceGeneration, version: latest.current.version, slideId: slide.id, elementId: added.id, kind: added.kind }); setGenerationSaved(false); };
  const addElement = (type, extra) => { if(type==='chart'&&generationTarget&&generationDraft.trim()){setNotice('请先加入或取消当前描述。');return;}commit({ type: 'element-insert', slideId: slide.id, kind: type, ...extra }); const added = latest.current.doc.slides.find(s => s.id === slide.id)?.elements.at(-1); setElementId(added?.id); setFormatOpen(true); if(type==='chart'&&generationEnabled&&added)captureGeneration(added); };
  const placeGeneration = frame => { const tool=generationTool;setGenerationTool(null);if(!tool||!generationEnabled||tool.scope!==currentSource.current||tool.slideId!==generationCurrent.current.slideId||tool.version!==latest.current.version)return;commit({type:'image-placeholder',slideId:slide.id,frame});if(latest.current.error)return;const added=latest.current.doc.slides.find(s=>s.id===slide.id).elements.at(-1);setElementId(added.id);captureGeneration(added); };
  const queueGeneration = () => {if(!generationValid()||!generationSaved||!generationDraft.trim())return;const page=latest.current.doc.slides.findIndex(s=>s.id===generationTarget.slideId)+1;const next=addOfficeContext(contextsRef.current,{body:generationDraft,page,elementId:generationTarget.elementId,purpose:'generation'});if(next===contextsRef.current)return;contextsRef.current=next;setContexts(next);setGenerationTarget(null);setGenerationDraft('');setReview(true);setNotice('描述和目标已加入请求；预览后可插入终端，不自动回车。');};
  const addSlide = () => { commit({ type: 'slide-add' }); setSlideId(latest.current.doc.slides.at(-1).id); setElementId(null); setGrid(false); };
  const navigateSlide = id => { setSlideId(id); setElementId(null); setTextEditing(false); setMenu(null); };
  const addComment = () => {
    const page = presentation ? doc.slides.indexOf(slide) + 1 : docPage + 1;
    const next = addOfficeContext(contextsRef.current, { body: request, page,
      selectedText: presentation ? element?.text || '' : commentAnchor?.page === page ? commentAnchor.selectedText : '',
      elementId: presentation ? element?.id || null : null });
    if (next === contextsRef.current) return;
    contextsRef.current = next; setContexts(next); setRequest(''); requestRef.current?.focus();
  };
  async function insertComments() {
    if (!caps.annotate && !generationHandoff) return;
    const pending = beginOfficeContexts(contextsRef.current);
    if (pending === contextsRef.current) return;
    const permitted = pending.pendingIds.filter(id => pending.requests.find(item => item.id === id)?.purpose === 'generation' ? generationHandoff : caps.annotate);
    if (!permitted.length) return;
    const batch = { ...pending, pendingIds: permitted };
    const generation = contextGeneration.current.value;
    contextsRef.current = batch; setContexts(batch);
    setNotice('正在插入评论上下文，不会自动回车。');
    for (const id of batch.pendingIds) {
      if (!mounted.current || scopeRef.current !== batch.scope || contextGeneration.current.value !== generation || contextsRef.current.operation !== batch.operation) return;
      const item = batch.requests.find(value => value.id === id);
      if (item.purpose === 'generation' ? !generationEnabledRef.current : !annotateRef.current) { const paused = { ...contextsRef.current, phase: 'idle', pendingIds: [] }; contextsRef.current = paused; setContexts(paused); return; }
      const inserting = startOfficeContext(contextsRef.current, batch.operation, id);
      contextsRef.current = inserting; setContexts(inserting);
      const result = await deliverOfficeContext(onInsertContext, formatOfficeContext(path, item), {
        source: 'office-comment', kind, path, commentId: id, page: item.page,
        selectedText: item.selectedText, elementId: item.elementId
      });
      if (!mounted.current || scopeRef.current !== batch.scope || contextGeneration.current.value !== generation || contextsRef.current.operation !== batch.operation) return;
      const status = officeContextResult(result), next = finishOfficeContext(contextsRef.current, batch.scope, batch.operation, id, status);
      contextsRef.current = next; setContexts(next);
      setNotice(status === 'inserted' ? '评论上下文已插入终端输入，未回车；不代表 CLI 已读取或执行，Office 原文未修改。' : next.error);
      if (status !== 'inserted') break;
    }
  }
  const keyboard = event => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    const input = isInput(event.target);
    if (event.key === 'Escape') {
      if(spreadsheet&&floatingObject){event.preventDefault();event.stopPropagation();setFloatingId(null);root.current?.focus({preventScroll:true});return;}
      setMenu(null); setTextEditing(false);
      if (spreadsheet && (menu || formatOpen)) { setFormatOpen(false); return; }
      if (spreadsheet && (selection.row !== extent.row || selection.col !== extent.col)) { setExtent({ ...selection }); return; }
      if (request.trim() && review) { setNotice('请先添加或清空评论草稿。'); return; }
      setReview(false); return;
    }
    if (presentation) {
      const command = presentationShortcut({ ...event, key: event.key, code: event.code, ctrlKey: event.ctrlKey, metaKey: event.metaKey, altKey: event.altKey, shiftKey: event.shiftKey, repeat: event.repeat, defaultPrevented: event.defaultPrevented, editableTarget: input || textEditing, isComposing: event.nativeEvent.isComposing });
      if (command) { event.preventDefault(); event.stopPropagation(); if (command === 'grid') { setGrid(v => !v); requestAnimationFrame(() => root.current?.focus({ preventScroll: true })); } else if (command === 'fit') fit(); else if (command === 'actual') setZoom(100); else setZoom(z => Math.max(25, Math.min(500, z + (command === 'zoom-in' ? 10 : -10)))); return; }
    }
    if (input) return;
    if(spreadsheet&&floatingObject&&!((event.ctrlKey||event.metaKey)&&['s','z'].includes(event.key.toLowerCase()))){event.preventDefault();event.stopPropagation();return;}
    if (presentation && element && caps.editable && !event.repeat && !event.defaultPrevented && event.metaKey !== event.ctrlKey && event.shiftKey && ['f', 'b'].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation(); const forward = event.key.toLowerCase() === 'f';
      commit({ type: 'element-layer', slideId: slide.id, elementId, direction: event.altKey ? (forward ? 'forward' : 'backward') : (forward ? 'front' : 'back') }); return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && caps.editable) { event.preventDefault(); commit({ type: event.shiftKey ? 'redo' : 'undo' }); return; }
    if ((event.key === '/' || event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      if (caps.editable) { event.preventDefault(); setFormatOpen(caps.format); const rect = root.current.getBoundingClientRect(); openMenu({ preventDefault() {}, stopPropagation() {}, clientX: rect.left + 70, clientY: rect.top + 120 }, spreadsheet ? 'cells' : 'element', { elementId }); } return;
    }
    if (spreadsheet) {
      if (event.key === 'Enter' && primaryEnter(event) && caps.editable) { event.preventDefault(); if (!event.repeat) commit({ type: 'input-range', sheetId: sheet.id, range, value: sheet.cells[selection.row][selection.col] }); return; }
      const delta = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0], Tab: [0, event.shiftKey ? -1 : 1], Enter: [1, 0] }[event.key];
      if (delta && !event.metaKey && !event.ctrlKey && !event.altKey) { event.preventDefault(); const next = { row: Math.min(sheet.cells.length - 1, Math.max(0, extent.row + delta[0])), col: Math.min(sheet.cells[0].length - 1, Math.max(0, extent.col + delta[1])) }; selectCell(next.row, next.col, event.shiftKey && event.key !== 'Tab'); }
      else if (event.key === 'F2' && caps.editable) { event.preventDefault(); beginCell(selection.row, selection.col); }
      else if (['Delete', 'Backspace'].includes(event.key) && caps.editable) { event.preventDefault(); runRange('clear'); }
      else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && caps.editable) { event.preventDefault(); beginCell(selection.row, selection.col, event.key); }
    } else if (presentation) {
      if (element && caps.editable && ['Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); commit({ type: 'element-delete', slideId: slide.id, elementId }); setElementId(null); }
      else if (!element && ['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) { event.preventDefault(); const i = doc.slides.indexOf(slide); navigateSlide(doc.slides[Math.max(0, Math.min(doc.slides.length - 1, i + (event.key === 'ArrowLeft' ? -1 : 1)))].id); }
    }
  };
  const formula = sheet.cells[selection.row]?.[selection.col] || '';
  const selectedValues = useMemo(() => rangeCells(range, sheet).map(c => Number(cellValue(sheet, c.row, c.col))).filter(Number.isFinite), [sheet, range.r1, range.r2, range.c1, range.c2]);
  const changeDocxHost = patch => { if (request.trim()) { setNotice('请先处理评论草稿。'); return; } setHost(h => ({ ...h, ...patch })); };
  const scene = <details className="fo-scenario"><summary>Office 原型场景 · 合成数据</summary><div>
    {readOnly && <span className="fo-readonly">宿主强制只读（无法由场景解锁）</span>}
    {spreadsheet && <><Field label="来源"><select aria-label="工作簿来源" value={host.sourceKind} onChange={e=>{if(dirty||editingCell){setNotice("来源未切换：请先保存或处理当前草稿。");return;}setHost(h=>({...h,sourceKind:e.target.value}));}}><option value="static">static</option><option value="local">本机 controller（原型）</option><option value="artifactDocument">artifactDocument（原型）</option></select></Field><label><input type="checkbox" checked={host.isEditing} onChange={e=>setHost(h=>({...h,isEditing:e.target.checked}))}/>原始编辑能力</label><label><input type="checkbox" checked={host.hasLiveController} onChange={e=>setHost(h=>({...h,hasLiveController:e.target.checked}))}/>live 控制器（原型）</label><label><input type="checkbox" checked={host.artifactSearchEnabled} onChange={e=>setHost(h=>({...h,artifactSearchEnabled:e.target.checked}))}/>工作簿查找能力</label></>}
    {spreadsheet && <Field label="数据状态"><select aria-label="工作簿数据状态" value={host.sourceState} onChange={e => setHost(h => ({ ...h, sourceState: e.target.value }))}>{['live', 'starting', 'refreshing', 'fallback', 'blocked'].map(s => <option key={s}>{s}</option>)}</select></Field>}
    {spreadsheet && <label><input type="checkbox" checked={host.sourceBytes} onChange={e=>setHost(h=>({...h,sourceBytes:e.target.checked}))}/>已有源内容（原型）</label>}
    {spreadsheet && <label><input type="checkbox" checked={host.manualEditUiEnabled} onChange={e => setHost(h => ({ ...h, manualEditUiEnabled: e.target.checked }))} />手动格式能力</label>}
    {presentation && <><label><input type="checkbox" checked={host.sourceBytes} onChange={e => setHost(h => ({ ...h, sourceBytes: e.target.checked }))} />PPTX 源字节（原型）</label><label><input type="checkbox" checked={host.canRead} onChange={e => setHost(h => ({ ...h, canRead: e.target.checked }))} />PPTX 读取能力（原型）</label><label><input type="checkbox" checked={host.libraryFile} onChange={e => setHost(h => ({ ...h, libraryFile: e.target.checked }))} />库文件</label><label><input type="checkbox" checked={host.canWrite} onChange={e => setHost(h => ({ ...h, canWrite: e.target.checked }))} />可写来源</label><label><input type="checkbox" checked={host.template} onChange={e => setHost(h => ({ ...h, template: e.target.checked }))} />模板</label></>}
    {kind === 'docx' && <><Field label="查看路线"><select aria-label="DOCX 查看路线" value={host.docxRoute} onChange={e => { if (request.trim()) { setNotice('请先处理评论草稿。'); return; } setHost(h => ({ ...h, docxRoute: e.target.value, documentHostFlag: e.target.value === 'popcorn', renderFlag: e.target.value === 'popcorn', isAttachmentPreview: false, hostId: 'local-file' })); }}><option value="popcorn">Popcorn 只读文档</option><option value="legacy">docx-preview 分页</option></select></Field><Field label="DOCX 页数"><select aria-label="DOCX 示例页数" value={host.docxPageCount===1?1:3} onChange={e=>{if(request.trim()){setNotice('请先处理评论草稿。');return;}setHost(h=>({...h,docxPageCount:Number(e.target.value)}));}}><option value={1}>单页</option><option value={3}>三页</option></select></Field><label><input type="checkbox" checked={host.hasRedlines} onChange={e=>{if(request.trim()){setNotice('请先处理评论草稿。');return;}setHost(h=>({...h,hasRedlines:e.target.checked}));}}/>含修订示例</label><label><input type="checkbox" checked={host.redlinesEnabled} onChange={e => setHost(h => ({ ...h, redlinesEnabled: e.target.checked }))} />修订视图能力</label></>}
    {kind === 'docx' && <><div className="fo-field" role="radiogroup" aria-label="DOCX 来源场景（原型）"><span>来源场景</span>{[['file', '普通文件（原型）'], ['attachment', '附件（原型）'], ['durable', 'durable 宿主（原型）']].map(([value, label]) => <label key={value}><input type="radio" name={sourceControlName} value={value} checked={(host.isAttachmentPreview ? 'attachment' : host.hostId === 'durable' ? 'durable' : 'file') === value} onChange={() => changeDocxHost({ isAttachmentPreview: value === 'attachment', hostId: value === 'durable' ? 'durable' : 'local-file' })}/>{label}</label>)}</div><label><input type="checkbox" checked={documentHostFlag} onChange={e=>changeDocxHost({documentHostFlag:e.target.checked})}/>文档宿主能力（原型）</label><label><input type="checkbox" checked={renderFlag} onChange={e=>changeDocxHost({renderFlag:e.target.checked})}/>排版能力（原型）</label></>}
    {!spreadsheet && <label><input type="checkbox" checked={host.annotationsEnabled} onChange={e => setHost(h => ({ ...h, annotationsEnabled: e.target.checked }))} />请求修改能力</label>}
    <small>仅此原型的能力切换，不修改文件权限或参考应用设置。</small>
  </div></details>;

  if(kind==='docx'&&host.docxRoute==='legacy')return <section ref={root} tabIndex={0} className="fo-workspace" data-docx-route={kind === 'docx' ? host.docxRoute : undefined} aria-label="DOCX Office 原型" onKeyDown={keyboard}>
    {scene}<div className="fo-main">
      {docxBytes?<DocxPages bytes={docxBytes} hasRevisions={host.docxPageCount!==1&&host.hasRedlines} redlinesEnabled={host.redlinesEnabled} commentDraft={request}
        position={docxPosition.current} onPageChange={page=>setDocPage(page-1)}
        onSelectionChange={value=>setCommentAnchor(value?{page:value.page,selectedText:value.text}:null)}
        onDownload={()=>onDownload({bytes:docxBytes,mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',name:path.split('/').pop()})}
        onRequestEdits={caps.annotate?()=>{if(review&&request.trim()){setNotice('请先添加或清空评论草稿。');return;}setReview(value=>!value);}:undefined}/>:<p role={docxError?'alert':'status'}>{docxError||'正在读取 DOCX 示例…'}</p>}
      {review && caps.annotate && <aside className="fo-review" aria-label="Office 评论上下文"><strong>请求修改 · 示例</strong><textarea ref={requestRef} aria-label="Office 评论草稿" value={request} onChange={e=>setRequest(e.target.value)} placeholder="针对当前页或选区记录修改请求"/><button className="fo-pill" onClick={()=>{setRequest('');setCommentAnchor(null);setReview(false);setNotice('');}}>取消</button><button className="fo-pill" disabled={!request.trim()} onClick={addComment}>添加到请求</button>
        {contexts.requests.map(item => <div key={item.id} data-office-delivery={item.delivery}><p>第 {item.page} 页：{item.body}</p>{item.selectedText && <blockquote>{item.selectedText}</blockquote>}<small>{({ queued:'待插入', inserting:'正在插入', inserted:'已插入输入，未回车', failed:'插入失败，内容已保留', unknown:'结果未知；请检查终端，不会自动重发' })[item.delivery]}</small></div>)}
        <button className="fo-pill" disabled={contexts.phase === 'inserting' || !contexts.requests.some(item => ['queued','failed'].includes(item.delivery))} onClick={insertComments}>{contexts.phase === 'inserting' ? '正在插入上下文' : contexts.requests.some(item => item.delivery === 'failed') ? '重试失败评论' : '插入上下文'}</button>
        <small>插入当前终端输入，由你检查并自行提交；不跟踪 CLI 完成，不修改 Office 原文。</small>
      </aside>}
    </div><div className="fo-footer"><span>合成 DOCX 原件 · 真实只读排版</span></div>
    {notice&&<div className="fo-notice" role="status">{notice}</div>}
  </section>;
  return <section ref={root} tabIndex={0} className="fo-workspace" data-docx-route={kind === 'docx' ? host.docxRoute : undefined} aria-label={kind.toUpperCase() + ' Office 原型'} onKeyDown={keyboard} onPointerDown={event => { if (menu && !event.target.closest('.fo-context-menu')) setMenu(null); }}>
    {scene}
    {host.signed&&<div className="fo-notice fo-fidelity-notice" role="status">{OFFICE_SIGNED_EDIT_WARNING}</div>}
    {(kind==='xlsx'||presentation)&&<FileOfficeFidelity report={host.fidelityFailure} onCopy={host.onSaveLossyCopy}/>}
    <div className="fo-header">
      {presentation && <><Tool icon={List} label="切换幻灯片缩略图" active={thumbs} onClick={() => setThumbs(v => !v)} /><Tool icon={Grid2X2} label="网格视图" active={grid} onClick={() => setGrid(v => !v)} /></>}
      <strong>{kind.toUpperCase()}</strong><span className="fo-state">{caps.editable ? '可编辑示例' : '只读预览'}{dirty ? ' · 已修改' : ''}</span><span className="fo-spacer" />
      {(spreadsheet ? caps.format : caps.editable) && <><Tool icon={Undo2} label="撤销示例修改" disabled={!history.past.length} onClick={() => commit({ type: 'undo' })} /><Tool icon={Redo2} label="重做示例修改" disabled={!history.future.length} onClick={() => commit({ type: 'redo' })} /></>}
      {presentation && <button className="fo-pill" disabled={readOnly || host.signed || host.template || !caps.sourceWritable} onClick={() => setHost(h => ({ ...h, manualEditing: !h.manualEditing }))}>{host.manualEditing && caps.editable ? '完成编辑' : '编辑'}</button>}
      {spreadsheet && caps.search && <button aria-label="查找工作簿" disabled={!onArtifactSearch} title={onArtifactSearch ? "查找工作簿" : "当前来源未提供工作簿查找"} onClick={()=>{if(sourceGeneration===currentSource.current)onArtifactSearch?.();}}>查找</button>}
      {caps.format && <Tool icon={SlidersHorizontal} label="格式" disabled={spreadsheet&&!!floatingObject} active={formatOpen} onClick={() => setFormatOpen(v => !v)} />}
      {spreadsheet&&caps.format&&<><button aria-label="插入工作簿图片" onClick={()=>insertWorkbookObject('image')}><Image size={14}/>图片</button><button aria-label="插入工作簿图表" onClick={event=>openMenu(event,'workbook-chart')}><BarChart3 size={14}/>图表<ChevronDown size={12}/></button><button aria-label="插入工作簿形状" onClick={event=>openMenu(event,'workbook-shape')}><Shapes size={14}/>形状<ChevronDown size={12}/></button><button aria-label="插入工作簿文本框" onClick={startWorkbookText}><Type size={14}/>文本框</button></>}
      {caps.redlines && <Tool icon={redlines ? Eye : EyeOff} label={redlines ? '隐藏修订' : '显示修订'} active={redlines} onClick={() => { if (request.trim()) { setNotice('请先添加或清空评论草稿，再切换修订。'); return; } setRedlines(v => !v); }} />}
      {caps.annotate && <Tool icon={MessageSquare} label="请求修改" active={review} onClick={() => { if (review && request.trim()) { setNotice('请先添加或清空评论草稿。'); return; } setReview(v => !v); }} />}
      <details className="fo-zoom"><summary>{Math.round(zoom)}% <ChevronDown size={12} /></summary><div role="menu">{[25,50,100,150,200].map(v => <button key={v} role="menuitemradio" aria-checked={zoom === v} onClick={e => { setZoom(v); e.currentTarget.closest('details').open = false; }}>{zoom === v && <Check size={12} />}{v}%</button>)}<button role="menuitem" onClick={e => { fit(); e.currentTarget.closest('details').open = false; }}>适合视图</button></div></details>
      <Tool icon={Download} label="下载 Office 示例文本" onClick={onDownload} />
    </div>
    {spreadsheet && <div className="fo-formula"><span aria-label="当前选区">{floatingObject ? floatingObject.title : cellAddress(range.r1, range.c1)+(range.r1 !== range.r2 || range.c1 !== range.c2 ? ':' + cellAddress(range.r2, range.c2) : '')}</span><button disabled={!caps.editable||!!floatingObject} title="Insert function" aria-label="Insert function" onClick={() => formulaRef.current?.focus()}>fx</button><textarea rows={1} ref={formulaRef} aria-label="公式栏" readOnly={!caps.editable||!!floatingObject} value={floatingObject ? '' : editingCell ? cellInput : formula} onFocus={() => caps.editable && !floatingObject && !editingCell && beginCell(selection.row, selection.col, undefined, 'formula')} onChange={e => changeCellInput(e.target.value)} onBlur={() => finishCell()} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (e.key === 'Enter' && !e.shiftKey || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishCell(e.key === 'Escape'); if (e.key === 'Enter') e.currentTarget.blur(); } }} /></div>}
    {floatingObject&&<div className="fo-notice fo-fidelity-notice" role="status">{floatingObject.kind==='text'?'已选中文本框；双击编辑文字。':`已选中${floatingObject.kind==='image'?'图片':'绘图对象'}；暂不支持编辑此对象，原对象保留。`}</div>}
    {['xlsx','xlsm'].includes(kind) && sheet.objects.some(object=>!['chart','image','shape','text'].includes(object.kind)) && <div className="fo-notice fo-fidelity-notice" role="status">{XLSX_DRAWING_PREVIEW_NOTICE}</div>}
    {presentation && caps.editable && <div className="fo-insert"><button onClick={addSlide}><Plus size={14} />幻灯片</button>{[[Type,'text','文本'],[Image,'image','图片'],[BarChart3,'chart','图表'],[Table2,'table','表格'],[Shapes,'shape','形状']].map(([Icon,k,label]) => <button key={k} onClick={event => k==='image'&&generationEnabled?openMenu(event,'image-insert'):addElement(k)}><Icon size={14}/>{label}</button>)}<small>插入合成对象</small></div>}
    <div className="fo-main">
      {presentation && thumbs && !grid && <nav className="fo-slide-rail" aria-label="幻灯片缩略图">{doc.slides.map((s,i) => <button key={s.id} className={s.id === slide.id ? 'active' : ''} aria-current={s.id === slide.id ? 'page' : undefined} onClick={() => navigateSlide(s.id)} onContextMenu={e => caps.editable && openMenu(e, 'slide', { slideId: s.id })}><SlideThumbnail slide={s}/><small>{i + 1}{s.hidden && ' · 隐藏'}</small></button>)}</nav>}
      {kind === 'docx' && caps.pageRail && <nav className={'fo-doc-rail ' + (docked ? 'docked' : '')} aria-label="DOCX 页面缩略图"><button onClick={() => setDocked(v => !v)}>{docked ? '取消停靠' : '停靠'}</button>{[0,1,2].map(i => <button key={i} aria-current={docPage === i ? 'page' : undefined} onClick={() => { setDocPage(i); docNodes.current[i]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}><span>项目文档<br />第 {i + 1} 页</span></button>)}</nav>}
      <div className="fo-viewport" ref={viewport}>
        {spreadsheet ? <>
          {['blocked','starting','refreshing','fallback'].includes(host.sourceState) && <div className="fo-source-state" role="status">{({ blocked:'来源被阻止；当前示例只读。', starting:'正在建立示例会话；编辑尚不可用。', refreshing:'正在刷新示例；暂停编辑。', fallback:'回退到源文件只读预览。' })[host.sourceState]}<button onClick={() => setHost(h => ({ ...h, sourceState: 'live' }))}>恢复 live 示例</button></div>}
          <table className="fo-sheet" role="grid" aria-readonly={!caps.editable||!!floatingObject} aria-label="工作簿单元格" style={{ zoom: zoom / 100,display:host.sourceKind!=='static' && (host.sourceState==='blocked'||host.sourceState==='refreshing'||host.sourceState==='starting'&&!host.sourceBytes) ? 'none' : undefined }}><colgroup><col style={{ width: 36 }}/>{sheet.cells[0].map((_,c) => <col key={c} style={{ width: sheet.widths[c] || 112 }}/>)}</colgroup><thead><tr><th />{sheet.cells[0].map((_,c) => <th key={c} scope="col">{cellAddress(0,c).replace(/1$/, '')}</th>)}</tr></thead><tbody>{sheet.cells.map((row,r) => <tr key={r} style={{ height: sheet.heights[r] || 32 }}><th scope="row">{r + 1}</th>{row.map((value,c) => {
            const merge = sheet.merges.find(m => r >= m.r1 && r <= m.r2 && c >= m.c1 && c <= m.c2); if (merge && (r !== merge.r1 || c !== merge.c1)) return null;
            const addr = cellAddress(r,c), style = sheet.formats[addr] || {}, selected = !floatingObject && r >= range.r1 && r <= range.r2 && c >= range.c1 && c <= range.c2, active = !floatingObject && r === selection.row && c === selection.col;
            const cellStyle = { fontFamily:style.fontFamily||'inherit',fontWeight: style.bold ? 700 : undefined, fontStyle: style.italic ? 'italic' : undefined, textDecoration: [style.underline && 'underline', style.strike && 'line-through'].filter(Boolean).join(' '), color: style.color, background: style.conditional && Number(cellValue(sheet,r,c)) > Number(style.conditional) ? '#fff0c8' : style.fill, textAlign: style.align, whiteSpace: style.wrap ? 'pre-wrap' : 'nowrap', border: style.border ? '1px solid #557b73' : undefined, fontSize: style.fontSize ? `${style.fontSize}px` : undefined };
            return <td key={c} role="gridcell" aria-label={`单元格 ${addr}`} aria-selected={selected} colSpan={merge ? merge.c2 - merge.c1 + 1 : 1} rowSpan={merge ? merge.r2 - merge.r1 + 1 : 1} className={(selected ? 'selected ' : '') + (active ? 'active' : '')} style={cellStyle} onPointerDown={e => { if (e.button !== 0) return;setFloatingId(null);if(e.target.closest('input'))return; e.preventDefault(); dragSelection.current = {pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false}; selectCell(r,c,e.shiftKey); root.current.focus({ preventScroll:true }); }} onPointerMove={event=>{const drag=dragSelection.current;if(!drag||drag.pointerId!==event.pointerId||!(event.buttons&1))return;if(!drag.moved&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<4)return;drag.moved=true;setExtent({row:r,col:c});}} onPointerEnter={() => dragSelection.current?.moved && setExtent({ row:r,col:c })} onDoubleClick={() => beginCell(r,c)} onContextMenu={e => { if (caps.editable) { if (!selected) selectCell(r,c); openMenu(e,'cells'); } }}>
              {editingCell?.source !== 'formula' && editingCell?.row === r && editingCell.col === c ? <input autoFocus readOnly={!caps.editable} aria-label={`编辑 ${addr}`} value={cellInput} onChange={e => changeCellInput(e.target.value)} onBlur={() => finishCell()} onKeyDown={e => { if (e.nativeEvent.isComposing || e.keyCode === 229) return; if (['Enter','Tab','Escape'].includes(e.key) || ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key) && !e.currentTarget.value.trimStart().startsWith('=')) { e.preventDefault(); e.stopPropagation(); finishCell(e.key === 'Escape', e.key, e.shiftKey, e.key === 'Enter' && primaryEnter(e)); } }} /> : style.checkbox ? <input type="checkbox" aria-label={`${addr} 复选框`} disabled={!caps.editable} checked={value === 'TRUE'} onChange={e => commit({ type:'cell', sheetId:sheet.id,row:r,col:c,value:e.target.checked ? 'TRUE' : 'FALSE' })}/> : displayCell(sheet,r,c)}
            </td>;
          })}</tr>)}</tbody></table>
          {sheet.objects.some(object=>!object.frame&&['chart','image','shape'].includes(object.kind)) && <div className="fo-sheet-objects">{sheet.objects.filter(object=>!object.frame&&['chart','image','shape'].includes(object.kind)).map(o => <button type="button" key={o.id} data-office-object={o.id} aria-label={`选择${o.kind==='image'?'图片':'绘图对象'} ${o.title}`} aria-pressed={floatingObject?.id===o.id} onPointerDown={event=>event.stopPropagation()} onContextMenu={event=>{event.preventDefault();event.stopPropagation();}} onClick={()=>selectFloating(o)}>{o.kind === 'chart' ? <Chart element={{chartType:'bar',values:[3,5,2]}}/> : o.kind === 'image' ? <img src="/assets/app-icon.png" alt="合成图片对象"/> : <div className="fo-sample-shape"/>}<span>{o.title}</span></button>)}</div>}
          <div className="fo-workbook-drawings">{sheet.objects.filter(object=>object.frame).map(object=>{const drawing=workbookDrawingModel(object,sheet);return <button key={object.id} className="fo-workbook-object" data-office-object={object.id} aria-label={`选择${object.kind==='text'?'文本框':object.kind==='image'?'图片':object.kind==='chart'?'图表':'形状'} ${object.title}`} aria-pressed={floatingId===object.id} style={{left:(36+object.frame.x)*zoom/100,top:(27+object.frame.y)*zoom/100,width:object.frame.width*zoom/100,height:object.frame.height*zoom/100}} onPointerDown={event=>event.stopPropagation()} onClick={()=>selectFloating(object)} onDoubleClick={()=>{if(object.kind==='text'&&caps.format){selectFloating(object);setSheetTextDraft({id:object.id,sheetId:sheet.id,text:object.text,frame:object.frame});}}}>{object.kind==='image'?<img src="/assets/app-icon.png" alt="合成图片对象"/>:drawing?<WorkbookVector object={drawing} scale={zoom/100}/>:<span>此对象暂不能预览，原始数据保留。</span>}</button>;})}</div>
          {sheetTextTool&&<div className="fo-workbook-placement" style={{left:sheetTextTool.scrollX+36*zoom/100,top:sheetTextTool.scrollY+27*zoom/100,width:sheetTextTool.width,height:sheetTextTool.height}}><PptxImagePlacement purpose="text" width={sheetTextTool.width/(zoom/100)} height={sheetTextTool.height/(zoom/100)} onCancel={()=>setSheetTextTool(null)} onCommit={(frame,autoSize)=>insertWorkbookObject('text',{frame:{...frame,x:frame.x+sheetTextTool.scrollX/(zoom/100),y:frame.y+sheetTextTool.scrollY/(zoom/100)},autoSize})}/></div>}
          {sheetTextDraft&&<textarea autoFocus className="fo-workbook-text" aria-label="编辑工作簿文本框" maxLength={32767} readOnly={!caps.format} value={sheetTextDraft.text} style={{left:(36+sheetTextDraft.frame.x)*zoom/100,top:(27+sheetTextDraft.frame.y)*zoom/100,width:sheetTextDraft.frame.width*zoom/100,height:sheetTextDraft.frame.height*zoom/100,fontSize:14*zoom/100}} onChange={event=>{if(!caps.format)return;const text=event.target.value;setSheetTextDraft({...sheetTextDraft,text});previewDraft({type:'sheet-object-text',sheetId:sheet.id,objectId:sheetTextDraft.id,text});}} onCompositionStart={()=>{sheetTextComposing.current=true;}} onCompositionEnd={()=>{sheetTextComposing.current=false;if(sheetTextBlurred.current)finishSheetText();}} onBlur={()=>{sheetTextBlurred.current=true;finishSheetText();}} onFocus={()=>{sheetTextBlurred.current=false;}} onKeyDown={event=>{if(imeComposing(event)||sheetTextComposing.current){event.stopPropagation();return;}if(event.key==='Escape'||event.key==='Enter'&&(event.metaKey||event.ctrlKey)){event.preventDefault();event.stopPropagation();finishSheetText(event.key==='Escape');}}}/>}
        </> : presentation ? grid ? <div className="fo-slide-grid">{doc.slides.map((s,i) => <button key={s.id} className={s.id === slide.id ? 'active' : ''} onClick={() => navigateSlide(s.id)} onDoubleClick={() => { navigateSlide(s.id); setGrid(false); }} onContextMenu={e => caps.editable && openMenu(e,'slide',{slideId:s.id})}><SlideThumbnail slide={s}/><span>{i+1}{s.hidden ? ' · 隐藏' : ''}</span></button>)}</div> : <div className="fo-slide-wrap" style={{ zoom:zoom/100 }}><div className="fo-slide" style={{background:slide.background}} onPointerDown={e => { if (e.target === e.currentTarget) { setElementId(null); setTextEditing(false); } }} onContextMenu={e => caps.editable && openMenu(e,'slide',{slideId:slide.id})}>
          {slide.elements.map(el => <div key={el.id} className={'fo-element '+(elementId === el.id ? 'selected' : '')+' kind-'+el.kind} style={{ left:el.x,top:el.y,width:el.width,height:el.height,fontFamily:el.fontFamily||'inherit',fontSize:el.fontSize,color:el.color,background:el.fill,fontWeight:el.bold?700:undefined,fontStyle:el.italic?'italic':undefined,textDecoration:[el.underline&&'underline',el.strike&&'line-through'].filter(Boolean).join(' '),textAlign:el.align||'left',opacity:el.opacity??1,transform:`rotate(${el.rotation||0}deg)`,border:el.border?`${el.borderWidth||2}px ${el.borderStyle||'solid'} ${el.border}`:undefined,boxShadow:el.shadow?'0 6px 12px #0003':undefined,borderRadius:el.shape==='circle'?'50%':undefined,clipPath:el.shape==='triangle'?'polygon(50% 0,100% 100%,0 100%)':el.shape==='diamond'?'polygon(50% 0,100% 50%,50% 100%,0 50%)':el.shape==='arrow'?'polygon(0 25%,65% 25%,65% 0,100% 50%,65% 100%,65% 75%,0 75%)':el.shape==='left-arrow'?'polygon(100% 25%,35% 25%,35% 0,0 50%,35% 100%,35% 75%,100% 75%)':el.shape==='plus'?'polygon(35% 0,65% 0,65% 35%,100% 35%,100% 65%,65% 65%,65% 100%,35% 100%,35% 65%,0 65%,0 35%,35% 35%)':el.shape==='chevron'?'polygon(0 0,65% 0,100% 50%,65% 100%,0 100%,35% 50%)':el.shape==='callout'?'polygon(0 0,100% 0,100% 80%,40% 80%,20% 100%,20% 80%,0 80%)':el.shape==='line'?'polygon(0 48%,100% 48%,100% 52%,0 52%)':el.shape==='star'?'polygon(50% 0,61% 35%,98% 35%,68% 57%,79% 91%,50% 70%,21% 91%,32% 57%,2% 35%,39% 35%)':undefined }} tabIndex={0} aria-label={`${el.kind} 对象 ${el.id}`} onPointerDown={e => { if (isInput(e.target)) return; e.stopPropagation(); setElementId(el.id); setTextEditing(false); if (!caps.editable || e.button !== 0) return; elementDrag.current={id:el.id,x:el.x,y:el.y,startX:e.clientX,startY:e.clientY,node:e.currentTarget}; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const d=elementDrag.current; if (!d || d.id!==el.id) return; const x=Math.max(0,Math.min(600,d.x+(e.clientX-d.startX)/(zoom/100))),y=Math.max(0,Math.min(420,d.y+(e.clientY-d.startY)/(zoom/100))); d.next={x,y}; d.node.style.left=x+'px';d.node.style.top=y+'px'; }} onPointerUp={() => { const d=elementDrag.current;elementDrag.current=null;if(d?.next)commit({type:'element-update',slideId:slide.id,elementId:d.id,patch:d.next}); }} onPointerCancel={() => { const d=elementDrag.current;if(d){d.node.style.left=d.x+'px';d.node.style.top=d.y+'px';}elementDrag.current=null; }} onDoubleClick={() => { if(caps.editable && ['text','shape'].includes(el.kind)){setElementId(el.id);setTextEditing(true);} }} onContextMenu={e => { if(caps.editable){setElementId(el.id);openMenu(e,'element',{elementId:el.id});} }}>
            {textEditing && elementId===el.id && caps.editable ? <textarea autoFocus aria-label="幻灯片对象文本" defaultValue={el.text} onChange={e=>previewDraft({type:'element-update',slideId:slide.id,elementId:el.id,patch:{text:e.target.value}})} onBlur={e=>{updateElement({text:e.target.value});setTextEditing(false);}} onKeyDown={e=>{if(e.key==='Escape'&&!e.nativeEvent.isComposing){e.stopPropagation();draftCallback.current(serializeOffice(latest.current.doc));setTextEditing(false);}}}/> : <ElementContent element={el} editable={caps.editable && elementId===el.id} onCell={(row,col,value)=>commit({type:'table-cell',slideId:slide.id,elementId:el.id,row,col,value})} onCells={cells=>commit({type:'element-update',slideId:slide.id,elementId:el.id,patch:{cells}})}/>}
          </div>)}
          {generationTool&&generationEnabled&&generationTool.slideId===slide.id&&generationTool.version===history.version&&<PptxImagePlacement width={680} height={450} onCommit={placeGeneration} onCancel={()=>setGenerationTool(null)}/>}
        </div>{(caps.editable || slide.notes.trim()) && <label className="fo-notes"><span>Speaker notes</span><textarea aria-label="演讲者备注" readOnly={!caps.editable} value={slide.notes} onChange={e=>commit({type:'slide-notes',slideId:slide.id,value:e.target.value})}/></label>}</div> : <div className="fo-doc-pages" style={{zoom:zoom/100}}>{[0,1,2].map(i=><article key={i} ref={el=>{docNodes.current[i]=el;}} className="fo-doc-page" onMouseUp={()=>{if(review){const selection=window.getSelection();if(selection?.rangeCount){const range=selection.getRangeAt(0),text=selection.toString();if(text.trim()&&docNodes.current[i]?.contains(range.startContainer)&&docNodes.current[i]?.contains(range.endContainer)){setDocPage(i);setCommentAnchor({page:i+1,selectedText:text});setNotice('评论选区：'+text.slice(0,80));}}}}}><small>WillYou · 设计说明 · {i+1}</small><h1>{['项目文档与文件工作区','来源、状态与保存','验收与交付'][i]}</h1><p>项目、会话与文件分别维护状态。浏览、编辑、保存与恢复形成完整流程。</p><h2>完整的文件工作区</h2><p>{host.docxRoute==='legacy' && caps.redlines && redlines ? <><del>所有文件共用同一保存动作。</del><ins>文本、演示稿和工作簿使用独立保存状态。</ins></> : '文本、演示稿和工作簿使用独立保存状态。'}</p><table><tbody><tr><th>阶段</th><th>目标</th><th>状态</th></tr><tr><td>M9</td><td>文件浏览工作区</td><td>设计中</td></tr><tr><td>验收</td><td>逐格式与来源核对</td><td>待执行</td></tr></tbody></table><img src="/assets/app-icon.png" alt="WillYou 示例图标"/><p>本文为合成分页示例，不是 DOCX 排版引擎。预览文字可选择；页面未启用编辑、查找或页码输入控件。</p><footer>WillYou · {i+1} / 3</footer></article>)}</div>}
      </div>
      {formatOpen && caps.format && !floatingObject && <aside className="fo-inspector"><div><strong>格式</strong><Tool icon={X} label="关闭格式面板" onClick={()=>setFormatOpen(false)}/></div>{spreadsheet ? <>
        <div className="fo-format-row">{[[Bold,'bold','加粗'],[Italic,'italic','斜体'],[Underline,'underline','下划线'],[Strikethrough,'strike','删除线']].map(([I,p,label])=><Tool key={p} icon={I} label={label} active={!!activeStyle[p]} onClick={()=>format({[p]:!activeStyle[p]})}/>)}</div>
        <Field label="字体"><select aria-label="单元格字体" value={activeStyle.fontFamily||'inherit'} onChange={e=>format({fontFamily:e.target.value})}>{['inherit','Arial','Georgia','monospace'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="字号"><input type="number" min="8" max="48" aria-label="单元格字号" value={activeStyle.fontSize||13} onChange={e=>format({fontSize:Math.max(8,Math.min(48,Number(e.target.value)))})}/></Field>
        <Field label="文字颜色"><input type="color" aria-label="单元格文字颜色" value={activeStyle.color||'#263d3a'} onChange={e=>format({color:e.target.value})}/></Field><Field label="填充"><input type="color" aria-label="单元格填充" value={activeStyle.fill||'#ffffff'} onChange={e=>format({fill:e.target.value})}/></Field>
        <div className="fo-format-row">{[[AlignLeft,'left','左对齐'],[AlignCenter,'center','居中'],[AlignRight,'right','右对齐']].map(([I,v,l])=><Tool key={v} icon={I} label={l} active={activeStyle.align===v} onClick={()=>format({align:v})}/>)}</div>
        <label><input type="checkbox" checked={!!activeStyle.wrap} onChange={e=>format({wrap:e.target.checked})}/>自动换行</label><label><input type="checkbox" checked={!!activeStyle.border} onChange={e=>format({border:e.target.checked})}/>单元格边框</label>
        <Field label="数值格式"><select aria-label="数值格式" value={activeStyle.numberFormat||'general'} onChange={e=>format({numberFormat:e.target.value})}><option value="general">常规</option><option value="number">数值</option><option value="currency">货币</option><option value="percent">百分比</option></select></Field><Field label="小数位"><input aria-label="小数位" type="number" min="0" max="6" value={activeStyle.decimals??2} onChange={e=>format({decimals:Math.max(0,Math.min(6,Number(e.target.value)))})}/></Field>
        <div className="fo-stack">{[['merge','合并单元格'],['unmerge','取消合并'],['fit-column','适应列宽'],['fit-row','适应行高']].map(([t,l])=><button key={t} onClick={()=>runRange(t)}>{l}</button>)}<button onClick={()=>runRange('checkbox')}>插入复选框</button></div>
        <Field label="数据验证"><select aria-label="数据验证" value={activeStyle.validation||''} onChange={e=>runRange('validation',{value:e.target.value})}><option value="">不限制</option><option value="number">数字或公式</option></select></Field><Field label="条件填充阈值"><input aria-label="条件填充阈值" type="number" value={activeStyle.conditional??''} onChange={e=>runRange('conditional',{value:e.target.value})}/></Field>
        <div className="fo-stack">{[['chart','插入图表示例'],['image','插入图片示例'],['shape','插入形状示例']].map(([k,l])=><button key={k} onClick={()=>insertWorkbookObject(k,k==='chart'?{chartType:'bar'}:k==='shape'?{shape:'rect'}:{})}>{l}</button>)}</div>
      </> : element ? <>
        <strong className="fo-object-kind">{element.kind} · 所选对象</strong>{element.kind!=='group'&&<><div className="fo-format-row">{[[Bold,'bold','加粗'],[Italic,'italic','斜体'],[Underline,'underline','下划线'],[Strikethrough,'strike','删除线']].map(([I,p,l])=><Tool key={p} icon={I} label={l} active={!!element[p]} onClick={()=>updateElement({[p]:!element[p]})}/>)}</div>
        <Field label="字体"><select aria-label="对象字体" value={element.fontFamily||'inherit'} onChange={e=>updateElement({fontFamily:e.target.value})}>{['inherit','Arial','Georgia','monospace'].map(v=><option key={v}>{v}</option>)}</select></Field><Field label="段落列表"><select aria-label="段落列表" value={element.list||''} onChange={e=>updateElement({list:e.target.value})}><option value="">无</option><option value="bullet">项目符号</option><option value="number">编号</option></select></Field></>}{['x','y','width','height','fontSize','rotation'].filter(p=>p!=='fontSize'||element.kind!=='group').map(p=><Field key={p} label={({x:'横坐标',y:'纵坐标',width:'宽度',height:'高度',fontSize:'字号',rotation:'旋转'})[p]}><input type="number" aria-label={'对象'+p} value={element[p]||0} onChange={e=>updateElement({[p]:Number(e.target.value)})}/></Field>)}
        {element.kind!=='group'&&<><Field label="文字颜色"><input type="color" aria-label="对象文字颜色" value={element.color||'#263d3a'} onChange={e=>updateElement({color:e.target.value})}/></Field><Field label="填充"><input type="color" aria-label="对象填充" value={element.fill==='transparent'?'#ffffff':element.fill||'#ffffff'} onChange={e=>updateElement({fill:e.target.value})}/></Field><Field label="透明度"><input type="range" min="0" max="1" step="0.05" aria-label="对象透明度" value={element.opacity??1} onChange={e=>updateElement({opacity:Number(e.target.value)})}/></Field>
        <Field label="对齐"><select aria-label="对象文本对齐" value={element.align||'left'} onChange={e=>updateElement({align:e.target.value})}>{['left','center','right','justify'].map(v=><option key={v}>{v}</option>)}</select></Field><label><input type="checkbox" checked={!!element.shadow} onChange={e=>updateElement({shadow:e.target.checked})}/>阴影</label><label><input type="checkbox" checked={!!element.border} onChange={e=>updateElement({border:e.target.checked?'#557b73':null})}/>边框</label>
        {element.border&&<Field label="边框样式"><select aria-label="边框样式" value={element.borderStyle||'solid'} onChange={e=>updateElement({borderStyle:e.target.value})}>{['solid','dashed','dotted'].map(v=><option key={v}>{v}</option>)}</select></Field>}</>}{element.kind==='shape'&&<Field label="形状"><select aria-label="形状类型" value={element.shape} onChange={e=>updateElement({shape:e.target.value})}>{SHAPES.map(v=><option key={v}>{v}</option>)}</select></Field>}
        {element.kind==='chart'&&<><Field label="图表"><select aria-label="图表类型" value={element.chartType} onChange={e=>updateElement({chartType:e.target.value})}>{CHARTS.map(v=><option key={v}>{v}</option>)}</select></Field><Field label="图表数据"><input aria-label="图表数据" value={(element.values||[3,5,2]).join(',')} onChange={e=>{const values=e.target.value.split(',').map(Number);if(values.length<=8&&values.every(v=>Number.isFinite(v)&&v>=0))updateElement({values});}}/></Field><label><input type="checkbox" checked={!!element.axes} onChange={e=>updateElement({axes:e.target.checked})}/>坐标轴</label><label><input type="checkbox" checked={!!element.gridLines} onChange={e=>updateElement({gridLines:e.target.checked})}/>网格线</label><label><input type="checkbox" checked={!!element.legend} onChange={e=>updateElement({legend:e.target.checked})}/>图例</label></>}
        {element.kind==='image'&&<button title="原型仅切换合成图片，不读取本机文件" onClick={()=>updateElement({imageVariant:!element.imageVariant})}>替换图片</button>}
        {element.kind==='table'&&<><label><input type="checkbox" checked={!!element.headerRow} onChange={e=>updateElement({headerRow:e.target.checked})}/>首行标题</label><label><input type="checkbox" checked={!!element.headerColumn} onChange={e=>updateElement({headerColumn:e.target.checked})}/>首列标题</label></>}
        <div className="fo-stack">{[['front','置于顶层'],['forward','上移一层'],['backward','下移一层'],['back','置于底层']].map(([d,l])=><button key={d} onClick={()=>commit({type:'element-layer',slideId:slide.id,elementId,direction:d})}>{l}</button>)}</div>
      </> : <><p>选择幻灯片中的对象以编辑属性。</p><Field label="幻灯片背景"><input type="color" aria-label="幻灯片背景" value={slide.background} onChange={e=>commit({type:'slide-background',slideId:slide.id,value:e.target.value})}/></Field></>}</aside>}
      {generationTarget&&<aside className="fo-review" aria-label="PPTX 生成描述"><strong>{generationTarget.kind==='chart'?'描述图表':'描述图片'} · 示例</strong><small>对象 {generationTarget.elementId}；加入请求不代表已经生成。</small><textarea aria-label="生成描述" value={generationDraft} maxLength={8000} onChange={e=>setGenerationDraft(e.target.value)}/>{!generationValid()&&<p role="status">目标已改变，描述已保留。</p>}{!generationSaved&&<small>请先保存占位示例，再加入请求。</small>}<button disabled={!generationValid()} onClick={()=>{draftCallback.current(serializeOffice(latest.current.doc));setGenerationSaved(true);}}>保存占位示例</button><button disabled={!generationEnabled} onClick={()=>{if(element&&(element.kind==='chart'||element.kind==='image'&&element.isPlaceholder))captureGeneration(element);else setNotice('请选择图片占位或图表，描述已保留。');}}>重新选择目标</button><button disabled={!generationValid()||!generationSaved||!generationDraft.trim()} onClick={queueGeneration}>加入请求</button><button onClick={()=>{setGenerationTarget(null);setGenerationDraft('');}}>取消描述</button></aside>}
      {(review && caps.annotate || generationHandoff && contexts.requests.some(item=>item.purpose==='generation')) && <aside className="fo-review" aria-label="Office 评论上下文"><strong>请求修改 · 示例</strong><textarea ref={requestRef} aria-label="Office 评论草稿" readOnly={!caps.annotate} value={request} onChange={e=>setRequest(e.target.value)} placeholder="针对当前页或选区记录修改请求"/><button className="fo-pill" disabled={!caps.annotate||!request.trim()} onClick={addComment}>添加到请求</button>
        {contexts.requests.map(item => <div key={item.id} data-office-delivery={item.delivery}><p>第 {item.page} 页：{item.body}</p>{item.selectedText && <blockquote>{item.selectedText}</blockquote>}<small>{({ queued:'待插入', inserting:'正在插入', inserted:'已插入输入，未回车', failed:'插入失败，内容已保留', unknown:'结果未知；请检查终端，不会自动重发' })[item.delivery]}</small></div>)}
        <button className="fo-pill" disabled={contexts.phase === 'inserting' || !contexts.requests.some(item => ['queued','failed'].includes(item.delivery))} onClick={insertComments}>{contexts.phase === 'inserting' ? '正在插入上下文' : contexts.requests.some(item => item.delivery === 'failed') ? '重试失败评论' : '插入上下文'}</button>
        <small>插入当前终端输入，由你检查并自行提交；不跟踪 CLI 完成，不修改 Office 原文。</small>
      </aside>}
    </div>
    {spreadsheet && <nav className="fo-sheet-tabs" aria-label="工作表"><Tool icon={Plus} label="新增工作表" disabled={!caps.editable} onClick={()=>{if(!finishSheetText())return;commit({type:'sheet-add'});navigateSheet(latest.current.doc.sheets.at(-1).id);}}/>{doc.sheets.map((s,i)=><div key={s.id} className={s.id===sheet.id?'active':''} draggable={caps.editable} onDragStart={e=>{sheetDrag.current=s.id;e.dataTransfer.effectAllowed='move';}} onDragOver={e=>caps.editable&&e.preventDefault()} onDrop={e=>{e.preventDefault();if(sheetDrag.current)commit({type:'sheet-move',sheetId:sheetDrag.current,index:i});sheetDrag.current=null;}}><button aria-current={s.id===sheet.id?'page':undefined} onClick={()=>{navigateSheet(s.id);}} onDoubleClick={()=>caps.editable&&setRename({id:s.id,name:s.name})} onContextMenu={e=>caps.editable&&openMenu(e,'sheet',{sheetId:s.id})}>{s.name}</button></div>)}<span className="fo-spacer"/><small>计数 {rangeCells(range,sheet).length} · 合计 {selectedValues.reduce((a,b)=>a+b,0).toLocaleString()}</small></nav>}
    <div className="fo-footer"><span>合成 Office 模型 · {spreadsheet ? '有限公式示例，不执行宏' : '未使用真实 Office 排版引擎'}</span><span>{dirty ? '修改已交工作区草稿' : '示例未修改'}</span></div>
    {presentation && <div className="fo-notice" role="note">{PPTX_STATIC_PREVIEW_NOTICE}</div>}
    {(notice || history.error) && <div className="fo-notice" role="status"><span>{notice || history.error}</span><Tool icon={X} label="关闭提示" onClick={()=>{setNotice('');setHistory(h=>({...h,error:null}));}}/></div>}
    {rename && <div className="fo-modal-backdrop"><form className="fo-rename" role="dialog" aria-modal="true" aria-label="重命名工作表" onSubmit={e=>{e.preventDefault();const next=editOffice(latest.current,{type:'sheet-rename',sheetId:rename.id,name:rename.name},caps);if(next.error){setNotice(next.error);return;}commit({type:'sheet-rename',sheetId:rename.id,name:rename.name});setRename(null);}}><strong>重命名工作表</strong><input autoFocus aria-label="工作表新名称" value={rename.name} onChange={e=>setRename(r=>({...r,name:e.target.value}))} onKeyDown={e=>{if(e.key==='Escape'){e.stopPropagation();setRename(null);}}}/><div><button type="button" onClick={()=>setRename(null)}>取消</button><button type="submit">确定</button></div></form></div>}
    {menu && <div className="fo-context-menu" role="menu" style={{left:menu.x,top:menu.y}}>
      {menu.type==='workbook-chart'&&WORKBOOK_CHARTS.map(chartType=><button key={chartType} role="menuitem" onClick={()=>insertWorkbookObject('chart',{chartType})}>{({bar:'柱状图',line:'折线图',pie:'饼图',area:'面积图',scatter:'散点图'})[chartType]}</button>)}
      {menu.type==='workbook-shape'&&WORKBOOK_SHAPES.map(shape=><button key={shape} role="menuitem" onClick={()=>insertWorkbookObject('shape',{shape})}>{({ellipse:'圆形',rect:'矩形',triangle:'三角形',diamond:'菱形',star5:'星形',rightArrow:'右箭头',leftArrow:'左箭头',plus:'加号',chevron:'V形箭头',wedgeRoundRectCallout:'标注',line:'直线',lineInv:'斜箭头'})[shape]}</button>)}
      {menu.type==='image-insert'&&<><button role="menuitem" onClick={()=>{setMenu(null);if(generationTarget&&generationDraft.trim()){setNotice('请先加入或取消当前描述。');return;}setGrid(false);setGenerationTool({scope:sourceGeneration,slideId:slide.id,version:latest.current.version});}}>生成图片</button><button role="menuitem" onClick={()=>{setMenu(null);addElement('image');}}>从文件上传 · 示例</button></>}
      {menu.type==='sheet'&&<><button role="menuitem" onClick={()=>{navigateSheet(menu.sheetId);setMenu(null);}}>查看工作表</button><button role="menuitem" onClick={()=>{setRename({id:menu.sheetId,name:doc.sheets.find(s=>s.id===menu.sheetId)?.name||''});setMenu(null);}}>重命名</button><hr/><button role="menuitem" disabled={doc.sheets.length<=1} onClick={()=>{commit({type:'sheet-delete',sheetId:menu.sheetId});setMenu(null);}}>删除</button></>}
      {menu.type==='cells'&&<>{[['fill','向下填充',{direction:'down'}],['fill','向右填充',{direction:'right'}],['merge','合并单元格',{}],['unmerge','取消合并',{}],['fit-column','适应列宽',{}],['fit-row','适应行高',{}]].map(([t,l,e])=><button key={l} role="menuitem" disabled={!caps.format} onClick={()=>runRange(t,e)}>{l}</button>)}<hr/>{[['contents','清除内容'],['format','清除格式'],['all','全部清除']].map(([mode,label])=><button key={mode} role="menuitem" disabled={mode!=='contents'&&!caps.format} onClick={()=>runRange('clear',{mode})}>{label}</button>)}</>}
      {menu.type==='slide'&&<><button role="menuitem" onClick={()=>{commit({type:'slide-duplicate',slideId:menu.slideId});setMenu(null);}}>复制幻灯片</button><button role="menuitem" onClick={()=>{commit({type:'slide-hidden',slideId:menu.slideId});setMenu(null);}}>{doc.slides.find(s=>s.id===menu.slideId)?.hidden?'显示':'隐藏'}</button><hr/><button role="menuitem" disabled={doc.slides.length<=1} onClick={()=>{commit({type:'slide-delete',slideId:menu.slideId});setMenu(null);}}>删除</button></>}
      {menu.type==='element'&&menu.elementId&&[['front','置于顶层','⌘⇧F'],['forward','上移一层','⌘⌥⇧F'],['backward','下移一层','⌘⌥⇧B'],['back','置于底层','⌘⇧B']].map(([direction,label,key])=><button key={direction} role="menuitem" onClick={()=>{commit({type:'element-layer',slideId:slide.id,elementId:menu.elementId,direction});setMenu(null);}}>{label}<kbd>{key}</kbd></button>)}
    </div>}
  </section>;
}
function ElementContent({ element: el, editable, onCell, onCells }) {
  if(el.kind==='group') return <GroupContent element={el}/>;
  if(el.kind==='image'&&el.isPlaceholder) return <div role="img" aria-label="图片占位，尚未生成" style={{width:'100%',height:'100%',display:'grid',placeItems:'center',background:'#eef1f1',border:'1px dashed #96a09e',boxSizing:'border-box',color:'#596361'}}>图片占位 · 尚未生成</div>;
  if(el.kind==='image') return <img draggable={false} src="/assets/app-icon.png" alt="合成图片" style={{filter:el.imageVariant?'grayscale(1)':'none'}}/>;
  if(el.kind==='chart') return <Chart element={el}/>;
  if(el.kind==='table') return <SlideTable element={el} editable={editable} onCell={onCell} onCells={onCells}/>;
  return <span>{el.list ? String(el.text||'').split('\n').map((text,i)=><div key={i}>{el.list==='number' ? `${i+1}. ` : '• '}{text}</div>) : el.text}</span>;
}
function GroupContent({element}) {
  const frame=element.childFrame||{x:0,y:0,width:element.width,height:element.height};
  return <svg aria-label="合成组合对象内容" viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} preserveAspectRatio="none" style={{width:'100%',height:'100%',overflow:'visible',pointerEvents:'none'}}>
    {(element.children||[]).map(child=><foreignObject key={child.id} x={child.x} y={child.y} width={child.width} height={child.height} transform={`rotate(${child.rotation||0} ${child.x+child.width/2} ${child.y+child.height/2})`}>
      <div xmlns="http://www.w3.org/1999/xhtml" data-group-child={child.id} style={{width:'100%',height:'100%',background:child.fill,color:child.color,fontFamily:child.fontFamily||'inherit',fontSize:child.fontSize,fontWeight:child.bold?700:undefined,fontStyle:child.italic?'italic':undefined,textDecoration:[child.underline&&'underline',child.strike&&'line-through'].filter(Boolean).join(' '),textAlign:child.align||'left',opacity:child.opacity??1,border:child.border?`${child.borderWidth||2}px ${child.borderStyle||'solid'} ${child.border}`:undefined,boxSizing:'border-box'}}><ElementContent element={child} editable={false}/></div>
    </foreignObject>)}
  </svg>;
}
function SlideThumbnail({slide}) {
  return <svg className="fo-slide-thumbnail" viewBox="0 0 680 450" aria-label={slide.title}><rect width="680" height="450" fill={slide.background}/>{slide.elements.map(el=><g key={el.id} transform={`translate(${el.x} ${el.y}) rotate(${el.rotation||0} ${el.width/2} ${el.height/2})`} opacity={el.opacity??1}>{el.fill&&el.fill!=='transparent'&&<rect width={el.width} height={el.height} fill={el.fill}/>} {el.kind==='group'?<foreignObject width={el.width} height={el.height}><GroupContent element={el}/></foreignObject>:el.kind==='image'?<image href="/assets/app-icon.png" width={el.width} height={el.height}/>:el.kind==='chart'?<g>{(el.values||[3,5,2]).map((v,i)=><rect key={i} x={i*el.width/4} y={el.height-v/5*el.height} width={el.width/5} height={v/5*el.height} fill={COLORS[(i%4)+1]}/>)}</g>:el.kind==='table'?<g>{el.cells.map((row,r)=>row.map((v,c)=><g key={`${r}:${c}`}><rect x={c*el.width/row.length} y={r*el.height/el.cells.length} width={el.width/row.length} height={el.height/el.cells.length} fill="#eff6f3" stroke="#adc4b9"/><text x={c*el.width/row.length+5} y={(r+.6)*el.height/el.cells.length} fontSize="12" fill="#263d3a">{v}</text></g>))}</g>:<text fill={el.color||'#263d3a'} fontSize={el.fontSize||18} fontWeight={el.bold?700:400}>{String(el.text||'').split('\n').map((text,i)=><tspan key={i} x="5" y={(el.fontSize||18)*(i+1)*1.3}>{text}</tspan>)}</text>}</g>)}</svg>;
}
function Chart({element}) {
  const values=(element.values||[3,5,2]).slice(0,8), max=Math.max(...values,1), total=values.reduce((a,b)=>a+b,0)||1, type=element.chartType||'bar';
  const color=i=>COLORS[(i%4)+1], x=i=>25+i*170/Math.max(1,values.length-1), y=v=>110-v/max*85;
  const points=values.map((v,i)=>`${x(i)},${y(v)}`).join(' '); let cumulative=0;
  const pie=values.map((v,i)=>{ const a=cumulative/total*Math.PI*2-Math.PI/2;cumulative+=v;const b=cumulative/total*Math.PI*2-Math.PI/2;return <path key={i} d={`M110 65 L${110+45*Math.cos(a)} ${65+45*Math.sin(a)} A45 45 0 ${v/total>.5?1:0} 1 ${110+45*Math.cos(b)} ${65+45*Math.sin(b)} Z`} fill={color(i)}/>; });
  let sum=0;
  return <div className="fo-chart"><svg viewBox="0 0 220 130" aria-label={type+' 合成图表'}>
    {element.gridLines&&[25,53,81,110].map(v=><line key={v} x1="12" x2="210" y1={v} y2={v} stroke="#d5e5de"/>)}
    {['line','area','scatter'].includes(type)?<>{type!=='scatter'&&<polyline points={type==='area'?`25,110 ${points} ${x(values.length-1)},110`:points} fill={type==='area'?'#d8eee7':'none'} stroke="#218b78" strokeWidth="3"/>}{values.map((v,i)=><circle key={i} cx={x(i)} cy={y(v)} r="4" fill={color(i)}/>)}</>:type==='pie'?values.filter(v=>v>0).length===1?<circle cx="110" cy="65" r="45" fill={color(values.findIndex(v=>v>0))}/>:pie:type==='funnel'?values.map((v,i)=><rect key={i} x={110-v/max*90} y={15+i*95/values.length} width={v/max*180} height={90/values.length} fill={color(i)}/>):type==='treemap'?values.map((v,i)=>{const left=sum/total*190;sum+=v;return <rect key={i} x={15+left} y="15" width={Math.max(0,v/total*190-2)} height="95" fill={color(i)}/>;}):type==='waterfall'?values.map((v,i)=>{const bottom=110-sum/total*90;sum+=v;return <rect key={i} x={15+i*190/values.length} y={110-sum/total*90} width={160/values.length} height={Math.max(0,bottom-(110-sum/total*90))} fill={color(i)}/>;}):values.map((v,i)=><rect key={i} x={15+i*190/values.length} y={y(v)} width={(type==='histogram'?188:150)/values.length} height={v/max*85} rx={type==='histogram'?0:2} fill={color(i)}/>)}
    {element.axes&&<><line x1="12" x2="210" y1="112" y2="112" stroke="#9cafab"/><line x1="12" x2="12" y1="10" y2="112" stroke="#9cafab"/></>}
  </svg>{element.legend&&<small>{values.map((_,i)=>String.fromCharCode(65+i)).join(' · ')}</small>}<small>{type} · 合成数据</small></div>;
}
