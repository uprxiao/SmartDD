import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { SmartddApi } from '@shared/types';

function subscribe<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as A));
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.off(channel, listener);
}

const api: SmartddApi = {
  listSessions: () => ipcRenderer.invoke('sessions:list'),
  launch: (req) => ipcRenderer.invoke('sessions:launch', req),
  write: (id, data) => ipcRenderer.send('pty:write', id, data),
  resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
  kill: (id) => ipcRenderer.send('pty:kill', id),
  runProbes: () => ipcRenderer.invoke('probes:run'),
  onData: (cb) => subscribe('pty:data', cb),
  onExit: (cb) => subscribe('pty:exit', cb),
  onSessionUpdated: (cb) => subscribe('session:updated', cb),
};

contextBridge.exposeInMainWorld('smartdd', api);
