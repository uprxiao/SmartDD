// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRecoveryInspection, FileRecoveryItem } from '@shared/file-recovery';
import { FileRecoveryDialog } from './recovery-dialog';
const api = vi.hoisted(() => ({ recovery: vi.fn(), inspectRecovery: vi.fn(), cancelResource: vi.fn(async () => undefined) }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const first: FileRecoveryItem = { projectKey: 'a'.repeat(64), id: '11111111-1111-4111-8111-111111111111', relativePath: 'first.txt', state: 'unknown', createdAt: 2 };
const second: FileRecoveryItem = { ...first, id: '22222222-2222-4222-8222-222222222222', relativePath: 'second.txt', state: 'conflict', createdAt: 1 };
const result = (item = first): FileRecoveryInspection => ({ item, state: item.state, readOnly: true, materials: [{ kind: 'draft', available: true, preview: item.relativePath + ' <script>plain text</script>', revision: { device: '1', inode: '1', size: 12, hash: 'b'.repeat(64), modifiedNs: '1', changedNs: '1' } }, { kind: 'current', available: false, message: '原目录不可用；独立草稿仍保留' }] });
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
beforeEach(() => { vi.clearAllMocks(); api.recovery.mockResolvedValue([first, second]); api.inspectRecovery.mockImplementation(async input => result(input.id === first.id ? first : second)); });
afterEach(cleanup);
describe('recovery inspection dialog', () => {
  it('loads only on demand and shows native material as escaped readonly text', async () => {
    const view = render(<FileRecoveryDialog open={false} onOpenChange={() => undefined}/>); expect(api.recovery).not.toHaveBeenCalled();
    view.rerender(<FileRecoveryDialog open onOpenChange={() => undefined}/>);
    await waitFor(() => expect(screen.getByLabelText('独立保存的本地草稿').textContent).toContain('first.txt <script>plain text</script>'));
    expect(document.querySelector('script')).toBeNull(); expect(document.querySelector('textarea,input')).toBeNull();
    expect(screen.getByText('原目录不可用；独立草稿仍保留')).toBeDefined(); expect(api.inspectRecovery.mock.calls[0][0]).toMatchObject({ projectKey: first.projectKey, id: first.id });
    expect(screen.queryByRole('button', { name: /覆盖|清理/ })).toBeNull();
  });
  it('cancels a superseded read and ignores its late result', async () => {
    const old = deferred<FileRecoveryInspection>(); api.inspectRecovery.mockImplementationOnce(() => old.promise);
    render(<FileRecoveryDialog open onOpenChange={() => undefined}/>); await waitFor(() => expect(api.inspectRecovery).toHaveBeenCalledTimes(1));
    const request = api.inspectRecovery.mock.calls[0][0]; fireEvent.click(screen.getByRole('button', { name: /second.txt/ }));
    await waitFor(() => expect(screen.getByLabelText('独立保存的本地草稿').textContent).toContain('second.txt'));
    expect(api.cancelResource).toHaveBeenCalledWith(request.requestId); await act(async () => old.resolve(result(first)));
    expect(screen.getByLabelText('独立保存的本地草稿').textContent).toContain('second.txt');
  });
  it('cancels a pending read when closed and never installs it after reopening', async () => {
    const old = deferred<FileRecoveryInspection>(); api.inspectRecovery.mockImplementationOnce(() => old.promise);
    const view = render(<FileRecoveryDialog open onOpenChange={() => undefined}/>); await waitFor(() => expect(api.inspectRecovery).toHaveBeenCalledTimes(1));
    const request = api.inspectRecovery.mock.calls[0][0]; view.rerender(<FileRecoveryDialog open={false} onOpenChange={() => undefined}/>);
    expect(api.cancelResource).toHaveBeenCalledWith(request.requestId); await act(async () => old.resolve(result(second)));
    view.rerender(<FileRecoveryDialog open onOpenChange={() => undefined}/>); await waitFor(() => expect(screen.getByLabelText('独立保存的本地草稿').textContent).toContain('first.txt'));
  });
  it('keeps read failures visible and retries without resolving or deleting any record', async () => {
    api.inspectRecovery.mockRejectedValueOnce(new Error('UNTRUSTED'));
    render(<FileRecoveryDialog open onOpenChange={() => undefined}/>); await screen.findByRole('alert'); fireEvent.click(screen.getByRole('button', { name: '重新读取' }));
    await waitFor(() => expect(screen.getByLabelText('独立保存的本地草稿').textContent).toContain('first.txt'));
    expect(api.inspectRecovery).toHaveBeenCalledTimes(2);
  });
});
