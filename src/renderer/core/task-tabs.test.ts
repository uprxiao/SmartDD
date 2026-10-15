import { describe, expect, it } from 'vitest';
import { nextTabAfterClose, withTab } from './task-tabs';

describe('withTab', () => {
  it('keeps an open tab where it is', () => {
    expect(withTab(['a', 'b'], 'a', 'b')).toEqual(['a', 'b']);
  });

  it('opens a new tab after the current one, or at the end', () => {
    expect(withTab(['a', 'b', 'c'], 'x', 'a')).toEqual(['a', 'x', 'b', 'c']);
    expect(withTab(['a', 'b'], 'x', null)).toEqual(['a', 'b', 'x']);
    expect(withTab(['a', 'b'], 'x', 'gone')).toEqual(['a', 'b', 'x']);
    expect(withTab([], 'x', null)).toEqual(['x']);
  });
});

describe('nextTabAfterClose', () => {
  it('moves to the right neighbour, else the left one', () => {
    expect(nextTabAfterClose(['a', 'b', 'c'], 'b', 'b')).toBe('c');
    expect(nextTabAfterClose(['a', 'b', 'c'], 'c', 'c')).toBe('b');
    expect(nextTabAfterClose(['a', 'b', 'c'], 'a', 'a')).toBe('b');
  });

  it('keeps the current tab when closing another one', () => {
    expect(nextTabAfterClose(['a', 'b', 'c'], 'c', 'a')).toBe('a');
  });

  it('gives null once the last tab closes', () => {
    expect(nextTabAfterClose(['a'], 'a', 'a')).toBeNull();
  });
});
