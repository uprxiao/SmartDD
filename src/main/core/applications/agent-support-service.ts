import type { AgentSupportState } from '@shared/capability-bundles';
import { ApplicationError } from '@shared/applications';
import { BuiltinPackageRegistry } from './builtin-package-registry';
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
  private state: AgentSupportState = { state: 'preparing',errorCode: null,legacyResourceCount: 0,runtimeHash: null,adapters: [],applications: [] };
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
      await this.legacy.adoptRuntime(this.capabilities.runtimeIdentity().hash);this.state.legacyResourceCount++;
      const expected = ['mail','zentao'];
      if (source.index.apps.length !== expected.length || !expected.every(id => source.index.apps.some(a => a.appId === id))) throw new ApplicationError('INVALID_PACKAGE','本版本缺少已声明的完整内置应用包');
      const builtin = new BuiltinPackageRegistry(this.store), packages = builtin.packages;
      for (const entry of source.index.apps) {
        const status: AgentSupportState['applications'][number] = { appId: entry.appId as 'mail' | 'zentao', version: entry.version, hash: entry.hash, filesReady: false, defaultForNewSessions: false, errorCode: null };
        this.state.applications.push(status);
        try {
          const installed = await builtin.install(source,entry);status.filesReady = installed.state === 'ready';
          // The first default is safe to establish locally. Existing defaults are changed only by upgrade preflight.
          if (!packages.active(entry.appId)) await packages.activate(installed.packageHash,0);
          status.defaultForNewSessions = packages.active(entry.appId)?.packageHash === installed.packageHash;
        } catch(error) { status.errorCode = error instanceof ApplicationError ? error.code : 'CAPABILITY_UNAVAILABLE'; }
      }
      const failed = this.state.applications.filter(a => a.errorCode);
      this.state.state = failed.length ? (failed.length === this.state.applications.length ? 'unavailable' : 'partial') : 'ready';
      this.state.errorCode = failed[0]?.errorCode ?? null;
    }catch(error){this.state.state='unavailable';this.state.errorCode=error instanceof ApplicationError?error.code:'CAPABILITY_UNAVAILABLE';}
  }
}
