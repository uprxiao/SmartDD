import { expect, it } from 'vitest';
import { readSearchHistory, rememberSearchHistory } from './search-history';
const storage = () => { const map = new Map<string, string>(); return { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value); }, removeItem: (key: string) => { map.delete(key); }, key: (index: number) => [...map.keys()][index] ?? null, get length() { return map.size; } }; };
it('R08 U: invalid legacy masks are not replayed, read does not rewrite stored data', () => {
  const s = storage(), key = 'willyou-file-search-v1:own'; const original = JSON.stringify({ query: ['valid', 'x\ud800', 'x'.repeat(257)], mask: ['*.ts', 'x'.repeat(257), 'x\udc00'] }); s.setItem(key, original);
  expect(readSearchHistory(key, s)).toEqual({ query: ['valid'], mask: ['*.ts'] }); expect(s.getItem(key)).toBe(original);
});
it('R08 U: remembering history keeps whole256-unit Unicode and excludes oversized input', () => {
  const s = storage(), key = 'willyou-file-search-v1:own', query = '中'.repeat(254) + '🙂';
  const valid = rememberSearchHistory(key, { query: [], mask: [] }, query, query, s); expect(valid).toEqual({ query: [query], mask: [query] });
  expect(rememberSearchHistory(key, valid, query + 'x', query + 'x', s)).toEqual(valid);
});
