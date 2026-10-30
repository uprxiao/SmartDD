import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realDelay } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { FileService } from '@main/core/files/file-service';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { FileWorkspaceStore } from '@renderer/features/files/workspace-store';
import type { FileClient } from '@renderer/features/files/file-buffer';
import type { FileRef, FileSaveReceipt } from '@shared/files';

vi.mock('@renderer/lib/ipc', () => ({ events: { on: () => () => undefined }, rpc: { files: {} } }));
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const until = async (condition: () => boolean) => { const deadline = Date.now() + 5000; while (!condition()) { if (Date.now() > deadline) throw new Error('H24 real native operation did not settle'); await realDelay(2); } };
const settled = (promise: Promise<unknown>) => promise.then(() => ({ status: 'fulfilled', message: '' }), error => ({ status: 'rejected', message: String(error) }));
const rows: Record<string, unknown>[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
type Gate = { ready: ReturnType<typeof deferred<Record<string, unknown>>>; release: ReturnType<typeof deferred<void>> };
class GatedBroker extends NativeFileBroker {
  gates: Gate[] = [];
  saves: Record<string, unknown>[] = [];
  transactions: string[] = [];
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (input.operation === 'save') {
      this.saves.push(input); const gate = this.gates.shift();
      if (gate) { gate.ready.resolve(input); await gate.release.promise; }
    }
    return super.request<T>(input, { ...options, onTransaction: (identity, opId) => { this.transactions.push(opId); options.onTransaction?.(identity, opId); } });
  }
}
async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-h24-io-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, 'a.md'), other = join(project, 'b.md'); writeFileSync(path, '# A base\n'); writeFileSync(other, '# B base\n');
  const broker = new GatedBroker(process.env.SMARTDD_M9_FILE_BROKER!);
  const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'H24 isolated source', projectId: 'h24' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const pending = new Set<Promise<unknown>>(), receipts: FileSaveReceipt[] = [], releases: (() => void)[] = [];
  const track = async <T,>(operation: () => Promise<T>) => { const work = operation(); pending.add(work); try { return await work; } finally { pending.delete(work); } };
  const api = {
    roots: (scope: Parameters<FileService['openScope']>[1]) => track(() => service.openScope('h24', scope)),
    open: (input: Parameters<FileService['open']>[1]) => track(() => service.open('h24', input)), list: (input: Parameters<FileService['list']>[1]) => track(() => service.list('h24', input)),
    read: (ref: FileRef) => track(() => service.read('h24', ref)), refresh: (ref: FileRef) => track(() => service.refresh('h24', ref)),
    save: (input: Parameters<FileService['save']>[1]) => track(async () => { const receipt = await service.save('h24', input); receipts.push(receipt); return receipt; }),
    checkpoint: (input: Parameters<FileService['checkpoint']>[1]) => track(() => service.checkpoint('h24', input)),
    drafts: (ref: FileRef) => track(async () => service.drafts('h24', ref)), readDraft: (ref: FileRef, id: string) => track(() => service.readDraft('h24', ref, id)),
    resolveDraft: (input: Parameters<FileService['resolveDraft']>[1]) => track(() => service.resolveDraft('h24', input)),
    closeDocument: async (ref: FileRef) => service.closeDocument('h24', ref), closeScope: async (scope: Parameters<FileService['closeScope']>[1]) => service.closeScope('h24', scope),
  };
  const store = new FileWorkspaceStore({ kind: 'project', projectId: 'h24' }, api as unknown as FileClient, null, null);
  await store.initialize(); await store.open(store.treeRoot!, 'b.md', true); const b = store.active!;
  await store.open(store.treeRoot!, 'a.md', true); const a = store.active!, buffer = a.buffer!;
  const f = { directory, path, other, store, a, b, buffer, broker, receipts,
    edit: (text: string) => { const tr = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text }, userEvent: 'input.type' }); buffer.acceptTransactions(tr.state, [tr]); },
    hold: () => { const gate = { ready: deferred<Record<string, unknown>>(), release: deferred<void>() }; broker.gates.push(gate); releases.push(() => gate.release.resolve()); return gate; },
    idle: () => until(() => pending.size === 0 && broker.activeProcesses === 0 && !buffer.saving),
    state: () => ({ active: store.active?.route.relativePath, aMode: buffer.mode, aRouteMode: a.route.mode, aRaw: buffer.raw, aDisk: readFileSync(path, 'utf8'), aDirty: buffer.dirty, aConflict: buffer.conflict, bMode: b.buffer!.mode, bRaw: b.buffer!.raw, bDisk: readFileSync(other, 'utf8') }),
    cleanup: async () => { releases.forEach(release => release()); await until(() => pending.size === 0 && broker.activeProcesses === 0); store.dispose(); service.closeOwner('h24'); await service.watcher.dispose(); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); return f;
}
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
afterAll(() => { if (process.env.SMARTDD_H24_EVIDENCE) writeFileSync(process.env.SMARTDD_H24_EVIDENCE, JSON.stringify({ caseId: 'M9-T-H24', at: new Date().toISOString(), broker: process.env.SMARTDD_M9_FILE_BROKER, brokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Production store+buffer+FileService/recovery+packaged broker; real checkpoint/write/conflict and independent disk checks. Only native save dispatch timing is gated. No mocked successful save, UI or physical IME claim.', rows }, null, 2) + '\n'); });

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9 H24 mode change while actual save waits', () => {
  it.each(['success', 'conflict'] as const)('control: unchanged mode intent sees real save %s', async outcome => {
    const f = await fixture(); f.edit('# A edited\n'); const gate = f.hold(), change = settled(f.store.setMode(f.buffer, 'source')); await gate.ready.promise;
    if (outcome === 'conflict') writeFileSync(f.path, '# External\n'); gate.release.resolve(); const result = await change; await f.idle();
    rows.push({ scenario: 'current intent control', outcome, result, final: f.state(), receipts: f.receipts, nativeSaves: f.broker.saves.length, transactions: f.broker.transactions });
    expect(result.status).toBe(outcome === 'success' ? 'fulfilled' : 'rejected'); expect(f.buffer.mode).toBe(outcome === 'success' ? 'source' : 'document');
    expect(readFileSync(f.path, 'utf8')).toBe(outcome === 'success' ? '# A edited\n' : '# External\n'); expect(f.buffer.dirty).toBe(outcome !== 'success');
  });

  it.each(['other tab', 'away then back'].flatMap(navigation => ['success', 'conflict'].map(outcome => ({ navigation, outcome }))))('cancels old intent after $navigation with late $outcome', async ({ navigation, outcome }) => {
    const f = await fixture(); f.edit('# A edited\n'); const gate = f.hold(), change = settled(f.store.setMode(f.buffer, 'source')); await gate.ready.promise;
    f.store.activate(f.b.id); if (navigation === 'away then back') f.store.activate(f.a.id);
    if (outcome === 'conflict') writeFileSync(f.path, '# External\n'); gate.release.resolve(); const result = await change; await f.idle();
    const final = f.state(); rows.push({ scenario: 'navigation during mode save', navigation, outcome, result, final, receipts: f.receipts, nativeSaves: f.broker.saves.length });
    expect(result.status).toBe('fulfilled'); expect(final.aMode).toBe('document'); expect(final.aRouteMode).toBe('document'); expect(final.active).toBe(navigation === 'other tab' ? 'b.md' : 'a.md');
    expect(final.bMode).toBe('document'); expect(final.bRaw).toBe('# B base\n'); expect(final.bDisk).toBe('# B base\n');
    expect(final.aDisk).toBe(outcome === 'success' ? '# A edited\n' : '# External\n'); expect(final.aDirty).toBe(outcome !== 'success');
  });

  it('honors a newer explicit request to remain in the current mode while the older request saves', async () => {
    const f = await fixture(); f.edit('# A edited\n'); const gate = f.hold(), older = settled(f.store.setMode(f.buffer, 'source')); await gate.ready.promise;
    await f.store.setMode(f.buffer, 'document'); gate.release.resolve(); const result = await older; await f.idle();
    rows.push({ scenario: 'new mode intent supersedes old pending mode', result, final: f.state(), receipts: f.receipts });
    expect(result.status).toBe('fulfilled'); expect(f.buffer.mode).toBe('document'); expect(f.a.route.mode).toBe('document'); expect(f.buffer.dirty).toBe(false); expect(readFileSync(f.path, 'utf8')).toBe('# A edited\n');
  });

  it.each(['keep latest input', 'return to current base'] as const)('cancels an old switch when a new real save replaces the awaited operation: %s', async input => {
    const f = await fixture(); f.edit('# First\n'); const firstGate = f.hold(), first = f.buffer.save(); await firstGate.ready.promise;
    let newer: Promise<boolean> | undefined;
    void first.then(() => { f.edit('# Second\n'); newer = f.buffer.save(); if (input === 'return to current base') f.edit('# First\n'); });
    const older = settled(f.store.setMode(f.buffer, 'source')), secondGate = f.hold(); firstGate.release.resolve(); await secondGate.ready.promise;
    const result = await older, whileSecondPending = f.state(); secondGate.release.resolve(); await until(() => newer !== undefined); const newerSaved = await newer; await f.idle();
    rows.push({ scenario: 'new active native save before old switch continuation', input, result, whileSecondPending, newerSaved, final: f.state(), receipts: f.receipts, nativeSaves: f.broker.saves.length });
    expect(result.status).toBe('fulfilled'); expect(whileSecondPending.aMode).toBe('document'); expect(whileSecondPending.aDisk).toBe('# First\n'); expect(whileSecondPending.aDirty).toBe(input === 'keep latest input');
    expect(f.buffer.mode).toBe('document'); expect(f.buffer.raw).toBe(input === 'keep latest input' ? '# Second\n' : '# First\n'); expect(readFileSync(f.path, 'utf8')).toBe('# Second\n'); expect(newerSaved).toBe(input === 'keep latest input'); expect(f.buffer.dirty).toBe(input !== 'keep latest input'); expect(f.broker.saves).toHaveLength(2);
  });
});
