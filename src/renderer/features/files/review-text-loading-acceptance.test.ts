import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { FILE_LIMITS, type FileDocument } from '@shared/files';
import { FileBuffer, type FileClient } from './file-buffer';

const buffers: FileBuffer[] = [];
afterEach(() => buffers.splice(0).forEach(buffer => buffer.dispose()));
function fixture(size: number) {
  const file = { name: 'large.txt', relativePath: 'large.txt', absolutePath: '/synthetic/large.txt',
    ref: { id: randomUUID(), lease: randomUUID(), generation: 1 }, documentKey: 'large', writable: true,
    revision: { hash: 'a'.repeat(64), size, device: '1', inode: '2', modifiedNs: '1', changedNs: '1' },
    content: { kind: 'text', basis: 'sample' } } as FileDocument;
  const api = { read: vi.fn(async () => { throw new Error('[TOO_LARGE] ordinary20MiB reader'); }),
    refresh: vi.fn(async () => file), drafts: vi.fn(async () => []), closeDocument: vi.fn(async () => undefined) };
  const buffer = new FileBuffer(file, api as unknown as FileClient, () => undefined); buffers.push(buffer);
  return { buffer, api };
}
// Real buffer/controller integration with explicitly isolated file transport.
// Full native boundary bytes and real App remain separate required layers.
it.each([FILE_LIMITS.readableText + 1, FILE_LIMITS.asset - 1, FILE_LIMITS.asset])('K06 review %i bytes delegates to the independent non-editor reader', async size => {
  const { buffer, api } = fixture(size); buffer.navigationView = 'review'; await buffer.load();
  expect(buffer.loadState).toBe('ready'); expect(buffer.loadError).toBe(''); expect(buffer.editor).toBeNull();
  expect(buffer.editable).toBe(false); expect(api.read).not.toHaveBeenCalled(); expect(buffer.raw).toBe('');
});
it('ordinary large text keeps the original20MiB reader limit', async () => {
  const { buffer, api } = fixture(FILE_LIMITS.readableText + 1); await buffer.load();
  expect(api.read).toHaveBeenCalledTimes(1); expect(buffer.loadState).toBe('error'); expect(buffer.editor).toBeNull();
});
it('leaving large review retries the ordinary path instead of leaving a stale ready body', async () => {
  const { buffer, api } = fixture(FILE_LIMITS.asset); buffer.navigationView = 'review'; await buffer.load();
  buffer.navigationView = null; await buffer.refresh();
  expect(api.read).toHaveBeenCalledTimes(1); expect(buffer.loadState).toBe('error'); expect(buffer.editor).toBeNull();
});
it('a clean small review switches to the independent reader when the fresh disk revision grows past20MiB', async () => {
  const { buffer, api } = fixture(8); buffer.navigationView = 'review';
  api.read.mockResolvedValueOnce({ document: buffer.file, base64: Buffer.from('small\r\n').toString('base64') } as never);
  await buffer.load(); const ref = buffer.file.ref; expect(buffer.editor).not.toBeNull();
  api.refresh.mockResolvedValueOnce({ ...buffer.file, revision: { ...buffer.file.revision, hash: 'b'.repeat(64), size: FILE_LIMITS.asset } });
  await buffer.refresh(); expect(buffer.largeTextReview).toBe(true); expect(buffer.file.ref).toBe(ref);
  expect(buffer.editor).toBeNull(); expect(buffer.loadError).toBe(''); expect(api.read).toHaveBeenCalledTimes(1);
});
it('an invalidation during the initial read refreshes the revision before retrying a now-large review', async () => {
  const { buffer, api } = fixture(8); buffer.navigationView = 'review'; const ref = buffer.file.ref;
  let reject!: (error: Error) => void;
  api.read.mockImplementationOnce(() => new Promise((_resolve, failure) => { reject = failure; }));
  const loading = buffer.load(); expect(api.read).toHaveBeenCalledTimes(1);
  api.refresh.mockResolvedValueOnce({ ...buffer.file, revision: { ...buffer.file.revision, hash: 'c'.repeat(64), size: FILE_LIMITS.asset } });
  await buffer.refresh(); reject(new Error('[TOO_LARGE] file grew during ordinary read')); await loading;
  expect(buffer.largeTextReview).toBe(true); expect(buffer.file.ref).toBe(ref); expect(buffer.loadState).toBe('ready');
  expect(buffer.loadError).toBe(''); expect(buffer.editor).toBeNull(); expect(api.refresh).toHaveBeenCalledTimes(1); expect(api.read).toHaveBeenCalledTimes(1);
});
