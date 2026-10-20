import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { createTaskController } from './core/tasks/controller';
import { createPtyController, PtyAccess, registerPtyInput } from './pty-access';

const sender = (id: number) => ({ id, mainFrame: {}, isDestroyed: () => false });
let main: ReturnType<typeof sender>;
let event: IpcMainInvokeEvent;
let owners: Map<string, string>;
let live: Set<string>;
let write: Mock<(id: string, data: string) => void>;
let resize: Mock<(id: string, cols: number, rows: number) => void>;
let kill: Mock<(id: string) => void>;
let access: PtyAccess;
beforeEach(() => {
  main = sender(1);
  event = { sender: main, senderFrame: main.mainFrame } as unknown as IpcMainInvokeEvent;
  owners = new Map([['task-a', 'pty-a'], ['task-b', 'pty-b']]);
  live = new Set(['pty-a', 'pty-b']);
  write = vi.fn(); resize = vi.fn(); kill = vi.fn();
  access = new PtyAccess({ trusted: e => e.sender === event.sender, activePty: id => owners.get(id) ?? null,
    alive: id => live.has(id), write, resize, killTask: kill });
});
const payload = { taskId: 'task-a', ptyId: 'pty-a', data: '中文\u0003' };

describe('main-process PTY ownership', () => {
  it('forwards valid keyboard control keys and resize with the trusted event intact', () => {
    const bus = new EventEmitter(); const off = registerPtyInput(bus as never, access);
    bus.emit('pty:input', event, payload);
    bus.emit('pty:resize', event, { ...payload, cols: 120, rows: 32 });
    expect(write).toHaveBeenCalledWith('pty-a', payload.data);
    expect(resize).toHaveBeenCalledWith('pty-a', 120, 32);
    off(); bus.emit('pty:input', event, payload);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('rejects an otherwise valid id from a different window, child frame or destroyed sender', () => {
    const other = sender(2);
    for (const e of [{ sender: other, senderFrame: other.mainFrame },
      { sender: main, senderFrame: {} }, { sender: main, senderFrame: null }]) {
      expect(access.input(e as never, payload)).toBe(false);
    }
    main.isDestroyed = () => true;
    expect(access.input(event, payload)).toBe(false);
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects missing/mismatched task ids even when both PTYs are live', () => {
    for (const value of [null, {}, { ...payload, taskId: 'task-b' }, { ...payload, ptyId: 'pty-b' }, { ...payload, taskId: undefined }]) {
      expect(access.input(event, value)).toBe(false);
    }
    expect(write).not.toHaveBeenCalled();
  });
  it('rechecks ownership after stop/delete/reopen and rejects a dead native PTY', () => {
    owners.delete('task-a'); expect(access.input(event, payload)).toBe(false);
    owners.set('task-a', 'pty-new'); live.add('pty-new');
    expect(access.input(event, payload)).toBe(false);
    expect(access.input(event, { ...payload, ptyId: 'pty-new' })).toBe(true);
    live.delete('pty-new'); expect(access.input(event, { ...payload, ptyId: 'pty-new' })).toBe(false);
    expect(write).toHaveBeenCalledTimes(1);
  });
  it('rejects malformed/oversize payloads and invalid dimensions without throwing in an event handler', () => {
    for (const data of [null, {}, 7, '中'.repeat(350000)]) expect(access.input(event, { ...payload, data })).toBe(false);
    for (const cols of [0, -1, 1.5, Infinity, 1001, '120']) expect(access.resize(event, { ...payload, cols, rows: 32 })).toBe(false);
    expect(write).not.toHaveBeenCalled(); expect(resize).not.toHaveBeenCalled();
  });
  it('scoped kill RPC uses Electron context and the task service, never a renderer-supplied owner', () => {
    const handlers = new Map<string, Function>();
    registerRPCRouter({ pty: createPtyController(access) }, { handle: (name: string, fn: Function) => handlers.set(name, fn) } as never);
    const invoke = handlers.get('pty.kill')!;
    expect(() => invoke(event, 'task-b', 'pty-a')).toThrow('TERMINAL_TARGET_DENIED');
    const other = sender(2);
    expect(() => invoke({ sender: other, senderFrame: other.mainFrame }, 'task-a', 'pty-a', event)).toThrow('TERMINAL_SENDER_DENIED');
    invoke(event, 'task-a', 'pty-a'); expect(kill).toHaveBeenCalledExactlyOnceWith('task-a');
  });
  it('observes only successful owned writes,never raw failed/unauthorized input or resize/context authorization',()=>{
    const observed=vi.fn();const current=new PtyAccess({trusted:e=>e.sender===event.sender,activePty:id=>owners.get(id)??null,alive:id=>live.has(id),write,resize,killTask:kill,observedInput:observed});
    current.authorize(event,payload);current.resize(event,{...payload,cols:80,rows:24});expect(observed).not.toHaveBeenCalled();expect(current.input(event,{...payload,runId:'forged'})).toBe(true);expect(observed).toHaveBeenCalledExactlyOnceWith(event,{taskId:'task-a',ptyId:'pty-a'},payload.data);expect(write.mock.invocationCallOrder[0]).toBeLessThan(observed.mock.invocationCallOrder[0]);
    write.mockImplementationOnce(()=>{throw new Error('closed native handle');});expect(current.input(event,payload)).toBe(false);expect(current.input({...event,senderFrame:null},payload)).toBe(false);expect(observed).toHaveBeenCalledTimes(1);
  });
  it('keeps an accepted keyboard write successful when evidence collection fails,so callers cannot duplicate it',()=>{
    const current=new PtyAccess({trusted:()=>true,activePty:()=>payload.ptyId,alive:()=>true,write,resize,killTask:kill,observedInput:()=>{throw new Error('observation unavailable');}});expect(current.input(event,payload)).toBe(true);expect(write).toHaveBeenCalledExactlyOnceWith(payload.ptyId,payload.data);
  });
  it('task endpoints cannot bypass sender checks for create/open/delete/kill/archive', () => {
    const names = ['list', 'get', 'create', 'open', 'rename', 'setArchived', 'stopAndArchive', 'delete', 'kill'];
    const svc = Object.fromEntries(names.map(n => [n, vi.fn()]));
    const handlers = new Map<string, Function>();
    registerRPCRouter(createTaskController(svc as never, e => access.requireSender(e)), { handle: (name: string, fn: Function) => handlers.set(name, fn) } as never);
    for (const name of names) {
      const invoke = handlers.get(`tasks.${name}`)!;
      expect(() => invoke({ sender: main, senderFrame: {} }, 'task-a')).toThrow('TERMINAL_SENDER_DENIED');
      expect(svc[name]).not.toHaveBeenCalled();
      invoke(event, 'task-a'); expect(svc[name]).toHaveBeenCalledTimes(1);
    }
  });
});
