import { composing as imeComposing } from './file-ime.mjs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, Download, List, MessageSquare, Trash2, X } from 'lucide-react';
import { PdfCanvasPage } from './FilePdfCanvas';
import { createPdfSession } from './file-pdf-engine.mjs';
import { classifyPdfError, fitWidthZoom, resolveDestinationPage, pdfPageWindow, pdfDeliveryResult, beginPdfDelivery, finishPdfDeliveryItem, stopPdfDelivery } from './file-pdf-model.mjs';
import { initialPdfComments, pdfPoint, pdfRegion, removePdfComment, savePdfComment } from './file-artifact-model.mjs';
import './file-artifact.css';
import { bindPdfWheel } from '../../../src/renderer/features/files/pdf/wheel.mjs';

const PAGE = { width: 600, height: 780 };
const clampPage = (page, total) => Math.max(1, Math.min(total, Number.isFinite(page) ? Math.trunc(page) : 1));
const clampZoom = value => Math.max(30, Math.min(800, value));
const pageTitles = ['文件浏览工作区', '交互与状态', '验收与交付'];

export function FilePdfPreview({ kind, onDownload = () => {}, initialPage = 1, onPageChange, path = 'synthetic.pdf', hostOptions = {}, onStateChange, onInsertContext }) {
  const review = kind === 'pdf-review';
  const [source, setSource] = useState(hostOptions.pdfSource || (kind === 'tex' ? 'synthetic' : 'normal')), real = source !== 'synthetic';
  const [pdf, setPdf] = useState({ status: 'loading' }), [reloadKey, setReloadKey] = useState(0), [passwordPrompt, setPasswordPrompt] = useState(null), [password, setPassword] = useState(''), [downscaled, setDownscaled] = useState(() => new Set());
  const task = useRef(null), passwordCancelled = useRef(false);
  const total = real ? (pdf.pages?.length || 1) : hostOptions.pageCount === 1 ? 1 : 3;
  const sizeOf = number => real && pdf.pages?.[number - 1] ? pdf.pages[number - 1] : PAGE;
  const [page, setPage] = useState(clampPage(initialPage, total)), [zoom, setZoom] = useState(100), [zoomMenu, setZoomMenu] = useState(false);
  const [zooming, setZooming] = useState(false);
  const [docked, setDocked] = useState(false), [annotation, setAnnotation] = useState(false);
  const [enabled, setEnabled] = useState(hostOptions.annotationsEnabled !== false), [batching, setBatching] = useState(!!hostOptions.annotationBatchingEnabled);
  const [syntheticLoadState, setLoadState] = useState(hostOptions.pdfStatus || 'ready'), [failureNext, setFailureNext] = useState(false), [retryKey, setRetryKey] = useState(0);
  const [comments, setComments] = useState(() => initialPdfComments(path)), [draft, setDraft] = useState(null), [body, setBody] = useState(''), [drawing, setDrawing] = useState(null);
  const [notice, setNotice] = useState(''), [cardPosition, setCardPosition] = useState({ top: 80, left: 30 });
  const root = useRef(null), scroll = useRef(null), pages = useRef([]), drag = useRef(null), zoomValue = useRef(100), timer = useRef(null), editor = useRef(null), currentComments = useRef(comments);
  currentComments.current = comments;
  const [viewport, setViewport] = useState({ top: 0, height: 800 });
  const windowed = useMemo(() => pdfPageWindow(pdf.pages || [], zoom, viewport.top, viewport.height), [pdf.pages, zoom, viewport]);
  const virtual = real && !review && total > 40;
  const renderedNumbers = review ? [page] : virtual ? windowed.numbers : Array.from({ length: total }, (_, i) => i + 1);
  const loadState = real ? (pdf.status === 'ready' ? 'ready' : pdf.status === 'error' ? 'error' : 'loading') : syntheticLoadState;
  const changePage = value => { const next = clampPage(value, total); setPage(next); onPageChange?.(next); };
  const zoomTo = value => { const next = clampZoom(value); zoomValue.current = next; setZoom(next); };
  const goto = value => {
    const next = clampPage(value, total); changePage(next);
    if (!review) { if (virtual) scroll.current?.scrollTo({ top: windowed.offsets[next - 1], behavior: 'auto' }); else pages.current[next - 1]?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!real) return;
    let cancelled = false, session = null;
    passwordCancelled.current = false; setPdf({ status: 'loading' }); setPasswordPrompt(null); setPassword('');
    setDownscaled(new Set()); setPage(1); setViewport({ top: 0, height: 800 }); pages.current = [];
    const reportError = error => {
      const info = classifyPdfError(error);
      if (cancelled || passwordCancelled.current || info.kind === 'aborted') return;
      setPasswordPrompt(null); setPdf({ status: 'error', kind: info.kind, message: info.message || '无法渲染 PDF。' });
    };
    (async () => {
      try {
        session = await createPdfSession({ url: '/assets/m9-pdf/' + source + '.pdf', onFailure: reportError,
          onPassword: (update, reason, engine) => { if (!cancelled) { setPasswordPrompt({ update, wrong: reason === engine.PasswordResponses.INCORRECT_PASSWORD }); setPassword(''); } } });
        if (cancelled) { await session.destroy(); return; }
        task.current = session;
        const doc = await session.ready; if (cancelled) return;
        setPasswordPrompt(null);
        const sizes = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await session.run(doc.getPage(i)); if (cancelled) return;
          const view = page.getViewport({ scale: 1 }); sizes.push({ width: view.width, height: view.height }); page.cleanup();
          if (i % 32 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        }
        const titles = {};
        for (const item of (await session.run(doc.getOutline())) || []) { const index = await session.run(resolveDestinationPage(item.dest, doc.getDestination.bind(doc), doc.getPageIndex.bind(doc))); if (index !== null && !titles[index + 1]) titles[index + 1] = item.title; }
        if (!cancelled) setPdf({ status: 'ready', engine: session.engine, run: session.run, doc, pages: sizes, titles });
      } catch (error) { reportError(error); await session?.destroy(); }
    })();
    return () => { cancelled = true; void session?.destroy(); if (task.current === session) task.current = null; };
  }, [real, source, reloadKey]);
  useEffect(() => {
    if (!real || pdf.status !== 'ready' || review) return;
    const frame = requestAnimationFrame(() => { const width = scroll.current?.clientWidth; if (width) zoomTo(fitWidthZoom(pdf.pages[0].width, width - 48)); });
    return () => cancelAnimationFrame(frame);
  }, [real, pdf.status, source]);
  useEffect(() => { onStateChange?.({ route: review ? 'review-pdf' : 'artifact-pdf', page, zoom, annotation, batching, loadState, comments, draftActive: !!draft }); }, [review, page, zoom, annotation, batching, loadState, comments, draft, onStateChange]);
  useEffect(() => {
    setZooming(false);
    if (review || loadState !== 'ready' || !scroll.current) return;
    return bindPdfWheel(scroll.current, { getZoom: () => zoomValue.current, setZoom: zoomTo, onZooming: setZooming });
  }, [review, loadState, source, path, reloadKey]);
  useEffect(() => {
    if (review || loadState !== 'ready' || !scroll.current) return;
    const ratios = new Map();
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => ratios.set(Number(entry.target.dataset.page), entry.intersectionRatio));
      const visible = [...ratios].sort((a, b) => b[1] - a[1])[0];
      if (visible?.[1] > 0) { setPage(visible[0]); onPageChange?.(visible[0]); }
    }, { root: scroll.current, threshold: [0, .1, .25, .5, .75, 1] });
    pages.current.filter(Boolean).forEach(node => observer.observe(node));
    return () => observer.disconnect();
  }, [review, loadState, retryKey, total, onPageChange, windowed.numbers[0], windowed.numbers.at(-1)]);
  useEffect(() => {
    if (!draft || !root.current) return;
    const place = () => {
      const pageRect = pages.current[draft.page - 1]?.getBoundingClientRect(), hostRect = root.current.getBoundingClientRect();
      if (!pageRect) return;
      const anchor = draft.anchor.kind === 'region' ? { x: draft.anchor.rect.x + draft.anchor.rect.width, y: draft.anchor.rect.y } : draft.anchor.point;
      const size = draft.pageSize || PAGE;
      setCardPosition({ left: Math.max(8, Math.min(hostRect.width - 292, pageRect.left - hostRect.left + anchor.x / size.width * pageRect.width + 8)),
        top: Math.max(48, Math.min(hostRect.height - 230, pageRect.top - hostRect.top + anchor.y / size.height * pageRect.height)) });
    };
    place(); editor.current?.focus(); scroll.current?.addEventListener('scroll', place, { passive: true }); window.addEventListener('resize', place);
    return () => { scroll.current?.removeEventListener('scroll', place); window.removeEventListener('resize', place); };
  }, [draft, zoom]);

  useEffect(() => { clearTimeout(timer.current); setComments(initialPdfComments(path + ':' + source)); setDraft(null); setBody(''); setNotice(''); return () => { currentComments.current = stopPdfDelivery(currentComments.current); }; }, [path, source]);

  function startDraft(value) {
    if (comments.phase === 'inserting') return;
    if (draft && body.trim() && value.id !== draft.id) { setNotice('当前评论尚未保存，请先添加或取消。'); return; }
    setDraft(value); setBody(value.body || ''); setNotice('');
  }
  function pointerDown(event, number) {
    if (review || !enabled || !annotation || comments.phase === 'inserting' || event.button !== 0 ||
      event.target.closest('button,a,input,textarea,p,h1,h2,small,.textLayer span')) return;
    event.preventDefault();
    window.getSelection()?.removeAllRanges();
    const point = pdfPoint({ x: event.clientX, y: event.clientY }, event.currentTarget.getBoundingClientRect(), sizeOf(number));
    drag.current = { number, start: point, element: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrawing({ page: number, rect: pdfRegion(point, point, sizeOf(number)) });
  }
  function pointerMove(event) {
    if (!drag.current) return;
    const { start, number, element } = drag.current;
    const point = pdfPoint({ x: event.clientX, y: event.clientY }, element.getBoundingClientRect(), sizeOf(number));
    setDrawing({ page: number, rect: pdfRegion(start, point, sizeOf(number)) });
  }
  function pointerUp(event) {
    const active = drag.current;
    if (!active) return;
    drag.current = null; setDrawing(null);
    const point = pdfPoint({ x: event.clientX, y: event.clientY }, active.element.getBoundingClientRect(), sizeOf(active.number));
    const rect = pdfRegion(active.start, point, sizeOf(active.number));
    if (!rect) return;
    startDraft({ page: active.number, pageSize: sizeOf(active.number), anchor: rect.width > 3 && rect.height > 3 ? { kind: 'region', rect } : { kind: 'point', point } });
  }
  function captureText(event, number) {
    if (review || !enabled || !annotation || drag.current || comments.phase === 'inserting') return;
    const selection = window.getSelection();
    if (!selection?.toString().trim() || !selection.rangeCount) return;
    const range = selection.getRangeAt(0), pageNode = event.currentTarget;
    if (!pageNode.contains(range.startContainer) || !pageNode.contains(range.endContainer)) return;
    const pageRect = pageNode.getBoundingClientRect();
    const boxes = [...range.getClientRects()].filter(rect => rect.width && rect.height).map(rect => pdfRegion(
      pdfPoint({ x: rect.left, y: rect.top }, pageRect, sizeOf(number)), pdfPoint({ x: rect.right, y: rect.bottom }, pageRect, sizeOf(number)), sizeOf(number)));
    if (!boxes.length) return;
    const rect = pdfRegion({ x: Math.min(...boxes.map(x => x.x)), y: Math.min(...boxes.map(x => x.y)) },
      { x: Math.max(...boxes.map(x => x.x + x.width)), y: Math.max(...boxes.map(x => x.y + x.height)) }, sizeOf(number));
    startDraft({ page: number, pageSize: sizeOf(number), anchor: { kind: 'region', rect, selectionKind: 'text', selectedText: selection.toString(), selectionRects: boxes } });
  }
  async function send(state = currentComments.current) {
    const pending = beginPdfDelivery(state);
    if (pending === state) return;
    currentComments.current = pending; setComments(pending);
    setNotice(onInsertContext ? '正在插入评论上下文，不会自动回车。' : '正在模拟插入上下文，不调用模型。');
    const failed = failureNext; setFailureNext(false);
    for (const id of pending.pendingIds) {
      if (currentComments.current.operation !== pending.operation || currentComments.current.scope !== pending.scope) return;
      const item = pending.requests.find(value => value.id === id);
      const inserting = { ...currentComments.current, requests: currentComments.current.requests.map(value => value.id === id ? { ...value, delivery: 'inserting' } : value) };
      currentComments.current = inserting; setComments(inserting);
      const text = `${path} · 第 ${item.page} 页\n${item.anchor.selectedText || ''}\n评论：${item.body}`.trim();
      let result;
      try { result = onInsertContext ? await onInsertContext(text, { source: 'pdf-comment', path, commentId: id, page: item.page, anchor: item.anchor }) : await new Promise(resolve => { timer.current = setTimeout(() => resolve({ status: failed ? 'failed' : 'inserted' }), 250); }); }
      catch { result = { status: 'failed' }; }
      if (currentComments.current.operation !== pending.operation || currentComments.current.scope !== pending.scope) return;
      const status = pdfDeliveryResult(result), next = finishPdfDeliveryItem(currentComments.current, pending.operation, id, status);
      currentComments.current = next; setComments(next);
      setNotice(status === 'inserted' ? '评论上下文已插入（不回车），不代表 CLI 已读取或执行；PDF 未修改。' : next.error);
      if (status !== 'inserted') break;
    }
  }
  function submit() {
    if (!draft || !body.trim()) return;
    const next = { ...savePdfComment(comments, { ...draft, body }), phase: 'idle' };
    setComments(next); setDraft(null); setBody('');
    if (!batching) send(next);
  }
  const boxStyle = (rect, number) => { const size = sizeOf(number); return { left: rect.x / size.width * 100 + '%', top: rect.y / size.height * 100 + '%', width: rect.width / size.width * 100 + '%', height: rect.height / size.height * 100 + '%' }; };
  const annotationRect = item => item.anchor.kind === 'region' ? item.anchor.rect : { ...item.anchor.point, width: 1, height: 1 };
  const visibleComments = comments.requests;
  const locked = comments.phase === 'inserting';

  return <div ref={root} data-zooming={zooming} className={'fw-artifact fw-pdf fa-pdf ' + (review ? 'fw-pdf-review' : '')} onKeyDown={event => {
    if (imeComposing(event) || event.key !== 'Escape') return;
    event.stopPropagation(); setZoomMenu(false);
    if (draft) { if (body.trim()) setNotice('评论草稿已保留；添加或取消后可退出评论模式。'); else setDraft(null); }
    else setAnnotation(false);
  }}>
    {review ? total > 1 && <div className="fw-pdf-pager"><button aria-label="上一页" disabled={page === 1} onClick={() => goto(page - 1)}><ArrowLeft size={16} /></button><span>{page} / {total}</span><button aria-label="下一页" disabled={page === total} onClick={() => goto(page + 1)}><ArrowRight size={16} /></button></div> : <div className="fw-artifact-tools">
      <span className="fw-push" /><div className="fw-zoom-control"><button aria-label="PDF 缩放" aria-expanded={zoomMenu} onClick={() => setZoomMenu(!zoomMenu)}>{Math.round(zoom)}% <ChevronDown size={12} /></button>{zoomMenu && <div className="fw-zoom-menu" role="menu">{[25, 50, 100, 150, 200].map(value => <button key={value} role="menuitemradio" aria-checked={zoom === value} onClick={() => { zoomTo(value); setZoomMenu(false); }}>{zoom === value ? <Check size={12} /> : <span />}{value}%</button>)}<button role="menuitem" onClick={() => { zoomTo(real && pdf.pages ? fitWidthZoom(pdf.pages[0].width, (scroll.current?.clientWidth || 648) - 48) : Math.min(100, ((scroll.current?.clientWidth || 648) - 48) / PAGE.width * 100)); setZoomMenu(false); }}>适合宽度</button></div>}</div>
      <button className="fw-icon" aria-label="下载文档示例" onClick={onDownload}><Download size={16} /></button>{enabled && <button className={'fw-icon ' + (annotation ? 'active' : '')} aria-label="PDF 评论" aria-pressed={annotation} disabled={locked || loadState !== 'ready'} onClick={() => { if (draft && body.trim()) setNotice('请先添加或取消当前草稿。'); else { setDraft(null); setAnnotation(!annotation); } }}><MessageSquare size={16} /></button>}
    </div>}
    {loadState !== 'ready' ? <div className="fw-empty" role={loadState === 'error' ? 'alert' : 'status'}>{loadState === 'loading' ? <><span className="fw-loading" />{real ? '正在载入 PDF' : '正在载入 PDF 示例'}</> : <><h3>PDF 页面渲染失败</h3><p>{real ? pdf.message : '原型模拟失败，原始文件没有被修改。'}原始文件没有被修改。</p><button onClick={() => { if (real) setReloadKey(x => x + 1); else { setLoadState('ready'); setRetryKey(x => x + 1); } }}>重试</button></>}</div> : <div className="fw-artifact-main">
      {!review && total > 1 && <nav className={'fw-thumbnails ' + (docked ? 'docked' : 'undocked')} aria-label="PDF 页面缩略图"><button className="fw-dock-thumbnails" aria-label={docked ? '取消停靠缩略图' : '停靠缩略图'} onClick={() => setDocked(!docked)}><List size={12} /><span className="fw-thumbnail-dock-label">{docked ? '取消停靠' : '停靠缩略图'}</span></button>{Array.from({ length: total }, (_, i) => i + 1).map(number => <button key={number} aria-label={'第 ' + number + ' 页'} title={real && pdf.titles?.[number] ? '第 ' + number + ' 页 · ' + pdf.titles[number] : undefined} aria-current={number === page ? 'page' : undefined} onClick={() => goto(number)}>{real && (!virtual || Math.abs(number - page) <= 4) ? <PdfCanvasPage engine={pdf.engine} doc={pdf.doc} run={pdf.run} number={number} size={sizeOf(number)} zoom={100} thumbWidth={52} review className="fa-pdf-thumb" /> : null}<span>{real ? (pdf.titles?.[number] || '') : pageTitles[number - 1]}</span><small>{number}</small></button>)}</nav>}
      <div className="fw-artifact-scroll fa-pdf-scroll" ref={scroll} onScroll={event => { if (virtual) setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight }); }}>{virtual && <div aria-hidden="true" style={{ height: windowed.before, flexShrink: 0 }} />}{renderedNumbers.map(number => real ? <PdfCanvasPage key={source + number} engine={pdf.engine} doc={pdf.doc} run={pdf.run} number={number} size={sizeOf(number)} zoom={review ? 100 : zoom} review={review} articleRef={node => { pages.current[number - 1] = node; }} className={'fw-paper fw-pdf-page ' + (annotation && !review ? 'fa-annotation-mode' : '')} onInternalLink={goto} onExternalLink={url => setNotice('外部链接入口（原型不导航）：' + url)} onPlan={(n, flag) => setDownscaled(previous => { if (previous.has(n) === flag) return previous; const next = new Set(previous); flag ? next.add(n) : next.delete(n); return next; })} onPointerDown={event => pointerDown(event, number)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; setDrawing(null); }} onMouseUp={event => captureText(event, number)}>
        {!review && visibleComments.filter(item => item.page === number).map(item => <button key={item.id} className="fa-pdf-marker" style={{ left: annotationRect(item).x / sizeOf(number).width * 100 + '%', top: annotationRect(item).y / sizeOf(number).height * 100 + '%' }} aria-label={'PDF 评论 ' + (visibleComments.indexOf(item) + 1)} onClick={() => startDraft(item)}>{visibleComments.indexOf(item) + 1}</button>)}
        {!review && draft?.page === number && draft.anchor.kind === 'region' && <span className="fa-pdf-region" style={boxStyle(draft.anchor.rect, number)} />}{drawing?.page === number && <span className="fa-pdf-region" style={boxStyle(drawing.rect, number)} />}
      </PdfCanvasPage> : <article key={number} data-page={number} ref={node => { pages.current[number - 1] = node; }} className={'fw-paper fw-pdf-page ' + (annotation && !review ? 'fa-annotation-mode' : '')} style={{ zoom: review ? 1 : zoom / 100, userSelect: review ? 'none' : 'text' }} onPointerDown={event => pointerDown(event, number)} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; setDrawing(null); }} onMouseUp={event => captureText(event, number)}>
        <small>{kind === 'tex' ? 'TeX → PDF' : review ? 'Review PDF · canvas 路由模拟' : 'PDF'} · 第 {number} 页</small><h1>{pageTitles[number - 1]}</h1><p>项目维护根目录；会话保存面板与标签状态；文件身份由宿主与路径共同确定。</p><p>文件保存时检查外部变化。冲突需要保留草稿，不能直接覆盖。</p>{!review && <button className="text-button" onClick={() => goto(number === total ? 1 : number + 1)}>文档内部链接：第 {number === total ? 1 : number + 1} 页</button>}
        <div className="fa-pdf-blank" aria-label={'第 ' + number + ' 页区域选择画布'}>{annotation && !review && <span>可选中文字，或在留白处拖出区域／点击放置评论。</span>}</div><p className="fw-codec-note">合成页面，未解析实际 PDF；{review ? '此路线不提供文本层、链接层或评论。' : '评论是任务上下文，不会写入 PDF。'}</p>
        {!review && visibleComments.filter(item => item.page === number).map(item => <button key={item.id} className="fa-pdf-marker" style={{ left: annotationRect(item).x / PAGE.width * 100 + '%', top: annotationRect(item).y / PAGE.height * 100 + '%' }} aria-label={'PDF 评论 ' + (visibleComments.indexOf(item) + 1)} onClick={() => startDraft(item)}>{visibleComments.indexOf(item) + 1}</button>)}
        {!review && draft?.page === number && draft.anchor.kind === 'region' && <span className="fa-pdf-region" style={boxStyle(draft.anchor.rect, number)} />}{drawing?.page === number && <span className="fa-pdf-region" style={boxStyle(drawing.rect, number)} />}
      </article>)}{virtual && <div aria-hidden="true" style={{ height: windowed.after, flexShrink: 0 }} />}</div>
    </div>}
    {!review && draft && <section className="fa-pdf-editor" style={cardPosition} aria-label="PDF 评论编辑器"><header><strong>第 {draft.page} 页 · {draft.anchor.selectionKind === 'text' ? '所选文字' : draft.anchor.kind === 'region' ? '所选区域' : '所选位置'}</strong><button className="fw-icon" aria-label="取消 PDF 评论草稿" onClick={() => { setDraft(null); setBody(''); }}><X size={14} /></button></header>{draft.anchor.selectedText && <blockquote>{draft.anchor.selectedText}</blockquote>}<textarea ref={editor} aria-label="PDF 评论内容" placeholder="添加评论…" value={body} onChange={event => setBody(event.target.value)} /><div className="fa-pdf-editor-actions">{draft.id && <button aria-label="删除 PDF 评论" onClick={() => { setComments(value => removePdfComment(value, draft.id)); setDraft(null); setBody(''); }}><Trash2 size={14} /></button>}<button onClick={() => { setDraft(null); setBody(''); }}>取消</button><button disabled={!body.trim() || locked} onClick={submit}>{draft.id ? '保存' : batching ? '添加' : '插入上下文'}{!onInsertContext && '（模拟）'}</button></div></section>}
    {!review && loadState === 'ready' && enabled && batching && (annotation || comments.requests.length || comments.phase === 'inserted') && <div className="fa-pdf-batch" role="region" aria-label="PDF 评论批处理">
      <span>{locked ? '正在插入上下文' : comments.requests.length ? comments.requests.length + ' 条评论' : comments.phase === 'inserted' ? '评论上下文已插入' : '选择内容并提出修改'}</span>
      {comments.requests.length > 0 && !locked && <><button aria-label="上一个 PDF 评论" onClick={() => { const current = comments.requests.findIndex(item => item.id === draft?.id); const item = comments.requests[(current - 1 + comments.requests.length) % comments.requests.length]; goto(item.page); startDraft(item); }}><ArrowLeft size={14} /></button><button aria-label="下一个 PDF 评论" onClick={() => { const current = comments.requests.findIndex(item => item.id === draft?.id); const item = comments.requests[(current + 1) % comments.requests.length]; goto(item.page); startDraft(item); }}><ArrowRight size={14} /></button></>}
      {locked ? <button onClick={() => { clearTimeout(timer.current); currentComments.current = stopPdfDelivery(currentComments.current); setComments(currentComments.current); setNotice('已停止等待，结果未知；不会停止或撤回 CLI。'); }}>停止等待</button> : <><button disabled={!!draft && !!body.trim()} onClick={() => { setComments(value => ({ ...stopPdfDelivery(value), requests: [], phase: 'idle' })); setAnnotation(false); setDraft(null); }}>取消</button><button disabled={!comments.requests.some(item => !['inserted', 'unknown'].includes(item.delivery)) || !!draft} onClick={() => send()}>{comments.phase === 'failed' ? '重试插入' : '插入上下文'}{!onInsertContext && '（模拟）'}</button></>}
    </div>}
    {loadState === 'ready' && comments.phase === 'failed' && !batching && <div className="fa-pdf-batch"><span>{comments.error}</span><button onClick={() => send()}>重试插入上下文</button></div>}
    {passwordPrompt && <section className="fa-pdf-password" role="dialog" aria-label="PDF 密码" onKeyDown={event => { if (event.key === 'Enter' && password) { event.preventDefault(); passwordPrompt.update(password); setPassword(''); } }}>
      <strong>{passwordPrompt.wrong ? '密码错误，请重试' : '此 PDF 需要密码'}</strong><input type="password" autoFocus aria-label="PDF 密码" value={password} onChange={event => setPassword(event.target.value)} /><small>演示样本的密码是 m9-user（不是真实凭据）。</small>
      <div><button onClick={() => { passwordCancelled.current = true; task.current?.destroy(); task.current = null; setPasswordPrompt(null); setPdf({ status: 'error', kind: 'password', message: '需要密码才能打开此 PDF。' }); }}>取消</button><button disabled={!password} onClick={() => { passwordPrompt.update(password); setPassword(''); }}>打开</button></div>
    </section>}
    {downscaled.size > 0 && <p className="fa-artifact-status" role="status">页面尺寸过大，已降低渲染分辨率以保护内存（第 {[...downscaled].join('、')} 页）。</p>}
    {comments.requests.some(item => item.delivery) && <p className="fa-artifact-status" role="status" data-pdf-delivery>{comments.requests.map((item, index) => `${index + 1}: ${item.delivery || 'idle'}`).join(' · ')}</p>}
    {(notice || comments.error) && <p className="fa-artifact-status" role="status">{comments.error || notice}</p>}
    <details className="fa-fixture-controls"><summary>M9 PDF 场景</summary><label>文档来源<select aria-label="PDF 文档来源" value={source} onChange={event => { setSource(event.target.value); setDraft(null); setDrawing(null); setAnnotation(false); }}>{[['normal', '真实 PDF：3 页中文，含链接/大纲'], ['encrypted', '真实 PDF：需要密码'], ['truncated', '真实 PDF：截断损坏'], ['garbage', '真实 PDF：随机字节'], ['bigpage', '真实 PDF：14400×14400pt 超大页'], ['r34-large', '真实 PDF：2000页合成压力样本'], ['r34-cjk', '真实 PDF：非嵌入CJK字体'], ['synthetic', '合成页（原型原有，不解析 PDF）']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{!real && <label>载入状态（仅合成页）<select aria-label="PDF 示例载入状态" value={loadState} onChange={event => { setLoadState(event.target.value); setDraft(null); setDrawing(null); }}>{[['ready', '正常'], ['loading', '载入中'], ['error', '渲染失败']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}{!review && <><label><input type="checkbox" checked={enabled} disabled={locked || !!draft} onChange={event => { setEnabled(event.target.checked); if (!event.target.checked) setAnnotation(false); }} />annotations_enabled</label><label><input type="checkbox" checked={batching} disabled={locked || !!draft || comments.requests.length > 0} onChange={event => setBatching(event.target.checked)} />annotation_batching_enabled</label><label><input type="checkbox" checked={failureNext} onChange={event => setFailureNext(event.target.checked)} />下次发送失败</label></>}<p>真实来源由 pdf.js 解析（只读，不写入 PDF）；评论仅交接上下文，不自动回车、不追踪CLI完成、不写回PDF；未接终端回调时明确模拟。非嵌入CJK字形依赖系统字体。Review 与 artifact 路线分别验收。</p></details>
  </div>;
}
