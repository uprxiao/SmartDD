import {SkillObservationMonitor} from './skill-observation-monitor';
import {BridgeSupervisor} from './bridge-supervisor';
import {nativeCapabilityPreparation} from './native-preparation-diagnostics';
import {nativeCapabilityConflicts} from './native-application-conflicts';
import {assertNoPendingApplicationSwitch} from './application-run-policy';
import type {ManagedCapabilityRestriction} from './launch-restriction';
import { mkdirSync, writeFileSync,readFileSync } from 'node:fs';
import { delimiter,dirname, join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { applicationMcpServerName, type CapabilitySessionSnapshot } from '@shared/application-session';
import type { RuntimeSnapshot } from '@shared/capabilities';
import { CapabilityService, MCP_CAPABILITY, type PreparedRuntime } from '../capabilities/capability-service';
import { projectCapabilityEnabled, type ProjectCapabilitySetting } from '../projects/project-capability-setting';
import type { TaskCapabilityLaunch, TaskCapabilityLauncher } from '../tasks/capability-lifecycle';
import type { AgentSupportService } from './agent-support-service';
import type { ApplicationService } from './application-service';
import type { ResourceRecord } from './resource-store';
import { CapabilitySessionRegistry, selectSessionApplications, canonicalFuturePath, type StoredCapabilitySession } from './session-registry';
import { CapabilityRunRegistry, type RunBindingRevision, type OwnedCapabilityRun } from './run-registry';
import { ApplicationAdapterRegistry } from './application-adapter-registry';
import { ApplicationToolService } from './tool-service';
import { PrivateApplicationBroker } from './private-broker';
import {ApplicationCliGateway} from './cli-gateway';
import {CurrentApplicationAuthorization} from './current-authorization';
import {SkillLibraryService} from './skill-library-service';
import {cleanupPreLibraryCopies} from './legacy-copy-cleanup';
import {retirePreLibraryResources,type PreLibraryRetirement} from './retire-pre-library-resources';
import type {CodexCliSandboxPlan} from './codex-effective-sandbox';
import {createApplicationRunPlan,selectCapabilityEntry,type RunPlanAvailability} from './run-plan';
import { AgentBridgeProcesses } from './agent-bridge-processes';
import { MacProcessIdentityReader, type ProcessIdentityReader } from './process-identity';
import { MacUnixPeerIdentityReader, type UnixPeerIdentityReader } from './unix-peer-identity';
import type { NativeLaunchContext, TaskLaunchInput } from './native-launch-context';
import { canonicalJson, digest } from './manifest';
import {legacyRuntimeMetadata} from './legacy-task-evidence';
import {EmbeddedNodeRuntime} from './embedded-node-runtime';
import {builtinApplicationModules} from './modules';
/** Resource kinds only pre-R1.0 launches used (shared discovery, per-session projections, Claude plugin, M4 originals). */
const RETIRED_RESOURCE_KINDS:ReadonlySet<string>=new Set(['session-projection','claude-projection-source','claude-projection-archive','claude-delivery','agent-projection','legacy-agent-projection','legacy-static-plugin','legacy-plugin-source']);
interface ActiveLaunch {run:OwnedCapabilityRun;runtime?:PreparedRuntime;releasing?:Promise<void>}
export interface TaskCapabilityLauncherOptions {
  helper: string;
  cliPath?:string;
  inspectSandbox?:(input:TaskLaunchInput,native:NativeLaunchContext)=>Promise<CodexCliSandboxPlan>;
  stopPty(ptyId:string):void;
  processes?:ProcessIdentityReader;
  peers?:UnixPeerIdentityReader;
  inspectNative?:(input:TaskLaunchInput)=>Promise<NativeLaunchContext>;
  probeApplicationRuntime?:(signal:AbortSignal)=>Promise<boolean>;
  pollMs?:number;
  /** R16: HOME whose `.agents/skills` (and each Agent's link directory) holds the single WillYou Skill library. Omitted: no library delivery. */
  skillLibraryHome?:string;
  /** Packaged App only: also remove pre-R1.0 copies whose markers name no data directory (M4 copies, coordination root). */
  cleanupUnattributable?:boolean;
}
/** Production composition. Credentials, native PIDs and resource identities never come from RPC. */
export class ManagedTaskCapabilities implements TaskCapabilityLauncher {
  private readonly planningAgents=new Map<string,NativeLaunchContext>();
  private readonly planningCliPolicies=new Map<string,CodexCliSandboxPlan>();
  readonly cli?:ApplicationCliGateway;
  private cliReady=false;
  readonly sessions:CapabilitySessionRegistry;
  readonly runs:CapabilityRunRegistry;
  private readonly authorization:CurrentApplicationAuthorization;
  readonly bridges:AgentBridgeProcesses;
  readonly broker:PrivateApplicationBroker;
  readonly bridgeRecovery=new BridgeSupervisor();
  private readonly skillObservations=new SkillObservationMonitor(async(taskId,runId)=>{await this.applications.sessionDiagnostics.inspect(taskId,runId);});
  private readonly recoveryServices=new Map<string,string>();
  private readonly active=new Map<string,ActiveLaunch>();
  private readonly pending=new Set<Promise<TaskCapabilityLaunch>>();
  private readonly stopping=new Map<string,Promise<void>>();
  private readonly processes:ProcessIdentityReader;
  private readonly embeddedNode=new EmbeddedNodeRuntime();
  private readonly timer:ReturnType<typeof setInterval>;
  readonly recoveryWarnings:{homeId:string;code:string}[]=[];
  private readonly library?:SkillLibraryService;
  /** Last pre-R1.0 copy cleanup (diagnostics). */
  legacyCleanup:import('./legacy-copy-cleanup').LegacyCopyCleanup|null=null;
  /** Last retirement of pre-R1.0 resource records (diagnostics). */
  retirement:PreLibraryRetirement|null=null;
  private closed=false;private closing?:Promise<void>;private sweeping=false;
  private constructor(private readonly support:AgentSupportService,private readonly capabilities:CapabilityService,private readonly applications:ApplicationService,private readonly options:TaskCapabilityLauncherOptions){
    const store=support.store;this.processes=options.processes??new MacProcessIdentityReader(options.helper);
    this.sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:snapshot=>this.assertInitialSelection(snapshot),verifyExtraResource:(resource,snapshot)=>this.verifyResource(resource,snapshot)});
    this.authorization=new CurrentApplicationAuthorization(store,applications.builtin);
    if(options.skillLibraryHome)this.library=new SkillLibraryService(store,applications.builtin,{home:options.skillLibraryHome,targets:()=>support.adapters.deliveryAdapters.libraryTargets(),added:appId=>{const state=applications.selections.catalogState(appId as Parameters<typeof applications.selections.catalogState>[0]);return state.added&&state.enabled;},standardSkills:()=>(store.sqlite.prepare('SELECT skill_id AS skillId,hash FROM skill_versions WHERE active=1 ORDER BY skill_id').all() as {skillId:string;hash:string}[]).map(s=>({skillId:s.skillId,files:Object.fromEntries(Object.entries(support.legacy.verify(store.get('standard-skill:'+s.skillId+':'+s.hash))).map(([path,text])=>[path,Buffer.from(text,'utf8')]))}))});
    this.runs=new CapabilityRunRegistry(store,this.sessions,{processes:this.processes,currentAuthorization:context=>this.authorization.view(context),createPlan:(snapshot,snapshotHash,runId)=>{
      const selected={...selectSessionApplications(snapshot,snapshot.packages.map(p=>p.appId)),standardSkills:[]};
      const sources=selected.packages.map(p=>{const application=applications.builtin.retainedMetadata(p.packageHash);return{packageHash:p.packageHash,manifest:application.manifest,capabilities:builtinApplicationModules.capabilityViews(application.manifest)};});
      // R16: Skills come from the machine-wide library; a run plan carries no per-run Skill copies.
      return createApplicationRunPlan({runId,snapshotHash,snapshot:selected,applications:sources,skills:[],available:this.cliAvailability(snapshot.taskId),sandbox:this.planningCliPolicies.has(snapshot.taskId)?{source:this.planningCliPolicies.get(snapshot.taskId)!.source,digest:this.planningCliPolicies.get(snapshot.taskId)!.digest}:undefined,cliVersion:this.planningAgents.get(snapshot.taskId)?.version??'unverified'});
    },assertCurrent:snapshot=>{
      // Application enablement and current slots belong to each business call, not Agent liveness.
      const project=store.sqlite.prepare('SELECT archived_at FROM projects WHERE id=?').get(snapshot.projectId) as {archived_at:number|null}|undefined;
      if(!project||project.archived_at!==null)throw new ApplicationError('SCOPE_DENIED','项目已删除或归档，不能继续使用此运行');
    },revoke:runId=>{const recoveryService=this.recoveryServices.get(runId);if(recoveryService)this.bridgeRecovery.revoke(runId,recoveryService);this.broker?.revokeRun(runId);this.cli?.revokeRun(runId);this.bridges?.revokeRun(runId);const entry=this.active.get(runId);if(entry)this.options.stopPty(entry.run.ptyId);}});
    this.bridges=new AgentBridgeProcesses(this.runs,options.peers??new MacUnixPeerIdentityReader(options.helper),this.processes,{pollMs:options.pollMs});
    this.broker=new PrivateApplicationBroker(this.runs,new ApplicationToolService(store,this.runs,new ApplicationAdapterRegistry(store,applications.data)),{attachPeer:(socket,runId,bridge)=>this.bridges.attach(socket,runId,bridge),authenticated:(runId,bridgeId)=>applications.sessionDiagnostics.bridgeAuthenticated(runId,bridgeId),disconnected:(runId)=>this.bridgeDisconnected(runId),rejectedReplacement:(runId,bridgeId)=>this.bridges.revokeBridge(runId,bridgeId)});
    if(options.cliPath)try{this.cli=new ApplicationCliGateway(this.runs,new ApplicationToolService(store,this.runs,new ApplicationAdapterRegistry(store,applications.data),{entry:'cli'}),options.peers??new MacUnixPeerIdentityReader(options.helper),{executable:{path:canonicalFuturePath(options.cliPath),sha256:digest(readFileSync(options.cliPath))}});}catch{/* Missing CLI resources retain the approved read-only MCP fallback. */}
    applications.sessionDiagnostics.attach({deliveryAdapters:support.adapters.deliveryAdapters,channelConnected:id=>this.broker.hasAuthenticated(id),recoveryIssue:id=>{const server=this.recoveryServices.get(id);const result=server?this.bridgeRecovery.inspect(id,server)?.result:undefined;return result&&result.code!=='CONNECTED'?result.code:null;},verify:(resource,snapshot)=>this.verifyResource(resource,snapshot)});
    this.timer=setInterval(()=>{void this.sweep();},Math.max(20,options.pollMs??500));this.timer.unref();
  }
  static async open(support:AgentSupportService,capabilities:CapabilityService,applications:ApplicationService,options:TaskCapabilityLauncherOptions):Promise<ManagedTaskCapabilities>{
    const result=new ManagedTaskCapabilities(support,capabilities,applications,options);
    try{await result.runs.recover();
      if(options.skillLibraryHome)try{result.legacyCleanup=cleanupPreLibraryCopies({home:options.skillLibraryHome,storeId:support.store.storeId,unattributable:options.cleanupUnattributable===true});}catch(error){result.recoveryWarnings.push({homeId:'legacy-copy-cleanup',code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
      try{result.retirement=await retirePreLibraryResources(support.store);}catch(error){result.recoveryWarnings.push({homeId:'pre-library-retirement',code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
      result.syncSkillLibrary();await result.broker.start();if(result.cli)try{await result.cli.start();result.cliReady=true;}catch{await result.cli.close();}applications.attachRuns(result.runs);return result;}catch(error){await result.dispose();throw error;}
  }
  /** Converge the Skill library after startup and every application change; a failure never blocks tasks. */
  syncSkillLibrary():void{
    if(!this.library)return;
    try{this.library.sync();this.recoveryWarnings.splice(0,this.recoveryWarnings.length,...this.recoveryWarnings.filter(w=>w.homeId!=='skill-library'));}
    catch(error){if(!this.recoveryWarnings.some(w=>w.homeId==='skill-library'))this.recoveryWarnings.push({homeId:'skill-library',code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
  }
  skillLibraryConflicts(){return this.library?.conflicts()??[];}
  /**
   * R1.0 §3.5: applications enabled or upgraded since this library run started that its Agent sees only after a
   * resume (declared per Agent: in-session Skill reload, in-session MCP reload). Removals need no resume.
   */
  resumeAdvice(taskId:string):import('@shared/tasks').TaskResumeAdvice|null{
    for(const entry of this.active.values()){
      const record=this.runs.get(entry.run.runId);if(record.taskId!==taskId||record.state!=='active')continue;
      const context=this.runs.bridgePreparation(entry.run.runId),plan=context.plan;if(!plan)return null;
      if(this.support.adapters.get(context.snapshot.adapterBinding.hash).metadata.skillDelivery!=='library')return null;
      const library=this.support.adapters.deliveryAdapters.get(context.snapshot.runner).library,names:string[]=[];
      for(const app of this.selectedApps(context.snapshot.projectId)){
        if(plan.applications.some(a=>a.appId===app.appId&&a.packageHash===app.packageHash))continue;
        const manifest=this.applications.builtin.retainedMetadata(app.packageHash).manifest;
        const usesMcp=builtinApplicationModules.capabilityViews(manifest).some(c=>selectCapabilityEntry(c,{mcp:true,cli:plan.grades.cli}).entry==='mcp');
        if(!library.skillsReloadInSession||usesMcp&&!library.mcpReloadInSession)names.push(builtinApplicationModules.module(app.appId).presentation.displayName);
      }
      return names.length?{applications:names}:null;
    }
    return null;
  }
  private cliAvailability(taskId:string):RunPlanAvailability{const policy=this.planningCliPolicies.get(taskId);return{mcp:true,cli:this.cliReady&&policy?.available===true,reason:policy?.available?undefined:policy&&'reason'in policy?policy.reason:'cli-entry-unavailable'};}
  private async configureCli(input:TaskLaunchInput,native:NativeLaunchContext,snapshot:CapabilitySessionSnapshot){
    const delivery=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner);
    if(!this.cliReady||!delivery.entryDelivery('cli')||this.support.adapters.get(snapshot.adapterBinding.hash).metadata.cliEntry!=='supported')return;
    // §15.4: the CLI sandbox is delivered only for a version whose declared levels include L0.cli; undeclared versions fail closed.
    if(!this.support.adapters.effective(snapshot.adapterBinding.hash,native.version).levels.includes('L0.cli'))return;
    const inspect=this.options.inspectSandbox??delivery.effectiveSandbox;
    if(!inspect)return;
    this.planningCliPolicies.set(input.taskId,await inspect.call(delivery,input,native));
  }

  private bindings(projectId:string,appIds:readonly string[]):RunBindingRevision[]{return this.authorization.bindings(projectId,appIds);}

  private assertInitialSelection(snapshot:CapabilitySessionSnapshot):void{
    assertNoPendingApplicationSwitch(this.support.store,snapshot);
    const store=this.support.store,apps=this.selectedApps(snapshot.projectId);
    if(canonicalJson(apps)!==canonicalJson(snapshot.packages.map(p=>({appId:p.appId,packageHash:p.packageHash}))))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目应用或默认版本已变化');
    const bindings=this.bindings(snapshot.projectId,snapshot.packages.map(p=>p.appId));
    for(const app of snapshot.packages){const current=bindings.filter(b=>b.appId===app.appId&&b.connectionId).map(b=>({bindingId:`${snapshot.projectId}:${app.appId}:${b.slot}`,connectionId:b.connectionId!,identityRevision:b.identityRevision!}));if(canonicalJson(current)!==canonicalJson(app.bindings))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目连接选择已变化');}
    const settings=store.sqlite.prepare('SELECT id,project_id AS projectId,capability_id AS capabilityId,enabled FROM project_capabilities WHERE project_id=?').all(snapshot.projectId) as ProjectCapabilitySetting[];
    if(projectCapabilityEnabled(settings,snapshot.projectId,MCP_CAPABILITY)!==snapshot.mcp.some(m=>m.kind==='legacy-project-context'))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目上下文选择已变化');
  }
  /** Pre-R1.0 references stay recorded until adoption releases them, but no launch is backed by them any more. */
  private verifyResource(resource:ResourceRecord,snapshot:CapabilitySessionSnapshot):void{
    if(resource.kind==='agent-adapter')this.support.adapters.verifyReference(resource,snapshot);
    else if(RETIRED_RESOURCE_KINDS.has(resource.kind))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','R1.0 之前的投影资源不再用于启动');
    else this.support.legacy.verify(resource);
  }
  private selectedApps(projectId:string):{appId:string;packageHash:string}[]{return this.authorization.selectedApps(projectId);}

  /** Every version of an Agent uses the library; prefer the adapter that declares this version. */
  private libraryAdapter(runner:string,cliVersion:string|undefined){
    const candidates=this.support.status().adapters.filter(a=>a.agentId===runner&&this.support.adapters.get(a.hash).metadata.skillDelivery==='library');
    return candidates.find(a=>cliVersion!==undefined&&a.cliVersions.includes(cliVersion))??candidates[0];
  }
  prepare(input:TaskLaunchInput):Promise<TaskCapabilityLaunch>{const work=this.prepareOnce(input);this.pending.add(work);void work.finally(()=>{this.pending.delete(work);this.planningAgents.delete(input.taskId);this.planningCliPolicies.delete(input.taskId);}).catch(()=>{});return work;}
  private async prepareOnce(input:TaskLaunchInput):Promise<TaskCapabilityLaunch>{
    if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','任务能力准备已取消');
    let native:NativeLaunchContext|undefined,unavailable:string|undefined;
    try{const delivery=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner);native=await(this.options.inspectNative??delivery.inspectNative).call(delivery,input);}catch(error){if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;if(!(error instanceof ApplicationError)||error.code!=='AGENT_ADAPTER_UNSUPPORTED')throw error;unavailable=error.code;}
    if(native)this.planningAgents.set(input.taskId,native);
    return this.prepareCurrent(input,native,unavailable);
  }
  /** R1.0 production launch: the library when the Agent can use it, otherwise native only; never the shared discovery catalog. */
  private async prepareCurrent(input:TaskLaunchInput,native:NativeLaunchContext|undefined,unavailable:string|undefined):Promise<TaskCapabilityLaunch>{
    if(native){const library=await this.libraryLaunch(input,native);if(library)return this.prepareLibrary(input,native,library);}
    const runner=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner).id,code=unavailable??'AGENT_ADAPTER_UNSUPPORTED';
    if(input.previous?.sessionCapabilities){
      const pointer=input.previous.sessionCapabilities;if(pointer.taskId!==input.taskId)throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针不属于当前会话');
      const current=await this.sessions.get(input.taskId);
      if(current.snapshot.projectId!==input.projectId||current.pointer.snapshotHash!==pointer.snapshotHash)throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针与原会话快照不同');
      return this.prepareUnavailableSession(input,current,native,code);
    }
    if(input.newTask){
      const adapter=this.libraryAdapter(runner,native?.version);
      if(!adapter)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','本版本未准备此Agent适配资源');
      const current=await this.sessions.create(this.createLibrarySnapshot(input,native?.version??'unverified',adapter.hash),input.home);
      await this.sessions.addLegacyRuntimeReference(input.taskId,current.pointer.snapshotHash,this.capabilities.runtimeIdentity().hash);
      return this.prepareUnavailableSession(input,current,native,code);
    }
    // History without a session record (before M10): native only.
    if(input.previous&&!legacyRuntimeMetadata.safeParse(input.previous).success)throw new ApplicationError('SNAPSHOT_CORRUPT','原能力快照格式不支持，保留原记录并阻止受管恢复');
    const recorded=this.support.store.sqlite.prepare('SELECT schema_version,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(input.taskId) as {schema_version:number;legacy_status:string}|undefined;
    if(recorded&&(recorded.schema_version!==0||recorded.legacy_status!=='history-unknown'))throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针缺失或原历史已待核查，保留原登记且不降级重建');
    await this.sessions.holdUnknown({taskId:input.taskId,projectId:input.projectId,runner,stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,reason:'history-unknown'});
    return this.prepareNativeHistory(input,native,unavailable);
  }
  /** The library adapter that serves this launch: a resumed library session, or a new task on a declared Agent version. */
  private async libraryLaunch(input:TaskLaunchInput,native:NativeLaunchContext):Promise<{adapterHash:string;current?:StoredCapabilitySession}|undefined>{
    const runner=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner).id;
    if(input.previous?.sessionCapabilities){
      const pointer=input.previous.sessionCapabilities;if(pointer.taskId!==input.taskId)return undefined;
      const recorded=this.support.store.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(input.taskId) as {snapshot_json:string}|undefined;
      let hash:string|undefined;try{hash=JSON.parse(recorded?.snapshot_json??'null')?.adapterBinding?.hash;}catch{return undefined;}
      if(!hash)return undefined;let library:boolean;try{library=this.support.adapters.get(hash).metadata.skillDelivery==='library';}catch{return undefined;}
      if(!library)return this.adoptLibrarySession(input,native,runner);
      const current=await this.sessions.get(input.taskId);
      if(current.snapshot.projectId!==input.projectId)throw new ApplicationError('SNAPSHOT_CORRUPT','任务项目与原会话身份不符');
      if(current.pointer.snapshotHash!==pointer.snapshotHash)throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针与原会话快照不同');
      await this.sessions.verifyNativeIdentity(input.taskId,{runner,stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});
      return{adapterHash:hash,current};
    }
    if(!input.newTask)return undefined;
    const adapter=this.libraryAdapter(runner,native.version);
    return adapter?{adapterHash:adapter.hash}:undefined;
  }
  /** S4: a pre-R1.0 session becomes a library session on resume. Any failure keeps the original path so the task still starts. */
  private async adoptLibrarySession(input:TaskLaunchInput,native:NativeLaunchContext,runner:string):Promise<{adapterHash:string;current:StoredCapabilitySession}|undefined>{
    const adapter=this.libraryAdapter(runner,native.version);if(!adapter)return undefined;
    try{
      const pointer=input.previous!.sessionCapabilities!,old=await this.sessions.get(input.taskId);
      if(old.snapshot.projectId!==input.projectId||old.pointer.snapshotHash!==pointer.snapshotHash||old.retention!=='active')return undefined;
      await this.sessions.verifyNativeIdentity(input.taskId,{runner,stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});
      if((await this.sessions.references(input.taskId)).filter(r=>r.refKind==='legacy-runtime').length!==1)return undefined;
      // Nothing after the adoption may fail back to the old path: the stored pointer has already moved.
      return{adapterHash:adapter.hash,current:await this.sessions.adoptLibrary(input.taskId,old.pointer.snapshotHash,this.createLibrarySnapshot(input,native.version,adapter.hash))};
    }catch(error){
      if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;if(!(error instanceof ApplicationError))throw error;
      // Once adopted, the old path no longer matches the stored pointer: report instead of falling back.
      const now=this.support.store.sqlite.prepare('SELECT snapshot_json FROM capability_session_snapshots WHERE task_id=?').get(input.taskId) as {snapshot_json:string}|undefined;
      try{if(this.support.adapters.get(JSON.parse(now?.snapshot_json??'null')?.adapterBinding?.hash).metadata.skillDelivery==='library')throw error;}catch(checked){if(checked===error)throw error;}
      return undefined;
    }
  }
  /** Pinned bridge runtime shared by every registered application package. */
  private applicationRuntimeHash():string|null{
    for(const appId of builtinApplicationModules.appIds()){const active=this.applications.builtin.packages.active(appId);if(active)return this.applications.builtin.retainedMetadata(active.packageHash).manifest.runtime.hash;}
    return null;
  }
  /** Audit record of the session; what it may call is decided per call (R17), and Skills come from the library (R16). */
  private createLibrarySnapshot(input:TaskLaunchInput,agentVersion:string,adapterHash:string):CapabilitySessionSnapshot{
    const runner=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner).id,adapter=this.support.adapters.get(adapterHash).metadata;
    const apps=this.selectedApps(input.projectId),bindings=this.bindings(input.projectId,apps.map(a=>a.appId)),packages=apps.map(a=>this.authorization.packageSelection(input.projectId,a.packageHash,bindings,[]));
    const runtimeHash=packages[0]?.runtimeHash??this.applicationRuntimeHash(),appMcp=applicationMcpServerName(digest(input.taskId));
    if(new Set(packages.map(p=>p.runtimeHash)).size>1)throw new ApplicationError('HOST_INCOMPATIBLE','本次应用选择使用了不兼容的桥运行版本');
    const mcp:CapabilitySessionSnapshot['mcp']=runtimeHash?[{kind:'applications',serverName:appMcp,protocolMajor:1,runtimeHash}]:[];
    if(this.capabilities.enabled(input.projectId,MCP_CAPABILITY))mcp.push({kind:'legacy-project-context',serverName:'smartdd_project_'+digest(input.taskId).slice(0,12),protocolMajor:1,runtimeHash:this.capabilities.runtimeIdentity().hash});
    return{schema:3,taskId:input.taskId,projectId:input.projectId,createdAt:new Date().toISOString(),runner,adapterBinding:{id:runner,version:adapter.version,hash:adapterHash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(packages.flatMap(p=>Object.keys(p.toolContractMajors).map(name=>[name,'mcp__'+appMcp+'__'+name])))},native:{sessionId:input.sessionId,stateRoot:input.stateRoot,cwd:input.cwd},agentAtCreation:{version:agentVersion,adapterRevision:1},catalogGeneration:'library',packages,standardSkills:[],mcp,provenance:'created'};
  }
  private async prepareLibrary(input:TaskLaunchInput,native:NativeLaunchContext,selected:{adapterHash:string;current?:StoredCapabilitySession}):Promise<TaskCapabilityLaunch>{
    let current=selected.current;
    if(!current){
      current=await this.sessions.create(this.createLibrarySnapshot(input,native.version,selected.adapterHash),input.home);
      await this.sessions.addLegacyRuntimeReference(input.taskId,current.pointer.snapshotHash,this.capabilities.runtimeIdentity().hash);
    }
    const snapshot=current.snapshot,stored=current;
    // M10 rule kept in R1.0: while a stop-before-switch connection change is pending, no run of the project forks.
    const gate=()=>assertNoPendingApplicationSwitch(this.support.store,{projectId:input.projectId,packages:this.selectedApps(input.projectId)});gate();
    await this.configureCli(input,native,snapshot);
    if(this.support.adapters.versionSupport(snapshot.adapterBinding.hash,native.version)==='unsupported')return this.prepareUnavailableSession(input,stored,native,'AGENT_ADAPTER_UNSUPPORTED');
    const bridgeReady=!snapshot.mcp.some(m=>m.kind==='applications')||await(this.options.probeApplicationRuntime?.(input.signal)??this.embeddedNode.check(input.signal));
    const run=await this.runs.reserve({taskId:input.taskId,snapshotHash:stored.pointer.snapshotHash,bindings:[]}),entry:ActiveLaunch={run};this.active.set(run.runId,entry);
    try{
      const legacy=(await this.sessions.references(input.taskId)).filter(r=>r.refKind==='legacy-runtime');if(legacy.length!==1)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原启动资源身份缺失或重复');
      // A user MCP, Skill or native tool already holding one of our names keeps the user's entry; ours is not mounted.
      const facets=nativeCapabilityConflicts(snapshot,native,undefined,this.support.adapters.deliveryAdapters),appConflict=facets.applications.size>0;
      const projectMcp=snapshot.mcp.find(m=>m.kind==='legacy-project-context'),mcpName=projectMcp&&!facets.projectMcp&&this.capabilities.enabled(input.projectId,MCP_CAPABILITY)?projectMcp.serverName:null;
      await run.prepare();
      const runtime=this.capabilities.prepare({projectId:input.projectId,taskId:input.taskId,runner:input.profile.runner,cwd:input.cwd,home:input.home,profileArgs:input.profile.args,previous:input.previous,managed:{runId:run.runId,runtimeHash:legacy[0].refHash,mcpName}});entry.runtime=runtime;runtime.snapshot.sessionCapabilities=stored.pointer;
      const issues=[...(bridgeReady?[]:['HOST_INCOMPATIBLE']),...(appConflict||facets.projectMcp?['AGENT_CAPABILITY_NAME_CONFLICT']:[])];
      if(issues.length)runtime.snapshot.selfCheck={status:'failed',issues:[...new Set([...runtime.snapshot.selfCheck.issues,...issues])],at:Date.now()};
      const planned=this.runs.bridgePreparation(run.runId).plan;if(!planned)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','本次运行身份记录缺失');
      const mcp=snapshot.mcp.filter(m=>m.kind==='applications'?bridgeReady&&!appConflict:m.serverName===mcpName).map(m=>({kind:m.kind,serverName:m.serverName,command:m.kind==='applications'?process.execPath:'python3',args:m.kind==='applications'?[join(this.support.store.root,'runtime',m.runtimeHash,'mcp-bridge.cjs'),'--bootstrap',join(this.support.store.root,'pending-bootstrap.json')]:[join(this.support.store.root,'runtime',m.runtimeHash,'context_mcp.py'),join(this.support.store.root,'runs',input.projectId,input.taskId,run.runId,'context.json')],env:m.kind==='applications'?{ELECTRON_RUN_AS_NODE:'1'}:{} as Record<string,string>}));
      const policy=this.planningCliPolicies.get(input.taskId);let cliEnvironment:Readonly<Record<string,string>>|undefined,cliSandbox:NonNullable<import('@shared/agent-adapters').LibraryLoadRequest['cliSandbox']>|undefined;
      if(planned.grades.cli&&this.cli&&policy?.available){cliSandbox={endpoint:this.cli.endpoint,kind:policy.kind,parent:policy.parent,networkProxy:policy.networkProxy,enableNetwork:policy.enableNetwork,existingNames:policy.existingNames,source:policy.source,digest:policy.digest};cliEnvironment=this.cli.issue(run).environment;runtime.secretValues.push(cliEnvironment.WILLYOU_RUN_TOKEN);}
      const bridgeEntry=mcp.find(m=>m.kind==='applications');let bridge:Awaited<ReturnType<PrivateApplicationBroker['prepare']>>|undefined;
      if(bridgeEntry){bridge=await this.broker.prepare(run,bridgeEntry.serverName);bridgeEntry.args[2]=bridge.bootstrapPath;}
      // A plan the adapter still refuses (another collision, unsupported mechanism) leaves the ordinary Agent: native only.
      let plan:import('@shared/agent-adapters').AgentLoadPlan|undefined,planIssue:'AGENT_ADAPTER_UNSUPPORTED'|'AGENT_CAPABILITY_NAME_CONFLICT'|undefined;
      try{plan=this.support.adapters.planLibrary(snapshot.adapterBinding.hash,{snapshot,runId:run.runId,cliVersion:native.version,currentExecutable:process.execPath,native:{...snapshot.native,runner:snapshot.runner,home:input.home},inventory:native.inventory,planHash:planned.planHash,...(cliSandbox?{cliSandbox}:{}),mcp});}
      catch(error){if(error instanceof ApplicationError&&(error.code==='AGENT_ADAPTER_UNSUPPORTED'||error.code==='AGENT_CAPABILITY_NAME_CONFLICT'))planIssue=error.code;else throw error;}
      if(bridgeEntry&&plan)this.registerBridgeRecovery(run,bridgeEntry.serverName,snapshot.adapterBinding.hash,native.version);
      const configPaths:string[]=[],root=dirname(runtime.snapshot.manifestPath);
      for(const[name,text]of Object.entries(plan?.files??{})){mkdirSync(root,{recursive:true,mode:0o700});writeFileSync(join(root,name),text,{flag:'wx',mode:0o600});configPaths.push(join(root,name));}
      try{await this.applications.sessionDiagnostics.prepared({schema:2,capabilities:nativeCapabilityPreparation(snapshot,planIssue?{applications:[],standardPaths:[],mcpNames:[],issue:planIssue}:{applications:appConflict?[]:snapshot.packages.map(p=>p.appId),standardPaths:[],mcpNames:runtime.snapshot.mcp.map(m=>m.name).filter(name=>name===mcpName||name!==projectMcp?.serverName),facets,...(bridgeReady?{}:{applicationIssue:'HOST_INCOMPATIBLE'}),projectMcpEnabled:this.capabilities.enabled(input.projectId,MCP_CAPABILITY)}),runId:run.runId,selectionHash:stored.selectionHash,cliVersion:native.version,adapterHash:snapshot.adapterBinding.hash,state:planIssue?'unavailable':'prepared',issueCode:planIssue??null,manifestPath:runtime.snapshot.manifestPath,configPaths,preparedAt:new Date().toISOString()});}catch{/* Display evidence never grants capability or blocks the Agent. */}
      if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','任务能力准备已取消');
      try{this.applications.nativeMessages.register(run.runId,native.version,run.signal);}catch{/* Missing origin evidence grants nothing. */}
      let phase:'prepared'|'restricting'|'native-only'|'arming'='prepared',effective=true,prepared=runtime;
      const narrow=async(reason:string,cause?:ManagedCapabilityRestriction):Promise<TaskCapabilityLaunch>=>{
        if(phase!=='prepared'||this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','此启动不能再撤去应用注入');
        phase='restricting';this.broker.revokeRun(run.runId);this.cli?.revokeRun(run.runId);await bridge?.bridge.cancelBeforeLaunch();
        await this.runs.restrictToNative(run.runId,cause);effective=false;prepared.release();prepared=this.unavailableRuntime(input,stored,run.runId,cause?.issueCode??'AGENT_ADAPTER_UNSUPPORTED');
        prepared.snapshot.selfCheck?.issues.push(reason);entry.runtime=prepared;launch.runtime=prepared;launch.args=[];launch.env={};launch.initialInput=undefined;phase='native-only';return launch;
      };
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args:plan?.args??[],env:cliEnvironment?{...runtime.env,...cliEnvironment,PATH:dirname(this.options.cliPath!)+delimiter+(input.environment.PATH??'')}:runtime.env,command:native.command,
        assertBeforeFork:()=>{if(effective)gate();},
        nativeOnly:reason=>narrow(reason),
        beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','启动已取消或窗口已使用');const nativeOnly=phase==='native-only';if(effective)gate();phase='arming';if(!nativeOnly&&effective)await bridge?.bridge.arm();await run.cli.arm();},
        spawned:async pid=>{await run.cli.attach(pid??0);if(effective)this.skillObservations.start(input.taskId,run.runId,run.signal);},
        initialInput:(sender,text)=>this.applications.nativeInputs.observeLaunch(sender,{taskId:input.taskId,ptyId:run.ptyId},text),
        cancelBeforeFork:()=>run.cancelBeforeFork().then(()=>this.releaseStopped(entry)),spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>this.stopWithSkillHistory(input.taskId,entry,reason),
        bindNative:async id=>{const known=await this.sessions.get(input.taskId),bound=await this.sessions.bindNativeSession(input.taskId,known.pointer.snapshotHash,{...snapshot.native,runner:snapshot.runner,sessionId:id});prepared.snapshot.sessionCapabilities=bound.pointer;if(effective)this.skillObservations.start(input.taskId,run.runId,run.signal);}};
      return planIssue?narrow(planIssue,{reason:'managed_capabilities_unavailable',issueCode:planIssue}):launch;
    }catch(error){await run.stop('prepare-failed').catch(()=>{});await this.releaseStopped(entry);throw error;}
  }
  private async prepareUnavailableSession(input:TaskLaunchInput,current:StoredCapabilitySession,native:NativeLaunchContext|undefined,unavailable:string|undefined):Promise<TaskCapabilityLaunch>{
    const snapshot=current.snapshot,adapter=this.support.adapters.get(snapshot.adapterBinding.hash);
    const run=await this.runs.reserveFixedNativeGuard({taskId:input.taskId,projectId:input.projectId,runner:snapshot.runner,snapshotHash:current.pointer.snapshotHash,resourceIds:[`agent-adapter:${snapshot.runner}:${snapshot.adapterBinding.hash}`],...(snapshot.legacyBinding||unavailable?{restriction:{reason:'managed_capabilities_unavailable' as const,issueCode:unavailable==='AGENT_ADAPTER_UNSUPPORTED'||unavailable==='AGENT_CAPABILITY_NAME_CONFLICT'?unavailable:'RESOURCE_RECOVERY_REQUIRED' as const}}:{}),verify:async()=>{
      this.support.adapters.verify(snapshot.adapterBinding.hash);
      if(!input.newTask)await this.sessions.verifyNativeIdentity(input.taskId,{runner:snapshot.runner,stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});
    }}),entry:ActiveLaunch={run};this.active.set(run.runId,entry);
    try{
      await run.prepare();
      const issue=snapshot.legacyBinding?unavailable??'RESOURCE_RECOVERY_REQUIRED':unavailable??'CAPABILITY_UNAVAILABLE',runtime=this.unavailableRuntime(input,current,run.runId,issue);if((!native||!adapter.metadata.cliVersions.includes(native.version))&&!runtime.snapshot.selfCheck?.issues.includes('AGENT_ADAPTER_UNSUPPORTED'))runtime.snapshot.selfCheck?.issues.push('AGENT_ADAPTER_UNSUPPORTED');entry.runtime=runtime;
      if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原会话原生启动已取消');
      try{await this.applications.sessionDiagnostics.prepared({schema:2,capabilities:nativeCapabilityPreparation(snapshot,{applications:[],standardPaths:[],mcpNames:[],issue}),runId:run.runId,selectionHash:current.selectionHash,cliVersion:native?.version??null,adapterHash:snapshot.adapterBinding.hash,state:'unavailable',issueCode:issue,manifestPath:runtime.snapshot.manifestPath,configPaths:[],preparedAt:new Date().toISOString()});}catch{/* Display evidence grants nothing. */}
      let phase:'prepared'|'native-only'|'arming'='prepared';
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args:[],env:{},command:native?.command,assertBeforeFork:()=>{},nativeOnly:async reason=>{
        if(phase!=='prepared'||this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原生启动窗口已使用');
        launch.args=[];runtime.snapshot.selfCheck?.issues.push(reason);phase='native-only';return launch;
      },beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','原会话启动已取消或窗口已使用');phase='arming';await run.cli.arm();},spawned:pid=>run.cli.attach(pid??0),cancelBeforeFork:()=>run.cancelBeforeFork().then(()=>this.releaseStopped(entry)),spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>run.stop(reason).then(()=>this.releaseStopped(entry)),bindNative:async id=>{const known=await this.sessions.get(input.taskId),bound=await this.sessions.bindNativeSession(input.taskId,known.pointer.snapshotHash,{...snapshot.native,runner:snapshot.runner,sessionId:id});runtime.snapshot.sessionCapabilities=bound.pointer;}};
      return launch;
    }catch(error){await run.stop('unavailable-prepare-failed').catch(()=>{});await this.releaseStopped(entry);throw error;}
  }
  private async prepareNativeHistory(input:TaskLaunchInput,native:NativeLaunchContext|undefined,unavailable:string|undefined):Promise<TaskCapabilityLaunch>{
    const runner:string=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner).id,adapter=this.libraryAdapter(runner,native?.version);if(!adapter)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','缺少原生历史隔离所需适配资源');
    // A native-only guard grants no application bridge and keeps the native argv/config untouched.
    const nativeUnverified=Boolean(!native||unavailable||!this.support.adapters.get(adapter.hash).metadata.cliVersions.includes(native.version));
    const record=this.support.store.sqlite.prepare("SELECT snapshot_hash AS hash FROM capability_session_snapshots WHERE task_id=? AND schema_version=0 AND retention_state='hold'").get(input.taskId) as {hash:string}|undefined;if(!record)throw new ApplicationError('SESSION_ON_HOLD','缺少原历史保留依据');
    const run=await this.runs.reserveNativeGuard({taskId:input.taskId,projectId:input.projectId,runner,snapshotHash:record.hash,resourceIds:[`agent-adapter:${runner}:${adapter.hash}`],verify:async()=>{this.support.adapters.verify(adapter.hash);}}),entry:ActiveLaunch={run};this.active.set(run.runId,entry);
    try{
      await run.prepare();
      const check:RuntimeSnapshot['selfCheck']={status:'failed',issues:['HISTORY_CAPABILITIES_UNKNOWN',...(nativeUnverified?['AGENT_ADAPTER_UNSUPPORTED']:[])],at:Date.now()},runtime:PreparedRuntime={persistSnapshot:false,args:[],env:{},secretValues:[],snapshot:{runId:run.runId,projectId:input.projectId,configVersion:input.previous?.configVersion??0,configHash:record.hash,manifestPath:input.previous?.manifestPath??join(this.support.store.root,'sessions',input.taskId,'snapshot.json'),auditPath:input.previous?.auditPath??join(this.support.store.root,'resource-audit',input.projectId,input.taskId+'.jsonl'),skills:[],mcp:[],selfCheck:check},wrap:(command,argv)=>({command,args:argv}),check:()=>check,release:()=>{}};entry.runtime=runtime;
      if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原生历史启动已取消');
      let phase:'prepared'|'native-only'|'arming'='prepared';
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args:[],env:{},command:native?.command,assertBeforeFork:()=>{},nativeOnly:async reason=>{
        if(phase!=='prepared'||this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原生历史启动窗口已使用');
        await this.runs.restrictToNative(run.runId);launch.args=[];for(const issue of ['AGENT_ADAPTER_UNSUPPORTED',reason])if(!check.issues.includes(issue))check.issues.push(issue);phase='native-only';return launch;
      },beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','原生历史启动已取消或窗口已使用');phase='arming';await run.cli.arm();},spawned:pid=>run.cli.attach(pid??0),cancelBeforeFork:()=>run.cancelBeforeFork().then(()=>this.releaseStopped(entry)),spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>run.stop(reason).then(()=>this.releaseStopped(entry))};
      return launch;
    }catch(error){await run.stop('history-prepare-failed').catch(()=>{});await this.releaseStopped(entry);throw error;}
  }
  private unavailableRuntime(input:TaskLaunchInput,current:StoredCapabilitySession,runId:string,code:string):PreparedRuntime{
    const check:RuntimeSnapshot['selfCheck']={status:'failed',issues:[code],at:Date.now()};
    return{args:[],env:{},secretValues:[],snapshot:{runId,projectId:input.projectId,configVersion:input.previous?.configVersion??0,configHash:current.selectionHash,manifestPath:join(this.support.store.root,'sessions',input.taskId,'snapshot.json'),auditPath:join(this.support.store.root,'resource-audit',input.projectId,input.taskId+'.jsonl'),skills:[],mcp:[],selfCheck:check,sessionCapabilities:current.pointer},wrap:(command,args)=>({command,args}),check:()=>check,release:()=>{}};
  }
  private registerBridgeRecovery(run:OwnedCapabilityRun,server:string,adapterHash:string,cliVersion:string):void {
    const recovery=this.support.adapters.recovery(adapterHash,cliVersion);
    const authorize=()=>{
        if(run.signal.aborted||this.closed||this.runs.get(run.runId).state!=='active')throw new ApplicationError('CANCELED','原运行已停止');
        const context=this.runs.bridgePreparation(run.runId);
        // Shared transport may recover for a still-enabled original application, never an added one.
        const permitted=context.snapshot.packages;
        const eligible=permitted.some(pack=>this.support.store.sqlite.prepare('SELECT 1 FROM application_catalog_state c JOIN application_project_settings p ON p.app_id=c.app_id WHERE c.app_id=? AND p.project_id=? AND c.added=1 AND c.enabled=1 AND p.enabled=1 AND p.pending_operation_id IS NULL').get(pack.appId,context.snapshot.projectId));
        if(!eligible)throw new ApplicationError('SCOPE_DENIED','原运行应用已停用或正在变更，不能重新签发工具通道');
      };
    this.bridgeRecovery.register(run.runId,server,{
      capability:recovery.capability,evidence:recovery.evidence,
      validate:async()=>authorize(),
      ...(recovery.replace?{replace:async(attempt:{instanceId:string;generation:number;signal:AbortSignal})=>{
        const prepared=await this.broker.prepare(run,server,authorize);let connected=false;
        const cancel=()=>{this.bridges.revokeBridge(run.runId,prepared.bridge.processId);return prepared.cancel().catch(()=>undefined);};
        const aborted=()=>{void cancel();};attempt.signal.addEventListener('abort',aborted,{once:true});
        try{
          if(attempt.signal.aborted)return false;
          await prepared.bridge.arm();
          if(attempt.signal.aborted)return false;
          const handshake=this.broker.waitForAuthentication(run.runId,prepared.bridge.processId,attempt.signal);
          await recovery.replace!({runId:run.runId,serverName:server,bridgeInstanceId:prepared.bridge.processId,generation:attempt.generation,bootstrapPath:prepared.bootstrapPath,signal:attempt.signal});
          const authenticated=await handshake;authorize();connected=authenticated;
          return connected&&!attempt.signal.aborted;
        }finally{attempt.signal.removeEventListener('abort',aborted);if(!connected||attempt.signal.aborted)await cancel();}
      }}:{}),
    });
    this.recoveryServices.set(run.runId,server);
  }
  private bridgeDisconnected(runId:string):void {
    const server=this.recoveryServices.get(runId),entry=this.active.get(runId);
    if(!server||!entry||entry.run.signal.aborted||this.closed||this.broker.hasAuthenticated(runId))return;
    const state=this.bridgeRecovery.inspect(runId,server);if(!state||state.revoked)return;
    if(state.result?.code==='CONNECTED')this.bridgeRecovery.beginRecovery(runId,server,state.generation,'disconnected');
    const generation=this.bridgeRecovery.inspect(runId,server)!.generation;
    // Unsupported native versions report unavailable; never stop/resume their Agent.
    void this.bridgeRecovery.prepareReplacement(runId,server,generation);
  }
  private stopWithSkillHistory(taskId:string,entry:ActiveLaunch,reason?:string):Promise<void>{
    const previous=this.stopping.get(entry.run.runId);if(previous)return previous;
    const finish=this.applications.sessionDiagnostics.prepareStop(taskId,entry.run.runId);
    const work=(async()=>{try{await entry.run.stop(reason);}finally{await finish();}await this.releaseStopped(entry);})();
    this.stopping.set(entry.run.runId,work);
    void work.finally(()=>{if(this.stopping.get(entry.run.runId)===work)this.stopping.delete(entry.run.runId);}).catch(()=>{});
    return work;
  }
  private releaseStopped(entry:ActiveLaunch):Promise<void>{if(this.runs.get(entry.run.runId).state!=='stopped')return Promise.resolve();if(entry.releasing)return entry.releasing;const work=(async()=>{entry.runtime?.release();const server=this.recoveryServices.get(entry.run.runId);if(server)this.bridgeRecovery.release(entry.run.runId,server);this.recoveryServices.delete(entry.run.runId);this.active.delete(entry.run.runId);})();entry.releasing=work;void work.catch(()=>{entry.releasing=undefined;});return work;}
  private async sweep():Promise<void>{if(this.sweeping)return;this.sweeping=true;try{await Promise.allSettled([...this.active.values()].map(entry=>this.releaseStopped(entry)));}finally{this.sweeping=false;}}
  tombstone(taskId:string):Promise<void>{return this.sessions.tombstone(taskId);}
  activeTaskIds(projectId:string):ReadonlySet<string>{return new Set((this.support.store.sqlite.prepare("SELECT task_id AS id FROM capability_runs WHERE project_id=? AND state NOT IN ('stopped','failed')").all(projectId) as {id:string}[]).map(r=>r.id));}
  dispose():Promise<void>{if(this.closing)return this.closing;this.closed=true;this.skillObservations.close();clearInterval(this.timer);this.closing=(async()=>{await Promise.allSettled([...this.pending]);const finishes=[...this.active.values()].filter(entry=>!this.stopping.has(entry.run.runId)).map(entry=>this.applications.sessionDiagnostics.prepareStop(this.runs.get(entry.run.runId).taskId,entry.run.runId));const results=await Promise.allSettled([...this.stopping.values(),this.runs.dispose(),this.bridges.dispose(),this.broker.close(),...(this.cli?[this.cli.close()]:[])]);await Promise.allSettled(finishes.map(finish=>finish()));const deadline=performance.now()+2000;do{await this.sweep();if(!this.active.size)break;await new Promise<void>(done=>setTimeout(done,10));}while(performance.now()<deadline);if(results.some(result=>result.status==='rejected'))throw new ApplicationError('RUN_STOP_FAILED','部分运行关闭尚未完成；私有通道已撤销，未知占用继续保留');})();return this.closing;}
}
