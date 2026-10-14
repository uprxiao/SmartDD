import { sql } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Column layout of `sessions` / `app_secrets` matches the M0 tables so the first
// migration (CREATE TABLE IF NOT EXISTS) adopts existing databases unchanged.

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  runner: text('runner', { enum: ['claude', 'codex'] }).notNull(),
  cwd: text('cwd').notNull(),
  nativeSessionId: text('native_session_id'),
  title: text('title').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** safeStorage ciphertext (base64); the master key lives in the macOS Keychain. */
export const appSecrets = sqliteTable('app_secrets', {
  key: text('key').primaryKey(),
  secret: text('secret').notNull(),
});

/** One row per settings key holding only the delta from defaults (JSON). */
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at')
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});
