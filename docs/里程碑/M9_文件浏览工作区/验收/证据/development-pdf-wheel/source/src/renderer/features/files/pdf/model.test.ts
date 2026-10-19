import { describe, expect, it } from 'vitest';
import { PdfCanvasBudget, MAX_CANVAS_PIXELS, TOTAL_CANVAS_PIXELS, pdfRenderPlan, pdfOffsets, pdfPageWindow, pageAtOffset, fitWidthZoom, clampPdfZoom, resolveDestinationPage } from './model';
import { ViewerSessionSlot } from './session-slot';

describe('production PDF resource boundaries', () => {
  it('shows every part of an oversized or rotated page within area and side limits', () => {
    for (const size of [{ width: 200000, height: 200000 }, { width: 792, height: 612 }, { width: 1, height: 200000 }]) {
      const plan = pdfRenderPlan(size, 800, 3);
      expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
      expect(Math.max(plan.canvasWidth, plan.canvasHeight)).toBeLessThanOrEqual(16384);
      expect(plan.cssWidth / plan.cssHeight).toBeCloseTo(size.width / size.height, 8);
      expect(plan.downscaled).toBe(true);
    }
    expect(clampPdfZoom(25)).toBe(30); expect(fitWidthZoom(100, 5000)).toBe(100);
    expect(() => pdfRenderPlan({ width: Infinity, height: 20 }, 100)).toThrow();
  });
  it('accounts for body pages and thumbnails together and releases exact reservations', () => {
    const budget = new PdfCanvasBudget(), owners = Array.from({ length: 20 }, () => ({}));
    for (const owner of owners) {
      const plan = budget.take(owner, { width: 200000, height: 200000 }, 800, 2, MAX_CANVAS_PIXELS);
      expect(budget.pixels).toBeLessThanOrEqual(TOTAL_CANVAS_PIXELS);
      if (plan) expect(plan.canvasWidth * plan.canvasHeight).toBeLessThanOrEqual(MAX_CANVAS_PIXELS);
    }
    expect(budget.take({}, { width: 612, height: 792 }, 100, 1, MAX_CANVAS_PIXELS)).toBeNull();
    owners.forEach((owner) => budget.release(owner)); expect(budget.pixels).toBe(0); expect(budget.count).toBe(0);
    expect(budget.take({}, { width: 612, height: 792 }, 100, 1, MAX_CANVAS_PIXELS)).not.toBeNull();
  });
  it('bounds 2000-page windows at minimum zoom and keeps the last page reachable', () => {
    const offsets = pdfOffsets(Array.from({ length: 2000 }, () => ({ width: 612, height: 792 })), 30);
    expect(pdfPageWindow(offsets, 0, 4000).numbers).toHaveLength(8);
    expect(pageAtOffset(offsets, offsets[1999])).toBe(1999);
    const end = pdfPageWindow(offsets, offsets[1999], 800);
    expect(end.numbers).toContain(2000); expect(end.after).toBe(0);
    expect(end.before).toBe(offsets[end.numbers[0] - 1]);
  });
  it('resolves only known internal destinations without running authored actions', async () => {
    const doc = { getDestination: async () => [{ num: 7, gen: 0 }], getPageIndex: async () => 3 };
    expect(await resolveDestinationPage('chapter', doc)).toBe(3);
    expect(await resolveDestinationPage([0], doc)).toBe(0);
    expect(await resolveDestinationPage([-1], doc)).toBeNull();
    expect(await resolveDestinationPage({ action: 'JavaScript' }, doc)).toBeNull();
  });
});

describe('viewer replacement shutdown fence', () => {
  it('does not start a replacement while the previous native session is shutting down', async () => {
    const slot = new ViewerSessionSlot<{ destroy(): Promise<void> }>(), order: string[] = [];
    let finish!: () => void;
    const destroyed = new Promise<void>((resolve) => { finish = resolve; });
    await slot.replace(async () => ({ destroy: async () => { order.push('destroy-old'); await destroyed; order.push('old-stopped'); } }), new AbortController().signal);
    const next = slot.replace(async () => { order.push('start-new'); return { destroy: async () => undefined }; }, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 0)); expect(order).toEqual(['destroy-old']);
    finish(); await next; expect(order).toEqual(['destroy-old', 'old-stopped', 'start-new']);
  });
  it('destroys a late-created session after cancellation and allows a subsequent retry', async () => {
    const slot = new ViewerSessionSlot<{ destroy(): Promise<void> }>(), abort = new AbortController(); let stopped = 0;
    let finish!: () => void; const ready = new Promise<void>((resolve) => { finish = resolve; });
    const result = slot.replace(async () => { await ready; return { destroy: async () => { stopped++; } }; }, abort.signal);
    await new Promise((resolve) => setTimeout(resolve, 0)); abort.abort(); finish();
    await expect(result).rejects.toThrow(); expect(stopped).toBe(1);
    await expect(slot.replace(async () => ({ destroy: async () => undefined }), new AbortController().signal)).resolves.toBeDefined();
  });
});
