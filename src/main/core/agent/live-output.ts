import type { AgentLiveFrame } from '@shared/events';
import { EVENT_LIMIT } from './agent-task-service';

const FLUSH_MS = 50;
const RUN_FRAMES = 128;
const RUN_BYTES = 16 * 1024 * 1024;
const HOST_BYTES = 64 * 1024 * 1024;

type Frame = { value: AgentLiveFrame; bytes: number };
type RunQueue = { frames: Frame[]; bytes: number; incomplete: boolean };

const textBytes = (text: string) => Buffer.byteLength(JSON.stringify(text)) - 2;

function codePointBoundary(text: string, end: number) {
  return end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end]) ? end - 1 : end;
}

function prefix(text: string, bytes: number) {
  let low = 0;
  let high = Math.min(text.length, bytes);
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (textBytes(text.slice(0, codePointBoundary(text, mid))) <= bytes) low = mid;
    else high = mid - 1;
  }
  return text.slice(0, codePointBoundary(text, low));
}

/** Coalesces transient previews. Durable items and control events use their own path. */
export class AgentLiveOutput {
  private readonly queues = new Map<string, RunQueue>();
  private pendingBytes = 0;
  private timer?: ReturnType<typeof setTimeout>;

  constructor(private readonly emit: (frame: AgentLiveFrame) => void) {}

  append(input: AgentLiveFrame) {
    if (!input.text) return;
    // Reserve enough space for the preview marker if this run fills the queue.
    const envelope = Buffer.byteLength(JSON.stringify({ ...input, text: '', previewIncomplete: true }));
    if (envelope >= EVENT_LIMIT) return;
    let queue = this.queues.get(input.runId);
    if (!queue) {
      queue = { frames: [], bytes: 0, incomplete: false };
      this.queues.set(input.runId, queue);
    }
    if (queue.incomplete) return;
    let remaining = input.text;
    while (remaining) {
      const gap = Math.min(RUN_BYTES - queue.bytes, HOST_BYTES - this.pendingBytes);
      const last = queue.frames.at(-1);
      if (last?.value.itemKey === input.itemKey) {
        const suffix = prefix(remaining, Math.min(gap, EVENT_LIMIT - last.bytes));
        if (suffix) {
          last.value.text += suffix;
          const bytes = textBytes(suffix);
          last.bytes += bytes;
          queue.bytes += bytes;
          this.pendingBytes += bytes;
          remaining = remaining.slice(suffix.length);
          continue;
        }
      }
      const chunk = queue.frames.length < RUN_FRAMES ? prefix(remaining, Math.min(gap, EVENT_LIMIT) - envelope) : '';
      if (!chunk) {
        queue.incomplete = true;
        if (last) last.value.previewIncomplete = true;
        break;
      }
      const bytes = envelope + textBytes(chunk);
      queue.frames.push({ value: { ...input, text: chunk }, bytes });
      queue.bytes += bytes;
      this.pendingBytes += bytes;
      remaining = remaining.slice(chunk.length);
    }
    this.schedule();
  }

  private schedule() {
    if (this.timer || !this.pendingBytes) return;
    this.timer = setTimeout(() => this.flush(), FLUSH_MS);
    this.timer.unref();
  }

  private flush() {
    this.timer = undefined;
    for (const [runId, queue] of this.queues) {
      const frame = queue.frames.shift();
      if (frame) {
        queue.bytes -= frame.bytes;
        this.pendingBytes -= frame.bytes;
        try { this.emit(frame.value); } catch { /* The receiving window may have closed. */ }
      }
      if (!queue.frames.length && !queue.incomplete) this.queues.delete(runId);
      if (!this.pendingBytes) break;
    }
    this.schedule();
  }

  end(runId: string) {
    const queue = this.queues.get(runId);
    if (!queue) return;
    this.pendingBytes -= queue.bytes;
    this.queues.delete(runId);
  }

  close() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.queues.clear();
    this.pendingBytes = 0;
  }
}
