// @vitest-environment jsdom
import { Blob as NodeBlob } from 'node:buffer';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { openDataUriMediaResource } from './resource';

// Actual URI parsing and real Blob bytes; URL registration is an explicit
// isolated sink. Native playback and browser URL ownership are separate layers.
let blobs: NodeBlob[], revoked: string[];
beforeEach(() => {
  blobs = []; revoked = [];
  vi.stubGlobal('Blob', NodeBlob);
  const OriginalURL = URL;
  vi.stubGlobal('URL', class extends OriginalURL {
    static createObjectURL(blob: Blob) { blobs.push(blob as unknown as NodeBlob); return `blob:owned-${blobs.length}`; }
    static revokeObjectURL(url: string) { revoked.push(url); }
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('decodes percent bytes, literal plus and invalid percent sequences using the reference UTF-8 order', async () => {
  const abort = new AbortController();
  const value = await openDataUriMediaResource('data:audio/wav,RIFF%00%ff+%2B%zzé#t=0.5', abort.signal);
  expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(new Uint8Array([82, 73, 70, 70, 0, 255, 43, 43, 37, 122, 122, 195, 169]));
  expect(blobs[0].type).toBe('audio/wav');
  expect(value.url).toBe('blob:owned-1#t=0.5');
  value.release(); abort.abort(); value.release();
  expect(revoked).toEqual(['blob:owned-1']);
});

it.each(['DATA:AUDIO/WAV;base64,AP8r', 'data:audio/wav;base64,AP%38r'])('consumes literal or escaped base64 from %s', async uri => {
  const abort = new AbortController(), value = await openDataUriMediaResource(uri, abort.signal);
  expect(new Uint8Array(await blobs[0].arrayBuffer())).toEqual(new Uint8Array([0, 255, 43]));
  expect(value.transport).toBe('data-uri');
  abort.abort(); value.release();
  expect(revoked).toEqual(['blob:owned-1']);
});

it.each(['https://invalid.example/media.wav', 'data:audio/wav', 'data:audio/wav;base64,!!!!'])('rejects invalid input without registering a URL: %s', async uri => {
  await expect(openDataUriMediaResource(uri, new AbortController().signal)).rejects.toThrow();
  expect(blobs).toEqual([]); expect(revoked).toEqual([]);
});

it('handles cancellation before work and before the asynchronous caller receives ownership', async () => {
  const first = new AbortController(); first.abort();
  await expect(openDataUriMediaResource('data:audio/wav;base64,AP8r', first.signal)).rejects.toThrow();
  expect(blobs).toEqual([]);
  const second = new AbortController(), pending = openDataUriMediaResource('data:audio/wav;base64,AP8r', second.signal);
  second.abort(); (await pending).release();
  expect(revoked).toEqual(['blob:owned-1']);
});
