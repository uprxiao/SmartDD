import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

export const aiProfilesKey = ['aiProfiles'] as const;

export function useAiProfiles() {
  return useQuery({ queryKey: aiProfilesKey, queryFn: () => rpc.aiProfiles.list() });
}

export function useRefreshAiProfiles() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: aiProfilesKey });
}
