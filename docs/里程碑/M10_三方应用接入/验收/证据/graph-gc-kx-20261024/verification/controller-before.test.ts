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
function fakeService(){return{impact:vi.fn(),bindTerminal:vi.fn(),insertTerminal:vi.fn(),releaseTerminal:vi.fn(),diagnoseSession:vi.fn(),listVersions:vi.fn(),cleanupVersion:vi.fn(),listActivity:vi.fn(),activityDetail:vi.fn(),prepareSend:vi.fn(),executeSend:vi.fn(),mailStatus:vi.fn(),viewSend:vi.fn(),reviewSend:vi.fn(),authorizeSend:vi.fn(),cancelSend:vi.fn(),captureAttachment:vi.fn(),replyDraft:vi.fn(),importAttachment:vi.fn(),mailQuery:vi.fn(),mailMessage:vi.fn(),mailResource:vi.fn(),mailCacheStatus:vi.fn(),clearMailCache:vi.fn(),catalog:vi.fn(()=>[{appId:'mail',added:false}]),setAdded:vi.fn(),setEnabled:vi.fn(),projectSettings:vi.fn(),select:vi.fn(),listConnections:vi.fn(),testConnection:vi.fn(),discardConnectionTest:vi.fn(),saveConnection:vi.fn(),setConnectionEnabled:vi.fn(),disconnect:vi.fn(),viewDrafts:vi.fn(),viewDraft:vi.fn(),readBusinessResource:vi.fn()};}
const event=(id:number)=>{const wc=Object.assign(new EventEmitter(),{id,mainFrame:{},isDestroyed:()=>false});return{sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;};
function register(current:ApplicationService|undefined){handlers=new Map();registerRPCRouter({applications:createApplicationController(current,e=>access.requireSender(e))},{handle:(name:string,handler:(...args:any[])=>any)=>handlers.set(name,handler)} as never);}
const invoke=(name:string,e=sender,...args:unknown[])=>handlers.get('applications.'+name)!(e,...args);
beforeEach(()=>{sender=event(81);access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});service=fakeService();register(service as unknown as ApplicationService);});
describe('main-renderer application RPC authority and safe replies',()=>{
 it('gates read-only impact before parsing renderer scope',async()=>{for(const e of [event(82),{...sender,senderFrame:{} as IpcMainInvokeEvent['senderFrame']}])expect(await invoke('impact',e,{sql:'never parse'})).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service.impact).not.toHaveBeenCalled();const query={kind:'remove',appId:'mail',expectedRevision:0};service.impact.mockReturnValueOnce({projects:[]});expect(await invoke('impact',sender,query)).toEqual({ok:true,value:{projects:[]}});expect(service.impact).toHaveBeenCalledWith(sender,query);});
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
 it('exposes explicit business endpoints without generic SQL,secret,scope or caller-supplied approval flags',()=>{
  expect([...handlers.keys()].sort()).toEqual(['impact','terminalBind','terminalInsert','terminalRelease','session','versions','cleanupVersion','activity','activityDetail','prepareSend','executeSend','send','reviewSend','authorizeSend','cancelSend','catalog','setAdded','setEnabled','projectSettings','select','connections','testConnection','discardConnectionTest','saveConnection','setConnectionEnabled','disconnect','drafts','draft','resource','captureAttachment','replyDraft','importAttachment','mailQuery','mailStatus','mailRead','mailResource','mailCacheStatus','clearMailCache','zentaoWork','zentaoObject','zentaoResource'].map(n=>'applications.'+n).sort());
 });
 it('keeps cache inspection and reclamation as explicit main-frame-only management endpoints',async()=>{
  service.mailCacheStatus.mockResolvedValueOnce({limit:500000000});service.clearMailCache.mockResolvedValueOnce({activeLeases:1});
  expect(await invoke('mailCacheStatus')).toEqual({ok:true,value:{limit:500000000}});expect(service.mailCacheStatus).toHaveBeenCalledWith(sender);
  expect(await invoke('clearMailCache',event(82))).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service.clearMailCache).not.toHaveBeenCalled();
  expect(await invoke('clearMailCache')).toEqual({ok:true,value:{activeLeases:1}});expect(service.clearMailCache).toHaveBeenCalledWith(sender);
 });
 it('routes mail reads through the actual trusted sender and denies alternate windows before business execution',async()=>{
  for(const [name,method,args] of [['mailQuery','mailQuery',['p1',{}]],['mailStatus','mailStatus',['p1',{}]],['mailRead','mailMessage',['p1',{nativeId:'1'}]],['mailResource','mailResource',['p1',{resource:{}}]]] as const){
   expect(await invoke(name,event(82),...args)).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service[method]).not.toHaveBeenCalled();service[method].mockResolvedValueOnce({complete:true});expect(await invoke(name,sender,...args)).toEqual({ok:true,value:{complete:true}});expect(service[method]).toHaveBeenCalledWith(sender,...args);
  }
 });
 it('protects reply,resource import and workspace capture with actual main-frame authority',async()=>{
  for(const name of ['captureAttachment','replyDraft','importAttachment'] as const){expect(await invoke(name,event(82),'p1',{})).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service[name]).not.toHaveBeenCalled();service[name].mockResolvedValueOnce({saved:true});expect(await invoke(name,sender,'p1',{})).toEqual({ok:true,value:{saved:true}});expect(service[name]).toHaveBeenCalledWith(sender,'p1',{});}
 });
 it('binds sending review,confirmation and cancellation to the actual main frame',async()=>{
  for(const [name,method] of [['prepareSend','prepareSend'],['executeSend','executeSend'],['send','viewSend'],['reviewSend','reviewSend'],['authorizeSend','authorizeSend'],['cancelSend','cancelSend']] as const){
   expect(await invoke(name,event(82),'p1',{})).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service[method]).not.toHaveBeenCalled();service[method].mockResolvedValueOnce({state:'awaiting-authorization'});expect(await invoke(name,sender,'p1',{})).toEqual({ok:true,value:{state:'awaiting-authorization'}});expect(service[method]).toHaveBeenCalledWith(sender,'p1',{});
  }
 });
 it('keeps history metadata and frozen results behind the main-frame gate without enabling an app',async()=>{
  for(const[name,method]of[['activity','listActivity'],['activityDetail','activityDetail']] as const){expect(await invoke(name,event(82),{})).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service[method]).not.toHaveBeenCalled();service[method].mockReturnValueOnce({items:[]});expect(await invoke(name,sender,{})).toMatchObject({ok:true,value:{items:[]}});expect(service[method]).toHaveBeenCalledWith(sender,{},...(name==='activityDetail'?[undefined]:[]));}
 });
 it('protects all terminal reference entrypoints with the actual main frame before source parsing',async()=>{for(const [name,method,arg] of [['terminalBind','bindTerminal',{}],['terminalInsert','insertTerminal',{}],['terminalRelease','releaseTerminal','id']] as const){expect(await invoke(name,event(82),arg)).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service[method]).not.toHaveBeenCalled();service[method].mockResolvedValueOnce({checked:true});expect(await invoke(name,sender,arg)).toEqual({ok:true,value:{checked:true}});expect(service[method]).toHaveBeenCalledWith(sender,arg);}});
 it('allows read-only session diagnostics only from the real main frame',async()=>{expect(await invoke('session',event(82),'t1')).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service.diagnoseSession).not.toHaveBeenCalled();service.diagnoseSession.mockResolvedValueOnce({selection:'unknown-history'});expect(await invoke('session',sender,'t1')).toEqual({ok:true,value:{selection:'unknown-history'}});expect(service.diagnoseSession).toHaveBeenCalledWith(sender,'t1');});
 it('gates version inspection and cleanup before parsing any renderer plan',async()=>{
  for(const[name,method]of[['versions','listVersions'],['cleanupVersion','cleanupVersion']] as const){expect(await invoke(name,event(82),{sql:'invalid'})).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(service[method]).not.toHaveBeenCalled();service[method].mockResolvedValueOnce({items:[]});expect(await invoke(name,sender,'mail')).toMatchObject({ok:true,value:{items:[]}});expect(service[method]).toHaveBeenCalledWith(sender,'mail');}
 });
 it('checks sender authority even when the optional service is unavailable',async()=>{
  register(undefined);expect(await invoke('catalog',event(82))).toMatchObject({ok:false,code:'SCOPE_DENIED'});expect(await invoke('catalog')).toMatchObject({ok:false,code:'CAPABILITY_UNAVAILABLE'});
 });
});
