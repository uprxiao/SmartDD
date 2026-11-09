import { buildInsertion, sanitizeTerminalText } from './file-reference-model.mjs';
export const FILE_DRAG_TYPE = 'application/x-willyou-prototype-file';
let activeDrag = null;
let cancelledDragToken = null;
let sequence = 0;
// Root and file come from the synthetic workspace catalog, never from a browser URL.
// Production must resolve an opaque root/file identity in main; this is not a real root lease.
export function absoluteFilePath(rootPath, relativePath) {
  if (typeof rootPath !== 'string' || typeof relativePath !== 'string' || !relativePath) return { ok: false, error: 'invalid-path' };
  for (const value of [rootPath, relativePath]) {
    if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) || sanitizeTerminalText(value).text !== value) return { ok: false, error: 'unsafe-path' };
  }
  if (!/^(\/|[A-Za-z]:\/)/.test(rootPath) || /^[\/\\]|^[A-Za-z]:/.test(relativePath) || /\\/.test(rootPath + relativePath) || [...rootPath.split('/'), ...relativePath.split('/')].some(p => p === '.' || p === '..')) return { ok: false, error: 'invalid-path' };
  return { ok: true, path: rootPath.replace(/\/+$/, '') + '/' + relativePath };
}
export function beginFileDrag({ taskId, ptyId = taskId, rootPath, relativePath }) {
  cancelledDragToken = null;
  const result = absoluteFilePath(rootPath, relativePath);
  activeDrag = result.ok && taskId ? { token: 'file-drag-' + ++sequence, taskId, ptyId, path: result.path } : null;
  return activeDrag ? { ok: true, token: activeDrag.token } : { ok: false, error: result.error || 'no-task' };
}
export function resolveFileDrag(token, taskId, ptyId = taskId) {
  if (!activeDrag || activeDrag.token !== token) {
    if (!activeDrag && cancelledDragToken === token) { cancelledDragToken = null; return { ok: false, error: 'cancelled-drag' }; }
    return { ok: false, error: 'unknown-drag' };
  }
  if (activeDrag.taskId !== taskId || activeDrag.ptyId !== ptyId) return { ok: false, error: 'foreign-task' };
  const path = activeDrag.path; activeDrag = null;
  return { ok: true, path };
}
export function endFileDrag() { if (activeDrag) cancelledDragToken = activeDrag.token; activeDrag = null; }
export function buildFilePathInsertion({ path, existingInput = '', ...terminal }) {
  if (typeof path !== 'string' || !/^(\/|[A-Za-z]:\/)/.test(path)) return { ok: false, error: 'invalid-path' };
  // Paths must be rejected, not sanitised into a different file name.
  if (/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(path) || sanitizeTerminalText(path).text !== path) return { ok: false, error: 'unsafe-path' };
  const text = (existingInput && !/\s$/.test(existingInput) ? ' ' : '') + path + ' ';
  const result = buildInsertion({ ...terminal, text, bracketedPaste: false });
  return result.ok ? { ...result, data: text } : result;
}
