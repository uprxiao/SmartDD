import { createHash, randomUUID } from 'node:crypto';
import { closeSync, ftruncateSync, mkdirSync, mkdtempSync, openSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { FileSaveReceipt } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore, recoveryProjectKey } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileWorkspaceStore } from './workspace-store';
import type { FileClient } from './file-buffer';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} }, events: { on: () => () => undefined } }));
const BASE = 'Original before save\n', LOCAL = 'Local candidate 中文🙂\n', DISPLACED = 'External concurrent edit through original FD\n';
const sha = (x: string | Uint8Array) => createHash('sha256').update(x).digest('hex');
const disk = (p: string) => { const s = statSync(p, { bigint: true }), bytes = readFileSync(p); return { text: bytes.toString(), hash: sha(bytes), inode: String(s.ino), mtimeNs: String(s.mtimeNs), ctimeNs: String(s.ctimeNs) }; };
const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { resolve, promise }; };
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
class InspectBroker extends NativeFileBroker {
  saves = 0; calls: Record<string, unknown>[] = []; heldRead: { ready: ReturnType<typeof deferred>; release: ReturnType<typeof deferred> } | null = null;
  swapParent: (() => void) | null = null;
  constructor(executable: string, readonly mode: 'saved' | 'unknown' | 'conflict', readonly oldFd: number | null) { super(executable); }
  override async request<T>(request: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    this.calls.push({ operation: request.operation, root: request.root, relativePath: request.relativePath, expectedParentIdentity: request.expectedParentIdentity });
    if (request.operation === 'read' && String(request.relativePath).endsWith('/journal.json') && this.heldRead) { const gate = this.heldRead; this.heldRead = null; gate.ready.resolve(); await gate.release.promise; }
    if (request.operation === 'stat' && String(request.relativePath).endsWith('/candidate') && request.expectedParentIdentity && this.swapParent) { const swap = this.swapParent; this.swapParent = null; swap(); }
    if (request.operation !== 'save') return super.request<T>(request, options);
    this.saves++;
    return super.request<T>({ ...request, ...(this.mode === 'unknown' ? { testFailAt: 'swapped' } : this.mode === 'conflict' ? { testStopAt: 'swapped' } : {}) }, { ...options, onTestStop: (_phase, child) => { try { ftruncateSync(this.oldFd!, 0); writeSync(this.oldFd!, DISPLACED, 0, 'utf8'); } finally { child.kill('SIGCONT'); } } });
  }
}
async function fixture(mode: 'saved' | 'unknown' | 'conflict', candidate = LOCAL) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-recovery-inspect-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata'), path = join(project, 'source.txt'); mkdirSync(project); mkdirSync(userdata); writeFileSync(path, BASE);
  const oldFd = mode === 'conflict' ? openSync(path, 'r+') : null, broker = new InspectBroker(process.env.SMARTDD_TEST_FILE_BROKER!, mode, oldFd); let available = true;
  const sources = { sources: () => available ? [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Recovery inspect', projectId: 'recovery-inspect' }] : [] };
  const recovery = new FileRecoveryStore(broker, userdata, sources), service = new FileService(new FileRootsService(sources, broker), broker, recovery), pending = new Set<Promise<unknown>>();
  const call = async <T,>(fn: () => Promise<T>) => { const p = fn(); pending.add(p); try { return await p; } finally { pending.delete(p); } };
  const api = { roots: (scope: Parameters<FileService['openScope']>[1]) => service.openScope('frame', scope), open: (input: Parameters<FileService['open']>[1]) => service.open('frame', input), list: (input: Parameters<FileService['list']>[1]) => service.list('frame', input),
    read: (ref: Parameters<FileService['read']>[1]) => call(() => service.read('frame', ref)), refresh: (ref: Parameters<FileService['refresh']>[1]) => call(() => service.refresh('frame', ref)), save: (input: Parameters<FileService['save']>[1]) => call(() => service.save('frame', input)), checkpoint: (input: Parameters<FileService['checkpoint']>[1]) => call(() => service.checkpoint('frame', input)),
    drafts: async (ref: Parameters<FileService['drafts']>[1]) => service.drafts('frame', ref), readDraft: (ref: Parameters<FileService['readDraft']>[1], id: string) => service.readDraft('frame', ref, id), resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => call(() => service.resolveDraft('frame', input)), closeDocument: async (ref: Parameters<FileService['closeDocument']>[1]) => service.closeDocument('frame', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('frame', scope), watch: async () => null, stopWatch: async () => undefined };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'recovery-inspect' }, api as unknown as FileClient, null, null); await store.initialize(); await store.open(store.treeRoot!, 'source.txt', true); const tab = store.active!, buffer = tab.buffer!;
  const tx = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: candidate }, userEvent: 'input.type' }); buffer.acceptTransactions(tx.state, [tx]);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); await buffer.save();
  const receipt = buffer.saveReceipt!; expect(receipt.state).toBe(mode); const id = receipt.opId, projectKey = recoveryProjectKey('recovery-inspect'), journalPath = join(userdata, 'file-recovery/v1', projectKey, id, 'journal.json'), journal = JSON.parse(readFileSync(journalPath, 'utf8'));
  const paths = { current: path, displaced: join(project, journal.transactionLeaf, 'candidate'), materialized: join(project, journal.transactionLeaf, 'materialized'), draft: join(userdata, 'file-recovery/v1', projectKey, id, 'draft'), journal: journalPath };
  const versions = () => Object.fromEntries(Object.entries(paths).map(([name, p]) => [name, disk(p)])); const gates: { release: ReturnType<typeof deferred> }[] = [];
  const f = { directory, project, userdata, path, broker, recovery, service, store, tab, buffer, receipt, journal, paths, versions, projectKey, input: () => ({ projectKey, id, requestId: randomUUID() }), unavailable: () => { available = false; }, hold: () => { const gate = { ready: deferred(), release: deferred() }; broker.heldRead = gate; gates.push(gate); return gate; },
    cleanup: async () => { gates.forEach(gate => gate.release.resolve()); store.dispose(); await Promise.allSettled([...pending]); service.closeOwner('frame'); await service.watcher.dispose(); broker.dispose(); if (oldFd !== null) closeSync(oldFd); rmSync(directory, { recursive: true, force: true }); } };
  fixtures.push(f); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
afterAll(() => { if (process.env.SMARTDD_RECOVERY_INSPECT_EVIDENCE) writeFileSync(process.env.SMARTDD_RECOVERY_INSPECT_EVIDENCE, JSON.stringify({ at: new Date().toISOString(), helper: process.env.SMARTDD_TEST_FILE_BROKER, helperSha256: sha(readFileSync(process.env.SMARTDD_TEST_FILE_BROKER!)), nativeSourceSha256: sha(readFileSync('native/files/broker.mm')), boundary: 'Actual production store/FileService/recovery and real native save/exchange/read; test macro injects swapped IO failure or suspends while an external old-FD writer edits the displaced inode. No fabricated receipt/inspection content. These are I, not UI A.', rows }, null, 2) + '\n'); });
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_TEST_FILE_BROKER)('H27 recovery materials remain inspectable after discard', () => {
  it.each(['unknown', 'conflict'] as const)('retains all %s materials, closes explicitly and never retries a discarded buffer', async mode => {
    const f = await fixture(mode), before = f.versions(); expect(f.buffer.recoveryBlocked).toBe(true); expect(await f.store.close(f.tab.id)).toBe('blocked');
    expect(await f.store.close(f.tab.id, true)).toBe('closed'); await vi.advanceTimersByTimeAsync(4000); await delay(20); expect(f.versions()).toEqual(before); expect(f.broker.saves).toBe(1); expect(f.store.tabs).toHaveLength(0);
    const inspection = await f.service.inspectRecovery('frame', f.input()); expect(inspection.readOnly).toBe(true); expect(inspection.state).toBe(mode); expect(inspection.materials.every(x => x.available)).toBe(true);
    expect(inspection.materials.find(x => x.kind === 'draft')!.preview).toBe(LOCAL); expect(inspection.materials.find(x => x.kind === 'current')!.preview).toBe(LOCAL); expect(inspection.materials.find(x => x.kind === 'displaced')!.preview).toBe(mode === 'conflict' ? DISPLACED : BASE); expect(f.versions()).toEqual(before);
    rows.push({ mode, receipt: f.receipt, beforeAndAfter: before, inspection, saveCalls: f.broker.saves, explicitClosed: true });
  });
  it('does not read an attacker replacement of the verified transaction parent between inspection and snapshot', async () => {
    const f = await fixture('saved'), transaction = join(f.project, f.journal.transactionLeaf); f.broker.swapParent = () => { renameSync(transaction, transaction + '.original'); mkdirSync(transaction, { mode: 0o700 }); writeFileSync(join(transaction, 'candidate'), 'FORGED_PARENT_CONTENT'); writeFileSync(join(transaction, 'materialized'), 'FORGED_PARENT_CONTENT'); };
    const inspection = await f.service.inspectRecovery('frame', f.input()); expect(inspection.materials.find(x => x.kind === 'displaced')!.available).toBe(false); expect(JSON.stringify(inspection)).not.toContain('FORGED_PARENT_CONTENT'); expect(readFileSync(join(transaction + '.original', 'candidate'), 'utf8')).toBe(BASE);
    rows.push({ scenario: 'parent identity changes after journal validation', inspection, originalRetained: true });
  });
  it('returns private draft only when its original source root is no longer authorized', async () => {
    const f = await fixture('unknown'), before = f.versions(); f.unavailable(); const inspection = await f.service.inspectRecovery('frame', f.input());
    expect(inspection.item.sourceAvailable).toBe(false); expect(inspection.materials.filter(x => x.available).map(x => x.kind)).toEqual(['draft']); expect(f.versions()).toEqual(before);
    rows.push({ scenario: 'source removed; private material retained without ambient source access', inspection });
  });
  it('cancels only the requesting owner without corrupting the journal or blocking a subsequent inspection', async () => {
    const f = await fixture('unknown'), gate = f.hold(), input = f.input(), pending = f.service.inspectRecovery('frame', input); await gate.ready.promise;
    f.service.cancelResource('other-frame', input.requestId); f.service.cancelResource('frame', input.requestId); gate.release.resolve(); await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' });
    expect(f.recovery.items().find(x => x.id === input.id)!.state).not.toBe('invalid'); const again = await f.service.inspectRecovery('frame', f.input()); expect(again.materials.every(x => x.available)).toBe(true); expect(f.broker.activeProcesses).toBe(0);
    rows.push({ scenario: 'owner-scoped cancellation is retryable', again });
  });
  it('bounds text preview at a UTF-8 byte boundary while retaining full-content hashes', async () => {
    const text = 'x'.repeat(262143) + '中尾', f = await fixture('saved', text), before = f.versions(), inspection = await f.service.inspectRecovery('frame', f.input()); const draft = inspection.materials.find(x => x.kind === 'draft')!;
    expect(draft.available).toBe(true); expect(draft.truncated).toBe(true); expect(draft.preview).toBe('x'.repeat(262143)); expect(draft.revision!.hash).toBe(sha(text)); expect(f.versions()).toEqual(before);
    rows.push({ scenario: 'bounded UTF-8 prefix plus exact full hash', bytes: Buffer.byteLength(text), previewUnits: draft.preview!.length, sha256: draft.revision!.hash });
  });
  it('rejects forged IDs and path-bearing requests before native IO', async () => {
    const f = await fixture('unknown'), count = f.broker.calls.length;
    await expect(f.service.inspectRecovery('frame', { ...f.input(), id: '../outside' })).rejects.toThrow(); await expect(f.service.inspectRecovery('frame', { ...f.input(), path: '/outside' } as never)).rejects.toThrow(); expect(f.broker.calls).toHaveLength(count);
    rows.push({ scenario: 'opaque schemas reject paths before IO' });
  });
});
