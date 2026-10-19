// @vitest-environment jsdom
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { useSyncExternalStore } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import type { FileRef, FileScope, PathRequest } from '@shared/files';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
import { WorkspaceTree } from './workspace-tree';

vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: { applications: vi.fn(async () => ({ id: 'cache', apps: [], preferredUnavailable: false })) } }, events: { on: vi.fn(() => () => undefined) } }));
const observations: unknown[] = [];
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function fingerprint(path: string) { const s = statSync(path, { bigint: true }); return { sha256: sha(readFileSync(path)), inode: String(s.ino), mtimeNs: String(s.mtimeNs) }; }
function Tree({ store }: { store: FileWorkspaceStore }) { useSyncExternalStore(store.subscribe, store.snapshot); return <WorkspaceTree store={store} run={work => { void work(); }} />; }

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('B19 real native directory cache and forced refresh', () => {
  let base: string, project: string, broker: NativeFileBroker, service: FileService, store: FileWorkspaceStore;
  let lists: { path: string; at: number; outcome?: string }[], before: ReturnType<typeof fingerprint>;
  beforeEach(async () => {
    base = realpathSync(mkdtempSync('/private/tmp/willyou-tree-cache-native-')); project = join(base, 'project');
    for (const p of [project, join(base, 'userdata'), join(project, 'cache'), join(project, 'restricted')]) mkdirSync(p);
    writeFileSync(join(project, 'cache/old.txt'), 'Old external file\n'); writeFileSync(join(project, 'restricted/child.txt'), 'Permission retry file\n');
    writeFileSync(join(project, 'stable.txt'), 'Unchanged cache sentinel 中文🙂\n'); before = fingerprint(join(project, 'stable.txt'));
    broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!); lists = [];
    const request = broker.request.bind(broker);
    broker.request = async <T,>(input: Record<string, unknown>, options?: BrokerOptions): Promise<T> => {
      // Recovery journal discovery also lists its own private root. Account
      // only the source root under test, as in the other native tree probes.
      if (input.operation !== 'list' || (input.root as { path?: string } | undefined)?.path !== project) return request<T>(input, options);
      const row = { path: String(input.relativePath), at: performance.now(), outcome: 'pending' }; lists.push(row);
      try { const result = await request<T>(input, options); row.outcome = 'ready'; return result; }
      catch (error) { row.outcome = String(error); throw error; }
    };
    const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'cache-root', path: project, label: 'B19 native cache', projectId: 'cache' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(base, 'userdata'), resolver));
    const api = {
      roots: (scope: FileScope) => service.openScope('cache', scope), list: (input: PathRequest) => service.list('cache', input),
      open: (input: PathRequest) => service.open('cache', input), read: (ref: FileRef) => service.read('cache', ref), refresh: (ref: FileRef) => service.refresh('cache', ref),
      drafts: (ref: FileRef) => service.drafts('cache', ref), closeDocument: async (ref: FileRef) => service.closeDocument('cache', ref), closeScope: async (scope: FileScope) => service.closeScope('cache', scope),
    };
    store = new FileWorkspaceStore({ kind: 'project', projectId: 'cache' }, api as unknown as FileClient, null, null);
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    await store.initialize(); render(<Tree store={store} />);
  });
  afterEach(async () => {
    cleanup(); store?.dispose(); service?.closeOwner('cache'); await service?.watcher.dispose(); broker?.dispose(); vi.unstubAllGlobals();
    if (base) { expect(fingerprint(join(project, 'stable.txt'))).toEqual(before); chmodSync(join(project, 'restricted'), 0o755); rmSync(base, { recursive: true, force: true }); }
  });
  afterAll(() => { if (process.env.SMARTDD_TREE_CACHE_EVIDENCE) writeFileSync(process.env.SMARTDD_TREE_CACHE_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), caseId: 'M9-T-B19', layer: 'I: production React tree/store/service + packaged native broker, passive native list accounting; jsdom geometry. Watch not attached so explicit stale-cache invalidation is deterministic. No PTY or model; actual task states are tested separately in App A.', broker: process.env.SMARTDD_M9_FILE_BROKER, observations }, null, 2) + '\n'); });

  it('reuses confirmed directory results before and after five real seconds; explicit refresh reads current names', async () => {
    const user = userEvent.setup(), directory = () => screen.getByRole('treeitem', { name: 'cache' });
    await user.click(directory()); await screen.findByRole('treeitem', { name: 'old.txt' });
    const initial = [...lists]; expect(initial.map(x => x.path)).toEqual(['', 'cache']);
    const first = performance.now(); await user.click(directory()); await user.click(directory());
    await screen.findByRole('treeitem', { name: 'old.txt' }); const immediateMs = performance.now() - first;
    expect(immediateMs).toBeLessThan(5000); expect(lists).toEqual(initial);
    await user.click(directory()); const start = performance.now(); await delay(5100); await user.click(directory());
    await screen.findByRole('treeitem', { name: 'old.txt' }); const afterFiveMs = performance.now() - start;
    expect(afterFiveMs).toBeGreaterThanOrEqual(5000); expect(lists).toEqual(initial);
    writeFileSync(join(project, 'cache/new.txt'), 'Explicit external addition\n'); unlinkSync(join(project, 'cache/old.txt'));
    expect(screen.getByRole('treeitem', { name: 'old.txt' })).toBeTruthy(); expect(screen.queryByRole('treeitem', { name: 'new.txt' })).toBeNull();
    await act(async () => { await store.refresh(); }); await screen.findByRole('treeitem', { name: 'new.txt' });
    expect(screen.queryByRole('treeitem', { name: 'old.txt' })).toBeNull(); expect(screen.getAllByRole('treeitem', { name: 'new.txt' })).toHaveLength(1);
    expect(lists.map(x => x.path)).toEqual(['', 'cache', '', 'cache']);
    observations.push({ scenario: 'confirmed cache and explicit refresh', immediateMs, afterFiveMs, lists, confirmedCachePreservedAcrossCollapse: true, staleRowsBeforeRefresh: ['cache/old.txt'], refreshedRows: ['cache/new.txt'], stableUnchanged: fingerprint(join(project, 'stable.txt')) });
  }, 15000);

  it('does not convert a native directory error to cached empty; actual retry rereads restored permissions', async () => {
    const user = userEvent.setup(); chmodSync(join(project, 'restricted'), 0o000);
    await user.click(screen.getByRole('treeitem', { name: 'restricted' })); const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('读取失败'); expect(screen.queryByText('空目录', { exact: true })).toBeNull();
    expect(store.directories.get(store.directoryKey(store.treeRoot!, 'restricted'))?.state).toBe('error');
    const failure = { text: alert.textContent, title: alert.getAttribute('title') }; chmodSync(join(project, 'restricted'), 0o755);
    await user.click(screen.getByRole('button', { name: '重试' })); await screen.findByRole('treeitem', { name: 'child.txt' });
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull()); expect(screen.getAllByRole('treeitem', { name: 'child.txt' })).toHaveLength(1);
    expect(lists.map(x => x.path)).toEqual(['', 'restricted', 'restricted']); expect(lists[1].outcome).not.toBe('ready'); expect(lists[2].outcome).toBe('ready');
    expect(readFileSync(join(project, 'restricted/child.txt'), 'utf8')).toBe('Permission retry file\n');
    observations.push({ scenario: 'native error and explicit retry', failure, lists, state: store.directories.get(store.directoryKey(store.treeRoot!, 'restricted')) });
  });
});
