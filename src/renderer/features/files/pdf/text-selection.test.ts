// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachPdfTextSelection } from './text-selection';

const releases: (() => void)[] = [];
function layer(tabIndex?: number) {
  const host = document.createElement('div'); host.className = 'textLayer';
  host.innerHTML = '<span>FIRST_MARKER</span><span>SECOND_MARKER</span>';
  host.style.width = '816px'; host.style.height = '1056px';
  if (tabIndex !== undefined) host.tabIndex = tabIndex;
  document.body.append(host);
  const release = attachPdfTextSelection(host); releases.push(release);
  return { host, release, first: host.firstChild!, second: host.children[1], end: host.querySelector<HTMLDivElement>('.endOfContent')! };
}
// Controlled unit fixtures only. Real PDF drag acceptance uses trusted input.
function select(node: Node, start: number, end: number) {
  const range = document.createRange(); range.setStart(node, start); range.setEnd(node, end);
  const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  return selection;
}
afterEach(() => {
  for (const release of releases.splice(0)) release();
  vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); document.body.replaceChildren();
});

describe('PDF text selection lifecycle shared by App and prototype', () => {
  it('makes the rendered layer focusable without changing text and restores its own additions on repeated cleanup', () => {
    const { host, first, second, end, release } = layer();
    expect(host.tabIndex).toBe(0); expect(end.className).toBe('endOfContent');
    expect(host.textContent).toBe('FIRST_MARKERSECOND_MARKER');
    release(); release();
    expect(host.getAttribute('tabindex')).toBeNull(); expect(end.isConnected).toBe(false);
    expect([...host.childNodes]).toEqual([first, second]);
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(host.classList.contains('selecting')).toBe(false);
  });

  it('moves only its sentinel for a native range and never assigns Selection or intercepts copy', () => {
    const { host, first, second, end } = layer(3);
    const selection = select(first.firstChild!, 0, 5);
    const add = vi.spyOn(selection, 'addRange'), remove = vi.spyOn(selection, 'removeAllRanges');
    document.dispatchEvent(new Event('selectionchange'));
    expect([...host.childNodes]).toEqual([first, end, second]);
    expect(end.style.width).toBe('816px'); expect(end.style.height).toBe('1056px');
    expect(host.classList.contains('selecting')).toBe(true); expect(selection.toString()).toBe('FIRST');
    expect(add).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
    const copy = new Event('copy', { bubbles: true, cancelable: true });
    expect(host.dispatchEvent(copy)).toBe(true); expect(copy.defaultPrevented).toBe(false);
    expect(host.tabIndex).toBe(3);
  });

  it('resets all layers after pointer release or window blur and resets keyboard selection after keyup', () => {
    const a = layer(), b = layer();
    for (const item of [a, b]) item.host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    document.dispatchEvent(new Event('pointerdown'));
    document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(a.host.classList.contains('selecting')).toBe(true);
    document.dispatchEvent(new Event('pointerup'));
    for (const item of [a, b]) expect(item.host.classList.contains('selecting')).toBe(false);
    a.host.dispatchEvent(new MouseEvent('mousedown')); window.dispatchEvent(new Event('blur'));
    expect(a.host.classList.contains('selecting')).toBe(false);
    b.host.dispatchEvent(new MouseEvent('mousedown')); document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift' }));
    expect(b.host.classList.contains('selecting')).toBe(false);
  });

  it('resets sentinels for selections outside the PDF and for an empty selection without changing that selection', () => {
    const { host, first, end } = layer();
    select(first.firstChild!, 0, 5); document.dispatchEvent(new Event('selectionchange'));
    const outside = document.createElement('p'); outside.textContent = 'outside'; document.body.append(outside);
    const selection = select(outside.firstChild!, 0, 7);
    document.dispatchEvent(new Event('selectionchange'));
    expect(selection.toString()).toBe('outside'); expect(host.lastChild).toBe(end);
    expect(host.classList.contains('selecting')).toBe(false); expect(end.style.width).toBe('');
    host.dispatchEvent(new MouseEvent('mousedown')); selection.removeAllRanges();
    document.dispatchEvent(new Event('selectionchange'));
    expect(host.classList.contains('selecting')).toBe(false); expect(selection.rangeCount).toBe(0);
  });

  it('keeps the shared document listeners until the last layer closes and removes them before a new document session', () => {
    const listen = vi.spyOn(document, 'addEventListener'), a = layer(), b = layer();
    const signals = listen.mock.calls.filter(([type]) => type === 'selectionchange').map(([, , options]) => (options as AddEventListenerOptions).signal!);
    expect(signals).toHaveLength(1); expect(signals[0].aborted).toBe(false);
    a.release(); expect(signals[0].aborted).toBe(false);
    b.host.dispatchEvent(new MouseEvent('mousedown')); document.dispatchEvent(new Event('pointerup'));
    expect(b.host.classList.contains('selecting')).toBe(false);
    b.release(); expect(signals[0].aborted).toBe(true);
    const c = layer();
    const next = listen.mock.calls.filter(([type]) => type === 'selectionchange');
    expect(next).toHaveLength(2); expect((next[1][2] as AddEventListenerOptions).signal?.aborted).toBe(false);
    c.release();
  });
});
