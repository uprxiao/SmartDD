import { describe, expect, it } from 'vitest';
import { limitNameResults, nameResultNotice } from './file-name-results.mjs';
describe('C13 complete ranking then bounded presentation', () => {
  it.each([4999, 5000, 5001])('%i matches retain an exact total, stable prefix and truthful truncation', total => {
    const ranked = Array.from({ length: total }, (_, index) => ({ path: `cap-${String(index).padStart(5, '0')}.txt`, index })), before = [...ranked], result = limitNameResults(ranked);
    expect(result).toMatchObject({ total, limit: 5000, truncated: total > 5000 }); expect(result.ranked).toEqual(ranked.slice(0, 5000)); expect(ranked).toEqual(before);
    if (total > 5000) expect(nameResultNotice(result)).toBe('名称结果仅显示前 5000 项（共 5001 项）。请缩小关键词查看其余匹配。'); else expect(nameResultNotice(result)).toBe('');
  });
  it('does not reorder equal labels or mutate source records and rejects invalid budgets', () => {
    const ranked = [{ path: 'b/same.txt' }, { path: 'a/same.txt' }, { path: 'c/same.txt' }]; expect(limitNameResults(ranked, 2).ranked).toEqual(ranked.slice(0, 2)); expect(ranked).toHaveLength(3);
    for (const limit of [0, -1, 1.5, NaN, Infinity, 200001]) expect(() => limitNameResults(ranked, limit)).toThrow('limit');
  });
});
