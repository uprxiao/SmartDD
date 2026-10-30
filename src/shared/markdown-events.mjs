/** Link activation is separate from selection and never authorizes a file path. */
export function markdownLinkAllowed(event, { editorEmpty = true, nativeSelected = false } = {}) {
  return event.button === 0 && event.detail <= 1 && !event.shiftKey && editorEmpty && !nativeSelected;
}
export function markdownNativeSelection(root, selection = root.ownerDocument.getSelection()) {
  return Boolean(selection && !selection.isCollapsed && root.contains(selection.anchorNode) && root.contains(selection.focusNode));
}
/** One native mouseup owner. Remove before invoking code that can destroy DOM. */
export function waitMarkdownMouseup(document, { signal, isCurrent, finish, settled = () => {} }) {
  let active = true;
  const cancel = () => { if (!active) return; active = false; document.removeEventListener('mouseup', onUp); signal?.removeEventListener('abort', cancel); settled(); };
  const onUp = event => { if (!active) return; cancel(); if (event.button === 0 && isCurrent()) finish(event); };
  if (signal?.aborted) { active = false; return cancel; }
  document.addEventListener('mouseup', onUp); signal?.addEventListener('abort', cancel, { once: true });
  return cancel;
}
