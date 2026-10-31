import {ConfigViewRegistry} from '../config-view-registry';
import * as manifestPolicy from '../manifest';
import {planApplicationActivation} from '../activation-preflight';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {z} from 'zod';
import type {IpcMainInvokeEvent} from 'electron';
import {ApplicationError,type ApplicationManifest,type InstalledApplicationPackage} from '@shared/applications';
import type {CapabilityBundleIndex} from '@shared/capability-bundles';
import type {CapabilitySessionSnapshotV2} from '@shared/application-session';
import {applicationMcpServerName,applicationNativeSkillName} from '@shared/application-session';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import {ApplicationAdapterRegistry,type ApplicationDataHost} from '../application-adapter-registry';
import {ApplicationBusinessDataService} from '../business-data-service';
import {ApplicationConnectionService} from '../connection-service';
import {ApplicationSelectionService} from '../selection-service';
import {ApplicationExecutionContexts} from '../execution-context';
import {ApplicationToolService} from '../tool-service';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {CapabilityBundleSource} from '../bundle-source';
import {applicationSkillContentHash} from '../session-registry';
import {validateRuntime} from '../runtime-registry';
import {canonicalJson,digest,manifestHash} from '../manifest';
import type {HostApplicationDefinitions,HostedIdentity} from '../host-application-registry';
import type {OwnedCapabilityRun} from '../run-registry';
import {fixtureBundle} from './fixtures';
import {FixtureProcessReader,runFixture} from './run-fixture';

// E-EXT only: real store/session/run/tool/context/adapter classes,compiled fake
// providers and a complete private distribution. No native Agent or network.
const ids=['extalpha','extbeta'] as const;
type Id=typeof ids[number];
type LegacyConfig={kind:Id;endpoint:string;username:string;authMode:'token'};
type Config={kind:Id;serviceUrl:string;username:string;authMode:'token'};
const hosts:HostApplicationDefinitions<Config,Id>={api:1,applications:ids.map(id=>({id,slots:[id],stopBeforeSwitch:false})),providers:ids.map(id=>({id,appId:id,configApiMajor:1,configSchemaVersion:2,configSchema:z.object({kind:z.literal(id),serviceUrl:z.url(),username:z.string().min(1),authMode:z.literal('token')}).strict(),authentication:{kind:'secret',modes:['token']},permissions:{read:id+'.read',write:id+'.write'}}))};
const runtimeBytes=Buffer.from('module.exports = {};\n');
const runtime=validateRuntime({id:'applications',protocolMajor:1,bridgeEntry:'mcp-bridge.cjs',files:{'mcp-bridge.cjs':runtimeBytes}});
function fakePackage(id:Id){
 const bundle=fixtureBundle(),manifest=bundle.manifest,files=bundle.files;
 manifest.appId=id;manifest.displayName='Isolated '+id;manifest.runtime.hash=runtime.hash;manifest.connectionContracts[0].providerId=id;manifest.permissions=[id+'.read',id+'.write'];
 const base=manifest.tools[0];manifest.tools=['query','write'].map(kind=>({...base,name:'smartdd_'+id+'_'+kind+'_v1',permission:id+'.'+(kind==='query'?'read':'write'),annotations:{readOnlyHint:kind==='query',destructiveHint:false,idempotentHint:kind==='query',openWorldHint:false}}));
 files['schemas/input.json']=Buffer.from(canonicalJson({type:'object',properties:{value:{type:'string',maxLength:100},objectId:{type:'string',maxLength:100}},required:['value'],additionalProperties:false}));
 files['schemas/output.json']=Buffer.from(canonicalJson({type:'object',properties:{value:{type:'string'},appId:{type:'string'},projectId:{type:'string'},taskId:{type:'string'},operationId:{type:'string'},connectionId:{type:'string'}},required:['value','appId','projectId','taskId','operationId','connectionId'],additionalProperties:false}));
 files['schemas/connection.json']=Buffer.from(canonicalJson({type:'object',properties:{kind:{const:id},endpoint:{type:'string',format:'uri'},username:{type:'string',minLength:1},authMode:{const:'token'}},required:['kind','endpoint','username','authMode'],additionalProperties:false}));
 const operations=Object.fromEntries(manifest.tools.map(tool=>[tool.name,{method:id+'.'+(tool.annotations.readOnlyHint?'query':'write'),semantics:tool.annotations.readOnlyHint?'read':'write',retry:tool.annotations.readOnlyHint?'safe-read':'never',timeoutMs:1000}]));
 files['adapter/operations.json']=Buffer.from(canonicalJson({appId:id,version:manifest.version,operations})+'\n');
 files['adapter/index.cjs']=Buffer.from("const routes=require('./operations.json');module.exports={api:1,dataApi:1,appId:routes.appId,version:routes.version,operations:routes.operations,execute(name,input,data){return data.v1.invoke(routes.operations[name].method,input);}};\n");
 manifest.files=Object.entries(files).map(([path,bytes])=>({path,size:bytes.length,sha256:digest(bytes),executable:false}));return bundle;
}
function distribution(root:string,bundles:ReturnType<typeof fakePackage>[]){
 const apps:CapabilityBundleIndex['apps']=[];
 for(const bundle of bundles){const hash=manifestHash(bundle.manifest),path='apps/'+bundle.manifest.appId+'/'+bundle.manifest.version+'/'+hash;apps.push({appId:bundle.manifest.appId,version:bundle.manifest.version,hash,path});for(const[name,bytes]of Object.entries({...bundle.files,'manifest.json':Buffer.from(canonicalJson(bundle.manifest)+'\n')})){const dest=join(root,path,name);mkdirSync(join(dest,'..'),{recursive:true});writeFileSync(dest,bytes,{mode:0o600});}}
 const path='runtimes/'+runtime.hash;mkdirSync(join(root,path),{recursive:true});writeFileSync(join(root,path,'runtime.json'),canonicalJson(runtime.manifest)+'\n',{mode:0o600});writeFileSync(join(root,path,'mcp-bridge.cjs'),runtimeBytes,{mode:0o600});
 const index:Omit<CapabilityBundleIndex,'indexHash'>={schema:'willyou-capability-bundles-v1',build:{appVersion:'0.0.5',commit:null,dirty:true,resourceSetHash:''},adapters:[],runtimes:[{id:'applications',protocolMajor:1,hash:runtime.hash,path,bridgeEntry:'mcp-bridge.cjs'}],apps};index.build.resourceSetHash=digest(canonicalJson({adapters:index.adapters,runtimes:index.runtimes,apps:index.apps}));writeFileSync(join(root,'index.json'),canonicalJson({...index,indexHash:digest(canonicalJson(index))})+'\n',{mode:0o600});return new CapabilityBundleSource(root);
}
let f:Awaited<ReturnType<typeof runFixture>>,connections:ApplicationConnectionService<Config,Id>,selections:ApplicationSelectionService<Config,Id>,contexts:ApplicationExecutionContexts<Config,Id>|undefined,tools:ApplicationToolService,builtin:BuiltinPackageRegistry;
const running:OwnedCapabilityRun[]=[];let installed:InstalledApplicationPackage[],pids:number,executions:number;
let selected:Record<Id,string>,reader:FixtureProcessReader,onWait:()=>void,releaseLate:(()=>void)|undefined;
const sender={} as IpcMainInvokeEvent;
async function start(projectId:string,permissions?:readonly string[]){
 const snapshot:CapabilitySessionSnapshotV2=structuredClone(f.snapshot);snapshot.taskId=randomUUID();snapshot.projectId=projectId;const server=applicationMcpServerName(digest(snapshot.taskId));snapshot.mcp.find(m=>m.kind==='applications')!.serverName=server;
 snapshot.packages=installed.map(pack=>({appId:pack.appId,version:pack.version,packageHash:pack.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:pack.manifest.hostApi,dataApi:1,runtimeHash:runtime.hash,toolContractMajors:Object.fromEntries(pack.manifest.tools.map(t=>[t.name,t.contractMajor])),skills:pack.manifest.skills.map(skill=>{const nativeName=applicationNativeSkillName(pack.appId,skill.id,pack.packageHash);return{skillId:skill.id,nativeName,contentHash:applicationSkillContentHash(pack.manifest,skill.path),sourceRelativePath:skill.path,projectionPath:join(f.store.root,'sessions',snapshot.taskId,'claude/plugin/skills',nativeName,'SKILL.md')};}),bindings:[],allowedOperations:pack.manifest.permissions.filter(p=>!permissions||permissions.includes(p))}));
 snapshot.adapterBinding.nativeToolNames=Object.fromEntries(installed.flatMap(pack=>pack.manifest.tools.map(t=>[t.name,'mcp__'+server+'__'+t.name])));const session=await f.sessions.create(snapshot,f.home),run=await f.runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});running.push(run);await run.prepare();await run.cli.arm();const pid=++pids;reader.identities.set(pid,'darwin-proc-v1:extension:'+pid);await run.cli.attach(pid);return run;
}
const call=(run:OwnedCapabilityRun,id:Id,value='normal',requestId=randomUUID(),connectionId:string|null=null,write=false,signal?:AbortSignal)=>tools.call(run.runId,requestId,{operation:'smartdd_'+id+'_'+(write?'write':'query')+'_v1',contractMajor:1,connectionId,arguments:{value}},signal);
beforeEach(async()=>{
 contexts=undefined;releaseLate=undefined;reader=new FixtureProcessReader();const bundles=ids.map(fakePackage);f=await runFixture(reader,{application:true,runtime:runtimeBytes,applicationBundle:bundles[0]});f.sqlite.exec("INSERT INTO projects(id,name,created_at,updated_at) VALUES('p2','second isolated extension project',1,1)");
 const secrets=new SecretsStore(drizzle(f.sqlite,{schema}),{isAvailable:()=>true,encrypt:value=>Buffer.from(value),decrypt:value=>value.toString()});connections=new ApplicationConnectionService<Config,Id>(f.store,secrets,{verify:async(config:Config):Promise<HostedIdentity<Config>>=>({providerId:config.kind,serviceId:'isolated-'+config.kind,accountId:config.username,contractMajor:1})},1000,hosts,new ConfigViewRegistry<LegacyConfig>(hosts.providers.map(provider=>({providerId:provider.id,sourceSchemaVersion:2,targetApiMajor:1,identityContractMajor:1,implementationVersion:'fixture-1',sourceSchema:provider.configSchema,targetSchema:z.object({kind:z.literal(provider.id),endpoint:z.url(),username:z.string().min(1),authMode:z.literal('token')}).strict(),authModes:['token'],authentication:()=>'token',outputAuthentication:()=>'token',convert:(value:unknown)=>{const current=value as Config;return{kind:current.kind,endpoint:current.serviceUrl,username:current.username,authMode:current.authMode};}}))));
 builtin=new BuiltinPackageRegistry(f.store,connections.registry);const source=distribution(join(f.root,'private-distribution'),bundles);installed=[];for(const entry of source.index.apps){const pack=await builtin.install(source,entry);installed.push(pack);if(!builtin.packages.active(pack.appId))await builtin.packages.activate(pack.packageHash,0);}
 selections=new ApplicationSelectionService(f.store,connections,{requireProject:projectId=>{if(!f.sqlite.prepare('SELECT id FROM projects WHERE id=?').get(projectId))throw new ApplicationError('SCOPE_DENIED','unknown project');},stopProjectRuns:async()=>true,runningInProject:()=>0});selected={extalpha:'',extbeta:''};
 for(const id of ids){const saved=await connections.save({name:id,expectedRevision:0,config:{kind:id,serviceUrl:'https://'+id+'.example.test/',username:'isolated-'+id,authMode:'token'},secret:'private-'+id});selected[id]=saved.id;await selections.setAdded(id,true,0);for(const projectId of ['p1','p2'])await selections.select({projectId,appId:id,expectedRevision:0,enabled:true,connections:{[id]:saved.id}});}
 contexts=new ApplicationExecutionContexts(f.store,selections,connections,{requireSender:value=>{if(value!==sender)throw new ApplicationError('SCOPE_DENIED','untrusted UI');},assertRun:id=>f.runs.assertActive(id)});pids=310000;executions=0;onWait=()=>{};
 const data:ApplicationDataHost=new ApplicationBusinessDataService({registry:connections.registry,hosts:ids.map(id=>({appId:id,data:{resolve(version,method,binding){if(version!==1||binding.appId!==id||![id+'.query',id+'.write'].includes(method))throw new ApplicationError('CAPABILITY_UNAVAILABLE','unknown compiled fake route');const semantics=method.endsWith('.write')?'write':'read';return{semantics,retry:'never',timeoutMs:1000,authorize:(claim,expected)=>{selections.requireEnabled(claim.run.projectId,id);const slot=selections.connectionSlot(claim.run.projectId,id,id);if(expected!==null&&expected!==slot.connectionId)throw new ApplicationError('SCOPE_DENIED','connection is not selected');},authorizeReceipt:(claim,operationId)=>contexts!.assertAgentReceipt(claim,binding,operationId),execute:(claim,input,operation)=>contexts!.withAgent(claim,binding,operation,semantics,async scope=>{const active=await contexts!.connection(scope,id,operation.connectionId);expect(active.configView.view).toEqual({kind:id,endpoint:active.connection.config.serviceUrl,username:active.connection.config.username,authMode:'token'});expect(active.configView.viewMajor).toBe(1);expect(active.connection.configSchemaVersion).toBe(2);contexts!.require(scope,binding.permission);if(typeof input.objectId==='string'&&input.objectId!==id+':'+scope.projectId)throw new ApplicationError('SCOPE_DENIED','isolated object belongs to another app/project');executions++;if(input.value==='hold'){onWait();await new Promise<void>(resolve=>{releaseLate=resolve;});if(scope.signal.aborted)throw new ApplicationError('CANCELED','isolated late producer canceled');}if(input.value==='wait'){onWait();await new Promise<never>((_,reject)=>{const cancel=()=>reject(new ApplicationError('CANCELED','isolated producer canceled'));scope.signal.addEventListener('abort',cancel,{once:true});if(scope.signal.aborted)cancel();});}if(input.value==='unknown')throw new ApplicationError('CONNECTION_UNAVAILABLE','isolated unknown external result');return{value:id+':'+String(input.value),appId:id,projectId:scope.projectId,taskId:scope.taskId,operationId:scope.operationId,connectionId:active.connection.id};})};}}}))});
 tools=new ApplicationToolService(f.store,f.runs,new ApplicationAdapterRegistry(f.store,data,connections.registry),{retryDelays:[0,0]});
});
afterEach(async()=>{releaseLate?.();await contexts?.dispose();while(running.length)await running.pop()!.cli.exited();f?.cleanup();vi.restoreAllMocks();});

describe('registered fake apps use the production discovery,adapter,context and receipt chain',()=>{
 it('uses persisted schema 2 through fixed API 1 adapters without rewriting current configuration',async()=>{
  const run=await start('p1');
  for(const id of ids){
   const before=f.sqlite.prepare('SELECT config_json,config_schema_version,config_revision FROM application_connections WHERE id=?').get(selected[id]);
   expect(before).toMatchObject({config_schema_version:2,config_revision:1});
   expect(JSON.parse((before as {config_json:string}).config_json)).toEqual({kind:id,serviceUrl:'https://'+id+'.example.test/',username:'isolated-'+id,authMode:'token'});
   expect(await call(run,id)).toMatchObject({status:'ok',value:{appId:id,connectionId:selected[id]}});
   expect(f.sqlite.prepare('SELECT config_json,config_schema_version,config_revision FROM application_connections WHERE id=?').get(selected[id])).toEqual(before);
  }
 });
 it.each([false,true])('rejects removed host Data API before authentication for a retained adapter (cached=%s) and restores the same run',async cached=>{
  const run=await start('p1'),snapshot=structuredClone(f.runs.assertActive(run.runId).snapshot),pack=installed.find(item=>item.appId==='extalpha')!,adapter=readFileSync(join(f.store.root,pack.relativePath,'adapter/index.cjs'));
  if(cached)expect(await call(run,'extalpha')).toMatchObject({status:'ok'});
  const before=executions,authenticate=vi.spyOn(connections,'authentication'),original=manifestPolicy.assertHostCompatible;
  // Models the compiled policy of a newer host opening unchanged old data.
  // Store/package/adapter/context/credential and tool paths remain real; this is
  // not proof of a real API2 host or native CLI, which require packaged evidence.
  const policy=vi.spyOn(manifestPolicy,'assertHostCompatible').mockImplementation(manifest=>{if(manifest.appId==='extalpha')throw new ApplicationError('HOST_INCOMPATIBLE','Host no longer supports this retained Data API');original(manifest);});
  const preflight=planApplicationActivation(builtin.packages,[],[],0,{parseConfig:input=>connections.registry.parseConfig(input),parseIdentity:(input,provider)=>connections.registry.parseIdentity(input,provider),views:{resolve:request=>{const pack=installed.find(item=>item.appId===request.providerId)!;return connections.resolvePackageView(pack.packageHash,connections.get(selected[connections.registry.provider(request.providerId).id]));}}});
  expect(preflight.issues).toContainEqual({code:'RETAINED_PACKAGE_INCOMPATIBLE',packageHash:pack.packageHash,taskId:snapshot.taskId});
  expect(preflight.issues.some(issue=>issue.packageHash===installed.find(item=>item.appId==='extbeta')!.packageHash)).toBe(false);
  for(const write of [false,true])expect(await call(run,'extalpha','must-not-execute',randomUUID(),null,write)).toMatchObject({status:'error',error:{code:'HOST_INCOMPATIBLE'}});
  expect(executions).toBe(before);expect(authenticate).not.toHaveBeenCalled();
  expect(await call(run,'extbeta')).toMatchObject({status:'ok'});
  policy.mockRestore();expect(await call(run,'extalpha','same-run-restored')).toMatchObject({status:'ok'});
  expect(f.runs.assertActive(run.runId).snapshot).toEqual(snapshot);expect(readFileSync(join(f.store.root,pack.relativePath,'adapter/index.cjs'))).toEqual(adapter);
 });
 it.each(['unknown-schema','missing-converter','unknown-authentication','missing-account','extra-security-field','old-auth-incompatible'] as const)('rejects %s before authentication and resumes the same fixed run after repair',async fault=>{
  const run=await start('p1'),snapshot=structuredClone(f.runs.assertActive(run.runId).snapshot),discovery=await tools.list(run.runId);
  const pack=installed.find(p=>p.appId==='extalpha')!,adapter=readFileSync(join(f.store.root,pack.relativePath,'adapter/index.cjs'));
  const originalConfig=(f.sqlite.prepare('SELECT config_json FROM application_connections WHERE id=?').get(selected.extalpha) as {config_json:string}).config_json;
  const authenticate=vi.spyOn(connections,'authentication');
  expect(await call(run,'extalpha')).toMatchObject({status:'ok'});authenticate.mockClear();
  // Explicit persisted-state fault injection; no claim this is a supported save.
  const resolveView=ConfigViewRegistry.prototype.resolve,empty=new ConfigViewRegistry([]);
  const converter=vi.spyOn(ConfigViewRegistry.prototype,'resolve').mockImplementation(function(this:ConfigViewRegistry<{kind:string}>,request,source,allowed){return resolveView.call(fault==='missing-converter'&&request.providerId==='extalpha'?empty:this,request,source,fault==='old-auth-incompatible'&&request.providerId==='extalpha'?['password']:allowed);});
  if(['unknown-authentication','missing-account','extra-security-field'].includes(fault)){const config=JSON.parse(originalConfig);if(fault==='unknown-authentication')config.authMode='oauth-new';if(fault==='missing-account')delete config.username;if(fault==='extra-security-field')config.tlsVerification=false;f.sqlite.prepare('UPDATE application_connections SET config_json=? WHERE id=?').run(canonicalJson(config),selected.extalpha);}
  if(fault==='unknown-schema')f.sqlite.prepare('UPDATE application_connections SET config_schema_version=99 WHERE id=?').run(selected.extalpha);
  for(const write of [false,true])expect(await call(run,'extalpha','blocked',randomUUID(),null,write)).toMatchObject({status:'error',error:{code:fault==='missing-converter'?'CONFIG_COMPATIBILITY_UNVERIFIED':'CONFIG_INCOMPATIBLE'}});
  expect(authenticate).not.toHaveBeenCalled();expect(executions).toBe(1);
  expect(await call(run,'extbeta')).toMatchObject({status:'ok',value:{appId:'extbeta'}});
  converter.mockRestore();f.sqlite.prepare('UPDATE application_connections SET config_schema_version=2,config_json=? WHERE id=?').run(originalConfig,selected.extalpha);
  for(const write of [false,true])expect(await call(run,'extalpha','recovered',randomUUID(),null,write)).toMatchObject({status:'ok',value:{appId:'extalpha',connectionId:selected.extalpha}});
  expect(f.runs.assertActive(run.runId).snapshot).toEqual(snapshot);
  expect((await tools.list(run.runId)).tools).toEqual(discovery.tools);
  expect(readFileSync(join(f.store.root,pack.relativePath,'adapter/index.cjs'))).toEqual(adapter);
  expect(f.sqlite.prepare('SELECT config_schema_version,config_revision,identity_revision FROM application_connections WHERE id=?').get(selected.extalpha)).toEqual({config_schema_version:2,config_revision:1,identity_revision:1});
 });
 it('discovers fixed schemas and reads through both compiled fake apps in two real isolated project scopes',async()=>{
  const a=await start('p1'),b=await start('p2');expect((await tools.list(a.runId)).tools.map(t=>t.name).sort()).toEqual(installed.flatMap(p=>p.manifest.tools.map(t=>t.name)).sort());for(const run of [a,b])for(const id of ids)expect(await call(run,id)).toMatchObject({status:'ok',value:{appId:id,projectId:run===a?'p1':'p2',connectionId:selected[id],value:id+':normal'}});expect(executions).toBe(4);
  const calls=f.sqlite.prepare('SELECT project_id,app_id,state,attempt_count FROM application_invocations ORDER BY project_id,app_id').all();expect(calls).toHaveLength(4);expect(calls.every(row=>(row as {state:string}).state==='succeeded')).toBe(true);const operations=f.sqlite.prepare('SELECT caller_kind,run_id,package_hash,targets_json,state FROM application_data_operations').all() as {caller_kind:string;run_id:string;package_hash:string;targets_json:string;state:string}[];expect(operations).toHaveLength(4);for(const row of operations){expect(row.caller_kind).toBe('agent-run');expect(row.state).toBe('succeeded');expect(JSON.parse(row.targets_json)).toHaveLength(1);}expect(JSON.stringify(calls)+JSON.stringify(operations)).not.toContain('private-ext');
  const joined=f.sqlite.prepare('SELECT i.*,d.caller_kind,d.scope_kind,d.action,d.state AS data_state,d.targets_json FROM application_invocations i JOIN application_data_operations d ON d.operation_id=i.operation_id').all() as Record<string,unknown>[];expect(joined).toHaveLength(4);for(const row of joined){const id=ids.find(value=>value===row.app_id)!,run=row.project_id==='p1'?a:b,pack=installed.find(value=>value.appId===id)!;expect(row).toMatchObject({run_id:run.runId,task_id:f.runs.get(run.runId).taskId,app_id:id,package_hash:pack.packageHash,tool_name:'smartdd_'+id+'_query_v1',contract_major:1,semantics:'read',state:'succeeded',effect_state:'read-only',attempt_count:1,error_code:null,caller_kind:'agent-run',scope_kind:'project',action:'smartdd_'+id+'_query_v1',data_state:'succeeded'});expect(JSON.parse(String(row.targets_json))).toEqual([{slot:id,id:selected[id],identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:1}]);expect(Date.parse(String(row.ended_at))).toBeGreaterThanOrEqual(Date.parse(String(row.started_at)));}

 });
 it.each(ids)('rejects invalid %s schemas and a connection from another registered app before executing business code',async id=>{
  const run=await start('p1');await expect(tools.call(run.runId,randomUUID(),{operation:'smartdd_'+id+'_query_v1',contractMajor:1,connectionId:null,arguments:{value:'x',projectId:'p2'}})).resolves.toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(await call(run,id,'x',randomUUID(),selected[ids.find(value=>value!==id)!])).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(executions).toBe(0);
 });
 it.each(ids)('uses the same %s permission and receipt checks without replaying a completed invocation',async id=>{
  const run=await start('p1'),requestId=randomUUID(),first=await call(run,id,'once',requestId);expect(first.status).toBe('ok');expect(await call(run,id,'once',requestId)).toEqual(first);expect(executions).toBe(1);await selections.select({projectId:'p1',appId:id,expectedRevision:1,enabled:false,connections:{[id]:selected[id]}});expect(await call(run,id,'once',requestId)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(executions).toBe(1);expect(await call(run,ids.find(value=>value!==id)!)).toMatchObject({status:'ok'});
 });
 it.each(ids)('leaves an uncertain %s write unknown and never generically replays it from its durable receipt',async id=>{
  const run=await start('p1',ids.map(value=>value+'.write')),requestId=randomUUID(),first=await call(run,id,'unknown',requestId,null,true);expect(first).toMatchObject({status:'error',error:{effectState:'unknown',attemptCount:1}});expect(await call(run,id,'unknown',requestId,null,true)).toEqual(first);expect(executions).toBe(1);expect(f.sqlite.prepare('SELECT state FROM application_data_operations').get()).toEqual({state:'unknown'});
 });
 it('keeps the default product trust boundary closed even when valid private distribution metadata exists',()=>{
  expect(()=>new BuiltinPackageRegistry(f.store).assertTrusted(installed[0].packageHash)).toThrow('可信内置分发依据');
 });
 it('discovers only the original selected read permissions and refuses writes for both registered apps',async()=>{
  const run=await start('p1',ids.map(id=>id+'.read'));expect((await tools.list(run.runId)).tools.map(t=>t.name).sort()).toEqual(ids.map(id=>'smartdd_'+id+'_query_v1'));for(const id of ids)expect(await call(run,id,'normal',randomUUID(),null,true)).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(executions).toBe(0);
 });
 it.each(ids)('keeps %s business-object ownership inside the host-issued real project scope',async id=>{
  const a=await start('p1'),b=await start('p2');const invoke=(run:OwnedCapabilityRun,objectId:string)=>tools.call(run.runId,randomUUID(),{operation:'smartdd_'+id+'_query_v1',contractMajor:1,connectionId:null,arguments:{value:'owned',objectId}});expect(await invoke(a,id+':p1')).toMatchObject({status:'ok',value:{projectId:'p1'}});expect(await invoke(b,id+':p1')).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(await invoke(b,id+':p2')).toMatchObject({status:'ok',value:{projectId:'p2'}});expect(executions).toBe(2);
 });
 it.each(ids)('cancels an in-flight %s read through the shared operation signal and records cancellation',async id=>{
  const run=await start('p1'),controller=new AbortController();let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});onWait=ready;const pending=call(run,id,'wait',randomUUID(),null,false,controller.signal);await started;controller.abort();expect(await pending).toMatchObject({status:'error',error:{code:'CANCELED'}});await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT state FROM application_data_operations').get()).toEqual({state:'cancelled'}));expect(executions).toBe(1);await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT state,error_code,effect_state,attempt_count FROM application_invocations').get()).toEqual({state:'failed',error_code:'CANCELED',effect_state:'read-only',attempt_count:1}));
 });
 it.each(ids)('bounds an in-flight %s read by its original route deadline without delivering late success',async id=>{
  const run=await start('p1');expect(await call(run,id,'wait')).toMatchObject({status:'error',error:{code:'TIMEOUT',attemptCount:1}});await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT state FROM application_data_operations').get()).toEqual({state:'cancelled'}));expect(executions).toBe(1);await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT state,error_code,effect_state,attempt_count FROM application_invocations').get()).toEqual({state:'failed',error_code:'TIMEOUT',effect_state:'read-only',attempt_count:1}));
 });
 it.each(ids)('does not grant %s authority to JSON copies of an actual UI context',async id=>{
  await contexts!.withUi(sender,{projectId:'p1',appId:id,action:id+'.query',operations:[id+'.read'],semantics:'read'},async scope=>{expect(()=>contexts!.require({...scope},id+'.read')).toThrow('宿主');expect(()=>contexts!.require({...scope,projectId:'p2'},id+'.read')).toThrow('宿主');expect((await contexts!.connection(scope,id)).connection.id).toBe(selected[id]);return null;});
 });
 it.each(ids.flatMap(id=>['unknown','cross-app'].map(fault=>({id,fault}))))('rejects a corrupted $fault target in a retained $id receipt instead of replaying or accepting it',async({id,fault})=>{
  const run=await start('p1'),requestId=randomUUID();expect((await call(run,id,'once',requestId)).status).toBe('ok');const row=f.sqlite.prepare('SELECT operation_id,targets_json FROM application_data_operations').get() as {operation_id:string;targets_json:string};const targets=JSON.parse(row.targets_json);targets[0].slot=fault==='unknown'?'missing-provider':ids.find(value=>value!==id);f.sqlite.prepare('UPDATE application_data_operations SET targets_json=? WHERE operation_id=?').run(JSON.stringify(targets),row.operation_id);expect(await call(run,id,'once',requestId)).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});expect(executions).toBe(1);
 });
 it.each(ids)('rechecks original %s dispatcher bytes even after a successful cached adapter load',async id=>{
  const run=await start('p1');expect((await call(run,id)).status).toBe('ok');const pack=installed.find(p=>p.appId===id)!,path=join(f.store.root,pack.relativePath,'adapter/index.cjs'),bytes=readFileSync(path);writeFileSync(path,'module.exports = {};\n');try{expect(await call(run,id)).toMatchObject({status:'error',error:{code:'HASH_MISMATCH'}});expect(executions).toBe(1);}finally{writeFileSync(path,bytes);}
 });
 it.each(['unknown-app','duplicate','missing-resolver','empty'] as const)('rejects invalid compiled data-service registration: %s',fault=>{
  const data:ApplicationDataHost={resolve:()=>{throw new Error('must not resolve');}},registration={registry:connections.registry,hosts:[{appId:'extalpha',data}]};if(fault==='unknown-app')registration.hosts[0].appId='unregistered';if(fault==='duplicate')registration.hosts.push(registration.hosts[0]);if(fault==='missing-resolver')Reflect.set(data,'resolve',null);if(fault==='empty')registration.hosts=[];expect(()=>new ApplicationBusinessDataService(registration)).toThrow();expect(executions).toBe(0);
 });
 it.each(ids.flatMap(id=>['cancel-first','timeout-first'].map(order=>({id,order}))))('preserves the first $order reason when a late $id producer settles after both signals',async({id,order})=>{
  const run=await start('p1'),controller=new AbortController(),timeouts:AbortSignal[]=[],original=AbortSignal.timeout.bind(AbortSignal);vi.spyOn(AbortSignal,'timeout').mockImplementation(delay=>{const actual=original(delay);timeouts.push(actual);return actual;});let ready!:()=>void;const started=new Promise<void>(resolve=>{ready=resolve;});onWait=ready;const pending=call(run,id,'hold',randomUUID(),null,false,controller.signal);await started;const code=order==='cancel-first'?'CANCELED':'TIMEOUT';if(order==='cancel-first')controller.abort();expect(await pending).toMatchObject({status:'error',error:{code}});await vi.waitFor(()=>expect(timeouts[0]?.aborted).toBe(true),{timeout:2500,interval:20});controller.abort();releaseLate!();await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT state,error_code,effect_state,attempt_count FROM application_invocations').get()).toEqual({state:'failed',error_code:code,effect_state:'read-only',attempt_count:1}));expect(executions).toBe(1);
 });
});
