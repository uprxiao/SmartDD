import {createHash} from 'node:crypto';
import {cpSync} from 'node:fs';
import {ownedBundle} from '../owned-bundle';
import {applicationToolDeclarations} from '@shared/application-capabilities';
import {ApplicationBridgeClient,consumeBridgeBootstrap} from '../bridge-client';
import {LegacyCapabilityResourceAdopter,readLegacyOwnedTree} from '../legacy-resource-adopter';
import {treeHash} from '../../capabilities/assets';
import {writeOwnedTree} from '../../capabilities/files';
import {projectSkillName,standardNativeSkillName} from '../session-projector';
import {DiscoveryCatalog} from '../discovery-catalog';
import {captureNativeStaticRoots,verifyNativeStaticRoots} from '../native-static-roots';
import {createNativeGuardDiscoveryProof,nativeGuardResourceOmissions,nativeGuardCatalogOmissions,nativeGuardAdapterExclusions,type NativeGuardDiscoveryProof} from '../native-discovery-exclusions';
import {spawnSync} from 'node:child_process';
import {secretKeys} from '../../projects/secret-keys';
import {SessionCapabilityProjector} from '../session-projector';
import {applicationNativeSkillName,applicationMcpServerName} from '@shared/application-session';
import {readClaudeSlot,writeClaudeSlot} from '../claude-delivery-state';
import {ApplicationConnectionService} from '../connection-service';
import {PtyAccess} from '../../../pty-access';
import {APPLICATION_SKILL_EXAMPLES} from '@shared/application-terminal';
import type {ApplicationUiSender} from '../execution-context';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {parse as parseToml} from 'smol-toml';
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
import {CapabilityService,MCP_CAPABILITY} from '../../capabilities/capability-service';
import {TaskService,type PtyHost} from '../../tasks/task-service';
import {ResourceStore} from '../resource-store';
import {AgentSupportService} from '../agent-support-service';
import {ApplicationService} from '../application-service';
import {ManagedTaskCapabilities} from '../task-capability-launcher';
import {FixtureProcessReader} from './run-fixture';
import {PtyManager} from '../../../pty-manager';
import {MacProcessIdentityReader} from '../process-identity';
import {encodeClaudeDir} from '../../tasks/native-sessions';
import {ApplicationToolService} from '../tool-service';
import {canonicalJson,digest} from '../manifest';
import {ApplicationAdapterRegistry} from '../application-adapter-registry';
import {BuiltinPackageRegistry} from '../builtin-package-registry';
import {CapabilityBundleSource} from '../bundle-source';
import {installCliFixturePackage} from './cli-fixture';
import type {AgentLoadRequest,AgentLoadPlan} from '@shared/agent-adapters';
import {applicationSkillContentHash} from '../session-registry';
import {connect} from 'node:net';
import {VALUE_PREFIX} from '../../../launch-env';
import {UpstreamSessionPool} from '../upstream/session-pool';
import type {BridgeResponse} from '@shared/application-bridge';
let root:string,home:string,cwd:string,sqlite:Database.Database,capabilities:CapabilityService,support:AgentSupportService,applications:ApplicationService,managed:ManagedTaskCapabilities,tasks:TaskService,projects:ProjectService,profiles:AiProfileService,reader:FixtureProcessReader,ptys:TestPtys,projectId:string,codexId:string,claudeId:string;
const delivery=resolve('delivery-t24/attempt-001');mkdirSync(delivery,{recursive:true});
let observations:unknown[]=[];
let expectedDisposeError:unknown;
let argMax:number|null;
let applicationRuntimeAvailable:boolean;
let cliPolicyAvailable:boolean;
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
class TestPtys extends EventEmitter implements PtyHost{
 readonly live=new Map<string,number>();readonly launches:SpawnOptions[]=[];
 spawn(options:SpawnOptions){this.launches.push(options);const pid=31000+this.launches.length;this.live.set(options.id!,pid);reader.identities.set(pid,'darwin-proc-v1:300:'+pid);return options.id!;}
 nativePid(id:string){return this.live.get(id)??null;}
 kill(id:string){const pid=this.live.get(id);if(pid){reader.identities.delete(pid);this.live.delete(id);this.emit('exit',id,0);}}
}
beforeEach(async({task})=>{
 cliPolicyAvailable=true;const withCli=true;
 observations=[];fixtureBridgeExits=[];expectedDisposeError=undefined;applicationRuntimeAvailable=true;argMax=1048576;root=realpathSync(mkdtempSync(join(tmpdir(),'willyou-m10-launch-')));home=join(root,'home');cwd=join(root,'project');mkdirSync(home);mkdirSync(cwd);mkdirSync(join(cwd,'.git'));mkdirSync(join(home,'.claude'));
 sqlite=new Database(join(root,'state.sqlite'));sqlite.pragma('foreign_keys=ON');runBundledMigrations(sqlite);const db=drizzle(sqlite,{schema}),secrets=new SecretsStore(db,{isAvailable:()=>true,encrypt:s=>Buffer.from(s),decrypt:b=>b.toString()});projects=new ProjectService(db,secrets);profiles=new AiProfileService(db,secrets);projectId=projects.createProject({name:'isolated production composition',aliases:[],description:'',rulesPath:null},[{label:'',path:cwd}]).id;
 // Only this private, harmless version fixture is executed. It does not emulate a native Agent session.
 const command=join(root,'version-fixture');writeFileSync(command,'#!/bin/sh\ncase "$1" in --version) echo "0.166.0";; *) exit 70;; esac\n',{mode:0o700});
 codexId=profiles.create({name:'Codex version fixture',runner:'codex',executable:command,args:[],env:[],color:null,isDefault:true}).id;
 const cc=join(root,'cc-version-fixture');writeFileSync(cc,'#!/bin/sh\ncase "$1" in --version) echo "2.1.303 (Claude Code)";; *) exit 70;; esac\n',{mode:0o700});claudeId=profiles.create({name:'CC version fixture',runner:'claude',executable:cc,args:[],env:[],color:null,isDefault:false}).id;
 capabilities=new CapabilityService({db,projects,secrets,userData:root});support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,levelFixtureDistribution());await support.initialize();expect(support.status().state).toBe('ready');reader=new FixtureProcessReader();ptys=new TestPtys();tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',...(withCli?{WILLYOU_RUN_TOKEN:'OUTER_RUN_TOKEN_MUST_NOT_LEAK',WILLYOU_ENDPOINT:'/private/tmp/outer.sock'}:{})}),onChanged:()=>{},codexPollMs:20,launchArgMax:()=>argMax});
 applications=new ApplicationService(support.store,{secrets,projects,tasks,activePty:id=>tasks.activePty(id),requireSender:()=>{},mailWorker:join(root,'unused-worker'),foxmailNative:join(root,'unused-native'),processes:reader});await applications.recover();managed=await ManagedTaskCapabilities.open(support,capabilities,applications,{helper:join(root,'unused-helper'),processes:reader,...(withCli?{cliPath:realpathSync(resolve('out/native/willyou-app')),inspectSandbox:async()=>cliPolicyAvailable?fixtureCliPolicy:{available:false as const,reason:'controlled-unverified-policy',source:'unverified-effective-policy',digest:null}}:{}),peers:{read:async()=>withCli?{schema:2,state:'running',uid:process.getuid!(),peer:{pid:32001,startedAt:'darwin-proc-v1:300:32001',executable:realpathSync(resolve('out/native/willyou-app'))},ancestors:[{pid:32001,startedAt:'darwin-proc-v1:300:32001',ppid:31001},{pid:31001,startedAt:'darwin-proc-v1:300:31001',ppid:1}]}:null},probeApplicationRuntime:async()=>applicationRuntimeAvailable,stopPty:id=>ptys.kill(id),pollMs:20});tasks.attachManagedCapabilities(managed);
});
afterEach(async()=>{
 const failures:unknown[]=[];
 try{tasks?.dispose();for(const id of ptys?.live?.keys()??[])ptys.kill(id);await applications?.dispose();}catch(error){failures.push(error);}
 failures.push(...await drainFixtureBridgeExits());
 try{await managed?.dispose();}catch(error){if(error!==expectedDisposeError)failures.push(error);}
 failures.push(...await drainFixtureBridgeExits());
 capabilities?.dispose();sqlite?.close();rmSync(root,{recursive:true,force:true});writeFileSync(join(delivery,'cleanup-'+randomUUID()+'.json'),JSON.stringify({root,rootExists:existsSync(root),liveFakePtys:ptys.live.size,fixtureBridgeFailures:failures.map(e=>String(e)),resources:'only own private TaskService, broker/CLI listeners and fake PTYs; no real Agent/UI'},null,2));
 writeFileSync(join(delivery,'observations-'+randomUUID()+'.json'),JSON.stringify(observations,null,2));
 if(failures.length)throw new AggregateError(failures,'Synthetic bridge exits and fixture disposal must complete before store cleanup');
});
const create=(id=codexId)=>tasks.create({projectId,dirId:null,aiProfileId:id,firstMessage:''});



let minimalAdapterHash='';
function levelFixtureDistribution(){
 const path=join(root,'level-adapter-distribution');cpSync(resolve('out/capability-bundles'),path,{recursive:true});const original=new CapabilityBundleSource(path),template=original.adapters().find(a=>a.metadata.agentId==='codex'&&a.metadata.version==='1.3.0')!;
 const metadata={...template.metadata,version:'9.0.0',cliEntry:'unsupported' as const,levels:{'0.166.0':['L0.skill','L0.mcp','L1'] as import('@shared/agent-adapters').AgentLevel[]},evidenceBaseline:'M11 T24 private registered L0+L1 fixture; no L2/L3 evidence methods or CLI delivery'};
 const files={...template.files,'index.cjs':Buffer.from(template.files['index.cjs'].toString().replace("exports.version='1.3.0'","exports.version='9.0.0'"))},bundle=ownedBundle(metadata,files);minimalAdapterHash=bundle.hash;
 const relative='adapters/codex/9.0.0/'+bundle.hash,directory=join(path,relative);mkdirSync(directory,{recursive:true});for(const[name,bytes]of Object.entries(files)){mkdirSync(dirname(join(directory,name)),{recursive:true});writeFileSync(join(directory,name),bytes);}writeFileSync(join(directory,'bundle.json'),canonicalJson(bundle.manifest)+'\n');
 const {indexHash:_,...index}=structuredClone(original.index);index.adapters.push({agentId:'codex',version:'9.0.0',hash:bundle.hash,path:relative});index.build.resourceSetHash=digest(canonicalJson({adapters:index.adapters,runtimes:index.runtimes,apps:index.apps}));writeFileSync(join(path,'index.json'),canonicalJson({...index,indexHash:digest(canonicalJson(index))})+'\n');
 observations.push({fixtureAdapter:{metadata,hash:bundle.hash,sourceIndexHash:original.index.indexHash,fixtureIndexHash:new CapabilityBundleSource(path).index.indexHash}});return path;
}
async function selectMail(){await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});}

describe('M11-T24 actual installed adapter levels and live shared capability service',()=>{
 beforeEach(()=>{
  const handles=new Map<string,Awaited<ReturnType<typeof managed.broker.prepare>>['bridge']>(),prepare=managed.broker.prepare.bind(managed.broker),kill=ptys.kill.bind(ptys);
  vi.spyOn(managed.broker,'prepare').mockImplementation(async(...args)=>{const value=await prepare(...args);handles.set(args[0].ptyId,value.bridge);return value;});
  vi.spyOn(ptys,'kill').mockImplementation(id=>{kill(id);const handle=handles.get(id);if(handle){handles.delete(id);queueFixtureBridgeExit(handle);}});
 });
 it.each([{mode:'retained-full',nativeVersion:'0.162.1',adapterVersion:'1.0.0',higher:'declared',nativeSend:true},{mode:'minimal-fixture',nativeVersion:'0.166.0',adapterVersion:'9.0.0',higher:'unverified',nativeSend:false}] as const)('loads $mode, delivers the original SOP, calls MCP, and reports its actual levels',async sample=>{
  writeFileSync(profiles.resolve(codexId).command,'#!/bin/sh\ncase "$1" in --version) echo "'+sample.nativeVersion+'";; *) exit 70;; esac\n',{mode:0o700});await selectMail();
  const pkg=applications.builtin.packages.get(applications.builtin.packages.active('mail')!.packageHash),before=canonicalJson(pkg.manifest),packageBytes=Object.fromEntries(pkg.manifest.files.map(f=>[f.path,digest(readFileSync(join(support.store.root,pkg.relativePath,f.path)))]));
  const real=support.adapters.plan.bind(support.adapters),plans:{hash:string;input:AgentLoadRequest;plan:AgentLoadPlan}[]=[];vi.spyOn(support.adapters,'plan').mockImplementation((hash,input)=>{const plan=real(hash,input);plans.push({hash,input:structuredClone(input),plan:structuredClone(plan)});return plan;});
  const running=await create(codexId),stored=await managed.sessions.get(running.task.id),snapshot=stored.snapshot,runId=running.task.runtimeSnapshot!.runId;
  expect(snapshot.adapterBinding.version).toBe(sample.adapterVersion);if(sample.mode==='minimal-fixture')expect(snapshot.adapterBinding.hash).toBe(minimalAdapterHash);
  const installed=support.adapters.verify(snapshot.adapterBinding.hash);expect(installed.hash).toBe(snapshot.adapterBinding.hash);const selected=plans.filter(p=>p.input.runId===runId).at(-1)!;expect(selected.hash).toBe(installed.hash);for(const arg of selected.plan.args)expect(ptys.launches[0].args).toContain(arg);expect(selected.input.cliSandbox).toBeUndefined();
  expect(snapshot.packages).toHaveLength(1);expect(snapshot.packages[0].packageHash).toBe(pkg.packageHash);for(const skill of snapshot.packages[0].skills){const bytes=readFileSync(skill.projectionPath);expect(bytes.toString()).toContain('smartdd_mail_');expect(bytes.toString()).not.toContain('{{WILLYOU_');expect(applicationSkillContentHash(pkg.manifest,skill.sourceRelativePath)).toBe(skill.contentHash);observations.push({skillId:skill.skillId,sourceHash:skill.contentHash,deliveredHash:digest(bytes)});}
  const service=new ApplicationToolService(support.store,managed.runs,new ApplicationAdapterRegistry(support.store,applications.data),{retryDelays:[0,0]}),response=await service.call(runId,randomUUID(),{operation:'smartdd_mail_draft_list_v2',contractMajor:2,connectionId:null,arguments:{}});
  expect(response).toMatchObject({status:'ok',value:{schema:'willyou-app-result-v2',data:{items:[],nextCursor:null},source:{appId:'mail',packageHash:pkg.packageHash,connections:[]},operation:{origin:'mcp',effectState:'read-only'}}});
  const diagnostic=await applications.sessionDiagnostics.inspect(running.task.id),plan=diagnostic.currentRun!.runPlan!;expect(plan).toMatchObject({cliVersion:sample.nativeVersion,verified:true,nativeSendEvidence:sample.nativeSend});
  for(const level of ['L0.skill','L0.mcp','L1'])expect(plan.levels).toContainEqual({level,state:'declared'});for(const level of ['L2','L3'])expect(plan.levels).toContainEqual({level,state:sample.higher});expect(plan.levels).toContainEqual({level:'L0.cli',state:'unverified'});
  expect(diagnostic.applications.find(a=>a.appId==='mail')!.evidence).toMatchObject({toolRequests:1,successfulToolRequests:1,skillDiscovery:'unverified',skillRead:'unverified'});
  expect(canonicalJson(applications.builtin.packages.get(pkg.packageHash).manifest)).toBe(before);expect(Object.fromEntries(pkg.manifest.files.map(f=>[f.path,digest(readFileSync(join(support.store.root,pkg.relativePath,f.path)))]))).toEqual(packageBytes);
  observations.push({sample,adapter:{metadata:installed.metadata,hash:installed.hash},packageHash:pkg.packageHash,unchangedAppManifestHash:digest(before),runtimePlan:plan,invocation:{status:response.status,operation:response.status==='ok'?(response.value as import('@shared/application-result').ApplicationResultV2).operation:null},diagnosticEvidence:diagnostic.applications.find(a=>a.appId==='mail')!.evidence});
 });
});
