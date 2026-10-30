import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FileRead, FileRef, FileRoot, FileWatchUpdate } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileWorkspaceStore } from '@renderer/features/files/workspace-store';
import type { FileClient } from '@renderer/features/files/file-buffer';

const watch = vi.hoisted(() => ({ listener: null as null | ((update: FileWatchUpdate) => void) }));
vi.mock('@renderer/lib/ipc', () => ({ events: { on: (_event: unknown, listener: (update: FileWatchUpdate) => void) => { watch.listener = listener; return () => { watch.listener = null; }; } }, rpc: { files: {} } }));

const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
async function fixture(failLate = false) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-initial-load-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, 'source.txt'); writeFileSync(path, 'ORIGINAL\n');
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
  const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'H22 isolated fixture', projectId: 'h22' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const ready = deferred<FileRead>(), release = deferred<void>(), reads: FileRead[] = [];
  let first = true, watchUpdate: FileWatchUpdate | null = null;
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('h22', scope),
    open: (input: Parameters<FileService['open']>[1]) => service.open('h22', input),
    list: (input: Parameters<FileService['list']>[1]) => service.list('h22', input),
    read: async (ref: FileRef) => {
      const hold = first; first = false; const result = await service.read('h22', ref); reads.push(result);
      if (hold) { ready.resolve(result); await release.promise; if (failLate) throw new Error('Synthetic late read delivery failure after real native read'); }
      return result;
    },
    refresh: vi.fn((ref: FileRef) => service.refresh('h22', ref)),
    save: vi.fn((input: Parameters<FileService['save']>[1]) => service.save('h22', input)),
    checkpoint: vi.fn((input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('h22', input)),
    drafts: (ref: FileRef) => service.drafts('h22', ref),
    readDraft: (ref: FileRef, id: string) => service.readDraft('h22', ref, id),
    resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('h22', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('h22', ref),
    closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('h22', scope),
    watch: async (root: FileRoot, _directories: string[], _refs: FileRef[], id?: string) => {
      watchUpdate = { id: id ?? randomUUID(), lease: root.lease, generation: root.generation, sequence: (watchUpdate?.sequence ?? 0) + 1, coverage: 'poll', changed: false, resyncRequired: false };
      return watchUpdate;
    },
    stopWatch: async () => undefined,
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'h22' }, api as unknown as FileClient, null, null);
  await store.initialize(); const root = store.treeRoot!, detach = store.attach();
  const opening = store.open(root, 'source.txt', true); await ready.promise;
  const f = { directory, path, api, broker, service, store, root, opening, ready, release, reads,
    notify: () => { if (!watchUpdate || !watch.listener) throw new Error('Synthetic watch delivery not attached'); watchUpdate = { ...watchUpdate, sequence: watchUpdate.sequence + 1, changed: true }; watch.listener(watchUpdate); },
    cleanup: async () => { release.resolve(); await opening; detach(); store.dispose(); service.closeOwner('h22'); await service.watcher.dispose(); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
afterAll(() => {
  if (process.env.SMARTDD_H22_EVIDENCE) writeFileSync(process.env.SMARTDD_H22_EVIDENCE, JSON.stringify({ caseId: 'M9-T-H22', recordedAt: new Date().toISOString(), broker: process.env.SMARTDD_M9_FILE_BROKER, brokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Synthetic matching watch event delivered through the production store.attach/receiveWatch/refreshRoot path; real FileBuffer/FileService and packaged broker IO. First read delivery is gated; no UI or actual OS watcher event is claimed.', rows }, null, 2) + '\n');
});

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('H22 initial read and disk notification ordering', () => {
  it.each(['in-place write', 'atomic replacement', 'late read failure'] as const)('rechecks current disk when %s is notified before initial read completes', async (mode) => {
    const f = await fixture(mode === 'late read failure');
    const buffer = f.store.active!.buffer!, old = await f.ready.promise;
    expect(buffer.loadState).toBe('loading'); expect(buffer.editor).toBeNull();
    if (mode === 'atomic replacement') { writeFileSync(f.path + '.new', 'LATEST\n'); renameSync(f.path + '.new', f.path); }
    else writeFileSync(f.path, 'LATEST\n');
    // Deliver a matching change event through the production subscription;
    // actual filesystem changes and reads remain real.
    f.notify(); await Promise.resolve();
    const refreshBeforeDelivery = f.api.refresh.mock.calls.length;
    f.release.resolve(); await f.opening;
    const result = { mode, firstRead: Buffer.from(old.base64, 'base64').toString(), currentDisk: readFileSync(f.path, 'utf8'), finalBuffer: buffer.raw, loadState: buffer.loadState, loadError: buffer.loadError, baseHash: buffer.baseHash, currentDiskHash: sha(readFileSync(f.path)), dirty: buffer.dirty, conflict: buffer.conflict, refreshBeforeDelivery, refreshAfterDelivery: f.api.refresh.mock.calls.length, actualReads: f.reads.map(read => ({ text: Buffer.from(read.base64, 'base64').toString(), revision: read.document.revision })), saveCalls: f.api.save.mock.calls.length, checkpointCalls: f.api.checkpoint.mock.calls.length };
    rows.push(result);
    expect(buffer.loadState).toBe('ready'); expect(buffer.raw).toBe('LATEST\n'); expect(buffer.baseHash).toBe(result.currentDiskHash);
    expect(buffer.loadError).toBe(''); expect(buffer.dirty).toBe(false); expect(buffer.conflict).toBe(false);
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
  });
  it('coalesces repeated matching notifications before delivery and does not retry a quiet initial load', async () => {
    const quiet = await fixture(); quiet.release.resolve(); await quiet.opening;
    expect(quiet.reads).toHaveLength(1); expect(quiet.store.active!.buffer!.raw).toBe('ORIGINAL\n');
    const f = await fixture(); writeFileSync(f.path, 'LATEST\n');
    f.notify(); f.notify(); f.notify(); f.release.resolve(); await f.opening;
    expect(f.store.active!.buffer!.raw).toBe('LATEST\n'); expect(f.reads).toHaveLength(2);
    expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
    rows.push({ variant: 'coalesced notifications / quiet control', quietReadCount: quiet.reads.length, coalescedReadCount: f.reads.length, finalBuffer: f.store.active!.buffer!.raw });
  });
  it('does not start a delayed refresh or restore a closed buffer after notification and disposal', async () => {
    const f = await fixture(), buffer = f.store.active!.buffer!;
    writeFileSync(f.path, 'LATEST\n'); f.notify(); f.store.dispose();
    f.release.resolve(); await f.opening;
    expect(buffer.editor).toBeNull(); expect(f.reads).toHaveLength(1); expect(f.api.save).not.toHaveBeenCalled(); expect(f.api.checkpoint).not.toHaveBeenCalled();
    rows.push({ variant: 'disposed before old delivery', editorRemainsAbsent: buffer.editor === null, reads: f.reads.length, currentDisk: readFileSync(f.path, 'utf8') });
  });
});
