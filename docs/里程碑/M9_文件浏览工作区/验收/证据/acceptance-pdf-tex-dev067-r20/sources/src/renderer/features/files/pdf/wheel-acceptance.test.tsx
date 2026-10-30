// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
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
const makeBuffer = (name: string) => {
  const pdfPosition = { page: 1, zoom: 100, initialized: true };
  return { file: { ref: { id: name }, revision: { hash: name } }, pdfPosition, updatePdfPosition(patch: Partial<FileBuffer['pdfPosition']>) { Object.assign(pdfPosition, patch); } } as unknown as FileBuffer;
};
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
  it('clamps a restored out-of-range page back into the actual document and reports the new hint', async () => {
    const buffer = makeBuffer('changed.pdf'); buffer.pdfPosition.page = 999;
    render(<FilePdfPreview buffer={buffer} loadData={loadData} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(buffer.pdfPosition.page).toBe(1);
  });
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
  it.each([199, 200])('retains raw accumulation at 199ms and clears it at 200ms (observed at %ims)', async (elapsed) => {
    const f = await mount(); f.wheel(-3); expect(f.buffer.pdfPosition.zoom).toBe(100);
    act(() => vi.advanceTimersByTime(elapsed)); f.wheel(-3);
    expect(f.buffer.pdfPosition.zoom).toBeCloseTo(elapsed === 199 ? 100 * Math.exp(.03) : 100, 8);
  });
  it('restarts the raw accumulation expiry on each continuous wheel event', async () => {
    const f = await mount(); f.wheel(-1);
    for (let i = 0; i < 3; i++) { act(() => vi.advanceTimersByTime(199)); f.wheel(-1); }
    expect(f.buffer.pdfPosition.zoom).toBeCloseTo(100 * Math.exp(.02), 8);
  });
  it('leaves ordinary scroll and zero delta free of zoom work', async () => {
    const f = await mount(); expect(f.wheel(-20, false).defaultPrevented).toBe(false);
    expect(f.wheel(0).defaultPrevented).toBe(true);
    expect(f.buffer.pdfPosition.zoom).toBe(100); expect(vi.getTimerCount()).toBe(0);
  });
  it('tears down old timers and RAF on document replacement before the next document receives input', async () => {
    const f = await mount(); f.wheel(-20); const oldLeft = f.node.scrollLeft;
    const next = makeBuffer('B.pdf'); next.pdfPosition.zoom = 150;
    f.rerender(<FilePdfPreview buffer={next} loadData={loadData} />);
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    const current = f.container.querySelector('.fw-pdf-scroll') as HTMLElement;
    current.scrollLeft = 12; current.scrollTop = 20;
    act(() => vi.advanceTimersByTime(300));
    expect(f.node.scrollLeft).toBe(oldLeft); expect(current.scrollLeft).toBe(12);
    expect(next.pdfPosition.zoom).toBe(150); expect(f.container.querySelector('.fw-pdf')?.getAttribute('data-zooming')).toBe('false');
    const event = new WheelEvent('wheel', { deltaY: -3, ctrlKey: true, cancelable: true }); act(() => current.dispatchEvent(event));
    expect(next.pdfPosition.zoom).toBe(150); // A's prior raw 110.5% must not enter B.
    f.unmount(); act(() => vi.advanceTimersByTime(300)); expect(vi.getTimerCount()).toBe(0);
  });

});
