// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, webcrypto } from 'node:crypto';
import { FileTexPreview } from './preview';
import type { FileBuffer } from '../file-buffer';
const api = vi.hoisted(() => ({ compileTex: vi.fn(), releaseTex: vi.fn(), texChunk: vi.fn(), load: null as null | ((signal: AbortSignal) => Promise<Uint8Array>) }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
vi.mock('../pdf/preview', () => ({ FilePdfPreview: ({ loadData }: { loadData: typeof api.load }) => { api.load = loadData; return <div>PDF viewer</div>; } }));
const buffer = (id = 'one') => ({ instance: id, file: { ref: { id }, revision: { hash: id } } }) as unknown as FileBuffer;
const bytes = Buffer.from('%PDF-synthetic-owned-fixture');
const result = { id: 'result', bytes: bytes.length, pages: 1, hash: createHash('sha256').update(bytes).digest('hex'), elapsedMs: 100, peakRssBytes: 100, warnings: ['fixture warning'], diagnostic: 'fixture diagnostic' };
beforeEach(() => { vi.clearAllMocks(); api.compileTex.mockResolvedValue(result); api.releaseTex.mockResolvedValue(undefined); api.texChunk.mockResolvedValue(bytes.toString('base64')); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe('TeX preview lifecycle', () => {
  it('hands only generated verified bytes to the PDF viewer and releases on file switch; ignores stale compilation', async () => {
    let finish!: (value: unknown) => void; api.compileTex.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const view = render(<FileTexPreview buffer={buffer()} />); await screen.findByText('正在生成 PDF…'); const id = api.compileTex.mock.calls[0][0].id;
    view.rerender(<FileTexPreview buffer={buffer('two')} />); await screen.findByText('PDF viewer'); expect(api.releaseTex).toHaveBeenCalledWith(id);
    await act(async () => finish({ ...result, warnings: ['STALE'] })); expect(screen.queryByText('STALE')).toBeNull();
    expect(Buffer.from(await api.load!(new AbortController().signal))).toEqual(bytes); expect(api.texChunk).toHaveBeenCalledWith('result', 0, bytes.length);
    api.texChunk.mockResolvedValue(Buffer.alloc(bytes.length, 1).toString('base64')); await expect(api.load!(new AbortController().signal)).rejects.toThrow('校验失败');
    view.unmount(); expect(api.releaseTex).toHaveBeenCalledTimes(2);
  });
  it('cancels, retries, displays compiler errors as text and never substitutes a failed output for success', async () => {
    let finish!: (value: unknown) => void; api.compileTex.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<FileTexPreview buffer={buffer()} />); fireEvent.click(await screen.findByRole('button', { name: '取消编译' })); await screen.findByText('已取消编译');
    await act(async () => finish(result)); expect(screen.queryByText('PDF viewer')).toBeNull();
    api.compileTex.mockRejectedValueOnce(new Error("Error invoking remote method 'files.compileTex': FileError: <script>synthetic diagnostic</script>")); fireEvent.click(screen.getByRole('button', { name: '重新编译' }));
    await screen.findByRole('alert'); expect(screen.getByText('<script>synthetic diagnostic</script>')).toBeTruthy(); expect(document.querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '重新编译' })); await waitFor(() => expect(api.compileTex).toHaveBeenCalledTimes(3)); await screen.findByText('PDF viewer');
  });
});
