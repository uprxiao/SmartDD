import {PtyAccess} from '../../../pty-access';
import {fixture as pluginFixture} from '../plugins/__tests__/fixture';
import {pluginMcpToolName} from '../plugins/session-tools';
import {MacProcessIdentityReader} from '../process-identity';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import {ApplicationConnectionService} from '../connection-service';
import type {ApplicationUiSender} from '../execution-context';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,realpathSync,renameSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import Database from 'better-sqlite3';
import {drizzle} from 'drizzle-orm/better-sqlite3';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {runBundledMigrations} from '../../../db/migrations';
import * as schema from '../../../db/schema';
import {SecretsStore} from '../../../secrets';
import type {SpawnOptions} from '../../../pty-manager';
import type {TaskCapabilityLaunch} from '../../tasks/capability-lifecycle';
import {ProjectService} from '../../projects/project-service';
import {AiProfileService} from '../../ai/ai-profile-service';
import {CapabilityService} from '../../capabilities/capability-service';
import {TaskService,type PtyHost} from '../../tasks/task-service';
import {ResourceStore} from '../resource-store';
import {AgentSupportService} from '../agent-support-service';
import {ApplicationService} from '../application-service';
import {ManagedTaskCapabilities} from '../task-capability-launcher';
import {FixtureProcessReader} from './run-fixture';
import {encodeClaudeDir} from '../../tasks/native-sessions';
import {ApplicationToolService} from '../tool-service';
import {canonicalJson,digest,validatePackageBundle} from '../manifest';
import {builtinApplicationModules} from '../modules';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {CapabilityBundleSource} from '../bundle-source';
import {installCliFixturePackage} from './cli-fixture';
import {connect} from 'node:net';
import {VALUE_PREFIX} from '../../../launch-env';
import {codexServerArgs,type CodexTaskServerRequest,type PrivateCodexTaskServer} from '../codex-task-server';
import {UpstreamSessionPool} from '../upstream/session-pool';
import type {BridgeResponse} from '@shared/application-bridge';
let root:string,home:string,cwd:string,sqlite:Database.Database,capabilities:CapabilityService,support:AgentSupportService,applications:ApplicationService,managed:ManagedTaskCapabilities,tasks:TaskService,projects:ProjectService,profiles:AiProfileService,reader:FixtureProcessReader,ptys:TestPtys,projectId:string,codexId:string,claudeId:string;
let expectedDisposeError:unknown;
let pluginWrites:{id:string;data:string}[]=[],pluginUrls:string[]=[];
let argMax:number|null;
let applicationRuntimeAvailable:boolean;
let cliPolicyAvailable:boolean;
let codexRequests:CodexTaskServerRequest[]=[],codexStarted:string[]=[],codexStopped:string[]=[],codexStartFailure=false;
const fixtureCliPolicy={available:true as const,kind:'inherit' as const,parent:':read-only',networkProxy:true,enableNetwork:true,existingNames:[],source:'controlled-effective-policy-fixture',digest:digest('controlled-effective-policy-fixture')};
// TestPtys has no native bridge child. Its synthetic exit callbacks must settle
// before their SQLite store/root is closed; retain every rejection for teardown.
let fixtureBridgeExits:Promise<PromiseSettledResult<void>>[]=[];
function queueFixtureBridgeExit(handle:{exited():Promise<void>}):void{
 fixtureBridgeExits.push(handle.exited().then(value=>({status:'fulfilled' as const,value}),reason=>({status:'rejected' as const,reason})));
}
async function drainFixtureBridgeExits():Promise<unknown[]>{
 const failures:unknown[]=[];
 while(fixtureBridgeExits.length){for(const result of await Promise.all(fixtureBridgeExits.splice(0)))if(result.status==='rejected')failures.push(result.reason);}
 return failures;
}
/** Task wiring only: native Codex/Unix ownership is tested separately. Both
 * backend roles and their explicit fake exit events are persisted here. */
async function prepareSyntheticCodexServer(request:CodexTaskServerRequest):Promise<PrivateCodexTaskServer>{
 codexRequests.push(request);codexServerArgs(request.profileArgs,request.managedArgs);
 const launcher=await request.run.reserveBridge(),server=await request.run.reserveBridge();let state:PrivateCodexTaskServer['state']='prepared',pid:number|undefined,closing:Promise<void>|undefined;
 const stop=():Promise<void>=>{if(state==='stopped')return Promise.resolve();if(closing)return closing;closing=(async()=>{state='stopping';if(pid===undefined){await launcher.cancelUnforked!();await server.cancelUnforked!();}else{reader.identities.delete(pid);await launcher.exited();await server.exited();}codexStopped.push(request.run.runId);state='stopped';})();return closing;};
 return{url:'unix:///private/tmp/synthetic-codex-'+request.run.runId,get state(){return state;},recoveryWarnings:[],stop,start:async()=>{
  state='starting';await launcher.arm();await server.arm();pid=51000+codexStarted.length;reader.identities.set(pid,'darwin-proc-v1:400:'+pid);await launcher.attach(pid);await server.attach(pid);codexStarted.push(request.run.runId);
  if(codexStartFailure)throw new Error('controlled-private-server-start-failure');state='ready';
 }};
}
class TestPtys extends EventEmitter implements PtyHost{
 readonly live=new Map<string,number>();readonly launches:SpawnOptions[]=[];
 spawn(options:SpawnOptions){this.launches.push(options);const pid=31000+this.launches.length;this.live.set(options.id!,pid);reader.identities.set(pid,'darwin-proc-v1:300:'+pid);return options.id!;}
 nativePid(id:string){return this.live.get(id)??null;}
 kill(id:string){const pid=this.live.get(id);if(pid){reader.identities.delete(pid);this.live.delete(id);this.emit('exit',id,0);}}
}
beforeEach(async({task})=>{
 pluginWrites=[];pluginUrls=[];codexRequests=[];codexStarted=[];codexStopped=[];codexStartFailure=false;cliPolicyAvailable=true;const withPlugins=task.suite?.name==='M13 P1 plugins through production task startup';const withCli=withPlugins||['M11 S5 CLI delivery through the production task entry','M11 R1.0 library launch through the production task entry'].includes(task.suite?.name??'');
 fixtureBridgeExits=[];expectedDisposeError=undefined;applicationRuntimeAvailable=true;argMax=1048576;root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-launch-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(join(home,'.claude'));
 sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(db,secrets);profiles=new AiProfileService(db,secrets);projectId=projects.createProject({name:'isolated production composition',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 // Only this private, harmless version fixture is executed. It does not emulate a native Agent session.
 const command=join(root,'version-fixture');writeFileSync(command,'#!/bin/sh\ncase "$1" in --version) echo "0.162.1";; *) exit 70;; esac\n',{mode:0o700});
 codexId=profiles.create({name:'Codex version fixture',runner:'codex',executable:command,args:[],env:[],color:null,isDefault:true}).id;
 const cc=join(root,'cc-version-fixture');writeFileSync(cc,'#!/bin/sh\ncase "$1" in --version) echo "2.1.303 (Claude Code)";; *) exit 70;; esac\n',{mode:0o700});claudeId=profiles.create({name:'CC version fixture',runner:'claude',executable:cc,args:[],env:[],color:null,isDefault:false}).id;
 capabilities=new CapabilityService({db,projects,secrets,userData:root});support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,resolve('out/capability-bundles-compatibility-v1'));await support.initialize();expect(support.status().state).toBe('ready');reader=new FixtureProcessReader();ptys=new TestPtys();tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',...(withCli?{WILLYOU_RUN_TOKEN:'OUTER_RUN_TOKEN_MUST_NOT_LEAK',WILLYOU_ENDPOINT:'/private/tmp/outer.sock'}:{})}),onChanged:()=>{},codexPollMs:20,launchArgMax:()=>argMax});
 applications=new ApplicationService(support.store,{secrets,projects,tasks,...(withPlugins?{openPluginUrl:async(url:string)=>{pluginUrls.push(url);},terminal:{access:new PtyAccess({trusted:()=>true,activePty:id=>tasks.activePty(id),alive:id=>ptys.live.has(id),write:()=>{},resize:()=>{},killTask:()=>{}}),bracketedPaste:async()=>true,write:(id:string,data:string)=>{pluginWrites.push({id,data});}},plugins:{processes:new MacProcessIdentityReader(resolve('out/native/willyou-process-identity')),runtime:{executable:process.execPath,readOnlyRoots:[process.execPath],keychainRoots:[home]}}}:{}),activePty:id=>tasks.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes:reader});await applications.recover();managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:join(root,'unused-helper'),processes:reader,...(withCli?{cliPath:realpathSync(resolve('out/native/willyou-app')),inspectSandbox:async()=>cliPolicyAvailable?fixtureCliPolicy:{available:false as const,reason:'controlled-unverified-policy',source:'unverified-effective-policy',digest:null}}:{}),peers:{read:async()=>withCli?{schema:2,state:'running',uid:process.getuid!(),peer:{pid:32001,startedAt:'darwin-proc-v1:300:32001',executable:realpathSync(resolve('out/native/willyou-app'))},ancestors:[{pid:32001,startedAt:'darwin-proc-v1:300:32001',ppid:31000+ptys.launches.length},{pid:31000+ptys.launches.length,startedAt:'darwin-proc-v1:300:'+(31000+ptys.launches.length),ppid:1}]}:null},probeApplicationRuntime:async()=>applicationRuntimeAvailable,...(withPlugins?{prepareCodexServer:prepareSyntheticCodexServer}:{}),stopPty:id=>ptys.kill(id),pollMs:20});tasks.attachManagedCapabilities(managed);
 // Codex and Claude start their configured MCP servers with the session, so the bridge child exits with the Agent.
 // TestPtys forks nothing: settle each prepared bridge handle when its PTY is killed.
 const handles=new Map<string,Awaited<ReturnType<typeof managed.broker.prepare>>['bridge']>(),prepare=managed.broker.prepare.bind(managed.broker),kill=ptys.kill.bind(ptys);
 vi.spyOn(managed.broker,'prepare').mockImplementation(async(...args)=>{const value=await prepare(...args);handles.set(args[0].ptyId,value.bridge);return value;});
 vi.spyOn(ptys,'kill').mockImplementation(id=>{kill(id);const handle=handles.get(id);if(handle){handles.delete(id);queueFixtureBridgeExit(handle);}});

});
afterEach(async()=>{
 const failures:unknown[]=[];
 try{tasks?.dispose();for(const id of ptys?.live?.keys()??[])ptys.kill(id);await applications?.dispose();}catch(error){failures.push(error);}
 failures.push(...await drainFixtureBridgeExits());
 try{await managed?.dispose();}catch(error){if(error!==expectedDisposeError)failures.push(error);}
 failures.push(...await drainFixtureBridgeExits());
 capabilities?.dispose();sqlite?.close();rmSync(root,{recursive:true,force:true});
 if(failures.length)throw new AggregateError(failures,'Synthetic bridge exits and fixture disposal must complete before store cleanup');
});
const create=(id=codexId)=>tasks.create({projectId,dirId:null,aiProfileId:id,firstMessage:''});

describe('M11 S5 CLI delivery through the production task entry',()=>{
 const policy=fixtureCliPolicy;
 beforeEach(async()=>{
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.166.0";; *) exit 70;; esac\n',{mode:0o700});
  await installCliFixturePackage(support.store,join(root,'cli-distribution'));
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
 });
 const request=(token:string)=>new Promise<BridgeResponse>((ok,fail)=>{
  const socket=connect(managed.cli!.endpoint),timer=setTimeout(()=>{socket.destroy();fail(Error('Private S5 host deadline'));},5000);let text='';
  socket.on('error',error=>{clearTimeout(timer);fail(error);});socket.on('data',chunk=>{text+=String(chunk);if(text.includes('\n')){clearTimeout(timer);socket.end();ok(JSON.parse(text.slice(0,text.indexOf('\n'))));}});
  socket.on('connect',()=>socket.write(JSON.stringify({schema:'willyou-cli-v1',id:randomUUID(),token,method:'capabilities/call',call:{operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}}})+'\n'));
 });
 it('fixes a CLI plan without per-run Skill copies and supplies an environment-only token that dies at stop',async()=>{
  const running=await create(),launch=ptys.launches[0],runtime=running.task.runtimeSnapshot!,fixed=(await managed.sessions.get(running.task.id)).snapshot,plan=managed.runs.bridgePreparation(runtime.runId).plan!;
  expect(fixed.schema).toBe(3);expect(fixed.adapterBinding.version).toBe('1.4.0');expect(plan.allowed).toMatchObject([{appId:'mail',capabilityId:'mail.draft.list',entry:'cli'}]);expect(plan.sandbox).toEqual({source:policy.source,digest:policy.digest});
  const token=launch.env![VALUE_PREFIX+'WILLYOU_RUN_TOKEN']!;expect(token).toMatch(/^[a-f0-9]{64}$/);expect(launch.env![VALUE_PREFIX+'WILLYOU_ENDPOINT']).toBe(managed.cli!.endpoint);expect(launch.env![VALUE_PREFIX+'PATH']).toContain(dirname(realpathSync(resolve('out/native/willyou-app'))));
  expect(launch.env).not.toHaveProperty('WILLYOU_CLI_INACTIVE');expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_CLI_INACTIVE');
  expect(JSON.stringify(runtime)).not.toContain(token);expect(readFileSync(runtime.manifestPath,'utf8')).not.toContain(token);expect(JSON.stringify(launch.args)).not.toContain(token);
  // R16: the Skill comes from the machine-wide library (rendered and tested in skill-library-service), never per run.
  expect(plan.skills).toEqual([]);expect(fixed.packages[0].skills).toEqual([]);expect(existsSync(join(home,'.agents/skills'))).toBe(false);

  expect(launch.args).toContain('permissions.wy_cli_'+digest(managed.cli!.endpoint).slice(0,12)+'.extends=":read-only"');expect(launch.args!.join(' ')).toContain(managed.cli!.endpoint);expect(launch.args!.join(' ')).not.toContain('pending-bootstrap.json');
  expect(await request(token)).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list',data:{items:[]},operation:{origin:'cli'}}});
  tasks.kill(running.task.id);await vi.waitFor(()=>expect(ptys.live.size).toBe(0));expect(await request(token)).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
 });
 async function deselectLastCliApp(){
  await applications.selections.select({projectId,appId:'mail',enabled:false,expectedRevision:1,connections:{foxmail:null,smtp:null}});
  await applications.selections.setAdded('browser',true,0);
  await applications.selections.select({projectId,appId:'browser',enabled:false,expectedRevision:0,connections:{}});
 }
 it('keeps identity and snapshot protection with no enabled apps, then authorizes an app enabled in the same run',async()=>{
  await deselectLastCliApp();const running=await create(),launch=ptys.launches[0],runId=running.task.runtimeSnapshot!.runId;
  expect(managed.runs.assertActive(runId).snapshot.packages).toEqual([]);
  expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_CLI_INACTIVE');
  expect(launch.env![VALUE_PREFIX+'WILLYOU_RUN_TOKEN']).toMatch(/^[a-f0-9]{64}$/);
  expect(launch.args!.join(' ')).toContain('wy_cli_');
  expect(launch.args).toContain('shell_snapshot');
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:2,connections:{foxmail:null,smtp:null}});
  expect(managed.runs.assertActive(runId).snapshot.packages.map(p=>p.appId)).toContain('mail');
  tasks.kill(running.task.id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));
  expect(()=>managed.runs.assertActive(runId)).toThrow();
 });
 it.each(['unverified-policy','unknown-version'] as const)('does not deliver the inactive CLI mode for %s',async fault=>{
  await deselectLastCliApp();if(fault==='unverified-policy')cliPolicyAvailable=false;else writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "99.0.0";; *) exit 70;; esac\n');
  const running=await create(),launch=ptys.launches[0];expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_CLI_INACTIVE');expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');
  expect(launch.env![VALUE_PREFIX+'PATH']??'').not.toContain(dirname(realpathSync(resolve('out/native/willyou-app'))));tasks.kill(running.task.id);
 });
 it('rejects an AI profile trying to inject the host inactive marker',async()=>{
  const original=profiles.get(codexId);profiles.update(codexId,{name:original.name,runner:'codex',executable:profiles.resolve(codexId).command,args:[],env:[{name:'WILLYOU_CLI_INACTIVE',value:'1',secret:false}],color:null,isDefault:true});
  await expect(create()).rejects.toThrow('保留变量');expect(ptys.launches).toEqual([]);
 });
 it('uses the declared MCP fallback without a token or policy injection when effective sandbox is unverified',async()=>{
  cliPolicyAvailable=false;const running=await create(),launch=ptys.launches[0],plan=managed.runs.bridgePreparation(running.task.runtimeSnapshot!.runId).plan!;
  expect(plan.allowed).toMatchObject([{entry:'mcp'}]);expect(plan.applications[0]).toMatchObject({fallback:true});expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');expect(launch.env).not.toHaveProperty('WILLYOU_RUN_TOKEN');expect(launch.env).not.toHaveProperty('WILLYOU_ENDPOINT');expect(launch.args!.join(' ')).not.toContain('wy_cli_');
  expect(plan.skills).toEqual([]);

 });

 // M11 T25 regression: FakePTY only; no actual Agent/App/native PTY.
 const t25Unknown=()=>writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "99.0.0";; *) exit 70;; esac\n',{mode:0o700});
 async function t25Capture(running:Awaited<ReturnType<typeof create>>){
  const runtime=running.task.runtimeSnapshot!,snapshot=(await managed.sessions.get(running.task.id)).snapshot,planRow=sqlite.prepare("SELECT plan_json FROM capability_resource_operations WHERE operation_id=? AND kind='application-run-plan'").get('application-run-plan:'+runtime.runId) as {plan_json:string}|undefined;
  const plan=planRow?JSON.parse(planRow.plan_json):null,diagnostic=await applications.sessionDiagnostics.inspect(running.task.id),effective=support.adapters.effective(snapshot.adapterBinding.hash,'99.0.0');
  return{runtime,snapshot,plan,diagnostic,effective,launch:ptys.launches[0],ptyLive:ptys.live.has(running.ptyId),skillFiles:(plan?.skills??[]).map((skill:{nativeName:string})=>{const path=join(home,'.agents/skills',skill.nativeName,'SKILL.md');return{path,text:existsSync(path)?readFileSync(path,'utf8'):null};})};
 }
 async function t25WithoutFallback(){
  const distribution=join(root,'cli-distribution'),original=new CapabilityBundleSource(distribution),entry=original.index.apps.find(a=>a.appId==='mail')!,bundle=original.application(entry);if(bundle.manifest.schema!=='smartdd-app-package-v2')throw Error('v2 required');
  const oldHash=entry.hash,manifest=structuredClone(bundle.manifest);manifest.version='1.1.2';for(const capability of manifest.capabilities)capability.binding={cli:{command:['mail','draft','list']}};
  const checked=validatePackageBundle({manifest,files:bundle.files},builtinApplicationModules),relative='apps/mail/'+manifest.version+'/'+checked.packageHash,dir=join(distribution,relative);mkdirSync(dir,{recursive:true});
  for(const[path,bytes]of Object.entries(checked.files)){mkdirSync(join(dir,path,'..'),{recursive:true});writeFileSync(join(dir,path),bytes);}writeFileSync(join(dir,'manifest.json'),canonicalJson(checked.manifest)+'\n');
  const{indexHash:_,...index}=structuredClone(original.index);index.apps=index.apps.map(a=>a.appId==='mail'?{appId:'mail',version:manifest.version,hash:checked.packageHash,path:relative}:a);index.build.resourceSetHash=digest(canonicalJson({adapters:index.adapters,runtimes:index.runtimes,apps:index.apps}));writeFileSync(join(distribution,'index.json'),canonicalJson({...index,indexHash:digest(canonicalJson(index))})+'\n');
  const source=new CapabilityBundleSource(distribution),builtin=new BuiltinPackageRegistry(support.store),installed=await builtin.install(source,source.index.apps.find(a=>a.appId==='mail')!);await builtin.packages.activate(installed.packageHash,builtin.packages.active('mail')!.generation);expect(builtin.assertTrusted(oldHash).packageHash).toBe(oldHash);return{oldHash,newHash:installed.packageHash};
 }
 it('T25 unknown version actually reads through the declared MCP fallback and receives only the matching SOP',async()=>{
  t25Unknown();const running=await create(),value=await t25Capture(running),service=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data)),response=await service.call(value.runtime.runId,randomUUID(),{operation:'smartdd_mail_draft_list_v2',contractMajor:2,connectionId:null,arguments:{}});
  expect(value.ptyLive).toBe(true);expect(response).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list',data:{items:[]},operation:{origin:'mcp'}}});expect(value.plan.applications[0]).toMatchObject({effectiveEntry:'mcp',fallback:true});expect(value.plan.allowed).toMatchObject([{capabilityId:'mail.draft.list',entry:'mcp'}]);expect(value.skillFiles).toEqual([]);
 });
 it('T25 unknown version marks a CLI-only capability unavailable without injecting another entry or changing the installed original package',async()=>{
  const packages=await t25WithoutFallback();t25Unknown();const running=await create(),value=await t25Capture(running),service=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data),{entry:'cli'}),response=await service.call(value.runtime.runId,randomUUID(),{operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}}),application=value.diagnostic.applications.find(a=>a.appId==='mail');
  expect(value.ptyLive).toBe(true);expect(response.status).toBe('error');expect(application).toBeDefined();const publicPlan=value.diagnostic.currentRun?.runPlan?.applications.find(a=>a.appId==='mail');const unavailableReason=publicPlan?.effectiveEntry==='unavailable'?publicPlan.reason:application!.issueCode;expect(unavailableReason).toEqual(expect.any(String));expect(unavailableReason!.length).toBeGreaterThan(0);if(publicPlan){expect(publicPlan.effectiveEntry).toBe('unavailable');expect(publicPlan.fallback).toBe(false);}expect(value.runtime.mcp.some(m=>m.name.startsWith('wy_'))).toBe(false);expect(value.snapshot.packages[0].version).toBe('1.1.2');expect(value.snapshot.packages[0].packageHash).toBe(packages.newHash);expect(value.snapshot.packages[0].packageHash).not.toBe(packages.oldHash);
 });
 it('T25 unknown version delivers no CLI token or socket policy and closes L2 L3/native authorization while leaving page authorization as an A-layer requirement',async()=>{
  t25Unknown();const running=await create(),value=await t25Capture(running),env=value.launch.env??{},args=value.launch.args??[],native=await applications.nativeMessages.read(value.runtime.runId);
  expect(value.ptyLive).toBe(true);for(const name of ['WILLYOU_RUN_TOKEN','WILLYOU_ENDPOINT']){expect(env).not.toHaveProperty(name);expect(env).not.toHaveProperty(VALUE_PREFIX+name);}expect(args.join(' ')).not.toContain('wy_cli_');expect(args.join(' ')).not.toContain(managed.cli!.endpoint);expect(value.effective.verified).toBe(false);expect(value.effective.levels).not.toContain('L0.cli');expect(value.effective.levels).not.toContain('L2');expect(value.effective.levels).not.toContain('L3');expect(value.effective.nativeSendEvidence).toBe(false);expect(native.messages).toEqual([]);
 });

 it('T25 fixed session resumes under an unknown version via MCP fallback without changing its original selection',async()=>{
  const first=await create(),firstRun=first.task.runtimeSnapshot!.runId,firstPlan=managed.runs.bridgePreparation(firstRun).plan!;expect(firstPlan.allowed).toMatchObject([{capabilityId:'mail.draft.list',entry:'cli'}]);
  const nativeId=await stopForSwitchFixture(first,'codex'),fixed=await managed.sessions.get(first.task.id);expect(tasks.get(first.task.id).recovery).toBe('resumable');expect(managed.runs.get(firstRun).state).toBe('stopped');
  t25Unknown();const resumed=await tasks.open({taskId:first.task.id}),value={...await t25Capture(resumed),launch:ptys.launches.at(-1)!},after=await managed.sessions.get(first.task.id),service=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data)),response=await service.call(value.runtime.runId,randomUUID(),{operation:'smartdd_mail_draft_list_v2',contractMajor:2,connectionId:null,arguments:{}});
  expect(value.runtime.runId).not.toBe(firstRun);expect(resumed.task.nativeSessionId).toBe(nativeId);expect(after.pointer).toEqual(fixed.pointer);expect(after.snapshot).toEqual(fixed.snapshot);expect(after.snapshot.agentAtCreation.version).toBe('0.166.0');expect(value.plan.cliVersion).toBe('99.0.0');expect(value.plan.applications[0]).toMatchObject({effectiveEntry:'mcp',fallback:true});expect(response).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list',operation:{origin:'mcp'},data:{items:[]}}});expect(value.launch.args).toContain('resume');expect(value.launch.args).toContain(nativeId);expect(value.launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');expect(value.launch.args.join(' ')).not.toContain('wy_cli_');expect(value.effective.nativeSendEvidence).toBe(false);expect(value.effective.levels).not.toContain('L2');expect(value.effective.levels).not.toContain('L3');
 },20000);
 // R1.0 R17 (2026-11-04) replaces "old token permanently revoked on authorization change": the token proves identity only.
 it('follows the current project setting with the same token: disabled is refused with guidance, re-enabled works again',async()=>{
  await create();const token=ptys.launches[0].env![VALUE_PREFIX+'WILLYOU_RUN_TOKEN']!;expect(await request(token)).toMatchObject({status:'ok'});
  const before=applications.selections.projectSettings(projectId,'mail');await applications.selections.select({projectId,appId:'mail',enabled:false,expectedRevision:before.revision,connections:{foxmail:null,smtp:null}});
  expect(await request(token)).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});const disabled=applications.selections.projectSettings(projectId,'mail');await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:disabled.revision,connections:{foxmail:null,smtp:null}});
  expect(await request(token)).toMatchObject({status:'ok'});expect(ptys.live.size).toBe(1);expect(sqlite.prepare('SELECT count(*) n FROM application_invocations').get()).toEqual({n:2});
 });
});

describe('M11 R1.0 library launch through the production task entry',()=>{
 beforeEach(async()=>{
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.166.0";; *) exit 70;; esac\n',{mode:0o700});
  await installCliFixturePackage(support.store,join(root,'cli-distribution'));await applications.selections.setAdded('mail',true,0);
 });
 const call=(token:string)=>new Promise<BridgeResponse>((ok,fail)=>{
  const socket=connect(managed.cli!.endpoint),timer=setTimeout(()=>{socket.destroy();fail(Error('Private R1.0 host deadline'));},5000);let text='';
  socket.on('error',error=>{clearTimeout(timer);fail(error);});socket.on('data',chunk=>{text+=String(chunk);if(text.includes('\n')){clearTimeout(timer);socket.end();ok(JSON.parse(text.slice(0,text.indexOf('\n'))));}});
  socket.on('connect',()=>socket.write(JSON.stringify({schema:'willyou-cli-v1',id:randomUUID(),token,method:'capabilities/call',call:{operation:'mail.draft.list',contractMajor:2,connectionId:null,arguments:{}}})+'\n'));
 });
 const managedSkills=()=>existsSync(join(home,'.agents/skills'))?readdirSync(join(home,'.agents/skills')).filter(n=>n.startsWith('smartdd-')):[];
 it('T41: a task started before the project enables an application uses it in the same run once enabled',async()=>{
  const running=await create(),launch=ptys.launches[0],saved=(await managed.sessions.get(running.task.id)).snapshot;
  expect(saved.schema).toBe(3);expect(saved.adapterBinding.version).toBe('1.4.0');expect(saved.packages).toEqual([]);expect(saved.standardSkills).toEqual([]);
  expect(saved.mcp.map(m=>m.kind)).toContain('applications');
  const argv=launch.args!.join(' ');expect(argv).not.toContain('skills.config');expect(argv).toContain('permissions.wy_cli_');expect(argv).toMatch(/mcp_servers\.[A-Za-z0-9_-]+\.command=/);expect(managedSkills()).toEqual([]);
  const token=launch.env![VALUE_PREFIX+'WILLYOU_RUN_TOKEN']!;expect(token).toMatch(/^[a-f0-9]{64}$/);
  expect(await call(token)).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  expect(await call(token)).toMatchObject({status:'ok',value:{capabilityId:'mail.draft.list',operation:{origin:'cli'}}});
  tasks.kill(running.task.id);await vi.waitFor(()=>expect(ptys.live.size).toBe(0));expect(await call(token)).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  expect(existsSync(join(home,'.agents/smartdd-runtime'))).toBe(false);
 });
 it('serves an unverified Codex version from the library with MCP only, never the CLI sandbox',async()=>{
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.170.0";; *) exit 70;; esac\n',{mode:0o700});
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const running=await create(),launch=ptys.launches[0],saved=(await managed.sessions.get(running.task.id)).snapshot,plan=managed.runs.bridgePreparation(running.task.runtimeSnapshot!.runId).plan!;
  expect(saved.adapterBinding.version).toBe('1.4.0');expect(plan.grades.cli).toBe(false);expect(plan.allowed).toMatchObject([{capabilityId:'mail.draft.list',entry:'mcp'}]);
  const argv=launch.args!.join(' ');expect(argv).not.toContain('wy_cli_');expect(argv).not.toContain('skills.config');expect(argv).toMatch(/mcp_servers\.[A-Za-z0-9_-]+\.command=/);
  expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');expect(managedSkills()).toEqual([]);
 });
 it('S3d: an Agent whose version cannot be read starts native only, without the shared discovery catalog',async()=>{
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "not a version";; *) exit 70;; esac\n',{mode:0o700});
  const running=await create(),launch=ptys.launches[0];
  expect(launch.args).toEqual([]);expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');expect(running.task.runtimeSnapshot?.selfCheck.issues).toContain('AGENT_ADAPTER_UNSUPPORTED');
  expect(existsSync(join(home,'.agents/smartdd-runtime'))).toBe(false);expect(managedSkills()).toEqual([]);
 });
 it('S5: advises a resume only where the Agent cannot see the new application in the running session',async()=>{
  const codex=await create(),claude=await create(claudeId);
  expect(tasks.resumeAdvice(codex.task.id)).toBeNull();expect(tasks.resumeAdvice(claude.task.id)).toBeNull();
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  // Codex 0.166.0 reaches the CLI-primary capability next turn; Claude Code reads Skills only after a resume.
  expect(tasks.resumeAdvice(codex.task.id)).toBeNull();expect(tasks.resumeAdvice(claude.task.id)?.applications).toHaveLength(1);
 });
 it('serves Claude Code 2.1.303 from the library with an MCP config and no per-task plugin directory',async()=>{
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const running=await create(claudeId),launch=ptys.launches[0],saved=(await managed.sessions.get(running.task.id)).snapshot;
  expect(saved.runner).toBe('claude-code');expect(saved.adapterBinding.version).toBe('1.2.0');
  expect(launch.args).toContain('--mcp-config');expect(launch.args).not.toContain('--plugin-dir');expect(existsSync(join(root,'sessions',running.task.id,'claude/plugin'))).toBe(false);
  expect(launch.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');
 });
 it('S4: a pre-R1.0 session becomes a library session on resume, keeping its native identity',async()=>{
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const first=await create(),nativeId=await stopForSwitchFixture(first,'codex'),old=await seedPreLibrarySession(first.task.id,'1.3.0');
  expect(old.snapshot.adapterBinding.version).toBe('1.3.0');
  const resumed=await tasks.open({taskId:first.task.id}),launch=ptys.launches.at(-1)!,adopted=await managed.sessions.get(first.task.id);
  expect(resumed.task.nativeSessionId).toBe(nativeId);expect(adopted.snapshot.adapterBinding.version).toBe('1.4.0');expect(adopted.snapshot.native.sessionId).toBe(nativeId);expect(adopted.snapshot.packages[0].skills).toEqual([]);expect(adopted.pointer.snapshotHash).not.toBe(old.pointer.snapshotHash);
  expect((await managed.sessions.references(first.task.id)).map(r=>r.refKind).sort()).toEqual(['agent-adapter','application-package','legacy-runtime','runtime']);
  expect(launch.args).toContain('resume');expect(launch.args!.join(' ')).not.toContain('skills.config');
  expect(await call(launch.env![VALUE_PREFIX+'WILLYOU_RUN_TOKEN']!)).toMatchObject({status:'ok'});
  // The adopted pointer is the task's pointer from now on: a second resume stays on the library path.
  tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(resumed.task.runtimeSnapshot!.runId).state).toBe('stopped'));const again=await tasks.open({taskId:first.task.id});expect(again.task.nativeSessionId).toBe(nativeId);expect(ptys.launches.at(-1)!.args!.join(' ')).not.toContain('skills.config');
 });
 // S6 finding (Claude Code not logged in): the Agent exits before starting its MCP servers, so no bridge ever joins.
 const exitWithoutBridge=(ptyId:string)=>{const pid=ptys.live.get(ptyId);if(pid){reader.identities.delete(pid);ptys.live.delete(ptyId);ptys.emit('exit',ptyId,0);}};
 const settled=async(runId:string)=>{
  await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));
  expect(sqlite.prepare('SELECT kind,state,pid FROM capability_run_processes WHERE run_id=? ORDER BY kind').all(runId)).toEqual([{kind:'bridge',state:'canceled',pid:null},{kind:'cli',state:'exited',pid:expect.any(Number)}]);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=? AND state<>'released'").get(runId)).toEqual({n:0});
 };
 it('ends a run whose Agent exits on its own before starting its MCP servers',async()=>{
  const running=await create(),runId=running.task.runtimeSnapshot!.runId;exitWithoutBridge(running.ptyId!);await settled(runId);
  expect(managed.activeTaskIds(projectId).has(running.task.id)).toBe(false);
 });
 it('ends a user-stopped run whose Agent never started its MCP servers',async()=>{
  const running=await create(),runId=running.task.runtimeSnapshot!.runId;vi.mocked(ptys.kill).mockImplementationOnce(id=>exitWithoutBridge(id));
  tasks.kill(running.task.id);await settled(runId);
 });
 // S6 (T40): the run plan records what the Agent loads at this launch (the project's current applications), so a
 // resumed session is not told to resume again for an application it already loaded.
 it('clears the resume advice once the session is resumed after an application change',async()=>{
  const first=await create(),nativeId=await stopForSwitchFixture(first,'codex');
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const resumed=await tasks.open({taskId:first.task.id}),plan=managed.runs.bridgePreparation(resumed.task.runtimeSnapshot!.runId).plan!;
  expect(resumed.task.nativeSessionId).toBe(nativeId);expect(plan.applications.map(a=>a.appId)).toEqual(['mail']);expect(managed.resumeAdvice(first.task.id)).toBeNull();
 });
 it('records the enabled application without per-run Skill copies and resumes on the same library path',async()=>{
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const first=await create(),saved=(await managed.sessions.get(first.task.id)).snapshot;
  expect(saved.adapterBinding.version).toBe('1.4.0');expect(saved.packages.map(p=>({appId:p.appId,skills:p.skills}))).toEqual([{appId:'mail',skills:[]}]);expect(managedSkills()).toEqual([]);
  const nativeId=await stopForSwitchFixture(first,'codex'),resumed=await tasks.open({taskId:first.task.id}),launch=ptys.launches.at(-1)!;
  expect(resumed.task.nativeSessionId).toBe(nativeId);expect(launch.args).toContain('resume');expect(launch.args!.join(' ')).not.toContain('skills.config');
  expect(await call(launch.env![VALUE_PREFIX+'WILLYOU_RUN_TOKEN']!)).toMatchObject({status:'ok'});expect(managedSkills()).toEqual([]);
 });
});

describe('M11 S7 project stop and host disposal reach the actual shared upstream',()=>{
 it('stops only project A calls, preserves project B and reaps all reference MCP children on host disposal',async()=>{
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.166.0";; *) exit 70;; esac\n',{mode:0o700});
  const source=new CapabilityBundleSource(process.env.WILLYOU_TEST_BUNDLES??resolve('out/capability-bundles')),installed=await applications.builtin.install(source,source.index.apps.find(a=>a.appId==='sample-kv')!);await applications.builtin.packages.activate(installed.packageHash,0);await applications.selections.setAdded('sample-kv',true,0);
  const pools=new Set<UpstreamSessionPool>(),acquire=UpstreamSessionPool.prototype.acquire;vi.spyOn(UpstreamSessionPool.prototype,'acquire').mockImplementation(function(this:UpstreamSessionPool,...args){pools.add(this);return acquire.apply(this,args);});
  const sender={sender:{id:818,isDestroyed:()=>false},senderFrame:{}} as unknown as ApplicationUiSender,tested=await applications.testConnection(sender,{expectedRevision:0,name:'Shared reference',config:{kind:'sample-kv',service:'task-stop',prefix:'demo:',transport:'mcp',authMode:'token'},secret:'SYNTHETIC_STOP'}),connection=await applications.saveConnection(sender,'sample-kv',tested.operationId,tested.candidateHash);
  const secondCwd=join(root,'project-b');mkdirSync(secondCwd);const second=projects.createProject({name:'Upstream B',aliases:[],description:'',rulesPath:null},[{label:'',path:secondCwd}]);for(const id of [projectId,second.id])await applications.selections.select({projectId:id,appId:'sample-kv',enabled:true,connections:{'sample-kv':connection.id},expectedRevision:0});
  const a=await create(),b=await tasks.create({projectId:second.id,dirId:null,aiProfileId:codexId,firstMessage:''}),backend=join(support.store.root,'reference-services',digest('task-stop'));mkdirSync(backend,{recursive:true});writeFileSync(join(backend,'control.json'),JSON.stringify({delays:{'demo:a':2000,'demo:b':1500}}));
  const service=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data)),invoke=(runId:string,key:string)=>service.call(runId,randomUUID(),{operation:'smartdd_sample_kv_read_v2',contractMajor:2,connectionId:null,arguments:{key}}),one=invoke(a.task.runtimeSnapshot!.runId,'demo:a'),two=invoke(b.task.runtimeSnapshot!.runId,'demo:b');
  await vi.waitFor(()=>expect([...pools].flatMap(pool=>pool.status()).map(row=>row.pending)).toContain(2),{timeout:5000});expect([...pools].flatMap(pool=>pool.status())).toHaveLength(1);const pid=[...pools][0].status()[0].pid!;expect(pid).toBeGreaterThan(0);
  expect(await tasks.stopProject(projectId,5000)).toBe(true);expect(await one).toMatchObject({status:'error',error:{code:'CANCELED'}});expect(await two).toMatchObject({status:'ok',value:{data:{key:'demo:b'}}});expect(tasks.activePty(b.task.id)).not.toBeNull();
   // Match the host shutdown boundary: kill revokes immediately, while managed
   // disposal joins the run/bridge exits before the application service closes.
   tasks.kill(b.task.id);await managed.dispose();await applications.dispose();expect([...pools].flatMap(pool=>pool.status())).toEqual([]);expect(()=>process.kill(pid,0)).toThrow();expect(sqlite.prepare("SELECT count(*) n FROM capability_resource_leases WHERE state='active'").get()).toEqual({n:0});
 },30000);
});

describe('M11 S4 data-only Mail v2 through the production task composition',()=>{
 beforeEach(()=>{
  // TestPtys does not fork a bridge child; settle only its synthetic handles.
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.166.0";; *) exit 70;; esac\n',{mode:0o700});
 });
 const selectMail=async()=>{await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});};
 const installV2=async()=>{
  const source=new CapabilityBundleSource(resolve('out/capability-bundles')),before=applications.builtin.packages.active('mail')!;
  const installed=await applications.builtin.install(source,source.index.apps.find(app=>app.appId==='mail')!);
  await applications.builtin.packages.activate(installed.packageHash,before.generation);return applications.builtin.assertTrusted(installed.packageHash);
 };
 const tools=()=>new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data));
 const call=(service:ApplicationToolService,runId:string,operation:string,args:Record<string,unknown>,major=2)=>service.call(runId,randomUUID(),{operation:`smartdd_mail_${operation}_v${major}`,contractMajor:major,connectionId:null,arguments:args});
 const body={mode:'new',sourceMessageRef:null,senderConnectionId:null,to:['fixture@example.test'],cc:[],bcc:[],subject:'M11 local v2',text:'synthetic body',html:null,inReplyTo:null,references:[],attachmentIds:[]};

 it('maps all fourteen legacy tools without package executables and preserves the bridge runtime identity',async()=>{
  const old=applications.builtin.packages.get(applications.builtin.packages.active('mail')!.packageHash),v2=await installV2();
  expect(v2.version).toBe('1.1.0');expect(v2.manifest.schema).toBe('smartdd-app-package-v2');
  if(v2.manifest.schema!=='smartdd-app-package-v2')throw Error('v2 required');
  expect(v2.manifest.capabilities).toHaveLength(14);expect(v2.manifest.capabilities.map(c=>c.legacyTool!.name).sort()).toEqual(applicationToolDeclarations(old.manifest).map(t=>t.name).sort());
  expect(v2.manifest.runtime).toEqual(old.manifest.runtime);expect(v2.manifest.files.some(f=>f.executable||/\.(?:c?js|mjs|sh|py)$/.test(f.path))).toBe(false);
  expect(v2.manifest.capabilities.every(c=>c.contractMajor===2&&c.binding.mcp?.tool.endsWith('_v2'))).toBe(true);
  expect(applications.builtin.packages.get(old.packageHash).manifest).toEqual(old.manifest);
 });
 it('creates a schema-3 task with a fixed plan and no per-run Skill copies',async()=>{
  const application=await installV2();await selectMail();const running=await create(),saved=await managed.sessions.get(running.task.id),scope=managed.runs.bridgePreparation(running.task.runtimeSnapshot!.runId);
  expect(saved.snapshot.schema).toBe(3);expect(saved.snapshot.adapterBinding.version).toBe('1.4.0');expect(scope.plan?.allowed).toHaveLength(14);expect(scope.plan?.allowed.every(c=>c.entry==='mcp'&&c.contractMajor===2)).toBe(true);
  // R16: the library renders the Skill once per machine (skill-library-service tests); the session records none.
  expect(saved.snapshot.packages[0].skills).toEqual([]);expect(scope.plan!.skills).toEqual([]);expect(scope.plan!.applications[0].packageHash).toBe(application.packageHash);
  expect(readFileSync(resolve(support.store.directory(support.store.get('app:'+application.packageHash)),application.manifest.skills[0].path,'SKILL.md'),'utf8')).toContain('{{WILLYOU_ENTRYPOINTS}}');
 });
 it('returns unified v2 data and resources while the page reads the same draft and CAS rejects stale updates',async()=>{
  const application=await installV2();await selectMail();const running=await create(),runId=running.task.runtimeSnapshot!.runId,service=tools();
  const first=await call(service,runId,'draft_create',{content:body});expect(first).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',contractMajor:2,capabilityId:'mail.draft.create',source:{packageHash:application.packageHash,connections:[]},operation:{origin:'mcp',effectState:'completed'}}});
  if(first.status!=='ok')throw Error(JSON.stringify(first));const value=first.value as import('@shared/application-result').ApplicationResultV2,draft=(value.data as {draft:import('@shared/application-data').MailDraftDataView}).draft;
  expect(value.resources).toContainEqual(draft.content.text);const sender={sender:{id:991,isDestroyed:()=>false}} as unknown as import('electron').IpcMainInvokeEvent;
  expect(await applications.viewDraft(sender,projectId,draft.id)).toMatchObject({draft:{id:draft.id,revision:1,content:draft.content}});
  expect(await call(service,runId,'draft_update',{draftId:draft.id,expectedRevision:1,content:{...body,text:'second'}})).toMatchObject({status:'ok',value:{data:{draft:{revision:2}}}});
  expect(await call(service,runId,'draft_update',{draftId:draft.id,expectedRevision:1,content:body})).toMatchObject({status:'error',error:{code:'REVISION_CONFLICT',retryable:false}});
  expect(await call(service,runId,'resource_read',{resource:draft.content.text,offset:0,length:100})).toMatchObject({status:'ok',value:{data:{data:'synthetic body',eof:true},operation:{effectState:'read-only'}}});
 });
 it('limits missing slots to their dependent capabilities and keeps the result/cancel capabilities slot-free',async()=>{
  await installV2();await selectMail();const running=await create(),runId=running.task.runtimeSnapshot!.runId,service=tools();
  expect(await call(service,runId,'query',{})).toMatchObject({status:'error',error:{code:'AUTH_REQUIRED'}});
  for(const operation of ['send_get','send_cancel'])expect(await call(service,runId,operation,{intentId:randomUUID()})).toMatchObject({status:'error',error:{code:'NOT_FOUND'}});
  expect(await call(service,runId,'draft_list',{})).toMatchObject({status:'ok',value:{data:{items:[],nextCursor:null},operation:{effectState:'read-only'}}});
  expect(await call(service,runId,'draft_create',{content:body,projectId:'forged'})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
 });
 it('M11-T11 rejects self approval, a forged review hash and missing observed approval before any send execution',async()=>{
  await installV2();await selectMail();const sender={sender:{id:992,isDestroyed:()=>false}} as unknown as import('electron').IpcMainInvokeEvent;
  // Reversible cipher/provider identity are explicit software fixtures; no SMTP or Keychain.
  const localSecrets=new SecretsStore(drizzle(sqlite,{schema}),{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()}),connections=new ApplicationConnectionService(support.store,localSecrets,{verify:async config=>({providerId:config.kind,serviceId:'synthetic',accountId:'fixture@example.test',contractMajor:1})});
  const connection=await connections.save({name:'Synthetic SMTP T11',expectedRevision:0,config:{kind:'smtp',host:'127.0.0.1',port:9,username:'fixture@example.test',fromAddress:'fixture@example.test',authMode:'password',mode:'plain'},secret:'SYNTHETIC_ONLY'}),selected=applications.selections.projectSettings(projectId,'mail');
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:selected.revision,connections:{foxmail:null,smtp:connection.id}});
  const status=await applications.projectPolicy(sender,projectId,'mail') as import('@shared/mail-sender-identity').MailSenderIdentityStatus;await applications.projectAction(sender,projectId,'mail',{action:'confirm-sender',arguments:{expectedBindingHash:status.bindingHash,confirmed:true}});
  const running=await create(),runId=running.task.runtimeSnapshot!.runId,service=tools(),created=await call(service,runId,'draft_create',{content:{...body,senderConnectionId:connection.id}});expect(created.status).toBe('ok');if(created.status!=='ok')throw Error(JSON.stringify(created));
  const draft=((created.value as import('@shared/application-result').ApplicationResultV2).data as {draft:import('@shared/application-data').MailDraftDataView}).draft,prepared=await call(service,runId,'send_prepare',{draftId:draft.id,expectedRevision:draft.revision,expectedContentHash:draft.contentHash});expect(prepared.status).toBe('ok');if(prepared.status!=='ok')throw Error(JSON.stringify(prepared));
  const intent=((prepared.value as import('@shared/application-result').ApplicationResultV2).data as {intent:{id:string;reviewHash:string;authorized:boolean}}).intent;expect(intent.authorized).toBe(false);
  const decrypt=vi.spyOn(SecretsStore.prototype,'get');
  expect(await call(service,runId,'send_execute',{intentId:intent.id,expectedReviewHash:intent.reviewHash,approved:true})).toMatchObject({status:'error',error:{code:'INVALID_INPUT'}});
  expect(await call(service,runId,'send_execute',{intentId:intent.id,expectedReviewHash:'f'.repeat(64)})).toMatchObject({status:'error',error:{code:'INTENT_STALE'}});
  expect(await call(service,runId,'send_execute',{intentId:intent.id,expectedReviewHash:intent.reviewHash})).toMatchObject({status:'error',error:{code:'AUTHORIZATION_REQUIRED'}});
  expect(decrypt).not.toHaveBeenCalled();expect(sqlite.prepare('SELECT count(*) n FROM mail_send_executions').get()).toEqual({n:0});
 });
 // R1.0 R10/R17 (2026-11-04) replace "a running session keeps its fixed v1 tools" (T12): every call uses the current package.
 it('serves a running session from the current package after v2 activation and advises a resume for its tool list',async()=>{
  await selectMail();const running=await create(),runId=running.task.runtimeSnapshot!.runId,fixed=await managed.sessions.get(running.task.id),service=tools();
  expect(fixed.snapshot.schema).toBe(3);expect(await call(service,runId,'draft_list',{},1)).toMatchObject({status:'ok',value:{items:[],nextCursor:null}});expect(managed.resumeAdvice(running.task.id)).toBeNull();
  const raw=sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(running.task.id);
  const v2=await installV2();expect(sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(running.task.id)).toEqual(raw);
  expect(await call(service,runId,'draft_list',{})).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',source:{packageHash:v2.packageHash}}});
  expect((await service.list(runId)).tools.every(tool=>tool.name.endsWith('_v2'))).toBe(true);expect((await call(service,runId,'draft_list',{},1)).status).toBe('error');
  // Codex keeps the MCP tool list it loaded at start: the task page asks for a resume (S5).
  expect(managed.resumeAdvice(running.task.id)).toEqual({applications:['邮件']});
 });
});
// Historical success fixtures need actual native history, not only a claimed ID/root.
const codexDayDirectory=(stateRoot:string,stamp:number)=>{const day=new Date(stamp),pad=(n:number)=>String(n).padStart(2,'0');return join(stateRoot,'sessions',String(day.getFullYear()),pad(day.getMonth()+1),pad(day.getDate()));};
const seedNativeHistory=(runner:'claude-code'|'codex',id:string,stateRoot=join(home,runner==='codex'?'.codex':'.claude'))=>{
 const stamp=Date.now(),folder=runner==='codex'?codexDayDirectory(stateRoot,stamp):join(stateRoot,'projects',encodeClaudeDir(cwd));mkdirSync(folder,{recursive:true});
 const file=join(folder,runner==='codex'?'rollout-private-'+id+'.jsonl':id+'.jsonl');
 writeFileSync(file,JSON.stringify(runner==='codex'?{type:'session_meta',payload:{id,cwd,timestamp:new Date(stamp).toISOString(),originator:'codex_cli_rs'}}:{type:'user',message:{role:'user',content:'synthetic retained native history'}})+'\n');return file;
};


describe('task cancellation before the native fork',()=>{
 it.each(['cancel','prepare-error','host-shutdown','host-shutdown-before-arming'] as const)('settles the known unspawned CLI and bridge after %s during arming',async reason=>{
  await applications.selections.setAdded('mail',true,0);
  await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const original=managed.prepare.bind(managed);
  const spy=vi.spyOn(managed,'prepare').mockImplementation(async input=>{
   const launch=await original(input),before=launch.beforeSpawn.bind(launch);
   launch.beforeSpawn=async()=>{
    if(reason==='host-shutdown-before-arming'){tasks.dispose();await vi.waitFor(()=>expect(sqlite.prepare('SELECT state FROM capability_runs').get()).toEqual({state:'stopped'}));return;}
    await before();if(reason==='cancel')tasks.kill(input.taskId);else if(reason==='host-shutdown')tasks.dispose();else throw new Error('controlled pre-fork preparation failure');
   };
   return launch;
  });
  await expect(create()).rejects.toThrow(reason==='prepare-error'?'controlled pre-fork preparation failure':'任务启动已取消');
  expect(ptys.launches).toHaveLength(0);
  await vi.waitFor(()=>expect(sqlite.prepare('SELECT state,revocation_state,pid FROM capability_runs').all()).toEqual([{state:'stopped',revocation_state:'revoked',pid:null}]));
  expect(sqlite.prepare('SELECT kind,state,pid FROM capability_run_processes ORDER BY kind').all()).toEqual([{kind:'bridge',state:'canceled',pid:null},{kind:'cli',state:'canceled',pid:null}]);
  expect(sqlite.prepare("SELECT COUNT(*) n FROM capability_resource_leases WHERE owner_kind='run' AND state<>'released'").get()).toEqual({n:0});
  if(reason.startsWith('host-shutdown'))expect(ptys.listenerCount('exit')).toBe(0);
  expect(existsSync(join(home,'.agents/smartdd-runtime'))).toBe(false);spy.mockRestore();
 });
});

describe('native history loss after managed preparation is armed',()=>{
 it.each(['claude-code','codex'] as const)('refuses a late %s history loss before fork and cancels the known unspawned run',async runner=>{
  const first=await create(runner==='codex'?codexId:claudeId),nativeId=runner==='codex'?randomUUID():first.task.id,nativeRoot=join(home,runner==='codex'?'.codex':'.claude'),file=seedNativeHistory(runner,nativeId,nativeRoot);
  if(runner==='codex')await vi.waitFor(()=>expect(tasks.get(first.task.id).nativeSessionId).toBe(nativeId),{timeout:6000});
  expect(tasks.get(first.task.id).recovery).toBe('resumable');tasks.kill(first.task.id);
  await vi.waitFor(()=>expect(managed.runs.get(first.task.runtimeSnapshot!.runId).state).toBe('stopped'));
  const raw=sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(first.task.id),original=managed.prepare.bind(managed),preserved=file+'.preserved';
  const spy=vi.spyOn(managed,'prepare').mockImplementation(async input=>{const launch=await original(input),before=launch.beforeSpawn.bind(launch);launch.beforeSpawn=async()=>{await before();renameSync(file,preserved);};return launch;});
  await expect(tasks.open({taskId:first.task.id})).rejects.toMatchObject({code:'NATIVE_IDENTITY_CONFLICT'});
  expect(ptys.launches).toHaveLength(1);expect(sqlite.prepare('SELECT * FROM tasks WHERE id=?').get(first.task.id)).toEqual(raw);
  await vi.waitFor(()=>expect(sqlite.prepare("SELECT COUNT(*) n FROM capability_runs WHERE task_id=? AND state<>'stopped'").get(first.task.id)).toEqual({n:0}));
  expect(sqlite.prepare("SELECT COUNT(*) n FROM capability_run_processes WHERE run_id IN (SELECT run_id FROM capability_runs WHERE task_id=?) AND state NOT IN ('exited','canceled')").get(first.task.id)).toEqual({n:0});
  expect(sqlite.prepare("SELECT COUNT(*) n FROM capability_resource_leases WHERE owner_kind='run' AND owner_id IN (SELECT run_id FROM capability_runs WHERE task_id=?) AND state<>'released'").get(first.task.id)).toEqual({n:0});
  spy.mockRestore();renameSync(preserved,file);
 });
});

describe('late native history arrival before fork',()=>{
 it('does not reopen a fresh Claude UUID after its original history appears during preparation',async()=>{
  const first=await create(claudeId);tasks.kill(first.task.id);await vi.waitFor(()=>expect(managed.runs.get(first.task.runtimeSnapshot!.runId).state).toBe('stopped'));
  expect(tasks.get(first.task.id).recovery).toBe('fresh');
  const original=managed.prepare.bind(managed),spy=vi.spyOn(managed,'prepare').mockImplementation(async input=>{const launch=await original(input),before=launch.beforeSpawn.bind(launch);launch.beforeSpawn=async()=>{await before();seedNativeHistory('claude-code',first.task.id);};return launch;});
  await expect(tasks.open({taskId:first.task.id})).rejects.toMatchObject({code:'NATIVE_IDENTITY_CONFLICT'});
  expect(ptys.launches).toHaveLength(1);expect(tasks.get(first.task.id).recovery).toBe('resumable');
  await vi.waitFor(()=>expect(sqlite.prepare("SELECT COUNT(*) n FROM capability_runs WHERE task_id=? AND state<>'stopped'").get(first.task.id)).toEqual({n:0}));
  spy.mockRestore();
 });
});

async function zentaoSwitchFixture(targetProject=projectId){
 const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});
 const connections=new ApplicationConnectionService(support.store,secrets,{verify:async c=>({providerId:c.kind,serviceId:'private-switch-service',accountId:c.kind==='foxmail'?c.account:'username'in c?c.username:'fixture-account',contractMajor:1})});
 const a=await connections.save({name:'Private ZenTao A',expectedRevision:0,config:{kind:'zentao',baseUrl:'https://zentao.example.test/biz/',username:'private-a',authMode:'token'},secret:'private-fixture-a'});
 const b=await connections.save({name:'Private ZenTao B',expectedRevision:0,config:{kind:'zentao',baseUrl:'https://zentao.example.test/biz/',username:'private-b',authMode:'token'},secret:'private-fixture-b'});
 const sender={} as ApplicationUiSender;await applications.setAdded(sender,'zentao',true,0);await applications.select(sender,{projectId:targetProject,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:a.id}});
 return {a,b,sender,next:()=>applications.select(sender,{projectId:targetProject,appId:'zentao',enabled:true,expectedRevision:1,connections:{zentao:b.id}})};
}
async function stopForSwitchFixture(task:Awaited<ReturnType<typeof create>>,runner:'claude-code'|'codex'){
 const id=runner==='codex'?randomUUID():task.task.id;seedNativeHistory(runner,id);
 if(runner==='codex')await vi.waitFor(()=>expect(tasks.get(task.task.id).nativeSessionId).toBe(id),{timeout:6000});
 expect(tasks.get(task.task.id).recovery).toBe('resumable');tasks.kill(task.task.id);await vi.waitFor(()=>expect(managed.runs.get(task.task.runtimeSnapshot!.runId).state).toBe('stopped'));
 return id;
}
/**
 * A stopped session as pre-R1.0 builds stored it: bound to an earlier, non-library adapter version.
 * The pre-R1.0 launch path no longer exists, so the stored record is rewritten in place (same native identity).
 */
async function seedPreLibrarySession(taskId:string,version:string){
 const current=await managed.sessions.get(taskId),adapter=support.status().adapters.find(a=>a.agentId===current.snapshot.runner&&a.version===version)!;
 const old={...current.snapshot,catalogGeneration:'pre-r1-fixture',adapterBinding:{...current.snapshot.adapterBinding,version,hash:adapter.hash}},bytes=canonicalJson(old),hash=digest(bytes),selection=digest(canonicalJson({...old,native:{...old.native,sessionId:null}})),resource=support.store.get(`agent-adapter:${old.runner}:${adapter.hash}`);
 sqlite.transaction(()=>{
  sqlite.prepare('UPDATE capability_session_snapshots SET snapshot_json=?,snapshot_hash=? WHERE task_id=?').run(bytes,hash,taskId);
  sqlite.prepare('INSERT OR IGNORE INTO capability_snapshot_versions(snapshot_hash,task_id,snapshot_json,selection_hash,created_at) VALUES(?,?,?,?,?)').run(hash,taskId,bytes,selection,old.createdAt);
  sqlite.prepare('UPDATE capability_session_identities SET selection_hash=? WHERE task_id=?').run(selection,taskId);
  sqlite.prepare("UPDATE capability_session_refs SET ref_id=?,ref_hash=?,relative_path=? WHERE task_id=? AND ref_kind='agent-adapter'").run(resource.resourceId,resource.contentHash,resource.relativePath,taskId);
  const task=sqlite.prepare('SELECT runtime_snapshot FROM tasks WHERE id=?').get(taskId) as {runtime_snapshot:string},runtime=JSON.parse(task.runtime_snapshot);runtime.sessionCapabilities={...runtime.sessionCapabilities,snapshotHash:hash};
  sqlite.prepare('UPDATE tasks SET runtime_snapshot=? WHERE id=?').run(JSON.stringify(runtime),taskId);
 })();
 writeFileSync(join(support.store.root,'sessions',taskId,'.smartdd-owned.json'),canonicalJson({owner:'SmartDD',schema:2,storeId:support.store.storeId,kind:'session',taskId,sourceHash:selection})+'\n');
 return managed.sessions.get(taskId);
}
async function activeSwitchPair(){
 const first=await create(codexId),nativeId=randomUUID();seedNativeHistory('codex',nativeId);
 await vi.waitFor(()=>expect(tasks.get(first.task.id).nativeSessionId).toBe(nativeId),{timeout:6000});
 await vi.waitFor(async()=>expect((await managed.sessions.get(first.task.id)).snapshot.native.sessionId).toBe(nativeId));
 const second=await create(claudeId);seedNativeHistory('claude-code',second.task.id);expect(tasks.get(second.task.id).recovery).toBe('resumable');
 return{first,second,firstNative:nativeId,firstFixed:await managed.sessions.get(first.task.id),secondFixed:await managed.sessions.get(second.task.id)};
}
async function foreignSwitchTask(sender:ApplicationUiSender,connectionId:string){
 const directory=join(root,'foreign-switch-project');mkdirSync(directory);mkdirSync(join(directory,'.git'));
 const project=projects.createProject({name:'foreign switch fixture',aliases:[],description:'',rulesPath:null},[{label:'',path:directory}]);
 await applications.select(sender,{projectId:project.id,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:connectionId}});
 const created=await tasks.create({projectId:project.id,dirId:null,aiProfileId:claudeId,firstMessage:''});
 return{...created,projectId:project.id,selection:applications.selections.projectSettings(project.id,'zentao')};
}
describe('ZenTao switch only affects loaded application runs and gates their fork',()=>{
 it('keeps an unrelated task and another project running while stopping the loaded ZenTao task',async()=>{
  const unrelated=await create(claudeId),unrelatedPty=tasks.activePty(unrelated.task.id)!,x=await zentaoSwitchFixture();
  const otherDir=join(root,'other-project');mkdirSync(otherDir);mkdirSync(join(otherDir,'.git'));const other=projects.createProject({name:'other switch scope',aliases:[],description:'',rulesPath:null},[{label:'',path:otherDir}]);
  await applications.select(x.sender,{projectId:other.id,appId:'zentao',enabled:true,expectedRevision:0,connections:{zentao:x.a.id}});
  const foreign=await tasks.create({projectId:other.id,dirId:null,aiProfileId:claudeId,firstMessage:''}),foreignPty=tasks.activePty(foreign.task.id)!,related=await create(claudeId),fixed=await managed.sessions.get(related.task.id);
  seedNativeHistory('claude-code',related.task.id);expect(tasks.get(related.task.id).recovery).toBe('resumable');
  const selected=await x.next();expect(selected.connections.zentao).toBe(x.b.id);expect(ptys.live.has(unrelatedPty)).toBe(true);expect(ptys.live.has(foreignPty)).toBe(true);expect(tasks.activePty(related.task.id)).toBeNull();
  const resumed=await tasks.open({taskId:related.task.id}),again=await managed.sessions.get(related.task.id);expect(again.pointer).toEqual(fixed.pointer);expect(again.snapshot).toEqual(fixed.snapshot);expect(resumed.task.nativeSessionId).toBe(related.task.id);
  const detail=await applications.diagnoseSession(x.sender,related.task.id),app=detail.applications.find(a=>a.appId==='zentao')!;expect(app.connections[0]).toMatchObject({id:x.b.id,originalId:x.a.id,selection:'changed'});
  const tools=await new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data)).list(resumed.task.runtimeSnapshot!.runId);expect(tools.tools.map(t=>t.name).sort()).toEqual(Object.keys(fixed.snapshot.packages[0].toolContractMajors).sort());for(const tool of tools.tools){expect(tool.description).toContain('Private ZenTao A');expect(tool.description).toContain('Private ZenTao B');expect(tool.description).toContain('旧来源对象引用');expect(tool.description).toContain('调用按项目当前来源执行');}
 },25000);
 it.each(['claude-code','codex'] as const)('rejects every %s new/resume in the project while the switch is pending (R17: every session may use ZenTao)',async runner=>{
  const ordinary=await create(claudeId);await stopForSwitchFixture(ordinary,'claude-code');const x=await zentaoSwitchFixture(),related=await create(runner==='codex'?codexId:claudeId);await stopForSwitchFixture(related,runner);
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r),original=tasks.stopProject.bind(tasks);
  const spy=vi.spyOn(tasks,'stopProject').mockImplementation(async(...args)=>{entered();await gate;return original(...args);}),switching=x.next();
  try{
   await ready;expect(applications.selections.projectSettings(projectId,'zentao').pendingOperationId).not.toBeNull();const count=ptys.launches.length;
   await expect(create(runner==='codex'?codexId:claudeId)).rejects.toMatchObject({code:'RESOURCE_BUSY'});await expect(tasks.open({taskId:related.task.id})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(ptys.launches).toHaveLength(count);
   await expect(tasks.open({taskId:ordinary.task.id})).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(ptys.launches).toHaveLength(count);expect((await managed.sessions.get(ordinary.task.id)).snapshot.packages).toEqual([]);
  }finally{release();await switching;spy.mockRestore();}
 },25000);
 it('checks a switch that begins after arming immediately before the native fork',async()=>{
  const x=await zentaoSwitchFixture();let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r),originalStop=tasks.stopProject.bind(tasks);
  const stop=vi.spyOn(tasks,'stopProject').mockImplementation(async(...args)=>{entered();await gate;return originalStop(...args);});let switching:Promise<unknown>|undefined;
  const original=managed.prepare.bind(managed),prepare=vi.spyOn(managed,'prepare').mockImplementation(async input=>{const launch=await original(input),before=launch.beforeSpawn.bind(launch);launch.beforeSpawn=async()=>{await before();switching=x.next();await ready;};return launch;});
  try{await expect(create(claudeId)).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(ptys.launches).toHaveLength(0);expect(sqlite.prepare("SELECT count(*) n FROM capability_runs WHERE state NOT IN ('stopped','failed')").get()).toEqual({n:0});}
  finally{release();await switching;prepare.mockRestore();stop.mockRestore();}
 },20000);
 it('preserves A after one of two loaded runs fails to stop, gates resume during the wait and requires explicit retry',async()=>{
  const x=await zentaoSwitchFixture(),pair=await activeSwitchPair(),foreign=await foreignSwitchTask(x.sender,x.a.id),before=applications.selections.projectSettings(projectId,'zentao'),count=ptys.launches.length;
  const failedStop=new Error('controlled second loaded PTY stop failure'),kill=vi.mocked(ptys.kill),workingKill=kill.getMockImplementation()!;
  kill.mockImplementation(id=>{if(id===pair.second.ptyId)throw failedStop;workingKill(id);});
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>entered=r),originalStop=tasks.stopProject.bind(tasks);
  const stop=vi.spyOn(tasks,'stopProject').mockImplementation(async(...args)=>{tasks.kill(pair.first.task.id);await vi.waitFor(()=>expect(managed.runs.get(pair.first.task.runtimeSnapshot!.runId).state).toBe('stopped'));entered();await gate;return originalStop(...args);});
  let restored=false;const switching=x.next(),settled=switching.then(value=>({value,error:undefined}),error=>({value:undefined,error}));
  try{
   await ready;expect(applications.selections.projectSettings(projectId,'zentao')).toMatchObject({connections:{zentao:x.a.id},pendingOperationId:expect.any(String)});
   await expect(tasks.open({taskId:pair.first.task.id})).rejects.toMatchObject({code:'RESOURCE_BUSY'});await expect(create()).rejects.toMatchObject({code:'RESOURCE_BUSY'});expect(ptys.launches).toHaveLength(count);
   expect(tasks.activePty(foreign.task.id)).toBe(foreign.ptyId);release();expect((await settled).error).toBe(failedStop);
   expect(applications.selections.projectSettings(projectId,'zentao')).toEqual(before);expect(tasks.activePty(pair.first.task.id)).toBeNull();expect(ptys.live.has(pair.second.ptyId)).toBe(true);expect(ptys.launches).toHaveLength(count);
   expect(managed.runs.get(pair.second.task.runtimeSnapshot!.runId).state).toBe('stopping');expect(()=>managed.runs.assertActive(pair.second.task.runtimeSnapshot!.runId)).toThrow();
   expect(applications.selections.projectSettings(foreign.projectId,'zentao')).toEqual(foreign.selection);expect(tasks.activePty(foreign.task.id)).toBe(foreign.ptyId);expect(managed.runs.assertActive(foreign.task.runtimeSnapshot!.runId).snapshot.projectId).toBe(foreign.projectId);expect(applications.selections.requireEnabled(foreign.projectId,'zentao').connections.zentao).toBe(x.a.id);
   kill.mockImplementation(workingKill);stop.mockRestore();restored=true;tasks.kill(pair.second.task.id);await vi.waitFor(()=>expect(tasks.runningInProject(projectId)).toBe(0));
   expect((await x.next()).connections.zentao).toBe(x.b.id);expect(ptys.launches).toHaveLength(count);
   for(const[created,fixed,nativeId]of[[pair.first,pair.firstFixed,pair.firstNative],[pair.second,pair.secondFixed,pair.second.task.id]] as const){
    const reopened=await tasks.open({taskId:created.task.id});expect(reopened.task.nativeSessionId).toBe(nativeId);expect((await managed.sessions.get(created.task.id)).snapshot).toEqual(fixed.snapshot);expect(reopened.task.runtimeSnapshot!.runId).not.toBe(created.task.runtimeSnapshot!.runId);
    const detail=await applications.diagnoseSession(x.sender,created.task.id);expect(detail.applications.find(a=>a.appId==='zentao')!.connections[0]).toMatchObject({id:x.b.id,originalId:x.a.id,selection:'changed'});
   }
   expect(tasks.activePty(foreign.task.id)).toBe(foreign.ptyId);
  }finally{release();await settled;if(!restored){kill.mockImplementation(workingKill);stop.mockRestore();}}
 },40000);
 it('rolls back a B binding commit after both loaded runs stopped and never restarts them automatically',async()=>{
  const x=await zentaoSwitchFixture(),pair=await activeSwitchPair(),foreign=await foreignSwitchTask(x.sender,x.a.id),before=applications.selections.projectSettings(projectId,'zentao'),count=ptys.launches.length;
  const slots=()=>sqlite.prepare('SELECT * FROM application_binding_slot_revisions WHERE project_id=? ORDER BY app_id,slot').all(projectId),bindings=()=>sqlite.prepare('SELECT * FROM application_project_bindings WHERE project_id=? ORDER BY app_id,slot').all(projectId),oldSlots=slots(),oldBindings=bindings();
  sqlite.exec(`CREATE TEMP TRIGGER fail_switch_binding BEFORE INSERT ON application_project_bindings WHEN NEW.project_id='${projectId}' AND NEW.connection_id='${x.b.id}' BEGIN SELECT RAISE(ABORT,'controlled B binding commit failure'); END`);
  try{await expect(x.next()).rejects.toThrow('controlled B binding commit failure');}finally{sqlite.exec('DROP TRIGGER fail_switch_binding');}
  expect(tasks.runningInProject(projectId)).toBe(0);expect(tasks.activePty(pair.first.task.id)).toBeNull();expect(tasks.activePty(pair.second.task.id)).toBeNull();expect(ptys.launches).toHaveLength(count);
  expect(applications.selections.projectSettings(projectId,'zentao')).toEqual(before);expect(slots()).toEqual(oldSlots);expect(bindings()).toEqual(oldBindings);expect(sqlite.prepare("SELECT state FROM application_binding_changes WHERE project_id=? ORDER BY rowid DESC LIMIT 1").get(projectId)).toEqual({state:'failed'});
  expect((await managed.sessions.get(pair.first.task.id)).snapshot).toEqual(pair.firstFixed.snapshot);expect((await managed.sessions.get(pair.second.task.id)).snapshot).toEqual(pair.secondFixed.snapshot);expect(applications.selections.projectSettings(foreign.projectId,'zentao')).toEqual(foreign.selection);expect(tasks.activePty(foreign.task.id)).toBe(foreign.ptyId);expect(managed.runs.assertActive(foreign.task.runtimeSnapshot!.runId).snapshot.projectId).toBe(foreign.projectId);expect(applications.selections.requireEnabled(foreign.projectId,'zentao').connections.zentao).toBe(x.a.id);
  expect((await x.next()).connections.zentao).toBe(x.b.id);expect(ptys.launches).toHaveLength(count);
  const reopened=await tasks.open({taskId:pair.first.task.id});expect(reopened.task.nativeSessionId).toBe(pair.firstNative);expect((await managed.sessions.get(pair.first.task.id)).snapshot).toEqual(pair.firstFixed.snapshot);
  const newTask=await create();const newDetail=await applications.diagnoseSession(x.sender,newTask.task.id);expect(newDetail.applications.find(a=>a.appId==='zentao')!.connections[0]).toMatchObject({id:x.b.id,originalId:x.b.id});
  expect(sqlite.prepare('PRAGMA foreign_key_check').all()).toEqual([]);expect(tasks.activePty(foreign.task.id)).toBe(foreign.ptyId);
 },40000);
});

describe('ZenTao switch retains already narrowed native-only running work',()=>{
 it('does not stop a selected but un-injected native-only task while stopping a loaded one',async()=>{
  const x=await zentaoSwitchFixture();
  const loaded=await create(claudeId),originalPrepare=managed.prepare.bind(managed),spy=vi.spyOn(managed,'prepare').mockImplementationOnce(async input=>{const launch=await originalPrepare(input);return launch.nativeOnly!('managed_launch_payload_too_large');});
  const native=await create(claudeId),pty=tasks.activePty(native.task.id)!;spy.mockRestore();expect((await managed.sessions.get(native.task.id)).snapshot.packages.map(p=>p.appId)).toContain('zentao');expect(()=>managed.runs.assertActive(native.task.runtimeSnapshot!.runId)).toThrow('不签发');
  await x.next();expect(tasks.activePty(loaded.task.id)).toBeNull();expect(ptys.live.has(pty)).toBe(true);expect(tasks.activePty(native.task.id)).toBe(pty);
 },20000);
});


describe('actual host preparation records independent native diagnostics',()=>{
 // R1.0: Skills are not per session, so only the session's own MCP names can collide with a user entry; the user's entry wins.
 it.each(['native-conflicts','app-and-independent-conflicts','unknown-cli'] as const)('records truthful %s diagnostics, keeps the user configuration and persists no secrets',async fault=>{
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const seed=await create(codexId),nativeId=await stopForSwitchFixture(seed,'codex'),fixed=await managed.sessions.get(seed.task.id),mcp=fixed.snapshot.mcp.find(m=>m.kind==='legacy-project-context')!,bridgeName=fixed.snapshot.mcp.find(m=>m.kind==='applications')!.serverName,config=join(home,'.codex/config.toml');
  const text='[mcp_servers.'+mcp.serverName+']\ncommand="/usr/bin/false"\nargs=["MUST_NOT_PERSIST_ARG"]\nenv={TOKEN="MUST_NOT_PERSIST_TOKEN"}\n'+(fault==='app-and-independent-conflicts'?'[mcp_servers.'+bridgeName+']\ncommand="/usr/bin/false"\n':'');
  if(fault!=='unknown-cli')writeFileSync(config,text);else writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "99.0.0";; *) exit 70;; esac\n');
  const bridges=vi.mocked(managed.broker.prepare).mock.calls.length;let running:Awaited<ReturnType<typeof create>>|undefined;
  try{
   running=await tasks.open({taskId:seed.task.id});const argv=ptys.launches.at(-1)!.args!.join(' '),diagnostic=await applications.sessionDiagnostics.inspect(seed.task.id),preparation=diagnostic.currentRun!.preparation as unknown as {schema:number;capabilities:{kind:string;id:string;state:string;issueCode:string|null;sources:{kind:string;configurationPath:string|null;path:string|null}[]}[]};
   expect(preparation.schema).toBe(2);expect(preparation.capabilities).toHaveLength(fixed.snapshot.packages.length+1);
   const context=preparation.capabilities.find(i=>i.kind==='project-mcp')!,app=preparation.capabilities.find(i=>i.kind==='application'&&i.id==='mail')!;
   if(fault!=='unknown-cli'){
    expect(context).toMatchObject({id:mcp.serverName,state:'unavailable',issueCode:'AGENT_CAPABILITY_NAME_CONFLICT'});expect(context.sources).toContainEqual(expect.objectContaining({kind:'mcp',path:config}));
    expect(argv).not.toContain('mcp_servers.'+mcp.serverName+'.');expect(readFileSync(config,'utf8')).toBe(text);
    if(fault==='native-conflicts'){expect(app).toMatchObject({state:'prepared',issueCode:null});expect(argv).toContain('mcp_servers.'+bridgeName+'.command=');expect(vi.mocked(managed.broker.prepare).mock.calls.length).toBe(bridges+1);}
    else{
     expect(app).toMatchObject({state:'unavailable',issueCode:'AGENT_CAPABILITY_NAME_CONFLICT'});expect(app.sources).toContainEqual(expect.objectContaining({kind:'mcp',path:config}));
     expect(argv).not.toContain('mcp_servers.'+bridgeName+'.');expect(vi.mocked(managed.broker.prepare).mock.calls.length).toBe(bridges);
     const forged=structuredClone(diagnostic.currentRun!.preparation)!;if(forged.schema===2){const item=forged.capabilities.find(i=>i.kind==='application'&&i.id==='mail')!;item.state='prepared';item.issueCode=null;}await expect(applications.sessionDiagnostics.prepared(forged)).rejects.toMatchObject({code:'RESOURCE_STATE_CHANGED'});
    }
   }else{
    // R15 unknown-version delivery is best-effort L0.skill/L0.mcp, not a native configuration conflict; verified L1/L2/L3 stay closed.
    expect(preparation.capabilities.every(i=>i.state==='prepared')).toBe(true);expect(diagnostic.currentRun!.runPlan).toMatchObject({cliVersion:'99.0.0',verified:false,nativeSendEvidence:false});
    expect(diagnostic.currentRun!.runPlan!.levels).toEqual(['L0.skill','L0.mcp','L0.cli','L1','L2','L3'].map(level=>({level,state:level==='L0.skill'||level==='L0.mcp'?'best-effort':'unverified'})));
    expect(ptys.launches.at(-1)!.env).not.toHaveProperty(VALUE_PREFIX+'WILLYOU_RUN_TOKEN');const tools=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data));expect(await tools.call(running.task.runtimeSnapshot!.runId,randomUUID(),{operation:'smartdd_mail_draft_list_v1',contractMajor:1,connectionId:null,arguments:{}})).toMatchObject({status:'ok',value:{items:[],nextCursor:null}});
   }
   const stored=(sqlite.prepare('SELECT evidence_json FROM capability_run_preparations WHERE run_id=?').get(running.task.runtimeSnapshot!.runId) as {evidence_json:string}).evidence_json;expect(stored).not.toMatch(/MUST_NOT_PERSIST/);
   expect((await managed.sessions.get(seed.task.id)).snapshot).toEqual(fixed.snapshot);expect(running.task.nativeSessionId).toBe(nativeId);expect(ptys.live.has(running.ptyId)).toBe(true);
  }finally{if(running){tasks.kill(running.task.id);await vi.waitFor(()=>expect(managed.runs.get(running!.task.runtimeSnapshot!.runId).state).toBe('stopped'));}}
 },30000);
});

describe('embedded runtime failure narrows only application execution',()=>{
 it.each(['codex','claude-code'].flatMap(runner=>['new','resume'].map(mode=>[runner,mode] as const)))('keeps native capabilities on %s %s without the application bridge, then restores applications in a new run',async(runner,mode)=>{
  await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});
  const profile=runner==='codex'?codexId:claudeId;
  let seed:Awaited<ReturnType<typeof create>>|undefined,nativeId:string|undefined,prior:Awaited<ReturnType<typeof managed.sessions.get>>|undefined;
  if(mode==='resume'){seed=await create(profile);nativeId=await stopForSwitchFixture(seed,runner as 'codex'|'claude-code');prior=await managed.sessions.get(seed.task.id);}
  applicationRuntimeAvailable=false;
  const preparation=vi.spyOn(managed.broker,'prepare'),before=preparation.mock.calls.length;
  const running=seed?await tasks.open({taskId:seed.task.id}):await create(profile),id=running.task.id,runId=running.task.runtimeSnapshot!.runId,fixed=await managed.sessions.get(id);
  // R1.0: no per-run scope; the bridge is simply not mounted, so the Agent cannot reach any application tool.
  expect(running.task.runtimeSnapshot!.selfCheck.issues).toContain('HOST_INCOMPATIBLE');
  expect(preparation.mock.calls.length).toBe(before);expect(sqlite.prepare("SELECT * FROM capability_run_processes WHERE run_id=? AND kind='bridge'").all(runId)).toEqual([]);
  expect(fixed.snapshot.packages.map(p=>p.appId)).toEqual(['mail']);if(prior){expect(fixed.snapshot).toEqual(prior.snapshot);expect(running.task.nativeSessionId).toBe(nativeId);}
  const diagnostic=await applications.sessionDiagnostics.inspect(id),receipt=diagnostic.currentRun!.preparation!;expect(receipt.schema).toBe(2);
  if(receipt.schema!==2)throw new Error('Expected per-capability preparation');
  expect(receipt.capabilities.find(c=>c.kind==='application')).toMatchObject({state:'unavailable',issueCode:'HOST_INCOMPATIBLE'});
  const independent=receipt.capabilities.filter(c=>c.kind!=='application');expect(independent.length).toBeGreaterThan(0);expect(independent.every(c=>c.state==='prepared')).toBe(true);
  expect(running.task.runtimeSnapshot!.skills.filter(s=>s.enabled).length).toBe(fixed.snapshot.standardSkills.length);expect(running.task.runtimeSnapshot!.mcp.some(m=>m.name===fixed.snapshot.mcp.find(m=>m.kind==='legacy-project-context')!.serverName)).toBe(true);
  const tools=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data));applicationRuntimeAvailable=true;
  if(mode==='new')nativeId=await stopForSwitchFixture(running,runner as 'codex'|'claude-code');else{tasks.kill(id);await vi.waitFor(()=>expect(managed.runs.get(runId).state).toBe('stopped'));}
  expect(sqlite.prepare("SELECT * FROM capability_resource_leases WHERE owner_kind='run' AND owner_id=? AND state='active'").all(runId)).toEqual([]);
  const resumed=await tasks.open({taskId:id}),newRun=resumed.task.runtimeSnapshot!.runId;expect(newRun).not.toBe(runId);expect(resumed.task.nativeSessionId).toBe(nativeId);expect((await managed.sessions.get(id)).selectionHash).toBe(fixed.selectionHash);expect(managed.runs.assertActive(newRun).snapshot.packages.map(p=>p.appId)).toEqual(['mail']);expect(preparation.mock.calls.length).toBe(before+1);
  expect(await tools.call(newRun,randomUUID(),{operation:'smartdd_mail_draft_list_v1',contractMajor:1,connectionId:null,arguments:{}})).toMatchObject({status:'ok'});
  tasks.kill(id);await vi.waitFor(()=>expect(managed.runs.get(newRun).state).toBe('stopped'));
 },30000);
});


describe('M13 P1 plugins through production task startup',()=>{
 beforeEach(async()=>{writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.166.0";; *) exit 70;; esac\n',{mode:0o700});});
 const putPlugin=async(version='0.1.0',extra=false,actions=false,skills=false)=>{
  const f=pluginFixture();f.manifest.version=version;f.manifest.providers=[];f.manifest.capabilities['demo-tracker.items.list'].slots=[];
  if(actions){Object.assign(f.manifest.ui.panels[0],{rowActions:[{kind:'insertTerminal',title:'插入引用',payload:{reference:'{row.id}'}},{kind:'openUrl',title:'打开链接',field:'url'}]});const schema=JSON.parse(f.files.get('schemas/output.json')!.toString());schema.properties.items.items.properties.url={type:'string'};f.files.set('schemas/output.json',Buffer.from(JSON.stringify(schema)));}
  if(extra)Object.assign(f.manifest.capabilities,{'demo-tracker.items.extra':{...f.manifest.capabilities['demo-tracker.items.list']}});
  if(skills){Object.assign(f.manifest,{skills:['skills']});f.files.set('skills/query/SKILL.md',Buffer.from('---\nname: query\ndescription: Synthetic query '+version+'\n---\n{{WILLYOU_APPLICATION}}\n{{WILLYOU_ENTRYPOINTS}}\n'));f.files.set('skills/query/references/version.txt',Buffer.from(version));}
  f.files.set('runtime/main.mjs',Buffer.from(`import readline from 'node:readline';readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line),result=m.method==='initialize'?{protocol:'jsonrpc-stdio/1',plugin:'demo-tracker',version:${JSON.stringify(version)}}:{items:[{id:${JSON.stringify(version)},title:'Synthetic P1',url:'https://example.invalid/p1'}]};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result})+'\\n');});`));
  const directory=join(root,'plugin-source',version);for(const[path,bytes]of f.bundle()){mkdirSync(dirname(join(directory,path)),{recursive:true});writeFileSync(join(directory,path),bytes);}
  const inspected=await applications.plugins!.inspect('synthetic-renderer',directory,'directory');await applications.plugins!.install('synthetic-renderer',inspected.token);
 };
 const pluginTools=()=>new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data),{additional:applications.plugins!.tools});
 const invoke=(taskId:string)=>{const row=sqlite.prepare("SELECT run_id FROM capability_runs WHERE task_id=? AND state='active'").get(taskId) as {run_id:string};return pluginTools().call(row.run_id,randomUUID(),{operation:pluginMcpToolName('demo-tracker.items.list'),contractMajor:1,connectionId:null,arguments:{}});};
 const usePrivateCodex=()=>writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "0.167.1";; *) exit 70;; esac\n',{mode:0o700});
 it('delivers Codex frozen roots and run plan before the actual task terminal connects to its own backend',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);const created=await create(),request=codexRequests[0],launch=ptys.launches.at(-1)!;
  expect(codexRequests).toHaveLength(1);expect(codexStarted).toEqual([request.run.runId]);expect(request.run.runId).toBe(created.task.runtimeSnapshot!.runId);expect(launch.args).toContain('--remote');expect(launch.args[launch.args.indexOf('--remote')+1]).toContain(request.run.runId);
  expect(request.managedArgs).not.toContain('--remote');expect(request.skills.codexRoots).toHaveLength(1);expect(readFileSync(join(request.skills.codexRoots[0],'SKILL.md'),'utf8')).toContain('Synthetic query 0.1.0');expect(managed.runs.bridgePreparation(request.run.runId).plan?.skills).toEqual([expect.objectContaining({nativeName:'willyou-demo-tracker-query'})]);
  expect(managed.runs.bridgePreparation(request.run.runId).plan?.grades.cli).toBe(false);expect(request.environment).not.toHaveProperty('WILLYOU_RUN_TOKEN');expect(request.environment).not.toHaveProperty('CODEX_HOME');expect(existsSync(join(cwd,'.agents/skills'))).toBe(false);
  tasks.kill(created.task.id);await vi.waitFor(()=>expect(managed.runs.get(request.run.runId).state).toBe('stopped'));expect(codexStopped).toEqual([request.run.runId]);expect(existsSync(request.skills.root)).toBe(false);
 });
 it('keeps a running Codex Skill frozen while host calls use the new package, then refreshes private roots on resume',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);const first=await create(),old=codexRequests[0],path=join(old.skills.codexRoots[0],'SKILL.md'),bytes=readFileSync(path,'utf8');await putPlugin('0.2.0',false,false,true);expect(readFileSync(path,'utf8')).toBe(bytes);expect(await invoke(first.task.id)).toMatchObject({status:'ok',value:{items:[{id:'0.2.0'}]}});
  const id=await stopForSwitchFixture(first,'codex');expect(existsSync(old.skills.root)).toBe(false);const resumed=await tasks.open({taskId:first.task.id}),next=codexRequests[1];expect(resumed.task.nativeSessionId).toBe(id);expect(next.run.runId).not.toBe(old.run.runId);expect(next.skills.root).not.toBe(old.skills.root);expect(readFileSync(join(next.skills.codexRoots[0],'SKILL.md'),'utf8')).toContain('Synthetic query 0.2.0');expect(ptys.launches.at(-1)!.args).toContain('resume');
 });
 it('closes a backend which started before a terminal fork failure without using the whole-run no-fork receipt',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);codexStartFailure=true;await expect(create()).rejects.toThrow('controlled-private-server-start-failure');expect(codexStarted).toHaveLength(1);expect(ptys.launches).toHaveLength(0);
  await vi.waitFor(()=>expect(sqlite.prepare('SELECT state FROM capability_runs').all()).toEqual([{state:'stopped'}]));expect(codexStopped).toEqual(codexStarted);const states=sqlite.prepare("SELECT kind,state FROM capability_run_processes").all();expect(states).toContainEqual({kind:'cli',state:'canceled'});expect(states.filter(row=>(row as {kind:string}).kind==='bridge')).toEqual(expect.arrayContaining([{kind:'bridge',state:'exited'},{kind:'bridge',state:'exited'}]));
 });
 it('narrows a prepared Codex launch before any backend fork and retains the ordinary native Agent',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);const original=managed.prepare.bind(managed);vi.spyOn(managed,'prepare').mockImplementationOnce(async input=>{const launch=await original(input);return launch.nativeOnly!('managed_launch_payload_too_large');});const created=await create();expect(codexRequests).toHaveLength(1);expect(codexStarted).toEqual([]);expect(codexStopped).toHaveLength(1);expect(ptys.launches.at(-1)!.args).not.toContain('--remote');expect(created.task.runtimeSnapshot!.selfCheck.issues).toContain('managed_launch_payload_too_large');
 });
 it('preserves unsupported profile arguments in a native-only launch and does not start a private backend',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);mkdirSync(join(home,'.codex'),{recursive:true});writeFileSync(join(home,'.codex/work.config.toml'),'model="synthetic"\n');profiles.update(codexId,{name:'Codex version fixture',runner:'codex',executable:profiles.resolve(codexId).command,args:['--profile','work'],env:[],color:null,isDefault:true});
  const created=await create();expect(codexStarted).toEqual([]);expect(ptys.launches.at(-1)!.args).toEqual(['--profile','work']);expect(created.task.runtimeSnapshot!.selfCheck.issues).toContain('AGENT_ADAPTER_UNSUPPORTED');
 });
 it('does not prepare private Codex roots for a project-closed plugin',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);const plugin=applications.plugins!.catalog()[0],target={appId:plugin.appId,packageHash:plugin.hash!},setting=applications.plugins!.connections.project(target,projectId);await applications.plugins!.connections.setProject({...target,projectId,expectedRevision:setting.binding_revision,mode:'follow',enabled:false});await create();expect(codexRequests).toEqual([]);expect(ptys.launches.at(-1)!.args).not.toContain('--remote');
 });
 it('refuses changed Codex Skill bytes before backend/terminal forks and closes prepared windows',async()=>{
  usePrivateCodex();await putPlugin('0.1.0',false,false,true);const original=managed.prepare.bind(managed);vi.spyOn(managed,'prepare').mockImplementationOnce(async input=>{const launch=await original(input);writeFileSync(join(codexRequests[0].skills.codexRoots[0],'SKILL.md'),'changed');return launch;});await expect(create()).rejects.toMatchObject({code:'HASH_MISMATCH'});expect(codexStarted).toEqual([]);expect(ptys.launches).toHaveLength(0);await vi.waitFor(()=>expect(sqlite.prepare('SELECT state FROM capability_runs').all()).toEqual([{state:'stopped'}]));
 });
 it('delivers a private Claude Skill at the actual task launch, keeps it frozen after update, and refreshes on resume',async()=>{
  await putPlugin('0.1.0',false,false,true);const created=await create(claudeId),launch=ptys.launches.at(-1)!,index=launch.args.indexOf('--plugin-dir');expect(index).toBeGreaterThan(-1);const oldRoot=launch.args[index+1],entry=join(oldRoot,'payload/skills/query/SKILL.md'),before=readFileSync(entry,'utf8'),saved=await managed.sessions.get(created.task.id);expect(before).toContain('Synthetic query 0.1.0');expect(before).toContain(saved.snapshot.adapterBinding.nativeToolNames[pluginMcpToolName('demo-tracker.items.list')]);expect(before).not.toContain('{{WILLYOU_');expect(existsSync(join(home,'.claude/skills/willyou-demo-tracker'))).toBe(false);
  expect(managed.runs.bridgePreparation(created.task.runtimeSnapshot!.runId).plan?.skills).toEqual([expect.objectContaining({appId:'demo-tracker',nativeName:'willyou-demo-tracker:query'})]);await putPlugin('0.2.0',false,false,true);expect(readFileSync(entry,'utf8')).toBe(before);expect(await invoke(created.task.id)).toMatchObject({status:'ok',value:{items:[{id:'0.2.0'}]}});
  const nativeId=await stopForSwitchFixture(created,'claude-code');await vi.waitFor(()=>expect(existsSync(oldRoot)).toBe(false));const resumed=await tasks.open({taskId:created.task.id}),next=ptys.launches.at(-1)!,nextRoot=next.args[next.args.indexOf('--plugin-dir')+1];expect(resumed.task.nativeSessionId).toBe(nativeId);expect(nextRoot).not.toBe(oldRoot);expect(readFileSync(join(nextRoot,'payload/skills/query/SKILL.md'),'utf8')).toContain('Synthetic query 0.2.0');
 });
 it('does not inject a project-closed Claude plugin into a new or resumed task',async()=>{
  await putPlugin('0.1.0',false,false,true);const created=await create(claudeId);await stopForSwitchFixture(created,'claude-code');const plugin=applications.plugins!.catalog()[0],target={appId:plugin.appId,packageHash:plugin.hash!},setting=applications.plugins!.connections.project(target,projectId);await applications.plugins!.connections.setProject({...target,projectId,expectedRevision:setting.binding_revision,mode:'follow',enabled:false});await tasks.open({taskId:created.task.id});expect(ptys.launches.at(-1)!.args).not.toContain('--plugin-dir');const fresh=await create(claudeId);expect(ptys.launches.at(-1)!.args).not.toContain('--plugin-dir');const current=await managed.sessions.get(fresh.task.id);expect(current.snapshot.schema===3&&current.snapshot.externalPlugins).toEqual([]);
 });
 it('refuses a changed Skill projection before the native fork and closes the unspawned run',async()=>{
  await putPlugin('0.1.0',false,false,true);const original=managed.prepare.bind(managed);vi.spyOn(managed,'prepare').mockImplementation(async input=>{const launch=await original(input),index=launch.args.indexOf('--plugin-dir');if(index>=0)writeFileSync(join(launch.args[index+1],'payload/skills/query/SKILL.md'),'tampered');return launch;});await expect(create(claudeId)).rejects.toMatchObject({code:'HASH_MISMATCH'});expect(ptys.launches).toHaveLength(0);await vi.waitFor(()=>expect(sqlite.prepare("SELECT state FROM capability_runs").all()).toEqual([{state:'stopped'}]));expect(managed.recoveryWarnings.some(w=>w.homeId.startsWith('plugin-skills:'))).toBe(true);
 });
 it('routes a real sandbox page result into the chosen task through host-owned proof and the existing exactly-once paste transport',async()=>{
  await putPlugin('0.1.0',false,true);const created=await create(),frame={processId:101,routingId:202},sender={sender:{id:91,mainFrame:frame,isDestroyed:()=>false},senderFrame:frame} as unknown as ApplicationUiSender;
  const target={taskId:created.task.id,ptyId:created.ptyId},hash=applications.plugins!.catalog()[0].hash!,page=await applications.pluginRead(sender,{requestId:randomUUID(),projectId,appId:'demo-tracker',panelId:'items',packageHash:hash,capability:'demo-tracker.items.list',input:{}});
  const request={receiptId:page.actionReceipt!,actionIndex:0,row:{receiptId:page.actionReceipt!,index:0}},action=applications.pluginPrepareAction(sender,request);
  const source={kind:'pluginAction' as const,appId:'demo-tracker',actionId:action.id},binding=await applications.bindTerminal(sender,{projectId,target,source}),operation={bindingId:binding.id,operationId:randomUUID()};
  expect(await applications.insertTerminal(sender,operation)).toMatchObject({state:'inserted'});expect(await applications.insertTerminal(sender,operation)).toMatchObject({state:'inserted'});expect(pluginWrites).toHaveLength(1);expect(pluginWrites[0]).toMatchObject({id:created.ptyId});expect(pluginWrites[0].data).toContain('"reference":"0.1.0"');expect(pluginWrites[0].data.endsWith('\r')).toBe(false);
  const opened=applications.pluginPrepareAction(sender,{...request,actionIndex:1});const opening=applications.pluginOpenAction(sender,opened.id);await expect(applications.pluginOpenAction(sender,opened.id)).rejects.toMatchObject({code:'INTENT_STALE'});await opening;expect(pluginUrls).toEqual(['https://example.invalid/p1']);
  applications.releaseTerminal(sender,binding.id);const next=await applications.bindTerminal(sender,{projectId,target,source});sqlite.prepare("UPDATE application_project_settings SET enabled=0 WHERE app_id='demo-tracker' AND project_id=?").run(projectId);
  expect(()=>applications.insertTerminal(sender,{bindingId:next.id,operationId:randomUUID()})).toThrow();expect(pluginWrites).toHaveLength(1);expect(()=>applications.pluginPrepareAction(sender,request)).toThrow();
 });
 it('captures an installed plugin in the actual task snapshot/plan and dispatches its sandbox process',async()=>{
  await putPlugin();const created=await create(),saved=await managed.sessions.get(created.task.id);expect(saved.snapshot.schema).toBe(3);
  if(saved.snapshot.schema!==3)throw new Error('schema3 required');expect(saved.snapshot.externalPlugins).toHaveLength(1);expect(saved.snapshot.adapterBinding.nativeToolNames).toHaveProperty(pluginMcpToolName('demo-tracker.items.list'));
  expect(saved.snapshot.packages.some(p=>p.appId==='demo-tracker')).toBe(false);expect(await invoke(created.task.id)).toMatchObject({status:'ok',value:{items:[{id:'0.1.0'}]}});
  await applications.plugins!.setEnabled('demo-tracker',false,applications.plugins!.catalog()[0].revision);expect(await invoke(created.task.id)).toMatchObject({status:'error',error:{code:'APP_NOT_ENABLED'}});
 });
 it('refreshes plugin discovery on native-session resume and retains the original native identity/history',async()=>{
  await putPlugin();const created=await create(),nativeId=await stopForSwitchFixture(created,'codex'),old=await managed.sessions.get(created.task.id);
  await putPlugin('0.2.0',true);const resumed=await tasks.open({taskId:created.task.id}),current=await managed.sessions.get(created.task.id);
  expect(resumed.task.nativeSessionId).toBe(nativeId);expect(current.pointer.snapshotHash).not.toBe(old.pointer.snapshotHash);expect(current.snapshot.native).toEqual(old.snapshot.native);
  if(current.snapshot.schema!==3)throw new Error('schema3 required');expect(current.snapshot.externalPlugins![0]).toMatchObject({version:'0.2.0'});expect(current.snapshot.externalPlugins![0].capabilities.some(c=>c.id==='demo-tracker.items.extra')).toBe(true);
  expect(sqlite.prepare('SELECT 1 FROM capability_snapshot_versions WHERE task_id=? AND snapshot_hash=?').get(created.task.id,old.pointer.snapshotHash)).toBeTruthy();
  expect(await invoke(created.task.id)).toMatchObject({status:'ok',value:{items:[{id:'0.2.0'}]}});
 });
});
