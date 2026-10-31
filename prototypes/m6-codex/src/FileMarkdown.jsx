import { composing as imeComposing } from './file-ime.mjs';
import { fileLinkLocation } from '../../../src/shared/file-link-location.mjs';
import { RoutedImageGallery as ImageGallery } from './ImageGalleryRoute.jsx';
import { downloadImageCopy } from './image-download.mjs';
import { markdownImageMenuAllowed } from '../../../src/shared/image-menu-policy.mjs';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileMarkdownSource } from './FileMarkdownSource.jsx';
import { ArrowLeft, ArrowRight, Download, X, ZoomIn, ZoomOut, Copy, Check } from 'lucide-react';
import 'katex/dist/katex.min.css';
import { parseMarkdown, renderMarkdownBlock, standaloneImage, codeBody, highlightedCode, parseFrontmatter, safeImageSrc, replaceMarkdownBlock, resolveMarkdownPath, imageMenuActions, fitImage, stepImageZoom, anchoredImageZoom, scaleWheelDelta } from './file-markdown-model.mjs';
import './file-markdown.css';
import { domSourcePoint, sourceRange } from './file-markdown-source.mjs';
import { renderThemedMermaid } from './file-markdown-mermaid.mjs';
import { createMarkdownMathBudget, createMarkdownMathSession, hydrateMarkdownMath } from '../../../src/shared/markdown-math-session.mjs';
import { markdownLinkAllowed, markdownNativeSelection, waitMarkdownMouseup } from '../../../src/shared/markdown-events.mjs';

// Explicit prototype metadata examples; image decoding keeps its original source.
const imageMenuSourceExamples = {
  'host-mismatch': { originHost: 'another-local' },
  'src-data-display-https': { src: 'data:image/png;base64,AA==', displaySrc: 'https://example.invalid/display.png' },
  'src-http-display-https': { src: 'http://example.invalid/source.png', displaySrc: 'https://example.invalid/display.png' },
  'src-file': { src: 'file:///synthetic/menu.png' },
  'src-data': { src: 'data:image/png;base64,AA==' },
  'src-invalid': { src: 'http://' },
  'src-invalid-display-https': { src: 'http://', displaySrc: 'https://example.invalid/display.png' },
};

// Markdown editor over markdown-it tokens. Source offsets stay authoritative: a block is edited as its own source text and
// only that range is replaced; rendered HTML is never parsed back into Markdown.
function highlight(root, query) {
  const needle = query.toLowerCase(), walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentElement.closest('.katex,.katex-display,script,style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const value = node.nodeValue, lower = value.toLowerCase(); let start = 0, index = lower.indexOf(needle); if (index < 0) continue;
    const fragment = document.createDocumentFragment();
    while (index >= 0) { fragment.append(value.slice(start, index)); const mark = document.createElement('mark'); mark.textContent = value.slice(index, index + needle.length); fragment.append(mark); start = index + needle.length; index = lower.indexOf(needle, start); }
    fragment.append(value.slice(start)); node.replaceWith(fragment);
  }
}
function MdHtml({ html, find, raw, math, budget, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => { const root = ref.current; root.innerHTML = html; if (find) highlight(root, find); const abort = new AbortController(), release = hydrateMarkdownMath(root, math, abort.signal, { budget, baseUnits: html.length, overflow: () => { root.textContent = raw; } }); return () => { abort.abort(); release(); }; }, [html, find, raw, math, budget]);
  return <div ref={ref} {...props} />;
}
let mermaidSeq = 0;
function MermaidView({ source }) {
  const [state, setState] = useState({ status: 'loading' });
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || 'light');
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme || 'light'));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let cancelled = false; const id = 'fw-mermaid-' + (++mermaidSeq);
    setState({ status: 'loading' });
    renderThemedMermaid({ id, source, theme, cancelled: () => cancelled }).then(svg => {
      if (!cancelled && svg) setState({ status: 'ready', svg, theme, source });
    }).catch(error => { if (!cancelled) setState({ status: 'error', message: String(error?.message || error).split('\n')[0], theme, source }); });
    return () => { cancelled = true; document.getElementById('d' + id)?.remove(); };
  }, [source, theme]);
  if (state.status === 'loading' || state.theme !== theme || state.source !== source) return <div className="fw-md-mermaid" aria-busy="true">正在渲染图表…</div>;
  if (state.status === 'error') return <div className="fw-md-mermaid-error" role="alert">Mermaid 图表无法渲染：{state.message}</div>;
  return <div className="fw-md-mermaid" data-md-theme={theme} aria-label="Mermaid 图示" dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
export function FileMarkdown({ text, path, readingSelection, retainView=false, onReadingSelection, findQuery='', overlay=false, readOnly=false, imageMenuScope='document', imageContext=true, imageGalleryRouting, resolveImageSource, onEdit, onSelect, onOpenFile, onImageReference, onImageAction, onComposition }) {
  const { blocks, env } = useMemo(() => parseMarkdown(text), [text]);
  const math = useMemo(() => createMarkdownMathSession(), []), budget = useMemo(() => createMarkdownMathBudget(blocks.reduce((units, block) => units + (block.tokens ? renderMarkdownBlock(block, env).length : 0), 0)), [blocks, env]);
  // Each DOM owner cancels its group; the last owner stops the lazy worker.
  // Keep this session reusable across React StrictMode effect remounts.
  const [editing, setEditing] = useState(()=>readingSelection&&(readingSelection.anchor||readingSelection.head)?{id:0,from:0,to:text.length,source:text,selectionFrom:0,selectionTo:0,readingSelection}:null), [context, setContext] = useState(null), [active, setActive] = useState(null), [copied, setCopied] = useState(false);
  const [imageScenario, setImageScenario] = useState('local'), [showScenario, setShowScenario] = useState(false);
  const imageScenarioName = useId();
  const imageOwner = useRef(null), [imageInput, setImageInput] = useState(null);
  useEffect(() => {
    const owner = new AbortController(); imageOwner.current = owner; setImageInput(null);
    return () => { owner.abort(); if (imageOwner.current === owner) imageOwner.current = null; };
  }, [text, path]);
  const article = useRef(null), origin = useRef(null), editSequence = useRef(0), restoreSourceFocus = useRef(null), sourceSelection = useRef({ from: 0, to: 0 });
  const [selectionNotice, setSelectionNotice] = useState('');
  const gesture = useRef(null), capturedSelection = useRef(false), blockedLinkDown = useRef(false), identity = useRef(null); identity.current = { text, path, editing };
  useEffect(() => () => { gesture.current?.(); gesture.current = null; }, [text, path, editing]);
  const pictures = blocks.filter(b => b.type === 'image').map(b => {
    const { alt, original: raw } = standaloneImage(b), resolved = resolveMarkdownPath(path, raw);
    return { id:b.from, alt, src:resolveImageSource?.(resolved) || safeImageSrc(raw), original:raw, path:resolved || 'resources/app-icon.png', localPath:resolved ? '/workspace/' + resolved : undefined };
  });
  useLayoutEffect(() => {
    if (!editing) {
      if (restoreSourceFocus.current !== null) {
        const target = article.current?.querySelector('[data-md-from="' + restoreSourceFocus.current + '"]') || article.current;
        restoreSourceFocus.current = null; target?.focus({ preventScroll: true });
      }
      return;
    }
  }, [editing?.id]);
  useEffect(() => {
    if (editing && (readOnly || text !== editing.source)) { setEditing(null); setSelectionNotice('文件内容或编辑权限已变化，请重新选择源码。'); }
  }, [text, readOnly]);
  const finishEditing = (restoreFocus = false) => {
    if (restoreFocus) restoreSourceFocus.current = editing?.from ?? 0;
    setEditing(null);
  };
  const openSource = (from, to, selectionFrom = from, selectionTo = selectionFrom, direction = 'forward') => {
    if (readOnly) return;
    sourceSelection.current = { from: selectionFrom, to: selectionTo };
    setEditing({ id: ++editSequence.current, from, to, source: text, selectionFrom, selectionTo, direction });
    onSelect?.(selectionFrom, selectionTo);
  };
  const begin = (block, event) => {
    if (capturedSelection.current || readOnly || editing || event?.target.closest('a,button,input,summary')) return;
    const selected = window.getSelection();
    if (selected && !selected.isCollapsed && article.current?.contains(selected.anchorNode)) return;
    const formula = event?.target.closest('[data-md-math]');
    if (formula) {
      setSelectionNotice('已定位公式内容末尾；其他公式保留预览。');
      const from = Number(formula.dataset.mdMathFrom), to = Number(formula.dataset.mdMathTo), end = Number(formula.dataset.mdMathContentEnd);
      if ([from, to, end].every(Number.isSafeInteger)) openSource(from, to, end, end);
    } else { const native = event && article.current.ownerDocument.caretRangeFromPoint?.(event.clientX, event.clientY), point = native && domSourcePoint(article.current, native.startContainer, native.startOffset, 'start'), position = Math.max(block.from, Math.min(block.to, point?.offset ?? block.from)); setSelectionNotice(''); openSource(block.from, block.to, position, position); }
  };
  const captureRenderedSelection = () => {
    if (editing) return;
    const selected = window.getSelection();
    if (!selected || selected.isCollapsed || !selected.rangeCount) return;
    const native = selected.getRangeAt(0), start = domSourcePoint(article.current, native.startContainer, native.startOffset, 'start'), end = domSourcePoint(article.current, native.endContainer, native.endOffset, 'end');
    const range = sourceRange(start, end, text.length); if (!range) return;
    const first = blocks.find(block => block.to > range.from), last = [...blocks].reverse().find(block => block.from < range.to);
    if (!first || !last) return;
    setSelectionNotice(range.exact ? '选区已映射到原始 Markdown；包含两端之间的源码标记。' : '此选区含公式或无法逐字映射的内容，已展开完整源码单元供核对。');
    if (readOnly) onSelect?.(range.from, range.to);
    else {
      openSource(first.from, last.to, range.from, range.to, selected.anchorNode === native.endContainer && selected.anchorOffset === native.endOffset ? 'backward' : 'forward');
      selected.removeAllRanges();
    }
    return true;
  };
  const startRenderedSelection = event => {
    capturedSelection.current = false;
    if (event.target.closest('a[data-md-href]')) { blockedLinkDown.current = markdownNativeSelection(article.current) || Boolean(editing && sourceSelection.current.from !== sourceSelection.current.to) || !markdownLinkAllowed(event); return; }
    blockedLinkDown.current = false;
    if (editing || event.button !== 0 || event.target.closest('a,button,input,img,summary')) return;
    if (event.target.closest('[data-md-math]')) { const owner = event.target.closest('[data-md-from]'), block = blocks.find(value => value.from === Number(owner?.dataset.mdFrom)); if (block) { event.preventDefault(); begin(block, event); } return; }
    gesture.current?.(); const root = article.current;
    const cancel = waitMarkdownMouseup(root.ownerDocument, { isCurrent: () => root === article.current && root.isConnected && identity.current.text === text && identity.current.path === path && !identity.current.editing, settled: () => { if (gesture.current === cancel) gesture.current = null; }, finish: () => { capturedSelection.current = Boolean(captureRenderedSelection()); } }); gesture.current = cancel;
  };
  const toggleTask = (b, line, checked) => {
    const rel = line - (b.line - 1), parts = b.raw.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g) || [];
    if (rel < 0 || rel >= parts.length || !/\[[ xX]\]/.test(parts[rel])) return;
    parts[rel] = parts[rel].replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
    const next = replaceMarkdownBlock(text, b, parts.join('')); if (next !== null) onEdit(next);
  };
  const htmlClick = (b, e) => {
    const link = e.target.closest('a[data-md-href]');
    if (link) { e.preventDefault(); const blocked = e.detail > 0 && blockedLinkDown.current; blockedLinkDown.current = false; if (blocked || editing || !markdownLinkAllowed(e, { nativeSelected: markdownNativeSelection(article.current) })) return; const href = link.dataset.mdHref;
      try {
        const location = fileLinkLocation(href), target = resolveMarkdownPath(path, location.path, { decode: true });
        if (target) Promise.resolve(onOpenFile(target, location)).catch(error => onImageAction(error.message));
        else onImageAction('外部链接入口（原型不导航）：' + href);
      } catch (error) { onImageAction(error.message); }
      return; }
    if (editing) return;
    const box = e.target.closest('input[data-md-task-line]');
    if (box) { if (readOnly) e.preventDefault(); else toggleTask(b, Number(box.dataset.mdTaskLine), box.checked); return; }
    begin(b, e);
  };
  const openImage = (p,e) => {
    origin.current=e.currentTarget;
    const snapshot=(source,element)=>({...source,source,downloadSrc:source.src,src:element?.currentSrc||element?.src||source.src});
    const connected=[...article.current.querySelectorAll('[data-md-image]')].filter(n=>n.isConnected).map(n=>{const source=pictures.find(p=>p.id===Number(n.dataset.mdImage));return source?snapshot(source,n.querySelector('img')):null;}).filter(Boolean);
    const selected=connected.find(item=>item.source===p)||snapshot(p,e.currentTarget.querySelector('img'));
    setActive({ picture:selected, pictures:connected.includes(selected)?connected:[selected] });
  };
  const imageAction = async (action,picture,reportInGallery=false) => {
    picture=picture.source||picture;
    setContext(null);
    if(action.id==='open') {
      onImageAction?.('');
      try {
        if(!onOpenFile)throw new Error('图片新标签入口不可用');
        const opened=await onOpenFile(picture.path,{readOnlyImage:true});
        if(opened===null||opened===false)throw new Error('图片来源为空，请重新读取后重试');
      } catch(error) { onImageAction?.('无法打开图片：'+String(error?.message||error)); }
      return;
    }
    if(action.id==='reference') {
      if (imageInput?.state === 'pending' || imageInput?.state === 'unknown') return;
      const owner = imageOwner.current, requestId = crypto.randomUUID();
      if (!owner || owner.signal.aborted) return;
      const onState = result => { if (imageOwner.current === owner && !owner.signal.aborted) { setImageInput({ ...result, requestId }); onImageAction?.(result.message); } };
      if (!onImageReference) return onState({ state: 'failed', message: '当前任务没有可用图片输入入口。' });
      onImageReference({path:picture.path,alt:picture.alt,src:picture.src}, { requestId, signal: owner.signal, scenario: imageScenario, onState });
      return;
    }
    if(action.id==='reveal') return onImageAction('已选择“在文件管理器中显示”（原型不启动外部应用）');
    try {
      if(action.id==='address') await navigator.clipboard.writeText(action.value);
      if(action.id==='copy') {
        const img=new window.Image();img.src=picture.src;await img.decode();
        const canvas=document.createElement('canvas');canvas.width=img.naturalWidth;canvas.height=img.naturalHeight;
        canvas.getContext('2d').drawImage(img,0,0);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        if(!blob)throw new Error('图片转换失败');
        await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);
      }
      if(action.id==='download') {
        await downloadImageCopy(picture,{signal:new AbortController().signal,saveContent:async content=>{
          // Prototype browser sink only; actual App saves through its owned
          // native transaction. Preserve and verify the same original bytes.
          const bytes=Uint8Array.from(atob(content.base64),char=>char.charCodeAt(0));
          const url=URL.createObjectURL(new Blob([bytes],{type:'application/octet-stream'})),a=document.createElement('a');
          a.href=url;a.download=content.name;document.body.append(a);
          try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),0);}
          return {state:'dispatched'};
        }});
      }
      onImageAction(action.id==='download'?'已下载合成图片副本':action.id==='copy'?'已复制合成图片（PNG）':'已复制示例图片地址');
    } catch(error) {onImageAction('图片操作失败：权限或图片解码不可用，请重试。');if(reportInGallery)throw error;}
  };
  return <>
    <article className="fw-markdown fw-markdown-editable" ref={article} tabIndex={-1} aria-label="Markdown 文档编辑区" onMouseDown={startRenderedSelection} onKeyUp={e=>{if(e.shiftKey)captureRenderedSelection();}}>
      {editing ? <FileMarkdownSource key={editing.id} text={editing.source} path={path} resolveImageSource={resolveImageSource} readingSelection={editing.readingSelection} autoFocus={editing.id!==0} retainView={retainView} onReadingSelection={onReadingSelection} selectionFrom={editing.selectionFrom} selectionTo={editing.selectionTo} direction={editing.direction} readOnly={readOnly} onEdit={next=>{setEditing(current=>({...current,source:next}));onEdit(next);}} onSelect={(from,to)=>{sourceSelection.current={from,to};onSelect?.(from,to);}} onFinish={finishEditing} onStatus={setSelectionNotice} onComposition={onComposition} onLink={href=>{const target=resolveMarkdownPath(path,href);target?onOpenFile?.(target):onImageAction?.('外部链接入口（原型不导航）：'+href);}}/> : blocks.map(b=>{
        const raw=b.raw.replace(/\r?\n$/,'');
        const attr={onClick:e=>begin(b,e),onKeyDown:e=>{if((e.key==='Enter'||e.key==='F2')&&e.target===e.currentTarget&&!imeComposing(e)){e.preventDefault();begin(b,e);}},tabIndex:readOnly||b.type==='image'?-1:0,'data-md-line':b.line,'data-md-from':b.from,'data-md-to':b.to};
        if(b.type==='frontmatter'){const fm=parseFrontmatter(raw);return <dl key={b.from} className="fw-md-frontmatter" {...attr}>{fm.error&&<div role="alert" className="fw-md-frontmatter-error">{fm.error}</div>}{fm.entries.map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>;}
        if(b.type==='blank')return <div key={b.from} className="fw-paragraph-break" {...attr} aria-label={'空行 '+b.line}/>;
        if(b.type==='definition')return <div key={b.from} className="fw-md-definition" {...attr}>{raw}</div>;
        if(b.type==='image'){
          const p=pictures.find(p=>p.id===b.from);
          return <button className="fw-md-image" data-md-image={p.id} key={b.from} title="打开嵌入图片" onClick={e=>openImage(p,e)} onContextMenu={e=>{if(!markdownImageMenuAllowed(imageMenuScope,imageContext))return;e.preventDefault();origin.current=e.currentTarget;setContext({picture:p,x:e.clientX,y:e.clientY});}}><img src={p.src} alt={p.alt}/></button>;
        }
        if(b.type==='code'||b.type==='mermaid'){
          const body=codeBody(b), highlighted=highlightedCode(b);
          return <div key={b.from} className="fw-md-fence" {...attr}><small>{b.language||b.type}</small>{b.type==='mermaid'?<><MermaidView source={body}/><details onClick={e=>e.stopPropagation()}><summary>查看图表源码</summary><pre>{body}</pre></details></>:<pre><code className={highlighted.language?'hljs language-'+highlighted.language:''} data-md-source-from={b.from} data-md-source-to={b.to} data-md-source-mode="atomic" data-md-source-runs={highlighted.map?JSON.stringify(highlighted.map.runs):undefined} dangerouslySetInnerHTML={{__html:highlighted.html}} /></pre>}</div>;
        }
        return <MdHtml key={b.from} html={renderMarkdownBlock(b,{...env,readOnly})} find={findQuery} raw={b.raw} math={math} budget={budget} className={'fw-md-block fw-md-html fw-md-'+b.type} {...attr} onClick={e=>htmlClick(b,e)}/>;
      })}
      {!text&&!readOnly&&<button className="fw-md-empty" onClick={()=>openSource(0,0)}>使用 Markdown 写作…</button>}
    </article>
    {selectionNotice&&<p className="fw-md-selection-notice" role="status">{selectionNotice}</p>}
    {imageInput && <div className="fw-md-selection-notice" role="status" aria-label="图片输入状态" aria-busy={imageInput.state === 'pending'}>
      {imageInput.message}
      {imageInput.state === 'pending' && <button onClick={() => { imageOwner.current?.abort(); imageOwner.current = new AbortController(); setImageInput({ state: 'failed', message: '图片准备已取消；已有输入和图片保留。' }); }}>取消图片准备</button>}
      {imageInput.state === 'pending' && imageScenario === 'pending-input' && <>
        <button onClick={() => window.dispatchEvent(new CustomEvent('m9:terminal-image-complete', { detail: { requestId: imageInput.requestId } }))}>完成图片准备（合成）</button>
        <button onClick={() => window.dispatchEvent(new CustomEvent('m9:terminal-image-complete', { detail: { requestId: imageInput.requestId, failed: true } }))}>模拟图片准备失败</button>
      </>}
    </div>}
    <div className="fw-md-fixture-tools"><button onClick={()=>setShowScenario(!showScenario)}>图片能力样例</button>{showScenario&&<div className="fw-md-fixture-scenarios" role="radiogroup" aria-label="图片能力场景">{[['local','本机静态图'],['remote','远程静态图'],['host-mismatch','本机身份不匹配'],['http','HTTP 地址'],['gif','动画 GIF'],['no-input','模型不接收图片'],['unknown-input','图片能力未知（合成）'],['reject-input','图片准备拒绝（合成）'],['pending-input','图片准备中（合成）'],['fallback','新叠层不可用，退旧灯箱'],['src-data-display-https','src=data，displaySrc=HTTPS'],['src-http-display-https','src=HTTP，displaySrc=HTTPS'],['src-file','src=file'],['src-data','src=data'],['src-invalid','src=无效URL'],['src-invalid-display-https','无效src，displaySrc=HTTPS']].map(([value,label])=><label key={value}><input type="radio" name={imageScenarioName} value={value} checked={imageScenario===value} onChange={e=>setImageScenario(e.target.value)}/>{label}</label>)}</div>}<button aria-label="复制 Markdown" onClick={async()=>{try{await navigator.clipboard.writeText(text);setCopied(true);}catch{onImageAction('复制失败');}}}>{copied?<Check size={13}/>:<Copy size={13}/>}</button></div>
    {context&&<ImageMenu context={context} onClose={()=>{setContext(null);origin.current?.focus();}} actions={imageMenuActions({src:imageScenario==='http'?'https://example.invalid/fixture.png':context.picture.original,...imageMenuSourceExamples[imageScenario],localPath:context.picture.localPath,host:imageScenario==='remote'?'remote':'local',animated:imageScenario==='gif'||/^data:image\/gif;/i.test(context.picture.src),canSelect:true,clipboard:typeof ClipboardItem!=='undefined'&&!!navigator.clipboard?.write})} onAction={action=>imageAction(action,context.picture)}/>}
    {active&&<ImageGallery initial={active} routing={imageGalleryRouting} overlay={overlay&&imageScenario!=='fallback'} download={!(overlay&&imageScenario==='fallback')} onClose={()=>{setActive(null);origin.current?.focus({preventScroll:true});}} onDownload={p=>imageAction({id:'download'},p,true)}/>}
  </>;
}
function ImageMenu({context,actions,onAction,onClose}){
  const ref=useRef(null);
  useEffect(()=>{const el=ref.current;const rect=el.getBoundingClientRect();el.style.left=Math.max(8,Math.min(context.x,window.innerWidth-rect.width-8))+'px';el.style.top=Math.max(8,Math.min(context.y,window.innerHeight-rect.height-8))+'px';el.querySelector('button')?.focus({preventScroll:true});},[context]);
  return <><div className="fw-dismiss" onClick={onClose}/><div ref={ref} className="fw-menu fw-image-menu" role="menu" onKeyDown={e=>{e.stopPropagation();const all=[...ref.current.querySelectorAll('button')],i=all.indexOf(document.activeElement);if(e.key==='Escape')onClose();if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();all[e.key==='Home'?0:e.key==='End'?all.length-1:(i+(e.key==='ArrowDown'?1:-1)+all.length)%all.length]?.focus();}}}>{actions.map(a=><button role="menuitem" key={a.id} onClick={()=>onAction(a)}>{a.label}</button>)}</div></>;
}
