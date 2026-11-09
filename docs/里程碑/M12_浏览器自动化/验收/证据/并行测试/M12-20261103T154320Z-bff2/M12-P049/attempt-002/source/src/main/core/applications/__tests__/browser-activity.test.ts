import {afterEach,beforeEach,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {runFixture} from './run-fixture';
import {ApplicationActivityService} from '../activity-service';
import {BrowserAudit} from '../../browser/audit';
import {BrowserOperations} from '../../browser/operations';
import {BrowserCookieImportAudit} from '../../browser/cookie-import/audit';
let f:Awaited<ReturnType<typeof runFixture>>,activity:ApplicationActivityService,operations:BrowserOperations,audit:BrowserAudit;
beforeEach(async()=>{f=await runFixture();activity=new ApplicationActivityService(f.store);operations=new BrowserOperations(f.sqlite);audit=new BrowserAudit(operations);});
afterEach(async()=>{await f.runs.dispose();f.cleanup();});
function command(runId:string=randomUUID(),requestId:string=randomUUID()){const scope={runId,requestId,taskId:f.snapshot.taskId,projectId:'p1'},record=audit.start(scope,'cookie get',{task:'target2'},true);record.page('page2');record.grant({grantId:'grant1',mode:'observe',source:'user'});record.success({result:{cookies:[{name:'session',value:'canary-private-cookie'}]},file:{path:'/private/tmp/synthetic-result.json',bytes:10}});return scope;}
it('joins browser detail to the original M11 operation once and shows only redacted parameter/result metadata',async()=>{
  const run=await f.create(),scope=command(run.runId),id=randomUUID();f.sqlite.prepare("INSERT INTO application_invocations(operation_id,run_id,request_id,request_hash,project_id,task_id,app_id,package_hash,tool_name,contract_major,connection_id,semantics,state,attempt_count,effect_state,started_at,ended_at) VALUES(?,?,?,'request','p1',?,'browser','fixture-package','browser.cookie.get',2,NULL,'read','succeeded',1,'read-only',?,?)").run(id,run.runId,scope.requestId,scope.taskId,'2026-11-04T10:00:00.000Z','2026-11-04T10:00:00.010Z');
  const rows=activity.list({appId:'browser'}).items;expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({id,kind:'operation',runId:run.runId,requestId:scope.requestId,browser:{pageId:'page2',targetTaskId:'target2'}});const detail=activity.detail('operation',id);expect(detail.browser).toMatchObject({authorization:{grantId:'grant1',source:'user'},result:{file:{path:'/private/tmp/synthetic-result.json'}}});expect(JSON.stringify(detail)).not.toContain('canary-private-cookie');expect(JSON.stringify(detail)).toContain('已脱敏');
});
it('retains standalone read/UI import records, source project and actor without inferring a new run',async()=>{
  const scope=command(),user=new BrowserCookieImportAudit(operations,()=> 'p1');await user.run('deleted-task','profile1','import',async()=>({value:'never-log-import-value'}));const rows=activity.list({appId:'browser'}).items;expect(rows).toHaveLength(2);const imported=rows.find(row=>row.action==='ui cookie import')!;expect(imported).toMatchObject({kind:'browser',projectId:'p1',taskId:'deleted-task',taskTitle:null,callerKind:'ui',state:'succeeded'});const read=rows.find(row=>row.requestId===scope.requestId)!;expect(read.browser?.pageId).toBe('page2');const before=f.sqlite.prepare('SELECT count(*) AS n FROM browser_operations').get();for(const row of rows){expect(activity.detail(row.kind,row.id).browser).toBeTruthy();}expect(f.sqlite.prepare('SELECT count(*) AS n FROM browser_operations').get()).toEqual(before);expect(JSON.stringify(rows)).not.toContain('never-log-import-value');
});
it('paginates equal-time mixed records without duplicates and distinguishes repeated request IDs across runs',()=>{
  const shared=randomUUID();for(let i=0;i<5;i++)command(randomUUID(),shared);f.sqlite.prepare('UPDATE browser_operations SET created_at=?,updated_at=?').run(1700000000000,1700000000010);const seen:string[]=[];let cursor:string|null|undefined=null;do{const page=activity.list({appId:'browser',limit:2,cursor});seen.push(...page.items.map(row=>row.id));cursor=page.nextCursor;}while(cursor);expect(seen).toHaveLength(5);expect(new Set(seen).size).toBe(5);for(const id of seen)expect(activity.detail('browser',id).item.requestId).toBe(shared);expect(()=>activity.list({appId:'mail',cursor:activity.list({appId:'browser',limit:2}).nextCursor})).toThrow('筛选条件');
});
it('hides legacy duplicate write receipts, preserves old receipts and keeps connection filters scoped',()=>{
  const scope=command();operations.begin(scope.runId,scope.requestId,scope.taskId,'page2','cookie get');operations.update(scope.runId,scope.requestId,'succeeded','completed',{summary:{value:'legacy-private-cookie'}});expect(activity.list({appId:'browser'}).items).toHaveLength(1);expect(activity.list({appId:'browser',connectionId:randomUUID()}).items).toEqual([]);expect(operations.receipt(scope.runId,scope.requestId)).toMatchObject({state:'succeeded'});
});
