import {EventEmitter} from 'node:events';
import {join,resolve} from 'node:path';
import {readFileSync,cpSync,mkdirSync,writeFileSync,realpathSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {ApplicationCliGateway} from '../cli-gateway';
import {MacUnixPeerIdentityReader} from '../unix-peer-identity';
import {MacProcessIdentityReader} from '../process-identity';
import {canonicalJson,digest,validatePackageBundle} from '../manifest';
import {Client} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
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
 const snapshot:CapabilitySessionSnapshot={...base,projectId,schema:3,standardSkills:[],agentAtCreation:{version:'0.166.0',adapterRevision:1},adapterBinding:{...base.adapterBinding,version:adapter.metadata.version,hash:adapter.hash,nativeToolNames:Object.fromEntries(tools.map(t=>[t.name,`mcp__${mcp.serverName}__${t.name}`]))},packages:[{appId:'sample-kv',version:manifest.version,packageHash:active.packageHash,hashAlgorithm:'app-manifest-v1',hostApi:manifest.hostApi,dataApi:manifest.dataApi,runtimeHash:manifest.runtime.hash,entry:'cli',capabilityContractMajors:Object.fromEntries(manifest.capabilities.map(c=>[c.id,c.contractMajor])),toolContractMajors:Object.fromEntries(tools.map(t=>[t.name,t.contractMajor])),skills:manifest.skills.map(s=>{const nativeName=applicationNativeSkillName('sample-kv',s.id,active.packageHash);return{skillId:s.id,nativeName,contentHash:applicationSkillContentHash(manifest,s.path),sourceRelativePath:s.path,projectionPath:join(f.home,'.agents/skills',nativeName,'SKILL.md')};}),bindings:[{bindingId:projectId+':sample-kv:sample-kv',connectionId,identityRevision:1}],allowedOperations:manifest.permissions}],mcp:base.mcp.filter(m=>m.kind!=='applications')};
 const saved=await f.sessions.create(snapshot,f.home),run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:saved.pointer.snapshotHash,bindings:[{appId:'sample-kv',slot:'sample-kv',connectionId,identityRevision:1,bindingRevision:1}]});owned.push(run);await run.prepare();await run.cli.arm();const pid=process.pid,birth=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')).read(pid)!.startedAt;reader.identities.set(pid,birth);await run.cli.attach(pid);return run;
}
const call=(run:OwnedCapabilityRun,mode:'read'|'write',args:Record<string,unknown>)=>new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data)).call(run.runId,randomUUID(),{operation:`smartdd_sample_kv_${mode}_v2`,contractMajor:2,connectionId:null,arguments:args});
const row=(value:unknown)=>(value as ApplicationResultV2).data;
beforeEach(async()=>{
 f=await agentFixture();owned=[];reader=new FixtureProcessReader();const distribution=join(f.root,'cli-sample-distribution');await installCliSample(distribution);const source=new CapabilityBundleSource(distribution);await new RuntimeRegistry(f.store).install(source.runtime());const builtin=new BuiltinPackageRegistry(f.store),installed=await builtin.install(source,source.index.apps.find(a=>a.appId==='sample-kv')!);await builtin.packages.activate(installed.packageHash,0);
 const db=drizzle(f.sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),projects=new ProjectService(db,secrets);app=new ApplicationService(f.store,{secrets,projects,tasks:{stopProject:async()=>true,runningInProject:()=>0},requireSender:()=>{},mailWorker:join(f.root,'not-used'),foxmailNative:join(f.root,'not-used'),processes:reader,uiReadRetryDelays:[0,0]});await app.recover();await app.setAdded(sender,'sample-kv',true,0);
 const tested=await app.testConnection(sender,{expectedRevision:0,name:'Reference upstream',config:{kind:'sample-kv',service:'reference',prefix:'demo:',transport:'mcp',authMode:'token'},secret:'SYNTHETIC_SAMPLE'}),connection=await app.saveConnection(sender,'sample-kv',tested.operationId,tested.candidateHash);connectionId=connection.id;await app.select(sender,{projectId:'p1',appId:'sample-kv',enabled:true,connections:{'sample-kv':connectionId},expectedRevision:0});
 runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>{const p=snapshot.packages[0],application=app.builtin.assertTrusted(p.packageHash);return createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[{packageHash:p.packageHash,manifest:application.manifest,capabilities:builtinApplicationModules.capabilityViews(application.manifest)}],available:{mcp:true,cli:true},skills:[]});}});app.attachRuns(runs);
});
afterEach(async()=>{await gateway?.close();for(const run of owned)await run.cli.exited();const data=Reflect.get(app.data,'hosts') as Map<string,unknown>;const pool=Reflect.get(data.get('sample-kv') as object,'pool') as {status():{pid:number|null}[]};const pids=pool.status().map(s=>s.pid).filter((x):x is number=>x!==null);await app?.dispose();for(const pid of pids)expect(()=>process.kill(pid,0)).toThrow();gateway=undefined;f?.cleanup();});


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
 return new Promise<{code:number|null;stdout:string;stderr:string}>((ok,fail)=>{const child=spawn(binary,args,{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>{child.kill('SIGKILL');},10000);child.stdout.on('data',c=>{stdout+=c;});child.stderr.on('data',c=>{stderr+=c;});child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',code=>{clearTimeout(timer);ok({code,stdout,stderr});});});
}
describe('M11-T03 managed native CLI to registered MCP upstream (I, synthetic Agent root)',()=>{
 it('discovers only mapped CLI capabilities, calls the real upstream, and rejects an extra tool and bad arguments without leaking the credential',async()=>{
  const script=realpathSync(resolve('resources/application-upstreams/sample-kv.cjs')),exe=realpathSync(process.execPath),scriptBefore=digest(readFileSync(script));
  const credential=join(f.root,'discovery-credential.json');writeFileSync(credential,JSON.stringify({credential:'SYNTHETIC_SAMPLE'}),{mode:0o600});
  const transport=new StdioClientTransport({command:exe,args:[script,'mcp'],cwd:f.root,env:{ELECTRON_RUN_AS_NODE:'1',HOME:f.root,PATH:'/usr/bin:/bin',WILLYOU_UPSTREAM_CREDENTIAL_FILE:credential,WILLYOU_SAMPLE_DATA:join(f.root,'discovery-data')},stderr:'pipe'});
  transport.stderr?.on('data',()=>{});const upstream=new Client({name:'T03 discovery observer',version:'1.0.0'},{capabilities:{}});let discoveryPid:number|null=null;
  try{await upstream.connect(transport,{timeout:5000});discoveryPid=transport.pid;const catalog=await upstream.listTools();expect(catalog.tools.map(t=>t.name)).toContain('not_mapped');}finally{await upstream.close();await transport.close();if(discoveryPid)expect(()=>process.kill(discoveryPid!,0)).toThrow();}
  await app.invokeCapability(sender,'p1','sample-kv','sample-kv.entry.write',{key:'demo:via-cli',value:'reference-value',expectedRevision:0});
  const run=await start(),binary=realpathSync(resolve('out/native/willyou-app')),cli=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:'cli',retryDelays:[0,0]});
  gateway=new ApplicationCliGateway(runs,cli,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),{executable:{path:binary,sha256:digest(readFileSync(binary))}});await gateway.start();const env={...gateway.issue(run).environment};
  const listed=await native(['--list'],env);expect(listed.code).toBe(0);expect(JSON.parse(listed.stdout).capabilities.map((c:{id:string})=>c.id).sort()).toEqual(['sample-kv.entry.read','sample-kv.entry.write']);
  const result=await native(['sample-kv','entry','read','--json',JSON.stringify({key:'demo:via-cli'})],env);expect(result).toMatchObject({code:0,stderr:''});expect(JSON.parse(result.stdout)).toMatchObject({schema:'willyou-app-result-v2',capabilityId:'sample-kv.entry.read',data:{key:'demo:via-cli',value:'reference-value',revision:1},source:{appId:'sample-kv',connections:[{connectionId}]},operation:{origin:'cli',effectState:'read-only'}});
  const before=f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get();
  const extra=await native(['sample-kv','not_mapped','--json',JSON.stringify({key:'demo:via-cli'})],env),bad=await native(['sample-kv','entry','read','--json',JSON.stringify({key:123})],env);
  expect(extra.code).toBe(2);expect(JSON.parse(extra.stdout).error.code).toMatch(/SCOPE_DENIED|INVALID_INPUT/);expect(bad.code).toBe(2);expect(JSON.parse(bad.stdout).error.code).toBe('INVALID_INPUT');
  expect(f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual(before);
  expect(JSON.stringify([listed,result,extra,bad,f.sqlite.prepare('SELECT * FROM application_invocations').all()])).not.toContain('SYNTHETIC_SAMPLE');expect(digest(readFileSync(script))).toBe(scriptBefore);
 });
 it('M11-T04 returns the unified v2 result and controlled errors with an unchanged CLI upstream',async()=>{
  const old=app.connections.get(connectionId);await app.connections.save({id:old.id,expectedRevision:old.revision,name:old.name,config:{...old.config,kind:'sample-kv',service:'reference',prefix:'demo:',transport:'cli',authMode:'token'},secret:'SYNTHETIC_SAMPLE'});
  const script=realpathSync(resolve('resources/application-upstreams/sample-kv.cjs')),originalHash=digest(readFileSync(script)),run=await start(),binary=realpathSync(resolve('out/native/willyou-app')),cli=new ApplicationToolService(f.store,runs,new ApplicationAdapterRegistry(f.store,app.data),{entry:'cli',retryDelays:[0,0]});
  gateway=new ApplicationCliGateway(runs,cli,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),{executable:{path:binary,sha256:digest(readFileSync(binary))}});await gateway.start();const env={...gateway.issue(run).environment};
  const result=await native(['sample-kv','entry','read','--json',JSON.stringify({key:'demo:cli-upstream'})],env);expect(result).toMatchObject({code:0,stderr:''});expect(JSON.parse(result.stdout)).toMatchObject({schema:'willyou-app-result-v2',capabilityId:'sample-kv.entry.read',source:{appId:'sample-kv',connections:[{connectionId}]},data:{key:'demo:cli-upstream',value:null,revision:0},operation:{origin:'cli',effectState:'read-only'}});
  const denied=await native(['sample-kv','entry','read','--json',JSON.stringify({key:'foreign:cli-upstream'})],env);expect(denied.code).toBe(2);expect(JSON.parse(denied.stdout)).toMatchObject({error:{code:'SCOPE_DENIED',effectState:'read-only'}});expect(digest(readFileSync(script))).toBe(originalHash);expect(JSON.stringify([result,denied])).not.toContain('SYNTHETIC_SAMPLE');
 });

});
