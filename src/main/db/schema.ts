import { sql } from 'drizzle-orm';
import { blob, foreignKey, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
    /** NULL: unknown or running without evidence; false: owned exit without history; true: history observed. */
    nativeHistoryObserved: integer('native_history_observed', { mode: 'boolean' }),
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
  relativePath: text('relative_path').notNull(),scopeIdentity: text('scope_identity').notNull().default(''),scopeRelativePath: text('scope_relative_path'),
  state: text('state', { enum: ['staged', 'verified', 'ready', 'deleting', 'removed', 'recovery-required'] }).notNull(),
  generation: integer('generation').notNull().default(1), integrity: text('integrity', { enum: ['unknown', 'valid', 'invalid'] }).notNull(), operationId: text('operation_id'),
}, t => ({ ownedPath: uniqueIndex('capability_resources_owned_path').on(t.ownerStoreId, t.pathScope, t.relativePath),discoveryPath: uniqueIndex('capability_resources_discovery_path').on(t.scopeIdentity,t.scopeRelativePath).where(sql`${t.pathScope}='H' AND ${t.state}<>'removed'`) }));
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
  runId: text('run_id').primaryKey(), taskId: text('task_id').notNull().references(() => capabilitySessionSnapshots.taskId), projectId: text('project_id').notNull(), runner: text('runner').notNull(), pid: integer('pid'), processStartedAt: text('process_started_at'), state: text('state').notNull(), startedAt: text('started_at').notNull(), endedAt: text('ended_at'), errorCode: text('error_code'), snapshotHash: text('snapshot_hash'),ownerInstanceId: text('owner_instance_id'),ownerPid: integer('owner_pid'),ownerStartedAt: text('owner_started_at'),bindingsJson: text('bindings_json').notNull().default('[]'),ptyId: text('pty_id'),revocationState: text('revocation_state').notNull().default('open'),
});
export const capabilitySchemaMigrations = sqliteTable('capability_schema_migrations', {
  appId: text('app_id').notNull(), migrationId: text('migration_id').notNull(), checksum: text('checksum').notNull(), fromVersion: integer('from_version').notNull(), toVersion: integer('to_version').notNull(), appliedAt: text('applied_at').notNull(), hostBuild: text('host_build').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.appId, t.migrationId] }) }));

export const applicationConnections = sqliteTable('application_connections', {
  id: text('id').primaryKey(), appId: text('app_id').notNull(), providerId: text('provider_id').notNull(), name: text('name').notNull(), configSchemaVersion: integer('config_schema_version').notNull().default(1), configJson: text('config_json').notNull(),
  revision: integer('revision').notNull(), configRevision: integer('config_revision').notNull(), identityRevision: integer('identity_revision').notNull(), verifiedIdentityJson: text('verified_identity_json').notNull(), identityHash: text('identity_hash').notNull(),
  secretRef: text('secret_ref'), secretRevision: integer('secret_revision').notNull(), policyRevision: integer('policy_revision').notNull(), enabled: integer('enabled', { mode: 'boolean' }).notNull(), authState: text('auth_state').notNull(), health: text('health').notNull(), healthCode: text('health_code'), healthMessage: text('health_message'), testedAt: text('tested_at'), cleanupPending: integer('cleanup_pending', { mode: 'boolean' }).notNull().default(false), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => ({ byProvider: index('application_connections_provider_idx').on(t.providerId, t.appId), identityKey: uniqueIndex('application_connections_identity_key').on(t.id, t.providerId, t.appId) }));
export const applicationSecretChanges = sqliteTable('application_secret_changes', {
  operationId: text('operation_id').primaryKey(), connectionId: text('connection_id').notNull(), expectedRevision: integer('expected_revision').notNull(), oldSecretRef: text('old_secret_ref'), newSecretRef: text('new_secret_ref'), candidateHash: text('candidate_hash').notNull(), candidateJson: text('candidate_json').notNull(), verifiedIdentityJson: text('verified_identity_json'), compatibilityPlanJson: text('compatibility_plan_json'), expiresAt: text('expires_at').notNull(), state: text('state').notNull(), errorCode: text('error_code'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const applicationCatalogState = sqliteTable('application_catalog_state', {
  appId: text('app_id').primaryKey(), added: integer('added', { mode: 'boolean' }).notNull(), enabled: integer('enabled', { mode: 'boolean' }).notNull(), revision: integer('revision').notNull(), updatedAt: text('updated_at').notNull(),
});
export const applicationProjectSettings = sqliteTable('application_project_settings', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }), appId: text('app_id').notNull(), enabled: integer('enabled', { mode: 'boolean' }).notNull(), bindingRevision: integer('binding_revision').notNull(), policyRevision: integer('policy_revision').notNull().default(0), pendingOperationId: text('pending_operation_id'), updatedAt: text('updated_at').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.projectId, t.appId] }) }));
export const applicationProjectBindings = sqliteTable('application_project_bindings', {
  projectId: text('project_id').notNull(), appId: text('app_id').notNull(), slot: text('slot').notNull(), connectionId: text('connection_id').notNull(), identityRevision: integer('identity_revision').notNull(),
}, t => ({ pk: primaryKey({ columns: [t.projectId, t.appId, t.slot] }), connectionRole: foreignKey({ columns: [t.connectionId, t.slot, t.appId], foreignColumns: [applicationConnections.id, applicationConnections.providerId, applicationConnections.appId] }), projectScope: foreignKey({ columns: [t.projectId, t.appId], foreignColumns: [applicationProjectSettings.projectId, applicationProjectSettings.appId] }).onDelete('cascade') }));
export const applicationBindingChanges = sqliteTable('application_binding_changes', {
  operationId: text('operation_id').primaryKey(), projectId: text('project_id').notNull(), appId: text('app_id').notNull(), fromRevision: integer('from_revision').notNull(), toRevision: integer('to_revision'), previousJson: text('previous_json').notNull(), nextJson: text('next_json').notNull(), state: text('state').notNull(), errorCode: text('error_code'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});

// M10 persistent mail business objects have no cascading project/task deletion:
// ordinary application removal and native-history cleanup must retain their data.
export const mailBlobObjects = sqliteTable('mail_blob_objects', {
  contentHash: text('content_hash').primaryKey(), byteSize: integer('byte_size').notNull(), createdAt: text('created_at').notNull(),
});
export const mailAttachmentObjects = sqliteTable('mail_attachment_objects', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), contentHash: text('content_hash').notNull().references(() => mailBlobObjects.contentHash),
  filename: text('filename').notNull(), contentType: text('content_type').notNull(), byteSize: integer('byte_size').notNull(), kind: text('kind', { enum: ['attachment','message'] }).notNull().default('attachment'), createdAt: text('created_at').notNull(),
});
export const mailBlobWrites = sqliteTable('mail_blob_writes', {
  operationId: text('operation_id').primaryKey(), attachmentId: text('attachment_id').notNull(), projectId: text('project_id').notNull(), requestHash: text('request_hash').notNull(), metadataJson: text('metadata_json').notNull(), state: text('state').notNull(), errorCode: text('error_code'), cleanupPending: integer('cleanup_pending', { mode: 'boolean' }).notNull().default(false), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
});
export const mailDrafts = sqliteTable('mail_drafts', {
  id: text('id').primaryKey(), projectId: text('project_id').notNull(), sourceTaskId: text('source_task_id'), copiedFromDraftId: text('copied_from_draft_id'),
  subject: text('subject').notNull(), attachmentCount: integer('attachment_count').notNull(), currentRevision: integer('current_revision').notNull(), state: text('state').notNull(), activeIntentId: text('active_intent_id'), lastExecutionId: text('last_execution_id'), createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
},t => ({ byProject: index('mail_drafts_project_updated').on(t.projectId,t.updatedAt,t.id), sourceDraft: foreignKey({ columns: [t.copiedFromDraftId], foreignColumns: [t.id] }) }));
export const mailDraftRevisions = sqliteTable('mail_draft_revisions', {
  draftId: text('draft_id').notNull().references(() => mailDrafts.id), revision: integer('revision').notNull(), contentJson: text('content_json').notNull(), contentHash: text('content_hash').notNull(), actorTaskId: text('actor_task_id'), createdAt: text('created_at').notNull(),
},t => ({ pk: primaryKey({ columns: [t.draftId,t.revision] }) }));
export const mailDraftMutations = sqliteTable('mail_draft_mutations', {
  projectId: text('project_id').notNull(), operationId: text('operation_id').notNull(), requestHash: text('request_hash').notNull(), draftId: text('draft_id').notNull().references(() => mailDrafts.id), resultJson: text('result_json').notNull(), createdAt: text('created_at').notNull(),
},t => ({ pk: primaryKey({ columns: [t.projectId,t.operationId] }) }));

export const mailSendIntents = sqliteTable('mail_send_intents', {
  id: text('id').primaryKey(),projectId: text('project_id').notNull(),sourceTaskId: text('source_task_id'),sourceRunId: text('source_run_id'),operationId: text('operation_id').notNull(),requestHash: text('request_hash').notNull(),
  draftId: text('draft_id').notNull(),draftRevision: integer('draft_revision').notNull(),draftContentHash: text('draft_content_hash').notNull(),connectionId: text('connection_id').notNull().references(() => applicationConnections.id),
  identityRevision: integer('identity_revision').notNull(),configRevision: integer('config_revision').notNull(),policyRevision: integer('policy_revision').notNull(),bindingRevision: integer('binding_revision').notNull(),identityJson: text('identity_json').notNull(),smtpConfigJson: text('smtp_config_json').notNull(),
  rawWriteId: text('raw_write_id').notNull(),rawObjectId: text('raw_object_id').references(() => mailAttachmentObjects.id),rawHash: text('raw_hash'),frozenHash: text('frozen_hash'),envelopeJson: text('envelope_json'),messageId: text('message_id').notNull(),reviewJson: text('review_json'),reviewHash: text('review_hash'),state: text('state').notNull(),grantId: text('grant_id'),executionId: text('execution_id'),cancelRequestedAt: text('cancel_requested_at'),
  ownerInstanceId: text('owner_instance_id').notNull(),ownerPid: integer('owner_pid').notNull(),ownerStartedAt: text('owner_started_at').notNull(),errorCode: text('error_code'),createdAt: text('created_at').notNull(),updatedAt: text('updated_at').notNull(),
},t => ({ operation: uniqueIndex('mail_send_intents_operation').on(t.projectId,t.operationId),byProject: index('mail_send_intents_project_updated').on(t.projectId,t.updatedAt,t.id),activity:index('mail_send_intents_activity_time').on(t.createdAt,t.id),revision: foreignKey({ columns: [t.draftId,t.draftRevision],foreignColumns: [mailDraftRevisions.draftId,mailDraftRevisions.revision] }) }));
export const mailSendGrants = sqliteTable('mail_send_grants', {
  id: text('id').primaryKey(),intentId: text('intent_id').notNull().references(() => mailSendIntents.id),source: text('source').notNull(),evidenceId: text('evidence_id').notNull(),evidenceHash: text('evidence_hash').notNull(),reviewHash: text('review_hash').notNull(),evidenceJson: text('evidence_json').notNull(),state: text('state').notNull(),expiresAt: text('expires_at').notNull(),createdAt: text('created_at').notNull(),
},t => ({ sourceEvent: uniqueIndex('mail_send_grants_source_event').on(t.source,t.evidenceId) }));
export const mailSendExecutions = sqliteTable('mail_send_executions', {
  id: text('id').primaryKey(),intentId: text('intent_id').notNull().references(() => mailSendIntents.id),projectId: text('project_id').notNull(),draftId: text('draft_id').notNull(),draftRevision: integer('draft_revision').notNull(),reviewHash: text('review_hash').notNull(),state: text('state').notNull(),resultJson: text('result_json'),secretRevision: integer('secret_revision').notNull(),ownerInstanceId: text('owner_instance_id').notNull(),startedAt: text('started_at').notNull(),endedAt: text('ended_at'),
},t => ({ oncePerIntent: uniqueIndex('mail_send_executions_intent').on(t.intentId),oncePerRevision: uniqueIndex('mail_send_executions_draft_revision').on(t.draftId,t.draftRevision) }));

export const applicationBindingSlotRevisions = sqliteTable('application_binding_slot_revisions', {
  projectId: text('project_id').notNull(),appId: text('app_id').notNull(),slot: text('slot').notNull(),revision: integer('revision').notNull(),
},t => ({ pk: primaryKey({ columns: [t.projectId,t.appId,t.slot] }),projectScope: foreignKey({ columns: [t.projectId,t.appId],foreignColumns: [applicationProjectSettings.projectId,applicationProjectSettings.appId] }).onDelete('cascade') }));

export const capabilitySessionIdentities = sqliteTable('capability_session_identities', {
  taskId: text('task_id').primaryKey().references(() => capabilitySessionSnapshots.taskId),runner: text('runner').notNull(),identityRoot: text('identity_root').notNull(),sessionId: text('session_id'),cwd: text('cwd').notNull(),discoveryHome: text('discovery_home').notNull(),selectionHash: text('selection_hash').notNull(),createdAt: text('created_at').notNull(),updatedAt: text('updated_at').notNull(),
},t => ({ nativeIdentity: uniqueIndex('capability_session_native_identity').on(t.runner,t.identityRoot,t.sessionId) }));
export const capabilitySessionMcpNames = sqliteTable('capability_session_mcp_names', {
  serverName: text('server_name').primaryKey(),taskId: text('task_id').notNull().references(() => capabilitySessionSnapshots.taskId),kind: text('kind').notNull(),
},t => ({ taskKind: uniqueIndex('capability_session_mcp_task_kind').on(t.taskId,t.kind) }));

export const capabilitySnapshotVersions = sqliteTable('capability_snapshot_versions', {
  snapshotHash: text('snapshot_hash').primaryKey(),taskId: text('task_id').notNull().references(() => capabilitySessionSnapshots.taskId),snapshotJson: text('snapshot_json').notNull(),selectionHash: text('selection_hash').notNull(),createdAt: text('created_at').notNull(),
});
export const capabilitySessionHolds = sqliteTable('capability_session_holds', {
  taskId: text('task_id').primaryKey().references(() => capabilitySessionSnapshots.taskId),previousRetention: text('previous_retention').notNull(),reason: text('reason').notNull(),createdAt: text('created_at').notNull(),
});

export const capabilityLeaseResources = sqliteTable('capability_lease_resources', {
  leaseId: text('lease_id').notNull().references(() => capabilityResourceLeases.leaseId),resourceId: text('resource_id').notNull().references(() => capabilityResources.resourceId),contentHash: text('content_hash').notNull(),generation: integer('generation').notNull(),
},t => ({ pk: primaryKey({ columns: [t.leaseId,t.resourceId] }) }));
export const capabilityRunProcesses = sqliteTable('capability_run_processes', {
  processId: text('process_id').primaryKey(),runId: text('run_id').notNull().references(() => capabilityRuns.runId),kind: text('kind').notNull(),launchKey: text('launch_key').notNull().unique(),state: text('state').notNull(),pid: integer('pid'),processStartedAt: text('process_started_at'),armedAt: text('armed_at'),attachedAt: text('attached_at'),endedAt: text('ended_at'),
},t => ({ byRun: index('capability_run_processes_run_idx').on(t.runId),oneCli: uniqueIndex('capability_run_one_cli_idx').on(t.runId).where(sql`${t.kind} = 'cli'`) }));
export const capabilityRunActivities = sqliteTable('capability_run_activities', {
  activityId: text('activity_id').primaryKey(),runId: text('run_id').notNull().references(() => capabilityRuns.runId),state: text('state').notNull(),startedAt: text('started_at').notNull(),endedAt: text('ended_at'),
});
export const capabilityStoreState = sqliteTable('capability_store_state', {
  singleton: integer('singleton').primaryKey(),storeId: text('store_id').notNull(),resourceGeneration: integer('resource_generation').notNull().default(1),maintenanceState: text('maintenance_state').notNull(),maintenanceOperationId: text('maintenance_operation_id'),
});

export const applicationInvocations = sqliteTable('application_invocations', {
  operationId: text('operation_id').primaryKey(),runId: text('run_id').notNull().references(() => capabilityRuns.runId),requestId: text('request_id').notNull(),requestHash: text('request_hash').notNull(),projectId: text('project_id').notNull(),taskId: text('task_id').notNull(),appId: text('app_id').notNull(),packageHash: text('package_hash').notNull(),toolName: text('tool_name').notNull(),contractMajor: integer('contract_major').notNull(),connectionId: text('connection_id'),semantics: text('semantics').notNull(),state: text('state').notNull(),attemptCount: integer('attempt_count').notNull().default(0),errorCode: text('error_code'),effectState: text('effect_state').notNull(),startedAt: text('started_at').notNull(),endedAt: text('ended_at'),
},t => ({ request: uniqueIndex('application_invocations_run_request').on(t.runId,t.requestId),project: index('application_invocations_project_idx').on(t.projectId,t.startedAt),activity:index('application_invocations_activity_time').on(t.startedAt,t.operationId) }));

export const capabilityPackageContracts = sqliteTable('capability_package_contracts', {
  packageHash: text('package_hash').notNull().references(() => capabilityPackages.packageHash),toolName: text('tool_name').notNull(),inputSource: text('input_source').notNull(),outputSource: text('output_source').notNull(),
},t => ({ pk: primaryKey({ columns: [t.packageHash,t.toolName] }) }));

export const capabilityAgentAdapters = sqliteTable('capability_agent_adapters', {
  agentId: text('agent_id').notNull(),version: text('version').notNull(),adapterHash: text('adapter_hash').notNull().unique(),resourceId: text('resource_id').notNull().references(() => capabilityResources.resourceId),manifestJson: text('manifest_json').notNull(),
},t => ({ pk: primaryKey({ columns: [t.agentId,t.version] }) }));

export const capabilityDiscoveryRoots = sqliteTable('capability_discovery_roots', { homeId: text('home_id').primaryKey(),canonicalHome: text('canonical_home').notNull().unique() });


export const capabilityBuiltinPackageSources = sqliteTable('capability_builtin_package_sources', {
  packageHash: text('package_hash').notNull().references(() => capabilityPackages.packageHash),
  sourceIndexHash: text('source_index_hash').notNull(),sourceIndexJson: text('source_index_json').notNull(),approvedAt: text('approved_at').notNull(),
},t => ({ pk: primaryKey({ columns: [t.packageHash,t.sourceIndexHash] }) }));


// Business provenance retains IDs after project/package cleanup without pinning obsolete code.
export const applicationDataOperations = sqliteTable('application_data_operations', {
  operationId:text('operation_id').primaryKey(),callerKind:text('caller_kind').notNull(),scopeKind:text('scope_kind').notNull(),projectId:text('project_id'),taskId:text('task_id'),runId:text('run_id'),jobId:text('job_id'),parentOperationId:text('parent_operation_id'),
  appId:text('app_id').notNull(),packageHash:text('package_hash').notNull(),dataApi:integer('data_api').notNull(),action:text('action').notNull(),semantics:text('semantics').notNull(),scopeHash:text('scope_hash').notNull(),targetsJson:text('targets_json').notNull().default('[]'),attemptCount:integer('attempt_count').notNull().default(1),state:text('state').notNull(),errorCode:text('error_code'),startedAt:text('started_at').notNull(),endedAt:text('ended_at'),
},t=>({project:index('application_data_operations_project').on(t.projectId,t.startedAt),activity:index('application_data_operations_activity_time').on(t.startedAt,t.operationId)}));
export const applicationDataResources = sqliteTable('application_data_resources', {
  resourceId:text('resource_id').primaryKey(),projectId:text('project_id').notNull(),appId:text('app_id').notNull(),backingKind:text('backing_kind').notNull(),objectId:text('object_id').notNull(),objectRevision:text('object_revision').notNull(),part:text('part').notNull(),dataContractMajor:integer('data_contract_major').notNull(),permission:text('permission').notNull(),contentHash:text('content_hash').notNull(),byteSize:integer('byte_size').notNull(),mediaType:text('media_type').notNull(),mintedPackageHash:text('minted_package_hash').notNull(),mintedOperationId:text('minted_operation_id').notNull(),createdAt:text('created_at').notNull(),
},t=>({businessIdentity:uniqueIndex('application_data_resources_identity').on(t.projectId,t.appId,t.backingKind,t.objectId,t.objectRevision,t.part,t.dataContractMajor)}));

// Fetched ZenTao history remains source-scoped; original package references do not own business data.
export const applicationZentaoRevisions=sqliteTable('application_zentao_revisions',{
  objectKey:text('object_key').primaryKey(),projectId:text('project_id').notNull(),connectionId:text('connection_id').notNull(),identityRevision:integer('identity_revision').notNull(),objectKind:text('object_kind').notNull(),nativeId:text('native_id').notNull(),contentRevision:text('content_revision').notNull(),representation:text('representation').notNull(),payloadJson:text('payload_json').notNull(),fetchedAt:text('fetched_at').notNull(),
},t=>({identity:uniqueIndex('application_zentao_revisions_identity').on(t.projectId,t.connectionId,t.identityRevision,t.objectKind,t.nativeId,t.contentRevision,t.representation)}));
export const applicationZentaoFiles=sqliteTable('application_zentao_files',{
  objectKey:text('object_key').notNull().references(()=>applicationZentaoRevisions.objectKey),fileId:text('file_id').notNull(),contentHash:text('content_hash').notNull(),bytes:blob('bytes',{mode:'buffer'}).notNull(),mediaType:text('media_type').notNull(),byteSize:integer('byte_size').notNull(),fetchedAt:text('fetched_at').notNull(),
},t=>({pk:primaryKey({columns:[t.objectKey,t.fileId,t.contentHash]})}));
export const applicationZentaoCursors=sqliteTable('application_zentao_cursors',{
  cursorId:text('cursor_id').primaryKey(),projectId:text('project_id').notNull(),targetJson:text('target_json').notNull(),objectKind:text('object_kind').notNull(),pageSize:integer('page_size').notNull(),pageNo:integer('page_no').notNull(),expectedTotal:integer('expected_total').notNull(),seenJson:text('seen_json').notNull(),expiresAt:text('expires_at').notNull(),
});
export const applicationZentaoOperationObjects=sqliteTable('application_zentao_operation_objects',{
  operationId:text('operation_id').notNull(),objectKey:text('object_key').notNull().references(()=>applicationZentaoRevisions.objectKey),
},t=>({pk:primaryKey({columns:[t.operationId,t.objectKey]})}));
export const applicationReadReceiptChecks=sqliteTable('application_read_receipt_checks',{
  checkOperationId:text('check_operation_id').primaryKey(),originalOperationId:text('original_operation_id').notNull(),checkedAt:text('checked_at').notNull(),
});

export const applicationZentaoOperationResources=sqliteTable('application_zentao_operation_resources',{
  operationId:text('operation_id').primaryKey(),backingJson:text('backing_json').notNull(),
});

// Operational lineage only; mail index/body/resource bytes remain in the quota-controlled cache.
export const applicationIndexWaiters=sqliteTable('application_index_waiters',{
 indexOperationId:text('index_operation_id').notNull().references(()=>applicationDataOperations.operationId),parentOperationId:text('parent_operation_id').notNull().references(()=>applicationDataOperations.operationId),sourceKey:text('source_key').notNull(),joinedAt:text('joined_at').notNull(),endedAt:text('ended_at'),state:text('state').notNull(),
},t=>({pk:primaryKey({columns:[t.indexOperationId,t.parentOperationId]})}));
export const applicationMailOperationSources=sqliteTable('application_mail_operation_sources',{
 operationId:text('operation_id').primaryKey().references(()=>applicationDataOperations.operationId),sourceKey:text('source_key').notNull(),sourceRevision:text('source_revision').notNull(),operationKind:text('operation_kind').notNull(),provenanceJson:text('provenance_json').notNull(),createdAt:text('created_at').notNull(),
});

export const mailUserActionSources=sqliteTable('mail_user_action_sources',{
  evidenceId:text('evidence_id').primaryKey(),intentId:text('intent_id').notNull().references(()=>mailSendIntents.id),sourceKind:text('source_kind').notNull(),sourceHash:text('source_hash').notNull(),provenanceJson:text('provenance_json').notNull(),createdAt:text('created_at').notNull(),
});

// Host-recorded references help trace activity; they confer no business authority.
export const applicationActivitySubjects=sqliteTable('application_activity_subjects',{
 operationId:text('operation_id').notNull().references(()=>applicationDataOperations.operationId,{onDelete:'cascade'}),kind:text('kind').notNull(),subjectId:text('subject_id').notNull(),
},t=>({pk:primaryKey({columns:[t.operationId,t.kind,t.subjectId]}),lookup:index('application_activity_subjects_lookup').on(t.kind,t.subjectId,t.operationId)}));

// Fixed host preparation and kernel-verified bridge observations, scoped per run.
export const capabilityRunPreparations = sqliteTable('capability_run_preparations', {
 runId:text('run_id').primaryKey().references(()=>capabilityRuns.runId),evidenceJson:text('evidence_json').notNull(),evidenceHash:text('evidence_hash').notNull(),preparedAt:text('prepared_at').notNull(),
},t=>({time:index('capability_run_evidence_time').on(t.preparedAt,t.runId)}));
export const capabilityBridgeObservations = sqliteTable('capability_bridge_observations', {
 runId:text('run_id').notNull().references(()=>capabilityRuns.runId),bridgeId:text('bridge_id').notNull().references(()=>capabilityRunProcesses.processId),evidenceJson:text('evidence_json').notNull(),evidenceHash:text('evidence_hash').notNull(),observedAt:text('observed_at').notNull(),
},t=>({pk:primaryKey({columns:[t.runId,t.bridgeId]})}));

// M4 source preservation is distinct from the later schema2 migration/Agent resume.
export const capabilityLegacyMigrationPreparations = sqliteTable('capability_legacy_migration_preparations', {
 taskId: text('task_id').primaryKey().references(() => capabilitySessionSnapshots.taskId),
 sourceSnapshotJson: text('source_snapshot_json').notNull(),sourceRecordJson: text('source_record_json').notNull(),sourceSnapshotHash: text('source_snapshot_hash').notNull(),sourceIdentityJson: text('source_identity_json').notNull(),boundNativeSessionId: text('bound_native_session_id'),
 evidenceJson: text('evidence_json'),evidenceHash: text('evidence_hash'),manifestJson: text('manifest_json'),manifestHash: text('manifest_hash'),
 hBindingHash:text('h_binding_hash'),state: text('state',{enum:['held','prepared','migrated']}).notNull(),issueCode: text('issue_code'),createdAt: text('created_at').notNull(),updatedAt: text('updated_at').notNull(),
}, t=>({byState:index('capability_legacy_preparation_state').on(t.state,t.taskId)}));

// Derived original H aliases survive UI task deletion without replacing fixed S.
export const capabilityLegacyHBindings=sqliteTable('capability_legacy_h_bindings',{
 taskId:text('task_id').primaryKey().references(()=>capabilityLegacyMigrationPreparations.taskId),
 bindingJson:text('binding_json').notNull(),bindingHash:text('binding_hash').notNull(),createdAt:text('created_at').notNull(),
});

// Host-observed metadata retained per run; never used as application authority.
export const capabilitySkillObservations=sqliteTable('capability_skill_observations',{
 runId:text('run_id').notNull().references(()=>capabilityRuns.runId),appId:text('app_id').notNull(),skillId:text('skill_id').notNull(),kind:text('kind',{enum:['discovery','read']}).notNull(),evidenceJson:text('evidence_json').notNull(),evidenceHash:text('evidence_hash').notNull(),observedAt:text('observed_at').notNull(),
},t=>({pk:primaryKey({columns:[t.runId,t.appId,t.skillId,t.kind]})}));
