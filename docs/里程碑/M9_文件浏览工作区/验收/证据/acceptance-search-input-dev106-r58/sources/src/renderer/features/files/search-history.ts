import type { FileRoot, FileScope } from '@shared/files';
import { FILE_SEARCH_INPUT_LIMIT, isWellFormedSearchText } from '@shared/file-search-input.mjs';

export interface SearchHistory { query: string[]; mask: string[] }
type HistoryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'key' | 'length'>;
const prefix = 'willyou-file-search-v1:';
const scopeIndex = 'willyou-file-search-scopes-v1';

export function searchHistoryKey(scope: FileScope, root: FileRoot | null): string {
  return `${prefix}${JSON.stringify([scope, root?.canonicalPath, root?.identity])}`;
}
function strings(input: unknown, capacity: number, length: number, trim: boolean): string[] {
  if (!Array.isArray(input)) return [];
  const values: string[] = [];
  for (const item of input) {
    if (!isWellFormedSearchText(item) || item.length > length) continue;
    const value = trim ? item.trim() : item;
    if (!value.trim() || values.includes(value)) continue;
    values.push(value); if (values.length === capacity) break;
  }
  return values;
}
function normalize(input: unknown): SearchHistory {
  const data = input && typeof input === 'object' ? input as Partial<SearchHistory> : {};
  return { query: strings(data.query, 30, FILE_SEARCH_INPUT_LIMIT, false), mask: strings(data.mask, 20, FILE_SEARCH_INPUT_LIMIT, true) };
}
export function readSearchHistory(key: string, storage: HistoryStorage = localStorage): SearchHistory {
  try { return normalize(JSON.parse(storage.getItem(key) ?? '{}')); }
  catch { return { query: [], mask: [] }; }
}
export function rememberSearchHistory(key: string, previous: SearchHistory, query: string, mask: string, storage: HistoryStorage = localStorage): SearchHistory {
  const next = normalize({ query: [query, ...previous.query], mask: [mask, ...previous.mask] });
  try {
    let indexed: unknown;
    try { indexed = JSON.parse(storage.getItem(scopeIndex) ?? '[]'); } catch { indexed = []; }
    const existing: string[] = [];
    for (let index = 0; index < storage.length; index++) { const candidate = storage.key(index); if (candidate?.startsWith(prefix)) existing.push(candidate); }
    // Match the approved prototype: remembering, not opening, promotes a scope.
    // Older per-scope records have no timestamps. Preserve their storage order
    // behind known MRU entries and bound them when the next history is written.
    const ordered = [key, ...(Array.isArray(indexed) ? indexed.filter((value): value is string => typeof value === 'string' && existing.includes(value)) : []), ...existing];
    const keep = [...new Set(ordered)].slice(0, 20);
    storage.setItem(key, JSON.stringify(next));
    storage.setItem(scopeIndex, JSON.stringify(keep));
    for (const candidate of existing) if (!keep.includes(candidate)) storage.removeItem(candidate);
  } catch { /* The current dialog retains history when browser storage is unavailable. */ }
  return next;
}
