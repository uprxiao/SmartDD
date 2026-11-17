import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import type { ElectronAPI } from './api';

// Same generic bridge as Yoda: the typed RPC client and event emitter are built on top in the renderer.
const api: ElectronAPI = {
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  eventSend: (channel, data) => ipcRenderer.send(channel, data),
  eventOn: (channel, cb) => {
    const wrapped = (_: IpcRendererEvent, data: unknown) => cb(data);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  pathForFile: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
};

contextBridge.exposeInMainWorld('electronAPI', api);
