import { EditorSelection, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { LineNavigator } from './go-to-line';
import { resolveLineTarget, STALE_LINE_PREVIEW, type LineTarget } from './line-target';

/** A preview owns one unchanged document and selection in one live view. */
export class LinePreviewSession implements LineNavigator {
  readonly initialLine: number;
  readonly lineCount: number;
  private readonly document;
  private readonly selection: EditorSelection;
  private readonly scroll;
  private readonly top: number;
  private readonly left: number;
  private expected: EditorSelection;
  private closed = false;
  constructor(private readonly view: EditorView, private readonly owns: () => boolean) {
    this.document = view.state.doc;
    this.selection = this.expected = view.state.selection;
    this.initialLine = this.document.lineAt(this.selection.main.head).number;
    this.lineCount = this.document.lines;
    this.scroll = view.scrollSnapshot();
    this.top = view.scrollDOM.scrollTop;
    this.left = view.scrollDOM.scrollLeft;
  }
  isCurrent(): boolean {
    return !this.closed && this.view.dom.isConnected && this.owns() &&
      this.view.state.doc === this.document && this.view.state.selection.eq(this.expected);
  }
  preview(value: string): LineTarget {
    if (!this.isCurrent()) return { valid: false, error: STALE_LINE_PREVIEW };
    const result = resolveLineTarget(value, this.lineCount);
    if (result.valid) {
      const position = this.document.line(result.line).from;
      this.view.dispatch({ selection: EditorSelection.single(position), effects: EditorView.scrollIntoView(position, { y: 'center' }), annotations: Transaction.addToHistory.of(false) });
      this.expected = this.view.state.selection;
    }
    return result;
  }
  commit(value: string): LineTarget {
    const result = this.preview(value);
    if (result.valid) { this.closed = true; this.view.focus(); }
    return result;
  }
  cancel(focus = true): boolean {
    const restore = this.isCurrent(); this.closed = true;
    if (!restore) return false;
    this.view.dispatch({ selection: this.selection, effects: this.scroll, annotations: Transaction.addToHistory.of(false) });
    // Also restore immediately when cancellation precedes view destruction.
    this.view.scrollDOM.scrollTop = this.top;
    this.view.scrollDOM.scrollLeft = this.left;
    if (focus) this.view.focus();
    return true;
  }
}
