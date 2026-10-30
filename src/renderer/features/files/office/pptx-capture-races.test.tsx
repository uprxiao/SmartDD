// @vitest-environment jsdom
// Renderer-I only: real hook/provider/tray/store, deferred RPC transport and a
// small owned-buffer model seam. No App, native broker, PTY, CLI or DOM user A.
import { randomUUID } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileBuffer } from '@renderer/features/files/file-buffer';
import type { FileDocument, FileRoot } from '@shared/files';
import { usePptxRequests } from '@renderer/features/files/office/pptx-context';
import { FileTerminalContextProvider, TerminalReferenceTray, useFileTerminalContext } from '@renderer/features/files/terminal-context/context';
import { registerFileTerminal, type FileTerminalContextStore } from '@renderer/features/files/terminal-context/store';

const transport = vi.hoisted(() => ({ files: {} as Record<string, unknown> }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: transport.files } }));
const disposers: (() => void)[] = [];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  const root: FileRoot = { lease: randomUUID(), generation: 1, source: 'task-cwd', sourceId: 'g332-owned', path: '/synthetic/g332', canonicalPath: '/synthetic/g332', identity: { device: '1', inode: '2' }, label: 'G332 renderer-I' };
  const file = { ref: { lease: root.lease, generation: 1, id: randomUUID() }, documentKey: 'local:1:3', name: 'context.pptx', relativePath: 'context.pptx', absolutePath: '/synthetic/g332/context.pptx', writable: false, sourceReadOnly: false,
    revision: { device: '1', inode: '3', hash: 'a'.repeat(64), size: 123, modifiedNs: '1', changedNs: '1' }, content: { kind: 'office', format: 'pptx' } } as FileDocument;
  const captured = { ...file, ref: { ...file.ref, id: randomUUID() } }, gate = deferred<FileDocument>();
  const target = { taskId: 'g332-task', ptyId: 'g332-owned-pty-symbol-only', focus: vi.fn() };
  disposers.push(registerFileTerminal(target));
  const state = { version: 3, protected: false, info: { slides: [{ id: '256', title: '公开模型', hidden: false, notes: 'speaker notes remain separate', elements: [] }] } };
  const buffer = { instance: 'same-owned-buffer', file, baseHash: file.revision.hash, sourceUnavailable: '', pdfPosition: { page: 1 },
    pptx: { id: 'controller-before', editing: false, selection: null, result: { state }, action: vi.fn(), history: vi.fn() }, save: vi.fn() };
  const api = {
    open: vi.fn(async () => captured), related: vi.fn(() => gate.promise), refresh: vi.fn(async () => captured), closeDocument: vi.fn(async () => undefined),
    terminalBind: vi.fn(async () => ({ id: randomUUID(), taskId: target.taskId, ptyId: target.ptyId, lease: root.lease, generation: root.generation })), terminalRelease: vi.fn(async () => undefined),
    terminalPrepare: vi.fn(async () => ({ id: randomUUID(), relativePath: file.relativePath, revision: captured.revision, identity: { device: '1', inode: '3' } })),
    terminalInsert: vi.fn(async (input: { operationId: string }) => ({ operationId: input.operationId, state: 'inserted', characters: 40, removed: 0, replaced: 0, truncated: 0, stale: [], bracketed: false })),
  };
  Object.assign(transport.files, api);
  const workspace = { treeRoot: root, snapshot: () => 0 };
  let store: FileTerminalContextStore | null = null;
  function Body() {
    store = useFileTerminalContext();
    const request = usePptxRequests(buffer as unknown as FileBuffer, buffer.pdfPosition.page, state.info.slides[buffer.pdfPosition.page - 1], true);
    return <><button aria-label="请求修改" disabled={!request.onRequestEdits} onClick={request.onRequestEdits}>请求修改</button>{request.panel}<TerminalReferenceTray /></>;
  }
  function Surface() { return <FileTerminalContextProvider workspace={workspace as never}><Body /></FileTerminalContextProvider>; }
  const view = render(<Surface />);
  const rerender = () => view.rerender(<Surface />);
  const ownedStore = () => { if (!store) throw new Error('actual provider did not create a store'); return store; };
  return { root, file, captured, gate, target, state, buffer, api, workspace, rerender, ownedStore };
}
async function begin(f: ReturnType<typeof fixture>) {
  await waitFor(() => expect((screen.getByRole('button', { name: '请求修改' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '请求修改' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'PPTX 修改指令' }), { target: { value: '请保留本条评论，不执行任何命令' } });
  fireEvent.click(screen.getByRole('button', { name: '加入终端引用' }));
  await waitFor(() => expect(f.api.related).toHaveBeenCalledOnce());
}
function noMutationOrDelivery(f: ReturnType<typeof fixture>) {
  expect(f.api.open).not.toHaveBeenCalled(); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  expect(f.api.terminalPrepare).not.toHaveBeenCalled(); expect(f.buffer.save).not.toHaveBeenCalled();
  expect(f.buffer.pptx.action).not.toHaveBeenCalled(); expect(f.buffer.pptx.history).not.toHaveBeenCalled();
  expect(f.ownedStore().references).toEqual([]); expect(f.target.focus).not.toHaveBeenCalled();
}
afterEach(() => { cleanup(); for (const dispose of disposers.splice(0).reverse()) dispose(); for (const key of Object.keys(transport.files)) delete transport.files[key]; vi.clearAllMocks(); });

it.each(['target', 'root', 'source-unavailable', 'strong-readonly', 'model-version', 'source-hash'] as const)('rejects a late capture after %s changed, releases the new grant and never inserts', async reason => {
  const f = fixture(); await begin(f);
  act(() => {
    if (reason === 'target') disposers.push(registerFileTerminal({ taskId: 'other-owned-task', ptyId: 'other-pty-symbol-only', focus: vi.fn() }));
    if (reason === 'root') f.workspace.treeRoot = { ...f.root, lease: randomUUID(), generation: 2 };
    if (reason === 'source-unavailable') f.buffer.sourceUnavailable = 'actual source invalidation represented at renderer boundary';
    if (reason === 'strong-readonly') f.buffer.file.sourceReadOnly = true;
    if (reason === 'model-version') f.state.version++;
    if (reason === 'source-hash') f.buffer.baseHash = 'b'.repeat(64);
    f.rerender();
  });
  await act(async () => { f.gate.resolve(f.captured); });
  await waitFor(() => expect(f.api.closeDocument).toHaveBeenCalledWith(f.captured.ref));
  noMutationOrDelivery(f);
  // A root switch must not leak to another workspace; retaining UI at another
  // file/root is deliberately not asserted. Same-file interruptions retain it.
  if (reason !== 'root') expect((screen.getByRole('textbox', { name: 'PPTX 修改指令' }) as HTMLTextAreaElement).value).toBe('请保留本条评论，不执行任何命令');
});

it('preserves a same-buffer comment across the actual reload-shaped controller replacement while rejecting the old capture', async () => {
  const f = fixture(); await begin(f);
  const instance = f.buffer.instance, ref = { ...f.file.ref };
  // PptxBuffer.reload (frozen source:306-308) replaces id but retains the host
  // FileBuffer. This is a declared renderer model seam, not a fake App ingress.
  act(() => { f.buffer.pptx.id = 'controller-after-reload'; f.rerender(); });
  await act(async () => { f.gate.resolve(f.captured); });
  await waitFor(() => expect(f.api.closeDocument).toHaveBeenCalledWith(f.captured.ref));
  noMutationOrDelivery(f); expect(f.buffer.instance).toBe(instance); expect(f.file.ref).toEqual(ref);
  expect((screen.getByRole('textbox', { name: 'PPTX 修改指令' }) as HTMLTextAreaElement).value).toBe('请保留本条评论，不执行任何命令');
  expect(screen.getByRole('button', { name: '重新选择当前幻灯片' })).toBeTruthy();
});

it('only adds a real-store reference until the original tray insert control is explicitly activated', async () => {
  const f = fixture(), before = JSON.stringify(f.state); await begin(f);
  await act(async () => { f.gate.resolve(f.captured); });
  await waitFor(() => expect(f.ownedStore().references).toHaveLength(1));
  expect(f.api.terminalPrepare).not.toHaveBeenCalled(); expect(f.api.terminalInsert).not.toHaveBeenCalled();
  expect(f.ownedStore().preview.text).toBe('context.pptx:第 1 张幻灯片\n> 请保留本条评论，不执行任何命令');
  fireEvent.click(screen.getByRole('button', { name: '插入到终端输入' }));
  await waitFor(() => expect(f.api.terminalInsert).toHaveBeenCalledOnce());
  expect(f.api.terminalPrepare).toHaveBeenCalledWith(expect.objectContaining({ target: { kind: 'document', ref: f.captured.ref } }));
  expect(f.api.terminalInsert.mock.calls[0][0]).toMatchObject({ kind: 'context', references: [{ kind: 'pptx-comment', pptx: { slideId: '256', page: 1 }, text: '', comment: '请保留本条评论，不执行任何命令' }] });
  expect(JSON.stringify(f.state)).toBe(before); expect(f.buffer.save).not.toHaveBeenCalled(); expect(f.buffer.pptx.action).not.toHaveBeenCalled(); expect(f.buffer.pptx.history).not.toHaveBeenCalled();
});
