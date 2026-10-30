// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
import { FilePdfPreview } from './preview';

vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
vi.mock('./page', () => ({ PdfCanvasPage: ({ zoom }: { zoom: number }) => <div data-render-zoom={zoom} /> }));
// Only PDF decoding/canvas work is isolated. The real preview component owns its
// actual DOM wheel listener, production zoom/scroll state and effect teardown.
vi.mock('./engine', () => ({ createPdfSession: async () => ({
  ready: Promise.resolve({ numPages: 1, getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }), getOutline: async () => null }),
  run: (promise: Promise<unknown>) => promise, destroy: async () => undefined,
}) }));
const loadData = async () => new Uint8Array([37, 80, 68, 70]);
const makeBuffer = (name: string) => ({ file: { ref: { id: name }, revision: { hash: name } }, pdfPosition: { page: 1, zoom: 100, initialized: true } }) as unknown as FileBuffer;
async function mount() {
  const buffer = makeBuffer('A.pdf');
  const rendered = render(<FilePdfPreview buffer={buffer} loadData={loadData} />);
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  const node = rendered.container.querySelector('.fw-pdf-scroll') as HTMLElement;
  expect(node).toBeTruthy();
  Object.defineProperties(node, { clientWidth: { configurable: true, value: 600 }, clientHeight: { configurable: true, value: 800 } });
  node.scrollLeft = 50; node.scrollTop = 200;
  vi.useFakeTimers();
  const wheel = (deltaY: number, ctrlKey = true) => { const event = new WheelEvent('wheel', { deltaY, ctrlKey, clientX: 100, clientY: 100, cancelable: true }); act(() => node.dispatchEvent(event)); return event; };
  return { ...rendered, node, buffer, wheel };
}
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('M9-T-T06 mounted production PDF wheel lifecycle', () => {
  it('accumulates unsnapped raw scale instead of sticking to 100% on small continuous wheel events', async () => {
    const f = await mount(); for (let i = 0; i < 5; i++) f.wheel(-1);
    expect(f.buffer.pdfPosition.zoom).toBeCloseTo(100 * Math.exp(.025), 8);
  });
  it('ends the actual preview zooming state at 120ms, resetting it for each new wheel event', async () => {
    const f = await mount(); f.wheel(-3);
    expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('true');
    act(() => vi.advanceTimersByTime(119)); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('true');
    act(() => vi.advanceTimersByTime(1)); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('false');
    f.wheel(-1); act(() => vi.advanceTimersByTime(100)); f.wheel(-1);
    act(() => vi.advanceTimersByTime(119)); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('true');
    act(() => vi.advanceTimersByTime(1)); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('false');
  });
  it('cancels the queued anchor RAF when the preview unmounts', async () => {
    const f = await mount(); f.wheel(-20); const left = f.node.scrollLeft;
    f.unmount(); act(() => vi.advanceTimersByTime(300));
    expect(f.node.scrollLeft).toBe(left); expect(vi.getTimerCount()).toBe(0);
  });
});
