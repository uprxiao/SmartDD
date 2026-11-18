import Database from 'better-sqlite3';import{it,expect,afterEach}from'vitest';import{randomUUID}from'node:crypto';
import{runBundledMigrations}from'../../../db/migrations';import{AgentStore}from'../../agent/agent-store';import{HostBusinessRequests}from'../../agent/host-business-requests';import{AgentBusinessTools}from'../agent-business-tools';
const clean:(()=>void)[]=[];afterEach(()=>clean.splice(0).forEach(f=>f()));
function fixture(tier='ask',maxTier='full',parentTier?:string,entry:'mcp'|'cli'='mcp'){
 const db=new Database(':memory:');runBundledMigrations(db);db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('p','fixture',Date.now(),Date.now());const store=new AgentStore(db),parentTaskId=parentTier?store.createTask({projectId:'p',dirId:null,cwd:'/fixture',title:'parent',selection:{driverId:'codex-app-server',profileId:'p',tier:parentTier}}):undefined,taskId=store.createTask({projectId:'p',dirId:null,cwd:'/fixture',title:'business',parentTaskId,selection:{driverId:'codex-app-server',profileId:'p',tier}}),bindingId=store.createBinding({task_id:taskId,driver_id:'codex-app-server',profile_id:'p',continuation_hash:'a'.repeat(64),cwd_identity:'/fixture',state_root:'/fixture/state'}),runId=randomUUID();store.insertRun({runId,taskId,bindingId,projectId:'p',generation:1,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});store.attachRunProcess(runId,taskId,12345,'fixture');
 const cap={id:'fixture.update',permission:'fixture.write',semantics:'write',slots:[],mcpTool:'smartdd_fixture_update_v1',aliases:[]},selection={appId:'fixture',packageHash:'hash',capabilities:[cap],connections:[]};let stamp='account-v1',writes=0,leases=0,intercept:any;const context:any={run:{runId,taskId,projectId:'p',state:'active'},snapshot:{schema:3,externalPlugins:[selection]},signal:new AbortController().signal};
 const run:any={...context.run,bindingId,generation:1};const runs:any={assertActive:()=>context,withTaskOperation:async(_run:string,op:any,work:any)=>{op.assertCurrent();const old=context.taskBusiness;context.taskBusiness={operationId:op.operationId,callHash:op.callHash};try{return await work();}finally{context.taskBusiness=old;}}};
 const description={context,selected:{application:{appId:'fixture'}},semantics:'write'},call={operation:entry==='cli'?cap.id:cap.mcpTool,contractMajor:1,connectionId:null,arguments:{value:'frozen'}},id=randomUUID();const service:any={attachTaskInterceptor:(fn:any)=>intercept=fn,inspectCall:()=>description,call:async(r:string,i:string,c:any)=>{const request=intercept(r,i,c,entry);if(request)return request;writes++;return{schema:1,id:i,status:'ok',value:{updated:true}};}};
 const apps:any={plugins:{lifecycle:{state:()=>({hash:'hash'}),packages:{get:()=>({plugin:{manifest:{capabilities:{[cap.id]:{...cap,maxTier}}}}})}},policy:{writeScope:()=>({stamp,displayName:'Fixture',version:'1',title:'Update',targets:[]})}}};
 const notices:any[]=[];const deps={store,run:()=>context.run.state==='active'?run:undefined,hasOwner:()=>context.run.state==='active',notify:(...args:any[])=>notices.push(args),acquire:async()=>{leases++;return()=>{leases--;};}};let requests=new HostBusinessRequests(deps);new AgentBusinessTools({store,requests,runs,applications:apps,services:new Map([[entry,service]]),notify:()=>{}});clean.push(()=>{requests.close();db.close();});
 return{store,taskId,parentTaskId,runId,id,call,invoke:(requestId=id)=>service.call(runId,requestId,call),requests:()=>requests,writes:()=>writes,leases:()=>leases,notices,end:()=>{context.run.state='stopped';store.finishRun(runId,taskId,'stopped',null);},change:()=>stamp='account-v2',restart:()=>{requests.close();requests=new HostBusinessRequests(deps);new AgentBusinessTools({store,requests,runs,applications:apps,services:new Map([[entry,service]]),notify:()=>{}});}};
}
it('E12/A12: ask/auto return a durable receipt immediately, wait without a directory lease, survive old run exit/restart, and execute the frozen call only once',async()=>{
 for(const tier of ['ask','auto']){const f=fixture(tier),receipt=await f.invoke();expect(receipt.value.status).toBe('awaiting_user');expect(f.writes()).toBe(0);expect(f.leases()).toBe(0);expect((await f.invoke()).value.requestId).toBe(receipt.value.requestId);f.end();f.restart();await f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'});expect(f.writes()).toBe(1);expect(f.leases()).toBe(0);await expect(f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'})).rejects.toThrow();}
});
it('A12: full access remains bounded by the plugin maximum, while changed connection/policy retires a late approval without any write',async()=>{
 const direct=fixture('full');await direct.invoke();expect(direct.writes()).toBe(1);expect(direct.store.pendingRequests(direct.taskId)).toEqual([]);
 const bounded=fixture('full','ask'),receipt=await bounded.invoke();expect(bounded.writes()).toBe(0);bounded.change();await expect(bounded.requests().respond(bounded.taskId,receipt.value.requestId,1,{choice:'allow'})).rejects.toThrow('已变化');expect(bounded.store.request(receipt.value.requestId)?.status).toBe('retired');expect(bounded.writes()).toBe(0);
});

it('A37: CLI returns a host request receipt before an approved write can execute', async () => {
  const f = fixture('ask', 'full', undefined, 'cli');
  const opened = await f.invoke();
  expect(opened).toMatchObject({ status: 'ok', taskRequest: true, value: {
    schema: 'willyou-task-request-v1', status: 'awaiting_user', requestId: expect.any(String), operationId: expect.any(String),
  } });
  const original = opened.value;
  expect(await f.invoke()).toMatchObject({ taskRequest: true, value: {
    schema: original.schema, status: 'pending', requestId: original.requestId, operationId: original.operationId,
  } });
  expect(f.writes()).toBe(0);
  await f.requests().respond(f.taskId, original.requestId, 1, { choice: 'allow' });
  expect(f.writes()).toBe(1);
  expect(await f.invoke()).toMatchObject({ taskRequest: true, value: {
    status: 'resolved', requestId: original.requestId, operationId: original.operationId,
  } });
  expect(f.writes()).toBe(1);
});

it('A26 applies live parent permissions to a child’s plugin call before the child’s native tier changes', async () => {
  const f = fixture('ask', 'full', 'ask');
  const parent = f.parentTaskId!;
  const change = (tier: 'ask' | 'full') => f.store.updateSelection(parent, { tier }, f.store.task(parent)!.selection_revision);
  expect((await f.invoke()).value.status).toBe('awaiting_user');
  expect(f.writes()).toBe(0);
  change('full');
  expect((await f.invoke(randomUUID())).value.updated).toBe(true);
  expect(JSON.parse(f.store.task(f.taskId)!.selection_json).tier).toBe('ask');
  change('ask');
  expect((await f.invoke(randomUUID())).value.status).toBe('awaiting_user');
  expect(f.writes()).toBe(1);
});
