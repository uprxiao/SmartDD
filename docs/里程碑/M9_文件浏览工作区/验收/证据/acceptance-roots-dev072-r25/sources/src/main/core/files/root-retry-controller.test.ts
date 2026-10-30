import { EventEmitter } from 'node:events';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { createFileController } from './controller';
import type { FileService } from './file-service';
vi.mock('electron', () => ({ BrowserWindow: {}, dialog: {}, shell: {} }));
describe('root recovery IPC authentication', () => {
  it('rejects foreign frames before retry/release and forwards the actual owner', () => {
    const roots = { retry: vi.fn(), release: vi.fn() }, service = { roots } as unknown as FileService;
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>(), sender = Object.assign(new EventEmitter(), { id: 31, mainFrame: { processId: 41, routingId: 59 }, isDestroyed: () => false, send: vi.fn() }), event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    registerRPCRouter({ files: createFileController(service, () => true) }, { handle: (name: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(name, handler) } as unknown as IpcMain);
    for (const [name, method] of [['retryRoot', roots.retry], ['releaseRoot', roots.release]] as const) { const handler = handlers.get('files.' + name)!; expect(() => handler({ ...event, senderFrame: {} } as IpcMainInvokeEvent, 'opaque input')).toThrow('UNTRUSTED'); expect(method).not.toHaveBeenCalled(); handler(event, 'opaque input'); expect(method).toHaveBeenCalledWith('31:41:59', 'opaque input'); }
  });
});
