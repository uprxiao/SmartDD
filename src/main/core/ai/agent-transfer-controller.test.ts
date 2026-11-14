import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { createAgentTransferController } from './agent-transfer-controller';
import type { AgentTransferService } from './agent-transfer';

const native=vi.hoisted(()=>({open:vi.fn(),save:vi.fn()}));
vi.mock('electron',()=>({BrowserWindow:{fromWebContents:()=>({})},dialog:{showOpenDialog:native.open,showSaveDialog:native.save}}));
const input={agentIds:['a'],providerIds:[],includeKeys:false};
const event=(id=4)=>{
  const sender=Object.assign(new EventEmitter(),{id,mainFrame:{},isDestroyed:()=>false});
  return {sender,senderFrame:sender.mainFrame} as unknown as IpcMainInvokeEvent;
};
let service:{exportTo:ReturnType<typeof vi.fn>;choose:ReturnType<typeof vi.fn>;unlock:ReturnType<typeof vi.fn>;commit:ReturnType<typeof vi.fn>;disposeOwner:ReturnType<typeof vi.fn>};
let handlers:Map<string,(...args:any[])=>any>;
const call=(method:string,e:IpcMainInvokeEvent,...args:unknown[])=>handlers.get(`agentTransfer.${method}`)!(e,...args);
beforeEach(()=>{
  vi.clearAllMocks();handlers=new Map();
  service={exportTo:vi.fn(async(path,_input,check)=>{check();return {path};}),choose:vi.fn(()=>({token:'opaque'})),unlock:vi.fn(),commit:vi.fn(),disposeOwner:vi.fn()};
  registerRPCRouter({agentTransfer:createAgentTransferController(service as unknown as AgentTransferService)},
    {handle:(name:string,fn:(...args:any[])=>any)=>handlers.set(name,fn)} as never);
});
it('native cancellation neither writes nor retains an import preview',async()=>{
  native.open.mockResolvedValue({canceled:true});native.save.mockResolvedValue({canceled:true});
  expect(await call('chooseImport',event())).toEqual({ok:true,value:null});
  expect(await call('export',event(),input)).toEqual({ok:true,value:null});
  expect(service.choose).not.toHaveBeenCalled();expect(service.exportTo).not.toHaveBeenCalled();
});
it('only uses native-selected paths and asks overwrite confirmation',async()=>{
  native.save.mockResolvedValue({filePath:'/synthetic/chosen.json'});native.open.mockResolvedValue({filePaths:['/synthetic/import.json']});
  expect(await call('export',event(),input)).toEqual({ok:true,value:{path:'/synthetic/chosen.json'}});
  expect(service.exportTo.mock.calls[0][0]).toBe('/synthetic/chosen.json');
  expect(native.save.mock.calls[0][1].properties).toContain('showOverwriteConfirmation');
  await call('chooseImport',event());expect(service.choose).toHaveBeenCalledWith(4,'/synthetic/import.json');
});
it('rejects subframes without opening a picker or reading a file',async()=>{
  expect(await call('chooseImport',{...event(),senderFrame:{}} as IpcMainInvokeEvent)).toMatchObject({ok:false});
  expect(native.open).not.toHaveBeenCalled();expect(service.choose).not.toHaveBeenCalled();
});
it('invalid key-export confirmation is rejected before the save dialog',async()=>{
  for(const extra of [{password:'short',confirmation:'short'},{password:'12345678',confirmation:'different'},{password:'12345678'}])
    expect(await call('export',event(),{...input,includeKeys:true,...extra})).toMatchObject({ok:false});
  expect(native.save).not.toHaveBeenCalled();
});
it('navigation invalidates an in-flight native picker even when frame object is unchanged',async()=>{
  let resolve!:(v:unknown)=>void;native.open.mockReturnValue(new Promise(r=>resolve=r));const e=event();
  const pending=call('chooseImport',e);e.sender.emit('did-start-navigation',{},'new',false,true);
  resolve({filePaths:['/synthetic/import.json']});expect(await pending).toMatchObject({ok:false});
  expect(service.choose).not.toHaveBeenCalled();expect(service.disposeOwner).toHaveBeenCalledWith(4);
});
it('blocked duplicate calls cannot release the first request busy lease',async()=>{
  let resolve!:(v:unknown)=>void;native.open.mockReturnValue(new Promise(r=>resolve=r));const e=event();
  const pending=call('chooseImport',e);
  expect(await call('commit',e,'opaque')).toMatchObject({ok:false,code:'BUSY'});
  expect(await call('commit',e,'opaque')).toMatchObject({ok:false,code:'BUSY'});
  expect(service.commit).not.toHaveBeenCalled();resolve({canceled:true});await pending;
  await call('commit',e,'opaque');expect(service.commit).toHaveBeenCalledWith(4,'opaque');
});
it('explicit cancellation invalidates a pending picker without waiting for its busy lease',async()=>{
  let resolve!:(v:unknown)=>void;native.open.mockReturnValue(new Promise(r=>resolve=r));const e=event();
  const pending=call('chooseImport',e);
  expect(await call('dispose',e)).toMatchObject({ok:true});
  expect(service.disposeOwner).toHaveBeenCalledWith(4);
  resolve({filePaths:['/synthetic/import.json']});expect(await pending).toMatchObject({ok:false});
  expect(service.choose).not.toHaveBeenCalled();
});
it('does not return raw filesystem, key store or native exceptions over IPC',async()=>{
  service.commit.mockImplementation(()=>{throw Error('PRIVATE_KEY_PATH_SENTINEL');});
  expect(JSON.stringify(await call('commit',event(),'opaque'))).not.toContain('PRIVATE_KEY_PATH_SENTINEL');
});
it('destruction disposes plaintext preview ownership',async()=>{
  await call('commit',event(),'opaque');const e=event(5);await call('commit',e,'opaque');e.sender.emit('destroyed');
  expect(service.disposeOwner).toHaveBeenCalledWith(5);
});
