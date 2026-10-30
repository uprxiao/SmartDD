import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { describe, expect, it, vi } from 'vitest';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { fileWorkspaceEvent } from '@shared/events';
import type { SavedFileWorkspace } from '@shared/file-workspace';
import { createFileController } from './controller';
import type { FileService } from './file-service';
import type { FileWorkspacePersistence } from './workspace-persistence';

const native = vi.hoisted(() => ({ choose: vi.fn(), window: { isDestroyed: () => false } }));
vi.mock('electron', () => ({ BrowserWindow: { fromWebContents: () => native.window }, dialog: { showSaveDialog: native.choose }, shell: { openExternal: vi.fn() } }));

describe('file IPC sender boundary', () => {
  it('authenticates every PPTX entry before edit, persistence, projection or release',()=>{
    const routes={openPptx:'open',editPptx:'edit',pptxHistory:'history',checkpointPptx:'checkpoint',savePptx:'save',restorePptx:'restore',rebasePptx:'rebase',renderPptx:'render',pptxChunk:'chunk',cancelPptxRender:'cancelRender',closePptx:'close'};
    const pptx=Object.fromEntries(Object.values(routes).map(name=>[name,vi.fn()])),service={pptx,closeOwner:vi.fn()} as unknown as FileService;
    const sender=Object.assign(new EventEmitter(),{id:9,mainFrame:{processId:17,routingId:11},isDestroyed:()=>false}),event={sender,senderFrame:sender.mainFrame} as unknown as IpcMainInvokeEvent;
    const handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();
    registerRPCRouter({files:createFileController(service,()=>true)},{handle:(channel:string,handler:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(channel,handler)} as unknown as IpcMain);
    for(const [route,method] of Object.entries(routes)){
      const handler=handlers.get(`files.${route}`)!;
      expect(()=>handler({...event,senderFrame:{}} as IpcMainInvokeEvent,'request')).toThrow('UNTRUSTED');expect(pptx[method]).not.toHaveBeenCalled();
      handler(event,'request');expect(pptx[method]).toHaveBeenCalledWith('9:17:11','request',...Array.from({length:route==='pptxChunk'?3:route==='cancelPptxRender'?1:0},()=>undefined));
    }
  });
  it('limits persistent route reads and writes to the trusted main renderer', () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const state: SavedFileWorkspace = { schemaVersion: 1, routes: [], active: null, treeSource: null, expanded: {}, collapsedRoots: [], filters: {}, treeWidth: 260 };
    const snapshot = { state: null, revision: 0 }, committed = { state, revision: 1, accepted: true };
    const workspace = { load: vi.fn(() => null), snapshot: vi.fn(() => snapshot), commit: vi.fn(() => committed) };
    const service = { closeOwner: vi.fn() } as unknown as FileService;
    const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: { processId: 14, routingId: 10 }, isDestroyed: () => false, send: vi.fn() });
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    registerRPCRouter({ files: createFileController(service, () => true, workspace as unknown as FileWorkspacePersistence) }, { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain);
    const scope = { kind: 'project', projectId: 'p' }, foreign = { ...event, senderFrame: {} } as IpcMainInvokeEvent, mutationId = randomUUID();
    expect(() => handlers.get('files.workspace')!(foreign, scope)).toThrow('UNTRUSTED');
    expect(() => handlers.get('files.workspaceSnapshot')!(foreign, scope)).toThrow('UNTRUSTED');
    expect(() => handlers.get('files.saveWorkspace')!(foreign, scope, state, 0, mutationId)).toThrow('UNTRUSTED');
    expect(workspace.load).not.toHaveBeenCalled(); expect(workspace.snapshot).not.toHaveBeenCalled(); expect(workspace.commit).not.toHaveBeenCalled();
    // An old unversioned writer cannot bypass the new CAS contract.
    expect(() => handlers.get('files.saveWorkspace')!(event, scope, state)).toThrow('INVALID_INPUT');
    expect(workspace.commit).not.toHaveBeenCalled(); expect(sender.send).not.toHaveBeenCalled();
    handlers.get('files.workspace')!(event, scope);
    expect(handlers.get('files.workspaceSnapshot')!(event, scope)).toBe(snapshot);
    expect(handlers.get('files.saveWorkspace')!(event, scope, state, 0, mutationId)).toBe(committed);
    expect(workspace.load).toHaveBeenCalledWith(scope); expect(workspace.snapshot).toHaveBeenCalledWith(scope);
    expect(workspace.commit).toHaveBeenCalledExactlyOnceWith(scope, state, 0);
    expect(sender.send).toHaveBeenCalledExactlyOnceWith(fileWorkspaceEvent.name, { scope, state, revision: 1, mutationId });
  });
  it('does not copy on cancellation and accepts a destination only from its native dialog', async () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const selection = { name: 'a.txt', context: { lease: { canonicalPath: '/fixture' }, relativePath: 'docs/a.txt' } };
    const prepareCopy = vi.fn(async () => selection), copyTo = vi.fn(async () => ({ state: 'saved' })), service = { actions: { prepareCopy, copyTo }, closeOwner: vi.fn() } as unknown as FileService;
    const sender = Object.assign(new EventEmitter(), { id: 4, mainFrame: { processId: 13, routingId: 9 }, isDestroyed: () => false });
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    let trusted = true;
    registerRPCRouter({ files: createFileController(service, () => trusted) }, { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain);
    const saveCopy = handlers.get('files.saveCopy')!;
    native.choose.mockResolvedValueOnce({ canceled: true, filePath: '' });
    expect(await saveCopy(event, {})).toEqual({ state: 'cancelled' }); expect(copyTo).not.toHaveBeenCalled();
    native.choose.mockResolvedValueOnce({ canceled: false, filePath: '/native-selected/copy.txt' });
    await saveCopy(event, {}); expect(copyTo).toHaveBeenCalledWith('4:13:9', selection, '/native-selected/copy.txt');
    native.choose.mockImplementationOnce(async () => { trusted = false; return { canceled: false, filePath: '/late-copy.txt' }; });
    await expect(saveCopy(event, {})).rejects.toThrow('UNTRUSTED'); expect(copyTo).toHaveBeenCalledTimes(1);
  });
  it('rejects viewers/foreign documents before touching a source, and revokes navigation/crash owners', () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const openScope = vi.fn(), closeOwner = vi.fn();
    const service = { openScope, closeOwner } as unknown as FileService;
    const sender = Object.assign(new EventEmitter(), { id: 3, mainFrame: { processId: 12, routingId: 8 }, isDestroyed: () => false });
    const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
    let trusted = true;
    const controller = createFileController(service, () => trusted);
    registerRPCRouter({ files: controller }, { handle: (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => handlers.set(channel, handler) } as unknown as IpcMain);
    const roots = handlers.get('files.roots')!;
    const scope = { kind: 'project', projectId: 'p' };
    expect(() => roots({ ...event, senderFrame: {} } as IpcMainInvokeEvent, scope)).toThrow('UNTRUSTED');
    expect(openScope).not.toHaveBeenCalled();
    trusted = false; expect(() => roots(event, scope)).toThrow('UNTRUSTED');
    trusted = true; roots(event, scope); expect(openScope).toHaveBeenCalledWith('3:12:8', scope);
    sender.emit('did-start-navigation', {}, 'https://untrusted.invalid', false, false); expect(closeOwner).not.toHaveBeenCalled();
    sender.emit('did-start-navigation', {}, 'https://untrusted.invalid', false, true); expect(closeOwner).toHaveBeenCalledWith('3:12:8');
    roots(event, scope); sender.emit('render-process-gone'); expect(closeOwner).toHaveBeenCalledTimes(2);
    roots(event, scope); sender.emit('destroyed'); expect(closeOwner).toHaveBeenCalledTimes(3);
  });
});
