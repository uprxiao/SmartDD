import {EventEmitter} from 'node:events';
import {join,resolve} from 'node:path';
import {readFileSync,cpSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {DiscoveryCatalog} from '../discovery-catalog';
import {UpstreamSessionPool,type UpstreamDefinition} from '../upstream/session-pool';
import {z} from 'zod';
import {ApplicationCliGateway} from '../cli-gateway';
import {MacUnixPeerIdentityReader} from '../unix-peer-identity';
import {MacProcessIdentityReader} from '../process-identity';
import {canonicalJson,digest,validatePackageBundle} from '../manifest';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {randomUUID} from 'node:crypto';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
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
const businessSecret='SYNTHETIC_M11_T08_'+randomUUID();
const consoleRecords:unknown[][]=[];
const observations:Record<string,unknown>[]=[];
let publishedSources:ReturnType<typeof f.projector.sourceSkills>=[];
const sender={sender:Object.assign(new EventEmitter(),{id:811,isDestroyed:()=>false}),senderFrame:{}} as unknown as import('../execution-context').ApplicationUiSender;
async function start(projectId='p1'){
 const base=f.plan('codex'),active=app.builtin.packages.get(app.builtin.packages.active('sample-kv')!.packageHash),manifest=active.manifest;if(manifest.schema!=='smartdd-app-package-v2')throw Error('v2');const adapter=f.installedAdapters.find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!,mcp=base.mcp.find(m=>m.kind==='applications')!,tools=applicationToolDeclarations(manifest);
 const snapshot:CapabilitySessionSnapshot={...base,projectId,schema:3,standardSkills:[],agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{...base.adapterBinding,version:adapter.metadata.version,hash:adapter.hash,nativeToolNames:Object.fromEntries(tools.map(t=>[t.name,`mcp__${mcp.serverName}__${t.name}`]))},packages:[{appId:'sample-kv',version:manifest.version,packageHash:active.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,entry:'cli',capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),toolContractMajors:Object.fromEntries(tools.map(t=>[t.name,t.contractMajor])),skills:manifest.skills.map(s=>{const nativeName=applicationNativeSkillName('sample-kv',s.id,active.packageHash);return{skillId:s.id,nativeName,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',nativeName,'SKILL.md')};}),bindings:[{bindingId:projectId+':sample-kv:sample-kv',connectionId,identityRevision:1}],allowedOperations:manifest.permissions}],mcp:base.mcp.filter(m=>m.kind!=='applications')};
 f.sqlite.prepare('INSERT INTO tasks(id,project_id,cwd,runner,title,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(snapshot.taskId,'p1',f.cwd,'codex','T08 isolated task',Date.now(),Date.now());const birthBefore=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')).read(process.pid)!.startedAt;reader.identities.set(process.pid,birthBefore);const catalog=new DiscoveryCatalog(f.store,f.home,reader,{instanceId:runs.instanceId});f.setExtraVerifier((resource,current)=>catalog.verifyReference(resource,current));publishedSources=f.projector.sourceSkills(snapshot,undefined,false,undefined,{mcp:true,cli:true});const published=await catalog.publish(publishedSources);snapshot.catalogGeneration=published.generation;const saved=await f.sessions.create(snapshot,f.home);for(const entry of published.entries)await f.sessions.addProjectionReference(snapshot.taskId,saved.pointer.snapshotHash,entry.resourceId);const run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[{appId:'sample-kv',slot:'sample-kv',connectionId,identityRevision:1,bindingRevision:1}]});owned.push(run);await run.prepare();await run.cli.arm();const pid=process.pid,birth=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')).read(pid)!.startedAt;reader.identities.set(pid,birth);await run.cli.attach(pid);return run;
}
const call=(run:OwnedCapabilityRun,mode:'read'|'write',args:Record<string,unknown>)=>new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data)).call(run.runId,randomUUID(),{operation:`smartdd_sample_kv_${mode}_v2`,contractMajor:2,connectionId:null,arguments:args});
const row=(value:unknown)=>(value as ApplicationResultV2).data;
beforeEach(async()=>{
 consoleRecords.length=0;for(const name of ['log','warn','error','info','debug'] as const)vi.spyOn(console,name).mockImplementation((...args:unknown[])=>{consoleRecords.push(args);});f=await agentFixture();owned=[];reader=new FixtureProcessReader();const distribution=join(f.root,'cli-sample-distribution');await installCliSample(distribution);const source=new CapabilityBundleSource(distribution);await new RuntimeRegistry(f.store).install(source.runtime());const builtin=new BuiltinPackageRegistry(f.store),installed=await builtin.install(source,source.index.apps.find(a=>a.appId==='sample-kv')!);await builtin.packages.activate(installed.packageHash,0);
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-used'),foxmailNative:join(f.root,'not-used'),processes:reader,uiReadRetryDelays:[0,0]});await app.recover();await app.setAdded(sender,'sample-kv',true,0);
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'Reference upstream',config:{kind:'sample-kv',service:'reference',prefix:'demo:',transport:'mcp',authMode:'token'},secret:businessSecret}),connection=await app.saveConnection(sender,'sample-kv',tested.operationId,tested.candidateHash);connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'sample-kv',enabled:true,connections:{'sample-kv':connectionId},expectedRevision:0});
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>{const p=snapshot.packages[0],application=app.builtin.assertTrusted(p.packageHash);return createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[{packageHash:p.packageHash,manifest:application.manifest,capabilities:builtinApplicationModules.capabilityViews(application.manifest)}],available:{mcp:true,cli:true},skills:[]});}});app.attachRuns(runs);
});
afterEach(async()=>{await gateway?.close();for(const run of owned)await run.cli.exited();const data=Reflect.get(app.data,'hosts') as Map<string,unknown>;const pool=Reflect.get(data.get('sample-kv') as object,'pool') as {status():{pid:number|null}[]};const pids=pool.status().map(s=>s.pid).filter((x):x is number=>x!==null);await app?.dispose();for(const pid of pids)expect(()=>process.kill(pid,0)).toThrow();gateway=undefined;f?.cleanup();vi.restoreAllMocks();});


let gateway:ApplicationCliGateway|undefined;
async function installCliSample(distribution:string){
 cpSync(resolve('out/capability-bundles'),distribution,{recursive:true});
 const original=new CapabilityBundleSource(distribution),entry=original.index.apps.find(a=>a.appId==='sample-kv')!,bundle=original.application(entry);
 if(bundle.manifest.schema!=='smartdd-app-package-v2')throw Error('v2 required');
 const manifest=structuredClone(bundle.manifest);manifest.version='1.0.1';manifest.entry='cli';
 for(const c of manifest.capabilities)c.binding={cli:{command:['sample-kv','entry',c.semantics==='read'?'read':'write']}};
 const checked=validatePackageBundle({manifest,files:bundle.files},builtinApplicationModules),relative='apps/sample-kv/'+manifest.version+'/'+checked.packageHash,dir=join(distribution,relative);mkdirSync(dir,{recursive:true});
 for(const [path,bytes]of Object.entries(checked.files)){mkdirSync(join(dir,path,'..'),{recursive:true});writeFileSync(join(dir,path),bytes);}
 writeFileSync(join(dir,'manifest.json'),canonicalJson(checked.manifest)+'\n');
 const {indexHash:_,...index}=structuredClone(original.index);index.apps=index.apps.map(a=>a.appId==='sample-kv'?{appId:'sample-kv',version:manifest.version,hash:checked.packageHash,path:relative}:a);index.build.resourceSetHash=digest(canonicalJson({adapters:index.adapters,runtimes:index.runtimes,apps:index.apps}));writeFileSync(join(distribution,'index.json'),canonicalJson({...index,indexHash:digest(canonicalJson(index))})+'\n');
}
async function native(args:string[],env:Record<string,string>){
 const binary=realpathSync(resolve('out/native/willyou-app'));
 return new Promise<{code:number|null;stdout:string;stderr:string;argv:string[];pid:number|undefined}>((ok,fail)=>{const child=spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');},10000);child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',code=>{clearTimeout(timer);ok({code,stdout,stderr,argv:[binary,...args],pid:child.pid});});});
}

function record(channel:string,value:unknown,runToken?:string){
 const text=typeof value==='string'?value:JSON.stringify(value);expect(text,channel+' leaked third-party business secret').not.toContain(businessSecret);if(runToken)expect(text,channel+' leaked host run token').not.toContain(runToken);
 observations.push({channel,thirdPartyCanaryPresent:false,hostRunTokenPresent:false,value});
 writeFileSync(resolve('t08-observations-'+process.pid+'.json'),JSON.stringify({thirdPartyCanarySha256:digest(businessSecret),thirdPartyCanaryBytes:Buffer.byteLength(businessSecret),observations},null,2)+'\n');
}
describe('M11-T08 secret separation for managed native CLI and ordinary diagnostics (I only)',()=>{
 it.each(['mcp','cli'] as const)('keeps the third-party secret out of all Agent-visible channels via %s upstream',async transport=>{
  if(transport==='cli'){const old=app.connections.get(connectionId);await app.connections.save({id:old.id,expectedRevision:old.revision,name:old.name,config:{...old.config,kind:'sample-kv',service:'reference',prefix:'demo:',transport:'cli',authMode:'token'},secret:businessSecret});}
  const run=await start(),context=runs.bridgePreparation(run.runId),binary=realpathSync(resolve('out/native/willyou-app')),cli=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:'cli',retryDelays:[0,0]});
  const sources=publishedSources;
  expect(sources).toHaveLength(1);for(const source of sources){const delivered=readFileSync(source.path,'utf8');expect(delivered).toContain('willyou-app sample-kv entry read');record(transport+':published-skill',delivered);for(const bytes of Object.values(source.files))expect(bytes.toString()).not.toContain(businessSecret);}
  gateway=new ApplicationCliGateway(runs,cli,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),{executable:{path:binary,sha256:digest(readFileSync(binary))}});await gateway.start();const env={...gateway.issue(run).environment},runToken=env.WILLYOU_RUN_TOKEN;
  expect(runToken).not.toBe(businessSecret);expect(Object.keys(env).sort()).toEqual(['WILLYOU_ENDPOINT','WILLYOU_RUN_TOKEN']);expect(JSON.stringify(env)).not.toContain(businessSecret);
  const help=await native(['--help'],env),catalogResult=await native(['--list'],env),success=await native(['sample-kv','entry','read','--json',JSON.stringify({key:'demo:t08'})],env),scopeError=await native(['sample-kv','entry','read','--json',JSON.stringify({key:'foreign:t08'})],env),badSchema=await native(['sample-kv','entry','read','--json',JSON.stringify({key:42})],env),missingContext=await native(['--list'],{});
  expect(help.code).toBe(0);expect(JSON.parse(help.stdout).command).toBe('willyou-app');expect(catalogResult.code).toBe(0);expect(success.code).toBe(0);expect(JSON.parse(success.stdout)).toMatchObject({schema:'willyou-app-result-v2',operation:{origin:'cli'},data:{key:'demo:t08',value:null}});expect(scopeError.code).toBe(2);expect(JSON.parse(scopeError.stdout)).toMatchObject({error:{code:'SCOPE_DENIED'}});expect(badSchema.code).toBe(2);expect(JSON.parse(badSchema.stdout)).toMatchObject({error:{code:'INVALID_INPUT'}});expect(missingContext.code).toBe(3);
  for(const [name,result]of Object.entries({help,catalog:catalogResult,success,scopeError,badSchema,missingContext})){
   expect(()=>JSON.parse(result.stdout)).not.toThrow();expect(result.stdout.trim().split('\n')).toHaveLength(1);
   if(result.code===0)expect(result.stderr).toBe('');else expect(result.stderr).toMatch(/^willyou-app: [A-Z][A-Z0-9_]*\n$/);
   record(transport+':native-'+name,result,runToken);record(transport+':actual-argv-'+name,result.argv,runToken);
  }
  const diagnostic=await app.diagnoseSession(sender,context.snapshot.taskId);expect(diagnostic.taskId).toBe(context.snapshot.taskId);expect(diagnostic.applications.some(a=>a.appId==='sample-kv')).toBe(true);record(transport+':session-diagnostic',diagnostic,runToken);
  const activities=app.listActivity(sender,{projectId:'p1'});expect(activities.items.length).toBeGreaterThan(0);record(transport+':activity-log',activities,runToken);for(const item of activities.items)record(transport+':activity-detail-'+item.id,app.activityDetail(sender,item.kind,item.id),runToken);
  for(const table of ['application_invocations','application_data_operations','capability_broker_denials','capability_run_preparations','capability_resource_operations'])record(transport+':ordinary-db-audit-'+table,f.sqlite.prepare('SELECT * FROM '+table).all(),runToken);
  record(transport+':run-plan',context.plan,runToken);record(transport+':console-log-warn-error-info-debug',consoleRecords,runToken);
  const exposedConnections=await app.listConnections(sender,'sample-kv');record(transport+':connection-public-view',exposedConnections,runToken);expect(JSON.stringify(exposedConnections)).not.toContain(businessSecret);
 });
 it('does not echo secret-bearing upstream stdout parser errors or stderr into public errors and ordinary console logs',async()=>{
  const pool=new UpstreamSessionPool(join(f.root,'parser-sessions')),command=realpathSync(process.execPath),script=realpathSync(resolve('scripts/applications/fixtures/m11-c1/t08-malformed-upstream.cjs'));
  const controlCredential=join(f.root,'t08-control-credential.json');writeFileSync(controlCredential,JSON.stringify({credential:businessSecret}),{mode:0o600});const control=spawnSync(command,[script,'read','--json','{}'],{encoding:'utf8',timeout:3000,env:{ELECTRON_RUN_AS_NODE:'1',WILLYOU_UPSTREAM_CREDENTIAL_FILE:controlCredential}});expect(control.status).toBe(0);expect(control.stdout).toContain(businessSecret);expect(control.stderr).toContain(businessSecret);record('parser:negative-control-raw-upstream-channels',{rawStdoutContainsSyntheticCanary:true,rawStderrContainsSyntheticCanary:true,stdoutSha256:digest(control.stdout),stderrSha256:digest(control.stderr),note:'Raw upstream transport is private and intentionally hostile; these bytes are never Agent/public output.'});
  const definition:UpstreamDefinition={id:'t08-malformed',kind:'cli',command,args:[script],resources:[command,script].map(path=>({path,sha256:digest(readFileSync(path))})),versions:['1.0.0'],isolation:'private-home-xdg',environment:{ELECTRON_RUN_AS_NODE:'1'},capabilities:{'t08.records.read':{semantics:'read',input:z.object({}).strict(),output:z.object({ok:z.boolean()}).strict(),inScope:()=>true,command:['read'],arguments:()=>({})}}};
  const lease=await pool.acquire(definition,{id:'t08-parser',revision:1,scope:{},credential:businessSecret});try{const error=await lease.invoke('t08.records.read',{}, {signal:new AbortController().signal,deadline:Date.now()+3000,operationId:randomUUID()}).catch(e=>e);expect(error).toMatchObject({code:'INVALID_RESPONSE',message:'上游结果无法按固定契约读取'});record('parser:public-error',{code:(error as {code:string}).code,message:(error as {message:string}).message,stack:String((error as Error).stack)});record('parser:console-log-warn-error-info-debug',consoleRecords);}finally{await lease.release();await pool.close();expect(pool.status()).toEqual([]);}
 });
});
