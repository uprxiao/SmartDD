import { randomUUID } from 'node:crypto';
import type { AgentService } from './agent-service';
import type { AiProfileService } from './ai-profile-service';
import type { ProviderService } from './provider-service';
import { planAgentLaunch } from './agent-launch-plan';

/** Resolve credentials for a selected managed MCP without starting an Agent or writing launch files. */
export function managedMcpSourceEnvironment(profileId: string, deps: {
  agents: AgentService;
  providers: ProviderService;
  profiles: AiProfileService;
  userData: string;
}): Record<string, string> {
  const config = deps.agents.configs().find(item => item.id === profileId);
  if (!config || config.source === 'legacy') return deps.profiles.resolve(profileId).env;
  const tool = deps.agents.tools().find(item => item.id === config.toolId);
  if (!tool) throw new Error('来源 Code Agent 已删除');
  const provider = config.providerId ? deps.agents.providers().find(item => item.id === config.providerId) : undefined;
  if (config.source === 'provider' && !provider) throw new Error('来源供应商已删除');
  if (config.kind !== 'claude' && config.kind !== 'codex') throw new Error('来源 Code Agent 暂不支持');
  const connection = provider ? deps.providers.runtimeConnection(provider.id, config.kind) : undefined;
  return planAgentLaunch({
    config, tool, provider, key: connection?.target.key, permission: 'ask',
    cwd: deps.userData, userData: deps.userData, runId: randomUUID(),
  }).profile.env;
}
