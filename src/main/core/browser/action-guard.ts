/** Evaluated in an isolated world before page scripts; page code cannot replace these intrinsics/state. */
export const BROWSER_GUARD_WORLD = 'willyou-browser-identity-v1';
export const BROWSER_GUARD_SOURCE = String.raw`(() => {
  if (globalThis.__wyBrowserGuard) return;
  let target = null, root = null, previousFocus = null, blocked = [], accepted = [];
  const kinds = ['pointerdown','mousedown','pointerup','mouseup','click','dblclick','keydown','keyup','keypress','beforeinput','input','change','focus','focusin','pointermove','mousemove','pointerover','mouseover','pointerenter','mouseenter'];
  function matches(e) {
    if (!target || !target.isConnected) return false;
    // A click may first reposition the virtual pointer outside its destination.
    // Once the retained node is gone, even those preparatory events are blocked.
    if (/^(pointer|mouse)(move|over|enter)$/.test(e.type)) return true;
    if ((e.type === 'focus' || e.type === 'focusin') && (e.target === window || e.target === document)) return true;
    // Clicking away from an edited input commits its pending change on blur.
    // Permit only that same retained previous-focus node while the action target remains connected.
    if (e.type === 'change' && previousFocus && previousFocus.isConnected && e.target === previousFocus) return true;
    const path = e.composedPath();
    if (path.includes(target)) return true;
    // Closed shadow roots retarget events at their host. Inspect that same retained root.
    if (root && root !== document) {
      let actual = null;
      if (typeof e.clientX === 'number' && root.elementFromPoint) actual = root.elementFromPoint(e.clientX, e.clientY);
      else actual = root.activeElement;
      if (actual && (actual === target || target.contains(actual))) return true;
    }
    // Enter events also visit ancestors of the intended target.
    return /^(pointer|mouse)(over|enter)$/.test(e.type) && e.target instanceof Node && e.target.contains(target);
  }
  function guard(e) {
    if (!target) return;
    if (matches(e)) { accepted.push(e.type); return; }
    e.preventDefault(); e.stopImmediatePropagation(); blocked.push(e.type);
  }
  for (const kind of kinds) window.addEventListener(kind, guard, true);
  Object.defineProperty(globalThis, '__wyBrowserGuard', {value: {
    arm(node) { if (!node || !node.isConnected) return false; target = node; root = node.getRootNode(); previousFocus = document.activeElement; blocked = []; accepted = []; return true; },
    valid() { return !!target && target.isConnected; },
    state() { return {blocked:blocked.slice(), accepted:accepted.slice(), connected:!!target && target.isConnected}; },
    disarm() { const result = this.state(); target = null; root = null; previousFocus = null; blocked = []; accepted = []; return result; }
  }});
})()`;
