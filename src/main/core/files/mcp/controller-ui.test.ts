import {EventEmitter} from 'node:events';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import {describe,expect,it,vi} from 'vitest';
import {registerRPCRouter} from '@shared/ipc/rpc';
import {fileViewerUiEvent} from '@shared/events';
import {createFileController} from '../controller';
import type {FileService} from '../file-service';
const native=vi.hoisted(()=>({window:{isDestroyed:()=>false}}));
vi.mock('electron',()=>({BrowserWindow:{fromWebContents:()=>native.window},dialog:{},shell:{}}));
describe('MCP native UI scoped IPC boundary',()=>{
 it('rejects foreign frames/untrusted main and drops callbacks after sender navigation or trust loss',()=>{
  const handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();
  const ui={open:vi.fn(),bounds:vi.fn(),send:vi.fn(),close:vi.fn()},service={viewers:{ui},closeOwner:vi.fn()} as unknown as FileService;
  const sender=Object.assign(new EventEmitter(),{id:51,mainFrame:{processId:3,routingId:9},isDestroyed:()=>false,send:vi.fn()}),event={sender,senderFrame:sender.mainFrame} as unknown as IpcMainInvokeEvent;let trusted=true;
  registerRPCRouter({files:createFileController(service,()=>trusted)},{handle:(key:string,fn:(e:IpcMainInvokeEvent,...a:unknown[])=>unknown)=>handlers.set(key,fn)} as unknown as IpcMain);
  for(const route of ['viewerUiOpen','viewerUiBounds','viewerUiSend','viewerUiClose']){const fn=handlers.get('files.'+route)!;expect(()=>fn({...event,senderFrame:{}} as IpcMainInvokeEvent,{})).toThrow('UNTRUSTED');trusted=false;expect(()=>fn(event,{})).toThrow('UNTRUSTED');trusted=true}
  for(const spy of Object.values(ui))expect(spy).not.toHaveBeenCalled();
  const ctx={id:'fixture',uri:'fixture://exact',generation:1};handlers.get('files.viewerUiOpen')!(event,ctx);expect(ui.open.mock.calls[0].slice(0,3)).toEqual(['51:3:9',ctx,native.window]);
  const callback=ui.open.mock.calls[0][3] as (e:unknown)=>void,payload={id:'fixture',payload:{jsonrpc:'2.0',method:'ui/initialize'}};callback(payload);expect(sender.send).toHaveBeenCalledExactlyOnceWith(fileViewerUiEvent.name,payload);
  trusted=false;callback(payload);expect(sender.send).toHaveBeenCalledTimes(1);trusted=true;
  sender.mainFrame={processId:3,routingId:10};callback(payload);expect(sender.send).toHaveBeenCalledTimes(1);
  sender.emit('did-start-navigation',{},'https://foreign.invalid',false,true);expect(service.closeOwner).toHaveBeenCalledWith('51:3:9');
 });
});
