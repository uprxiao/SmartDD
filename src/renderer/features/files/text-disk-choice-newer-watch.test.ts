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
const B = 'G246 B original', L = 'G246 L local 中文', D1 = 'G246 D1 disk choice', D2 = 'G246 D2 later watch';
const file = { ref: { id: 'g246-source', lease: 'g246-root', generation: 1 },
  name: 'source.txt', relativePath: 'source.txt', absolutePath: '/synthetic/g246/source.txt',
  documentKey: 'local:246:1', writable: true,
  revision: { device: '1', inode: '246', size: Buffer.byteLength(B), hash: sha(B), modifiedNs: '1', changedNs: '1' } };
const read = (raw: string, sequence: number) => ({ document: { ...structuredClone(file), revision: {
  ...file.revision, size: Buffer.byteLength(raw), hash: sha(raw), modifiedNs: String(sequence), changedNs: String(sequence),
} }, base64: Buffer.from(raw).toString('base64') });
let buffer: FileBuffer | undefined;
afterEach(() => { buffer?.dispose(); vi.useRealTimers(); });
it('accounts for D2 watch started after a disk choice while that choice awaited its real checkpoint', async () => {
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
  const recoveryRoute = vi.fn(async () => { event('safe-checkpoint-recovery-route'); });
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined, recoveryRoute);
  await buffer.load(); vi.useFakeTimers();
  let userTransactions = 0;
  const tr = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: L } });
  buffer.acceptTransactions(tr.state, [tr]); userTransactions++;
  api.refresh.mockResolvedValueOnce(read(D1, 2).document); api.read.mockResolvedValueOnce(read(D1, 2));
  await buffer.refresh();
  expect(snapshot()).toMatchObject({ raw: L, dirty: true, conflict: true, baseHash: sha(B), diskHash: sha(D1), sourceUnavailable: '', saving: false });
  let deliverCheckpoint!: (value: unknown) => void;
  let checkpointPending = true;
  api.checkpoint.mockImplementationOnce(() => { event('real-checkpoint-request'); return new Promise(resolve => { deliverCheckpoint = resolve; }); });
  const checkpointing = buffer.checkpoint();
  expect(deliverCheckpoint).toBeTypeOf('function');
  const checkpointInput = structuredClone(api.checkpoint.mock.calls[0][0]);
  let choiceReadReturned = false, choiceSettled = false;
  api.read.mockImplementationOnce(async () => { event('choice-D1-read-reply'); choiceReadReturned = true; return read(D1, 2); });
  event('public-useDisk-start');
  const adopting = buffer.useDisk().then(value => { choiceSettled = true; event('public-useDisk-settled'); return value; });
  await Promise.resolve(); await Promise.resolve();
  expect({ choiceReadReturned, choiceSettled, checkpointPending, discardRequests: api.resolveDraft.mock.calls.length }).toEqual({ choiceReadReturned: true, choiceSettled: false, checkpointPending: true, discardRequests: 0 });
  const choiceWaiting = { ...snapshot(), choiceReadReturned, choiceSettled, checkpointPending };
  let deliverD2!: (value: unknown) => void;
  api.refresh.mockResolvedValueOnce(read(D2, 3).document);
  api.read.mockImplementationOnce(() => { event('later-watch-D2-read-request'); return new Promise(resolve => { deliverD2 = resolve; }); });
  event('public-later-watch-refresh-start');
  const watching = buffer.refresh().then(() => { event('later-watch-refresh-settled'); });
  await vi.waitFor(() => expect(deliverD2).toBeTypeOf('function'), { timeout: 1000, interval: 1 });
  expect(choiceSettled).toBe(false); expect(checkpointPending).toBe(true);
  const D2InFlightBeforeCheckpoint = snapshot();
  const receipt = { draftId: checkpointInput.draftId, bufferVersion: checkpointInput.bufferVersion,
    hash: sha(Buffer.from(checkpointInput.base64, 'base64').toString('utf8')) };
  event('checkpoint-reply'); checkpointPending = false; deliverCheckpoint(receipt);
  const checkpointReceipt = await checkpointing;
  const choiceResult = await adopting;
  const afterChoice = snapshot();
  event('later-watch-D2-read-reply'); deliverD2(read(D2, 3));
  await watching;
  const final = snapshot();
  const cleanD2 = final.raw === D2 && !final.dirty && !final.conflict && final.baseHash === sha(D2);
  const retainedLWithD2 = final.raw === L && final.dirty && final.conflict && final.diskHash === sha(D2) && final.diskRaw === D2;
  const observed = { latestD2Accounted: cleanD2 || retainedLWithD2,
    noSourceRevoke: final.sourceUnavailable === '', noNewUserInput: userTransactions === 1,
    noSourceSave: api.save.mock.calls.length === 0,
    safeCheckpoint: checkpointInput.baseHash === sha(B)
      && Buffer.from(checkpointInput.base64, 'base64').toString('utf8') === L
      && checkpointReceipt?.draftId === buffer.draftId && recoveryRoute.mock.calls.length === 1 };
  const root = process.env.G246_ARTIFACT_DIR; if (root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'consumer-observation.json'), JSON.stringify({
    layer: 'real UTF8 FileBuffer renderer-I; API transport fixture, no actual filesystem/native claim',
    events, choiceWaiting, D2InFlightBeforeCheckpoint, checkpointInput, checkpointReceipt,
    choiceResult, afterChoice, final, safeAlternatives: { cleanD2, retainedLWithD2 }, observed,
    resolveDraftInputs: api.resolveDraft.mock.calls.map(call => call[0]),
  }, null, 2) + '\n');
  }
  expect(observed).toEqual({ latestD2Accounted: true, noSourceRevoke: true, noNewUserInput: true,
    noSourceSave: true, safeCheckpoint: true });
});
