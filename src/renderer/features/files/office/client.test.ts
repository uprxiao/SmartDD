// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileRef } from '@shared/files';
import { OfficeClient } from './client';
const api = vi.hoisted(() => ({ openOffice: vi.fn(), officeWindow: vi.fn(), officeCell: vi.fn(), closeOffice: vi.fn(), copy: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const ref = { id: 'file', lease: 'root', generation: 1 } as FileRef;
beforeEach(() => { vi.clearAllMocks(); api.openOffice.mockResolvedValue({ id: 'test' }); api.closeOffice.mockResolvedValue(undefined); vi.stubGlobal('navigator', { clipboard: { writeText: api.copy.mockResolvedValue(undefined) } }); });
afterEach(() => vi.unstubAllGlobals());
describe('Office renderer session isolation', () => {
  it('copies the complete long UTF16 value through bounded chunks', async () => {
    const text = '中文😀'.repeat(10000); api.officeCell.mockImplementation(async ({ start, length }) => ({ start, end: Math.min(text.length, start + length), total: text.length, text: text.slice(start, start + length) }));
    const client = new OfficeClient(ref, 'hash'); await client.copy('1', 0, 0);
    expect(api.officeCell).toHaveBeenCalledTimes(3); expect(api.copy).toHaveBeenCalledWith(text); client.close(); expect(api.closeOffice).toHaveBeenCalledTimes(1);
  });
  it('does not copy a response arriving after its document closed and reports inconsistent chunks', async () => {
    let finish!: (value: unknown) => void; api.officeCell.mockImplementationOnce(() => new Promise((done) => { finish = done; }));
    const client = new OfficeClient(ref, 'hash'); await client.ready;
    const copy = client.copy('1', 0, 0), rejected = expect(copy).rejects.toThrow('已关闭');
    await Promise.resolve(); await Promise.resolve(); client.close(); finish({ start: 0, end: 4, total: 4, text: 'late' }); await rejected; expect(api.copy).not.toHaveBeenCalled();
    api.officeCell.mockResolvedValue({ start: 0, end: 0, total: 3, text: '' }); const second = new OfficeClient(ref, 'hash');
    await expect(second.copy('1', 0, 0)).rejects.toThrow('不一致'); second.close();
  });
});
