import {drizzle} from 'drizzle-orm/better-sqlite3';
import {SecretsStore} from '../../../../secrets';
import * as dbSchema from '../../../../db/schema';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {afterEach,beforeEach,describe,expect,it,vi,type Mock} from 'vitest';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/server/validators/ajv';
import {ApplicationError} from '@shared/applications';
import {capabilitySessionSnapshotV3Schema} from '@shared/application-session-v3';
import {applicationMcpServerName} from '@shared/application-session';
import {digest} from '../../manifest';
import type {PluginSessionSelection} from '@shared/plugin-session';
import {ApplicationToolService} from '../../tool-service';
import {ApplicationCliGateway} from '../../cli-gateway';
import {MacUnixPeerIdentityReader} from '../../unix-peer-identity';
import {CapabilityRunRegistry,type OwnedCapabilityRun} from '../../run-registry';
import {createApplicationRunPlan} from '../../run-plan';
import {FixtureProcessReader,runFixture} from '../../__tests__/run-fixture';
import {MacProcessIdentityReader} from '../../process-identity';
import {PluginLifecycle} from '../lifecycle';
import {PluginProcess} from '../process';
import {PluginProjectPolicy} from '../project-policy';
import {capturePluginSession,PluginSessionTools,pluginMcpToolName,pluginToolSchema,type PluginToolPolicy} from '../session-tools';
import {validatePluginBundle} from '../package';
import {fixture} from './fixture';
import {PluginHostService} from '../host-service';

const read='demo-tracker.items.list',write='demo-tracker.items.put';
function candidate(version='0.1.0',options:{rename?:boolean;extra?:boolean;semantics?:boolean;crashWrite?:boolean;connection?:boolean}={}){
  const f=fixture(),cap=f.manifest.capabilities[read];f.manifest.version=version;f.manifest.ui.panels=[];
  cap.slots=options.connection?['tracker-api']:[];
  if(options.connection)Object.assign(f.manifest.providers[0],{secret:{title:'Synthetic token',required:true,modes:['token']}});
  const caps:Record<string,typeof cap>={[options.rename?'demo-tracker.items.scan':read]:cap,[write]:{...cap,title:'Put',semantics:'write',retry:'never',permission:'demo-tracker.write'}};
  if(options.extra)caps['demo-tracker.items.extra']={...cap};
  if(options.semantics)caps[read]={...cap,semantics:'write',retry:'never'};
  Object.assign(f.manifest,{capabilities:caps,legacyToolNames:{smartdd_demo_list_v1:options.rename?'demo-tracker.items.scan':read,...(options.rename?{[read]:'demo-tracker.items.scan'}:{})}});
  f.files.set('schemas/input.json',Buffer.from(JSON.stringify({type:'object',additionalProperties:false,properties:{value:{type:'string'},delay:{type:'integer'}}})));
  f.files.set('schemas/output.json',Buffer.from('{"type":"object","required":["version","capability"],"properties":{"version":{"type":"string"},"capability":{"type":"string"}}}'));
  f.files.set('runtime/main.mjs',Buffer.from(`const VERSION=${JSON.stringify(version)},CRASH=${!!options.crashWrite};\n`+String.raw`
import readline from 'node:readline';import {appendFileSync} from 'node:fs';import {join} from 'node:path';
readline.createInterface({input:process.stdin}).on('line',async line=>{
 const m=JSON.parse(line);let result;
 if(m.method==='initialize')result={protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:VERSION};
 else {appendFileSync(join(process.env.WILLYOU_PLUGIN_DATA,'calls.log'),JSON.stringify(m.params)+'\n');
 if(CRASH&&m.params.capability.endsWith('.put'))process.exit(3);
 if(m.params.input.delay)await new Promise(ok=>setTimeout(ok,m.params.input.delay));
 result={version:VERSION,capability:m.params.capability};}
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\n');
});`));
  return validatePluginBundle(f.bundle());
}
function legacyCandidate(writeFailure=false){
  const base=candidate('0.2.0'),files=new Map(base.files),manifest=structuredClone(base.manifest) as any;
  manifest.legacyToolNames.smartdd_demo_list_v2=writeFailure?write:read;
  manifest.legacyToolContracts={smartdd_demo_list_v2:{input:'schemas/legacy-input.json',output:'schemas/legacy-output.json',result:'application-v2',dataFields:writeFailure?['missing']:['version']}};
  files.set('schemas/legacy-input.json',Buffer.from(JSON.stringify({type:'object',required:['value'],additionalProperties:false,properties:{value:{type:'string'}}})));
  files.set('schemas/legacy-output.json',Buffer.from(JSON.stringify({type:'object',required:['schema','contractMajor','source','operation','data'],properties:{schema:{const:'willyou-app-result-v2'},contractMajor:{const:2},data:{type:'object',additionalProperties:false,required:['version'],properties:{version:{type:'string'}}},source:{type:'object'},operation:{type:'object'}}})));
  files.set('.willyou-plugin/plugin.json',Buffer.from(JSON.stringify(manifest)));return validatePluginBundle(files);
}
let f:Awaited<ReturnType<typeof runFixture>>,life:PluginLifecycle,reader:FixtureProcessReader,runs:CapabilityRunRegistry,run:OwnedCapabilityRun|undefined,tools:ApplicationToolService;
let gateway:ApplicationCliGateway|undefined;
let productionHost:PluginHostService|undefined;
let selection:PluginSessionSelection,projectEnabled:boolean,approve:Mock<PluginToolPolicy['approve']>,connection:Mock<PluginToolPolicy['connection']>;
const install=(value:ReturnType<typeof candidate>)=>life.install(value,life.inspect(value));
const count=()=>f.sqlite.prepare('SELECT count(*) n FROM application_invocations').get();
const calls=()=>{const path=join(life.dataDirectory('demo-tracker'),'calls.log');return existsSync(path)?readFileSync(path,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)):[];};
async function launch(entry:'mcp'|'cli'='mcp',realNative=false,connections:PluginSessionSelection['connections']=[],bindingRevision:number|null=1){
  selection=capturePluginSession(life.packages.get(life.state('demo-tracker').hash!),connections,entry,bindingRevision??undefined);
  const taskId=randomUUID(),serverName=applicationMcpServerName(digest(taskId));
  const snapshot=capabilitySessionSnapshotV3Schema.parse({...f.snapshot,taskId,schema:3,packages:[],externalPlugins:[selection],mcp:f.snapshot.mcp.map(m=>({...m,serverName})),adapterBinding:{...f.snapshot.adapterBinding,nativeToolNames:Object.fromEntries(selection.capabilities.flatMap(c=>[c.mcpTool,...c.aliases]).map(name=>[name,'mcp__'+serverName+'__'+name]))}});
  const session=await f.sessions.create(snapshot,f.home);
  if(realNative)reader.identities.set(process.pid,new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')).read(process.pid)!.startedAt);
  runs=new CapabilityRunRegistry(f.store,f.sessions,{processes:reader,assertCurrent:()=>{},revoke:()=>{},createPlan:(snapshot,snapshotHash,runId)=>createApplicationRunPlan({runId,snapshot,snapshotHash,applications:[],available:{mcp:true,cli:true},skills:[]})});
  run=await runs.reserve({taskId:snapshot.taskId,snapshotHash:session.pointer.snapshotHash,bindings:[]});await run.prepare();await run.cli.arm();reader.identities.set(200123,'darwin-proc-v1:fixture-plugin');await run.cli.attach(realNative?process.pid:200123);
  const additional=new PluginSessionTools(life,{
    authorize:(context,selected)=>{if(context.run.projectId!=='p1'||selected.appId!=='demo-tracker'||!projectEnabled)throw new ApplicationError('APP_NOT_ENABLED','synthetic project disabled');},
    connection:(...args)=>connection(...args),approve:(...args)=>approve(...args),
  });
  tools=new ApplicationToolService(f.store,runs,{resolve:()=>{throw new Error('External package entered builtin resolver');}},{entry,additional});
}
const call=(id=read,args:Record<string,unknown>={},requestId=randomUUID(),entry:'mcp'|'cli'='mcp')=>tools.call(run!.runId,requestId,{operation:entry==='mcp'?pluginMcpToolName(id):id,contractMajor:1,connectionId:null,arguments:args});
function connectionRows(){
  const now=new Date().toISOString();
  f.sqlite.prepare("INSERT INTO application_host_applications VALUES('demo-tracker')").run();
  f.sqlite.prepare("INSERT INTO application_host_providers VALUES('tracker-api','demo-tracker',1)").run();
  f.sqlite.prepare("INSERT INTO application_catalog_state VALUES('demo-tracker',1,1,1,?)").run(now);
  f.sqlite.prepare("INSERT INTO application_project_settings(project_id,app_id,enabled,binding_revision,updated_at) VALUES('p1','demo-tracker',1,1,?)").run(now);
  const ids=[randomUUID(),randomUUID()];
  ids.forEach((id,index)=>{
    const identity=JSON.stringify({providerId:'tracker-api',serviceId:'synthetic-service',accountId:'synthetic-'+index,contractMajor:1});
    const row={id,app_id:'demo-tracker',provider_id:'tracker-api',name:'Synthetic '+index,config_schema_version:1,config_json:JSON.stringify({kind:'tracker-api',authMode:'token',baseUrl:'http://127.0.0.1/synthetic-'+index}),revision:1,config_revision:1,identity_revision:1,verified_identity_json:identity,identity_hash:digest(identity),secret_ref:'synthetic-secret-'+index,secret_revision:1,policy_revision:1,enabled:1,auth_state:'connected',health:'healthy',cleanup_pending:0,created_at:now,updated_at:now};
    f.sqlite.prepare('INSERT INTO application_connections('+Object.keys(row).join(',')+') VALUES('+Object.keys(row).map(()=>'?').join(',')+')').run(...Object.values(row));
  });
  f.sqlite.prepare("INSERT INTO application_project_bindings VALUES('p1','demo-tracker','tracker-api',?,1)").run(ids[0]);return ids;
}
beforeEach(async()=>{
  reader=new FixtureProcessReader();f=await runFixture(reader,{application:true});mkdirSync(join(f.root,'synthetic-keychain'));
  life=new PluginLifecycle(f.store,{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),createProcess:(stored,data,events)=>new PluginProcess(stored.plugin,{packageRoot:stored.directory,dataRoot:data,protectedRoots:[f.root],readOnlyRoots:[process.execPath],keychainRoots:[join(f.root,'synthetic-keychain')],executable:process.execPath,...events}),deleteMetadata:()=>{}});
  projectEnabled=true;approve=vi.fn(async()=>{});connection=vi.fn(async()=>({source:'synthetic-host-only'}));await install(candidate());
});
afterEach(async()=>{await gateway?.close();gateway=undefined;if(run)await run.cli.exited();run=undefined;await productionHost?.close();productionHost=undefined;await life?.close();f?.cleanup();});

describe('external plugin through production run authorization and invocation ledger',()=>{
  it('preserves an explicitly declared old v2 wire contract while new MCP and CLI stay raw',async()=>{
    await install(legacyCandidate());await launch();
    const listed=(await tools.list(run!.runId)).tools.find(t=>t.name==='smartdd_demo_list_v2')!;
    expect(new AjvJsonSchemaValidator().getValidator(listed.inputSchema)({}).valid).toBe(false);
    expect(new AjvJsonSchemaValidator().getValidator(listed.outputSchema!)({version:'0.2.0'}).valid).toBe(false);
    const requestId=randomUUID(),result=await tools.call(run!.runId,requestId,{operation:'smartdd_demo_list_v2',contractMajor:2,connectionId:null,arguments:{value:'legacy'}});
    expect(result).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',contractMajor:2,capabilityId:read,data:{version:'0.2.0'},source:{appId:'demo-tracker',packageHash:life.state('demo-tracker').hash,connections:[]},operation:{requestId,origin:'mcp',effectState:'read-only'}}});
    if(result.status!=='ok')throw new Error('expected old contract success');
    expect((result.value as any).data).not.toHaveProperty('capability');
    expect((result.value as any).operation.id).toBe((f.sqlite.prepare('SELECT operation_id FROM application_invocations').get() as any).operation_id);
    expect(new AjvJsonSchemaValidator().getValidator(listed.outputSchema!)(result.value).valid).toBe(true);
    expect(await call()).toMatchObject({status:'ok',value:{version:'0.2.0',capability:read}});
    expect(calls()).toHaveLength(2);
  });
  it('rejects old input and major mismatch before runtime dispatch',async()=>{
    await install(legacyCandidate());await launch();
    expect(await tools.call(run!.runId,randomUUID(),{operation:'smartdd_demo_list_v2',contractMajor:2,connectionId:null,arguments:{}})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
    expect(await tools.call(run!.runId,randomUUID(),{operation:'smartdd_demo_list_v2',contractMajor:1,connectionId:null,arguments:{value:'legacy'}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
    expect(calls()).toHaveLength(0);
  });
  it('refuses legacy result adapters on write capabilities instead of changing write-effect semantics',()=>{
    expect(()=>legacyCandidate(true)).toThrow('只支持读取能力');
  });
  it('uses the real signed native CLI, kernel peer/ancestor checks and sandbox child end to end',async()=>{
    await launch('cli',true);
    const executable=resolve('out/native/willyou-app');
    gateway=new ApplicationCliGateway(runs,tools,new MacUnixPeerIdentityReader(resolve('out/native/willyou-process-identity')),{executable:{path:executable,sha256:digest(readFileSync(executable))}});
    await gateway.start();const issued=gateway.issue(run!);
    const cli=(args:string[])=>new Promise<{code:number|null;stdout:string;stderr:string}>((ok,fail)=>{
      const child=spawn(executable,args,{env:{PATH:'/usr/bin:/bin',...issued.environment},stdio:['ignore','pipe','pipe']}),chunks:Buffer[]=[],errors:Buffer[]=[];
      const timer=setTimeout(()=>{child.kill('SIGTERM');fail(new Error('native plugin CLI timeout'));},10000);
      child.stdout.on('data',chunk=>chunks.push(chunk));child.stderr.on('data',chunk=>errors.push(chunk));child.on('error',error=>{clearTimeout(timer);fail(error);});child.on('close',code=>{clearTimeout(timer);ok({code,stdout:Buffer.concat(chunks).toString(),stderr:Buffer.concat(errors).toString()});});
    });
    const listed=await cli(['--list']);expect(listed.code).toBe(0);const catalog=JSON.parse(listed.stdout);
    const selected=catalog.capabilities.find((c:{id:string})=>c.id===read);expect(selected).toMatchObject({command:['plugin','demo-tracker','items','list'],resultContract:'willyou-plugin-result-v1'});
    const result=await cli(selected.command);expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({schema:'willyou-plugin-result-v1',capabilityId:read,data:{version:'0.1.0'},operation:{effectState:'read-only'}});
    const writable=catalog.capabilities.find((c:{id:string})=>c.id===write),written=await cli(writable.command);
    expect(written.code).toBe(0);expect(JSON.parse(written.stdout)).toMatchObject({schema:'willyou-plugin-result-v1',capabilityId:write,operation:{effectState:'completed'}});
    expect(approve).toHaveBeenCalledTimes(1);expect(calls()).toHaveLength(2);expect(count()).toEqual({n:2});
  });
  it.each(['mcp','cli'] as const)('executes %s via the common host service and records actual package/run identities',async entry=>{
    await launch(entry);expect((await tools.list(run!.runId)).tools.map(t=>t.name)).toContain(entry==='mcp'?pluginMcpToolName(read):read);
    const result=await call(read,{},randomUUID(),entry);expect(result).toMatchObject({status:'ok',value:{version:'0.1.0',capability:read},effectState:'read-only'});
    expect(f.sqlite.prepare('SELECT run_id,project_id,task_id,app_id,package_hash,state,attempt_count FROM application_invocations').get()).toMatchObject({run_id:run!.runId,project_id:'p1',task_id:runs.assertActive(run!.runId).run.taskId,app_id:'demo-tracker',package_hash:life.state('demo-tracker').hash,state:'succeeded',attempt_count:1});
    expect(calls()).toHaveLength(1);expect(calls()[0].connection).toEqual({source:'synthetic-host-only'});expect(approve).not.toHaveBeenCalled();
  });
  it('uses the current version after upgrade while keeping discovery fixed to launch capabilities',async()=>{
    await launch();const old=selection.packageHash;await install(candidate('0.2.0',{extra:true}));
    expect(await call()).toMatchObject({status:'ok',value:{version:'0.2.0'}});
    expect((await tools.list(run!.runId)).tools.map(t=>t.name)).not.toContain(pluginMcpToolName('demo-tracker.items.extra'));
    expect(await call('demo-tracker.items.extra')).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
    expect(f.sqlite.prepare('SELECT package_hash FROM application_invocations').get()).toEqual({package_hash:life.state('demo-tracker').hash});expect(life.state('demo-tracker').hash).not.toBe(old);expect(calls()).toHaveLength(1);
  });
  it('resolves the old MCP alias and renamed capability through the current manifest',async()=>{
    await launch();await install(candidate('0.2.0',{rename:true}));
    expect(await call()).toMatchObject({status:'ok',value:{capability:'demo-tracker.items.scan'}});
    expect(await tools.call(run!.runId,randomUUID(),{operation:'smartdd_demo_list_v1',contractMajor:1,connectionId:null,arguments:{}})).toMatchObject({status:'ok',value:{capability:'demo-tracker.items.scan'}});
  });
  it('keeps the accepted old version while host approval is pending, then uses the new version',async()=>{
    await launch();let release!:()=>void;approve.mockImplementationOnce(()=>new Promise<void>(ok=>{release=ok;}));
    const first=call(write);await vi.waitFor(()=>expect(approve).toHaveBeenCalledTimes(1));
    expect(calls()).toHaveLength(0);let updated=false;const update=install(candidate('0.2.0')).then(()=>{updated=true;});
    await new Promise(ok=>setTimeout(ok,20));expect(updated).toBe(false);release();
    expect(await first).toMatchObject({status:'ok',value:{version:'0.1.0'}});await update;expect(await call(write)).toMatchObject({status:'ok',value:{version:'0.2.0'}});
  });
  it('records denied approval as not-started and starts no invocation child or credential lookup',async()=>{
    await launch();approve.mockRejectedValueOnce(new ApplicationError('AUTHORIZATION_REQUIRED','synthetic user declined'));
    expect(await call(write)).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED',effectState:'not-started',retryable:false}});
    expect(calls()).toHaveLength(0);expect(connection).not.toHaveBeenCalled();
    expect(f.sqlite.prepare("SELECT count(*) n FROM plugin_runtime_leases WHERE kind='invocation' AND pid IS NOT NULL").get()).toEqual({n:0});
    expect(f.sqlite.prepare('SELECT state,effect_state FROM application_invocations').get()).toEqual({state:'failed',effect_state:'not-started'});
  });
  it('refuses project/global disable and model-selected connection before a new ledger entry',async()=>{
    await launch();projectEnabled=false;expect(await call()).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});projectEnabled=true;
    expect(await tools.call(run!.runId,randomUUID(),{operation:pluginMcpToolName(read),contractMajor:1,connectionId:randomUUID(),arguments:{}})).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});
    await life.setEnabled('demo-tracker',false,life.state('demo-tracker').revision);expect(await call()).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});expect(count()).toEqual({n:0});expect(calls()).toHaveLength(0);
  });
  it('rechecks project authorization after approval and never dispatches after revocation',async()=>{
    await launch();approve.mockImplementationOnce(async()=>{projectEnabled=false;});expect(await call(write)).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED',effectState:'not-started'}});expect(calls()).toHaveLength(0);expect(connection).not.toHaveBeenCalled();
  });
  it('rejects invalid schemas and a read-to-write change without executing',async()=>{
    await launch();expect(await call(read,{value:123})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});expect(count()).toEqual({n:0});
    await install(candidate('0.2.0',{semantics:true}));expect(await call()).toMatchObject({status:'error',error:{code:'CONFIG_INCOMPATIBLE'}});expect(calls()).toHaveLength(0);
  });
  it('does not replay a write after a lost result, including duplicate requests',async()=>{
    await install(candidate('0.2.0',{crashWrite:true}));await launch();const id=randomUUID();
    expect(await call(write,{},id)).toMatchObject({status:'error',error:{effectState:'unknown',retryable:false}});
    expect(await call(write,{},id)).toMatchObject({status:'error',error:{effectState:'unknown',retryable:false}});expect(calls()).toHaveLength(1);expect(count()).toEqual({n:1});
  });
  it('rejects the stopped native run without starting plugin execution',async()=>{
    await launch();await run!.cli.exited();expect(await call()).toMatchObject({status:'error',error:{code:'SCOPE_DENIED'}});expect(calls()).toHaveLength(0);expect(count()).toEqual({n:0});
  });
  it('publishes shared schema refs that compile independently in an Agent client',()=>{
    const f=fixture();f.manifest.ui.panels=[];Object.assign(f.manifest,{schemas:['schemas/shared.json']});
    f.files.set('schemas/shared.json',Buffer.from(JSON.stringify({$id:'shared-value',type:'object',properties:{value:{type:'string'}},required:['value']})));
    f.files.set('schemas/input.json',Buffer.from(JSON.stringify({type:'object',properties:{item:{$ref:'shared-value'}},required:['item']})));
    const p=validatePluginBundle(f.bundle()),schema=pluginToolSchema(p,'schemas/input.json'),validate=new AjvJsonSchemaValidator().getValidator(schema);
    expect(validate({item:{value:'ok'}}).valid).toBe(true);expect(validate({item:{value:123}}).valid).toBe(false);
  });
  it('reads only the launch-bound connection from real host tables after a project account switch',async()=>{
    await install(candidate('0.2.0',{connection:true}));const [first,second]=connectionRows();await launch('mcp',false,[{slot:'tracker-api',connectionId:first,identityRevision:1}]);
    const get=vi.fn((key:string)=>'synthetic value for '+key),policy=new PluginProjectPolicy(f.store,life,{get},{assertRun:id=>runs.assertActive(id),approve:async()=>{}}),context=runs.assertActive(run!.runId),cap=selection.capabilities.find(c=>c.id===read)!;
    expect(policy.capture('p1')[0]).toMatchObject({bindingRevision:1,connections:[{connectionId:first}]});
    f.sqlite.prepare("UPDATE application_project_bindings SET connection_id=? WHERE project_id='p1' AND app_id='demo-tracker'").run(second);
    expect(policy.capture('p1')[0].connections[0].connectionId).toBe(second);
    expect(await policy.connection(context,selection,cap,context.signal)).toEqual({'tracker-api':{id:first,provider:'tracker-api',config:{baseUrl:'http://127.0.0.1/synthetic-0'},identityRevision:1,configRevision:1,policyRevision:1,identity:{providerId:'tracker-api',serviceId:'synthetic-service',accountId:'synthetic-0',contractMajor:1},authMode:'token',secret:'synthetic value for synthetic-secret-0'}});
    const resolved=await policy.connection(context,selection,cap,context.signal);
    f.sqlite.prepare("UPDATE application_project_settings SET binding_revision=8 WHERE project_id='p1' AND app_id='demo-tracker'").run();
    expect(policy.capture('p1')[0].bindingRevision).toBe(8);
    expect(policy.sourceRevisions(context,selection,cap,resolved)).toEqual([{slot:'tracker-api',connectionId:first,identityRevision:1,configRevision:1,policyRevision:1,bindingRevision:1}]);
    expect(get.mock.calls).toEqual([['synthetic-secret-0'],['synthetic-secret-0']]);

    f.sqlite.prepare('UPDATE application_connections SET identity_revision=2 WHERE id=?').run(first);
    await expect(policy.connection(context,selection,cap,context.signal)).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(get).toHaveBeenCalledTimes(2);
  });
  it('does not invent a selection revision for a historical plugin snapshot',async()=>{
    await install(candidate('0.2.0',{connection:true}));const [first]=connectionRows();await launch('mcp',false,[{slot:'tracker-api',connectionId:first,identityRevision:1}],null);
    const policy=new PluginProjectPolicy(f.store,life,{get:()=> 'synthetic'},{assertRun:id=>runs.assertActive(id),approve:async()=>{}}),context=runs.assertActive(run!.runId),cap=selection.capabilities.find(c=>c.id===read)!;
    const resolved=await policy.connection(context,selection,cap,context.signal);
    expect(()=>policy.sourceRevisions(context,selection,cap,resolved)).toThrow('缺少连接选用修订');
  });
  it('refuses a disabled project and incompatible saved config before decrypting any secret',async()=>{
    await install(candidate('0.2.0',{connection:true}));const [first]=connectionRows();await launch('mcp',false,[{slot:'tracker-api',connectionId:first,identityRevision:1}]);
    const get=vi.fn(()=> 'synthetic'),policy=new PluginProjectPolicy(f.store,life,{get},{assertRun:id=>runs.assertActive(id),approve:async()=>{}}),context=runs.assertActive(run!.runId),cap=selection.capabilities.find(c=>c.id===read)!;
    f.sqlite.prepare("UPDATE application_project_settings SET enabled=0 WHERE project_id='p1' AND app_id='demo-tracker'").run();
    await expect(policy.connection(context,selection,cap,context.signal)).rejects.toMatchObject({code:'APP_NOT_ENABLED'});
    f.sqlite.prepare("UPDATE application_project_settings SET enabled=1 WHERE project_id='p1' AND app_id='demo-tracker'").run();
    f.sqlite.prepare('UPDATE application_connections SET config_json=? WHERE id=?').run('{"kind":"tracker-api","authMode":"token","baseUrl":123}',first);
    await expect(policy.connection(context,selection,cap,context.signal)).rejects.toMatchObject({code:'CONFIG_INCOMPATIBLE'});expect(get).not.toHaveBeenCalled();
  });
  it('withholds credentials if a connection changes while the secret reader is active',async()=>{
    await install(candidate('0.2.0',{connection:true}));const [first]=connectionRows();await launch('mcp',false,[{slot:'tracker-api',connectionId:first,identityRevision:1}]);
    const get=vi.fn(()=>{f.sqlite.prepare('UPDATE application_connections SET revision=revision+1 WHERE id=?').run(first);return 'synthetic';}),policy=new PluginProjectPolicy(f.store,life,{get},{assertRun:id=>runs.assertActive(id),approve:async()=>{}}),context=runs.assertActive(run!.runId),cap=selection.capabilities.find(c=>c.id===read)!;
    await expect(policy.connection(context,selection,cap,context.signal)).rejects.toMatchObject({code:'REVISION_CONFLICT'});expect(get).toHaveBeenCalledTimes(1);expect(calls()).toHaveLength(0);
  });
});

describe('production default write confirmation with real run ledger and sandbox plugin',()=>{
  async function setup(options:{crashWrite?:boolean}={}){
    await install(candidate('0.2.0',{connection:true,crashWrite:options.crashWrite}));const ids=connectionRows();
    await launch('mcp',false,[{slot:'tracker-api',connectionId:ids[0],identityRevision:1}]);await life.close();
    const get=vi.fn(()=> 'SYNTHETIC_APPROVAL_SECRET');
    const processes=new MacProcessIdentityReader(resolve('out/native/willyou-process-identity'));
    const secrets=new SecretsStore(drizzle(f.sqlite,{schema:dbSchema}),{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});vi.spyOn(secrets,'get').mockImplementation(get);
    const host=new PluginHostService(f.store,secrets,{processes,runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[join(f.root,'synthetic-keychain')]}});
    productionHost=host;host.attachRuns(runs);
    tools=new ApplicationToolService(f.store,runs,{resolve:()=>{throw new Error('Plugin entered builtin');}},{additional:host.tools});
    const pty=f.sqlite.prepare('SELECT pty_id FROM capability_runs WHERE run_id=?').get(run!.runId) as {pty_id:string};
    const target={taskId:runs.assertActive(run!.runId).run.taskId,ptyId:pty.pty_id};
    const displayed=async()=>{let items:ReturnType<typeof host.approvals.present>=[];await vi.waitFor(()=>{items=host.approvals.present('renderer-1',target);expect(items).toHaveLength(1);});return items[0];};
    const decide=(review:Awaited<ReturnType<typeof displayed>>,allow:boolean,owner='renderer-1')=>host.approvals.decide(owner,{...target,id:review.id,displayReceiptId:review.displayReceiptId,reviewHash:review.reviewHash,allow});
    return{host,get,ids,target,displayed,decide,processes};
  }
  it('requires exact current-window review, denies without decrypting or dispatching, and records only hashed input',async()=>{
    const s=await setup(),pending=call(write,{value:'original'}),review=await s.displayed();
    expect(review).toMatchObject({input:{value:'original'},version:'0.2.0',targets:[{name:'Synthetic 0',connectionId:s.ids[0]}]});expect(s.get).not.toHaveBeenCalled();expect(calls()).toHaveLength(0);
    expect(()=>s.decide(review,true,'renderer-2')).toThrow('审阅');expect(s.host.approvals.present('renderer-1',{...s.target,ptyId:'other-pty'})).toEqual([]);
    s.decide(review,false);expect(await pending).toMatchObject({status:'error',error:{code:'PERMISSION_DENIED',layer:'auth',effectState:'not-started'}});expect(s.get).not.toHaveBeenCalled();expect(calls()).toHaveLength(0);
    const audit=f.sqlite.prepare('SELECT state,input_hash,provenance_json FROM plugin_write_approvals').get() as Record<string,unknown>;expect(audit.state).toBe('denied');expect(JSON.stringify(audit)).not.toContain('original');expect(audit.provenance_json).toContain('renderer-confirmation');
  });
  it('executes only the approved input once, even if the caller mutates its object while waiting',async()=>{
    const s=await setup(),input={value:'approved value'},requestId=randomUUID(),pending=call(write,input,requestId),review=await s.displayed();input.value='changed after review';
    s.decide(review,true);expect(await pending).toMatchObject({status:'ok',effectState:'completed'});expect(calls()).toHaveLength(1);expect(calls()[0].input).toEqual({value:'approved value'});expect(s.get).toHaveBeenCalledTimes(1);
    expect(()=>s.decide(review,true)).toThrow('审阅');expect(await call(write,{value:'approved value'},requestId)).toMatchObject({status:'ok'});expect(calls()).toHaveLength(1);expect(s.host.approvals.present('renderer-1',s.target)).toEqual([]);
    expect(f.sqlite.prepare('SELECT state FROM plugin_write_approvals').get()).toEqual({state:'allowed'});
  });
  it('invalidates an old account/configuration decision before decrypting or executing',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed();f.sqlite.prepare('UPDATE application_connections SET revision=revision+1,config_revision=config_revision+1 WHERE id=?').run(s.ids[0]);
    expect(()=>s.decide(review,true)).toThrow('变化');expect(await pending).toMatchObject({status:'error',error:{effectState:'not-started'}});expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT state FROM plugin_write_approvals').get()).toEqual({state:'invalidated'});
  });
  it('keeps a pending write on the original run account when only the project default binding changes',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed();
    const target={appId:'demo-tracker',packageHash:s.host.catalog()[0].hash!,connectionId:s.ids[1]},plan=s.host.connections.planDefault(target);await s.host.connections.setDefault({...target,planHash:plan.planHash});
    try{expect(()=>s.decide(review,true)).not.toThrow();expect(await pending).toMatchObject({status:'ok'});expect(calls()).toHaveLength(1);expect(s.get.mock.calls).toEqual([['synthetic-secret-0']]);}
    finally{await pending;}
  });
  it('prevents deleting the original connection of an active run even after the project points elsewhere; stopped runs no longer block',async()=>{
    const s=await setup(),target={appId:'demo-tracker',packageHash:s.host.catalog()[0].hash!,connectionId:s.ids[0]};
    f.sqlite.prepare("UPDATE application_project_bindings SET connection_id=? WHERE project_id='p1' AND app_id='demo-tracker'").run(s.ids[1]);
    const plan=s.host.connections.planDelete(target);expect(plan.running).toHaveLength(1);await expect(s.host.connections.delete({...target,planHash:plan.planHash})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(f.sqlite.prepare('SELECT 1 FROM application_connections WHERE id=?').get(s.ids[0])).toBeTruthy();
    await run!.stop();await run!.cli.exited();expect(runs.get(run!.runId).state).toBe('stopped');expect(s.host.connections.planDelete(target).running).toEqual([]);const fresh=s.host.connections.planDelete(target);await s.host.connections.delete({...target,planHash:fresh.planHash});expect(f.sqlite.prepare('SELECT 1 FROM application_connections WHERE id=?').get(s.ids[0])).toBeUndefined();expect(f.sqlite.prepare('SELECT 1 FROM application_connections WHERE id=?').get(s.ids[1])).toBeTruthy();
  });
  it('cancels the pending confirmation when its tool request is cancelled',async()=>{
    const s=await setup(),abort=new AbortController(),requestId=randomUUID(),pending=tools.call(run!.runId,requestId,{operation:pluginMcpToolName(write),contractMajor:1,connectionId:null,arguments:{}},abort.signal),review=await s.displayed();abort.abort();
    expect(await pending).toMatchObject({status:'error',error:{code:'CANCELED',effectState:'not-started'}});await vi.waitFor(()=>expect(s.host.approvals.present('renderer-1',s.target)).toEqual([]));expect(()=>s.decide(review,true)).toThrow('审阅');expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();
    await vi.waitFor(()=>expect(f.sqlite.prepare('SELECT effect_state FROM application_invocations').get()).toEqual({effect_state:'not-started'}));
  });
  it('expires at the original host operation deadline and never turns a later decision into execution',async()=>{
    const s=await setup(),request=vi.spyOn(s.host.approvals,'request'),pending=call(write),review=await s.displayed();
    const originalDeadline=request.mock.calls[0][4].deadline;expect(review.expiresAt).toBe(originalDeadline);
    // Advance only after the genuine pending review exists; a 100ms startup race cannot test this invariant.
    const clock=vi.spyOn(Date,'now').mockReturnValue(originalDeadline+1);
    try{s.host.approvals.present('renderer-1',s.target);expect(await pending).toMatchObject({status:'error',error:{code:'TIMEOUT',effectState:'not-started'}});expect(()=>s.decide(review,true)).toThrow();expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT state FROM plugin_write_approvals').get()).toEqual({state:'expired'});}finally{clock.mockRestore();request.mockRestore();await pending;}
  });
  it('keeps an approved crashed write unknown and does not ask again or replay it',async()=>{
    const s=await setup({crashWrite:true}),requestId=randomUUID(),pending=call(write,{},requestId),review=await s.displayed();s.decide(review,true);
    expect(await pending).toMatchObject({status:'error',error:{code:'UPSTREAM_RESULT_UNKNOWN',effectState:'unknown'}});expect(await call(write,{},requestId)).toMatchObject({status:'error',error:{effectState:'unknown'}});expect(calls()).toHaveLength(1);expect(s.host.approvals.present('renderer-1',s.target)).toEqual([]);
  });
  it('retains the accepted old version while confirmation is pending and executes it before upgrading',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed();let updated=false;
    const replacement=candidate('0.3.0',{connection:true}),updating=s.host.lifecycle.install(replacement,s.host.lifecycle.inspect(replacement)).then(()=>{updated=true;});
    expect(updated).toBe(false);expect(calls()).toHaveLength(0);s.decide(review,true);expect(await pending).toMatchObject({status:'ok',value:{version:'0.2.0'}});await updating;expect(s.host.catalog()[0].version).toBe('0.3.0');
  });
  it('fails closed when recording a human decision fails in SQLite',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed();f.sqlite.exec("CREATE TRIGGER fail_write_decision BEFORE UPDATE ON plugin_write_approvals BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END");
    expect(()=>s.decide(review,true)).toThrow('无法安全记录');expect(await pending).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED',effectState:'not-started'}});expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();
    f.sqlite.exec('DROP TRIGGER fail_write_decision');f.sqlite.prepare("UPDATE plugin_write_approvals SET host_pid=12345,host_started_at='darwin-proc-v1:1700000000:123' WHERE approval_id=?").run(review.id);
    const state=vi.spyOn(s.processes,'state').mockReturnValue('stopped');try{expect(s.host.approvals.recover()).toEqual({recovered:[review.operationId],pending:[]});expect(f.sqlite.prepare('SELECT state FROM plugin_write_approvals').get()).toEqual({state:'invalidated'});expect(f.sqlite.prepare('SELECT error_code,effect_state FROM application_invocations').get()).toEqual({error_code:'AUTHORIZATION_REQUIRED',effect_state:'not-started'});}finally{state.mockRestore();}
  });
  it('rechecks the exact account again after an allow decision, before reading credentials',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed();s.decide(review,true);f.sqlite.prepare('UPDATE application_connections SET revision=revision+1 WHERE id=?').run(s.ids[0]);
    expect(await pending).toMatchObject({status:'error',error:{effectState:'not-started'}});expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();
  });
  it('reports an approved request that exceeds its final private frame budget as not-started',async()=>{
    const s=await setup();s.get.mockReturnValue('SYNTHETIC_PRIVATE'.repeat(10000));const pending=call(write,{value:'x'.repeat(260000)}),review=await s.displayed();s.decide(review,true);
    expect(await pending).toMatchObject({status:'error',error:{code:'TOO_LARGE',effectState:'not-started'}});expect(calls()).toHaveLength(0);
  });
  it('invalidates the prompt when the original native run stops',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed(),owned=run!,stopping=owned.stop('synthetic-user-stop');
    expect(await pending).toMatchObject({status:'error',error:{code:'CANCELED',effectState:'not-started'}});await owned.cli.exited();await stopping;run=undefined;
    expect(()=>s.decide(review,true)).toThrow('审阅');expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();expect(f.sqlite.prepare('SELECT state FROM plugin_write_approvals').get()).toEqual({state:'cancelled'});
  });
  it('limits pending confirmations to four per run and never dispatches the excess write',async()=>{
    const s=await setup(),pending=[call(write),call(write),call(write),call(write)];await vi.waitFor(()=>expect(s.host.approvals.present('renderer-1',s.target)).toHaveLength(4));
    expect(await call(write)).toMatchObject({status:'error',error:{code:'RESOURCE_BUSY',effectState:'not-started'}});expect(calls()).toHaveLength(0);expect(s.get).not.toHaveBeenCalled();s.host.approvals.close();expect((await Promise.all(pending)).every(r=>r.status==='error')).toBe(true);
  });
  it('recovers only a never-approved write of a confirmed stopped host and does not downgrade an allowed unknown write',async()=>{
    const s=await setup(),pending=call(write),review=await s.displayed();s.decide(review,false);await pending;
    f.sqlite.prepare("UPDATE plugin_write_approvals SET state='pending',host_pid=12345,host_started_at='darwin-proc-v1:1700000000:123' WHERE approval_id=?").run(review.id);
    f.sqlite.prepare("UPDATE application_invocations SET state='unknown',effect_state='unknown' WHERE operation_id=?").run(review.operationId);
    const state=vi.spyOn(s.processes,'state');try{
      state.mockReturnValue('running');expect(s.host.approvals.recover()).toEqual({recovered:[],pending:[review.operationId]});
      state.mockReturnValue('unknown');expect(s.host.approvals.recover()).toEqual({recovered:[],pending:[review.operationId]});
      state.mockReturnValue('stopped');expect(s.host.approvals.recover()).toEqual({recovered:[review.operationId],pending:[]});
      expect(f.sqlite.prepare('SELECT state,effect_state FROM application_invocations WHERE operation_id=?').get(review.operationId)).toEqual({state:'failed',effect_state:'not-started'});
      f.sqlite.prepare("UPDATE plugin_write_approvals SET state='allowed' WHERE approval_id=?").run(review.id);f.sqlite.prepare("UPDATE application_invocations SET state='unknown',effect_state='unknown' WHERE operation_id=?").run(review.operationId);
      expect(s.host.approvals.recover()).toEqual({recovered:[],pending:[]});expect(f.sqlite.prepare('SELECT state,effect_state FROM application_invocations WHERE operation_id=?').get(review.operationId)).toEqual({state:'unknown',effect_state:'unknown'});expect(calls()).toHaveLength(0);
    }finally{state.mockRestore();}
  });
});
