import {contextBridge,ipcRenderer,type IpcRendererEvent} from 'electron';
// Only the trusted outer document has this bridge. The opaque child has none.
contextBridge.exposeInMainWorld('willyouMcpUi',{
 send:(payload:unknown)=>ipcRenderer.send('willyou-mcp-ui:message',payload),
 receive:(callback:(value:unknown)=>void)=>{const handler=(_event:IpcRendererEvent,value:unknown)=>callback(value);ipcRenderer.on('willyou-mcp-ui:host',handler);return()=>ipcRenderer.removeListener('willyou-mcp-ui:host',handler)},
});
