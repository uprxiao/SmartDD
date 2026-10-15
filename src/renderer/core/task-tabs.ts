/** Opening a task that already has a tab focuses it; otherwise the new tab goes after the current one. */
export function withTab(tabs: readonly string[], taskId: string, current: string | null): string[] {
  if (tabs.includes(taskId)) return [...tabs];
  const at = current ? tabs.indexOf(current) : -1;
  if (at === -1) return [...tabs, taskId];
  return [...tabs.slice(0, at + 1), taskId, ...tabs.slice(at + 1)];
}

/**
 * The tab to show after closing one, like browsers: the closed tab's right neighbour, else its
 * left one; closing a background tab keeps the current one. null: no tabs left.
 */
export function nextTabAfterClose(tabs: readonly string[], closing: string, current: string | null): string | null {
  const rest = tabs.filter((id) => id !== closing);
  if (current !== closing && current !== null && rest.includes(current)) return current;
  if (rest.length === 0) return null;
  const at = tabs.indexOf(closing);
  return rest[Math.min(Math.max(at, 0), rest.length - 1)];
}
