import {parseManifest} from '../manifest';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync,rmSync } from 'node:fs';
import { createServer,type Server,type IncomingMessage,type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi } from 'vitest';
import type { IpcMainInvokeEvent } from 'electron';
import type { ZentaoWorkData,ZentaoDetailData,ZentaoSourceRef } from '@shared/application-zentao';
import type { ApplicationResourceRef,ApplicationResourceChunk } from '@shared/application-data';
import type { ApplicationDataReply } from '@shared/application-data';
import type { ApplicationConnection,VerifiedConnectionCandidate } from '@shared/application-connections';
import { registerRPCRouter } from '@shared/ipc/rpc';
import { createApplicationController } from '../controller';
import { SecretsStore } from '../../../secrets';
import { PtyAccess } from '../../../pty-access';
import * as schema from '../../../db/schema';
import { ProjectService } from '../../projects/project-service';
import { ApplicationService } from '../application-service';
import { ApplicationAdapterRegistry } from '../application-adapter-registry';
import { ApplicationToolService } from '../tool-service';
import { CapabilityBundleSource } from '../bundle-source';
import { BuiltinPackageRegistry } from '../builtin-package-registry';
import { runFixture,FixtureProcessReader } from './run-fixture';
import {ZentaoClient,type ZentaoKind} from '../providers/zentao';
import {ApplicationExecutionContexts} from '../execution-context';
let secrets:SecretsStore,projects:ProjectService,access:PtyAccess;
let build:string,source:CapabilityBundleSource,f:Awaited<ReturnType<typeof runFixture>>,app:ApplicationService,tools:ApplicationToolService,owned:Awaited<ReturnType<typeof f.create>>,sender:IpcMainInvokeEvent;
let server:Server,base:string,connectionId:string,sockets:Set<Socket>,paths:string[],tokens:string[],acceptedTokens:Set<string>,outside:number,changes:number;
let changeEvents:unknown[];
interface ObjectData {fields:Record<string,unknown>;actions:unknown}
let holdDetail:boolean,held:(()=>void)|null,entered:(()=>void)|null;
let objects:Map<string,ObjectData>,files:Map<string,Buffer>,fileFailures:Map<string,number>,workFailures:number,workCalls:number,duplicatePage:boolean,totalChanged:boolean,intruder:boolean;
let workRetryAfter:string|undefined,workFailureStatus:number,workTimes:number[];
let holdAuthResponse:boolean,heldAuthResponse:(()=>void)|null,authEntered:(()=>void)|null,profileIds:Map<string,number>;
const id='9007199254740997';
const initial=()=>({fields:{id,assignedTo:{account:'tester'},status:'active',title:'隔离本人Bug',steps:'<p>复现步骤</p>',product:{id:'7',name:'fixture'},files:[]},actions:[{action:'opened',comment:'完整历史'}]});
const json=(res:ServerResponse,value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
function handle(req:IncomingMessage,res:ServerResponse){
 const url=new URL(req.url!,base);paths.push(url.pathname+url.search);tokens.push(String(req.headers.token??''));
 if(url.pathname==='/outside'){outside++;json(res,{});return;}
 if(!acceptedTokens.has(String(req.headers.token??''))){if(holdAuthResponse){holdAuthResponse=false;heldAuthResponse=()=>{heldAuthResponse=null;if(!res.destroyed&&!res.writableEnded)json(res,{message:'do not echo zt-secret-canary'},401);};authEntered?.();return;}json(res,{message:'do not echo zt-secret-canary'},401);return;}
 const route=url.pathname.replace(/^\/(?:biz|other)\/api.php\//,'');
 if(route==='v1/user'){json(res,{profile:{id:String(profileIds.get(url.pathname.startsWith('/other/')?'/other/':'/biz/')??7),account:'tester'}});return;}
 if(route==='v1/langs'){json(res,{bug:{status:'Bug状态',statusList:{active:'激活'},pri:'优先级',priList:['','P0','P1','P2'],severityList:{3:'较大'}}});return;}
 if(route==='v2/my/work'){
  workCalls++;workTimes.push(Date.now());if(workFailures>0){workFailures--;if(workRetryAfter!==undefined)res.setHeader('retry-after',workRetryAfter);json(res,{},workFailureStatus);return;}
  const kind=url.searchParams.get('mode')!,page=Number(url.searchParams.get('pageID')),size=Number(url.searchParams.get('recPerPage'));
  let rows=[...objects].filter(([key,value])=>key.startsWith(kind+':')&&(value.fields.assignedTo as {account:string}).account==='tester'&&(kind!=='bug'||value.fields.status!=='closed')).map(([,value])=>value.fields).sort((a,b)=>BigInt(String(a.id))>BigInt(String(b.id))?-1:1);
  if(intruder)rows=[{...initial().fields,assignedTo:{account:'other'},title:'outside scope must not escape'}];
  const currentPage=duplicatePage&&page>1?1:page,total=rows.length+(totalChanged&&page>1?1:0);
  json(res,{mode:kind,type:'assignedTo',pager:{recTotal:total,pageID:page,recPerPage:size,pageTotal:Math.ceil(total/size)},[kind==='bug'?'bugs':'stories']:rows.slice((currentPage-1)*size,currentPage*size)});return;
 }
 const detail=/^(?:v1\/bugs|v2\/stories)\/([0-9]+)$/.exec(route);
 if(detail){const kind=route.includes('/bugs/')?'bug':'story',value=objects.get(kind+':'+detail[1]);if(!value){json(res,{},404);return;}if(holdDetail){holdDetail=false;held=()=>{held=null;if(!res.destroyed&&!res.writableEnded)json(res,{[kind]:value.fields,actions:value.actions});};entered?.();return;}json(res,{[kind]:value.fields,actions:value.actions});return;}
 const file=/^v1\/files\/([0-9]+)$/.exec(route);
 if(file){const status=fileFailures.get(file[1]);if(status===302){res.writeHead(302,{location:'/outside'});res.end();return;}if(status){json(res,{},status);return;}
  const bytes=files.get(file[1]);if(!bytes){json(res,{},404);return;}res.writeHead(200,{'content-type':'application/octet-stream','content-length':bytes.length});res.end(bytes);return;
 }
 json(res,{},404);
}
const call=(name:string,args:Record<string,unknown>,requestId=randomUUID(),signal?:AbortSignal)=>tools.call(owned.runId,requestId,{operation:'smartdd_zentao_'+name+'_v1',contractMajor:1,connectionId:typeof args.connectionId==='string'?args.connectionId:null,arguments:args},signal);
async function list(kind:ZentaoKind='bug',extra:Record<string,unknown>={}){const response=await call('work_list',{kind,...extra});expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw new Error('list failed');return response.value as ZentaoWorkData;}
async function detail(reference:ZentaoSourceRef,kind:ZentaoKind='bug'){const response=await call('object_get',{kind,reference});expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw new Error('detail failed');return response.value as ZentaoDetailData;}
async function chunk(resource:ApplicationResourceRef,offset=0,length=262144){const response=await call('resource',{resource,offset,length});expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw new Error('resource failed');return response.value as ApplicationResourceChunk;}
const bytes=(value:ApplicationResourceChunk)=>Buffer.from(value.data,value.encoding==='base64'?'base64':'utf8');
async function whole(resource:ApplicationResourceRef){const parts:Buffer[]=[];let offset=0;do{const value=await chunk(resource,offset);parts.push(bytes(value));if(value.eof)break;offset=value.nextOffset!;}while(true);return Buffer.concat(parts);}
async function saveConnection(url=base,secret='zt-secret-canary'){
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'隔离禅道',config:{kind:'zentao',baseUrl:url,username:'tester',authMode:'token'},secret});return app.saveConnection(sender,'zentao',tested.operationId,tested.candidateHash);
}
beforeAll(()=>{
 build=mkdtempSync(join(tmpdir(),'willyou-m10-zt-data-build-'));
 execFileSync(process.execPath,['scripts/applications/build-runtime.mjs',join(build,'runtime')],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});
 execFileSync(process.execPath,['scripts/applications/build-bundles.mjs',join(build,'bundles'),join(build,'runtime/mcp-bridge.cjs'),'--retained-v1-test-fixture'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},timeout:30000,stdio:'pipe'});source=new CapabilityBundleSource(join(build,'bundles'));
});
afterAll(()=>rmSync(build,{recursive:true,force:true}));
beforeEach(async()=>{
 holdAuthResponse=false;heldAuthResponse=null;authEntered=null;profileIds=new Map();
 changeEvents=[];paths=[];tokens=[];acceptedTokens=new Set(['zt-secret-canary']);outside=0;changes=0;workCalls=0;workFailures=0;workRetryAfter=undefined;workFailureStatus=503;workTimes=[];holdDetail=false;held=null;entered=null;duplicatePage=false;totalChanged=false;intruder=false;files=new Map();fileFailures=new Map();objects=new Map([['bug:'+id,initial()]]);sockets=new Set();
 server=createServer(handle);server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address();if(!address||typeof address==='string')throw new Error('fixture address');base='http://127.0.0.1:'+address.port+'/biz/';
 const pack=source.application(source.index.apps.find(a=>a.appId==='zentao')!);f=await runFixture(new FixtureProcessReader(),{application:true,applicationBundle:{manifest:parseManifest(pack.manifest),files:{...pack.files}},runtime:Buffer.from(source.runtime().files['mcp-bridge.cjs'])});
 await new BuiltinPackageRegistry(f.store).install(source,source.index.apps.find(a=>a.appId==='zentao')!);
 const db=drizzle(f.sqlite,{schema});secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:v=>Buffer.from([...v].reverse().join('')),decrypt:v=>[...v.toString()].reverse().join('')});projects=new ProjectService(db,secrets);
 const wc=Object.assign(new EventEmitter(),{id:91,mainFrame:{},isDestroyed:()=>false});sender={sender:wc,senderFrame:wc.mainFrame} as unknown as IpcMainInvokeEvent;
 access=new PtyAccess({trusted:e=>e.sender===sender.sender,activePty:()=>null,alive:()=>false,write:()=>{},resize:()=>{},killTask:()=>{}});
 app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(f.root,'unused-worker'),foxmailNative:join(f.root,'unused-native'),uiReadRetryDelays:[0,0],changed:(change?:unknown)=>{changes++;changeEvents.push(change);}});await app.recover();await app.setAdded(sender,'zentao',true,0);
 const connection=await saveConnection();connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'zentao',enabled:true,connections:{zentao:connectionId},expectedRevision:0});app.attachRuns(f.runs);
 owned=await f.create();await owned.prepare();await owned.cli.arm();(f.reader as FixtureProcessReader).identities.set(60101,'darwin-proc-v1:2026:60101');await owned.cli.attach(60101);
 tools=new ApplicationToolService(f.store,f.runs,new ApplicationAdapterRegistry(f.store,app.data),{retryDelays:[0,0]});
});
afterEach(async()=>{held?.();heldAuthResponse?.();vi.restoreAllMocks();await app.dispose();await owned.cli.exited();for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));f.cleanup();});

describe('original ZenTao tools to actual provider and host-scoped business resources',()=>{
 it('M11 retains the original local ZenTao reference validator after module composition',async()=>{
  const current=await app.zentaoWork(sender,'p1',{kind:'bug'}),reference=current.items[0].reference;
  expect(()=>app.data.zentao.assertStoredReference('p1','bug',reference)).not.toThrow();
  expect(()=>app.data.zentao.assertStoredReference('p2','bug',reference)).toThrow(expect.objectContaining({code:'NOT_FOUND'}));
 });
 it('keeps frozen Agent outputs unchanged while UI alone receives cached instance display metadata',async()=>{
  const agentList=await list();expect(agentList).not.toHaveProperty('presentation');const agentDetail=await detail(agentList.items[0].reference);expect(agentDetail).not.toHaveProperty('presentation');expect(paths.filter(path=>path.includes('/langs'))).toHaveLength(0);
  const uiList=await app.zentaoWork(sender,'p1',{kind:'bug'});expect(uiList.presentation?.choices.status.active).toBe('激活');
  const uiDetail=await app.zentaoObject(sender,'p1',{kind:'bug',reference:uiList.items[0].reference});expect(uiDetail.presentation?.choices.pri['3']).toBe('P2');expect(uiDetail.fields.status).toBe('active');expect(paths.filter(path=>path.includes('/langs'))).toHaveLength(1);
  expect(uiDetail.reference.contentRevision).toBe(agentDetail.reference.contentRevision);expect(uiDetail.body?.revision).toBe(agentDetail.body?.revision);
 });
 it('OZ cancels an actual held UI detail HTTP producer and keeps a new read usable',async()=>{
  const first=await app.zentaoWork(sender,'p1',{kind:'bug'}),token=randomUUID();holdDetail=true;const ready=new Promise<void>(r=>entered=r),pending=app.zentaoObject(sender,'p1',{kind:'bug',reference:first.items[0].reference},token).then(()=>null,error=>error);await ready;expect(app.cancelUiRead(sender,token)).toEqual({canceled:true});expect(await pending).toMatchObject({code:'CANCELED'});held?.();expect(app.cancelUiRead(sender,token)).toEqual({canceled:false});expect((await app.zentaoWork(sender,'p1',{kind:'bug'},randomUUID())).complete).toBe(true);expect(f.sqlite.prepare("SELECT state,error_code,attempt_count FROM application_data_operations WHERE action='ui.zentao.object'").all()).toEqual([{state:'cancelled',error_code:'CANCELED',attempt_count:1}]);
 });
 it('OZ cancels actual UI retry backoff after its first HTTP failure without starting another attempt',async()=>{
  workFailures=5;workRetryAfter='1';const token=randomUUID(),pending=app.zentaoWork(sender,'p1',{kind:'bug'},token).then(()=>null,error=>error);await vi.waitFor(()=>expect(workCalls).toBe(1));expect(app.cancelUiRead(sender,token)).toEqual({canceled:true});expect(await pending).toMatchObject({code:'CANCELED'});expect(workCalls).toBe(1);expect(f.sqlite.prepare("SELECT state,error_code,attempt_count FROM application_data_operations WHERE action='ui.zentao.work'").all()).toEqual([{state:'cancelled',error_code:'CANCELED',attempt_count:1}]);
 });
 it('OZ aborts an original UI HTTP read when its own main document navigates',async()=>{
  const first=await app.zentaoWork(sender,'p1',{kind:'bug'});holdDetail=true;const ready=new Promise<void>(r=>entered=r),pending=app.zentaoObject(sender,'p1',{kind:'bug',reference:first.items[0].reference},randomUUID()).then(()=>null,error=>error);await ready;(sender.sender as unknown as EventEmitter).emit('did-start-navigation',{},'https://own.invalid',false,true);expect(await pending).toMatchObject({code:'CANCELED'});held?.();expect(sender.sender.listenerCount('did-start-navigation')).toBe(0);
 });
 it('OZ rejects malformed UI read IDs before provider or business journal use',async()=>{
  const before=paths.length;await expect(app.zentaoWork(sender,'p1',{kind:'bug'},'bad-id')).rejects.toThrow();expect(paths).toHaveLength(before);expect(f.sqlite.prepare("SELECT count(*) n FROM application_data_operations WHERE action='ui.zentao.work'").get()).toEqual({n:0});
 });
 it('OY-02 publishes runtime health as metadata rather than a full application mutation',async()=>{
  const before=changeEvents.length;await app.zentaoWork(sender,'p1',{kind:'bug'});expect(changeEvents.slice(before)).toEqual([{kind:'health',appId:'zentao',connectionId}]);
 });
 it('OY held UI provider response obeys the one original deadline and records TIMEOUT instead of cancellation',async()=>{
  const bounded=new ApplicationExecutionContexts(f.store,app.selections,app.connections,{requireSender:e=>access.requireSender(e),assertRun:run=>f.runs.assertActive(run),uiReadRetryDelays:[0,0],uiReadTimeoutMs:500}),client=new ZentaoClient({kind:'zentao',baseUrl:base,username:'tester',authMode:'token'},'zt-secret-canary');holdDetail=true;const began=performance.now();
  try{await expect(bounded.withUi(sender,{projectId:'p1',appId:'zentao',action:'ui.zentao.deadline_probe',operations:['zentao.read'],semantics:'read',retry:'safe-read'},context=>client.detail('bug',id,context.signal))).rejects.toMatchObject({code:'TIMEOUT'});expect(performance.now()-began).toBeLessThan(2000);expect(paths.filter(p=>p.endsWith('/bugs/'+id))).toHaveLength(1);expect(f.sqlite.prepare("SELECT state,error_code,attempt_count FROM application_data_operations WHERE action='ui.zentao.deadline_probe'").all()).toEqual([{state:'failed',error_code:'TIMEOUT',attempt_count:1}]);}finally{client.close();held?.();await bounded.dispose();}
 });
 it('OY rejects opting a UI write into the automatic read budget before invoking its work',()=>{
  let writes=0;expect(()=>app.contexts.withUi(sender,{projectId:'p1',appId:'zentao',action:'ui.zentao.prohibited_write_probe',operations:['zentao.read'],semantics:'write',retry:'safe-read'},async()=>{writes++;return null;})).toThrow('只有受信只读操作');expect(writes).toBe(0);expect(f.sqlite.prepare("SELECT count(*) n FROM application_data_operations WHERE action='ui.zentao.prohibited_write_probe'").get()).toEqual({n:0});
 });
 it('OY-01 applies a single UI read budget to transient pages and retains one operation with three attempts',async()=>{
  workFailures=2;const value=await app.zentaoWork(sender,'p1',{kind:'bug'});expect(value.items).toHaveLength(1);expect(workCalls).toBe(3);expect(f.sqlite.prepare("SELECT attempt_count,state FROM application_data_operations WHERE action='ui.zentao.work'").all()).toEqual([{attempt_count:3,state:'succeeded'}]);
 });
 it('OY-01 ends exhausted UI retries without replaying the first page or losing its original cursor',async()=>{
  objects.set('bug:8',{...initial(),fields:{...initial().fields,id:'8'}});const first=await app.zentaoWork(sender,'p1',{kind:'bug',limit:1});const cursor=f.sqlite.prepare('SELECT * FROM application_zentao_cursors WHERE cursor_id=?').get(first.nextCursor);workFailures=3;
  await expect(app.zentaoWork(sender,'p1',{kind:'bug',limit:1,cursor:first.nextCursor})).rejects.toMatchObject({code:'TRANSIENT_FAILURE',message:expect.stringContaining('3')});expect(workCalls).toBe(4);expect(f.sqlite.prepare('SELECT * FROM application_zentao_cursors WHERE cursor_id=?').get(first.nextCursor)).toEqual(cursor);const recovered=await app.zentaoWork(sender,'p1',{kind:'bug',limit:1,cursor:first.nextCursor});expect(recovered.complete).toBe(true);expect(paths.filter(p=>p.includes('/my/work?')).map(p=>new URL(p,base).searchParams.get('pageID'))).toEqual(['1','2','2','2','2']);
 });
 it('never waits beyond the one UI deadline for a long Retry-After hint',async()=>{
  workFailures=5;workRetryAfter='31';await expect(app.zentaoWork(sender,'p1',{kind:'bug'})).rejects.toMatchObject({code:'TRANSIENT_FAILURE'});expect(workCalls).toBe(1);expect(f.sqlite.prepare("SELECT attempt_count,state FROM application_data_operations WHERE action='ui.zentao.work'").all()).toEqual([{attempt_count:1,state:'failed'}]);
 });
 it.each([401,403,404])('never retries a permanent UI HTTP%s failure',async status=>{
  workFailures=5;workFailureStatus=status;await expect(app.zentaoWork(sender,'p1',{kind:'bug'})).rejects.toMatchObject({code:status===401?'AUTH_FAILED':status===403?'SCOPE_DENIED':'NOT_FOUND'});expect(workCalls).toBe(1);
 });
 it('OY-01 honors a short provider wait in the UI path rather than immediately retrying it',async()=>{
  workFailures=1;workRetryAfter='1';const value=await app.zentaoWork(sender,'p1',{kind:'bug'});expect(value.complete).toBe(true);expect(workCalls).toBe(2);expect(workTimes[1]-workTimes[0]).toBeGreaterThanOrEqual(1000);
 });
 it('OY-01 stops UI backoff when project permission is revoked and does not issue another request',async()=>{
  workFailures=5;workRetryAfter='1';const pending=app.zentaoWork(sender,'p1',{kind:'bug'}).then(()=>null,error=>error);await vi.waitFor(()=>expect(workCalls).toBe(1));const selected=await app.projectSettings(sender,'p1','zentao');await app.select(sender,{projectId:'p1',appId:'zentao',enabled:false,expectedRevision:selected.revision,connections:{zentao:connectionId}});const error=await pending;expect(error).toMatchObject({code:'CANCELED'});expect(workCalls).toBe(1);expect(f.sqlite.prepare("SELECT state,error_code,attempt_count FROM application_data_operations WHERE action='ui.zentao.work'").all()).toEqual([{state:'cancelled',error_code:'CANCELED',attempt_count:1}]);
 });
 it('lists only the current assigned-self source and preserves large exact IDs and a confirmed empty Story result',async()=>{
  const result=await list();expect(result).toMatchObject({kind:'bug',total:1,complete:true,nextCursor:null,problems:[],items:[{id,assignedTo:'tester',reference:{connectionId,identityRevision:1,nativeId:id}}]});expect(await list('story')).toMatchObject({items:[],total:0,complete:true});
  expect(paths.some(p=>p.includes('type=assignedTo'))).toBe(true);expect(paths.every(p=>!p.includes('zt-secret'))).toBe(true);
 });
 it('paginates with an opaque project/source-bound cursor and detects changed limits or duplicate pages',async()=>{
  objects.set('bug:8',{...initial(),fields:{...initial().fields,id:'8'}});const first=await list('bug',{limit:1});expect(first.complete).toBe(false);expect(first.nextCursor).toBeTypeOf('string');
  const second=await list('bug',{limit:1,cursor:first.nextCursor});expect(second).toMatchObject({items:[{id:'8'}],total:2,complete:true,nextCursor:null});
  expect(await call('work_list',{kind:'bug',limit:2,cursor:first.nextCursor})).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT'}});
  duplicatePage=true;expect(await list('bug',{limit:1,cursor:first.nextCursor})).toMatchObject({items:[],complete:false,nextCursor:null,problems:[{code:'INCOMPLETE_RESULT'}]});
 });
 it('retains the original successful page and cursor across a later-page failure and resumes only the missing page',async()=>{
  objects.set('bug:8',{...initial(),fields:{...initial().fields,id:'8'}});
  const first=await list('bug',{limit:1});expect(first).toMatchObject({items:[{id}],complete:false});
  const cursor=f.sqlite.prepare('SELECT * FROM application_zentao_cursors WHERE cursor_id=?').get(first.nextCursor);
  const original=f.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE native_id=?').all(id);
  workFailures=3;const failed=await call('work_list',{kind:'bug',limit:1,cursor:first.nextCursor});
  expect(failed).toMatchObject({status:'error',error:{code:'TRANSIENT_FAILURE',attemptCount:3,retryExhausted:true}});
  expect(f.sqlite.prepare('SELECT * FROM application_zentao_cursors WHERE cursor_id=?').get(first.nextCursor)).toEqual(cursor);
  expect(f.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE native_id=?').all(id)).toEqual(original);
  const recovered=await list('bug',{limit:1,cursor:first.nextCursor});
  expect(recovered).toMatchObject({items:[{id:'8',reference:{connectionId}}],complete:true,nextCursor:null});
  expect(paths.filter(p=>p.includes('/my/work?')).map(p=>new URL(p,base).searchParams.get('pageID'))).toEqual(['1','2','2','2','2']);
  expect(f.sqlite.prepare('SELECT * FROM application_zentao_revisions WHERE native_id=?').all(id)).toEqual(original);
  expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('returns a changed total as explicitly incomplete without pretending an empty complete search',async()=>{
  objects.set('bug:8',{...initial(),fields:{...initial().fields,id:'8'}});const first=await list('bug',{limit:1});totalChanged=true;expect(await list('bug',{limit:1,cursor:first.nextCursor})).toMatchObject({complete:false,nextCursor:null,problems:[{code:'INCOMPLETE_RESULT'}]});
 });
 it('uses the same current data for trusted UI and Agent and keeps full body,history and field values in bounded resources',async()=>{
  const large='完整描述'.repeat(60000);objects.get('bug:'+id)!.fields.steps=large;objects.get('bug:'+id)!.fields.largeField={full:'L'.repeat(20000)};
  const found=await app.zentaoWork(sender,'p1',{kind:'bug'}) as ZentaoWorkData;const object=await detail(found.items[0].reference);expect(object).toMatchObject({complete:true,missing:[],id});expect(object.fields).not.toHaveProperty('steps');
  expect(JSON.parse((await whole(object.body!)).toString()).steps).toBe(large);expect(JSON.parse((await whole(object.history!)).toString())[0].comment).toBe('完整历史');expect(JSON.parse((await whole(object.fields.largeField as ApplicationResourceRef)).toString()).full).toHaveLength(20000);
  const ui=await app.zentaoObject(sender,'p1',{kind:'bug',reference:found.items[0].reference}) as ZentaoDetailData;expect(ui.reference).toEqual(object.reference);expect(ui.body).toEqual(object.body);
 // Multiple real provider/resource requests for a 720KB UTF-8 body share this
 // integration-test budget. Individual production request deadlines are unchanged.
 },20000);
 it('reads nested Story description and acceptance criteria without incorrectly marking the body missing',async()=>{
  objects.set('story:8',{fields:{id:'8',title:'研发需求',status:'active',assignedTo:{account:'tester'},spec:{spec:'<p>需求原文</p>',verify:'验收标准'},files:[]},actions:[]});
  const found=await list('story'),object=await detail(found.items[0].reference,'story');expect(object.complete).toBe(true);expect(JSON.parse((await whole(object.body!)).toString())).toEqual({spec:{spec:'<p>需求原文</p>',verify:'验收标准'}});
 });
 it('keeps Bug and Story with the same numeric ID separate through real tool contracts and stored resources',async()=>{
  objects.set('story:'+id,{fields:{id,title:'Same ID Story',status:'active',assignedTo:{account:'tester'},spec:{spec:'STORY_ONLY_BODY',verify:'STORY_ONLY_CRITERIA'},files:[]},actions:[]});
  const bug=(await list('bug')).items[0].reference,story=(await list('story')).items[0].reference;
  expect(bug.nativeId).toBe(story.nativeId);expect(bug.connectionId).toBe(story.connectionId);expect(bug.contentRevision).not.toBe(story.contentRevision);
  const a=await detail(bug,'bug'),b=await detail(story,'story');expect(a.body!.id).not.toBe(b.body!.id);
  expect(JSON.parse((await whole(a.body!)).toString()).steps).toBe('<p>复现步骤</p>');expect(JSON.parse((await whole(b.body!)).toString()).spec.spec).toBe('STORY_ONLY_BODY');
  const before=paths.length;
  for(const input of [{kind:'story',reference:bug},{kind:'bug',reference:story}])expect(await call('object_get',input)).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});
  expect(paths).toHaveLength(before);
 });
 it('downloads ordinary,historical and inline files only through the fixed same-origin API and preserves binary bytes',async()=>{
  const object=objects.get('bug:'+id)!;object.fields.files=[{id:'11',title:'binary',extension:'bin',size:4}];object.fields.steps='<img src="/biz/file-read-22.png?x=1&amp;y=2"><img src="https://outside.example.test/file-read-99.png">';object.actions=[{comment:'历史',files:{'12':{id:'12',title:'history',size:3}}}];files.set('11',Buffer.from([0,255,128,1]));files.set('12',Buffer.from('old'));files.set('22',Buffer.from('img'));
  const objectData=await detail((await list()).items[0].reference);expect(objectData.complete).toBe(true);expect(objectData.attachments.map(a=>a.filename)).toEqual(['binary.bin','history','file-22']);expect(await whole(objectData.attachments[0].resource)).toEqual(files.get('11'));
  expect(paths.filter(p=>p.includes('/files/')).every(p=>/^\/biz\/api.php\/v1\/files\/(11|12|22)$/.test(p))).toBe(true);expect(outside).toBe(0);
 });
 it('reports missing,oversized and redirected files as partial without following a supplied URL or claiming complete',async()=>{
  objects.get('bug:'+id)!.fields.files=[{id:'11',name:'redirect',size:1},{id:'12',name:'too-large',size:25*1024*1024+1},{id:'13',name:'missing',size:2}];fileFailures.set('11',302);
  const object=await detail((await list()).items[0].reference);expect(object.complete).toBe(false);expect(object.attachments).toEqual([]);expect(object.missing).toEqual(expect.arrayContaining(['attachment:11:CONNECTION_UNAVAILABLE','attachment:12:TOO_LARGE','attachment:13:NOT_FOUND']));expect(paths).not.toContain('/biz/api.php/v1/files/12');expect(outside).toBe(0);
 });
 it('does not treat malformed history and file metadata as a complete object',async()=>{
  objects.get('bug:'+id)!.actions='unsupported-history';objects.get('bug:'+id)!.fields.files='unsupported-files';const result=await detail((await list()).items[0].reference);expect(result).toMatchObject({complete:false,history:null,attachments:[]});expect(result.missing).toEqual(expect.arrayContaining(['history','attachments','attachment-metadata']));
 });
 it('rejects forged or foreign-project source references and resource metadata before exposing data',async()=>{
  const found=await list(),reference=found.items[0].reference,object=await detail(reference);const count=paths.length;
  for(const change of [{contentRevision:'a'.repeat(64)},{connectionId:randomUUID()}])expect(await call('object_get',{kind:'bug',reference:{...reference,...change}})).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});expect(paths).toHaveLength(count);
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','other project',1,1)");await app.select(sender,{projectId:'p2',appId:'zentao',enabled:true,connections:{zentao:connectionId},expectedRevision:0});
  await expect(app.zentaoObject(sender,'p2',{kind:'bug',reference})).rejects.toMatchObject({code:'NOT_FOUND'});await expect(app.zentaoResource(sender,'p2',{resource:object.body,offset:0,length:20})).rejects.toMatchObject({code:'NOT_FOUND'});
  expect(await call('resource',{resource:{...object.body!,revision:'b'.repeat(64)},offset:0,length:10})).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});
 });
 it('rejects an actual other-project connection ID before invoking the same fixed tool',async()=>{
  const other=await saveConnection(base.replace('/biz/','/other/'));
  f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','same tool, different source',1,1)");
  await app.select(sender,{projectId:'p2',appId:'zentao',enabled:true,connections:{zentao:other.id},expectedRevision:0});
  const before=paths.length,requestId=randomUUID();
  const denied=await tools.call(owned.runId,requestId,{operation:'smartdd_zentao_work_list_v1',contractMajor:1,connectionId:other.id,arguments:{kind:'bug'}});
  expect(denied).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(paths).toHaveLength(before);
  expect((await list()).items[0].reference.connectionId).toBe(connectionId);
  expect(app.selections.projectSettings('p2','zentao').connections.zentao).toBe(other.id);
  expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('withholds late HTTP bytes after a source switch and retains the original operation identity',async()=>{
  objects.get('bug:'+id)!.fields.steps='ORIGINAL_SOURCE_LATE_BYTES';
  const reference=(await list()).items[0].reference,other=await saveConnection(base.replace('/biz/','/other/'));
  const ready=new Promise<void>(r=>entered=r);holdDetail=true;
  const pending=call('object_get',{kind:'bug',reference});await ready;
  const settings=app.selections.projectSettings('p1','zentao');
  await app.select(sender,{projectId:'p1',appId:'zentao',enabled:true,connections:{zentao:other.id},expectedRevision:settings.revision});
  held?.();const denied=await pending;expect(denied).toMatchObject({status:'error',error:{code:'CANCELED'}});
  expect(JSON.stringify(denied)).not.toContain('ORIGINAL_SOURCE_LATE_BYTES');
  const row=f.sqlite.prepare('SELECT project_id,state,error_code,targets_json FROM application_data_operations WHERE operation_id=?').get(denied.operationId) as {project_id:string;state:string;error_code:string;targets_json:string};
  expect(row).toMatchObject({project_id:'p1',state:'cancelled',error_code:'CANCELED'});
  expect(JSON.parse(row.targets_json)).toEqual([expect.objectContaining({slot:'zentao',id:connectionId,identityRevision:1,configRevision:1})]);
  objects.set('bug:'+id,{...initial(),fields:{...initial().fields,steps:'CURRENT_SOURCE_B_BYTES'}});
  const current=await detail((await list()).items[0].reference);
  expect(current.reference.connectionId).toBe(other.id);const body=(await whole(current.body!)).toString();
  expect(body).toContain('CURRENT_SOURCE_B_BYTES');expect(body).not.toContain('ORIGINAL_SOURCE_LATE_BYTES');
  expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('rechecks assignment for detail,old resources and cached list/detail/resource receipts',async()=>{
  const listId=randomUUID(),listInput={kind:'bug'},listed=await call('work_list',listInput,listId);expect(listed.status).toBe('ok');if(listed.status!=='ok')throw new Error();const reference=(listed.value as ZentaoWorkData).items[0].reference;
  const detailId=randomUUID(),detailInput={kind:'bug',reference},loaded=await call('object_get',detailInput,detailId);if(loaded.status!=='ok')throw new Error(JSON.stringify(loaded));const object=loaded.value as ZentaoDetailData;
  const readId=randomUUID(),readInput={resource:object.body,offset:0,length:100},read=await call('resource',readInput,readId);expect(read.status).toBe('ok');objects.get('bug:'+id)!.fields.assignedTo={account:'someone-else'};
  for(const [name,args,requestId,original] of [['work_list',listInput,listId,listed],['object_get',detailInput,detailId,loaded],['resource',readInput,readId,read]] as const){const response=await call(name,args,requestId);expect(response).toMatchObject({status:'error',operationId:original.operationId,error:{code:'SCOPE_DENIED',effectState:'read-only',attemptCount:1}});expect(JSON.stringify(response)).not.toContain('复现步骤');}
  expect(await call('object_get',detailInput)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(await call('resource',readInput)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
 });
 it('does not replay cached attachment bytes once the file no longer belongs to the current assigned object',async()=>{
  objects.get('bug:'+id)!.fields.files=[{id:'11',name:'file',size:3}];files.set('11',Buffer.from('abc'));const object=await detail((await list()).items[0].reference),requestId=randomUUID(),input={resource:object.attachments[0].resource,offset:0,length:3};const read=await call('resource',input,requestId);expect(read.status).toBe('ok');objects.get('bug:'+id)!.fields.files=[];
  expect(await call('resource',input,requestId)).toMatchObject({status:'error',operationId:read.operationId,error:{code:'SOURCE_UNAVAILABLE',attemptCount:1}});expect(await call('resource',input)).toMatchObject({status:'error',error:{code:'SOURCE_UNAVAILABLE'}});
 });
 it('keeps old explicit revisions readable while new detail and changed file bytes get new references',async()=>{
  objects.get('bug:'+id)!.fields.files=[{id:'11',name:'file',size:3}];files.set('11',Buffer.from('abc'));const reference=(await list()).items[0].reference,old=await detail(reference);objects.get('bug:'+id)!.fields.steps='第二版';files.set('11',Buffer.from('xyz'));const current=await detail(reference);
  expect(current.reference.contentRevision).not.toBe(old.reference.contentRevision);expect(current.body!.id).not.toBe(old.body!.id);expect(JSON.parse((await whole(old.body!)).toString()).steps).toBe('<p>复现步骤</p>');expect(JSON.parse((await whole(current.body!)).toString()).steps).toBe('第二版');expect(await whole(old.attachments[0].resource)).toEqual(Buffer.from('abc'));expect(await whole(current.attachments[0].resource)).toEqual(Buffer.from('xyz'));
 });
 it('invalidates old cursors and references on explicit connection switch without changing the original fixed package',async()=>{
  objects.set('bug:8',{...initial(),fields:{...initial().fields,id:'8'}});const first=await list('bug',{limit:1}),other=await saveConnection(base.replace('/biz/','/other/')),old=app.selections.projectSettings('p1','zentao');await app.select(sender,{projectId:'p1',appId:'zentao',enabled:true,connections:{zentao:other.id},expectedRevision:old.revision});
  expect(await call('object_get',{kind:'bug',reference:first.items[0].reference})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(await call('work_list',{kind:'bug',limit:1,cursor:first.nextCursor})).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT'}});expect((await list()).items[0].reference.connectionId).toBe(other.id);expect(f.runs.assertActive(owned.runId).snapshot.packages[0].packageHash).toBe(f.application!.packageHash);
 });
 it('uses a rotated current secret under the same identity and never persists it in business operations or fetched payloads',async()=>{
  const found=await list(),old=app.connections.get(connectionId);acceptedTokens.add('rotated-zt-secret');const tested=await app.testConnection(sender,{id:connectionId,expectedRevision:old.revision,name:old.name,config:old.config,secret:'rotated-zt-secret'});await app.saveConnection(sender,'zentao',tested.operationId,tested.candidateHash);acceptedTokens.delete('zt-secret-canary');await app.connections.reportHealth(connectionId,old,'AUTH_FAILED');expect(app.connections.get(connectionId).health).toBe('healthy');const before=tokens.length;
  expect((await detail(found.items[0].reference)).complete).toBe(true);expect(tokens.slice(before).every(t=>t==='rotated-zt-secret')).toBe(true);
  const audit=JSON.stringify(f.sqlite.prepare('SELECT * FROM application_data_operations').all())+JSON.stringify(f.sqlite.prepare('SELECT * FROM application_zentao_revisions').all());expect(audit).not.toContain('rotated-zt-secret');expect(audit).not.toContain('zt-secret-canary');
 });
 it('uses the single outer read retry budget for transient failures and never retries explicit authentication failure',async()=>{
  workFailures=2;const result=await call('work_list',{kind:'bug'});expect(result.status,JSON.stringify(result)).toBe('ok');expect(workCalls).toBe(3);expect(f.sqlite.prepare("SELECT attempt_count,state FROM application_invocations WHERE operation_id=?").get(result.operationId!)).toEqual({attempt_count:3,state:'succeeded'});
  acceptedTokens.clear();const failure=await call('work_list',{kind:'bug'});expect(failure).toMatchObject({status:'error',error:{code:'AUTH_FAILED',attemptCount:1,retryable:false}});expect(JSON.stringify(failure)).not.toContain('zt-secret');
 });
 it.each(['seconds','http-date'] as const)('does not send another provider request when Retry-After %s exceeds the one original deadline',async form=>{
  workFailures=1;workRetryAfter=form==='seconds'?'31':new Date(Date.now()+61_000).toUTCString();
  const result=await call('work_list',{kind:'bug'});
  expect(result).toMatchObject({status:'error',error:{code:'TRANSIENT_FAILURE',attemptCount:1,retryable:true,retryExhausted:true,effectState:'read-only'}});expect(workCalls).toBe(1);
  expect(f.sqlite.prepare('SELECT state,attempt_count,error_code FROM application_invocations WHERE operation_id=?').get(result.operationId!)).toEqual({state:'failed',attempt_count:1,error_code:'TRANSIENT_FAILURE'});expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('does not shorten a valid Retry-After even when local retry delays are zero',async()=>{
  workFailures=1;workRetryAfter='1';const result=await call('work_list',{kind:'bug'});expect(result.status).toBe('ok');expect(workCalls).toBe(2);expect(workTimes[1]-workTimes[0]).toBeGreaterThanOrEqual(1000);expect(f.sqlite.prepare('SELECT attempt_count,state FROM application_invocations WHERE operation_id=?').get(result.operationId!)).toEqual({attempt_count:2,state:'succeeded'});
 });
 it('does not retry a rate-limited read whose Retry-After exceeds the remaining budget',async()=>{
  workFailures=1;workFailureStatus=429;workRetryAfter='31';const result=await call('work_list',{kind:'bug'});expect(result).toMatchObject({status:'error',error:{code:'TRANSIENT_FAILURE',attemptCount:1,retryExhausted:true,nextAction:'本次重试已结束，请稍后明确重试'}});expect(workCalls).toBe(1);
 });
 it.each([{status:401,code:'AUTH_FAILED'},{status:403,code:'SCOPE_DENIED'}])('does not use Retry-After to retry permanent HTTP$status authentication or scope denial',async({status,code})=>{
  workFailures=1;workFailureStatus=status;workRetryAfter='31';const result=await call('work_list',{kind:'bug'});expect(result).toMatchObject({status:'error',error:{code,attemptCount:1,retryable:false,retryExhausted:false}});expect(workCalls).toBe(1);
 });
 it('cancels during Retry-After backoff without another HTTP attempt or an Agent restart',async()=>{
  workFailures=3;workRetryAfter='3';const request=randomUUID(),abort=new AbortController(),pending=call('work_list',{kind:'bug'},request,abort.signal);
  await vi.waitFor(()=>{expect(f.sqlite.prepare('SELECT state,attempt_count FROM application_invocations WHERE request_id=?').get(request)).toEqual({state:'running',attempt_count:1});expect(f.sqlite.prepare("SELECT count(*) n FROM application_data_operations WHERE caller_kind='agent-run' AND state='failed' AND error_code='TRANSIENT_FAILURE'").get()).toEqual({n:1});});
  abort.abort();expect(await pending).toMatchObject({status:'error',error:{code:'CANCELED',attemptCount:1,retryable:false,effectState:'read-only'}});expect(workCalls).toBe(1);expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('ignores an invalid Retry-After without adding a second transport retry layer',async()=>{
  workFailures=2;workRetryAfter='-1';const result=await call('work_list',{kind:'bug'});expect(result.status).toBe('ok');expect(workCalls).toBe(3);expect(f.sqlite.prepare('SELECT attempt_count FROM application_invocations WHERE operation_id=?').get(result.operationId!)).toEqual({attempt_count:3});
 });
 it('withholds an injected outside-assignee list and never records it as fetched project data',async()=>{
  intruder=true;expect(await call('work_list',{kind:'bug'})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(f.sqlite.prepare('SELECT count(*) n FROM application_zentao_revisions').get()).toEqual({n:0});
 });
});


describe('ZenTao current health,cancellation and source disappearance',()=>{
 it('updates current health separately from the saved test and recovers without changing policy or secret revisions',async()=>{
  const original=app.connections.get(connectionId),before=changes;acceptedTokens.clear();expect(await call('work_list',{kind:'bug'})).toMatchObject({status:'error',error:{code:'AUTH_FAILED'}});
  expect(app.connections.get(connectionId)).toMatchObject({health:'unavailable',healthCode:'AUTH_FAILED',testedAt:original.testedAt,identityRevision:original.identityRevision,configRevision:original.configRevision,secretRevision:original.secretRevision,policyRevision:original.policyRevision});
  acceptedTokens.add('zt-secret-canary');expect((await list()).complete).toBe(true);expect(app.connections.get(connectionId)).toMatchObject({health:'healthy',healthCode:null,testedAt:original.testedAt});expect(changes-before).toBe(2);await list();expect(changes-before).toBe(2);
 });
 it('does not return old body bytes as current data after the source object disappears',async()=>{
  const reference=(await list()).items[0].reference,object=await detail(reference);objects.delete('bug:'+id);expect(await call('object_get',{kind:'bug',reference})).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});
  expect(await call('resource',{resource:object.body,offset:0,length:50})).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});expect((await list()).items).toEqual([]);
 });
 it('cancels an active read on connection disconnect and withholds the late HTTP result',async()=>{
  const reference=(await list()).items[0].reference,ready=new Promise<void>(r=>entered=r);holdDetail=true;const pending=call('object_get',{kind:'bug',reference});await ready;
  const old=app.connections.get(connectionId);await app.disconnect(sender,connectionId,old.revision);expect(await pending).toMatchObject({status:'error',error:{code:'CANCELED',effectState:'read-only'}});held?.();
  expect(f.runs.get(owned.runId).state).toBe('active');expect(app.connections.get(connectionId).authorization).toBe('disconnected');
 });
 it('bounds a cancelled cached-receipt permission check without restarting the Agent or replaying the original read',async()=>{
  const reference=(await list()).items[0].reference,requestId=randomUUID(),input={kind:'bug',reference},first=await call('object_get',input,requestId);expect(first.status).toBe('ok');
  holdDetail=true;const ready=new Promise<void>(r=>entered=r),abort=new AbortController(),checking=call('object_get',input,requestId,abort.signal);await ready;abort.abort();
  expect(await checking).toMatchObject({status:'error',operationId:first.operationId,error:{code:'CANCELED',effectState:'read-only',attemptCount:1}});held?.();expect(f.runs.get(owned.runId).state).toBe('active');
  expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations WHERE request_id=?').get(requestId)).toEqual({n:1});
 });
});


it('reconstructs the business service with the same persisted source and resource revisions without relying on a prior in-memory client',async()=>{
 objects.get('bug:'+id)!.fields.files=[{id:'11',name:'retained',size:3}];files.set('11',Buffer.from('abc'));const reference=(await list()).items[0].reference,original=await detail(reference);
 await app.dispose();app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:e=>access.requireSender(e),mailWorker:join(f.root,'unused-worker'),foxmailNative:join(f.root,'unused-native'),changed:(change?:unknown)=>{changes++;changeEvents.push(change);}});await app.recover();app.attachRuns(f.runs);tools=new ApplicationToolService(f.store,f.runs,new ApplicationAdapterRegistry(f.store,app.data));
 const loaded=await detail(reference);expect(loaded.body).toEqual(original.body);expect(loaded.attachments).toEqual(original.attachments);expect(await whole(original.attachments[0].resource)).toEqual(Buffer.from('abc'));expect(JSON.parse((await whole(original.body!)).toString()).steps).toBe('<p>复现步骤</p>');
});


it('binds stored source content to its canonical revision and rejects a corrupt retained reference before requesting fresh data',async()=>{
 const reference=(await list()).items[0].reference;await detail(reference);
 const rows=f.sqlite.prepare('SELECT payload_json,content_revision,representation FROM application_zentao_revisions').all() as {payload_json:string;content_revision:string;representation:string}[];
 for(const row of rows){expect(createHash('sha256').update(row.payload_json).digest('hex')).toBe(row.content_revision);if(row.representation==='detail'){const source=JSON.parse(row.payload_json);expect(source).not.toHaveProperty('missing');expect(source).not.toHaveProperty('complete');}}
 const requests=paths.length;f.sqlite.prepare("UPDATE application_zentao_revisions SET payload_json='{}' WHERE representation='summary'").run();expect(await call('object_get',{kind:'bug',reference})).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});expect(paths).toHaveLength(requests);
});

// T02 controller/service integration. Cipher, native process and Electron sender
// are explicit fixtures; actual HTTP/SQLite participate, not packaged UI or safeStorage.
function connectionRpc(){
 const handlers=new Map<string,(event:IpcMainInvokeEvent,...args:unknown[])=>unknown>();
 registerRPCRouter({applications:createApplicationController(app,event=>access.requireSender(event))},{handle:(name:string,handler:(event:IpcMainInvokeEvent,...args:unknown[])=>unknown)=>handlers.set(name,handler)} as never);
 return async<T=unknown>(name:string,...args:unknown[]):Promise<ApplicationDataReply<T>>=>await handlers.get('applications.'+name)!(sender,...args) as ApplicationDataReply<T>;
}
const connectionRows=()=>f.sqlite.prepare('SELECT * FROM application_connections ORDER BY id').all();
const snapshotRows=()=>f.sqlite.prepare('SELECT * FROM capability_session_snapshots ORDER BY task_id').all();
describe('T02 saved verification, directory refresh and same-identity authentication recovery',()=>{
 it('keeps saved A/B after an independent directory failure, retries only the list, and reconnects expired A without borrowing B or activating a candidate early',async()=>{
  const invoke=connectionRpc();acceptedTokens.add('zt-secret-B');const b=await saveConnection(base.replace('/biz/','/other/'),'zt-secret-B'),a=app.connections.get(connectionId),rows=connectionRows(),snapshots=snapshotRows(),selection=app.selections.projectSettings('p1','zentao');
  const requests=paths.length,secretChanges=f.sqlite.prepare('SELECT * FROM application_secret_changes ORDER BY operation_id').all();
  vi.spyOn(app.connections,'list').mockImplementationOnce(()=>{throw new Error('directory unavailable; do not echo zt-secret-canary');});
  const failed=await invoke('connections','zentao');expect(failed).toEqual({ok:false,code:'CAPABILITY_UNAVAILABLE',message:'本次应用操作未完成，请重新载入后核对状态'});expect(JSON.stringify(failed)).not.toContain('zt-secret');expect(connectionRows()).toEqual(rows);expect(app.connections.get(connectionId)).toEqual(a);expect(app.connections.get(b.id)).toEqual(b);
  const refreshed=await invoke<ApplicationConnection[]>('connections','zentao');expect(refreshed).toEqual({ok:true,value:expect.arrayContaining([a,b])});if(!refreshed.ok)throw new Error('directory retry failed');expect(refreshed.value).toHaveLength(2);expect(paths).toHaveLength(requests);expect(f.sqlite.prepare('SELECT * FROM application_secret_changes ORDER BY operation_id').all()).toEqual(secretChanges);
  acceptedTokens.delete('zt-secret-canary');const expired=await call('work_list',{kind:'bug'});expect(expired).toMatchObject({status:'error',error:{code:'AUTH_FAILED',attemptCount:1,retryable:false}});expect(JSON.stringify(expired)).not.toContain('zt-secret');expect(app.connections.get(connectionId)).toMatchObject({id:a.id,health:'unavailable',healthCode:'AUTH_FAILED',testedAt:a.testedAt,identity:a.identity});expect(app.connections.get(b.id)).toEqual(b);
  acceptedTokens.add('zt-secret-A-restored');const unavailable=app.connections.get(connectionId),tested=await invoke<VerifiedConnectionCandidate>('testConnection',{id:a.id,expectedRevision:unavailable.revision,name:a.name,config:a.config,secret:'zt-secret-A-restored'});expect(tested.ok).toBe(true);if(!tested.ok)throw new Error('candidate failed');
  expect(app.connections.get(connectionId)).toEqual(unavailable);expect(await call('work_list',{kind:'bug'})).toMatchObject({status:'error',error:{code:'AUTH_FAILED',attemptCount:1}});
  const saved=await invoke<ApplicationConnection>('saveConnection','zentao',tested.value.operationId,tested.value.candidateHash);expect(saved.ok).toBe(true);if(!saved.ok)throw new Error('reconnect failed');expect(saved.value).toMatchObject({id:a.id,identity:a.identity,identityRevision:a.identityRevision,configRevision:a.configRevision,policyRevision:a.policyRevision,secretRevision:a.secretRevision+1,health:'healthy'});expect(saved.value.revision).toBe(a.revision+1);expect(Date.parse(saved.value.testedAt!)).toBeGreaterThanOrEqual(Date.parse(a.testedAt!));
  const at=paths.length,recovered=await list();expect(recovered).toMatchObject({complete:true,items:[{reference:{connectionId:a.id}}]});expect(tokens.slice(at)).not.toHaveLength(0);expect(tokens.slice(at).every(token=>token==='zt-secret-A-restored')).toBe(true);expect(paths.slice(at).every(path=>path.startsWith('/biz/'))).toBe(true);
  const final=await invoke<ApplicationConnection[]>('connections','zentao');expect(final.ok).toBe(true);if(!final.ok)throw new Error('final directory failed');expect(final.value).toHaveLength(2);expect(final.value.find(x=>x.id===a.id)).toMatchObject({health:'healthy',identity:a.identity,testedAt:saved.value.testedAt});expect(app.connections.get(b.id)).toEqual(b);expect(app.selections.projectSettings('p1','zentao')).toEqual(selection);expect(snapshotRows()).toEqual(snapshots);expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('does not let a delayed real HTTP authentication failure overwrite the newly verified A or change B',async()=>{
  acceptedTokens.add('zt-secret-B');const b=await saveConnection(base.replace('/biz/','/other/'),'zt-secret-B'),a=app.connections.get(connectionId),snapshots=snapshotRows();acceptedTokens.delete('zt-secret-canary');holdAuthResponse=true;const ready=new Promise<void>(resolve=>authEntered=resolve),pending=call('work_list',{kind:'bug'});await ready;
  acceptedTokens.add('zt-secret-A-newer');const tested=await app.testConnection(sender,{id:a.id,expectedRevision:a.revision,name:a.name,config:a.config,secret:'zt-secret-A-newer'}),saved=await app.saveConnection(sender,'zentao',tested.operationId,tested.candidateHash);heldAuthResponse?.();const late=await pending;expect(late.status).toBe('error');if(late.status!=='error')throw new Error('late operation returned data');expect(['CANCELED','AUTH_FAILED']).toContain(late.error.code);expect(late).not.toHaveProperty('value');expect(app.connections.get(a.id)).toMatchObject({health:'healthy',testedAt:saved.testedAt,secretRevision:saved.secretRevision,identity:a.identity});expect(app.connections.get(b.id)).toEqual(b);
  const at=paths.length;expect((await list()).complete).toBe(true);expect(tokens.slice(at).every(token=>token==='zt-secret-A-newer')).toBe(true);expect(app.connections.get(a.id).healthCode).not.toBe('AUTH_FAILED');expect(snapshotRows()).toEqual(snapshots);expect(app.connections.list('zentao')).toHaveLength(2);expect(f.runs.get(owned.runId).state).toBe('active');
 });
 it('rejects a reconnect token identifying another account instead of silently replacing A, and preserves B and the original binding',async()=>{
  acceptedTokens.add('zt-secret-B');const b=await saveConnection(base.replace('/biz/','/other/'),'zt-secret-B'),a=app.connections.get(connectionId),selection=app.selections.projectSettings('p1','zentao'),snapshots=snapshotRows();acceptedTokens.delete('zt-secret-canary');expect(await call('work_list',{kind:'bug'})).toMatchObject({status:'error',error:{code:'AUTH_FAILED'}});const unavailable=app.connections.get(a.id);acceptedTokens.add('zt-secret-other-account');profileIds.set('/biz/',8);
  const invoke=connectionRpc(),denied=await invoke('testConnection',{id:a.id,expectedRevision:unavailable.revision,name:a.name,config:a.config,secret:'zt-secret-other-account'});expect(denied).toMatchObject({ok:false,code:'IDENTITY_CHANGE_REQUIRES_SELECTION'});expect(JSON.stringify(denied)).not.toContain('zt-secret');expect(app.connections.get(a.id)).toEqual(unavailable);expect(app.connections.get(a.id).identity).toEqual(a.identity);expect(app.connections.get(b.id)).toEqual(b);expect(app.connections.list('zentao')).toHaveLength(2);expect(app.selections.projectSettings('p1','zentao')).toEqual(selection);expect(snapshotRows()).toEqual(snapshots);expect(f.sqlite.prepare('SELECT count(*) AS n FROM app_secrets').get()).toEqual({n:2});expect(f.runs.get(owned.runId).state).toBe('active');
 });
});
