import type { IpcMain, IpcMainEvent, IpcMainInvokeEvent } from 'electron';
import { ptyInputEvent, ptyResizeEvent } from '@shared/events';
import { createScopedRPCController } from '@shared/ipc/rpc';

type SenderEvent = Pick<IpcMainEvent, 'sender' | 'senderFrame'>;
type Target = { taskId: string; ptyId: string };

/** Only the application's trusted main renderer owns its task terminals.
 * File viewers must not receive this authority, even if they learn a PTY id.
 * Resolve the task in the main process on every operation: exit/reopen invalidates old ids.
 */
export class PtyAccess {
  constructor(private readonly deps: {
    trusted: (event: SenderEvent) => boolean;
    activePty: (taskId: string) => string | null;
    alive: (ptyId: string) => boolean;
    write: (ptyId: string, data: string) => void;
    resize: (ptyId: string, cols: number, rows: number) => void;
    killTask: (taskId: string) => void;
  }) {}

  requireSender(event: SenderEvent): void {
    if (!event?.sender || event.sender.isDestroyed() || !event.senderFrame ||
        event.senderFrame !== event.sender.mainFrame || !this.deps.trusted(event)) {
      throw new Error('TERMINAL_SENDER_DENIED');
    }
  }

  private target(event: SenderEvent, value: unknown): Target {
    this.requireSender(event);
    const t = value as Partial<Target> | null;
    if (!t || typeof t.taskId !== 'string' || !t.taskId || t.taskId.length > 128 ||
        typeof t.ptyId !== 'string' || !t.ptyId || t.ptyId.length > 128) throw new Error('TERMINAL_TARGET_DENIED');
    if (this.deps.activePty(t.taskId) !== t.ptyId || !this.deps.alive(t.ptyId)) throw new Error('TERMINAL_TARGET_DENIED');
    return t as Target;
  }

  input(event: SenderEvent, value: unknown): boolean {
    try {
      const t = this.target(event, value);
      const data = (value as { data?: unknown }).data;
      // This is keyboard input, so control keys remain valid. Context insertion
      // has a separate sanitization contract and may not reuse raw input blindly.
      if (typeof data !== 'string' || Buffer.byteLength(data, 'utf8') > 1024 * 1024) return false;
      this.deps.write(t.ptyId, data);
      return true;
    } catch { return false; }
  }

  resize(event: SenderEvent, value: unknown): boolean {
    try {
      const t = this.target(event, value);
      const { cols, rows } = value as { cols: number; rows: number };
      if (!Number.isSafeInteger(cols) || !Number.isSafeInteger(rows) || cols < 1 || rows < 1 || cols > 1000 || rows > 1000) return false;
      this.deps.resize(t.ptyId, cols, rows);
      return true;
    } catch { return false; }
  }

  kill(event: SenderEvent, taskId: string, ptyId: string): void {
    this.target(event, { taskId, ptyId });
    this.deps.killTask(taskId);
  }
}

/** Keep Electron's trusted sender context; the generic event emitter omits it. */
export function registerPtyInput(ipc: Pick<IpcMain, 'on' | 'off'>, access: PtyAccess): () => void {
  const input = (event: IpcMainEvent, value: unknown) => { access.input(event, value); };
  const resize = (event: IpcMainEvent, value: unknown) => { access.resize(event, value); };
  ipc.on(ptyInputEvent.name, input);
  ipc.on(ptyResizeEvent.name, resize);
  return () => { ipc.off(ptyInputEvent.name, input); ipc.off(ptyResizeEvent.name, resize); };
}

export function createPtyController(access: PtyAccess) {
  return createScopedRPCController({
    kill: (event: IpcMainInvokeEvent, taskId: string, ptyId: string) => access.kill(event, taskId, ptyId),
  });
}
