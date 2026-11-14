import { createRPCController } from '@shared/ipc/rpc';
import type { CodeAgentKind, ProviderInput, RunConfigInput } from '@shared/ai-agents';
import type { AgentService } from './agent-service';
import type { AgentToolService } from './agent-tools';
import type { ProviderService } from './provider-service';
import type { AiProfileService } from './ai-profile-service';

export function createAgentController(service: AgentService, tools: AgentToolService, providers: ProviderService,profiles:AiProfileService,onTasksChanged?:()=>void) {
  return {
    agents: createRPCController({
      tools: () => service.tools(),
      refreshTools: () => tools.refresh(),
      customToolPath: (kind: string, path: string | null,toolId?:string) => tools.customPath(kind, path,toolId),
      providers: () => service.providers(),
      saveProvider: (input: ProviderInput, id?: string) => providers.save(input, id),
      deleteProvider: (id: string) => { const deleted=providers.delete(id);onTasksChanged?.();return deleted; },
      refreshProviderModels: (id: string) => providers.refresh(id),
      probeProvider: (id: string, kind: CodeAgentKind) => providers.probe(id, kind),
      checkProviderModel: (id: string, kind: CodeAgentKind, model: string) => providers.check(id, kind, model),
      list: () => service.configs(),
      save: (input: RunConfigInput, id?: string) => service.saveConfig(input, id),
      delete: (id: string) => { service.deleteConfig(id);onTasksChanged?.(); },
      setDefault: (id: string) => service.setDefault(id),
      reorder: (id: string, index: number) => service.reorder(id, index),
      homeVisible:(id:string,visible:boolean)=>service.setHomeVisible(id,visible),
      updateLegacy:(id:string,input:Parameters<AiProfileService['updateLegacy']>[1])=>profiles.updateLegacy(id,input),
    }),
  };
}
