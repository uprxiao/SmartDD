import { useEffect, useRef, useState, useSyncExternalStore, type HTMLAttributes, type RefObject } from 'react';
import { MessageSquare, Trash2, X } from 'lucide-react';
import { formatPdfReferenceLocation, type TerminalPdfContext } from '@shared/file-terminal';
import type { FileBuffer } from '../file-buffer';
import { useFileTerminalContext } from '../terminal-context/context';
import { textFingerprint, type SelectionContext } from '../terminal-context/store';

interface PdfComment { id: string; pdf: TerminalPdfContext; text: string; comment: string }
interface Draft extends PdfComment { left: number; top: number }
const subscribeNone = () => () => undefined;
const snapshotNone = () => 0;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const rounded = (value: number) => Math.round(clamp(value) * 1_000_000) / 1_000_000;
export function pdfCommentAnchor(rect: { left: number; top: number; right: number; bottom: number }, page: DOMRect): TerminalPdfContext['anchor'] | null {
  if (!(page.width > 0 && page.height > 0) || ![rect.left, rect.top, rect.right, rect.bottom, page.left, page.top, page.width, page.height].every(Number.isFinite)) return null;
  const x = rounded((Math.min(rect.left, rect.right) - page.left) / page.width), y = rounded((Math.min(rect.top, rect.bottom) - page.top) / page.height);
  const right = rounded((Math.max(rect.left, rect.right) - page.left) / page.width), bottom = rounded((Math.max(rect.top, rect.bottom) - page.top) / page.height);
  return { x, y, width: Math.max(0, rounded(right - x)), height: Math.max(0, rounded(bottom - y)) };
}

/** The approved P11 comment interaction, using the existing real reference
 * tray. Comments never modify PDF bytes or submit a terminal command. */
export function usePdfComments(buffer: FileBuffer, review: boolean, ready: boolean, host: RefObject<HTMLElement | null>) {
  const terminal = useFileTerminalContext();
  useSyncExternalStore(terminal?.subscribe ?? subscribeNone, terminal?.snapshot ?? snapshotNone);
  const policy = terminal?.root?.capabilities;
  const enabled = !review && policy?.pdfAnnotations === true;
  const batching = policy?.pdfAnnotationBatching === true;
  const [active, setActive] = useState(false), [draft, setDraft] = useState<Draft | null>(null), [body, setBody] = useState('');
  const [comments, setComments] = useState<PdfComment[]>([]), [notice, setNotice] = useState(''), [adding, setAdding] = useState(false);
  const [drawing, setDrawing] = useState<{ page: number; anchor: TerminalPdfContext['anchor'] } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null), busy = useRef(false), alive = useRef(true), addition = useRef(0);
  const drag = useRef<{ page: number; x: number; y: number; element: HTMLElement } | null>(null);
  const identity = `${buffer.instance}:${buffer.file.ref.id}:${buffer.file.revision.hash}`;
  useEffect(() => { alive.current = true; return () => { alive.current = false; drag.current = null; }; }, [identity]);
  useEffect(() => { addition.current++; busy.current = false; setAdding(false); setActive(false); setDraft(null); setBody(''); setComments([]); setDrawing(null); setNotice(''); }, [identity]);
  useEffect(() => { if (draft) editor.current?.focus(); }, [draft?.id]);
  useEffect(() => {
    if (!draft || !host.current) return;
    const root = host.current, scroller = root.querySelector('.fw-pdf-scroll'), article = scroller?.querySelector<HTMLElement>(`article[data-page="${draft.pdf.page}"]`), id = draft.id;
    const place = () => {
      const page = article?.getBoundingClientRect(), outer = root.getBoundingClientRect(); if (!page?.width || !page.height) return;
      const left = Math.max(8, Math.min(Math.max(8, outer.width - 292), page.left - outer.left + (draft.pdf.anchor.x + draft.pdf.anchor.width) * page.width + 8));
      const top = Math.max(42, Math.min(Math.max(42, outer.height - 238), page.top - outer.top + draft.pdf.anchor.y * page.height));
      setDraft(current => current?.id === id && (current.left !== left || current.top !== top) ? { ...current, left, top } : current);
    };
    place(); scroller?.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    const observer = new ResizeObserver(place); observer.observe(root); if (article) observer.observe(article);
    return () => { scroller?.removeEventListener('scroll', place); window.removeEventListener('resize', place); observer.disconnect(); };
  }, [draft?.id, host]);
  useEffect(() => { if (!enabled) { setActive(false); drag.current = null; setDrawing(null); } }, [enabled]);

  function start(page: number, anchor: TerminalPdfContext['anchor'], text: string, element: HTMLElement, existing?: PdfComment) {
    if (!enabled || !ready || busy.current) return;
    if (draft && body.trim() && draft.id !== existing?.id) { setNotice('当前评论尚未添加，请先添加或取消。'); return; }
    const outer = host.current?.getBoundingClientRect(), rect = element.getBoundingClientRect();
    if (!outer) return;
    const left = Math.max(8, Math.min(Math.max(8, outer.width - 292), rect.left - outer.left + (anchor.x + anchor.width) * rect.width + 8));
    const top = Math.max(42, Math.min(Math.max(42, outer.height - 238), rect.top - outer.top + anchor.y * rect.height));
    setDraft({ id: existing?.id ?? crypto.randomUUID(), pdf: { page, anchor }, text, comment: existing?.comment ?? '', left, top });
    setBody(existing?.comment ?? ''); setNotice('');
  }
  async function add(items: PdfComment[]) {
    if (!terminal || busy.current || !enabled || !items.length) return;
    busy.current = true; setAdding(true); const operation = ++addition.current;
    const file = buffer.file, hash = file.revision.hash, instance = buffer.instance;
    const selections: SelectionContext[] = items.map(item => ({ pdf: item.pdf, text: item.text, comment: item.comment,
      version: buffer.version, instance, selectedTextHash: textFingerprint(item.text), current: () => buffer.instance === instance && buffer.file.revision.hash === hash }));
    try {
      const accepted = await terminal.addMany({ lease: file.ref.lease, generation: file.ref.generation, relativePath: file.relativePath }, file.revision, selections);
      if (alive.current && operation === addition.current && identity === `${buffer.instance}:${buffer.file.ref.id}:${buffer.file.revision.hash}`) {
        if (accepted) { setDraft(null); setBody(''); setComments([]); setNotice('评论已加入终端引用；预览后可插入，不会自动回车。'); }
        else setNotice(terminal.notice || '未能加入终端引用，评论已保留。');
      }
    } catch (failure) {
      if (alive.current && operation === addition.current) setNotice(`未能加入终端引用，评论已保留：${String(failure)}`);
    } finally { if (operation === addition.current) { busy.current = false; if (alive.current) setAdding(false); } }
  }
  const submit = () => {
    if (!draft || !body.trim() || busy.current) return;
    const item: PdfComment = { id: draft.id, pdf: draft.pdf, text: draft.text, comment: body.trim() };
    if (batching) {
      if (!comments.some(comment => comment.id === item.id) && comments.length >= 64) { setNotice('最多可保留 64 条评论'); return; }
      setComments(previous => previous.some(comment => comment.id === item.id) ? previous.map(comment => comment.id === item.id ? item : comment) : [...previous, item]);
      setDraft(null); setBody('');
    } else void add([item]);
  };
  function captureText(event: React.MouseEvent<HTMLElement> | React.KeyboardEvent<HTMLElement>, page: number) {
    if (!active || !enabled || !ready || busy.current || drag.current) return;
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.toString().trim()) return;
    const range = selection.getRangeAt(0), element = event.currentTarget;
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) {
      if (element.contains(range.startContainer) || element.contains(range.endContainer)) setNotice('请在同一页内选择评论文字。');
      return;
    }
    const boxes = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0);
    if (!boxes.length) return;
    const anchor = pdfCommentAnchor({ left: Math.min(...boxes.map(rect => rect.left)), top: Math.min(...boxes.map(rect => rect.top)), right: Math.max(...boxes.map(rect => rect.right)), bottom: Math.max(...boxes.map(rect => rect.bottom)) }, element.getBoundingClientRect());
    if (anchor) start(page, anchor, selection.toString().slice(0, 200_000), element);
  }
  function pageProps(page: number): HTMLAttributes<HTMLElement> {
    return {
      'data-pdf-comment-mode': enabled && active ? 'true' : undefined,
      onPointerDown(event) {
        if (!enabled || !active || !ready || busy.current || event.button !== 0 || (event.target as Element).closest('button,a,input,textarea,.textLayer span')) return;
        if (draft && body.trim()) { setNotice('当前评论尚未添加，请先添加或取消。'); return; }
        event.preventDefault(); window.getSelection()?.removeAllRanges();
        drag.current = { page, x: event.clientX, y: event.clientY, element: event.currentTarget };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      onPointerMove(event) {
        const current = drag.current; if (!current) return;
        const anchor = pdfCommentAnchor({ left: current.x, top: current.y, right: event.clientX, bottom: event.clientY }, current.element.getBoundingClientRect());
        if (anchor) setDrawing({ page: current.page, anchor });
      },
      onPointerUp(event) {
        const current = drag.current; if (!current) return;
        drag.current = null; setDrawing(null);
        const anchor = pdfCommentAnchor({ left: current.x, top: current.y, right: event.clientX, bottom: event.clientY }, current.element.getBoundingClientRect());
        if (anchor) {
          const rect = current.element.getBoundingClientRect();
          if (anchor.width * rect.width <= 3 || anchor.height * rect.height <= 3) { anchor.width = 0; anchor.height = 0; }
          start(current.page, anchor, '', current.element);
        }
      },
      onPointerCancel() { drag.current = null; setDrawing(null); },
      onMouseUp(event) { captureText(event, page); },
      onKeyUp(event) { if (!event.nativeEvent.isComposing && event.keyCode !== 229 && event.key === 'Shift') captureText(event, page); },
    } as HTMLAttributes<HTMLElement>;
  }
  const overlay = (page: number) => <>
    {enabled && draft?.pdf.page === page && draft.pdf.anchor.width > 0 && draft.pdf.anchor.height > 0 && <span className="fw-pdf-comment-region" aria-hidden style={{ left: `${draft.pdf.anchor.x * 100}%`, top: `${draft.pdf.anchor.y * 100}%`, width: `${draft.pdf.anchor.width * 100}%`, height: `${draft.pdf.anchor.height * 100}%` }} />}
    {drawing?.page === page && <span className="fw-pdf-comment-region" aria-hidden style={{ left: `${drawing.anchor.x * 100}%`, top: `${drawing.anchor.y * 100}%`, width: `${drawing.anchor.width * 100}%`, height: `${drawing.anchor.height * 100}%` }} />}
    {enabled && comments.filter(item => item.pdf.page === page).map(item => <button key={item.id} className="fw-pdf-comment-marker" aria-label={`PDF 评论 ${comments.indexOf(item) + 1}`} style={{ left: `${item.pdf.anchor.x * 100}%`, top: `${item.pdf.anchor.y * 100}%` }} onClick={event => { const element = event.currentTarget.closest<HTMLElement>('article'); if (element) start(page, item.pdf.anchor, item.text, element, item); }}>{comments.indexOf(item) + 1}</button>)}
  </>;
  return {
    pageProps, overlay,
    toolbar: enabled && <button type="button" className={`fw-icon ${active ? 'active' : ''}`} aria-label="PDF 评论" aria-pressed={active} disabled={!ready || adding} onClick={() => { if (draft && body.trim()) setNotice('请先添加或取消当前评论。'); else { setDraft(null); setActive(value => !value); } }}><MessageSquare size={16} /></button>,
    keyDown(event: React.KeyboardEvent<HTMLElement>) {
      if (event.key !== 'Escape' || event.nativeEvent.isComposing || event.keyCode === 229 || !active && !draft) return;
      event.stopPropagation();
      if (draft && body.trim()) setNotice('评论草稿已保留；添加或取消后可退出评论模式。');
      else if (draft) setDraft(null);
      else setActive(false);
    },
    panels: <>
      {enabled && draft && <form className="fw-pdf-comment-card" role="dialog" aria-label="PDF 评论草稿" style={{ left: draft.left, top: draft.top }} onSubmit={event => { event.preventDefault(); submit(); }}>
        <header><strong>第 {draft.pdf.page} 页评论</strong><button type="button" aria-label="取消 PDF 评论" disabled={adding} onClick={() => { setDraft(null); setBody(''); }}><X size={14} /></button></header>
        <small>{formatPdfReferenceLocation(draft.pdf)}</small>{draft.text && <blockquote>{draft.text}</blockquote>}
        <textarea ref={editor} aria-label="PDF 评论内容" maxLength={8000} value={body} onChange={event => setBody(event.target.value)} disabled={adding} />
        <footer>{draft.id && comments.some(item => item.id === draft.id) && <button type="button" aria-label="删除 PDF 评论" disabled={adding} onClick={() => { setComments(items => items.filter(item => item.id !== draft.id)); setDraft(null); setBody(''); }}><Trash2 size={14} /></button>}<button type="button" disabled={adding} onClick={() => { setDraft(null); setBody(''); }}>取消</button><button type="submit" disabled={!body.trim() || adding}>{batching ? '添加评论' : '加入终端引用'}</button></footer>
      </form>}
      {enabled && batching && (active || comments.length > 0) && <div className="fw-pdf-comment-batch" role="region" aria-label="PDF 评论批处理"><span>{comments.length ? `${comments.length} 条评论` : '选择内容或区域并添加评论'}</span><button type="button" disabled={adding || Boolean(draft && body.trim())} onClick={() => { setComments([]); setDraft(null); setBody(''); setActive(false); }}>取消</button><button type="button" disabled={adding || comments.length === 0 || Boolean(draft)} onClick={() => void add(comments)}>加入终端引用</button></div>}
      {notice && <p className="fw-pdf-status" role="status">{notice}</p>}
    </>,
  };
}
