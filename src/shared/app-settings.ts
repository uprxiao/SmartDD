import { z } from 'zod';

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const THEMES = ['ylight', 'ydark'] as const;
export type Theme = (typeof THEMES)[number];

export const TERMINAL_FONT_SIZE = { min: 10, max: 24 } as const;

/**
 * Strict schemas validate writes: an invalid value is rejected with an error instead of
 * being silently replaced by the default.
 */
export const APP_SETTINGS_STRICT_SCHEMA_MAP = {
  voice: z.object({
    provider: z.literal('typeless'),
    enabled: z.boolean(),
    globalEnabled: z.boolean(),
    globalShortcut: z.string().trim().min(1).max(80),
    shortcutOverride: z.string().trim().max(80).nullable(),
  }),
  general: z.object({
    language: z.enum(SUPPORTED_LANGUAGES),
  }),
  /** `null` = follow the system appearance. */
  theme: z.enum(THEMES).nullable(),
  terminal: z.object({
    fontFamily: z.string().trim().min(1),
    fontSize: z.number().int().min(TERMINAL_FONT_SIZE.min).max(TERMINAL_FONT_SIZE.max),
  }),
  /** The home page's last project / directory / AI profile, as in Yoda. Stale ids are ignored on read. */
  homeDraft: z.object({
    projectId: z.string().nullable(),
    dirId: z.string().nullable(),
    aiProfileId: z.string().nullable(),
  }),
};

export type AppSettings = {
  [K in keyof typeof APP_SETTINGS_STRICT_SCHEMA_MAP]: z.infer<(typeof APP_SETTINGS_STRICT_SCHEMA_MAP)[K]>;
};
export type AppSettingsKey = keyof AppSettings;
export const AppSettingsKeys = Object.keys(APP_SETTINGS_STRICT_SCHEMA_MAP) as AppSettingsKey[];

export const APP_SETTINGS_DEFAULTS: AppSettings = {
  voice: { provider: 'typeless', enabled: true, globalEnabled: false, globalShortcut: 'Command+Shift+Space', shortcutOverride: null },
  general: { language: 'zh-CN' },
  theme: null,
  terminal: { fontFamily: 'Menlo, Monaco, monospace', fontSize: 13 },
  homeDraft: { projectId: null, dirId: null, aiProfileId: null },
};

// Reads are lenient, as in Yoda: every field `.catch(default)` so one corrupt stored field
// falls back on its own instead of resetting the whole key.
function lenientObject<S extends z.ZodRawShape>(strict: z.ZodObject<S>, defaults: Record<string, unknown>) {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, field] of Object.entries(strict.shape)) shape[k] = (field as z.ZodType).catch(defaults[k]);
  return z.object(shape) as unknown as z.ZodObject<S>;
}

const strict = APP_SETTINGS_STRICT_SCHEMA_MAP;
export const APP_SETTINGS_SCHEMA_MAP: { [K in AppSettingsKey]: z.ZodType<AppSettings[K]> } = {
  voice: lenientObject(strict.voice, APP_SETTINGS_DEFAULTS.voice),
  general: lenientObject(strict.general, APP_SETTINGS_DEFAULTS.general),
  theme: strict.theme.catch(APP_SETTINGS_DEFAULTS.theme),
  terminal: lenientObject(strict.terminal, APP_SETTINGS_DEFAULTS.terminal),
  homeDraft: lenientObject(strict.homeDraft, APP_SETTINGS_DEFAULTS.homeDraft),
};

export interface AppSettingWithMeta<K extends AppSettingsKey> {
  value: AppSettings[K];
  defaults: AppSettings[K];
  overrides: Partial<AppSettings[K]>;
}

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  return structuredClone(APP_SETTINGS_DEFAULTS[key]);
}
