import {createHash} from 'node:crypto';
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
const delivery=resolve('delivery-t16/attempt-002');mkdirSync(delivery,{recursive:true});
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
 capabilities=new CapabilityService({db,projects,secrets,userData:root});support=new AgentSupportService(new ResourceStore(sqlite,root),capabilities,resolve('out/capability-bundles'));await support.initialize();expect(support.status().state).toBe('ready');reader=new FixtureProcessReader();ptys=new TestPtys();tasks=new TaskService({db,ptys,profiles,projects,capabilities,baseEnv:()=>({HOME:home,PATH:'/usr/bin:/bin',...(withCli?{WILLYOU_RUN_TOKEN:'OUTER_RUN_TOKEN_MUST_NOT_LEAK',WILLYOU_ENDPOINT:'/private/tmp/outer.sock'}:{})}),onChanged:()=>{},codexPollMs:20,launchArgMax:()=>argMax});
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


function observePlans(){
 const real=support.adapters.plan.bind(support.adapters),seen:{request:AgentLoadRequest,plan:AgentLoadPlan}[]=[];
 vi.spyOn(support.adapters,'plan').mockImplementation((hash,input)=>{const plan=real(hash,input);seen.push({request:structuredClone(input),plan:structuredClone(plan)});observations.push({kind:'actual-adapter-plan-call',runner:input.snapshot.runner,runId:input.runId,taskId:input.snapshot.taskId,hasCliSandbox:Boolean(input.cliSandbox),hasSkillDelivery:Boolean(input.applicationSkillDelivery),argHash:digest(canonicalJson(plan.args))});return plan;});return seen;
}
function canonSop(text:string){return text.replace(/^name:.*$/m,'name: SAME_SOURCE');}
async function selectMail(){await applications.selections.setAdded('mail',true,0);await applications.selections.select({projectId,appId:'mail',enabled:true,expectedRevision:0,connections:{foxmail:null,smtp:null}});}
function observeSource(taskId:string,snapshot:Awaited<ReturnType<typeof managed.sessions.get>>['snapshot']){
 const pack=snapshot.packages.find(p=>p.appId==='mail')!,manifest=applications.builtin.assertTrusted(pack.packageHash).manifest;
 const sources=pack.skills.map(skill=>{expect(applicationSkillContentHash(manifest,skill.sourceRelativePath)).toBe(skill.contentHash);return{skillId:skill.skillId,contentHash:skill.contentHash,sourceRelativePath:skill.sourceRelativePath};});
 observations.push({taskId,runner:snapshot.runner,projectId:snapshot.projectId,packageHash:pack.packageHash,permissions:pack.allowedOperations,bindings:pack.bindings,sources});return sources;
}

describe('M11-T16 actual shared SOP delivery across declared Agent adapter fixtures',()=>{
 beforeEach(()=>{
  const handles=new Map<string,Awaited<ReturnType<typeof managed.broker.prepare>>['bridge']>(),prepare=managed.broker.prepare.bind(managed.broker),kill=ptys.kill.bind(ptys);
  vi.spyOn(managed.broker,'prepare').mockImplementation(async(...args)=>{const value=await prepare(...args);handles.set(args[0].ptyId,value.bridge);return value;});
  vi.spyOn(ptys,'kill').mockImplementation(id=>{kill(id);const handle=handles.get(id);if(handle){handles.delete(id);queueFixtureBridgeExit(handle);}});
 });
 it('uses one current application SOP for both declared MCP delivery adapters with identical scope and source identity',async()=>{
  await selectMail();const seen=observePlans(),codex=await create(codexId),claude=await create(claudeId),c=(await managed.sessions.get(codex.task.id)).snapshot,a=(await managed.sessions.get(claude.task.id)).snapshot;
  expect(c.runner).toBe('codex');expect(a.runner).toBe('claude-code');expect(c.packages.map(p=>p.appId)).toEqual(['mail']);expect(a.packages.map(p=>p.appId)).toEqual(['mail']);
  const cs=observeSource(c.taskId,c),as=observeSource(a.taskId,a);expect(cs).toEqual(as);expect(c.packages[0].packageHash).toBe(a.packages[0].packageHash);expect(c.projectId).toBe(a.projectId);expect(c.packages[0].allowedOperations).toEqual(a.packages[0].allowedOperations);expect(c.packages[0].bindings).toEqual(a.packages[0].bindings);
  for(const skill of c.packages[0].skills){const other=a.packages[0].skills.find(s=>s.skillId===skill.skillId)!;
   const cb=readFileSync(skill.projectionPath,'utf8'),ab=readFileSync(other.projectionPath,'utf8');expect(canonSop(cb)).toBe(canonSop(ab));expect(cb).not.toContain('willyou-app mail');expect(cb).toContain('MCP 工具 smartdd_mail_');observations.push({skillId:skill.skillId,normalizedCodexSha256:digest(canonSop(cb)),normalizedClaudeSha256:digest(canonSop(ab))});
  }
  for(const run of [codex,claude]){const plan=managed.runs.bridgePreparation(run.task.runtimeSnapshot!.runId).plan!;expect(plan.allowed.every(p=>p.entry==='mcp'&&p.appId==='mail')).toBe(true);expect(plan.projectId).toBe(projectId);expect(plan.applications.map(a=>a.appId)).toEqual(['mail']);}
  expect(seen.some(s=>s.plan.agentId==='codex'&&s.plan.args.includes('-c'))).toBe(true);expect(seen.some(s=>s.plan.agentId==='claude-code'&&s.plan.args.includes('--plugin-dir'))).toBe(true);expect(seen.every(s=>s.request.snapshot.projectId===projectId)).toBe(true);
 });
 it('renders CLI only for its supported adapter and the declared MCP fallback for the other, from the same SOP source',async()=>{
  await installCliFixturePackage(support.store,join(root,'cli-distribution'));await selectMail();const seen=observePlans(),codex=await create(codexId),claude=await create(claudeId),c=(await managed.sessions.get(codex.task.id)).snapshot,a=(await managed.sessions.get(claude.task.id)).snapshot;
  expect(observeSource(c.taskId,c)).toEqual(observeSource(a.taskId,a));const cp=managed.runs.bridgePreparation(codex.task.runtimeSnapshot!.runId).plan!,ap=managed.runs.bridgePreparation(claude.task.runtimeSnapshot!.runId).plan!;
  expect(cp.allowed).toMatchObject([{capabilityId:'mail.draft.list',entry:'cli'}]);expect(cp.allowed).toHaveLength(1);expect(ap.allowed).toMatchObject([{capabilityId:'mail.draft.list',entry:'mcp'}]);expect(ap.allowed).toHaveLength(1);expect(ap.applications[0]).toMatchObject({fallback:true,effectiveEntry:'mcp'});
  const cliText=readFileSync(join(home,'.agents/skills',cp.skills[0].nativeName,'SKILL.md'),'utf8'),mcpText=readFileSync(a.packages[0].skills[0].projectionPath,'utf8');expect(cliText).toContain('willyou-app mail draft list');expect(cliText).not.toContain('smartdd_mail_draft_list_v2');expect(mcpText).toContain('smartdd_mail_draft_list_v2');expect(mcpText).not.toContain('willyou-app mail draft list');
  const cl=seen.find(s=>s.request.runId===cp.runId)!,al=seen.find(s=>s.request.runId===ap.runId)!;expect(cl).toBeDefined();expect(al).toBeDefined();expect(cl.request.cliSandbox).toBeDefined();expect(al.request.cliSandbox).toBeUndefined();expect(cl.request.applicationSkillDelivery).toBeDefined();
  observations.push({codex:{source:c.packages[0].skills[0].contentHash,entry:cp.applications[0],allowed:cp.allowed,skillHash:digest(cliText)},claude:{source:a.packages[0].skills[0].contentHash,entry:ap.applications[0],allowed:ap.allowed,skillHash:digest(mcpText)}});
 });
 it('explicitly rejects unsupported native versions and unsupported Claude CLI delivery without mutating the shared SOP or target scope',async()=>{
  await selectMail();const seen=observePlans(),codex=await create(codexId),claude=await create(claudeId);const sources=[await managed.sessions.get(codex.task.id),await managed.sessions.get(claude.task.id)];
  for(const observed of seen){const input=observed.request,hash=input.snapshot.adapterBinding.hash,before=structuredClone(input),pack=input.snapshot.packages[0],bytes=pack.skills.map(s=>digest(readFileSync(s.projectionPath)));
   expect(()=>support.adapters.plan(hash,{...input,cliVersion:'99.0.0'})).toThrow(expect.objectContaining({code:'AGENT_ADAPTER_UNSUPPORTED'}));
   if(input.snapshot.runner==='claude-code')expect(()=>support.adapters.plan(hash,{...input,cliSandbox:{endpoint:'/private/tmp/wy-cli-t16-unsupported',kind:'inherit',parent:':read-only',networkProxy:true,enableNetwork:true,existingNames:[],source:'synthetic-negative',digest:'a'.repeat(64)},applicationSkillDelivery:{planHash:'a'.repeat(64),skills:[]}})).toThrow(expect.objectContaining({code:'AGENT_ADAPTER_UNSUPPORTED'}));
   expect(input).toEqual(before);expect(pack.skills.map(s=>digest(readFileSync(s.projectionPath)))).toEqual(bytes);observations.push({runner:input.snapshot.runner,unsupportedVersionCode:'AGENT_ADAPTER_UNSUPPORTED',unsupportedCli:input.snapshot.runner==='claude-code'?'AGENT_ADAPTER_UNSUPPORTED':'not requested',sourceHashes:bytes,project:input.snapshot.projectId});
  }
  expect(await managed.sessions.get(codex.task.id)).toEqual(sources[0]);expect(await managed.sessions.get(claude.task.id)).toEqual(sources[1]);
 });
});
