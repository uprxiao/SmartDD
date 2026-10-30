import { useEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { Check, ChevronDown, Copy, Loader2, Table2, Undo2, Redo2, Save, Plus,SlidersHorizontal } from 'lucide-react';
import { OFFICE_LIMITS, type OfficeCellStyle, type OfficeCellText, type OfficeSheetWindow, type OfficeRange, type OfficeRangeContent,type OfficeFloatingObject,type OfficeFloatingVector } from '@shared/file-office';
import type { FileBuffer } from '../file-buffer';
import { fileErrorMessage } from '../file-buffer';
import { columnName, logicalScroll, officeAxes, physicalScroll, SCROLL_LIMIT } from './layout';
import './style.css';
import { OFFICE_SIGNED_EDIT_WARNING } from './fidelity-details';
import { OfficeSheetRenameDialog } from './sheet-rename-dialog';
import { OfficeSheetMenu } from './sheet-menu';
import { OfficeRangeMenu,type RangeCommand } from './range-menu';
import { OfficeFormatPanel } from './format-panel';
import {WorkbookFloatingImages,officeDrawingBox} from './floating-images';
import {WorkbookInsertControls} from './workbook-insert-controls';
import type {WorkbookDrawing} from '@shared/file-workbook-drawing';
import {PptxImagePlacement} from '@shared/pptx-image-placement';
import {WorkbookTextEditor} from './workbook-text-editor';

const HEADER = 27, RAIL = 36;
interface InlineEdit { sheetId: string; row: number; column: number; text: string; original: string; originalVersion: number }
interface SelectedCellText extends OfficeCellText { clientId:string; sheetId:string; row:number; column:number; modelVersion:number }
function cellStyle(style: OfficeCellStyle | undefined, numeric: boolean, scale=1): CSSProperties {
  if (!style) return {};
  const font = style.font, align = style.alignment;
  const output: CSSProperties = { fontFamily: font?.family, fontSize: font?.points ? `${font.points}pt` : undefined, fontWeight: font?.bold ? 700 : undefined, fontStyle: font?.italic ? 'italic' : undefined, textDecoration: [font?.underline && 'underline', font?.strike && 'line-through'].filter(Boolean).join(' '), color: font?.color, background: style.fill, textAlign: align?.horizontal ?? (numeric ? 'right' : 'left'), whiteSpace: align?.wrap ? 'pre-wrap' : 'pre', padding: `${2*scale}px ${7*scale}px`, paddingLeft: (7 + (align?.indent ?? 0) * 10)*scale };
  for (const edge of ['left','right','top','bottom'] as const) {
    const border = style.borders?.[edge]; if (!border) continue;
    const width = border.style === 'thick' ? 3 : border.style.startsWith('medium') || border.style === 'double' ? 2 : 1;
    const line = border.style === 'double' ? 'double' : border.style === 'dotted' || border.style === 'hair' ? 'dotted' : /dash/i.test(border.style) ? 'dashed' : 'solid';
    output[`border${edge[0].toUpperCase()}${edge.slice(1)}` as 'borderLeft'] = `${width}px ${line} ${border.color}`;
  }
  return output;
}

export function FileOfficePreview({ buffer }: { buffer: FileBuffer }) {
  const sheetDrag=useRef<string|null>(null);
  const section=useRef<HTMLElement>(null),renameReturn=useRef<HTMLElement>(null);
  const [formatOpen,setFormatOpen]=useState(false);
  const [selectedObject,setSelectedObject]=useState<string|null>(null);
  const [textEditing,setTextEditing]=useState<OfficeFloatingVector|null>(null);
  const [textPlacement,setTextPlacement]=useState<{clientId:string;sheetId:string;hostRevision:number;version:number;rangeKey:string;scrollTop:number;scrollLeft:number;scale:number}|null>(null);
  const [rename,setRename]=useState<{sheetId:string;name:string}|null>(null);
  const office=buffer.getOffice(), client=office.client, result=office.result, writer=office.writer;
  const viewport = useRef<HTMLDivElement>(null), formula=useRef<HTMLTextAreaElement>(null);
  const inline = useRef<HTMLInputElement>(null), selectionIntent = useRef(0), mounted = useRef(true);
  const [editing, setEditing] = useState<InlineEdit | null>(null);
  const editingRef = useRef(editing); editingRef.current = editing;
  const [sheetId, setSheetId] = useState(office.view.sheetId), [loadedPage, setPage] = useState<{clientId:string;version:number;value:OfficeSheetWindow} | null>(null), [selected, setSelected] = useState({ row:office.view.row, column:office.view.column }), [loadedCell, setCell] = useState<SelectedCellText | null>(null);
  // Retain the current grid while its next revision loads: removing it would
  // unmount the focused editor after a commit/save. Object selection, unlike
  // the retained grid, must only use identities from the current model.
  const page=loadedPage && loadedPage.clientId===client?.id ? loadedPage.value : null;
  const pageFresh=!!loadedPage && loadedPage.clientId===client?.id && loadedPage.version===result?.state.version;
  const [insertSelection,setInsertSelection]=useState<{clientId:string;sheetId:string;version:number;kind:WorkbookDrawing['kind'];intent:number}|null>(null);
  // An old response can survive until effects run after a selection render.
  // Never use another cell's text as this selection's edit baseline.
  const cell=loadedCell?.clientId===client?.id && loadedCell?.sheetId===sheetId && loadedCell?.row===selected.row && loadedCell?.column===selected.column && loadedCell?.modelVersion===result?.state.version ? loadedCell : null;
  const [extent,setExtent]=useState({row:office.view.endRow ?? office.view.row,column:office.view.endColumn ?? office.view.column});
  const selection=useRef({anchor:selected,extent});selection.current={anchor:selected,extent};
  const drag=useRef<{pointerId:number;row:number;column:number;ready:boolean;ended:boolean}|null>(null),suppressClick=useRef(false);
  const [statistics,setStatistics]=useState<OfficeRangeContent|null>(null),[statisticsError,setStatisticsError]=useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [zoom, setZoom] = useState(office.view.zoom);
  const currentClient = useRef(client); currentClient.current = client;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; selectionIntent.current++; }; }, []);
  useEffect(()=>{setEditing(null);setFormatOpen(false);selectionIntent.current++;drag.current=null;},[office.hostRevision]);
  useEffect(()=>{setSelectedObject(null);setTextEditing(null);setTextPlacement(null);},[client,sheetId,office.hostRevision]);
  useEffect(()=>{if(pageFresh && selectedObject && page?.sheetId===sheetId && !page.objects?.some(image=>image.id===selectedObject))setSelectedObject(null);},[page,pageFresh,sheetId,selectedObject]);
  useEffect(()=>{office.view.zoom=zoom;},[office,zoom]);
  const [scroll, setScroll] = useState({ top: 0, left: 0, width: 500, height: 600 });
  const sheet = result?.workbook.sheets.find((value) => value.id === sheetId), axes = useMemo(() => sheet ? officeAxes(sheet) : null, [sheet]);
  const scale = zoom / 100, logicalTop = logicalScroll(scroll.top, (axes?.rows.total ?? 0) * scale + HEADER, scroll.height) / scale, logicalLeft = logicalScroll(scroll.left, (axes?.columns.total ?? 0) * scale + RAIL, scroll.width) / scale;
  const rowIndices = axes?.rows.visible(logicalTop, scroll.height / scale + 32, OFFICE_LIMITS.windowRows) ?? [], columnIndices = axes?.columns.visible(logicalLeft, scroll.width / scale + 64, OFFICE_LIMITS.windowColumns) ?? [];
  const range:OfficeRange={firstRow:Math.min(selected.row,extent.row),lastRow:Math.max(selected.row,extent.row),firstColumn:Math.min(selected.column,extent.column),lastColumn:Math.max(selected.column,extent.column)};
  // Include complete visible merged cells, including a merge selected by its anchor.
  for(let changed=true;changed;) {changed=false;for(const merge of page?.sheetId === sheetId ? page.merges : []) {
    if(merge.firstRow>range.lastRow || merge.lastRow<range.firstRow || merge.firstColumn>range.lastColumn || merge.lastColumn<range.firstColumn)continue;
    if(merge.firstRow<range.firstRow || merge.lastRow>range.lastRow || merge.firstColumn<range.firstColumn || merge.lastColumn>range.lastColumn){range.firstRow=Math.min(range.firstRow,merge.firstRow);range.lastRow=Math.max(range.lastRow,merge.lastRow);range.firstColumn=Math.min(range.firstColumn,merge.firstColumn);range.lastColumn=Math.max(range.lastColumn,merge.lastColumn);changed=true;}
  }}
  const rangeKey=[range.firstRow,range.firstColumn,range.lastRow,range.lastColumn].join(':');
  const multiple=range.firstRow !== range.lastRow || range.firstColumn !== range.lastColumn;
  const address=`${columnName(range.firstColumn)}${range.firstRow+1}${multiple ? `:${columnName(range.lastColumn)}${range.lastRow+1}` : ''}`;
  const rowKey = rowIndices.join(','), columnKey = columnIndices.join(',');
  useEffect(() => {
    let alive=true; void office.load().then(()=>{ if (alive) { setError(''); setNotice(''); setSheetId(office.view.sheetId); setSelected({row:office.view.row,column:office.view.column}); } });
    return ()=>{alive=false;};
  }, [office,client]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const resize = new ResizeObserver(() => setScroll({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight }));
    resize.observe(element); return () => resize.disconnect();
  }, []);
  useEffect(() => {
    setEditing(null); selectionIntent.current++;drag.current=null;
    const anchor={row:office.view.row,column:office.view.column},end={row:office.view.endRow ?? anchor.row,column:office.view.endColumn ?? anchor.column};
    selection.current={anchor,extent:end};setSelected(anchor);setExtent(end);setZoom(office.view.zoom);
    setPage(null);setCell(null);
    if(office.view.sheetId !== sheetId){setSheetId(office.view.sheetId);return;}
    const element=viewport.current;
    if(element && axes) {
      element.scrollTop=physicalScroll(axes.rows.offsets[Math.min(anchor.row,axes.rows.count-1)]*scale,axes.rows.total*scale+HEADER,element.clientHeight);
      element.scrollLeft=physicalScroll(axes.columns.offsets[Math.min(anchor.column,axes.columns.count-1)]*scale,axes.columns.total*scale+RAIL,element.clientWidth);
      setScroll(value=>({...value,top:element.scrollTop,left:element.scrollLeft}));
    }
  }, [client, sheetId,office.viewRevision]);
  useEffect(() => {
    if (!client || !result || !sheetId || !rowIndices.length || !columnIndices.length) return; let alive = true;const version=result.state.version;
    const timer = setTimeout(() => { void client.window(sheetId, rowIndices, columnIndices).then((value) => { if (alive && currentClient.current===client && office.result?.state.version===version) setPage({clientId:client.id,version,value}); }, (failure) => { if (alive && office.result?.state.version===version) setError(fileErrorMessage(failure)); }); }, 30);
    return () => { alive = false; clearTimeout(timer); };
  }, [client, sheetId, rowKey, columnKey, office.tick,result?.state.version]);
  useEffect(()=>{
    if(!insertSelection)return;
    if(insertSelection.clientId!==client?.id || insertSelection.sheetId!==sheetId || insertSelection.intent!==selectionIntent.current || insertSelection.version!==result?.state.version){setInsertSelection(null);return;}
    if(!pageFresh || !page || page.sheetId!==sheetId)return;
    const object=page.objects?.filter(value=>insertSelection.kind==='text'?value.kind==='shape'&&value.shape?.textBox:value.kind===insertSelection.kind).at(-1);
    if(object){setSelectedObject(object.id);setFormatOpen(false);setEditing(null);if(insertSelection.kind==='text'&&object.kind==='shape')setTextEditing(object);}
    setInsertSelection(null);
  },[insertSelection,page,pageFresh,client,sheetId,result?.state.version]);
  useEffect(()=>{
    if(textPlacement && (!office.editingControls||textPlacement.clientId!==client?.id||textPlacement.sheetId!==sheetId||textPlacement.hostRevision!==office.hostRevision||textPlacement.version!==result?.state.version||textPlacement.rangeKey!==rangeKey||textPlacement.scrollTop!==scroll.top||textPlacement.scrollLeft!==scroll.left||textPlacement.scale!==scale))setTextPlacement(null);
  },[textPlacement,client,sheetId,office.hostRevision,result?.state.version,rangeKey,scroll.top,scroll.left,scale,office.editingControls]);
  useEffect(()=>{
    if(textEditing && pageFresh && page?.sheetId===sheetId&&!page.objects?.some(value=>value.id===textEditing.id)){setTextEditing(null);}
    if(!textEditing&&office.pendingDrawing?.sheetId===sheetId&&pageFresh){
      const pending=page?.objects?.find(value=>value.id===office.pendingDrawing!.objectId);
      if(pending?.kind==='shape'&&pending.shape?.textBox){setSelectedObject(pending.id);setTextEditing(pending);}
    }
  },[textEditing,page,pageFresh,sheetId,office.pendingDrawing]);
  useEffect(() => {
    setCell(null); setNotice(''); if (!client || !sheetId || !office.result) return; let alive = true; const modelVersion=office.result.state.version;
    void client.cell(sheetId, selected.row, selected.column).then(async(value) => {
      if (value.end < value.total && value.total <= 32767) value={...value,text:await client.text(sheetId,selected.row,selected.column),end:value.total};
      if (alive && office.result?.state.version === modelVersion) setCell({...value,modelVersion,clientId:client.id,sheetId,row:selected.row,column:selected.column});
    }).catch((failure) => { if (alive) setNotice(fileErrorMessage(failure)); });
    return () => { alive = false; };
  }, [client, sheetId, selected.row, selected.column, office.tick, result?.state.version]);
  useEffect(()=>{
    if (office.pending) { const pending=office.pending; setSheetId(pending.sheetId); setSelected({row:pending.row,column:pending.column}); }
    else if (office.result && !office.result.workbook.sheets.some(sheet=>sheet.id === sheetId && sheet.hidden === 'visible')) { setSheetId(office.view.sheetId);setSelected({row:office.view.row,column:office.view.column}); }
  },[office,office.tick,sheetId]);
  useEffect(()=>{sheetDrag.current=null;setRename(null);},[client]);
  useEffect(()=>{
    setStatistics(null);setStatisticsError('');if(!client || !sheetId)return;let alive=true;
    const timer=setTimeout(()=>{void client.range(sheetId,range).then(value=>{if(alive)setStatistics(value);},failure=>{if(alive)setStatisticsError(fileErrorMessage(failure));});},80);
    return()=>{alive=false;clearTimeout(timer);};
  },[client,sheetId,rangeKey,office.tick]);
  const move = (row: number, column: number,extend=false) => {
    setSelectedObject(null);setTextEditing(null);setTextPlacement(null);
    if (!axes || !viewport.current) return;
    row = Math.max(0, Math.min(axes.rows.count - 1, row)); column = Math.max(0, Math.min(axes.columns.count - 1, column));
    const merge = page?.merges.find((value) => row >= value.firstRow && row <= value.lastRow && column >= value.firstColumn && column <= value.lastColumn);
    if (merge) { row = merge.firstRow; column = merge.firstColumn; }
    const anchor=extend ? selection.current.anchor : {row,column},end={row,column};
    selection.current={anchor,extent:end};setSelected(anchor);setExtent(end);office.view={...office.view,sheetId,...anchor,endRow:row,endColumn:column};const element = viewport.current;
    if (axes.rows.offsets[row] < logicalTop || axes.rows.offsets[row + 1] * scale + HEADER > logicalTop * scale + scroll.height) element.scrollTop = physicalScroll(Math.max(0, axes.rows.offsets[row] * scale), axes.rows.total * scale + HEADER, scroll.height);
    if (axes.columns.offsets[column] < logicalLeft || axes.columns.offsets[column + 1] * scale + RAIL > logicalLeft * scale + scroll.width) element.scrollLeft = physicalScroll(Math.max(0, axes.columns.offsets[column] * scale), axes.columns.total * scale + RAIL, scroll.width);
    setScroll((value) => ({ ...value, top: element.scrollTop, left: element.scrollLeft }));
  };
  const activeCell = page?.sheetId === sheetId ? page.cells.find((value) => value.row === selected.row && value.column === selected.column) : undefined;
  const editable=!selectedObject && office.editable && !sheet?.protected && Boolean(cell) && (cell?.total ?? 0) <= 32767;
  const rangeEditable=!selectedObject && office.editable && !sheet?.protected && !office.busy && !office.composing;
  const drawingEditable=office.editable && office.editingControls && !sheet?.protected && !office.busy && !office.composing;
  const drawingTarget=JSON.stringify([buffer.instance,buffer.file.ref,buffer.baseHash,client?.id,office.hostRevision,result?.state.version,sheetId,rangeKey,office.pending?.text??null]);
  const insertDrawing=async(drawing:WorkbookDrawing)=>{
    if(!client || !drawingEditable)return false;
    const intent=++selectionIntent.current;
    const ok=await writer.rangeAction({type:'drawing-insert',sheetId,range,drawing});
    if(ok && mounted.current && currentClient.current===client && intent===selectionIntent.current && office.result){
      setInsertSelection({clientId:client.id,sheetId,version:office.result.state.version,kind:drawing.kind,intent});
    }
    return ok;
  };
  const startTextPlacement=async()=>{
    if(!client||!drawingEditable)return;const intent=++selectionIntent.current;
    if(!await writer.flush()||!mounted.current||currentClient.current!==client||intent!==selectionIntent.current||!office.editingControls||!office.result)return;
    setEditing(null);setFormatOpen(false);setSelectedObject(null);setTextEditing(null);
    setTextPlacement({clientId:client.id,sheetId,hostRevision:office.hostRevision,version:office.result.state.version,rangeKey,scrollTop:scroll.top,scrollLeft:scroll.left,scale});
  };
  const editText=async(object:OfficeFloatingVector)=>{
    if(!drawingEditable||!object.shape?.textBox)return;const intent=++selectionIntent.current;
    if(!await writer.flush()||!mounted.current||intent!==selectionIntent.current||currentClient.current!==client)return;
    setEditing(null);setFormatOpen(false);setTextPlacement(null);setSelectedObject(object.id);setTextEditing(object);
  };
  const textBox=textEditing&&axes?officeDrawingBox(textEditing.anchor,axes):null;
  const selectedStyle=page?.styles[activeCell?.style ?? -1];
  const structural=office.editable && !result?.workbook.protected && !office.busy && !office.composing;
  const sheetButtons=useRef(new Map<string,HTMLButtonElement>());
  const viewSheet=(id:string)=>{
    const intent=++selectionIntent.current;
    void writer.flush().then(ok=>{if(ok && mounted.current && selectionIntent.current === intent){
      const anchor={row:0,column:0};office.view={...office.view,sheetId:id,...anchor,endRow:0,endColumn:0};selection.current={anchor,extent:anchor};setSelected(anchor);setExtent(anchor);setSheetId(id);setEditing(null);
      if(viewport.current){viewport.current.scrollTop=0;viewport.current.scrollLeft=0;}setScroll(value=>({...value,top:0,left:0}));
    }});
  };
  const renameSheet=(id:string)=>{
    if(!structural)return;
    renameReturn.current=sheetButtons.current.get(id) ?? null;
    void writer.flush().then(ok=>{const value=office.result?.workbook.sheets.find(sheet=>sheet.id === id);if(ok && value && mounted.current)setRename({sheetId:id,name:value.name});});
  };
  const pending=office.pending?.sheetId === sheetId && office.pending.row === selected.row && office.pending.column === selected.column ? office.pending : null;
  const select=async(row:number,column:number,extend=false)=>{
    const intent=++selectionIntent.current;
    if (office.composing)return false;
    if ((!office.pending && !office.busy || await writer.flush()) && mounted.current && intent === selectionIntent.current) {
      setEditing(null);move(row,column,extend);viewport.current?.focus({preventScroll:true});return true;
    }
    return false;
  };
  const selectImage=async(image:OfficeFloatingObject)=>{
    const intent=++selectionIntent.current;
    if(office.composing || !await writer.flush())return;
    if(!mounted.current || intent!==selectionIntent.current || !page?.objects?.some(value=>value.id===image.id))return;
    drag.current=null;setEditing(null);setTextEditing(null);setTextPlacement(null);setFormatOpen(false);setSelectedObject(image.id);
  };
  const dismissImage=()=>{setSelectedObject(null);setTextEditing(null);viewport.current?.focus({preventScroll:true});};
  const startDrag=(event:PointerEvent<HTMLDivElement>,row:number,column:number)=>{
    if(event.button !== 0 || event.target === inline.current || office.composing)return;
    event.preventDefault();suppressClick.current=true;
    const gesture={pointerId:event.pointerId,row,column,ready:false,ended:false};drag.current=gesture;
    viewport.current?.setPointerCapture?.(event.pointerId);
    void select(row,column,event.shiftKey).then(ok=>{if(!ok || drag.current !== gesture)return;gesture.ready=true;move(gesture.row,gesture.column,true);if(gesture.ended)drag.current=null;});
  };
  const endDrag=()=>{if(drag.current){drag.current.ended=true;if(drag.current.ready)drag.current=null;}};
  const dragMove=(event:PointerEvent<HTMLDivElement>)=>{
    const gesture=drag.current,element=viewport.current;if(!gesture || gesture.pointerId !== event.pointerId || !axes || !element)return;
    const box=element.getBoundingClientRect();
    if(event.clientY<box.top+HEADER)element.scrollTop-=24;else if(event.clientY>box.bottom-12)element.scrollTop+=24;
    if(event.clientX<box.left+RAIL)element.scrollLeft-=24;else if(event.clientX>box.right-12)element.scrollLeft+=24;
    const top=logicalScroll(element.scrollTop,axes.rows.total*scale+HEADER,element.clientHeight)/scale,left=logicalScroll(element.scrollLeft,axes.columns.total*scale+RAIL,element.clientWidth)/scale;
    gesture.row=axes.rows.at(top+Math.max(0,event.clientY-box.top-HEADER)/scale);gesture.column=axes.columns.at(left+Math.max(0,event.clientX-box.left-RAIL)/scale);
    if(gesture.ready)move(gesture.row,gesture.column,true);
  };
  const runRange=(command:RangeCommand)=>{void writer.rangeAction({...command,sheetId,range}).then(ok=>{if(ok && mounted.current){setEditing(null);viewport.current?.focus({preventScroll:true});}});};
  const beforeRangeMenu=async(target:EventTarget|null)=>{
    if(office.composing)return false;
    const element=target instanceof Element ? target.closest('[data-office-row]') : null;
    if(!element)return writer.flush();
    const row=Number(element.getAttribute('data-office-row')),column=Number(element.getAttribute('data-office-column'));
    if(row>=range.firstRow && row<=range.lastRow && column>=range.firstColumn && column<=range.lastColumn)return writer.flush();
    return select(row,column);
  };
  const beginInline=async(row:number,column:number,initial?:string)=>{
    if (!client || !office.editable || sheet?.protected || office.composing) return;
    if (initial && initial.length > 32767) { setNotice('单元格文字超过 32767 个字符；未替换现有内容。'); return; }
    const intent=++selectionIntent.current;
    try {
      const same=row === selected.row && column === selected.column;
      const oldPending=office.pending;
      if (oldPending && (oldPending.sheetId !== sheetId || oldPending.row !== row || oldPending.column !== column) && !await writer.flush()) return;
      const version=office.result!.state.version;
      const original=same && cell && cell.end === cell.total && cell.modelVersion === version ? cell.text : await client.text(sheetId,row,column);
      if (!mounted.current || currentClient.current !== client || intent !== selectionIntent.current || office.result?.state.version !== version || original.length > 32767) return;
      const pending=office.pending, text=initial ?? (pending?.sheetId === sheetId && pending.row === row && pending.column === column ? pending.text : original);
      if(!same)move(row,column);
      setEditing({sheetId,row,column,text,original,originalVersion:version});
      if (initial !== undefined) writer.setPending({sheetId,row,column,text},original,version);
    } catch(failure) { if (mounted.current && intent === selectionIntent.current) setNotice(fileErrorMessage(failure)); }
  };
  useEffect(()=>{ if (editing) { inline.current?.focus({preventScroll:true}); inline.current?.setSelectionRange(editing.text.length,editing.text.length); } },[editing?.sheetId,editing?.row,editing?.column]);
  const blurInline=(event:FocusEvent<HTMLInputElement>)=>{
    const previous=editingRef.current; if (!previous || office.composing) return;
    if(event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest('.fw-office-formula'))return;
    // A toolbar click may save concurrently. Flush is serialised and idempotent;
    // an old blur must not close a newly opened editor or discard newer typing.
    void writer.flush().then(ok=>{if(ok && mounted.current && editingRef.current === previous) setEditing(null);});
  };
  const primaryEnter=(event:{metaKey:boolean;ctrlKey:boolean})=>event.metaKey || event.ctrlKey && !/Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const commitPrimary=()=>{
    if(!cell || office.composing)return;
    const intent=++selectionIntent.current,previousClient=client;
    const complete=multiple ? writer.rangeAction({type:'input',sheetId,range,text:pending?.text ?? cell.text}) : writer.flush();
    void complete.then(ok=>{if(ok && mounted.current && currentClient.current === previousClient && selectionIntent.current === intent){setEditing(null);viewport.current?.focus({preventScroll:true});}});
  };
  const finishKey=(event:KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,source:'inline'|'formula')=>{
    if (event.nativeEvent.isComposing || event.keyCode === 229 || office.composing) return;
    if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); selectionIntent.current++; writer.cancelPending(); setEditing(null); viewport.current?.focus({preventScroll:true}); return;}
    if(source === 'formula') {
      if(event.key === 'Enter' && !event.shiftKey){event.preventDefault();event.stopPropagation();event.currentTarget.blur();}
      return;
    }
    if(event.key === 'Enter' && primaryEnter(event)) {event.preventDefault();event.stopPropagation();if(!event.repeat)commitPrimary();return;}
    // Arrows finish ordinary cell text. Formula input keeps them for its
    // caret/reference interaction, including the inline editor's = prefix.
    const finishArrow=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) && !event.currentTarget.value.trimStart().startsWith('=');
    if (event.key === 'Tab' || event.key === 'Enter' || finishArrow) {
      event.preventDefault(); event.stopPropagation();
      const row=event.key === 'Enter' ? axes?.rows.next(selected.row,event.shiftKey ? -1 : 1) ?? selected.row : event.key === 'ArrowDown' ? axes?.rows.next(selected.row,1) ?? selected.row : event.key === 'ArrowUp' ? axes?.rows.next(selected.row,-1) ?? selected.row : selected.row;
      const column=event.key === 'Tab' || event.key === 'ArrowRight' ? axes?.columns.next(selected.column,event.key === 'Tab' && event.shiftKey ? -1 : 1) ?? selected.column : event.key === 'ArrowLeft' ? axes?.columns.next(selected.column,-1) ?? selected.column : selected.column;
      void select(row,column);
    }
  };
  const copy = () => {
    if(selectedObject)return;
    if(!client || office.composing)return;
    const perform=()=>{if(currentClient.current === client)void (multiple ? client.copyRange(sheetId,range) : client.copy(sheetId,selected.row,selected.column)).catch(failure=>{if(currentClient.current === client)setNotice(fileErrorMessage(failure));});};
    if(office.pending)void writer.flush().then(ok=>{if(ok)perform();});else perform();
  };
  return <section ref={section} className="fw-office" aria-label="工作簿预览" data-workbook-source={office.sourceState} data-workbook-source-kind={office.sourceKind} data-artifact-search-enabled={office.artifactSearchEnabled} onKeyDown={(event)=>{
    if ((event.target as HTMLElement).closest('[role="dialog"],[role="menu"]')) return;
    if (event.nativeEvent.isComposing || event.keyCode === 229 || office.composing) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {event.preventDefault(); void writer.save();}
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !(event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) {event.preventDefault(); void writer.history(event.shiftKey ? 'redo' : 'undo');}
  }}>
    <header className="fw-office-header"><Table2 size={15} /><strong>工作簿</strong><span className="fw-office-state">{office.sourceChanging ? '正在切换…' : office.sourceState==='blocked' ? '来源不可用' : office.sourceState==='refreshing' ? '正在刷新…' : office.sourceState==='fallback' ? '只读回退' : office.sourceState==='starting' ? '正在准备…' : office.busy ? '正在处理…' : office.editable ? '可编辑' : '只读'}</span><span className="fw-office-spacer" />
      {office.editingControls && <><button aria-label="撤销表格编辑" disabled={!result?.state.canUndo || office.busy} onClick={()=>void writer.history('undo')}><Undo2 size={14}/></button><button aria-label="重做表格编辑" disabled={!result?.state.canRedo || office.busy} onClick={()=>void writer.history('redo')}><Redo2 size={14}/></button><button aria-label="保存工作簿" disabled={!office.dirty || office.busy || buffer.conflict} onClick={()=>void writer.save()}><Save size={14}/></button></>}
      {office.editingControls && <button aria-label="格式" disabled={!!selectedObject} aria-expanded={formatOpen} className={formatOpen ? "active" : undefined} onClick={()=>setFormatOpen(value=>!value)}><SlidersHorizontal size={15}/></button>}
      {office.editingControls && <WorkbookInsertControls enabled={drawingEditable} targetKey={drawingTarget} onInsert={insertDrawing} onText={()=>void startTextPlacement()}/>}
      {office.artifactSearchEnabled && <button aria-label="查找工作簿" disabled={!office.canSearchArtifact} title={office.canSearchArtifact ? "查找工作簿" : "当前来源未提供工作簿查找"} onClick={()=>writer.search()}>查找</button>}
      <details className="fw-office-zoom"><summary>{zoom}% <ChevronDown size={12} /></summary><div role="menu">{[25,50,100,150,200].map((value) => <button key={value} role="menuitemradio" aria-checked={zoom === value} onClick={(event) => { setZoom(value); event.currentTarget.closest('details')!.open = false; }}>{zoom === value && <Check size={12} />}{value}%</button>)}<button role="menuitem" onClick={(event) => { setZoom(Math.max(25, Math.min(100, Math.round((scroll.width - RAIL) / Math.min(axes?.columns.total ?? 620, 620) * 100)))); event.currentTarget.closest('details')!.open = false; }}>适合视图</button></div></details>
    </header>
    {["blocked","refreshing","fallback"].includes(office.sourceState) && !buffer.loadError && <div className="fw-office-notice" role={office.sourceState==="blocked" ? "alert" : "status"}>{office.sourceMessage || (office.sourceState==="blocked" ? "工作簿来源暂不可用；当前修改仍保留。" : office.sourceState==="refreshing" ? "工作簿正在刷新；暂不能编辑。" : "当前显示只读回退内容；原修改仍保留。")}{office.sourceState==='fallback' && <button disabled={office.dirty} onClick={()=>{setError('');void office.reload();}}>重新加载</button>}</div>}
    <div className="fw-office-formula"><span aria-label="当前选区">{selectedObject ? page?.objects?.find(image=>image.id===selectedObject)?.name || "图片" : address}</span><button disabled={!editable} aria-label="Insert function" title="Insert function" onClick={()=>formula.current?.focus()}>fx</button><textarea ref={formula} aria-label="公式栏" rows={1} readOnly={!editable} maxLength={32767} value={selectedObject ? '' : editing?.text ?? pending?.text ?? cell?.text ?? ''} onFocus={()=>setEditing(null)} onChange={(event)=>writer.setPending({sheetId,row:selected.row,column:selected.column,text:event.currentTarget.value},cell?.text ?? '',cell?.modelVersion)} onCompositionStart={()=>{office.composing=true;}} onCompositionEnd={()=>{office.composing=false;}} onBlur={()=>{if (!office.composing) void writer.flush();}} onKeyDown={(event)=>finishKey(event,'formula')}/><button aria-label={multiple ? "复制选区内容" : "复制完整单元格内容"} title={multiple ? "复制选区内容" : "复制完整单元格内容"} disabled={!cell || !!selectedObject} onClick={copy}><Copy size={14} /></button></div>
    {cell && cell.end < cell.total && <div className="fw-office-notice">内容较长，公式栏显示前一部分；可复制完整内容。</div>}
    {result?.calculation?.state === 'cached' && <div className="fw-office-notice" role="status">{result.calculation.message}</div>}
    {result?.workbook.signed&&<div className="fw-office-notice" role="status">{OFFICE_SIGNED_EDIT_WARNING}</div>}
    {result?.workbook.fontMetric?.message && <div className="fw-office-notice" role="status">{result.workbook.fontMetric.message}</div>}
    {page?.sheetId===sheetId && page.cells.some(value=>value.conditional?.unsupported) && <div className="fw-office-notice" role="status">此区域含暂未完整显示的条件格式，原规则仍保留。</div>}
    {page?.sheetId===sheetId && page.controlsWarning && <div className="fw-office-notice" role="status">{page.controlsWarning}</div>}
    {page?.sheetId===sheetId && page.drawingWarning && <div className="fw-office-notice" role="status">{page.drawingWarning}</div>}
    {selectedObject && <div className="fw-office-notice" role="status">{page?.objects?.find(value=>value.id===selectedObject)?.kind==='image'?'已选中图片；暂不支持编辑此图片，原对象保留。':`已选中${page?.objects?.find(value=>value.id===selectedObject)?.kind==='chart'?'图表':'形状'}；单元格工具不作用于此对象，原对象保留。`}</div>}
    {notice && <div className="fw-office-notice" role="alert">{notice}</div>}
    {(error || buffer.loadError) ? <div className="fw-empty" role="alert"><p>{error || buffer.loadError}</p><button disabled={office.dirty} onClick={() => {setError(''); void office.reload();}}>重新加载</button></div> : !result ? <div className="fw-empty" role="status"><Loader2 size={18} className="animate-spin" />正在读取工作簿…</div> : null}
    <div className="fw-office-main"><OfficeRangeMenu container={section} enabled={office.editingControls && !office.composing && !selectedObject} canEdit={rangeEditable} beforeOpen={beforeRangeMenu} onAction={runRange}><div ref={viewport} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={()=>{drag.current=null;selectionIntent.current++;}} onLostPointerCapture={endDrag} className="fw-office-viewport" style={{ display: result && !error && !['blocked','refreshing'].includes(office.sourceState) ? undefined : 'none' }} tabIndex={0} role="grid" aria-label="工作簿单元格" aria-readonly={!editable} aria-rowcount={axes ? axes.rows.count + 1 : 0} aria-colcount={axes ? axes.columns.count + 1 : 0} aria-activedescendant={!selectedObject && activeCell ? `office-${buffer.instance}-${sheetId}-${selected.row}-${selected.column}` : undefined} onPaste={(event)=>{if (event.target !== inline.current && rangeEditable) {event.preventDefault(); void beginInline(selected.row,selected.column,event.clipboardData.getData('text/plain'));}}} onScroll={(event) => { const element = event.currentTarget; setScroll({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight }); }} onKeyDown={(event) => {
      if (event.defaultPrevented || event.target === inline.current || (event.target as HTMLElement).closest('.fw-office-checkbox,.fw-office-floating-image,.fw-office-text-editor')) return;
      if (event.nativeEvent.isComposing || event.keyCode === 229 || !axes || !sheet) return;
      if(selectedObject && event.key==='Escape'){event.preventDefault();event.stopPropagation();dismissImage();return;}
      if (event.key === 'Escape' && multiple) {
        event.preventDefault();event.stopPropagation();selectionIntent.current++;drag.current=null;
        move(selected.row,selected.column);return;
      }
      // The enclosing range-menu trigger owns this tool key. Let it prepare
      // the selection before any ordinary-character editor can consume it.
      if (rangeEditable && event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'c') { event.preventDefault(); copy(); return; }
      if (rangeEditable && event.key === 'Enter' && primaryEnter(event)) {event.preventDefault();event.stopPropagation();if(!event.repeat)commitPrimary();return;}
      if (rangeEditable && ['Enter','F2'].includes(event.key)) {event.preventDefault(); void beginInline(selected.row,selected.column); return;}
      if (rangeEditable && ['Backspace','Delete'].includes(event.key)) {event.preventDefault();runRange({type:'clear',mode:'contents'});return;}
      if (rangeEditable && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.length === 1) {event.preventDefault(); void beginInline(selected.row,selected.column,event.key); return;}
      const extend=event.shiftKey && event.key !== 'Tab';
      let { row,column }=extend ? selection.current.extent : selected;const control=event.ctrlKey || event.metaKey;
      const merged=page?.merges.find(value=>row>=value.firstRow && row<=value.lastRow && column>=value.firstColumn && column<=value.lastColumn);
      if(merged){if(event.key === 'ArrowDown')row=merged.lastRow;else if(event.key === 'ArrowUp')row=merged.firstRow;else if(event.key === 'ArrowRight' || event.key === 'Tab' && !event.shiftKey)column=merged.lastColumn;else if(event.key === 'ArrowLeft' || event.key === 'Tab' && event.shiftKey)column=merged.firstColumn;}
      const next = event.key === 'ArrowDown' ? [axes.rows.next(row, 1), column] : event.key === 'ArrowUp' ? [axes.rows.next(row, -1), column] : event.key === 'ArrowRight' || event.key === 'Tab' && !event.shiftKey ? [row, axes.columns.next(column, 1)] : event.key === 'ArrowLeft' || event.key === 'Tab' && event.shiftKey ? [row, axes.columns.next(column, -1)] : event.key === 'Home' ? [control ? axes.rows.at(0) : row, axes.columns.at(0)] : event.key === 'End' ? [control ? Math.max(0, sheet.rows - 1) : row, Math.max(0, sheet.columns - 1)] : event.key === 'PageDown' ? [axes.rows.at(axes.rows.offsets[row] + scroll.height / scale), column] : event.key === 'PageUp' ? [axes.rows.at(Math.max(0, axes.rows.offsets[row] - scroll.height / scale)), column] : null;
      if (next) { event.preventDefault(); void select(next[0], next[1],extend); }
    }}><div className="fw-office-grid" style={{ height: Math.min(SCROLL_LIMIT, (axes?.rows.total ?? 0) * scale + HEADER), width: Math.min(SCROLL_LIMIT, (axes?.columns.total ?? 0) * scale + RAIL) }}>
      <div className="fw-office-head" role="row" aria-rowindex={1}><span className="fw-office-corner" role="columnheader" />{axes && columnIndices.map((column) => <span key={column} role="columnheader" aria-colindex={column + 2} style={{ left: scroll.left + (axes.columns.offsets[column] - logicalLeft) * scale + RAIL, width: axes.columns.size(column) * scale }}>{columnName(column)}</span>)}</div>
      {axes && page?.sheetId === sheetId && [...new Set(page.cells.map((cell) => cell.row))].map((row) => <div role="row" aria-rowindex={row + 2} key={row} className="fw-office-row" style={{ top: scroll.top + (axes.rows.offsets[row] - logicalTop) * scale + HEADER, height: axes.rows.size(row) * scale }}>
        {page.rowIndices.includes(row) && <span className="fw-office-row-number" role="rowheader" style={{ height: '100%' }}>{row + 1}</span>}
        {page.cells.filter((value) => value.row === row).map((value) => {
        const merge = page.merges.find((range) => value.row >= range.firstRow && value.row <= range.lastRow && value.column >= range.firstColumn && value.column <= range.lastColumn);
        if (merge && (value.row !== merge.firstRow || value.column !== merge.firstColumn) || axes.rows.size(value.row) === 0 || axes.columns.size(value.column) === 0) return null;
        const right = merge ? Math.min(axes.columns.count, merge.lastColumn + 1) : value.column + 1, bottom = merge ? Math.min(axes.rows.count, merge.lastRow + 1) : value.row + 1;
        const inCellCheckbox=page.checkboxes?.some(c=>!c.label && c.linked.row===value.row && c.linked.column===value.column && c.from.row===value.row && c.to.row===value.row && c.from.column===value.column && c.to.column===value.column);
        const style = cellStyle(page.styles[value.style], value.type === 'number',scale);if(value.runs)style.textDecoration='none';if(value.conditional?.fill)style.background=value.conditional.fill;const selectedCell = value.row === selected.row && value.column === selected.column;
        return <div role="gridcell" aria-rowindex={value.row + 2} aria-colindex={value.column + 2} aria-rowspan={merge ? merge.lastRow - merge.firstRow + 1 : undefined} aria-colspan={merge ? merge.lastColumn - merge.firstColumn + 1 : undefined} aria-selected={!selectedObject && value.row>=range.firstRow && value.row<=range.lastRow && value.column>=range.firstColumn && value.column<=range.lastColumn} data-active={!selectedObject && selectedCell} data-office-row={value.row} data-office-column={value.column} id={`office-${buffer.instance}-${sheetId}-${value.row}-${value.column}`} key={value.address} className={`fw-office-cell${selectedCell && editing ? ' editing' : ''}`} style={{ ...style, left: scroll.left + (axes.columns.offsets[value.column] - logicalLeft) * scale + RAIL, top: 0, width: (axes.columns.offsets[right] - axes.columns.offsets[value.column]) * scale, height: (axes.rows.offsets[bottom] - axes.rows.offsets[value.row]) * scale, fontSize: `${(page.styles[value.style]?.font?.points ?? 10) * scale}pt` }} onPointerDown={event=>startDrag(event,value.row,value.column)} onClick={(event) => {if(suppressClick.current){suppressClick.current=false;return;} if (event.target !== inline.current) void select(value.row,value.column,event.shiftKey); }} onDoubleClick={(event)=>{if (event.target !== inline.current) void beginInline(value.row,value.column);}} title={value.truncated ? '内容较长，选中后可复制完整内容' : value.display}>{selectedCell && editing && editing.sheetId === sheetId && editing.row === value.row && editing.column === value.column ? <input ref={inline} aria-label={`编辑 ${value.address}`} maxLength={32767} value={editing.text} onChange={(event)=>{const text=event.currentTarget.value; setEditing({...editing,text}); writer.setPending({sheetId,row:editing.row,column:editing.column,text},editing.original,editing.originalVersion);}} onCompositionStart={()=>{office.composing=true;}} onCompositionEnd={()=>{office.composing=false;}} onBlur={blurInline} onKeyDown={(event)=>finishKey(event,'inline')} /> : <>{value.runs ? value.runs.map((run,index)=>{const font={...page.styles[value.style]?.font,...run.font};return <span key={index} style={{fontFamily:font.family,fontSize:`${(font.points ?? 10)*scale}pt`,fontWeight:font.bold ? 700 : 400,fontStyle:font.italic ? 'italic' : 'normal',textDecoration:[font.underline && 'underline',font.strike && 'line-through'].filter(Boolean).join(' ') || 'none',color:font.color}}>{run.text}</span>;}) : inCellCheckbox ? '' : value.display}{value.truncated ? '…' : ''}</>}</div>;
      })}</div>)}
      {axes && client && pageFresh && page?.sheetId===sheetId && page.objects && <WorkbookFloatingImages client={client} sheetId={sheetId} images={page.objects} axes={axes} scale={scale} scroll={scroll} logicalTop={logicalTop} logicalLeft={logicalLeft} selected={selectedObject} onSelect={image=>{void selectImage(image);}} onEditText={object=>void editText(object)} onDismiss={dismissImage}/>}
      {textPlacement&&scroll.width>RAIL&&scroll.height>HEADER&&<div style={{position:'absolute',zIndex:5,left:scroll.left+RAIL,top:scroll.top+HEADER,width:scroll.width-RAIL,height:scroll.height-HEADER}}><PptxImagePlacement purpose="text" width={(scroll.width-RAIL)/scale} height={(scroll.height-HEADER)/scale} onCancel={()=>{setTextPlacement(null);viewport.current?.focus({preventScroll:true});}} onCommit={(frame,autoSize)=>{setTextPlacement(null);void insertDrawing({kind:'text',frame:{...frame,x:logicalLeft+frame.x,y:logicalTop+frame.y},autoSize:autoSize===true});}}/></div>}
      {textEditing&&textBox&&<WorkbookTextEditor key={textEditing.id} office={office} sheetId={sheetId} object={textEditing} style={{left:scroll.left+(textBox.x-logicalLeft)*scale+RAIL,top:scroll.top+(textBox.y-logicalTop)*scale+HEADER,width:textBox.width*scale,height:textBox.height*scale,fontSize:14*scale,padding:4*scale}} onClose={()=>{setTextEditing(null);viewport.current?.focus({preventScroll:true});}}/>}
      {axes && page?.sheetId===sheetId && page.checkboxes?.map(control=>{
        const x=axes.columns.offsets[control.from.column]+control.from.x,y=axes.rows.offsets[control.from.row]+control.from.y;
        const width=axes.columns.offsets[control.to.column]+control.to.x-x,height=axes.rows.offsets[control.to.row]+control.to.y-y;
        if(width<=0 || height<=0)return null;
        return <label key={control.id} className="fw-office-checkbox" title={control.reason ?? control.label} style={{left:scroll.left+(x-logicalLeft)*scale+RAIL,top:scroll.top+(y-logicalTop)*scale+HEADER,width:width*scale,height:height*scale,fontSize:12*scale,gap:4*scale}} onPointerDown={event=>event.stopPropagation()}>
          <input type="checkbox" aria-label={control.label || `${columnName(control.linked.column)}${control.linked.row+1} 复选框`} checked={control.checked} disabled={!rangeEditable || !!control.reason} style={{width:13*scale,height:13*scale}} onKeyDown={event=>{if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='z'){event.preventDefault();void writer.history(event.shiftKey ? 'redo' : 'undo');}}} onChange={event=>{const checked=event.currentTarget.checked,intent=++selectionIntent.current;void writer.editCell({sheetId,...control.linked,text:checked ? 'TRUE' : 'FALSE'}).then(ok=>{if(ok && mounted.current && selectionIntent.current===intent)setEditing(null);});}}/>
          {control.label && <span>{control.label}</span>}
        </label>;
      })}
    </div></div></OfficeRangeMenu>
    {formatOpen && office.editingControls && !selectedObject && <OfficeFormatPanel key={`${sheetId}/${rangeKey}`} style={selectedStyle ?? {numberFormat:0}} defaultFont={page?.styles[0]?.font?.family} validation={activeCell?.validation} conditional={activeCell?.conditional} enabled={rangeEditable && !!selectedStyle} onFormat={format=>writer.rangeAction({type:'format',sheetId,range,format})} onConditional={value=>writer.rangeAction({type:'conditional',sheetId,range,value})} onRange={runRange} onClose={()=>{setFormatOpen(false);viewport.current?.focus({preventScroll:true});}} onSave={()=>void writer.save()}/>}
    </div>
    {result && <nav className="fw-office-sheets" aria-label="工作表">
      <button className="fw-office-add-sheet" aria-label="新增工作表" title="新增工作表" disabled={!structural} onClick={()=>{void writer.sheetAction({type:'add'}).then(ok=>{if(ok && mounted.current){setEditing(null);setSheetId(office.view.sheetId);setSelected({row:0,column:0});}});}}><Plus size={14}/></button>
      {result.workbook.sheets.filter((value) => value.hidden === 'visible').map((value) => <OfficeSheetMenu key={value.id} container={section} enabled={structural} canDelete={result.workbook.sheets.filter(sheet=>sheet.hidden === 'visible').length>1} onView={()=>viewSheet(value.id)} onRename={()=>renameSheet(value.id)} onDelete={()=>{void writer.sheetAction({type:'delete',sheetId:value.id}).then(ok=>{if(ok && mounted.current){setEditing(null);setSheetId(office.view.sheetId);}});}}>
        <button ref={node=>{if(node)sheetButtons.current.set(value.id,node);else sheetButtons.current.delete(value.id);}} aria-current={value.id === sheetId ? 'page' : undefined} draggable={structural}
        onDoubleClick={()=>renameSheet(value.id)}
        onDragStart={event=>{if (!structural) {event.preventDefault();return;} sheetDrag.current=value.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-willyou-sheet',value.id);}}
        onDragEnd={()=>{sheetDrag.current=null;}} onDragOver={event=>{if(structural && sheetDrag.current){event.preventDefault();event.dataTransfer.dropEffect='move';}}}
        onDrop={event=>{event.preventDefault();event.stopPropagation();const id=sheetDrag.current;sheetDrag.current=null;if(id && structural) void writer.sheetAction({type:'move',sheetId:id,index:result.workbook.sheets.findIndex(sheet=>sheet.id === value.id)});}}
        onClick={()=>viewSheet(value.id)}>{value.name}</button>
      </OfficeSheetMenu>)}
    <span className="fw-office-spacer"/><small aria-label="选区统计">{selectedObject ? "图片" : statisticsError || (statistics ? `计数 ${statistics.count} · 合计 ${statistics.sum ?? (statistics.numericCount ? '超出数值范围' : 0)}` : '正在统计…')}</small>
    </nav>}
    {rename && <OfficeSheetRenameDialog name={rename.name} container={section} returnFocus={renameReturn} onCancel={()=>setRename(null)} onRename={async name=>await writer.sheetAction({type:'rename',sheetId:rename.sheetId,name}) ? null : buffer.saveError || '请先完成当前输入'}/>}
  </section>;
}
