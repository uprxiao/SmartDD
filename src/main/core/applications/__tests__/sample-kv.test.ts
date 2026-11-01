import {EventEmitter} from 'node:events';
import {join,resolve} from 'node:path';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it} from 'vitest';
import {agentFixture} from './agent-fixture';
import {FixtureProcessReader} from './run-fixture';
import {CapabilityBundleSource} from '../bundle-source';
import {RuntimeRegistry} from '../runtime-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {ApplicationService} from '../application-service';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../run-registry';
import {ApplicationToolService} from '../tool-service';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {createApplicationRunPlan} from '../run-plan';
import {builtinApplicationModules} from '../modules';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import {applicationNativeSkillName,type CapabilitySessionSnapshot} from '@shared/application-session';
import type {ApplicationResultV2} from '@shared/application-result';
import {applicationSkillContentHash} from '../session-registry';
import {SecretsStore} from '../../../secrets';
import {ProjectService} from '../../projects/project-service';
import * as schema from '../../../db/schema';
let f:Awaited<ReturnType<typeof agentFixture>>,app:ApplicationService,runs:CapabilityRunRegistry,reader:FixtureProcessReader,owned:OwnedCapabilityRun[],connectionId:string;
const sender={sender:Object.assign(new EventEmitter(),{id:811,isDestroyed:()=>false}),senderFrame:{}} as unknown as import('../execution-context').ApplicationUiSender;
async function start(projectId='p1'){
 const base=f.plan('codex'),active=app.builtin.packages.get(app.builtin.packages.active('sample-kv')!.packageHash),manifest=active.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('v2');const adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!,mcp=base.mcp.find(m=>m.kind==='applications')!,tools=applicationToolDeclarations(manifest);
 const snapshot:CapabilitySessionSnapshot={...base,projectId,schema:3,standardSkills:[],agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{...base.adapterBinding,version:adapter.metadata.version,hash:adapter.hash,nativeToolNames:Object.fromEntries(tools.map(t=>[t.name,`mcp__${mcp.serverName}__${t.name}`]))},packages:[{appId:'sample-kv',version:manifest.version,packageHash:active.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,entry:'mcp',capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),toolContractMajors:Object.fromEntries(tools.map(t=>[t.name,t.contractMajor])),skills:manifest.skills.map(s=>{const nativeName=applicationNativeSkillName('sample-kv',s.id,active.packageHash);return{skillId:s.id,nativeName,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',nativeName,'SKILL.md')};}),bindings:[{bindingId:projectId+':sample-kv:sample-kv',connectionId,identityRevision:1}],allowedOperations:manifest.permissions}],mcp:base.mcp.map(m=>m.kind==='applications'?{...m,runtimeHash:manifest.runtime.hash}:m)};
 const saved=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[{appId:'sample-kv',slot:'sample-kv',connectionId,identityRevision:1,bindingRevision:1}]});owned.push(run);await run.prepare();await run.cli.arm();const pid=44100+owned.length;reader.identities.set(pid,'darwin-proc-v1:6:'+pid);await run.cli.attach(pid);return run;
}
const call=(run:OwnedCapabilityRun,mode:'read'|'write',args:Record<string,unknown>)=>new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data)).call(run.runId,randomUUID(),{operation:`smartdd_sample_kv_${mode}_v2`,contractMajor:2,connectionId:null,arguments:args});
const row=(value:unknown)=>(value as ApplicationResultV2).data;
beforeEach(async()=>{
 f=await agentFixture();owned=[];reader=new FixtureProcessReader();const source=new CapabilityBundleSource(process.env.WILLYOU_TEST_BUNDLES??resolve('out/capability-bundles'));await new RuntimeRegistry(f.store).install(source.runtime());const builtin=new BuiltinPackageRegistry(f.store),installed=await builtin.install(source,source.index.apps.find(a=>a.appId==='sample-kv')!);await builtin.packages.activate(installed.packageHash,0);
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-used'),foxmailNative:join(f.root,'not-used'),processes:reader,uiReadRetryDelays:[0,0]});await app.recover();await app.setAdded(sender,'sample-kv',true,0);
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'Reference upstream',config:{kind:'sample-kv',service:'reference',prefix:'demo:',transport:'mcp',authMode:'token'},secret:'SYNTHETIC_SAMPLE'}),connection=await app.saveConnection(sender,'sample-kv',tested.operationId,tested.candidateHash);connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'sample-kv',enabled:true,connections:{'sample-kv':connectionId},expectedRevision:0});
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>{const p=snapshot.packages[0],application=app.builtin.assertTrusted(p.packageHash);return createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[{packageHash:p.packageHash,manifest:application.manifest,capabilities:builtinApplicationModules.capabilityViews(application.manifest)}],available:{mcp:true,cli:false},skills:[]});}});app.attachRuns(runs);
});
afterEach(async()=>{for(const run of owned)await run.cli.exited();await app?.dispose();f?.cleanup();});

describe('M11 new application registration uses generic host boundaries',()=>{
 it('executes through a real page context without creating a fictitious Agent run',async()=>{
  expect(row(await app.invokeCapability(sender,'p1','sample-kv','sample-kv.entry.read',{key:'demo:a'}))).toMatchObject({value:null,revision:0});
  const changed=await app.invokeCapability(sender,'p1','sample-kv','sample-kv.entry.write',{key:'demo:a',value:'page value',expectedRevision:0});expect(changed).toMatchObject({operation:{origin:'ui',requestId:null},source:{appId:'sample-kv',connections:[{slot:'sample-kv',connectionId}]},data:{value:'page value',revision:1}});
  expect(f.sqlite.prepare('SELECT count(*) n FROM capability_runs').get()).toEqual({n:0});expect(f.sqlite.prepare('SELECT DISTINCT run_id,task_id FROM application_data_operations').all()).toEqual([{run_id:null,task_id:null}]);
 });
 it('uses the same module/data/protection/result via a fixed Codex MCP plan and refuses an out-of-scope key',async()=>{
  const run=await start();expect(await call(run,'write',{key:'demo:shared',value:'agent value',expectedRevision:0})).toMatchObject({status:'ok',value:{operation:{origin:'mcp'},data:{value:'agent value',revision:1}}});
  expect(row(await app.invokeCapability(sender,'p1','sample-kv','sample-kv.entry.read',{key:'demo:shared'}))).toMatchObject({value:'agent value',revision:1});expect(await call(run,'read',{key:'outside:a'})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
  expect(await call(run,'write',{key:'demo:x',value:'injected',expectedRevision:0,operationId:'forged'})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
 });
 it('adapts the same official-style CLI with a private config and fixed command mapping',async()=>{
  const current=app.connections.get(connectionId);await app.connections.save({id:current.id,expectedRevision:current.revision,name:current.name,config:{...current.config,kind:'sample-kv',service:'reference',prefix:'demo:',transport:'cli',authMode:'token'},secret:'SYNTHETIC_CLI'});
  expect(row(await app.invokeCapability(sender,'p1','sample-kv','sample-kv.entry.write',{key:'demo:cli',value:'cli value',expectedRevision:0}))).toMatchObject({value:'cli value',revision:1});expect(row(await app.invokeCapability(sender,'p1','sample-kv','sample-kv.entry.read',{key:'demo:cli'}))).toMatchObject({value:'cli value',revision:1});
 });
 it('has no sample application branch in the host core or generic pages',()=>{
  for(const path of ['task-capability-launcher.ts','run-registry.ts','business-data-service.ts','capability-execution.ts','execution-context.ts','connection-service.ts','selection-service.ts','session-diagnostics.ts','controller.ts','application-service.ts','cli-gateway.ts'])expect(readFileSync(resolve('src/main/core/applications',path),'utf8'),path).not.toContain('sample-kv');
  for(const path of ['connection-form.tsx','project-applications.tsx'])expect(readFileSync(resolve('src/renderer/features/applications',path),'utf8'),path).not.toContain('sample-kv');
  expect(builtinApplicationModules.module('sample-kv').providers).toHaveLength(1);expect(builtinApplicationModules.module('sample-kv').capabilities['sample-kv.entry.write'].protection).toEqual({kind:'revision',object:'sample_kv_entry',key:'expectedRevision'});
 });
});
