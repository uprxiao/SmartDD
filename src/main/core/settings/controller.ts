import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { createRPCController } from '@shared/ipc/rpc';
import type { SettingsStore } from './settings-service';

export function createAppSettingsController(store: SettingsStore, onChanged: (key: AppSettingsKey) => void) {
  return createRPCController({
    get: <K extends AppSettingsKey>(key: K) => store.get(key),
    getAll: () => store.getAll(),
    getWithMeta: <K extends AppSettingsKey>(key: K) => store.getWithMeta(key),
    update: async <K extends AppSettingsKey>(key: K, value: AppSettings[K] | Partial<AppSettings[K]>) => {
      const saved = await store.update(key, value);
      onChanged(key);
      return saved;
    },
    reset: async (key: AppSettingsKey) => {
      await store.reset(key);
      onChanged(key);
    },
    resetField: async (key: AppSettingsKey, field: string) => {
      await store.resetField(key, field);
      onChanged(key);
    },
  });
}
