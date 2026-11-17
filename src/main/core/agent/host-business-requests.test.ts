import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { HostBusinessRequests, type BusinessHandler } from './host-business-requests';
import { evaluateCapabilities } from './capabilities';
import type { RunHandle } from './agent-run-service';
const clean: (() => void)[]=[];afterEach(()=>clean.splice(0).forEach(f=>f()));
function fixture(needsRun=false, executionMs?:number) {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');runBundledMigrations(db);const store=new AgentStore(db);
  const taskId=store.createTask({projectId:null,dirId:null,cwd:'/fixture',title:'Business',selection:{driverId:'codex-app-server',profileId:'p',tier:'ask'}});
  const bindingId=store.createBinding({task_id:taskId,driver_id:'codex-app-server',profile_id:'p',continuation_hash:'a'.repeat(64),state_root:'/fixture/state',cwd_identity:'/fixture'});
  let generation=0,current:RunHandle|undefined,owner=false,executions=0,account='first';const notices:{text:string;wake:boolean}[]=[];
  const open=()=>{const runId=randomUUID();store.insertRun({runId,taskId,bindingId,generation:++generation,projectId:null,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});store.attachRunProcess(runId,taskId,12345,'fixture');current={taskId,bindingId,runId,generation,driverId:'codex-app-server',tier:'ask',version:'0.169.0',capabilities:evaluateCapabilities('codex-app-server','0.169.0').capabilities};owner=true;return current;};
  const origin=open(),deps={executionMs,store,run:()=>current,hasOwner:()=>owner,notify:(_t:string,_id:string,text:string,wake:boolean)=>{notices.push({text,wake});}};
  const service=new HostBusinessRequests(deps),handler:BusinessHandler={needsRun,validate:async r=>{if(r.row.account_identity!==account)throw Error('account changed');},execute:async()=>{executions++;return{ok:true};}};service.register('test',handler);
  const create=()=>service.create(origin,{operationId:randomUUID(),kind:'test',title:'Test operation',review:{to:'fixed'},data:{immutable:true},accountIdentity:account});
  clean.push(()=>{service.close();db.close();});
  return {db,store,taskId,bindingId,service,handler,deps,origin,create,notices,open,executions:()=>executions,end:()=>{store.finishRun(origin.runId,taskId,'stopped',null);current=undefined;owner=false;},setAccount:(s:string)=>{account=s;}};
}
it('E12: waiting has no expiry, survives native exit/switch and restart, then executes once with current task authority',async()=>{
 const f=fixture(),r=f.create();f.db.prepare("UPDATE agent_requests SET created_at='2020-01-01T00:00:00Z'").run();f.end();
 const restarted=new HostBusinessRequests(f.deps);restarted.register('test',f.handler);clean.unshift(()=>restarted.close());
 expect(await restarted.respond(f.taskId,r.requestId,1,{choice:'allow'})).toMatchObject({state:'finished'});expect(f.executions()).toBe(1);
 await expect(restarted.respond(f.taskId,r.requestId,1,{choice:'allow'})).rejects.toThrow('已更新');expect(f.executions()).toBe(1);
 expect(f.notices[0].text).toContain('不是新的真人授权');
});
it('E12: no owner approval is persistent pending-bind, never an early usable grant; a later registered run binds once',async()=>{
 const f=fixture(true),r=f.create();f.end();expect(await f.service.respond(f.taskId,r.requestId,1,{choice:'allow'})).toEqual({state:'approved_pending_bind'});expect(f.executions()).toBe(0);
 expect(f.db.prepare('SELECT status,bound_run_id FROM agent_requests WHERE request_id=?').get(r.requestId)).toEqual({status:'approved_pending_bind',bound_run_id:null});expect(f.notices[0].text).toContain('尚无可用权限');
 const restarted=new HostBusinessRequests(f.deps);restarted.register('test',f.handler);clean.unshift(()=>restarted.close());const run=f.open();await restarted.bindPending(f.taskId,run);await restarted.bindPending(f.taskId,run);
 expect(f.executions()).toBe(1);expect(f.db.prepare('SELECT bound_run_id FROM agent_requests WHERE request_id=?').get(r.requestId)).toEqual({bound_run_id:run.runId});
});
it('E12: stopping/revoking before bind prevents the successor from receiving authority',async()=>{
 const f=fixture(true),r=f.create();f.end();await f.service.respond(f.taskId,r.requestId,1,{choice:'allow'});f.service.stop(f.taskId);await f.service.bindPending(f.taskId,f.open());expect(f.executions()).toBe(0);expect(f.store.request(r.requestId)?.status).toBe('retired');
});
it('E12: changed account/content fails the late approval and cannot replace the stored original review',async()=>{
 const f=fixture(),r=f.create();f.setAccount('second');await expect(f.service.respond(f.taskId,r.requestId,1,{choice:'allow'})).rejects.toThrow('account changed');expect(f.executions()).toBe(0);
 f.db.prepare('UPDATE agent_requests SET payload_ref=? WHERE request_id=?').run(JSON.stringify({businessKind:'test',review:{to:'different'},phase:'waiting_user'}),r.requestId);
 await expect(f.service.respond(f.taskId,r.requestId,1,{choice:'allow'})).rejects.toThrow('已损坏');
});
it('E12: interrupted execution is recorded unknown after restart and never automatically replayed',async()=>{
 const f=fixture(),r=f.create(),row=f.store.request(r.requestId)!,p=JSON.parse(row.payload_ref);f.db.prepare('UPDATE agent_requests SET payload_ref=? WHERE request_id=?').run(JSON.stringify({...p,phase:'executing'}),r.requestId);
 const restarted=new HostBusinessRequests(f.deps);restarted.register('test',f.handler);clean.unshift(()=>restarted.close());expect(f.store.request(r.requestId)?.status).toBe('resolved');expect(f.executions()).toBe(0);expect(f.store.items(f.taskId).find(i=>i.type==='notification')?.payload.status).toBe('unknown');
});

it('E12: execution budget starts on approval, an expired FIFO wait never executes or retains its reservation',async()=>{
 const f=fixture(false,30),r=f.create();let released=0;
 (f.deps as any).acquire=async(_task:string,_id:string,signal:AbortSignal)=>{await new Promise(resolve=>setTimeout(resolve,60));expect(signal.aborted).toBe(true);return()=>{released++;};};
 await expect(f.service.respond(f.taskId,r.requestId,1,{choice:'allow'})).rejects.toThrow('执行时限');expect(f.executions()).toBe(0);expect(released).toBe(1);expect(f.store.request(r.requestId)?.status).toBe('retired');
});
it('E12: a run ending during the FIFO wait produces pending-bind rather than a grant on its stale identity',async()=>{
 const f=fixture(true),r=f.create();(f.deps as any).acquire=async()=>{f.end();return()=>{};};
 expect(await f.service.respond(f.taskId,r.requestId,1,{choice:'allow'})).toMatchObject({state:'approved_pending_bind'});expect(f.executions()).toBe(0);expect((f.db.prepare('SELECT bound_run_id FROM agent_requests WHERE request_id=?').get(r.requestId) as {bound_run_id:string|null}).bound_run_id).toBeNull();
 (f.deps as any).acquire=async()=>()=>{};const successor=f.open();await f.service.bindPending(f.taskId,successor);expect(f.executions()).toBe(1);expect((f.db.prepare('SELECT bound_run_id FROM agent_requests WHERE request_id=?').get(r.requestId) as {bound_run_id:string|null}).bound_run_id).toBe(successor.runId);
});
it('E12: cancellation cannot release a business lease while its executor still has an external effect in flight',async()=>{
 const f=fixture(),r=f.create();let settled!:()=>void,entered!:()=>void,leases=0;const began=new Promise<void>(resolve=>entered=resolve);
 (f.deps as any).acquire=async()=>{leases++;return()=>{leases--;};};f.handler.execute=async()=>{entered();await new Promise<void>(resolve=>settled=resolve);return {ok:true};};
 const work=f.service.respond(f.taskId,r.requestId,1,{choice:'allow'});await began;f.service.stop(f.taskId);expect(leases).toBe(1);expect(f.service.busy(f.taskId)).toBe(true);settled();expect(await work).toMatchObject({state:'unknown'});expect(leases).toBe(0);expect(f.store.request(r.requestId)?.status).toBe('retired');
});
