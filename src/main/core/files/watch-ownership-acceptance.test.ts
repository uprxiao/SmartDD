import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { AsyncSubscription, SubscribeCallback } from '@parcel/watcher';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot, FileWatchUpdate } from '@shared/files';
import { fileWatchEvent } from '@shared/events';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { FileService } from './file-service';
import { FileRootsService } from './roots';
import { FileRecoveryStore } from './recovery-store';
import { NativeFileBroker } from './native-broker';
import { createFileController } from './controller';

const bridge = vi.hoisted(() => ({ subscribe: null as null | ((path: string, callback: SubscribeCallback) => Promise<AsyncSubscription>) }));
// Only the public native-subscribe boundary is injectable. FileService,
// FileWatchService, owner checks, snapshots and native IO are production code.
vi.mock('@parcel/watcher', () => ({ subscribe: (path: string, callback: SubscribeCallback) => bridge.subscribe!(path, callback) }));
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const output: Record<string, unknown> = { cases: ['M9-T-L03', 'M9-T-L04'], startedAt: new Date().toISOString(), runs: [] };
const until = async (condition: () => boolean) => {
  const deadline = Date.now() + 6000;
  while (!condition()) { if (Date.now() >= deadline) throw new Error('Expected actual native event/snapshot did not arrive'); await new Promise(resolve => setTimeout(resolve, 20)); }
};
let fixture: string, broker: NativeFileBroker, service: FileService;
let nativeSubscribe: (path: string, callback: SubscribeCallback, options: { backend: 'fs-events' }) => Promise<AsyncSubscription>;
let nativeEvents: { generation: number; path: string; events: { type: string; path: string }[]; error: string | null }[];
let generations: number, unsubscribed: number[], callbacks: Map<number, SubscribeCallback>;
let rejectPendingForCleanup: (() => void) | null = null;
const connectNative = async (path: string, callback: SubscribeCallback) => {
  const generation = ++generations; callbacks.set(generation, callback);
  const subscription = await nativeSubscribe(path, (error, events) => {
    nativeEvents.push({ generation, path, error: error?.message ?? null, events: events.map(event => ({ type: event.type, path: event.path })) });
    callback(error, events);
  }, { backend: 'fs-events' });
  return { unsubscribe: async () => { unsubscribed.push(generation); await subscription.unsubscribe(); } };
};
const zeroResources = { roots: 0, consumers: 0, timers: 0, stopping: 0 };

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_WATCH_ACCEPTANCE_APP)('M9 L03/L04 production watch owner boundary with packaged native resources', () => {
  beforeEach(() => {
    const resources = join(process.env.SMARTDD_WATCH_ACCEPTANCE_APP!, 'Contents/Resources');
    const packagedRequire = createRequire(join(resources, 'app.asar/package.json'));
    nativeSubscribe = packagedRequire('@parcel/watcher').subscribe;
    const originalFs = packagedRequire('original-fs') as typeof import('node:fs');
    output.resources = { package: process.env.SMARTDD_WATCH_ACCEPTANCE_APP, asarSha256: sha(originalFs.readFileSync(join(resources, 'app.asar'))), brokerSha256: sha(readFileSync(join(resources, 'native/willyou-files'))), watcherVersion: packagedRequire('@parcel/watcher/package.json').version, watcherBinding: Object.keys(packagedRequire.cache).filter(path => path.includes('watcher') && path.endsWith('.node')).map(path => ({ path, sha256: sha(readFileSync(path)) })) };
    fixture = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-watch-owner-')));
    for (const name of ['one', 'two', 'userdata']) mkdirSync(join(fixture, name));
    writeFileSync(join(fixture, 'one/value.txt'), 'ONE BASE'); writeFileSync(join(fixture, 'two/value.txt'), 'TWO BASE');
    broker = new NativeFileBroker(join(resources, 'native/willyou-files'));
    const resolver = { sources: (scope: { kind: string; projectId?: string }) => [{ kind: 'project-directory' as const, id: `source-${scope.projectId}`, path: join(fixture, scope.projectId === 'two' ? 'two' : 'one'), label: 'Synthetic watch root', projectId: scope.projectId ?? 'one' }] };
    service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, join(fixture, 'userdata'), resolver));
    nativeEvents = []; generations = 0; unsubscribed = []; callbacks = new Map(); bridge.subscribe = connectNative; rejectPendingForCleanup = null;
  });
  afterEach(async () => { rejectPendingForCleanup?.(); if (service) { await service.watcher.dispose(); service.closeOwner('one'); service.closeOwner('two'); } broker?.dispose(); if (fixture) rmSync(fixture, { recursive: true, force: true }); });

  it.each(['late callback error', 'late subscribe rejection'] as const)('L03: the replacement survives %s and receives a real filesystem event', async (failure) => {
    const root = (await service.openScope('one', { kind: 'project', projectId: 'one' })).roots[0];
    const doc = await service.open('one', { lease: root.lease, generation: root.generation, relativePath: 'value.txt' });
    const before: FileWatchUpdate[] = [], current: FileWatchUpdate[] = [];
    const record: Record<string, unknown> = { case: 'M9-T-L03', failure, oldUpdates: before, currentUpdates: current, nativeEvents, pass: false };
    (output.runs as unknown[]).push(record);
    let rejectOld!: (error: Error) => void;
    if (failure === 'late subscribe rejection') {
      let first = true;
      bridge.subscribe = (path, callback) => { if (first) { first = false; return new Promise((_resolve, reject) => { rejectOld = reject; rejectPendingForCleanup = () => reject(new Error('test cleanup of undelivered subscribe failure')); }); } return connectNative(path, callback); };
    }
    const old = await service.watch('one', root, [''], [doc.ref], event => before.push(event));
    if (failure === 'late callback error') await until(() => before.some(event => event.coverage === 'native' && !event.resyncRequired));
    service.watcher.stop('one', old!.id);
    const replacement = await service.watch('one', root, [''], [doc.ref], event => current.push(event));
    await until(() => current.some(event => event.coverage === 'native' && !event.resyncRequired));
    const currentGeneration = generations, countBefore = before.length, currentMarker = current.length;
    // The error is intentionally delayed at the public subscription callback /
    // promise boundary. The subsequent changed event must come from macOS.
    if (failure === 'late callback error') callbacks.get(1)!(new Error('delayed watch1 failure'), []);
    else rejectOld(new Error('delayed watch1 start failure'));
    await Promise.resolve(); await Promise.resolve();
    expect(service.watcher.resourceCounts.roots).toBe(1); expect(service.watcher.resourceCounts.consumers).toBe(1);
    expect(current.slice(currentMarker).some(event => event.coverage === 'poll' || event.coverage === 'none')).toBe(false);
    const next = `watch2 survived ${failure}`; writeFileSync(join(fixture, 'one/value.txt'), next);
    await until(() => nativeEvents.some(event => event.generation === currentGeneration && event.events.some(change => change.path === join(fixture, 'one/value.txt'))) && current.slice(currentMarker).some(event => event.changed && event.coverage === 'native'));
    expect(before).toHaveLength(countBefore); expect(current.every(event => event.id === replacement!.id)).toBe(true);
    expect(Buffer.from((await service.read('one', doc.ref)).base64, 'base64').toString()).toBe(next);
    expect(unsubscribed).not.toContain(currentGeneration);
    service.watcher.stop('one', replacement!.id); await service.watcher.dispose(); expect(service.watcher.resourceCounts).toEqual(zeroResources);
    Object.assign(record, { oldId: old!.id, replacementId: replacement!.id, currentGeneration, oldConsumerReceivedLateEvents: before.length !== countBefore, unsubscribed, finalResources: service.watcher.resourceCounts, finalText: next, pass: true });
  }, 20_000);

  it('L04: real native changes stay with the authenticated IPC owner, and forged IDs cannot read/reconfigure/stop another watch', async () => {
    type Sender = EventEmitter & { id: number; mainFrame: { processId: number; routingId: number }; isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> };
    const sender = (id: number): Sender => Object.assign(new EventEmitter(), { id, mainFrame: { processId: 100 + id, routingId: 200 + id }, isDestroyed: () => false, send: vi.fn() });
    const w1 = sender(1), w2 = sender(2), event = (s: Sender) => ({ sender: s, senderFrame: s.mainFrame }) as unknown as IpcMainInvokeEvent;
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    registerRPCRouter({ files: createFileController(service, e => e.sender === (w1 as unknown) || e.sender === (w2 as unknown)) }, { handle: (name: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, fn) } as unknown as IpcMain);
    const invoke = (s: Sender, method: string, ...args: unknown[]) => handlers.get(`files.${method}`)!(event(s), ...args);
    const root1 = (await invoke(w1, 'roots', { kind: 'project', projectId: 'one' }) as { roots: FileRoot[] }).roots[0];
    const root2 = (await invoke(w2, 'roots', { kind: 'project', projectId: 'two' }) as { roots: FileRoot[] }).roots[0];
    const doc1 = await invoke(w1, 'open', { lease: root1.lease, generation: root1.generation, relativePath: 'value.txt' }) as FileDocument, doc2 = await invoke(w2, 'open', { lease: root2.lease, generation: root2.generation, relativePath: 'value.txt' }) as FileDocument;
    const watch1 = await invoke(w1, 'watch', root1, [''], [doc1.ref]) as FileWatchUpdate, watch2 = await invoke(w2, 'watch', root2, [''], [doc2.ref]) as FileWatchUpdate;
    const updates = (s: Sender): FileWatchUpdate[] => s.send.mock.calls.filter(([channel]) => channel === fileWatchEvent.name).map(([, update]) => update as FileWatchUpdate);
    await until(() => updates(w1).some(u => u.coverage === 'native' && !u.resyncRequired) && updates(w2).some(u => u.coverage === 'native' && !u.resyncRequired));
    await expect(invoke(w2, 'watch', root2, [''], [doc2.ref], watch1.id)).rejects.toThrow('UNTRUSTED');
    await expect(invoke(w1, 'watch', root1, [''], [doc1.ref], watch2.id)).rejects.toThrow('UNTRUSTED');
    await expect(invoke(w2, 'watch', { ...root1, owner: '1:101:201' }, [''], [], watch1.id)).rejects.toThrow('UNTRUSTED');
    await expect(invoke(w2, 'watch', root2, [''], [doc1.ref])).rejects.toThrow('UNTRUSTED');
    await expect(invoke(w2, 'read', doc1.ref)).rejects.toThrow('UNTRUSTED');
    expect(() => handlers.get('files.stopWatch')!({ ...event(w2), senderFrame: {} } as IpcMainInvokeEvent, watch1.id)).toThrow('UNTRUSTED');
    invoke(w2, 'stopWatch', watch1.id); invoke(w1, 'stopWatch', watch2.id);
    expect(service.watcher.resourceCounts.consumers).toBe(2); expect(unsubscribed).toEqual([]);
    const a = updates(w1).length, b = updates(w2).length;
    writeFileSync(join(fixture, 'one/value.txt'), 'W1 AUTHORIZED CHANGE');
    await until(() => nativeEvents.some(e => e.path === join(fixture, 'one') && e.events.some(c => c.path === join(fixture, 'one/value.txt'))) && updates(w1).slice(a).some(u => u.changed));
    expect(updates(w2).slice(b).some(u => u.changed)).toBe(false);
    expect(updates(w1).every(u => u.id === watch1.id && u.lease === root1.lease)).toBe(true);
    expect(updates(w2).every(u => u.id === watch2.id && u.lease === root2.lease)).toBe(true);
    w1.emit('render-process-gone'); const stoppedCount = updates(w1).length, w2Marker = updates(w2).length;
    await expect(invoke(w2, 'read', doc1.ref)).rejects.toThrow('UNTRUSTED');
    writeFileSync(join(fixture, 'one/value.txt'), 'W1 CLOSED'); writeFileSync(join(fixture, 'two/value.txt'), 'W2 STILL ACTIVE');
    await until(() => updates(w2).slice(w2Marker).some(u => u.changed) && nativeEvents.some(e => e.path === join(fixture, 'two') && e.events.some(c => c.path === join(fixture, 'two/value.txt'))));
    expect(updates(w1)).toHaveLength(stoppedCount); expect(service.watcher.resourceCounts.consumers).toBe(1);
    w2.emit('destroyed'); await service.watcher.dispose(); expect(service.watcher.resourceCounts).toEqual(zeroResources);
    (output.runs as unknown[]).push({ case: 'M9-T-L04', watch1: watch1.id, watch2: watch2.id, rejectedAttempts: ['W2 configure W1 watchId', 'W1 configure W2 watchId', 'W2 forged owner + W1 root/watchId', 'W2 watch W1 document', 'W2 read W1 document', 'foreign frame stopWatch', 'W2 read revoked W1 document'], ineffectiveStopAttempts: ['W2 stop W1', 'W1 stop W2'], w1Updates: updates(w1), w2Updates: updates(w2), nativeEvents, unsubscribed, closedOwnerReceivedLaterEvents: updates(w1).length !== stoppedCount, finalResources: service.watcher.resourceCounts, ipcBoundary: 'Registered production controller with synthetic authenticated Electron sender identities; actual OS watcher events and broker IO; no actual Electron windows/GUI', pass: true });
  }, 20_000);
});

afterAll(() => {
  if (process.env.SMARTDD_WATCH_ACCEPTANCE_EVIDENCE) {
    mkdirSync(dirname(process.env.SMARTDD_WATCH_ACCEPTANCE_EVIDENCE), { recursive: true });
    writeFileSync(process.env.SMARTDD_WATCH_ACCEPTANCE_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n');
  }
});
