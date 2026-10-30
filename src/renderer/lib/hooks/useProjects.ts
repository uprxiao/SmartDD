import { useQuery, useQueryClient } from '@tanstack/react-query';
import { rpc } from '@renderer/lib/ipc';

export const projectListKey = (includeArchived: boolean) => ['projects', { includeArchived }] as const;
export const projectKey = (id: string) => ['project', id] as const;

export function useProjectList(includeArchived = false) {
  return useQuery({
    queryKey: projectListKey(includeArchived),
    networkMode: 'always', // Local IPC; main owns filesystem and provider failures.
    queryFn: () => rpc.projects.list({ includeArchived }),
  });
}

export function useProject(id: string | null) {
  return useQuery({
    queryKey: projectKey(id ?? ''),
    networkMode: 'always',
    queryFn: () => rpc.projects.get(id as string),
    enabled: Boolean(id),
    // Directory status is read from disk; coming back to the window should show moved/deleted dirs.
    refetchOnWindowFocus: true,
  });
}

/** Every write re-reads from main rather than patching the cache: main is the source of truth. */
export function useRefreshProjects() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['projects'] }),
      queryClient.invalidateQueries({ queryKey: ['project'] }),
    ]);
}
