import { z } from 'zod';
import { ApplicationError, type ApplicationManifestV1 } from '@shared/applications';
import { applicationCapabilityViews, type LegacyCapabilityResolver, type LegacyCapabilityPolicy } from '@shared/application-capabilities';
import type { ApplicationPresentation, ApplicationProviderPresentation } from '@shared/application-presentation';
import type { HostApplicationDefinitions, HostProvider, HostedConfiguration, HostedIdentity } from '../host-application-registry';
import type { ApplicationModuleCatalog } from '../manifest';
import type { ApplicationDataHost } from '../application-adapter-registry';
import type { ApplicationExecutionContext, ApplicationExecutionContexts } from '../execution-context';
import type { ApplicationDataResources } from '../data-resources';
import type { ApplicationSelectionService } from '../selection-service';
import type { ResourceStore } from '../resource-store';
import type {ConfigViewConverter} from '../config-view-registry';
import type {CapabilitySessionSnapshot} from '@shared/application-session';

export interface ApplicationModuleData extends ApplicationDataHost {
  /** Retained internal v1 callers may use their original service, never the new routing facade. */
  legacyData?: ApplicationDataHost;
  execute(context: ApplicationExecutionContext, method: string, input: unknown): Promise<unknown>;
}
export interface ApplicationModuleServices {
  store: ResourceStore; contexts: ApplicationExecutionContexts; resources: ApplicationDataResources; selections: ApplicationSelectionService;
  /** Compatibility services for retained built-ins; new modules build their own services from the common host facilities. */
  retained: ReadonlyMap<string, unknown>;
}
export interface ApplicationProviderRuntime { mailWorker: string; foxmailNative: string }
export interface ApplicationModuleCapability extends LegacyCapabilityPolicy {
  method: string; permission: string; contractMajors: readonly number[];
}
export interface TrustedApplicationProvider extends HostProvider<HostedConfiguration, string> {
  configViews?: readonly ConfigViewConverter<HostedConfiguration>[];
  presentation: ApplicationProviderPresentation;
  verify(value: unknown, secret: string | null, signal: AbortSignal, runtime: ApplicationProviderRuntime): Promise<HostedIdentity<HostedConfiguration>>;
}
export interface TrustedApplicationModule {
  appId: string; contractMajors: readonly number[]; slots: readonly string[]; stopBeforeSwitch: boolean;
  presentation: ApplicationPresentation;
  providers: readonly TrustedApplicationProvider[];
  legacyPolicy: LegacyCapabilityResolver;
  capabilities: Readonly<Record<string, ApplicationModuleCapability>>;
  connectionNotice?(store: ResourceStore, snapshot: CapabilitySessionSnapshot, appId: string): string | null;
  createData(services: ApplicationModuleServices): ApplicationModuleData;
}
export type ApplicationProviderDefinition<S extends z.ZodType<HostedConfiguration>, P extends string, A extends string> = Omit<TrustedApplicationProvider, 'id' | 'appId' | 'configSchema'> & { id: P; appId: A; configSchema: S };
export type ApplicationModuleDefinition<A extends string, P extends readonly TrustedApplicationProvider[]> = Omit<TrustedApplicationModule, 'appId' | 'providers'> & { appId: A; providers: P };
export type ModuleConfiguration<T extends readonly TrustedApplicationModule[]> = z.infer<T[number]['providers'][number]['configSchema']>;
export type ModuleApplicationId<T extends readonly TrustedApplicationModule[]> = T[number]['appId'];

/** Compiled registration is authority. Manifests and database rows cannot add a module. */
export class ApplicationModuleRegistry<const T extends readonly TrustedApplicationModule[]> implements ApplicationModuleCatalog {
  private readonly modules = new Map<string, TrustedApplicationModule>();
  private readonly providers = new Map<string, TrustedApplicationProvider>();
  readonly definitions: HostApplicationDefinitions<ModuleConfiguration<T>, ModuleApplicationId<T>>;
  readonly configurationSchema: z.ZodType<ModuleConfiguration<T>>;
  constructor(readonly registered: T) {
    const invalid = () => new ApplicationError('INVALID_INPUT', '受信应用模块定义无效或重复');
    if (!registered.length || registered.length > 128) throw invalid();
    for (const module of registered) {
      if (!/^[a-z][a-z0-9-]{0,19}$/.test(module.appId) || this.modules.has(module.appId) || !module.contractMajors.length || new Set(module.contractMajors).size !== module.contractMajors.length || module.contractMajors.some(n => !Number.isSafeInteger(n) || n < 1) || typeof module.createData !== 'function' || typeof module.legacyPolicy !== 'function' || !module.providers.length || new Set(module.slots).size !== module.slots.length) throw invalid();
      if (!module.slots.includes(module.presentation.defaultProvider)) throw invalid();
      this.modules.set(module.appId, module);
      for(const [id,capability] of Object.entries(module.capabilities)){
        if(id!==capability.id||!id.startsWith(module.appId+'.')||!capability.method.startsWith(module.appId+'.')||!capability.permission.startsWith(module.appId+'.')||!capability.contractMajors.length||capability.contractMajors.some(major=>!module.contractMajors.includes(major))||capability.semantics!=='read'&&(!capability.protection||capability.retry!=='never')||capability.semantics==='external-write'&&!capability.approval)throw invalid();
      }
      for (const provider of module.providers) {
        if (provider.appId !== module.appId || this.providers.has(provider.id) || !module.slots.includes(provider.id) || provider.presentation.id !== provider.id || provider.presentation.appId !== module.appId || provider.presentation.initial.kind !== provider.id || typeof provider.verify !== 'function') throw invalid();
        this.providers.set(provider.id, provider);
      }
      if (module.slots.some(slot => !module.providers.some(p => p.id === slot))) throw invalid();
    }
    this.definitions = {
      api: 1,
      applications: registered.map(m => ({ id: m.appId, slots: [...m.slots], stopBeforeSwitch: m.stopBeforeSwitch })),
      providers: registered.flatMap(m => m.providers.map(({ presentation: _presentation, verify: _verify, configViews: _configViews, ...definition }) => definition)),
    // Flattening a heterogeneous readonly tuple loses its correlated literals in
    // TypeScript. Every definition above still comes from that same compiled tuple.
    } as unknown as HostApplicationDefinitions<ModuleConfiguration<T>, ModuleApplicationId<T>>;
    this.configurationSchema = z.unknown().transform((value, context) => {
      const kind = value && typeof value === 'object' && !Array.isArray(value) ? Reflect.get(value, 'kind') : null;
      const parsed = typeof kind === 'string' ? this.providers.get(kind)?.configSchema.safeParse(value) : null;
      if (!parsed?.success || parsed.data.kind !== kind) { context.addIssue({ code: 'custom', message: '连接字段无效，请核对表单' }); return z.NEVER; }
      return parsed.data as ModuleConfiguration<T>;
    });
  }
  appIds(): ModuleApplicationId<T>[] { return this.registered.map(m => m.appId); }
  module(appId: string): TrustedApplicationModule {
    const module = this.modules.get(appId);
    if (!module) throw new ApplicationError('CONFIG_INCOMPATIBLE', '当前宿主没有此应用模块');
    return module;
  }
  provider(providerId: string): TrustedApplicationProvider {
    const provider = this.providers.get(providerId);
    if (!provider) throw new ApplicationError('CONFIG_INCOMPATIBLE', '当前宿主没有此连接类型');
    return provider;
  }
  supportsModule(id: string, appId: string, major: number): boolean { return id === appId && !!this.modules.get(id)?.contractMajors.includes(major); }
  legacyCapabilities(manifest: ApplicationManifestV1) { return applicationCapabilityViews(manifest, this.module(manifest.appId).legacyPolicy); }
  capability(appId:string,id:string,contractMajor:number):ApplicationModuleCapability{
    const value=this.module(appId).capabilities[id];
    if(!value||!value.contractMajors.includes(contractMajor))throw new ApplicationError('CAPABILITY_UNAVAILABLE','受信模块没有此能力契约');
    return value;
  }
  createHosts(services: ApplicationModuleServices) { return this.registered.map(module => ({ appId: module.appId, data: module.createData(services) })); }
  configViews(): readonly ConfigViewConverter<HostedConfiguration>[] {
    return [...this.providers.values()].flatMap(provider => {
      if (provider.configViews) return [...provider.configViews];
      const authentication = (source: unknown): string => {
        const config = provider.configSchema.parse(source), auth = provider.authentication;
        if (config.kind !== provider.id) throw new ApplicationError('CONFIG_INCOMPATIBLE', '配置类型不属于转换器');
        const mode = auth.kind === 'none' ? auth.mode : Reflect.get(config, 'authMode');
        if (typeof mode !== 'string' || auth.kind === 'secret' && !auth.modes.includes(mode)) throw new ApplicationError('CONFIG_INCOMPATIBLE', '配置认证方式不属于转换器');
        return mode;
      };
      return [{providerId:provider.id,sourceSchemaVersion:provider.configSchemaVersion??1,targetApiMajor:provider.configApiMajor,identityContractMajor:1,implementationVersion:'1',sourceSchema:provider.configSchema,targetSchema:provider.configSchema,outputAuthentication:authentication,authModes:provider.authentication.kind==='none'?[provider.authentication.mode]:provider.authentication.modes,authentication,convert:(source:unknown)=>source}];
    });
  }
  providerPresentation(id: string): ApplicationProviderPresentation {
    const provider = this.provider(id);
    return { ...structuredClone(provider.presentation), configSchema: z.toJSONSchema(provider.configSchema) };
  }
}
