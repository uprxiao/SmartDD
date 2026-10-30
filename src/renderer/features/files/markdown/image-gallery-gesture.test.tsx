// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageGallery } from '../../../../../prototypes/m6-codex/src/ImageGallery.jsx';

// Component event integration. Browser capture and decoder geometry are isolated;
// genuine pointer capture/touch is checked separately in the packaged App.
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function mount(width = 40, height = 30) {
  const pictures = ['A', 'B'].map((alt, id) => ({ id, alt, src: 'data:image/png,' + id }));
  render(<ImageGallery initial={{ picture: pictures[0], pictures }} overlay={false} download={false} onClose={() => {}} onDownload={() => {}} />);
  const viewport = document.querySelector<HTMLElement>('.fw-gallery-viewport')!;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 1000 },
    clientHeight: { configurable: true, value: 700 },
  });
  viewport.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 700, width: 1000, height: 700, toJSON() {} });
  const image = document.querySelector<HTMLImageElement>('.fw-gallery img')!;
  Object.defineProperties(image, { naturalWidth: { value: width }, naturalHeight: { value: height } });
  fireEvent.load(image);
  const captured = new Set<number>();
  const release = vi.fn((id: number) => captured.delete(id));
  Object.assign(viewport, {
    setPointerCapture: (id: number) => captured.add(id),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: release,
  });
  function pointer(type: string, id: number, x: number, y: number) {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperties(event, { pointerId: { value: id }, pointerType: { value: 'touch' } });
    fireEvent(viewport, event);
  }
  const transform = () => document.querySelector<HTMLImageElement>('.fw-gallery img')!.style.transform;
  const zoom = () => Number(/scale\(([^)]+)\)/.exec(transform())![1]);
  const pan = () => /translate\(([^p]+)px, ([^p]+)px\)/.exec(transform())!.slice(1).map(Number);
  return { viewport, captured, release, pointer, transform, zoom, pan };
}

it('V13 leaves ordinary wheel scrolling unconsumed without changing zoom', () => {
  const host = mount(), outer = vi.fn();
  host.viewport.parentElement!.addEventListener('wheel', outer);
  const unconsumed = fireEvent.wheel(host.viewport, { deltaY: 120, deltaMode: 0 });
  expect(unconsumed).toBe(true);
  expect(outer).toHaveBeenCalledTimes(1);
  expect(host.zoom()).toBe(1);
  expect(host.pan()).toEqual([0, 0]);
});

// Original G09 Del/Fel: pixels unchanged, line x16, page x800, divisor200.
// This synthetic component layer does not claim trusted OS wheel delta modes.
it.each([[0, 20, 20], [1, 1, 16], [2, .025, 20]])('V13 applies original wheel mode %s and keeps the image point under the cursor', (deltaMode, deltaY, pixels) => {
  const host = mount(), expected = Math.exp(-pixels / 200);
  fireEvent.wheel(host.viewport, { deltaMode, deltaY, ctrlKey: true, clientX: 600, clientY: 400 });
  expect(host.zoom()).toBeCloseTo(expected, 10);
  const [x, y] = host.pan();
  expect((100 - x) / host.zoom()).toBeCloseTo(100, 10);
  expect((50 - y) / host.zoom()).toBeCloseTo(50, 10);
});

it.each([[40, 30, .25], [4000, 800, .234]])('V13 clamps wheel and pinch to the original Fit/25%% lower bound for %sx%s', (width, height, minimum) => {
  const host = mount(width, height);
  fireEvent.wheel(host.viewport, { deltaMode: 0, deltaY: 10000, ctrlKey: true, clientX: 500, clientY: 350 });
  expect(host.zoom()).toBeCloseTo(minimum, 10);
  fireEvent.click(screen.getByRole('button', { name: '重置图片适应缩放' }));
  host.pointer('pointerdown', 11, 100, 100);
  host.pointer('pointerdown', 12, 200, 100);
  host.pointer('pointermove', 12, 105, 100);
  expect(host.zoom()).toBeCloseTo(minimum, 10);
});

it('V13 keeps the original 500% upper bound for wheel and pinch', () => {
  const host = mount();
  fireEvent.wheel(host.viewport, { deltaMode: 0, deltaY: -10000, ctrlKey: true, clientX: 500, clientY: 350 });
  expect(host.zoom()).toBe(5);
  fireEvent.click(screen.getByRole('button', { name: '重置图片适应缩放' }));
  host.pointer('pointerdown', 11, 100, 100);
  host.pointer('pointerdown', 12, 200, 100);
  host.pointer('pointermove', 12, 1000, 100);
  expect(host.zoom()).toBe(5);
});

it('V13 releases both active pointer captures when changing the image', () => {
  const host = mount();
  host.pointer('pointerdown', 11, 100, 100);
  host.pointer('pointerdown', 12, 200, 100);
  host.pointer('pointermove', 12, 300, 100);
  expect(host.transform()).toContain('scale(2)');
  expect([...host.captured]).toEqual([11, 12]);
  fireEvent.click(screen.getByRole('button', { name: '下一张图片' }));
  expect(document.querySelector('.fw-gallery header>span')!.textContent).toBe('B');
  expect(host.captured.size).toBe(0);
  expect(host.release.mock.calls.map(([id]) => id).sort()).toEqual([11, 12]);
  // The newly mounted second image has its own decoder/load event.
  const nextImage = document.querySelector<HTMLImageElement>('.fw-gallery img')!;
  Object.defineProperties(nextImage, { naturalWidth: { value: 40 }, naturalHeight: { value: 30 } });
  fireEvent.load(nextImage);
  expect(host.transform()).toContain('translate(0px, 0px) scale(1)');
  host.pointer('pointermove', 12, 700, 500);
  expect(host.transform()).toContain('translate(0px, 0px) scale(1)');
});

it('V13 clears capture and the previous drag when resetting to Fit', () => {
  const host = mount();
  host.pointer('pointerdown', 17, 100, 100);
  host.pointer('pointermove', 17, 170, 140);
  expect(host.transform()).toContain('translate(70px, 40px)');
  fireEvent.click(screen.getByRole('button', { name: '重置图片适应缩放' }));
  expect(host.captured.size).toBe(0);
  expect(host.release).toHaveBeenCalledExactlyOnceWith(17);
  host.pointer('pointermove', 17, 300, 300);
  expect(host.transform()).toContain('translate(0px, 0px) scale(1)');
});
