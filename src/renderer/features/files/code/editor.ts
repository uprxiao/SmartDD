import { StateEffect } from '@codemirror/state';
import { Decoration, ViewPlugin, type DecorationSet, type EditorView, type ViewUpdate } from '@codemirror/view';
// Only the numeric paint DTO enters the UI; grammar/theme parsing stays in the Worker.
import { CODE_TOKEN_STRIDE, codeTokenStyle } from './paint.mjs';
const recolor = StateEffect.define<{ revision: number; tokens: Uint32Array }>();

export function codeHighlight(filename: string, status: (message: string) => void) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    worker?: Worker; timer?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>;
    revision = 0; request = 0; ready = false; disposed = false;
    constructor(readonly view: EditorView) { this.schedule(0); }
    stop() { this.worker?.terminate(); this.worker = undefined; this.ready = false; clearTimeout(this.deadline); }
    schedule(delay = 120) {
      this.stop(); clearTimeout(this.timer); const revision = ++this.revision; status('');
      this.timer = setTimeout(() => {
        if (this.disposed || revision !== this.revision) return;
        const worker = this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        const failed = (message: string) => { if (this.worker !== worker || this.disposed) return; this.stop(); status(`${message}；源码与编辑内容保持完整。`); };
        worker.addEventListener('error', () => failed('语法高亮未能加载'));
        worker.addEventListener('message', ({ data }) => {
          if (this.disposed || this.worker !== worker || data.revision !== this.revision) return;
          if (data.type === 'error') { failed(data.message); return; }
          if (data.type === 'ready') { clearTimeout(this.deadline); this.ready = true; this.window(); }
          if (data.type === 'window' && data.request === this.request) this.view.dispatch({ effects: recolor.of({ revision, tokens: data.tokens }) });
        });
        this.deadline = setTimeout(() => failed('语法高亮解析超时'), 15000);
        worker.postMessage({ type: 'parse', source: this.view.state.doc.toString(), filename, revision });
      }, delay);
    }
    window() {
      if (!this.ready) return;
      this.worker?.postMessage({ type: 'window', revision: this.revision, request: ++this.request, from: this.view.viewport.from, to: this.view.viewport.to });
    }
    update(update: ViewUpdate) {
      if (update.docChanged) { this.decorations = this.decorations.map(update.changes); this.schedule(); }
      else if (update.viewportChanged) this.window();
      for (const transaction of update.transactions) for (const effect of transaction.effects) {
        if (!effect.is(recolor) || effect.value.revision !== this.revision) continue;
        const tokens = effect.value.tokens, ranges = [];
        for (let i = 0; i < tokens.length; i += CODE_TOKEN_STRIDE) {
          const from = tokens[i], to = tokens[i + 1];
          if (from < to && to <= update.state.doc.length) ranges.push(Decoration.mark({ class: 'fw-code-token', attributes: { style: codeTokenStyle(tokens, i) } }).range(from, to));
        }
        this.decorations = Decoration.set(ranges, true);
      }
    }
    destroy() { this.disposed = true; clearTimeout(this.timer); this.stop(); }
  }, { decorations: (instance) => instance.decorations });
}
