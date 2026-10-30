// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'fixture', apps: [] })) } } }));
const rows: unknown[] = [], dispose: (() => Promise<void>)[] = [];
afterEach(async () => { vi.useRealTimers(); cleanup(); for (const fn of dispose.splice(0)) await fn(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.WILLYOU_TREE_TOOLTIP_EVIDENCE) writeFileSync(process.env.WILLYOU_TREE_TOOLTIP_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), layer: 'I', boundary: 'Original native broker/FileService/tree store and actual WorkspaceTree. jsdom geometry and exact timer are controlled; pointer input here is component input, separately tested in real App.', rows }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('N13 tooltip follows actual native directory model', () => {
  it('uses real canonical file paths, closes on native model refresh, and never opens or writes the source', async () => {
    const base = realpathSync(mkdtempSync('/private/tmp/willyou-tree-tooltip-I-')), rootPath = join(base, 'root'), userData = join(base, 'userdata'); mkdirSync(rootPath); mkdirSync(userData);
    const name = '独立路径🙂.md', path = join(rootPath, name); writeFileSync(path, 'N13 source stays unchanged\r\n');
    const fingerprint = () => { const s = statSync(path, { bigint: true }); return { sha256: createHash('sha256').update(readFileSync(path)).digest('hex'), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; }, before = fingerprint();
    const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!), operations: string[] = [], original = broker.request.bind(broker);
    broker.request = async (input, options) => { operations.push(String(input.operation)); return original(input, options); };
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: rootPath, label: 'N13 fixture', projectId: 'tooltip' }] };
    const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userData, resolver));
    const api = { roots: (scope: FileScope) => service.openScope('tooltip', scope), list: (input: PathRequest) => service.list('tooltip', input), open: (input: PathRequest) => service.open('tooltip', input), read: (ref: FileRef) => service.read('tooltip', ref), drafts: (ref: FileRef) => service.drafts('tooltip', ref), closeDocument: async (ref: FileRef) => service.closeDocument('tooltip', ref), closeScope: async (scope: FileScope) => service.closeScope('tooltip', scope) };
    const store = new FileWorkspaceStore({ kind: 'project', projectId: 'tooltip' }, api as unknown as FileClient, null, null);
    dispose.push(async () => { store.dispose(); service.closeOwner('tooltip'); await service.watcher.dispose(); broker.dispose(); rmSync(base, { recursive: true, force: true }); });
    await store.initialize(); vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
    function View() { useSyncExternalStore(store.subscribe, store.snapshot); return <WorkspaceTree store={store} run={f => { void f(); }} />; }
    vi.stubGlobal('PointerEvent', class extends MouseEvent { readonly pointerType = 'mouse'; });
    render(<View />); const file = screen.getByRole('treeitem', { name }); expect(file.getAttribute('data-file-path')).toBe(path); expect(file.hasAttribute('title')).toBe(false);
    vi.useFakeTimers(); fireEvent.pointerEnter(file); expect(vi.getTimerCount()).toBeGreaterThan(0); act(() => { vi.advanceTimersByTime(499); }); expect(screen.queryByRole('tooltip')).toBeNull(); act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByRole('tooltip').textContent).toBe(path); expect(file.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    expect(operations.some(op => ['open', 'save', 'write', 'rename', 'remove'].includes(op))).toBe(false);
    vi.useRealTimers(); await act(async () => { await store.open(store.treeRoot!, name); });
    // Loading a file changes the workspace revision, but not the tree model.
    // Its genuine native read must not consume an already visible path tip.
    expect(store.active?.buffer?.loadState).toBe('ready'); expect(screen.getByRole('tooltip').textContent).toBe(path);
    await act(async () => { await store.list(store.treeRoot!, '', true); }); expect(screen.queryByRole('tooltip')).toBeNull();
    expect(operations.some(op => ['save', 'write', 'rename', 'remove'].includes(op))).toBe(false); expect(fingerprint()).toEqual(before);
    rows.push({ caseId: 'M9-T-N13', path, opensAtMs: 500, absentAtMs: 499, originalNativeOperations: operations, hoverOpensNothing: true, unrelatedFileLoadKeptTooltip: true, modelRefreshClosed: true, sourceBefore: before, sourceAfter: fingerprint() });
  });
});
