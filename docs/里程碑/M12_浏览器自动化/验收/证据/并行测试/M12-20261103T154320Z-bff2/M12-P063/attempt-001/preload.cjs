const {contextBridge, ipcRenderer} = require('electron');
// Technical probe only: this channel has no App RPC, files or credential access.
contextBridge.exposeInMainWorld('__m12PromptProbe', (message, initial) => {
  if (typeof message !== 'string' || typeof initial !== 'string') return null;
  return ipcRenderer.sendSync('m12-p063-prompt-probe', {message, initial});
});
contextBridge.executeInMainWorld({func: () => {
  const open = window.__m12PromptProbe;
  window.prompt = function (message = '', initial = '') {
    return open(String(message), String(initial));
  };
}});
