import {EventEmitter} from 'node:events';
import {createServer,type Server} from 'node:http';
import type {Socket} from 'node:net';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {builtinApplicationModules} from '../modules';
import type {ApplicationResourceRef} from '@shared/application-data';
import {canonicalJson,digest} from '../manifest';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import type {CapabilitySessionSnapshot} from '@shared/application-session';
import {applicationNativeSkillName} from '@shared/application-session';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import type {ApplicationResultV2} from '@shared/application-result';
import type {ZentaoWorkData,ZentaoDetailData} from '@shared/application-zentao';
import type {ApplicationResourceChunk} from '@shared/application-data';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
import {CapabilityBundleSource} from '../bundle-source';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {ApplicationService} from '../application-service';
import {applicationSkillContentHash} from '../session-registry';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {createApplicationRunPlan} from '../run-plan';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';

let f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,runs:CapabilityRunRegistry,server:Server,sockets:Set<Socket>,owned:OwnedCapabilityRun[],connectionId:string;
let available:boolean,incomplete:boolean,providerCalls:number,duplicatePage:boolean,totalChanged:boolean;
let v1Hash:string,v2Hash:string,paths:string[],traces:unknown[];
const delivery=resolve('delivery/attempt-002');mkdirSync(delivery,{recursive:true});
const ids=['9007199254740997','51','23','11','8'];
const longBody='<p>按原始字符保存 '+ '🙂中文&x'.repeat(1600)+'</p>';
const history=[{action:'opened',comment:'完整历史'+ '更新🙂'.repeat(1300)}];
const attachment=Buffer.from(Array.from({length:6005},(_,i)=>(i*37)%256));
const fieldLong='原始自定义字段'+ '字段🙂'.repeat(1100);
const bytes=(v:ApplicationResourceChunk)=>Buffer.from(v.data,v.encoding==='base64'?'base64':'utf8');
type Entry='cli'|'v1'|'page';
const senderFrame={};
const sender={sender:Object.assign(new EventEmitter(),{id:808,isDestroyed:()=>false,mainFrame:senderFrame}),senderFrame} as unknown as import('../execution-context').ApplicationUiSender;
const body='<p>synthetic bug body '+ 'x'.repeat(6000)+'</p>';
const id='79291';
function tool(run:OwnedCapabilityRun,entry:'cli'|'mcp',operation:string,args:Record<string,unknown>){return new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry,retryDelays:[0,0]}).call(run.runId,randomUUID(),{operation,contractMajor:2,connectionId:null,arguments:args});}
function value<T>(response:Awaited<ReturnType<typeof tool>>){expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw Error(JSON.stringify(response));return response.value as ApplicationResultV2&{data:T};}
async function start(version:'v1'|'v2'='v2'){
 const target=version==='v1'?v1Hash:v2Hash,active=app.builtin.packages.active('zentao')!;if(active.packageHash!==target)await app.builtin.packages.activate(target,active.generation);
 const original=f.plan('codex'),selected=app.builtin.packages.get(target),manifest=selected.manifest,isV2=manifest.schema==='smartdd-app-package-v2';
 const adapter=isV2?f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!:f.installedAdapters.find(a=>a.metadata.agentId==='codex')!,bridge=original.mcp.find(m=>m.kind==='applications')!,tools=applicationToolDeclarations(manifest);
 const snapshot:CapabilitySessionSnapshot={...original,schema:isV2?3:2,standardSkills:[],agentAtCreation:{version:isV2?'0.166.0':adapter.metadata.cliVersions[0],adapterRevision:1},adapterBinding:{...original.adapterBinding,version:adapter.metadata.version,hash:adapter.hash,nativeToolNames:Object.fromEntries(tools.map(t=>[t.name,`mcp__${bridge.serverName}__${t.name}`]))},packages:[{appId:'zentao',version:manifest.version,packageHash:selected.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(tools.map(t=>[t.name,t.contractMajor])),...(isV2?{capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),entry:'cli' as const}:{}),skills:manifest.skills.map(s=>{const nativeName=applicationNativeSkillName('zentao',s.id,selected.packageHash);return{skillId:s.id,nativeName,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',nativeName,'SKILL.md')};}),allowedOperations:['zentao.read'],bindings:[{bindingId:'p1:zentao:zentao',connectionId,identityRevision:1}]}],mcp:original.mcp.map(m=>m.kind==='applications'?{...m,runtimeHash:manifest.runtime.hash}:m)} as CapabilitySessionSnapshot;
 const session=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});owned.push(run);await run.prepare();await run.cli.arm();const pid=43100+owned.length;reader.identities.set(pid,'darwin-proc-v1:500:'+pid);await run.cli.attach(pid);traces.push({runId:run.runId,packageHash:selected.packageHash,version:manifest.version,entry:version==='v1'?'mcp':'cli',snapshotHash:session.pointer.snapshotHash});return run;
}
let reader:FixtureProcessReader;
beforeEach(async()=>{
 available=true;incomplete=false;providerCalls=0;duplicatePage=false;totalChanged=false;owned=[];sockets=new Set();paths=[];traces=[];
 server=createServer((req,res)=>{providerCalls++;const url=new URL(req.url!,'http://127.0.0.1'),json=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};paths.push(url.pathname+url.search);
  if(req.headers.token!=='synthetic-zt-token')return json({},401);
  if(url.pathname.endsWith('/v1/user'))return json({profile:{id:'7',account:'tester'}});
  if(url.pathname.endsWith('/v1/langs'))return json({bug:{statusList:{active:'激活'},priList:{3:'P2'},severityList:{3:'较大'}}});
  if(url.pathname.endsWith('/v2/my/work')){const kind=url.searchParams.get('mode'),page=Number(url.searchParams.get('pageID')),size=Number(url.searchParams.get('recPerPage')),rows=kind==='bug'?ids.map(id=>({id,title:'Synthetic Bug '+id,status:'active',assignedTo:{account:'tester'}})):[],current=duplicatePage&&page>1?1:page,total=rows.length+(totalChanged&&page>1?1:0);return json({mode:kind,type:'assignedTo',pager:{recTotal:total,pageID:page,recPerPage:size,pageTotal:Math.ceil(total/size)},[kind==='bug'?'bugs':'stories']:rows.slice((current-1)*size,current*size)});}
  const match=/\/v1\/bugs\/([0-9]+)$/.exec(url.pathname);
  if(match&&ids.includes(match[1]))return json({bug:{id:match[1],title:'Synthetic Bug '+match[1],status:'active',pri:3,severity:3,assignedTo:{account:'tester'},product:{id:'96',name:'Synthetic Product'},customLong:fieldLong,steps:incomplete?undefined:longBody,files:[{id:'44',title:'binary.dat',size:attachment.length}]},actions:incomplete?undefined:history});
  if(url.pathname.endsWith('/v1/files/44')){res.writeHead(200,{'content-type':'application/octet-stream','content-length':attachment.length});res.end(attachment);return;}
  return json({},404);
 });server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
 f=await agentFixture({applicationVersion:'9.0.0'});const source=new CapabilityBundleSource(process.env.WILLYOU_TEST_BUNDLES??resolve('out/capability-bundles'));await new RuntimeRegistry(f.store).install(source.runtime());const trusted=new BuiltinPackageRegistry(f.store),installed=await trusted.install(source,source.index.apps.find(a=>a.appId==='zentao')!);v2Hash=installed.packageHash;const retained=new CapabilityBundleSource(resolve('out/capability-bundles-compatibility-v1'));const v1=await trusted.install(retained,retained.index.apps.find(a=>a.appId==='zentao')!);v1Hash=v1.packageHash;await trusted.packages.activate(v2Hash,trusted.packages.active('zentao')!.generation);
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);reader=new FixtureProcessReader();app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-executed'),foxmailNative:join(f.root,'not-executed'),processes:reader,uiReadRetryDelays:[0,0]});await app.recover();await app.setAdded(sender,'zentao',true,0);
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'Synthetic ZenTao',config:{kind:'zentao',baseUrl:`http://127.0.0.1:${address.port}/biz/`,username:'tester',authMode:'token'},secret:'synthetic-zt-token'}),connection=await app.saveConnection(sender,'zentao',tested.operationId,tested.candidateHash);connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:connectionId}});
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>{const p=snapshot.packages[0],application=app.builtin.assertTrusted(p.packageHash);return createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[{manifest:application.manifest,packageHash:p.packageHash,capabilities:builtinApplicationModules.capabilityViews(application.manifest)}],skills:[],available:{mcp:true,cli:available}});}});app.attachRuns(runs);
});
afterEach(async()=>{for(const run of owned)await run.cli.exited();await app?.dispose();for(const socket of sockets)socket.destroy();await new Promise<void>(ok=>server.close(()=>ok()));writeFileSync(join(delivery,'trace-'+randomUUID()+'.json'),JSON.stringify({connectionId,v1Hash,v2Hash,providerCalls,paths,traces,runStates:owned.map(r=>runs.get(r.runId)),cleanup:{serverListening:server.listening,activeFixtureSockets:sockets.size}},null,2));f?.cleanup();});


async function call(entry:Entry,run:OwnedCapabilityRun|undefined,kind:'list'|'detail'|'resource',args:Record<string,unknown>){
 if(entry==='page'){
  if(kind==='list')return app.zentaoWork(sender,'p1',args as never);
  if(kind==='detail')return app.zentaoObject(sender,'p1',args as never);
  return app.zentaoResource(sender,'p1',args);
 }
 const operation=entry==='v1'?{list:'smartdd_zentao_work_list_v1',detail:'smartdd_zentao_object_get_v1',resource:'smartdd_zentao_resource_v1'}[kind]:{list:'zentao.object.list',detail:'zentao.object.get',resource:'zentao.resource.read'}[kind];
 const response=await new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:entry==='cli'?'cli':'mcp',retryDelays:[0,0]}).call(run!.runId,randomUUID(),{operation,contractMajor:entry==='v1'?1:2,connectionId:null,arguments:args});
 expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw Error(JSON.stringify(response));
 if(entry==='v1'){expect(response.value).not.toHaveProperty('schema');expect(response.value).not.toHaveProperty('operation');return response.value;}
 const result=response.value as ApplicationResultV2;
 expect(result).toMatchObject({schema:'willyou-app-result-v2',source:{connections:[{slot:'zentao',connectionId,identityRevision:1}]},operation:{origin:'cli',effectState:'read-only'}});
 traces.push({capability:result.capabilityId,source:result.source,completeness:result.completeness,pagination:result.pagination,operation:result.operation});
 return result.data;
}
async function entries(){return {v1:await start('v1'),cli:await start('v2')};}
async function listAll(entry:Entry,run?:OwnedCapabilityRun){
 const pages:ZentaoWorkData[]=[];let cursor:string|null=null;
 for(let n=0;n<4;n++){
  const page=await call(entry,run,'list',{kind:'bug',limit:2,cursor}) as ZentaoWorkData;pages.push(page);
  expect(page.total).toBe(ids.length);expect(page.problems).toEqual([]);
  for(const row of page.items)expect(row.reference).toMatchObject({connectionId,identityRevision:1,nativeId:row.id});
  if(!page.nextCursor){expect(page.complete).toBe(true);break;}expect(page.complete).toBe(false);cursor=page.nextCursor;
 }
 expect(pages).toHaveLength(3);const all=pages.flatMap(p=>p.items);expect(all.map(i=>i.id)).toEqual(ids);expect(new Set(all.map(i=>i.id)).size).toBe(ids.length);
 traces.push({entry,pages:pages.map(p=>({ids:p.items.map(i=>i.id),complete:p.complete,total:p.total,hasNext:p.nextCursor!==null}))});return all;
}
async function allBytes(entry:Entry,run:OwnedCapabilityRun|undefined,resource:ApplicationResourceRef){
 const parts:Buffer[]=[];let offset=0,chunks=0;
 while(chunks++<30){const chunk=await call(entry,run,'resource',{resource,offset,length:4096}) as ApplicationResourceChunk;
  expect(chunk).toMatchObject({resourceId:resource.id,revision:resource.revision,offset});expect(chunk.length).toBeLessThanOrEqual(4096);expect(bytes(chunk).length).toBe(chunk.length);parts.push(bytes(chunk));
  if(chunk.eof){expect(chunk.nextOffset).toBeNull();break;}expect(chunk.nextOffset).toBe(offset+chunk.length);expect(chunk.length).toBeGreaterThan(0);offset=chunk.nextOffset!;
 }
 const complete=Buffer.concat(parts);expect(complete.length).toBe(resource.size);expect(digest(complete)).toBe(resource.revision);traces.push({entry,resourceId:resource.id,chunks,bytes:complete.length,sha256:digest(complete)});return complete;
}

describe('M11-T02 acceptance: CLI v2 / retained MCP v1 / page service share business identity',()=>{
 it('continues all pages with no loss or duplicate and keeps each transport contract',async()=>{
  const owned=await entries(),cli=await listAll('cli',owned.cli),v1=await listAll('v1',owned.v1),page=await listAll('page');
  expect(cli).toEqual(v1);expect(cli).toEqual(page);expect(ids[0]).toBe('9007199254740997');
  const requests=paths.filter(p=>p.includes('/my/work?')).map(p=>new URL(p,'http://localhost').searchParams.get('pageID'));
  expect(requests).toEqual(['1','2','3','1','2','3','1','2','3']);
 });
 it('compares detail metadata, exact raw fields and revisions across all entries',async()=>{
  const owned=await entries(),listed=await listAll('cli',owned.cli),ref=listed[0].reference,details:ZentaoDetailData[]=[];
  for(const entry of ['cli','v1','page'] as const){const run=entry==='page'?undefined:owned[entry],detail=await call(entry,run,'detail',{kind:'bug',reference:ref}) as ZentaoDetailData;details.push(detail);
   expect(detail.complete).toBe(true);expect(detail.missing).toEqual([]);expect(detail.reference).toMatchObject({connectionId,identityRevision:1,nativeId:ids[0]});
   expect(detail.fields).toMatchObject({id:ids[0],status:'active',pri:3,severity:3,product:{id:'96',name:'Synthetic Product'}});
  }
  const strip=(d:ZentaoDetailData)=>{const {presentation,...business}=d;return business;};
  expect(strip(details[0])).toEqual(strip(details[1]));expect(strip(details[1])).toEqual(strip(details[2]));
  expect(details[0]).not.toHaveProperty('presentation');expect(details[1]).not.toHaveProperty('presentation');expect(details[2].presentation?.choices.status.active).toBe('激活');
 });
 it.each(['body','history','attachment','long-field'] as const)('compares complete %s resource bytes via bounded continuation in all three entries',async part=>{
  const owned=await entries(),listed=await listAll('cli',owned.cli),reference=listed[0].reference,values:Buffer[]=[];
  for(const entry of ['cli','v1','page'] as const){const run=entry==='page'?undefined:owned[entry],detail=await call(entry,run,'detail',{kind:'bug',reference}) as ZentaoDetailData;
   const resource=part==='body'?detail.body!:part==='history'?detail.history!:part==='attachment'?detail.attachments[0].resource:detail.fields.customLong as ApplicationResourceRef;
   const value=await allBytes(entry,run,resource);values.push(value);
   if(part==='body')expect(JSON.parse(value.toString())).toEqual({steps:longBody});
   if(part==='history')expect(JSON.parse(value.toString())).toEqual(history);
   if(part==='attachment')expect(value).toEqual(attachment);
   if(part==='long-field')expect(JSON.parse(value.toString())).toEqual(fieldLong);
  }
  expect(values[0]).toEqual(values[1]);expect(values[1]).toEqual(values[2]);
 });
 it('reports duplicate pages and changed totals as incomplete consistently, without a fabricated next page',async()=>{
  const owned=await entries();
  for(const mode of ['duplicate','total-change']){
   duplicatePage=mode==='duplicate';totalChanged=mode==='total-change';const results:unknown[]=[];
   for(const entry of ['cli','v1','page'] as const){const run=entry==='page'?undefined:owned[entry],first=await call(entry,run,'list',{kind:'bug',limit:2}) as ZentaoWorkData;
    const second=await call(entry,run,'list',{kind:'bug',limit:2,cursor:first.nextCursor}) as ZentaoWorkData;
    expect(second).toMatchObject({items:[],nextCursor:null,complete:false,problems:[{code:'INCOMPLETE_RESULT',objectId:null}]});
    results.push({items:second.items,total:second.total,complete:second.complete,nextCursor:second.nextCursor,problems:second.problems});
   }
   expect(results[0]).toEqual(results[1]);expect(results[1]).toEqual(results[2]);traces.push({mode,results});
  }
 });
 it('keeps missing source fields and cross-source denials consistent while valid reads remain usable',async()=>{
  const owned=await entries(),list=await listAll('cli',owned.cli),reference=list[0].reference;incomplete=true;
  for(const entry of ['cli','v1','page'] as const){const run=entry==='page'?undefined:owned[entry],detail=await call(entry,run,'detail',{kind:'bug',reference}) as ZentaoDetailData;
   expect(detail.complete).toBe(false);expect(detail.missing).toEqual(expect.arrayContaining(['description','history']));expect(detail.body).toBeNull();expect(detail.history).toBeNull();
   const spoofed={...reference,connectionId:randomUUID()};
   if(entry==='page')await expect(app.zentaoObject(sender,'p1',{kind:'bug',reference:spoofed})).rejects.toMatchObject({code:'NOT_FOUND'});
   else {const response=await new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:entry==='cli'?'cli':'mcp',retryDelays:[0,0]}).call(run!.runId,randomUUID(),{operation:entry==='cli'?'zentao.object.get':'smartdd_zentao_object_get_v1',contractMajor:entry==='cli'?2:1,connectionId:null,arguments:{kind:'bug',reference:spoofed}});expect(response).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});}
   expect((await call(entry,run,'list',{kind:'bug',limit:2}) as ZentaoWorkData).items.map(i=>i.id)).toEqual(ids.slice(0,2));
  }
 });
});
