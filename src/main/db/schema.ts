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

// ---- M3: AI profiles and tasks ----

/** Runner + environment (PRD F04). Secret variable values live in `app_secrets` (`ai:<id>:env:<NAME>`). */
export const aiProfiles = sqliteTable('ai_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  runner: text('runner', { enum: ['claude', 'codex'] }).notNull(),
  /** null: the runner's own command on the login shell's PATH. */
  executable: text('executable'),
  /** JSON [{ name, secret, value }]; value is null for secret variables. */
  env: text('env').notNull().default('[]'),
  /** JSON string[] passed before SmartDD's own arguments. */
  args: text('args').notNull().default('[]'),
  color: text('color'),
  isDefault: integer('is_default', { mode: 'boolean' }).notNull().default(false),
  /** Last health result: a test, or an API answer seen in a task (the latest wins). */
  checkStatus: text('check_status', { enum: ['ok', 'failed', 'warning'] }),
  checkCategory: text('check_category'),
  /** manual / auto / task:<taskId> */
  checkSource: text('check_source'),
  checkMessage: text('check_message'),
  checkMs: integer('check_ms'),
  checkAt: integer('check_at'),
  ...timestamps,
});

/**
 * A task is one CLI conversation (PRD F05; called "session" in the PRD). Only metadata is kept,
 * never terminal output. Profile and project fields are snapshots taken at launch.
 */
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    dirId: text('dir_id').references(() => projectDirs.id, { onDelete: 'set null' }),
    cwd: text('cwd').notNull(),
    aiProfileId: text('ai_profile_id').references(() => aiProfiles.id, { onDelete: 'set null' }),
    aiProfileName: text('ai_profile_name'),
    runner: text('runner', { enum: ['claude', 'codex'] }).notNull(),
    nativeSessionId: text('native_session_id'),
    title: text('title').notNull(),
    firstMessage: text('first_message').notNull().default(''),
    /** JSON string[] of variable names given to the CLI on the last launch (no values). */
    injectedEnvNames: text('injected_env_names').notNull().default('[]'),
    configVersion: integer('config_version'),
    /** CLAUDE_CONFIG_DIR / CODEX_HOME in effect, so resume looks for the session file in the right place. */
    stateRoot: text('state_root'),
    archivedAt: integer('archived_at'),
    lastLaunchedAt: integer('last_launched_at'),
    ...timestamps,
  },
  (t) => ({ byProject: index('tasks_project_idx').on(t.projectId) })
);
