import Database from 'better-sqlite3';import{it,expect,afterEach}from'vitest';import{randomUUID}from'node:crypto';
import{runBundledMigrations}from'../../../db/migrations';import{AgentStore}from'../../agent/agent-store';import{HostBusinessRequests}from'../../agent/host-business-requests';import{AgentBusinessTools}from'../agent-business-tools';
import{ApplicationError}from'@shared/applications';
import{standaloneKey}from'../../agent/task-application-scope';
import{ScheduleStore}from'../../schedules/store';
import{newScheduleConfig}from'@shared/schedule';
const clean:(()=>void)[]=[];afterEach(()=>clean.splice(0).forEach(f=>f()));
function fixture(tier='ask',maxTier='full',parentTier?:string,entry:'mcp'|'cli'='mcp',appId='fixture',standalone=false){
 const db=new Database(':memory:');runBundledMigrations(db);db.prepare('INSERT INTO projects(id,name,created_at,updated_at) VALUES(?,?,?,?)').run('p','fixture',Date.now(),Date.now());const store=new AgentStore(db),parentTaskId=parentTier?store.createTask({projectId:'p',dirId:null,cwd:'/fixture',title:'parent',selection:{driverId:'codex-app-server',profileId:'p',tier:parentTier}}):undefined,taskId=store.createTask({projectId:standalone?null:'p',dirId:null,cwd:'/fixture',title:'business',parentTaskId,selection:{driverId:'codex-app-server',profileId:'p',tier}}),bindingId=store.createBinding({task_id:taskId,driver_id:'codex-app-server',profile_id:'p',continuation_hash:'a'.repeat(64),cwd_identity:'/fixture',state_root:'/fixture/state'}),runId=randomUUID(),scope=standalone?standaloneKey(taskId):'p';store.insertRun({runId,taskId,bindingId,projectId:scope,generation:1,driverId:'codex-app-server',owner:{instanceId:'fixture',pid:process.pid,startedAt:null},launchPlanHash:'b'.repeat(64)});store.attachRunProcess(runId,taskId,12345,'fixture');
 const cap={id:'fixture.update',permission:'fixture.write',semantics:'write',slots:[],mcpTool:'smartdd_fixture_update_v1',aliases:[]},selection={appId,packageHash:'hash',capabilities:[cap],connections:[]};let stamp='account-v1',writes=0,leases=0,intercept:any;const context:any={run:{runId,taskId,projectId:scope,state:'active'},snapshot:standalone?{schema:3,externalPlugins:[],packages:[{appId,packageHash:'hash',bindings:[],toolContractMajors:{[cap.mcpTool]:1}}]}:{schema:3,externalPlugins:[selection]},signal:new AbortController().signal};
 const run:any={...context.run,bindingId,generation:1};const runs:any={assertActive:()=>context,withTaskOperation:async(_run:string,op:any,work:any)=>{op.assertCurrent();const old=context.taskBusiness;context.taskBusiness={operationId:op.operationId,callHash:op.callHash};try{return await work();}finally{context.taskBusiness=old;}}};
 const description={context,selected:{application:{appId}},semantics:'write'},call={operation:entry==='cli'?cap.id:cap.mcpTool,contractMajor:1,connectionId:null,arguments:{value:'frozen'}},id=randomUUID();const service:any={attachTaskInterceptor:(fn:any)=>intercept=fn,inspectCall:()=>description,call:async(r:string,i:string,c:any)=>{const request=intercept(r,i,c,entry);if(request)return request;writes++;return{schema:1,id:i,status:'ok',value:{updated:true}};}};
 const apps:any={builtin:{retainedMetadata:()=>({manifest:{displayName:'Browser'},version:'1'})},selections:{requireApplicationEnabled:(id:string,app:string)=>{if(id!==scope||app!=='browser')throw new ApplicationError('SCOPE_DENIED','browser scope mismatch');},policyStamp:(id:string,app:string)=>{if(id!==scope||app!=='browser')throw new ApplicationError('SCOPE_DENIED','browser scope mismatch');return{globalRevision:1,projectPolicyRevision:0};}},plugins:{lifecycle:{state:()=>({hash:'hash'}),packages:{get:()=>({plugin:{manifest:{capabilities:{[cap.id]:{...cap,maxTier}}}}})}},policy:{writeScope:()=>({stamp,displayName:'Fixture',version:'1',title:'Update',targets:[]})}}};
 let scheduledTurn:string|undefined;const notices:any[]=[];const deps={store,currentTurn:()=>scheduledTurn,run:()=>context.run.state==='active'?run:undefined,hasOwner:()=>context.run.state==='active',notify:(...args:any[])=>notices.push(args),acquire:async()=>{leases++;return()=>{leases--;};}};let requests=new HostBusinessRequests(deps);new AgentBusinessTools({store,requests,runs,applications:apps,services:new Map([[entry,service]]),notify:()=>{}});clean.push(()=>{requests.close();db.close();});
 return{store,taskId,parentTaskId,runId,id,call,context,attachScheduled:()=>{const ledger=new ScheduleStore(db),at=Date.now(),p=ledger.save({config:{...newScheduleConfig(),title:'Synthetic schedule policy',prompt:'fixture write',projectId:'p',dirId:'fixture-dir',cwd:'/fixture',destination:'existing',boundTask:taskId,profileId:'p',tier:tier as 'ask'|'auto'|'full'},schedule:{type:'interval',zone:'UTC',minutes:60},grace:60,enabled:false},at);const c=ledger.claim(p.id,{expected:p.revision,trigger:'manual',requestId:randomUUID(),now:at});if(!('run'in c))throw Error('fixture claim failed');ledger.begin(c.run.id,at);store.tx(()=>{const t=store.acceptTurn({taskId,clientInputId:c.run.inputId,text:'fixture write',sourceKind:'system'}).turn;ledger.accept(c.run.id,taskId,c.run.inputId,t.turn_id);scheduledTurn=t.turn_id;});return{occurrenceId:c.run.id,turnId:scheduledTurn!};},invoke:(requestId=id)=>service.call(runId,requestId,call),requests:()=>requests,writes:()=>writes,leases:()=>leases,notices,end:()=>{context.run.state='stopped';store.finishRun(runId,taskId,'stopped',null);},change:()=>stamp='account-v2',restart:()=>{requests.close();requests=new HostBusinessRequests(deps);new AgentBusinessTools({store,requests,runs,applications:apps,services:new Map([[entry,service]]),notify:()=>{}});}};
}
it('E12/A12: ask/auto return a durable receipt immediately, wait without a directory lease, survive old run exit/restart, and execute the frozen call only once',async()=>{
 for(const tier of ['ask','auto']){const f=fixture(tier),receipt=await f.invoke();expect(receipt.value.status).toBe('awaiting_user');expect(f.writes()).toBe(0);expect(f.leases()).toBe(0);expect((await f.invoke()).value.requestId).toBe(receipt.value.requestId);f.end();f.restart();await f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'});expect(f.writes()).toBe(1);expect(f.leases()).toBe(0);await expect(f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'})).rejects.toThrow();}
});
it('A12: full access remains bounded by the plugin maximum, while changed connection/policy retires a late approval without any write',async()=>{
 const direct=fixture('full');await direct.invoke();expect(direct.writes()).toBe(1);expect(direct.store.pendingRequests(direct.taskId)).toEqual([]);
 const bounded=fixture('full','ask'),receipt=await bounded.invoke();expect(bounded.writes()).toBe(0);bounded.change();await expect(bounded.requests().respond(bounded.taskId,receipt.value.requestId,1,{choice:'allow'})).rejects.toThrow('已变化');expect(bounded.store.request(receipt.value.requestId)?.status).toBe('retired');expect(bounded.writes()).toBe(0);
});

it('tells a browser caller to end its dependent turn so the queued approval result can arrive', async () => {
  const f = fixture('ask', 'full', undefined, 'mcp', 'browser');
  const receipt = await f.invoke();
  expect(receipt.value).toMatchObject({
    status: 'awaiting_user', next: expect.stringMatching(/结束当前回合.*后续回合/),
  });
  expect(receipt.value.next).toContain('勿休眠');
  expect((await f.invoke()).value).toMatchObject({
    status: 'pending', requestId: receipt.value.requestId, next: receipt.value.next,
  });
  expect(f.writes()).toBe(0);
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
it('A41 manual mail edit first cancels the pending send intent so the draft can be updated (D06-74)',async()=>{
 const order:string[]=[];
 const applications:any={
  viewDraft:async()=>({draft:{content:{mode:'new',sourceMessageRef:null,senderConnectionId:'c',to:['old@example.invalid'],cc:[],bcc:[],subject:'old',text:'old',html:null,inReplyTo:null,references:[],attachmentIds:[]}}}),
  cancelTaskMail:async(_s:unknown,project:string,intent:string)=>{order.push('cancel:'+project+':'+intent);},
  editTaskMail:async(_s:unknown,_p:string,_d:string,_r:number,content:any)=>{order.push('edit:'+content.subject);throw new Error('stop after edit');},
 };
 const tools:any=new AgentBusinessTools({store:{} as any,requests:{register:()=>{}} as any,runs:{} as any,applications,services:new Map(),notify:()=>{}});
 tools.mail=()=>({id:'intent-1',project_id:'p',draft_id:'draft-1',draft_revision:3});
 const record:any={payload:{data:{mailIntentId:'intent-1',entry:'mcp'}},origin:{runId:'run'},row:{task_id:'t',request_id:'r'}};
 await expect(tools.reviseMail(record,{edits:{to:'new@example.invalid',cc:'',bcc:'',subject:'new subject',text:'new body'}},{})).rejects.toThrow('stop after edit');
 expect(order).toEqual(['cancel:p:intent-1','edit:new subject']);
});

it('A72 a send whose authorization is refused before any delivery reports not executed, not unknown (D06-76)',async()=>{
 const handlers=new Map<string,any>();const calls:string[]=[];
 const applications:any={authorizeSend:async()=>{calls.push('authorize');throw new ApplicationError('INTENT_STALE','发件身份、配置或项目选用已改变，请重新明确操作');}};
 const service:any={call:async()=>{calls.push('send');return {status:'ok'};},attachTaskInterceptor:()=>{}};
 const tools:any=new AgentBusinessTools({store:{} as any,requests:{register:(kind:string,h:any)=>handlers.set(kind,h)} as any,runs:{} as any,applications,services:new Map([['mcp',service]]),notify:()=>{}});
 tools.mail=()=>({id:'intent-1',project_id:'p',draft_id:'d',draft_revision:1,review_hash:'h',review_json:'{}'});
 tools.scoped=(_r:unknown,_s:unknown,work:()=>Promise<unknown>)=>work();
 const record:any={payload:{businessKind:'mail_send',data:{mailIntentId:'intent-1',entry:'mcp',requestId:'q',call:{operation:'smartdd_mail_send_execute_v2'}}},origin:{runId:'run'},row:{task_id:'t',request_id:'r'}};
 const result=await handlers.get('mail_send').execute(record,{choice:'allow',displayReceiptId:'shown'},{signal:new AbortController().signal,sender:{}});
 expect(calls).toEqual(['authorize']);
 expect(result).toMatchObject({status:'error',error:{code:'INTENT_STALE',effectState:'none',message:'发件身份、配置或项目选用已改变，请重新明确操作'}});
});

it('M16 A44/B12: a no-project task uses its own verified browser scope for approved writes',async()=>{
 const f=fixture('ask','full',undefined,'mcp','browser',true);
 expect(f.store.task(f.taskId)?.project_id).toBeNull();
 const receipt=await f.invoke();
 expect(receipt.value.status).toBe('awaiting_user');
 expect(f.writes()).toBe(0);
 await f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'});
 expect(f.writes()).toBe(1);
 expect(f.store.request(receipt.value.requestId)?.status).toBe('resolved');
});
it('M16 A44/B12: wrong standalone run scope and non-browser writes remain denied',async()=>{
 const wrong=fixture('full','full',undefined,'mcp','browser',true);
 wrong.context.run.projectId=standaloneKey(randomUUID());
 await expect(wrong.invoke()).rejects.toMatchObject({code:'SCOPE_DENIED'});
 expect(wrong.writes()).toBe(0);
 const unavailable=fixture('full','full',undefined,'mcp','fixture',true);
 await expect(unavailable.invoke()).rejects.toMatchObject({code:'SCOPE_DENIED'});
 expect(unavailable.writes()).toBe(0);
});

it.each(['mcp','cli'] as const)('M16 A45/A46 actual scheduled origin uses the normal %s host write policy, not a blanket deny or implicit approval',async entry=>{
  const direct=fixture('full','full',undefined,entry),first=direct.attachScheduled();
  expect(direct.store.scheduledOrigin(first.turnId)?.occurrence_id).toBe(first.occurrenceId);
  await direct.invoke();expect(direct.writes()).toBe(1);expect(direct.store.pendingRequests(direct.taskId)).toEqual([]);
  for(const tier of ['ask','auto','full']){
    const f=fixture(tier,'ask',undefined,entry),origin=f.attachScheduled(),receipt=await f.invoke();
    expect(receipt.value.status).toBe('awaiting_user');expect(f.writes()).toBe(0);
    expect(f.store.pendingRequests(f.taskId)[0].origin.turnId).toBe(origin.turnId);
    expect((await f.invoke()).value.requestId).toBe(receipt.value.requestId);
    if(tier==='auto'){
      await f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'deny'});expect(f.writes()).toBe(0);
    }else if(tier==='full'){
      f.change();await expect(f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'})).rejects.toThrow('已变化');expect(f.writes()).toBe(0);
    }else{
      await f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'});expect(f.writes()).toBe(1);
      await expect(f.requests().respond(f.taskId,receipt.value.requestId,1,{choice:'allow'})).rejects.toThrow();expect(f.writes()).toBe(1);
    }
  }
});
