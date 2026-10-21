import {ClaudeDeliveryCoordinator} from './claude-delivery';
import type {ClaudeDeliveryToken,ClaudeRunDelivery} from './claude-delivery-state';
import {inspectApplicationResources} from './application-resource-availability';
import {assertNoPendingApplicationSwitch} from './application-run-policy';
import { mkdirSync, writeFileSync,lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { ApplicationError } from '@shared/applications';
import type { AgentLoadRequest,LegacyAgentLoadRequest,AgentLoadPlan } from '@shared/agent-adapters';
import { applicationMcpServerName, applicationNativeSkillName, type CapabilitySessionSnapshotV2 } from '@shared/application-session';
import type { RuntimeSkill, RuntimeSnapshot } from '@shared/capabilities';
import { CapabilityService, MCP_CAPABILITY, type PreparedRuntime } from '../capabilities/capability-service';
import type { TaskCapabilityLaunch, TaskCapabilityLauncher } from '../tasks/capability-lifecycle';
import type { AgentSupportService } from './agent-support-service';
import type { ApplicationService } from './application-service';
import { CapabilitySessionRegistry, selectionHash, applicationSkillContentHash, canonicalFuturePath, type StoredCapabilitySession } from './session-registry';
import { SessionCapabilityProjector, standardNativeSkillName } from './session-projector';
import { CapabilityRunRegistry, type RunBindingRevision, type OwnedCapabilityRun } from './run-registry';
import { DiscoveryCatalog, type DiscoveryReservation } from './discovery-catalog';
import { ApplicationAdapterRegistry } from './application-adapter-registry';
import { ApplicationToolService } from './tool-service';
import { PrivateApplicationBroker } from './private-broker';
import { AgentBridgeProcesses } from './agent-bridge-processes';
import { MacProcessIdentityReader, type ProcessIdentityReader } from './process-identity';
import { MacUnixPeerIdentityReader, type UnixPeerIdentityReader } from './unix-peer-identity';
import { inspectNativeLaunch, type NativeLaunchContext, type TaskLaunchInput } from './native-launch-context';
import { canonicalJson, digest } from './manifest';
import {legacyRuntimeMetadata} from './legacy-task-evidence';
import {LegacyTaskRetention} from './legacy-task-retention';
import {LegacyOriginalPlugin} from './legacy-original-plugin';
import {LegacyOriginalCodex} from './legacy-original-codex';
import {LegacyDiscoveryInventory} from './legacy-discovery-inventory';
import {LegacySessionMigration} from './legacy-session-migration';
import {LegacyPluginSources,legacyPluginOrigin} from './legacy-plugin-source';
import {assertLegacySessionSource,retainedLegacySource} from './legacy-session-source';
import {BuiltinPackageRegistry} from './builtin-package-registry';
import {RuntimeRegistry} from './runtime-registry';
interface ActiveLaunch {run:OwnedCapabilityRun;hold?:DiscoveryReservation;runtime?:PreparedRuntime;releasing?:Promise<void>}
export interface TaskCapabilityLauncherOptions {
  helper: string;
  stopPty(ptyId:string):void;
  processes?:ProcessIdentityReader;
  peers?:UnixPeerIdentityReader;
  inspectNative?:(input:TaskLaunchInput)=>Promise<NativeLaunchContext>;
  pollMs?:number;
}
/** Production composition. Credentials, native PIDs and resource identities never come from RPC. */
export class ManagedTaskCapabilities implements TaskCapabilityLauncher {
  readonly sessions:CapabilitySessionRegistry;
  readonly projector:SessionCapabilityProjector;
  readonly legacyMigration:LegacySessionMigration;
  readonly runs:CapabilityRunRegistry;
  readonly bridges:AgentBridgeProcesses;
  readonly broker:PrivateApplicationBroker;
  readonly claudeDelivery:ClaudeDeliveryCoordinator;
  private readonly catalogs=new Map<string,DiscoveryCatalog>();
  private readonly active=new Map<string,ActiveLaunch>();
  private readonly initialApplicationScopes=new Map<string,{selectionHash:string;appIds:readonly string[]}>();
  private readonly pending=new Set<Promise<TaskCapabilityLaunch>>();
  private readonly processes:ProcessIdentityReader;
  private readonly timer:ReturnType<typeof setInterval>;
  readonly recoveryWarnings:{homeId:string;code:string}[]=[];
  readonly legacyPreparationWarnings=new Map<string,string>();
  private readonly legacyRetention:LegacyTaskRetention;
  private closed=false;private closing?:Promise<void>;private sweeping=false;
  private constructor(private readonly support:AgentSupportService,private readonly capabilities:CapabilityService,private readonly applications:ApplicationService,private readonly options:TaskCapabilityLauncherOptions){
    const store=support.store;this.legacyRetention=new LegacyTaskRetention(store);this.processes=options.processes??new MacProcessIdentityReader(options.helper);
    this.sessions=new CapabilitySessionRegistry(store,{assertInitialSelection:snapshot=>this.assertInitialSelection(snapshot),verifyExtraResource:(resource,snapshot)=>{
      if(resource.kind==='agent-adapter')support.adapters.verifyReference(resource,snapshot);
      else if(['session-projection','claude-projection-source','claude-projection-archive','claude-delivery'].includes(resource.kind))this.projector.verify(resource,snapshot);
      else if(resource.kind==='agent-projection'){const identity=store.sqlite.prepare('SELECT discovery_home AS home FROM capability_session_identities WHERE task_id=?').get(snapshot.taskId) as {home:string}|undefined;if(!identity)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原生发现根缺失');this.catalog(identity.home).verifyReference(resource,snapshot);}
      else if(resource.kind==='legacy-agent-projection'){const identity=store.sqlite.prepare('SELECT discovery_home AS home FROM capability_session_identities WHERE task_id=?').get(snapshot.taskId) as {home:string}|undefined;if(!identity)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享发现根缺失');new LegacyOriginalCodex(store,this.catalog(identity.home)).verify(resource,snapshot);}
      else if(resource.kind==='legacy-static-plugin')new LegacyOriginalPlugin(store).verify(resource,snapshot);
      else if(resource.kind==='legacy-plugin-source')new LegacyPluginSources(store).verify(resource,legacyPluginOrigin(assertLegacySessionSource(store,snapshot).evidence));
      else support.legacy.verify(resource);
    }});
    this.legacyMigration=new LegacySessionMigration(store,this.sessions,undefined,home=>this.catalog(home));
    this.projector=new SessionCapabilityProjector(store,this.sessions);
    this.runs=new CapabilityRunRegistry(store,this.sessions,{processes:this.processes,assertCurrent:snapshot=>{
      // Application enablement and current slots belong to each business call, not Agent liveness.
      const project=store.sqlite.prepare('SELECT archived_at FROM projects WHERE id=?').get(snapshot.projectId) as {archived_at:number|null}|undefined;
      if(!project||project.archived_at!==null)throw new ApplicationError('SCOPE_DENIED','项目已删除或归档，不能继续使用此运行');
    },revoke:runId=>{this.broker?.revokeRun(runId);this.bridges?.revokeRun(runId);const entry=this.active.get(runId);if(entry)this.options.stopPty(entry.run.ptyId);}});
    this.claudeDelivery=new ClaudeDeliveryCoordinator(store,this.sessions,this.projector,this.processes,this.runs.instanceId);
    this.bridges=new AgentBridgeProcesses(this.runs,options.peers??new MacUnixPeerIdentityReader(options.helper),this.processes,{pollMs:options.pollMs});
    this.broker=new PrivateApplicationBroker(this.runs,new ApplicationToolService(store,this.runs,new ApplicationAdapterRegistry(store,applications.data)),{attachPeer:(socket,runId,bridge)=>this.bridges.attach(socket,runId,bridge),authenticated:(runId,bridgeId)=>applications.sessionDiagnostics.bridgeAuthenticated(runId,bridgeId)});
    applications.sessionDiagnostics.attach({channelConnected:id=>this.broker.hasAuthenticated(id),verify:(resource,snapshot,home)=>{
      if(resource.kind==='agent-adapter')support.adapters.verifyReference(resource,snapshot);
      else if(['session-projection','claude-projection-source','claude-projection-archive','claude-delivery'].includes(resource.kind))this.projector.verify(resource,snapshot);
      else if(resource.kind==='agent-projection'){const catalog=this.catalogs.get(home);if(!catalog)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享发现目录尚未核查');catalog.verifyReference(resource,snapshot);}
      else if(resource.kind==='legacy-agent-projection'){const catalog=this.catalogs.get(home);if(!catalog)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享发现目录尚未核查');new LegacyOriginalCodex(store,catalog).verify(resource,snapshot);}
      else if(resource.kind==='legacy-static-plugin')new LegacyOriginalPlugin(store).verify(resource,snapshot);
      else if(resource.kind==='legacy-plugin-source')new LegacyPluginSources(store).verify(resource,legacyPluginOrigin(assertLegacySessionSource(store,snapshot).evidence));
      else support.legacy.verify(resource);
    }});
    this.timer=setInterval(()=>{void this.sweep();},Math.max(20,options.pollMs??500));this.timer.unref();
  }
  static async open(support:AgentSupportService,capabilities:CapabilityService,applications:ApplicationService,options:TaskCapabilityLauncherOptions):Promise<ManagedTaskCapabilities>{
    const result=new ManagedTaskCapabilities(support,capabilities,applications,options);
    try{await result.runs.recover();
      const roots=support.store.sqlite.prepare('SELECT home_id AS id,canonical_home AS home FROM capability_discovery_roots').all() as {id:string;home:string}[];
      for(const root of roots){try{if(root.home!==canonicalFuturePath(root.home)||digest(root.home)!==root.id)throw new ApplicationError('OWNERSHIP_CONFLICT','原发现根身份不同');await result.catalog(root.home).recoverConsumers();}catch(error){result.recoveryWarnings.push({homeId:root.id,code:error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED'});}}
      await result.broker.start();applications.attachRuns(result.runs);return result;}catch(error){await result.dispose();throw error;}
  }
  private catalog(home:string):DiscoveryCatalog{const key=canonicalFuturePath(home);let value=this.catalogs.get(key);if(!value){value=new DiscoveryCatalog(this.support.store,key,this.processes,{instanceId:this.runs.instanceId});this.catalogs.set(key,value);}return value;}
  private bindings(projectId:string,appIds:readonly string[]):RunBindingRevision[]{
    return appIds.flatMap(appId=>{const slots=appId==='zentao'?['zentao'] as const:['foxmail','smtp'] as const;return slots.map(slot=>{
      const row=this.support.store.sqlite.prepare('SELECT b.connection_id,b.identity_revision,r.revision FROM application_binding_slot_revisions r LEFT JOIN application_project_bindings b ON b.project_id=r.project_id AND b.app_id=r.app_id AND b.slot=r.slot WHERE r.project_id=? AND r.app_id=? AND r.slot=?').get(projectId,appId,slot) as {connection_id:string|null;identity_revision:number|null;revision:number}|undefined;
      if(!row)throw new ApplicationError('CONFIG_COMPATIBILITY_UNVERIFIED','项目连接槽修订缺失');return{appId,slot,connectionId:row.connection_id,identityRevision:row.identity_revision,bindingRevision:row.revision};
    });});
  }
  /** SQL-only recheck under C. Selection is checked once; later calls use current business policy. */
  private assertInitialSelection(snapshot:CapabilitySessionSnapshotV2):void{
    const planned=this.initialApplicationScopes.get(snapshot.taskId);if(planned&&planned.selectionHash!==selectionHash(snapshot))throw new ApplicationError('RESOURCE_STATE_CHANGED','本轮应用范围与原固定选择不同');
    assertNoPendingApplicationSwitch(this.support.store,planned?{projectId:snapshot.projectId,packages:snapshot.packages.filter(p=>planned.appIds.includes(p.appId))}:snapshot);
    const store=this.support.store,apps=this.selectedApps(snapshot.projectId);
    if(canonicalJson(apps)!==canonicalJson(snapshot.packages.map(p=>({appId:p.appId,packageHash:p.packageHash}))))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目应用或默认版本已变化');
    const actual=store.sqlite.prepare('SELECT v.skill_id AS skillId,v.id AS versionId,v.hash FROM skill_versions v LEFT JOIN project_capabilities p ON p.id=? || v.skill_id WHERE v.active=1 AND COALESCE(p.enabled,1)=1 ORDER BY v.skill_id').all(snapshot.projectId+':');
    const expected=snapshot.standardSkills.map(s=>({skillId:s.skillId,versionId:s.versionId,hash:s.hash})).sort((a,b)=>a.skillId.localeCompare(b.skillId));
    if(canonicalJson(actual)!==canonicalJson(expected))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间标准Skill选择已变化');
    const bindings=this.bindings(snapshot.projectId,snapshot.packages.map(p=>p.appId));
    for(const app of snapshot.packages){const current=bindings.filter(b=>b.appId===app.appId&&b.connectionId).map(b=>({bindingId:`${snapshot.projectId}:${app.appId}:${b.slot}`,connectionId:b.connectionId!,identityRevision:b.identityRevision!}));if(canonicalJson(current)!==canonicalJson(app.bindings))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目连接选择已变化');}
    const context=this.capabilities.enabled(snapshot.projectId,MCP_CAPABILITY);
    if(context!==snapshot.mcp.some(m=>m.kind==='legacy-project-context'))throw new ApplicationError('RESOURCE_STATE_CHANGED','准备期间项目上下文选择已变化');
  }
  private selectedApps(projectId:string):{appId:string;packageHash:string}[]{
    const rows=this.support.store.sqlite.prepare('SELECT s.app_id AS appId FROM application_project_settings s JOIN application_catalog_state c ON c.app_id=s.app_id WHERE s.project_id=? AND s.enabled=1 AND c.added=1 AND c.enabled=1 ORDER BY s.app_id').all(projectId) as {appId:string}[];
    return rows.map(({appId})=>{const active=this.applications.builtin.packages.active(appId);if(!active)throw new ApplicationError('CAPABILITY_UNAVAILABLE','选用应用尚无可用的默认版本');return{appId,packageHash:active.packageHash};});
  }
  private createSnapshot(input:TaskLaunchInput,native:NativeLaunchContext|undefined,generation:string):CapabilitySessionSnapshotV2{
    const runner=input.profile.runner==='claude'?'claude-code':'codex',adapter=this.support.status().adapters.find(a=>a.agentId===runner&&a.version==='1.0.0');
    if(!adapter)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','本版本未准备此Agent适配资源');
    const skillPath=(name:string)=>join(runner==='codex'?join(canonicalFuturePath(input.home),'.agents/skills'):join(this.support.store.root,'sessions',input.taskId,'claude/plugin/skills'),name,'SKILL.md');
    const appMcp=applicationMcpServerName(digest(input.taskId)),bindings=this.bindings(input.projectId,this.selectedApps(input.projectId).map(a=>a.appId));
    const packages=this.selectedApps(input.projectId).map(({packageHash})=>{const p=this.applications.builtin.retainedMetadata(packageHash),m=p.manifest;return{appId:p.appId,version:p.version,packageHash,hashAlgorithm:'app-manifest-v1' as const,hostApi:m.hostApi,dataApi:m.dataApi,runtimeHash:m.runtime.hash,toolContractMajors:Object.fromEntries(m.tools.map(t=>[t.name,t.contractMajor])),skills:m.skills.map(s=>{const name=applicationNativeSkillName(p.appId,s.id,packageHash);return{skillId:s.id,nativeName:name,contentHash:applicationSkillContentHash(m,s.path),sourceRelativePath:s.path,projectionPath:skillPath(name)};}),bindings:bindings.filter(b=>b.appId===p.appId&&b.connectionId).map(b=>({bindingId:`${input.projectId}:${p.appId}:${b.slot}`,connectionId:b.connectionId!,identityRevision:b.identityRevision!})),allowedOperations:[...m.permissions]};});
    const runtimeHashes=[...new Set(packages.map(p=>p.runtimeHash))];if(runtimeHashes.length>1)throw new ApplicationError('HOST_INCOMPATIBLE','本次应用选择使用了不兼容的桥运行版本');
    const mcp:CapabilitySessionSnapshotV2['mcp']=packages.length?[{kind:'applications',serverName:appMcp,protocolMajor:1,runtimeHash:runtimeHashes[0]}]:[];
    if(this.capabilities.enabled(input.projectId,MCP_CAPABILITY))mcp.push({kind:'legacy-project-context',serverName:'smartdd_project_'+digest(input.taskId).slice(0,12),protocolMajor:1,runtimeHash:this.capabilities.runtimeIdentity().hash});
    return{schema:2,taskId:input.taskId,projectId:input.projectId,createdAt:new Date().toISOString(),runner,adapterBinding:{id:runner,version:adapter.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:Object.fromEntries(packages.flatMap(p=>Object.keys(p.toolContractMajors).map(name=>[name,'mcp__'+appMcp+'__'+name])))},native:{sessionId:input.sessionId,stateRoot:input.stateRoot,cwd:input.cwd},agentAtCreation:{version:native?.version??'unverified',adapterRevision:1},catalogGeneration:generation,packages,standardSkills:this.capabilities.selection(input.projectId).filter(s=>s.enabled).map(s=>({skillId:s.skillId,versionId:s.versionId,hash:s.hash,hashAlgorithm:'legacy-tree-v1',projectionPath:skillPath(standardNativeSkillName(s.skillId,s.hash))})),mcp,provenance:'created'};
  }
  prepare(input:TaskLaunchInput):Promise<TaskCapabilityLaunch>{const work=this.prepareOnce(input);this.pending.add(work);void work.finally(()=>this.pending.delete(work)).catch(()=>{});return work;}
  private async prepareOnce(input:TaskLaunchInput):Promise<TaskCapabilityLaunch>{
    if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','任务能力准备已取消');
    let native:NativeLaunchContext|undefined,unavailable:string|undefined;
    try{native=await(this.options.inspectNative??inspectNativeLaunch)(input);}catch(error){if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;if(!(error instanceof ApplicationError)||error.code!=='AGENT_ADAPTER_UNSUPPORTED')throw error;unavailable=error.code;}
    const catalog=this.catalog(input.home);let current:StoredCapabilitySession|undefined;
    if(input.profile.runner==='codex')try{await new LegacyDiscoveryInventory(this.support.store,catalog).prepare(input.signal);}catch(error){if(input.signal.aborted||error instanceof ApplicationError&&['CANCELED','RESOURCE_BUSY'].includes(error.code))throw error;if(!(error instanceof ApplicationError))throw error;unavailable??=error.code==='OWNERSHIP_CONFLICT'?'AGENT_CAPABILITY_NAME_CONFLICT':error.code;}
    if(input.previous?.sessionCapabilities){
      const pointer=input.previous.sessionCapabilities;if(pointer.taskId!==input.taskId)throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针不属于当前会话');current=await this.sessions.get(input.taskId);
      if(current.snapshot.projectId!==input.projectId)throw new ApplicationError('SNAPSHOT_CORRUPT','任务项目与原固定快照身份不符，保留原记录且不恢复应用能力');
      if(current.pointer.snapshotHash!==pointer.snapshotHash)throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针与原会话快照不同');
      await this.sessions.verifyNativeIdentity(input.taskId,{runner:input.profile.runner==='claude'?'claude-code':'codex',stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});
    }else{
      if(!input.newTask){
        if(input.previous&&!legacyRuntimeMetadata.safeParse(input.previous).success)throw new ApplicationError('SNAPSHOT_CORRUPT','原能力快照格式不支持，保留原记录并阻止受管恢复');
        const recorded=this.support.store.sqlite.prepare('SELECT schema_version,legacy_status FROM capability_session_snapshots WHERE task_id=?').get(input.taskId) as {schema_version:number;legacy_status:string}|undefined;
        if(recorded&&(recorded.schema_version!==0||recorded.legacy_status!=='history-unknown'))throw new ApplicationError('SNAPSHOT_CORRUPT','任务指针缺失或原历史已待核查，保留原登记且不降级重建');
        await this.sessions.holdUnknown({taskId:input.taskId,projectId:input.projectId,runner:input.profile.runner==='claude'?'claude-code':'codex',stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,reason:'history-unknown'});
        if(input.previous){
          try{await this.legacyRetention.prepare({taskId:input.taskId,projectId:input.projectId,runner:input.profile.runner==='claude'?'claude-code':'codex',stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home},input.previous,input.signal);this.legacyPreparationWarnings.delete(input.taskId);}
          catch(error){if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;if(this.legacyPreparationWarnings.size>=256&&!this.legacyPreparationWarnings.has(input.taskId))this.legacyPreparationWarnings.delete(this.legacyPreparationWarnings.keys().next().value!);this.legacyPreparationWarnings.set(input.taskId,error instanceof ApplicationError?error.code:'RESOURCE_RECOVERY_REQUIRED');}
        }
        const sourceState=(this.support.store.sqlite.prepare('SELECT state FROM capability_legacy_migration_preparations WHERE task_id=?').get(input.taskId) as {state:string}|undefined)?.state;
        if(native&&!unavailable&&sourceState==='prepared')try{
          const source=retainedLegacySource(this.support.store,input.taskId,'prepared');
          // An intact old transient tree is not authority to dispose/adopt a
          // prior native owner. Known normal cleanup leaves the durable source.
          if(this.originalTransientAbsent(source.snapshot.manifestPath)){
            const runner=input.profile.runner==='claude'?'claude-code':'codex',adapter=this.support.status().adapters.find(a=>a.agentId===runner&&a.version==='1.1.0');
            if(!adapter)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','尚未准备原格式适配资源');
            current=(await this.legacyMigration.migrate({identity:{taskId:input.taskId,projectId:input.projectId,runner,stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home},sourceSnapshotHash:source.row.source_snapshot_hash,adapterHash:adapter.hash,cliVersion:native.version,catalogGeneration:(await catalog.snapshot()).generation},input.signal)).session;
            this.legacyPreparationWarnings.delete(input.taskId);
          }
        }catch(error){
          if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;
          if(!(error instanceof ApplicationError))throw error;
          if(this.legacyPreparationWarnings.size>=256&&!this.legacyPreparationWarnings.has(input.taskId))this.legacyPreparationWarnings.delete(this.legacyPreparationWarnings.keys().next().value!);
          this.legacyPreparationWarnings.set(input.taskId,error.code);unavailable=error.code;
          const converted=this.support.store.sqlite.prepare('SELECT schema_version FROM capability_session_snapshots WHERE task_id=?').get(input.taskId) as {schema_version:number}|undefined;
          if(converted?.schema_version===2)current=await this.sessions.get(input.taskId);
        }
        if(!current)return this.prepareNativeHistory(input,native,unavailable,catalog);
      }else{
      const planned=this.createSnapshot(input,native,(await catalog.snapshot()).generation);
      const plannedReady=inspectApplicationResources(this.support.store,planned.packages).filter(p=>p.state==='ready').map(p=>p.appId),plannedScope=plannedReady.length<planned.packages.length?plannedReady:undefined;
      assertNoPendingApplicationSwitch(this.support.store,plannedScope?{projectId:planned.projectId,packages:planned.packages.filter(p=>plannedScope.includes(p.appId))}:planned);
      const adapter=this.support.adapters.get(planned.adapterBinding.hash);
      if(native&&!adapter.metadata.cliVersions.includes(native.version))unavailable='AGENT_ADAPTER_UNSUPPORTED';
      if(planned.runner==='codex'&&!unavailable){
        try{planned.catalogGeneration=(await catalog.publish(this.projector.sourceSkills(planned,plannedScope,plannedScope?.length===0),{signal:input.signal})).generation;}
        catch(error){if(error instanceof ApplicationError&&error.code==='OWNERSHIP_CONFLICT')unavailable='AGENT_CAPABILITY_NAME_CONFLICT';else throw error;}
      }
      if(plannedScope)this.initialApplicationScopes.set(planned.taskId,{selectionHash:selectionHash(planned),appIds:Object.freeze([...plannedScope])});
      try{current=await this.sessions.create(planned,input.home,plannedScope);}finally{this.initialApplicationScopes.delete(planned.taskId);}
      await this.sessions.addLegacyRuntimeReference(input.taskId,current.pointer.snapshotHash,this.capabilities.runtimeIdentity().hash);
      }
    }
    if(!current)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原会话固定快照尚未就绪');
    if(current.snapshot.legacyBinding){
      try{
        const original=assertLegacySessionSource(this.support.store,current.snapshot);
        if(!this.originalTransientAbsent(original.snapshot.manifestPath))unavailable??='RESOURCE_RECOVERY_REQUIRED';
        else if(!unavailable&&native){await this.sessions.ensureMirror(input.taskId);if(current.snapshot.runner==='codex')await new LegacyOriginalCodex(this.support.store,catalog).prepare(input.taskId,input.signal);else await new LegacyOriginalPlugin(this.support.store).prepare(input.taskId,input.signal);this.legacyPreparationWarnings.delete(input.taskId);}
      }catch(error){if(input.signal.aborted||error instanceof ApplicationError&&error.code==='CANCELED')throw error;if(!(error instanceof ApplicationError))throw error;unavailable??=error.code;}
      if(unavailable||!native)return this.prepareUnavailableSession(input,current,native,unavailable??'AGENT_ADAPTER_UNSUPPORTED',catalog);
    }
    const snapshot=current.snapshot,adapter=this.support.adapters.get(snapshot.adapterBinding.hash);
    if(native&&!adapter.metadata.cliVersions.includes(native.version))unavailable='AGENT_ADAPTER_UNSUPPORTED';
    const ready=inspectApplicationResources(this.support.store,snapshot.packages).filter(p=>p.state==='ready').map(p=>p.appId),applicationScope=!snapshot.legacyBinding&&!unavailable&&native&&(ready.length<snapshot.packages.length||snapshot.runner==='claude-code'&&this.claudeDelivery.has(snapshot.taskId))?ready:undefined;
    if(ready.length<snapshot.packages.length&&!applicationScope)return this.prepareUnavailableSession(input,current,native,unavailable,catalog);
    if(snapshot.runner==='claude-code'&&this.claudeDelivery.has(snapshot.taskId)&&(unavailable||!native))return this.prepareUnavailableSession(input,current,native,unavailable,catalog);
    const independent=applicationScope?.length===0;
    const gateSnapshot=applicationScope?{projectId:snapshot.projectId,packages:snapshot.packages.filter(p=>applicationScope.includes(p.appId))}:snapshot;
    assertNoPendingApplicationSwitch(this.support.store,gateSnapshot);const projectionIds:string[]=[];
    let pluginRoot:string|null=null,pluginHash:string|null=null,deliveryToken:ClaudeDeliveryToken|undefined,deliveryProof:ClaudeRunDelivery|undefined;
    if(!unavailable&&!snapshot.legacyBinding){
      if(snapshot.runner==='codex'){const sources=this.projector.sourceSkills(snapshot,applicationScope,independent),published=await catalog.publish(sources,{signal:input.signal});for(const source of sources){const entry=published.entries.find(e=>e.path===source.path&&e.storeId===this.support.store.storeId);if(!entry)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原共享投影未按相同身份登记');await this.sessions.addProjectionReference(input.taskId,current.pointer.snapshotHash,entry.resourceId);projectionIds.push(entry.resourceId);}}
      else if(applicationScope){try{deliveryToken=independent?await this.claudeDelivery.prepareIndependent(input.taskId):await this.claudeDelivery.prepare(input.taskId,applicationScope);}catch(error){if(!(error instanceof ApplicationError)||!['RESOURCE_BUSY','RESOURCE_RECOVERY_REQUIRED','OWNERSHIP_CONFLICT','HASH_MISMATCH'].includes(error.code))throw error;return this.prepareUnavailableSession(input,current,native,error.code,catalog);}pluginRoot=join(this.support.store.root,'sessions',input.taskId,'claude/plugin');pluginHash=deliveryToken.hash;projectionIds.push(deliveryToken.resourceId);}
      else{const plugin=await this.projector.claude(input.taskId);pluginRoot=plugin.root;pluginHash=plugin.resource.contentHash;}
    }
    const hold=snapshot.runner==='codex'?await catalog.reserveRun((await catalog.snapshot()).generation,'codex',ids=>independent?this.runs.reserveIndependent({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},projectionIds,ids):applicationScope?this.runs.reserveScoped({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},applicationScope,projectionIds,ids):this.runs.reserve({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},ids)):undefined;
    let run:OwnedCapabilityRun;
    try{run=hold?.run??(independent?await this.runs.reserveIndependent({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},projectionIds,undefined,deliveryToken):deliveryToken?await this.runs.reserveScoped({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]},applicationScope!,projectionIds,undefined,deliveryToken):await this.runs.reserve({taskId:input.taskId,snapshotHash:current.pointer.snapshotHash,bindings:[]}));}
    catch(error){if(deliveryToken)await this.claudeDelivery.cancel(deliveryToken).catch(()=>{});throw error;}
    const entry:ActiveLaunch={run,hold};this.active.set(run.runId,entry);
    try{
      if(deliveryToken)deliveryProof=this.claudeDelivery.proof(run.runId,deliveryToken);
      const legacy=(await this.sessions.references(input.taskId)).filter(r=>r.refKind==='legacy-runtime');if(legacy.length!==1)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原启动资源身份缺失或重复');
      const mcpName=snapshot.mcp.find(m=>m.kind==='legacy-project-context')?.serverName??null;
      const original=snapshot.legacyBinding?assertLegacySessionSource(this.support.store,snapshot):null;
      const sources=unavailable?[]:original?original.evidence.skills.filter(s=>s.enabled).map(s=>{if(!s.nativeName)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原Skill原生名称缺失');return{path:s.projectionPath,nativeName:s.nativeName,sourceHash:s.hash,sourceResourceId:'standard-skill:'+s.skillId+':'+s.hash,files:Object.fromEntries(Object.entries(this.support.legacy.verify(this.support.store.get('standard-skill:'+s.skillId+':'+s.hash))).map(([p,t])=>[p,Buffer.from(t)])),executables:new Set<string>()};}):this.projector.sourceSkills(snapshot,applicationScope,independent),skills:RuntimeSkill[]=unavailable?[]:snapshot.standardSkills.map(s=>{const known=this.support.store.sqlite.prepare('SELECT skill_id AS skillId,id AS versionId,name,version,hash FROM skill_versions WHERE id=? AND skill_id=? AND hash=?').get(s.versionId,s.skillId,s.hash) as Pick<RuntimeSkill,'skillId'|'versionId'|'name'|'version'|'hash'>|undefined;if(!known)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原标准Skill元数据缺失或身份不同');return{...known,path:s.projectionPath,loaded:'unverified',enabled:true};});
      const projections=unavailable?{}:Object.fromEntries(snapshot.standardSkills.map(s=>{const source=sources.find(v=>v.path===s.projectionPath)!;return[s.versionId,{path:s.projectionPath,nativeName:source.nativeName,...(original?{format:'legacy-tree-v1' as const}:{}),files:source.files}];}));
      let request:AgentLoadRequest|undefined,legacyRequest:LegacyAgentLoadRequest|undefined;
      const legacyPlan=()=>{if(!legacyRequest)throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原格式加载依据缺失');return this.support.adapters.planLegacy(snapshot.adapterBinding.hash,legacyRequest);};
      if(!unavailable&&native){
        const collection=hold?.catalog??null;
        const inventory=native.inventory.map(item=>{const source=sources.find(s=>s.path===item.path);return source?{...item,ownerStoreId:this.support.store.storeId,contentHash:source.sourceHash}:item;});
        const flags=native.userSkillConfig.map(item=>{if(typeof item.path!=='string')return item;const path=canonicalFuturePath(resolve(input.cwd,item.path));const known=collection?.entries.find(e=>canonicalFuturePath(e.path)===path||canonicalFuturePath(dirname(e.path))===path);return known?{...item,path:known.path}:item;});
        if(original){
          legacyRequest={schema:'m4-legacy-load-request-v1',taskId:input.taskId,projectId:input.projectId,sourceSnapshotHash:original.row.source_snapshot_hash,runId:run.runId,cliVersion:native.version,native:{...snapshot.native,runner:snapshot.runner,home:catalog.home},catalog:collection,userSkillConfig:flags,inventory};
          try{legacyPlan();}catch(error){if(error instanceof ApplicationError&&['AGENT_ADAPTER_UNSUPPORTED','AGENT_CAPABILITY_NAME_CONFLICT','RESOURCE_RECOVERY_REQUIRED'].includes(error.code)){unavailable=error.code;legacyRequest=undefined;}else throw error;}
        }else{
        request={snapshot,...(independent?{independentCapabilities:true as const}:{}),...(applicationScope?{applicationScope}:{}),...(deliveryProof?{claudeDelivery:deliveryProof}:{}),runId:run.runId,cliVersion:native.version,currentExecutable:process.execPath,native:{...snapshot.native,runner:snapshot.runner,home:catalog.home},pluginRoot,pluginHash,catalog:collection,userSkillConfig:flags,inventory,mcp:snapshot.mcp.filter(m=>m.kind==='applications'?!independent:this.capabilities.enabled(input.projectId,MCP_CAPABILITY)).map(m=>({kind:m.kind,serverName:m.serverName,command:m.kind==='applications'?process.execPath:'python3',args:m.kind==='applications'?[join(this.support.store.root,'runtime',m.runtimeHash,'mcp-bridge.cjs'),'--bootstrap',join(this.support.store.root,'pending-bootstrap.json')]:[join(this.support.store.root,'runtime',m.runtimeHash,'context_mcp.py'),join(this.support.store.root,'runs',input.projectId,input.taskId,run.runId,'context.json')],env:m.kind==='applications'?{ELECTRON_RUN_AS_NODE:'1'}:{} as Record<string,string>}))};
        try{this.support.adapters.plan(snapshot.adapterBinding.hash,request);}catch(error){if(error instanceof ApplicationError&&['AGENT_ADAPTER_UNSUPPORTED','AGENT_CAPABILITY_NAME_CONFLICT'].includes(error.code)){unavailable=error.code;request=undefined;}else throw error;}
      }
      }
      let runtime=unavailable?this.unavailableRuntime(input,current,run.runId,unavailable):this.capabilities.prepare({projectId:input.projectId,taskId:input.taskId,runner:input.profile.runner,cwd:input.cwd,home:input.home,profileArgs:input.profile.args,previous:input.previous,managed:{runId:run.runId,runtimeHash:legacy[0].refHash,mcpName,skills,projections}});entry.runtime=runtime;runtime.snapshot.sessionCapabilities=current.pointer;
      await run.prepare();if(unavailable)await this.runs.restrictToNative(run.runId,{reason:'managed_capabilities_unavailable',issueCode:unavailable==='AGENT_ADAPTER_UNSUPPORTED'||unavailable==='AGENT_CAPABILITY_NAME_CONFLICT'?unavailable:'RESOURCE_RECOVERY_REQUIRED'});const configPaths:string[]=[];let bridge:Awaited<ReturnType<PrivateApplicationBroker['prepare']>>|undefined;let args:string[]=[];
      let plan:AgentLoadPlan|undefined;
      if(request){const mcp=request.mcp.find(m=>m.kind==='applications');if(mcp){bridge=await this.broker.prepare(run,mcp.serverName);mcp.args[2]=bridge.bootstrapPath;}plan=this.support.adapters.plan(snapshot.adapterBinding.hash,request);}
      else if(legacyRequest)plan=legacyPlan();
      if(plan){args=plan.args;const root=dirname(runtime.snapshot.manifestPath);for(const[name,text]of Object.entries(plan.files)){mkdirSync(root,{recursive:true,mode:0o700});writeFileSync(join(root,name),text,{flag:'wx',mode:0o600});configPaths.push(join(root,name));}}

      try{await this.applications.sessionDiagnostics.prepared({schema:1,runId:run.runId,selectionHash:current.selectionHash,cliVersion:native?.version??null,adapterHash:snapshot.adapterBinding.hash,state:unavailable?'unavailable':'prepared',issueCode:unavailable??null,manifestPath:runtime.snapshot.manifestPath,configPaths,preparedAt:new Date().toISOString()});}catch{/* Missing display evidence never grants capability or blocks ordinary Agent launch. */}
      if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','任务能力准备已取消');
      if(!unavailable&&native)try{this.applications.nativeMessages.register(run.runId,native.version,run.signal);}catch{/* Missing origin evidence grants nothing and must not stop the ordinary Agent. */}
      let effectiveApplications=!unavailable;
      let phase:'prepared'|'restricting'|'native-only'|'arming'='prepared';
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args,env:runtime.env,command:native?.command,
        assertBeforeFork:()=>{if(effectiveApplications){assertNoPendingApplicationSwitch(this.support.store,gateSnapshot);if(deliveryProof)this.claudeDelivery.assertRun(run.runId,deliveryProof);}},
        nativeOnly:async reason=>{
          if(phase!=='prepared'||this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','此启动不能再撤去应用注入');
          if(unavailable){runtime.snapshot.selfCheck?.issues.push(reason);launch.args=[];launch.env={};launch.initialInput=undefined;phase='native-only';return launch;}
          phase='restricting';
          this.broker.revokeRun(run.runId);await bridge?.bridge.cancelBeforeLaunch();
          await this.runs.restrictToNative(run.runId);effectiveApplications=false;
          runtime.release();runtime=this.unavailableRuntime(input,current,run.runId,'AGENT_ADAPTER_UNSUPPORTED');
          runtime.snapshot.selfCheck?.issues.push(reason);entry.runtime=runtime;
          launch.runtime=runtime;launch.args=[];launch.env={};launch.initialInput=undefined;
          // The registry recorded the narrowing atomically; initial preparation remains immutable.
          phase='native-only';return launch;
        },
        beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','启动已取消或窗口已使用');const nativeOnly=phase==='native-only';if(effectiveApplications)assertNoPendingApplicationSwitch(this.support.store,gateSnapshot);phase='arming';await hold?.activate();if(!nativeOnly)await bridge?.bridge.arm();await run.cli.arm();},spawned:pid=>run.cli.attach(pid??0),initialInput:unavailable?undefined:(sender,text)=>this.applications.nativeInputs.observeLaunch(sender,{taskId:input.taskId,ptyId:run.ptyId},text),cancelBeforeFork:()=>run.cancelBeforeFork().then(()=>this.releaseStopped(entry)),spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>run.stop(reason).then(()=>this.releaseStopped(entry)),bindNative:async id=>{const known=await this.sessions.get(input.taskId),bound=await this.sessions.bindNativeSession(input.taskId,known.pointer.snapshotHash,{...snapshot.native,runner:snapshot.runner,sessionId:id});runtime.snapshot.sessionCapabilities=bound.pointer;}};
      return launch;
    }catch(error){await run.stop('prepare-failed').catch(()=>{});await this.releaseStopped(entry);throw error;}
  }
  private originalTransientAbsent(path:string):boolean{
    try{lstatSync(path);return false;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return true;throw new ApplicationError('RESOURCE_RECOVERY_REQUIRED','原临时目录状态暂不能核验');}
  }
  private async prepareUnavailableSession(input:TaskLaunchInput,current:StoredCapabilitySession,native:NativeLaunchContext|undefined,unavailable:string|undefined,catalog:DiscoveryCatalog):Promise<TaskCapabilityLaunch>{
    const snapshot=current.snapshot,adapter=this.support.adapters.get(snapshot.adapterBinding.hash),collection=await catalog.snapshot(),isolationEntry=snapshot.legacyBinding?this.support.status().adapters.find(a=>a.agentId===snapshot.runner&&a.version==='1.0.0'):undefined,isolation=isolationEntry?this.support.adapters.get(isolationEntry.hash):adapter;
    const knownVersion=Boolean(native&&(!unavailable||snapshot.legacyBinding&&unavailable!=='AGENT_ADAPTER_UNSUPPORTED')&&isolation.metadata.projectionFormatVersion===1&&isolation.metadata.cliVersions.includes(native.version)),consumesH=snapshot.runner==='codex'||!knownVersion;
    const resources=[`agent-adapter:${snapshot.runner}:${snapshot.adapterBinding.hash}`,...(isolation.hash!==adapter.hash?[isolation.resource.resourceId]:[]),...(consumesH?collection.entries.filter(e=>e.storeId===this.support.store.storeId).map(e=>e.resourceId):[])];
    const reserve=(ids?:{runId:string;ptyId:string})=>this.runs.reserveFixedNativeGuard({taskId:input.taskId,projectId:input.projectId,runner:snapshot.runner,snapshotHash:current.pointer.snapshotHash,resourceIds:resources,...(snapshot.legacyBinding?{restriction:{reason:'managed_capabilities_unavailable' as const,issueCode:unavailable==='AGENT_ADAPTER_UNSUPPORTED'||unavailable==='AGENT_CAPABILITY_NAME_CONFLICT'?unavailable:'RESOURCE_RECOVERY_REQUIRED' as const}}:{}),verify:async()=>{
      this.support.adapters.verify(snapshot.adapterBinding.hash);if(isolation.hash!==adapter.hash)this.support.adapters.verify(isolation.hash);if(consumesH)catalog.verifyNativeIsolation(collection);
      if(!input.newTask)await this.sessions.verifyNativeIdentity(input.taskId,{runner:snapshot.runner,stateRoot:input.stateRoot,cwd:input.cwd,sessionId:input.sessionId,home:input.home});
    }},ids);
    const hold=consumesH?await catalog.reserveRun(collection.generation,snapshot.runner,ids=>reserve(ids)):undefined,run=hold?.run??await reserve(),entry:ActiveLaunch={run,hold};this.active.set(run.runId,entry);
    try{
      let args:string[]=[];
      if(snapshot.runner==='codex'&&collection.entries.length&&native&&knownVersion){
        // Only compute false discovery flags; retain the actual fixed S everywhere
        // else. This transient request is neither stored nor granted a bridge.
        const {legacyBinding:_original,...fixed}=snapshot,hidden:CapabilitySessionSnapshotV2={...fixed,provenance:'created',adapterBinding:{id:snapshot.runner,version:isolation.metadata.version,hash:isolation.hash,projectionFormatVersion:1,nativeToolNames:{}},packages:[],standardSkills:[],mcp:[]};
        const flags=native.userSkillConfig.map(item=>{if(typeof item.path!=='string')return item;const path=canonicalFuturePath(resolve(input.cwd,item.path)),known=collection.entries.find(e=>canonicalFuturePath(e.path)===path||canonicalFuturePath(dirname(e.path))===path);return known?{...item,path:known.path}:item;});
        args=this.support.adapters.plan(isolation.hash,{snapshot:hidden,runId:run.runId,cliVersion:native.version,currentExecutable:process.execPath,native:{...snapshot.native,runner:snapshot.runner,home:catalog.home},pluginRoot:null,pluginHash:null,catalog:collection,userSkillConfig:flags,inventory:native.inventory,mcp:[]}).args;
      }
      const issue=snapshot.legacyBinding?unavailable??'RESOURCE_RECOVERY_REQUIRED':unavailable??'CAPABILITY_UNAVAILABLE',runtime=this.unavailableRuntime(input,current,run.runId,issue);if(!native||!adapter.metadata.cliVersions.includes(native.version))runtime.snapshot.selfCheck?.issues.push('AGENT_ADAPTER_UNSUPPORTED');entry.runtime=runtime;
      await run.prepare();if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原会话原生启动已取消');
      try{await this.applications.sessionDiagnostics.prepared({schema:1,runId:run.runId,selectionHash:current.selectionHash,cliVersion:native?.version??null,adapterHash:snapshot.adapterBinding.hash,state:'unavailable',issueCode:issue,manifestPath:runtime.snapshot.manifestPath,configPaths:[],preparedAt:new Date().toISOString()});}catch{/* Display evidence grants nothing. */}
      let phase:'prepared'|'native-only'|'arming'='prepared';
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args,env:{},command:native?.command,nativeOnly:async reason=>{
        if(phase!=='prepared'||this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原生启动窗口已使用');
        launch.args=[];runtime.snapshot.selfCheck?.issues.push(reason);phase='native-only';return launch;
      },beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','原会话启动已取消或窗口已使用');phase='arming';await hold?.activate();await run.cli.arm();},spawned:pid=>run.cli.attach(pid??0),cancelBeforeFork:()=>run.cancelBeforeFork().then(()=>this.releaseStopped(entry)),spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>run.stop(reason).then(()=>this.releaseStopped(entry)),bindNative:async id=>{const known=await this.sessions.get(input.taskId),bound=await this.sessions.bindNativeSession(input.taskId,known.pointer.snapshotHash,{...snapshot.native,runner:snapshot.runner,sessionId:id});runtime.snapshot.sessionCapabilities=bound.pointer;}};
      return launch;
    }catch(error){await run.stop('unavailable-prepare-failed').catch(()=>{});await this.releaseStopped(entry);throw error;}
  }
  private async prepareNativeHistory(input:TaskLaunchInput,native:NativeLaunchContext|undefined,unavailable:string|undefined,catalog:DiscoveryCatalog):Promise<TaskCapabilityLaunch>{
    const runner=input.profile.runner==='claude'?'claude-code':'codex',adapter=this.support.status().adapters.find(a=>a.agentId===runner&&a.version==='1.0.0');if(!adapter)throw new ApplicationError('AGENT_ADAPTER_UNSUPPORTED','缺少原生历史隔离所需适配资源');
    const collection=await catalog.snapshot(),knownVersion=native&&this.support.adapters.get(adapter.hash).metadata.cliVersions.includes(native.version);
    // A native-only guard grants no application bridge. When filtering is unverified,
    // preserve native argv/config and freeze H for the consumer rather than blocking
    // the ordinary Agent or pretending its managed Skill selection was validated.
    const nativeUnverified=Boolean(!native||unavailable||!knownVersion);
    const record=this.support.store.sqlite.prepare("SELECT snapshot_hash AS hash FROM capability_session_snapshots WHERE task_id=? AND schema_version=0 AND retention_state='hold'").get(input.taskId) as {hash:string}|undefined;if(!record)throw new ApplicationError('SESSION_ON_HOLD','缺少原历史保留依据');
    const consumesH=runner==='codex'||!knownVersion,resourceIds=[`agent-adapter:${runner}:${adapter.hash}`,...(consumesH?collection.entries.filter(e=>e.storeId===this.support.store.storeId).map(e=>e.resourceId):[])];
    const reserve=(ids?:{runId:string;ptyId:string})=>this.runs.reserveNativeGuard({taskId:input.taskId,projectId:input.projectId,runner,snapshotHash:record.hash,resourceIds,verify:async()=>{this.support.adapters.verify(adapter.hash);if(consumesH)catalog.verify(collection);}},ids);
    const hold=consumesH?await catalog.reserveRun(collection.generation,runner,ids=>reserve(ids)):undefined,run=hold?.run??await reserve(),entry:ActiveLaunch={run,hold};this.active.set(run.runId,entry);
    try{
      let args:string[]=[];
      if(runner==='codex'&&collection.entries.length&&native&&!nativeUnverified){
        // A transient empty selection is used solely to prepare false discovery
        // flags. It is never persisted, inspected as history or granted a bridge.
        const snapshot:CapabilitySessionSnapshotV2={schema:2,taskId:input.taskId,projectId:input.projectId,createdAt:new Date().toISOString(),runner,adapterBinding:{id:runner,version:adapter.version,hash:adapter.hash,projectionFormatVersion:1,nativeToolNames:{}},native:{sessionId:input.sessionId,stateRoot:input.stateRoot,cwd:input.cwd},agentAtCreation:{version:native.version,adapterRevision:1},catalogGeneration:collection.generation,packages:[],standardSkills:[],mcp:[],provenance:'migrated-known-legacy'};
        const flags=native.userSkillConfig.map(item=>{if(typeof item.path!=='string')return item;const path=canonicalFuturePath(resolve(input.cwd,item.path)),known=collection.entries.find(e=>canonicalFuturePath(e.path)===path||canonicalFuturePath(dirname(e.path))===path);return known?{...item,path:known.path}:item;});
        args=this.support.adapters.plan(adapter.hash,{snapshot,runId:run.runId,cliVersion:native.version,currentExecutable:process.execPath,native:{...snapshot.native,runner,home:catalog.home},pluginRoot:null,pluginHash:null,catalog:collection,userSkillConfig:flags,inventory:native.inventory,mcp:[]}).args;
      }
      const check:RuntimeSnapshot['selfCheck']={status:'failed',issues:['HISTORY_CAPABILITIES_UNKNOWN',...(nativeUnverified?['AGENT_ADAPTER_UNSUPPORTED']:[])],at:Date.now()},runtime:PreparedRuntime={persistSnapshot:false,args:[],env:{},secretValues:[],snapshot:{runId:run.runId,projectId:input.projectId,configVersion:input.previous?.configVersion??0,configHash:record.hash,manifestPath:input.previous?.manifestPath??join(this.support.store.root,'sessions',input.taskId,'snapshot.json'),auditPath:input.previous?.auditPath??join(this.support.store.root,'resource-audit',input.projectId,input.taskId+'.jsonl'),skills:[],mcp:[],selfCheck:check},wrap:(command,argv)=>({command,args:argv}),check:()=>check,release:()=>{}};entry.runtime=runtime;
      await run.prepare();if(this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原生历史启动已取消');
      let phase:'prepared'|'native-only'|'arming'='prepared';
      const launch:TaskCapabilityLaunch={ptyId:run.ptyId,runtime,args,env:{},command:native?.command,nativeOnly:async reason=>{
        if(phase!=='prepared'||this.closed||input.signal.aborted)throw new ApplicationError('CANCELED','原生历史启动窗口已使用');
        await this.runs.restrictToNative(run.runId);launch.args=[];for(const issue of ['AGENT_ADAPTER_UNSUPPORTED',reason])if(!check.issues.includes(issue))check.issues.push(issue);phase='native-only';return launch;
      },beforeSpawn:async()=>{if(this.closed||input.signal.aborted||!['prepared','native-only'].includes(phase))throw new ApplicationError('CANCELED','原生历史启动已取消或窗口已使用');phase='arming';await hold?.activate();await run.cli.arm();},spawned:pid=>run.cli.attach(pid??0),cancelBeforeFork:()=>run.cancelBeforeFork().then(()=>this.releaseStopped(entry)),spawnFailed:()=>run.stop('native-fork-error').then(()=>this.releaseStopped(entry)),exited:()=>run.cli.exited().then(()=>this.releaseStopped(entry)),stop:reason=>run.stop(reason).then(()=>this.releaseStopped(entry))};
      return launch;
    }catch(error){await run.stop('history-prepare-failed').catch(()=>{});await this.releaseStopped(entry);throw error;}
  }
  private unavailableRuntime(input:TaskLaunchInput,current:StoredCapabilitySession,runId:string,code:string):PreparedRuntime{
    const check:RuntimeSnapshot['selfCheck']={status:'failed',issues:[code],at:Date.now()};
    return{args:[],env:{},secretValues:[],snapshot:{runId,projectId:input.projectId,configVersion:input.previous?.configVersion??0,configHash:current.selectionHash,manifestPath:join(this.support.store.root,'sessions',input.taskId,'snapshot.json'),auditPath:join(this.support.store.root,'resource-audit',input.projectId,input.taskId+'.jsonl'),skills:[],mcp:[],selfCheck:check,sessionCapabilities:current.pointer},wrap:(command,args)=>({command,args}),check:()=>check,release:()=>{}};
  }
  private releaseStopped(entry:ActiveLaunch):Promise<void>{if(this.runs.get(entry.run.runId).state!=='stopped')return Promise.resolve();if(entry.releasing)return entry.releasing;const work=(async()=>{await entry.hold?.release();entry.runtime?.release();this.active.delete(entry.run.runId);})();entry.releasing=work;void work.catch(()=>{entry.releasing=undefined;});return work;}
  private async sweep():Promise<void>{if(this.sweeping)return;this.sweeping=true;try{await Promise.allSettled([...this.active.values()].map(entry=>this.releaseStopped(entry)));}finally{this.sweeping=false;}}
  tombstone(taskId:string):Promise<void>{return this.sessions.tombstone(taskId);}
  activeTaskIds(projectId:string):ReadonlySet<string>{return new Set((this.support.store.sqlite.prepare("SELECT task_id AS id FROM capability_runs WHERE project_id=? AND state NOT IN ('stopped','failed')").all(projectId) as {id:string}[]).map(r=>r.id));}
  dispose():Promise<void>{if(this.closing)return this.closing;this.closed=true;clearInterval(this.timer);this.closing=(async()=>{await Promise.allSettled([...this.pending]);const results=await Promise.allSettled([this.runs.dispose(),this.bridges.dispose(),this.broker.close()]);const deadline=performance.now()+2000;do{await this.sweep();if(!this.active.size)break;await new Promise<void>(done=>setTimeout(done,10));}while(performance.now()<deadline);if(results.some(result=>result.status==='rejected'))throw new ApplicationError('RUN_STOP_FAILED','部分运行关闭尚未完成；私有通道已撤销，未知占用继续保留');})();return this.closing;}
}
