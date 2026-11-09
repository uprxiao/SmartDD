import {afterEach,expect,it} from 'vitest';
import Database from 'better-sqlite3';
import {readFileSync} from 'node:fs';
import {BrowserAudit,browserActivityDetails,browserAuditValue} from '../audit';
import {BrowserOperations} from '../operations';
import {ApplicationError} from '@shared/applications';
const databases:Database.Database[]=[];
afterEach(()=>databases.splice(0).forEach(db=>db.close()));
function fixture(){const db=new Database(':memory:');databases.push(db);db.exec(readFileSync('drizzle/0030_browser_operations.sql','utf8'));const operations=new BrowserOperations(db),audit=new BrowserAudit(operations);return{db,operations,audit};}
const scope={runId:'run1',requestId:'request1',projectId:'project1',taskId:'task1'};
it('redacts all six required sensitive commands without mutating command inputs or results',()=>{
  const vectors:[string,Record<string,unknown>,unknown][]=[['set credentials',{user:'qa',pass:'秘密canary-credentials'},{configured:true}],['cookie set',{name:'session',value:'秘密canary-set'},{value:'秘密canary-set'}],['storage local set',{key:'token',value:'秘密canary-storage'},{value:'秘密canary-storage'}],['fill',{element:'@p1e1',value:'秘密canary-password'},{filled:'@p1e1'}],['set headers',{headers:{Authorization:'秘密canary-header','Proxy-Authorization':'秘密canary-proxy','Content-Type':'application/json'}},{headersSet:true}],['cookie get',{}, {result:{cookies:[{name:'session',value:'秘密canary-get',domain:'fixture.test'}]}}]];
  for(const[command,input,result]of vectors){const before=JSON.stringify({input,result}),projected={arguments:browserAuditValue(command,input,'arguments'),result:browserAuditValue(command,result,'result')},text=JSON.stringify(projected);expect(text).not.toContain('秘密canary');expect(text).toContain('已脱敏');expect(text).toContain('length');expect(JSON.stringify({input,result})).toBe(before);}
});
it('keeps caller, target, page, grant, duration and file metadata in an independent read audit without a write receipt',()=>{
  const f=fixture(),record=f.audit.start(scope,'pdf',{task:'task2'},true);record.page('page2');record.grant({grantId:'grant1',mode:'observe',source:'user'});record.success({file:{path:'/private/tmp/synthetic.pdf',bytes:10}});
  expect(f.operations.receipt('run1','request1')).toEqual({state:'not-found'});const row=f.operations.get('run1','audit:request1')!;expect(row).toMatchObject({task_id:'task1',page_id:'page2',state:'succeeded',effect_state:'read-only'});expect(browserActivityDetails(row)).toMatchObject({command:'pdf',targetTaskId:'task2',pageId:'page2',authorization:{grantId:'grant1',mode:'observe',source:'user'},result:{file:{path:'/private/tmp/synthetic.pdf',bytes:10}},durationMs:expect.any(Number)});
});
it('preserves the first audit on a replay and records failed versus unknown without serializing error messages',()=>{
  const f=fixture(),record=f.audit.start(scope,'fill',{value:'canary-pw'},false);record.passwordFill(true);record.failure(new ApplicationError('BROWSER_STALE_REF','private failure canary'),false);const before=f.operations.get('run1','audit:request1');f.audit.start(scope,'fill',{value:'different'},false).success({unexpected:true});expect(f.operations.get('run1','audit:request1')).toEqual(before);expect(before).toMatchObject({state:'failed',effect_state:'not-started',error_code:'BROWSER_STALE_REF'});expect(browserActivityDetails(before!).passwordFill).toBe(true);expect(JSON.stringify(before)).not.toContain('private failure');
  f.audit.start({...scope,requestId:'r2'},'goto',{},false).failure(new ApplicationError('BROWSER_TIMEOUT','secret error'),true);expect(f.operations.get('run1','audit:r2')).toMatchObject({state:'unknown',effect_state:'unknown'});
});
it('bounds large results while retaining source metadata and protects sensitive legacy receipt summaries',()=>{
  const f=fixture(),record=f.audit.start(scope,'cookie get',{},true);record.success({result:{cookies:Array.from({length:80},(_,n)=>({name:'c'+n,value:'canary-'+ 'x'.repeat(900)}))}});const row=f.operations.get('run1','audit:request1')!;expect(Buffer.byteLength(row.summary!)).toBeLessThan(16000);expect(browserActivityDetails(row).targetTaskId).toBe('task1');expect(row.summary).not.toContain('canary-');
  f.operations.begin('run1','write','task1','page1','storage local set');f.operations.update('run1','write','succeeded','completed',{summary:{result:{value:'canary-secret'}}});expect(JSON.stringify(f.operations.receipt('run1','write'))).not.toContain('canary-secret');expect(JSON.stringify(f.operations.receipt('run1','write'))).toContain('已脱敏');
});
it('masks compatibility exec text before dispatch and refuses corrupt audit history without replacing it',()=>{
  const f=fixture();f.audit.start(scope,'exec',{command:'fill input canary-secret'},false).success({completed:true});expect(f.operations.get('run1','audit:request1')!.summary).not.toContain('canary-secret');f.db.prepare('UPDATE browser_operations SET summary=?').run('{bad');expect(()=>browserActivityDetails(f.operations.get('run1','audit:request1')!)).toThrow('审计摘要损坏');expect(f.operations.get('run1','audit:request1')!.summary).toBe('{bad');
});
