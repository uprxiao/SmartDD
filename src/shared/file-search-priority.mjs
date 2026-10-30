/** Relative hints only reorder paths already enumerated by the trusted walk.
 * The caller's authority, exclusions and mask still decide membership. */
export function prioritizeSearchPaths(paths, priorityFolders = []) {
  const folders = [...new Set(priorityFolders)];
  if (!folders.length) return [...paths];
  const buckets = Array.from({ length: folders.length + 1 }, () => []);
  for (const path of paths) {
    const at = folders.findIndex(folder => folder === '' || path.startsWith(folder + '/'));
    buckets[at < 0 ? folders.length : at].push(path);
  }
  return buckets.flat();
}
/** Nearest active-file ancestors first; a different selected root has no hint. */
export function searchPriorityFolders(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.startsWith('/') || relativePath.includes('\0') || relativePath.split('/').some(p => !p || p === '.' || p === '..')) return [];
  const parts = relativePath.split('/'); parts.pop();
  const folders = [];
  while (parts.length && folders.length < 64) { folders.push(parts.join('/')); parts.pop(); }
  return folders;
}
