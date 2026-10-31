// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileBuffer } from '@renderer/features/files/file-buffer';

// Public real FileBuffer, CM EditorState and source field; only API transport isolated.
const api = vi.hoisted(() => Object.fromEntries([
  'read', 'refresh', 'save', 'checkpoint', 'drafts', 'readDraft', 'resolveDraft', 'closeDocument',
].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const initial = 'G241 original UTF8 source';
const edited = 'G241 retained local 中文';
const reason = '原目录已失效，已有编辑仍保留，请重新关联原目录';
const file = {
  ref: { id: 'g241-document', lease: 'g241-root', generation: 1 },
  name: 'source.txt', relativePath: 'source.txt', absolutePath: '/synthetic/g241/source.txt',
  documentKey: 'local:241:1', writable: true,
  revision: { device: '1', inode: '241', size: Buffer.byteLength(initial), hash: hash(initial), modifiedNs: '1', changedNs: '1' },
};
let buffer: FileBuffer | undefined;
afterEach(() => { buffer?.dispose(); vi.useRealTimers(); });
it('does not dispatch a new source save after revocation while its safe checkpoint was awaiting a reply', async () => {
  vi.resetAllMocks();
  const events: { seq: number; name: string; sourceUnavailable: string }[] = [];
  const event = (name: string) => events.push({ seq: events.length, name, sourceUnavailable: buffer?.sourceUnavailable ?? '' });
  let fixtureDisk = initial;
  api.read.mockResolvedValue({ document: structuredClone(file), base64: Buffer.from(initial).toString('base64') });
  api.drafts.mockResolvedValue([]);
  api.closeDocument.mockResolvedValue(undefined);
  api.resolveDraft.mockImplementation(async () => { event('resolveDraft-request'); return { resolved: true }; });
  api.save.mockImplementation(async input => {
    event('source-save-request');
    fixtureDisk = Buffer.from(input.base64, 'base64').toString('utf8');
    return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'saved',
      revision: { ...file.revision, hash: hash(fixtureDisk), size: Buffer.byteLength(fixtureDisk), inode: '242' } };
  });
  const recoveryRoute = vi.fn(async () => { event('safe-recovery-route'); });
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined, recoveryRoute);
  await buffer.load();
  // Suppress only unrelated automatic debounce; explicit public save is unchanged.
  buffer.pauseAutosave();
  const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: edited } });
  buffer.acceptTransactions(transaction.state, [transaction]);
  const before = { raw: buffer.raw, dirty: buffer.dirty, baseHash: buffer.baseHash, version: buffer.version };
  expect(before).toEqual({ raw: edited, dirty: true, baseHash: file.revision.hash, version: 1 });
  let deliverCheckpoint!: (value: unknown) => void;
  api.checkpoint.mockImplementationOnce(() => { event('safe-checkpoint-request'); return new Promise(resolve => { deliverCheckpoint = resolve; }); });
  const saving = buffer.save();
  await vi.waitFor(() => expect(deliverCheckpoint).toBeTypeOf('function'));
  expect(api.save).not.toHaveBeenCalled(); // No source save was sent before invalidation.
  const checkpointInput = structuredClone(api.checkpoint.mock.calls[0][0]);
  buffer.invalidateSource(reason);
  event('source-invalidated');
  const checkpointReceipt = { draftId: checkpointInput.draftId, bufferVersion: checkpointInput.bufferVersion,
    hash: hash(Buffer.from(checkpointInput.base64, 'base64').toString('utf8')) };
  event('safe-checkpoint-reply');
  deliverCheckpoint(checkpointReceipt);
  const ok = await saving;
  const observed = {
    ok, sourceUnavailable: buffer.sourceUnavailable,
    saveRequests: api.save.mock.calls.length, resolveDraftRequests: api.resolveDraft.mock.calls.length,
    fixtureDisk, raw: buffer.raw, dirty: buffer.dirty, baseHash: buffer.baseHash, version: buffer.version,
    safeCheckpoint: checkpointInput.draftId === buffer.draftId
      && checkpointInput.bufferVersion === before.version
      && Buffer.from(checkpointInput.base64, 'base64').toString('utf8') === edited
      && checkpointInput.baseHash === file.revision.hash && recoveryRoute.mock.calls.length === 1,
  };
  const root = process.env.G241_ARTIFACT_DIR;
  if (root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'consumer-observation.json'), JSON.stringify({
    layer: 'shared UTF8 FileBuffer renderer consumer; API boundary fixture, not main/native write proof',
    events, before, checkpointInput, checkpointReceipt, observed,
    saveInputs: api.save.mock.calls.map(call => call[0]),
    resolveDraftInputs: api.resolveDraft.mock.calls.map(call => call[0]),
  }, null, 2) + '\n');
  }
  expect(observed).toEqual({
    ok: false, sourceUnavailable: reason, saveRequests: 0, resolveDraftRequests: 0,
    fixtureDisk: initial, raw: edited, dirty: true, baseHash: file.revision.hash, version: 1,
    safeCheckpoint: true,
  });
});
