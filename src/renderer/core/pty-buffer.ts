import { ptyDataEvent, ptyExitEvent } from '@shared/events';
import { events } from '@renderer/lib/ipc';

// A PTY may write before its view mounts and stays alive when its task view unmounts.
// Keep recent output in the renderer so each new xterm can reconstruct the live shell.

const MAX_BUFFERED = 2 * 1024 * 1024;

interface Sink {
  data: (data: string) => void;
  exit: (code: number) => void;
}

interface BufferedOutput {
  chunks: string[];
  size: number;
  earlyExit: number | null;
  mounted: boolean;
  sinks: Set<Sink>;
}

const buffers = new Map<string, BufferedOutput>();

function outputFor(ptyId: string): BufferedOutput {
  let output = buffers.get(ptyId);
  if (!output) {
    output = { chunks: [], size: 0, earlyExit: null, mounted: false, sinks: new Set() };
    buffers.set(ptyId, output);
  }
  return output;
}

events.on(ptyDataEvent, ({ ptyId, data }) => {
  const output = outputFor(ptyId);
  const chunk = data.slice(-MAX_BUFFERED);
  output.chunks.push(chunk);
  output.size += chunk.length;
  while (output.size > MAX_BUFFERED) output.size -= output.chunks.shift()!.length;
  for (const sink of output.sinks) sink.data(data);
});

events.on(ptyExitEvent, ({ ptyId, code }) => {
  const output = outputFor(ptyId);
  if (!output.mounted) {
    output.earlyExit = code;
    return;
  }
  buffers.delete(ptyId);
  for (const sink of output.sinks) sink.exit(code);
});

export function attachPty(ptyId: string, sink: Sink): () => void {
  const output = outputFor(ptyId);
  output.mounted = true;
  for (const chunk of output.chunks) sink.data(chunk);
  if (output.earlyExit !== null) {
    buffers.delete(ptyId);
    sink.exit(output.earlyExit);
  } else {
    output.sinks.add(sink);
  }
  return () => { output.sinks.delete(sink); };
}
