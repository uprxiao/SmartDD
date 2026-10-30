// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileDocument } from '@shared/files';
import { FileReviewText } from './preview';
import { createReviewTextClient } from './client';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
vi.mock('./client', () => ({ createReviewTextClient: vi.fn() }));
const open = vi.mocked(createReviewTextClient);
const file = (id: string) => ({ ref: { id }, revision: { hash: id, size: 42 } }) as FileDocument;
const reader = (text: string) => ({ window: vi.fn(async () => ({ text, index: 0, start: 0, end: 42, total: 42, pages: 1 })), destroy: vi.fn(async () => undefined) });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('a delayed previous-file reader cannot replace the next file or publish its old ready body', async () => {
  const old = reader('OLD SOURCE'), next = reader('CURRENT SOURCE'); let resolve!: (value: unknown) => void;
  open.mockImplementationOnce(() => new Promise(done => { resolve = done; }) as never).mockResolvedValueOnce(next as never);
  const view = render(<FileReviewText file={file('old')} />);
  view.rerender(<FileReviewText file={file('next')} />);
  await screen.findByText('CURRENT SOURCE');
  await act(async () => { resolve(old); });
  expect(old.destroy).toHaveBeenCalledTimes(1); expect(old.window).not.toHaveBeenCalled();
  expect(screen.queryByText('OLD SOURCE')).toBeNull(); expect(document.querySelector('.fw-review-text')?.getAttribute('data-sha256')).toBe('next');
});
it('cancel preserves a distinct state and retry creates a fresh reader without accepting the cancelled body', async () => {
  const next = reader('AFTER RETRY'); let cancelled: AbortSignal | undefined;
  open.mockImplementationOnce((_file, _api, signal) => {
    cancelled = signal;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }));
  }).mockResolvedValueOnce(next as never);
  render(<FileReviewText file={file('source')} />); fireEvent.click(screen.getByText('取消读取'));
  await screen.findByText('已取消读取，原始文件保持不变'); expect(cancelled?.aborted).toBe(true);
  expect(document.querySelector('.fw-review-text')?.getAttribute('data-complete')).toBe('false');
  fireEvent.click(screen.getByText('重新读取')); await screen.findByText('AFTER RETRY');
  await waitFor(() => expect(document.querySelector('.fw-review-text')?.getAttribute('data-complete')).toBe('true'));
  expect(open).toHaveBeenCalledTimes(2);
});
