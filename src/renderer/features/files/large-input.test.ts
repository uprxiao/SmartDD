// @vitest-environment jsdom
import { EditorSelection, EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleLargeTextInput, LARGE_TEXT_INPUT_UNITS } from './large-input';

const views: EditorView[] = [], text = '中文🙂\n'.repeat(20_000);
function view(extensions: Extension = []) {
  const current = new EditorView({ parent: document.body, state: EditorState.create({ doc: 'ABCD', extensions }) }); views.push(current); return current;
}
const event = (options: InputEventInit = {}) => new InputEvent('beforeinput', { inputType: 'insertText', data: text, cancelable: true, ...options });
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { for (const current of views.splice(0)) current.destroy(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe('bounded routing of large ordinary text input', () => {
  it('uses one editor change for the complete text at each current selection', () => {
    const current = view(EditorState.allowMultipleSelections.of(true)); current.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 1), EditorSelection.range(3, 4)]) });
    expect(handleLargeTextInput(event(), current)).toBe(true); expect(current.state.doc.toString()).toBe(text + 'BC' + text); expect(current.state.selection.ranges).toHaveLength(2);
  });
  it.each([0, LARGE_TEXT_INPUT_UNITS - 1, LARGE_TEXT_INPUT_UNITS])('leaves %i-unit ordinary input on its original path', units => {
    const current = view(), input = event({ data: 'x'.repeat(units) }); expect(handleLargeTextInput(input, current)).toBe(false); expect(input.defaultPrevented).toBe(false); expect(current.state.doc.toString()).toBe('ABCD');
  });
  it.each(['insertFromPaste', 'insertCompositionText', 'deleteContentBackward', 'historyUndo'])('does not reinterpret %s', inputType => {
    const current = view(), input = event({ inputType }); expect(handleLargeTextInput(input, current)).toBe(false); expect(input.defaultPrevented).toBe(false);
  });
  it('preserves noncancelable, already handled, missing-data and composing events', () => {
    const current = view();
    for (const input of [event({ cancelable: false }), event({ data: null }), event({ isComposing: true })]) expect(handleLargeTextInput(input, current)).toBe(false);
    const handled = event(); handled.preventDefault(); expect(handleLargeTextInput(handled, current)).toBe(false); expect(current.state.doc.toString()).toBe('ABCD');
  });
  it.each([EditorState.readOnly.of(true), EditorView.editable.of(false)])('cannot widen a readonly editor capability', extension => {
    const current = view(extension), input = event(); expect(handleLargeTextInput(input, current)).toBe(false); expect(input.defaultPrevented).toBe(false); expect(current.state.doc.toString()).toBe('ABCD');
  });
  it('leaves an active real EditorView composition on the existing path', () => {
    const current = view(); current.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); expect(current.compositionStarted).toBe(true);
    const input = event(); expect(handleLargeTextInput(input, current)).toBe(false); expect(input.defaultPrevented).toBe(false);
  });
});
