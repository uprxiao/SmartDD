// Presentation only. These local POSIX paths come from issued roots and main's
// file metadata; this helper neither grants IO authority nor rewrites a route.
function localPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\0')) return null;
  const path = value.replace(/\/+$/, '') || '/';
  return path !== '/' && path.slice(1).split('/').some(part => !part || part === '.' || part === '..') ? null : path;
}
function rootPath(root) {
  return root && (!root.hostId || root.hostId === 'local') ? localPath(root.canonicalPath ?? root.path) : null;
}
export function rootRelativePath(root, absolutePath) {
  const base = rootPath(root), path = localPath(absolutePath);
  if (!base || !path) return null;
  if (base === path) return '';
  return path.startsWith(base === '/' ? '/' : base + '/') ? path.slice(base === '/' ? 1 : base.length + 1) : null;
}
export function fileAbsolutePath(root, relativePath) {
  const base = rootPath(root);
  if (!base || typeof relativePath !== 'string' || relativePath.startsWith('/') || relativePath.includes('\0') || relativePath && relativePath.split('/').some(part => !part || part === '.' || part === '..')) return null;
  return relativePath ? (base === '/' ? '/' : base + '/') + relativePath : base;
}
export function fileDisplayLocation(roots, absolutePath, sourceRoot) {
  let found = null, length = -1;
  for (const root of roots) {
    const relativePath = rootRelativePath(root, absolutePath), base = rootPath(root);
    if (relativePath === null || !base || base.length < length || base.length === length && root !== sourceRoot) continue;
    found = { root, relativePath, absolutePath }; length = base.length;
  }
  return found;
}
export function fileNavigationLocation(roots, absolutePath, currentRoot, sourceRoot) {
  const relativePath = roots.includes(currentRoot) ? rootRelativePath(currentRoot, absolutePath) : null;
  return relativePath !== null ? { root: currentRoot, relativePath, absolutePath } : fileDisplayLocation(roots, absolutePath, sourceRoot);
}
