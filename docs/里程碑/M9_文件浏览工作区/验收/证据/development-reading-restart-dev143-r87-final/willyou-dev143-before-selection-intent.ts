import { MapMode, type EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { textReadingSchema, type TextReading } from '@shared/file-workspace';

interface Position { document: EditorState['doc']; effect?: ReturnType<EditorView['scrollSnapshot']>; anchor: number; yMargin: number; top: number; left: number }
const positions = new WeakMap<object, Map<string, Position>>();
const restoring = new WeakSet<object>();
const liveViews = new WeakMap<object, { editor: EditorView; mode: string }>();
const focusTransfers = new WeakMap<object, { mode: string; focused: boolean }>();
/** Keep a document anchor, not unmeasured pixel offsets, across view recreation. */
function captureEditorScroll(owner: object, editor: EditorView, mode: string): void {
  let modes = positions.get(owner);
  if (!modes) { modes = new Map(); positions.set(owner, modes); }
  const effect = editor.scrollSnapshot();
  modes.set(mode, { document: editor.state.doc, effect, anchor: effect.value.range.head, yMargin: effect.value.yMargin, top: editor.scrollDOM.scrollTop, left: editor.scrollDOM.scrollLeft });
}
export function rememberEditorScroll(owner: object, editor: EditorView, mode = 'default'): void {
  if (!restoring.has(owner)) captureEditorScroll(owner, editor, mode);
  focusTransfers.set(owner, { mode, focused: editor.hasFocus });
}
/** Capture the live view when a durable workspace checkpoint is taken. */
export function attachEditorReading(owner: object, editor: EditorView, mode: string): () => void {
  const entry = { editor, mode }; liveViews.set(owner, entry);
  return () => { if (liveViews.get(owner) === entry) liveViews.delete(owner); };
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
    const head = position.effect?.value.range.head ?? position.anchor, atEnd = head > 0 && head === transaction.startState.doc.length;
    if (transaction.changes.mapPos(head, atEnd ? -1 : 1, atEnd ? MapMode.TrackBefore : MapMode.TrackAfter) === null) continue;
    if (position.effect) {
      const mapped = position.effect.map(transaction.changes);
      if (mapped) { position.effect = mapped; position.anchor = mapped.value.range.head; position.document = transaction.state.doc; }
    } else { position.anchor = transaction.changes.mapPos(head); position.document = transaction.state.doc; }
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

/** Only unchanged clean bytes get durable numeric hints. Draft recovery is separate. */
export function serializeEditorReading(owner: object, state: EditorState, hash: string): TextReading | undefined {
  const live = liveViews.get(owner);
  if (live?.editor.state.doc === state.doc && !restoring.has(owner)) captureEditorScroll(owner, live.editor, live.mode);
  const views: TextReading['views'] = {};
  for (const mode of ['source', 'document'] as const) {
    const position = positions.get(owner)?.get(mode);
    if (position?.document !== state.doc) continue;
    views[mode] = { anchor: position.effect?.value.range.head ?? position.anchor, yMargin: position.effect?.value.yMargin ?? position.yMargin, top: position.top, left: position.left };
  }
  // Unviewed/restored legacy routes must not gain metadata-only CAS writes.
  if (!Object.keys(views).length) return undefined;
  const selection = state.selection.main;
  const value = textReadingSchema.safeParse({ hash, length: state.doc.length, selection: { anchor: selection.anchor, head: selection.head }, views });
  return value.success ? value.data : undefined;
}
/** Compare native content hash and normalized length before using any old offset. */
export function hydrateEditorReading(owner: object, state: EditorState, hash: string, value: TextReading | undefined): EditorState {
  const parsed = textReadingSchema.safeParse(value);
  if (!parsed.success) return state;
  const hint = parsed.data, length = state.doc.length;
  if (hint.hash !== hash || hint.length !== length || hint.selection.anchor > length || hint.selection.head > length || Object.values(hint.views).some(view => view.anchor > length)) return state;
  const next = state.update({ selection: hint.selection }).state;
  const modes = new Map<string, Position>();
  for (const mode of ['source', 'document'] as const) {
    const position = hint.views[mode]; if (!position) continue;
    modes.set(mode, { document: next.doc, anchor: position.anchor, yMargin: position.yMargin, top: position.top, left: position.left });
  }
  positions.set(owner, modes); return next;
}

/** Rebuild a real snapshot through public geometry/scroll APIs after mounting. */
export function applyHydratedEditorReading(owner: object, editor: EditorView, mode: string): () => void {
  const position = positions.get(owner)?.get(mode);
  if (!position || position.effect || position.document !== editor.state.doc) return () => undefined;
  const target = { ...position }; let active = true, frame = 0, attempts = 0, settled = 0, previous = '';
  const inputTypes = ['wheel', 'pointerdown', 'keydown', 'beforeinput'] as const;
  const eventRoot = editor.dom.ownerDocument, intentHost = editor.dom.closest('.fw-editor-host') ?? editor.dom;
  const current = () => active && editor.state.doc === target.document && editor.dom.isConnected;
  const stop = (capture = false) => {
    if (!active) return;
    active = false; cancelAnimationFrame(frame); restoring.delete(owner);
    for (const type of inputTypes) eventRoot.removeEventListener(type, intent, true);
    if (capture && editor.dom.isConnected) captureEditorScroll(owner, editor, mode);
  };
  const intent = (event: Event) => { if (event.composedPath().includes(intentHost)) stop(true); };
  for (const type of inputTypes) eventRoot.addEventListener(type, intent, { capture: true, passive: true });
  restoring.add(owner);
  const measure = () => {
    if (!current()) { stop(); return; }
    editor.requestMeasure({ key: owner,
      read: view => current() ? { top: view.lineBlockAt(target.anchor).top, actual: view.scrollDOM.scrollTop, left: view.scrollDOM.scrollLeft } : null,
      write: value => {
        if (!value || !current()) { stop(); return; }
        const top = Math.max(0, value.top - target.yMargin), key = JSON.stringify([value.top, value.actual, value.left]);
        const aligned = Math.abs(value.actual - top) <= .5 && Math.abs(value.left - target.left) <= .5;
        settled = aligned && key === previous ? settled + 1 : 0; previous = key;
        editor.scrollDOM.scrollTop = top; editor.scrollDOM.scrollLeft = target.left;
        if (settled >= 4 || ++attempts >= 24) { stop(true); return; }
        frame = requestAnimationFrame(measure);
      },
    });
  };
  measure(); return () => stop();
}

/** Give CM the source target before its initial virtual viewport is measured. */
export function hydratedEditorTarget(owner: object, state: EditorState, mode: string) {
  const position = positions.get(owner)?.get(mode);
  return position && !position.effect && position.document === state.doc
    ? EditorView.scrollIntoView(position.anchor, { y: 'start', x: 'start', yMargin: position.yMargin, xMargin: position.left }) : undefined;
}
