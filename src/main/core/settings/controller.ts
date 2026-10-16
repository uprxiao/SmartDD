import { APP_SETTINGS_DEFAULTS } from '@shared/app-settings';
import type { VoiceService } from '../voice/voice-service';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import { createRPCController } from '@shared/ipc/rpc';
import type { SettingsStore } from './settings-service';

export function createAppSettingsController(store: SettingsStore, onChanged: (key: AppSettingsKey) => void, voice?: VoiceService) {
  return createRPCController({
    get: <K extends AppSettingsKey>(key: K) => store.get(key),
    getAll: () => store.getAll(),
    getWithMeta: <K extends AppSettingsKey>(key: K) => store.getWithMeta(key),
    update: async <K extends AppSettingsKey>(key: K, value: AppSettings[K] | Partial<AppSettings[K]>) => {
      const saved = key === 'voice' && voice ? await voice.update(value as Partial<AppSettings['voice']>) as AppSettings[K] : await store.update(key, value);
      onChanged(key);
      return saved;
    },
    reset: async (key: AppSettingsKey) => {
      if (key === 'voice' && voice) await voice.reset();
      else await store.reset(key);
      onChanged(key);
    },
    resetField: async (key: AppSettingsKey, field: string) => {
      if (key === 'voice' && voice) {
        if (!(field in APP_SETTINGS_DEFAULTS.voice)) throw new Error('Invalid voice field');
        await voice.update({ [field]: APP_SETTINGS_DEFAULTS.voice[field as keyof AppSettings['voice']] });
      } else await store.resetField(key, field);
      onChanged(key);
    },
  });
}
