import type { FileBuffer } from './file-buffer';

// A window-local choice belongs to the physical buffer, not its suffix or a
// mounted React view. Explicit source navigation uses the same authority as
// the existing viewer menu; the next menu choice may supersede it again.
const choices = new WeakMap<FileBuffer, string | null>();
const listeners = new Set<() => void>();
export const fileViewerChoice = (buffer: FileBuffer | undefined) => buffer ? choices.get(buffer) : undefined;
export function chooseFileViewer(buffer: FileBuffer, id: string | null | undefined): void {
  if (choices.get(buffer) === id) return;
  if (id === undefined) choices.delete(buffer); else choices.set(buffer, id);
  for (const listener of listeners) listener();
}
export function subscribeFileViewerChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
