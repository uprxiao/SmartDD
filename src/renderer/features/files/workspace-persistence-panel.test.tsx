// @vitest-environment jsdom
import { createHash, randomUUID } from 'node:crypto';
import { EditorView } from '@codemirror/view';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import type { SavedFileWorkspace, WorkspaceUpdate, WorkspacePersistence } from '@shared/file-workspace';
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
  const scope = { kind: 'project' as const, projectId: randomUUID() };
  let saved: SavedFileWorkspace | null = null, revision = 0, listener: ((event: WorkspaceUpdate) => void) | null = null;
  const persistence: WorkspacePersistence = { load: async () => saved, snapshot: async () => ({ state: saved, revision }),
    commit: vi.fn(async (_scope, state, expectedRevision) => {
      if (expectedRevision !== revision) return { state: saved, revision, accepted: false };
      saved = structuredClone(state); return { state: saved, revision: ++revision, accepted: true };
    }), subscribe: callback => { listener = callback; return () => { listener = null; }; } };
  const store = new FileWorkspaceStore(scope, api as unknown as FileClient, null, persistence); injected.store = store;
  await store.initialize(); for (const name of ['A.txt', 'B.txt', 'C.txt']) await store.open(root, name, true);
  const b = store.tabs[1], c = store.tabs[2]; store.activate(b.id); await store.flushPersistence();
  render(<><input aria-label="Outside workspace focus sentinel" /><FileWorkspacePanel scope={store.scope} onClose={() => undefined} /></>);
  const editor = EditorView.findFromDOM(document.querySelector('.cm-editor') as HTMLElement)!;
  const external = () => {
    saved = { ...saved!, routes: saved!.routes.filter(route => route.relativePath !== 'B.txt'), treeWidth: 410 };
    listener?.({ scope, state: structuredClone(saved), revision: ++revision, mutationId: randomUUID() });
  };
  return { store, api, b, c, editor, external, persistence, saved: () => saved };
}
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Object.defineProperties(Range.prototype, { getClientRects: { configurable: true, value: () => [] }, getBoundingClientRect: { configurable: true, value: () => new DOMRect() } });
});
afterEach(() => { cleanup(); injected.store?.dispose(); injected.store = null; vi.unstubAllGlobals(); });

describe('M9-DEV-036 visible persistence conflict actions', () => {
  it('shows explicit layout overwrite and reread actions; a clean reread adopts latest routes', async () => {
    const f = await fixture(), user = userEvent.setup();
    act(() => f.external());
    expect(screen.getByRole('alert').textContent).toContain('当前标签、选择与草稿已保留');
    expect(screen.getByRole('button', { name: '保存当前窗口标签' })).toBeDefined();
    expect((screen.getByRole('button', { name: '读取最新标签' }) as HTMLButtonElement).disabled).toBe(false);
    await user.click(screen.getByRole('button', { name: '读取最新标签' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '读取最新标签' })).toBeNull());
    expect(f.store.tabs.map(tab => tab.route.relativePath)).toEqual(['A.txt', 'C.txt']);
    expect(f.store.treeWidth).toBe(410);
  });
  it('disables reread while dirty and explicit layout save retains the editor bytes and dirty state', async () => {
    const f = await fixture(), user = userEvent.setup(), buffer = f.b.buffer!;
    act(() => { f.editor.dispatch({ changes: { from: 0, insert: 'LOCAL ' } }); f.external(); });
    expect((screen.getByRole('button', { name: '读取最新标签' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: '保存当前窗口标签' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '保存当前窗口标签' })).toBeNull());
    expect(f.store.active?.buffer).toBe(buffer); expect(buffer.raw).toBe('LOCAL BASE\n'); expect(buffer.dirty).toBe(true);
    expect(f.saved()?.routes.map(route => route.relativePath)).toEqual(['A.txt', 'B.txt', 'C.txt']);
  });
});
