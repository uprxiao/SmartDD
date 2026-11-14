import type { CodeAgentTool, ProviderView, RunConfigView } from '@shared/ai-agents';
import type { AgentSourceIdentity } from '@shared/agent-run-state';

export function agentSourceIdentity(config: RunConfigView, tool: CodeAgentTool, provider?: ProviderView): AgentSourceIdentity {
  if (config.toolId !== tool.id || config.kind !== tool.kind || !['claude', 'codex'].includes(tool.kind)) throw new Error('智能体工具身份不一致');
  if (config.source === 'provider' && (!provider || config.providerId !== provider.id)) throw new Error('原供应商已删除，请重新选择智能体');
  return { configId: config.id, toolId: tool.id, kind: tool.kind as AgentSourceIdentity['kind'], source: config.source,
    providerId: config.source === 'provider' ? provider!.id : null,
    providerRevision: config.source === 'provider' ? provider!.identityRevision : null,
    login: config.source === 'login' ? tool.login : null };
}

export function assertResumeSource(previous: AgentSourceIdentity, current: AgentSourceIdentity, explicitlySelected: boolean): void {
  if (previous.kind !== current.kind) throw new Error('只能选择同一个 Code Agent 的智能体恢复');
  const changed = previous.configId !== current.configId || previous.toolId !== current.toolId || previous.source !== current.source ||
    previous.providerId !== current.providerId || previous.providerRevision !== current.providerRevision || previous.login !== current.login || previous.legacyRevision !== current.legacyRevision;
  if (changed && !explicitlySelected) throw new Error('智能体认证来源已变化，请重新选择后恢复');
}

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const modelId = (value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()) && value.length <= 256 && !/^[\s-]|[\x00-\x1f\x7f]/.test(value);

/** Parse only native metadata fields. Assistant text and embedded tool payloads
 * never select a restore model. Claude requestedModel outranks alias identity.
 */
export function lastRequestedModel(kind: AgentSourceIdentity['kind'], lines: readonly unknown[]): string | null {
  let requested: string | null = null, fallback: string | null = null;
  for (const line of lines) {
    if (!object(line) || line.isSidechain === true || line.isApiErrorMessage === true) continue;
    if (kind === 'codex') {
      if (line.type === 'turn_context' && object(line.payload) && modelId(line.payload.model)) requested = line.payload.model;
    } else {
      if (line.type === 'assistant' && modelId(line.requestedModel)) requested = line.requestedModel;
      if (line.type === 'attachment' && object(line.attachment) && object(line.attachment.identity) && modelId(line.attachment.identity.modelId)) fallback = line.attachment.identity.modelId;
    }
  }
  return requested ?? fallback;
}

export function resumeModel(config: RunConfigView, provider: ProviderView | undefined, last: string | null): { model: string | null; changed: boolean; reason: string | null } {
  if (config.source !== 'provider') return { model: last, changed: false, reason: null };
  if (!provider || provider.id !== config.providerId) throw new Error('原供应商已删除，请重新选择智能体');
  const usable = (id: string | null): id is string => Boolean(id && config.models.includes(id) && provider.models.some((model) => model.id === id && !model.offline && model.availability[config.kind as 'claude' | 'codex'] !== 'unavailable'));
  if (usable(last)) return { model: last, changed: false, reason: null };
  if (!usable(config.defaultModel)) throw new Error('默认模型已下线或不可用，请先编辑智能体');
  return { model: config.defaultModel, changed: true, reason: last ? `上次模型 ${last} 不再允许，将使用 ${config.defaultModel}` : `无法读取上次模型，将使用 ${config.defaultModel}` };
}
