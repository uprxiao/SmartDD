import { useEffect, useRef, useState } from 'react';
import 'pdfjs-dist/web/pdf_viewer.css';
import { pdfRenderPlan, resolveDestinationPage, MAX_CANVAS_PIXELS } from './file-pdf-model.mjs';
import { attachPdfTextSelection } from '../../../src/renderer/features/files/pdf/text-selection';

// 单页真实渲染：画布 + 文本层 + 链接层。只在接近视口时渲染，离开后释放画布；缩放/卸载取消在途任务。
// 画布面积与边长受 file-pdf-model 的上限保护；超限降采样并通过 onPlan 通知。
export function PdfCanvasPage({ engine, doc, run, number, size, zoom, review = false, thumbWidth = 0, onInternalLink, onExternalLink, onPlan, articleRef, className = '', children, ...rest }) {
  const box = useRef(null), canvas = useRef(null), textHost = useRef(null), previousRender = useRef(Promise.resolve());
  const [near, setNear] = useState(false), [links, setLinks] = useState([]), [failure, setFailure] = useState('');
  const effectiveZoom = thumbWidth ? thumbWidth / (size.width * (96 / 72)) * 100 : zoom;
  const plan = pdfRenderPlan(size.width, size.height, effectiveZoom, window.devicePixelRatio || 1);
  useEffect(() => {
    const observer = new IntersectionObserver(entries => setNear(entries.some(e => e.isIntersecting)), { rootMargin: '800px 0px' });
    observer.observe(box.current); return () => observer.disconnect();
  }, []);
  useEffect(() => { onPlan?.(number, plan.downscaled); }, [number, plan.downscaled]);
  useEffect(() => {
    const node = canvas.current;
    if (!near) { node.width = 1; node.height = 1; node.dataset.rendered = 'false'; textHost.current?.replaceChildren(); setLinks([]); setFailure(''); return; }
    let cancelled = false, task = null, textLayer = null, releaseSelection = null;
    const guarded = promise => run ? run(promise) : promise;
    (async () => {
      try {
        await previousRender.current; if (cancelled) return;
        const page = await guarded(doc.getPage(number)); if (cancelled) return;
        const viewport = page.getViewport({ scale: plan.display * plan.ratio });
        node.width = plan.canvasWidth; node.height = plan.canvasHeight;
        task = page.render({ canvasContext: node.getContext('2d'), viewport, canvas: node });
        const rendered = guarded(task.promise);
        previousRender.current = rendered.catch(() => {});
        await rendered; if (cancelled) return;
        node.dataset.rendered = 'true'; setFailure('');
        if (!review && !thumbWidth) {
          const css = page.getViewport({ scale: plan.display });
          textHost.current.replaceChildren(); textHost.current.style.setProperty('--scale-factor', String(plan.display));
          textHost.current.style.setProperty('--total-scale-factor', String(plan.display * page.userUnit));
          textLayer = new engine.TextLayer({ textContentSource: page.streamTextContent(), container: textHost.current, viewport: css });
          await guarded(textLayer.render()); if (cancelled) return;
          releaseSelection = attachPdfTextSelection(textHost.current);
          const found = [];
          for (const a of await guarded(page.getAnnotations())) {
            if (a.subtype !== 'Link') continue;
            const [x1, y1, x2, y2] = engine.Util.normalizeRect(css.convertToViewportRectangle(a.rect));
            const target = a.url ? { url: a.url } : a.dest ? { pageIndex: await guarded(resolveDestinationPage(a.dest, doc.getDestination.bind(doc), doc.getPageIndex.bind(doc))) } : null;
            if (target && (target.url || target.pageIndex !== null)) found.push({ left: x1, top: y1, width: x2 - x1, height: y2 - y1, ...target });
          }
          if (!cancelled) setLinks(found);
        }
      } catch (error) {
        if (cancelled || error?.name === 'RenderingCancelledException' || error?.name === 'AbortException') return;
        node.dataset.rendered = 'error'; setFailure('此页渲染失败');
      }
    })();
    return () => { cancelled = true; releaseSelection?.(); task?.cancel(); textLayer?.cancel(); textHost.current?.replaceChildren(); node.width = 1; node.height = 1; node.dataset.rendered = 'false'; };
  }, [near, doc, run, number, plan.canvasWidth, plan.canvasHeight, plan.display, review, thumbWidth]);
  return <article ref={node => { box.current = node; articleRef?.(node); }} data-page={number} className={className + ' fa-pdf-real'} style={{ width: plan.cssWidth, height: plan.cssHeight }} {...rest}>
    <canvas ref={canvas} className="fa-pdf-canvas" style={{ width: plan.cssWidth, height: plan.cssHeight }} aria-label={'第 ' + number + ' 页'} />
    {!review && !thumbWidth && <div ref={textHost} className="textLayer fa-pdf-text" />}
    {links.map((link, i) => <a key={i} className="fa-pdf-link" href="#" style={{ left: link.left, top: link.top, width: link.width, height: link.height }} aria-label={link.url ? '外部链接 ' + link.url : '跳转到第 ' + (link.pageIndex + 1) + ' 页'} onClick={event => { event.preventDefault(); event.stopPropagation(); link.url ? onExternalLink?.(link.url) : onInternalLink?.(link.pageIndex + 1); }} />)}
    {failure && <p className="fa-pdf-page-error" role="status">{failure}</p>}
    {children}
  </article>;
}
export { MAX_CANVAS_PIXELS };
