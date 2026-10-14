// Modeled on Yoda (Apache-2.0) src/main/core/settings/settings-service.ts.
import { eq } from 'drizzle-orm';
import {
  APP_SETTINGS_SCHEMA_MAP,
  APP_SETTINGS_STRICT_SCHEMA_MAP,
  AppSettingsKeys,
  getDefaultForKey,
  type AppSettingWithMeta,
  type AppSettings,
  type AppSettingsKey,
} from '@shared/app-settings';
import type { AppDb } from '@main/db/client';
import { appSettings } from '@main/db/schema';
import { computeDelta, isDeepEqual, isPlainObject, mergeDeep } from './utils';

export class SettingsStore {
  private cache: Partial<AppSettings> = {};
  /** Serializes writes per key so concurrent partial updates cannot clobber each other's fields. */
  private writeQueues: Partial<Record<AppSettingsKey, Promise<unknown>>> = {};

  constructor(private readonly db: AppDb) {}

  private runSerialized<T>(key: AppSettingsKey, task: () => Promise<T> | T): Promise<T> {
    const prev = this.writeQueues[key] ?? Promise.resolve();
    const next = prev.then(task, task);
    this.writeQueues[key] = next.catch(() => undefined);
    return next;
  }

  /** `undefined` = never stored (or corrupt JSON). A stored JSON `null` is a real value. */
  private readRaw(key: AppSettingsKey): unknown {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get();
    if (!row) return undefined;
    try {
      return JSON.parse(row.value);
    } catch {
      return undefined;
    }
  }

  private storeRaw(key: AppSettingsKey, value: unknown): void {
    const serialized = JSON.stringify(value);
    const now = Date.now();
    this.db
      .insert(appSettings)
      .values({ key, value: serialized, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: serialized, updatedAt: now } })
      .run();
  }

  private deleteRow(key: AppSettingsKey): void {
    this.db.delete(appSettings).where(eq(appSettings.key, key)).run();
  }

  private resolve<K extends AppSettingsKey>(key: K, raw: unknown): { value: AppSettings[K]; valid: boolean } {
    const defaults = getDefaultForKey(key);
    let candidate: unknown = raw === undefined ? defaults : raw;
    if (isPlainObject(raw) && isPlainObject(defaults)) candidate = mergeDeep(defaults, raw);
    const parsed = APP_SETTINGS_SCHEMA_MAP[key].safeParse(candidate);
    return parsed.success ? { value: parsed.data as AppSettings[K], valid: true } : { value: defaults, valid: false };
  }

  get<K extends AppSettingsKey>(key: K): AppSettings[K] {
    if (key in this.cache) return this.cache[key] as AppSettings[K];
    const { value } = this.resolve(key, this.readRaw(key));
    this.cache[key] = value;
    return value;
  }

  getWithMeta<K extends AppSettingsKey>(key: K): AppSettingWithMeta<K> {
    const defaults = getDefaultForKey(key);
    const raw = this.readRaw(key);
    const { value, valid } = this.resolve(key, raw);
    if (raw === undefined || !valid) return { value: defaults, defaults, overrides: {} };
    const overrides =
      isPlainObject(raw) && isPlainObject(defaults) ? computeDelta(raw, defaults) : isDeepEqual(raw, defaults) ? {} : raw;
    return { value, defaults, overrides: overrides as Partial<AppSettings[K]> };
  }

  getAll(): AppSettings {
    return Object.fromEntries(AppSettingsKeys.map((k) => [k, this.get(k)])) as AppSettings;
  }

  /** Object settings accept partial updates, merged onto the current value before validation. */
  update<K extends AppSettingsKey>(key: K, value: AppSettings[K] | Partial<AppSettings[K]>): Promise<AppSettings[K]> {
    return this.runSerialized(key, () => {
      const defaults = getDefaultForKey(key);
      const current = this.get(key);
      const merged = isPlainObject(value) && isPlainObject(current) ? mergeDeep(current, value) : value;
      // Strict on write: the lenient read schema would silently swap a bad value for the default.
      const parsed = APP_SETTINGS_STRICT_SCHEMA_MAP[key].safeParse(merged);
      if (!parsed.success) {
        throw new Error(`设置 ${key} 的值无效：${parsed.error.issues.map((i) => `${i.path.join('.') || key} ${i.message}`).join('；')}`);
      }
      const validated = parsed.data as AppSettings[K];
      if (isPlainObject(validated) && isPlainObject(defaults)) {
        const delta = computeDelta(validated, defaults);
        if (Object.keys(delta).length === 0) this.deleteRow(key);
        else this.storeRaw(key, delta);
      } else if (isDeepEqual(validated, defaults)) {
        this.deleteRow(key);
      } else {
        this.storeRaw(key, validated);
      }
      delete this.cache[key];
      return validated;
    });
  }

  reset(key: AppSettingsKey): Promise<void> {
    return this.runSerialized(key, () => {
      this.deleteRow(key);
      delete this.cache[key];
    });
  }

  resetField<K extends AppSettingsKey>(key: K, field: string): Promise<void> {
    return this.runSerialized(key, () => {
      const raw = this.readRaw(key);
      if (!isPlainObject(raw)) return;
      const delta = { ...raw };
      delete delta[field];
      if (Object.keys(delta).length === 0) this.deleteRow(key);
      else this.storeRaw(key, delta);
      delete this.cache[key];
    });
  }
}
