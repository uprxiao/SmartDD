// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
// The isolated prototype is JavaScript and has no public renderer declaration.
// @ts-expect-error Prototype component imported solely for its boundary regression.
import { FileMarkdown } from '../../../../../prototypes/m6-codex/src/FileMarkdown.jsx';
const api = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock('../../../../../prototypes/m6-codex/src/image-download.mjs', () => ({ downloadImageCopy: api.download }));
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  api.download.mockRejectedValueOnce(new Error('公开合成下载失败'));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
it('the normal prototype Markdown host reports a failed download inside its modal and can retry', async () => {
  const notice = vi.fn();
  render(<FileMarkdown text={'![公开图](image.gif)'} path="images.md" readOnly onImageAction={notice} resolveImageSource={() => 'data:image/gif;base64,R0lGODlhAQABAAAAACw='} />);
  fireEvent.click(screen.getByRole('button', { name: '公开图' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: '下载' }));
  await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('公开合成下载失败'));
  expect(api.download).toHaveBeenCalledOnce();
  api.download.mockResolvedValueOnce(undefined);
  fireEvent.click(within(dialog).getByRole('button', { name: '下载' }));
  await waitFor(() => expect(api.download).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(within(dialog).queryByRole('alert')).toBeNull());
  expect(screen.getByRole('dialog')).toBe(dialog);
});
