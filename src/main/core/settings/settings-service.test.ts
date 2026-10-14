import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDbClient, type DbClient } from '@main/db/client';
import { runBundledMigrations } from '@main/db/migrations';
import { APP_SETTINGS_DEFAULTS } from '@shared/app-settings';
import { SettingsStore } from './settings-service';

let client: DbClient;
let store: SettingsStore;

beforeEach(() => {
  client = openDbClient(':memory:');
  runBundledMigrations(client.sqlite);
  store = new SettingsStore(client.db);
});
afterEach(() => client.close());

/** Reads the table directly: the store's own answer is not proof of what was persisted. */
const rows = () =>
  Object.fromEntries(
    (client.sqlite.prepare('SELECT key, value FROM app_settings').all() as { key: string; value: string }[]).map((r) => [
      r.key,
      JSON.parse(r.value),
    ])
  );
const putRaw = (key: string, value: string) =>
  client.sqlite.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run(key, value);

describe('SettingsStore', () => {
  it('returns defaults for an empty table', () => {
    expect(store.getAll()).toEqual(APP_SETTINGS_DEFAULTS);
    expect(store.getWithMeta('terminal').overrides).toEqual({});
  });

  it('stores only the delta from the defaults', async () => {
    await store.update('terminal', { fontSize: 16 });
    expect(rows()).toEqual({ terminal: { fontSize: 16 } });
    expect(store.get('terminal')).toEqual({ fontFamily: 'Menlo, Monaco, monospace', fontSize: 16 });
    expect(store.getWithMeta('terminal').overrides).toEqual({ fontSize: 16 });
  });

  it('deletes the row once a value is back to the default', async () => {
    await store.update('terminal', { fontSize: 16 });
    await store.update('terminal', { fontSize: 13 });
    expect(rows()).toEqual({});
    await store.update('theme', 'ydark');
    expect(rows()).toEqual({ theme: 'ydark' });
    await store.update('theme', null);
    expect(rows()).toEqual({});
  });

  it('survives a new store instance (persisted, not cached)', async () => {
    await store.update('general', { language: 'en' });
    expect(new SettingsStore(client.db).get('general')).toEqual({ language: 'en' });
  });

  it('rejects invalid writes instead of silently using the default', async () => {
    await store.update('terminal', { fontSize: 16 });
    await expect(store.update('terminal', { fontSize: 99 })).rejects.toThrow(/terminal 的值无效/);
    await expect(store.update('theme', 'neon' as never)).rejects.toThrow(/theme 的值无效/);
    await expect(store.update('terminal', { fontFamily: '   ' })).rejects.toThrow(/fontFamily/);
    expect(rows()).toEqual({ terminal: { fontSize: 16 } });
  });

  it('falls back per field when a stored value is corrupt', () => {
    putRaw('terminal', JSON.stringify({ fontSize: 'huge', fontFamily: 'Fira Code' }));
    expect(store.get('terminal')).toEqual({ fontFamily: 'Fira Code', fontSize: 13 });
    putRaw('theme', JSON.stringify('neon'));
    putRaw('general', '{not json');
    const fresh = new SettingsStore(client.db);
    expect(fresh.get('theme')).toBeNull();
    expect(fresh.get('general')).toEqual({ language: 'zh-CN' });
  });

  it('serializes concurrent partial updates to the same key', async () => {
    await Promise.all([store.update('terminal', { fontSize: 18 }), store.update('terminal', { fontFamily: 'Fira Code' })]);
    expect(rows()).toEqual({ terminal: { fontSize: 18, fontFamily: 'Fira Code' } });
  });

  it('a failed write does not block later writes on the same key', async () => {
    const bad = store.update('terminal', { fontSize: 1 });
    const good = store.update('terminal', { fontSize: 20 });
    await expect(bad).rejects.toThrow();
    await expect(good).resolves.toMatchObject({ fontSize: 20 });
  });

  it('reset and resetField', async () => {
    await store.update('terminal', { fontSize: 18, fontFamily: 'Fira Code' });
    await store.resetField('terminal', 'fontSize');
    expect(rows()).toEqual({ terminal: { fontFamily: 'Fira Code' } });
    expect(store.get('terminal').fontSize).toBe(13);
    await store.resetField('terminal', 'fontFamily');
    expect(rows()).toEqual({});
    await store.update('theme', 'ylight');
    await store.reset('theme');
    expect(rows()).toEqual({});
    expect(store.get('theme')).toBeNull();
  });
});
