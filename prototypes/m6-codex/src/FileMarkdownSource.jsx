import { useLayoutEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { createSourceField } from '../../../src/renderer/features/files/editor-source.ts';
import { markdownEditor } from '../../../src/renderer/features/files/markdown/editor.ts';
import { resolveMarkdownPath, safeImageSrc } from './file-markdown-model.mjs';
import { renderThemedMermaid } from './file-markdown-mermaid.mjs';
import { guardEditorComposition } from '../../../src/shared/file-composition-shortcut.mjs';
import '../../../src/renderer/features/files/markdown/style.css';

/** Synthetic prototype host, actual shared CM/source/decorations/Workers.
 * It has no filesystem/IPC/native authority and only accepts fixture images. */
export function FileMarkdownSource(props) {
  const container = useRef(null), callbacks = useRef(props); callbacks.current = props;
  useLayoutEffect(() => {
    let disposed = false, view;
    const source = createSourceField(props.text), map = EditorState.create({ doc: source.normalized, extensions: [source.extensions] }).field(source.field).map;
    const buffer = { source, get editable() { return !callbacks.current.readOnly; } };
    const host = {
      status: message => callbacks.current.onStatus?.(message),
      link: href => callbacks.current.onLink?.(href),
      image: async (element, authored, signal) => {
        if (signal.aborted) return;
        const current = callbacks.current, resolved = resolveMarkdownPath(current.path || '', authored);
        element.src = current.resolveImageSource?.(resolved) || safeImageSrc(authored);
      },
      diagram: (element, code, signal) => {
        const id = element.id, live = () => !disposed && !signal.aborted && element.isConnected;
        renderThemedMermaid({ id, source: code, theme: document.documentElement.dataset.theme || 'light', cancelled: () => !live() }).then(svg => { if (live()) { element.innerHTML = svg; view.requestMeasure(); } }).catch(error => { if (live()) { element.textContent = '图表无法渲染：' + String(error.message); view.requestMeasure(); } });
        return () => { document.getElementById('d' + id)?.remove(); };
      },
    };
    const from = map.rawToCm(props.selectionFrom), to = map.rawToCm(props.selectionTo);
    const state = EditorState.create({
      doc: source.normalized, selection: props.readingSelection ?? { anchor: props.direction === 'backward' ? to : from, head: props.direction === 'backward' ? from : to },
      extensions: [source.extensions, history(), keymap.of([...defaultKeymap, ...historyKeymap]), EditorState.readOnly.of(Boolean(props.readOnly)), markdownEditor(buffer, host), EditorView.domEventHandlers({
        blur(event) { if(callbacks.current.retainView)return false;if (event.relatedTarget && view.dom.contains(event.relatedTarget)) return false; queueMicrotask(() => { if (!disposed && !view.hasFocus && !view.composing) callbacks.current.onFinish?.(false); }); return false; },
        keydown(event) { if (event.key === 'Escape' && !event.isComposing && !view.composing) { event.preventDefault(); callbacks.current.onFinish?.(true); return true; } return false; },
        compositionstart() { callbacks.current.onComposition?.(true); return false; }, compositionend() { callbacks.current.onComposition?.(false); return false; },
      })],
    });
    view = new EditorView({ state, parent: container.current, dispatchTransactions(transactions) {
      view.update(transactions); const current = view.state.field(source.field), selected = view.state.selection.main;
      if (transactions.some(transaction => transaction.docChanged)) callbacks.current.onEdit(current.raw);
      if (transactions.some(transaction => transaction.selection || transaction.docChanged)) { callbacks.current.onSelect?.(current.map.cmToRaw(selected.from), current.map.cmToRaw(selected.to));callbacks.current.onReadingSelection?.(selected.anchor,selected.head); }
    } });
    view.contentDOM.setAttribute('aria-label', 'Markdown 源文本编辑'); if(props.autoFocus!==false){view.focus();view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'nearest' }) });}
    const selected=view.state.selection.main;callbacks.current.onSelect?.(map.cmToRaw(selected.from),map.cmToRaw(selected.to));callbacks.current.onReadingSelection?.(selected.anchor,selected.head);
    return () => { disposed = true; view.destroy(); };
  }, []);
  return <div ref={container} className="fw-md-source-core fw-markdown-editable" onKeyDownCapture={event => {
    guardEditorComposition(event);
  }} />;
}
