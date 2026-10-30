import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as realTimeout } from 'node:timers/promises';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { undo } from '@codemirror/commands';
import type { FileCheckpointReceipt, FileDocument, FileRead, FileSaveInput, FileSaveReceipt } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileRecoveryStore } from '@main/core/files/recovery-store';
import { FileRootsService } from '@main/core/files/roots';
import { FileBuffer } from './file-buffer';

const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; };
const until = async (predicate: () => boolean) => {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for real native IO'); await realTimeout(2); }
};
const observations: Record<string, unknown>[] = [];
const fixtures: { cleanup(): Promise<void> }[] = [];
let clock = 0;
const advance = async (milliseconds: number) => { clock += milliseconds; await vi.advanceTimersByTimeAsync(milliseconds); };

class ObservedBroker extends NativeFileBroker {
  saveGate: ReturnType<typeof deferred<void>> | null = null;
  readonly saveRequests: Record<string, unknown>[] = [];
  readonly transactions: string[] = [];
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (input.operation === 'save') {
      this.saveRequests.push(input);
      const gate = this.saveGate; this.saveGate = null;
      if (gate) await gate.promise; // Delay dispatch; the actual production write still follows.
    }
    return super.request<T>(input, { ...options, onTransaction: (identity, opId) => {
      this.transactions.push(opId); options.onTransaction?.(identity, opId);
    } });
  }
}

async function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-text-acceptance-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata');
  mkdirSync(project); mkdirSync(userdata); const path = join(project, 'source.md'); writeFileSync(path, 'BASE\n');
  const executable = process.env.SMARTDD_M9_FILE_BROKER!;
  const broker = new ObservedBroker(executable), resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'Text acceptance', projectId: 'fixture' }] };
  const service = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
  const root = (await service.openScope('frame', { kind: 'project', projectId: 'fixture' })).roots[0];
  const doc = await service.open('frame', { lease: root.lease, generation: root.generation, relativePath: 'source.md' });
  const pending = new Set<Promise<unknown>>(), saved: { request: FileSaveInput; receipt: FileSaveReceipt; at: number }[] = [];
  const calls: { method: string; at: number }[] = [];
  const checkpoints: FileCheckpointReceipt[] = [];
  let activeSaves = 0, maxActiveSaves = 0;
  let delivery: { method: 'read' | 'refresh'; ready: ReturnType<typeof deferred<FileRead | FileDocument>>; release: ReturnType<typeof deferred<void>>; fail: boolean } | null = null;
  let checkpointDelivery: { version: number; ready: ReturnType<typeof deferred<FileCheckpointReceipt>>; release: ReturnType<typeof deferred<void>> } | null = null;
  const releases: (() => void)[] = [];
  async function invoke<T>(method: string, action: () => Promise<T>): Promise<T> {
    calls.push({ method, at: clock });
    const work = action(); pending.add(work);
    try { return await work; } finally { pending.delete(work); }
  }
  async function delivered<T extends FileRead | FileDocument>(method: 'read' | 'refresh', action: () => Promise<T>): Promise<T> {
    const hold = delivery?.method === method ? delivery : null;
    if (hold) delivery = null;
    const result = await action();
    if (hold) { hold.ready.resolve(result); await hold.release.promise; if (hold.fail) throw new Error('Injected late delivery error after real native read'); }
    return result;
  }
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: (ref) => invoke('read', () => delivered('read', () => service.read('frame', ref))),
    refresh: (ref) => invoke('refresh', () => delivered('refresh', () => service.refresh('frame', ref))),
    save: (request) => invoke('save', async () => {
      activeSaves++; maxActiveSaves = Math.max(maxActiveSaves, activeSaves);
      try { const receipt = await service.save('frame', request); saved.push({ request, receipt, at: clock }); return receipt; }
      finally { activeSaves--; }
    }),
    checkpoint: (request) => invoke('checkpoint', async () => {
      const hold = checkpointDelivery?.version === request.bufferVersion ? checkpointDelivery : null;
      if (hold) checkpointDelivery = null;
      const result = await service.checkpoint('frame', request); checkpoints.push(result);
      if (hold) { hold.ready.resolve(result); await hold.release.promise; }
      return result;
    }),
    drafts: async (ref) => service.drafts('frame', ref),
    readDraft: (ref, id) => service.readDraft('frame', ref, id),
    resolveDraft: (request) => invoke('resolveDraft', () => service.resolveDraft('frame', request)),
    closeDocument: async (ref) => service.closeDocument('frame', ref),
  };
  const changed = vi.fn(), buffer = new FileBuffer(doc, api, changed); await buffer.load();
  const f = {
    directory, project, userdata, path, broker, service, buffer, changed, calls, saved, checkpoints,
    disk: () => readFileSync(path, 'utf8'),
    count: (method: string) => calls.filter((call) => call.method === method).length,
    get maxActiveSaves() { return maxActiveSaves; },
    idle: async () => { await until(() => pending.size === 0 && !buffer.saving && broker.activeProcesses === 0); },
    replace: (text: string) => { const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: text } }); buffer.acceptTransactions(transaction.state, [transaction]); },
    external: (text: string) => { writeFileSync(path + '.new', text); renameSync(path + '.new', path); return { hash: hash(readFileSync(path)), inode: String(statSync(path, { bigint: true }).ino) }; },
    holdSave: () => { const gate = deferred<void>(); broker.saveGate = gate; releases.push(() => gate.resolve()); return gate; },
    holdDelivery: (method: 'read' | 'refresh', fail: boolean) => {
      const hold = { method, ready: deferred<FileRead | FileDocument>(), release: deferred<void>(), fail }; delivery = hold;
      releases.push(() => hold.release.resolve()); return hold;
    },
    holdCheckpoint: (version: number) => {
      const hold = { version, ready: deferred<FileCheckpointReceipt>(), release: deferred<void>() }; checkpointDelivery = hold;
      releases.push(() => hold.release.resolve()); return hold;
    },
    recoverDraftAfterRestart: async () => {
      const restarted = new FileService(new FileRootsService(resolver, broker), broker, new FileRecoveryStore(broker, userdata, resolver));
      let restored: FileBuffer | undefined;
      try {
        const root = (await restarted.openScope('restarted', { kind: 'project', projectId: 'fixture' })).roots[0];
        const reopened = await restarted.open('restarted', { lease: root.lease, generation: root.generation, relativePath: 'source.md' });
        await restarted.recovery.ready(); const recovered = await restarted.readDraft('restarted', reopened.ref, buffer.draftId);
        restored = new FileBuffer(reopened, {
          read: (ref) => restarted.read('restarted', ref), refresh: (ref) => restarted.refresh('restarted', ref),
          save: (input) => restarted.save('restarted', input), checkpoint: (input) => restarted.checkpoint('restarted', input),
          drafts: async (ref) => restarted.drafts('restarted', ref), readDraft: (ref, id) => restarted.readDraft('restarted', ref, id),
          resolveDraft: (input) => restarted.resolveDraft('restarted', input), closeDocument: async (ref) => restarted.closeDocument('restarted', ref),
        }, () => undefined);
        await restored.load(); await restored.restoreDraft(buffer.draftId);
        expect(restored.raw).toBe(Buffer.from(recovered.base64, 'base64').toString());
        expect(restored.baseHash).toBe(recovered.baseHash); expect(restored.dirty).toBe(true); expect(restored.conflict).toBe(false);
        return { ...recovered, restoredBuffer: { raw: restored.raw, baseHash: restored.baseHash, dirty: restored.dirty, conflict: restored.conflict } };
      } finally { restored?.dispose(); restarted.closeOwner('restarted'); }
    },
    cleanup: async () => { releases.forEach((release) => release()); await until(() => pending.size === 0 && broker.activeProcesses === 0); buffer.dispose(); service.closeOwner('frame'); broker.dispose(); rmSync(directory, { recursive: true, force: true }); },
  };
  fixtures.push(f); return f;
}

afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); clock = 0; });
afterAll(() => {
  if (process.env.SMARTDD_M9_TEXT_ACCEPTANCE_EVIDENCE) writeFileSync(process.env.SMARTDD_M9_TEXT_ACCEPTANCE_EVIDENCE, JSON.stringify({
    observedAt: new Date().toISOString(), platform: process.platform, arch: process.arch,
    executable: process.env.SMARTDD_M9_FILE_BROKER, executableSha256: hash(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)),
    level: 'Actual FileBuffer → FileService/recovery → packaged production broker → independent filesystem checks; no GUI. Only timing and delivery ordering are controlled.', observations,
  }, null, 2) + '\n');
});

describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9 text buffer production acceptance', () => {
  it('M9-T-H04 resets 3000ms autosave on repeated edits and never overlaps a suspended real save', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.replace('FIRST\n'); await advance(2999); await f.idle();
    expect(f.count('save')).toBe(0); expect(f.disk()).toBe('BASE\n');
    f.replace('SECOND\n'); await advance(1); await f.idle(); // old 3000ms deadline must be cancelled.
    expect(f.count('save')).toBe(0);
    await advance(2998); await f.idle(); expect(f.count('save')).toBe(0);
    const firstGate = f.holdSave(); await advance(1);
    await until(() => f.broker.saveRequests.length === 1);
    expect(clock).toBe(5999); expect(f.count('save')).toBe(1); expect(f.disk()).toBe('BASE\n');
    f.replace('THIRD\n'); await advance(1000); f.replace('FOURTH\n'); await advance(2999);
    expect(f.count('save')).toBe(1); await advance(1); expect(f.count('save')).toBe(1);
    firstGate.resolve(); await f.idle();
    expect(f.disk()).toBe('SECOND\n'); expect(f.buffer.dirty).toBe(true); expect(f.buffer.raw).toBe('FOURTH\n');
    await advance(2999); await f.idle(); expect(f.count('save')).toBe(1);
    await advance(1); await f.idle();
    expect(f.count('save'), `draft=${f.buffer.draftError}; save=${f.buffer.saveError}; version=${f.buffer.version}; saved=${f.buffer.savedVersion}`).toBe(2); expect(f.maxActiveSaves).toBe(1);
    expect(f.disk()).toBe('FOURTH\n'); expect(f.buffer.dirty).toBe(false);
    expect(f.saved.map(({ request }) => request.baseHash)).toEqual([hash('BASE\n'), hash('SECOND\n')]);
    expect(f.saved.map(({ receipt }) => receipt.revision?.hash)).toEqual([hash('SECOND\n'), hash('FOURTH\n')]);
    expect(f.broker.transactions).toHaveLength(2);
    observations.push({ case: 'M9-T-H04', calls: f.calls, saved: f.saved, maxActiveSaves: f.maxActiveSaves, finalBytes: f.disk(), transactions: f.broker.transactions });
  });

  it('M9-T-H07 merges concurrent save requests behind one real write and commits the newer buffer against its returned revision', async () => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.replace('FIRST\n'); const gate = f.holdSave(), first = f.buffer.save();
    await until(() => f.broker.saveRequests.length === 1);
    f.replace('SECOND\n'); const second = f.buffer.save(), third = f.buffer.save();
    await realTimeout(5);
    expect(f.count('save')).toBe(1); expect(f.maxActiveSaves).toBe(1); expect(f.disk()).toBe('BASE\n');
    gate.resolve(); expect(await Promise.all([first, second, third])).toEqual([false, false, false]); await f.idle();
    expect(f.buffer.baseRaw).toBe('FIRST\n'); expect(f.buffer.baseHash).toBe(hash('FIRST\n'));
    expect(f.buffer.raw).toBe('SECOND\n'); expect(f.buffer.dirty).toBe(true);
    await advance(2999); await f.idle(); expect(f.count('save')).toBe(1);
    await advance(1); await f.idle();
    expect(f.count('save')).toBe(2); expect(f.maxActiveSaves).toBe(1); expect(f.broker.transactions).toHaveLength(2);
    expect(f.saved[1].request.baseHash).toBe(f.saved[0].receipt.revision!.hash);
    expect(f.buffer.baseHash).toBe(hash('SECOND\n')); expect(f.buffer.raw).toBe(f.disk()); expect(f.buffer.dirty).toBe(false);
    observations.push({ case: 'M9-T-H07', concurrentRequests: 3, nativeWrites: f.broker.saveRequests.length, maxActiveSaves: f.maxActiveSaves, saved: f.saved, finalBytes: f.disk() });
  });

  it.each([2, 3])('M9-DEV-034 preserves rebased durable input when checkpoint v%i arrives after the newer checkpoint', async (lateVersion) => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    f.replace('FIRST\n'); const writeGate = f.holdSave(), firstSave = f.buffer.save();
    await until(() => f.broker.saveRequests.length === 1);
    const late = f.holdCheckpoint(lateVersion);
    f.replace('SECOND\n'); await advance(500); await until(() => f.checkpoints.some((receipt) => receipt.bufferVersion === 2));
    f.replace('THIRD 中文\n'); await advance(500); await until(() => f.checkpoints.some((receipt) => receipt.bufferVersion === 3));
    await late.ready.promise;
    const beforeRebase = await f.recoverDraftAfterRestart();
    expect(beforeRebase.bufferVersion).toBe(3); expect(beforeRebase.baseHash).toBe(hash('BASE\n'));
    expect(Buffer.from(beforeRebase.base64, 'base64').toString()).toBe('THIRD 中文\n');
    writeGate.resolve(); expect(await firstSave).toBe(false);
    expect(f.buffer.baseHash).toBe(hash('FIRST\n')); expect(f.buffer.version).toBeGreaterThan(3);
    await advance(500); await until(() => f.checkpoints.some((receipt) => receipt.bufferVersion === f.buffer.version));
    const recovered = await f.recoverDraftAfterRestart();
    expect(recovered.bufferVersion).toBe(f.buffer.version); expect(recovered.baseHash).toBe(hash('FIRST\n'));
    expect(Buffer.from(recovered.base64, 'base64').toString()).toBe('THIRD 中文\n');
    const durableVersion = f.buffer.draftVersion;
    late.release.resolve(); await f.idle();
    expect(f.buffer.draftVersion).toBe(durableVersion); expect(f.buffer.draftError).toBe('');
    await advance(2499); await f.idle(); expect(f.count('save')).toBe(1);
    await advance(1); await f.idle();
    expect(f.count('save')).toBe(2); expect(f.disk()).toBe('THIRD 中文\n'); expect(f.buffer.dirty).toBe(false);
    expect(f.saved[1].request.baseHash).toBe(hash('FIRST\n')); expect(f.saved[1].receipt.revision?.hash).toBe(hash('THIRD 中文\n'));
    expect(f.maxActiveSaves).toBe(1); expect(f.broker.transactions).toHaveLength(2);
    observations.push({ case: ['M9-T-H04', 'M9-T-H07'], defect: 'M9-DEV-034', lateCheckpointVersion: lateVersion, durableBeforeRebase: beforeRebase, durableAfterRebase: recovered, finalSaved: f.saved[1], finalBytes: f.disk() });
  });

  it.each(['before', 'after'] as const)('M9-DEV-035 retains the new durable draft when an old clean cleanup resumes %s its checkpoint', async (oldReceiptOrder) => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const late = f.holdCheckpoint(1);
    f.replace('FIRST\n'); await advance(500); await late.ready.promise;
    expect(undo({ state: f.buffer.editor!, dispatch: (transaction) => f.buffer.acceptTransactions(transaction.state, [transaction]) })).toBe(true);
    expect(f.buffer.raw).toBe('BASE\n'); expect(f.buffer.dirty).toBe(false); expect(f.buffer.version).toBe(2);
    f.replace('NEWEST 中文\n'); expect(f.buffer.version).toBe(3);
    if (oldReceiptOrder === 'before') { late.release.resolve(); await f.idle(); }
    await advance(500); await until(() => f.checkpoints.some((receipt) => receipt.bufferVersion === 3));
    const beforeLate = await f.recoverDraftAfterRestart(); expect(beforeLate.bufferVersion).toBe(3);
    late.release.resolve(); await f.idle();
    expect(f.disk()).toBe('BASE\n'); expect(f.count('save')).toBe(0);
    expect(f.buffer.raw).toBe('NEWEST 中文\n'); expect(f.buffer.dirty).toBe(true);
    const recovered = await f.recoverDraftAfterRestart();
    expect(recovered.bufferVersion).toBe(3); expect(recovered.restoredBuffer.raw).toBe('NEWEST 中文\n');
    expect(recovered.baseHash).toBe(hash('BASE\n')); expect(f.buffer.draftError).toBe('');
    expect(f.count('resolveDraft')).toBe(0);
    await advance(2499); await f.idle(); expect(f.count('save')).toBe(0);
    await advance(1); await f.idle();
    expect(f.disk()).toBe('NEWEST 中文\n'); expect(f.buffer.dirty).toBe(false); expect(f.broker.transactions).toHaveLength(1);
    observations.push({ case: ['M9-T-H04', 'M9-T-H07'], defect: 'M9-DEV-035', oldReceiptOrder, recoveredBeforeAutosave: recovered, finalSaved: f.saved, finalBytes: f.disk() });
  });

  it.each(['automatic', 'explicit'] as const)('M9-DEV-035 still resolves the intended draft for %s discard', async (discard) => {
    const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const late = f.holdCheckpoint(1);
    f.replace('FIRST\n'); await advance(500); await late.ready.promise;
    let closed: Promise<boolean> | undefined;
    if (discard === 'automatic') {
      expect(undo({ state: f.buffer.editor!, dispatch: (transaction) => f.buffer.acceptTransactions(transaction.state, [transaction]) })).toBe(true);
      expect(f.buffer.dirty).toBe(false);
    } else { closed = f.buffer.prepareClose('discard'); expect(f.buffer.dirty).toBe(true); }
    expect(f.count('resolveDraft')).toBe(0); late.release.resolve();
    if (closed) expect(await closed).toBe(true);
    await f.idle();
    expect(f.count('resolveDraft')).toBe(1); expect(f.service.drafts('frame', f.buffer.file.ref)).toEqual([]);
    expect(f.disk()).toBe('BASE\n'); expect(f.count('save')).toBe(0); expect(f.buffer.draftError).toBe('');
    observations.push({ case: ['M9-T-H04', 'M9-T-H07'], defect: 'M9-DEV-035', discard, resolvedDraftCount: f.count('resolveDraft'), finalBytes: f.disk() });
  });

  it.each(['refresh', 'read'] as const)('M9-T-H21 keeps r2 when an older %s response/error arrives late, including after disposal', async (method) => {
    for (const fail of [false, true]) for (const dispose of [false, true]) {
      const f = await fixture(), oldVersion = f.external('EXTERNAL R1\n'), hold = f.holdDelivery(method, fail);
      const r1 = f.buffer.refresh(); await hold.ready.promise;
      const latestVersion = f.external('EXTERNAL R2 中文\n'), r2 = f.buffer.refresh(); await r2;
      expect(f.buffer.raw).toBe('EXTERNAL R2 中文\n'); expect(f.buffer.baseHash).toBe(latestVersion.hash);
      expect(f.buffer.file.revision.inode).toBe(latestVersion.inode); expect(f.buffer.loadError).toBe('');
      expect(latestVersion.inode).not.toBe(oldVersion.inode);
      if (dispose) f.buffer.dispose();
      const notifications = f.changed.mock.calls.length, state = { raw: f.buffer.raw, baseHash: f.buffer.baseHash, revision: { ...f.buffer.file.revision }, error: f.buffer.loadError };
      hold.release.resolve(); await r1;
      expect({ raw: f.buffer.raw, baseHash: f.buffer.baseHash, revision: f.buffer.file.revision, error: f.buffer.loadError }).toEqual(state);
      expect(f.changed).toHaveBeenCalledTimes(notifications); expect(f.disk()).toBe('EXTERNAL R2 中文\n');
      expect(f.count('save')).toBe(0); expect(f.broker.transactions).toEqual([]);
      observations.push({ case: 'M9-T-H21', delayedStage: method, lateResult: fail ? 'delivery error' : 'real earlier snapshot', disposedBeforeDelivery: dispose, oldVersion, latestVersion, final: state, diskHash: hash(readFileSync(f.path)), notificationsAfterLateDelivery: f.changed.mock.calls.length - notifications });
    }
  });
});
