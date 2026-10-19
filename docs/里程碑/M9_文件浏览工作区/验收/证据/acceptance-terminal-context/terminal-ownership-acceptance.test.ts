import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { createPtyController, PtyAccess, registerPtyInput } from './pty-access';
const windows = vi.hoisted(() => [] as any[]);
vi.mock('./app/icon', () => ({ appIcon: '' }));
vi.mock('electron', () => ({ nativeTheme: { shouldUseDarkColors: false }, BrowserWindow: class extends EventEmitter {
  webContents = { mainFrame: { url: '' }, isDestroyed: (): boolean => false };
  constructor() { super(); windows.push(this); }
  isDestroyed() { return false; }
  async loadURL(url: string) { this.webContents.mainFrame.url = url; }
  async loadFile(path: string) { this.webContents.mainFrame.url = `file://${path}`; }
} }));
import { createMainWindow, isMainRenderer } from './app/window';
let bus: EventEmitter, off: () => void, event: IpcMainInvokeEvent, active: Map<string, string>, alive: Set<string>;
let write: Mock<(id: string, data: string) => void>, resize: Mock<(id: string, cols: number, rows: number) => void>, kill: Mock<(id: string) => void>, invoke: Function;
beforeEach(async () => {
  vi.stubEnv('ELECTRON_RENDERER_URL', 'http://127.0.0.1:5173/');
  const window = await createMainWindow(); event = { sender: window.webContents, senderFrame: window.webContents.mainFrame } as unknown as IpcMainInvokeEvent;
  active = new Map([['task-a', 'pty-a'], ['task-b', 'pty-b']]); alive = new Set(['pty-a', 'pty-b']);
  write = vi.fn(); resize = vi.fn(); kill = vi.fn();
  const access = new PtyAccess({ trusted: isMainRenderer, activePty: id => active.get(id) ?? null, alive: id => alive.has(id), write, resize, killTask: kill });
  bus = new EventEmitter(); off = registerPtyInput(bus as never, access);
  const handlers = new Map<string, Function>(); registerRPCRouter({ pty: createPtyController(access) }, { handle: (name: string, fn: Function) => handlers.set(name, fn) } as never); invoke = handlers.get('pty.kill')!;
});
afterEach(() => { off(); for (const window of windows.splice(0)) window.emit('closed'); vi.unstubAllEnvs(); });
const payload = { taskId: 'task-a', ptyId: 'pty-a', data: '中文🙂\x03', cols: 120, rows: 32 };
describe('M9-T-Y27 every raw channel retains main document and current PTY authorization', () => {
  it('accepts CJK/Ctrl input, resize and scoped kill on the same trusted current instance', () => {
    bus.emit('pty:input', event, payload); bus.emit('pty:resize', event, payload); invoke(event, payload.taskId, payload.ptyId);
    expect(write).toHaveBeenCalledExactlyOnceWith('pty-a', payload.data); expect(resize).toHaveBeenCalledExactlyOnceWith('pty-a', 120, 32); expect(kill).toHaveBeenCalledExactlyOnceWith('task-a');
  });
  it.each(['wrong-task', 'nonexistent-pty', 'old-pty', 'stopped-task', 'exited-pty', 'foreign-window', 'subframe', 'navigated-document', 'destroyed-sender', 'replaced-window'])('rejects %s on input, resize and kill with zero side effects', async scenario => {
    let incoming = event; const target = { ...payload };
    if (scenario === 'wrong-task') target.taskId = 'task-b';
    if (scenario === 'nonexistent-pty') target.ptyId = 'absent';
    if (scenario === 'old-pty') { active.set('task-a', 'new-pty'); alive.add('new-pty'); }
    if (scenario === 'stopped-task') active.delete('task-a');
    if (scenario === 'exited-pty') alive.delete('pty-a');
    if (scenario === 'foreign-window') { const frame = { url: 'http://127.0.0.1:5173/' }; incoming = { sender: { mainFrame: frame, isDestroyed: () => false }, senderFrame: frame } as never; }
    if (scenario === 'subframe') incoming = { ...event, senderFrame: {} } as never;
    if (scenario === 'navigated-document') (event.sender.mainFrame as unknown as { url: string }).url = 'http://127.0.0.1:5173/untrusted';
    if (scenario === 'destroyed-sender') event.sender.isDestroyed = () => true;
    if (scenario === 'replaced-window') await createMainWindow();
    bus.emit('pty:input', incoming, target); bus.emit('pty:resize', incoming, target);
    expect(() => invoke(incoming, target.taskId, target.ptyId)).toThrow(/TERMINAL_(SENDER|TARGET)_DENIED/);
    expect(write).not.toHaveBeenCalled(); expect(resize).not.toHaveBeenCalled(); expect(kill).not.toHaveBeenCalled();
  });
});
