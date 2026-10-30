import { describe, expect, it } from 'vitest';
import { findText } from './text-find';

describe('file find source positions', () => {
  it('preserves original offsets after Unicode case folds and emoji', () => {
    const source = 'İ😀中文 FOO foo';
    const matches = findText(source, 'foo');
    expect(matches.map(({ from, to }) => source.slice(from, to))).toEqual(['FOO', 'foo']);
    expect(matches[0].from).toBe(6);
  });
  it('treats regex characters literally and bounds repeated matches', () => {
    expect(findText('a.*b .*', '.*')).toEqual([{ from: 1, to: 3 }, { from: 5, to: 7 }]);
    expect(findText('xxxxx', 'x', 2)).toHaveLength(2);
    expect(findText('x', '')).toEqual([]);
  });
});
