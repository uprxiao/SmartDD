import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { createTransferController } from './transfer-controller';
import type { ProjectTransferService } from './transfer-service';
import { TransferError } from './transfer-format';

const native = vi.hoisted(() => ({ open: vi.fn(), save: vi.fn(), reveal: vi.fn(), window: { title: 'QA' } }));
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => native.window }, dialog: { showOpenDialog: native.open, showSaveDialog: native.save }, shell: { showItemInFolder: native.reveal } }));
let handlers: Map<string, (...args: any[]) => any>;
let svc: ReturnType<typeof service>;
function service() {
  return {
    describeExport: vi.fn(() => ({ project: { name: 'AIS' } })),
    exclusive: vi.fn(async (_id: number, fn: () => unknown) => fn()),
    exportTo: vi.fn(async (path: string) => ({ path, fileName: 'AIS.willyou', sha256: 'hash' })),
    choose: vi.fn(() => ({ fileToken: 'opaque', fileName: 'AIS.willyou' })),
    unlock: vi.fn(), allowDirectory: vi.fn(), allowRules: vi.fn(),
    validateDraft: vi.fn(), commit: vi.fn(), getResult: vi.fn(), dispose: vi.fn(), disposeOwner: vi.fn(),
  };
}
function event(id = 7) {
  const sender = Object.assign(new EventEmitter(), { id, mainFrame: {}, isDestroyed: () => false });
  return { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
}
const invoke = (name: string, e: IpcMainInvokeEvent, ...args: unknown[]) => handlers.get(`transfer.${name}`)!(e, ...args);
const input = { projectId: 'project', profileIds: [], emptyPasswordRefs: [], passphrase: '12345678', confirmation: '12345678' };
beforeEach(() => {
  vi.clearAllMocks(); svc = service(); handlers = new Map();
  registerRPCRouter({ transfer: createTransferController(svc as unknown as ProjectTransferService) }, { handle: (name: string, handler: (...args: any[]) => any) => handlers.set(name, handler) } as never);
});
describe('M8 native dialogs and sender-bound IPC', () => {
  it('E02 refuses a short or mismatched password without opening the native save dialog', async () => {
    for (const bad of [{ ...input, passphrase: '1234567' }, { ...input, confirmation: 'wrong' }]) expect(await invoke('export', event(), bad)).toMatchObject({ ok: false });
    expect(native.save).not.toHaveBeenCalled(); expect(svc.exportTo).not.toHaveBeenCalled();
  });
  it('E05/I07 picker cancellation neither writes nor creates a preview', async () => {
    native.save.mockResolvedValue({ canceled: true }); native.open.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke('export', event(), input)).toEqual({ ok: true, value: null });
    expect(await invoke('chooseImport', event())).toEqual({ ok: true, value: null });
    expect(svc.exportTo).not.toHaveBeenCalled(); expect(svc.choose).not.toHaveBeenCalled();
    expect(native.save.mock.calls[0][1].properties).toContain('showOverwriteConfirmation');
  });
  it('E01/E05 exports only to the native-selected file and scopes Finder reveal to its sender', async () => {
    native.save.mockResolvedValue({ canceled: false, filePath: '/chosen/AIS.willyou' }); const e = event();
    expect(await invoke('export', e, input)).toMatchObject({ ok: true });
    expect(svc.exportTo).toHaveBeenCalledWith('/chosen/AIS.willyou', 'project', [], [], '12345678');
    expect(await invoke('revealExport', event(8), '/chosen/AIS.willyou')).toMatchObject({ ok: false });
    expect(await invoke('revealExport', e, '/arbitrary/file')).toMatchObject({ ok: false });
    expect(await invoke('revealExport', e, '/chosen/AIS.willyou')).toMatchObject({ ok: true });
    expect(native.reveal).toHaveBeenCalledTimes(1);
  });
  it('D02 registers only the directory returned by the system picker', async () => {
    native.open.mockResolvedValue({ canceled: false, filePaths: ['/picked'] });
    expect(await invoke('pickDirectory', event(), 'preview')).toEqual({ ok: true, value: '/picked' });
    expect(svc.allowDirectory).toHaveBeenCalledWith(7, 'preview', '/picked');
    expect(native.open.mock.calls[0][1].properties).toContain('openDirectory');
  });
  it('I07/S05 rejects subframes and disposes preview sessions on navigation and destruction', async () => {
    const e = event();
    expect(await invoke('describeExport', { ...e, senderFrame: {} as IpcMainInvokeEvent['senderFrame'] }, 'project', [])).toMatchObject({ ok: false });
    expect(svc.describeExport).not.toHaveBeenCalled();
    await invoke('describeExport', e, 'project', []);
    e.sender.emit('did-start-navigation', {}, 'file:///new', false, true);
    e.sender.emit('destroyed');
    expect(svc.disposeOwner).toHaveBeenCalledTimes(2); expect(svc.disposeOwner).toHaveBeenCalledWith(7);
  });
  it('S05 never returns raw filesystem/secret exceptions across IPC', async () => {
    svc.describeExport.mockImplementationOnce(() => { throw Error('private-token-secret'); });
    expect(JSON.stringify(await invoke('describeExport', event(), 'project', []))).not.toContain('private-token-secret');
    svc.describeExport.mockImplementationOnce(() => { throw new TransferError('MISSING_CREDENTIAL', '请补齐凭据'); });
    expect(await invoke('describeExport', event(), 'project', [])).toEqual({ ok: false, code: 'MISSING_CREDENTIAL', message: '请补齐凭据' });
  });
});
