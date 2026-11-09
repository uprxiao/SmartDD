const {contextBridge} = require('electron');
// Keep only Chromium's existing prompt function; no App or IPC API is exposed.
const nativePrompt = globalThis.prompt.bind(globalThis);
contextBridge.exposeInMainWorld('__m12NativePromptProbe', (message, initial) => nativePrompt(message, initial));
contextBridge.executeInMainWorld({func: () => {
  window.prompt = function (message = '', initial = '') {
    return window.__m12NativePromptProbe(String(message), String(initial));
  };
}});
