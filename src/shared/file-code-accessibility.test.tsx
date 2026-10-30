// @vitest-environment jsdom
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FileCodeTextarea } from '../../prototypes/m6-codex/src/FileCodeTextarea';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Worker', class { onmessage = null; postMessage() {} terminate() {} });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('describes actual forward and backward UTF16 selection heads and preserves the original callbacks/ref', () => {
  const ref = createRef<HTMLTextAreaElement>(), select = vi.fn(), focus = vi.fn(), change = vi.fn();
  render(<FileCodeTextarea filename="src/main.ts" value={'alpha\n中文🙂\n'} aria-label="文件编辑器" ref={ref} onSelect={select} onFocus={focus} onChange={change} />);
  const input = screen.getByRole('textbox', { name: '文件编辑器' }) as HTMLTextAreaElement;
  expect(ref.current).toBe(input);
  expect(input.getAttribute('aria-description')).toBe('第 1 行，第 1 列');
  input.focus(); expect(focus).toHaveBeenCalledTimes(1);
  input.setSelectionRange(10, 10); fireEvent.select(input);
  expect(input.getAttribute('aria-description')).toBe('第 2 行，第 5 列');
  input.setSelectionRange(6, 10, 'backward'); fireEvent.select(input);
  expect(input.getAttribute('aria-description')).toBe('第 2 行，第 1 列');
  expect(select).toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
  expect(input.value).toBe('alpha\n中文🙂\n'); expect(ref.current).toBe(input);
});

it('recomputes its description after a shorter external value and retains read-only state', () => {
  const props = { filename: 'same.ts', 'aria-label': '文件编辑器', readOnly: true };
  const view = render(<FileCodeTextarea {...props} value={'alpha\n中文🙂\n'} />);
  const input = screen.getByRole('textbox', { name: '文件编辑器' }) as HTMLTextAreaElement;
  input.setSelectionRange(10, 10); fireEvent.keyUp(input, { key: 'ArrowRight' });
  expect(input.getAttribute('aria-description')).toBe('第 2 行，第 5 列');
  view.rerender(<FileCodeTextarea {...props} value="x" />);
  expect(input.getAttribute('aria-description')).toBe('第 1 行，第 2 列');
  expect(input.readOnly).toBe(true); expect(input.value).toBe('x');
});
