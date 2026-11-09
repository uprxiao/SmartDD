import { useEffect, useRef, useState } from 'react';

export interface PptxPlacementFrame { x: number; y: number; width: number; height: number }

/** Shared product/prototype interaction; coordinates are actual slide units. */
export function PptxImagePlacement({ width, height, onCommit, onCancel, purpose='image' }: {
  width: number; height: number; onCommit(frame: PptxPlacementFrame,autoSize?:boolean): void; onCancel(): void;purpose?:'image'|'text';
}) {
  const root = useRef<HTMLDivElement>(null), drag = useRef<{ id: number; x: number; y: number } | null>(null), committed = useRef(false);
  const [frame, setFrame] = useState<PptxPlacementFrame | null>(null);
  useEffect(() => { root.current?.focus({ preventScroll: true }); return () => { drag.current = null; }; }, []);
  const point = (clientX: number, clientY: number) => {
    const rect = root.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(width, (clientX - rect.left) / rect.width * width)), y: Math.max(0, Math.min(height, (clientY - rect.top) / rect.height * height)) };
  };
  const clickFrame = (x: number, y: number) => {
    const w = Math.min(112, width), h = Math.min(56, height);
    return { x: Math.max(0, Math.min(width - w, x)), y: Math.max(0, Math.min(height - h, y)), width: w, height: h };
  };
  const commit = (next: PptxPlacementFrame,autoSize=false) => {
    if (committed.current || !Object.values(next).every(Number.isFinite) || next.width <= 0 || next.height <= 0) return;
    committed.current = true; drag.current = null;if(purpose==='text')onCommit(next,autoSize);else onCommit(next);
  };
  return <div ref={root} role="region" aria-label={purpose==='text'?'放置文本框':'放置图片占位'} tabIndex={0}
    style={{ position: 'absolute', inset: 0, zIndex: 5, cursor: 'crosshair', touchAction: 'none', outline: 'none' }}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current || committed.current) return;
      event.preventDefault(); event.stopPropagation();
      const p = point(event.clientX, event.clientY); drag.current = { id: event.pointerId, ...p }; setFrame(null);
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current; if (!start || start.id !== event.pointerId) return;
      const end = point(event.clientX, event.clientY);
      setFrame({ x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(start.x - end.x), height: Math.abs(start.y - end.y) });
    }}
    onPointerUp={event => {
      const start = drag.current; if (!start || start.id !== event.pointerId) return;
      event.preventDefault(); event.stopPropagation(); drag.current = null;
      const end = point(event.clientX, event.clientY);
      const dx = Math.abs(start.x - end.x), dy = Math.abs(start.y - end.y);
      commit(dx < 2 && dy < 2 ? clickFrame(start.x, start.y) : { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: dx, height: dy },dx<2&&dy<2);
    }}
    onPointerCancel={() => { drag.current = null; setFrame(null); }}
    onLostPointerCapture={() => { drag.current = null; setFrame(null); }}
    onKeyDown={event => {
      if (event.nativeEvent.isComposing || event.keyCode === 229 || event.repeat) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCancel(); }
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); commit(clickFrame((width - Math.min(112, width)) / 2, (height - Math.min(56, height)) / 2),true); }
    }}>
    <span style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', padding: '5px 9px', borderRadius: 6, background: 'var(--bg,white)', color: 'var(--text,#333)', border: '1px solid var(--border,#ddd)', fontSize: 12, whiteSpace: 'nowrap', pointerEvents: 'none' }}>单击或拖出{purpose==='text'?'文本框':'图片'}范围 · Enter 居中 · Esc 取消</span>
    {frame && <div aria-hidden style={{ position: 'absolute', left: `${frame.x / width * 100}%`, top: `${frame.y / height * 100}%`, width: `${frame.width / width * 100}%`, height: `${frame.height / height * 100}%`, boxSizing: 'border-box', border: '1px dashed #39967e', background: '#39967e18', pointerEvents: 'none' }} />}
  </div>;
}
