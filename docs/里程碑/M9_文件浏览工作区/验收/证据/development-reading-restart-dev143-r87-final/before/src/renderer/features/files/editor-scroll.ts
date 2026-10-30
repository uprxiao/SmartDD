import { MapMode, type EditorState, type Transaction } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

interface Position { document: EditorState['doc']; effect: ReturnType<EditorView['scrollSnapshot']>; top: number; left: number }
const positions = new WeakMap<object, Map<string, Position>>();
const focusTransfers = new WeakMap<object, { mode: string; focused: boolean }>();
/** Keep a document anchor, not unmeasured pixel offsets, across view recreation. */
export function rememberEditorScroll(owner: object, editor: EditorView, mode = 'default'): void {
  let modes = positions.get(owner);
  if (!modes) { modes = new Map(); positions.set(owner, modes); }
  modes.set(mode, { document: editor.state.doc, effect: editor.scrollSnapshot(), top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft });
  focusTransfers.set(owner, { mode, focused: editor.hasFocus });
}
export function restoredEditorScroll(owner: object, state: EditorState, mode = 'default'): ReturnType<EditorView['scrollSnapshot']> | undefined {
  const position = positions.get(owner)?.get(mode);
  return position?.document === state.doc ? position.effect : undefined;
}
/** Retain an inactive mode's source anchor through edits in the active view. */
export function mapEditorScroll(owner: object, transaction: Transaction): void {
  if (!transaction.docChanged) return;
  for (const position of positions.get(owner)?.values() ?? []) {
    if (position.document !== transaction.startState.doc) continue;
    // A deleted anchor no longer identifies the old visible content. Leave
    // its pixels as a fallback, without presenting a stale source effect.
    const head = position.effect.value.range.head, atEnd = head > 0 && head === transaction.startState.doc.length;
    if (transaction.changes.mapPos(head, atEnd ? -1 : 1, atEnd ? MapMode.TrackBefore : MapMode.TrackAfter) === null) continue;
    const mapped = position.effect.map(transaction.changes);
    if (mapped) { position.effect = mapped; position.document = transaction.state.doc; }
  }
}
export function restoredEditorPosition(owner: object, mode: string): { top: number; left: number } {
  const position = positions.get(owner)?.get(mode);
  return { top: position?.top ?? 0, left: position?.left ?? 0 };
}
/** A successful mode change replaces its DOM; only hand off focus it owned. */
export function takeEditorModeFocus(owner: object, mode: string): boolean {
  const previous = focusTransfers.get(owner);
  focusTransfers.delete(owner);
  return Boolean(previous?.focused && previous.mode !== mode);
}
