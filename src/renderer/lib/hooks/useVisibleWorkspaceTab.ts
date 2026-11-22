import { useEffect } from 'react';

export function useVisibleWorkspaceTab(strip: HTMLElement | null) {
  useEffect(() => {
    if (!strip) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = strip.querySelector('[role="tab"][aria-selected="true"]')?.parentElement;
        if (!active || !strip.clientWidth) return;
        const viewport = strip.getBoundingClientRect();
        const tab = active.getBoundingClientRect();
        if (tab.left < viewport.left) strip.scrollLeft += tab.left - viewport.left;
        else if (tab.right > viewport.right) strip.scrollLeft += tab.right - viewport.right;
      });
    };
    const content = new MutationObserver(schedule);
    content.observe(strip, { subtree: true, childList: true, characterData: true, attributeFilter: ['aria-selected'] });
    const layout = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    layout?.observe(strip);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      content.disconnect();
      layout?.disconnect();
    };
  }, [strip]);
}
