import { describe, expect, it } from 'vitest';
import { OfficeAxis, columnName, logicalScroll, physicalScroll, SCROLL_LIMIT } from './layout';

describe('large worksheet navigation geometry', () => {
  it('skips a long hidden band while preserving real heights and the final visible row', () => {
    const axis = new OfficeAxis(1048576, 20, [{ first: 1, last: 999999, pixels: 0 }, { first: 1000000, last: 1000000, pixels: 40 }]);
    expect(axis.visible(0, 61, 100)).toEqual([0, 1000000, 1000001]);
    expect(axis.at(20)).toBe(1000000); expect(axis.next(1000000, -1)).toBe(0);
    expect(axis.visible(axis.total - 20, 100, 100)).toEqual([1048575]);
    expect(columnName(16383)).toBe('XFD');
  });
  it('maps very large logical scroll extents into browser-safe size without losing the last row', () => {
    const total = 500_000_000, viewport = 600;
    expect(physicalScroll(total - viewport, total, viewport)).toBe(SCROLL_LIMIT - viewport);
    expect(logicalScroll(SCROLL_LIMIT - viewport, total, viewport)).toBe(total - viewport);
    const position = 23456789; expect(logicalScroll(physicalScroll(position, total, viewport), total, viewport)).toBeCloseTo(position, 6);
  });
});
