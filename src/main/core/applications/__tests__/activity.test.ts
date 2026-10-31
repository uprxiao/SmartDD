import {randomUUID} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {ApplicationActivityService} from '../activity-service';
import {runFixture} from './run-fixture';
let f:Awaited<ReturnType<typeof runFixture>>,activity:ApplicationActivityService;
const when='2026-10-20T12:00:00.000Z',source=randomUUID(),other=randomUUID();
beforeEach(async()=>{f=await runFixture();activity=new ApplicationActivityService(f.store);});
afterEach(async()=>{await f.runs.dispose();f.cleanup();});
function put(over:{id?:string;app?:'mail'|'zentao';project?:string|null;at?:string;targets?:unknown;caller?:'ui'|'agent-run'|'index-job';state?:string;action?:string;runId?:string;taskId?:string}={}){
 const id=over.id??randomUUID(),caller=over.caller??'ui',project=over.project===undefined?'p1':over.project;
 f.sqlite.prepare(`INSERT INTO application_data_operations(operation_id,caller_kind,scope_kind,project_id,task_id,run_id,job_id,parent_operation_id,app_id,package_hash,data_api,action,semantics,scope_hash,targets_json,state,started_at) VALUES(@id,@caller,@scope,@project,@task,@run,@job,@parent,@app,'private-package',1,@action,'read','scope',@targets,@state,@at)`).run({id,caller,scope:caller==='index-job'?'internal-index':project===null?'connection-management':'project',project,task:over.taskId??null,run:over.runId??null,job:caller==='index-job'?randomUUID():null,parent:caller==='index-job'?randomUUID():null,app:over.app??'mail',action:over.action??'mail.query',targets:JSON.stringify(over.targets??[]),state:over.state??'succeeded',at:over.at??when});return id;
}

describe('persistent read-only application activity',()=>{
 it('deduplicates the Data API and bridge ledger while preserving the true source,request and attempt count',async()=>{
  const run=await f.create(),id=put({caller:'agent-run',targets:[{id:source}],runId:run.runId,taskId:f.snapshot.taskId}),request=randomUUID();
  f.sqlite.prepare(`INSERT INTO application_invocations(operation_id,run_id,request_id,request_hash,project_id,task_id,app_id,package_hash,tool_name,contract_major,connection_id,semantics,state,attempt_count,error_code,effect_state,started_at) VALUES(?,?,?,'request','p1',?,'mail','private-package','smartdd_mail_query_v1',1,?,'read','succeeded',3,NULL,'read-only',?)`).run(id,run.runId,request,f.snapshot.taskId,source,when);
  const page=activity.list();expect(page.items).toHaveLength(1);expect(page.items[0]).toMatchObject({id,callerKind:'agent-run',requestId:request,attemptCount:3,state:'succeeded',connections:[{id:source,name:null}]});
 });
 it('uses immutable time+identity keysets and binds cursors to the exact filters',()=>{
  const ids=Array.from({length:5},()=>put({targets:[{id:source}]}));put({app:'zentao',targets:[{id:other}]});put({at:'2026-10-20T13:00:00.000Z',project:'foreign-project'});
  const filter={appId:'mail' as const,connectionId:source,projectId:'p1',limit:2},first=activity.list(filter),second=activity.list({...filter,cursor:first.nextCursor}),third=activity.list({...filter,cursor:second.nextCursor});
  expect([...first.items,...second.items,...third.items].map(i=>i.id)).toEqual(ids.sort().reverse());expect(third.nextCursor).toBeNull();expect(()=>activity.list({...filter,connectionId:other,cursor:first.nextCursor})).toThrow(/筛选条件/);expect(()=>activity.list({...filter,cursor:'not-json'})).toThrow(/游标/);
 });
 it('filters host-recorded connection subjects without inferring the current project selection',()=>{
  const recorded=put({targets:[],action:'connection.save',project:null}),unrelated=put({targets:[{id:other}]});f.sqlite.prepare('INSERT INTO application_activity_subjects VALUES(?,?,?)').run(recorded,'connection',source);
  expect(activity.list({connectionId:source}).items.map(i=>i.id)).toEqual([recorded]);expect(activity.list({connectionId:other}).items.map(i=>i.id)).toEqual([unrelated]);expect(activity.list({appId:'zentao',connectionId:source}).items).toEqual([]);
 });
 it('retains deleted-project and index provenance and does not create new operations when inspecting or refreshing',()=>{
  const id=put({project:'deleted-project',caller:'index-job',action:'mail.refresh'}),before=f.sqlite.prepare('SELECT COUNT(*) AS n FROM application_data_operations').get();
  for(let n=0;n<3;n++){expect(activity.list().items[0]).toMatchObject({id,projectId:'deleted-project',projectName:null,callerKind:'index-job',jobId:expect.any(String)});expect(activity.detail('operation',id).send).toBeNull();}
  expect(f.sqlite.prepare('SELECT COUNT(*) AS n FROM application_data_operations').get()).toEqual(before);
 });
 it('returns only explicit metadata,never SQL,provider arguments,secret material or approvals',()=>{
  const id=put({targets:[{id:source,secret:'never-return-private-canary',approved:true,config:{token:'never-return-token'}}]});const json=JSON.stringify(activity.detail('operation',id));expect(json).not.toContain('private-canary');expect(json).not.toContain('never-return-token');expect(json).not.toContain('approved');
  expect(()=>activity.list({limit:1000})).toThrow();expect(()=>activity.list({sql:'SELECT * FROM app_secrets'} as never)).toThrow();expect(()=>activity.detail('send',id)).toThrow(/没有/);
 });
 it('marks corrupt source metadata as a recovery error instead of silently selecting a new connection',()=>{
  const id=put();f.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run('{bad',id);expect(()=>activity.list()).toThrow(/缺失或损坏/);expect(()=>activity.detail('operation',id)).toThrow(/缺失或损坏/);expect(()=>activity.list({connectionId:source})).toThrow(/不能确认连接筛选/);
 });
});
