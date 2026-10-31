import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {ApplicationError} from '@shared/applications';
import {MaintenanceWaits,type MaintenanceWaitOwner,type CleanupWaitControl} from '../maintenance-waits';

function owner(id:number){const events=new EventEmitter();let destroyed=false;const value:MaintenanceWaitOwner={id,isDestroyed:()=>destroyed,once:(event,listener)=>events.once(event,listener),removeListener:(event,listener)=>events.removeListener(event,listener)};return{value,destroy:()=>{destroyed=true;events.emit('destroyed');},listeners:()=>events.listenerCount('destroyed')};}
const untilCanceled=(control:CleanupWaitControl)=>new Promise<never>((_,reject)=>{const stop=()=>reject(new ApplicationError('CANCELED','已取消本次等待'));if(control.signal.aborted)stop();else control.signal.addEventListener('abort',stop,{once:true});});
it('cancels only the original window request, supports repeated cancel, and removes completed identities',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),b=owner(2),token=randomUUID(),pending=waits.run(a.value,token,untilCanceled);
 expect(()=>waits.cancel(b.value,token)).toThrow(expect.objectContaining({code:'SCOPE_DENIED'}));expect(waits.cancel(a.value,randomUUID())).toEqual({canceled:false});
 expect(waits.cancel(a.value,token)).toEqual({canceled:true});expect(waits.cancel(a.value,token)).toEqual({canceled:true});await expect(pending).rejects.toMatchObject({code:'CANCELED'});expect(waits.cancel(a.value,token)).toEqual({canceled:false});expect(a.listeners()).toBe(0);await waits.dispose();
});
it('keeps separate requests alive and refuses a duplicate pending identity',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),first=randomUUID(),second=randomUUID(),p1=waits.run(a.value,first,untilCanceled);let signal!:AbortSignal;
 const p2=waits.run(a.value,second,control=>{signal=control.signal;return untilCanceled(control);});await expect(waits.run(a.value,first,async()=>undefined)).rejects.toMatchObject({code:'RESOURCE_BUSY'});
 waits.cancel(a.value,first);await expect(p1).rejects.toMatchObject({code:'CANCELED'});expect(signal.aborted).toBe(false);const checked=expect(p2).rejects.toMatchObject({code:'CANCELED'});await waits.dispose();await checked;expect(a.listeners()).toBe(0);
});
it('cannot cancel or abort work after the final coordinator has entered its action',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),token=randomUUID();let finish!:(value:string)=>void,signal!:AbortSignal;
 const pending=waits.run(a.value,token,control=>{signal=control.signal;control.onExecuting();return new Promise<string>(done=>{finish=done;});});expect(waits.cancel(a.value,token)).toEqual({canceled:false});a.destroy();const closing=waits.dispose();expect(signal.aborted).toBe(false);finish('original-result');await expect(pending).resolves.toBe('original-result');await closing;expect(a.listeners()).toBe(0);
});
it('aborts pending ownership on window destruction and rejects new work after disposal',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),token=randomUUID(),pending=waits.run(a.value,token,untilCanceled);a.destroy();await expect(pending).rejects.toMatchObject({code:'CANCELED'});await waits.dispose();await expect(waits.run(owner(2).value,randomUUID(),async()=>undefined)).rejects.toMatchObject({code:'CANCELED'});
});
it('uses a shared finite budget and never enters an action after cancellation',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),token=randomUUID(),clock=vi.spyOn(performance,'now');let time=100;clock.mockImplementation(()=>time);
 try{
  const pending=waits.run(a.value,token,async control=>{expect(control.lockOptions().timeoutMs).toBe(15000);time+=4000;expect(control.lockOptions().timeoutMs).toBe(11000);time+=11001;expect(()=>control.lockOptions()).toThrow(expect.objectContaining({code:'RESOURCE_BUSY'}));waits.cancel(a.value,token);expect(()=>control.onExecuting()).toThrow(expect.objectContaining({code:'CANCELED'}));});await pending;expect(a.listeners()).toBe(0);
 }finally{clock.mockRestore();await waits.dispose();}
});

it('reports only actual waiting and final coordinated execution, retaining the original result',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),token=randomUUID(),notify=vi.fn();let enter!:()=>void,finish!:(v:string)=>void;
 const pending=waits.run(a.value,token,control=>{enter=()=>control.onExecuting();return new Promise<string>(done=>{finish=done;});},notify);
 expect(notify.mock.calls).toEqual([['waiting']]);enter();enter();expect(notify.mock.calls).toEqual([['waiting'],['executing']]);expect(waits.cancel(a.value,token)).toEqual({canceled:false});finish('actual-result');await expect(pending).resolves.toBe('actual-result');expect(notify).toHaveBeenCalledTimes(2);await waits.dispose();
});
it('does not let a destroyed progress target or notification exception change cleanup semantics',async()=>{
 const waits=new MaintenanceWaits(),a=owner(1),token=randomUUID(),notify=vi.fn(()=>{throw Error('Window delivery failed');});
 await expect(waits.run(a.value,token,async control=>{control.onExecuting();return 7;},notify)).resolves.toBe(7);expect(notify).toHaveBeenCalledTimes(2);expect(a.listeners()).toBe(0);await waits.dispose();
});
