// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { EditorView } from '@codemirror/view';
import { undoDepth } from '@codemirror/commands';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot, FileSaveInput, FileSaveReceipt } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { FileWorkspacePanel } from './workspace-panel';

const injected = vi.hoisted(() => ({ store: null as FileWorkspaceStore | null }));
// LSP is covered by its actual EditorView suite; this harness isolates tab focus.
vi.mock('./lsp/components', () => ({ FileLanguageProvider: ({ children }: { children: import('react').ReactNode }) => children, LanguageSettingsMenu: () => null, LanguageResults: () => null, LanguageEditorTools: () => null, useFileLanguage: () => null }));
// MCP resources are covered separately; preserve the real panel/editor under test.
vi.mock('./mcp/viewer', () => ({ McpViewerMenu: () => null, McpViewerSettings: () => null, McpViewerSlot: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('./workspace-store', async (original) => ({ ...await original<typeof import('./workspace-store')>(), fileWorkspaceFor: () => injected.store! }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'fixture', apps: [], preferredUnavailable: false })) } }, events: { on: vi.fn(() => () => undefined) } }));
// Keep real panel/tab controls, store and CodeMirror. Other viewers and syntax
// decoration are outside this focus test and never supply its focus behavior.
vi.mock('./code/editor', () => ({ codeHighlight: () => [] }));
vi.mock('./markdown/editor', () => ({ markdownEditor: () => [] }));
vi.mock('./git-metadata', () => ({ useGitStatus: () => ({ data: null, error: '', loading: false }), GitStatusMark: () => null, FileChanges: () => null }));
vi.mock('./office/pages-preview', () => ({ FileOfficePagesPreview: () => null }));
vi.mock('./office/preview', () => ({ FileOfficePreview: () => null }));
vi.mock('./pdf/preview', () => ({ FilePdfPreview: () => null }));
vi.mock('./notebook/preview', () => ({ FileNotebookPreview: () => null }));
vi.mock('./media/preview', () => ({ FileMediaPreview: () => null }));
vi.mock('./csv/preview', () => ({ FileCsvPreview: () => null }));
vi.mock('./html/preview', () => ({ FileHtmlPreview: () => null }));
vi.mock('./tex/preview', () => ({ FileTexPreview: () => null }));

const observations: unknown[] = [];
async function fixture(names = ['A.txt', 'B.txt', 'C.txt']) {
  const root: FileRoot = { source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', lease: randomUUID(), generation: 1, label: 'Fixture', identity: { device: '1', inode: '2' } }, documents = new Map<string, FileDocument>();
  const api = {
    roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []),
    open: vi.fn(async ({ relativePath }: { relativePath: string }) => {
      const file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, documentKey: `local:1:${relativePath}`, name: relativePath, relativePath, absolutePath: `/fixture/${relativePath}`, writable: true, revision: { device: '1', inode: relativePath, size: 5, hash: createHash('sha256').update('BASE\n').digest('hex'), modifiedNs: '1', changedNs: '1' } };
      documents.set(file.ref.id, file); return file;
    }),
    read: vi.fn(async ({ id }: { id: string }) => ({ document: documents.get(id)!, base64: Buffer.from('BASE\n').toString('base64') })),
    refresh: vi.fn(async ({ id }: { id: string }) => documents.get(id)!), drafts: vi.fn(async () => []),
    save: vi.fn(async (input: FileSaveInput): Promise<FileSaveReceipt> => ({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'failed', message: '文件为只读；本地修改仍保留' })),
    checkpoint: vi.fn(async (input: Parameters<FileClient['checkpoint']>[0]) => ({ draftId: input.draftId, bufferVersion: input.bufferVersion, hash: createHash('sha256').update(Buffer.from(input.base64, 'base64')).digest('hex') })),
    resolveDraft: vi.fn(async () => ({ resolved: true })),
    watch: vi.fn(async () => null), stopWatch: vi.fn(async () => undefined), closeDocument: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: randomUUID() }, api as unknown as FileClient, null, null); injected.store = store;
  await store.initialize(); for (const name of names) await store.open(root, name, true);
  const b = store.tabs[1], c = store.tabs[2]; store.activate(b.id);
  render(<><input aria-label="Outside workspace focus sentinel" /><FileWorkspacePanel scope={store.scope} onClose={() => undefined} /></>);
  const editor = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  return { store, api, b, c, editor };
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});

describe('M9-DEV-068 H23 failed mode-switch focus (real panel/editor, native API isolated)', () => {
  async function edited() {
    const f = await fixture(['A.txt', 'B.md', 'C.txt']);
    act(() => { f.editor.dispatch({ changes: { from: f.editor.state.doc.length, insert: 'Retained edit 中文🙂' }, userEvent: 'input.type' }); f.editor.focus(); });
    expect(f.b.buffer!.dirty).toBe(true); return f;
  }
  it('keeps pointer-initiated failed switching in the original editor, mode and selection', async () => {
    const f = await edited(), user = userEvent.setup(), state = f.b.buffer!.editor!, instance = f.b.buffer!.instance;
    const selection = state.selection.toJSON(), history = undoDepth(state);
    await user.click(screen.getByRole('button', { name: '查看源码' }));
    await waitFor(() => expect(f.b.buffer!.saveError).toContain('只读'));
    expect(f.editor.hasFocus).toBe(true); expect(f.b.buffer!.instance).toBe(instance); expect(f.b.buffer!.editor).toBe(f.editor.state);
    expect(EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)).toBe(f.editor);
    expect(f.editor.state.selection.toJSON()).toEqual(selection); expect(undoDepth(f.editor.state)).toBe(history); expect(f.b.buffer!.mode).toBe('document');
    expect(f.b.buffer!.raw).toBe('BASE\nRetained edit 中文🙂'); expect(document.querySelectorAll('.cm-editor')).toHaveLength(1);
    expect(f.b.buffer!.dirty).toBe(true); expect(f.api.save).toHaveBeenCalledTimes(1);
    expect(f.api.resolveDraft).not.toHaveBeenCalled(); expect(f.store.tabs[0].buffer!.raw).toBe('BASE\n');
    observations.push({ caseId: 'M9-T-H23', input: 'pointer', focus: 'original editor', unchangedBufferAndMode: true, dirty: true, error: f.b.buffer!.saveError });
  });
  it('does not steal a later user focus choice when the failed save replies', async () => {
    const f = await edited(), user = userEvent.setup(); let reply!: (value: FileSaveReceipt) => void;
    f.api.save.mockImplementationOnce(() => new Promise(resolve => { reply = resolve; }));
    await user.click(screen.getByRole('button', { name: '查看源码' })); await waitFor(() => expect(f.api.save).toHaveBeenCalledTimes(1));
    const outside = screen.getByRole('textbox', { name: 'Outside workspace focus sentinel' }); await user.click(outside);
    const input = f.api.save.mock.calls[0][0]; await act(async () => reply({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'failed', message: 'Delayed read-only failure' }));
    await waitFor(() => expect(f.b.buffer!.saveError).toContain('read-only')); expect(document.activeElement).toBe(outside); expect(f.b.buffer!.mode).toBe('document');
  });
  it('retains keyboard access and the explicit button focus on failed activation', async () => {
    const f = await edited(), user = userEvent.setup(), button = screen.getByRole('button', { name: '查看源码' });
    act(() => button.focus()); await user.keyboard('{Enter}'); await waitFor(() => expect(f.api.save).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(f.b.buffer!.saveError).toContain('只读')); expect(document.activeElement).toBe(button); expect(f.b.buffer!.mode).toBe('document');
  });
});
afterEach(() => { cleanup(); injected.store?.dispose(); injected.store = null; vi.unstubAllGlobals(); });
afterAll(() => {
  if (process.env.SMARTDD_M9_TAB_FOCUS_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_TAB_FOCUS_EVIDENCE, JSON.stringify({ observedAt: new Date().toISOString(), level: 'Real production workspace panel/store/CodeMirror in jsdom, user-event pointer/keyboard events; native API isolated, no actual terminal/native App.', observations }, null, 2) + '\n');
});

describe('M9-DEV-037 D08 non-active tab close focus', () => {
  it('keeps the active editor focus, selection and buffer while releasing the inactive tab', async () => {
    const f = await fixture(), user = userEvent.setup();
    act(() => { f.editor.dispatch({ selection: { anchor: 2 } }); f.editor.focus(); });
    expect(f.editor.hasFocus).toBe(true); const state = f.b.buffer!.editor, closedRef = f.c.buffer!.file.ref;
    await user.click(screen.getByRole('button', { name: '关闭 C.txt' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'C.txt' })).toBeNull());
    expect(f.store.active).toBe(f.b); expect(f.b.buffer!.editor).toBe(state); expect(f.editor.state.selection.main.head).toBe(2);
    expect(f.api.closeDocument).toHaveBeenCalledWith(closedRef); expect(f.editor.hasFocus).toBe(true);
    observations.push({ action: 'mouse close inactive C with B editor focus', active: f.store.active?.route.relativePath, focus: 'B editor', selection: f.editor.state.selection.main.head, raw: f.b.buffer!.raw, CReferenceReleased: true });
  });
  it('gives keyboard close a usable focus target on the still-active tab', async () => {
    const f = await fixture(), user = userEvent.setup(), close = screen.getByRole('button', { name: '关闭 C.txt' });
    act(() => close.focus()); await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'C.txt' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'B.txt' })));
    expect(f.store.active).toBe(f.b);
    observations.push({ action: 'keyboard Enter closes inactive C', active: 'B.txt', focus: 'B tab' });
  });
  it('does not steal focus from outside the workspace when closing inactive C with the mouse', async () => {
    const f = await fixture(), user = userEvent.setup(), outside = screen.getByRole('textbox', { name: 'Outside workspace focus sentinel' });
    act(() => outside.focus()); await user.click(screen.getByRole('button', { name: '关闭 C.txt' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'C.txt' })).toBeNull());
    expect(f.store.active).toBe(f.b); expect(document.activeElement).toBe(outside);
    observations.push({ action: 'mouse close inactive C with external focus', active: 'B.txt', externalFocusPreserved: true });
  });
  it('restores focus to the adjacent active tab when the previously focused editor was removed', async () => {
    const f = await fixture(), user = userEvent.setup();
    act(() => f.editor.focus()); await user.click(screen.getByRole('button', { name: '关闭 B.txt' }));
    await waitFor(() => expect(screen.queryByRole('tab', { name: 'B.txt' })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'C.txt' })));
    expect(f.store.active?.route.relativePath).toBe('C.txt');
    observations.push({ action: 'mouse closes focused active B', active: 'C.txt', focus: 'C tab' });
  });
});
