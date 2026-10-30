import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Check, Copy, Download, Loader2, Play } from 'lucide-react';
import { rpc } from '@renderer/lib/ipc';
import { FILE_LIMITS } from '@shared/files';
import type { FileBuffer } from '../file-buffer';
import { readFileResource } from '../resource';
import { createNotebookClient, notebookFrameSlots, type NotebookClient } from './client';
import { notebookAssetUrl, notebookRelatedImage } from './assets';
import { frameDocument } from './sanitize';
import type { NotebookCellView, NotebookChoices, NotebookInfo, NotebookOutputView, NotebookWindow, TextPart } from './model';
import './style.css';
import '../../../../shared/markdown-readonly.css';

interface Context { buffer: FileBuffer; client: NotebookClient; scroll: RefObject<HTMLDivElement | null>; choices: NotebookChoices; choose: (patch: NotebookChoices) => void; details: ReadonlySet<string>; setDetail: (key: string, open: boolean) => void }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function FileNotebookPreview({ buffer, onDownload }: { buffer: FileBuffer; onDownload?: () => Promise<void> }) {
  const [session, setSession] = useState<{ client: NotebookClient; info: NotebookInfo } | null>(null), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [downloadError, setDownloadError] = useState('');
  const [choices, setChoices] = useState<NotebookChoices>({}), [view, setView] = useState<NotebookWindow | null>(null), [position, setPosition] = useState({ top: buffer.notebookPosition, height: 800 });
  const [sizes, setSizes] = useState<Map<number, number>>(new Map()), [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<Set<string>>(new Set());
  const setDetail = useCallback((key: string, open: boolean) => setDetails((previous) => { if (previous.has(key) === open) return previous; const next = new Set(previous); open ? next.add(key) : next.delete(key); return next; }), []);
  const scroll = useRef<HTMLDivElement>(null), heights = useRef(new Map<number, number>()), measureFrame = useRef(0);
  const choose = useCallback((patch: NotebookChoices) => setChoices((previous) => ({ offsets: { ...previous.offsets, ...patch.offsets }, htmlPages: { ...previous.htmlPages, ...patch.htmlPages }, raw: { ...previous.raw, ...patch.raw }, outputs: { ...previous.outputs, ...patch.outputs }, outputCounts: { ...previous.outputCounts, ...patch.outputCounts } })), []);
  useEffect(() => {
    const abort = new AbortController(); let client: NotebookClient | null = null;
    setSession(null); setError(''); setDownloadError(''); setView(null); setChoices({}); setCollapsed(new Set()); setDetails(new Set()); heights.current.clear(); setSizes(new Map());
    void (async () => {
      try {
        if (buffer.file.revision.size > FILE_LIMITS.notebook) throw new Error('Notebook 超过 40 MiB 文件上限');
        const bytes = await readFileResource(buffer.file, rpc.files, abort.signal); abort.signal.throwIfAborted();
        client = await createNotebookClient(bytes, buffer.file.name, abort.signal);
        const info = await client.ready; abort.signal.throwIfAborted(); setSession({ client, info });
      } catch (failure) { if (!abort.signal.aborted) setError(errorMessage(failure)); void client?.destroy(); }
    })();
    return () => { abort.abort(); void client?.destroy(); cancelAnimationFrame(measureFrame.current); };
  }, [buffer, buffer.file.revision.hash, attempt]);
  useEffect(() => {
    const node = scroll.current; if (!session || !node) return;
    node.scrollTop = buffer.notebookPosition;
    const observer = new ResizeObserver(() => setPosition({ top: node.scrollTop, height: node.clientHeight })); observer.observe(node); return () => observer.disconnect();
  }, [session, buffer, Boolean(view)]);
  const offsets = useMemo(() => {
    const array = new Float64Array((session?.info.cells ?? 0) + 1);
    for (let i = 0; i < array.length - 1; i++) array[i + 1] = array[i] + (sizes.get(i) ?? 240);
    return array;
  }, [session, sizes]);
  const range = useMemo(() => {
    if (!session?.info.cells) return { start: 0, count: 0 };
    let lo = 0, hi = session.info.cells;
    while (lo < hi) { const middle = (lo + hi) >>> 1; if (offsets[middle + 1] < position.top) lo = middle + 1; else hi = middle; }
    const start = Math.max(0, lo - 2); let end = lo;
    while (end < session.info.cells && end - start < 30 && offsets[end] < position.top + position.height + 500) end++;
    return { start, count: Math.max(1, end - start) };
  }, [session, offsets, position]);
  useEffect(() => {
    if (!session) return;
    let live = true;
    void session.client.window(range.start, range.count, choices).then((result) => { if (live) setView(result); }).catch((failure) => { if (live) setError(errorMessage(failure)); });
    return () => { live = false; };
  }, [session, range.start, range.count, choices]);
  const measure = useCallback((index: number, height: number) => {
    const value = Math.ceil(height) + 16;
    if (heights.current.get(index) === value) return;
    heights.current.set(index, value); cancelAnimationFrame(measureFrame.current);
    measureFrame.current = requestAnimationFrame(() => setSizes(new Map(heights.current)));
  }, []);
  const context: Context | null = session && { buffer, client: session.client, scroll, choices, choose, details, setDetail };
  return <section className="fw-artifact fa-notebook" aria-label="Notebook 只读预览">
    <div className="fw-artifact-tools"><strong title={session?.info.title ?? buffer.file.name}>{session?.info.title ?? buffer.file.name}</strong><small>{session ? `${session.info.cells} 个单元` : 'IPYNB'}</small><span className="fw-push" />{onDownload && <button className="fw-icon" aria-label="下载 Notebook" onClick={() => { setDownloadError(''); void onDownload().catch((failure) => setDownloadError(errorMessage(failure))); }}><Download size={16} /></button>}</div>
    {downloadError && <div className="fw-save-strip" role="alert">Notebook 下载失败：{downloadError}</div>}
    {error ? <div className="fw-empty" role="alert"><h3>无法预览 Notebook</h3><p>{error}</p><button onClick={() => setAttempt((value) => value + 1)}>重新加载</button></div> : !session || !view ? <div className="fw-empty" role="status"><Loader2 size={20} className="animate-spin" />正在解析 Notebook…</div> : <div className="fa-notebook-scroll" ref={scroll} onScroll={(event) => { const node = event.currentTarget; buffer.notebookPosition = node.scrollTop; setPosition({ top: node.scrollTop, height: node.clientHeight }); }}>
      {!session.info.cells ? <div className="fw-empty">This notebook does not contain any cells</div> : <div className="fa-notebook-cells"><div aria-hidden style={{ height: offsets[view.start] }} />{view.cells.map((cell) => <Cell key={cell.index} cell={cell} total={session.info.cells} context={context!} measure={measure} closed={collapsed.has(cell.index)} onToggle={(closed) => setCollapsed((previous) => { if (previous.has(cell.index) === closed) return previous; const next = new Set(previous); closed ? next.add(cell.index) : next.delete(cell.index); return next; })} />)}<div aria-hidden style={{ height: Math.max(0, offsets.at(-1)! - offsets[view.start + view.cells.length]) }} /></div>}
    </div>}
  </section>;
}

function Cell({ cell, total, context, measure, closed, onToggle }: { cell: NotebookCellView; total: number; context: Context; measure: (index: number, height: number) => void; closed: boolean; onToggle: (closed: boolean) => void }) {
  const node = useRef<HTMLDetailsElement>(null);
  useEffect(() => { const element = node.current; if (!element) return; const observer = new ResizeObserver(() => measure(cell.index, element.getBoundingClientRect().height)); observer.observe(element); return () => observer.disconnect(); }, [cell.index, measure]);
  const source = !cell.sourceEmpty ? <Part item={cell.source} context={context} kind={cell.type === 'markdown' ? 'markdown' : 'code'} copy={cell.type !== 'markdown'} label={cell.type === 'raw' ? 'Raw' : 'Code'} /> : <p className="fa-notebook-empty">{cell.type === 'markdown' ? 'Empty Markdown cell' : cell.type === 'raw' ? 'Empty raw cell' : 'Empty code cell'}</p>;
  return <details ref={node} className="fw-notebook-cell fa-notebook-cell" open={!closed} onToggle={(event) => onToggle(!event.currentTarget.open)} data-cell-index={cell.index}>
    <summary><span title={cell.title}>{cell.title}</span><small>Cell {cell.index + 1} of {total}</small>{cell.type === 'code' && <span className="fa-notebook-execution">{cell.executionCount !== null && <small>Run {cell.executionCount}</small>}<span className="fw-notebook-run" title="Running is disabled in read-only preview" aria-hidden><Play size={12} /></span></span>}</summary>
    {!closed && <><div className="fa-notebook-cell-body">{cell.description && <Part item={cell.description} context={context} kind="markdown" />}{cell.sourceCollapsed ? <details className="fa-code-disclosure" open={context.details.has(`source:${cell.index}`)} onToggle={(event) => context.setDetail(`source:${cell.index}`, event.currentTarget.open)}><summary>Code</summary>{source}</details> : source}</div>
      {cell.outputTotal > 0 && <div className="fa-notebook-outputs">{cell.outputs.map((output) => <Output key={output.index} output={output} context={context} />)}{(cell.outputStart > 0 || cell.outputStart + cell.outputs.length < cell.outputTotal) && <div className="fa-notebook-pages"><button disabled={cell.outputStart === 0} onClick={() => context.choose({ outputs: { [cell.index]: Math.max(0, cell.outputStart - 12) } })}>前一组输出</button><span>输出 {cell.outputStart + 1}–{cell.outputStart + cell.outputs.length} / {cell.outputTotal}</span><button disabled={cell.outputStart + cell.outputs.length >= cell.outputTotal} onClick={() => context.choose({ outputs: { [cell.index]: cell.outputStart + Math.max(1, cell.outputs.length) } })}>后一组输出</button></div>}</div>}
    </>}
  </details>;
}
function Output({ output, context }: { output: NotebookOutputView; context: Context }) {
  if (output.asset) return <ImageOutput asset={output.asset} context={context} />;
  const content = output.content && <Part item={output.content} context={context} kind={output.type === 'html' ? 'html' : output.type === 'markdown' ? 'markdown' : 'code'} />;
  if (output.type === 'error' || output.summary) return <div className={output.type === 'error' ? 'fa-notebook-error-output' : 'fa-notebook-summary'}>{output.summary ? <Part item={output.summary} context={context} kind="markdown" /> : <strong>{output.title}</strong>}<details className="fa-raw-output" open={context.details.has(`raw:${output.content?.key ?? output.index}`)} onToggle={(event) => context.setDetail(`raw:${output.content?.key ?? output.index}`, event.currentTarget.open)}><summary>Raw output</summary>{content}</details></div>;
  return <>{content}{output.type === 'html' && output.content && <button className="fa-notebook-raw" onClick={() => context.choose({ raw: { [output.content!.key]: !context.choices.raw?.[output.content!.key] } })}>{context.choices.raw?.[output.content.key] ? 'HTML preview' : 'Raw output'}</button>}</>;
}
function Part({ item, context, kind, copy = false, label = '' }: { item: TextPart; context: Context; kind: 'markdown' | 'code' | 'html'; copy?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const copyText = async () => { setCopyError(''); try { await context.client.copySource(item.key); setCopied(true); } catch (failure) { setCopyError(errorMessage(failure)); } };
  return <div className={kind === 'code' ? 'fa-code-block' : ''}>
    {copy && <header><span>{label}</span><button className="fw-icon" aria-label="Copy code" onClick={() => void copyText()}>{copied ? <Check size={14} /> : <Copy size={14} />}</button></header>}
    {item.deferred ? <p className="fa-notebook-empty">滚动到此内容后可继续查看。</p> : kind === 'html' && item.html !== undefined ? <HtmlOutput key={`${item.key}:${item.htmlPage ?? 0}`} item={item} context={context} /> : item.html ? kind === 'markdown' ? <StaticMarkup html={item.html} context={context} /> : <pre><code className="hljs" dangerouslySetInnerHTML={{ __html: item.html }} /></pre> : <pre className="fa-notebook-output">{item.text}</pre>}
    {item.notice && <p role="status">{item.notice}</p>}{copyError && <p role="alert">复制失败：{copyError}</p>}
    {kind === 'html' && item.html !== undefined ? (item.htmlPages ?? 0) > 1 && <div className="fa-notebook-pages"><button disabled={!item.htmlPage} onClick={() => context.choose({ htmlPages: { [item.key]: (item.htmlPage ?? 0) - 1 } })}>上一段 HTML</button><span>{(item.htmlPage ?? 0) + 1} / {item.htmlPages}</span><button disabled={(item.htmlPage ?? 0) + 1 >= (item.htmlPages ?? 1)} onClick={() => context.choose({ htmlPages: { [item.key]: (item.htmlPage ?? 0) + 1 } })}>下一段 HTML</button></div> : (item.start > 0 || item.end < item.total) && <div className="fa-notebook-pages"><button disabled={!item.start} onClick={() => context.choose({ offsets: { [item.key]: Math.max(0, item.start - 16384) } })}>上一段</button><span>{item.start + 1}–{item.end} / {item.total}</span>{item.total > 49152 && <button disabled={item.end === item.total} onClick={() => context.choose({ offsets: { [item.key]: Math.max(0, item.total - 16384) } })}>末段</button>}<button disabled={item.end === item.total || item.end === item.start} onClick={() => context.choose({ offsets: { [item.key]: item.end } })}>下一段</button></div>}
  </div>;
}
function useVisible(node: RefObject<HTMLElement | null>, scroll: Context['scroll']) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { if (!node.current) return; const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { root: scroll.current, rootMargin: '100px' }); observer.observe(node.current); return () => observer.disconnect(); }, [scroll, node]);
  return visible;
}
function ImageOutput({ asset, context }: { asset: string; context: Context }) {
  const node = useRef<HTMLDivElement>(null), visible = useVisible(node, context.scroll);
  const [preview, setPreview] = useState<{ url: string; downscaled: boolean } | null>(null), [error, setError] = useState('');
  useEffect(() => {
    const abort = new AbortController(); setPreview(null); setError('');
    if (visible) void notebookAssetUrl(context.buffer, () => context.client.asset(asset), abort.signal).then((value) => { if (!abort.signal.aborted) setPreview(value); }).catch((failure) => { if (!abort.signal.aborted) setError(errorMessage(failure)); });
    return () => abort.abort();
  }, [context.client, context.buffer, asset, visible]);
  return <div ref={node} className="fa-notebook-image">{error ? <p role="alert">图片输出无法显示：{error}</p> : preview ? <><img src={preview.url} alt="Notebook output" onError={() => setError('图像解码失败')} />{preview.downscaled && <p>图像已降低预览分辨率，原始文件保持完整。</p>}</> : <p role="status">图像等待显示…</p>}</div>;
}
function HtmlOutput({ item, context }: { item: TextPart; context: Context }) {
  const node = useRef<HTMLDivElement>(null), visible = useVisible(node, context.scroll), deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [document, setDocument] = useState(''), [error, setError] = useState('');
  const assetIds = JSON.stringify(item.assets ?? []);
  useEffect(() => {
    const abort = new AbortController(); let release: (() => void) | undefined; setDocument(''); setError('');
    if (visible) void (async () => {
      try {
        release = await notebookFrameSlots.acquire(abort.signal); abort.signal.throwIfAborted();
        const assets: Record<string, string> = {};
        await Promise.all((JSON.parse(assetIds) as string[]).map(async (id) => { const result = await notebookAssetUrl(context.buffer, () => context.client.asset(id), abort.signal, 'opaque-frame'); assets[id] = result.url; }));
        abort.signal.throwIfAborted(); setDocument(frameDocument(item.html ?? '', assets));
        deadline.current = setTimeout(() => { if (!abort.signal.aborted) { setError('HTML 输出显示超时'); setDocument(''); abort.abort(); release?.(); } }, 2000);
      } catch (failure) { if (!abort.signal.aborted) setError(errorMessage(failure)); release?.(); abort.abort(); }
    })();
    return () => { abort.abort(); release?.(); clearTimeout(deadline.current); };
  }, [context.client, context.buffer, item.html, assetIds, visible]);
  return <div ref={node} className="fa-notebook-html">{error ? <p role="alert">{error}</p> : document ? <iframe title="Notebook HTML output" className="fa-notebook-frame" sandbox="" referrerPolicy="no-referrer" srcDoc={document} onLoad={() => clearTimeout(deadline.current)} /> : <p role="status">HTML 输出等待显示…</p>}</div>;
}
function StaticMarkup({ html, context }: { html: string; context: Context }) {
  const node = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = node.current; if (!element) return;
    const pending = new Map<HTMLImageElement, AbortController>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const image = entry.target as HTMLImageElement;
        if (!entry.isIntersecting) { pending.get(image)?.abort(); pending.delete(image); image.removeAttribute('src'); continue; }
        if (pending.has(image)) continue;
        const abort = new AbortController(); pending.set(image, abort);
        void notebookAssetUrl(context.buffer, () => notebookRelatedImage(context.buffer, context.client, image.dataset.mdSrc ?? '', abort.signal), abort.signal).then(({ url }) => { if (!abort.signal.aborted) image.src = url; }).catch((failure) => { if (!abort.signal.aborted) { image.alt = errorMessage(failure); image.classList.add('fw-md-image-error'); } });
      }
    }, { root: context.scroll.current, rootMargin: '100px' });
    for (const image of element.querySelectorAll<HTMLImageElement>('img[data-md-src]')) { image.removeAttribute('src'); observer.observe(image); }
    return () => { observer.disconnect(); for (const abort of pending.values()) abort.abort(); };
  }, [html, context.client, context.buffer, context.scroll]);
  return <div ref={node} className="fa-static-markdown fw-md-block" onClick={(event) => { if ((event.target as Element).closest('a')) event.preventDefault(); }} dangerouslySetInnerHTML={{ __html: html }} />;
}
