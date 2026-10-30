import { useEffect, useRef, useState } from 'react';
import type { ReviewTextWindow } from './model.mjs';
import './review-text.css';

/** Pure, shared presentation; bytes stay in the independent readonly model. */
export function ReviewTextPane({ value, pending = false, onPage }: { value: ReviewTextWindow; pending?: boolean; onPage(index: number): void }) {
  const [input, setInput] = useState(String(value.index + 1));
  const content = useRef<HTMLPreElement>(null);
  useEffect(() => { setInput(String(value.index + 1)); if (content.current) content.current.scrollTop = 0; }, [value.index]);
  return <div className="fw-review-text-ready" data-page={value.index + 1} data-pages={value.pages} data-first-byte={value.start} data-last-byte={value.end}>
    <div className="fw-save-strip" role="status">全文已校验 · 只读<span className="fw-push" />{value.start + (value.total ? 1 : 0)}–{value.end} / {value.total} 字节</div>
    <pre ref={content} tabIndex={0} aria-label="只读文本内容">{value.text}</pre>
    <form className="fw-review-text-controls" onSubmit={event => { event.preventDefault(); const page = Number(input); if (Number.isSafeInteger(page) && page >= 1 && page <= value.pages) onPage(page - 1); }}>
      <button type="button" disabled={pending || value.index === 0} onClick={() => onPage(0)}>首块</button>
      <button type="button" disabled={pending || value.index === 0} onClick={() => onPage(value.index - 1)}>上一块</button>
      <label>文本块 <input aria-label="文本块" type="number" min={1} max={value.pages} value={input} disabled={pending} onChange={event => setInput(event.target.value)} /></label>
      <span>/ {value.pages}</span><button type="submit" disabled={pending}>跳转</button>
      <button type="button" disabled={pending || value.index + 1 === value.pages} onClick={() => onPage(value.index + 1)}>下一块</button>
      <button type="button" disabled={pending || value.index + 1 === value.pages} onClick={() => onPage(value.pages - 1)}>末块</button>
    </form>
  </div>;
}
