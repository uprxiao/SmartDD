// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileBuffer } from '@renderer/features/files/file-buffer';
// No model/dirty/version assignment. Actual FileBuffer and CodeMirror transactions;
// only the constructor API and imported IPC transport boundary are isolated.
const api = vi.hoisted(() => Object.fromEntries([
  'read', 'refresh', 'checkpoint', 'save', 'drafts', 'readDraft', 'resolveDraft', 'closeDocument',
].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const original = 'G242 original UTF8';
const oldChoiceInput = 'G242 edit included in original disk choice';
const newerInput = 'G242 NEW accepted input 中文';
const externalDisk = 'G242 external disk snapshot chosen earlier';
const reason = '原目录已失效，已有编辑仍保留，请重新关联原目录';
const file = {
  ref: { id: 'g242-source', lease: 'g242-root', generation: 1 },
  name: 'source.txt', relativePath: 'source.txt', absolutePath: '/synthetic/g242/source.txt',
  documentKey: 'local:242:1', writable: true,
  revision: { device: '1', inode: '242', size: Buffer.byteLength(original), hash: sha(original), modifiedNs: '1', changedNs: '1' },
};
let buffer: FileBuffer | undefined;
afterEach(() => { buffer?.dispose(); vi.useRealTimers(); });
it('rejects a stale UTF8 useDisk read reply after newer public input and source revocation while retaining the safe draft', async () => {
  vi.resetAllMocks();
  const events: { seq: number; name: string; unavailable: string }[] = [];
  const event = (name: string) => events.push({ seq: events.length, name, unavailable: buffer?.sourceUnavailable ?? '' });
  const oldRead = { document: structuredClone(file), base64: Buffer.from(original).toString('base64') };
  const externalRead = { document: { ...structuredClone(file), revision: { ...file.revision, size: Buffer.byteLength(externalDisk), hash: sha(externalDisk), modifiedNs: '2', changedNs: '2' } }, base64: Buffer.from(externalDisk).toString('base64') };
  api.read.mockImplementation(async () => { event('ordinary-initial-read'); return structuredClone(oldRead); });
  api.drafts.mockResolvedValue([]); api.closeDocument.mockResolvedValue(undefined);
  api.save.mockImplementation(async () => { event('unexpected-source-save'); throw new Error('This regression never permits a source write'); });
  api.resolveDraft.mockImplementation(async () => { event('new-resolveDraft-request'); return { resolved: true }; });
  const checkpointInputs: any[] = [];
  api.checkpoint.mockImplementation(async input => { event('safe-checkpoint-request'); checkpointInputs.push(structuredClone(input));
    return { draftId: input.draftId, bufferVersion: input.bufferVersion, hash: sha(Buffer.from(input.base64, 'base64').toString('utf8')) }; });
  const recoveryRoute = vi.fn(async () => undefined);
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined, recoveryRoute);
  await buffer.load();
  vi.useFakeTimers(); // Freeze unrelated debounce; do not advance time or replace the decision path.
  const replace = (raw: string) => {
    const tr = buffer!.editor!.update({ changes: { from: 0, to: buffer!.editor!.doc.length, insert: raw } });
    buffer!.acceptTransactions(tr.state, [tr]);
  };
  expect({ raw: buffer.raw, dirty: buffer.dirty, editable: buffer.editable, unavailable: buffer.sourceUnavailable }).toEqual({ raw: original, dirty: false, editable: true, unavailable: '' });
  replace(oldChoiceInput);
  const safeReceipt = await buffer.checkpoint();
  expect(safeReceipt).not.toBeNull();
  // Real public refresh creates the conflict; no direct disk/model assignment.
  api.refresh.mockResolvedValueOnce(structuredClone(externalRead.document));
  api.read.mockResolvedValueOnce(structuredClone(externalRead));
  await buffer.refresh();
  expect(buffer.conflict).toBe(true); expect(buffer.raw).toBe(oldChoiceInput);
  let deliverRead!: (value: unknown) => void;
  api.read.mockImplementationOnce(() => { event('useDisk-read-request'); return new Promise(resolve => { deliverRead = resolve; }); });
  const beforeChoice = { raw: buffer.raw, version: buffer.version, dirty: buffer.dirty,
    conflict: buffer.conflict, editable: buffer.editable, unavailable: buffer.sourceUnavailable, baseHash: buffer.baseHash };
  const adopting = buffer.useDisk();
  expect(deliverRead).toBeTypeOf('function'); expect(api.resolveDraft).not.toHaveBeenCalled();
  expect(buffer.editable).toBe(true); expect(buffer.sourceUnavailable).toBe('');
  replace(newerInput);
  const accepted = { raw: buffer.raw, version: buffer.version, dirty: buffer.dirty,
    editable: buffer.editable, unavailable: buffer.sourceUnavailable, baseHash: buffer.baseHash };
  expect(accepted).toEqual({ raw: newerInput, version: 2, dirty: true, editable: true, unavailable: '', baseHash: file.revision.hash });
  const newerEditor = buffer.editor;
  event('new-public-CM-input-accepted');
  buffer.invalidateSource(reason); event('source-invalidated');
  event('old-useDisk-read-reply'); deliverRead(structuredClone(externalRead));
  const ok = await adopting;
  const observed = { ok, sourceUnavailable: buffer.sourceUnavailable,
    raw: buffer.raw, dirty: buffer.dirty, conflict: buffer.conflict,
    version: buffer.version, savedVersion: buffer.savedVersion, baseHash: buffer.baseHash,
    sameNewerEditor: buffer.editor === newerEditor,
    resolveDraftRequests: api.resolveDraft.mock.calls.length, saveRequests: api.save.mock.calls.length,
    safeOldCheckpoint: checkpointInputs.length === 1 && checkpointInputs[0].bufferVersion === 1
      && checkpointInputs[0].baseHash === file.revision.hash
      && Buffer.from(checkpointInputs[0].base64, 'base64').toString('utf8') === oldChoiceInput
      && safeReceipt!.draftId === buffer.draftId && recoveryRoute.mock.calls.length === 1,
  };
  const root = process.env.G242_ARTIFACT_DIR; if (root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'consumer-observation.json'), JSON.stringify({
    layer: 'shared UTF8 FileBuffer renderer-I; API transport fixture, not actual main/native disk durability',
    selectedBoundary: 'read-reply', events, beforeChoice, accepted, safeReceipt, checkpointInputs,
    externalReadSHA256: sha(externalDisk), observed,
    resolveDraftInputs: api.resolveDraft.mock.calls.map(call => call[0]),
    interpretation: 'A normal source was editable before the newer CM transaction; input changes and root invalidation each obsolete the earlier decision. This single combined scenario does not independently isolate their individual causal sufficiency.',
  }, null, 2) + '\n');
  }
  expect(observed).toEqual({ ok: false, sourceUnavailable: reason, raw: newerInput, dirty: true,
    conflict: true, version: 2, savedVersion: 0, baseHash: file.revision.hash,
    sameNewerEditor: true, resolveDraftRequests: 0, saveRequests: 0, safeOldCheckpoint: true });
});
