import { ptyDataEvent, ptyExitEvent } from '@shared/events';
import { events } from '@renderer/lib/ipc';

// A PTY starts printing as soon as main spawns it, before React has mounted its xterm.
// Output for terminals nobody is attached to yet is kept here and flushed on attach.

const MAX_BUFFERED = 2 * 1024 * 1024;

interface Sink {
  data: (data: string) => void;
  exit: (code: number) => void;
}

const pending = new Map<string, { chunks: string[]; size: number; exit: number | null }>();
const sinks = new Map<string, Sink>();
export const exitedPtys = new Map<string, number>();

events.on(ptyDataEvent, ({ ptyId, data }) => {
  const sink = sinks.get(ptyId);
  if (sink) return sink.data(data);
  const p = pending.get(ptyId) ?? { chunks: [], size: 0, exit: null };
  p.chunks.push(data);
  p.size += data.length;
  while (p.size > MAX_BUFFERED && p.chunks.length > 1) p.size -= p.chunks.shift()!.length;
  pending.set(ptyId, p);
});

events.on(ptyExitEvent, ({ ptyId, code }) => {
  exitedPtys.set(ptyId, code);
  const sink = sinks.get(ptyId);
  if (sink) return sink.exit(code);
  const p = pending.get(ptyId) ?? { chunks: [], size: 0, exit: null };
  p.exit = code;
  pending.set(ptyId, p);
});

export function attachPty(ptyId: string, sink: Sink): () => void {
  const p = pending.get(ptyId);
  pending.delete(ptyId);
  if (p) {
    for (const c of p.chunks) sink.data(c);
    if (p.exit !== null) sink.exit(p.exit);
  }
  sinks.set(ptyId, sink);
  return () => {
    if (sinks.get(ptyId) === sink) sinks.delete(ptyId);
  };
}
