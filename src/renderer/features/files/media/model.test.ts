import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { FileDocument } from '@shared/files';
import { MEDIA_LIMIT, mediaType, type MediaSource } from '@shared/file-media';
import { clearMediaElement, MediaSeekDrag, mediaDuration, mediaTime } from './model';
import { openMediaResource } from './resource';

function resourceFixture(bytes = Buffer.from('synthetic media')) {
  const file: FileDocument = { ref: { id: randomUUID(), lease: randomUUID(), generation: 1 }, name: 'demo.wav', relativePath: 'demo.wav', absolutePath: '/fixture/demo.wav', documentKey: 'local:1:2', writable: true, revision: { size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex'), device: '1', inode: '2', modifiedNs: '1', changedNs: '1' } };
  const api = { openMedia: vi.fn(async (input: { id: string }): Promise<MediaSource> => ({ id: input.id, transport: 'binary', mime: 'audio/wav', size: bytes.length, hash: file.revision.hash })), mediaChunk: vi.fn(async (_id: string, offset: number, length: number) => bytes.subarray(offset, offset + length).toString('base64')), releaseMedia: vi.fn(async () => undefined) };
  return { file, api };
}
describe('media controls and resource lifetime', () => {
  it('keeps invalid durations finite and resolves each pointer drag once', () => {
    for (const duration of [0, NaN, Infinity, -1]) { expect(mediaDuration(duration)).toBe(0); expect(mediaTime(duration)).toBe('0:00'); }
    expect(mediaTime(3661.5)).toBe('61:01');
    const drag = new MediaSeekDrag(); drag.begin(1, true); expect(drag.end(2)).toBe(false); expect(drag.end(1)).toBe(true); expect(drag.end(1)).toBe(false);
    drag.begin(2, false); expect(drag.end(2)).toBe(false); drag.begin(3, true); drag.reset(); expect(drag.end(3)).toBe(false);
    expect(mediaType('sound.OPUS')).toEqual({ kind: 'audio', mime: 'audio/ogg' }); expect(mediaType('clip.mp4')?.kind).toBe('video'); expect(mediaType('clip.mp4.exe')).toBeNull();
  });
  it('reads binary chunks with a hash fence and revokes all 20 Blob sessions exactly once', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture'), revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    try {
      for (let i = 0; i < 20; i++) {
        const f = resourceFixture(), abort = new AbortController(), resource = await openMediaResource(f.file, f.api, abort.signal);
        expect(resource.url).toBe('blob:fixture'); abort.abort(); resource.release(); expect(f.api.releaseMedia).toHaveBeenCalledTimes(1);
      }
      expect(create).toHaveBeenCalledTimes(20); expect(revoke).toHaveBeenCalledTimes(20);
      const order: string[] = []; clearMediaElement({ pause: () => order.push('pause'), removeAttribute: (name) => order.push(`remove:${name}`), load: () => order.push('load') }); expect(order).toEqual(['pause', 'remove:src', 'load']);
    } finally { create.mockRestore(); revoke.mockRestore(); }
  });
  it('never creates a Blob for a cancelled, changed, truncated or oversized resource', async () => {
    const create = vi.spyOn(URL, 'createObjectURL');
    try {
      const f = resourceFixture(), abort = new AbortController();
      f.api.mediaChunk.mockImplementationOnce(async () => { abort.abort(); return Buffer.from('synthetic media').toString('base64'); });
      await expect(openMediaResource(f.file, f.api, abort.signal)).rejects.toThrow(); expect(f.api.releaseMedia).toHaveBeenCalledTimes(1);
      const truncated = resourceFixture(); truncated.api.mediaChunk.mockResolvedValue(''); await expect(openMediaResource(truncated.file, truncated.api, new AbortController().signal)).rejects.toThrow('长度');
      const changed = resourceFixture(); changed.api.mediaChunk.mockResolvedValue(Buffer.alloc(changed.file.revision.size).toString('base64')); await expect(openMediaResource(changed.file, changed.api, new AbortController().signal)).rejects.toThrow('内容');
      const huge = resourceFixture(); huge.file.revision.size = MEDIA_LIMIT + 1; await expect(openMediaResource(huge.file, huge.api, new AbortController().signal)).rejects.toThrow('128 MiB'); expect(huge.api.openMedia).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    } finally { create.mockRestore(); }
  });
});
