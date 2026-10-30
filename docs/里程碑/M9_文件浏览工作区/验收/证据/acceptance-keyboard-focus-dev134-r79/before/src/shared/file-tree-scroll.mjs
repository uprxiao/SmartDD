// Shared by the production tree and its synthetic prototype. Keep an already
// visible row still; reveal only the obscured edge, allowing for sticky parents.
export const FILE_TREE_ROW_HEIGHT = 28;
export function nearestTreeScroll(index, scrollTop, height, stickyHeight = 0) {
  const top = Math.max(0, index) * FILE_TREE_ROW_HEIGHT, bottom = top + FILE_TREE_ROW_HEIGHT;
  if (top < scrollTop + stickyHeight) return Math.max(0, top - stickyHeight);
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}
