import {afterEach,expect,it,vi} from 'vitest';
import {BrowserAccess,type BrowserAccessAudit} from '../access';

const fixtures:BrowserAccess[]=[];
afterEach(()=>{for(const f of fixtures.splice(0))f.dispose();vi.useRealTimers();vi.restoreAllMocks();});
function fixture(){
  const projects=new Map([['T1','P1'],['T2','P1'],['T3','P2']]),events:BrowserAccessAudit[]=[],changed=vi.fn(),audit=vi.fn((e:BrowserAccessAudit)=>{events.push(e)}),access=new BrowserAccess({taskProject:id=>projects.get(id)??null,changed,audit}),run=new AbortController(),command=new AbortController(),binding={runId:'run1',taskId:'T1',projectId:'P1',signal:run.signal};fixtures.push(access);access.track(binding);return{access,run,command,binding,projects,events,audit,changed};
}
it('allows own task without a grant and offers a same-project request before any grant exists',async()=>{
  const f=fixture();expect(f.access.can('run1','T1','write')).toBe(true);expect(f.access.can('run1','T2','read')).toBe(false);
  const pending=f.access.request(f.binding,'T2','observe',f.command.signal),request=f.access.snapshot().requests[0];expect(request).toMatchObject({runId:'run1',requesterTaskId:'T1',targetTaskId:'T2',mode:'observe'});expect(request.expiresAt-request.createdAt).toBeGreaterThanOrEqual(60000);f.access.respond(request.id,true);const grant=await pending;expect(grant).not.toHaveProperty('expiresAt');expect(f.access.snapshot().requests).toEqual([]);expect(f.access.can('run1','T2','read')).toBe(true);expect(f.access.can('run1','T2','write')).toBe(false);
});
it('denies cross-project, absent, self and forged-run requests without presenting a prompt',()=>{
  const f=fixture();for(const target of['T3','missing','T1'])expect(()=>f.access.request(f.binding,target,'control',f.command.signal)).toThrow();expect(()=>f.access.track({...f.binding,taskId:'T2'})).toThrow();expect(()=>f.access.track({...f.binding,signal:new AbortController().signal})).toThrow();expect(f.access.snapshot()).toEqual({requests:[],grants:[]});expect(f.events).toEqual([]);
});
it('requires fresh control for writes, then revocation makes queued admission fail without changing own-task authority',async()=>{
  const f=fixture(),pending=f.access.request(f.binding,'T2','control',f.command.signal),request=f.access.snapshot().requests[0];f.access.respond(request.id,true);await pending;const queuedAdmission=()=>f.access.require('run1','T2','write');expect(queuedAdmission).not.toThrow();f.access.revoke(request.id);expect(queuedAdmission).toThrow();expect(f.access.can('run1','T1','write')).toBe(true);expect(f.events.at(-1)).toMatchObject({result:'revoked',source:'user',request:{id:request.id}});
});
it('denial and exact60-second timeout settle once, never install a grant, and reject late clicks',async()=>{
  vi.useFakeTimers();const f=fixture();const denied=f.access.request(f.binding,'T2','observe',f.command.signal).catch(e=>e),first=f.access.snapshot().requests[0];f.access.respond(first.id,false);expect(await denied).toMatchObject({code:'SCOPE_DENIED'});expect(()=>f.access.respond(first.id,true)).toThrow();
  const timed=f.access.request(f.binding,'T2','control',f.command.signal).catch(e=>e),second=f.access.snapshot().requests[0];await vi.advanceTimersByTimeAsync(59999);expect(f.access.snapshot().requests).toHaveLength(1);await vi.advanceTimersByTimeAsync(1);expect(await timed).toMatchObject({code:'SCOPE_DENIED'});expect(f.access.snapshot().grants).toEqual([]);expect(f.events.at(-1)).toMatchObject({result:'denied',source:'timeout'});expect(()=>f.access.respond(second.id,true)).toThrow();expect(vi.getTimerCount()).toBe(0);
});
it('command cancellation removes only its prompt, and a run ending removes both grants and its remaining prompts',async()=>{
  const f=fixture(),allowed=f.access.request(f.binding,'T2','control',f.command.signal);f.access.respond(f.access.snapshot().requests[0].id,true);await allowed;
  const cancellation=new AbortController(),pending=f.access.request(f.binding,'T2','observe',cancellation.signal).catch(e=>e),id=f.access.snapshot().requests[0].id;cancellation.abort();expect(await pending).toMatchObject({code:'SCOPE_DENIED'});expect(f.access.can('run1','T2','write')).toBe(true);expect(()=>f.access.respond(id,true)).toThrow();
  const next=f.access.request(f.binding,'T2','observe',f.command.signal).catch(e=>e);f.run.abort();expect(await next).toMatchObject({code:'SCOPE_DENIED'});expect(f.access.snapshot()).toEqual({requests:[],grants:[]});expect(f.access.can('run1','T2','read')).toBe(false);
  const newRun={...f.binding,runId:'run2',signal:new AbortController().signal};f.access.track(newRun);expect(f.access.can('run2','T2','read')).toBe(false);
});
it('scope changes invalidate both pending requests and existing grants without persisting or reviving them',async()=>{
  const f=fixture(),allowed=f.access.request(f.binding,'T2','control',f.command.signal);f.access.respond(f.access.snapshot().requests[0].id,true);await allowed;f.projects.set('T2','P2');expect(f.access.can('run1','T2','read')).toBe(false);expect(f.access.snapshot().grants).toEqual([]);f.projects.set('T2','P1');expect(f.access.can('run1','T2','read')).toBe(false);
  const pending=f.access.request(f.binding,'T2','control',f.command.signal).catch(e=>e),id=f.access.snapshot().requests[0].id;f.projects.delete('T2');f.access.respond(id,true);expect(await pending).toMatchObject({code:'SCOPE_DENIED'});expect(f.access.snapshot()).toEqual({requests:[],grants:[]});
});
it('returns detached state copies, so mutating renderer snapshots cannot upgrade a grant',async()=>{
  const f=fixture(),pending=f.access.request(f.binding,'T2','observe',f.command.signal);const snapshot=f.access.snapshot();snapshot.requests[0].mode='control';f.access.respond(snapshot.requests[0].id,true);const grant=await pending;grant.mode='control';const read=f.access.snapshot();read.grants[0].mode='control';read.grants.length=0;expect(f.access.can('run1','T2','write')).toBe(false);expect(f.access.can('run1','T2','read')).toBe(true);
});
it('honors an explicit user mode choice while retaining the Agent requested mode in the audit',async()=>{
  const f=fixture(),control=f.access.request(f.binding,'T2','control',f.command.signal,'cli-request');f.access.respond(f.access.snapshot().requests[0].id,true,'observe');expect(await control).toMatchObject({mode:'observe',requestedMode:'control',requestId:'cli-request'});expect(f.access.can('run1','T2','write')).toBe(false);
  const observe=f.access.request(f.binding,'T2','observe',f.command.signal);f.access.respond(f.access.snapshot().requests[0].id,true,'control');expect(await observe).toMatchObject({mode:'control',requestedMode:'observe'});expect(f.access.can('run1','T2','write')).toBe(true);expect(f.events.some(event=>event.result==='allowed'&&event.request.mode==='control'&&event.request.requestedMode==='observe')).toBe(true);
});
it('fails closed when audit storage fails before presenting or before granting authority',async()=>{
  const f=fixture();vi.spyOn(console,'warn').mockImplementation(()=>{});f.audit.mockImplementationOnce(()=>{throw Error('storage unavailable')});expect(()=>f.access.request(f.binding,'T2','control',f.command.signal)).toThrow();expect(f.access.snapshot().requests).toEqual([]);
  const pending=f.access.request(f.binding,'T2','control',f.command.signal).catch(e=>e),id=f.access.snapshot().requests[0].id;f.audit.mockImplementationOnce(()=>{throw Error('write failed')});f.access.respond(id,true);expect(await pending).toMatchObject({code:'SCOPE_DENIED'});expect(f.access.snapshot().grants).toEqual([]);
});
it('rechecks run lifetime after a reentrant audit callback and tolerates a failed UI notification',async()=>{
  const f=fixture();vi.spyOn(console,'warn').mockImplementation(()=>{});f.changed.mockImplementation(()=>{throw Error('window closed')});const pending=f.access.request(f.binding,'T2','control',f.command.signal).catch(e=>e),id=f.access.snapshot().requests[0].id;f.audit.mockImplementationOnce(()=>{f.run.abort()});f.access.respond(id,true);expect(await pending).toMatchObject({code:'SCOPE_DENIED'});expect(f.access.snapshot()).toEqual({requests:[],grants:[]});
});
