import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { OfficeSlideInfo } from '@shared/file-office-pages';
import type { FileBuffer } from '../file-buffer';
import { useFileTerminalContext } from '../terminal-context/context';
import { textFingerprint, type VisibleTerminal } from '../terminal-context/store';
import './docx-context.css';
import './pptx-context.css';

const subscribeNone = () => () => undefined, snapshotNone = () => 0;
interface SlideRequest {
  identity: string; sourceHash: string; controllerId: string; version: number;
  slideId: string; page: number; elementId?: string; text: string; target: VisibleTerminal;
}

/** Comments are source-bound terminal references, independent of manual editing.
 * They neither change the presentation nor execute the resulting instruction. */
export function usePptxRequests(buffer: FileBuffer, page: number, slide: OfficeSlideInfo | undefined, admitted: boolean) {
  const terminal = useFileTerminalContext();
  useSyncExternalStore(terminal?.subscribe ?? subscribeNone, terminal?.snapshot ?? snapshotNone);
  const pptx = buffer.pptx, identity = `${buffer.instance}/${buffer.file.ref.id}/${pptx?.id}`;
  // Reload replaces the controller and invalidates an old capture, but the
  // user's unsubmitted instruction still belongs to this FileBuffer.
  const bufferInstance = buffer.instance;
  const alive = useRef(true), latest = useRef(identity), allowed = useRef(false), busy = useRef(false), operation = useRef(0);
  latest.current = identity;
  const [open, setOpen] = useState(false), [anchor, setAnchor] = useState<SlideRequest | null>(null);
  const [draft, setDraft] = useState(''), [notice, setNotice] = useState(''), [adding, setAdding] = useState(false);
  const enabled = Boolean(admitted && pptx?.id && pptx.result && slide && !buffer.sourceUnavailable && !buffer.file.sourceReadOnly
    && !pptx.result.state.protected && terminal?.target && terminal.root?.lease === buffer.file.ref.lease && terminal.root.generation === buffer.file.ref.generation);
  allowed.current = enabled;
  useEffect(() => {
    alive.current = true; operation.current++; busy.current = false;
    setOpen(false); setAnchor(null); setDraft(''); setNotice(''); setAdding(false);
    return () => { alive.current = false; operation.current++; };
  }, [bufferInstance]);
  const capture = (): SlideRequest | null => {
    if (!enabled || !pptx?.id || !pptx.result || !slide || !terminal?.target || pptx.result.state.info.slides[page - 1]?.id !== slide.id) return null;
    const selected = pptx.selection?.slideId === slide.id ? slide.elements?.find(element => element.id === pptx.selection?.elementId) : undefined;
    return { identity, sourceHash: buffer.baseHash, controllerId: pptx.id, version: pptx.result.state.version,
      slideId: slide.id, page, ...(selected ? { elementId: selected.id } : {}), text: selected?.text ?? '', target: terminal.target };
  };
  const request = () => {
    if (!enabled || busy.current) return;
    if (open && draft.trim()) { setNotice('请先加入或取消当前评论草稿。'); return; }
    if (!open) { setAnchor(capture()); setNotice(''); }
    setOpen(value => !value);
  };
  const add = async () => {
    const captured = anchor, file = buffer.file, instance = buffer.instance;
    const current = () => {
      const currentPptx = buffer.pptx, state = currentPptx?.result?.state, currentSlide = state?.info.slides[(captured?.page ?? 0) - 1];
      return Boolean(captured && currentPptx && state && alive.current && allowed.current && latest.current === captured.identity && buffer.baseHash === captured.sourceHash
        && !buffer.sourceUnavailable && !buffer.file.sourceReadOnly && currentPptx.id === captured.controllerId
        && state.version === captured.version && !state.protected
        && buffer.pdfPosition.page === captured.page && currentSlide?.id === captured.slideId && terminal?.target === captured.target
        && (!captured.elementId || currentSlide.elements?.some(element => element.id === captured.elementId && (element.text ?? '') === captured.text)));
    };
    if (!enabled || !terminal || busy.current || !captured || !draft.trim()) return;
    if (!current()) { setNotice('幻灯片、文件或终端已改变；草稿已保留，请重新选择。'); return; }
    busy.current = true; setAdding(true); const own = ++operation.current;
    try {
      const accepted = await terminal.addPptx(file, { pptx: { slideId: captured.slideId, page: captured.page, ...(captured.elementId ? { elementId: captured.elementId } : {}) },
        text: captured.text, comment: draft.trim(), version: captured.version, instance, selectedTextHash: textFingerprint(captured.text), current });
      if (!alive.current || own !== operation.current) return;
      if (accepted) { setDraft(''); setAnchor(null); setOpen(false); setNotice('幻灯片与指令已加入终端引用；预览后可插入，不会自动回车。'); }
      else setNotice(terminal.notice || '未能加入终端引用，草稿已保留。');
    } catch (error) {
      if (alive.current && own === operation.current) setNotice(`未能加入终端引用，草稿已保留：${error instanceof Error ? error.message : String(error)}`);
    } finally { if (alive.current && own === operation.current) { busy.current = false; setAdding(false); } }
  };
  return { onRequestEdits: enabled ? request : undefined, panel: <>{open && <aside className="fw-docx-review fw-pptx-review" aria-label="PPTX 评论上下文">
    <strong>请求修改</strong>
    {anchor ? <><small>第 {anchor.page} 张幻灯片{anchor.elementId ? ` · 对象 ${anchor.elementId}` : ''}</small>{anchor.text && <blockquote>{anchor.text}</blockquote>}</> : <p>请先打开要交接的幻灯片。</p>}
    <textarea aria-label="PPTX 修改指令" placeholder="记录当前幻灯片的修改请求" value={draft} maxLength={8000} disabled={adding} onChange={event => setDraft(event.target.value)} />
    {!enabled && <p role="status">当前文件或任务终端不可用；草稿已保留。</p>}
    <div><button type="button" disabled={adding} onClick={() => { setDraft(''); setAnchor(null); setOpen(false); setNotice(''); }}>取消</button><button type="button" disabled={!enabled || adding} onClick={() => { setAnchor(capture()); setNotice(''); }}>重新选择当前幻灯片</button><button type="button" disabled={!enabled || !anchor || !draft.trim() || adding} onClick={() => void add()}>{adding ? '正在加入…' : '加入终端引用'}</button></div>
    <small>仅插入当前终端输入，由你检查并自行提交。</small>
  </aside>}{notice && <p className="fw-docx-context-notice" role="status">{notice}</p>}</> };
}
