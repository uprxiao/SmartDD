import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { agentToolsChangedEvent } from '@shared/events';
import { events, rpc } from '@renderer/lib/ipc';
import { aiProfilesKey } from './useAiProfiles';

export const agentsKey=['agents'] as const;
export function useAgentToolEvents() {
  const client = useQueryClient();
  useEffect(() => events.on(agentToolsChangedEvent, () => {
    void client.invalidateQueries({ queryKey: agentsKey });
    void client.resetQueries({ queryKey: ['agent-model-catalog'] });
  }), [client]);
}

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
