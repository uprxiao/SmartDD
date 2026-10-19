// Shared App/prototype Ctrl+wheel lifecycle, independently implemented from the
// reviewed M9 D04 behavior. Each binding belongs to exactly one document/session.
const snapPoints = [30, 40, 50, 67, 75, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500, 600, 700, 800];
const clamp = value => Math.max(30, Math.min(800, value));
export function bindPdfWheel(node, { getZoom, setZoom, onZooming, onAnchor }) {
  let raw = null, applied = null, zoomTimer, rawTimer, frame, anchor = null, disposed = false;
  const wheel = event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (!Number.isFinite(event.deltaY) || event.deltaY === 0 || disposed) return;
    const previous = getZoom();
    // An explicit menu/fit change starts a new scale baseline.
    if (applied !== null && previous !== applied) raw = null;
    raw = clamp((raw ?? previous) * Math.exp(-Math.max(-20, Math.min(20, event.deltaY)) * .005));
    const next = snapPoints.find(point => Math.abs(point - raw) <= point * .02) ?? raw;
    applied = next;
    clearTimeout(zoomTimer); clearTimeout(rawTimer);
    onZooming(true);
    zoomTimer = setTimeout(() => { zoomTimer = undefined; if (!disposed) onZooming(false); }, 120);
    rawTimer = setTimeout(() => { rawTimer = undefined; raw = null; }, 200);
    const rect = node.getBoundingClientRect(), x = event.clientX - rect.left, y = event.clientY - rect.top;
    // Several events may arrive before one animation frame. Carry the pending
    // anchor forward instead of repeatedly reading an unapplied scroll offset.
    anchor = { left: ((anchor?.left ?? node.scrollLeft) + x) * next / previous - x, top: ((anchor?.top ?? node.scrollTop) + y) * next / previous - y };
    onAnchor?.(anchor); setZoom(next);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      if (disposed || !anchor) return;
      node.scrollLeft = anchor.left; node.scrollTop = anchor.top; anchor = null;
    });
  };
  node.addEventListener('wheel', wheel, { passive: false });
  return () => {
    disposed = true; node.removeEventListener('wheel', wheel);
    clearTimeout(zoomTimer); clearTimeout(rawTimer);
    if (frame !== undefined) cancelAnimationFrame(frame);
    raw = anchor = null;
  };
}
