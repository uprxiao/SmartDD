// M13 native terminal fixtures. The production launcher only implements prepareAgent.
import { mkdirSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';
import { ApplicationError } from '@shared/applications';
import type { CapabilitySessionSnapshot } from '@shared/application-session';
import type { RuntimeSnapshot } from '@shared/capabilities';
import { MCP_CAPABILITY, type CapabilityService, type PreparedRuntime } from '../capabilities/capability-service';
import type { TaskCapabilityLaunch, TaskCapabilityLauncher } from '../tasks/capability-lifecycle';
import { withShellProxy } from '../ai/runner-detect';
import { ManagedTaskCapabilities, type ActiveLaunch, type TaskCapabilityLauncherOptions } from './task-capability-launcher';
import type { AgentSupportService } from './agent-support-service';
import type { ApplicationService } from './application-service';
import type { OwnedCapabilityRun } from './run-registry';
import type { StoredCapabilitySession } from './session-registry';
import type { NativeLaunchContext, TaskLaunchInput } from './native-launch-context';
import { canonicalJson, digest } from './manifest';
import { nativeCapabilityPreparation } from './native-preparation-diagnostics';
import { nativeCapabilityConflicts } from './native-application-conflicts';
import { withCoordinatorLock } from './coordinator-lock';
import { withResourceLock } from './resource-lock';
import { ensureStoreDirectory } from './package-files';
import type { ManagedCapabilityRestriction } from './launch-restriction';
import { codexProfileArgsForCli } from './codex-effective-sandbox';
import { legacyRuntimeMetadata } from './legacy-task-evidence';
import { prepareCodexTaskServer } from './codex-task-server';
import { codexClientArgs } from './codex-client-args';
import { verifyClaudeCliSandbox } from './claude-effective-sandbox';
import { verifyCodexCliSandbox } from './codex-effective-sandbox';
import { builtinApplicationModules } from './modules';
import { selectCapabilityEntry } from './run-plan';
import type { FrozenPluginSkillSet } from './plugins/frozen-skills';
import type { CliSandboxPlan } from './capability-delivery-adapters';
import { assertNoPendingApplicationSwitch } from './application-run-policy';
import type { PrivateApplicationBroker } from './private-broker';
import type { CodexTaskServerRequest } from './codex-task-server';

export class TerminalTaskCapabilityFixture extends ManagedTaskCapabilities implements TaskCapabilityLauncher {
  static override async open(support: AgentSupportService, capabilities: CapabilityService, applications: ApplicationService, options: TaskCapabilityLauncherOptions) {
    const fixture = new TerminalTaskCapabilityFixture(support, capabilities, applications, options);
    await fixture.initialize();
    return fixture;
  }

  coordinateRestore<T>(work:()=>Promise<T>,signal:AbortSignal):Promise<T>{
    // Separate H scope: serialize restore/copy admissions across normal hosts,
    // including different tasks targeting the same native SID. Never hold C over I/O.
    return withCoordinatorLock(ensureStoreDirectory(this.support.store.root,'locks/native-history'),'catalog',work,{signal,timeoutMs:15000,processes:this.processes});
  }
  async assertHistoryCopyAllowed(input:{taskId:string;from:string;to:string;cwd:string;sessionId:string;home:string}):Promise<void>{
    await withResourceLock(this.support.store.root,()=>{this.sessions.assertHistoryCopyAllowed(input);});
  }
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
  prepare(input:TaskLaunchInput):Promise<TaskCapabilityLaunch>{const work=this.prepareOnce(input);this.pending.add(work);void work.finally(()=>{this.pending.delete(work);this.planningAgents.delete(input.taskId);this.planningCliPolicies.delete(input.taskId);}).catch(()=>{});return work;}
  private async prepareOnce(input:TaskLaunchInput):Promise<TaskCapabilityLaunch>{
    if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','任务能力准备已取消');
    let native:NativeLaunchContext|undefined,unavailable:string|undefined;
    try{const delivery=this.support.adapters.deliveryAdapters.forRunner(input.profile.runner);native=await(this.options.inspectNative??delivery.inspectNative).call(delivery,input);}catch(error){if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;if(!(error instanceof ApplicationError)||error.code!=='AGENT_ADAPTER_UNSUPPORTED')throw error;unavailable=error.code;}
    if(native)this.planningAgents.set(input.taskId,native);
    // Later native checks and the CLI PATH must see the terminal's PATH; the app's own PATH is bare when started from the Dock.
    // D06-79: carry the login shell's proxy variables with its PATH (a Finder/Dock launch inherits neither).
    return this.prepareCurrent(native?.shellPath?{...input,environment:withShellProxy({...input.environment,PATH:native.shellPath},native.shellProxy)}:input,native,unavailable);
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
      await this.sessions.verifyNativeIdentity(input.taskId,{runner,stateRoot:input.nativeRestore?.from??input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});
      if(this.applications.plugins||input.nativeRestore)return{adapterHash:hash,current:await this.sessions.adoptLibrary(input.taskId,current.pointer.snapshotHash,this.createLibrarySnapshot(input,native.version,hash),{
        copy:input.nativeRestore,home:input.home,commit:input.commitSessionSnapshot?(before,after)=>{
          if(input.signal.aborted)throw new ApplicationError('CANCELED','历史目录提交已取消');
          input.commitSessionSnapshot!({pointer:before.pointer,native:before.snapshot.native},{pointer:after.pointer,native:after.snapshot.native});
        }:undefined,
      })};
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
  private async prepareLibrary(input:TaskLaunchInput,native:NativeLaunchContext,selected:{adapterHash:string;current?:StoredCapabilitySession}):Promise<TaskCapabilityLaunch>{
    let current=selected.current;
    if(!current){
      current=await this.sessions.create(this.createLibrarySnapshot(input,native.version,selected.adapterHash),input.home);
      await this.sessions.addLegacyRuntimeReference(input.taskId,current.pointer.snapshotHash,this.capabilities.runtimeIdentity().hash);
    }
    const snapshot=current.snapshot,stored=current;
    // M10 rule kept in R1.0: while a stop-before-switch connection change is pending, no run of the project forks.
    let frozenSkills:FrozenPluginSkillSet|undefined,frozenPolicy:CliSandboxPlan|undefined;
    const gate=()=>{if(frozenPolicy){if('runner'in frozenPolicy)verifyClaudeCliSandbox(frozenPolicy);else verifyCodexCliSandbox(frozenPolicy);}assertNoPendingApplicationSwitch(this.support.store,{projectId:input.projectId,packages:this.selectedApps(input.projectId)});if(frozenSkills){this.pluginSkills!.verify(frozenSkills);if(snapshot.schema===3&&canonicalJson(this.applications.plugins?.selections(input.projectId)??[])!==canonicalJson(snapshot.externalPlugins??[]))throw new ApplicationError('RESOURCE_STATE_CHANGED','启动前插件或连接选择已变化，请重新启动');}};gate();
    this.syncSkillLibrary(input.profile.runner==='claude'?input.stateRoot:undefined);
    await this.configureCli(input,native,snapshot);
    const checkedPolicy=this.planningCliPolicies.get(input.taskId);if(checkedPolicy?.available)frozenPolicy=checkedPolicy;
    if(this.support.adapters.versionSupport(snapshot.adapterBinding.hash,native.version)==='unsupported')return this.prepareUnavailableSession(input,stored,native,'AGENT_ADAPTER_UNSUPPORTED');
    const bridgeReady=!snapshot.mcp.some(m=>m.kind==='applications')||await(this.options.probeApplicationRuntime?.(input.signal)??this.embeddedNode.check(input.signal));
    const run=await this.runs.reserve({taskId:input.taskId,snapshotHash:stored.pointer.snapshotHash,bindings:this.applications.builtinPreferences.capture(input.projectId),bindingMode:'run'}),entry:ActiveLaunch={run};this.active.set(run.runId,entry);
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
      if(planned.grades.cli&&this.cli&&policy?.available){
        cliSandbox='runner'in policy?{runner:'claude-code',endpoint:this.cli.endpoint,kind:policy.kind,source:policy.source,digest:policy.digest}:{endpoint:this.cli.endpoint,kind:policy.kind,parent:policy.parent,networkProxy:policy.networkProxy,enableNetwork:policy.enableNetwork,existingNames:policy.existingNames,source:policy.source,digest:policy.digest};
        cliEnvironment=this.cli.issue(run).environment;runtime.secretValues.push(cliEnvironment.WILLYOU_RUN_TOKEN);
      }
      const bridgeEntry=mcp.find(m=>m.kind==='applications');let bridge:Awaited<ReturnType<PrivateApplicationBroker['prepare']>>|undefined;
      if(bridgeEntry){bridge=await this.broker.prepare(run,bridgeEntry.serverName);bridgeEntry.args[2]=bridge.bootstrapPath;}
      const profileArgs=cliEnvironment&&policy?.available&&!('runner'in policy)?codexProfileArgsForCli(input.profile.args,policy,native.version):input.profile.args;
      let clientProfileArgs:string[]|undefined;
      const launchEnvironment=cliEnvironment?{...runtime.env,...cliEnvironment,PATH:dirname(this.options.cliPath!)+delimiter+(input.environment.PATH??'')}:runtime.env;
      // A plan the adapter still refuses (another collision, unsupported mechanism) leaves the ordinary Agent: native only.
      let plan:import('@shared/agent-adapters').AgentLoadPlan|undefined,planIssue:'AGENT_ADAPTER_UNSUPPORTED'|'AGENT_CAPABILITY_NAME_CONFLICT'|undefined;
      try{plan=this.support.adapters.planLibrary(snapshot.adapterBinding.hash,{snapshot,runId:run.runId,cliVersion:native.version,currentExecutable:process.execPath,native:{...snapshot.native,runner:snapshot.runner,home:input.home},inventory:native.inventory,planHash:planned.planHash,...(cliSandbox?{cliSandbox}:{}),mcp});
        if((snapshot.runner==='claude-code'||snapshot.runner==='codex'&&native.version==='0.167.1')&&this.pluginSkills&&bridgeReady&&!appConflict){const set=this.pluginSkills.describe(snapshot,run.runId,this.cliAvailability(input.taskId));if(canonicalJson(set?.skills??[])!==canonicalJson(planned.skills))throw new ApplicationError('RESOURCE_STATE_CHANGED','插件 Skill 来源在准备期间已变化');if(set){this.pluginSkills.checkNative(set,native);this.pluginSkills.materialize(set);frozenSkills=set;
          if(snapshot.runner==='claude-code')plan.args.push(...set.claudeRoots.flatMap(root=>['--plugin-dir',root]));
          else{const request:CodexTaskServerRequest={task:input,native,run,skills:set,profileArgs:[...profileArgs],managedArgs:[...plan.args],environment:{...launchEnvironment},storeId:this.support.store.storeId};entry.codex=await(this.options.prepareCodexServer?.(request)??prepareCodexTaskServer(request,this.backends,this.processes));const client=codexClientArgs(profileArgs,plan.args,input.mode==='resume');clientProfileArgs=client.profile;plan.args=[...client.managed,'--remote',entry.codex.url];}
        }}
      }
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
        phase='restricting';this.broker.revokeRun(run.runId);this.cli?.revokeRun(run.runId);await entry.codex?.stop();await bridge?.bridge.cancelBeforeLaunch();
        await this.runs.restrictToNative(run.runId,cause);effective=false;prepared.release();prepared=this.unavailableRuntime(input,stored,run.runId,cause?.issueCode??'AGENT_ADAPTER_UNSUPPORTED');
        prepared.snapshot.selfCheck?.issues.push(reason);entry.runtime=prepared;launch.runtime=prepared;launch.args=[];launch.profileArgs=undefined;launch.env={};launch.initialInput=undefined;phase='native-only';return launch;
      };
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args:plan?.args??[],profileArgs:clientProfileArgs??(cliEnvironment&&policy?.available?profileArgs:undefined),env:launchEnvironment,command:native.command,
        ...(entry.codex?.initializationProcess?{codexInitializer:()=>entry.codex!.initializationProcess!()}:{}),
        assertBeforeFork:()=>{if(effective)gate();},
        nativeOnly:reason=>narrow(reason),
        beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','启动已取消或窗口已使用');const nativeOnly=phase==='native-only';if(effective)gate();phase='arming';if(!nativeOnly&&effective){await entry.codex?.start();gate();await bridge?.bridge.arm();}await run.cli.arm();},
        spawned:async pid=>{await run.cli.attach(pid??0);if(effective)this.skillObservations.start(input.taskId,run.runId,run.signal);},
        initialInput:(sender,text)=>this.applications.nativeInputs.observeLaunch(sender,{taskId:input.taskId,ptyId:run.ptyId},text),
        cancelBeforeFork:async()=>{if(entry.codex){await run.cli.cancelUnforked!();await run.stop('native-fork-not-attempted');await entry.codex.stop();}else await run.cancelBeforeFork();await this.releaseStopped(entry);},spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>this.stopWithSkillHistory(input.taskId,entry,reason),
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
  tombstone(taskId:string):Promise<void>{return this.sessions.tombstone(taskId);}
  activeTaskIds(projectId:string):ReadonlySet<string>{return new Set((this.support.store.sqlite.prepare("SELECT task_id AS id FROM capability_runs WHERE project_id=? AND state NOT IN ('stopped','failed')").all(projectId) as {id:string}[]).map(r=>r.id));}
}
