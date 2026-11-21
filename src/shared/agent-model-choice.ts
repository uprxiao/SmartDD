import { z } from 'zod';

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
export interface AgentModelCatalog {
  models: AgentModelOption[];
  status: 'loading' | 'refreshing' | 'ready' | 'unavailable';
}
export type CatalogReadMode = 'peek' | 'wait' | 'retry';
