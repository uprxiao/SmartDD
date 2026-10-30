import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FileRead, FileRef } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { NativeFileBroker } from '@main/core/files/native-broker';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => undefined } }));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { resolve, promise }; };
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const disk = (path: string) => ({ text: readFileSync(path, 'utf8'), hash: sha(readFileSync(path)), inode: String(statSync(path, { bigint: true }).ino) });
async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-read-recovery-native-'))), project = join(directory, 'project'), userData = join(directory, 'userdata'), path = join(project, 'source.txt');
  mkdirSync(project); mkdirSync(userData); writeFileSync(path, 'A original\n');
  const broker = new NativeFileBroker(process.env.SMARTDD_M9_FILE_BROKER!);
  const sources = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'H01 native fixture', projectId: 'h01' }] };
  const service = new FileService(new FileRootsService(sources, broker), broker, new FileRecoveryStore(broker, userData, sources));
  type ReadGate = { ready: ReturnType<typeof deferred<FileRead>>; release: ReturnType<typeof deferred<void>>; fail: boolean };
  const pending = new Set<Promise<unknown>>(); let hold: ReadGate | null = null;
  const gates: ReadGate[] = [];
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('h01', scope),
    open: vi.fn((input: Parameters<FileService['open']>[1]) => service.open('h01', input)),
    list: (input: Parameters<FileService['list']>[1]) => service.list('h01', input),
    read: vi.fn(async (ref: FileRef) => {
      const gate = hold; hold = null;
      const run = (async () => { const result = await service.read('h01', ref); if (gate) { gate.ready.resolve(result); await gate.release.promise; if (gate.fail) throw new Error('Controlled late transport failure after real native read'); } return result; })();
      pending.add(run); try { return await run; } finally { pending.delete(run); }
    }),
    refresh: (ref: FileRef) => service.refresh('h01', ref),
    save: vi.fn((input: Parameters<FileService['save']>[1]) => service.save('h01', input)),
    checkpoint: (input: Parameters<FileService['checkpoint']>[1]) => service.checkpoint('h01', input),
    drafts: (ref: FileRef) => service.drafts('h01', ref), readDraft: (ref: FileRef, id: string) => service.readDraft('h01', ref, id),
    resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => service.resolveDraft('h01', input),
    closeDocument: async (ref: FileRef) => service.closeDocument('h01', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('h01', scope),
    watch: async () => null, stopWatch: async () => undefined,
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'h01' }, api as unknown as FileClient, null, null); await store.initialize();
  const f = { directory, path, store, api, service, root: store.treeRoot!,
    holdRead: (fail = false) => { hold = { ready: deferred<FileRead>(), release: deferred<void>(), fail }; gates.push(hold); return hold; },
    cleanup: async () => { gates.forEach(gate => gate.release.resolve()); await Promise.allSettled([...pending]); store.dispose(); service.closeOwner('h01'); await service.watcher.dispose(); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); });
afterAll(() => { if (process.env.SMARTDD_H01_EVIDENCE) writeFileSync(process.env.SMARTDD_H01_EVIDENCE, JSON.stringify({ caseId: 'M9-T-H01', at: new Date().toISOString(), broker: process.env.SMARTDD_M9_FILE_BROKER, brokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Real production store/buffer/FileService/recovery and packaged native IO. Watch transport is absent; read-delivery timing/error alone gated after the actual native read. Native permission, missing and persistent draft failures are real. No actual UI/OS-watch claim.', rows }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('H01 real native read recovery', () => {
  it.each(['reactivate', 'refresh', 'reopen tree'] as const)('retries failed initial open through %s without duplicate tabs', async trigger => {
    const f = await fixture(); chmodSync(f.path, 0); await f.store.open(f.root, 'source.txt', true); const tab = f.store.active!;
    expect(tab.buffer).toBeNull(); expect(tab.error).toContain('PERMISSION'); expect(tab.loading).toBe(false);
    chmodSync(f.path, 0o400);
    if (trigger === 'reactivate') { f.store.activate(tab.id); await vi.waitFor(() => expect(tab.buffer?.loadState).toBe('ready')); }
    if (trigger === 'refresh') await f.store.refresh();
    if (trigger === 'reopen tree') await f.store.open(f.root, 'source.txt', true);
    expect(tab.buffer?.raw).toBe('A original\n'); expect(tab.error).toBe(''); expect(f.store.tabs).toHaveLength(1); expect(f.api.save).not.toHaveBeenCalled();
    rows.push({ trigger, raw: tab.buffer?.raw, error: tab.error, opens: f.api.open.mock.calls.length, disk: disk(f.path) });
  });
  it('recovers an initial read failure through refresh of the same buffer', async () => {
    const f = await fixture(); f.api.read.mockRejectedValueOnce(new Error('Controlled initial transport read failure')); await f.store.open(f.root, 'source.txt', true);
    const buffer = f.store.active!.buffer!; expect(buffer.loadState).toBe('error'); expect(buffer.editor).toBeNull();
    writeFileSync(f.path, 'B recovered\n'); await f.store.refresh();
    expect(f.store.active!.buffer).toBe(buffer); expect(buffer.raw).toBe('B recovered\n'); expect(buffer.loadState).toBe('ready'); expect(buffer.loadError).toBe('');
    rows.push({ scenario: 'initial read delivery failure -> same-buffer retry', raw: buffer.raw, disk: disk(f.path), reads: f.api.read.mock.calls.length });
  });
  it.each([false, true])('ignores an obsolete A read or error delivered after newer B, late error=%s', async fail => {
    const f = await fixture(), gate = f.holdRead(fail), first = f.store.open(f.root, 'source.txt', true); const a = await gate.ready.promise;
    const buffer = f.store.active!.buffer!; expect(buffer.loadState).toBe('loading'); writeFileSync(f.path, 'B authoritative\n');
    await buffer.load(); expect(buffer.raw).toBe('B authoritative\n'); gate.release.resolve(); await first;
    expect(buffer.raw).toBe('B authoritative\n'); expect(buffer.loadState).toBe('ready'); expect(buffer.loadError).toBe(''); expect(buffer.baseHash).toBe(disk(f.path).hash); expect(f.api.save).not.toHaveBeenCalled();
    rows.push({ scenario: 'obsolete real A read delivery', fail, old: Buffer.from(a.base64, 'base64').toString(), final: buffer.raw, reads: f.api.read.mock.calls.length, disk: disk(f.path) });
  });
  it('keeps dirty bytes and native draft on unreadable disk, then recovers reads without a write', async () => {
    const f = await fixture(); await f.store.open(f.root, 'source.txt', true); const buffer = f.store.active!.buffer!, before = disk(f.path);
    const tx = buffer.editor!.update({ changes: { from: buffer.editor!.doc.length, insert: 'Local draft 中文🙂' }, userEvent: 'input.type' }); buffer.acceptTransactions(tx.state, [tx]); await buffer.checkpoint();
    chmodSync(f.path, 0); await f.store.refresh(); expect(buffer.loadError).toContain('PERMISSION'); expect(buffer.raw).toBe(before.text + 'Local draft 中文🙂');
    chmodSync(f.path, 0o400); await f.store.refresh(); expect(buffer.loadError).toBe(''); expect(buffer.dirty).toBe(true); expect(disk(f.path)).toEqual(before);
    const drafts = f.service.drafts('h01', buffer.file.ref); expect(drafts).toHaveLength(1); const draft = await f.service.readDraft('h01', buffer.file.ref, drafts[0].id);
    expect(Buffer.from(draft.base64, 'base64').toString()).toBe(buffer.raw); expect(f.api.save).not.toHaveBeenCalled();
    rows.push({ scenario: 'permission retry preserves dirty and native checkpoint', raw: buffer.raw, draft, disk: disk(f.path) });
  });
  it('recovers the original missing inode; a different occupant requires an explicit fresh open', async () => {
    const f = await fixture(); await f.store.open(f.root, 'source.txt', true); const buffer = f.store.active!.buffer!, before = disk(f.path), fd = openSync(f.path, 'r');
    try { renameSync(f.path, f.path + '.held'); await f.store.refresh(); expect(buffer.loadError).toContain('MISSING'); expect(buffer.raw).toBe(before.text);
      renameSync(f.path + '.held', f.path); await f.store.refresh(); expect(buffer.raw).toBe(before.text); expect(buffer.loadError).toBe(''); expect(disk(f.path).inode).toBe(before.inode);
      unlinkSync(f.path); await f.store.refresh(); writeFileSync(f.path, 'Restored new inode\n'); await f.store.refresh(); expect(buffer.loadError).toContain('另一文件'); expect(buffer.raw).toBe(before.text);
      expect(await f.store.close(f.store.active!.id)).toBe('closed'); await f.store.open(f.root, 'source.txt', true); expect(f.store.active!.buffer!.raw).toBe('Restored new inode\n'); expect(disk(f.path).inode).not.toBe(before.inode); expect(f.api.save).not.toHaveBeenCalled();
      rows.push({ scenario: 'same-inode retry / new-inode explicit fresh capability', before, after: disk(f.path), raw: f.store.active!.buffer!.raw });
    } finally { closeSync(fd); }
  });
  it('invalidates a suspended older refresh when a newer explicit load completes', async () => {
    const f = await fixture(); await f.store.open(f.root, 'source.txt', true); const buffer = f.store.active!.buffer!;
    writeFileSync(f.path, 'B old refresh\n'); const gate = f.holdRead(), old = buffer.refresh(); await gate.ready.promise;
    writeFileSync(f.path, 'C latest load\n'); await buffer.load(); gate.release.resolve(); await old;
    expect(buffer.raw).toBe('C latest load\n'); expect(buffer.baseHash).toBe(disk(f.path).hash); expect(buffer.loadError).toBe('');
    rows.push({ scenario: 'late native B refresh after newer C explicit load', final: buffer.raw, disk: disk(f.path) });
  });
});
