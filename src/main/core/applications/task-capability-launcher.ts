import { AgentBusinessTools } from './agent-business-tools';
import {SkillObservationMonitor} from './skill-observation-monitor';
import {BridgeSupervisor} from './bridge-supervisor';
import {assertNoPendingApplicationSwitch} from './application-run-policy';
import { mkdirSync, writeFileSync,readFileSync } from 'node:fs';
import { delimiter,dirname, join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import { applicationMcpServerName, type CapabilitySessionSnapshot } from '@shared/application-session';
import { CapabilityService, MCP_CAPABILITY, type PreparedRuntime } from '../capabilities/capability-service';
import { projectCapabilityEnabled, type ProjectCapabilitySetting } from '../projects/project-capability-setting';
import type { AgentSupportService } from './agent-support-service';
import type { ApplicationService } from './application-service';
import type { ResourceRecord } from './resource-store';
import { CapabilitySessionRegistry, canonicalFuturePath } from './session-registry';
import { CapabilityRunRegistry, type RunBindingRevision, type OwnedCapabilityRun } from './run-registry';
import { ApplicationAdapterRegistry } from './application-adapter-registry';
import { ApplicationToolService } from './tool-service';
import { PrivateApplicationBroker } from './private-broker';
import {ApplicationCliGateway} from './cli-gateway';
import {CurrentApplicationAuthorization} from './current-authorization';
import {SkillLibraryService} from './skill-library-service';
import {cleanupPreLibraryCopies} from './legacy-copy-cleanup';
import {retirePreLibraryResources,type PreLibraryRetirement} from './retire-pre-library-resources';
import type {CliSandboxPlan} from './capability-delivery-adapters';
import {verifyClaudeCliSandbox} from './claude-effective-sandbox';
import {verifyCodexCliSandbox} from './codex-effective-sandbox';
import {createApplicationRunPlan,selectCapabilityEntry,type RunPlanAvailability} from './run-plan';

import { AgentBridgeProcesses } from './agent-bridge-processes';
import {RunBackendAuthority} from './run-backend-authority';
import { MacProcessIdentityReader, type ProcessIdentityReader } from './process-identity';
import { MacUnixPeerIdentityReader, type UnixPeerIdentityReader } from './unix-peer-identity';
import { inspectNativeLaunch, type NativeLaunchContext, type TaskLaunchInput } from './native-launch-context';
import type { CheckedNativeCli } from '../ai/runner-detect';
import { canonicalJson, digest } from './manifest';
import {EmbeddedNodeRuntime} from './embedded-node-runtime';
import {builtinApplicationModules} from './modules';
import {FrozenPluginSkills,type FrozenPluginSkillSet} from './plugins/frozen-skills';
import type {CodexTaskServerRequest,PrivateCodexTaskServer} from './codex-task-server';
import type { AgentHostTools } from './agent-host-tools';
import type { RunIntegration } from '../agent/run-integration';
import type { DriverOpenOptions } from '../agent/driver';
import { codexSupportsTurnPermissions } from '../agent/permissions';
import { RuntimeRegistry } from './runtime-registry';
import { verifyPackageTree } from './package-files';
import type { BridgeResponse } from '@shared/application-bridge';
/** Resource kinds only pre-R1.0 launches used (shared discovery, per-session projections, Claude plugin, M4 originals). */
const RETIRED_RESOURCE_KINDS:ReadonlySet<string>=new Set(['session-projection','claude-projection-source','claude-projection-archive','claude-delivery','agent-projection','legacy-agent-projection','legacy-static-plugin','legacy-plugin-source']);
export interface ActiveLaunch {run:OwnedCapabilityRun;runtime?:PreparedRuntime;codex?:PrivateCodexTaskServer;releasing?:Promise<void>}
export interface TaskCapabilityLauncherOptions {
  helper: string;
  cliPath?:string;
  inspectSandbox?:(input:TaskLaunchInput,native:NativeLaunchContext)=>Promise<CliSandboxPlan>;
  stopPty(ptyId:string):void;
  processes?:ProcessIdentityReader;
  peers?:UnixPeerIdentityReader;
  inspectNative?:(input:TaskLaunchInput)=>Promise<NativeLaunchContext>;
  probeApplicationRuntime?:(signal:AbortSignal)=>Promise<boolean>;
  /** Host-only dependency for isolated software tests; no RPC/config surface. */
  prepareCodexServer?:(request:CodexTaskServerRequest)=>Promise<PrivateCodexTaskServer>;
  pollMs?:number;
  /** R16: HOME whose `.agents/skills` (and each Agent's link directory) holds the single WillYou Skill library. Omitted: no library delivery. */
  skillLibraryHome?:string;
  /** Packaged App only: also remove pre-R1.0 copies whose markers name no data directory (M4 copies, coordination root). */
  cleanupUnattributable?:boolean;
}
/** Production composition. Credentials, native PIDs and resource identities never come from RPC. */
export class ManagedTaskCapabilities {
  private readonly agentServices=new Map<import('@shared/application-capabilities').ApplicationEntry,ApplicationToolService>();
  private agentBusiness?:AgentBusinessTools;
  attachAgentRequests(store:import('../agent/agent-store').AgentStore,requests:import('../agent/host-business-requests').HostBusinessRequests,notify:(taskId:string,id:string,text:string)=>void){if(this.agentBusiness)return;this.agentBusiness=new AgentBusinessTools({store,requests,runs:this.runs,applications:this.applications,services:this.agentServices,notify});}

  private hostTools?: AgentHostTools;
  attachAgentTools(tools: AgentHostTools) { this.hostTools = tools; }
  protected readonly planningAgents=new Map<string,NativeLaunchContext>();
  protected readonly planningCliPolicies=new Map<string,CliSandboxPlan>();
  readonly cli?:ApplicationCliGateway;
  protected cliReady=false;
  readonly sessions:CapabilitySessionRegistry;
  readonly runs:CapabilityRunRegistry;
  protected readonly authorization:CurrentApplicationAuthorization;
  readonly bridges:AgentBridgeProcesses;
  readonly backends:RunBackendAuthority;
  readonly broker:PrivateApplicationBroker;
  readonly bridgeRecovery=new BridgeSupervisor();
  protected readonly skillObservations=new SkillObservationMonitor(async(taskId,runId)=>{await this.applications.sessionDiagnostics.collectSkillObservations(taskId,runId);},undefined,runId=>this.applications.sessionDiagnostics.forgetSkillObservations(runId));
  protected readonly recoveryServices=new Map<string,string>();
  protected readonly active=new Map<string,ActiveLaunch>();
  protected readonly pending=new Set<Promise<unknown>>();
  private readonly stopping=new Map<string,Promise<void>>();
  protected readonly processes:ProcessIdentityReader;
  protected readonly embeddedNode=new EmbeddedNodeRuntime();
  private readonly timer:ReturnType<typeof setInterval>;
  readonly recoveryWarnings:{homeId:string;code:string}[]=[];
  protected readonly library?:SkillLibraryService;
  protected readonly pluginSkills?:FrozenPluginSkills;
  /** Last pre-R1.0 copy cleanup (diagnostics). */
  legacyCleanup:import('./legacy-copy-cleanup').LegacyCopyCleanup|null=null;
  /** Last retirement of pre-R1.0 resource records (diagnostics). */
  retirement:PreLibraryRetirement|null=null;
  protected closed=false;private closing?:Promise<void>;private sweeping=false;
  protected constructor(protected readonly support:AgentSupportService,protected readonly capabilities:CapabilityService,protected readonly applications:ApplicationService,protected readonly options:TaskCapabilityLauncherOptions){
    const store=support.store;this.processes=options.processes??new MacProcessIdentityReader(options.helper);
    this.sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:snapshot=>this.assertInitialSelection(snapshot),verifyExtraResource:(resource,snapshot)=>this.verifyResource(resource,snapshot)});
    this.authorization=new CurrentApplicationAuthorization(store,applications.builtin);
    if(applications.plugins)this.pluginSkills=new FrozenPluginSkills(store,applications.plugins.lifecycle);
    if(options.skillLibraryHome)this.library=new SkillLibraryService(store,applications.builtin,{home:options.skillLibraryHome,targets:()=>support.adapters.deliveryAdapters.libraryTargets(),added:appId=>{const state=applications.selections.catalogState(appId as Parameters<typeof applications.selections.catalogState>[0]);return state.added&&state.enabled;},standardSkills:()=>(store.sqlite.prepare('SELECT skill_id AS skillId,hash FROM skill_versions WHERE active=1 ORDER BY skill_id').all() as {skillId:string;hash:string}[]).filter(s=>capabilities.globalEnabled(s.skillId)).map(s=>({skillId:s.skillId,files:Object.fromEntries(Object.entries(support.legacy.verify(store.get('standard-skill:'+s.skillId+':'+s.hash))).map(([path,text])=>[path,Buffer.from(text,'utf8')]))}))});
    this.runs=new CapabilityRunRegistry(store,this.sessions,{processes:this.processes,currentAuthorization:context=>this.authorization.view(context),createPlan:(snapshot,snapshotHash,runId,pinnedBindings)=>{
      // R17: the plan records what the Agent loads at this launch, i.e. the project's current applications (not the
      // session's creation record), so the resume advice compares against what this run actually loaded.
      const apps=this.authorization.selectedApps(snapshot.projectId),bindings=pinnedBindings?[...pinnedBindings,...this.authorization.bindings(snapshot.projectId,apps.filter(a=>a.appId!=='mail'&&a.appId!=='browser').map(a=>a.appId))]:this.authorization.bindings(snapshot.projectId,apps.map(a=>a.appId));
      const selected={...snapshot,packages:apps.map(a=>this.authorization.packageSelection(snapshot.projectId,a.packageHash,bindings,[])),standardSkills:[]} as CapabilitySessionSnapshot;
      const sources=selected.packages.map(p=>{const application=applications.builtin.retainedMetadata(p.packageHash);return{packageHash:p.packageHash,manifest:application.manifest,capabilities:builtinApplicationModules.capabilityViews(application.manifest)};});
      // R16: Skills come from the machine-wide library; a run plan carries no per-run Skill copies.
      const available=this.cliAvailability(snapshot.taskId),skills=snapshot.runner==='claude-code'||snapshot.runner==='codex'&&this.planningAgents.get(snapshot.taskId)?.version==='0.167.1'?this.pluginSkills?.describe(selected,runId,available)?.skills??[]:[];
      return createApplicationRunPlan({runId,snapshotHash,snapshot:selected,applications:sources,skills,available,sandbox:this.planningCliPolicies.has(snapshot.taskId)?{source:this.planningCliPolicies.get(snapshot.taskId)!.source,digest:this.planningCliPolicies.get(snapshot.taskId)!.digest}:undefined,cliVersion:this.planningAgents.get(snapshot.taskId)?.version??'unverified'});
    },assertCurrent:snapshot=>{
      // Application enablement and current slots belong to each business call, not Agent liveness.
      const project=store.sqlite.prepare('SELECT archived_at FROM projects WHERE id=?').get(snapshot.projectId) as {archived_at:number|null}|undefined;
      if(!project||project.archived_at!==null)throw new ApplicationError('SCOPE_DENIED','项目已删除或归档，不能继续使用此运行');
    },revoke:runId=>{const recoveryService=this.recoveryServices.get(runId);if(recoveryService)this.bridgeRecovery.revoke(runId,recoveryService);this.broker?.revokeRun(runId);this.cli?.revokeRun(runId);this.bridges?.revokeRun(runId);this.backends?.revokeRun(runId);const entry=this.active.get(runId),backend=entry?.codex?.stop();if(entry)this.options.stopPty(entry.run.ptyId);return backend;}});
    this.backends=new RunBackendAuthority(this.runs,options.peers??new MacUnixPeerIdentityReader(options.helper),this.processes,{pollMs:options.pollMs});
    this.bridges=new AgentBridgeProcesses(this.runs,options.peers??new MacUnixPeerIdentityReader(options.helper),this.processes,{pollMs:options.pollMs,additionalRoot:this.backends});
    const applicationTools = new ApplicationToolService(store,this.runs,new ApplicationAdapterRegistry(store,applications.data),{additional:applications.plugins?.tools});this.agentServices.set('mcp',applicationTools);
    const agentRun = (runId: string) => !!(store.sqlite.prepare('SELECT binding_id FROM capability_runs WHERE run_id=?').get(runId) as { binding_id?: string } | undefined)?.binding_id;
    this.broker=new PrivateApplicationBroker(this.runs,{
      clearMemory: runId => applicationTools.clearMemory(runId),
      list: async runId => { const list = await applicationTools.list(runId); if (!this.hostTools || !agentRun(runId)) return list; return this.runs.withActivity(runId, async context => ({ ...list, tools: [...list.tools, ...this.hostTools!.list(context)] })); },
      call: async (runId, id, call, signal) => {
        if (!call.operation.startsWith('wy_')) {
          const row = store.sqlite.prepare("SELECT d.access FROM capability_runs r JOIN agent_delegations d ON d.child_task_id=r.task_id WHERE r.run_id=? AND r.binding_id IS NOT NULL").get(runId) as { access: string } | undefined;
          if (row?.access === 'read') {
            const context = this.runs.assertActive(runId), tool = (await applicationTools.list(runId)).tools.find(t => t.name === call.operation && t.contractMajor === call.contractMajor);
            const external = context.snapshot.schema === 3 && context.snapshot.externalPlugins?.some(p => p.capabilities.some(c => c.mcpTool === call.operation || c.aliases.includes(call.operation)));
            if (!tool?.annotations.readOnlyHint || tool.annotations.destructiveHint || external) return { schema: 1, id, status: 'error', error: { code: 'SCOPE_DENIED', message: '只读角色拒绝写入或未经宿主证明的插件。调用 wy_request_write 并结束本轮后排队。', layer: 'auth', retryable: false, attemptCount: 0, retryExhausted: false, effectState: 'not-started', nextAction: '申请写入资格并结束本轮' } } as BridgeResponse;
          }
          return applicationTools.call(runId,id,call,signal);
        }
        try {
          if (!this.hostTools || !agentRun(runId) || call.contractMajor !== 1 || call.connectionId !== null) throw new ApplicationError('SCOPE_DENIED', '此运行未启用宿主委派工具');
          const value = await this.runs.withActivity(runId, context => this.hostTools!.call(context, call.operation, call.arguments, signal ?? context.signal));
          return { schema: 1, id, status: 'ok', value } as BridgeResponse;
        } catch (e) { return { schema: 1, id, status: 'error', error: { code: e instanceof ApplicationError ? e.code : 'INVALID_INPUT', message: (e as Error).message.slice(0, 1000), layer: 'auth', retryable: false, attemptCount: 0, retryExhausted: false, effectState: 'not-started', nextAction: '核对收据及子任务状态后再操作' } } as BridgeResponse; }
      },
    },{rejectedPeer:async(socket,runId,bridge)=>{if(agentRun(runId))await this.bridges.observeRejected(socket,runId,bridge);},attachPeer:(socket,runId,bridge)=>this.bridges.attach(socket,runId,bridge),authenticated:(runId,bridgeId)=>applications.sessionDiagnostics.bridgeAuthenticated(runId,bridgeId),disconnected:(runId)=>this.bridgeDisconnected(runId),rejectedReplacement:(runId,bridgeId)=>this.bridges.revokeBridge(runId,bridgeId)});
    if(options.cliPath)try{const cliTools=new ApplicationToolService(store,this.runs,new ApplicationAdapterRegistry(store,applications.data),{entry:'cli',additional:applications.plugins?.tools});this.agentServices.set('cli',cliTools);const identity={path:canonicalFuturePath(options.cliPath),sha256:digest(readFileSync(options.cliPath))};this.cli=new ApplicationCliGateway(this.runs,cliTools,options.peers??new MacUnixPeerIdentityReader(options.helper),{executable:identity,additionalRoot:this.backends});this.cliProof=Object.freeze(identity);}catch{/* Missing CLI resources retain the approved read-only MCP fallback. */}
    applications.sessionDiagnostics.attach({deliveryAdapters:support.adapters.deliveryAdapters,channelConnected:id=>this.broker.hasAuthenticated(id),recoveryIssue:id=>{const server=this.recoveryServices.get(id);const result=server?this.bridgeRecovery.inspect(id,server)?.result:undefined;return result&&result.code!=='CONNECTED'?result.code:null;},verify:(resource,snapshot)=>this.verifyResource(resource,snapshot)});
    this.timer=setInterval(()=>{void this.sweep();},Math.max(20,options.pollMs??500));this.timer.unref();
  }
  static async open(support:AgentSupportService,capabilities:CapabilityService,applications:ApplicationService,options:TaskCapabilityLauncherOptions):Promise<ManagedTaskCapabilities>{
    const manager=new ManagedTaskCapabilities(support,capabilities,applications,options);
    await manager.initialize();
    return manager;
  }

  protected async initialize() {
    try{await this.runs.recover();
      for(const issue of this.pluginSkills?.recover()??[])this.recoveryWarnings.push({homeId:'plugin-skills:'+issue.runId,code:issue.code});
      if(this.options.skillLibraryHome)try{this.legacyCleanup=cleanupPreLibraryCopies({home:this.options.skillLibraryHome,storeId:this.support.store.storeId,unattributable:this.options.cleanupUnattributable===true});}catch(error){this.recoveryWarnings.push({homeId:'legacy-copy-cleanup',code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
      try{this.retirement=await retirePreLibraryResources(this.support.store);}catch(error){this.recoveryWarnings.push({homeId:'pre-library-retirement',code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
      this.syncSkillLibrary();await this.broker.start();if(this.cli)try{await this.cli.start();this.cliReady=true;}catch{await this.cli.close();}this.applications.attachRuns(this.runs);}catch(error){await this.dispose();throw error;}
  }
  /** Converge the Skill library after startup and every application change; a failure never blocks tasks. */
  syncSkillLibrary(claudeStateRoot?:string,managedCodexHome?:string):void{
    if(!this.library)return;
    try{
      if(managedCodexHome)this.library.syncManagedBrowser(managedCodexHome);
      else this.library.sync(claudeStateRoot);
      this.recoveryWarnings.splice(0,this.recoveryWarnings.length,...this.recoveryWarnings.filter(w=>w.homeId!=='skill-library'));
    }
    catch(error){if(!this.recoveryWarnings.some(w=>w.homeId==='skill-library'))this.recoveryWarnings.push({homeId:'skill-library',code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}
  }
  skillLibraryConflicts(){return this.library?.conflicts()??[];}
  protected cliAvailability(taskId:string):RunPlanAvailability{const policy=this.planningCliPolicies.get(taskId);return{mcp:true,cli:this.cliReady&&policy?.available===true,reason:policy?.available?undefined:policy&&'reason'in policy?policy.reason:'cli-entry-unavailable'};}
  protected async configureCli(input:TaskLaunchInput,native:NativeLaunchContext,snapshot:CapabilitySessionSnapshot){
    const delivery=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner);
    if(!this.cliReady||!delivery.entryDelivery('cli')||this.support.adapters.get(snapshot.adapterBinding.hash).metadata.cliEntry!=='supported')return;
    // §15.4: the CLI sandbox is delivered only for a version whose declared levels include L0.cli; undeclared versions fail closed.
    if(!this.support.adapters.effective(snapshot.adapterBinding.hash,native.version).levels.includes('L0.cli'))return;
    const inspect=this.options.inspectSandbox??delivery.effectiveSandbox;

    if(!inspect)return;
    const policy=await inspect.call(delivery,input,native);
    this.planningCliPolicies.set(input.taskId,policy);
    return policy;
  }

  protected bindings(projectId:string,appIds:readonly string[]):RunBindingRevision[]{return this.authorization.bindings(projectId,appIds);}

  protected assertInitialSelection(snapshot:CapabilitySessionSnapshot):void{
    assertNoPendingApplicationSwitch(this.support.store,snapshot);
    const store=this.support.store,apps=this.selectedApps(snapshot.projectId);
    if(canonicalJson(apps)!==canonicalJson(snapshot.packages.map(p=>({appId:p.appId,packageHash:p.packageHash}))))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目应用或默认版本已变化');
    const bindings=this.bindings(snapshot.projectId,snapshot.packages.map(p=>p.appId));
    for(const app of snapshot.packages){const current=bindings.filter(b=>b.appId===app.appId&&b.connectionId).map(b=>({bindingId:`${snapshot.projectId}:${app.appId}:${b.slot}`,connectionId:b.connectionId!,identityRevision:b.identityRevision!}));if(canonicalJson(current)!==canonicalJson(app.bindings))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目连接选择已变化');}
    if(snapshot.schema===3&&this.applications.plugins&&canonicalJson(snapshot.externalPlugins??[])!==canonicalJson(this.applications.plugins.selections(snapshot.projectId)))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间插件或启动连接已变化');
    const settings=store.sqlite.prepare('SELECT id,project_id AS projectId,capability_id AS capabilityId,enabled FROM project_capabilities WHERE project_id=?').all(snapshot.projectId) as ProjectCapabilitySetting[];
    if(projectCapabilityEnabled(settings,snapshot.projectId,MCP_CAPABILITY)!==snapshot.mcp.some(m=>m.kind==='legacy-project-context'))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目上下文选择已变化');
  }
  /** Pre-R1.0 references stay recorded until adoption releases them, but no launch is backed by them any more. */
  protected verifyResource(resource:ResourceRecord,snapshot:CapabilitySessionSnapshot):void{
    if(resource.kind==='agent-adapter')this.support.adapters.verifyReference(resource,snapshot);
    else if(RETIRED_RESOURCE_KINDS.has(resource.kind))throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','R1.0 之前的投影资源不再用于启动');
    else this.support.legacy.verify(resource);
  }
  protected selectedApps(projectId:string):{appId:string;packageHash:string}[]{return this.authorization.selectedApps(projectId);}

  /** Every version of an Agent uses the library; prefer the adapter that declares this version. */
  protected libraryAdapter(runner:string,cliVersion:string|undefined){
    const candidates=this.support.status().adapters.filter(a=>a.agentId===runner&&this.support.adapters.get(a.hash).metadata.skillDelivery==='library');
    return candidates.find(a=>cliVersion!==undefined&&a.cliVersions.includes(cliVersion))??candidates[0];
  }
  /** Pinned bridge runtime shared by every registered application package. */
  private applicationRuntimeHash():string|null{
    for(const appId of builtinApplicationModules.appIds()){const active=this.applications.builtin.packages.active(appId);if(active)return this.applications.builtin.retainedMetadata(active.packageHash).manifest.runtime.hash;}
    return null;
  }
  /** Audit record of the session; what it may call is decided per call (R17), and Skills come from the library (R16). */
  protected createLibrarySnapshot(input:TaskLaunchInput,agentVersion:string,adapterHash:string,options:{scope?:'browser';nativeAgent?:boolean}={}):CapabilitySessionSnapshot{
    const runner=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner).id,adapter=this.support.adapters.get(adapterHash).metadata;
    const {scope,nativeAgent}=options;
    const apps=this.selectedApps(input.projectId).filter(app=>!scope||app.appId===scope);
    const bindings=this.bindings(input.projectId,apps.map(a=>a.appId)),packages=apps.map(a=>this.authorization.packageSelection(input.projectId,a.packageHash,bindings,[]));
    const runtimeHash=packages[0]?.runtimeHash??this.applicationRuntimeHash(),taskDigest=digest(input.taskId);
    // The Responses function name includes both the server and tool name.
    const appMcp=applicationMcpServerName(nativeAgent?taskDigest.slice(0,16):taskDigest);
    if(new Set(packages.map(p=>p.runtimeHash)).size>1)throw new ApplicationError('HOST_INCOMPATIBLE','本次应用选择使用了不兼容的桥运行版本');
    const mcp:CapabilitySessionSnapshot['mcp']=runtimeHash?[{kind:'applications',serverName:appMcp,protocolMajor:1,runtimeHash}]:[];
    const externalPlugins=scope?undefined:this.applications.plugins?.selections(input.projectId);
    if(!scope&&runner!=='antigravity'&&this.capabilities.enabled(input.projectId,MCP_CAPABILITY))mcp.push({kind:'legacy-project-context',serverName:'smartdd_project_'+digest(input.taskId).slice(0,12),protocolMajor:1,runtimeHash:this.capabilities.runtimeIdentity().hash});
    const toolNames=[...packages.flatMap(p=>Object.keys(p.toolContractMajors)),...(externalPlugins??[]).flatMap(p=>p.capabilities.flatMap(c=>[c.mcpTool,...c.aliases]))];
    return{schema:3,taskId:input.taskId,projectId:input.projectId,createdAt:new Date().toISOString(),runner,adapterBinding:{id:runner,version:adapter.version,hash:adapterHash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(toolNames.map(name=>[name,'mcp__'+appMcp+'__'+name]))},native:{sessionId:input.sessionId,stateRoot:input.stateRoot,cwd:input.cwd},agentAtCreation:{version:agentVersion,adapterRevision:1},catalogGeneration:'library',packages,...(externalPlugins?{externalPlugins}:{}),standardSkills:[],mcp,provenance:'created'};
  }
  /** M14 binds capabilities to a real SDK/app-server run, never to a synthetic PTY process. */
  private cliProof?:import('../agent/host-cli-command').HostBusinessCli;
  agentDelivery(runner:string,version:string,browserMcpCandidate=false):'verified'|'browser'|undefined{
    const delivery=this.support.adapters.deliveryAdapters.forRunner(runner);
    const adapter=this.libraryAdapter(delivery.id,version);
    if(!adapter)return;
    if(runner==='antigravity')return browserMcpCandidate&&process.platform==='darwin'&&process.arch==='arm64'?'verified':undefined;
    if(this.support.adapters.levels(adapter.hash,version).includes('L0.mcp'))return 'verified';
    if(browserMcpCandidate&&delivery.entryDelivery('mcp')&&this.support.adapters.versionSupport(adapter.hash,version)==='best-effort')return 'browser';
  }
  taskPlugins(taskId:string){const task=this.support.store.sqlite.prepare('SELECT project_id FROM tasks WHERE id=?').get(taskId) as {project_id:string|null}|undefined;if(!task?.project_id)return[];const result=this.selectedApps(task.project_id).map(p=>({id:p.appId,name:this.applications.builtin.retainedMetadata(p.packageHash).manifest.displayName}));for(const p of this.applications.plugins?.selections(task.project_id)??[]){const state=this.applications.plugins!.lifecycle.state(p.appId);if(state.hash)result.push({id:p.appId,name:this.applications.plugins!.lifecycle.packages.get(state.hash).plugin.manifest.displayName});}return result;}
  async agentReference(sender:import('./execution-context').ApplicationUiSender,taskId:string,raw:import('@shared/application-terminal').ApplicationTerminalSource){
    const {applicationTerminalSourceSchema,applicationReferenceText,terminalSourceApp}=await import('@shared/application-terminal');
    const source=applicationTerminalSourceSchema.parse(raw),store=this.support.store;
    const task=()=>{const t=store.sqlite.prepare('SELECT t.project_id,a.archived_at FROM agent_tasks a JOIN tasks t ON t.id=a.task_id WHERE a.task_id=?').get(taskId) as {project_id:string|null;archived_at:string|null}|undefined;if(!t?.project_id||t.archived_at||!store.sqlite.prepare('SELECT 1 FROM projects WHERE id=? AND archived_at IS NULL').get(t.project_id))throw new ApplicationError('SCOPE_DENIED','引用目标任务或项目已不可用');return t;};
    const projectId=task().project_id!;
    if(source.kind==='pluginAction'){const value=this.applications.pluginReviewAction(sender,source.actionId);if(value.kind!=='insertTerminal'||value.appId!==source.appId||value.projectId!==projectId)throw new ApplicationError('SCOPE_DENIED','插件原对象不属于目标项目');task();return{taskId,projectId,text:value.text};}
    const appId=terminalSourceApp(source);this.applications.selections.requireEnabled(projectId,appId);
    const selected=this.selectedApps(projectId).find(p=>p.appId===appId);if(!selected)throw new ApplicationError('SCOPE_DENIED','目标项目没有选用此应用');const pack=this.applications.builtin.retainedMetadata(selected.packageHash),policy=canonicalJson(this.applications.selections.policyStamp(projectId,appId));
    if(source.kind==='skill'){if(!pack.manifest.skills.some(s=>s.id===source.skillId))throw new ApplicationError('SCOPE_DENIED','此应用没有声明该Skill');}
    else if(source.kind==='draft'){const value=await this.applications.viewDraft(sender,projectId,source.draftId,source.revision);if(value.draft.contentHash!==source.contentHash||(store.sqlite.prepare('SELECT current_revision FROM mail_drafts WHERE id=? AND project_id=?').get(source.draftId,projectId) as {current_revision:number}|undefined)?.current_revision!==source.revision)throw new ApplicationError('REVISION_CONFLICT','草稿已更新，请重新查看后插入');}
    else {const slot=source.kind==='zentao'?'zentao':'foxmail',binding=this.applications.selections.connectionSlot(projectId,appId,slot),connection=this.applications.connections.get(source.reference.connectionId);if(binding.connectionId!==connection.id||binding.identityRevision!==source.reference.identityRevision||connection.identityRevision!==source.reference.identityRevision||!connection.enabled||connection.authorization!=='connected')throw new ApplicationError('SCOPE_DENIED','引用不是目标项目当前选用的来源');if(source.kind==='zentao')this.applications.data.zentao.assertStoredReference(projectId,source.objectKind,source.reference);else await this.applications.contexts.withUi(sender,{projectId,appId:'mail',action:'ui.mail.reference.prepare',operations:['mail.read'],semantics:'read'},context=>this.applications.mailReads.source(context,source.reference));}
    if(task().project_id!==projectId||canonicalJson(this.applications.selections.policyStamp(projectId,appId))!==policy)throw new ApplicationError('RESOURCE_STATE_CHANGED','准备引用期间项目授权已经变化');
    return{taskId,projectId,text:applicationReferenceText(source)};
  }
  recordAgentHumanInput(runId:string,sender:import('./execution-context').ApplicationUiSender,text:string,sequence:number){const context=this.runs.assertActive(runId),row=this.support.store.sqlite.prepare('SELECT pty_id FROM capability_runs WHERE run_id=? AND binding_id IS NOT NULL').get(runId) as {pty_id:string}|undefined;if(row)this.applications.nativeInputs.observeAgent(sender,context,row.pty_id,text,sequence);}
  agentContext(runId:string){return this.runs.assertActive(runId);}
  assertAgentApplication(taskId:string,appId:'browser'){const task=this.support.store.sqlite.prepare('SELECT project_id FROM tasks WHERE id=?').get(taskId) as {project_id:string}|undefined;if(!task)throw new ApplicationError('SCOPE_DENIED','任务不存在');this.applications.selections.requireApplicationEnabled(task.project_id,appId);}
  async prepareAgent(input: { runId: string; bindingId: string; generation: number; task: TaskLaunchInput; version: string; checkedCli?: CheckedNativeCli; applicationScope?: 'browser'; managedCodexHome?: string; assertCurrent(): void }): Promise<RunIntegration> {
    if (this.closed) throw new ApplicationError('CANCELED', '应用服务已关闭');
    const store = this.support.store, task = input.task, runner = this.support.adapters.deliveryAdapters.forRunner(task.profile.runner).id;
    const adapter = this.libraryAdapter(runner, input.version); if (!adapter) throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED', '没有此执行器的受控交付资源');
    const managedAcp = runner === 'antigravity';
    input.assertCurrent();
    if (!managedAcp) this.syncSkillLibrary(task.profile.runner === 'claude' ? task.stateRoot : undefined,input.managedCodexHome);
    const native = await (this.options.inspectNative ?? inspectNativeLaunch)(task, input.checkedCli);
    if (input.checkedCli && native.version !== input.version) throw new ApplicationError('RESOURCE_STATE_CHANGED', '执行器版本在准备期间已变化，请重新发送');
    const snapshot = this.createLibrarySnapshot(task, input.version, adapter.hash, {scope:input.applicationScope,nativeAgent:true}), bytes = canonicalJson(snapshot), hash = digest(bytes);
    const server = snapshot.mcp.find(m => m.kind === 'applications');
    if (!server) throw new ApplicationError('CAPABILITY_UNAVAILABLE', '应用桥资源尚未准备');
    if (native.inventory.some(x => x.kind === 'mcp' && x.name === server.serverName)) throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT', '用户 MCP 已使用 WillYou 服务名，未覆盖');
    const bindings = input.applicationScope ? [] : this.applications.builtinPreferences.capture(task.projectId);
    const selection=JSON.parse((store.sqlite.prepare('SELECT selection_json FROM agent_tasks WHERE task_id=?').get(task.taskId) as {selection_json:string}).selection_json),role=store.sqlite.prepare('SELECT access FROM agent_delegations WHERE child_task_id=?').get(task.taskId) as {access:string}|undefined;
    // The driver supplies the effective per-turn tier. Inspect the same host choice, retaining all other source flags.
    const args:string[]=[];for(let i=0;i<task.profile.args.length;i++){const a=task.profile.args[i];if(['--permission-mode','--sandbox','-s','--ask-for-approval','-a','--setting-sources'].includes(a)){i++;continue;}if(['--dangerously-bypass-approvals-and-sandbox','--yolo','--approve-for-me','--not-so-yolo','--full-auto'].includes(a))continue;args.push(a);}
    const fullAccess = selection.tier === 'full';
    const codex = task.profile.runner === 'codex';
    // Preload the restricted profile on the verified protocol so a later downgrade keeps
    // access to the one host socket, even when the first turn starts with full access.
    const prepareRestrictedProfile = codex && codexSupportsTurnPermissions(input.version);
    if (codex) args.push('--sandbox', fullAccess && !prepareRestrictedProfile ? 'danger-full-access' : 'workspace-write');
    else args.push('--setting-sources', 'user', '--permission-mode', fullAccess ? 'bypassPermissions' : 'default');
    const cliTask = { ...task, profile: { ...task.profile, args } };
    let cliPolicy = managedAcp || role?.access === 'read' || input.applicationScope ? undefined : await this.configureCli(cliTask,native,snapshot);
    if (cliPolicy && !cliPolicy.available && fullAccess && prepareRestrictedProfile) {
      const fullArgs = [...args.slice(0, -1), 'danger-full-access'];
      cliPolicy = await this.configureCli({ ...cliTask, profile: { ...cliTask.profile, args: fullArgs } }, native, snapshot);
    }
    const available: RunPlanAvailability = { cli: !!this.cli&&this.cliReady&&cliPolicy?.available===true&&role?.access!=='read', mcp: true };
    const skills = managedAcp ? undefined : this.pluginSkills?.describe(snapshot, input.runId, available);
    if (skills) this.pluginSkills!.checkNative(skills, native);
    let skillsMaterialized = false;
    const sources = snapshot.packages.map(p => { const application = this.applications.builtin.retainedMetadata(p.packageHash); return { packageHash: p.packageHash, manifest: application.manifest, capabilities: builtinApplicationModules.capabilityViews(application.manifest) }; });
    const plan = createApplicationRunPlan({ runId: input.runId, snapshotHash: hash, snapshot, applications: sources, skills: skills?.skills ?? [], available, applicationScope: input.applicationScope, sandbox:cliPolicy?.available?{source:cliPolicy.source,digest:cliPolicy.digest}:undefined, cliVersion: input.version });
    const browserEntry = plan.allowed.find(capability=>capability.capabilityId==='browser.tab.create')?.entry;
    const browserMcp = !codex && !managedAcp && browserEntry === 'mcp' ? {
      serverName: server.serverName,
      alwaysLoad: input.applicationScope === 'browser',
      toolNames: plan.allowed.flatMap(capability =>
        capability.mcpTool && ['browser.tab.create', 'browser.nav.goto', 'browser.nav.snapshot'].includes(capability.capabilityId)
          ? [capability.mcpTool] : []),
    } : undefined;
    const resourceIds = [...new Set([`agent-adapter:${snapshot.runner}:${adapter.hash}`, ...snapshot.packages.flatMap(p => ['app:' + p.packageHash, 'runtime:' + p.runtimeHash]), ...snapshot.mcp.map(m => (m.kind === 'applications' ? 'runtime:' : 'legacy-runtime:') + m.runtimeHash)])];
    const verify = async () => {
      this.support.adapters.verify(adapter.hash);
      for (const p of snapshot.packages) { const installed = this.applications.builtin.retainedMetadata(p.packageHash); verifyPackageTree(join(store.root, installed.relativePath), installed, store.storeId); new RuntimeRegistry(store).verify(p.runtimeHash); }
      new RuntimeRegistry(store).verify(server.runtimeHash);
      if (skills && skillsMaterialized) this.pluginSkills!.verify(skills);
    };
    let nativeStarted=false;
    const assertCurrent = () => { input.assertCurrent();if(!nativeStarted&&cliPolicy?.available){if('runner' in cliPolicy)verifyClaudeCliSandbox(cliPolicy);else verifyCodexCliSandbox(cliPolicy);} assertNoPendingApplicationSwitch(store, snapshot); if (skills && skillsMaterialized) this.pluginSkills!.verify(skills); };
    // Per-binding version records coexist with M13's task snapshots; no global session pointer is rewritten.
    store.sqlite.transaction(() => {
      const reserved = store.sqlite.prepare("SELECT c.capability_session_id,c.snapshot_json FROM capability_runs r JOIN agent_capability_sessions c ON c.capability_session_id=r.capability_session_id WHERE r.run_id=? AND r.binding_id=? AND r.state='preparing' AND r.pid IS NULL").get(input.runId, input.bindingId) as { capability_session_id: string; snapshot_json: string } | undefined;
      if (!reserved || JSON.parse(reserved.snapshot_json).kind !== 'run_preparing' || JSON.parse(reserved.snapshot_json).runId !== input.runId) throw new ApplicationError('SNAPSHOT_IMMUTABLE', '本次运行的能力预留已变化，不能替换');
      const frozen = JSON.stringify({ kind: 'business', snapshot, runId: input.runId });
      store.sqlite.prepare('UPDATE agent_capability_sessions SET content_hash=?,snapshot_json=? WHERE capability_session_id=?').run(digest(frozen), frozen, reserved.capability_session_id);
    })();
    const run = await this.runs.adoptAgentRun(input.runId, input.bindingId, { session: { snapshot, pointer: { schema: 3, taskId: task.taskId, snapshotHash: hash }, selectionHash: hash, discoveryHome: task.home, retention: 'active', legacyStatus: 'created' }, resourceIds, bindings, plan, verify, assertCurrent });
    let bridge: Awaited<ReturnType<PrivateApplicationBroker['prepare']>> | undefined;
    try {
      await run.prepare();
      if (skills) {
        assertCurrent();
        // The copied Skill belongs to the prepared run, before any native process or bridge can launch.
        this.pluginSkills!.materialize(skills);
        skillsMaterialized = true;
      }
      store.sqlite.transaction(()=>{for(const resourceId of resourceIds){const resource=store.get(resourceId);for(const [ownerKind,ownerId] of [['run',input.runId],['binding',input.bindingId]])store.sqlite.prepare('INSERT OR IGNORE INTO agent_resource_refs(owner_kind,owner_id,resource_kind,resource_id,hold_reason,created_at) VALUES(?,?,?,?,?,?)').run(ownerKind,ownerId,resource.kind,resourceId,JSON.stringify({contentHash:resource.contentHash,generation:resource.generation}),new Date().toISOString());}})();
      const opensNativeThread = codex || managedAcp;
      bridge = opensNativeThread
        ? await this.broker.reserve(run, server.serverName, assertCurrent)
        : await this.broker.prepare(run, server.serverName, assertCurrent);
      const projectMcp=snapshot.mcp.find(m=>m.kind==='legacy-project-context');let runtime:PreparedRuntime|undefined;
      if(projectMcp){if(native.inventory.some(x=>x.kind==='mcp'&&x.name===projectMcp.serverName))throw new ApplicationError('AGENT_CAPABILITY_NAME_CONFLICT','用户 MCP 已使用项目上下文名称');runtime=this.capabilities.prepare({projectId:task.projectId,taskId:task.taskId,runner:task.profile.runner,cwd:task.cwd,home:task.home,profileArgs:task.profile.args,previous:task.previous,managed:{runId:run.runId,runtimeHash:projectMcp.runtimeHash,mcpName:projectMcp.serverName}});}
      const mcpServers: NonNullable<DriverOpenOptions['mcpServers']> = { [server.serverName]: { command: process.execPath, args: [join(store.root, 'runtime', server.runtimeHash, 'mcp-bridge.cjs'), '--bootstrap', bridge.bootstrapPath], env: { ELECTRON_RUN_AS_NODE: '1' } } };
      if(projectMcp&&runtime)mcpServers[projectMcp.serverName]={command:'python3',args:[join(store.root,'runtime',projectMcp.runtimeHash,'context_mcp.py'),join(store.root,'runs',task.projectId,task.taskId,run.runId,'context.json')],env:{}};
      const extraArgs: string[] = [];
      let cliEnvironment: Record<string, string> = {};
      let claudeSettings: Record<string, unknown> | undefined;
      let codexCliPermissions: string | undefined;
      if(available.cli&&this.cli&&cliPolicy?.available){
        const cliSandbox='runner' in cliPolicy?{runner:'claude-code' as const,endpoint:this.cli.endpoint,kind:cliPolicy.kind,source:cliPolicy.source,digest:cliPolicy.digest}:{endpoint:this.cli.endpoint,kind:cliPolicy.kind,parent:cliPolicy.parent,networkProxy:cliPolicy.networkProxy,enableNetwork:cliPolicy.enableNetwork,existingNames:cliPolicy.existingNames,source:cliPolicy.source,digest:cliPolicy.digest};
        const overlay=this.support.adapters.planLibrary(adapter.hash,{snapshot,runId:run.runId,cliVersion:input.version,currentExecutable:process.execPath,native:{...snapshot.native,runner:snapshot.runner,home:task.home},inventory:native.inventory,planHash:plan.planHash,cliSandbox,mcp:[]});
        if (task.profile.runner === 'codex') {
          extraArgs.push(...overlay.args);
          if (cliSandbox.kind === 'inherit') {
            const namedProfile = overlay.args.find((arg, index) => overlay.args[index - 1] === '-c' && arg.startsWith('default_permissions='));
            codexCliPermissions = /^default_permissions="(wy_cli_[a-f0-9]{12})"$/.exec(namedProfile ?? '')?.[1];
            if (!codexCliPermissions) throw new ApplicationError('INVALID_RESPONSE', 'Codex 业务 CLI 权限配置无法核对');
          }
        } else {
          const at = overlay.args.indexOf('--settings');
          if (at >= 0) claudeSettings = JSON.parse(overlay.args[at + 1]);
        }
        cliEnvironment={...this.cli.issue(run).environment,PATH:dirname(this.options.cliPath!)+delimiter+(task.environment.PATH??'')};
      }
      const role = store.sqlite.prepare("SELECT access FROM agent_delegations WHERE child_task_id=?").get(task.taskId) as { access: string } | undefined;
      if (role?.access === 'read' && task.profile.runner === 'codex') { const disabled = native.inventory.filter(e => e.kind === 'mcp' && e.name !== server.serverName); if (disabled.length) extraArgs.push('-c', `mcp_servers={${disabled.map(e => `${JSON.stringify(e.name)}={enabled=false}`).join(',')}}`); }
      if (task.profile.runner === 'codex') for (const [name, m] of Object.entries(mcpServers)) extraArgs.push('-c', `mcp_servers.${name}={command=${JSON.stringify(m.command)},args=${JSON.stringify(m.args)},env={ELECTRON_RUN_AS_NODE="1"},default_tools_approval_mode="approve",startup_timeout_sec=30,tool_timeout_sec=120}`);
      this.active.set(run.runId, { run,...(runtime?{runtime}:{}) });
      return {
        extraArgs, mcpServers,browserEntry,browserMcp,env:{...runtime?.env,...cliEnvironment},claudeSettings,codexCliPermissions,...(available.cli&&this.options.cliPath?{hostBusinessCli:this.cliProof}:{}),
        plugins: task.profile.runner === 'claude' ? skills?.claudeRoots.map(path => ({ type: 'local' as const, path })) : undefined,
        skillRoots: task.profile.runner === 'codex' ? skills?.codexRoots.map((path, i) => ({ path, name: skills.skills[i].nativeName })) : undefined,
        assertCurrent, beforeFork: async () => { assertCurrent(); if (!opensNativeThread) await bridge!.bridge.arm(); await run.cli.arm(); },
        ...(opensNativeThread ? { beforeThreadOpen: async () => {
          assertCurrent();
          await bridge!.bridge.arm();
          try { bridge!.issue(); }
          catch (error) { await bridge!.bridge.releaseUnclaimed?.(); throw error; }
        } } : {}),
        attached: async pid => {await run.cli.attach(pid);nativeStarted=true;if(!managedAcp)this.applications.nativeMessages.register(run.runId,input.version,run.signal);},
        exited: async () => { await run.cli.exited(); const deadline = Date.now() + 20_000; while (!['stopped', 'failed'].includes(this.runs.get(run.runId).state)) { if (Date.now() >= deadline) throw new ApplicationError('RESOURCE_BUSY', '业务或桥进程尚未排空'); await new Promise(r => setTimeout(r, 50)); } },
        cancelBeforeFork: async () => { this.broker.revokeRun(run.runId); await run.cli.cancelUnforked!(); await bridge!.bridge.releaseUnclaimed?.(); await run.stop('agent-unforked'); },
      };
    } catch (e) {
      this.broker.revokeRun(run.runId);
      await run.cli.cancelUnforked?.().catch(() => {});
      await run.stop('agent-prepare-failed').catch(() => {});
      if (skills) await this.releaseStopped({ run }).catch(() => {});
      throw e;
    }
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
  protected stopWithSkillHistory(taskId:string,entry:ActiveLaunch,reason?:string):Promise<void>{
    const previous=this.stopping.get(entry.run.runId);if(previous)return previous;
    const finish=this.applications.sessionDiagnostics.prepareStop(taskId,entry.run.runId);
    const work=(async()=>{try{await entry.run.stop(reason);}finally{await finish();}await this.releaseStopped(entry);})();
    this.stopping.set(entry.run.runId,work);
    void work.finally(()=>{if(this.stopping.get(entry.run.runId)===work)this.stopping.delete(entry.run.runId);}).catch(()=>{});
    return work;
  }
  protected releaseStopped(entry:ActiveLaunch):Promise<void>{if(this.runs.get(entry.run.runId).state!=='stopped')return Promise.resolve();if(entry.releasing)return entry.releasing;const work=(async()=>{await entry.codex?.stop();if(entry.codex?.recoveryWarnings.length)this.recoveryWarnings.push({homeId:'codex-server:'+entry.run.runId,code:'RESOURCE_RECOVERY_REQUIRED'});entry.runtime?.release();try{this.pluginSkills?.release(entry.run.runId);}catch(error){this.recoveryWarnings.push({homeId:'plugin-skills:'+entry.run.runId,code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}const server=this.recoveryServices.get(entry.run.runId);if(server)this.bridgeRecovery.release(entry.run.runId,server);this.recoveryServices.delete(entry.run.runId);this.active.delete(entry.run.runId);})();entry.releasing=work;void work.catch(()=>{entry.releasing=undefined;});return work;}
  async recoverAgentRun(runId: string) {
    const row = this.support.store.sqlite.prepare('SELECT binding_id FROM capability_runs WHERE run_id=?').get(runId) as { binding_id: string | null } | undefined;
    if (!row?.binding_id) throw new ApplicationError('SCOPE_DENIED', '不是 M14 的原运行');
    return this.runs.recover(runId);
  }
  private async sweep():Promise<void>{if(this.sweeping)return;this.sweeping=true;try{await Promise.allSettled([...this.active.values()].map(entry=>this.releaseStopped(entry)));}finally{this.sweeping=false;}}
  dispose():Promise<void>{if(this.closing)return this.closing;this.closed=true;this.skillObservations.close();clearInterval(this.timer);this.closing=(async()=>{await Promise.allSettled([...this.pending]);const finishes=[...this.active.values()].filter(entry=>!this.stopping.has(entry.run.runId)).map(entry=>this.applications.sessionDiagnostics.prepareStop(this.runs.get(entry.run.runId).taskId,entry.run.runId));const results=await Promise.allSettled([...this.stopping.values(),this.runs.dispose(),this.bridges.dispose(),this.backends.dispose(),this.broker.close(),...(this.cli?[this.cli.close()]:[])]);await Promise.allSettled(finishes.map(finish=>finish()));const deadline=performance.now()+2000;do{await this.sweep();if(!this.active.size)break;await new Promise<void>(done=>setTimeout(done,10));}while(performance.now()<deadline);if(results.some(result=>result.status==='rejected'))throw new ApplicationError('RUN_STOP_FAILED','部分运行关闭尚未完成；私有通道已撤销，未知占用继续保留');})();return this.closing;}
}
