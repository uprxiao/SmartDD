import { useEffect, useRef, useState } from 'react';
import { FileCode2, Loader2 } from 'lucide-react';
import { fileHtmlEvent } from '@shared/events';
import type { HtmlPreviewState } from '@shared/file-html';
import { events, rpc } from '@renderer/lib/ipc';
import type { FileBuffer } from '../file-buffer';
import { fileErrorMessage } from '../file-buffer';
import './style.css';

// WebContentsView sits above DOM layers. Hide it whenever an application popup
// is present; keep the file toolbar outside its rectangle so source is reachable.
export function htmlViewOccluded(element: HTMLElement): boolean {
  if (document.visibilityState === 'hidden' || !element.getClientRects().length || element.closest('[hidden], [aria-hidden="true"], [inert]')) return true;
  return [...document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [data-slot="popover-content"]')].some((popup) => {
    if (!popup.getClientRects().length || popup.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = getComputedStyle(popup);
    return style.visibility !== 'hidden' && !(popup.hasAttribute('data-closed') && style.opacity === '0');
  });
}
export function FileHtmlPreview({ buffer }: { buffer: FileBuffer }) {
  const host = useRef<HTMLDivElement>(null), [attempt, setAttempt] = useState(0), [state, setState] = useState<HtmlPreviewState>({ state: 'loading', warnings: [], blockedRequests: 0 });
  useEffect(() => {
    const element = host.current!, id = crypto.randomUUID(); let alive = true, frame = 0, last = '', settle: ReturnType<typeof setTimeout> | undefined;
    setState({ state: 'loading', warnings: [], blockedRequests: 0 });
    const accept = (value: HtmlPreviewState) => { if (alive) setState(value); };
    const unlisten = events.on(fileHtmlEvent, (value) => { if (value.id === id) accept(value); });
    const sync = () => {
      frame = 0; if (!alive) return;
      const rect = element.getBoundingClientRect(), value = { id, x: rect.x, y: rect.y, width: rect.width, height: rect.height, visible: !htmlViewOccluded(element) };
      const next = JSON.stringify(value); if (last === next) return; last = next;
      void rpc.files.htmlBounds(value).catch((error) => accept({ state: 'failed', warnings: [], blockedRequests: 0, message: fileErrorMessage(error) }));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    void rpc.files.openHtml({ id, ref: buffer.file.ref, baseHash: buffer.baseHash }).then((value) => { accept(value); last = ''; schedule(); }).catch((error) => accept({ state: 'failed', warnings: [], blockedRequests: 0, message: fileErrorMessage(error) }));
    // Base UI keeps a closing popup mounted during its exit animation. Its
    // computed opacity changes without a DOM mutation; observe animation end
    // as well as open/closed attributes, and settle non-animated closures too.
    const changed = () => { schedule(); clearTimeout(settle); settle = setTimeout(schedule, 160); };
    const resize = new ResizeObserver(schedule), mutation = new MutationObserver(changed);
    resize.observe(element); mutation.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'inert', 'aria-hidden', 'data-open', 'data-closed', 'data-ending-style', 'data-starting-style', 'data-state', 'style', 'class'] });
    window.addEventListener('resize', schedule); document.addEventListener('scroll', schedule, true); document.addEventListener('visibilitychange', schedule); document.addEventListener('animationend', schedule, true); document.addEventListener('transitionend', schedule, true); schedule();
    return () => {
      alive = false; unlisten(); cancelAnimationFrame(frame); clearTimeout(settle); resize.disconnect(); mutation.disconnect();
      window.removeEventListener('resize', schedule); document.removeEventListener('scroll', schedule, true); document.removeEventListener('visibilitychange', schedule);
      document.removeEventListener('animationend', schedule, true); document.removeEventListener('transitionend', schedule, true);
      void rpc.files.closeHtml(id).catch(() => undefined);
    };
  }, [buffer.instance, buffer.baseHash, attempt]);
  return <div className="fw-html-preview" aria-label="HTML 文档预览">
    {(state.warnings.length > 0 || state.blockedRequests > 0) && <details className="fw-html-notice"><summary>部分页面功能不可用</summary>{state.warnings.map((warning, index) => <p key={index}>{warning}</p>)}{state.blockedRequests > 0 && <p>已拦截 {state.blockedRequests} 次不支持的请求或导航。</p>}</details>}
    <div className="fw-html-host" ref={host}>
      {state.state === 'loading' && <div className="fw-empty" role="status"><Loader2 className="animate-spin" size={20} />正在加载文档…</div>}
      {(state.state === 'failed' || state.state === 'closed') && <div className="fw-empty" role="alert"><FileCode2 size={24} /><p>{state.message ?? '文档预览已关闭'}</p><button onClick={() => setAttempt((value) => value + 1)}>重新加载</button></div>}
      {state.state === 'ready' && <span className="sr-only">文档已加载，使用顶部按钮可切回源码</span>}
    </div>
  </div>;
}
