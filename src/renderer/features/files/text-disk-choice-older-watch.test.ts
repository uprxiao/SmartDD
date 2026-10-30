// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileBuffer } from '@renderer/features/files/file-buffer';
const api = vi.hoisted(() => Object.fromEntries([
  'read', 'refresh', 'checkpoint', 'save', 'drafts', 'readDraft', 'resolveDraft', 'closeDocument',
].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const B = 'G246 older B original', L = 'G246 older L local 中文';
const D0 = 'G246 older D0 stale watch', D1 = 'G246 older D1 fresh disk choice';
const file = { ref: { id: 'g246-older-source', lease: 'g246-older-root', generation: 1 },
  name: 'source.txt', relativePath: 'source.txt', absolutePath: '/synthetic/g246-older/source.txt',
  documentKey: 'local:246:2', writable: true,
  revision: { device: '1', inode: '247', size: Buffer.byteLength(B), hash: sha(B), modifiedNs: '1', changedNs: '1' } };
const read = (raw: string, sequence: number) => ({ document: { ...structuredClone(file), revision: {
  ...file.revision, size: Buffer.byteLength(raw), hash: sha(raw), modifiedNs: String(sequence), changedNs: String(sequence),
} }, base64: Buffer.from(raw).toString('base64') });
let buffer: FileBuffer | undefined;
afterEach(() => { buffer?.dispose(); vi.useRealTimers(); });
it('does not let a D0 watch already in flight before the disk choice overwrite its accepted fresh D1', async () => {
  vi.resetAllMocks();
  const events: { seq: number; name: string }[] = [];
  const event = (name: string) => events.push({ seq: events.length, name });
  const snapshot = () => ({ raw: buffer!.raw, dirty: buffer!.dirty, conflict: buffer!.conflict,
    version: buffer!.version, baseHash: buffer!.baseHash, sourceUnavailable: buffer!.sourceUnavailable,
    saving: buffer!.saving, diskHash: buffer!.disk?.document.revision.hash ?? null,
    diskRaw: buffer!.disk ? Buffer.from(buffer!.disk.base64, 'base64').toString('utf8') : null });
  api.read.mockResolvedValueOnce(read(B, 1)); api.drafts.mockResolvedValue([]); api.closeDocument.mockResolvedValue(undefined);
  api.resolveDraft.mockImplementation(async () => { event('explicit-choice-discard-request'); return { resolved: true }; });
  api.save.mockImplementation(async () => { event('unexpected-save'); throw new Error('No source save belongs to this scenario'); });
  const checkpointInputs: any[] = [];
  api.checkpoint.mockImplementation(async input => { event('safe-checkpoint-request'); checkpointInputs.push(structuredClone(input));
    return { draftId: input.draftId, bufferVersion: input.bufferVersion, hash: sha(Buffer.from(input.base64, 'base64').toString('utf8')) }; });
  const recoveryRoute = vi.fn(async () => undefined);
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined, recoveryRoute);
  await buffer.load(); vi.useFakeTimers();
  let userTransactions = 0;
  const tr = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: L } });
  buffer.acceptTransactions(tr.state, [tr]); userTransactions++;
  // A completed public refresh first creates the real D0 conflict/choice producer.
  api.refresh.mockResolvedValueOnce(read(D0, 2).document); api.read.mockResolvedValueOnce(read(D0, 2));
  await buffer.refresh();
  expect(snapshot()).toMatchObject({ raw: L, dirty: true, conflict: true, baseHash: sha(B), diskHash: sha(D0), sourceUnavailable: '', saving: false });
  const safeReceipt = await buffer.checkpoint();
  expect(safeReceipt).not.toBeNull();
  let deliverD0!: (value: unknown) => void, oldWatchSettled = false;
  api.refresh.mockResolvedValueOnce(read(D0, 2).document);
  api.read.mockImplementationOnce(() => { event('older-watch-D0-read-request'); return new Promise(resolve => { deliverD0 = resolve; }); });
  event('public-older-watch-refresh-start');
  const watching = buffer.refresh().then(() => { oldWatchSettled = true; event('older-watch-refresh-settled'); });
  await vi.waitFor(() => expect(deliverD0).toBeTypeOf('function'), { timeout: 1000, interval: 1 });
  expect(oldWatchSettled).toBe(false);
  const oldWatchInFlight = snapshot();
  api.read.mockImplementationOnce(async () => { event('fresh-choice-D1-read-reply'); return read(D1, 3); });
  event('public-useDisk-fresh-D1-start');
  const choiceResult = await buffer.useDisk();
  event('public-useDisk-fresh-D1-settled');
  const afterChoice = snapshot(), chosenEditor = buffer.editor;
  expect({ choiceResult, oldWatchSettled, raw: afterChoice.raw, dirty: afterChoice.dirty,
    conflict: afterChoice.conflict, baseHash: afterChoice.baseHash }).toEqual({
    choiceResult: true, oldWatchSettled: false, raw: D1, dirty: false, conflict: false, baseHash: sha(D1) });
  event('older-watch-D0-read-reply'); deliverD0(read(D0, 2));
  await watching;
  const final = snapshot();
  const observed = { raw: final.raw, dirty: final.dirty, conflict: final.conflict, baseHash: final.baseHash,
    diskHash: final.diskHash, sameChosenEditor: buffer.editor === chosenEditor,
    noSourceRevoke: final.sourceUnavailable === '', noNewUserInput: userTransactions === 1,
    noSourceSave: api.save.mock.calls.length === 0,
    safeCheckpoint: checkpointInputs.length === 1 && checkpointInputs[0].baseHash === sha(B)
      && Buffer.from(checkpointInputs[0].base64, 'base64').toString('utf8') === L
      && safeReceipt!.draftId === buffer.draftId && recoveryRoute.mock.calls.length === 1 };
  const root = process.env.G246_ARTIFACT_DIR; if (root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'older-watch-observation.json'), JSON.stringify({
    layer: 'real UTF8 FileBuffer renderer-I; API transport fixture, no filesystem/native claim',
    events, oldWatchInFlight, checkpointInputs, safeReceipt, choiceResult, afterChoice, final, observed,
    resolveDraftInputs: api.resolveDraft.mock.calls.map(call => call[0]),
  }, null, 2) + '\n');
  }
  expect(observed).toEqual({ raw: D1, dirty: false, conflict: false, baseHash: sha(D1), diskHash: null,
    sameChosenEditor: true, noSourceRevoke: true, noNewUserInput: true, noSourceSave: true, safeCheckpoint: true });
});
