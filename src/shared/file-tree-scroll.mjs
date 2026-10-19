// Shared by the production tree and its synthetic prototype. Keep an already
// visible row still; reveal only the obscured edge, allowing for sticky parents.
export const FILE_TREE_ROW_HEIGHT = 28;
// Count logical visible siblings, including virtual rows outside the viewport.
export function treeSetInfo(rows) {
  const groups = new Map();
  for (const { path } of rows) {
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (!groups.has(parent)) groups.set(parent, []);
    groups.get(parent).push(path);
  }
  return Object.fromEntries([...groups.values()].flatMap(list => list.map((path, index) => [path, { pos: index + 1, size: list.length }])));
}
export function nearestTreeScroll(index, scrollTop, height, stickyHeight = 0) {
  const top = Math.max(0, index) * FILE_TREE_ROW_HEIGHT, bottom = top + FILE_TREE_ROW_HEIGHT;
  if (top < scrollTop + stickyHeight) return Math.max(0, top - stickyHeight);
  if (bottom > scrollTop + height) return Math.max(0, bottom - height);
  return scrollTop;
}
