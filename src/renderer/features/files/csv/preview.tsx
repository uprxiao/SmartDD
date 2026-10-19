import { useEffect, useRef, useState } from 'react';
import { Copy, Loader2, Table2 } from 'lucide-react';
import { CsvClient, createCsvClient } from './client';
import { CSV_LIMITS, csvColumn, type CsvInfo, type CsvPart, type CsvWindow } from './model';
import './style.css';

const ROW = 28, COL = 112, RAIL = 42;
interface CsvPreviewBuffer { instance: string; raw: string; baseHash: string; version: number; file: { name: string } }
export function FileCsvPreview({ buffer }: { buffer: CsvPreviewBuffer }) {
  const viewport = useRef<HTMLDivElement>(null), [attempt, setAttempt] = useState(0), [client, setClient] = useState<CsvClient | null>(null), [info, setInfo] = useState<CsvInfo | null>(null);
  const [page, setPage] = useState<CsvWindow | null>(null), [error, setError] = useState(''), [copyError, setCopyError] = useState('');
  const [scroll, setScroll] = useState({ top: 0, left: 0, width: 400, height: 600 }), [selected, setSelected] = useState({ row: 0, column: 0 }), [cell, setCell] = useState<CsvPart | null>(null);
  const startRow = Math.max(0, Math.floor(scroll.top / ROW) - 2), startColumn = Math.max(0, Math.floor(scroll.left / COL) - 1);
  const rows = Math.min(CSV_LIMITS.windowRows, Math.ceil(scroll.height / ROW) + 4), columns = Math.min(CSV_LIMITS.windowColumns, Math.ceil(scroll.width / COL) + 2);
  useEffect(() => {
    const abort = new AbortController(); let active: CsvClient | null = null;
    setClient(null); setInfo(null); setPage(null); setError(''); setCopyError(''); setSelected({ row: 0, column: 0 }); setCell(null); setScroll((value) => ({ ...value, top: 0, left: 0 }));
    void createCsvClient(buffer.raw, /\.tsv$/i.test(buffer.file.name) ? '\t' : ',', abort.signal).then(async (value) => {
      active = value; const metadata = await value.ready; if (abort.signal.aborted) return;
      setInfo(metadata); setClient(value); if (viewport.current) { viewport.current.scrollTop = 0; viewport.current.scrollLeft = 0; }
    }).catch((failure) => { void active?.destroy(); if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { abort.abort(); void active?.destroy(); };
  }, [buffer.instance, buffer.baseHash, buffer.version, attempt]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const resize = new ResizeObserver(() => setScroll({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight }));
    resize.observe(element); return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!client || !info) return; let alive = true;
    const timer = setTimeout(() => { void client.window(startRow, startColumn, rows, columns).then((value) => { if (alive) setPage(value); }).catch((failure) => { if (alive) setError(failure instanceof Error ? failure.message : String(failure)); }); }, 40);
    return () => { alive = false; clearTimeout(timer); };
  }, [client, info, startRow, startColumn, rows, columns]);
  useEffect(() => {
    setCell(null); setCopyError(''); if (!client || !info?.rows) return; let alive = true;
    void client.cell(selected.row, selected.column).then((value) => { if (alive) setCell(value); }).catch((failure) => { if (alive) setCopyError(failure instanceof Error ? failure.message : String(failure)); });
    return () => { alive = false; };
  }, [client, info, selected.row, selected.column]);
  const move = (row: number, column: number) => {
    if (!info?.rows || !info.columns || !viewport.current) return;
    row = Math.min(info.rows - 1, Math.max(0, row)); column = Math.min(info.columns - 1, Math.max(0, column)); setSelected({ row, column });
    const element = viewport.current;
    if (row * ROW < element.scrollTop || (row + 2) * ROW > element.scrollTop + element.clientHeight) element.scrollTop = Math.max(0, row * ROW - ROW);
    if (column * COL < element.scrollLeft || (column + 1) * COL + RAIL > element.scrollLeft + element.clientWidth) element.scrollLeft = Math.max(0, column * COL - COL);
    setScroll((value) => ({ ...value, top: element.scrollTop, left: element.scrollLeft }));
  };
  const selectionVisible = page?.rows.some((row) => row.some((value) => value.row === selected.row && value.column === selected.column));
  return <div className="fw-csv" aria-label={/\.tsv$/i.test(buffer.file.name) ? 'TSV 表格预览' : 'CSV 表格预览'}>
    <div className="fw-csv-value"><span>{info?.rows ? `${csvColumn(selected.column)}${selected.row + 1}` : '—'}</span><input aria-label="单元格内容" readOnly value={cell?.text ?? ''} /><button aria-label="复制完整单元格内容" title="复制完整单元格内容" disabled={!cell || !client} onClick={() => { if (client) void client.copyCell(selected.row, selected.column).catch((failure) => setCopyError(failure instanceof Error ? failure.message : String(failure))); }}><Copy size={14} /></button></div>
    {cell && cell.end < cell.total && <div className="fw-csv-notice">单元格较长，此处显示前一部分；可复制完整内容或查看源码。</div>}
    {copyError && <div className="fw-csv-notice" role="alert">{copyError}</div>}
    {error ? <div className="fw-empty" role="alert"><Table2 size={24} /><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}>重新解析</button></div> : !info ? <div className="fw-empty" role="status"><Loader2 size={18} className="animate-spin" />正在解析表格…</div> : !info.rows ? <div className="fw-empty" role="status">空表格</div> : null}
    <div ref={viewport} className="fw-csv-viewport" style={{ display: info?.rows && !error ? undefined : 'none' }} role="grid" aria-label="只读表格" aria-readonly="true" aria-rowcount={info ? info.rows + 1 : 0} aria-colcount={info ? info.columns + 1 : 0} aria-activedescendant={selectionVisible ? `csv-${buffer.instance}-${selected.row}-${selected.column}` : undefined} tabIndex={0} onScroll={(event) => { const element = event.currentTarget; setScroll({ top: element.scrollTop, left: element.scrollLeft, width: element.clientWidth, height: element.clientHeight }); }} onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || !info) return;
      const { row, column } = selected;
      const next = event.key === 'ArrowDown' ? [row + 1, column] : event.key === 'ArrowUp' ? [row - 1, column] : event.key === 'ArrowLeft' ? [row, column - 1] : event.key === 'ArrowRight' ? [row, column + 1] : event.key === 'Home' ? [event.ctrlKey || event.metaKey ? 0 : row, 0] : event.key === 'End' ? [event.ctrlKey || event.metaKey ? info.rows - 1 : row, info.columns - 1] : event.key === 'PageDown' ? [row + Math.floor(scroll.height / ROW) - 1, column] : event.key === 'PageUp' ? [row - Math.floor(scroll.height / ROW) + 1, column] : null;
      if (next) { event.preventDefault(); move(next[0], next[1]); }
    }}><div className="fw-csv-grid" style={{ height: ((info?.rows ?? 0) + 1) * ROW, width: (info?.columns ?? 0) * COL + RAIL }}>
      <div className="fw-csv-head" role="row" aria-rowindex={1} style={{ width: (info?.columns ?? 0) * COL + RAIL }}><span className="fw-csv-corner" role="columnheader" />{page?.rows[0]?.map((value) => <span role="columnheader" aria-colindex={value.column + 2} key={value.column} style={{ left: value.column * COL + RAIL, width: COL }}>{csvColumn(value.column)}</span>)}</div>
      {page?.rows.filter((row) => row.length > 0).map((row) => <div role="row" aria-rowindex={row[0].row + 2} key={row[0].row} className="fw-csv-row" style={{ top: (row[0].row + 1) * ROW, width: (info?.columns ?? 0) * COL + RAIL }}><span className="fw-csv-row-number" role="rowheader">{row[0].row + 1}</span>{row.map((value) => <div role="gridcell" aria-colindex={value.column + 2} aria-selected={value.row === selected.row && value.column === selected.column} id={`csv-${buffer.instance}-${value.row}-${value.column}`} key={value.column} className="fw-csv-cell" style={{ left: value.column * COL + RAIL, width: COL }} onClick={() => { move(value.row, value.column); viewport.current?.focus({ preventScroll: true }); }} title={value.missing ? '本行没有此字段' : value.truncated ? '内容较长，选中后可复制完整内容' : value.text}>{value.text}{value.truncated ? '…' : ''}</div>)}</div>)}
    </div></div>
    {info && <div className="fw-csv-footer">{info.rows.toLocaleString()} 行 · {info.columns.toLocaleString()} 列<span>表格预览 · 只读</span></div>}
  </div>;
}
