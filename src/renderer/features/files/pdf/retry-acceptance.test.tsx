// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { PdfCanvasPage } from './page';
import { PdfCanvasBudget } from './model';
import type { PdfSession } from './engine';

function deferred() { let resolve!: () => void, reject!: (error: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function fixture(label: string) {
  const tasks: (ReturnType<typeof deferred> & { cancel: ReturnType<typeof vi.fn> })[] = [], cleanup = vi.fn();
  const page = { userUnit: 1, getViewport: () => ({ width: 100, height: 120 }), getAnnotations: async () => [], cleanup,
    streamTextContent: () => ({ label }), render: vi.fn(() => { const t = { ...deferred(), cancel: vi.fn() }; tasks.push(t); return t; }) };
  const textRendered = vi.fn();
  class TextLayer {
    constructor(private options: { container: HTMLElement; textContentSource: { label: string } }) {}
    async render() { textRendered(this.options.textContentSource.label); const span = document.createElement('span'); span.textContent = this.options.textContentSource.label; this.options.container.append(span); }
    cancel() {}
  }
  const session = { run: <T,>(p: Promise<T>) => p, engine: { AnnotationMode: { ENABLE: 1 }, TextLayer } } as unknown as PdfSession;
  const doc = { getPage: async () => page } as unknown as PDFDocumentProxy;
  return { tasks, page, doc, session, textRendered, cleanup };
}
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const size = { width: 100, height: 120 };
describe('T15 real PdfCanvasPage/effect/budget integration, renderer/decoder isolated', () => {
  it('clears failed canvas, shows retry, creates a fresh task and only publishes successful text', async () => {
    const a = fixture('A'), budget = new PdfCanvasBudget();
    const view = render(<PdfCanvasPage {...a} number={1} size={size} zoom={100} budget={budget} quota={1000000} />);
    await waitFor(() => expect(a.tasks).toHaveLength(1));
    await act(async () => { a.tasks[0].reject(new Error('controlled page error')); });
    expect(screen.getByRole('alert').textContent).toContain('controlled page error');
    const canvas = view.container.querySelector('canvas')!; expect(canvas.width).toBe(0); expect(canvas.dataset.rendered).toBe('error'); expect(a.textRendered).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '重试此页' }));
    await waitFor(() => expect(a.tasks).toHaveLength(2)); expect(a.tasks[1]).not.toBe(a.tasks[0]); expect(screen.queryByRole('alert')).toBeNull();
    expect(canvas.dataset.rendered).not.toBe('true');
    await act(async () => { a.tasks[1].resolve(); });
    expect(canvas.dataset.rendered).toBe('true'); expect(view.container.querySelector('.fw-pdf-text')?.textContent).toBe('A');
    view.unmount(); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0); expect(a.tasks[1].cancel).toHaveBeenCalledOnce();
  });
  it('serializes a reused canvas and discards an old retry success after the document changes', async () => {
    const a = fixture('OLD'), b = fixture('NEW'), budget = new PdfCanvasBudget();
    const props = { number: 1, size, zoom: 100, budget, quota: 1000000 };
    const view = render(<PdfCanvasPage {...a} {...props} />);
    await waitFor(() => expect(a.tasks).toHaveLength(1));
    await act(async () => { a.tasks[0].reject(new Error('first error')); });
    fireEvent.click(screen.getByRole('button', { name: '重试此页' })); await waitFor(() => expect(a.tasks).toHaveLength(2));
    const canvas = view.container.querySelector('canvas')!;
    view.rerender(<PdfCanvasPage {...b} {...props} />);
    expect(a.tasks[1].cancel).toHaveBeenCalledOnce(); expect(canvas.width).toBe(0); expect(canvas.dataset.rendered).toBe('false');
    await act(async () => { a.tasks[1].resolve(); }); await waitFor(() => expect(b.tasks).toHaveLength(1));
    expect(a.textRendered).not.toHaveBeenCalled(); expect(canvas.dataset.rendered).not.toBe('true');
    await act(async () => { b.tasks[0].resolve(); });
    expect(canvas.dataset.rendered).toBe('true'); expect(view.container.querySelector('.fw-pdf-text')?.textContent).toBe('NEW'); expect(a.textRendered).not.toHaveBeenCalled();
    view.unmount(); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0);
  });
  it('does not publish a successful render after unmount and frees its original canvas', async () => {
    const a = fixture('CLOSED'), budget = new PdfCanvasBudget();
    const view = render(<PdfCanvasPage {...a} number={1} size={size} zoom={100} budget={budget} quota={1000000} />);
    await waitFor(() => expect(a.tasks).toHaveLength(1)); const canvas = view.container.querySelector('canvas')!;
    view.unmount(); await act(async () => { a.tasks[0].resolve(); });
    expect(a.textRendered).not.toHaveBeenCalled(); expect(canvas.width).toBe(0); expect(canvas.height).toBe(0); expect(canvas.dataset.rendered).toBe('false'); expect(a.tasks[0].cancel).toHaveBeenCalledOnce();
  });
});
