import { EditorView } from '@codemirror/view';

/** A routing threshold, not a file-size limit. Keep the complete input. */
export const LARGE_TEXT_INPUT_UNITS = 64 * 1024;

/**
 * Large plain insertText events can spend seconds in the browser's editable
 * DOM before CodeMirror can observe them. Apply the same text/selection as a
 * normal editor transaction instead, retaining history and the source field.
 * Actual paste and composition keep their existing CodeMirror input paths.
 */
export function handleLargeTextInput(event: InputEvent, view: EditorView): boolean {
  if (event.defaultPrevented || !event.cancelable || event.isComposing || view.compositionStarted || view.state.readOnly || !view.state.facet(EditorView.editable)
    || event.inputType !== 'insertText' || typeof event.data !== 'string' || event.data.length <= LARGE_TEXT_INPUT_UNITS) return false;
  event.preventDefault();
  view.dispatch({ ...view.state.replaceSelection(event.data), userEvent: 'input.type', scrollIntoView: true });
  return true;
}
