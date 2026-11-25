import {describe,it,expect} from 'vitest';
import Database from 'better-sqlite3';
import {mkdtempSync,mkdirSync,realpathSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';
import {runBundledMigrations} from '../../db/migrations';
import {AgentTaskService,boundedEvent,type ResolvedLaunch} from './agent-task-service';
import {AgentStore,type StoredEvent} from './agent-store';
import {AgentRunService} from './agent-run-service';
import {DRIVERS} from './registry';
import {MacProcessIdentityReader} from '../applications/process-identity';
import {resolveProfileLaunch} from './profile-launch';
import {materializeAgentPlan} from '../ai/agent-launch-files';
import {evaluateCapabilities,type DriverId} from './capabilities';
import {providerModelOptions} from '@shared/agent-model-choice';
import type {ProviderView,CodeAgentTool,RunConfigView} from '@shared/ai-agents';
import {startFixture} from './m16-model-fixture';

const suiteRoot=process.env.M16_E03_E05_ROOT??'';
if(!suiteRoot.startsWith('/private/tmp/willyou-m16-E03E05.')||!existsSync(suiteRoot+'/evidence'))throw Error('Private M16 E03E05 root required');
const nodeBin=process.env.M16_NODE_BIN??'';
const helpers=new MacProcessIdentityReader(join(suiteRoot,'runtime','willyou-process-identity'));
const cliPaths={codex:process.env.M16_CODEX,claude:process.env.M16_CLAUDE,antigravity:process.env.M16_AGY};
const all={codex:'codex-app-server',claude:'claude-sdk',antigravity:'antigravity-acp'} as const;
type Kind=keyof typeof all;
const kinds=Object.keys(all) as Kind[];
const phase=process.env.M16_SELECTION??kinds.join(',');
function digest(path:string){return createHash('sha256').update(readFileSync(path)).digest('hex');}
async function until(fn:()=>boolean,label:string,ms=45000){const until=Date.now()+ms;while(Date.now()<until){if(fn())return;await sleep(50);}throw new Error('timed out '+label);}
function rootChild(path:string,root:string){expect(path.startsWith(root+'/')).toBe(true);}
function sourcePolicy(current:{driverId:string;profileId:string;providerId:string|null;cwd:string;tier:string;archivedAt?:unknown;status?:string}|null,expected:{driverId:string;profileId:string;providerId:string|null;cwd:string;tier:string}) {
  if (!current||current.archivedAt)return 'unavailable';
  if (current.status==='working'||current.status==='waiting')return 'skip-busy';
  return (['driverId','profileId','providerId','cwd','tier'] as const).some(k=>expected[k]!==current[k])?'reconfirm':'reuse';
}

async function scenario(kind:Kind){
  const driverId:DriverId=all[kind];const names=kind==='antigravity'?['gemini-4-carbon','gemini-4-argon']:[`m16-${kind}-one`,`m16-${kind}-two`];
  const root=realpathSync(mkdtempSync(join(suiteRoot,'runtime',kind+'-'))), home=join(root,'home'),cwd=join(root,'work'),userData=join(root,'data'),temp=join(root,'tmp');
  for(const p of [home,cwd,userData,temp])mkdirSync(p,{mode:0o700});
  const result:any={kind,driverId,layer:'Frozen production main-process task service + actual native CLI + synthetic loopback protocol; no UI, scheduler, or real model',root,source:'a0acddb3a2325c6bf732adaa7e954ce4d767a2c3',assertions:[],turns:[],events:[],live:[],launches:[],policy:[]};
  const output=join(suiteRoot,'evidence',`${kind}-${root.split('/').at(-1)}.json`);
  const save=()=>writeFileSync(output,JSON.stringify(result,null,2)+'\n',{mode:0o600});
  const check=(name:string,value:unknown=true)=>{result.assertions.push({name,value});save();};
  const fixture=await startFixture();
  const baseEnv={HOME:home,USERPROFILE:home,ZDOTDIR:home,TMPDIR:temp,PATH:[nodeBin,'/usr/bin','/bin','/usr/sbin','/sbin'].join(':'),SHELL:'/bin/zsh',USER:'m16-fixture',LOGNAME:'m16-fixture',
    XDG_CONFIG_HOME:join(home,'.config'),XDG_DATA_HOME:join(home,'.local','share'),XDG_CACHE_HOME:join(home,'.cache'),XDG_STATE_HOME:join(home,'.local','state'),CLOUDSDK_CONFIG:join(home,'.config','gcloud'),
    HTTP_PROXY:fixture.origin,HTTPS_PROXY:fixture.origin,ALL_PROXY:fixture.origin,http_proxy:fixture.origin,https_proxy:fixture.origin,all_proxy:fixture.origin,NO_PROXY:'127.0.0.1,localhost',no_proxy:'127.0.0.1,localhost',
    DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',CLAUDE_CODE_DISABLE_OFFICIAL_MARKETPLACE_AUTOINSTALL:'1',DISABLE_TELEMETRY:'1',DO_NOT_TRACK:'1',BROWSER:'/usr/bin/false'};
  const db=new Database(join(userData,'agent.sqlite'));db.pragma('foreign_keys=ON');runBundledMigrations(db);
  const store=new AgentStore(db);
  const runs=new AgentRunService({store,drivers:DRIVERS,processes:helpers,host:{instanceId:randomUUID(),pid:process.pid,startedAt:helpers.read(process.pid)?.startedAt??null}});
  let service:AgentTaskService|undefined;
  const observed:StoredEvent[]=[];let humanEvidence=0;
  store.subscribe(e=>{observed.push(boundedEvent(e));});
  const processIdentities=new Map<number,{pid:number;startedAt:string}>();
  runs.onLive(({runId,event})=>{if(event.type==='process'){const id=helpers.read(event.pid);if(id)processIdentities.set(event.pid,id);result.live.push({runId,type:event.type,pid:event.pid,identityVerified:!!id});}else if(event.type==='exit')result.live.push({runId,type:event.type,code:event.code,signal:event.signal});else if(['turn.started','turn.completed','session'].includes(event.type))result.live.push({runId,type:event.type,...(event.type==='session'?{nativeId:event.nativeId}:event.type==='turn.started'?{nativeTurnId:event.nativeTurnId}:event.type==='turn.completed'?{status:event.status,nativeTurnId:event.nativeTurnId}:{})});});
  try{
    const executable=realpathSync(cliPaths[kind]??'');expect(executable.startsWith('/Users/liubu/.local/')).toBe(true);
    const raw=execFileSync(executable,['--version'],{cwd,env:baseEnv,encoding:'utf8',timeout:15000}).trim();
    const version=raw.match(/\b\d+\.\d+\.\d+\b/)?.[0];expect(version).toBeTruthy();
    const capabilities=evaluateCapabilities(driverId,version!);expect(capabilities.state).not.toBe('unsupported');
    result.cli={executable,version,sha256:digest(executable),capabilityState:capabilities.state,capabilities:capabilities.capabilities};
    const provider:ProviderView={id:'fixture-provider-'+kind,name:'Local '+kind,preset:null,identityRevision:1,endpoints:kind==='codex'?{responses:fixture.origin+'/v1'}:kind==='claude'?{anthropic:fixture.origin}:{gemini:fixture.origin},authType:'bearer',hasKey:true,models:names.map(id=>({id,name:id,contextWindow:null,offline:false,availability:{codex:'available',claude:'available',antigravity:'available'},codex:{reasoningLevels:['low','medium','high'],defaultReasoning:'medium',inputModalities:['text'],supportVerbosity:false},claude:{reasoningLevels:['low','medium','high'],defaultReasoning:'medium'},antigravity:{reasoningLevels:['low','medium','high'],defaultReasoning:'low'}})),recommended:{},refreshedAt:null};
    const tool:CodeAgentTool={id:'fixture-tool-'+kind,kind,installed:true,executable,customPath:executable,version:version!,login:'none'};
    const profile:RunConfigView={id:'fixture-profile-'+kind,name:'Local '+kind,toolId:tool.id,kind,source:'provider',providerId:provider.id,models:names,defaultModel:names[0],homeVisible:true,isDefault:true,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null};
    const profilePlan=(profileId:string,work:string,runId:string,model?:string)=>{
      if(profileId!==profile.id)throw Error('Unknown isolated profile');
      rootChild(work,root);
      return resolveProfileLaunch({config:profile,tool,provider,cwd:work,userData,runId,baseEnv,key:'PUBLIC_M16_LOCAL_FIXTURE_KEY',model,carryExtensions:false});
    };
    const launch=async(i:{profileId:string;cwd:string;runId:string;model?:string}):Promise<ResolvedLaunch>=>{
      const p=profilePlan(i.profileId,i.cwd,i.runId,i.model);
      rootChild(p.stateRoot,root);rootChild(p.env.HOME,root);
      expect(p.env.HTTP_PROXY).toBe(fixture.origin);expect(p.compatibility.extensions).toBe(false);
      materializeAgentPlan(p.plan,userData,i.cwd);
      // Prevent discovery of non-business local services; native protocol still performs the real handshake.
      const extraArgs=kind==='codex'?[...p.extraArgs,'--disable','apps','-c','web_search="disabled"']:p.extraArgs;
      result.launches.push({driverId,model:p.model,profileId:i.profileId,cwd:i.cwd,stateRoot:p.stateRoot,envHome:p.env.HOME,compatibility:{source:p.compatibility.source,providerId:p.compatibility.providerId,extensions:p.compatibility.extensions},tier:'selected per real task',argumentsHash:createHash('sha256').update(JSON.stringify(extraArgs)).digest('hex')});
      return {driverId,model:p.model,stateRoot:p.stateRoot,env:p.env,executable:{path:p.command,version:version!},compatibility:p.compatibility,extraArgs,settingSources:p.settingSources,capabilities:capabilities.capabilities};
    };
    service=new AgentTaskService({store,runs,resolveLaunch:launch,profileDriver:id=>{if(id!==profile.id)throw Error('Unknown fixture profile');return driverId;},profileModelSettings:id=>({defaultModel:profile.defaultModel,providerBacked:true,options:providerModelOptions(provider,profile)}),userData});
    service.attachHumanRecorder(()=>humanEvidence++);
    const tasks=service;
    const create=(id:string)=>tasks.create({clientTaskId:id,projectId:null,dirId:null,cwd,title:'Synthetic M16 '+kind,profileId:profile.id,tier:'ask',model:names[0],effort:'low',carryExtensions:false});
    const a=create(randomUUID());const again=create(a.taskId);
    expect(again.taskId).toBe(a.taskId);expect(tasks.snapshot(a.taskId).selection).toMatchObject({driverId,profileId:profile.id,tier:'ask',model:names[0],effort:'low',carryExtensions:false});
    expect(observed.filter(e=>e.taskId===a.taskId&&e.type==='task.created')).toHaveLength(1);
    expect(()=>tasks.create({clientTaskId:a.taskId,projectId:null,dirId:null,cwd:join(cwd,'other'),title:'Conflicting synthetic task',profileId:profile.id,tier:'ask'})).toThrow();
    check('E03 stable create ID and duplicate no second task');
    const marker=(round:number,part:string)=>`WY_M16_${kind.toUpperCase()}_${round}_${part}`;
    const taskId=a.taskId;
    const identity=(id:string)=>{const s=tasks.snapshot(id);return {driverId:s.selection.driverId,profileId:s.selection.profileId,providerId:profile.providerId,cwd:s.cwd,tier:s.selection.tier,archivedAt:s.archivedAt,status:s.status};};
    const frozen=identity(taskId);
    const firstInput=marker(1,'FIRST'),hold=fixture.hold(firstInput);
    const input={clientInputId:randomUUID(),text:`Reply with exactly the identifier ${firstInput}. No tools or files.`,expectedSelectionRevision:tasks.snapshot(taskId).selectionRevision};
    const receipt=await tasks.submit(taskId,input);expect(receipt.status).toBe('accepted');
    const dupe=await tasks.submit(taskId,input);expect(dupe.turnId).toBe(receipt.turnId);expect(dupe.duplicate).toBe(true);
    await Promise.race([hold.seen,sleep(45000).then(()=>{throw Error('first native request did not reach loopback')} )]);
    expect(tasks.status(taskId)).toBe('working');result.policy.push({name:'busy actual native turn',decision:sourcePolicy(identity(taskId),frozen)});
    expect(sourcePolicy(identity(taskId),frozen)).toBe('skip-busy');
    const competing=tasks.enqueueHost(taskId,randomUUID(),'M16 benign queued conflict witness','system');
    expect(competing.turn.status).toBe('accepted');expect(store.queuedTurns(taskId).some(t=>t.turn_id===competing.turn.turn_id)).toBe(true);
    tasks.cancelQueued(taskId,competing.turn.turn_id);expect(store.turn(competing.turn.turn_id)?.status).toBe('canceled');
    check('E05 existing host entry queues while busy; scheduler requires dedicated atomic claim/skip', {stateAtAttempt:'working',witnessTurn:competing.turn.turn_id,cancelledBeforeDispatch:true});
    hold.release();
    async function completed(id:string,turnId:string,expectedMarker:string,sourceKind:string){
      await until(()=>!['accepted','dispatching','started'].includes(store.turn(turnId)?.status??'absent'),'turn '+turnId);
      const turn=store.turn(turnId)!;
      const output=store.items(id,{limit:200}).filter(x=>x.turnId===turnId&&x.type==='assistant_message').map(x=>x.payload.text).join('\n');
      expect(turn.status).toBe('completed');expect(output).toContain(expectedMarker+'_ANSWER');expect(turn.source_kind).toBe(sourceKind);
      await until(()=>tasks.status(id)==='completed'&&!tasks.isDispatching(id),'idle after actual terminal turn');
      const run=runs.runForTask(id)!;expect(run).toBeTruthy();const binding=store.binding(run.bindingId)!;expect(binding.native_id).toBeTruthy();expect(binding.native_confirmed_at).toBeTruthy();
      const lifecycle=observed.filter(e=>e.taskId===id&&(e.payload as any)?.turnId===turnId).map(e=>e.type);
      expect(lifecycle).toContain('turn.accepted');expect(lifecycle).toContain('turn.started');expect(lifecycle).toContain('turn.ended');
      result.turns.push({taskId:id,turnId,clientInputId:turn.client_input_id,sourceKind:turn.source_kind,status:turn.status,nativeTurnId:turn.native_turn_id,runId:run.runId,bindingId:run.bindingId,nativeId:binding.native_id,generation:run.generation,model:run.appliedModel??run.model,effort:run.appliedEffort,outputMarker:expectedMarker+'_ANSWER',events:lifecycle});save();
      return {run,binding};
    }
    const first=await completed(taskId,receipt.turnId,firstInput,'user');
    const firstModel=fixture.trace.filter(x=>x.marker===firstInput&&!x.auxiliary);expect(firstModel.length).toBeGreaterThan(0);expect(firstModel.every(x=>x.model===names[0])).toBe(true);
    check('E03 native completion, durable accepted/started/ended and duplicate input receipt');
    await runs.close(first.run.runId);await until(()=>!runs.runForTask(taskId)&&!runs.closingForTask(taskId),'actual native run closed');
    const selection=tasks.snapshot(taskId);const revision=selection.selectionRevision;
    const changed=tasks.setSelection(taskId,{model:names[1],effort:'high'},revision);expect(changed.ok).toBe(true);
    const after=identity(taskId);expect(sourcePolicy(after,frozen)).toBe('reuse');
    await expect(tasks.submit(taskId,{clientInputId:randomUUID(),text:'Synthetic stale choice, no dispatched task',expectedSelectionRevision:revision})).rejects.toThrow();
    result.policy.push({name:'actual same-profile model/effort change',decision:sourcePolicy(after,frozen),selectionRevision:tasks.snapshot(taskId).selectionRevision,selection:tasks.snapshot(taskId).selection});
    const continueMarker=marker(1,'CONTINUE');const continuationInputId=randomUUID();
    const second=tasks.enqueueHost(taskId,continuationInputId,`Reply with ${continueMarker}. No tools or files.`, 'system');
    expect(second.duplicate).toBe(false);expect(tasks.enqueueHost(taskId,continuationInputId,'same synthetic continuation','system').turn.turn_id).toBe(second.turn.turn_id);
    const resumed=await completed(taskId,second.turn.turn_id,continueMarker,'system');
    expect(resumed.binding.binding_id).toBe(first.binding.binding_id);expect(resumed.binding.native_id).toBe(first.binding.native_id);expect(resumed.run.generation).toBe(first.run.generation+1);
    const secondRequests=fixture.trace.filter(x=>x.marker===continueMarker&&!x.auxiliary);expect(secondRequests.length).toBeGreaterThan(0);expect(secondRequests.every(x=>x.model===names[1])).toBe(true);expect(secondRequests.some(x=>x.markers.includes(firstInput)&&x.earlierAnswer)).toBe(true);
    check('E05 actual persisted native session resumes same binding, generation advances, old response reaches model fixture, new model used');
    check('E03 synthetic host source stays system and duplicate ID deduplicated across same task');
    await runs.close(resumed.run.runId);await until(()=>!runs.runForTask(taskId)&&!runs.closingForTask(taskId),'second native run closed');
    const b=create(randomUUID());const independentMarker=marker(2,'INDEPENDENT');
    const fresh=tasks.enqueueHost(b.taskId,randomUUID(),`Reply with ${independentMarker}. No tools or files.`, 'system');
    const freshRun=await completed(b.taskId,fresh.turn.turn_id,independentMarker,'system');
    expect(freshRun.binding.native_id).not.toBe(first.binding.native_id);expect(freshRun.binding.binding_id).not.toBe(first.binding.binding_id);
    const freshRequests=fixture.trace.filter(x=>x.marker===independentMarker&&!x.auxiliary);expect(freshRequests.length).toBeGreaterThan(0);expect(freshRequests.every(x=>!x.markers.includes(firstInput)&&!x.markers.includes(continueMarker)&&x.model===names[0])).toBe(true);
    check('E05 same cwd/profile new task has different native identity and no prior chat input');
    // E05 design policy, evaluated against real snapshot identities. Provider and directory changes are fixture variants only; production F16 gate is not implemented.
    const stable=identity(taskId);
    for(const [name,variant]of Object.entries({driver:{...stable,driverId:'different-driver'},profile:{...stable,profileId:'different-profile'},provider:{...stable,providerId:'different-provider'},cwd:{...stable,cwd:join(root,'other-directory')}})){
      expect(sourcePolicy(variant,frozen)).toBe('reconfirm');result.policy.push({name,decision:'reconfirm',evidence:'isolated proposed comparison using actual snapshot fields'});
    }
    const permission=tasks.setSelection(taskId,{tier:'full'},tasks.snapshot(taskId).selectionRevision);expect(permission.ok).toBe(true);expect(sourcePolicy(identity(taskId),frozen)).toBe('reconfirm');
    result.policy.push({name:'real task permission selection changed, no turn dispatched',decision:'reconfirm'});
    await tasks.archive(taskId);expect(sourcePolicy(identity(taskId),frozen)).toBe('unavailable');expect(()=>tasks.enqueueHost(taskId,randomUUID(),'Archived witness','system')).toThrow();
    expect(()=>tasks.enqueueHost(randomUUID(),randomUUID(),'Missing task witness','system')).toThrow();
    expect(humanEvidence).toBe(0);expect(fixture.failures).toEqual([]);
    check('E05 archived/missing bound task rejected by actual host enqueue; proposed policy re-confirm on changed permission and target identity');
    check('E03 no human source evidence granted to programmatic submit or system enqueue');
    // Verify same persisted event stream the actual service exposes to subscribers.
    for(const id of [taskId,b.taskId]){const persisted=store.events(id,0,1000);expect(persisted.map(e=>[e.seq,e.type])).toEqual(observed.filter(e=>e.taskId===id).map(e=>[e.seq,e.type]));}
    check('E03 subscriber event sequence equals durable events');
    result.status='passed';
  }catch(error){result.status='failed';result.error=String(error instanceof Error?error.stack:error);throw error;}
  finally{
    await service?.closePrewarms();await runs.closeAll();
    await fixture.close();
    result.trace=fixture.trace;result.denied=fixture.denied;result.fixtureFailures=fixture.failures;
    result.events=observed.map(e=>({taskId:e.taskId,type:e.type,seq:e.seq,...(e.payload&&typeof e.payload==='object'?Object.fromEntries(Object.entries(e.payload).filter(([k])=>['turnId','sourceKind','status','runId','generation','nativeTurnId'].includes(k))):{})}));
    result.runRows=db.prepare('SELECT task_id,run_id,binding_id,generation,state,pid,error_code FROM capability_runs ORDER BY rowid').all();
    result.cleanup=[...processIdentities.values()].map(identity=>({pid:identity.pid,state:helpers.state(identity)}));
    result.providerFixtureOnly=true;result.networkRoute='All native configured model endpoints and proxy are local loopback; proxy denies absolute requests and CONNECT.';result.cliSha256Unchanged=result.cli?digest(result.cli.executable)===result.cli.sha256:null;
    db.close();save();
  }
}

describe('M16 F16 E03–E05 pre-development service experiments',()=>{
  for(const kind of kinds) it.skipIf(!phase.split(',').includes(kind))(`${kind}: real task and driver, synthetic loopback`,()=>scenario(kind),180000);
});

it.skipIf(!phase.split(',').includes('binding'))('E05 actual profile switching and launch identity changes; proposed scheduler policy',async()=>{
  const root=realpathSync(mkdtempSync(join(suiteRoot,'runtime','binding-'))),home=join(root,'home'),userData=join(root,'user-data'),cwd=join(root,'work'),other=join(root,'other');
  for(const path of [home,userData,cwd,other])mkdirSync(path,{mode:0o700});
  const db=new Database(join(userData,'agent.sqlite'));db.pragma('foreign_keys=ON');runBundledMigrations(db);
  const store=new AgentStore(db),runs=new AgentRunService({store,drivers:DRIVERS,processes:helpers,host:{instanceId:randomUUID(),pid:process.pid,startedAt:helpers.read(process.pid)?.startedAt??null}});
  const fixture=await startFixture();const baseEnv={HOME:home,PATH:[nodeBin,'/usr/bin','/bin'].join(':'),HTTP_PROXY:fixture.origin,HTTPS_PROXY:fixture.origin,ALL_PROXY:fixture.origin,NO_PROXY:'127.0.0.1,localhost'};
  const rows:any[]=[];const events:StoredEvent[]=[];store.subscribe(e=>events.push(boundedEvent(e)));
  const profileOf=(kind:Kind,id:string,providerId:string):RunConfigView=>({id,name:'Synthetic '+kind,toolId:'fixture-'+kind,kind,source:'provider',providerId,models:[kind==='antigravity'?'gemini-4-carbon':`m16-${kind}-one`],defaultModel:kind==='antigravity'?'gemini-4-carbon':`m16-${kind}-one`,homeVisible:true,isDefault:false,loggedOut:false,nameCustomized:true,order:0,available:true,legacyReason:null});
  const first=profileOf('codex','fixture-codex','P1'),second=profileOf('claude','fixture-claude','P1'),third=profileOf('claude','fixture-claude-other','P2');
  const configs=new Map([first,second,third].map(p=>[p.id,p]));
  const tasks=new AgentTaskService({store,runs,profileDriver:id=>all[configs.get(id)!.kind as Kind],resolveLaunch:async()=>{throw Error('No native task is authorized by this binding-only proposal');},userData});
  const snapshot=(taskId:string)=>{const s=tasks.snapshot(taskId);return {taskId,driverId:s.selection.driverId,profileId:s.selection.profileId,providerId:configs.get(s.selection.profileId)!.providerId,cwd:s.cwd,tier:s.selection.tier,status:s.status,archivedAt:s.archivedAt,revision:s.selectionRevision};};
  let error:string|undefined;
  try{
    const {taskId}=tasks.create({clientTaskId:randomUUID(),projectId:null,dirId:null,cwd,title:'M16 binding policy experiment',profileId:first.id,model:first.defaultModel!,tier:'ask'});
    const before=snapshot(taskId);
    const switch1=await tasks.switchProfile(taskId,second.id,before.revision,second.defaultModel);expect(switch1.ok).toBe(true);
    await until(()=>!tasks.snapshot(taskId).switching,'profile switch to Claude');
    const mid=snapshot(taskId);expect(mid.driverId).toBe('claude-sdk');expect(mid.providerId).toBe(before.providerId);expect(sourcePolicy(mid,before)).toBe('reconfirm');
    await expect(tasks.submit(taskId,{clientInputId:randomUUID(),text:'Old choice must not reach native model',expectedSelectionRevision:before.revision})).rejects.toThrow();
    rows.push({name:'real AgentTaskService cross-agent UI command contract; stale input rejected',before,after:mid,decision:sourcePolicy(mid,before)});
    const switch2=await tasks.switchProfile(taskId,third.id,mid.revision,third.defaultModel);expect(switch2.ok).toBe(true);
    await until(()=>!tasks.snapshot(taskId).switching,'profile switch to other provider');
    const end=snapshot(taskId);expect(end.driverId).toBe(mid.driverId);expect(end.providerId).not.toBe(mid.providerId);expect(sourcePolicy(end,mid)).toBe('reconfirm');
    await expect(tasks.submit(taskId,{clientInputId:randomUUID(),text:'Old provider choice must not reach native model',expectedSelectionRevision:mid.revision})).rejects.toThrow();
    rows.push({name:'real AgentTaskService same-agent alternate-provider profile switch; stale input rejected',before:mid,after:end,decision:sourcePolicy(end,mid)});
    const tool:CodeAgentTool={id:third.toolId,kind:'claude',version:'fixture-only',login:'none',installed:true,executable:cliPaths.claude!};
    const provider:ProviderView={id:third.providerId!,name:'Synthetic P2',preset:null,endpoints:{anthropic:fixture.origin},authType:'bearer',hasKey:true,identityRevision:1,models:[{id:third.defaultModel!,name:'fixture',contextWindow:null,offline:false,availability:{codex:'available',claude:'available'}}],recommended:{},refreshedAt:null};
    const resolve=(p:ProviderView,work:string,key:string)=>resolveProfileLaunch({config:third,tool,provider:p,key,cwd:work,userData,runId:randomUUID(),baseEnv,carryExtensions:false});
    const a=resolve(provider,cwd,'SYNTHETIC_A'),endpointChanged=resolve({...provider,endpoints:{anthropic:fixture.origin+'/another-local-fixture'},identityRevision:2},cwd,'SYNTHETIC_A'),keyChanged=resolve({...provider,identityRevision:2},cwd,'SYNTHETIC_B');
    expect(a.compatibility.providerId).toBe(endpointChanged.compatibility.providerId);expect(a.compatibility.identity).not.toBe(endpointChanged.compatibility.identity);expect(a.compatibility.identity).not.toBe(keyChanged.compatibility.identity);
    rows.push({name:'real resolveProfileLaunch compatibility derives endpoint/key identity (same Provider ID)',sameProvider:true,endpointIdentityChanged:true,credentialIdentityChanged:true,needReconfirm:true,scope:'launch resolution only; no runtime credential mutation or external model'});
    const otherPath=resolve(provider,other,'SYNTHETIC_A');
    expect(a.stateRoot).toBe(otherPath.stateRoot);expect(a.compatibility.identity).toBe(otherPath.compatibility.identity);
    const current={...end,cwd:realpathSync(other)};expect(sourcePolicy(current,end)).toBe('reconfirm');
    rows.push({name:'distinct physical working directory, same profile/provider identity; must include cwd as separate binding dimension',beforeCwd:end.cwd,afterCwd:current.cwd,decision:sourcePolicy(current,end),scope:'two real temp directories, proposed scheduler comparison; no task migration'});
    expect(fixture.trace).toEqual([]);expect(store.turns(taskId)).toEqual([]);
  }catch(e){error=String(e instanceof Error?e.stack:e);throw e;}
  finally{await tasks.closePrewarms();await runs.closeAll();await fixture.close();db.close();writeFileSync(join(suiteRoot,'evidence',`binding-${root.split('/').at(-1)}.json`),JSON.stringify({status:error?'failed':'passed',error,source:'a0acddb3a2325c6bf732adaa7e954ce4d767a2c3',root,rows,events:events.map(e=>({taskId:e.taskId,type:e.type,seq:e.seq})),networkRequests:fixture.trace.length,proxyDenied:fixture.denied,layer:'real service selection commands and production launch resolver plus experimental scheduler decision; no model/native task sent'},null,2)+'\n',{mode:0o600});}
},30000);
