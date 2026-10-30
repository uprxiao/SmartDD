import { EditorSelection, StateEffect, StateField, Transaction, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import type { FileBuffer } from '../file-buffer';
import { domSourcePoint } from './file-markdown-source.mjs';
import { markdownLinkAllowed, markdownNativeSelection, waitMarkdownMouseup } from '@shared/markdown-events.mjs';
import type { MarkdownItem } from './model.mjs';
import { fileFindState } from '../text-find-state';
import { markdownFindKey, paintMarkdownFind, type RenderedFileFind } from './find-highlights';
import { createMarkdownMathBudget, createMarkdownMathSession, hydrateMarkdownMath, type MarkdownMathBudget, type MarkdownMathSession } from '@shared/markdown-math-session.mjs';
import { createMarkdownMathFragments } from '@shared/markdown-math-fragments.mjs';
import { markdownMarkerRevealed, markdownNodeRevealed } from '@shared/markdown-inline-plan.mjs';

interface Item extends MarkdownItem { cmFrom: number; cmTo: number; revision: number; mathBudget?: MarkdownMathBudget; fragmentMath?: MarkdownMathSession; inlineWidget?: boolean; ownerFrom?: number; ownerTo?: number }
export interface MarkdownHost {
  status(message: string): void;
  link(href: string): void;
  image(element: HTMLImageElement, source: string, signal: AbortSignal): Promise<void>;
  diagram?(element: HTMLElement, source: string, signal: AbortSignal): void | (() => void);
}

/** Markdown is a view of the same CodeMirror source document. Widgets may
 * reveal/select source, but never deserialize DOM text into a disk write. */
export function markdownEditor(buffer: Pick<FileBuffer, 'source' | 'editable'>, host: MarkdownHost): Extension {
  const source = buffer.source!;
  const setItems = StateEffect.define<Item[]>();
  const setFocused = StateEffect.define<boolean>();
  const mathSessions = new WeakMap<EditorView, MarkdownMathSession>();
  const gestures = new WeakMap<EditorView, () => void>();
  const linkDown = new WeakMap<EditorView, boolean>();
  const mathFor = (view: EditorView) => { let session = mathSessions.get(view); if (!session) { session = createMarkdownMathSession(); mathSessions.set(view, session); } return session; };
  type DiagramRecord = { key: string; id: string; code: string; active: boolean; owner: Block | null };
  const diagrams = new Map<string, DiagramRecord>(), diagramKey = (item: Item) => `${item.from}:${item.to}`;
  const diagramRecord = (item: Item): DiagramRecord => {
    const key = diagramKey(item), previous = diagrams.get(key);
    if (previous?.active && previous.code === item.source) return previous;
    const record = { key, id: `fw-diagram-${crypto.randomUUID()}`, code: item.source ?? '', active: true, owner: null }; diagrams.set(key, record); return record;
  };
  const alive = (view: EditorView, item: Item) => Boolean(view.state.field(field, false)?.items.some((current) => current.from === (item.ownerFrom ?? item.from) && current.to === (item.ownerTo ?? item.to) && (item.type === 'mermaid' ? current.type === 'mermaid' && current.source === item.source : current.revision === item.revision)));
  class Block extends WidgetType {
    abort: AbortController | null = null;
    constructor(readonly item: Item, readonly findKey: string, public record?: DiagramRecord) { super(); }
    eq(other: Block) { return this.record || other.record ? this.record === other.record && this.record?.active === true : this.findKey === other.findKey && this.item.revision === other.item.revision && this.item.from === other.item.from && this.item.to === other.item.to && this.item.mathBudget === other.item.mathBudget; }
    get estimatedHeight() { return this.item.type === 'rule' ? 20 : this.item.type === 'heading' ? 42 : 64; }
    toDOM(view: EditorView): HTMLElement {
      // CodeMirror may recreate viewport DOM for the same WidgetType object.
      // Async work belongs to this DOM lifetime; old callbacks retain their
      // aborted signal even when a later DOM instance has started loading.
      this.abort?.abort(); const abort = this.abort = new AbortController();
      const item = this.item; const element: HTMLElement = document.createElement(item.inlineWidget ? 'span' : 'div');
      element.className = `fw-md-block fw-md-${item.type}`; element.dataset.mdFrom = String(item.from); element.dataset.mdTo = String(item.to);
      if (item.inlineWidget) element.classList.add('fw-md-inline');
      element.setAttribute('aria-label', `Markdown ${item.type}`);
      if (item.metadata) {
        const list = document.createElement('dl');
        for (const [key, value] of item.metadata.entries) { const term = document.createElement('dt'), description = document.createElement('dd'); term.textContent = key; description.textContent = value; list.append(term, description); }
        element.append(list);
      } else if (item.type === 'mermaid' && item.source !== undefined) {
        this.record = diagramRecord(item); this.record.owner = this; element.id = this.record.id; element.dataset.mdDiagramId = this.record.id;
        let cleanup: void | (() => void);
        try { cleanup = host.diagram?.(element, item.source, abort.signal); } catch { element.textContent = item.source; host.status('图表渲染失败，源码仍保留'); }
        const resize = new ResizeObserver(() => { if (!abort.signal.aborted && element.isConnected) view.requestMeasure(); }); resize.observe(element);
        abort.signal.addEventListener('abort', () => { resize.disconnect(); try { cleanup?.(); } catch { /* Teardown must not interrupt editor disposal. */ } }, { once: true });
      }
      else if (item.html) element.innerHTML = item.html;
      if (item.sourceMap) {
        const code = element.querySelector('code');
        if (code) { code.dataset.mdSourceFrom = String(item.sourceMap.from); code.dataset.mdSourceTo = String(item.sourceMap.to); code.dataset.mdSourceMode = item.sourceMap.mode; if (item.sourceMap.runs) code.dataset.mdSourceRuns = JSON.stringify(item.sourceMap.runs); }
      }
      const find = view.state.field(fileFindState, false);
      if (find) paintMarkdownFind(element, find, raw => view.state.field(source.field).map.rawToCm(raw));
      if (item.mathBudget) hydrateMarkdownMath(element, item.ownerFrom !== undefined && item.fragmentMath ? item.fragmentMath : mathFor(view), abort.signal, {
        budget: item.mathBudget, baseUnits: item.html?.length ?? 0,
        measure: () => { if (!abort.signal.aborted && alive(view, item)) view.requestMeasure(); },
        overflow: () => {
          const current = view.state.field(field, false);
          if (abort.signal.aborted || !current || !alive(view, item)) return;
          const message = '此块预览复杂度超过预算，显示完整源码';
          view.dispatch({ effects: setItems.of(current.items.map(value => value.from === (item.ownerFrom ?? item.from) && value.to === (item.ownerTo ?? item.to) && value.mathBudget === item.mathBudget ? { ...value, sourceOnly: message } : value)), annotations: Transaction.addToHistory.of(false) }); host.status(message);
        },
        error: () => { if (!abort.signal.aborted && alive(view, item)) host.status('公式预览暂不可用，源码和修改仍保留'); },
      });
      for (const image of element.querySelectorAll<HTMLImageElement>('img[data-md-src]')) {
        const source = image.dataset.mdSrc ?? ''; image.removeAttribute('src');
        void host.image(image, source, abort.signal).catch(() => { if (!abort.signal.aborted) { image.alt = `${image.alt || '图片'}（无法加载）`; image.classList.add('fw-md-image-error'); } });
      }
      for (const image of element.querySelectorAll('img')) image.addEventListener('load', () => { if (!abort.signal.aborted) view.requestMeasure(); });
      const reveal = (position: number, extend = false) => {
        if (abort.signal.aborted || !alive(view, item)) return;
        const map = view.state.field(source.field).map, target = map.rawToCm(Math.max(item.from, Math.min(item.to, position)));
        view.focus(); view.dispatch({ selection: EditorSelection.single(extend ? view.state.selection.main.anchor : target, target), effects: [setFocused.of(true), EditorView.scrollIntoView(target, { y: 'nearest' })], annotations: Transaction.addToHistory.of(false) });
      };
      let blockedLinkDown = false;
      element.addEventListener('mousedown', (event) => {
        if ((event.target as Element).closest('a[data-md-href]')) { blockedLinkDown = !markdownLinkAllowed(event, { editorEmpty: view.state.selection.main.empty, nativeSelected: markdownNativeSelection(view.contentDOM) }); return; }
        if ((event.target as Element).closest('a, input, button, img') || event.button !== 0) return;
        if (abort.signal.aborted || !alive(view, item)) return;
        const document = element.ownerDocument, raw = view.state.field(source.field).raw;
        const at = (node: Node | null, offset: number, edge: 'start' | 'end') => {
          const mapped = domSourcePoint(view.contentDOM, node, offset, edge); if (mapped) return mapped.offset;
          if (!node || !view.contentDOM.contains(node)) return null;
          try { return view.state.field(source.field).map.cmToRaw(view.posAtDOM(node, offset)); } catch { return null; }
        };
        const range = document.caretRangeFromPoint?.(event.clientX, event.clientY);
        const point = range ? at(range.startContainer, range.startOffset, 'start') : null;
        // Formula glyphs are atomic. Their existing immediate source/focus
        // behavior stays separate from a native rendered-text drag.
        const formula = (event.target as Element).closest<HTMLElement>('[data-md-math]');
        if (formula) { event.preventDefault(); const end = Number(formula.dataset.mdMathContentEnd); reveal(Number.isSafeInteger(end) ? end : point ?? item.from, event.shiftKey); return; }
        gestures.get(view)?.();
        const current = () => !abort.signal.aborted && element.isConnected && alive(view, item) && view.state.field(source.field).raw === raw;
        const cancel = waitMarkdownMouseup(document, { signal: abort.signal, isCurrent: current, settled: () => { if (gestures.get(view) === cancel) gestures.delete(view); }, finish: () => {
          gestures.delete(view); const selected = document.getSelection();
          if (selected && !selected.isCollapsed && selected.rangeCount) {
            if (!markdownNativeSelection(view.contentDOM, selected)) return;
            const native = selected.getRangeAt(0), from = at(native.startContainer, native.startOffset, 'start'), to = at(native.endContainer, native.endOffset, 'end');
            if (from === null || to === null || from >= to) return;
            const backward = selected.anchorNode === native.endContainer && selected.anchorOffset === native.endOffset, map = view.state.field(source.field).map;
            const anchor = map.rawToCm(backward ? to : from), head = map.rawToCm(backward ? from : to);
            selected.removeAllRanges(); view.dispatch({ selection: EditorSelection.single(anchor, head), effects: EditorView.scrollIntoView(head, { y: 'nearest' }), annotations: Transaction.addToHistory.of(false) }); view.focus();
          } else reveal(point ?? item.from, event.shiftKey);
        } }); gestures.set(view, cancel);
      });
      element.addEventListener('click', (event) => {
        if (abort.signal.aborted) return;
        const target = event.target as HTMLElement, anchor = target.closest<HTMLAnchorElement>('a[data-md-href]');
        if (target.closest('[data-md-reveal]')) { event.preventDefault(); reveal(item.from); return; }
        if (anchor) { event.preventDefault(); const blocked = event.detail > 0 && blockedLinkDown; blockedLinkDown = false; if (!blocked && alive(view, item) && markdownLinkAllowed(event, { editorEmpty: view.state.selection.main.empty, nativeSelected: markdownNativeSelection(view.contentDOM) })) host.link(anchor.dataset.mdHref ?? ''); return; }
        const checkbox = target.closest<HTMLInputElement>('input[data-md-task-line]');
        if (checkbox) {
          event.preventDefault(); if (!buffer.editable || !alive(view, item)) return;
          const raw = view.state.field(source.field).raw, lines = [...raw.matchAll(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/g)];
          const line = lines[Number(checkbox.dataset.mdTaskLine)], marker = line?.[0].match(/^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]/);
          if (!line || !marker) return;
          const at = line.index + marker[0].lastIndexOf('[') + 1, map = view.state.field(source.field).map;
          view.dispatch({ changes: { from: map.rawToCm(at), to: map.rawToCm(at + 1), insert: marker[1] === ' ' ? 'x' : ' ' }, annotations: Transaction.userEvent.of('input') });
        }
      });
      element.tabIndex = 0;
      element.addEventListener('keydown', (event) => { if (event.key === 'Enter' && event.target === element) { event.preventDefault(); reveal(item.from); } });
      return element;
    }
    ignoreEvent() { return true; }
    destroy() { this.abort?.abort(); if (this.record?.owner === this) { this.record.owner = null; this.record.active = false; if (diagrams.get(this.record.key) === this.record) diagrams.delete(this.record.key); } }
  }
  const decorate = (items: Item[], selection: EditorSelection, focused: boolean, find: RenderedFileFind | undefined, map: { rawToCm(raw: number): number; cmToRaw(position: number): number }) => {
    for (const [key, record] of diagrams) if (!items.some(item => item.type === 'mermaid' && diagramKey(item) === key && item.source === record.code)) { record.active = false; diagrams.delete(key); }
    const ranges: Range<Decoration>[] = [], atomic: Range<Decoration>[] = [], rawRanges = selection.ranges.map(range => ({ from: map.cmToRaw(range.from), to: map.cmToRaw(range.to) }));
    const replace = (from: number, to: number, widget?: Block, block = false) => { if (to <= from) return; const range = Decoration.replace({ widget, block }).range(from, to); ranges.push(range); atomic.push(range); };
    for (const item of items) {
      if (item.cmTo <= item.cmFrom || item.sourceOnly || item.metadata?.error || item.type === 'blank' || item.type === 'definition' || item.type === 'mermaid' && typeof host.diagram !== 'function') continue;
      const intersects = (from: number, to: number) => selection.ranges.some(range => range.from <= to && range.to >= from);
      const retainsSource = item.inline?.some(node => node.sourceOnly);
      if (!intersects(item.cmFrom, item.cmTo) && !retainsSource) replace(item.cmFrom, item.cmTo, new Block(item, markdownFindKey(item.cmFrom, item.cmTo, find), item.type === 'mermaid' ? diagramRecord(item) : undefined), true);
      else {
      for (const node of item.inline ?? []) {
        const revealed = markdownNodeRevealed(node, rawRanges, focused);
        if (node.kind === 'heading') ranges.push(Decoration.line({ class: `fw-md-heading-line fw-md-heading-${node.level}` }).range(map.rawToCm(node.line!)));
        if (node.kind === 'format' && node.contentFrom! < node.contentTo!) ranges.push(Decoration.mark({ class: `fw-md-${node.style}` }).range(map.rawToCm(node.contentFrom!), map.rawToCm(node.contentTo!)));
        if (node.kind === 'code' && node.parts?.length && node.contentFrom! < node.contentTo!) ranges.push(Decoration.mark({ tagName: 'code', class: 'fw-md-code', attributes: { 'data-md-from': String(node.from), 'data-md-to': String(node.to) } }).range(map.rawToCm(node.contentFrom!), map.rawToCm(node.contentTo!)));
        if (node.kind === 'link' && node.contentFrom! < node.contentTo!) {
          const editing = focused && rawRanges.some(range => range.from < node.to && range.to > node.from);
          ranges.push(Decoration.mark({ class: 'fw-md-link', ...(editing ? {} : { tagName: 'a', attributes: { href: '#', 'data-md-href': node.href ?? '' } }) }).range(map.rawToCm(node.contentFrom!), map.rawToCm(node.contentTo!)));
        }
        for (const [index, [from, to]] of (node.parts ?? []).entries()) if (to > from) {
          if (markdownMarkerRevealed(node, index, rawRanges, focused)) ranges.push(Decoration.mark({ class: 'fw-md-delimiter' }).range(map.rawToCm(from), map.rawToCm(to)));
          else replace(map.rawToCm(from), map.rawToCm(to));
        }
        if (node.html && !revealed && !(node.kind === 'code' && node.parts?.length)) {
          const cmFrom = map.rawToCm(node.from), cmTo = map.rawToCm(node.to);
          const child: Item = { from: node.from, to: node.to, line: item.line, type: node.kind, html: node.html, cmFrom, cmTo, revision: item.revision, inlineWidget: true, ownerFrom: item.from, ownerTo: item.to };
          replace(cmFrom, cmTo, new Block(child, markdownFindKey(cmFrom, cmTo, find)));
        }
      }
      for (const math of item.math ?? []) {
        const cmFrom = map.rawToCm(math.from), cmTo = map.rawToCm(math.to);
        if (focused && intersects(cmFrom, cmTo)) continue;
        const child: Item = { from: math.from, to: math.to, line: item.line, type: math.block ? 'math' : 'math-inline', html: math.html, cmFrom, cmTo, revision: item.revision, mathBudget: item.mathBudget, fragmentMath: item.fragmentMath, inlineWidget: !math.block, ownerFrom: item.from, ownerTo: item.to };
        replace(cmFrom, cmTo, new Block(child, markdownFindKey(cmFrom, cmTo, find)), math.block);
      }
      }
    }
    return { decorations: Decoration.set(ranges, true), atomic: Decoration.set(atomic, true) };
  };
  const field = StateField.define<{ items: Item[]; focused: boolean; decorations: DecorationSet; atomic: DecorationSet }>({
    create: () => ({ items: [], focused: false, decorations: Decoration.none, atomic: Decoration.none }),
    update(value, transaction) {
      let items = value.items;
      if (transaction.docChanged) {
        const before = transaction.startState.field(source.field), after = transaction.state.field(source.field);
        items = items.filter(item => item.type === 'mermaid' && before.raw.slice(item.from, item.to) === after.raw.slice(item.from, item.to) &&
          after.map.rawToCm(item.from) === item.cmFrom && after.map.rawToCm(item.to) === item.cmTo &&
          transaction.changes.mapPos(item.cmFrom, 1) === item.cmFrom && transaction.changes.mapPos(item.cmTo, -1) === item.cmTo);
      }
      for (const effect of transaction.effects) if (effect.is(setItems)) items = effect.value;
      let focused = value.focused; for (const effect of transaction.effects) if (effect.is(setFocused)) focused = effect.value;
      const find = transaction.state.field(fileFindState, false), oldFind = transaction.startState.field(fileFindState, false);
      return transaction.docChanged || transaction.selection || items !== value.items || find !== oldFind || focused !== value.focused ? { items, focused, ...decorate(items, transaction.newSelection, focused, find, transaction.state.field(source.field).map) } : value;
    },
    provide: (state) => [EditorView.decorations.from(state, (value) => value.decorations), EditorView.atomicRanges.of((view) => view.state.field(state).atomic)],
  });
  return [field, EditorView.lineWrapping, EditorView.domEventHandlers({
    mousedown(event, view) {
      const anchor = (event.target as Element).closest('a[data-md-href]'); if (!anchor || !view.contentDOM.contains(anchor)) return false;
      const allowed = markdownLinkAllowed(event, { editorEmpty: view.state.selection.main.empty, nativeSelected: markdownNativeSelection(view.contentDOM) }); linkDown.set(view, !allowed);
      if (allowed) { event.preventDefault(); return true; } return false;
    },
    click(event, view) {
      const anchor = (event.target as Element).closest<HTMLElement>('a[data-md-href]'); if (!anchor || !view.contentDOM.contains(anchor)) return false;
      event.preventDefault(); const blocked = event.detail > 0 && linkDown.get(view); linkDown.delete(view);
      if (!blocked && markdownLinkAllowed(event, { editorEmpty: view.state.selection.main.empty, nativeSelected: markdownNativeSelection(view.contentDOM) })) host.link(anchor.dataset.mdHref ?? ''); return true;
    },
    dblclick(event, view) {
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
      if (position === null || view.state.wordAt(position) !== null) return false;
      const line = view.state.doc.lineAt(position), offset = position - line.from;
      if (!/[\t ]/.test(line.text.slice(Math.max(0, offset - 1), offset + 1))) return false;
      view.dispatch({ selection: EditorSelection.cursor(position) });
      return true;
    },
  }), ViewPlugin.fromClass(class {
    worker: Worker | null = null;
    revision = 0; serial = 0; active: { id: number; rev: number; type: string } | null = null;
    queued = true; disposed = false; index: Uint32Array | null = null; windowStart = -1;
    timer?: ReturnType<typeof setTimeout>; deadline?: ReturnType<typeof setTimeout>;
    readonly math: MarkdownMathSession;
    constructor(readonly view: EditorView) { this.math = mathFor(view); this.schedule(); }
    update(update: ViewUpdate) {
      if (update.focusChanged) queueMicrotask(() => { if (!this.disposed && this.view.state.field(field).focused !== this.view.hasFocus) this.view.dispatch({ effects: setFocused.of(this.view.hasFocus), annotations: Transaction.addToHistory.of(false) }); });
      if (update.docChanged) { gestures.get(this.view)?.(); gestures.delete(this.view); this.revision++; this.index = null; this.windowStart = -1; this.queued = true; this.schedule(); }
      else if (update.viewportChanged) this.schedule();
    }
    schedule() { clearTimeout(this.timer); this.timer = setTimeout(() => this.run(), 30); }
    stop(message?: string) {
      this.worker?.terminate(); this.worker = null; this.active = null; this.index = null; this.windowStart = -1; clearTimeout(this.deadline);
      if (message && !this.disposed) host.status(message);
    }
    run() {
      if (this.disposed || this.active || this.view.composing) { if (!this.disposed && this.view.composing) this.schedule(); return; }
      if (!this.worker) {
        this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        this.worker.onerror = (error) => { error.preventDefault(); this.stop('文档预览失败，源码和修改仍保留'); };
        this.worker.onmessage = ({ data }) => {
          if (this.disposed || !this.active || data.id !== this.active.id) return;
          if (data.rev !== this.revision) { this.active = null; clearTimeout(this.deadline); this.schedule(); return; }
          if (data.type === 'failure') { this.stop(`${data.error}；源码和修改仍保留`); return; }
          if (data.type === 'result') { this.index = data.index; this.active = null; clearTimeout(this.deadline); this.run(); return; }
          if (data.type === 'window') {
            const map = this.view.state.field(source.field).map;
            const budget = createMarkdownMathBudget((data.items as MarkdownItem[]).reduce((units, item) => units + (item.html?.length ?? 0), 0));
            const items = (data.items as MarkdownItem[]).map((item) => ({ ...item, revision: this.revision, cmFrom: map.rawToCm(item.from), cmTo: map.rawToCm(item.to), mathBudget: item.html?.includes('data-md-math=') ? budget : undefined, fragmentMath: item.math?.length ? createMarkdownMathFragments(this.math) : undefined }));
            this.active = null; clearTimeout(this.deadline);
            if (this.view.composing) { this.windowStart = -1; this.schedule(); return; }
            this.view.dispatch({ effects: setItems.of(items), annotations: Transaction.addToHistory.of(false) });
            host.status(items.find((item) => item.sourceOnly)?.sourceOnly ?? items.find((item) => item.metadata?.error)?.metadata?.error ?? '');
            this.schedule();
          }
        };
      }
      if (this.queued) {
        this.queued = false; this.active = { id: ++this.serial, rev: this.revision, type: 'parse' };
        this.worker.postMessage({ ...this.active, source: this.view.state.field(source.field).raw });
      } else if (this.index) {
        const rawFrom = this.view.state.field(source.field).map.cmToRaw(this.view.viewport.from);
        let low = 0, high = this.index.length / 4;
        while (low < high) { const mid = (low + high) >> 1; if (this.index[mid * 4 + 1] <= rawFrom) low = mid + 1; else high = mid; }
        const start = Math.max(0, low - 10);
        if (start === this.windowStart) return;
        this.windowStart = start; this.active = { id: ++this.serial, rev: this.revision, type: 'window' };
        this.worker.postMessage({ ...this.active, start, readOnly: !buffer.editable });
      } else return;
      this.deadline = setTimeout(() => this.stop('文档预览超过 15 秒，已停止解析；源码和修改仍保留'), 15000);
    }
    destroy() { this.disposed = true; gestures.get(this.view)?.(); gestures.delete(this.view); linkDown.delete(this.view); clearTimeout(this.timer); this.stop(); this.math.dispose(); if (mathSessions.get(this.view) === this.math) mathSessions.delete(this.view); for (const record of [...diagrams.values()]) { record.owner?.destroy(); record.active = false; } diagrams.clear(); }
  })];
}
