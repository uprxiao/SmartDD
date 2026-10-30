import { createHash } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import type { FileDocument } from '@shared/files';
import { activeReviewTextWorkers, createReviewTextClient } from './client';
import { ReviewTextModel } from './model.mjs';

const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: unknown; onmessageerror: unknown;
  model: ReviewTextModel | null = null;
  held: { id: number; result: unknown } | null = null;
  hold = false; terminated = 0;
  constructor() { workers.push(this); }
  terminate() { this.terminated++; }
  postMessage(value: { id: number; method: string; args: unknown[] }) {
    // Transport is explicitly isolated. Real Worker byte transfer and rendering
    // remain required in App A; this exercises client request/lifetime races.
    queueMicrotask(() => {
      try {
        let result: unknown;
        if (value.method === 'open') { this.model = new ReviewTextModel(new Uint8Array(value.args[0] as ArrayBuffer)); result = this.model.info; }
        else result = this.model!.window(value.args[0] as number);
        if (this.hold) this.held = { id: value.id, result }; else this.onmessage?.({ data: { id: value.id, result } });
      } catch (error) { this.onmessage?.({ data: { id: value.id, error: String(error) } }); }
    });
  }
}
function fixture(bytes = new TextEncoder().encode('known 中文🙂\r\nEOF')) {
  const file = { content: { kind: 'text' }, ref: { id: crypto.randomUUID() }, revision: { size: bytes.length, hash: createHash('sha256').update(bytes).digest('hex') } } as FileDocument;
  return { file, bytes, api: { chunk: vi.fn(async () => Buffer.from(bytes).toString('base64')), cancelResource: vi.fn(async () => undefined) } };
}
afterEach(() => { vi.unstubAllGlobals(); workers.splice(0); expect(activeReviewTextWorkers()).toBe(0); });
it('unsupported beats size and never invokes a body transport or creates a Worker', async () => {
  vi.stubGlobal('Worker', FakeWorker); const f = fixture(); f.file.content = { kind: 'unsupported', basis: 'extension' }; f.file.revision.size = 268435457;
  await expect(createReviewTextClient(f.file, f.api, new AbortController().signal)).rejects.toThrow('[UNSUPPORTED]');
  expect(f.api.chunk).not.toHaveBeenCalled(); expect(workers).toHaveLength(0);
});
it('cancellation while an actual chunk promise is pending discards its late bytes before Worker creation', async () => {
  vi.stubGlobal('Worker', FakeWorker); const f = fixture(), abort = new AbortController(); let resolve!: (bytes: string) => void;
  f.api.chunk.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const result = createReviewTextClient(f.file, f.api, abort.signal); await vi.waitFor(() => expect(f.api.chunk).toHaveBeenCalledTimes(1));
  abort.abort(); resolve(Buffer.from(f.bytes).toString('base64')); await expect(result).rejects.toThrow();
  expect(f.api.cancelResource).toHaveBeenCalledTimes(1); expect(workers).toHaveLength(0);
});
it.each(['short', 'hash'])('never publishes complete source on%s transport data', async mode => {
  vi.stubGlobal('Worker', FakeWorker); const f = fixture();
  f.api.chunk.mockResolvedValueOnce(Buffer.from(mode === 'short' ? f.bytes.slice(0, 2) : new Uint8Array(f.bytes.length)).toString('base64'));
  await expect(createReviewTextClient(f.file, f.api, new AbortController().signal)).rejects.toThrow(); expect(workers).toHaveLength(0);
});
it('decode failure destroys the reader and does not retain an active model', async () => {
  vi.stubGlobal('Worker', FakeWorker); const f = fixture(new Uint8Array([65, 255]));
  await expect(createReviewTextClient(f.file, f.api, new AbortController().signal)).rejects.toThrow('[UNSUPPORTED]'); expect(workers[0].terminated).toBe(1);
});
it('close rejects an outstanding page and ignores its late response, with one exact termination', async () => {
  vi.stubGlobal('Worker', FakeWorker); const f = fixture(), abort = new AbortController();
  const client = await createReviewTextClient(f.file, f.api, abort.signal); expect((await client.window(0)).text).toBe(new TextDecoder().decode(f.bytes));
  workers[0].hold = true; const pending = client.window(0); await vi.waitFor(() => expect(workers[0].held).not.toBeNull());
  abort.abort(); await expect(pending).rejects.toThrow(); workers[0].onmessage?.({ data: workers[0].held }); await client.destroy();
  expect(workers[0].terminated).toBe(1); expect(activeReviewTextWorkers()).toBe(0);
});
