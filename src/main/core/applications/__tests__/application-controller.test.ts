import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { ApplicationError } from '@shared/applications';
import { z } from 'zod';
import { PtyAccess } from '../../../pty-access';
import { createApplicationController } from '../controller';
import type { ApplicationService } from '../application-service';
let handlers:Map<string,(...args:any[])=>any>,sender:IpcMainInvokeEvent,access:PtyAccess,service:ReturnType<typeof fakeService>;
function fakeService(){return{catalog:vi.fn(()=>[{appId:'mail',added:false}]),setAdded:vi.fn(),setEnabled:vi.fn(),projectSettings:vi.fn(),select:vi.fn(),listConnections:vi.fn(),testConnection:vi.fn(),saveConnection:vi.fn(),setConnectionEnabled:vi.fn(),disconnect:vi.fn(),viewDrafts:vi.fn(),viewDraft:vi.fn(),readBusinessResource:vi.fn()};}
const event=(id:number)=>{const wc=Object.assign(new EventEmitter(),{id,mainFrame:{},isDestroyed:()=>false});return{sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;};
function register(current:ApplicationService|undefined){handlers=new Map();registerRPCRouter({applications:createApplicationController(current,e=>access.requireSender(e))},{handle:(name:string,handler:(...args:any[])=>any)=>handlers.set(name,handler)} as never);}
const invoke=(name:string,e=sender,...args:unknown[])=>handlers.get('applications.'+name)!(e,...args);
beforeEach(()=>{sender=event(81);access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});service=fakeService();register(service as unknown as ApplicationService);});
describe('main-renderer application RPC authority and safe replies',()=>{
 it('passes the actual Electron sender to a trusted read and wraps the result',async()=>{expect(await invoke('catalog')).toEqual({ok:true,value:[{appId:'mail',added:false}]});expect(service.catalog).toHaveBeenCalledWith(sender);});
 it('rejects file-viewer windows,subframes and destroyed senders before any service or candidate parsing',async()=>{
  const dead=event(81);dead.sender.isDestroyed=()=>true;for(const e of [event(82),{...sender,senderFrame:{} as IpcMainInvokeEvent['senderFrame']},dead]){
   expect(await invoke('catalog',e)).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(await invoke('testConnection',e,{config:null,secret:'not-to-be-parsed'})).toMatchObject({ok:false,code:'SCOPE_DENIED'});
  }expect(service.catalog).not.toHaveBeenCalled();expect(service.testConnection).not.toHaveBeenCalled();
 });
 it('preserves controlled error codes and hides raw synchronous or asynchronous provider,SQLite and filesystem errors',async()=>{
  service.catalog.mockImplementationOnce(()=>{throw new Error('private-token /private/source/account.sqlite');});expect(JSON.stringify(await invoke('catalog'))).not.toContain('private-token');
  service.viewDraft.mockRejectedValueOnce(new Error('SMTP-secret-canary'));expect(await invoke('draft',sender,'p1','draft')).toEqual({ok:false,code:'CAPABILITY_UNAVAILABLE',message:'本次应用操作未完成，请重新载入后核对状态'});
  service.catalog.mockImplementationOnce(()=>z.array(z.never()).parse([{secret:'must-not-echo'}]));expect(await invoke('catalog')).toEqual({ok:false,code:'INVALID_INPUT',message:'应用操作字段无效，请核对表单后重试'});
  service.setAdded.mockRejectedValueOnce(new ApplicationError('REVISION_CONFLICT','应用状态已变化，请重新载入'));expect(await invoke('setAdded',sender,'mail',true,0)).toEqual({ok:false,code:'REVISION_CONFLICT',message:'应用状态已变化，请重新载入'});
 });
 it('exposes explicit business endpoints without a generic SQL,secret,scope or send-approval method',()=>{
  expect([...handlers.keys()].sort()).toEqual(['catalog','setAdded','setEnabled','projectSettings','select','connections','testConnection','saveConnection','setConnectionEnabled','disconnect','drafts','draft','resource'].map(n=>'applications.'+n).sort());
 });
 it('checks sender authority even when the optional service is unavailable',async()=>{
  register(undefined);expect(await invoke('catalog',event(82))).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(await invoke('catalog')).toMatchObject({ok:false,code:'CAPABILITY_UNAVAILABLE'});
 });
});
