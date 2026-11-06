import { expect, it } from 'vitest';
import { markdownNodeRevealed } from './markdown-inline-plan.mjs';

it.each([
  { focused: false, from: 12, to: 12, expected: false },
  { focused: true, from: 9, to: 9, expected: false },
  { focused: true, from: 10, to: 10, expected: true },
  { focused: true, from: 15, to: 15, expected: true },
  { focused: true, from: 20, to: 20, expected: true },
  { focused: true, from: 21, to: 21, expected: false },
  { focused: true, from: 5, to: 25, expected: true },
])('DEV117 source node visibility $focused $from..$to', ({ focused, from, to, expected }) => {
  expect(markdownNodeRevealed({ kind: 'entity', from: 10, to: 20 }, [{ from, to }], focused)).toBe(expected);
});
it('DEV117 linked image/entity source is available while editing its containing link', () => {
  const node = { kind: 'image' as const, from: 10, to: 20, parents: [[8, 30] as [number, number]] };
  expect(markdownNodeRevealed(node, [{ from: 25, to: 25 }], true)).toBe(true);
  expect(markdownNodeRevealed(node, [{ from: 25, to: 25 }], false)).toBe(false);
  expect(markdownNodeRevealed(node, [{ from: 35, to: 35 }], true)).toBe(false);
});
