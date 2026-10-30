import { FILE_SEARCH_INPUT_LIMIT, isWellFormedSearchText } from '../../../src/shared/file-search-input.mjs';
// Synthetic prototype search history only; never reads application settings.
export const SEARCH_HISTORY_KEY = 'willyou-m9-search-history-v1';

export function normalizeSearchHistory(value) {
  const unique = (items, trim, limit) => [...new Set((Array.isArray(items) ? items : [])
    .filter(item => isWellFormedSearchText(item) && item.length <= FILE_SEARCH_INPUT_LIMIT)
    .map(item => trim ? item.trim() : item).filter(Boolean))].slice(0, limit);
  return { queries: unique(value?.queries, false, 30), masks: unique(value?.masks, true, 20) };
}

export function readSearchHistories(storage) {
  try {
    const value = JSON.parse(storage.getItem(SEARCH_HISTORY_KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    const seen = new Set();
    return value.filter(item => {
      if (!item || typeof item.scope !== 'string' || seen.has(item.scope)) return false;
      seen.add(item.scope); return true;
    }).slice(0, 20).map(item => ({ scope: item.scope, ...normalizeSearchHistory(item) }));
  } catch { return []; }
}

export function writeSearchHistory(storage, scope, value) {
  const current = { scope, ...normalizeSearchHistory(value) };
  // MRU changes only when the user remembers a query/mask, not on dialog read.
  const next = [current, ...readSearchHistories(storage).filter(item => item.scope !== scope)].slice(0, 20);
  storage.setItem(SEARCH_HISTORY_KEY, JSON.stringify(next));
  return current;
}
