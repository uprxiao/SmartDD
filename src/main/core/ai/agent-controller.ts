import { createRPCController } from '@shared/ipc/rpc';
import type { CodeAgentKind, ProviderInput, RunConfigInput } from '@shared/ai-agents';
import type { AgentService } from './agent-service';
import type { AgentToolService } from './agent-tools';
import type { ProviderService } from './provider-service';
import type { AiProfileService } from './ai-profile-service';

export function createAgentController(service: AgentService, tools: AgentToolService, providers: ProviderService,profiles:AiProfileService,onTasksChanged?:()=>void,onConfigurationChanged?:()=>void) {
  return {
    agents: createRPCController({
      tools: () => service.tools(),
      refreshTools: () => tools.refresh(),
      customToolPath: async(kind: string,path:string|null,toolId?:string)=>{const result=await tools.customPath(kind,path,toolId);onConfigurationChanged?.();return result;},
      providers: () => service.providers(),
      saveProvider:(input:ProviderInput,id?:string)=>{const result=providers.save(input,id);onConfigurationChanged?.();return result;},
      deleteProvider: (id: string) => { const deleted=providers.delete(id);onTasksChanged?.();onConfigurationChanged?.();return deleted; },
      refreshProviderModels: (id: string) => providers.refresh(id),
      providerModelCatalog: (id: string) => providers.modelCatalog(id),
      saveProviderModels:(id:string,expected:string[],selected:string[],revision:number)=>{const result=providers.saveModelSelection(id,expected,selected,revision);onConfigurationChanged?.();return result;},
      probeProvider: (id: string, kind: CodeAgentKind) => providers.probe(id, kind),
      checkProviderModel: (id: string, kind: CodeAgentKind, model: string) => providers.check(id, kind, model),
      list: () => service.configs(),
      save:(input:RunConfigInput,id?:string)=>{const result=service.saveConfig(input,id);onConfigurationChanged?.();return result;},
      delete: (id: string) => { service.deleteConfig(id);onTasksChanged?.();onConfigurationChanged?.(); },
      setDefault: (id: string) => service.setDefault(id),
      reorder: (id: string, index: number) => service.reorder(id, index),
      homeVisible:(id:string,visible:boolean)=>service.setHomeVisible(id,visible),
      updateLegacy:(id:string,input:Parameters<AiProfileService['updateLegacy']>[1])=>profiles.updateLegacy(id,input),
    }),
  };
}
