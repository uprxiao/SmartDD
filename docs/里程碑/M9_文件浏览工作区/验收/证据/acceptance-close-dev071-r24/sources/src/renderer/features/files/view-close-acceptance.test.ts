import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import type { FileClient } from './file-buffer';
import { FileWorkspaceStore } from './workspace-store';
const events = vi.hoisted(() => ({ listeners: new Map<string, (value: unknown) => void>(), off: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: (name: string, listener: (value: unknown) => void) => { events.listeners.set(name, listener); return () => { events.listeners.delete(name); events.off(); }; } } }));
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
class DelayedBroker extends NativeFileBroker {
  saves = 0; hold: { entered: ReturnType<typeof gate>; release: ReturnType<typeof gate> } | null = null;
  override async request<T>(request: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (request.operation === 'save') { this.saves++; if (this.hold) { const held = this.hold; this.hold = null; held.entered.resolve(); await held.release.promise; } }
    return super.request<T>(request, options);
  }
}
const fixtures: { cleanup(): Promise<void> }[] = [], rows: unknown[] = [];
async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-view-close-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata'), path = join(project, 'source.txt'); mkdirSync(project); mkdirSync(userdata); writeFileSync(path, 'BASE\n');
  const broker = new DelayedBroker(process.env.SMARTDD_TEST_FILE_BROKER!), sources = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Close fixture', projectId: 'view-close' }] }, recovery = new FileRecoveryStore(broker, userdata, sources), service = new FileService(new FileRootsService(sources, broker), broker, recovery), watches: Promise<unknown>[] = [], holds: { release: ReturnType<typeof gate> }[] = [];
  const api = { roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('frame', scope), open: (input: Parameters<FileService['open']>[1]) => service.open('frame', input), list: (input: Parameters<FileService['list']>[1]) => service.list('frame', input), read: (input: Parameters<FileService['read']>[1]) => service.read('frame', input), refresh: (input: Parameters<FileService['refresh']>[1]) => service.refresh('frame', input), save: (input: Parameters<FileService['save']>[1]) => service.save('frame', input), checkpoint: (input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('frame', input), drafts: (input: Parameters<FileService['drafts']>[1]) => service.drafts('frame', input), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('frame', input), closeDocument: async (input: Parameters<FileService['closeDocument']>[1]) => service.closeDocument('frame', input), closeScope: async (input: Parameters<FileService['closeScope']>[1]) => service.closeScope('frame', input),
    watch: (root: Parameters<FileService['watch']>[1], directories: string[], refs: Parameters<FileService['watch']>[3], id?: string) => { const pending = service.watch('frame', root, directories, refs, () => undefined, id); watches.push(pending); return pending; }, stopWatch: async (id: string) => service.watcher.stop('frame', id) };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'view-close' }, api as unknown as FileClient, null, null); await store.initialize(); await store.open(store.treeRoot!, 'source.txt', true); const buffer = store.active!.buffer!;
  const edit = (text: string) => { const tx = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text }, userEvent: 'input.type' }); buffer.acceptTransactions(tx.state, [tx]); };
  const f = { directory, path, broker, service, store, buffer, edit, disk: () => readFileSync(path, 'utf8'), watched: async () => { await Promise.all(watches); }, hold: () => { const held = { entered: gate(), release: gate() }; broker.hold = held; holds.push(held); return held; },
    cleanup: async () => { holds.forEach(held => held.release.resolve()); await store.flushDetachedViews(); store.dispose(); service.closeOwner('frame'); await service.watcher.dispose(); broker.dispose(); rmSync(directory, { recursive: true, force: true }); } };
  fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); events.listeners.clear(); events.off.mockClear(); });
afterAll(() => { if (process.env.SMARTDD_VIEW_CLOSE_EVIDENCE) writeFileSync(process.env.SMARTDD_VIEW_CLOSE_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), helper: process.env.SMARTDD_TEST_FILE_BROKER, helperSha256: createHash('sha256').update(readFileSync(process.env.SMARTDD_TEST_FILE_BROKER!)).digest('hex'), boundary: 'I: real store, FileService, watcher, independent drafts and native save receipts. Only IO delivery/timers controlled; no mocked successful writes. Normal App quit is verified separately.', rows }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TEST_FILE_BROKER)('last-view flush and close', () => {
  it('flushes only on last detach, waits for the real write and releases watchers/timers', async () => {
    const f = await fixture(), detach = f.store.attach(), second = f.store.attach(); await f.watched(); expect(f.service.watcher.resourceCounts.consumers).toBe(1); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.edit('LATEST 中文🙂\n'); const held = f.hold(); second(); expect(f.broker.saves).toBe(0); detach(); detach(); await held.entered.promise;
    expect(f.disk()).toBe('BASE\n'); expect(f.buffer.dirty).toBe(true); expect(f.service.watcher.resourceCounts.consumers).toBe(0); expect(events.off).toHaveBeenCalledTimes(1);
    held.release.resolve(); await f.store.flushDetachedViews(); expect(f.disk()).toBe('LATEST 中文🙂\n'); expect(f.buffer.dirty).toBe(false); await vi.advanceTimersByTimeAsync(9000); await delay(20); expect(f.broker.saves).toBe(1);
    rows.push({ scenario: 'last detach delayed native write', independentDisk: f.disk(), saveCalls: f.broker.saves, watchesAfter: f.service.watcher.resourceCounts, timersAfter: vi.getTimerCount() });
  });
  it('resumes newer input after reattaching during an older flush', async () => {
    const f = await fixture(), detach = f.store.attach(); await f.watched(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.edit('FIRST\n'); const held = f.hold(); detach(); await held.entered.promise; const again = f.store.attach(); f.edit('NEWER\n'); held.release.resolve(); await f.store.flushDetachedViews();
    expect(f.disk()).toBe('FIRST\n'); expect(f.buffer.raw).toBe('NEWER\n'); expect(f.buffer.dirty).toBe(true); await vi.advanceTimersByTimeAsync(3000);
    for (let i = 0; i < 100 && f.buffer.dirty; i++) await delay(20);
    expect(f.disk()).toBe('NEWER\n'); expect(f.buffer.dirty).toBe(false); expect(f.broker.saves).toBe(2); again(); await f.store.flushDetachedViews();
    rows.push({ scenario: 'reattach while older write pending; newer input autosaves', independentDisk: f.disk(), saveCalls: f.broker.saves });
  });
  it('does not rewrite a clean source on unmount or prepareClose', async () => {
    const f = await fixture(), detach = f.store.attach(); await f.watched(); expect(await f.buffer.prepareClose('save')).toBe(true); detach(); await f.store.flushDetachedViews(); expect(f.broker.saves).toBe(0); expect(f.disk()).toBe('BASE\n');
    rows.push({ scenario: 'clean source is not rewritten', saveCalls: f.broker.saves });
  });
});
