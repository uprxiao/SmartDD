import { z } from 'zod';
import type { ProviderModel, ProviderView } from './ai-agents';
import { modelHubEndpoints } from './provider-catalog';
import { verifiedPresetProtocol } from './ai-provider-presets';

export const CODEX_LOGIN_MODEL = 'gpt-6.2-sol';
export const CODEX_LOGIN_EFFORT = 'medium';
export const CODEX_LOGIN_FALLBACK = '当前 Codex 目录未提供 GPT-6.2-Sol 与中等推理强度，使用执行器默认。';

export interface AgentModelChoice { model?: string | null; effort?: string | null }

export function offersCodexLoginDefault(models: readonly {id: string; efforts: readonly string[]}[] | undefined) {
  return !!models?.some(model => model.id === CODEX_LOGIN_MODEL && model.efforts.includes(CODEX_LOGIN_EFFORT));
}

export type AgentModelScope =
  | { kind: 'project'; projectId: string; dirId: string }
  | { kind: 'task'; taskId: string };

export const agentModelsSchema = z.array(z.object({
  id: z.string().min(1).max(256), name: z.string().max(160),
  efforts: z.array(z.string().max(24)).max(12), defaultEffort: z.string().max(24).optional(),
  isDefault: z.boolean().optional(),
})).max(200);
export type AgentModelOption = z.infer<typeof agentModelsSchema>[number];

export const modelEffortKey = (profileId: string, model?: string | null) => JSON.stringify([profileId, model || null]);

export function resolveModelEffort(model: Pick<AgentModelOption, 'efforts' | 'defaultEffort'> | undefined, preferred?: string | null, mediumFallback = true) {
  const offered = model?.efforts ?? [];
  if (preferred && offered.includes(preferred)) return preferred;
  if (model?.defaultEffort && offered.includes(model.defaultEffort)) return model.defaultEffort;
  return mediumFallback && offered.includes('medium') ? 'medium' : undefined;
}

/** Model Hub's Responses endpoint returned these levels for this exact model. */
export function providerCodexMetadata(provider: Pick<ProviderView, 'preset' | 'endpoints'>, model: ProviderModel): ProviderModel['codex'] {
  if (model.codex?.reasoningLevels.length || provider.preset !== 'ultracloud' ||
      provider.endpoints.responses !== modelHubEndpoints.responses || model.id !== 'gpt-6.1-sol') return model.codex;
  return {
    inputModalities: ['text'], supportVerbosity: false, ...model.codex,
    reasoningLevels: ['low', 'medium', 'high', 'xhigh', 'max'], defaultReasoning: 'medium',
  };
}

export function providerModelOptions(provider: ProviderView | undefined, profile: { kind: string; models: string[] }): AgentModelOption[] {
  if (!provider || (profile.kind !== 'codex' && profile.kind !== 'claude')) return [];
  const officialClaudeDeepSeek = provider.preset === 'deepseek' && verifiedPresetProtocol(provider.preset, provider.endpoints, 'claude');
  return provider.models.flatMap(model => {
    if (!profile.models.includes(model.id)) return [];
    if (profile.kind === 'claude' && (!provider.endpoints.anthropic || model.offline || model.availability.claude === 'unavailable')) return [];
    // The official Messages API maps aliases such as medium to high.
    const deepSeekLevels = officialClaudeDeepSeek && (model.id === 'deepseek-flash' || model.id === 'deepseek-v4-pro')
      ? { reasoningLevels: ['low', 'high', 'max'], defaultReasoning: 'high' }
      : undefined;
    const metadata = profile.kind === 'claude' ? deepSeekLevels ?? model.claude : providerCodexMetadata(provider, model);
    if (!metadata?.reasoningLevels.length) return [];
    return [{ id: model.id, name: model.id, efforts: metadata.reasoningLevels, defaultEffort: metadata.defaultReasoning ?? undefined }];
  });
}
export interface AgentModelCatalog {
  models: AgentModelOption[];
  status: 'loading' | 'refreshing' | 'ready' | 'unavailable';
}
export type CatalogReadMode = 'peek' | 'wait' | 'retry';
