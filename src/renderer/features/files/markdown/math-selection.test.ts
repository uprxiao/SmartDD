import { describe, expect, it } from 'vitest';
import { analyze, renderWindow } from './model.mjs';

describe('DEV116 mathematical source boundaries', () => {
  it.each(['\n', '\r\n', '\r'])('keeps parser content-end and raw UTF-16 positions with %j', eol => {
    const source = ['---', 'title: test', '---', '', '# 中文😀 $a^2$ 和 $b_1$', '', '$$', 'c+d', '$$', '', '> 引用 $q$', '', '- 项 $r$', '', 'Tail', ''].join(eol);
    const items = renderWindow(analyze(source).parsed, 0, 60);
    const ranges = items.flatMap(item => item.math ?? []);
    expect(ranges.map(item => item.code)).toEqual(['a^2', 'b_1', '\nc+d\n', 'q', 'r']);
    expect(ranges.map(item => source.slice(item.from, item.to))).toEqual(['$a^2$', '$b_1$', ['$$', 'c+d', '$$'].join(eol), '$q$', '$r$']);
    for (const item of ranges) {
      expect(source.slice(item.contentEnd, item.contentEnd + (item.block ? 2 : 1))).toBe(item.block ? '$$' : '$');
      expect(item.contentEnd).toBeGreaterThan(item.from);
      expect(item.contentEnd).toBeLessThan(item.to);
    }
  });
  it('does not confuse repeated formulas, inline double dollars or an equation number', () => {
    const source = '$x$ and $x$ and $$x+y$$\n\n$$z$$ (eq-1)\n';
    const ranges = renderWindow(analyze(source).parsed, 0, 60).flatMap(item => item.math ?? []);
    expect(ranges.map(item => [item.from, item.to, item.contentEnd, item.displayMode])).toEqual([[0, 3, 2, false], [8, 11, 10, false], [16, 23, 21, true], [25, 37, 28, true]]);
    expect(ranges[3].html).toContain('(eq-1)');
  });
});
