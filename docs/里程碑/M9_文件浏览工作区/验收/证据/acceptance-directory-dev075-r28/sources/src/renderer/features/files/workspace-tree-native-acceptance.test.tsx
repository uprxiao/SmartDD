// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
import { WorkspaceTree } from './workspace-tree';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'fixture', apps: [], preferredUnavailable: false })) } }, events: { on: vi.fn(() => () => undefined) } }));
const observations: unknown[] = [];
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
function fingerprint(path: string) { const s = statSync(path, { bigint: true }); return { sha256: hash(path), size: String(s.size), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; }
function Tree({ store }: { store: FileWorkspaceStore }) { useSyncExternalStore(store.subscribe, store.snapshot); return <WorkspaceTree store={store} run={work => { void work(); }} />; }

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TREE_FIXTURES || !process.env.SMARTDD_M9_FILE_BROKER)('B01/B04/B05/B18 production tree, store, FileService and packaged native broker', () => {
  let store: FileWorkspaceStore, service: FileService, broker: NativeFileBroker, userdata: string, project: string;
  let requests: { operation: string; relativePath: string }[], before: Record<string, ReturnType<typeof fingerprint>>;
  let gate: ReturnType<typeof deferred> | undefined, hold: { operation: string; relativePath: string } | undefined;
  beforeEach(async () => {
    const manifest = JSON.parse(readFileSync(process.env.SMARTDD_TREE_FIXTURES!, 'utf8')) as { root: string; files: { relativePath: string }[] };
    project = manifest.root; before = Object.fromEntries(manifest.files.map(row => [row.relativePath, fingerprint(join(project, row.relativePath))]));
    userdata = realpathSync(mkdtempSync('/private/tmp/willyou-tree-userdata-'));
    broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!); requests = []; gate = undefined; hold = undefined;
    const request = broker.request.bind(broker);
    broker.request = async <T,>(input: Record<string, unknown>, options?: BrokerOptions): Promise<T> => {
      const root = input.root as { path?: string } | undefined;
      if (root?.path === project) requests.push({ operation: String(input.operation), relativePath: String(input.relativePath ?? '') });
      const result = await request<T>(input, options);
      // Gate delivery after genuine native IO; never replace filesystem results.
      const held = hold;
      if (held && root?.path === project && input.operation === held.operation && input.relativePath === held.relativePath) await gate?.promise;
      return result;
    };
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'tree', path: project, label: 'Tree acceptance', projectId: 'tree' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
    const api = {
      roots: (scope: FileScope) => service.openScope('tree', scope), list: (input: PathRequest) => service.list('tree', input),
      open: (input: PathRequest) => service.open('tree', input), read: (ref: FileRef) => service.read('tree', ref), refresh: (ref: FileRef) => service.refresh('tree', ref),
      drafts: (ref: FileRef) => service.drafts('tree', ref), closeDocument: async (ref: FileRef) => service.closeDocument('tree', ref), closeScope: async (scope: FileScope) => service.closeScope('tree', scope),
    };
    store = new FileWorkspaceStore({ kind: 'project', projectId: 'tree' }, api as unknown as FileClient, null, null);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    await store.initialize(); render(<Tree store={store} />);
  });
  afterEach(async () => {
    cleanup(); gate?.resolve(); store?.dispose(); service?.closeOwner('tree'); await service?.watcher.dispose(); broker?.dispose(); vi.unstubAllGlobals();
    if (before) expect(Object.fromEntries(Object.keys(before).map(path => [path, fingerprint(join(project, path))]))).toEqual(before);
    rmSync(userdata, { recursive: true, force: true });
  });
  afterAll(() => { if (process.env.SMARTDD_TREE_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), level: 'I: production WorkspaceTree/Base UI + FileWorkspaceStore + FileService + packaged macOS native broker; jsdom component input, not native App A; optional delivery gate after actual native response.', broker: process.env.SMARTDD_M9_FILE_BROKER, brokerSha256: hash(process.env.SMARTDD_M9_FILE_BROKER!), observations }, null, 2) + '\n'); });
  const lists = () => requests.filter(row => row.operation === 'list').map(row => row.relativePath);

  it('B01 lists only root then levels one/two; pending requests and collapsed cache are reused', async () => {
    expect(lists()).toEqual(['']); expect(screen.queryByRole('treeitem', { name: 'level2' })).toBeNull();
    const user = userEvent.setup(); gate = deferred(); hold = { operation: 'list', relativePath: 'level1' };
    await user.click(screen.getByRole('treeitem', { name: 'level1' }));
    const first = store.list(store.treeRoot!, 'level1');
    expect(store.list(store.treeRoot!, 'level1')).toBe(first);
    // B01 coalesces duplicate requests while still expanded. Unconfirmed
    // collapse/reopen cancellation and inverse delivery belong to B02.
    expect(lists()).toEqual(['', 'level1']);
    await act(async () => { gate!.resolve(); await first; });
    await user.click(screen.getByRole('treeitem', { name: 'level2' }));
    await screen.findByRole('treeitem', { name: 'level3' });
    expect(lists()).toEqual(['', 'level1', 'level1/level2']); expect(screen.queryByRole('treeitem', { name: 'level4' })).toBeNull();
    await user.click(screen.getByRole('treeitem', { name: 'level1' })); await user.click(screen.getByRole('treeitem', { name: 'level1' }));
    expect(lists()).toEqual(['', 'level1', 'level1/level2']);
    expect(requests.every(row => row.operation === 'list')).toBe(true);
    observations.push({ caseId: 'M9-T-B01', requests, samePendingPromise: true, duplicateWhileExpandedCoalesced: true, resolvedCollapseCacheReused: true, deeperDirectoriesNotListed: true });
  });
  it('B04 ordinary native tree includes dotfiles, hidden child and node_modules child', async () => {
    for (const name of ['.env', '.gitignore', '.hidden', 'node_modules']) expect(screen.getByRole('treeitem', { name })).toBeTruthy();
    const user = userEvent.setup();
    for (const directory of ['.hidden', 'node_modules']) {
      await user.click(screen.getByRole('treeitem', { name: directory }));
      await waitFor(() => expect(store.directories.get(store.directoryKey(store.treeRoot!, directory))).toMatchObject({ state: 'ready', entries: [{ name: 'x', relativePath: `${directory}/x` }] }));
    }
    expect(screen.getAllByRole('treeitem', { name: 'x' })).toHaveLength(2);
    expect(lists()).toEqual(['', '.hidden', 'node_modules']);
    observations.push({ caseId: 'M9-T-B04', requests, includeHiddenEquivalent: 'No exclude filter in ordinary list; native enumerator returns dot entries, service only removes recovery identities.', visible: ['.env', '.gitignore', '.hidden/x', 'node_modules/x'] });
  });
  it('B05 real empty directory resolves to an explicit collapsible empty state', async () => {
    const user = userEvent.setup(), directory = screen.getByRole('treeitem', { name: 'empty' });
    const rootItems = screen.getAllByRole('treeitem').length;
    await user.click(directory); await screen.findByText('空目录', { exact: true });
    expect(directory.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('正在读取…')).toBeNull(); expect(screen.getAllByRole('treeitem')).toHaveLength(rootItems);
    expect(store.directories.get(store.directoryKey(store.treeRoot!, 'empty'))).toEqual({ state: 'ready', entries: [] });
    await user.click(directory); expect(directory.getAttribute('aria-expanded')).toBe('false'); expect(screen.queryByText('空目录', { exact: true })).toBeNull();
    expect(lists()).toEqual(['', 'empty']); observations.push({ caseId: 'M9-T-B05', requests, explicitEmpty: true, noFakeFileOrInfiniteSpinner: true, collapsible: true });
  });
  it('B18 real first single A preview, first double B pinned once, directory only toggles', async () => {
    const user = userEvent.setup();
    await user.click(screen.getByRole('treeitem', { name: 'A.txt' })); await waitFor(() => expect(store.active?.buffer?.loadState).toBe('ready'));
    expect(store.active?.pinned).toBe(false); expect(store.active?.buffer?.raw).toBe('Tree A baseline\n');
    gate = deferred(); hold = { operation: 'stat', relativePath: 'B.txt' };
    const node = screen.getByRole('treeitem', { name: 'B.txt' }), clicks: number[] = [];
    node.addEventListener('click', event => clicks.push((event as MouseEvent).detail));
    await user.dblClick(node);
    expect(store.tabs).toHaveLength(1); expect(store.active?.route.relativePath).toBe('B.txt'); expect(store.active?.pinned).toBe(true); expect(clicks).toEqual([1, 2]);
    await act(async () => { gate!.resolve(); }); await waitFor(() => expect(store.active?.buffer?.loadState).toBe('ready'));
    expect(store.active?.buffer?.raw).toBe('Tree B baseline\n');
    const id = store.activeId;
    await user.click(screen.getByRole('treeitem', { name: 'empty' })); await screen.findByText('空目录', { exact: true });
    await user.click(screen.getByRole('treeitem', { name: 'empty' }));
    expect(store.activeId).toBe(id); expect(store.tabs).toHaveLength(1); expect(store.active?.pinned).toBe(true);
    expect(requests.filter(row => row.operation === 'stat' && row.relativePath === 'B.txt')).toHaveLength(1);
    observations.push({ caseId: 'M9-T-B18', requests, clickDetails: clicks, previewAContent: 'Tree A baseline\n', pinnedBContent: store.active?.buffer?.raw, tabs: store.tabs.map(tab => ({ path: tab.route.relativePath, pinned: tab.pinned })), directoryDoesNotOpenOrChangeActive: true });
  });
});
