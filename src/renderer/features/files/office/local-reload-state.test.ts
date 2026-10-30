// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FileBuffer } from '@renderer/features/files/file-buffer';
import { OfficeBuffer } from '@renderer/features/files/office/buffer';
import { OfficeClient } from '@renderer/features/files/office/client';

// Only the IPC transport is a fixture. FileBuffer, OfficeBuffer, OfficeClient,
// localWorkbookHost, loading/state gates and reload() are the real frozen source.
const api = vi.hoisted(() => Object.fromEntries([
  'openOffice', 'closeOffice', 'drafts', 'editOffice', 'checkpointOffice',
  'saveOffice', 'resolveDraft', 'closeDocument', 'refresh',
].map(name => [name, vi.fn()])));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const workbook = {
  kind: 'xlsx' as const,
  sheets: [{ id: '1', name: 'Sheet', hidden: 'visible' as const, rows: 10, columns: 10,
    protected: false, defaultRowHeight: 20, defaultColumnWidth: 80, rowSizes: [], columnSizes: [] }],
  date1904: false, signed: false, externalLinks: 0, protected: false,
};
const file = {
  ref: { id: 'g250-document', lease: 'g250-root', generation: 1 },
  name: 'book.xlsx', relativePath: 'book.xlsx', absolutePath: '/synthetic/g250/book.xlsx',
  documentKey: 'local:1:2',
  revision: { hash: 'g250-base', device: '1', inode: '2', size: 100, modifiedNs: '1', changedNs: '1' },
  writable: true,
};
const state = () => ({ version: 0, dirty: false, canUndo: false, canRedo: false, workbook });
let buffer: FileBuffer | undefined;
let finishOpen: ((value: unknown) => void) | undefined;
let finishDrafts: ((value: unknown) => void) | undefined;
let reloading: Promise<void> | undefined;
const receipt = (id: string) => ({ id, hash: file.revision.hash, workbook, state: state(), calculation: { state: 'ready' } });
afterEach(async () => {
  // Settle only this fixture's original replies if an earlier assertion fails.
  // This is cleanup, never another reload/edit/save or source-state assignment.
  finishOpen?.(receipt('cleanup-owned-reply'));
  finishDrafts?.([]);
  await reloading?.catch(() => undefined);
  buffer?.dispose();
  vi.useRealTimers();
});

it('keeps a genuine local reload refreshing and readonly until both ready and drafts settle', async () => {
  vi.resetAllMocks();
  api.refresh.mockResolvedValue(file);
  api.openOffice.mockImplementation(async input => receipt(input.id));
  api.drafts.mockResolvedValue([]);
  api.closeOffice.mockResolvedValue(undefined);
  api.closeDocument.mockResolvedValue(undefined);
  api.resolveDraft.mockResolvedValue({ resolved: true });
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined);
  await buffer.load();
  const office = buffer.office!;
  const initialClient = office.client!;
  expect(office).toBeInstanceOf(OfficeBuffer);
  expect(initialClient).toBeInstanceOf(OfficeClient);
  const snap = () => ({ sourceState: office.sourceState, editable: office.editable,
    editingControls: office.editingControls, loadState: buffer!.loadState,
    dirty: buffer!.dirty, pending: structuredClone(office.pending),
    baseHash: buffer!.baseHash, file: structuredClone(buffer!.file),
    clientId: office.client?.id, version: office.result?.state.version ?? null,
    resultPresent: !!office.result });
  const initial = snap();
  expect({ sourceState: initial.sourceState, editable: initial.editable,
    editingControls: initial.editingControls, dirty: initial.dirty }).toEqual({
    sourceState: 'live', editable: true, editingControls: true, dirty: false });

  api.openOffice.mockImplementationOnce(() => new Promise(resolve => { finishOpen = resolve; }));
  api.drafts.mockImplementationOnce(() => new Promise(resolve => { finishDrafts = resolve; }));
  reloading = office.reload(); // Genuine explicit public reload; not metadata refresh().
  await vi.waitFor(() => expect(finishOpen).toBeTypeOf('function'), { timeout: 10000, interval: 10 });
  const duringOpen = snap();
  const currentClient = office.client!;
  expect(currentClient).toBeInstanceOf(OfficeClient);
  expect(currentClient).not.toBe(initialClient);
  finishOpen!(receipt(currentClient.id));
  await vi.waitFor(() => expect(finishDrafts).toBeTypeOf('function'), { timeout: 10000, interval: 10 });
  const duringDrafts = snap();
  finishDrafts!([]);
  await reloading;
  const after = snap();
  const phases = [initial, duringOpen, duringDrafts, after].map(value => ({
    sourceState: value.sourceState, editable: value.editable, editingControls: value.editingControls,
  }));
  const observation = {
    layer: 'renderer-I; real FileBuffer/OfficeBuffer/OfficeClient, mocked IPC only; no App/native/physical disk claim',
    worker: { pid: process.pid, ppid: process.ppid },
    initial, duringOpen, duringDrafts, after, phases,
    openCalls: api.openOffice.mock.calls.map(call => call[0]),
    draftsCalls: api.drafts.mock.calls.map(call => call[0]),
    closeOfficeCalls: api.closeOffice.mock.calls.map(call => call[0]),
    edits: api.editOffice.mock.calls.length, sourceSaves: api.saveOffice.mock.calls.length,
    checkpoints: api.checkpointOffice.mock.calls.length, discardRequests: api.resolveDraft.mock.calls.length,
    boundary: 'Only original openOffice and drafts replies held. Same-file native refresh receipt mocked for explicit retry;no user input,revoke,model assignment or extra reload.',
  };
  const artifactRoot = process.env.G250_ARTIFACT_DIR;
  if (artifactRoot) {
    mkdirSync(artifactRoot, { recursive: true });
    writeFileSync(join(artifactRoot, 'reload-lifecycle-observation.json'), JSON.stringify(observation, null, 2) + '\n');
  }

  // Persist the complete real timeline before the first product assertion.
  expect(phases).toEqual([
    { sourceState: 'live', editable: true, editingControls: true },
    { sourceState: 'refreshing', editable: false, editingControls: false },
    { sourceState: 'refreshing', editable: false, editingControls: false },
    { sourceState: 'live', editable: true, editingControls: true },
  ]);
  expect(after.loadState).toBe('ready');
  expect(after.file).toEqual(initial.file);
  expect(after.baseHash).toBe(file.revision.hash);
  expect(after.dirty).toBe(false);
  expect(after.pending).toBeNull();
  expect(api.editOffice).not.toHaveBeenCalled();
  expect(api.saveOffice).not.toHaveBeenCalled();
  expect(api.checkpointOffice).not.toHaveBeenCalled();
  expect(api.resolveDraft).not.toHaveBeenCalled();
  expect(api.closeOffice.mock.calls.filter(call => call[0] === initialClient.id)).toHaveLength(1);
});


it.each(['older-first', 'newer-first'] as const)('keeps the latest reload authoritative when replies finish %s', async order => {
  vi.resetAllMocks();
  api.refresh.mockResolvedValue(file);
  finishOpen = undefined;
  finishDrafts = undefined;
  reloading = undefined;
  api.openOffice.mockImplementation(async input => receipt(input.id));
  api.drafts.mockResolvedValue([]);
  api.closeOffice.mockResolvedValue(undefined);
  api.closeDocument.mockResolvedValue(undefined);
  api.resolveDraft.mockResolvedValue({ resolved: true });
  buffer = new FileBuffer(structuredClone(file), api as never, () => undefined);
  await buffer.load();
  const office = buffer.office!;
  const replies: { id: string; resolve(value: unknown): void }[] = [];
  api.openOffice.mockImplementation(input => new Promise(resolve => { replies.push({ id: input.id, resolve }); }));
  const older = office.reload();
  await vi.waitFor(() => expect(replies).toHaveLength(1));
  const olderClient = office.client;
  const newer = office.reload();
  await vi.waitFor(() => expect(replies).toHaveLength(2));
  const currentClient = office.client;
  expect(currentClient).not.toBe(olderClient);
  try {
    if (order === 'older-first') {
      replies[0].resolve(receipt(replies[0].id));
      await older;
      expect(office.client).toBe(currentClient);
      expect(office.sourceState).toBe('refreshing');
      expect(office.editable).toBe(false);
      replies[1].resolve(receipt(replies[1].id));
      await newer;
    } else {
      replies[1].resolve(receipt(replies[1].id));
      await newer;
      expect(office.sourceState).toBe('live');
      expect(office.editable).toBe(true);
      replies[0].resolve(receipt(replies[0].id));
      await older;
    }
    expect(office.client).toBe(currentClient);
    expect(office.sourceState).toBe('live');
    expect(office.editable).toBe(true);
    expect(office.editingControls).toBe(true);
    expect(buffer.baseHash).toBe(file.revision.hash);
    expect(buffer.dirty).toBe(false);
    expect(api.editOffice).not.toHaveBeenCalled();
    expect(api.saveOffice).not.toHaveBeenCalled();
    expect(api.resolveDraft).not.toHaveBeenCalled();
  } finally {
    for (const reply of replies) reply.resolve(receipt(reply.id));
    await Promise.allSettled([older, newer]);
  }
});
