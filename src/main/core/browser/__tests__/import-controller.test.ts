import {describe,expect,it,vi} from 'vitest';
import type {IpcMain,IpcMainInvokeEvent} from 'electron';
import {createBrowserController} from '../controller';
import type {BrowserService} from '../service';
import {registerRPCRouter} from '@shared/ipc/rpc';
function fixture(){
  const calls=new Map<string,(event:IpcMainInvokeEvent,input:unknown)=>unknown>(),service={importCookies:vi.fn(),clearCookies:vi.fn(),recoverCookies:vi.fn(),importCookieSources:vi.fn(),createProfile:vi.fn(),cloneProfile:vi.fn(),useProfile:vi.fn(),deleteProfile:vi.fn(),accessState:vi.fn(),respondAccess:vi.fn(),revokeAccess:vi.fn(),pauseFromUi:vi.fn()} as unknown as BrowserService,frame={},sender={isDestroyed:()=>false,mainFrame:frame},event={sender,senderFrame:frame} as unknown as IpcMainInvokeEvent;
  const controller=createBrowserController(service,event=>event.sender===sender);registerRPCRouter({browser:controller},{handle:(channel:string,fn:(event:IpcMainInvokeEvent,input:unknown)=>unknown)=>{calls.set(channel,fn);}} as unknown as IpcMain);
  return{service,controller,event,call:(name:string,input:unknown,e=event)=>calls.get('browser.'+name)!(e,input)};
}
describe('Cookie import IPC authority (software)',()=>{
  const input={taskId:'11111111-1111-4111-8111-111111111111',profileId:'project-'+ 'a'.repeat(24),sourceId:'b'.repeat(64),confirmed:true};
  it('refuses direct calls, untrusted renderers and even a trusted window subframe',()=>{
    const f=fixture();expect(()=>f.controller.importCookies({...input,confirmed:true})).toThrow('IPC sender');
    expect(()=>f.call('importCookies',input,{...f.event,senderFrame:{}} as IpcMainInvokeEvent)).toThrow('可信主窗口');expect(()=>f.call('importCookies',input,{...f.event,sender:{isDestroyed:()=>false,mainFrame:{}}} as IpcMainInvokeEvent)).toThrow('可信主窗口');expect(f.service.importCookies).not.toHaveBeenCalled();
  });
  it('requires explicit risk/clear confirmation and never accepts raw partition/path arguments',()=>{
    const f=fixture();for(const bad of [{...input,confirmed:false},{...input,confirmed:undefined},{...input,partition:'persist:foreign'},{...input,path:'/private/source'}])expect(()=>f.call('importCookies',bad)).toThrow();expect(()=>f.call('clearCookies',{taskId:input.taskId,profileId:input.profileId})).toThrow();expect(f.service.importCookies).not.toHaveBeenCalled();expect(f.service.clearCookies).not.toHaveBeenCalled();
  });
  it('forwards only the trusted task/profile and opaque selected source identity after confirmation',()=>{
    const f=fixture();f.call('importCookies',input);expect(f.service.importCookies).toHaveBeenCalledExactlyOnceWith(input.taskId,input.profileId,input.sourceId);f.call('clearCookies',{taskId:input.taskId,profileId:input.profileId,confirmed:true});expect(f.service.clearCookies).toHaveBeenCalledExactlyOnceWith(input.taskId,input.profileId);
  });
});
it('accepts grant decisions and pause only from the trusted main frame with strict user-action payloads',()=>{
  const f=fixture(),id='11111111-1111-4111-8111-111111111111';
  for(const name of['accessState','respondAccess','revokeAccess','pause'])expect(()=>f.call(name,{id,allow:true,taskId:id,paused:true},{...f.event,senderFrame:{}} as IpcMainInvokeEvent)).toThrow('可信主窗口');
  for(const input of[{id,allow:true,runId:'forged'},{id,allow:true,mode:'all'},{id,allow:'true'}])expect(()=>f.call('respondAccess',input)).toThrow();expect(()=>f.call('pause',{taskId:id,paused:true,runId:'forged'})).toThrow();
  f.call('respondAccess',{id,allow:true,mode:'observe'});expect(f.service.respondAccess).toHaveBeenCalledExactlyOnceWith(id,true,'observe');f.call('revokeAccess',{id});expect(f.service.revokeAccess).toHaveBeenCalledExactlyOnceWith(id);f.call('pause',{taskId:id,paused:true});expect(f.service.pauseFromUi).toHaveBeenCalledExactlyOnceWith(id,true);
});
it('gates profile mutations on trusted main-frame IPC, explicit delete confirmation and strict public identities',()=>{
  const f=fixture(),taskId='11111111-1111-4111-8111-111111111111',profileId='project-'+ 'a'.repeat(24),input={taskId,profileId};
  for(const name of['cloneProfile','deleteProfile'])expect(()=>f.call(name,{...input,confirmed:true},{...f.event,senderFrame:{}} as IpcMainInvokeEvent)).toThrow('可信主窗口');
  for(const bad of[{...input},{...input,confirmed:false},{...input,confirmed:true,partition:'persist:foreign'}])expect(()=>f.call('deleteProfile',bad)).toThrow();expect(f.service.deleteProfile).not.toHaveBeenCalled();
  expect(()=>f.call('createProfile',{taskId,label:' '.repeat(3)})).toThrow();expect(()=>f.call('cloneProfile',{...input,path:'/foreign'})).toThrow();f.call('deleteProfile',{...input,confirmed:true});expect(f.service.deleteProfile).toHaveBeenCalledExactlyOnceWith(taskId,profileId);
});
