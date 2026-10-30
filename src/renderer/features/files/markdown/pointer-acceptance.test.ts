// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSourceField } from '../editor-source';
import { markdownEditor } from './editor';

// Original R2 nr: whitespace double-click collapses an existing source range.
// Only browser geometry is adapted. No worker response, parser result, document
// replacement or native input is simulated; actual P/A checks cover geometry.
const views: EditorView[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  views.splice(0).forEach(view => view.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe('X03 reference whitespace double-click source selection', () => {
  const raw = 'prefix   \t suffix !\r\n';
  it.each([
    { name: 'consecutive spaces', at: 8, collapse: true },
    { name: 'tab', at: 10, collapse: true },
    { name: 'word', at: 3, collapse: false },
    { name: 'punctuation', at: 19, collapse: false },
    { name: 'outside editor coordinates', at: null, collapse: false },
  ])('$name preserves source and only collapses eligible whitespace', ({ at, collapse }) => {
    const source = createSourceField(raw), link = vi.fn();
    const parent = document.createElement('div'); document.body.append(parent);
    const view = new EditorView({ parent, state: EditorState.create({
      doc: source.normalized, selection: { anchor: 0, head: 2 },
      extensions: [source.extensions, markdownEditor({ source, editable: true }, { status() {}, link, image: async () => {} })],
    }) }); views.push(view);
    const position = vi.spyOn(view, 'posAtCoords').mockReturnValue(at);
    const before = view.state.selection.main;
    if (at !== null && collapse) expect(view.state.wordAt(at)).toBeNull();
    const event = new MouseEvent('dblclick', { bubbles: true, cancelable: true, button: 0, detail: 2, clientX: 24, clientY: 24 });
    fireEvent(view.contentDOM, event);
    if (collapse) {
      expect(view.state.selection.main.empty).toBe(true);
      expect(view.state.selection.main.head).toBe(at);
      expect(position).toHaveBeenCalledWith({ x: 24, y: 24 }, false);
      expect(event.defaultPrevented).toBe(true);
    } else {
      expect(view.state.selection.main).toEqual(before);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(view.state.doc.toString()).toBe(source.normalized);
    expect(view.state.field(source.field).raw).toBe(raw);
    expect(link).not.toHaveBeenCalled();
  });
});
