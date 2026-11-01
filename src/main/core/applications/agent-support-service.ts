import type { AgentSupportState } from '@shared/capability-bundles';
import { ApplicationError } from '@shared/applications';
import { BuiltinPackageRegistry } from './builtin-package-registry';
import type { CapabilityService } from '../capabilities/capability-service';
import type { ResourceStore } from './resource-store';
import { AgentAdapterRegistry } from './agent-adapter-registry';
import { LegacyCapabilityResourceAdopter } from './legacy-resource-adopter';
import { RuntimeRegistry } from './runtime-registry';
import { CapabilityBundleSource } from './bundle-source';
import { applicationModuleMetadata } from '@shared/application-provider-metadata';
import type { ApplicationId } from '@shared/application-connections';
/** App startup prepares immutable local bytes; failure is diagnostic and never throws into task startup. */
export class AgentSupportService {
  readonly adapters: AgentAdapterRegistry;
  readonly legacy: LegacyCapabilityResourceAdopter;
  private state: AgentSupportState = { state: 'preparing',errorCode: null,legacyResourceCount: 0,runtimeHash: null,adapters: [],applications: [] };
  private starting?: Promise<void>;
  constructor(readonly store: ResourceStore,private readonly capabilities: Pick<CapabilityService,'list' | 'runtimeIdentity'>,private readonly sourceRoot: string) { this.adapters=new AgentAdapterRegistry(store);this.legacy=new LegacyCapabilityResourceAdopter(store); }
  status(): AgentSupportState { return structuredClone(this.state); }
  initialize(): Promise<void> { if(this.starting)return this.starting;this.starting=this.prepare();return this.starting; }
  private async prepare(): Promise<void> {
    try {
      const source=new CapabilityBundleSource(this.sourceRoot),bundles=source.adapters(),runtime=source.runtime();
      if(!['claude-code','codex'].every(id=>bundles.some(b=>b.metadata.agentId===id)))throw new ApplicationError('INVALID_PACKAGE','本版本缺少已声明的Agent适配资源');
      for(const bundle of bundles){const installed=await this.adapters.install(bundle.metadata,bundle.files);this.state.adapters.push({agentId:installed.metadata.agentId,version:installed.metadata.version,hash:installed.hash,cliVersions:installed.metadata.cliVersions,filesReady:true,nativeDiscovery:'unverified',bridgeRecovery:installed.metadata.bridgeRecovery==='supported'?(installed.metadata.cliVersions.every(version=>this.adapters.recovery(installed.hash,version).capability==='supported')?'supported':'unverified'):installed.metadata.bridgeRecovery,configReload:installed.metadata.configReload??'unverified',recoveryRequiresAgentRestart:installed.metadata.recoveryRequiresAgentRestart??null,recoveryEvidence:installed.metadata.recoveryEvidence??[]});}
      const installedRuntime=await new RuntimeRegistry(this.store).install(runtime);this.state.runtimeHash=installedRuntime.contentHash;
      for(const skill of this.capabilities.list())for(const version of skill.versions){await this.legacy.adoptStandard(skill.id,version.hash);this.state.legacyResourceCount++;}
      await this.legacy.adoptRuntime(this.capabilities.runtimeIdentity().hash);this.state.legacyResourceCount++;
      // The registered module catalog is the single source; new applications must not edit this service.
      // The retained-v1 test fixture intentionally indexes a registered subset; production must index every registration.
      const registered = applicationModuleMetadata.map(m => m.appId), indexed = source.index.apps.map(a => a.appId);
      if (new Set(indexed).size !== indexed.length || indexed.some(id => !registered.includes(id))
        || (!source.index.build.testFixture && !registered.every(id => indexed.includes(id)))) throw new ApplicationError('INVALID_PACKAGE','本版本缺少已声明的完整内置应用包');
      const builtin = new BuiltinPackageRegistry(this.store), packages = builtin.packages;
      for (const entry of source.index.apps) {
        const status: AgentSupportState['applications'][number] = { appId: entry.appId as ApplicationId, version: entry.version, hash: entry.hash, filesReady: false, defaultForNewSessions: false, errorCode: null };
        this.state.applications.push(status);
        try {
          const installed = await builtin.install(source,entry);status.filesReady = installed.state === 'ready';
          // Default activation waits until the whole indexed set is ready.
        } catch(error) { status.errorCode = error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE'; }
      }
      if(this.state.applications.every(status=>status.filesReady&&!status.errorCode)){
        const missing=this.state.applications.filter(status=>!packages.active(status.appId));
        try{await packages.activateSet(missing.map(status=>({hash:status.hash,expectedGeneration:0})));}
        catch(error){for(const status of missing)status.errorCode=error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE';}
      }
      for(const status of this.state.applications)status.defaultForNewSessions=packages.active(status.appId)?.packageHash===status.hash;
      const failed = this.state.applications.filter(a => a.errorCode);
      this.state.state = failed.length ? (failed.length === this.state.applications.length ? 'unavailable' : 'partial') : 'ready';
      this.state.errorCode = failed[0]?.errorCode ?? null;
    }catch(error){this.state.state='unavailable';this.state.errorCode=error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE';}
  }
}
