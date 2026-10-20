import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
  /** Imported command unavailable on this computer; a manual configuration/test releases it. */
  commandPending: integer('command_pending', { mode: 'boolean' }).notNull().default(false),
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
    /** M4: version pins, hashes and injection self-check, never secret values. */
    runtimeSnapshot: text('runtime_snapshot'),
    archivedAt: integer('archived_at'),
    lastLaunchedAt: integer('last_launched_at'),
    ...timestamps,
  },
  (t) => ({ byProject: index('tasks_project_idx').on(t.projectId) })
);

// Installed standard packages are immutable; upgrading switches the active version only.
export const skillVersions = sqliteTable('skill_versions', {
  id: text('id').primaryKey(),
  skillId: text('skill_id').notNull(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  hash: text('hash').notNull(),
  installedAt: integer('installed_at').notNull(),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
});

/** Absence means enabled (new projects get the standard catalog by default). */
export const projectCapabilities = sqliteTable('project_capabilities', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  capabilityId: text('capability_id').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
});

/** Committed atomically with an imported project. Contains no credentials. */
export const projectImportReceipts = sqliteTable('project_import_receipts', {
  requestId: text('request_id').primaryKey(),
  fingerprint: text('fingerprint').notNull(),
  result: text('result').notNull(),
  createdAt: integer('created_at').notNull(),
});

/** Ownership survives resource deletion until the unreferenced file is removed. */
export const importedKeys = sqliteTable('imported_keys', {
  serverId: text('server_id').primaryKey(),
  path: text('path').notNull(),
  createdAt: integer('created_at').notNull(),
});

// ---- M10: immutable application packages and durable session/resource ownership ----
// Session snapshots intentionally have no FK to tasks: native-history tombstones retain resources.
export const capabilityResources = sqliteTable('capability_resources', {
  resourceId: text('resource_id').primaryKey(), kind: text('kind').notNull(), contentHash: text('content_hash').notNull(),
  ownerStoreId: text('owner_store_id').notNull(), pathScope: text('path_scope', { enum: ['C', 'H'] }).notNull(),
  relativePath: text('relative_path').notNull(),
  state: text('state', { enum: ['staged', 'verified', 'ready', 'deleting', 'removed', 'recovery-required'] }).notNull(),
  generation: integer('generation').notNull().default(1), integrity: text('integrity', { enum: ['unknown', 'valid', 'invalid'] }).notNull(), operationId: text('operation_id'),
}, t => ({ ownedPath: uniqueIndex('capability_resources_owned_path').on(t.ownerStoreId, t.pathScope, t.relativePath) }));
export const capabilityResourceDependencies = sqliteTable('capability_resource_dependencies', {
  resourceId: text('resource_id').notNull().references(() => capabilityResources.resourceId),
  dependencyId: text('dependency_id').notNull().references(() => capabilityResources.resourceId),
}, t => ({ pk: primaryKey({ columns: [t.resourceId, t.dependencyId] }) }));
export const capabilityResourceLeases = sqliteTable('capability_resource_leases', {
  leaseId: text('lease_id').primaryKey(), resourceId: text('resource_id').notNull().references(() => capabilityResources.resourceId),
  ownerKind: text('owner_kind').notNull(), ownerId: text('owner_id').notNull(), hostInstanceId: text('host_instance_id').notNull(),
  pid: integer('pid'), processStartedAt: text('process_started_at'), state: text('state').notNull(), createdAt: text('created_at').notNull(), endedAt: text('ended_at'),
}, t => ({ byResource: index('capability_resource_leases_resource_idx').on(t.resourceId, t.state) }));
export const capabilityResourceOperations = sqliteTable('capability_resource_operations', {
  operationId: text('operation_id').primaryKey(), kind: text('kind').notNull(), ownerStoreId: text('owner_store_id').notNull(),
  state: text('state').notNull(), planJson: text('plan_json').notNull(), errorCode: text('error_code'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const capabilityPackages = sqliteTable('capability_packages', {
  packageHash: text('package_hash').primaryKey(), appId: text('app_id').notNull(), version: text('version').notNull(), hashAlgorithm: text('hash_algorithm').notNull(),
  relativePath: text('relative_path').notNull(), manifestJson: text('manifest_json').notNull(), resourceId: text('resource_id').notNull().references(() => capabilityResources.resourceId), installedAt: text('installed_at').notNull(),
}, t => ({ identity: uniqueIndex('capability_packages_identity').on(t.appId, t.version) }));
export const capabilityActivePackages = sqliteTable('capability_active_packages', {
  appId: text('app_id').primaryKey(), packageHash: text('package_hash').notNull().references(() => capabilityPackages.packageHash), activationGeneration: integer('activation_generation').notNull(), activatedAt: text('activated_at').notNull(),
});
export const capabilityInstallJournal = sqliteTable('capability_install_journal', {
  installId: text('install_id').primaryKey().references(() => capabilityResourceOperations.operationId), hostBuild: text('host_build').notNull(), fromGeneration: integer('from_generation'), toGeneration: integer('to_generation'),
  state: text('state').notNull(), planJson: text('plan_json').notNull(), backupPath: text('backup_path'), errorCode: text('error_code'), updatedAt: text('updated_at').notNull(),
});
export const capabilitySessionSnapshots = sqliteTable('capability_session_snapshots', {
  taskId: text('task_id').primaryKey(), schemaVersion: integer('schema_version').notNull(), snapshotJson: text('snapshot_json').notNull(), snapshotHash: text('snapshot_hash').notNull(), createdAt: text('created_at').notNull(), legacyStatus: text('legacy_status').notNull(), retentionState: text('retention_state', { enum: ['active', 'tombstone', 'hold'] }).notNull(),
});
export const capabilitySessionRefs = sqliteTable('capability_session_refs', {
  taskId: text('task_id').notNull().references(() => capabilitySessionSnapshots.taskId), refKind: text('ref_kind').notNull(), refId: text('ref_id').notNull().references(() => capabilityResources.resourceId), refHash: text('ref_hash').notNull(), relativePath: text('relative_path').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.taskId, t.refKind, t.refId] }), byResource: index('capability_session_refs_resource_idx').on(t.refId) }));
export const capabilityRuns = sqliteTable('capability_runs', {
  runId: text('run_id').primaryKey(), taskId: text('task_id').notNull().references(() => capabilitySessionSnapshots.taskId), projectId: text('project_id').notNull().references(() => projects.id), runner: text('runner').notNull(), pid: integer('pid'), processStartedAt: text('process_started_at'), state: text('state').notNull(), startedAt: text('started_at').notNull(), endedAt: text('ended_at'), errorCode: text('error_code'),
});
export const capabilitySchemaMigrations = sqliteTable('capability_schema_migrations', {
  appId: text('app_id').notNull(), migrationId: text('migration_id').notNull(), checksum: text('checksum').notNull(), fromVersion: integer('from_version').notNull(), toVersion: integer('to_version').notNull(), appliedAt: text('applied_at').notNull(), hostBuild: text('host_build').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.appId, t.migrationId] }) }));
