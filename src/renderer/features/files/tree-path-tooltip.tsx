import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FocusEvent, PointerEvent } from 'react';

const ignored = '.fw-git-state,input,textarea,[data-tooltip-ignore],[data-slot=context-menu-trigger] [role=menuitem]';
const ignoredEvent = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) => event.nativeEvent.composedPath().some(target => target instanceof Element && target.closest(ignored));
type Tooltip = { element: HTMLElement; path: string; x: number; y: number };

/** File paths belong to the tree model, not the browser's native title timer. */
export function useTreePathTooltip(model: unknown) {
  const id = useId(), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidate = useRef<HTMLElement | null>(null), popup = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const inPopup = (target: EventTarget | null) => target instanceof Node && !!popup.current?.contains(target);
  const dismiss = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null; candidate.current = null; setTooltip(null);
  }, []);
  useEffect(() => { dismiss(); }, [model, dismiss]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') dismiss(); };
    const outside = (event: Event) => { if (!popup.current || !event.composedPath().includes(popup.current)) dismiss(); };
    window.addEventListener('keydown', key, true);
    window.addEventListener('pointerdown', outside, true);
    window.addEventListener('scroll', outside, true);
    window.addEventListener('resize', dismiss);
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', outside, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [dismiss]);
  const schedule = (event: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>, path: string, keyboard = false) => {
    const pointer = event as PointerEvent<HTMLElement>;
    if (pointer.pointerType === 'touch' || pointer.buttons || ignoredEvent(event) || keyboard && !event.currentTarget.matches(':focus-visible')) return;
    dismiss(); const element = event.currentTarget; candidate.current = element;
    const show = () => {
      timer.current = null;
      if (!element.isConnected || candidate.current !== element) return;
      const box = element.getBoundingClientRect();
      setTooltip({ element, path, x: Math.max(8, Math.min(box.left, innerWidth - 328)), y: Math.max(8, Math.min(box.bottom + 5, innerHeight - 112)) });
    };
    if (keyboard) show(); else timer.current = setTimeout(show, 500);
  };
  return {
    dismiss,
    bind: (path: string) => ({
      'aria-describedby': tooltip?.path === path ? id : undefined,
      onPointerEnter: (event: PointerEvent<HTMLElement>) => schedule(event, path),
      onPointerMove: (event: PointerEvent<HTMLElement>) => { if (event.buttons || event.pointerType === 'touch' || ignoredEvent(event)) dismiss(); },
      onPointerLeave: (event: PointerEvent<HTMLElement>) => { if (!inPopup(event.relatedTarget)) dismiss(); },
      onPointerDown: dismiss,
      onBlur: (event: FocusEvent<HTMLElement>) => { if (!inPopup(event.relatedTarget)) dismiss(); },
      onFocus: (event: FocusEvent<HTMLElement>) => schedule(event, path, true),
    }),
    // The transparent padding is hit-testable, so crossing the five-pixel
    // visual gap enters this popup instead of the next directory row.
    element: tooltip && <div ref={popup} className="fw-path-tooltip-host" style={{ position: 'fixed', zIndex: 45, left: tooltip.x, top: tooltip.y - 5, paddingTop: 5, maxWidth: 320 }} onPointerLeave={dismiss} onBlur={event => { if (event.relatedTarget !== tooltip.element && !inPopup(event.relatedTarget)) dismiss(); }}><div id={id} className="fw-path-tooltip" role="tooltip" tabIndex={-1} style={{ position: 'relative' }}>{tooltip.path}</div></div>,
  };
}
