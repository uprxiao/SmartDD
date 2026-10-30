import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FileSaveReceipt } from '@shared/files';
import { FileService } from '@main/core/files/file-service';
import { FileRootsService } from '@main/core/files/roots';
import { FileRecoveryStore, recoveryProjectKey } from '@main/core/files/recovery-store';
import { NativeFileBroker, type BrokerOptions } from '@main/core/files/native-broker';
import { FileBuffer } from './file-buffer';

const BASE = 'BASE\r\n', LOCAL = 'Local candidate 中文🙂\r\n', DIFFERENT = 'External different 内容\r\n', DISPLACED = 'External change through the old descriptor\n';
const sha = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
const disk = (path: string) => { const stat = statSync(path, { bigint: true }), bytes = readFileSync(path); return { text: bytes.toString('utf8'), hash: sha(bytes), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs), inode: String(stat.ino), size: String(stat.size) }; };
const until = async (condition: () => boolean) => { const end = Date.now() + 6000; while (!condition()) { if (Date.now() > end) throw new Error('H19 native IO did not settle'); await delay(5); } };
let build = '', testBroker = '';
const rows: unknown[] = [], fixtures: { cleanup(): Promise<void> }[] = [];
const output: Record<string, unknown> = { caseId: 'M9-T-H19', startedAt: new Date().toISOString(), rows };
class ObservedBroker extends NativeFileBroker {
  saves: Record<string, unknown>[] = []; stops: string[] = []; receipts: FileSaveReceipt[] = [];
  constructor(executable: string, readonly path: string, readonly oldFd: number | null, readonly differentAfterConflict: boolean) { super(executable); }
  override async request<T>(input: Record<string, unknown>, options: BrokerOptions = {}): Promise<T> {
    if (input.operation !== 'save') return super.request<T>(input, options);
    this.saves.push(input);
    const result = await super.request<T>({ ...input, ...(this.oldFd !== null ? { testStopAt: 'swapped' } : {}) }, { ...options, onTestStop: (phase, child) => {
      this.stops.push(phase); writeSync(this.oldFd!, DISPLACED, 0, 'utf8'); child.kill('SIGCONT');
    } });
    this.receipts.push(result as FileSaveReceipt);
    // This writer runs only after the real broker has returned its displaced
    // conflict, before FileBuffer performs its actual current-content reread.
    if (this.differentAfterConflict) { writeFileSync(this.path + '.external', DIFFERENT); renameSync(this.path + '.external', this.path); }
    return result;
  }
}
async function fixture(phase: 'precommit' | 'displaced', equal: boolean) {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-h19-fixture-'))), project = join(directory, 'project'), userdata = join(directory, 'userdata'); mkdirSync(project); mkdirSync(userdata);
  const path = join(project, 'source.txt'); writeFileSync(path, BASE);
  const fd = phase === 'displaced' ? openSync(path, 'r+') : null;
  const executable = phase === 'displaced' ? testBroker : process.env.SMARTDD_M9_FILE_BROKER!;
  const broker = new ObservedBroker(executable, path, fd, phase === 'displaced' && !equal);
  const resolver = { sources: () => [{ kind: 'project-directory' as const, id: 'root', path: project, label: 'H19 isolated source', projectId: 'h19' }] };
  const recovery = new FileRecoveryStore(broker, userdata, resolver), service = new FileService(new FileRootsService(resolver, broker), broker, recovery);
  const root = (await service.openScope('h19', { kind: 'project', projectId: 'h19' })).roots[0];
  const file = await service.open('h19', { lease: root.lease, generation: root.generation, relativePath: 'source.txt' });
  const pending = new Set<Promise<unknown>>(); const readValues: string[] = [];
  const wrap = async <T,>(fn: () => Promise<T>) => { const p = fn(); pending.add(p); try { return await p; } finally { pending.delete(p); } };
  const api: ConstructorParameters<typeof FileBuffer>[1] = {
    read: ref => wrap(async () => { const read = await service.read('h19', ref); readValues.push(Buffer.from(read.base64, 'base64').toString('utf8')); return read; }), refresh: ref => wrap(() => service.refresh('h19', ref)),
    save: vi.fn(input => wrap(() => service.save('h19', input))), checkpoint: vi.fn(input => wrap(() => service.checkpoint('h19', input))),
    drafts: async ref => service.drafts('h19', ref), readDraft: (ref, id) => wrap(() => service.readDraft('h19', ref, id)), resolveDraft: input => wrap(() => service.resolveDraft('h19', input)), closeDocument: async ref => service.closeDocument('h19', ref),
  };
  const buffer = new FileBuffer(file, api, () => undefined); await buffer.load();
  const state = () => ({ raw: buffer.raw, baseHash: buffer.baseHash, dirty: buffer.dirty, conflict: buffer.conflict, recoveryBlocked: buffer.recoveryBlocked, saveError: buffer.saveError, saveReceipt: buffer.saveReceipt && structuredClone(buffer.saveReceipt), diskHash: buffer.disk?.document.revision.hash ?? null });
  const f = { path, project, userdata, broker, buffer, api, service, readValues, state,
    idle: () => until(() => pending.size === 0 && broker.activeProcesses === 0 && !buffer.saving),
    cleanup: async () => { buffer.dispose(); await until(() => pending.size === 0 && broker.activeProcesses === 0); service.closeOwner('h19'); await service.watcher.dispose(); broker.dispose(); if (fd !== null) closeSync(fd); rmSync(directory, { recursive: true, force: true }); },
  }; fixtures.push(f); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const edit = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: LOCAL }, userEvent: 'input.type' }); buffer.acceptTransactions(edit.state, [edit]);
  return f;
}
beforeAll(() => {
  build = realpathSync(mkdtempSync(join(tmpdir(), 'willyou-h19-test-broker-'))); testBroker = join(build, 'willyou-files-test');
  const command = ['clang++', '-std=c++17', '-fobjc-arc', '-O1', '-Wno-deprecated-declarations', '-DWILLYOU_FILE_BROKER_TEST=1', '-framework', 'Foundation', '-framework', 'AppKit', '-framework', 'ImageIO', '-framework', 'CoreGraphics', '-framework', 'CoreText', resolve('native/files/broker.mm'), '-o', testBroker];
  execFileSync('xcrun', command, { timeout: 120000 });
  output.native = { source: 'native/files/broker.mm', sourceSha256: sha(readFileSync('native/files/broker.mm')), testBroker, testBrokerSha256: sha(readFileSync(testBroker)), compile: ['xcrun', ...command], productionBroker: process.env.SMARTDD_M9_FILE_BROKER, productionBrokerSha256: sha(readFileSync(process.env.SMARTDD_M9_FILE_BROKER!)), boundary: 'Separate helper compiles unchanged production source with existing WILLYOU_FILE_BROKER_TEST suspension hook; no fake saved/conflict response. Precommit cases use actual packaged r6 helper.' };
}, 120_000);
afterEach(async () => { for (const f of fixtures.splice(0)) await f.cleanup(); vi.useRealTimers(); });
afterAll(() => { if (process.env.SMARTDD_H19_EVIDENCE) writeFileSync(process.env.SMARTDD_H19_EVIDENCE, JSON.stringify({ ...output, finishedAt: new Date().toISOString() }, null, 2) + '\n'); rmSync(build, { recursive: true, force: true }); });
const cases = (['precommit', 'displaced'] as const).flatMap(phase => [true, false].map(equal => ({ phase, equal })));
describe.skipIf(process.platform !== 'darwin' || !process.env.SMARTDD_M9_FILE_BROKER)('M9 H19 ordinary vs post-exchange conflict authority', () => {
  it.each(cases)('$phase conflict / current equals candidate=$equal', async ({ phase, equal }) => {
    const f = await fixture(phase, equal);
    if (phase === 'precommit') writeFileSync(f.path, equal ? LOCAL : DIFFERENT);
    const before = disk(f.path); expect(await f.buffer.save()).toBe(false); await f.idle();
    const receipt = structuredClone(f.buffer.saveReceipt!), afterSave = disk(f.path), afterState = f.state();
    expect(receipt.state).toBe('conflict'); expect(f.buffer.raw).toBe(LOCAL); expect(f.buffer.baseHash).toBe(sha(BASE)); expect(f.readValues.at(-1)).toBe(equal ? LOCAL : DIFFERENT);
    expect(f.buffer.conflict).toBe(true); expect(f.buffer.dirty).toBe(true);
    if (phase === 'precommit') {
      expect(receipt.recoveryId).toBeUndefined(); expect(f.buffer.recoveryBlocked).toBe(false); expect(f.broker.saves).toHaveLength(0); expect(afterSave).toEqual(before);
      await f.buffer.refresh(); await f.idle();
      if (equal) {
        // The implementation conservatively returns conflict first. A separate
        // authoritative refresh converges exact D=L without forging a saved ack.
        expect(f.buffer.dirty).toBe(false); expect(f.buffer.conflict).toBe(false); expect(f.buffer.baseHash).toBe(afterSave.hash); expect(f.buffer.saveReceipt).toBeNull();
      } else { expect(f.buffer.dirty).toBe(true); expect(f.buffer.conflict).toBe(true); expect(f.buffer.baseHash).toBe(sha(BASE)); }
      await vi.advanceTimersByTimeAsync(3500); await f.idle(); expect(disk(f.path)).toEqual(afterSave); expect(f.api.save).toHaveBeenCalledTimes(1); expect(f.broker.saves).toHaveLength(0);
      rows.push({ phase, equal, before, afterSave, receipt, afterState, afterRefresh: f.state(), afterTimers: disk(f.path), readValues: f.readValues, sourceSaveCalls: f.broker.saves.length, conservativeOrdinaryEqualBehavior: equal ? 'save returns conflict; subsequent actual refresh proves exact raw+BOM and adopts authoritative revision, without a fabricated saved receipt' : null });
    } else {
      expect(f.broker.stops).toEqual(['swapped']); expect(receipt.recoveryId).toBeTruthy(); expect(receipt.message).toContain('Displaced'); expect(f.buffer.recoveryBlocked).toBe(true); expect(f.broker.saves).toHaveLength(1);
      const journalPath = join(f.userdata, 'file-recovery/v1', recoveryProjectKey('h19'), receipt.opId, 'journal.json');
      const journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      const paths = { current: f.path, displaced: join(f.project, journal.transactionLeaf, 'candidate'), materialized: join(f.project, journal.transactionLeaf, 'materialized'), draft: join(f.userdata, 'file-recovery/v1', recoveryProjectKey('h19'), receipt.opId, 'draft'), journal: journalPath };
      const versions = () => Object.fromEntries(Object.entries(paths).map(([name, path]) => [name, disk(path)]));
      const retained = versions(); expect(retained.current.text).toBe(equal ? LOCAL : DIFFERENT); expect(retained.displaced.text).toBe(DISPLACED); expect(retained.materialized.text).toBe(LOCAL); expect(retained.draft.text).toBe(LOCAL); expect(journal.exchanged).toBe(true); expect(journal.state).toBe('conflict');
      await f.buffer.refresh(); await vi.advanceTimersByTimeAsync(3500); await f.idle(); expect(await f.buffer.save()).toBe(false); expect(await f.buffer.keepLocal()).toBe(false); await f.idle();
      expect(f.state()).toEqual(afterState); expect(versions()).toEqual(retained); expect(f.api.save).toHaveBeenCalledTimes(1); expect(f.broker.saves).toHaveLength(1);
      const recordDirectory = join(f.userdata, 'file-recovery/v1', recoveryProjectKey('h19'));
      expect(readdirSync(recordDirectory)).toContain(receipt.opId); expect(existsSync(paths.displaced)).toBe(true);
      rows.push({ phase, equal, before, afterSave, receipt, afterState, afterRefreshAndTimers: f.state(), readValues: f.readValues, versionsBeforeAndAfter: retained, journal, actualNativeStops: f.broker.stops, sourceSaveCalls: f.broker.saves.length, pauseAutoSaveAndExplicitOverwrite: true });
    }
  }, 20_000);
});
