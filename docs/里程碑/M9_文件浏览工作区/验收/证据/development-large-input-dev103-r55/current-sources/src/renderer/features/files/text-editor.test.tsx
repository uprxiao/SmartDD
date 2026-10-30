// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { useSyncExternalStore } from 'react';
import { EditorView } from '@codemirror/view';
import { EditorSelection } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileSaveInput, FileSaveReceipt } from '@shared/files';
import { FileBuffer, type FileClient } from './file-buffer';
import { FileTextEditor } from './text-editor';

// Keep the production EditorView, history and buffer intact. Only unrelated
// syntax/Markdown rendering and the file API boundary are isolated here.
vi.mock('./code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('./markdown/editor', () => ({ markdownEditor: () => [] }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const buffers: FileBuffer[] = [];
function fixture(name = 'history.txt', raw = 'BASE\r\n') {
  const id = randomUUID();
  const file: FileDocument = { name, ref: { id, lease: id, generation: 1 }, documentKey: `local:1:${id}`, relativePath: name, absolutePath: `/fixture/${name}`, writable: true, revision: { device: '1', inode: id, size: raw.length, hash: hash(raw), modifiedNs: '1', changedNs: '1' } };
  const api = {
    read: vi.fn(async () => ({ document: file, base64: Buffer.from(raw).toString('base64') })), refresh: vi.fn(async () => file),
    save: vi.fn(async (input: FileSaveInput): Promise<FileSaveReceipt> => ({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'saved', revision: file.revision })),
    checkpoint: vi.fn(async (input: Parameters<FileClient['checkpoint']>[0]) => ({ draftId: input.draftId, bufferVersion: input.bufferVersion, hash: hash(Buffer.from(input.base64, 'base64').toString()) })),
    drafts: vi.fn(async () => []), readDraft: vi.fn(), resolveDraft: vi.fn(async () => ({ resolved: true })), closeDocument: vi.fn(async () => undefined),
  };
  let revision = 0;
  const listeners = new Set<() => void>();
  const buffer = new FileBuffer(file, api, () => { revision++; listeners.forEach((listener) => listener()); }); buffers.push(buffer);
  return { buffer, api, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; }, snapshot: () => revision };
}
function Editor({ value }: { value: ReturnType<typeof fixture> }) {
  useSyncExternalStore(value.subscribe, value.snapshot);
  return <FileTextEditor buffer={value.buffer} wrap={false} />;
}
const button = (name: string) => screen.getByRole('button', { name }) as HTMLButtonElement;
const editor = () => EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
const editOneCharacter = () => act(() => { editor().dispatch({ changes: { from: 2, to: 3, insert: 'X' }, selection: { anchor: 3 }, userEvent: 'input.type' }); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, {
    getClientRects: { configurable: true, value: () => [] },
    getBoundingClientRect: { configurable: true, value: () => new DOMRect() },
  });
});
afterEach(() => { cleanup(); buffers.splice(0).forEach((buffer) => buffer.dispose()); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('production text history controls (real CodeMirror; file API isolated)', () => {
  it('large input replaces the selected range in one lossless editor transaction before native DOM insertion', async () => {
    const value = fixture('atomic.txt', 'BASE\n'); await value.buffer.load(); render(<Editor value={value} />);
    const input = '中文🙂\n'.repeat(20_000), current = editor();
    act(() => current.dispatch({ selection: { anchor: 0, head: current.state.doc.length } }));
    const event = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: input });
    act(() => current.contentDOM.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); expect(value.buffer.raw).toBe(input); expect(value.buffer.dirty).toBe(true);
    expect(button('撤销').disabled).toBe(false); fireEvent.click(button('撤销')); expect(value.buffer.raw).toBe('BASE\n');
    fireEvent.click(button('重做')); expect(value.buffer.raw).toBe(input);
    expect(value.api.save).not.toHaveBeenCalled(); expect(value.api.checkpoint).not.toHaveBeenCalled();
  });

  it('M9-T-H02: reflects real undo/redo availability, restores focus and avoids a save after returning to base', async () => {
    const value = fixture(); await value.buffer.load(); render(<Editor value={value} />);
    expect(screen.getByRole('toolbar', { name: '文本编辑' })).toBeTruthy();
    expect(button('撤销').disabled).toBe(true); expect(button('重做').disabled).toBe(true);
    editOneCharacter();
    expect(value.buffer.raw).toBe('BAXE\r\n'); expect(value.buffer.dirty).toBe(true);
    expect(button('撤销').disabled).toBe(false); expect(button('重做').disabled).toBe(true);
    act(() => editor().focus());
    expect(fireEvent.mouseDown(button('撤销'))).toBe(false); expect(editor().hasFocus).toBe(true);
    fireEvent.click(button('撤销'));
    expect(value.buffer.raw).toBe('BASE\r\n'); expect(value.buffer.dirty).toBe(false); expect(editor().hasFocus).toBe(true);
    expect(button('撤销').disabled).toBe(true); expect(button('重做').disabled).toBe(false);
    // Keyboard activation can start with focus on the toolbar button.
    act(() => button('重做').focus()); fireEvent.click(button('重做'));
    expect(value.buffer.raw).toBe('BAXE\r\n'); expect(value.buffer.dirty).toBe(true); expect(editor().hasFocus).toBe(true);
    expect(button('撤销').disabled).toBe(false); expect(button('重做').disabled).toBe(true);
    fireEvent.click(button('撤销'));
    expect(value.buffer.raw).toBe('BASE\r\n'); expect(value.buffer.dirty).toBe(false); expect(editor().hasFocus).toBe(true);
    expect(button('撤销').disabled).toBe(true); expect(button('重做').disabled).toBe(false);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(value.api.save).not.toHaveBeenCalled(); expect(value.api.checkpoint).not.toHaveBeenCalled();
  });

  it('disables both directions when the file becomes read-only even with a usable history branch', async () => {
    const value = fixture(); await value.buffer.load(); render(<Editor value={value} />); editOneCharacter();
    act(() => { value.buffer.file = { ...value.buffer.file, writable: false }; value.buffer.notify(); });
    expect(button('撤销').disabled).toBe(true); expect(button('重做').disabled).toBe(true);
    fireEvent.click(button('撤销')); expect(value.buffer.raw).toBe('BAXE\r\n');
    act(() => { value.buffer.file = { ...value.buffer.file, writable: true }; value.buffer.notify(); });
    fireEvent.click(button('撤销')); expect(value.buffer.raw).toBe('BASE\r\n');
    act(() => { value.buffer.file = { ...value.buffer.file, writable: false }; value.buffer.notify(); });
    expect(button('撤销').disabled).toBe(true); expect(button('重做').disabled).toBe(true);
    fireEvent.click(button('重做')); expect(value.buffer.raw).toBe('BASE\r\n'); expect(value.api.save).not.toHaveBeenCalled();
  });

  it('targets only the current document and retains its own history after a view switch', async () => {
    const first = fixture('first.txt'), second = fixture('second.txt'); await first.buffer.load(); await second.buffer.load();
    const mounted = render(<Editor value={first} />); editOneCharacter();
    mounted.rerender(<Editor value={second} />);
    expect(button('撤销').disabled).toBe(true); expect(button('重做').disabled).toBe(true);
    fireEvent.click(button('撤销')); expect(first.buffer.raw).toBe('BAXE\r\n'); expect(second.buffer.raw).toBe('BASE\r\n');
    editOneCharacter(); fireEvent.click(button('撤销'));
    expect(second.buffer.raw).toBe('BASE\r\n'); expect(first.buffer.raw).toBe('BAXE\r\n');
    mounted.rerender(<Editor value={first} />);
    expect(button('撤销').disabled).toBe(false); expect(button('重做').disabled).toBe(true);
    fireEvent.click(button('撤销'));
    expect(first.buffer.raw).toBe('BASE\r\n'); expect(second.buffer.raw).toBe('BASE\r\n');
    expect(first.api.save).not.toHaveBeenCalled(); expect(second.api.save).not.toHaveBeenCalled();
  });
});

describe('file Find controls over real CodeMirror state', () => {
  const find = (query: string) => {
    fireEvent.keyDown(editor().contentDOM, { key: 'f', code: 'KeyF', metaKey: true });
    fireEvent.change(screen.getByRole('textbox', { name: '在文件中查找' }), { target: { value: query } });
  };
  const count = () => document.querySelector('.fw-find>span')?.textContent;
  it('R13 selects the first actual literal match, wraps navigation and closes/reopens without writing the document', async () => {
    const value = fixture('find.txt', 'Before BASE after base\r\n'); await value.buffer.load(); render(<Editor value={value} />); find('base');
    expect(count()).toBe('1/2'); expect(editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to)).toBe('BASE');
    fireEvent.click(button('上一个匹配')); expect(count()).toBe('2/2'); expect(editor().state.sliceDoc(editor().state.selection.main.from, editor().state.selection.main.to)).toBe('base');
    fireEvent.click(button('下一个匹配')); expect(count()).toBe('1/2'); find('absent'); expect(count()).toBe('0/0'); expect(button('下一个匹配').disabled).toBe(true);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '在文件中查找' }), { key: 'Escape' }); expect(screen.queryByRole('textbox', { name: '在文件中查找' })).toBeNull(); expect(editor().hasFocus).toBe(true);
    find('base'); expect(count()).toBe('1/2'); expect(editor().state.selection.main.from).toBe(7); expect(value.buffer.dirty).toBe(false); expect(value.api.save).not.toHaveBeenCalled();
  });
  it('R14 recomputes from dirty editor transactions and undo without replacing the caret or reading the old disk', async () => {
    const value = fixture('edit-find.txt', 'word word\n'); await value.buffer.load(); render(<Editor value={value} />); find('word');
    act(() => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'word word word\n' }, selection: { anchor: 15 }, userEvent: 'input.type', annotations: isolateHistory.of('full') }));
    expect(count()).toBe('1/3'); expect(editor().state.selection.main.head).toBe(15);
    act(() => editor().dispatch({ changes: { from: 0, to: editor().state.doc.length, insert: 'none\n' }, userEvent: 'delete.selection', annotations: isolateHistory.of('full') })); expect(count()).toBe('0/0');
    fireEvent.click(button('撤销')); expect(count()).toBe('1/3'); expect(editor().state.selection.main.to).toBeLessThanOrEqual(editor().state.doc.length);
    fireEvent.click(button('撤销')); expect(count()).toBe('1/2'); expect(value.buffer.raw).toBe('word word\n'); expect(value.api.read).toHaveBeenCalledTimes(1);
  });
  it.each([998, 999, 1000])('R19 %i original matches have bounded navigation and an accurate more marker', async total => {
    const value = fixture('count.txt', 'word\n'.repeat(total)); await value.buffer.load(); render(<Editor value={value} />); find('word'); const limit = Math.min(total, 999), suffix = total > 999 ? '+' : '';
    expect(count()).toBe(`1/${limit}${suffix}`); fireEvent.click(button('上一个匹配')); expect(count()).toBe(`${limit}/${limit}${suffix}`); expect(editor().state.selection.main.from).toBe((limit - 1) * 5);
    fireEvent.click(button('下一个匹配')); expect(count()).toBe(`1/${limit}${suffix}`);
    if (total === 1000) {
      act(() => editor().dispatch({ changes: { from: 4995, to: 5000 }, userEvent: 'delete.selection' })); expect(count()).toBe('1/999'); fireEvent.click(button('撤销')); expect(count()).toBe('1/999+');
    }
  });
});

describe('line navigation with real CodeMirror and buffer (file API isolated)', () => {
  const input = () => screen.getByRole('textbox', { name: '行号' });
  const openLine = () => { fireEvent.click(button('跳转到行')); return input(); };
  const preview = (value: string) => fireEvent.change(input(), { target: { value } });
  const line = () => editor().state.doc.lineAt(editor().state.selection.main.head).number;
  const text = Array.from({ length: 20 }, (_, i) => `Line ${i + 1} 中文🙂`).join('\r\n');
  it('R15 clamps positive/negative targets, counts CRLF once and navigates an empty document without editing or history', async () => {
    const value = fixture('lines.txt', text); await value.buffer.load(); const mounted = render(<Editor value={value} />);
    for (const [target, expected] of [['1', 1], ['20', 20], ['21', 20], ['-1', 20], ['-20', 1], ['-21', 1]] as const) {
      openLine(); preview(target); expect(line()).toBe(expected); fireEvent.keyDown(input(), { key: 'Enter' }); expect(editor().hasFocus).toBe(true); expect(screen.queryByRole('textbox', { name: '行号' })).toBeNull();
    }
    expect(value.buffer.raw).toBe(text); expect(value.buffer.dirty).toBe(false); expect(button('撤销').disabled).toBe(true); expect(value.api.save).not.toHaveBeenCalled(); expect(value.api.checkpoint).not.toHaveBeenCalled();
    const empty = fixture('empty.txt', ''); await empty.buffer.load(); mounted.rerender(<Editor value={empty} />); openLine(); preview('1'); fireEvent.keyDown(input(), { key: 'Enter' }); expect(line()).toBe(1); expect(empty.buffer.raw).toBe('');
  });
  it('R16 rejects invalid integers without moving or closing, exposes the error, trims valid input and ignores composing Enter', async () => {
    const value = fixture('validation.txt', text); await value.buffer.load(); render(<Editor value={value} />); act(() => editor().dispatch({ selection: { anchor: 7 } }));
    openLine();
    for (const target of ['0', '1.5', 'abc', '9007199254740992', ' ']) {
      preview(target); expect(input().getAttribute('aria-invalid')).toBe('true'); expect(screen.getByRole('alert').textContent).toMatch(/整数/); fireEvent.keyDown(input(), { key: 'Enter' }); expect(editor().state.selection.main.head).toBe(7); expect(document.activeElement).toBe(input());
    }
    fireEvent.compositionStart(input()); preview('9'); fireEvent.keyDown(input(), { key: 'Enter', isComposing: true }); expect(editor().state.selection.main.head).toBe(7); fireEvent.compositionEnd(input()); expect(line()).toBe(9);
    preview(' 7 '); expect(input().getAttribute('aria-invalid')).toBe('false'); fireEvent.keyDown(input(), { key: 'Enter' }); expect(line()).toBe(7); expect(value.buffer.dirty).toBe(false);
  });
  it('R17 Escape and close restore the full backwards selection and both scroll axes; Enter retains the target', async () => {
    const value = fixture('cancel.txt', text); await value.buffer.load(); render(<Editor value={value} />);
    act(() => editor().dispatch({ selection: EditorSelection.single(100, 80) })); editor().scrollDOM.scrollTop = 321; editor().scrollDOM.scrollLeft = 47;
    const original = editor().state.selection;
    for (const close of ['Escape', 'button']) {
      openLine(); preview('20'); expect(line()).toBe(20); editor().scrollDOM.scrollTop = 900; editor().scrollDOM.scrollLeft = 0;
      if (close === 'Escape') fireEvent.keyDown(input(), { key: 'Escape' }); else fireEvent.click(button('关闭跳行'));
      expect(editor().state.selection.eq(original)).toBe(true); expect(editor().scrollDOM.scrollTop).toBe(321); expect(editor().scrollDOM.scrollLeft).toBe(47); expect(editor().hasFocus).toBe(true);
    }
    openLine(); preview('12'); fireEvent.keyDown(input(), { key: 'Enter' }); expect(line()).toBe(12); expect(value.buffer.dirty).toBe(false);
  });
  it('R17 switching files cancels in the old live view before teardown and never restores its position into the next buffer', async () => {
    const first = fixture('first-lines.txt', text), second = fixture('other-lines.txt', 'Other\nTail'); await first.buffer.load(); await second.buffer.load(); const mounted = render(<Editor value={first} />);
    act(() => editor().dispatch({ selection: EditorSelection.single(100, 80) })); editor().scrollDOM.scrollTop = 321; const original = first.buffer.editor!.selection; openLine(); preview('20');
    mounted.rerender(<Editor value={second} />); expect(screen.queryByRole('textbox', { name: '行号' })).toBeNull(); expect(second.buffer.editor!.selection.main.head).toBe(0); expect(first.buffer.editor!.selection.eq(original)).toBe(true); expect(first.buffer.scrollTop).toBe(321);
    mounted.rerender(<Editor value={first} />); expect(editor().state.selection.eq(original)).toBe(true); expect(editor().scrollDOM.scrollTop).toBe(321);
  });
  it('never restores an obsolete selection after a real edit or another navigation changed the preview owner', async () => {
    const value = fixture('changed-lines.txt', text); await value.buffer.load(); render(<Editor value={value} />); openLine(); preview('20');
    act(() => editor().dispatch({ changes: { from: 0, insert: 'NEW\n' }, selection: { anchor: 2 }, userEvent: 'input.type' })); expect(screen.queryByRole('textbox', { name: '行号' })).toBeNull(); expect(editor().state.selection.main.head).toBe(2); expect(value.buffer.raw.startsWith('NEW')).toBe(true);
    openLine(); preview('10'); act(() => editor().dispatch({ selection: { anchor: 3 } })); expect(screen.queryByRole('textbox', { name: '行号' })).toBeNull(); expect(editor().state.selection.main.head).toBe(3);
  });
  it('shares one bar with Find and permits navigation in read-only text while composition disables opening', async () => {
    const value = fixture('read-only.txt', text); await value.buffer.load(); value.buffer.file = { ...value.buffer.file, writable: false }; render(<Editor value={value} />); openLine(); preview('-1'); fireEvent.keyDown(input(), { key: 'Enter' }); expect(line()).toBe(20); expect(value.buffer.dirty).toBe(false);
    openLine(); preview('2'); fireEvent.keyDown(input(), { key: 'f', code: 'KeyF', metaKey: true }); expect(screen.queryByRole('textbox', { name: '行号' })).toBeNull(); expect(screen.getByRole('textbox', { name: '在文件中查找' })).toBeTruthy(); openLine(); expect(screen.queryByRole('textbox', { name: '在文件中查找' })).toBeNull(); fireEvent.keyDown(input(), { key: 'Escape' });
    act(() => { value.buffer.file = { ...value.buffer.file, writable: true }; value.buffer.notify(); }); fireEvent.compositionStart(editor().contentDOM); expect(button('跳转到行').disabled).toBe(true); fireEvent.click(button('跳转到行')); expect(screen.queryByRole('textbox', { name: '行号' })).toBeNull();
  });
});
