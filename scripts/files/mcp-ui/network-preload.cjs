const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('probeResult',{send:value=>ipcRenderer.send('willyou-probe-result',value)});
