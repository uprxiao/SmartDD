import { createHash, randomUUID } from 'node:crypto';
import { redo, redoDepth, undo, undoDepth } from '@codemirror/commands';
import type { StateCommand } from '@codemirror/state';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FileError, type FileDocument, type FileRead, type FileSaveInput, type FileSaveReceipt } from '@shared/files';
import { FileBuffer, type FileClient } from './file-buffer';
import { CsvModel } from './csv/model';
import { FileWorkspaceStore } from './workspace-store';

const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (reason: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const buffers: FileBuffer[] = [];
function fixture(initial = 'BASE\r\n') {
  let disk = initial, sequence = 1;
  const file: FileDocument = { ref: { id: randomUUID(), lease: randomUUID(), generation: 1 }, documentKey: 'local:1:2', name: 'file.md', relativePath: 'file.md', absolutePath: '/fixture/file.md', writable: true, revision: { device: '1', inode: '2', size: Buffer.byteLength(disk), hash: hash(disk), modifiedNs: '1', changedNs: '1' } };
  const current = () => ({ ...file, revision: { ...file.revision, size: Buffer.byteLength(disk), hash: hash(disk), modifiedNs: String(sequence), changedNs: String(sequence) } });
  const api = {
    read: vi.fn(async (): Promise<FileRead> => ({ document: current(), base64: Buffer.from(disk).toString('base64') })),
    refresh: vi.fn(async () => current()),
    save: vi.fn(async (input: FileSaveInput): Promise<FileSaveReceipt> => {
      if (hash(disk) !== input.baseHash) return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'conflict' };
      disk = Buffer.from(input.base64, 'base64').toString(); sequence++;
      return { opId: input.opId, bufferVersion: input.bufferVersion, state: 'saved', revision: current().revision };
    }),
    checkpoint: vi.fn(async (input: Parameters<FileClient['checkpoint']>[0]) => ({ draftId: input.draftId, bufferVersion: input.bufferVersion, hash: createHash('sha256').update(Buffer.from(input.base64, 'base64')).digest('hex') })),
    drafts: vi.fn(async () => []), readDraft: vi.fn(), resolveDraft: vi.fn(async () => ({ resolved: true })), closeDocument: vi.fn(async () => undefined),
  };
  const changed = vi.fn(), buffer = new FileBuffer(file, api, changed); buffers.push(buffer);
  return { buffer, api, changed, file, disk: () => disk, external: (raw: string) => { disk = raw; sequence++; } };
}
function replace(buffer: FileBuffer, value: string) {
  const transaction = buffer.editor!.update({ changes: { from: 0, to: buffer.editor!.doc.length, insert: value } });
  buffer.acceptTransactions(transaction.state, [transaction]);
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { buffers.splice(0).forEach((buffer) => buffer.dispose()); vi.useRealTimers(); });

describe('real editor buffer lifecycle (API boundary isolated)', () => {
  it('H29 restores an exact clean checkpoint without a source write', async () => {
    const { buffer, api } = fixture(); await buffer.load(); const original = buffer.raw;
    api.readDraft.mockResolvedValueOnce({ base64: Buffer.from(original).toString('base64'), baseHash: buffer.baseHash, hash: hash(original), bufferVersion: 7 });
    await buffer.restoreDraft(randomUUID()); expect(buffer.raw).toBe(original); expect(buffer.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(4000); expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).not.toHaveBeenCalled();
  });
  it('H29 preserves compatible in-memory editor/history and resets incompatible history', async () => {
    const { buffer, api } = fixture(); await buffer.load(); replace(buffer, 'LOCAL SAME'); const state = buffer.editor!, depth = undoDepth(state);
    api.readDraft.mockResolvedValueOnce({ base64: Buffer.from('LOCAL SAME').toString('base64'), baseHash: buffer.baseHash, hash: hash('LOCAL SAME'), bufferVersion: 7 });
    await buffer.restoreDraft(randomUUID()); expect(buffer.editor).toBe(state); expect(undoDepth(buffer.editor!)).toBe(depth); expect(buffer.dirty).toBe(true);
    api.readDraft.mockResolvedValueOnce({ base64: Buffer.from('DIFFERENT RECOVERY').toString('base64'), baseHash: buffer.baseHash, hash: hash('DIFFERENT RECOVERY'), bufferVersion: 9 });
    await buffer.restoreDraft(randomUUID()); expect(buffer.raw).toBe('DIFFERENT RECOVERY'); expect(undoDepth(buffer.editor!)).toBe(0);
  });
  it('H29 compares a draft with fresh disk bytes even before a watch notification', async () => {
    const { buffer, api, external, disk } = fixture(); await buffer.load(); const baseHash = buffer.baseHash;
    external('EXTERNAL NEW DISK'); api.readDraft.mockResolvedValueOnce({ base64: Buffer.from('LOCAL RECOVERY').toString('base64'), baseHash, hash: hash('LOCAL RECOVERY'), bufferVersion: 7 });
    await buffer.restoreDraft(randomUUID()); expect(buffer.raw).toBe('LOCAL RECOVERY'); expect(buffer.conflict).toBe(true); expect(buffer.baseHash).toBe(baseHash);
    expect(Buffer.from(buffer.disk!.base64, 'base64').toString()).toBe(disk()); expect(buffer.file.revision.hash).toBe(hash(disk()));
  });
  it('H29 cannot overwrite input entered while draft retrieval is pending', async () => {
    const { buffer, api } = fixture(); await buffer.load(); const wait = deferred<Awaited<ReturnType<FileClient['readDraft']>>>(), draftId = buffer.draftId;
    api.readDraft.mockReturnValueOnce(wait.promise); const pending = buffer.restoreDraft(randomUUID()); replace(buffer, 'NEW INPUT MUST SURVIVE');
    wait.resolve({ base64: Buffer.from('OLD RECOVERY').toString('base64'), baseHash: buffer.baseHash, hash: hash('OLD RECOVERY'), bufferVersion: 7 });
    await expect(pending).rejects.toThrow('已改变'); expect(buffer.raw).toBe('NEW INPUT MUST SURVIVE'); expect(buffer.draftId).toBe(draftId);
  });
  it('H29 cannot use clean draft restoration to erase a protected unknown save receipt', async () => {
    const { buffer, api } = fixture(); await buffer.load(); const receipt = { opId: randomUUID(), bufferVersion: 0, state: 'unknown' as const, recoveryId: randomUUID(), message: 'Unresolved save' }; buffer.saveReceipt = receipt;
    api.readDraft.mockResolvedValueOnce({ base64: Buffer.from(buffer.raw).toString('base64'), baseHash: buffer.baseHash, hash: hash(buffer.raw), bufferVersion: 7 });
    await expect(buffer.restoreDraft(randomUUID())).rejects.toThrow('恢复记录'); expect(buffer.saveReceipt).toBe(receipt); expect(api.readDraft).not.toHaveBeenCalled(); expect(api.resolveDraft).not.toHaveBeenCalled();
  });
  it('H29 keeps the draft and current editor when the fresh disk encoding no longer supports lossless recovery', async () => {
    const { buffer, api, external } = fixture(); await buffer.load(); const state = buffer.editor, baseHash = buffer.baseHash;
    external('\0BINARY'); api.readDraft.mockResolvedValueOnce({ base64: Buffer.from('LOCAL RECOVERY').toString('base64'), baseHash, hash: hash('LOCAL RECOVERY'), bufferVersion: 7 });
    await expect(buffer.restoreDraft(randomUUID())).rejects.toThrow('无损'); expect(buffer.editor).toBe(state); expect(buffer.raw).toBe('BASE\r\n'); expect(api.resolveDraft).not.toHaveBeenCalled();
  });
  it('H01 retries a failed first read on refresh without creating a second buffer', async () => {
    const { buffer, api } = fixture(); api.read.mockRejectedValueOnce(new Error('Unreadable first read'));
    await buffer.load(); expect(buffer.loadState).toBe('error'); expect(buffer.editor).toBeNull();
    await buffer.refresh(); expect(buffer.loadState).toBe('ready'); expect(buffer.raw).toBe('BASE\r\n'); expect(buffer.loadError).toBe('');
  });
  it('H01 retries recovery metadata after a load error without discarding subsequently edited source', async () => {
    const { buffer, api } = fixture(); api.drafts.mockRejectedValueOnce(new Error('Recovery metadata unavailable'));
    await buffer.load(); expect(buffer.loadState).toBe('error'); expect(buffer.editor).not.toBeNull();
    replace(buffer, 'UNSAVED LOCAL'); const editor = buffer.editor;
    await buffer.refresh(); expect(buffer.loadState).toBe('ready'); expect(buffer.loadError).toBe(''); expect(buffer.editor).toBe(editor);
    expect(buffer.raw).toBe('UNSAVED LOCAL'); expect(buffer.dirty).toBe(true); expect(api.drafts).toHaveBeenCalledTimes(2); expect(api.save).not.toHaveBeenCalled();
  });

  it('loads SVG source on mode entry, saves before returning to the image and retains source on a save conflict', async () => {
    const initial = '\ufeff<svg xmlns="http://www.w3.org/2000/svg">\r\n<text>中文🙂</text>\r\n</svg>', { buffer, file, api, disk } = fixture(initial);
    file.name = 'fixture.svg'; await buffer.load(); expect(api.read).not.toHaveBeenCalled();
    const store = new FileWorkspaceStore({ kind: 'project', projectId: 'fixture' }, api as unknown as FileClient, null);
    store.tabs.push({ id: 'svg', route: { source: 'project-directory', sourceId: 'root', sourcePath: '/fixture', relativePath: 'fixture.svg', mode: 'document' }, buffer, pinned: true, error: '', loading: false }); store.activeId = 'svg';
    await store.setMode(buffer, 'source'); expect(buffer.editor).not.toBeNull(); expect(buffer.mode).toBe('source');
    const offset = buffer.editor!.doc.toString().indexOf('中文'); const change = buffer.editor!.update({ changes: { from: offset, to: offset + 2, insert: '测试' } }); buffer.acceptTransactions(change.state, [change]);
    await store.setMode(buffer, 'document'); expect(disk()).toBe(initial.replace('中文', '测试')); expect(buffer.mode).toBe('document');
    const savedEditor = buffer.editor; await store.setMode(buffer, 'source'); expect(buffer.editor).toBe(savedEditor); expect(api.read).toHaveBeenCalledTimes(1);
    replace(buffer, '<svg>pending</svg>'); api.save.mockResolvedValueOnce({ opId: randomUUID(), bufferVersion: buffer.version, state: 'conflict' });
    await expect(store.setMode(buffer, 'document')).rejects.toThrow(); expect(buffer.mode).toBe('source'); expect(buffer.dirty).toBe(true); expect(disk()).toBe(initial.replace('中文', '测试'));
  });
  it('does not create an editor or read the complete bytes for non-text metadata', async () => {
    const { buffer, api } = fixture(); buffer.file.content = { kind: 'unsupported', format: 'rtf', basis: 'extension' };
    await buffer.load(); expect(api.read).not.toHaveBeenCalled(); expect(buffer.editor).toBeNull(); expect(buffer.editable).toBe(false);
  });
  it('drops a clean text view when the same local path becomes binary, then can recover to text', async () => {
    const { buffer, api, file, external } = fixture(); await buffer.load();
    external('BINARY'); api.refresh.mockResolvedValueOnce({ ...file, revision: { ...file.revision, hash: hash('BINARY') }, content: { kind: 'binary', basis: 'sample' } });
    await buffer.refresh(); expect(buffer.editor).toBeNull(); expect(buffer.content.kind).toBe('binary');
    external('RESTORED'); await buffer.refresh(); expect(buffer.raw).toBe('RESTORED'); expect(buffer.editable).toBe(true);
  });
  it('preserves CSV BOM, quoting, separators and mixed EOLs through preview and a targeted source save', async () => {
    const original = '\ufeffname,value\r\n"中文🙂","comma,quote""line\nnext"\n\rformula,=SUM(A1:A2)\r\n', { buffer, api, disk } = fixture(original);
    buffer.file.name = 'fixture.csv'; await buffer.load();
    const model = new CsvModel(buffer.raw, ','); expect(model.info).toMatchObject({ rows: 4, columns: 2, newline: 'mixed' });
    expect(await buffer.save()).toBe(true); expect(api.save).not.toHaveBeenCalled(); expect(disk()).toBe(original);
    const from = buffer.editor!.doc.toString().indexOf('formula'), transaction = buffer.editor!.update({ changes: { from, to: from + 7, insert: 'changed' } });
    buffer.acceptTransactions(transaction.state, [transaction]); expect(await buffer.save()).toBe(true);
    expect(disk()).toBe(original.replace('formula', 'changed')); expect(buffer.bom).toBe(true);
  });
  it('uses separate 500ms checkpoints and 3s autosaves', async () => {
    const { buffer, api, disk } = fixture(); await buffer.load(); replace(buffer, 'EDIT\n');
    await vi.advanceTimersByTimeAsync(499); expect(api.checkpoint).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(api.checkpoint).toHaveBeenCalledTimes(1); expect(disk()).toBe('BASE\r\n');
    await vi.advanceTimersByTimeAsync(2499); expect(api.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(api.save).toHaveBeenCalledTimes(1); expect(disk()).toBe('EDIT\r\n'); expect(buffer.dirty).toBe(false);
  });
  it('M9-T-H02: real history restores clean state without saving across checkpoint and autosave deadlines', async () => {
    const { buffer, api, disk } = fixture(); await buffer.load();
    const initialHash = buffer.baseHash, initialRevision = buffer.file.revision;
    const runHistory = (command: StateCommand) => command({
      state: buffer.editor!, dispatch: (transaction) => buffer.acceptTransactions(transaction.state, [transaction]),
    });
    const expectHistory = (canUndo: boolean, canRedo: boolean) => {
      // The commands report availability without changing the state when their
      // dispatch target is a probe. This checks the actual history branches.
      const state = buffer.editor!, dispatch = vi.fn();
      expect(undo({ state, dispatch })).toBe(canUndo);
      expect(redo({ state, dispatch })).toBe(canRedo);
      expect(dispatch).toHaveBeenCalledTimes(Number(canUndo) + Number(canRedo));
      expect(undoDepth(state)).toBe(Number(canUndo));
      expect(redoDepth(state)).toBe(Number(canRedo));
      expect(buffer.editor).toBe(state);
    };
    expect(buffer.dirty).toBe(false); expectHistory(false, false);

    const edit = buffer.editor!.update({ changes: { from: 2, to: 3, insert: 'X' }, userEvent: 'input.type' });
    buffer.acceptTransactions(edit.state, [edit]);
    expect(buffer.raw).toBe('BAXE\r\n'); expect(buffer.dirty).toBe(true); expectHistory(true, false);
    await vi.advanceTimersByTimeAsync(499);
    expect(api.checkpoint).not.toHaveBeenCalled(); expect(api.save).not.toHaveBeenCalled();

    expect(runHistory(undo)).toBe(true);
    expect(buffer.raw).toBe('BASE\r\n'); expect(buffer.dirty).toBe(false); expectHistory(false, true);
    await vi.advanceTimersByTimeAsync(1); // The cancelled 500ms checkpoint deadline.
    expect(api.checkpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2499);
    expect(api.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); // The cancelled 3000ms autosave deadline.
    expect(api.save).not.toHaveBeenCalled(); expect(api.resolveDraft).not.toHaveBeenCalled();

    expect(runHistory(redo)).toBe(true);
    expect(buffer.raw).toBe('BAXE\r\n'); expect(buffer.dirty).toBe(true); expectHistory(true, false);
    await vi.advanceTimersByTimeAsync(499); expect(api.checkpoint).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(api.checkpoint).toHaveBeenCalledTimes(1);
    expect(api.checkpoint).toHaveBeenCalledWith(expect.objectContaining({ bufferVersion: 3, baseHash: initialHash, base64: Buffer.from('BAXE\r\n').toString('base64') }));
    expect(api.save).not.toHaveBeenCalled(); expect(disk()).toBe('BASE\r\n');
    await vi.advanceTimersByTimeAsync(2499); expect(api.save).not.toHaveBeenCalled();

    expect(runHistory(undo)).toBe(true);
    expect(buffer.raw).toBe('BASE\r\n'); expect(buffer.dirty).toBe(false); expectHistory(false, true);
    await vi.advanceTimersByTimeAsync(1); // Cross the second 3000ms deadline after undoing at 2999ms.
    expect(api.resolveDraft).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ action: 'discard', bufferVersion: 3, hash: hash('BAXE\r\n') }));
    await vi.advanceTimersByTimeAsync(3000);
    expect(api.save).not.toHaveBeenCalled(); expect(api.checkpoint).toHaveBeenCalledTimes(1);
    expect(disk()).toBe('BASE\r\n'); expect(buffer.baseHash).toBe(initialHash); expect(buffer.file.revision).toBe(initialRevision);
    expect(buffer.version).toBe(4); expect(buffer.savedVersion).toBe(0); expect(buffer.dirty).toBe(false); expectHistory(false, true);
  });
  it('keeps new edits dirty when an older save completes', async () => {
    const { buffer, api, file } = fixture(); await buffer.load(); replace(buffer, 'FIRST');
    const wait = deferred<FileSaveReceipt>(); api.save.mockImplementationOnce(() => wait.promise);
    const pending = buffer.save(); await vi.advanceTimersByTimeAsync(0);
    const request = api.save.mock.calls[0][0]; replace(buffer, 'SECOND');
    wait.resolve({ opId: request.opId, bufferVersion: request.bufferVersion, state: 'saved', revision: { ...file.revision, hash: hash('FIRST'), size: 5 } });
    expect(await pending).toBe(false); expect(buffer.raw).toBe('SECOND'); expect(buffer.baseRaw).toBe('FIRST'); expect(buffer.dirty).toBe(true);
    expect(buffer.savedVersion).toBe(1); expect(buffer.version).toBe(3); // Newer input plus its acknowledged-base rebase.
  });
  it('reloads clean external edits and retains all dirty conflict versions', async () => {
    const { buffer, external, api, disk } = fixture(); await buffer.load(); external('CLEAN EXTERNAL'); await buffer.refresh();
    expect(buffer.raw).toBe('CLEAN EXTERNAL'); expect(buffer.dirty).toBe(false);
    replace(buffer, 'MY EDIT'); external('OTHER EDIT'); await buffer.refresh();
    expect(buffer.raw).toBe('MY EDIT'); expect(buffer.baseRaw).toBe('CLEAN EXTERNAL'); expect(buffer.conflict).toBe(true);
    await vi.advanceTimersByTimeAsync(4000); expect(api.save).not.toHaveBeenCalled();
    expect(await buffer.keepLocal()).toBe(true); expect(disk()).toBe('MY EDIT');
    expect(api.save.mock.calls[0][0].baseHash).toBe(hash('OTHER EDIT'));
  });
  it.each([false, true])('rechecks external events received before a save receipt without losing newer input (%s)', async newerInput => {
    const { buffer, api, external, disk } = fixture(); await buffer.load(); replace(buffer, 'SAVED LOCAL');
    const receipt = deferred<void>(), persist = api.save.getMockImplementation()!;
    api.save.mockImplementationOnce(async input => { const saved = await persist(input); await receipt.promise; return saved; });
    const saving = buffer.save(); await vi.advanceTimersByTimeAsync(0); expect(disk()).toBe('SAVED LOCAL');
    external('LATEST EXTERNAL'); if (newerInput) replace(buffer, 'NEWER LOCAL');
    await buffer.refresh(); await buffer.refresh(); await buffer.refresh();
    expect(api.refresh).not.toHaveBeenCalled(); receipt.resolve(); await saving; await vi.advanceTimersByTimeAsync(0);
    expect(api.refresh).toHaveBeenCalledTimes(1); expect(buffer.raw).toBe(newerInput ? 'NEWER LOCAL' : 'LATEST EXTERNAL');
    expect(buffer.conflict).toBe(newerInput); expect(buffer.dirty).toBe(newerInput); expect(disk()).toBe('LATEST EXTERNAL');
    await vi.advanceTimersByTimeAsync(6000); expect(api.save).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])('retains the original view and draft when its renamed capability rejects a same-name replacement (%s)', async dirty => {
    const { buffer, api, disk } = fixture(), failure = new FileError('CHANGED', '原文件已改名，此路径现在属于另一文件'); await buffer.load();
    const originalFile = buffer.file;
    if (dirty) { replace(buffer, 'LOCAL ORIGINAL DRAFT'); await buffer.checkpoint(); }
    api.refresh.mockRejectedValue(failure); api.read.mockRejectedValue(failure); api.save.mockRejectedValue(failure);
    await buffer.refresh(); expect(buffer.file).toBe(originalFile); expect(buffer.raw).toBe(dirty ? 'LOCAL ORIGINAL DRAFT' : 'BASE\r\n'); expect(buffer.loadError).toContain('另一文件'); expect(buffer.dirty).toBe(dirty);
    if (dirty) { expect(await buffer.save()).toBe(false); expect(await buffer.keepLocal()).toBe(false); expect(buffer.raw).toBe('LOCAL ORIGINAL DRAFT'); expect(buffer.dirty).toBe(true); expect(api.resolveDraft).not.toHaveBeenCalled(); }
    expect(disk()).toBe('BASE\r\n');
  });
  it('does not retry an unknown commit or remove recovery material after using disk', async () => {
    const { buffer, api } = fixture(); await buffer.load(); replace(buffer, 'MY EDIT');
    api.save.mockImplementationOnce(async (input) => ({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'unknown', recoveryId: input.opId, message: 'Inspect recovery' }));
    expect(await buffer.save()).toBe(false); expect(buffer.recoveryBlocked).toBe(true); expect(await buffer.keepLocal()).toBe(false);
    await vi.advanceTimersByTimeAsync(9000); expect(api.save).toHaveBeenCalledTimes(1);
    expect(await buffer.useDisk()).toBe(true); expect(buffer.raw).toBe('BASE\r\n');
    expect(api.resolveDraft).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard', draftId: buffer.draftId }));
  });
  it('resolves a superseded checkpoint when undo returns the buffer to disk content', async () => {
    const { buffer, api } = fixture('BASE'); await buffer.load(); replace(buffer, 'EDIT');
    await vi.advanceTimersByTimeAsync(500); replace(buffer, 'BASE'); await vi.advanceTimersByTimeAsync(0);
    expect(buffer.dirty).toBe(false); expect(api.resolveDraft).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard', bufferVersion: 1, hash: hash('EDIT') }));
    await vi.advanceTimersByTimeAsync(4000); expect(api.save).not.toHaveBeenCalled();
  });
  it.each(['success', 'error'])('S09 U: a newer load supersedes older %s without changing current clean content', async outcome => {
    const { buffer, api, file } = fixture('CURRENT B'), wait = deferred<FileRead>(); api.read.mockImplementationOnce(() => wait.promise);
    const old = buffer.load(); await buffer.load(); const current = buffer.editor;
    if (outcome === 'success') wait.resolve({ document: { ...file, revision: { ...file.revision, hash: hash('OLD A') } }, base64: Buffer.from('OLD A').toString('base64') }); else wait.reject(new Error('old read failure'));
    await old; expect(buffer.raw).toBe('CURRENT B'); expect(buffer.editor).toBe(current); expect(buffer.loadState).toBe('ready'); expect(buffer.loadError).toBe(''); expect(buffer.dirty).toBe(false); expect(buffer.conflict).toBe(false); expect(api.save).not.toHaveBeenCalled();
  });
  it('discards late success after disposal and releases the backend reference', async () => {
    const { buffer, api, changed, file } = fixture(); const wait = deferred<FileRead>(); api.read.mockImplementationOnce(() => wait.promise);
    const loading = buffer.load(); buffer.dispose(); const notifications = changed.mock.calls.length;
    wait.resolve({ document: file, base64: Buffer.from('LATE').toString('base64') }); await loading;
    expect(buffer.editor).toBeNull(); expect(changed).toHaveBeenCalledTimes(notifications); expect(api.closeDocument).toHaveBeenCalledWith(file.ref);
  });
  it('leaves the in-memory buffer intact if checkpoint storage fails', async () => {
    const { buffer, api } = fixture(); await buffer.load(); replace(buffer, 'UNSAVED');
    api.checkpoint.mockRejectedValueOnce(new Error('quota full'));
    expect(await buffer.save()).toBe(false); expect(api.save).not.toHaveBeenCalled();
    expect(buffer.raw).toBe('UNSAVED'); expect(buffer.dirty).toBe(true); expect(buffer.draftError).toContain('quota full');
    await vi.advanceTimersByTimeAsync(9000); expect(api.save).not.toHaveBeenCalled();
  });
  it('flushes the latest edit after awaiting an older save during close', async () => {
    const { buffer, api, file } = fixture(); await buffer.load(); replace(buffer, 'FIRST');
    const wait = deferred<FileSaveReceipt>(); api.save.mockImplementationOnce(() => wait.promise);
    const old = buffer.save(); await vi.advanceTimersByTimeAsync(0);
    const request = api.save.mock.calls[0][0]; replace(buffer, 'LAST');
    api.save.mockImplementationOnce(async (input) => ({ opId: input.opId, bufferVersion: input.bufferVersion, state: 'saved', revision: { ...file.revision, hash: hash('LAST'), size: 4 } }));
    const close = buffer.prepareClose('save');
    wait.resolve({ opId: request.opId, bufferVersion: request.bufferVersion, state: 'saved', revision: { ...file.revision, hash: hash('FIRST'), size: 5 } });
    await old; expect(await close).toBe(true);
    expect(api.save).toHaveBeenCalledTimes(2); expect(buffer.dirty).toBe(false); expect(buffer.baseRaw).toBe('LAST');
  });
  it('can explicitly discard a durable older draft when its latest checkpoint failed', async () => {
    const { buffer, api } = fixture(); await buffer.load(); replace(buffer, 'OLD'); await buffer.checkpoint();
    replace(buffer, 'LATEST'); api.checkpoint.mockRejectedValueOnce(new Error('disk full'));
    expect(await buffer.prepareClose('save')).toBe(false);
    expect(buffer.raw).toBe('LATEST'); expect(api.resolveDraft).not.toHaveBeenCalled();
    expect(await buffer.prepareClose('discard')).toBe(true);
    expect(api.resolveDraft).toHaveBeenCalledWith(expect.objectContaining({ action: 'discard', bufferVersion: 1, hash: hash('OLD') }));
    expect(api.save).not.toHaveBeenCalled();
  });
  it('keeps an updated draft if the discard receipt refuses an older version', async () => {
    const { buffer, api } = fixture(); await buffer.load(); replace(buffer, 'EDIT'); await buffer.checkpoint();
    api.resolveDraft.mockResolvedValueOnce({ resolved: false });
    await expect(buffer.prepareClose('discard')).rejects.toThrow('未放弃新版本');
    expect(buffer.raw).toBe('EDIT'); expect(buffer.dirty).toBe(true);
  });
});
