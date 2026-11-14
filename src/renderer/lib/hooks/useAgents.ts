import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';
import { aiProfilesKey } from './useAiProfiles';

export const agentsKey=['agents'] as const;
export function useAgents(){
  return useQuery({queryKey:agentsKey,queryFn:async()=>{
    const [configs,providers,tools]=await Promise.all([rpc.agents.list(),rpc.agents.providers(),rpc.agents.tools()]);
    return {configs,providers,tools};
  }});
}
export function useRefreshAgents(){
  const client=useQueryClient();
  return async()=>{await Promise.all([client.invalidateQueries({queryKey:agentsKey}),client.invalidateQueries({queryKey:aiProfilesKey})]);};
}
