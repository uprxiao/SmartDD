import { useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import { rpc } from '@renderer/lib/ipc';

export type BrowserTabTooltip = { target: object; element: ReactNode; dismiss(): void };

/** Native page views sit above DOM popups. Keep a captured page visible while
 * the existing selectable tooltip is open; never release another surface. */
export function useBrowserTabTooltip({ taskId, tabId, tooltip, pageBlocked, surfaceOpen }: {
  taskId: string; tabId: string; tooltip: BrowserTabTooltip | null; pageBlocked: boolean; surfaceOpen: boolean;
}) {
  const instance = useId(), sequence = useRef(0), mounted = useRef(false);
  const [ready, setReady] = useState<{ target: object; image: string | null } | null>(null);
  const [revision, setRevision] = useState(0);
  const target = tooltip?.target, dismiss = tooltip?.dismiss;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (surfaceOpen) dismiss?.();
  }, [surfaceOpen, dismiss]);
  useEffect(() => {
    const blur = () => dismiss?.();
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [dismiss]);
  useLayoutEffect(() => {
    setReady(null);
    if (!target || pageBlocked || surfaceOpen) return;
    let active = true;
    const owner = `tab-tooltip:${instance}:${++sequence.current}`;
    void rpc.browser.overlay({ taskId, tabId, open: true, owner }).then(image => {
      if (active) setReady({ target, image });
    }).catch(() => { if (active) dismiss?.(); });
    return () => {
      active = false;
      void rpc.browser.overlay({ taskId, tabId, open: false, owner }).catch(() => {}).then(() => {
        // An earlier geometry request may have been suppressed by the hold.
        if (mounted.current) setRevision(value => value + 1);
      });
    };
  }, [taskId, tabId, target, pageBlocked, surfaceOpen, instance, dismiss]);
  const parked = !!target && ready?.target === target && !pageBlocked && !surfaceOpen;
  const visible = !!tooltip && !surfaceOpen && (pageBlocked || parked);
  return {
    parked, revision, image: parked ? ready.image : null,
    element: visible ? <div className="bw-tab-tooltip">{tooltip.element}</div> : null,
  };
}
