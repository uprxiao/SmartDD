import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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

// ---- M2: projects and their resources ----
// Secrets are never stored here: passwords live in `app_secrets` under keys derived
// from the row id (see src/main/core/projects/secret-keys.ts).

const timestamps = {
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
};

/** Result of the last connection test, kept on the row so the card can show it. */
const lastTest = {
  lastTestAt: integer('last_test_at'),
  lastTestOk: integer('last_test_ok', { mode: 'boolean' }),
  lastTestCategory: text('last_test_category'),
  lastTestMessage: text('last_test_message'),
  lastTestMs: integer('last_test_ms'),
};

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** JSON string[]: names used to match natural language ("AIS"). */
  aliases: text('aliases').notNull().default('[]'),
  description: text('description').notNull().default(''),
  rulesPath: text('rules_path'),
  /** Bumped on every change to the project or its resources; sessions record the version they started with. */
  configVersion: integer('config_version').notNull().default(1),
  archivedAt: integer('archived_at'),
  ...timestamps,
});

export const projectDirs = sqliteTable(
  'project_dirs',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    label: text('label').notNull().default(''),
    path: text('path').notNull(),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    ...timestamps,
  },
  (t) => ({ byProject: index('project_dirs_project_idx').on(t.projectId) })
);

export const projectDatabases = sqliteTable(
  'project_databases',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** dev / test / prod, or a custom label. */
    env: text('env').notNull(),
    label: text('label').notNull().default(''),
    aliases: text('aliases').notNull().default('[]'),
    vendor: text('vendor').notNull(),
    host: text('host').notNull(),
    port: integer('port').notNull(),
    database: text('database').notNull().default(''),
    schema: text('schema'),
    username: text('username').notNull().default(''),
    accessLevel: text('access_level', { enum: ['readonly', 'readwrite'] }).notNull().default('readonly'),
    isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
    note: text('note').notNull().default(''),
    ...lastTest,
    ...timestamps,
  },
  (t) => ({ byProject: index('project_databases_project_idx').on(t.projectId) })
);

export const projectServers = sqliteTable(
  'project_servers',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    env: text('env').notNull(),
    label: text('label').notNull().default(''),
    aliases: text('aliases').notNull().default('[]'),
    host: text('host').notNull(),
    port: integer('port').notNull().default(22),
    username: text('username').notNull(),
    authType: text('auth_type', { enum: ['password', 'key'] }).notNull(),
    privateKeyPath: text('private_key_path'),
    /** Mirrors remote-password-ssh: log in, then `sudo -i`. */
    defaultRoot: integer('default_root', { mode: 'boolean' }).notNull().default(false),
    /** none: no sudo; same-as-login: reuse the login password; separate: its own secret. */
    sudoPolicy: text('sudo_policy', { enum: ['none', 'same-as-login', 'separate'] })
      .notNull()
      .default('none'),
    appRoot: text('app_root'),
    logsPath: text('logs_path'),
    note: text('note').notNull().default(''),
    ...lastTest,
    ...timestamps,
  },
  (t) => ({ byProject: index('project_servers_project_idx').on(t.projectId) })
);
