import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OfficeSlideInfo } from '@shared/file-office-pages';
import type { PptxPlacementFrame } from '@shared/pptx-image-placement';
import type { PPTX_CHARTS } from '@shared/file-pptx-chart';
import type { FileBuffer } from '../file-buffer';
import { textFingerprint, type VisibleTerminal } from '../terminal-context/store';
import { useFileTerminalContext } from '../terminal-context/context';
import './docx-context.css';
import './pptx-context.css';

interface Owner { instance: string; ref: string; lease: string; generation: number; controller: string; slideId: string; page: number; version: number; terminal: VisibleTerminal }
interface Request extends Owner { id: string; elementId: string; kind: 'image' | 'chart'; newTarget: boolean; selectionRevision: number }
const subscribeNone = () => () => undefined, snapshotNone = () => 0;

/** Request acceptance ends at the real reference tray. Generation/CLI execution
 * is never inferred from this acknowledgment and is never initiated here. */
export function usePptxGeneration(buffer: FileBuffer, page: number, slide: OfficeSlideInfo | undefined, admitted: boolean) {
  const terminal = useFileTerminalContext();
  useSyncExternalStore(terminal?.subscribe ?? subscribeNone, terminal?.snapshot ?? snapshotNone);
  const [tool, setTool] = useState<Owner | null>(null), [request, setRequest] = useState<Request | null>(null);
  const [draft, setDraft] = useState(''), [notice, setNotice] = useState(''), [adding, setAdding] = useState(false);
  const active = useRef<Request | null>(null), placement = useRef<Owner | null>(null), alive = useRef(true), busy = useRef(false), flight = useRef<string | null>(null), sequence = useRef(0);
  const latest = useRef({ buffer, page, slide, admitted }); latest.current = { buffer, page, slide, admitted };
  const available = (accepted = false) => {
    const current = latest.current, pptx = current.buffer.pptx;
    return Boolean(alive.current && current.buffer === buffer && pptx?.editable && (accepted || pptx.editing && !pptx.composing) && !current.buffer.file.sourceReadOnly && !current.buffer.sourceUnavailable
      && current.slide && terminal?.target && terminal.root?.lease === current.buffer.file.ref.lease && terminal.root.generation === current.buffer.file.ref.generation);
  };
  const enabled = Boolean(admitted && available() && !buffer.pptx?.controlsBusy);
  const owner = (): Owner | null => {
    const pptx = buffer.pptx;
    if (!available() || !pptx?.id || !pptx.result || !slide || !terminal?.target) return null;
    return { instance: buffer.instance, ref: buffer.file.ref.id, lease: buffer.file.ref.lease, generation: buffer.file.ref.generation,
      controller: pptx.id, slideId: slide.id, page, version: pptx.result.state.version, terminal: terminal.target };
  };
  const currentOwner = (captured: Owner, version = captured.version, accepted = false) => {
    const current = latest.current, file = current.buffer.file, pptx = current.buffer.pptx;
    return Boolean(available(accepted) && current.buffer.instance === captured.instance && file.ref.id === captured.ref && file.ref.lease === captured.lease && file.ref.generation === captured.generation
      && pptx?.id === captured.controller && pptx.result?.state.version === version && current.page === captured.page && current.buffer.pdfPosition.page === captured.page
      && current.slide?.id === captured.slideId && pptx.result.state.info.slides[captured.page - 1]?.id === captured.slideId && terminal?.target === captured.terminal);
  };
  const currentTarget = (captured: Request, selected = true) => {
    const pptx = latest.current.buffer.pptx;
    const element = pptx?.result?.state.info.slides[captured.page - 1]?.elements?.find(item => item.id === captured.elementId);
    return Boolean(currentOwner(captured, captured.version, !selected) && element?.kind === captured.kind && (!selected || captured.selectionRevision === (pptx?.selectionRevision ?? 0) && pptx?.selection?.slideId === captured.slideId
      && pptx.selection.elementId === captured.elementId && !pptx.selection.cell && !pptx.selection.chartValues));
  };
  const saved = (captured: Request) => {
    const current = latest.current.buffer, receipt = current.saveReceipt;
    return !current.dirty && !current.pptx?.pending && current.file.revision.hash === current.baseHash
      && (!captured.newTarget || receipt?.state === 'saved' && receipt.revision?.hash === current.baseHash);
  };
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; active.current = null; placement.current = null; };
  }, []);
  useEffect(() => {
    sequence.current++; active.current = null; placement.current = null; busy.current = false; flight.current = null;
    setTool(null); setRequest(null); setDraft(''); setNotice(''); setAdding(false);
  }, [buffer.instance]);
  const captureRequest = (captured: Owner, elementId: string, kind: 'image' | 'chart', newTarget: boolean) => {
    const next: Request = { ...captured, id: crypto.randomUUID(), elementId, kind, newTarget, selectionRevision: buffer.pptx?.selectionRevision ?? 0 };
    active.current = next; setRequest(next); setNotice('');
  };
  const cancelPlacement = () => { placement.current = null; setTool(null); };
  const start = async () => {
    if (!enabled || busy.current || flight.current) return;
    if (active.current && draft.trim()) { setNotice('请先加入或取消当前描述。'); return; }
    busy.current = true; const own = ++sequence.current;
    try {
      if (!await buffer.pptx!.finishInput() || own !== sequence.current || !available()) return;
      const captured = owner(); if (!captured) return;
      active.current = null; setRequest(null); placement.current = captured; setTool(captured); setNotice('');
    } finally { if (own === sequence.current) busy.current = false; }
  };
  const insert = async (kind: 'image' | 'chart', frame?: PptxPlacementFrame, chartType?: typeof PPTX_CHARTS[number]) => {
    if (busy.current || flight.current) return;
    if (active.current && draft.trim()) { setNotice('请先加入或取消当前描述。'); return; }
    const captured = kind === 'image' ? placement.current : owner(), pptx = buffer.pptx;
    if (!captured || !pptx || pptx.controlsBusy || pptx.pending || !currentOwner(captured)) { cancelPlacement(); return; }
    const ids = new Set(pptx.result!.state.info.slides[captured.page - 1]?.elements?.map(item => item.id));
    busy.current = true; const own = ++sequence.current; cancelPlacement();
    try {
      const ok = await pptx.action(kind === 'image' ? { type: 'image-placeholder', slideId: captured.slideId, frame: frame! }
        : { type: 'chart-insert', slideId: captured.slideId, chartType: chartType! }, { id: captured.controller, version: captured.version });
      if (!ok || !alive.current || own !== sequence.current) return;
      const version = pptx.result!.state.version;
      if (version !== captured.version + 1 || !currentOwner(captured, version)) { setNotice('文档在插入期间已改变，未创建描述请求。'); return; }
      const additions = pptx.result!.state.info.slides[captured.page - 1]?.elements?.filter(item => !ids.has(item.id)) ?? [];
      if (additions.length !== 1 || additions[0].kind !== kind || kind === 'image' && !additions[0].isPlaceholder
        || pptx.selection?.slideId !== captured.slideId || pptx.selection.elementId !== additions[0].id) {
        setNotice('新对象或选区已改变，未创建描述请求。'); return;
      }
      captureRequest({ ...captured, version }, additions[0].id, kind, true);
    } finally { if (own === sequence.current) busy.current = false; }
  };
  const insertChart = async (chartType: typeof PPTX_CHARTS[number]) => {
    if (!available()) { if (buffer.pptx?.editable && buffer.pptx.editing && !buffer.pptx.controlsBusy && !buffer.file.sourceReadOnly && slide) await buffer.pptx.action({ type: 'chart-insert', slideId: slide.id, chartType }); return; }
    if (!await buffer.pptx!.finishInput() || !available()) return;
    await insert('chart', undefined, chartType);
  };
  const reselect = () => {
    if (flight.current || !enabled) return;
    const captured = owner(), pptx = buffer.pptx, selected = slide?.elements?.find(element => element.id === pptx?.selection?.elementId);
    if (!captured || pptx?.selection?.slideId !== captured.slideId || !selected || !(selected.kind === 'chart' || selected.kind === 'image' && selected.isPlaceholder)) {
      setNotice('请选择当前幻灯片中的图片占位或图表，描述已保留。'); return;
    }
    const old = active.current, newTarget = Boolean(old?.controller === captured.controller && old.elementId === selected.id && old.newTarget);
    captureRequest(captured, selected.id, selected.kind as 'image' | 'chart', newTarget);
  };
  const add = async () => {
    const captured = active.current, body = draft.trim();
    if (!captured || !body || !terminal || flight.current || !enabled) return;
    if (!currentTarget(captured) || !saved(captured)) { setNotice('请保存演示文稿并重新选择目标，描述已保留。'); return; }
    const file = buffer.file, hash = buffer.baseHash;
    let accepted = false;
    const current = () => Boolean(currentTarget(captured, !accepted) && saved(captured) && buffer.baseHash === hash
      && buffer.file.revision.hash === hash && (accepted || active.current?.id === captured.id));
    flight.current = captured.id; setAdding(true);
    try {
      const ack = await terminal.addPptx(file, { pptx: { slideId: captured.slideId, page: captured.page, elementId: captured.elementId }, text: '', comment: body,
        version: captured.version, instance: captured.instance, selectedTextHash: textFingerprint(''), current });
      if (!alive.current || active.current?.id !== captured.id) return;
      if (!ack || !current()) { setNotice(terminal.notice || '目标或请求已改变，描述已保留；请核对引用盘。'); return; }
      accepted = true; active.current = null; setRequest(null); setDraft('');
      setNotice('描述和目标已加入终端引用；预览后可插入，尚未生成，不会自动回车。');
    } catch (error) {
      if (alive.current && active.current?.id === captured.id) setNotice(`未能加入终端引用，描述已保留：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (flight.current === captured.id) { flight.current = null; if (alive.current) setAdding(false); }
    }
  };
  const cancel = () => { active.current = null; flight.current = null; setRequest(null); setDraft(''); setAdding(false); setNotice(''); };
  const save = async () => {
    const captured = active.current; if (!captured || !currentTarget(captured)) return;
    const ok = await buffer.save();
    if (alive.current && active.current?.id === captured.id) setNotice(ok && saved(captured) ? '目标已保存，可加入终端引用。' : buffer.saveError || '目标尚未保存，描述已保留。');
  };
  return { enabled, hasProvider: available(), placing: Boolean(tool && currentOwner(tool)), start, cancelPlacement, place: (frame: PptxPlacementFrame) => insert('image', frame), insertChart,
    panel: <>{request && <aside className="fw-docx-review fw-pptx-review" aria-label="PPTX 生成描述">
      <strong>{request.kind === 'chart' ? '描述图表' : '描述图片'}</strong><small>第 {request.page} 张幻灯片 · 对象 {request.elementId}</small>
      <textarea aria-label="生成描述" maxLength={8000} value={draft} disabled={adding} placeholder={request.kind === 'chart' ? '描述图表应展示的内容' : '描述要生成的图片'} onChange={event => setDraft(event.target.value)} />
      {!currentTarget(request) && <p role="status">目标已改变，描述已保留；请重新选择。</p>}
      {!saved(request) && <small>请先保存目标，再加入终端引用。</small>}
      <div><button disabled={!enabled || adding || !currentTarget(request)} onClick={() => void save()}>保存演示文稿</button><button disabled={!enabled || adding} onClick={reselect}>重新选择目标</button></div>
      <div><button onClick={cancel}>取消描述</button><button disabled={!enabled || adding || !draft.trim() || !currentTarget(request) || !saved(request)} onClick={() => void add()}>{adding ? '正在加入…' : '加入终端引用'}</button></div>
      <small>仅受理到终端引用；由你预览并自行插入、提交，不代表图片已生成。</small>
    </aside>}{notice && <p className="fw-docx-context-notice" role="status">{notice}</p>}</> };
}
