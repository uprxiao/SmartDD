import { useEffect, useRef, useState } from 'react';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import type { ViewerSession } from '@shared/file-viewer';
import { fileViewerUiEvent } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';
import { useTheme } from '@renderer/lib/theme';
import { createViewerAppBridge } from './bridge';
import { htmlViewOccluded } from '../html/preview';
export function McpAppFrame({ session, onRetry }: { session: ViewerSession; onRetry?: () => void }) {
  const activeBridge = useRef<AppBridge>(null), host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(''), { effectiveTheme } = useTheme();
  useEffect(() => {
    const element = host.current!, context = { id: session.id, uri: session.uri, generation: session.generation };
    setError('');
    let alive = true, frame = 0, last = '', settle: ReturnType<typeof setTimeout> | undefined;
    const fail = (failure: unknown) => { if (alive) { setError(String(failure)); void rpc.files.viewerUiClose(session.id).catch(() => undefined); } };
    const bridge = createViewerAppBridge(session, rpc.files, effectiveTheme === 'ydark' ? 'dark' : 'light', fail);
    activeBridge.current = bridge;
    const transport = {
      onmessage: undefined as ((message: never) => void) | undefined,
      onclose: undefined as (() => void) | undefined,
      start: async () => undefined,
      close: async () => { transport.onclose?.(); },
      send: async (payload: unknown) => { if (alive) await rpc.files.viewerUiSend(context, payload); },
    };
    const unlisten = events.on(fileViewerUiEvent, event => {
      if (!alive || event.id !== session.id) return;
      if (event.error) fail(event.error); else if (event.payload) transport.onmessage?.(event.payload as never);
    });
    const sync = () => {
      frame = 0; if (!alive) return;
      const rect = element.getBoundingClientRect(), bounds = { id: session.id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: !htmlViewOccluded(element) };
      const encoded = JSON.stringify(bounds); if (encoded === last) return; last = encoded;
      void rpc.files.viewerUiBounds(bounds).catch(fail);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    const changed = () => { schedule(); clearTimeout(settle); settle = setTimeout(schedule, 160); };
    void bridge.connect(transport as never).then(() => { if (alive) return rpc.files.viewerUiOpen(context); }).then(() => { if (alive) { last = ''; schedule(); } }).catch(fail);
    const resize = new ResizeObserver(schedule), mutation = new MutationObserver(changed);
    resize.observe(element); mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-open', 'data-closed', 'data-ending-style', 'data-starting-style', 'data-state', 'style', 'class'] });
    window.addEventListener('resize', schedule); document.addEventListener('scroll', schedule, true); document.addEventListener('visibilitychange', schedule); document.addEventListener('animationend', schedule, true); document.addEventListener('transitionend', schedule, true);
    return () => {
      activeBridge.current = null; alive = false; unlisten(); cancelAnimationFrame(frame); clearTimeout(settle); resize.disconnect(); mutation.disconnect();
      window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true); document.removeEventListener('visibilitychange', schedule); document.removeEventListener('animationend', schedule, true); document.removeEventListener('transitionend', schedule, true);
      void bridge.close(); void rpc.files.viewerUiClose(session.id).catch(() => undefined);
    };
  }, [session.id]);
  useEffect(() => { activeBridge.current?.setHostContext({ theme: effectiveTheme === 'ydark' ? 'dark' : 'light' }); }, [effectiveTheme]);
  return <div className="fw-mcp-app" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>{error && <div role="alert" className="fw-save-strip">{error}{onRetry && <button onClick={onRetry}>重试扩展</button>}</div>}<div ref={host} aria-label="扩展文件查看器" style={{ flex: 1, minHeight: 0 }} /></div>;
}
