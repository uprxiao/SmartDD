import type { AgentSupportState } from '@shared/capability-bundles';
import { ApplicationError } from '@shared/applications';
import type { CapabilityService } from '../capabilities/capability-service';
import type { ResourceStore } from './resource-store';
import { AgentAdapterRegistry } from './agent-adapter-registry';
import { LegacyCapabilityResourceAdopter } from './legacy-resource-adopter';
import { RuntimeRegistry } from './runtime-registry';
import { CapabilityBundleSource } from './bundle-source';
/** App startup prepares immutable local bytes; failure is diagnostic and never throws into task startup. */
export class AgentSupportService {
  readonly adapters: AgentAdapterRegistry;
  readonly legacy: LegacyCapabilityResourceAdopter;
  private state: AgentSupportState = { state: 'preparing',errorCode: null,legacyResourceCount: 0,runtimeHash: null,adapters: [] };
  private starting?: Promise<void>;
  constructor(readonly store: ResourceStore,private readonly capabilities: Pick<CapabilityService,'list' | 'runtimeIdentity'>,private readonly sourceRoot: string) { this.adapters=new AgentAdapterRegistry(store);this.legacy=new LegacyCapabilityResourceAdopter(store); }
  status(): AgentSupportState { return structuredClone(this.state); }
  initialize(): Promise<void> { if(this.starting)return this.starting;this.starting=this.prepare();return this.starting; }
  private async prepare(): Promise<void> {
    try {
      const source=new CapabilityBundleSource(this.sourceRoot),bundles=source.adapters(),runtime=source.runtime();
      if(!['claude-code','codex'].every(id=>bundles.some(b=>b.metadata.agentId===id)))throw new ApplicationError('INVALID_PACKAGE','本版本缺少已声明的Agent适配资源');
      for(const bundle of bundles){const installed=await this.adapters.install(bundle.metadata,bundle.files);this.state.adapters.push({agentId:installed.metadata.agentId,version:installed.metadata.version,hash:installed.hash,cliVersions:installed.metadata.cliVersions,filesReady:true,nativeDiscovery:'unverified',bridgeRecovery:'unverified'});}
      const installedRuntime=await new RuntimeRegistry(this.store).install(runtime);this.state.runtimeHash=installedRuntime.contentHash;
      for(const skill of this.capabilities.list())for(const version of skill.versions){await this.legacy.adoptStandard(skill.id,version.hash);this.state.legacyResourceCount++;}
      await this.legacy.adoptRuntime(this.capabilities.runtimeIdentity().hash);this.state.legacyResourceCount++;this.state.state='ready';
    }catch(error){this.state.state='unavailable';this.state.errorCode=error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE';}
  }
}
