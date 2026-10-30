import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CsvClient, createCsvClient } from './client';

class TestWorker {
  static workers: TestWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { preventDefault(): void }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { TestWorker.workers.push(this); }
  reply(id: number, result: unknown) { this.onmessage?.({ data: { id, result } }); }
}
beforeEach(() => { TestWorker.workers = []; vi.stubGlobal('Worker', TestWorker); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('CSV worker lifetime', () => {
  it('terminates a timed-out parser and rejects all waiting requests once', async () => {
    const client = new CsvClient('raw', ',', new AbortController().signal), worker = TestWorker.workers[0];
    const ready = expect(client.ready).rejects.toThrow('15秒'), pending = expect(client.window(0, 0, 1, 1)).rejects.toThrow('15秒');
    await vi.advanceTimersByTimeAsync(15000); await ready; await pending;
    expect(worker.terminate).toHaveBeenCalledTimes(1); await client.destroy(); expect(worker.terminate).toHaveBeenCalledTimes(1);
  });
  it('replaces the old worker, rejects old work and ignores a delayed result', async () => {
    const oldAbort = new AbortController(), first = await createCsvClient('first', ',', oldAbort.signal), oldWorker = TestWorker.workers[0];
    oldWorker.reply(1, { rows: 1, columns: 1 }); await first.ready;
    const pending = expect(first.cell(0, 0)).rejects.toThrow('已关闭');
    const next = await createCsvClient('second', '\t', new AbortController().signal), nextWorker = TestWorker.workers[1]; await pending;
    expect(oldWorker.terminate).toHaveBeenCalledOnce(); oldWorker.reply(2, { text: 'stale' });
    nextWorker.reply(1, { rows: 2, columns: 2 }); expect(await next.ready).toMatchObject({ rows: 2 });
    await next.destroy();
  });
  it('does not put a partial long cell on the clipboard if the viewer closes', async () => {
    const clipboard = { writeText: vi.fn(async () => undefined) }; vi.stubGlobal('navigator', { clipboard });
    const abort = new AbortController(), client = new CsvClient('source', ',', abort.signal), worker = TestWorker.workers[0];
    worker.reply(1, { rows: 1, columns: 1 }); await client.ready;
    const copying = expect(client.copyCell(0, 0)).rejects.toThrow('已关闭');
    worker.reply(2, { text: 'first', end: 5, total: 100 }); await Promise.resolve();
    abort.abort(); await copying; expect(clipboard.writeText).not.toHaveBeenCalled(); expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
