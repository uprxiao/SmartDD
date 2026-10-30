// @vitest-environment jsdom
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ImageGallery } from '../../../../../prototypes/m6-codex/src/ImageGallery.jsx';

// I event integration: original shared component, decoder/geometry isolated.
// These plain DOM targets have no separate React ancestry, so native bubbling
// reaches the actual gallery handler instead of a synthetic portal handler.
const pictures = ['A', 'B', 'C'].map((alt, id) => ({ id, alt, src: 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"/>') }));
const protectedTargets = [
  ['input', 'input', {}], ['textarea', 'textarea', {}], ['select', 'select', {}],
  ['editable true', 'div', { contenteditable: 'true' }],
  ['editable empty', 'div', { contenteditable: '' }],
  ['editable plaintext', 'div', { contenteditable: 'plaintext-only' }],
  ['menu', 'div', { role: 'menu' }], ['slider', 'div', { role: 'slider' }],
  ['spinbutton', 'div', { role: 'spinbutton' }], ['combobox', 'div', { role: 'combobox' }],
  ['listbox', 'div', { role: 'listbox' }], ['grid', 'div', { role: 'grid' }],
  ['tree', 'div', { role: 'tree' }], ['tablist', 'div', { role: 'tablist' }],
] as const;
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function mount() {
  const outer = vi.fn(), closed = vi.fn();
  const view = render(<div onKeyDown={outer}><ImageGallery initial={{ picture: pictures[1], pictures }} overlay={false} download={false} onDownload={() => {}} onClose={closed} /></div>);
  const viewport = view.container.querySelector<HTMLElement>('.fw-gallery-viewport')!;
  const caption = () => view.container.querySelector('.fw-gallery header>span')!.textContent;
  expect(caption()).toBe('B'); return { viewport, caption, closed, outer };
}
it.each(protectedTargets)('V14 keeps the image on %s ArrowLeft/Right, including nested targets', (_name, tag, attributes) => {
  const host = mount(), field = document.createElement(tag); field.tabIndex = 0;
  for (const [name, value] of Object.entries(attributes)) field.setAttribute(name, value);
  host.viewport.append(field); field.focus();
  for (const key of ['ArrowLeft', 'ArrowRight']) { fireEvent.keyDown(field, { key }); expect(host.caption()).toBe('B'); }
  if (tag === 'div') {
    const nested = document.createElement('span'); field.append(nested);
    for (const key of ['ArrowLeft', 'ArrowRight']) { fireEvent.keyDown(nested, { key }); expect(host.caption()).toBe('B'); }
  }
  expect(host.outer).not.toHaveBeenCalled(); expect(host.closed).not.toHaveBeenCalled();
});
it('V14 lets a noneditable island navigate, and never wraps the first/last image', () => {
  const host = mount(), editable = document.createElement('div'), island = document.createElement('div');
  editable.contentEditable = 'true'; island.setAttribute('contenteditable', 'false'); editable.append(island); host.viewport.append(editable);
  fireEvent.keyDown(island, { key: 'ArrowRight' }); expect(host.caption()).toBe('C');
  fireEvent.keyDown(host.viewport, { key: 'ArrowRight' }); expect(host.caption()).toBe('C');
  fireEvent.keyDown(host.viewport, { key: 'ArrowLeft' }); expect(host.caption()).toBe('B');
  fireEvent.keyDown(host.viewport, { key: 'ArrowLeft' }); expect(host.caption()).toBe('A');
  fireEvent.keyDown(host.viewport, { key: 'ArrowLeft' }); expect(host.caption()).toBe('A');
});
it('V14 ignores every nonempty combination of Alt/Ctrl/Meta/Shift for both arrows', () => {
  const host = mount();
  for (let mask = 1; mask < 16; mask++) for (const key of ['ArrowLeft', 'ArrowRight']) {
    fireEvent.keyDown(host.viewport, { key, altKey: Boolean(mask & 1), ctrlKey: Boolean(mask & 2), metaKey: Boolean(mask & 4), shiftKey: Boolean(mask & 8) });
    expect(host.caption()).toBe('B');
  }
  expect(host.outer).not.toHaveBeenCalled();
});
it('V14 respects defaultPrevented and both composition indicators on the image surface', () => {
  const host = mount(), child = document.createElement('button'); host.viewport.append(child); child.addEventListener('keydown', event => event.preventDefault());
  for (const key of ['ArrowLeft', 'ArrowRight']) {
    fireEvent.keyDown(child, { key }); expect(host.caption()).toBe('B');
    fireEvent.keyDown(host.viewport, { key, isComposing: true }); expect(host.caption()).toBe('B');
    fireEvent.keyDown(host.viewport, { key, keyCode: 229 }); expect(host.caption()).toBe('B');
  }
  fireEvent.keyDown(host.viewport, { key: 'Escape', isComposing: true }); expect(host.closed).not.toHaveBeenCalled();
  fireEvent.keyDown(host.viewport, { key: 'Escape', keyCode: 229 }); expect(host.closed).not.toHaveBeenCalled();
});
it('V14 closes on an ordinary Escape and restores the connected source focus', () => {
  function Host() { const [open, setOpen] = useState(false); return <><button onClick={() => setOpen(true)}>Source image</button>{open && <ImageGallery initial={{ picture: pictures[1], pictures }} overlay={false} download={false} onDownload={() => {}} onClose={() => setOpen(false)} />}</>; }
  render(<Host />); const source = screen.getByRole('button', { name: 'Source image' }); source.focus(); fireEvent.click(source);
  const viewport = screen.getByRole('dialog').querySelector<HTMLElement>('.fw-gallery-viewport')!; expect(document.activeElement).toBe(viewport);
  fireEvent.keyDown(viewport, { key: 'Escape' }); expect(screen.queryByRole('dialog')).toBeNull(); expect(document.activeElement).toBe(source);
});
