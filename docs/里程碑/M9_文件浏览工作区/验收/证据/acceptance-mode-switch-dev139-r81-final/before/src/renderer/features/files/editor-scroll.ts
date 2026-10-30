import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

const positions = new WeakMap<object, { document: EditorState['doc']; effect: ReturnType<EditorView['scrollSnapshot']> }>();
/** Keep a document anchor, not unmeasured pixel offsets, across view recreation. */
export function rememberEditorScroll(owner: object, editor: EditorView): void {
  positions.set(owner, { document: editor.state.doc, effect: editor.scrollSnapshot() });
}
export function restoredEditorScroll(owner: object, state: EditorState): ReturnType<EditorView['scrollSnapshot']> | undefined {
  const position = positions.get(owner);
  return position?.document === state.doc ? position.effect : undefined;
}
