import { describe, expect, it } from 'vitest';
import { compactRelativeTime } from './relative-time';

const now = Date.UTC(2026, 9, 15, 12);
const ago = (ms: number) => compactRelativeTime(now - ms, now);
const m = 60_000;
const h = 60 * m;
const d = 24 * h;

describe('compactRelativeTime', () => {
  it('says now under a minute, also for clocks slightly ahead', () => {
    expect(ago(0)).toBe('now');
    expect(ago(59_999)).toBe('now');
    expect(ago(-5_000)).toBe('now');
  });

  it('floors to the largest whole unit', () => {
    expect(ago(m)).toBe('1m');
    expect(ago(59 * m + 59_000)).toBe('59m');
    expect(ago(h)).toBe('1h');
    expect(ago(23 * h + 59 * m)).toBe('23h');
    expect(ago(d)).toBe('1d');
    expect(ago(29 * d)).toBe('29d');
    expect(ago(30 * d)).toBe('1mo');
    expect(ago(364 * d)).toBe('12mo');
    expect(ago(365 * d)).toBe('1y');
    expect(ago(800 * d)).toBe('2y');
  });
});
