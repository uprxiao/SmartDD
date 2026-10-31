import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { TerminalImageCache } from './terminal-image-cache';
const caches: TerminalImageCache[] = [];
const cache = () => { const value = new TerminalImageCache(); caches.push(value); return value; };
afterEach(() => { for (const value of caches.splice(0)) { value.releasePty('own-pty'); value.releasePty('other-pty'); } });
it('keeps exact immutable bytes after dispatch and releases only the originating PTY', async () => {
  const value = cache(), bytes = Buffer.from('synthetic cache bytes, decoder tested independently');
  const original = await value.prepare('own-pty', bytes), other = await value.prepare('other-pty', Buffer.from('other existing attachment'));
  expect(lstatSync(original.directory).mode & 0o777).toBe(0o700); expect(lstatSync(original.path).mode & 0o777).toBe(0o400);
  const frame = value.retain(original); expect(frame).toContain(original.path); expect(readFileSync(original.path)).toEqual(bytes);
  value.releasePending(original); expect(existsSync(original.path)).toBe(true);
  value.releasePty('other-pty'); expect(existsSync(original.path)).toBe(true); expect(existsSync(other.path)).toBe(false);
  value.releasePty('own-pty'); expect(existsSync(original.directory)).toBe(false);
});
it('removes a failed pending payload without touching another retained attachment', async () => {
  const value = cache(), old = await value.prepare('own-pty', Buffer.from('old attachment'));
  value.retain(old); const pending = await value.prepare('own-pty', Buffer.from('new pending'));
  value.releasePending(pending); expect(existsSync(pending.directory)).toBe(false); expect(readFileSync(old.path).toString()).toBe('old attachment');
  value.releasePending(pending); expect(existsSync(old.path)).toBe(true);
});
it('rejects a changed cache file before generating any image frame', async () => {
  const value = cache(), payload = await value.prepare('own-pty', Buffer.from('original'));
  const { chmodSync, writeFileSync } = await import('node:fs'); chmodSync(payload.path, 0o600); writeFileSync(payload.path, 'changed!');
  expect(() => value.retain(payload)).toThrow(/已改变/); value.releasePending(payload); expect(existsSync(payload.directory)).toBe(false);
});
