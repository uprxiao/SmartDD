export const FILE_TREE_ROW_HEIGHT: number;
export function treeSetInfo(rows: readonly { path: string }[]): Record<string, { pos: number; size: number }>;
export function nearestTreeScroll(index: number, scrollTop: number, height: number, stickyHeight?: number): number;
