// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { FileBuffer } from '@renderer/features/files/file-buffer';

// Only the real consumers' IPC transport is replaced. No FileBuffer,
// OfficeBuffer, OfficeClient, workbookHost, or source-state implementation mock.
const api = vi.hoisted(() => Object.fromEntries([
  'openOffice', 'closeOffice', 'drafts', 'editOffice', 'checkpointOffice',
  'saveOffice', 'recalculateOffice', 'resolveDraft', 'closeDocument',
].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));

const workbook = {
  kind: 'xlsx' as const,
  sheets: [{ id: '1', name: 'Sheet', hidden: 'visible' as const, rows: 10, columns: 10,
    protected: false, defaultRowHeight: 20, defaultColumnWidth: 80, rowSizes: [], columnSizes: [] }],
  date1904: false, signed: false, externalLinks: 0, protected: false,
};
const file = {
  ref: { id: 'g238-document', lease: 'g238-root', generation: 1 },
  name: 'book.xlsx', relativePath: 'book.xlsx', absolutePath: '/synthetic/g238/book.xlsx',
  documentKey: 'local:1:2',
  revision: { hash: 'g238-source-base', device: '1', inode: '2', size: 100, modifiedNs: '1', changedNs: '1' },
  writable: true,
};
const originalPending = { sheetId: '1', row: 0, column: 0, text: '=unfinished 中文' };
const reason = '原目录已失效，已有编辑仍保留，请重新关联原目录';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
let buffer: FileBuffer | undefined;

afterEach(() => {
  buffer?.dispose();
  vi.useRealTimers();
});

it('blocks a revoked genuine local source, rejects its retained writer, and preserves pending recovery', async () => {
  vi.resetAllMocks();
  let version = 0;
  const state = (dirty = false) => ({ version, dirty, canUndo: version > 0, canRedo: false, workbook });
  const checkpoints: any[] = [];
  api.openOffice.mockResolvedValue({ id: 'g238-office', hash: file.revision.hash,
    workbook, state: state(), calculation: { state: 'ready' } });
  api.drafts.mockResolvedValue([]);
  api.closeOffice.mockResolvedValue(undefined);
  api.closeDocument.mockResolvedValue(undefined);
  api.resolveDraft.mockResolvedValue({ resolved: true });
  api.editOffice.mockImplementation(async input => {
    if (input.version !== version) throw new Error('Transport fixture version mismatch');
    version++;
    return { state: state(true), calculation: { state: 'ready' } };
  });
  api.checkpointOffice.mockImplementation(async input => {
    checkpoints.push(structuredClone(input));
    return { draftId: input.draftId, bufferVersion: input.bufferVersion,
      hash: `g238-checkpoint-${input.bufferVersion}` };
  });
  api.saveOffice.mockImplementation(async input => ({
    state: state(), calculation: { state: 'ready' },
    receipt: { opId: input.opId, bufferVersion: input.bufferVersion, state: 'saved',
      revision: { ...file.revision, hash: 'g238-illegal-source-write', inode: '3' } },
    checkpoint: { draftId: input.draftId, bufferVersion: input.bufferVersion,
      hash: `g238-checkpoint-${input.bufferVersion}` },
  }));
  const recoveryRoute = vi.fn(async () => undefined);
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined, recoveryRoute);
  await buffer.load(); // FileBuffer.getOffice() chooses the actual localWorkbookHost.
  const office = buffer.office!;
  expect({ sourceState: office.sourceState, editable: office.editable,
    editingControls: office.editingControls, loadState: buffer.loadState }).toEqual({
    sourceState: 'live', editable: true, editingControls: true, loadState: 'ready' });
  vi.useFakeTimers(); // Advance only the existing consumer debounce, not a new runtime deadline.
  office.setPending(structuredClone(originalPending), '');
  const retainedWriter = office.writer;

  // Same public entry called by workspace-store's genuine rootInvalidated update.
  buffer.invalidateSource(reason);
  const immediatelyAfterInvalidation = {
    sourceState: office.sourceState, editable: office.editable,
    editingControls: office.editingControls, dirty: buffer.dirty,
    pending: structuredClone(office.pending), sourceUnavailable: buffer.sourceUnavailable,
  };
  const checkpoint = await buffer.checkpoint(); // Safe recovery remains available while blocked.
  const checkpointAtInvalidation = structuredClone(checkpoints);
  const retainedWriterResult = await retainedWriter.editCell({
    sheetId: '1', row: 1, column: 0, text: 'stale callback must not reach IPC',
  });
  await vi.advanceTimersByTimeAsync(3500); // Existing 500ms checkpoint/3000ms autosave boundaries.

  const observed = {
    sourceState: office.sourceState, editable: office.editable,
    editingControls: office.editingControls, dirty: buffer.dirty,
    pending: structuredClone(office.pending), retainedWriterResult,
    editCalls: api.editOffice.mock.calls.length, saveCalls: api.saveOffice.mock.calls.length,
    resultVersion: office.result?.state.version, baseHash: buffer.baseHash,
    sourceUnavailable: buffer.sourceUnavailable,
    safeCheckpoint: checkpoint !== null && checkpoint.draftId === buffer.draftId
      && checkpointAtInvalidation.length === 1
      && hash(checkpointAtInvalidation[0].pending) === hash(originalPending)
      && recoveryRoute.mock.calls.length > 0,
  };
  const artifactRoot = process.env.G238_ARTIFACT_DIR;
  if (artifactRoot) {
  mkdirSync(artifactRoot, { recursive: true });
  writeFileSync(join(artifactRoot, 'consumer-observation.json'), JSON.stringify({
    layer: 'renderer consumer C; IPC boundary fixture, no native/disk durability claim',
    immediatelyAfterInvalidation, observed, checkpoint, checkpointAtInvalidation, checkpoints,
    editInputs: api.editOffice.mock.calls.map(call => call[0]),
    saveInputs: api.saveOffice.mock.calls.map(call => call[0]),
    recoveryRouteCalls: recoveryRoute.mock.calls.length,
    expectedPendingSHA256: hash(originalPending),
  }, null, 2) + '\n');
  }

  // One final hard red captures all branches first, without stopping at a state-only failure.
  expect(observed).toEqual({
    sourceState: 'blocked', editable: false, editingControls: false, dirty: true,
    pending: originalPending, retainedWriterResult: false, editCalls: 0, saveCalls: 0,
    resultVersion: 0, baseHash: file.revision.hash, sourceUnavailable: reason,
    safeCheckpoint: true,
  });
});
