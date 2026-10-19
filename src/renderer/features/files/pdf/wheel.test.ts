// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindPdfWheel } from './wheel.mjs';
const bindings: (() => void)[] = [];
function fixture(initial = 100) {
  const node = document.createElement('div'); node.scrollLeft = 50; node.scrollTop = 200;
  let zoom = initial; const onZooming = vi.fn(), setZoom = vi.fn((value: number) => { zoom = value; });
  const dispose = bindPdfWheel(node, { getZoom: () => zoom, setZoom, onZooming }); bindings.push(dispose);
  const wheel = (deltaY: number, ctrlKey = true) => { const event = new WheelEvent('wheel', { deltaY, ctrlKey, cancelable: true, clientX: 100, clientY: 100 }); node.dispatchEvent(event); return event; };
  return { node, wheel, dispose, setZoom, onZooming, get zoom() { return zoom; }, externalZoom: (value: number) => { zoom = value; } };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { bindings.splice(0).forEach(dispose => dispose()); vi.useRealTimers(); });
describe('M9-T-T06 shared wheel timer and anchor unit boundaries', () => {
  it('clamps per-event delta and total scale and preserves the pointer anchor through one coalesced RAF', () => {
    const f = fixture(); f.wheel(-10000); expect(f.zoom).toBe(110); f.wheel(-20); expect(f.zoom).toBeCloseTo(100 * Math.exp(.2), 8);
    expect(f.node.scrollLeft).toBe(50); vi.advanceTimersByTime(16);
    expect(f.node.scrollLeft).toBeCloseTo((50 + 100) * Math.exp(.2) - 100, 8);
    expect(f.node.scrollTop).toBeCloseTo((200 + 100) * Math.exp(.2) - 100, 8);
    for (let i = 0; i < 100; i++) f.wheel(-20); expect(f.zoom).toBe(800);
    for (let i = 0; i < 100; i++) f.wheel(20); expect(f.zoom).toBe(30);
  });
  it('restarts the 120ms zoom-state timer and clears all work on idempotent disposal', () => {
    const f = fixture(); f.wheel(-1); vi.advanceTimersByTime(119); expect(f.onZooming.mock.calls.at(-1)).toEqual([true]);
    f.wheel(-1); vi.advanceTimersByTime(119); expect(f.onZooming.mock.calls.at(-1)).toEqual([true]);
    vi.advanceTimersByTime(1); expect(f.onZooming.mock.calls.at(-1)).toEqual([false]);
    f.wheel(-1); const calls=f.onZooming.mock.calls.length, writes=f.setZoom.mock.calls.length, left=f.node.scrollLeft;
    f.dispose(); f.dispose(); vi.advanceTimersByTime(500); f.wheel(-20);
    expect(f.onZooming).toHaveBeenCalledTimes(calls); expect(f.setZoom).toHaveBeenCalledTimes(writes); expect(f.node.scrollLeft).toBe(left); expect(vi.getTimerCount()).toBe(0);
  });
  it.each([199,200])('uses a fresh raw baseline at exactly 200ms (%ims probe)', elapsed => {
    const f=fixture(); f.wheel(-3); vi.advanceTimersByTime(elapsed); f.wheel(-3);
    expect(f.zoom).toBeCloseTo(elapsed===199?100*Math.exp(.03):100,8);
  });
  it('starts a fresh raw baseline after an explicit menu/fit scale change', () => {
    const f=fixture(); f.wheel(-3); f.externalZoom(200); f.wheel(-3); expect(f.zoom).toBe(200);
  });
});
