import { createHash, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { MEDIA_LIMIT } from '@shared/file-media';
import { FileMediaService, mediaRange } from './media-service';

function fixture(size = 64) {
  const bytes = Buffer.alloc(size <= 1024 ? size : 0, 42), abort = new AbortController();
  const revision = { hash: createHash('sha256').update(bytes).digest('hex'), size, device: '1', inode: '2', modifiedNs: '1', changedNs: '1' };
  const read = vi.fn(async (offset: number, length: number, signal: AbortSignal) => { signal.throwIfAborted(); return bytes.subarray(offset, offset + length); });
  const service = new FileMediaService(() => ({ name: 'clip.mp4', revision, signal: abort.signal, read }));
  const input = () => ({ id: randomUUID(), ref: { id: randomUUID(), lease: randomUUID(), generation: 1 }, baseHash: revision.hash });
  return { bytes, abort, read, revision, service, input };
}
describe('bounded media capabilities and range streaming', () => {
  it('handles suffix/open ranges, rejects multiple and invalid ranges, and defines empty files', () => {
    expect(mediaRange('bytes=3-', 10)).toEqual({ start: 3, end: 9, partial: true });
    expect(mediaRange('bytes=-3', 10)).toEqual({ start: 7, end: 9, partial: true });
    expect(mediaRange('bytes=0-99', 10)?.end).toBe(9);
    for (const value of ['bytes=10-', 'bytes=4-3', 'bytes=-0', 'bytes=0-1,3-4', 'bytes=-', 'bytes=999999999999999999999-', 'items=0-1']) expect(mediaRange(value, 10)).toBeNull();
    expect(mediaRange(null, 0)).toEqual({ start: 0, end: -1, partial: false }); expect(mediaRange('bytes=0-', 0)).toBeNull();
  });
  it('uses binary fallback only when protocol is unavailable and binds owner/revision/128MiB before reading', async () => {
    const f = fixture(), input = f.input(), source = await f.service.open('owner', input);
    expect(source.transport).toBe('binary'); expect(source.url).toBeUndefined();
    expect(Buffer.from(await f.service.chunk('owner', input.id, 0, 4), 'base64')).toEqual(f.bytes.subarray(0, 4));
    await expect(f.service.chunk('other', input.id, 0, 4)).rejects.toThrow('UNTRUSTED');
    await expect(f.service.chunk('owner', input.id, 63, 2)).rejects.toThrow('INVALID_INPUT');
    await expect(f.service.open('owner', { ...f.input(), baseHash: '0'.repeat(64) })).rejects.toThrow('CHANGED');
    const big = fixture(MEDIA_LIMIT + 1); await expect(big.service.open('owner', big.input())).rejects.toThrow('128 MiB'); expect(big.read).not.toHaveBeenCalled();
    const equal = fixture(MEDIA_LIMIT); expect((await equal.service.open('owner', equal.input())).size).toBe(MEDIA_LIMIT);
  });
  it('issues opaque URLs, gates requesting owners, supplies exact 206/HEAD/416, and revokes streams', async () => {
    const f = fixture(); f.service.setProtocolAvailable(true); const input = f.input(), source = await f.service.open('owner', input);
    expect(source.url).toMatch(/^willyou-media:\/\/local\/[a-f0-9]{64}$/); expect(source.url).not.toContain('clip');
    expect(f.service.allows('owner', source.url!)).toBe(true); expect(f.service.allows('other', source.url!)).toBe(false);
    expect(f.service.allows('owner', source.url! + '?path=elsewhere')).toBe(false);
    const range = await f.service.handle(new Request(source.url!, { headers: { Range: 'bytes=2-7' } }));
    expect(range.status).toBe(206); expect(range.headers.get('Content-Range')).toBe('bytes 2-7/64'); expect(Buffer.from(await range.arrayBuffer())).toEqual(f.bytes.subarray(2, 8));
    const head = await f.service.handle(new Request(source.url!, { method: 'HEAD' })); expect(head.status).toBe(200); expect(head.headers.get('Content-Length')).toBe('64'); expect(await head.text()).toBe('');
    const bad = await f.service.handle(new Request(source.url!, { headers: { Range: 'bytes=64-' } })); expect(bad.status).toBe(416); expect(bad.headers.get('Content-Range')).toBe('bytes */64');
    const live = await f.service.handle(new Request(source.url!)); f.abort.abort();
    await expect(live.arrayBuffer()).rejects.toThrow('CANCELLED'); expect((await f.service.handle(new Request(source.url!))).status).toBe(404);
  });
  it('cancels opening before delivery, bounds concurrent streams, and reclaims readers after cancel', async () => {
    const f = fixture(); f.service.setProtocolAvailable(true); const input = f.input();
    f.service.release('owner', input.id); await expect(f.service.open('owner', input)).rejects.toThrow('CANCELLED');
    const next = f.input(), source = await f.service.open('owner', next);
    const readers = await Promise.all(Array.from({ length: 6 }, () => f.service.handle(new Request(source.url!))));
    expect(readers.filter((result) => result.status === 200)).toHaveLength(4); expect(readers.filter((result) => result.status === 429)).toHaveLength(2);
    for (const result of readers) await result.body?.cancel();
    const reused = await f.service.handle(new Request(source.url!)); expect(reused.status).toBe(200); await reused.body?.cancel();
    f.service.closeOwner('owner'); expect(f.service.allows('owner', source.url!)).toBe(false);
  });
});
