// Context delivery stops at the terminal insertion receipt. It has no CLI lifecycle.
export const OFFICE_CONTEXT_TIMEOUT_MS = 1500;
const finalStates = new Set(['inserted', 'failed', 'unknown']);
export function createOfficeContexts(scope) {
  return { scope, operation: 0, nextId: 1, phase: 'idle', pendingIds: [], requests: [], error: '' };
}
export function addOfficeContext(state, { body, page, selectedText = '', elementId = null, purpose }) {
  if (typeof body !== 'string' || !body.trim() || !Number.isInteger(page) || page < 1) return state;
  const item = { id: `office-comment-${state.nextId}`, body, page, selectedText, elementId, delivery: 'queued', ...(purpose === 'generation' ? { purpose } : {}) };
  return { ...state, nextId: state.nextId + 1, requests: [...state.requests, item] };
}
export function beginOfficeContexts(state) {
  if (state.phase === 'inserting') return state;
  const pendingIds = state.requests.filter(item => ['queued', 'failed'].includes(item.delivery)).map(item => item.id);
  if (!pendingIds.length) return state; // Unknown and inserted items never retry implicitly.
  return { ...state, operation: state.operation + 1, phase: 'inserting', pendingIds, error: '' };
}
export function startOfficeContext(state, operation, id) {
  if (state.phase !== 'inserting' || state.operation !== operation || !state.pendingIds.includes(id)) return state;
  return { ...state, requests: state.requests.map(item => item.id === id && ['queued', 'failed'].includes(item.delivery) ? { ...item, delivery: 'inserting' } : item) };
}
export function finishOfficeContext(state, scope, operation, id, status) {
  if (state.scope !== scope || state.operation !== operation || state.phase !== 'inserting' || !finalStates.has(status)) return state;
  if (!state.requests.some(item => item.id === id && item.delivery === 'inserting')) return state;
  const requests = state.requests.map(item => item.id === id ? { ...item, delivery: status } : item);
  const remaining = state.pendingIds.filter(value => value !== id);
  const error = status === 'unknown' ? '插入结果未知，请先检查终端输入；评论已保留，不会自动重发。' : status === 'failed' ? '评论未插入终端，内容已保留，可重试失败评论。' : '';
  return { ...state, requests, pendingIds: status === 'inserted' ? remaining : [], phase: status === 'inserted' && remaining.length ? 'inserting' : status, error };
}
export function officeContextResult(result) {
  if (finalStates.has(result?.status)) return result.status;
  if (result?.ok === true) return 'inserted';
  if (result?.ok === false && result.error && !['terminal-no-response', 'timeout', 'transport-unknown'].includes(result.error)) return 'failed';
  return 'unknown';
}
export function formatOfficeContext(path, item) {
  return `${path} · 第 ${item.page} 页\n${item.elementId ? `对象：${item.elementId}\n` : ''}${item.selectedText ? `所选文字：${item.selectedText}\n` : ''}评论：${item.body}`;
}
export async function deliverOfficeContext(handler, text, metadata, timeoutMs = OFFICE_CONTEXT_TIMEOUT_MS) {
  if (typeof handler !== 'function') return { status: 'failed', error: 'no-terminal-adapter' };
  let timer;
  try {
    return await Promise.race([
      // A thrown/rejected transport could have inserted before losing its receipt.
      Promise.resolve().then(() => handler(text, metadata)).catch(() => ({ status: 'unknown', error: 'transport-unknown' })),
      new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'unknown', error: 'terminal-no-response' }), timeoutMs); })
    ]);
  } finally { clearTimeout(timer); }
}
