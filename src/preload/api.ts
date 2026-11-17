export interface ElectronAPI {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>;
  eventSend: (channel: string, data: unknown) => void;
  eventOn: (channel: string, cb: (data: unknown) => void) => () => void;
  /** 粘贴／拖入的文件在本机的真实路径（Electron webUtils）；剪贴板图片等没有路径时为空串。 */
  pathForFile: (file: File) => string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
