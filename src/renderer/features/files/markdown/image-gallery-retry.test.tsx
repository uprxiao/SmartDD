// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageGallery } from '../../../../../prototypes/m6-codex/src/ImageGallery.jsx';

// Load/error events are the decoder boundary; these checks exercise the actual
// gallery's source selection and asynchronous host callback, without network IO.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const picture = (id: string) => ({ id, alt: `Image ${id}`, src: `blob:synthetic-primary-${id}`, fallbackSrc: `blob:synthetic-thumbnail-${id}` });
const image = () => document.querySelector<HTMLImageElement>('.fw-gallery-viewport img')!;
const mount = (pictures: ReturnType<typeof picture>[], onRetry = vi.fn(async () => {})) => render(<ImageGallery initial={{ picture: pictures[0], pictures }} overlay download onClose={() => {}} onDownload={() => {}} onRetry={onRetry} />);

it('uses the permitted thumbnail when the primary fails and accepts its load', () => {
  const a = picture('A'); mount([a]);
  fireEvent.error(image());
  expect(image()?.getAttribute('src')).toBe(a.fallbackSrc);
  fireEvent.load(image());
  expect(document.querySelector('.fw-gallery-error')).toBeNull();
  expect(image().alt).toBe(a.alt);
});

it('shows a retry after both sources fail and reloads the current primary', async () => {
  const a = picture('A'), retry = vi.fn(async () => {}); mount([a], retry);
  fireEvent.error(image());
  expect(image()?.getAttribute('src')).toBe(a.fallbackSrc);
  fireEvent.error(image());
  expect(image()).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: '重试加载图片' })); });
  expect(retry).toHaveBeenCalledExactlyOnceWith(a);
  expect(image()?.getAttribute('src')).toBe(a.src);
  fireEvent.load(image());
  expect(document.querySelector('.fw-gallery-error')).toBeNull();
});

it('leaves the Retry button pointer sequence outside viewport drag capture', async () => {
  const a = picture('A'), retry = vi.fn(async () => {}); mount([a], retry);
  fireEvent.error(image());
  fireEvent.error(image());
  const viewport = document.querySelector<HTMLElement>('.fw-gallery-viewport')!;
  const capture = vi.fn();
  Object.assign(viewport, { setPointerCapture: capture });
  const button = screen.getByRole('button', { name: '重试加载图片' });
  // Record the real React handler's capture request. jsdom does not implement
  // native retargeting; the trusted browser sequence is checked separately.
  for (const type of ['pointerdown', 'pointerup']) {
    const event = new MouseEvent(type, { bubbles: true, button: 0 });
    Object.defineProperty(event, 'pointerId', { value: 23 });
    fireEvent(button, event);
  }
  await act(async () => { fireEvent.click(button); });
  expect(capture).not.toHaveBeenCalled();
  expect(retry).toHaveBeenCalledExactlyOnceWith(a);
  expect(image()?.getAttribute('src')).toBe(a.src);
});

it('keeps the selected image error when an earlier image retry finishes late', async () => {
  const a = { ...picture('A'), fallbackSrc: '' }, b = { ...picture('B'), fallbackSrc: '' };
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  const retry = vi.fn(() => pending); mount([a, b], retry);
  fireEvent.error(image());
  fireEvent.click(screen.getByRole('button', { name: '重试加载图片' }));
  expect(retry).toHaveBeenCalledExactlyOnceWith(a);
  fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
  expect(image()?.getAttribute('src')).toBe(b.src);
  fireEvent.error(image());
  await act(async () => { resolve(); await pending; });
  expect(screen.getByText(b.alt)).toBeTruthy();
  expect(screen.queryByRole('button', { name: '重试加载图片' })).not.toBeNull();
  expect(image()).toBeNull();
});
