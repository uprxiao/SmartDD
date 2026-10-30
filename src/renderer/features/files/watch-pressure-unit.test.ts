import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SubscribeCallback } from '@parcel/watcher';
import { FileWatchService } from '@main/core/files/watch-service';
import type { NativeFileBroker } from '@main/core/files/native-broker';
import type { FileRecoveryStore } from '@main/core/files/recovery-store';
import type { FileRootsService, RootLease } from '@main/core/files/roots';
import type { FileWatchUpdate } from '@shared/files';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
const listeners = vi.hoisted(() => new Set<(value: FileWatchUpdate) => void>());
vi.mock('@parcel/watcher', () => ({ subscribe: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: (_name: unknown, fn: (value: FileWatchUpdate) => void) => { listeners.add(fn); return () => listeners.delete(fn); } } }));
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.useRealTimers(); expect(listeners.size).toBe(0); });
function lease(generation = 1): RootLease {
  return { lease: randomUUID(), generation, source: 'project-directory', sourceId: 'unit-root', label: 'Unit root', path: '/unit', canonicalPath: '/unit', identity: { device: '1', inode: '2' }, owner: 'owner', scope: { kind: 'project', projectId: 'unit' }, projectId: 'unit', sourcePath: '/unit', descriptor: { path: '/unit', identity: { device: '1', inode: '2' } }, abort: new AbortController() };
}
function watcherFixture() {
  vi.useFakeTimers(); const root = lease(), updates: FileWatchUpdate[] = [], callbacks: SubscribeCallback[] = [], stopped = vi.fn(); let content = 'BASE';
  const request = vi.fn(async (input: Record<string, unknown>) => input.operation === 'list' ? { entries: [{ name: content }] } : { hash: content });
  const watcher = new FileWatchService({ require: () => root, observeFailure: async () => false } as unknown as FileRootsService, { request } as unknown as NativeFileBroker, { protectedIdentities: () => [] } as unknown as FileRecoveryStore, async (_path, callback) => { callbacks.push(callback); return { unsubscribe: async () => { stopped(); } }; });
  cleanup.push(() => watcher.dispose()); watcher.start('owner', root, [''], ['a.txt'], update => updates.push(update));
  return { watcher, updates, request, callbacks, stopped, change: () => { content = 'FINAL'; } };
}
describe('L05/L08 invalidation pressure and reconnect guards', () => {
  it('L05 coalesces ten thousand invalidation hints into one bounded fresh snapshot and declares resync', async () => {
    const f = watcherFixture(); await vi.advanceTimersByTimeAsync(0); expect(f.request).toHaveBeenCalledTimes(2); f.change();
    f.callbacks[0](null, Array.from({ length: 10000 }, () => ({ path: '/unit/a.txt', type: 'update' as const })));
    expect(f.updates.at(-1)).toMatchObject({ coverage: 'poll', resyncRequired: true }); expect(f.updates.at(-1)!.message).toContain('事件较多');
    await vi.advanceTimersByTimeAsync(0); expect(f.request).toHaveBeenCalledTimes(4); await vi.advanceTimersByTimeAsync(99); expect(f.request).toHaveBeenCalledTimes(4);
    expect(f.updates.at(-1)).toMatchObject({ changed: true, resyncRequired: false }); await f.watcher.dispose(); expect(f.watcher.resourceCounts).toEqual({ roots: 0, consumers: 0, timers: 0, stopping: 0 });
  });
  it('L08 advertises polling after a callback error, preserves snapshot truth and retries native only after backoff', async () => {
    const f = watcherFixture(); await vi.advanceTimersByTimeAsync(0); f.callbacks[0](new Error('explicit unit disconnect'), []); f.change();
    expect(f.updates.at(-1)).toMatchObject({ coverage: 'poll', resyncRequired: true }); expect(f.updates.at(-1)!.message).toContain('原生监听不可用');
    await vi.advanceTimersByTimeAsync(0); expect(f.updates.some(update => update.coverage === 'poll' && update.changed)).toBe(true); expect(f.stopped).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29999); expect(f.callbacks).toHaveLength(1); await vi.advanceTimersByTimeAsync(2001); expect(f.callbacks).toHaveLength(2);
    expect(f.updates.some(update => update.coverage === 'native' && update.resyncRequired && !update.message)).toBe(true); const count = f.updates.length; f.callbacks[0](new Error('late previous native generation'), []); expect(f.updates).toHaveLength(count); expect(f.stopped).toHaveBeenCalledTimes(1); await f.watcher.dispose(); expect(f.stopped).toHaveBeenCalledTimes(2);
  });
  it('L08 a fresh store ignores old lease/watch delivery but accepts a genuine current membership refresh', async () => {
    const old = lease(), root = lease(3), id = randomUUID(), api = { roots: vi.fn(async () => ({ roots: [root], unavailable: [] })), list: vi.fn(async () => []), watch: vi.fn(async () => ({ id, lease: root.lease, generation: root.generation, sequence: 1, coverage: 'native' as const, resyncRequired: true, changed: false })), stopWatch: vi.fn(async () => undefined), closeScope: vi.fn(async () => undefined) };
    const store = new FileWorkspaceStore(root.scope, api as unknown as FileClient, null, null); cleanup.push(async () => store.dispose()); await store.initialize(); const leave = store.attach();
    for (let i = 0; i < 20; i++) await Promise.resolve(); const before = api.list.mock.calls.length;
    for (const fn of listeners) fn({ id: randomUUID(), lease: old.lease, generation: old.generation, sequence: 9999, coverage: 'none', resyncRequired: true, changed: true, message: 'old offline generation' });
    expect(api.list).toHaveBeenCalledTimes(before); expect(store.watchStates.get(root.lease)).toMatchObject({ coverage: 'native', sequence: 1 });
    for (const fn of listeners) fn({ id, lease: root.lease, generation: root.generation, sequence: 2, coverage: 'native', resyncRequired: true, changed: true });
    for (let i = 0; i < 20; i++) await Promise.resolve(); expect(api.list.mock.calls.length).toBeGreaterThan(before); leave();
  });
});
