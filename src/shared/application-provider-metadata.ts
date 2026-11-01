import { z } from 'zod';
import catalog from './application-module-catalog.json';
import type { ApplicationFormField, ApplicationPresentation, ApplicationProviderPresentation } from './application-presentation';
import type { ApplicationId, ConnectionConfig } from './application-connections';

type ModuleMetadata = { appId: string; slots: string[]; stopBeforeSwitch: boolean; presentation: ApplicationPresentation; providers: ApplicationProviderPresentation[] };
export const applicationModuleMetadata = catalog.applications as unknown as readonly ModuleMetadata[];
export function applicationMetadata(id: string): ModuleMetadata {
  const module = applicationModuleMetadata.find(m => m.appId === id);
  if (!module) throw new Error('当前构建没有此应用的界面定义');
  return module;
}
export function applicationProviderMetadata(id: string): ApplicationProviderPresentation {
  const provider = applicationModuleMetadata.flatMap(m => m.providers).find(p => p.id === id);
  if (!provider) throw new Error('当前构建没有此连接类型的界面定义');
  return provider;
}
export function applicationProviderFields(provider: ApplicationProviderPresentation): readonly ApplicationFormField[] { return provider.groups.flatMap(group => 'row' in group ? [...group.row] : [group]); }
export function providerApplicationId(id: string): ApplicationId { return applicationProviderMetadata(id).appId as ApplicationId; }
export function applicationConnectionSummary(config: { kind: string }): { summary: string; location: string } {
  const provider = applicationProviderMetadata(config.kind), field = (key: string) => String(Reflect.get(config, key) ?? '');
  return { summary: provider.summaryFields.map(field).filter(Boolean).join(' · '), location: field(provider.locationField) };
}

const schemas = new Map(applicationModuleMetadata.flatMap(module => module.providers).map(provider => {
  if (!provider.configSchema) throw new Error('连接界面缺少生成的配置契约');
  return [provider.id, z.fromJSONSchema(provider.configSchema as Parameters<typeof z.fromJSONSchema>[0])] as const;
}));
/** UI preflight only. Main always uses the actual compiled provider schema and signed context. */
export const moduleConnectionConfigSchema: z.ZodType<ConnectionConfig> = z.unknown().transform((value, context) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) { context.addIssue({ code: 'custom', message: '连接字段无效' }); return z.NEVER; }
  const kind = Reflect.get(value, 'kind'), schema = typeof kind === 'string' ? schemas.get(kind) : null;
  if (!schema || typeof kind !== 'string') { context.addIssue({ code: 'custom', message: '未注册的连接类型' }); return z.NEVER; }
  const normalized = { ...value } as Record<string, unknown>;
  for (const field of applicationProviderFields(applicationProviderMetadata(kind))) {
    const raw = normalized[field.key];
    if (typeof raw !== 'string') continue;
    const text = field.trim === false ? raw : raw.trim(); normalized[field.key] = text;
    let invalid = /[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(text);
    if (field.format === 'http-base-url') {
      try { const url = new URL(text); invalid ||= !['http:', 'https:'].includes(url.protocol) || !!(url.username || url.password || url.search || url.hash); } catch { invalid = true; }
    } else if (field.format === 'host') invalid ||= /[\s/@?#\\]/u.test(text);
    if (invalid) context.addIssue({ code: 'custom', path: [field.key], message: field.validation });
  }
  const parsed = schema.safeParse(normalized);
  if (!parsed.success) { for (const issue of parsed.error.issues) context.addIssue({ code: 'custom', path: issue.path, message: issue.message }); return z.NEVER; }
  return parsed.data as ConnectionConfig;
});
