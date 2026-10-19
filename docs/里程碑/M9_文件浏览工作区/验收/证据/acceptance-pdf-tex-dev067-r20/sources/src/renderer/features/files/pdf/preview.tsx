import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, List, Loader2 } from 'lucide-react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { rpc } from '@renderer/lib/ipc';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@renderer/lib/ui/menu';
import type { FileBuffer } from '../file-buffer';
import { readFileResource } from '../resource';
import { createPdfSession, type PdfSession } from './engine';
import { PdfCanvasPage } from './page';
import { PdfCanvasBudget, clampPdfPage, clampPdfZoom, classifyPdfError, fitWidthZoom, pageAtOffset, pdfOffsets, pdfPageWindow, resolveDestinationPage, type PdfPageSize } from './model';
import './style.css';
import { bindPdfWheel } from './wheel.mjs';

interface ReadyPdf { session: PdfSession; doc: PDFDocumentProxy; sizes: PdfPageSize[]; titles: Record<number, string> }
export function FilePdfPreview({ buffer, review = false, onDownload, loadData }: { buffer: FileBuffer; review?: boolean; onDownload?: () => Promise<void>; loadData?: (signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>> }) {
  const [pdf, setPdf] = useState<ReadyPdf | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState(''), [attempt, setAttempt] = useState(0);
  const [passwordPrompt, setPasswordPrompt] = useState<{ submit: (value: string) => void; wrong: boolean } | null>(null), [password, setPassword] = useState('');
  const [zooming, setZooming] = useState(false);
  const [page, setPage] = useState(buffer.pdfPosition.page), [zoom, setZoom] = useState(buffer.pdfPosition.zoom), [docked, setDocked] = useState(false);
  const [viewport, setViewport] = useState({ top: 0, height: 800 }), [thumbTop, setThumbTop] = useState(0), [downscaled, setDownscaled] = useState<Set<number>>(new Set());
  const scroll = useRef<HTMLDivElement>(null), thumbScroll = useRef<HTMLDivElement>(null), current = useRef<PdfSession | null>(null), cancel = useRef<AbortController | null>(null), zoomRef = useRef(zoom);
  const pendingTop = useRef<number | null>(null), restorePage = useRef(buffer.pdfPosition.page);
  const budget = useMemo(() => new PdfCanvasBudget(), [buffer, buffer.file.revision.hash, attempt]);
  const offsets = useMemo(() => pdfOffsets(pdf?.sizes ?? [], review ? 100 : zoom), [pdf?.sizes, zoom, review]);
  const windowed = useMemo(() => pdfPageWindow(offsets, viewport.top, viewport.height), [offsets, viewport]);
  const numbers = review ? [clampPdfPage(page, pdf?.doc.numPages ?? 1)] : windowed.numbers;
  const total = pdf?.doc.numPages ?? 1;
  const zoomTo = useCallback((value: number) => { const next = clampPdfZoom(value); zoomRef.current = next; setZoom(next); buffer.updatePdfPosition({ zoom: next, initialized: true }); }, [buffer]);
  const goto = useCallback((value: number) => {
    const next = clampPdfPage(value, total); setPage(next); buffer.updatePdfPosition({ page: next });
    if (!review && scroll.current) scroll.current.scrollTop = offsets[next - 1];
  }, [buffer, offsets, total, review]);
  const onPlan = useCallback((number: number, flag: boolean) => setDownscaled((prior) => {
    if (prior.has(number) === flag) return prior;
    const next = new Set(prior); flag ? next.add(number) : next.delete(number); return next;
  }), []);
  useEffect(() => {
    const controller = new AbortController(); cancel.current = controller;
    let session: PdfSession | null = null;
    zoomRef.current = buffer.pdfPosition.zoom; setZoom(buffer.pdfPosition.zoom);
    pendingTop.current = null; restorePage.current = buffer.pdfPosition.page;
    setPdf(null); setError(''); setNotice(''); setPasswordPrompt(null); setPassword(''); setDownscaled(new Set());
    const fail = (failure: unknown) => {
      if (controller.signal.aborted) return;
      const classified = classifyPdfError(failure);
      if (classified.kind !== 'aborted') { setError(classified.message); setPdf(null); setPasswordPrompt(null); setPassword(''); }
    };
    void (async () => {
      try {
        const bytes = await (loadData ? loadData(controller.signal) : readFileResource(buffer.file, rpc.files, controller.signal));
        session = await createPdfSession(bytes, { signal: controller.signal, onFailure: fail,
          onPassword: (submit, wrong) => { if (!controller.signal.aborted) { setPasswordPrompt({ submit, wrong }); setPassword(''); } } });
        if (controller.signal.aborted) { await session.destroy(); return; }
        current.current = session;
        const doc = await session.ready;
        const first = await session.run(doc.getPage(1));
        controller.signal.throwIfAborted(); setPasswordPrompt(null); setPassword('');
        const view = first.getViewport({ scale: 1 }), sizes = Array.from({ length: doc.numPages }, () => ({ width: view.width, height: view.height }));
        const ready = { doc, session, sizes: [...sizes], titles: {} };
        const restoredPage = clampPdfPage(restorePage.current, doc.numPages);
        restorePage.current = restoredPage; buffer.updatePdfPosition({ page: restoredPage });
        setPdf(ready); setPage(restoredPage);
        // First paint needs one page, not an eager parse of thousands of pages.
        // Resolve size metadata in small batches, publishing immutable snapshots.
        void (async () => {
          try {
            for (let start = 2; start <= doc.numPages; start += 16) {
              for (let index = start; index < Math.min(start + 16, doc.numPages + 1); index++) {
                const item = await session!.run(doc.getPage(index)); controller.signal.throwIfAborted();
                const size = item.getViewport({ scale: 1 }); sizes[index - 1] = { width: size.width, height: size.height };
              }
              if (!controller.signal.aborted) setPdf((state) => state?.session === session ? { ...state, sizes: [...sizes] } : state);
              await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            const outline = await session!.run(doc.getOutline()), titles: Record<number, string> = {};
            const queue = [...(outline ?? [])];
            for (let index = 0; index < queue.length; index++) {
              const item = queue[index]; controller.signal.throwIfAborted();
              if (item.items) queue.push(...item.items);
              const destination = await session!.run(resolveDestinationPage(item.dest, doc));
              if (destination !== null && destination < doc.numPages && !titles[destination + 1]) titles[destination + 1] = item.title;
              if (index % 32 === 31) await new Promise<void>((resolve) => setTimeout(resolve, 0));
            }
            if (!controller.signal.aborted) setPdf((state) => state?.session === session ? { ...state, titles } : state);
          } catch (failure) { fail(failure); }
        })();
      } catch (failure) { fail(failure); await session?.destroy(); }
    })();
    return () => { controller.abort(); void session?.destroy(); if (current.current === session) current.current = null; if (cancel.current === controller) cancel.current = null; };
  }, [buffer, buffer.file.revision.hash, attempt, loadData]);
  useEffect(() => {
    const node = scroll.current;
    if (!pdf || !node) return;
    const observer = new ResizeObserver(() => setViewport({ top: node.scrollTop, height: node.clientHeight }));
    observer.observe(node);
    if (!buffer.pdfPosition.initialized) zoomTo(fitWidthZoom(pdf.sizes[0].width, node.clientWidth - 48));
    return () => observer.disconnect();
  }, [pdf?.session, buffer, zoomTo]);
  useEffect(() => {
    if (!pdf || !scroll.current) return;
    const top = pendingTop.current ?? offsets[clampPdfPage(restorePage.current, total) - 1];
    if (pendingTop.current !== null || restorePage.current > 1) { scroll.current.scrollTop = top; pendingTop.current = null; restorePage.current = 1; }
  }, [pdf?.session, offsets, total]);
  useEffect(() => {
    setZooming(false);
    const node = scroll.current;
    if (!node || review || !pdf || pdf.session !== current.current) return;
    return bindPdfWheel(node, {
      getZoom: () => zoomRef.current, setZoom: zoomTo, onZooming: setZooming,
      onAnchor: position => { pendingTop.current = position.top; },
    });
  }, [buffer, pdf?.session, review, zoomTo]);
  const thumbStart = Math.max(1, Math.floor(thumbTop / 102) + 1), thumbEnd = Math.min(total, thumbStart + 8);
  const thumbNumbers = Array.from({ length: Math.max(0, thumbEnd - thumbStart + 1) }, (_, i) => i + thumbStart);
  useEffect(() => {
    const node = thumbScroll.current; if (!node) return;
    const top = (page - 1) * 102;
    if (top < node.scrollTop || top + 92 > node.scrollTop + node.clientHeight) node.scrollTop = Math.max(0, top - (node.clientHeight - 92) / 2);
  }, [page, pdf?.session]);
  const submitPassword = () => { if (!password || !passwordPrompt) return; passwordPrompt.submit(password); setPassword(''); setPasswordPrompt(null); };
  return <section className={`fw-pdf ${review ? 'fw-pdf-review' : ''}`} aria-label="PDF 文档" data-zooming={zooming}>
    {!review && <div className="fw-pdf-tools"><span className="fw-push" /><DropdownMenu><DropdownMenuTrigger className="fw-pdf-zoom" aria-label="PDF 缩放">{Math.round(zoom)}% <ChevronDown size={12} /></DropdownMenuTrigger><DropdownMenuContent align="end">
      {[25, 50, 100, 150, 200].map((value) => <DropdownMenuItem key={value} onClick={() => zoomTo(value)}>{zoom === value ? <Check size={12} /> : <span style={{ width: 12 }} />}{value}%</DropdownMenuItem>)}
      <DropdownMenuItem disabled={!pdf} onClick={() => pdf && zoomTo(fitWidthZoom(pdf.sizes[page - 1].width, (scroll.current?.clientWidth ?? 648) - 48))}>适合宽度</DropdownMenuItem>
    </DropdownMenuContent></DropdownMenu>{onDownload && <button className="fw-icon" aria-label="下载文档" onClick={() => { void onDownload().catch((failure) => setNotice(String(failure))); }}><Download size={16} /></button>}</div>}
    {error ? <div className="fw-empty" role="alert"><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}>重试</button></div> : !pdf ? <div className="fw-empty" role="status"><Loader2 size={20} className="animate-spin" />{passwordPrompt ? '等待 PDF 密码' : '正在载入 PDF'}</div> : <div className="fw-pdf-main">
      {!review && total > 1 && <nav className={`fw-pdf-thumbnails ${docked ? 'docked' : ''}`} aria-label="PDF 页面缩略图">
        <button className="fw-pdf-dock" aria-label={docked ? '取消停靠缩略图' : '停靠缩略图'} aria-pressed={docked} onClick={() => setDocked((value) => !value)}><List size={12} /><span>{docked ? '取消停靠' : '停靠缩略图'}</span></button>
        <div ref={thumbScroll} className="fw-pdf-thumb-scroll" onScroll={(event) => setThumbTop(event.currentTarget.scrollTop)}><div aria-hidden style={{ height: (thumbStart - 1) * 102 }} />{thumbNumbers.map((number) => <button key={number} className="fw-pdf-thumb-button" aria-label={`第 ${number} 页`} aria-current={number === page ? 'page' : undefined} title={pdf.titles[number] ? `第 ${number} 页 · ${pdf.titles[number]}` : undefined} onClick={() => goto(number)}>
          <PdfCanvasPage session={pdf.session} doc={pdf.doc} number={number} size={pdf.sizes[number - 1]} zoom={100} budget={budget} quota={Math.floor(1024 * 1024 / 9)} thumbnail review /><span>{pdf.titles[number] ?? ''}</span><small>{number}</small>
        </button>)}<div aria-hidden style={{ height: (total - thumbEnd) * 102 }} /></div>
      </nav>}
      <div ref={scroll} className="fw-pdf-scroll" onScroll={(event) => {
        const node = event.currentTarget; setViewport({ top: node.scrollTop, height: node.clientHeight });
        if (!review) { const next = pageAtOffset(offsets, node.scrollTop + Math.min(100, node.clientHeight / 3)) + 1; setPage(next); buffer.updatePdfPosition({ page: next }); }
      }}><div aria-hidden style={{ height: review ? 0 : windowed.before }} />{numbers.map((number) => <PdfCanvasPage key={number} session={pdf.session} doc={pdf.doc} number={number} size={pdf.sizes[number - 1]} zoom={review ? 100 : zoom} budget={budget} quota={Math.min(16 * 1024 * 1024, Math.floor(31 * 1024 * 1024 / Math.max(1, numbers.length)))} review={review} onPlan={onPlan} onLink={(target) => target.page ? goto(target.page) : setNotice(`外部链接：${target.url ?? ''}`)} />)}<div aria-hidden style={{ height: review ? 0 : windowed.after }} /></div>
    </div>}
    {pdf && (review && total > 1 ? <div className="fw-pdf-pager"><button aria-label="上一页" disabled={page === 1} onClick={() => goto(page - 1)}><ArrowLeft size={16} /></button><span>{page} / {total}</span><button aria-label="下一页" disabled={page === total} onClick={() => goto(page + 1)}><ArrowRight size={16} /></button></div> : <p className="fw-pdf-status" role="status">第 {page} / {total} 页{numbers.some((number) => downscaled.has(number)) ? ' · 页面已降低渲染分辨率' : ''}</p>)}
    {notice && <p className="fw-pdf-status" role="status">{notice}</p>}
    {passwordPrompt && <form className="fw-pdf-password" role="dialog" aria-label="PDF 密码" onSubmit={(event) => { event.preventDefault(); submitPassword(); }}>
      <strong>{passwordPrompt.wrong ? '密码错误，请重试' : '此 PDF 需要密码'}</strong><input type="password" autoFocus autoComplete="off" aria-label="PDF 密码" value={password} onChange={(event) => setPassword(event.target.value)} />
      <div><button type="button" onClick={() => { cancel.current?.abort(); void current.current?.destroy(); setPasswordPrompt(null); setPassword(''); setError('已取消输入密码。需要密码才能打开此 PDF。'); }}>取消</button><button type="submit" disabled={!password}>打开</button></div>
    </form>}
  </section>;
}
