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
    related: vi.fn(async (): Promise<FileDocument> => ({ ...file, ref: { ...file.ref, id: randomUUID() } })),
    terminalBind: vi.fn(async () => ({ id: randomUUID(), taskId: target.taskId, ptyId: target.ptyId, lease: root.lease, generation: root.generation })), terminalRelease: vi.fn(async () => undefined),
    terminalPrepare: vi.fn(async () => ({ id: randomUUID(), relativePath: file.relativePath, revision: file.revision, identity: { device: '1', inode: '3' } })),
    terminalImageCapability: vi.fn(async () => ({ state: 'supported' as 'supported' | 'unsupported' | 'unknown', reason: 'known PNG adapter', acceptedMimeTypes: ['image/png'] })),
    terminalInsert: vi.fn(async (input: { operationId: string }): Promise<TerminalInsertionReceipt> => ({ operationId: input.operationId, state: 'inserted' as const, characters: 4, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false })),
  };
  const store = new FileTerminalContextStore(api as never); store.setRoot(root); disposers.push(store.attach());
  const path = { lease: root.lease, generation: root.generation, relativePath: file.relativePath };
  return { store, api, root, file, target, path };
}
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose(); endFileDrag(); vi.useRealTimers(); });
describe('terminal context lifecycle without model execution', () => {
  const imageFixture = async () => {
    const f = fixture(); await f.store.add(f.path);
    const image: FileDocument = { ...f.file, name: 'picture.png', relativePath: 'picture.png', content: { kind: 'image', mime: 'image/png', basis: 'signature' } };
    return { ...f, image };
  };
  it('hands off an exact image capability without removing existing references or claiming CLI acceptance', async () => {
    const f = await imageFixture(), notices: string[] = [];
    f.api.terminalInsert.mockImplementationOnce(async input => ({ operationId: input.operationId, state: 'inserted', characters: 80, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: true, confirmation: 'pty-write', image: { name: 'picture.png', mime: 'image/png', bytes: 78, sha256: f.image.revision.hash } }));
    await f.store.imageInput(new AbortController().signal)(f.image, f.image.revision.hash, text => notices.push(text));
    expect(f.api.terminalInsert).toHaveBeenCalledWith(expect.objectContaining({ kind: 'image', ref: f.image.ref, baseHash: f.image.revision.hash }));
    expect(f.api.terminalPrepare).not.toHaveBeenCalled(); expect(f.store.references).toHaveLength(1);
    expect(notices.at(-1)).toContain('请在终端检查图片草稿'); expect(f.target.focus).toHaveBeenCalledOnce();
  });
  it.each(['unsupported', 'unknown'] as const)('explains %s image input and preserves prior references with no insertion', async state => {
    const f = await imageFixture(); f.api.terminalImageCapability.mockResolvedValueOnce({ state, reason: 'fixture-specific unavailable reason', acceptedMimeTypes: [] });
    await f.store.imageInput(new AbortController().signal)(f.image, f.image.revision.hash, () => undefined);
    expect(f.store.notice).toBe('fixture-specific unavailable reason'); expect(f.store.state).toBe('failed'); expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(f.store.references).toHaveLength(1);
  });
  it('does not let a delayed source lookup reach a newly selected task', async () => {
    const f = await imageFixture(), insert = f.store.imageInput(new AbortController().signal);
    disposers.push(registerFileTerminal({ taskId: 'other-task', ptyId: 'other-pty', focus: vi.fn() }));
    await expect(insert(f.image, f.image.revision.hash, () => undefined)).rejects.toThrow('已切换');
    expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(f.store.references).toHaveLength(1);
  });
  it('revokes only the pending binding on source disposal and never resends a late image result', async () => {
    const f = await imageFixture(), reply = deferred<TerminalInsertionReceipt>(), owner = new AbortController();
    f.api.terminalInsert.mockImplementationOnce(() => reply.promise);
    const operation = f.store.imageInput(owner.signal)(f.image, f.image.revision.hash, () => undefined);
    await vi.waitFor(() => expect(f.api.terminalInsert).toHaveBeenCalledOnce()); owner.abort();
    reply.resolve({ operationId: f.api.terminalInsert.mock.calls[0][0].operationId, state: 'failed', message: 'cancelled before write' }); await operation;
    expect(f.api.terminalRelease).toHaveBeenCalledOnce(); expect(f.api.terminalInsert).toHaveBeenCalledOnce(); expect(f.store.references).toHaveLength(1); expect(f.target.focus).not.toHaveBeenCalled();
  });
  const docxFixture = () => {
    const f = fixture(); Object.assign(f.file, { name: '说明 #?.docx', relativePath: '资料/说明 #?.docx', writable: false, attachment: { textKind: null }, content: { kind: 'office', format: 'docx' } });
    const selection = { docx: { page: 2 }, text: '原文段落🙂', comment: '请核对段落', version: 0, instance: 'docx', selectedTextHash: textFingerprint('原文段落🙂'), current: () => true };
    return { ...f, selection };
  };
  it('captures DOCX through its original grant and preserves readonly attachment/quote without text lines', async () => {
    const f = docxFixture(); expect(await f.store.addDocx(f.file, f.selection)).toBe(true);
    expect(f.api.open).not.toHaveBeenCalled(); expect(f.api.related).toHaveBeenCalledWith(f.file.ref, encodeURIComponent(f.file.name));
    expect(f.store.references[0].file.attachment).toEqual(f.file.attachment); expect(f.store.references[0].file.writable).toBe(false);
    expect(f.store.preview.text).toBe('资料/说明 #?.docx:第 2 页\n> 请核对段落\n    原文段落🙂'); expect(f.api.terminalInsert).not.toHaveBeenCalled();
    const ref = f.store.references[0].file.ref;
    await f.store.insert(); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
    expect(f.api.terminalPrepare).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'document', ref } }));
    expect(f.api.terminalInsert.mock.calls[0][0]).toMatchObject({ kind: 'context', includeText: true, references: [{ kind: 'docx-comment', docx: { page: 2 }, text: f.selection.text, comment: f.selection.comment }] });
  });
  it('closes a captured DOCX grant if its actual source hash changed during preparation', async () => {
    const f = docxFixture(), changed = { ...f.file, ref: { ...f.file.ref, id: randomUUID() }, revision: { ...f.file.revision, hash: 'b'.repeat(64) } };
    f.api.related.mockResolvedValueOnce(changed); expect(await f.store.addDocx(f.file, f.selection)).toBe(false);
    expect(f.store.references).toEqual([]); expect(f.api.closeDocument).toHaveBeenCalledWith(changed.ref); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('rejects late DOCX capture across root change and releases the returned private reference', async () => {
    const f = docxFixture(), gate = deferred<FileDocument>(); f.api.related.mockImplementationOnce(() => gate.promise);
    const work = f.store.addDocx(f.file, f.selection); await vi.waitFor(() => expect(f.api.related).toHaveBeenCalledOnce());
    f.store.setRoot({ ...f.root, lease: randomUUID(), generation: 2 }); gate.resolve(f.file);
    expect(await work).toBe(false); expect(f.store.references).toEqual([]); expect(f.api.closeDocument).toHaveBeenCalledWith(f.file.ref); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('rejects missing/ambiguous paragraph context before capturing or dispatching', async () => {
    const f = docxFixture();
    for (const change of [{ text: ' ' }, { comment: ' ' }, { docx: { page: 0 } }, { range: { startLine: 1, endLine: 1 } }]) expect(await f.store.addDocx(f.file, { ...f.selection, ...change })).toBe(false);
    expect(f.api.open).not.toHaveBeenCalled(); expect(f.api.related).not.toHaveBeenCalled(); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  });
  const pptxFixture = () => {
    const f = fixture(); Object.assign(f.file, { name: '演示 #?.pptx', relativePath: '资料/演示 #?.pptx', absolutePath: '/tmp/project/资料/演示 #?.pptx', writable: false, sourceReadOnly: false, content: { kind: 'office', format: 'pptx' } });
    const selection = { pptx: { slideId: '256', page: 1 }, text: '', comment: '请调整版面', version: 3, instance: 'pptx', selectedTextHash: textFingerprint(''), current: () => true };
    return { ...f, selection };
  };
  it('captures the original PPTX grant and copies its slide locator before asynchronous queueing; insertion stays explicit', async () => {
    const f = pptxFixture(), operation = f.store.addPptx(f.file, f.selection); f.selection.pptx.page = 2;
    expect(await operation).toBe(true); expect(f.api.open).not.toHaveBeenCalled(); expect(f.api.related).toHaveBeenCalledWith(f.file.ref, encodeURIComponent(f.file.name));
    expect(f.store.references[0].selection?.pptx).toEqual({ slideId: '256', page: 1 }); expect(f.store.preview.text).toBe('资料/演示 #?.pptx:第 1 张幻灯片\n> 请调整版面');
    const capturedRef = f.store.references[0].file.ref;
    expect(f.api.terminalInsert).not.toHaveBeenCalled(); await f.store.insert();
    expect(f.api.terminalPrepare).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'document', ref: capturedRef } }));
    expect(f.api.terminalInsert.mock.calls[0][0]).toMatchObject({ kind: 'context', references: [{ kind: 'pptx-comment', pptx: { slideId: '256', page: 1 }, comment: '请调整版面', text: '' }] });
  });
  it('keeps strong readonly PPTX and mixed location input out of the capture path', async () => {
    const f = pptxFixture(); f.file.sourceReadOnly = true; expect(await f.store.addPptx(f.file, f.selection)).toBe(false);
    f.file.sourceReadOnly = false; expect(await f.store.addPptx(f.file, { ...f.selection, range: { startLine: 1, endLine: 1 } })).toBe(false);
    expect(f.api.related).not.toHaveBeenCalled(); expect(f.store.references).toEqual([]); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('releases a related PPTX source if the actual newly issued grant became strong readonly', async () => {
    const f = pptxFixture(), captured = { ...f.file, sourceReadOnly: true, ref: { ...f.file.ref, id: randomUUID() } }; f.api.related.mockResolvedValueOnce(captured);
    expect(await f.store.addPptx(f.file, f.selection)).toBe(false); expect(f.store.references).toEqual([]); expect(f.api.closeDocument).toHaveBeenCalledWith(captured.ref); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  });
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
  it('Y33 all file formats use only opaque path insertion, without a tray or content payload', async () => {
    for(const extension of ['txt','md','docx','pdf','png','jpg','unknown-m9']) {
      const f=fixture(),notice=vi.fn();f.file.name=f.file.relativePath='sample.'+extension;f.file.absolutePath='/tmp/project/'+f.file.name;
      const path={...f.path,relativePath:f.file.relativePath},drag=f.store.startDrag(path)!;await dropFileToTerminal(drag.token,f.target,notice);
      expect(f.api.open).toHaveBeenCalledWith(path);expect(f.api.terminalPrepare).toHaveBeenCalledWith(expect.objectContaining({target:expect.objectContaining({kind:'document'})}));
      expect(f.api.terminalInsert).toHaveBeenCalledOnce();const input=f.api.terminalInsert.mock.calls[0][0];expect(input).toMatchObject({kind:'path'});expect(Object.keys(input).sort()).toEqual(['bindingId','kind','operationId','sourceId']);expect(f.store.references).toEqual([]);expect(f.target.focus).toHaveBeenCalledOnce();
    }
  });
  it('consumes each drag only once, distinct drags each insert, cancel and cross-target do not insert', async () => {
    const f = fixture(), notice = vi.fn(), cancelled = f.store.startDrag(f.path)!; cancelled.end(); await dropFileToTerminal(cancelled.token, f.target, notice); expect(f.api.terminalInsert).not.toHaveBeenCalled();
    const first = f.store.startDrag(f.path)!; await Promise.all([dropFileToTerminal(first.token, f.target, notice), dropFileToTerminal(first.token, f.target, notice)]); expect(f.api.terminalInsert).toHaveBeenCalledTimes(1);
    const second = f.store.startDrag(f.path)!; await dropFileToTerminal(second.token, f.target, notice); expect(f.api.terminalInsert).toHaveBeenCalledTimes(2); expect(f.store.references).toEqual([]);
    const old = f.store.startDrag(f.path)!; const other = { taskId: 'other', ptyId: 'other-pty', focus: vi.fn() }; disposers.push(registerFileTerminal(other)); await dropFileToTerminal(old.token, other, notice); expect(f.api.terminalInsert).toHaveBeenCalledTimes(2); expect(notice).toHaveBeenLastCalledWith('拖动目标已改变，请重新拖动');
  });
  it.each(['inserted', 'failed'] as const)('Y37 path delivery stays unknown at1500ms and accepts its original late %s only once', async state => {
    vi.useFakeTimers(); const f = fixture(), reply = deferred<TerminalInsertionReceipt>(), notice = vi.fn();
    f.api.terminalInsert.mockImplementationOnce(() => reply.promise); const drag = f.store.startDrag(f.path)!;
    const pending = dropFileToTerminal(drag.token, f.target, notice); await vi.advanceTimersByTimeAsync(1499);
    expect(f.store.state).toBe('inserting'); expect(f.api.terminalInsert).toHaveBeenCalledOnce(); expect(f.store.references).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); expect(f.store.state).toBe('unknown'); expect(notice).toHaveBeenLastCalledWith(expect.stringContaining('结果未知'));
    await vi.advanceTimersByTimeAsync(2000); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
    const operationId = f.api.terminalInsert.mock.calls[0][0].operationId;
    reply.resolve(state === 'failed' ? { operationId, state, message: 'original source refused' } : { operationId, state, characters: 20, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false });
    await pending; expect(f.store.state).toBe(state); expect(f.api.terminalInsert).toHaveBeenCalledOnce(); expect(f.store.references).toEqual([]);
    expect(f.target.focus).toHaveBeenCalledTimes(state === 'inserted' ? 1 : 0);
    await dropFileToTerminal(drag.token, f.target, notice); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
  });
  it.each(['root', 'target'] as const)('path preparation pending across %s invalidation never dispatches', async boundary => {
    const f = fixture(), prepared = deferred<Awaited<ReturnType<typeof f.api.terminalPrepare>>>(), notice = vi.fn();
    f.api.terminalPrepare.mockImplementationOnce(() => prepared.promise); const drag = f.store.startDrag(f.path)!;
    const pending = dropFileToTerminal(drag.token, f.target, notice); await vi.waitFor(() => expect(f.api.terminalPrepare).toHaveBeenCalledOnce());
    if (boundary === 'root') f.store.setRoot({ ...f.root, lease: randomUUID(), generation: 2 });
    else disposers.push(registerFileTerminal({ taskId: 'other', ptyId: 'new-pty', focus: vi.fn() }));
    prepared.resolve({ id: randomUUID(), relativePath: f.file.relativePath, revision: f.file.revision, identity: f.file.revision }); await pending;
    expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(f.target.focus).not.toHaveBeenCalled();
  });
  it.each(['inserted', 'failed'] as const)('path late %s after target switch cannot change the new context or write/focus again', async state => {
    const f = fixture(), reply = deferred<TerminalInsertionReceipt>(), notice = vi.fn(); f.api.terminalInsert.mockImplementationOnce(() => reply.promise);
    const drag = f.store.startDrag(f.path)!, pending = dropFileToTerminal(drag.token, f.target, notice); await vi.waitFor(() => expect(f.api.terminalInsert).toHaveBeenCalledOnce());
    const other = { taskId: 'other', ptyId: 'new-pty', focus: vi.fn() }; disposers.push(registerFileTerminal(other)); const before = { state: f.store.state, notice: f.store.notice, callbacks: notice.mock.calls.length };
    const operationId = f.api.terminalInsert.mock.calls[0][0].operationId; reply.resolve(state === 'failed' ? { operationId, state, message: 'old source failed' } : { operationId, state, characters: 20, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false });
    await pending; expect({ state: f.store.state, notice: f.store.notice, callbacks: notice.mock.calls.length }).toEqual(before);
    expect(f.api.terminalInsert).toHaveBeenCalledOnce(); expect(f.target.focus).not.toHaveBeenCalled(); expect(other.focus).not.toHaveBeenCalled();
  });

  it('Y39 never treats forged path/root/file/task JSON or URL text as a captured token', async () => {
    const f = fixture(), notice = vi.fn();
    for (const token of [JSON.stringify({path:'/private/forged.txt',rootId:f.root.lease,fileId:f.file.ref.id,taskId:f.target.taskId}), f.file.ref.id, f.root.lease, 'https://invalid.example/p.png', 'data:image/png;base64,AA==', 'blob:synthetic', '/private/forged.txt']) await dropFileToTerminal(token, f.target, notice);
    expect(f.api.open).not.toHaveBeenCalled(); expect(f.api.terminalBind).not.toHaveBeenCalled(); expect(f.api.terminalPrepare).not.toHaveBeenCalled(); expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(notice).not.toHaveBeenCalled();
    const valid = f.store.startDrag(f.path)!; await dropFileToTerminal(valid.token, f.target, notice); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
  });
  it('Y37 has no path token or prepare/write when no visible terminal is available', () => {
    const f = fixture(false); expect(f.store.startDrag(f.path)).toBeNull(); expect(f.store.notice).toContain('当前没有可用的任务终端');
    expect(f.api.open).not.toHaveBeenCalled(); expect(f.api.terminalBind).not.toHaveBeenCalled(); expect(f.api.terminalPrepare).not.toHaveBeenCalled(); expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(f.store.references).toEqual([]);
  });

  it('Y38 reports a cancelled native payload once without writing, and never treats it as a new drag', async () => {
    const f = fixture(), notice = vi.fn(), drag = f.store.startDrag(f.path)!; drag.end();
    await dropFileToTerminal(drag.token, f.target, notice); expect(f.api.terminalInsert).not.toHaveBeenCalled(); expect(notice).toHaveBeenCalledOnce(); expect(notice).toHaveBeenLastCalledWith(expect.stringContaining('重新拖动'));
    notice.mockClear(); await dropFileToTerminal(drag.token, f.target, notice); expect(notice).not.toHaveBeenCalled(); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  });
  it('Y38 a new successful drag discards old cancellation hints so delayed old input cannot replace its state', async () => {
    const f = fixture(), notice = vi.fn(), old = f.store.startDrag(f.path)!; old.end();
    const fresh = f.store.startDrag(f.path)!; await dropFileToTerminal(fresh.token, f.target, notice); expect(f.store.state).toBe('inserted');
    const before = f.store.notice; notice.mockClear(); await dropFileToTerminal(old.token, f.target, notice);
    expect(notice).not.toHaveBeenCalled(); expect(f.store.notice).toBe(before); expect(f.api.terminalInsert).toHaveBeenCalledOnce();
  });

});
