// @vitest-environment jsdom
import { randomUUID } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import { FileBuffer } from '../file-buffer';
import { FileTextEditor } from '../text-editor';
import { FileContextActions } from '../file-actions';
import type { FileWorkspaceStore } from '../workspace-store';
import { FileTerminalContextProvider, TerminalReferenceTray } from './context';
import { registerFileTerminal } from './store';
const mocked = vi.hoisted(() => ({ api: {} as Record<string, any> }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: mocked.api } }));
vi.mock('../code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('../markdown/editor', () => ({ markdownEditor: () => [] }));
const disposers: (() => void)[] = [];
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0).reverse()) dispose(); vi.unstubAllGlobals(); });
async function fixture() {
  const root: FileRoot = { lease: randomUUID(), generation: 1, source: 'task-cwd', sourceId: 'task', path: '/tmp/project', canonicalPath: '/tmp/project', label: 'Project', identity: { device: '1', inode: '2' } };
  const text = 'first\n中文🙂 selected\nlast\n';
  const file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, documentKey: 'local:1:3', name: 'context.ts', relativePath: 'context.ts', absolutePath: '/tmp/project/context.ts', writable: true, revision: { device: '1', inode: '3', size: text.length, hash: 'a'.repeat(64), modifiedNs: '1', changedNs: '1' }, content: { kind: 'text', mime: 'text/plain', language: 'typescript' } as never };
  Object.assign(mocked.api, {
    read: vi.fn(async () => ({ document: file, base64: Buffer.from(text).toString('base64') })), drafts: vi.fn(async () => []), closeDocument: vi.fn(async () => undefined),
    open: vi.fn(async () => ({ ...file, ref: { ...file.ref, id: randomUUID() } })), refresh: vi.fn(async () => file), applications: vi.fn(async () => ({ id: 'apps', apps: [] })),
    terminalBind: vi.fn(async () => ({ id: randomUUID(), taskId: 'task', ptyId: 'pty', lease: root.lease, generation: 1 })), terminalRelease: vi.fn(async () => undefined),
    terminalPrepare: vi.fn(async () => ({ id: randomUUID(), relativePath: file.relativePath, revision: file.revision, identity: file.revision })),
    terminalInsert: vi.fn(async (input: { operationId: string }) => ({ operationId: input.operationId, state: 'inserted', characters: 30, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false })),
  });
  const buffer = new FileBuffer(file, mocked.api as never, () => undefined); await buffer.load(); disposers.push(() => buffer.dispose());
  const workspace = { treeRoot: root, snapshot: () => 0 } as unknown as FileWorkspaceStore;
  const target = { taskId: 'task', ptyId: 'pty', focus: vi.fn() }; disposers.push(registerFileTerminal(target));
  const tree = (value: FileBuffer) => <FileTerminalContextProvider workspace={workspace}><FileContextActions target={{ kind: 'document', ref: file.ref }} absolutePath={file.absolutePath} relativePath={file.relativePath} origin="breadcrumb" buffer={value} run={run => { void run(); }}><button>File source</button></FileContextActions><FileTextEditor buffer={value} wrap={false} /><TerminalReferenceTray /></FileTerminalContextProvider>;
  const mounted = render(tree(buffer));
  const view = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  return { file, buffer, view, target, replaceBuffer: async () => { const nextFile = { ...file, name: 'next.ts', relativePath: 'next.ts', ref: { ...file.ref, id: randomUUID() } }; const next = new FileBuffer(nextFile, { ...mocked.api, read: async () => ({ document: nextFile, base64: Buffer.from(text).toString('base64') }) } as never, () => undefined); await next.load(); disposers.push(() => next.dispose()); mounted.rerender(tree(next)); } };
}
describe('actual EditorView / file menu to visible reference tray', () => {
  it('captures exact UTF-16 range, previews/removes it and writes only on explicit insert', async () => {
    const f = await fixture(); act(() => f.view.dispatch({ selection: EditorSelection.single(6, f.view.state.doc.line(2).to) }));
    fireEvent.contextMenu(f.view.contentDOM, { clientX: 15, clientY: 20 }); fireEvent.click(await screen.findByRole('menuitem', { name: '添加所选内容到终端引用' }));
    const tray = await screen.findByRole('region', { name: '终端引用' }); expect(tray.textContent).toContain('context.ts:L2-2');
    fireEvent.click(screen.getByRole('checkbox', { name: '包含选中文本' })); fireEvent.click(screen.getByText('查看将插入的文本'));
    expect(tray.querySelector('pre')?.textContent).toBe('context.ts:L2\n    中文🙂 selected'); expect(mocked.api.terminalInsert).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '插入到终端输入' })); await waitFor(() => expect(mocked.api.terminalInsert).toHaveBeenCalledTimes(1));
    const input = mocked.api.terminalInsert.mock.calls[0][0]; expect(input.references[0]).toMatchObject({ kind: 'range', range: { startLine: 2, endLine: 2 }, text: '中文🙂 selected' }); expect(input.includeText).toBe(true);
    await screen.findByText('已插入终端输入，尚未提交'); expect(f.target.focus).toHaveBeenCalledOnce();
  });
  it('collects a whole file through its existing menu and clears with no terminal write', async () => {
    await fixture(); fireEvent.contextMenu(screen.getByRole('button', { name: 'File source' }), { clientX: 15, clientY: 20 }); fireEvent.click(await screen.findByRole('menuitem', { name: '添加到终端引用' }));
    await screen.findByRole('region', { name: '终端引用' }); fireEvent.click(screen.getByRole('button', { name: '清空' }));
    expect(screen.queryByRole('region', { name: '终端引用' })).toBeNull(); expect(mocked.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('disables selected-context actions while composition is still pending', async () => {
    const f = await fixture(); act(() => { f.view.dispatch({ selection: EditorSelection.single(6, f.view.state.doc.line(2).to) }); f.view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); });
    fireEvent.contextMenu(f.view.contentDOM, { clientX: 15, clientY: 20 }); const item = await screen.findByRole('menuitem', { name: '添加所选内容到终端引用' }); expect(item.getAttribute('aria-disabled')).toBe('true'); expect(mocked.api.open).not.toHaveBeenCalled();
  });
  it('does not attach a stale instruction dialog selection to a replacement EditorView', async () => {
    const f = await fixture(); act(() => f.view.dispatch({ selection: EditorSelection.single(6, f.view.state.doc.line(2).to) }));
    fireEvent.contextMenu(f.view.contentDOM, { clientX: 15, clientY: 20 }); fireEvent.click(await screen.findByRole('menuitem', { name: '让 CLI 修改所选代码…' }));
    await screen.findByRole('dialog'); fireEvent.change(screen.getByRole('textbox', { name: '所选代码的 CLI 指令' }), { target: { value: '只修改这段' } });
    await act(async () => { await f.replaceBuffer(); });
    const next = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!; act(() => next.dispatch({ selection: EditorSelection.single(6, next.state.doc.line(2).to) }));
    fireEvent.click(screen.getByRole('button', { name: '加入终端引用' })); await screen.findByText('选区内容已改变，请重新选择'); expect(mocked.api.open).not.toHaveBeenCalled(); expect(mocked.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('keeps the captured instruction range when native context-menu focus collapses the live caret', async () => {
    const f = await fixture(); act(() => f.view.dispatch({ selection: EditorSelection.single(6, f.view.state.doc.line(2).to) }));
    fireEvent.contextMenu(f.view.contentDOM, { clientX: 15, clientY: 20 });
    fireEvent.click(await screen.findByRole('menuitem', { name: '让 CLI 修改所选代码…' }));
    await screen.findByRole('dialog');
    // Native context-menu/focus handling can move the caret after the menu took
    // its snapshot; the dialog must keep the exact range it already displays.
    act(() => f.view.dispatch({ selection: EditorSelection.cursor(f.view.state.doc.length) }));
    fireEvent.change(screen.getByRole('textbox', { name: '所选代码的 CLI 指令' }), { target: { value: 'Explain this greeting.' } });
    fireEvent.click(screen.getByRole('button', { name: '加入终端引用' }));
    const tray = await screen.findByRole('region', { name: '终端引用' });
    fireEvent.click(screen.getByRole('checkbox', { name: '包含选中文本' }));
    expect(tray.querySelector('pre')?.textContent).toBe('context.ts:L2\n> Explain this greeting.\n    中文🙂 selected');
    expect(f.buffer.dirty).toBe(false); expect(mocked.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('rejects an instruction snapshot after the same editor document changes', async () => {
    const f = await fixture(); act(() => f.view.dispatch({ selection: EditorSelection.single(6, f.view.state.doc.line(2).to) }));
    fireEvent.contextMenu(f.view.contentDOM, { clientX: 15, clientY: 20 });
    fireEvent.click(await screen.findByRole('menuitem', { name: '让 CLI 修改所选代码…' }));
    await screen.findByRole('dialog');
    act(() => f.view.dispatch({ changes: { from: 6, to: f.view.state.doc.line(2).to, insert: 'replacement' } }));
    fireEvent.change(screen.getByRole('textbox', { name: '所选代码的 CLI 指令' }), { target: { value: 'Old selection instruction' } });
    fireEvent.click(screen.getByRole('button', { name: '加入终端引用' }));
    await screen.findByText('选区内容已改变，请重新选择');
    expect(mocked.api.open).not.toHaveBeenCalled(); expect(mocked.api.terminalInsert).not.toHaveBeenCalled();
  });
});
