import { createHash, webcrypto } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFileSync } from 'node:fs';
import type { FileBuffer } from '../file-buffer';
import type { FileDocument } from '@shared/files';
import { loadMarkdownImage } from './images';
import { imageMenuActions } from '@shared/image-menu-policy.mjs';

const api = vi.hoisted(() => ({ related: vi.fn(), chunk: vi.fn(), closeDocument: vi.fn() }));
vi.mock('@renderer/lib/ipc', () => ({ rpc: { files: api } }));
const rows: unknown[] = [], bytes = Buffer.from('unit-only image bytes; browser decoder is not tested here'), hash = createHash('sha256').update(bytes).digest('hex');
const buffer = { file: { ref: { id: 'unit-parent', lease: 'unit-root', generation: 1 } } } as FileBuffer;
const picture = () => ({ alt: 'Unit image', dataset: {}, src: '' }) as HTMLImageElement;
beforeEach(() => { vi.stubGlobal('crypto', webcrypto); api.chunk.mockResolvedValue(bytes.toString('base64')); api.closeDocument.mockResolvedValue(undefined); });
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
afterAll(() => { if (process.env.WILLYOU_V08_U_EVIDENCE) writeFileSync(process.env.WILLYOU_V08_U_EVIDENCE, JSON.stringify({ layer: 'U', boundary: 'Actual production MIME-to-animation load helper and explicit menu flags; controlled RPC document/bytes only, no decoder/native/App claim.', rows }, null, 2)+'\n'); });
describe('V08 animation source and explicit menu capability boundaries', () => {
  it.each([
    ['ordinary.png', 'image/png', false],
    ['gif-mime.png', 'image/gif', true],
    ['only-url.gif', 'image/png', false],
    ['normal.gif', 'image/gif', true],
  ])('%s follows provided image MIME, without inferring frames or URL suffix', async (name, mime, animated) => {
    const file = { ref: { id: name, lease: 'unit-root', generation: 1 }, name, absolutePath: '/unit/'+name, relativePath: name, revision: { hash, size: bytes.length }, content: { kind: 'image', mime } } as FileDocument;
    api.related.mockResolvedValue(file); const element = picture(), owner = new AbortController();
    const source = await loadMarkdownImage(buffer, element, name as string, owner.signal);
    try {
      expect(source.animated).toBe(animated); expect(source.mime).toBe(mime); expect(api.closeDocument).toHaveBeenCalledExactlyOnceWith(file.ref);
      const blob = await (await fetch(source.src)).blob(); expect(blob.type).toBe(mime); expect(Buffer.from(await blob.arrayBuffer())).toEqual(bytes);
      const menu = imageMenuActions({ src: name as string, localPath: file.absolutePath, animated: source.animated });
      expect(menu.some(x => x.id === 'reference')).toBe(!animated); expect(menu.some(x => x.id === 'copy')).toBe(!animated);
      expect(menu.some(x => /edit|resize|erase|background/i.test(x.id))).toBe(false); expect(menu.at(-1)?.id).toBe('download');
      rows.push({ name, mime, animated, menu, sourceHash: hash, actualBlobMime: blob.type, pass: true });
    } finally { owner.abort(); }
    await expect(fetch(source.src)).rejects.toThrow();
  });
  it.each([true, false])('menu receives only explicit animated=%s and does not sniff a .gif URL', animated => {
    const menu = imageMenuActions({ src: 'https://example.invalid/only-url.gif', animated });
    expect(menu.map(x => x.id)).toEqual(animated ? ['open','address','download'] : ['open','address','reference','copy','download']);
    rows.push({ branch: 'explicit-only-menu', animated, menu, pass: true });
  });
  it('missing animation flag keeps the URL-only branch static; host capability guards still narrow it', () => {
    const urlOnly = imageMenuActions({ src: 'https://example.invalid/only-url.gif' });
    expect(urlOnly.some(x => x.id === 'copy')).toBe(true); expect(urlOnly.some(x => x.id === 'reference')).toBe(true);
    const narrowed = imageMenuActions({ src: 'https://example.invalid/only-url.gif', canSelect: false, canCopy: false });
    expect(narrowed.map(x => x.id)).toEqual(['open','address','download']); rows.push({ branch: 'unmarked-url-vs-host-guards', urlOnly, narrowed, pass: true });
  });
});
