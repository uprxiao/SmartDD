import { useEffect, useRef, useState, type ReactNode, type HTMLAttributes } from 'react';
import type { PDFDocumentProxy, RenderTask, TextLayer } from 'pdfjs-dist';
import type { PdfSession } from './engine';
import { CSS_UNITS, PdfCanvasBudget, pdfRenderPlan, resolveDestinationPage, type PdfPageSize } from './model';
import { attachPdfTextSelection } from './text-selection';

interface PdfLink { left: number; top: number; width: number; height: number; url?: string; page?: number }
export function PdfCanvasPage({ session, doc, number, size, zoom, budget, quota, thumbnail = false, thumbnailSize, review = false, onLink, onPlan, children, articleProps }: {
  session: PdfSession; doc: PDFDocumentProxy; number: number; size: PdfPageSize; zoom: number;
  budget: PdfCanvasBudget; quota: number; thumbnail?: boolean; thumbnailSize?:{width:number;height:number}; review?: boolean;
  onLink?: (target: { page?: number; url?: string }) => void; onPlan?: (page: number, downscaled: boolean) => void; children?: ReactNode;
  articleProps?: HTMLAttributes<HTMLElement>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null), text = useRef<HTMLDivElement>(null), prior = useRef<Promise<unknown>>(Promise.resolve());
  const [links, setLinks] = useState<PdfLink[]>([]), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  const effectiveZoom = thumbnail ? Math.min((thumbnailSize?.width??52) / (size.width * CSS_UNITS), (thumbnailSize?.height??66) / (size.height * CSS_UNITS)) * 100 : zoom;
  const display = pdfRenderPlan(size, effectiveZoom, window.devicePixelRatio || 1, quota);
  useEffect(() => {
    const node = canvas.current!, layer = text.current, owner = {};
    let cancelled = false, render: RenderTask | null = null, textLayer: TextLayer | null = null;
    let releaseSelection: (() => void) | null = null;
    let loaded: Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null = null;
    const clear = () => { releaseSelection?.(); releaseSelection = null; node.width = 0; node.height = 0; layer?.replaceChildren(); budget.release(owner); };
    setLinks([]); setError('');
    const work = (async () => {
      await prior.current;
      if (cancelled) return;
      try {
        const page = await session.run(doc.getPage(number)); loaded = page;
        if (cancelled) return;
        const plan = budget.take(owner, size, effectiveZoom, window.devicePixelRatio || 1, quota);
        if (!plan) throw new Error('画布额度暂不可用，请重试');
        onPlan?.(number, plan.downscaled);
        node.width = plan.canvasWidth; node.height = plan.canvasHeight;
        // Form appearances are painted into the canvas. There are no editable
        // controls, document scripts, or annotation actions in the app DOM.
        render = page.render({ canvas: node, viewport: page.getViewport({ scale: plan.display * plan.ratio }), annotationMode: session.engine.AnnotationMode.ENABLE });
        await session.run(render.promise);
        if (cancelled) return;
        node.dataset.rendered = 'true';
        if (review || thumbnail || !layer) return;
        const viewport = page.getViewport({ scale: plan.display });
        layer.style.setProperty('--scale-factor', String(plan.display));
        layer.style.setProperty('--total-scale-factor', String(plan.display * page.userUnit));
        textLayer = new session.engine.TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        await session.run(textLayer.render());
        if (cancelled) return;
        releaseSelection = attachPdfTextSelection(layer);
        const found: PdfLink[] = [];
        for (const annotation of await session.run(page.getAnnotations({ intent: 'display' }))) {
          if (cancelled) return;
          if (annotation.subtype !== 'Link') continue;
          const [x1, y1, x2, y2] = session.engine.Util.normalizeRect(viewport.convertToViewportRectangle(annotation.rect));
          const rect = { left: x1, top: y1, width: x2 - x1, height: y2 - y1 };
          if (annotation.url || annotation.unsafeUrl) found.push({ ...rect, url: String(annotation.url || annotation.unsafeUrl) });
          else {
            const destination = await session.run(resolveDestinationPage(annotation.dest, doc));
            if (destination !== null && destination < doc.numPages) found.push({ ...rect, page: destination + 1 });
          }
        }
        if (!cancelled) setLinks(found);
      } catch (failure) {
        if (!cancelled) { clear(); node.dataset.rendered = 'error'; setError(failure instanceof Error ? failure.message : '此页渲染失败'); }
      } finally {
        if (cancelled) loaded?.cleanup();
      }
    })();
    // Serialize rerenders of this canvas; never start a new render while its
    // cancelled predecessor still owns it.
    prior.current = work.catch(() => undefined);
    return () => { cancelled = true; render?.cancel(); textLayer?.cancel(); clear(); node.dataset.rendered = 'false'; loaded?.cleanup(); };
  }, [session, doc, number, size.width, size.height, effectiveZoom, budget, quota, thumbnail, review, retry, onPlan]);
  return <article {...articleProps} className={`fw-pdf-page ${thumbnail ? 'fw-pdf-thumb' : ''}`} data-page={number} style={{ width: display.cssWidth, height: display.cssHeight }}>
    <canvas ref={canvas} className="fw-pdf-canvas" width={0} height={0} style={{ width: display.cssWidth, height: display.cssHeight }} aria-label={`第 ${number} 页`} />
    {!review && !thumbnail && <div ref={text} className="fw-pdf-text textLayer" />}
    {links.map((link, index) => <a key={index} href="#" className="fw-pdf-link" style={{ left: link.left, top: link.top, width: link.width, height: link.height }} aria-label={link.url ? `外部链接 ${link.url}` : `跳转到第 ${link.page} 页`} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onLink?.(link); }} />)}
    {error && <p className="fw-pdf-page-error" role="alert">{error}<button onClick={() => setRetry((value) => value + 1)}>重试此页</button></p>}
    {children}
  </article>;
}
