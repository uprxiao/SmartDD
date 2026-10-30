// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileDocument } from '@shared/files';
import { FileBuffer } from './file-buffer';
import { FileTextEditor } from './text-editor';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => {} } }));
vi.mock('./code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('./markdown/editor', () => ({ markdownEditor: () => [] }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('readonly review preserves the real editor and history, blocks document changes, and still accepts source selection', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const file = { name: 'range.txt', ref: { id: 'id' }, writable: true, revision: { hash: 'a'.repeat(64), size: 20 }, content: { kind: 'text', basis: 'extension' } } as FileDocument;
  const api = { read: async () => ({ document: file, base64: btoa('First\r\nSecond\r\nThird') }), drafts: async () => [], closeDocument: async () => {} };
  const buffer = new FileBuffer(file, api as never, () => {}); buffer.pauseAutosave(); await buffer.load();
  const host = render(<FileTextEditor buffer={buffer} wrap={false} />), view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  act(() => view.dispatch({ changes: { from: 0, insert: 'Saved ' } })); const text = buffer.raw;
  // The preceding text/history is deliberately retained; this component check
  // isolates the view guard. The store separately rejects dirty range opens.
  buffer.navigationView = 'review'; host.rerender(<FileTextEditor buffer={buffer} wrap={false} />);
  await waitFor(() => expect(view.state.facet(EditorState.readOnly)).toBe(true));
  act(() => { undo(view); view.dispatch({ changes: { from: 0, insert: 'BLOCKED ' } }); view.dispatch({ selection: { anchor: 6, head: 11 } }); });
  expect(buffer.raw).toBe(text); expect(view.state.doc.toString()).toBe(text.replaceAll('\r\n', '\n')); expect(view.state.selection.main.from).toBe(6); expect(view.state.selection.main.to).toBe(11);
  buffer.navigationView = null; host.rerender(<FileTextEditor buffer={buffer} wrap={false} />); await waitFor(() => expect(view.state.facet(EditorState.readOnly)).toBe(false));
  expect(EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)).toBe(view);
  act(() => undo(view)); expect(buffer.raw).toBe('First\r\nSecond\r\nThird'); host.unmount(); buffer.dispose();
});
