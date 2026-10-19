import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileDocument, FileRoot } from '@shared/files';
import type { TerminalInsertionReceipt } from '@shared/file-terminal';
import { FileTerminalContextStore, registerFileTerminal, dropFileToTerminal, endFileDrag, textFingerprint } from './store';
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
const disposers: (() => void)[] = [];
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture(running = true) {
  const root: FileRoot = { lease: randomUUID(), generation: 1, source: 'task-cwd', sourceId: 'source', path: '/tmp/project', canonicalPath: '/tmp/project', identity: { device: '1', inode: '2' }, label: 'Fixture' };
  const file: FileDocument = { ref: { lease: root.lease, generation: 1, id: randomUUID() }, documentKey: 'local:1:3', name: 'a.ts', relativePath: 'a.ts', absolutePath: '/tmp/project/a.ts', writable: true, revision: { device: '1', inode: '3', hash: 'a'.repeat(64), size: 4, modifiedNs: '1', changedNs: '1' }, content: { kind: 'text', mime: 'text/plain', language: 'typescript' } as never };
  const target = { taskId: 'task', ptyId: 'pty', focus: vi.fn() };
  if (running) disposers.push(registerFileTerminal(target));
  const api = {
    open: vi.fn(async () => ({ ...file, ref: { ...file.ref, id: randomUUID() } })), refresh: vi.fn(async () => file), closeDocument: vi.fn(async () => undefined),
    terminalBind: vi.fn(async () => ({ id: randomUUID(), taskId: target.taskId, ptyId: target.ptyId, lease: root.lease, generation: root.generation })), terminalRelease: vi.fn(async () => undefined),
    terminalPrepare: vi.fn(async () => ({ id: randomUUID(), relativePath: file.relativePath, revision: file.revision, identity: { device: '1', inode: '3' } })),
    terminalInsert: vi.fn(async (input: { operationId: string }): Promise<TerminalInsertionReceipt> => ({ operationId: input.operationId, state: 'inserted' as const, characters: 4, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false })),
  };
  const store = new FileTerminalContextStore(api as never); store.setRoot(root); disposers.push(store.attach());
  const path = { lease: root.lease, generation: root.generation, relativePath: file.relativePath };
  return { store, api, root, file, target, path };
}
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); endFileDrag(); vi.useRealTimers(); });
describe('terminal context lifecycle without model execution', () => {
  it('collects and previews references while stopped, then removes/clears without insertion', async () => {
    const f = fixture(false); await f.store.add(f.path); expect(f.store.references).toHaveLength(1); expect(f.store.canInsert).toBe(false); expect(f.store.preview.text).toBe('a.ts');
    f.store.options(false, 'at'); expect(f.store.preview.text).toBe('@a.ts'); f.store.remove(f.store.references[0].id); expect(f.store.references).toEqual([]); expect(f.api.terminalInsert).not.toHaveBeenCalled();
    await f.store.add(f.path); f.store.clear(); expect(f.store.references).toEqual([]); expect(f.api.closeDocument).toHaveBeenCalledTimes(2);
  });
  it('times out at 1500ms, never retries and accepts only its late matching receipt', async () => {
    vi.useFakeTimers(); const f = fixture(), reply = deferred<Awaited<ReturnType<typeof f.api.terminalInsert>>>(); f.api.terminalInsert.mockImplementation(() => reply.promise); await f.store.add(f.path);
    const operation = f.store.insert(); await vi.advanceTimersByTimeAsync(0); expect(f.store.state).toBe('inserting');
    await vi.advanceTimersByTimeAsync(1499); expect(f.store.state).toBe('inserting'); await vi.advanceTimersByTimeAsync(1); expect(f.store.state).toBe('unknown'); expect(f.store.references).toHaveLength(1);
    await f.store.insert(); await vi.advanceTimersByTimeAsync(9000); expect(f.api.terminalInsert).toHaveBeenCalledTimes(1);
    reply.resolve({ operationId: f.api.terminalInsert.mock.calls[0][0].operationId, state: 'inserted', characters: 4, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false }); await operation;
    expect(f.store.state).toBe('inserted'); expect(f.store.references).toEqual([]); expect(f.target.focus).toHaveBeenCalledTimes(1);
  });
  it('retains references after explicit refusal and allows a new explicit retry', async () => {
    const f = fixture(); await f.store.add(f.path); f.api.terminalInsert.mockImplementationOnce(async input => ({ operationId: input.operationId, state: 'failed', message: 'stopped before write' })); await f.store.insert(); expect(f.store.state).toBe('failed'); expect(f.store.references).toHaveLength(1);
    await f.store.insert(); expect(f.store.state).toBe('inserted'); expect(f.api.terminalInsert).toHaveBeenCalledTimes(2); expect(f.api.terminalInsert.mock.calls[0][0].operationId).not.toBe(f.api.terminalInsert.mock.calls[1][0].operationId);
  });
  it('keeps an unacknowledged dispatched write unknown after transport rejection', async () => {
    const f = fixture(); await f.store.add(f.path); f.api.terminalInsert.mockRejectedValueOnce(new Error('connection lost after write'));
    await f.store.insert(); expect(f.store.state).toBe('unknown'); expect(f.store.references).toHaveLength(1);
    await f.store.insert(); expect(f.api.terminalInsert).toHaveBeenCalledTimes(1); expect(f.target.focus).not.toHaveBeenCalled();
  });
  it.each(['mismatched', 'unknown'])('retains references and blocks retry for %s receipt', async kind => {
    const f = fixture(); await f.store.add(f.path);
    f.api.terminalInsert.mockImplementationOnce(async input => kind === 'unknown'
      ? { operationId: input.operationId, state: 'unknown', message: 'native write uncertain' }
      : { operationId: randomUUID(), state: 'inserted', characters: 4, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false });
    await f.store.insert(); expect(f.store.state).toBe('unknown'); expect(f.store.references).toHaveLength(1);
    await f.store.insert(); expect(f.api.terminalInsert).toHaveBeenCalledOnce(); expect(f.target.focus).not.toHaveBeenCalled();
  });
  it('cancels before dispatch and ignores old acknowledgements after root change', async () => {
    const f = fixture(), prepared = deferred<Awaited<ReturnType<typeof f.api.terminalPrepare>>>(); f.api.terminalPrepare.mockImplementationOnce(() => prepared.promise); await f.store.add(f.path);
    const pending = f.store.insert(); await vi.waitFor(() => expect(f.api.terminalPrepare).toHaveBeenCalledOnce()); f.store.clear(); prepared.resolve({ id: randomUUID(), relativePath: 'a.ts', revision: f.file.revision, identity: f.file.revision }); await pending;
    expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(f.store.state).toBe('idle');
    const reply = deferred<Awaited<ReturnType<typeof f.api.terminalInsert>>>(); f.api.terminalInsert.mockImplementationOnce(() => reply.promise); await f.store.add(f.path); const late = f.store.insert(); await vi.waitFor(() => expect(f.api.terminalInsert).toHaveBeenCalledOnce());
    f.store.setRoot({ ...f.root, lease: randomUUID(), generation: 2 }); reply.reject(new Error('old failure')); await late;
    expect(f.store.state).toBe('idle'); expect(f.store.notice).toBe(''); expect(f.target.focus).not.toHaveBeenCalled();
  });
  it('marks changed revision/selection as stale, but missing identity blocks insertion', async () => {
    const f = fixture(); let current = true;
    await f.store.add(f.path, f.file.revision, { text: '中文', range: { startLine: 1, endLine: 1 }, version: 1, instance: 'buffer', selectedTextHash: textFingerprint('中文'), current: () => current });
    current = false; await f.store.refresh(); expect(f.store.references[0].state).toBe('stale'); expect(f.store.canInsert).toBe(true);
    f.api.refresh.mockResolvedValue({ ...f.file, revision: { ...f.file.revision, inode: 'replaced' } }); await f.store.refresh(); expect(f.store.references[0].state).toBe('missing'); expect(f.store.canInsert).toBe(false);
  });
  it.each(['clear', 'root', 'target', 'detach'] as const)('ignores late success and failure after %s without touching a new context', async boundary => {
    for (const receipt of ['inserted', 'failed'] as const) {
      const f = fixture(), reply = deferred<TerminalInsertionReceipt>(); await f.store.add(f.path); f.api.terminalInsert.mockImplementationOnce(() => reply.promise);
      const pending = f.store.insert(); await vi.waitFor(() => expect(f.api.terminalInsert).toHaveBeenCalledOnce());
      if (boundary === 'clear') f.store.clear();
      if (boundary === 'root') f.store.setRoot({ ...f.root, lease: randomUUID(), generation: 2 });
      if (boundary === 'target') disposers.push(registerFileTerminal({ taskId: 'next', ptyId: 'next-pty', focus: vi.fn() }));
      if (boundary === 'detach') disposers.pop()!();
      const before = { state: f.store.state, notice: f.store.notice, references: [...f.store.references] };
      reply.resolve(receipt === 'failed' ? { operationId: f.api.terminalInsert.mock.calls[0][0].operationId, state: 'failed', message: 'old source refused' }
        : { operationId: f.api.terminalInsert.mock.calls[0][0].operationId, state: 'inserted', characters: 4, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false });
      await pending; expect({ state: f.store.state, notice: f.store.notice, references: f.store.references }).toEqual(before);
      expect(f.api.terminalInsert).toHaveBeenCalledOnce(); expect(f.target.focus).not.toHaveBeenCalled();
    }
  });
  it.each(['clear', 'root', 'target', 'detach'] as const)('never dispatches a prepared old selection after %s', async boundary => {
    const f = fixture(), prepared = deferred<Awaited<ReturnType<typeof f.api.terminalPrepare>>>(); await f.store.add(f.path); f.api.terminalPrepare.mockImplementationOnce(() => prepared.promise);
    const pending = f.store.insert(); await vi.waitFor(() => expect(f.api.terminalPrepare).toHaveBeenCalledOnce());
    if (boundary === 'clear') f.store.clear();
    if (boundary === 'root') f.store.setRoot({ ...f.root, lease: randomUUID(), generation: 2 });
    if (boundary === 'target') disposers.push(registerFileTerminal({ taskId: 'next', ptyId: 'next-pty', focus: vi.fn() }));
    if (boundary === 'detach') disposers.pop()!();
    prepared.resolve({ id: randomUUID(), relativePath: 'a.ts', revision: f.file.revision, identity: f.file.revision }); await pending;
    expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(f.target.focus).not.toHaveBeenCalled();
  });
  it('keeps the context through exactly 1500ms and permits explicit retry only after a late failed receipt', async () => {
    vi.useFakeTimers(); const f = fixture(), reply = deferred<TerminalInsertionReceipt>(); await f.store.add(f.path); f.api.terminalInsert.mockImplementationOnce(() => reply.promise);
    const pending = f.store.insert(); await vi.advanceTimersByTimeAsync(1499); expect(f.store.state).toBe('inserting');
    await vi.advanceTimersByTimeAsync(1); expect(f.store.state).toBe('unknown'); expect(f.store.references).toHaveLength(1); await f.store.insert(); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
    reply.resolve({ operationId: f.api.terminalInsert.mock.calls[0][0].operationId, state: 'failed', message: 'source closed before write' }); await pending;
    expect(f.store.state).toBe('failed'); expect(f.store.references).toHaveLength(1); expect(f.store.canInsert).toBe(true); await f.store.insert(); expect(f.store.state).toBe('inserted'); expect(f.api.terminalInsert).toHaveBeenCalledTimes(2);
  });
  it('blocks aggregate overflow in the visible preview and recovers when optional selected text is omitted', async () => {
    const f = fixture(), text = '中'.repeat(4000), comment = 'i'.repeat(3990);
    await f.store.add(f.path, f.file.revision, { text, comment, range: { startLine: 1, endLine: 1 }, version: 1, instance: 'buffer', selectedTextHash: textFingerprint(text), current: () => true });
    f.store.options(true, 'plain'); expect(f.store.preview.text).toBe(''); expect(f.store.preview.note).toContain('8000'); await f.store.insert(); expect(f.api.terminalInsert).not.toHaveBeenCalled();
    f.store.options(false, 'plain'); expect(f.store.preview.text).toBe('a.ts:L1\n> ' + comment); await f.store.insert(); expect(f.store.state).toBe('inserted'); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
  });
  it('consumes each drag only once, distinct drags each insert, cancel and cross-target do not insert', async () => {
    const f = fixture(), notice = vi.fn(), cancelled = f.store.startDrag(f.path)!; cancelled.end(); await dropFileToTerminal(cancelled.token, f.target, notice); expect(f.api.terminalInsert).not.toHaveBeenCalled();
    const first = f.store.startDrag(f.path)!; await Promise.all([dropFileToTerminal(first.token, f.target, notice), dropFileToTerminal(first.token, f.target, notice)]); expect(f.api.terminalInsert).toHaveBeenCalledTimes(1);
    const second = f.store.startDrag(f.path)!; await dropFileToTerminal(second.token, f.target, notice); expect(f.api.terminalInsert).toHaveBeenCalledTimes(2); expect(f.store.references).toEqual([]);
    const old = f.store.startDrag(f.path)!; const other = { taskId: 'other', ptyId: 'other-pty', focus: vi.fn() }; disposers.push(registerFileTerminal(other)); await dropFileToTerminal(old.token, other, notice); expect(f.api.terminalInsert).toHaveBeenCalledTimes(2); expect(notice).toHaveBeenLastCalledWith('拖动目标已改变，请重新拖动');
  });
});
