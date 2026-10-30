// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { FileBuffer } from '../file-buffer';
import type { OfficeSlideInfo } from '@shared/file-office-pages';
import { usePptxRequests } from './pptx-context';

const mocks = vi.hoisted(() => ({ terminal: null as unknown }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: {} } }));
vi.mock('../terminal-context/context', () => ({ useFileTerminalContext: () => mocks.terminal }));
const slide: OfficeSlideInfo = { id: '256', title: '真实幻灯片模型', hidden: false, notes: 'speaker notes are not comments', elements: [{ id: '7', name: '标题', kind: 'text', hidden: false, text: '原始标题' }] };
function fixture() {
  const terminal = { root: { lease: 'lease', generation: 1 }, target: { taskId: 'task', ptyId: 'pty', focus: vi.fn() },
    subscribe: () => () => undefined, snapshot: () => 0, notice: '', addPptx: vi.fn(async () => true) };
  const state = { version: 3, protected: false, info: { slides: [slide] } };
  const buffer = { instance: 'one', baseHash: 'a'.repeat(64), sourceUnavailable: '', pdfPosition: { page: 1 },
    file: { ref: { id: 'file', lease: 'lease', generation: 1 }, sourceReadOnly: false, writable: false },
    pptx: { id: 'controller', editing: false, selection: null as null | { slideId: string; elementId: string }, result: { state }, action: vi.fn(), history: vi.fn() }, save: vi.fn() };
  mocks.terminal = terminal;
  return { terminal, state, buffer };
}
function Harness({ buffer, admitted = true }: { buffer: FileBuffer; admitted?: boolean }) {
  const request = usePptxRequests(buffer, buffer.pdfPosition.page, slide, admitted);
  return <><button aria-label="请求修改" disabled={!request.onRequestEdits} onClick={request.onRequestEdits}>请求修改</button>{request.panel}</>;
}
function openDraft() { fireEvent.click(screen.getByRole('button', { name: '请求修改' })); fireEvent.change(screen.getByRole('textbox', { name: 'PPTX 修改指令' }), { target: { value: '请调整这张幻灯片' } }); }
beforeEach(() => { mocks.terminal = null; });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it('admits page comments while manual editing and OS write permission are off, without saving or changing notes/model', async () => {
  const f = fixture(), before = JSON.stringify(f.state); render(<Harness buffer={f.buffer as unknown as FileBuffer} />); openDraft();
  fireEvent.click(screen.getByRole('button', { name: '加入终端引用' })); await waitFor(() => expect(f.terminal.addPptx).toHaveBeenCalledOnce());
  const [file, selection] = f.terminal.addPptx.mock.calls[0] as unknown as [unknown, { pptx: object; text: string; comment: string; current(): boolean }];
  expect(file).toBe(f.buffer.file); expect(selection).toMatchObject({ pptx: { slideId: '256', page: 1 }, text: '', comment: '请调整这张幻灯片' }); expect(selection.current()).toBe(true);
  expect(JSON.stringify(f.state)).toBe(before); expect(f.buffer.save).not.toHaveBeenCalled(); expect(f.buffer.pptx.action).not.toHaveBeenCalled(); expect(f.buffer.pptx.history).not.toHaveBeenCalled();
});
it('captures only an actual selected element from the current slide', async () => {
  const f = fixture(); f.buffer.pptx.selection = { slideId: '256', elementId: '7' }; render(<Harness buffer={f.buffer as unknown as FileBuffer} />); openDraft();
  fireEvent.click(screen.getByRole('button', { name: '加入终端引用' })); await waitFor(() => expect(f.terminal.addPptx).toHaveBeenCalledOnce());
  expect(f.terminal.addPptx.mock.calls[0]).toEqual([f.buffer.file, expect.objectContaining({ pptx: { slideId: '256', page: 1, elementId: '7' }, text: '原始标题' })]);
});
it.each(['source-policy', 'unavailable', 'protected', 'no-target', 'different-root', 'not-admitted'])('keeps the real annotation boundary closed for %s', reason => {
  const f = fixture(); if (reason === 'source-policy') f.buffer.file.sourceReadOnly = true;
  if (reason === 'unavailable') f.buffer.sourceUnavailable = 'revoked'; if (reason === 'protected') f.state.protected = true;
  if (reason === 'no-target') mocks.terminal = null; if (reason === 'different-root') f.terminal.root.lease = 'other';
  render(<Harness buffer={f.buffer as unknown as FileBuffer} admitted={reason !== 'not-admitted'} />);
  expect((screen.getByRole('button', { name: '请求修改' }) as HTMLButtonElement).disabled).toBe(true); expect(f.terminal.addPptx).not.toHaveBeenCalled();
});
it('retains the draft when the actual model changed and requires explicit re-selection before capture', async () => {
  const f = fixture(); const view = render(<Harness buffer={f.buffer as unknown as FileBuffer} />); openDraft(); f.state.version++;
  view.rerender(<Harness buffer={f.buffer as unknown as FileBuffer} />); fireEvent.click(screen.getByRole('button', { name: '加入终端引用' }));
  expect(f.terminal.addPptx).not.toHaveBeenCalled(); expect((screen.getByRole('textbox', { name: 'PPTX 修改指令' }) as HTMLTextAreaElement).value).toBe('请调整这张幻灯片');
  fireEvent.click(screen.getByRole('button', { name: '重新选择当前幻灯片' })); fireEvent.click(screen.getByRole('button', { name: '加入终端引用' }));
  await waitFor(() => expect(f.terminal.addPptx).toHaveBeenCalledOnce()); expect(f.terminal.addPptx.mock.calls[0]).toEqual([f.buffer.file, expect.objectContaining({ version: 4 })]);
});
it('keeps the instruction after rejected capture rather than pretending insertion or retrying', async () => {
  const f = fixture(); f.terminal.addPptx.mockResolvedValue(false); f.terminal.notice = 'source changed'; render(<Harness buffer={f.buffer as unknown as FileBuffer} />); openDraft();
  fireEvent.click(screen.getByRole('button', { name: '加入终端引用' })); await screen.findByText('source changed');
  expect((screen.getByRole('textbox', { name: 'PPTX 修改指令' }) as HTMLTextAreaElement).value).toBe('请调整这张幻灯片'); expect(f.terminal.addPptx).toHaveBeenCalledOnce();
});
