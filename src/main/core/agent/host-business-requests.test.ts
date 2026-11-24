import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { runBundledMigrations } from '../../db/migrations';
import { AgentStore } from './agent-store';
import { HostBusinessRequests, type BusinessHandler } from './host-business-requests';
import { evaluateCapabilities } from './capabilities';
import type { RunHandle } from './agent-run-service';
import {DriverError} from './driver';
import type {ApplicationUiSender} from '../applications/execution-context';
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
it.each(['finished', 'unknown'] as const)('continues the original browser goal from a %s host result', async state => {
  const f = fixture();
  const originalRequestId = randomUUID();
  f.service.register('browser_write', {
    validate: async () => {},
    execute: async () => state === 'finished'
      ? { status: 'ok', value: 'raw synthetic page content' }
      : { status: 'error', error: { effectState: 'unknown', message: 'raw synthetic page content' } },
  });
  const approval = f.service.create(f.origin, {
    operationId: randomUUID(), kind: 'browser_write', title: '点击原网页', review: {},
    data: { requestId: originalRequestId },
  });
  expect(await f.service.respond(f.taskId,approval.requestId,1,{choice:'allow'})).toMatchObject({state});
  expect(f.notices).toHaveLength(1);
  expect(f.notices[0]).toMatchObject({ wake: true });
  expect(f.notices[0].text).toContain('不是新的真人授权');
  expect(f.notices[0].text).toContain('原任务目标');
  expect(f.notices[0].text).toContain(originalRequestId);
  expect(f.notices[0].text).not.toContain('raw synthetic page content');
  if (state === 'unknown') {
    expect(f.notices[0].text).toContain('只读检查原标签');
    expect(f.notices[0].text).toContain('请勿重发原操作');
  }
});
it('preserves an early login confirmation and only queues one authenticated continuation',async()=>{
  const f=fixture(true),wake=vi.fn(),browser={ready:false};
  Object.assign(f.deps,{wakeLogin:wake});
  let accepts=0;
  f.service.register('browser_login',{
    needsRun:true,
    validate:async()=>{},
    confirm:async()=>{if(!browser.ready)throw new DriverError('STATE','原业务页仍未就绪');},
    readiness:async()=>browser.ready?'ready':'loading',
    execute:async record=>{
      accepts++;
      f.store.acceptTurn({taskId:f.taskId,clientInputId:`browser-login-${record.row.request_id}-${record.row.revision}`,text:'续接',sourceKind:'system'});
      return{status:'verified'};
    },
  });
  const request=f.service.create(f.origin,{operationId:randomUUID(),kind:'browser_login',title:'登录',review:{},data:{pageId:'page'}});
  const confirm=()=>f.service.respond(f.taskId,request.requestId,1,{choice:'allow'},{} as ApplicationUiSender);
  await expect(f.service.respond(f.taskId,request.requestId,1,{choice:'allow'})).rejects.toThrow('原任务窗口');
  await expect(confirm()).rejects.toThrow('仍未就绪');
  expect(f.store.request(request.requestId)).toMatchObject({revision:1,status:'pending'});
  expect(f.service.browserPageAwaitingLogin(f.taskId,'page')).toBe(true);
  browser.ready=true;
  f.end();
  const raced=await Promise.allSettled([confirm(),confirm()]);
  expect(raced.filter(result=>result.status==='fulfilled')).toEqual([
    {status:'fulfilled',value:expect.objectContaining({state:'approved_pending_bind'})},
  ]);
  expect(raced.filter(result=>result.status==='rejected')).toHaveLength(1);
  expect(wake).toHaveBeenCalledWith(f.taskId);
  expect(f.store.queuedTurns(f.taskId)).toEqual([]);
  const rebound=f.open();
  browser.ready=false;
  await f.service.bindPending(f.taskId,rebound);
  expect(f.store.request(request.requestId)?.status).toBe('approved_pending_bind');
  browser.ready=true;
  f.service.browserChanged(f.taskId);
  await f.service.bindPending(f.taskId,rebound);
  await f.service.bindPending(f.taskId,rebound);
  expect(accepts).toBe(1);
  const turn=f.store.queuedTurns(f.taskId)[0];
  expect(turn.source_kind).toBe('system');
  expect(f.notices).toEqual([]);
  f.service.stop(f.taskId);
  expect(f.store.turn(turn.turn_id)?.status).toBe('canceled');
});
it.each(['pending', 'approved_pending_bind'])('retires a %s login request when its original tab identity is lost', async status => {
  const f = fixture(true);
  let originalTabExists = true;
  const assertSourceCurrent = () => {
    if (!originalTabExists) throw new Error('原标签或登录身份已变化');
  };
  const retire = vi.fn();
  const execute = vi.fn(async () => ({ status: 'verified' }));
  const loginHandler = { needsRun: true, assertSourceCurrent, validate: async () => assertSourceCurrent(), execute, retire };
  f.service.register('browser_login', loginHandler);
  const request = f.service.create(f.origin, {
    operationId: randomUUID(), kind: 'browser_login', title: '登录', review: {}, data: { pageId: 'original' },
  });
  const confirm = (revision: number) => f.service.respond(f.taskId, request.requestId, revision, { choice: 'allow' }, {} as ApplicationUiSender);
  if (status === 'approved_pending_bind') {
    f.end();
    expect(await confirm(1)).toMatchObject({ state: status });
  }
  const before = f.store.request(request.requestId)!;
  f.service.browserChanged(f.taskId);
  expect(f.store.request(request.requestId)).toMatchObject({ status, revision: before.revision });

  originalTabExists = false;
  f.service.browserChanged(f.taskId);
  f.service.browserChanged(f.taskId);
  expect(f.store.request(request.requestId)).toMatchObject({ status: 'retired', revision: before.revision + 1 });
  expect(retire).toHaveBeenCalledTimes(1);
  expect(f.service.browserPageAwaitingLogin(f.taskId, 'original')).toBe(false);
  await expect(confirm(before.revision)).rejects.toThrow('请求已更新');
  await f.service.bindPending(f.taskId, f.open());
  expect(execute).not.toHaveBeenCalled();
  expect(f.store.queuedTurns(f.taskId)).toEqual([]);
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

it('P3: a slot wait longer than 60 seconds does not consume the 60-second execution budget', async () => {
  const f = fixture(), request = f.create();
  const approvedAt = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(approvedAt);
  let released = false;
  (f.deps as any).acquire = async (_task: string, _id: string, signal: AbortSignal) => {
    clock.mockReturnValue(approvedAt + 61_000);
    expect(signal.aborted).toBe(false);
    return () => { released = true; };
  };
  const execute = f.handler.execute;
  const observed: number[] = [];
  f.handler.execute = async (record, decision, context) => {
    observed.push(context.deadline - Date.now());
    return execute(record, decision, context);
  };
  try {
    expect(await f.service.respond(f.taskId, request.requestId, 1, { choice: 'allow' })).toMatchObject({ state: 'finished' });
    expect(observed).toEqual([60_000]);
    expect(f.executions()).toBe(1);
    expect(released).toBe(true);
  } finally { clock.mockRestore(); }
});

it.each(['stop', 'revoke'])('P3: %s during admission cancels the approval before any effect', async action => {
  const f = fixture(), request = f.create();
  let signal!: AbortSignal;
  let waiting!: () => void;
  const entered = new Promise<void>(resolve => { waiting = resolve; });
  let admit!: () => void;
  let released = false;
  (f.deps as any).acquire = async (_task: string, _id: string, candidate: AbortSignal) => {
    signal = candidate;
    await new Promise<void>(resolve => { admit = resolve; waiting(); });
    return () => { released = true; };
  };
  const originalApproval = f.service.respond(f.taskId, request.requestId, 1, { choice: 'allow' });
  const settled = originalApproval.catch(error => error);
  await entered;
  try {
    if (action === 'stop') f.service.stop(f.taskId);
    else {
      const current = f.store.request(request.requestId)!;
      expect(await f.service.respond(f.taskId, request.requestId, current.revision, { choice: 'cancel' })).toMatchObject({ state: 'retired' });
    }
    expect(signal.aborted).toBe(true);
  } finally { admit(); await settled; }
  expect(f.executions()).toBe(0);
  expect(f.store.request(request.requestId)?.status).toBe('retired');
  expect(released).toBe(true);
});

it('P3: execution still times out after admission and retains its lease until the effect settles', async () => {
  const f = fixture(false, 20), request = f.create();
  let acquired = false, released = false;
  (f.deps as any).acquire = async () => { acquired = true; return () => { released = true; }; };
  f.handler.execute = async (_record, _decision, { signal }) => {
    expect(acquired).toBe(true);
    if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    expect(released).toBe(false);
    return { ok: true };
  };
  expect(await f.service.respond(f.taskId, request.requestId, 1, { choice: 'allow' })).toMatchObject({ state: 'unknown' });
  expect(released).toBe(true);
});

it('R2: with no admission callback the budget begins as soon as execution can proceed', async () => {
  const f = fixture(false, 250), request = f.create();
  const execute = f.handler.execute;
  f.handler.execute = async (record, decision, context) => {
    expect(context.signal.aborted).toBe(false);
    expect(context.deadline - Date.now()).toBeGreaterThan(225);
    return execute(record, decision, context);
  };
  expect(await f.service.respond(f.taskId, request.requestId, 1, { choice: 'allow' })).toMatchObject({ state: 'finished' });
  expect(f.executions()).toBe(1);
});

it('P3: after a restart a queued approval returns to the original review and cannot run without a fresh decision', async () => {
  const f = fixture(), request = f.create();
  const old = f.store.request(request.requestId)!;
  const payload = { ...JSON.parse(old.payload_ref), phase: 'queued_for_slot' };
  f.db.prepare('UPDATE agent_requests SET payload_ref=?,revision=2 WHERE request_id=?').run(JSON.stringify(payload), request.requestId);
  const restarted = new HostBusinessRequests(f.deps);
  restarted.register('test', f.handler);
  clean.unshift(() => restarted.close());
  const reopened = f.store.request(request.requestId)!;
  expect(reopened.status).toBe('pending');
  expect(reopened.revision).toBe(3);
  expect(JSON.parse(reopened.payload_ref)).toMatchObject({ phase: 'waiting_user', review: { to: 'fixed' } });
  expect(f.executions()).toBe(0);
  await expect(restarted.respond(f.taskId, request.requestId, 2, { choice: 'allow' })).rejects.toThrow('已更新');
  expect(await restarted.respond(f.taskId, request.requestId, 3, { choice: 'allow' })).toMatchObject({ state: 'finished' });
  expect(f.executions()).toBe(1);
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
