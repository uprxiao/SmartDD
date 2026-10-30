import { forwardRef, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './file-code-theme.css';
import { CODE_TOKEN_STRIDE, codeTokenStyle } from '../../../src/renderer/features/files/code/paint.mjs';

// The prototype keeps its synthetic textarea/history contract. The read-only
// paint layer uses the same real language Worker and palette as the App.
export const FileCodeTextarea = forwardRef(function FileCodeTextarea({ filename, value, onScroll, style, ...props }, ref) {
  const paint = useRef(null), [tokens, setTokens] = useState(null);
  useEffect(() => {
    setTokens(null);
    const worker = new Worker(new URL('../../../src/renderer/features/files/code/worker.ts', import.meta.url), { type: 'module' });
    const deadline = setTimeout(() => worker.terminate(), 15000);
    worker.onmessage = ({ data }) => {
      if (data.type === 'ready') worker.postMessage({ type: 'window', revision: 1, request: 1, from: 0, to: value.length });
      else if (data.type === 'window') { setTokens({ source: value, items: data.tokens }); clearTimeout(deadline); }
    };
    worker.postMessage({ type: 'parse', source: value, filename, revision: 1 });
    return () => { clearTimeout(deadline); worker.terminate(); };
  }, [filename, value]);
  const children = []; let offset = 0;
  if (tokens?.source === value) for (let i = 0; i < tokens.items.length; i += CODE_TOKEN_STRIDE) {
    const from = tokens.items[i], to = tokens.items[i + 1];
    if (from > offset) children.push(value.slice(offset, from));
    children.push(<span key={i} className="fw-code-token" style={Object.fromEntries(codeTokenStyle(tokens.items, i).split(';').map(pair => pair.split(':')))}>{value.slice(from, to)}</span>); offset = to;
  }
  children.push(value.slice(offset) + '\n');
  return <div className="fw-code-overlay"><pre ref={paint} aria-hidden="true" style={style}>{children}</pre><textarea {...props} ref={ref} value={value} style={style} onScroll={(event) => {
    if (paint.current) { paint.current.scrollTop = event.currentTarget.scrollTop; paint.current.scrollLeft = event.currentTarget.scrollLeft; }
    for (const column of event.currentTarget.closest('.fw-editor')?.querySelectorAll('.fw-line-numbers,.fw-prototype-blame') ?? []) column.scrollTop = event.currentTarget.scrollTop;
    onScroll?.(event);
  }} /></div>;
});

/** Synthetic design state only. Production rows come from the scoped Git provider. */
export function FilePrototypeBlame({ text }) {
  const [selected, setSelected] = useState(null);
  return <><div className="fw-prototype-blame">{text.split('\n').map((_, index) => <button key={index} aria-label={`第 ${index + 1} 行归属：示例作者`} onMouseEnter={event => setSelected({ anchor: event.currentTarget.getBoundingClientRect(), pinned: false })} onFocus={event => setSelected({ anchor: event.currentTarget.getBoundingClientRect(), pinned: false })} onClick={event => setSelected({ anchor: event.currentTarget.getBoundingClientRect(), pinned: true })}>示例作者</button>)}</div>{selected && createPortal(<div className="fw-prototype-blame-card" role={selected.pinned ? 'dialog' : 'tooltip'} style={{left:Math.min(selected.anchor.left,window.innerWidth-280),top:Math.min(selected.anchor.bottom+4,window.innerHeight-130)}} onMouseLeave={()=>{if(!selected.pinned)setSelected(null)}}><div><strong>示例作者</strong><button aria-label="关闭行归属详情" onClick={()=>setSelected(null)}>×</button></div><p>初始文件（合成归属示例）</p><small>2026/10/17 12:00 · a1b2c3d</small></div>,document.body)}</>;
}
