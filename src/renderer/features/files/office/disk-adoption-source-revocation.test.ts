// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileBuffer } from '@renderer/features/files/file-buffer';
const api = vi.hoisted(() => Object.fromEntries([
  'openOffice', 'closeOffice', 'checkpointOffice', 'editOffice', 'saveOffice',
  'openPptx', 'closePptx', 'checkpointPptx', 'editPptx', 'savePptx',
  'drafts', 'refresh', 'resolveDraft', 'closeDocument',
].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const reason = '原目录已失效，已有编辑仍保留，请重新关联原目录';
const oldText = 'G241 old choice draft';
const newText = 'G241 NEW pending after disk choice 中文';
const hash = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
let buffer: FileBuffer | undefined;
afterEach(() => { buffer?.dispose(); vi.useRealTimers(); });
it.each(['xlsx', 'pptx'] as const)('%s refuses obsolete disk adoption after a new public pending was accepted and the root was revoked', async kind => {
  vi.resetAllMocks();
  const events: { seq: number; name: string; unavailable: string }[] = [];
  const event = (name: string) => events.push({ seq: events.length, name, unavailable: buffer?.sourceUnavailable ?? '' });
  const file = {
    ref: { id: `g241-${kind}`, lease: 'g241-root', generation: 1 }, name: `source.${kind}`,
    relativePath: `source.${kind}`, absolutePath: `/synthetic/g241/source.${kind}`,
    documentKey: 'local:241:1', writable: true,
    revision: { device: '1', inode: '241', size: 100, hash: `g241-${kind}-original`, modifiedNs: '1', changedNs: '1' },
  };
  const external = { ...structuredClone(file), revision: { ...file.revision, hash: `g241-${kind}-external`, modifiedNs: '2', changedNs: '2' } };
  const workbook = { kind: 'xlsx', sheets: [{ id: '1', name: 'Sheet', hidden: 'visible', rows: 10, columns: 10,
    protected: false, defaultRowHeight: 20, defaultColumnWidth: 80, rowSizes: [], columnSizes: [] }],
    date1904: false, signed: false, externalLinks: 0, protected: false };
  api.openOffice.mockImplementation(async input => {
    event('openOffice-request');
    return { id: input.id, hash: input.baseHash, workbook,
      state: { version: 0, dirty: false, canUndo: false, canRedo: false, workbook }, calculation: { state: 'ready' } };
  });
  api.openPptx.mockImplementation(async input => {
    event('openPptx-request');
    return { id: input.id, sourceHash: input.baseHash,
      state: { version: 0, dirty: false, canUndo: false, canRedo: false, protected: false,
        info: { kind: 'pptx', signed: false, externalLinks: 0, hasRevisions: false,
          slides: [{ id: '256', title: 'Synthetic', hidden: false, notes: 'original', elements: [] }] } } };
  });
  api.drafts.mockResolvedValue([]);
  api.closeOffice.mockResolvedValue(undefined); api.closePptx.mockResolvedValue(undefined); api.closeDocument.mockResolvedValue(undefined);
  const checkpointInputs: any[] = [];
  const checkpoint = async (input: any) => { event('safe-checkpoint-request'); checkpointInputs.push(structuredClone(input));
    return { draftId: input.draftId, bufferVersion: input.bufferVersion, hash: hash(input.pending) }; };
  api.checkpointOffice.mockImplementation(checkpoint); api.checkpointPptx.mockImplementation(checkpoint);
  api.resolveDraft.mockImplementation(async () => { event('discard-request'); return { resolved: true }; });
  const recoveryRoute = vi.fn(async () => undefined);
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined, recoveryRoute);
  await buffer.load();
  vi.useFakeTimers(); // No debounce time is advanced; the held refresh is the only diagnostic gate.
  const owner = kind === 'xlsx' ? buffer.office! : buffer.pptx!;
  const set = (text: string) => kind === 'xlsx'
    ? buffer!.office!.setPending({ sheetId: '1', row: 0, column: 0, text }, '', 0)
    : buffer!.pptx!.setNotes('256', text, 'original', 0);
  const currentPending = () => kind === 'xlsx' ? buffer!.office!.pending : buffer!.pptx!.pending;
  set(oldText);
  const safeReceipt = await buffer.checkpoint();
  expect(safeReceipt).not.toBeNull(); expect(currentPending()?.text).toBe(oldText);
  // Create the genuine conflict through the public refresh path, not a disk/store assignment.
  api.refresh.mockResolvedValueOnce(structuredClone(external));
  await buffer.refresh();
  expect(buffer.conflict).toBe(true); expect(buffer.baseHash).toBe(file.revision.hash);
  let deliverRefresh!: (value: unknown) => void;
  api.refresh.mockImplementationOnce(() => { event('choice-refresh-request'); return new Promise(resolve => { deliverRefresh = resolve; }); });
  const beforeChoice = { pending: structuredClone(currentPending()), baseHash: buffer.baseHash,
    busy: owner.busy, editable: owner.editable, conflict: buffer.conflict };
  const adopting = buffer.useDisk();
  expect(deliverRefresh).toBeTypeOf('function');
  expect(owner.busy).toBe(false); expect(owner.editable).toBe(true);
  set(newText); // Public producer must really accept the new pending while the old choice awaits.
  const accepted = { pending: structuredClone(currentPending()), busy: owner.busy,
    editable: owner.editable, dirty: buffer.dirty, baseHash: buffer.baseHash };
  expect(accepted).toMatchObject({ pending: { text: newText }, busy: false, editable: true, dirty: true, baseHash: file.revision.hash });
  event('new-public-pending-accepted');
  const expectedPending = structuredClone(currentPending());
  const opensBefore = api.openOffice.mock.calls.length + api.openPptx.mock.calls.length;
  buffer.invalidateSource(reason); event('source-invalidated');
  event('old-choice-refresh-reply'); deliverRefresh(structuredClone(external));
  const ok = await adopting;
  const observed = { ok, sourceUnavailable: buffer.sourceUnavailable,
    pending: structuredClone(currentPending()), dirty: buffer.dirty, baseHash: buffer.baseHash,
    discardRequests: api.resolveDraft.mock.calls.length,
    newOpenRequests: api.openOffice.mock.calls.length + api.openPptx.mock.calls.length - opensBefore,
    safeOldCheckpoint: checkpointInputs.length === 1 && checkpointInputs[0].pending.text === oldText
      && safeReceipt!.draftId === buffer.draftId && recoveryRoute.mock.calls.length === 1,
  };
  const root = process.env.G241_ARTIFACT_DIR; if (root) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, `${kind}-use-disk-observation.json`), JSON.stringify({
    layer: 'real FileBuffer/OfficeBuffer/PptxBuffer; API boundary fixture, not native/disk durability',
    kind, beforeChoice, accepted, expectedPending, safeReceipt, checkpointInputs, events, observed,
    discardInputs: api.resolveDraft.mock.calls.map(call => call[0]),
  }, null, 2) + '\n');
  }
  expect(observed).toEqual({ ok: false, sourceUnavailable: reason, pending: expectedPending,
    dirty: true, baseHash: file.revision.hash, discardRequests: 0, newOpenRequests: 0, safeOldCheckpoint: true });
});
