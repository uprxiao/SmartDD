import {EventEmitter} from 'node:events';
import {createServer,type Server} from 'node:http';
import type {Socket} from 'node:net';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
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
let available:boolean,incomplete:boolean,providerCalls:number;
const senderFrame={};
const sender={sender:Object.assign(new EventEmitter(),{id:808,isDestroyed:()=>false,mainFrame:senderFrame}),senderFrame} as unknown as import('../execution-context').ApplicationUiSender;
const body='<p>synthetic bug body '+ 'x'.repeat(6000)+'</p>';
const id='79291';
function tool(run:OwnedCapabilityRun,entry:'cli'|'mcp',operation:string,args:Record<string,unknown>){return new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry,retryDelays:[0,0]}).call(run.runId,randomUUID(),{operation,contractMajor:2,connectionId:null,arguments:args});}
function value<T>(response:Awaited<ReturnType<typeof tool>>){expect(response.status,JSON.stringify(response)).toBe('ok');if(response.status!=='ok')throw Error(JSON.stringify(response));return response.value as ApplicationResultV2&{data:T};}
async function start(){
 const original=f.plan('codex'),selected=app.builtin.packages.get(app.builtin.packages.active('zentao')!.packageHash),manifest=selected.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('v2 required');
 const adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!,bridge=original.mcp.find(m=>m.kind==='applications')!,tools=applicationToolDeclarations(manifest);
 const snapshot:CapabilitySessionSnapshot={...original,schema:3,standardSkills:[],agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{...original.adapterBinding,version:adapter.metadata.version,hash:adapter.hash,nativeToolNames:Object.fromEntries(tools.map(t=>[t.name,`mcp__${bridge.serverName}__${t.name}`]))},packages:[{appId:'zentao',version:manifest.version,packageHash:selected.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,toolContractMajors:Object.fromEntries(tools.map(t=>[t.name,t.contractMajor])),capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),entry:'cli',skills:manifest.skills.map(s=>{const nativeName=applicationNativeSkillName('zentao',s.id,selected.packageHash);return{skillId:s.id,nativeName,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',nativeName,'SKILL.md')};}),allowedOperations:['zentao.read'],bindings:[{bindingId:'p1:zentao:zentao',connectionId,identityRevision:1}]}],mcp:original.mcp.map(m=>m.kind==='applications'?{...m,runtimeHash:manifest.runtime.hash}:m)};
 const session=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});owned.push(run);await run.prepare();await run.cli.arm();const pid=43100+owned.length;reader.identities.set(pid,'darwin-proc-v1:500:'+pid);await run.cli.attach(pid);return run;
}
let reader:FixtureProcessReader;
beforeEach(async()=>{
 available=true;incomplete=false;providerCalls=0;owned=[];sockets=new Set();
 server=createServer((req,res)=>{providerCalls++;const url=new URL(req.url!,'http://127.0.0.1'),json=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
  if(req.headers.token!=='synthetic-zt-token')return json({},401);
  if(url.pathname.endsWith('/v1/user'))return json({profile:{id:'7',account:'tester'}});
  if(url.pathname.endsWith('/v1/langs'))return json({bug:{statusList:{active:'激活'},priList:{3:'P2'},severityList:{3:'较大'}}});
  if(url.pathname.endsWith('/v2/my/work')){const kind=url.searchParams.get('mode'),rows=kind==='bug'?[{id,title:'Synthetic Bug',status:'active',assignedTo:{account:'tester'}}]:[];return json({mode:kind,type:'assignedTo',pager:{recTotal:rows.length,pageID:1,recPerPage:Number(url.searchParams.get('recPerPage')),pageTotal:rows.length?1:0},[kind==='bug'?'bugs':'stories']:rows});}
  if(url.pathname.endsWith('/v1/bugs/'+id))return json({bug:{id,title:'Synthetic Bug',status:'active',pri:3,severity:3,assignedTo:{account:'tester'},product:{id:'96',name:'Synthetic Product'},steps:incomplete?undefined:body,files:[]},actions:incomplete?undefined:[{action:'opened',comment:'synthetic history'}]});
  return json({},404);
 });server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});await new Promise<void>(ok=>server.listen(0,'127.0.0.1',ok));const address=server.address();if(!address||typeof address==='string')throw Error('fixture');
 f=await agentFixture();const source=new CapabilityBundleSource(process.env.WILLYOU_TEST_BUNDLES??resolve('out/capability-bundles'));await new RuntimeRegistry(f.store).install(source.runtime());const trusted=new BuiltinPackageRegistry(f.store),installed=await trusted.install(source,source.index.apps.find(a=>a.appId==='zentao')!);await trusted.packages.activate(installed.packageHash,trusted.packages.active('zentao')!.generation);
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);reader=new FixtureProcessReader();app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-executed'),foxmailNative:join(f.root,'not-executed'),processes:reader,uiReadRetryDelays:[0,0]});await app.recover();await app.setAdded(sender,'zentao',true,0);
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'Synthetic ZenTao',config:{kind:'zentao',baseUrl:`http://127.0.0.1:${address.port}/biz/`,username:'tester',authMode:'token'},secret:'synthetic-zt-token'}),connection=await app.saveConnection(sender,'zentao',tested.operationId,tested.candidateHash);connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:connectionId}});
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>{const p=snapshot.packages[0],application=app.builtin.assertTrusted(p.packageHash);if(application.manifest.schema!=='smartdd-app-package-v2')throw Error('v2 required');return createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[{manifest:application.manifest,packageHash:p.packageHash,capabilities:application.manifest.capabilities}],skills:[],available:{mcp:true,cli:available}});}});app.attachRuns(runs);
});
afterEach(async()=>{for(const run of owned)await run.cli.exited();await app?.dispose();for(const socket of sockets)socket.destroy();await new Promise<void>(ok=>server.close(()=>ok()));f?.cleanup();});

describe('M11 S6 ZenTao v2 using the real provider on a synthetic HTTP service',()=>{
 it('maps all three v1 tools to data-only contract2 capabilities with CLI primary and MCP fallback',()=>{
  const application=app.builtin.assertTrusted(app.builtin.packages.active('zentao')!.packageHash),manifest=application.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('v2 required');
  expect(manifest.version).toBe('1.1.0');expect(manifest.entry).toBe('cli');expect(manifest.capabilities.map(c=>c.legacyTool?.name).sort()).toEqual(['smartdd_zentao_object_get_v1','smartdd_zentao_resource_v1','smartdd_zentao_work_list_v1']);expect(manifest.capabilities.every(c=>c.contractMajor===2&&c.semantics==='read'&&c.binding.cli&&c.binding.fallback&&'mcp'in c.binding.fallback)).toBe(true);expect(manifest.files.some(f=>f.executable||/\.(?:c?js|mjs|py|sh)$/.test(f.path))).toBe(false);expect(manifest.skills.every(s=>s.template)).toBe(true);
 });
 it('reads list, complete references, detail and bounded resources through CLI with the same page data',async()=>{
  const run=await start(),listed=value<ZentaoWorkData>(await tool(run,'cli','zentao.object.list',{kind:'bug'}));expect(listed).toMatchObject({capabilityId:'zentao.object.list',source:{connections:[{slot:'zentao',connectionId}]},pagination:{nextCursor:null,total:1},operation:{origin:'cli',effectState:'read-only'}});
  const reference=listed.data.items[0].reference,detail=value<ZentaoDetailData>(await tool(run,'cli','zentao.object.get',{kind:'bug',reference}));expect(detail.data.reference).toMatchObject({connectionId:reference.connectionId,identityRevision:reference.identityRevision,nativeId:reference.nativeId});expect(detail.source.revision).toBe(detail.data.reference.contentRevision);expect(detail.resources).toContainEqual(detail.data.body);expect(detail.completeness.complete).toBe(true);
  const page=await app.zentaoObject(sender,'p1',{kind:'bug',reference});expect(page.fields).toEqual(detail.data.fields);
  const chunk=value<ApplicationResourceChunk>(await tool(run,'cli','zentao.resource.read',{resource:detail.data.body,offset:0,length:4096}));expect(chunk.data.length).toBe(4096);expect(chunk.data.eof).toBe(false);expect(chunk.data.nextOffset).toBe(4096);expect(chunk.source.connections[0].connectionId).toBe(connectionId);
 });
 it('keeps missing description/history explicit rather than claiming a complete result',async()=>{
  incomplete=true;const run=await start(),listed=value<ZentaoWorkData>(await tool(run,'cli','zentao.object.list',{kind:'bug'})),detail=value<ZentaoDetailData>(await tool(run,'cli','zentao.object.get',{kind:'bug',reference:listed.data.items[0].reference}));expect(detail.completeness.complete).toBe(false);expect(detail.completeness.missing).toEqual(expect.arrayContaining(['description','history']));expect(detail.data.body).toBeNull();
 });
 it('fixes the MCP fallback for a new run, refuses the inactive entry and never changes the first plan',async()=>{
  const cli=await start(),first=runs.bridgePreparation(cli.runId).plan!;available=false;const fallback=await start();expect(runs.bridgePreparation(fallback.runId).plan!.applications[0]).toMatchObject({effectiveEntry:'mcp',fallback:true});
  const before=providerCalls;expect(await tool(cli,'mcp','smartdd_zentao_work_list_v2',{kind:'bug'})).toMatchObject({status:'error',error:{code:'ENTRY_NOT_ACTIVE'}});expect(await tool(fallback,'cli','zentao.object.list',{kind:'bug'})).toMatchObject({status:'error',error:{code:'ENTRY_NOT_ACTIVE'}});expect(providerCalls).toBe(before);
  expect(value<ZentaoWorkData>(await tool(fallback,'mcp','smartdd_zentao_work_list_v2',{kind:'bug'})).data.items[0].id).toBe(id);expect(runs.bridgePreparation(cli.runId).plan).toEqual(first);
 });
});
