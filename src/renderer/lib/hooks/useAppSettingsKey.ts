// Modeled on Yoda (Apache-2.0) src/renderer/lib/hooks/useAppSettingsKey.ts.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AppSettings, AppSettingsKey, AppSettingWithMeta } from '@shared/app-settings';
import { rpcErrorMessage } from '@shared/ipc/rpc';
import i18n from '@renderer/lib/i18n';
import { rpc } from '@renderer/lib/ipc';

export const appSettingsQueryKey = (key: AppSettingsKey) => ['appSettings', key, 'meta'] as const;

export function useAppSettingsKey<K extends AppSettingsKey>(key: K) {
  const queryClient = useQueryClient();
  const queryKey = appSettingsQueryKey(key);

  const query = useQuery({
    queryKey,
    queryFn: () => rpc.appSettings.getWithMeta(key) as Promise<AppSettingWithMeta<K>>,
    staleTime: Infinity,
  });

  const update = useMutation({
    mutationFn: (value: AppSettings[K] | Partial<AppSettings[K]>) => rpc.appSettings.update(key, value),
    // Optimistic: the UI moves at once and rolls back if main rejects the value.
    onMutate: async (value) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<AppSettingWithMeta<K>>(queryKey);
      if (previous) {
        const next =
          value !== null && typeof value === 'object' && !Array.isArray(value)
            ? ({ ...(previous.value as object), ...value } as AppSettings[K])
            : (value as AppSettings[K]);
        queryClient.setQueryData<AppSettingWithMeta<K>>(queryKey, { ...previous, value: next });
      }
      return { previous };
    },
    onError: (error, _value, context) => {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
      toast.error(i18n.t('settings.saveFailed', { message: rpcErrorMessage(error) }));
    },
    // Re-read what main actually stored instead of trusting the optimistic value.
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  const reset = useMutation({
    mutationFn: () => rpc.appSettings.reset(key),
    onError: (error) => toast.error(i18n.t('settings.saveFailed', { message: rpcErrorMessage(error) })),
    onSettled: () => queryClient.invalidateQueries({ queryKey }),
  });

  return {
    value: query.data?.value,
    defaults: query.data?.defaults,
    overrides: query.data?.overrides,
    isLoading: query.isLoading,
    update: update.mutate,
    reset: reset.mutate,
  };
}
