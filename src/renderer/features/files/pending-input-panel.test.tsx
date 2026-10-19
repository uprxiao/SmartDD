// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { EditorView } from '@codemirror/view';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { FileWorkspacePanel } from './workspace-panel';

const injected = vi.hoisted(() => ({ store: null as FileWorkspaceStore | null }));
// MCP resources are covered separately; preserve the real panel/editor under test.
vi.mock('./mcp/viewer', () => ({ McpViewerMenu: () => null, McpViewerSettings: () => null, McpViewerSlot: ({ children }: { children: import('react').ReactNode }) => children }));
vi.mock('./lsp/components', () => ({ FileLanguageProvider: ({ children }: { children: import('react').ReactNode }) => children, LanguageSettingsMenu: () => null, LanguageResults: () => null, LanguageEditorTools: () => null, useFileLanguage: () => null }));
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
async function fixture() {
  const root: FileRoot = { source: 'project-directory', sourceId: 'root', path: '/fixture', canonicalPath: '/fixture', lease: randomUUID(), generation: 1, label: 'Fixture', identity: { device: '1', inode: '2' } }, documents = new Map<string, FileDocument>();
  const api = {
    roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []),
    open: vi.fn(async ({ relativePath }: { relativePath: string }) => {
      const file: FileDocument = { ref: { id: randomUUID(), lease: root.lease, generation: 1 }, documentKey: `local:1:${relativePath}`, name: relativePath, relativePath, absolutePath: `/fixture/${relativePath}`, writable: true, revision: { device: '1', inode: relativePath, size: 5, hash: createHash('sha256').update('BASE\n').digest('hex'), modifiedNs: '1', changedNs: '1' } };
      documents.set(file.ref.id, file); return file;
    }),
    read: vi.fn(async ({ id }: { id: string }) => ({ document: documents.get(id)!, base64: Buffer.from('BASE\n').toString('base64') })),
    refresh: vi.fn(async ({ id }: { id: string }) => documents.get(id)!), drafts: vi.fn(async () => []),
    watch: vi.fn(async () => null), stopWatch: vi.fn(async () => undefined), closeDocument: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: randomUUID() }, api as unknown as FileClient, null, null); injected.store = store;
  await store.initialize(); for (const name of ['A.txt', 'B.txt', 'C.txt']) await store.open(root, name, true);
  const b = store.tabs[1], c = store.tabs[2]; store.activate(b.id);
  render(<><input aria-label="Outside workspace focus sentinel" /><FileWorkspacePanel scope={store.scope} onClose={() => undefined} /></>);
  const editor = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  return { store, api, b, c, editor };
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(() => { cleanup(); injected.store?.dispose(); injected.store = null; vi.unstubAllGlobals(); });
afterAll(() => {
  if (process.env.SMARTDD_PENDING_PANEL_EVIDENCE) writeFileSync(process.env.SMARTDD_PENDING_PANEL_EVIDENCE, JSON.stringify({ observedAt: new Date().toISOString(), level: 'Real production workspace panel/store/CodeMirror in jsdom, user-event pointer/keyboard events; native API isolated, no actual terminal/native App.', observations }, null, 2) + '\n');
});

describe('M9-DEV-041 interrupted input recovery UI', () => {
  it('disables save, retains a blocked close and recovers through the actual Undo toolbar', async () => {
    const f = await fixture(), user = userEvent.setup();
    act(() => {
      f.editor.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      f.editor.dispatch({ changes: { from: 0, to: 4, insert: '未确认候选' }, userEvent: 'input.type.compose' });
    });
    await user.click(screen.getByRole('tab', { name: 'C.txt' }));
    expect(f.b.buffer!.inputInterrupted).toBe(true);
    await user.click(screen.getByRole('tab', { name: 'B.txt未保存' }));
    expect(screen.getByRole('alert').textContent).toContain('输入已中断');
    act(() => screen.getByRole('button', { name: '文件菜单' }).focus()); await user.keyboard('{Enter}');
    expect((await screen.findByRole('menuitem', { name: '保存文件' })).getAttribute('aria-disabled')).toBe('true');
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: '关闭 B.txt' }));
    expect(await screen.findByRole('dialog')).toBeTruthy(); expect(f.store.tabs).toContain(f.b); expect(f.b.buffer!.raw).toBe('未确认候选\n');
    expect(f.api.closeDocument).not.toHaveBeenCalledWith(f.b.buffer!.file.ref);
    await user.click(screen.getByRole('button', { name: '继续查看' }));
    await user.click(screen.getByRole('button', { name: '撤销' }));
    expect(f.b.buffer!.raw).toBe('BASE\n'); expect(f.b.buffer!.inputInterrupted).toBe(false); expect(f.b.buffer!.dirty).toBe(false);
    expect(screen.queryByText('输入已中断，请返回编辑器继续输入或撤销后再保存')).toBeNull();
    observations.push({ case: 'M9-T-H06', saveDisabled: true, closeBlockedRetainsBuffer: true, undoRestoresBase: true, boundary: 'Actual panel/store/buffer/EditorView in jsdom; only native file API mocked here; synthetic DOM composition, not App/system IME' });
  });
});
