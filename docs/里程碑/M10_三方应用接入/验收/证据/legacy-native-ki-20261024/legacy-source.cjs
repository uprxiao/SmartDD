"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const assert = require("node:assert/strict");
const node_fs = require("node:fs");
const node_path = require("node:path");
const node_readline = require("node:readline");
const Database = require("better-sqlite3");
const betterSqlite3 = require("drizzle-orm/better-sqlite3");
const drizzleOrm = require("drizzle-orm");
const sqliteCore = require("drizzle-orm/sqlite-core");
const node_crypto = require("node:crypto");
const zod = require("zod");
const yaml = require("yaml");
const node_os = require("node:os");
const smolToml = require("smol-toml");
const node_child_process = require("node:child_process");
const sessions = sqliteCore.sqliteTable("sessions", {
  id: sqliteCore.text("id").primaryKey(),
  runner: sqliteCore.text("runner", { enum: ["claude", "codex"] }).notNull(),
  cwd: sqliteCore.text("cwd").notNull(),
  nativeSessionId: sqliteCore.text("native_session_id"),
  title: sqliteCore.text("title").notNull(),
  createdAt: sqliteCore.integer("created_at").notNull()
});
const appSecrets = sqliteCore.sqliteTable("app_secrets", {
  key: sqliteCore.text("key").primaryKey(),
  secret: sqliteCore.text("secret").notNull()
});
const appSettings = sqliteCore.sqliteTable("app_settings", {
  key: sqliteCore.text("key").primaryKey(),
  value: sqliteCore.text("value").notNull(),
  updatedAt: sqliteCore.integer("updated_at").notNull().default(drizzleOrm.sql`(unixepoch() * 1000)`)
});
const timestamps = {
  createdAt: sqliteCore.integer("created_at").notNull(),
  updatedAt: sqliteCore.integer("updated_at").notNull()
};
const lastTest = {
  lastTestAt: sqliteCore.integer("last_test_at"),
  lastTestOk: sqliteCore.integer("last_test_ok", { mode: "boolean" }),
  lastTestCategory: sqliteCore.text("last_test_category"),
  lastTestMessage: sqliteCore.text("last_test_message"),
  lastTestMs: sqliteCore.integer("last_test_ms")
};
const projects = sqliteCore.sqliteTable("projects", {
  id: sqliteCore.text("id").primaryKey(),
  name: sqliteCore.text("name").notNull(),
  /** JSON string[]: names used to match natural language ("AIS"). */
  aliases: sqliteCore.text("aliases").notNull().default("[]"),
  description: sqliteCore.text("description").notNull().default(""),
  rulesPath: sqliteCore.text("rules_path"),
  /** Bumped on every change to the project or its resources; sessions record the version they started with. */
  configVersion: sqliteCore.integer("config_version").notNull().default(1),
  archivedAt: sqliteCore.integer("archived_at"),
  ...timestamps
});
const projectDirs = sqliteCore.sqliteTable(
  "project_dirs",
  {
    id: sqliteCore.text("id").primaryKey(),
    projectId: sqliteCore.text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    label: sqliteCore.text("label").notNull().default(""),
    path: sqliteCore.text("path").notNull(),
    isDefault: sqliteCore.integer("is_default", { mode: "boolean" }).notNull().default(false),
    ...timestamps
  },
  (t) => ({ byProject: sqliteCore.index("project_dirs_project_idx").on(t.projectId) })
);
const projectDatabases = sqliteCore.sqliteTable(
  "project_databases",
  {
    id: sqliteCore.text("id").primaryKey(),
    projectId: sqliteCore.text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    /** dev / test / prod, or a custom label. */
    env: sqliteCore.text("env").notNull(),
    label: sqliteCore.text("label").notNull().default(""),
    aliases: sqliteCore.text("aliases").notNull().default("[]"),
    vendor: sqliteCore.text("vendor").notNull(),
    host: sqliteCore.text("host").notNull(),
    port: sqliteCore.integer("port").notNull(),
    database: sqliteCore.text("database").notNull().default(""),
    schema: sqliteCore.text("schema"),
    username: sqliteCore.text("username").notNull().default(""),
    accessLevel: sqliteCore.text("access_level", { enum: ["readonly", "readwrite"] }).notNull().default("readonly"),
    isDefault: sqliteCore.integer("is_default", { mode: "boolean" }).notNull().default(false),
    note: sqliteCore.text("note").notNull().default(""),
    ...lastTest,
    ...timestamps
  },
  (t) => ({ byProject: sqliteCore.index("project_databases_project_idx").on(t.projectId) })
);
const projectServers = sqliteCore.sqliteTable(
  "project_servers",
  {
    id: sqliteCore.text("id").primaryKey(),
    projectId: sqliteCore.text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
    env: sqliteCore.text("env").notNull(),
    label: sqliteCore.text("label").notNull().default(""),
    aliases: sqliteCore.text("aliases").notNull().default("[]"),
    host: sqliteCore.text("host").notNull(),
    port: sqliteCore.integer("port").notNull().default(22),
    username: sqliteCore.text("username").notNull(),
    authType: sqliteCore.text("auth_type", { enum: ["password", "key"] }).notNull(),
    privateKeyPath: sqliteCore.text("private_key_path"),
    /** Mirrors remote-password-ssh: log in, then `sudo -i`. */
    defaultRoot: sqliteCore.integer("default_root", { mode: "boolean" }).notNull().default(false),
    /** none: no sudo; same-as-login: reuse the login password; separate: its own secret. */
    sudoPolicy: sqliteCore.text("sudo_policy", { enum: ["none", "same-as-login", "separate"] }).notNull().default("none"),
    appRoot: sqliteCore.text("app_root"),
    logsPath: sqliteCore.text("logs_path"),
    note: sqliteCore.text("note").notNull().default(""),
    ...lastTest,
    ...timestamps
  },
  (t) => ({ byProject: sqliteCore.index("project_servers_project_idx").on(t.projectId) })
);
const aiProfiles = sqliteCore.sqliteTable("ai_profiles", {
  id: sqliteCore.text("id").primaryKey(),
  name: sqliteCore.text("name").notNull(),
  runner: sqliteCore.text("runner", { enum: ["claude", "codex"] }).notNull(),
  /** null: the runner's own command on the login shell's PATH. */
  executable: sqliteCore.text("executable"),
  /** JSON [{ name, secret, value }]; value is null for secret variables. */
  env: sqliteCore.text("env").notNull().default("[]"),
  /** JSON string[] passed before SmartDD's own arguments. */
  args: sqliteCore.text("args").notNull().default("[]"),
  color: sqliteCore.text("color"),
  isDefault: sqliteCore.integer("is_default", { mode: "boolean" }).notNull().default(false),
  /** Imported command unavailable on this computer; a manual configuration/test releases it. */
  commandPending: sqliteCore.integer("command_pending", { mode: "boolean" }).notNull().default(false),
  /** Last health result: a test, or an API answer seen in a task (the latest wins). */
  checkStatus: sqliteCore.text("check_status", { enum: ["ok", "failed", "warning"] }),
  checkCategory: sqliteCore.text("check_category"),
  /** manual / auto / task:<taskId> */
  checkSource: sqliteCore.text("check_source"),
  checkMessage: sqliteCore.text("check_message"),
  checkMs: sqliteCore.integer("check_ms"),
  checkAt: sqliteCore.integer("check_at"),
  ...timestamps
});
const tasks = sqliteCore.sqliteTable(
  "tasks",
  {
    id: sqliteCore.text("id").primaryKey(),
    projectId: sqliteCore.text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    dirId: sqliteCore.text("dir_id").references(() => projectDirs.id, { onDelete: "set null" }),
    cwd: sqliteCore.text("cwd").notNull(),
    aiProfileId: sqliteCore.text("ai_profile_id").references(() => aiProfiles.id, { onDelete: "set null" }),
    aiProfileName: sqliteCore.text("ai_profile_name"),
    runner: sqliteCore.text("runner", { enum: ["claude", "codex"] }).notNull(),
    nativeSessionId: sqliteCore.text("native_session_id"),
    title: sqliteCore.text("title").notNull(),
    firstMessage: sqliteCore.text("first_message").notNull().default(""),
    /** JSON string[] of variable names given to the CLI on the last launch (no values). */
    injectedEnvNames: sqliteCore.text("injected_env_names").notNull().default("[]"),
    configVersion: sqliteCore.integer("config_version"),
    /** CLAUDE_CONFIG_DIR / CODEX_HOME in effect, so resume looks for the session file in the right place. */
    stateRoot: sqliteCore.text("state_root"),
    /** NULL: unknown or running without evidence; false: owned exit without history; true: history observed. */
    nativeHistoryObserved: sqliteCore.integer("native_history_observed", { mode: "boolean" }),
    /** M4: version pins, hashes and injection self-check, never secret values. */
    runtimeSnapshot: sqliteCore.text("runtime_snapshot"),
    archivedAt: sqliteCore.integer("archived_at"),
    lastLaunchedAt: sqliteCore.integer("last_launched_at"),
    ...timestamps
  },
  (t) => ({ byProject: sqliteCore.index("tasks_project_idx").on(t.projectId) })
);
const skillVersions = sqliteCore.sqliteTable("skill_versions", {
  id: sqliteCore.text("id").primaryKey(),
  skillId: sqliteCore.text("skill_id").notNull(),
  name: sqliteCore.text("name").notNull(),
  version: sqliteCore.text("version").notNull(),
  hash: sqliteCore.text("hash").notNull(),
  installedAt: sqliteCore.integer("installed_at").notNull(),
  active: sqliteCore.integer("active", { mode: "boolean" }).notNull().default(false)
});
const projectCapabilities = sqliteCore.sqliteTable("project_capabilities", {
  id: sqliteCore.text("id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  capabilityId: sqliteCore.text("capability_id").notNull(),
  enabled: sqliteCore.integer("enabled", { mode: "boolean" }).notNull().default(true)
});
const projectImportReceipts = sqliteCore.sqliteTable("project_import_receipts", {
  requestId: sqliteCore.text("request_id").primaryKey(),
  fingerprint: sqliteCore.text("fingerprint").notNull(),
  result: sqliteCore.text("result").notNull(),
  createdAt: sqliteCore.integer("created_at").notNull()
});
const importedKeys = sqliteCore.sqliteTable("imported_keys", {
  serverId: sqliteCore.text("server_id").primaryKey(),
  path: sqliteCore.text("path").notNull(),
  createdAt: sqliteCore.integer("created_at").notNull()
});
const capabilityResources = sqliteCore.sqliteTable("capability_resources", {
  resourceId: sqliteCore.text("resource_id").primaryKey(),
  kind: sqliteCore.text("kind").notNull(),
  contentHash: sqliteCore.text("content_hash").notNull(),
  ownerStoreId: sqliteCore.text("owner_store_id").notNull(),
  pathScope: sqliteCore.text("path_scope", { enum: ["C", "H"] }).notNull(),
  relativePath: sqliteCore.text("relative_path").notNull(),
  scopeIdentity: sqliteCore.text("scope_identity").notNull().default(""),
  scopeRelativePath: sqliteCore.text("scope_relative_path"),
  state: sqliteCore.text("state", { enum: ["staged", "verified", "ready", "deleting", "removed", "recovery-required"] }).notNull(),
  generation: sqliteCore.integer("generation").notNull().default(1),
  integrity: sqliteCore.text("integrity", { enum: ["unknown", "valid", "invalid"] }).notNull(),
  operationId: sqliteCore.text("operation_id")
}, (t) => ({ ownedPath: sqliteCore.uniqueIndex("capability_resources_owned_path").on(t.ownerStoreId, t.pathScope, t.relativePath), discoveryPath: sqliteCore.uniqueIndex("capability_resources_discovery_path").on(t.scopeIdentity, t.scopeRelativePath).where(drizzleOrm.sql`${t.pathScope}='H' AND ${t.state}<>'removed'`) }));
const capabilityResourceDependencies = sqliteCore.sqliteTable("capability_resource_dependencies", {
  resourceId: sqliteCore.text("resource_id").notNull().references(() => capabilityResources.resourceId),
  dependencyId: sqliteCore.text("dependency_id").notNull().references(() => capabilityResources.resourceId)
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.resourceId, t.dependencyId] }) }));
const capabilityResourceLeases = sqliteCore.sqliteTable("capability_resource_leases", {
  leaseId: sqliteCore.text("lease_id").primaryKey(),
  resourceId: sqliteCore.text("resource_id").notNull().references(() => capabilityResources.resourceId),
  ownerKind: sqliteCore.text("owner_kind").notNull(),
  ownerId: sqliteCore.text("owner_id").notNull(),
  hostInstanceId: sqliteCore.text("host_instance_id").notNull(),
  pid: sqliteCore.integer("pid"),
  processStartedAt: sqliteCore.text("process_started_at"),
  state: sqliteCore.text("state").notNull(),
  createdAt: sqliteCore.text("created_at").notNull(),
  endedAt: sqliteCore.text("ended_at")
}, (t) => ({ byResource: sqliteCore.index("capability_resource_leases_resource_idx").on(t.resourceId, t.state) }));
const capabilityResourceOperations = sqliteCore.sqliteTable("capability_resource_operations", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  kind: sqliteCore.text("kind").notNull(),
  ownerStoreId: sqliteCore.text("owner_store_id").notNull(),
  state: sqliteCore.text("state").notNull(),
  planJson: sqliteCore.text("plan_json").notNull(),
  errorCode: sqliteCore.text("error_code"),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
});
const capabilityPackages = sqliteCore.sqliteTable("capability_packages", {
  packageHash: sqliteCore.text("package_hash").primaryKey(),
  appId: sqliteCore.text("app_id").notNull(),
  version: sqliteCore.text("version").notNull(),
  hashAlgorithm: sqliteCore.text("hash_algorithm").notNull(),
  relativePath: sqliteCore.text("relative_path").notNull(),
  manifestJson: sqliteCore.text("manifest_json").notNull(),
  resourceId: sqliteCore.text("resource_id").notNull().references(() => capabilityResources.resourceId),
  installedAt: sqliteCore.text("installed_at").notNull()
}, (t) => ({ identity: sqliteCore.uniqueIndex("capability_packages_identity").on(t.appId, t.version) }));
const capabilityActivePackages = sqliteCore.sqliteTable("capability_active_packages", {
  appId: sqliteCore.text("app_id").primaryKey(),
  packageHash: sqliteCore.text("package_hash").notNull().references(() => capabilityPackages.packageHash),
  activationGeneration: sqliteCore.integer("activation_generation").notNull(),
  activatedAt: sqliteCore.text("activated_at").notNull()
});
const capabilityInstallJournal = sqliteCore.sqliteTable("capability_install_journal", {
  installId: sqliteCore.text("install_id").primaryKey().references(() => capabilityResourceOperations.operationId),
  hostBuild: sqliteCore.text("host_build").notNull(),
  fromGeneration: sqliteCore.integer("from_generation"),
  toGeneration: sqliteCore.integer("to_generation"),
  state: sqliteCore.text("state").notNull(),
  planJson: sqliteCore.text("plan_json").notNull(),
  backupPath: sqliteCore.text("backup_path"),
  errorCode: sqliteCore.text("error_code"),
  updatedAt: sqliteCore.text("updated_at").notNull()
});
const capabilitySessionSnapshots = sqliteCore.sqliteTable("capability_session_snapshots", {
  taskId: sqliteCore.text("task_id").primaryKey(),
  schemaVersion: sqliteCore.integer("schema_version").notNull(),
  snapshotJson: sqliteCore.text("snapshot_json").notNull(),
  snapshotHash: sqliteCore.text("snapshot_hash").notNull(),
  createdAt: sqliteCore.text("created_at").notNull(),
  legacyStatus: sqliteCore.text("legacy_status").notNull(),
  retentionState: sqliteCore.text("retention_state", { enum: ["active", "tombstone", "hold"] }).notNull()
});
const capabilitySessionRefs = sqliteCore.sqliteTable("capability_session_refs", {
  taskId: sqliteCore.text("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  refKind: sqliteCore.text("ref_kind").notNull(),
  refId: sqliteCore.text("ref_id").notNull().references(() => capabilityResources.resourceId),
  refHash: sqliteCore.text("ref_hash").notNull(),
  relativePath: sqliteCore.text("relative_path").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.taskId, t.refKind, t.refId] }), byResource: sqliteCore.index("capability_session_refs_resource_idx").on(t.refId) }));
const capabilityRuns = sqliteCore.sqliteTable("capability_runs", {
  runId: sqliteCore.text("run_id").primaryKey(),
  taskId: sqliteCore.text("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  projectId: sqliteCore.text("project_id").notNull(),
  runner: sqliteCore.text("runner").notNull(),
  pid: sqliteCore.integer("pid"),
  processStartedAt: sqliteCore.text("process_started_at"),
  state: sqliteCore.text("state").notNull(),
  startedAt: sqliteCore.text("started_at").notNull(),
  endedAt: sqliteCore.text("ended_at"),
  errorCode: sqliteCore.text("error_code"),
  snapshotHash: sqliteCore.text("snapshot_hash"),
  ownerInstanceId: sqliteCore.text("owner_instance_id"),
  ownerPid: sqliteCore.integer("owner_pid"),
  ownerStartedAt: sqliteCore.text("owner_started_at"),
  bindingsJson: sqliteCore.text("bindings_json").notNull().default("[]"),
  ptyId: sqliteCore.text("pty_id"),
  revocationState: sqliteCore.text("revocation_state").notNull().default("open")
});
const capabilitySchemaMigrations = sqliteCore.sqliteTable("capability_schema_migrations", {
  appId: sqliteCore.text("app_id").notNull(),
  migrationId: sqliteCore.text("migration_id").notNull(),
  checksum: sqliteCore.text("checksum").notNull(),
  fromVersion: sqliteCore.integer("from_version").notNull(),
  toVersion: sqliteCore.integer("to_version").notNull(),
  appliedAt: sqliteCore.text("applied_at").notNull(),
  hostBuild: sqliteCore.text("host_build").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.appId, t.migrationId] }) }));
const applicationConnections = sqliteCore.sqliteTable("application_connections", {
  id: sqliteCore.text("id").primaryKey(),
  appId: sqliteCore.text("app_id").notNull(),
  providerId: sqliteCore.text("provider_id").notNull(),
  name: sqliteCore.text("name").notNull(),
  configSchemaVersion: sqliteCore.integer("config_schema_version").notNull().default(1),
  configJson: sqliteCore.text("config_json").notNull(),
  revision: sqliteCore.integer("revision").notNull(),
  configRevision: sqliteCore.integer("config_revision").notNull(),
  identityRevision: sqliteCore.integer("identity_revision").notNull(),
  verifiedIdentityJson: sqliteCore.text("verified_identity_json").notNull(),
  identityHash: sqliteCore.text("identity_hash").notNull(),
  secretRef: sqliteCore.text("secret_ref"),
  secretRevision: sqliteCore.integer("secret_revision").notNull(),
  policyRevision: sqliteCore.integer("policy_revision").notNull(),
  enabled: sqliteCore.integer("enabled", { mode: "boolean" }).notNull(),
  authState: sqliteCore.text("auth_state").notNull(),
  health: sqliteCore.text("health").notNull(),
  healthCode: sqliteCore.text("health_code"),
  healthMessage: sqliteCore.text("health_message"),
  testedAt: sqliteCore.text("tested_at"),
  cleanupPending: sqliteCore.integer("cleanup_pending", { mode: "boolean" }).notNull().default(false),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
}, (t) => ({ byProvider: sqliteCore.index("application_connections_provider_idx").on(t.providerId, t.appId), identityKey: sqliteCore.uniqueIndex("application_connections_identity_key").on(t.id, t.providerId, t.appId) }));
const applicationSecretChanges = sqliteCore.sqliteTable("application_secret_changes", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  connectionId: sqliteCore.text("connection_id").notNull(),
  expectedRevision: sqliteCore.integer("expected_revision").notNull(),
  oldSecretRef: sqliteCore.text("old_secret_ref"),
  newSecretRef: sqliteCore.text("new_secret_ref"),
  candidateHash: sqliteCore.text("candidate_hash").notNull(),
  candidateJson: sqliteCore.text("candidate_json").notNull(),
  verifiedIdentityJson: sqliteCore.text("verified_identity_json"),
  compatibilityPlanJson: sqliteCore.text("compatibility_plan_json"),
  expiresAt: sqliteCore.text("expires_at").notNull(),
  state: sqliteCore.text("state").notNull(),
  errorCode: sqliteCore.text("error_code"),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
});
const applicationCatalogState = sqliteCore.sqliteTable("application_catalog_state", {
  appId: sqliteCore.text("app_id").primaryKey(),
  added: sqliteCore.integer("added", { mode: "boolean" }).notNull(),
  enabled: sqliteCore.integer("enabled", { mode: "boolean" }).notNull(),
  revision: sqliteCore.integer("revision").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
});
const applicationProjectSettings = sqliteCore.sqliteTable("application_project_settings", {
  projectId: sqliteCore.text("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  appId: sqliteCore.text("app_id").notNull(),
  enabled: sqliteCore.integer("enabled", { mode: "boolean" }).notNull(),
  bindingRevision: sqliteCore.integer("binding_revision").notNull(),
  policyRevision: sqliteCore.integer("policy_revision").notNull().default(0),
  pendingOperationId: sqliteCore.text("pending_operation_id"),
  updatedAt: sqliteCore.text("updated_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.projectId, t.appId] }) }));
const applicationProjectBindings = sqliteCore.sqliteTable("application_project_bindings", {
  projectId: sqliteCore.text("project_id").notNull(),
  appId: sqliteCore.text("app_id").notNull(),
  slot: sqliteCore.text("slot").notNull(),
  connectionId: sqliteCore.text("connection_id").notNull(),
  identityRevision: sqliteCore.integer("identity_revision").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.projectId, t.appId, t.slot] }), connectionRole: sqliteCore.foreignKey({ columns: [t.connectionId, t.slot, t.appId], foreignColumns: [applicationConnections.id, applicationConnections.providerId, applicationConnections.appId] }), projectScope: sqliteCore.foreignKey({ columns: [t.projectId, t.appId], foreignColumns: [applicationProjectSettings.projectId, applicationProjectSettings.appId] }).onDelete("cascade") }));
const applicationBindingChanges = sqliteCore.sqliteTable("application_binding_changes", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  appId: sqliteCore.text("app_id").notNull(),
  fromRevision: sqliteCore.integer("from_revision").notNull(),
  toRevision: sqliteCore.integer("to_revision"),
  previousJson: sqliteCore.text("previous_json").notNull(),
  nextJson: sqliteCore.text("next_json").notNull(),
  state: sqliteCore.text("state").notNull(),
  errorCode: sqliteCore.text("error_code"),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
});
const mailBlobObjects = sqliteCore.sqliteTable("mail_blob_objects", {
  contentHash: sqliteCore.text("content_hash").primaryKey(),
  byteSize: sqliteCore.integer("byte_size").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
});
const mailAttachmentObjects = sqliteCore.sqliteTable("mail_attachment_objects", {
  id: sqliteCore.text("id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  contentHash: sqliteCore.text("content_hash").notNull().references(() => mailBlobObjects.contentHash),
  filename: sqliteCore.text("filename").notNull(),
  contentType: sqliteCore.text("content_type").notNull(),
  byteSize: sqliteCore.integer("byte_size").notNull(),
  kind: sqliteCore.text("kind", { enum: ["attachment", "message"] }).notNull().default("attachment"),
  createdAt: sqliteCore.text("created_at").notNull()
});
const mailBlobWrites = sqliteCore.sqliteTable("mail_blob_writes", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  attachmentId: sqliteCore.text("attachment_id").notNull(),
  projectId: sqliteCore.text("project_id").notNull(),
  requestHash: sqliteCore.text("request_hash").notNull(),
  metadataJson: sqliteCore.text("metadata_json").notNull(),
  state: sqliteCore.text("state").notNull(),
  errorCode: sqliteCore.text("error_code"),
  cleanupPending: sqliteCore.integer("cleanup_pending", { mode: "boolean" }).notNull().default(false),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
});
const mailDrafts = sqliteCore.sqliteTable("mail_drafts", {
  id: sqliteCore.text("id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  sourceTaskId: sqliteCore.text("source_task_id"),
  copiedFromDraftId: sqliteCore.text("copied_from_draft_id"),
  subject: sqliteCore.text("subject").notNull(),
  attachmentCount: sqliteCore.integer("attachment_count").notNull(),
  currentRevision: sqliteCore.integer("current_revision").notNull(),
  state: sqliteCore.text("state").notNull(),
  activeIntentId: sqliteCore.text("active_intent_id"),
  lastExecutionId: sqliteCore.text("last_execution_id"),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
}, (t) => ({ byProject: sqliteCore.index("mail_drafts_project_updated").on(t.projectId, t.updatedAt, t.id), sourceDraft: sqliteCore.foreignKey({ columns: [t.copiedFromDraftId], foreignColumns: [t.id] }) }));
const mailDraftRevisions = sqliteCore.sqliteTable("mail_draft_revisions", {
  draftId: sqliteCore.text("draft_id").notNull().references(() => mailDrafts.id),
  revision: sqliteCore.integer("revision").notNull(),
  contentJson: sqliteCore.text("content_json").notNull(),
  contentHash: sqliteCore.text("content_hash").notNull(),
  actorTaskId: sqliteCore.text("actor_task_id"),
  createdAt: sqliteCore.text("created_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.draftId, t.revision] }) }));
const mailDraftMutations = sqliteCore.sqliteTable("mail_draft_mutations", {
  projectId: sqliteCore.text("project_id").notNull(),
  operationId: sqliteCore.text("operation_id").notNull(),
  requestHash: sqliteCore.text("request_hash").notNull(),
  draftId: sqliteCore.text("draft_id").notNull().references(() => mailDrafts.id),
  resultJson: sqliteCore.text("result_json").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.projectId, t.operationId] }) }));
const mailSendIntents = sqliteCore.sqliteTable("mail_send_intents", {
  id: sqliteCore.text("id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  sourceTaskId: sqliteCore.text("source_task_id"),
  sourceRunId: sqliteCore.text("source_run_id"),
  operationId: sqliteCore.text("operation_id").notNull(),
  requestHash: sqliteCore.text("request_hash").notNull(),
  draftId: sqliteCore.text("draft_id").notNull(),
  draftRevision: sqliteCore.integer("draft_revision").notNull(),
  draftContentHash: sqliteCore.text("draft_content_hash").notNull(),
  connectionId: sqliteCore.text("connection_id").notNull().references(() => applicationConnections.id),
  identityRevision: sqliteCore.integer("identity_revision").notNull(),
  configRevision: sqliteCore.integer("config_revision").notNull(),
  policyRevision: sqliteCore.integer("policy_revision").notNull(),
  bindingRevision: sqliteCore.integer("binding_revision").notNull(),
  identityJson: sqliteCore.text("identity_json").notNull(),
  smtpConfigJson: sqliteCore.text("smtp_config_json").notNull(),
  rawWriteId: sqliteCore.text("raw_write_id").notNull(),
  rawObjectId: sqliteCore.text("raw_object_id").references(() => mailAttachmentObjects.id),
  rawHash: sqliteCore.text("raw_hash"),
  frozenHash: sqliteCore.text("frozen_hash"),
  envelopeJson: sqliteCore.text("envelope_json"),
  messageId: sqliteCore.text("message_id").notNull(),
  reviewJson: sqliteCore.text("review_json"),
  reviewHash: sqliteCore.text("review_hash"),
  state: sqliteCore.text("state").notNull(),
  grantId: sqliteCore.text("grant_id"),
  executionId: sqliteCore.text("execution_id"),
  cancelRequestedAt: sqliteCore.text("cancel_requested_at"),
  ownerInstanceId: sqliteCore.text("owner_instance_id").notNull(),
  ownerPid: sqliteCore.integer("owner_pid").notNull(),
  ownerStartedAt: sqliteCore.text("owner_started_at").notNull(),
  errorCode: sqliteCore.text("error_code"),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
}, (t) => ({ operation: sqliteCore.uniqueIndex("mail_send_intents_operation").on(t.projectId, t.operationId), byProject: sqliteCore.index("mail_send_intents_project_updated").on(t.projectId, t.updatedAt, t.id), activity: sqliteCore.index("mail_send_intents_activity_time").on(t.createdAt, t.id), revision: sqliteCore.foreignKey({ columns: [t.draftId, t.draftRevision], foreignColumns: [mailDraftRevisions.draftId, mailDraftRevisions.revision] }) }));
const mailSendGrants = sqliteCore.sqliteTable("mail_send_grants", {
  id: sqliteCore.text("id").primaryKey(),
  intentId: sqliteCore.text("intent_id").notNull().references(() => mailSendIntents.id),
  source: sqliteCore.text("source").notNull(),
  evidenceId: sqliteCore.text("evidence_id").notNull(),
  evidenceHash: sqliteCore.text("evidence_hash").notNull(),
  reviewHash: sqliteCore.text("review_hash").notNull(),
  evidenceJson: sqliteCore.text("evidence_json").notNull(),
  state: sqliteCore.text("state").notNull(),
  expiresAt: sqliteCore.text("expires_at").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
}, (t) => ({ sourceEvent: sqliteCore.uniqueIndex("mail_send_grants_source_event").on(t.source, t.evidenceId) }));
const mailSendExecutions = sqliteCore.sqliteTable("mail_send_executions", {
  id: sqliteCore.text("id").primaryKey(),
  intentId: sqliteCore.text("intent_id").notNull().references(() => mailSendIntents.id),
  projectId: sqliteCore.text("project_id").notNull(),
  draftId: sqliteCore.text("draft_id").notNull(),
  draftRevision: sqliteCore.integer("draft_revision").notNull(),
  reviewHash: sqliteCore.text("review_hash").notNull(),
  state: sqliteCore.text("state").notNull(),
  resultJson: sqliteCore.text("result_json"),
  secretRevision: sqliteCore.integer("secret_revision").notNull(),
  ownerInstanceId: sqliteCore.text("owner_instance_id").notNull(),
  startedAt: sqliteCore.text("started_at").notNull(),
  endedAt: sqliteCore.text("ended_at")
}, (t) => ({ oncePerIntent: sqliteCore.uniqueIndex("mail_send_executions_intent").on(t.intentId), oncePerRevision: sqliteCore.uniqueIndex("mail_send_executions_draft_revision").on(t.draftId, t.draftRevision) }));
const applicationBindingSlotRevisions = sqliteCore.sqliteTable("application_binding_slot_revisions", {
  projectId: sqliteCore.text("project_id").notNull(),
  appId: sqliteCore.text("app_id").notNull(),
  slot: sqliteCore.text("slot").notNull(),
  revision: sqliteCore.integer("revision").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.projectId, t.appId, t.slot] }), projectScope: sqliteCore.foreignKey({ columns: [t.projectId, t.appId], foreignColumns: [applicationProjectSettings.projectId, applicationProjectSettings.appId] }).onDelete("cascade") }));
const capabilitySessionIdentities = sqliteCore.sqliteTable("capability_session_identities", {
  taskId: sqliteCore.text("task_id").primaryKey().references(() => capabilitySessionSnapshots.taskId),
  runner: sqliteCore.text("runner").notNull(),
  identityRoot: sqliteCore.text("identity_root").notNull(),
  sessionId: sqliteCore.text("session_id"),
  cwd: sqliteCore.text("cwd").notNull(),
  discoveryHome: sqliteCore.text("discovery_home").notNull(),
  selectionHash: sqliteCore.text("selection_hash").notNull(),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
}, (t) => ({ nativeIdentity: sqliteCore.uniqueIndex("capability_session_native_identity").on(t.runner, t.identityRoot, t.sessionId) }));
const capabilitySessionMcpNames = sqliteCore.sqliteTable("capability_session_mcp_names", {
  serverName: sqliteCore.text("server_name").primaryKey(),
  taskId: sqliteCore.text("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  kind: sqliteCore.text("kind").notNull()
}, (t) => ({ taskKind: sqliteCore.uniqueIndex("capability_session_mcp_task_kind").on(t.taskId, t.kind) }));
const capabilitySnapshotVersions = sqliteCore.sqliteTable("capability_snapshot_versions", {
  snapshotHash: sqliteCore.text("snapshot_hash").primaryKey(),
  taskId: sqliteCore.text("task_id").notNull().references(() => capabilitySessionSnapshots.taskId),
  snapshotJson: sqliteCore.text("snapshot_json").notNull(),
  selectionHash: sqliteCore.text("selection_hash").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
});
const capabilitySessionHolds = sqliteCore.sqliteTable("capability_session_holds", {
  taskId: sqliteCore.text("task_id").primaryKey().references(() => capabilitySessionSnapshots.taskId),
  previousRetention: sqliteCore.text("previous_retention").notNull(),
  reason: sqliteCore.text("reason").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
});
const capabilityLeaseResources = sqliteCore.sqliteTable("capability_lease_resources", {
  leaseId: sqliteCore.text("lease_id").notNull().references(() => capabilityResourceLeases.leaseId),
  resourceId: sqliteCore.text("resource_id").notNull().references(() => capabilityResources.resourceId),
  contentHash: sqliteCore.text("content_hash").notNull(),
  generation: sqliteCore.integer("generation").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.leaseId, t.resourceId] }) }));
const capabilityRunProcesses = sqliteCore.sqliteTable("capability_run_processes", {
  processId: sqliteCore.text("process_id").primaryKey(),
  runId: sqliteCore.text("run_id").notNull().references(() => capabilityRuns.runId),
  kind: sqliteCore.text("kind").notNull(),
  launchKey: sqliteCore.text("launch_key").notNull().unique(),
  state: sqliteCore.text("state").notNull(),
  pid: sqliteCore.integer("pid"),
  processStartedAt: sqliteCore.text("process_started_at"),
  armedAt: sqliteCore.text("armed_at"),
  attachedAt: sqliteCore.text("attached_at"),
  endedAt: sqliteCore.text("ended_at")
}, (t) => ({ byRun: sqliteCore.index("capability_run_processes_run_idx").on(t.runId), oneCli: sqliteCore.uniqueIndex("capability_run_one_cli_idx").on(t.runId).where(drizzleOrm.sql`${t.kind} = 'cli'`) }));
const capabilityRunActivities = sqliteCore.sqliteTable("capability_run_activities", {
  activityId: sqliteCore.text("activity_id").primaryKey(),
  runId: sqliteCore.text("run_id").notNull().references(() => capabilityRuns.runId),
  state: sqliteCore.text("state").notNull(),
  startedAt: sqliteCore.text("started_at").notNull(),
  endedAt: sqliteCore.text("ended_at")
});
const capabilityStoreState = sqliteCore.sqliteTable("capability_store_state", {
  singleton: sqliteCore.integer("singleton").primaryKey(),
  storeId: sqliteCore.text("store_id").notNull(),
  resourceGeneration: sqliteCore.integer("resource_generation").notNull().default(1),
  maintenanceState: sqliteCore.text("maintenance_state").notNull(),
  maintenanceOperationId: sqliteCore.text("maintenance_operation_id")
});
const applicationInvocations = sqliteCore.sqliteTable("application_invocations", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  runId: sqliteCore.text("run_id").notNull().references(() => capabilityRuns.runId),
  requestId: sqliteCore.text("request_id").notNull(),
  requestHash: sqliteCore.text("request_hash").notNull(),
  projectId: sqliteCore.text("project_id").notNull(),
  taskId: sqliteCore.text("task_id").notNull(),
  appId: sqliteCore.text("app_id").notNull(),
  packageHash: sqliteCore.text("package_hash").notNull(),
  toolName: sqliteCore.text("tool_name").notNull(),
  contractMajor: sqliteCore.integer("contract_major").notNull(),
  connectionId: sqliteCore.text("connection_id"),
  semantics: sqliteCore.text("semantics").notNull(),
  state: sqliteCore.text("state").notNull(),
  attemptCount: sqliteCore.integer("attempt_count").notNull().default(0),
  errorCode: sqliteCore.text("error_code"),
  effectState: sqliteCore.text("effect_state").notNull(),
  startedAt: sqliteCore.text("started_at").notNull(),
  endedAt: sqliteCore.text("ended_at")
}, (t) => ({ request: sqliteCore.uniqueIndex("application_invocations_run_request").on(t.runId, t.requestId), project: sqliteCore.index("application_invocations_project_idx").on(t.projectId, t.startedAt), activity: sqliteCore.index("application_invocations_activity_time").on(t.startedAt, t.operationId) }));
const capabilityPackageContracts = sqliteCore.sqliteTable("capability_package_contracts", {
  packageHash: sqliteCore.text("package_hash").notNull().references(() => capabilityPackages.packageHash),
  toolName: sqliteCore.text("tool_name").notNull(),
  inputSource: sqliteCore.text("input_source").notNull(),
  outputSource: sqliteCore.text("output_source").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.packageHash, t.toolName] }) }));
const capabilityAgentAdapters = sqliteCore.sqliteTable("capability_agent_adapters", {
  agentId: sqliteCore.text("agent_id").notNull(),
  version: sqliteCore.text("version").notNull(),
  adapterHash: sqliteCore.text("adapter_hash").notNull().unique(),
  resourceId: sqliteCore.text("resource_id").notNull().references(() => capabilityResources.resourceId),
  manifestJson: sqliteCore.text("manifest_json").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.agentId, t.version] }) }));
const capabilityDiscoveryRoots = sqliteCore.sqliteTable("capability_discovery_roots", { homeId: sqliteCore.text("home_id").primaryKey(), canonicalHome: sqliteCore.text("canonical_home").notNull().unique() });
const capabilityBuiltinPackageSources = sqliteCore.sqliteTable("capability_builtin_package_sources", {
  packageHash: sqliteCore.text("package_hash").notNull().references(() => capabilityPackages.packageHash),
  sourceIndexHash: sqliteCore.text("source_index_hash").notNull(),
  sourceIndexJson: sqliteCore.text("source_index_json").notNull(),
  approvedAt: sqliteCore.text("approved_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.packageHash, t.sourceIndexHash] }) }));
const applicationDataOperations = sqliteCore.sqliteTable("application_data_operations", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  callerKind: sqliteCore.text("caller_kind").notNull(),
  scopeKind: sqliteCore.text("scope_kind").notNull(),
  projectId: sqliteCore.text("project_id"),
  taskId: sqliteCore.text("task_id"),
  runId: sqliteCore.text("run_id"),
  jobId: sqliteCore.text("job_id"),
  parentOperationId: sqliteCore.text("parent_operation_id"),
  appId: sqliteCore.text("app_id").notNull(),
  packageHash: sqliteCore.text("package_hash").notNull(),
  dataApi: sqliteCore.integer("data_api").notNull(),
  action: sqliteCore.text("action").notNull(),
  semantics: sqliteCore.text("semantics").notNull(),
  scopeHash: sqliteCore.text("scope_hash").notNull(),
  targetsJson: sqliteCore.text("targets_json").notNull().default("[]"),
  attemptCount: sqliteCore.integer("attempt_count").notNull().default(1),
  state: sqliteCore.text("state").notNull(),
  errorCode: sqliteCore.text("error_code"),
  startedAt: sqliteCore.text("started_at").notNull(),
  endedAt: sqliteCore.text("ended_at")
}, (t) => ({ project: sqliteCore.index("application_data_operations_project").on(t.projectId, t.startedAt), activity: sqliteCore.index("application_data_operations_activity_time").on(t.startedAt, t.operationId) }));
const applicationDataResources = sqliteCore.sqliteTable("application_data_resources", {
  resourceId: sqliteCore.text("resource_id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  appId: sqliteCore.text("app_id").notNull(),
  backingKind: sqliteCore.text("backing_kind").notNull(),
  objectId: sqliteCore.text("object_id").notNull(),
  objectRevision: sqliteCore.text("object_revision").notNull(),
  part: sqliteCore.text("part").notNull(),
  dataContractMajor: sqliteCore.integer("data_contract_major").notNull(),
  permission: sqliteCore.text("permission").notNull(),
  contentHash: sqliteCore.text("content_hash").notNull(),
  byteSize: sqliteCore.integer("byte_size").notNull(),
  mediaType: sqliteCore.text("media_type").notNull(),
  mintedPackageHash: sqliteCore.text("minted_package_hash").notNull(),
  mintedOperationId: sqliteCore.text("minted_operation_id").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
}, (t) => ({ businessIdentity: sqliteCore.uniqueIndex("application_data_resources_identity").on(t.projectId, t.appId, t.backingKind, t.objectId, t.objectRevision, t.part, t.dataContractMajor) }));
const applicationZentaoRevisions = sqliteCore.sqliteTable("application_zentao_revisions", {
  objectKey: sqliteCore.text("object_key").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  connectionId: sqliteCore.text("connection_id").notNull(),
  identityRevision: sqliteCore.integer("identity_revision").notNull(),
  objectKind: sqliteCore.text("object_kind").notNull(),
  nativeId: sqliteCore.text("native_id").notNull(),
  contentRevision: sqliteCore.text("content_revision").notNull(),
  representation: sqliteCore.text("representation").notNull(),
  payloadJson: sqliteCore.text("payload_json").notNull(),
  fetchedAt: sqliteCore.text("fetched_at").notNull()
}, (t) => ({ identity: sqliteCore.uniqueIndex("application_zentao_revisions_identity").on(t.projectId, t.connectionId, t.identityRevision, t.objectKind, t.nativeId, t.contentRevision, t.representation) }));
const applicationZentaoFiles = sqliteCore.sqliteTable("application_zentao_files", {
  objectKey: sqliteCore.text("object_key").notNull().references(() => applicationZentaoRevisions.objectKey),
  fileId: sqliteCore.text("file_id").notNull(),
  contentHash: sqliteCore.text("content_hash").notNull(),
  bytes: sqliteCore.blob("bytes", { mode: "buffer" }).notNull(),
  mediaType: sqliteCore.text("media_type").notNull(),
  byteSize: sqliteCore.integer("byte_size").notNull(),
  fetchedAt: sqliteCore.text("fetched_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.objectKey, t.fileId, t.contentHash] }) }));
const applicationZentaoCursors = sqliteCore.sqliteTable("application_zentao_cursors", {
  cursorId: sqliteCore.text("cursor_id").primaryKey(),
  projectId: sqliteCore.text("project_id").notNull(),
  targetJson: sqliteCore.text("target_json").notNull(),
  objectKind: sqliteCore.text("object_kind").notNull(),
  pageSize: sqliteCore.integer("page_size").notNull(),
  pageNo: sqliteCore.integer("page_no").notNull(),
  expectedTotal: sqliteCore.integer("expected_total").notNull(),
  seenJson: sqliteCore.text("seen_json").notNull(),
  expiresAt: sqliteCore.text("expires_at").notNull()
});
const applicationZentaoOperationObjects = sqliteCore.sqliteTable("application_zentao_operation_objects", {
  operationId: sqliteCore.text("operation_id").notNull(),
  objectKey: sqliteCore.text("object_key").notNull().references(() => applicationZentaoRevisions.objectKey)
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.operationId, t.objectKey] }) }));
const applicationReadReceiptChecks = sqliteCore.sqliteTable("application_read_receipt_checks", {
  checkOperationId: sqliteCore.text("check_operation_id").primaryKey(),
  originalOperationId: sqliteCore.text("original_operation_id").notNull(),
  checkedAt: sqliteCore.text("checked_at").notNull()
});
const applicationZentaoOperationResources = sqliteCore.sqliteTable("application_zentao_operation_resources", {
  operationId: sqliteCore.text("operation_id").primaryKey(),
  backingJson: sqliteCore.text("backing_json").notNull()
});
const applicationIndexWaiters = sqliteCore.sqliteTable("application_index_waiters", {
  indexOperationId: sqliteCore.text("index_operation_id").notNull().references(() => applicationDataOperations.operationId),
  parentOperationId: sqliteCore.text("parent_operation_id").notNull().references(() => applicationDataOperations.operationId),
  sourceKey: sqliteCore.text("source_key").notNull(),
  joinedAt: sqliteCore.text("joined_at").notNull(),
  endedAt: sqliteCore.text("ended_at"),
  state: sqliteCore.text("state").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.indexOperationId, t.parentOperationId] }) }));
const applicationMailOperationSources = sqliteCore.sqliteTable("application_mail_operation_sources", {
  operationId: sqliteCore.text("operation_id").primaryKey().references(() => applicationDataOperations.operationId),
  sourceKey: sqliteCore.text("source_key").notNull(),
  sourceRevision: sqliteCore.text("source_revision").notNull(),
  operationKind: sqliteCore.text("operation_kind").notNull(),
  provenanceJson: sqliteCore.text("provenance_json").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
});
const mailUserActionSources = sqliteCore.sqliteTable("mail_user_action_sources", {
  evidenceId: sqliteCore.text("evidence_id").primaryKey(),
  intentId: sqliteCore.text("intent_id").notNull().references(() => mailSendIntents.id),
  sourceKind: sqliteCore.text("source_kind").notNull(),
  sourceHash: sqliteCore.text("source_hash").notNull(),
  provenanceJson: sqliteCore.text("provenance_json").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
});
const applicationActivitySubjects = sqliteCore.sqliteTable("application_activity_subjects", {
  operationId: sqliteCore.text("operation_id").notNull().references(() => applicationDataOperations.operationId, { onDelete: "cascade" }),
  kind: sqliteCore.text("kind").notNull(),
  subjectId: sqliteCore.text("subject_id").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.operationId, t.kind, t.subjectId] }), lookup: sqliteCore.index("application_activity_subjects_lookup").on(t.kind, t.subjectId, t.operationId) }));
const capabilityRunPreparations = sqliteCore.sqliteTable("capability_run_preparations", {
  runId: sqliteCore.text("run_id").primaryKey().references(() => capabilityRuns.runId),
  evidenceJson: sqliteCore.text("evidence_json").notNull(),
  evidenceHash: sqliteCore.text("evidence_hash").notNull(),
  preparedAt: sqliteCore.text("prepared_at").notNull()
}, (t) => ({ time: sqliteCore.index("capability_run_evidence_time").on(t.preparedAt, t.runId) }));
const capabilityBridgeObservations = sqliteCore.sqliteTable("capability_bridge_observations", {
  runId: sqliteCore.text("run_id").notNull().references(() => capabilityRuns.runId),
  bridgeId: sqliteCore.text("bridge_id").notNull().references(() => capabilityRunProcesses.processId),
  evidenceJson: sqliteCore.text("evidence_json").notNull(),
  evidenceHash: sqliteCore.text("evidence_hash").notNull(),
  observedAt: sqliteCore.text("observed_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.runId, t.bridgeId] }) }));
const capabilityLegacyMigrationPreparations = sqliteCore.sqliteTable("capability_legacy_migration_preparations", {
  taskId: sqliteCore.text("task_id").primaryKey().references(() => capabilitySessionSnapshots.taskId),
  sourceSnapshotJson: sqliteCore.text("source_snapshot_json").notNull(),
  sourceRecordJson: sqliteCore.text("source_record_json").notNull(),
  sourceSnapshotHash: sqliteCore.text("source_snapshot_hash").notNull(),
  sourceIdentityJson: sqliteCore.text("source_identity_json").notNull(),
  boundNativeSessionId: sqliteCore.text("bound_native_session_id"),
  evidenceJson: sqliteCore.text("evidence_json"),
  evidenceHash: sqliteCore.text("evidence_hash"),
  manifestJson: sqliteCore.text("manifest_json"),
  manifestHash: sqliteCore.text("manifest_hash"),
  hBindingHash: sqliteCore.text("h_binding_hash"),
  state: sqliteCore.text("state", { enum: ["held", "prepared", "migrated"] }).notNull(),
  issueCode: sqliteCore.text("issue_code"),
  createdAt: sqliteCore.text("created_at").notNull(),
  updatedAt: sqliteCore.text("updated_at").notNull()
}, (t) => ({ byState: sqliteCore.index("capability_legacy_preparation_state").on(t.state, t.taskId) }));
const capabilityLegacyHBindings = sqliteCore.sqliteTable("capability_legacy_h_bindings", {
  taskId: sqliteCore.text("task_id").primaryKey().references(() => capabilityLegacyMigrationPreparations.taskId),
  bindingJson: sqliteCore.text("binding_json").notNull(),
  bindingHash: sqliteCore.text("binding_hash").notNull(),
  createdAt: sqliteCore.text("created_at").notNull()
});
const capabilitySkillObservations = sqliteCore.sqliteTable("capability_skill_observations", {
  runId: sqliteCore.text("run_id").notNull().references(() => capabilityRuns.runId),
  appId: sqliteCore.text("app_id").notNull(),
  skillId: sqliteCore.text("skill_id").notNull(),
  kind: sqliteCore.text("kind", { enum: ["discovery", "read"] }).notNull(),
  evidenceJson: sqliteCore.text("evidence_json").notNull(),
  evidenceHash: sqliteCore.text("evidence_hash").notNull(),
  observedAt: sqliteCore.text("observed_at").notNull()
}, (t) => ({ pk: sqliteCore.primaryKey({ columns: [t.runId, t.appId, t.skillId, t.kind] }) }));
const schema = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  aiProfiles,
  appSecrets,
  appSettings,
  applicationActivitySubjects,
  applicationBindingChanges,
  applicationBindingSlotRevisions,
  applicationCatalogState,
  applicationConnections,
  applicationDataOperations,
  applicationDataResources,
  applicationIndexWaiters,
  applicationInvocations,
  applicationMailOperationSources,
  applicationProjectBindings,
  applicationProjectSettings,
  applicationReadReceiptChecks,
  applicationSecretChanges,
  applicationZentaoCursors,
  applicationZentaoFiles,
  applicationZentaoOperationObjects,
  applicationZentaoOperationResources,
  applicationZentaoRevisions,
  capabilityActivePackages,
  capabilityAgentAdapters,
  capabilityBridgeObservations,
  capabilityBuiltinPackageSources,
  capabilityDiscoveryRoots,
  capabilityInstallJournal,
  capabilityLeaseResources,
  capabilityLegacyHBindings,
  capabilityLegacyMigrationPreparations,
  capabilityPackageContracts,
  capabilityPackages,
  capabilityResourceDependencies,
  capabilityResourceLeases,
  capabilityResourceOperations,
  capabilityResources,
  capabilityRunActivities,
  capabilityRunPreparations,
  capabilityRunProcesses,
  capabilityRuns,
  capabilitySchemaMigrations,
  capabilitySessionHolds,
  capabilitySessionIdentities,
  capabilitySessionMcpNames,
  capabilitySessionRefs,
  capabilitySessionSnapshots,
  capabilitySkillObservations,
  capabilitySnapshotVersions,
  capabilityStoreState,
  importedKeys,
  mailAttachmentObjects,
  mailBlobObjects,
  mailBlobWrites,
  mailDraftMutations,
  mailDraftRevisions,
  mailDrafts,
  mailSendExecutions,
  mailSendGrants,
  mailSendIntents,
  mailUserActionSources,
  projectCapabilities,
  projectDatabases,
  projectDirs,
  projectImportReceipts,
  projectServers,
  projects,
  sessions,
  skillVersions,
  tasks
}, Symbol.toStringTag, { value: "Module" }));
class SecretsStore {
  constructor(db, cipher) {
    this.db = db;
    this.cipher = cipher;
  }
  set(key, secret2) {
    this.assertAvailable();
    const enc = this.cipher.encrypt(secret2).toString("base64");
    this.db.insert(appSecrets).values({ key, secret: enc }).onConflictDoUpdate({ target: appSecrets.key, set: { secret: enc } }).run();
  }
  get(key) {
    const row = this.db.select().from(appSecrets).where(drizzleOrm.eq(appSecrets.key, key)).get();
    if (!row) return null;
    this.assertAvailable();
    return this.cipher.decrypt(Buffer.from(row.secret, "base64"));
  }
  /** Presence check without decrypting (no Keychain prompt). */
  has(key) {
    return Boolean(this.db.select({ key: appSecrets.key }).from(appSecrets).where(drizzleOrm.eq(appSecrets.key, key)).get());
  }
  delete(key) {
    this.db.delete(appSecrets).where(drizzleOrm.eq(appSecrets.key, key)).run();
  }
  deleteMany(keys) {
    if (keys.length) this.db.delete(appSecrets).where(drizzleOrm.inArray(appSecrets.key, keys)).run();
  }
  assertAvailable() {
    if (!this.cipher.isAvailable()) {
      throw new Error("系统安全存储不可用（safeStorage），拒绝以明文保存密钥");
    }
  }
}
const DB_VENDORS = {
  mysql: { label: "MySQL", transport: "mysql", defaultPort: 3306 },
  postgres: { label: "PostgreSQL", transport: "postgres", defaultPort: 5432 },
  opengauss: { label: "openGauss", transport: "postgres", defaultPort: 5432 },
  panweidb: { label: "盘维 PanweiDB", transport: "postgres", defaultPort: 5432 },
  kingbase: { label: "KingbaseES", transport: "postgres", defaultPort: 54321 },
  highgo: { label: "HighGo", transport: "postgres", defaultPort: 5866 },
  oceanbase: { label: "OceanBase (MySQL)", transport: "mysql", defaultPort: 2881 },
  goldendb: { label: "GoldenDB", transport: "mysql", defaultPort: 3306 }
};
const DB_VENDOR_IDS = Object.keys(DB_VENDORS);
const trimmed = (max) => zod.z.string().trim().max(max);
const required = (max) => zod.z.string().trim().min(1).max(max);
const optionalPath = zod.z.string().trim().max(1024).nullable().transform((v) => v ? v : null);
const aliases = zod.z.array(zod.z.string()).max(50).transform((list) => [...new Set(list.map((a) => a.trim()).filter(Boolean))]);
const port = zod.z.number().int().min(1).max(65535);
const secretChange = zod.z.string().max(4096).nullable().optional();
const projectInputSchema = zod.z.object({
  name: required(100),
  aliases,
  description: trimmed(2e3),
  rulesPath: optionalPath
});
const dirInputSchema = zod.z.object({
  label: trimmed(100),
  path: zod.z.string().trim().min(1).max(1024).refine((p) => p.startsWith("/"), { message: "必须是绝对路径" })
});
const databaseInputSchema = zod.z.object({
  env: required(32),
  label: trimmed(100),
  aliases,
  vendor: zod.z.enum(DB_VENDOR_IDS),
  host: required(255),
  port,
  database: trimmed(255),
  schema: zod.z.string().trim().max(255).nullable().transform((v) => v ? v : null),
  username: required(255),
  accessLevel: zod.z.enum(["readonly", "readwrite"]),
  isDefault: zod.z.boolean(),
  note: trimmed(2e3),
  password: secretChange
});
const serverInputSchema = zod.z.object({
  env: required(32),
  label: trimmed(100),
  aliases,
  host: required(255),
  port,
  username: required(255),
  authType: zod.z.enum(["password", "key"]),
  privateKeyPath: optionalPath,
  defaultRoot: zod.z.boolean(),
  sudoPolicy: zod.z.enum(["none", "same-as-login", "separate"]),
  appRoot: optionalPath,
  logsPath: optionalPath,
  note: trimmed(2e3),
  password: secretChange,
  passphrase: secretChange,
  sudoPassword: secretChange
}).refine((s) => s.authType !== "key" || Boolean(s.privateKeyPath), {
  message: "密钥认证需要填写私钥路径",
  path: ["privateKeyPath"]
});
const FIELD_LABELS = {
  name: "项目名称",
  aliases: "别名",
  description: "说明",
  rulesPath: "规则文件",
  label: "名称",
  path: "路径",
  env: "环境",
  vendor: "数据库类型",
  host: "主机",
  port: "端口",
  database: "库名",
  schema: "Schema",
  username: "用户名",
  accessLevel: "权限",
  note: "备注",
  authType: "认证方式",
  privateKeyPath: "私钥文件",
  sudoPolicy: "sudo",
  appRoot: "应用目录",
  logsPath: "日志目录",
  password: "密码",
  passphrase: "私钥口令",
  sudoPassword: "sudo 密码"
};
function describeIssue(issue, labels = FIELD_LABELS) {
  const key = issue.path.find((p) => typeof p === "string");
  const field = (key && (labels[key] ?? FIELD_LABELS[key])) ?? (issue.path.join(".") || "输入");
  if (key === "port") return `${field}必须是 1–65535 的整数`;
  switch (issue.code) {
    case "too_small":
      return issue.origin === "string" && Number(issue.minimum) === 1 ? `${field}不能为空` : `${field}过小或过短`;
    case "too_big":
      return issue.origin === "string" ? `${field}不能超过 ${issue.maximum} 个字符` : `${field}过大或过长`;
    case "invalid_type":
    case "invalid_value":
      return `${field}取值无效`;
    default:
      return /[一-鿿]/.test(issue.message) ? `${field}：${issue.message}` : `${field}无效`;
  }
}
function inspectDir(path2) {
  const status = { exists: false, isDirectory: false, readable: false, writable: false, vcs: null, available: false };
  try {
    status.isDirectory = node_fs.statSync(path2).isDirectory();
    status.exists = true;
  } catch {
    return status;
  }
  status.readable = can(path2, node_fs.constants.R_OK | node_fs.constants.X_OK);
  status.writable = can(path2, node_fs.constants.W_OK);
  status.vcs = detectVcs(path2);
  status.available = status.isDirectory && status.readable;
  return status;
}
function can(path2, mode) {
  try {
    node_fs.accessSync(path2, mode);
    return true;
  } catch {
    return false;
  }
}
function detectVcs(start) {
  let dir = node_path.resolve(start);
  for (; ; ) {
    if (node_fs.existsSync(node_path.join(dir, ".svn"))) return "svn";
    if (node_fs.existsSync(node_path.join(dir, ".git"))) return "git";
    const parent = node_path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function pathIdentity(path2) {
  const abs = node_path.resolve(path2);
  try {
    return node_fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}
const serverKeys = (id2) => ({
  password: `server:${id2}:password`,
  passphrase: `server:${id2}:passphrase`,
  sudo: `server:${id2}:sudo`
});
const secretKeys = {
  databasePassword: (id2) => `db:${id2}:password`,
  /** Every key a database row may own. */
  database: (id2) => [`db:${id2}:password`],
  serverKeys,
  server: (id2) => Object.values(serverKeys(id2))
};
function parse(schema2, value) {
  const r = schema2.safeParse(value);
  if (r.success) return r.data;
  throw new Error(`输入无效：${describeIssue(r.error.issues[0])}`);
}
const parseAliases = (json2) => {
  try {
    const v = JSON.parse(json2);
    return Array.isArray(v) ? v.filter((a) => typeof a === "string") : [];
  } catch {
    return [];
  }
};
function lastTestOf(row) {
  if (row.lastTestAt == null) return null;
  return {
    at: row.lastTestAt,
    ok: Boolean(row.lastTestOk),
    category: row.lastTestCategory ?? "other",
    message: row.lastTestMessage ?? "",
    ms: row.lastTestMs ?? 0
  };
}
class ProjectService {
  constructor(db, secrets, now = Date.now, cleanupImportedKeys) {
    this.db = db;
    this.secrets = secrets;
    this.now = now;
    this.cleanupImportedKeys = cleanupImportedKeys;
  }
  // ---- projects ----
  listProjects(opts = {}) {
    const rows = this.db.select().from(projects).where(opts.includeArchived ? void 0 : drizzleOrm.isNull(projects.archivedAt)).orderBy(drizzleOrm.asc(projects.createdAt)).all();
    return rows.map((r) => this.toSummary(r));
  }
  getProject(id2) {
    const row = this.requireProject(id2);
    const dirs = this.db.select().from(projectDirs).where(drizzleOrm.eq(projectDirs.projectId, id2)).orderBy(drizzleOrm.asc(projectDirs.createdAt)).all();
    const dbs = this.db.select().from(projectDatabases).where(drizzleOrm.eq(projectDatabases.projectId, id2)).orderBy(drizzleOrm.asc(projectDatabases.createdAt)).all();
    const servers = this.db.select().from(projectServers).where(drizzleOrm.eq(projectServers.projectId, id2)).orderBy(drizzleOrm.asc(projectServers.createdAt)).all();
    return {
      ...this.toSummary(row),
      dirs: dirs.map((d) => this.toDirView(d)),
      databases: dbs.map((d) => this.toDatabaseView(d)),
      servers: servers.map((s) => this.toServerView(s))
    };
  }
  createProject(input, dirs = []) {
    const data = parse(projectInputSchema, input);
    const parsedDirs = dirs.map((d) => parse(dirInputSchema, d));
    const id2 = node_crypto.randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.assertUniqueName(data.name, null);
      this.db.insert(projects).values({ id: id2, ...data, aliases: JSON.stringify(data.aliases), createdAt: ts, updatedAt: ts }).run();
      for (const d of parsedDirs) this.insertDir(id2, d, ts);
    });
    return this.getProject(id2);
  }
  updateProject(id2, input) {
    const data = parse(projectInputSchema, input);
    this.db.transaction(() => {
      this.requireProject(id2);
      this.assertUniqueName(data.name, id2);
      this.db.update(projects).set({ ...data, aliases: JSON.stringify(data.aliases) }).where(drizzleOrm.eq(projects.id, id2)).run();
      this.bump(id2);
    });
    return this.getProject(id2);
  }
  setArchived(id2, archived) {
    this.db.transaction(() => {
      const row = this.requireProject(id2);
      if (!archived && row.archivedAt != null) {
        const dirs = this.db.select().from(projectDirs).where(drizzleOrm.eq(projectDirs.projectId, id2)).all();
        for (const d of dirs) this.assertPathFree(d.path, id2, d.id);
        this.assertUniqueName(row.name, id2);
      }
      this.db.update(projects).set({ archivedAt: archived ? row.archivedAt ?? this.now() : null }).where(drizzleOrm.eq(projects.id, id2)).run();
      this.bump(id2);
    });
    return this.getProject(id2);
  }
  /** Removes SmartDD's records only; code directories and remote resources are never touched. */
  deleteProject(id2, opts) {
    this.db.transaction(() => {
      this.requireProject(id2);
      if (opts.deleteSecrets) {
        const dbIds = this.db.select({ id: projectDatabases.id }).from(projectDatabases).where(drizzleOrm.eq(projectDatabases.projectId, id2)).all();
        const srvIds = this.db.select({ id: projectServers.id }).from(projectServers).where(drizzleOrm.eq(projectServers.projectId, id2)).all();
        this.secrets.deleteMany([
          ...dbIds.flatMap((r) => secretKeys.database(r.id)),
          ...srvIds.flatMap((r) => secretKeys.server(r.id))
        ]);
      }
      this.db.delete(projects).where(drizzleOrm.eq(projects.id, id2)).run();
    });
    this.cleanupOwnedKeys();
  }
  // ---- code directories ----
  addDir(projectId, input) {
    const data = parse(dirInputSchema, input);
    let id2 = "";
    this.db.transaction(() => {
      this.requireProject(projectId);
      id2 = this.insertDir(projectId, data, this.now());
      this.bump(projectId);
    });
    return this.toDirView(this.requireDir(id2));
  }
  updateDir(id2, input) {
    const data = parse(dirInputSchema, input);
    this.db.transaction(() => {
      const row = this.requireDir(id2);
      this.assertPathFree(data.path, row.projectId, id2);
      this.db.update(projectDirs).set({ label: data.label, path: data.path, updatedAt: this.now() }).where(drizzleOrm.eq(projectDirs.id, id2)).run();
      this.bump(row.projectId);
    });
    return this.toDirView(this.requireDir(id2));
  }
  setDefaultDir(id2) {
    this.db.transaction(() => {
      const row = this.requireDir(id2);
      this.db.update(projectDirs).set({ isDefault: false }).where(drizzleOrm.eq(projectDirs.projectId, row.projectId)).run();
      this.db.update(projectDirs).set({ isDefault: true }).where(drizzleOrm.eq(projectDirs.id, id2)).run();
      this.bump(row.projectId);
    });
  }
  removeDir(id2) {
    this.db.transaction(() => {
      const row = this.requireDir(id2);
      this.db.delete(projectDirs).where(drizzleOrm.eq(projectDirs.id, id2)).run();
      if (row.isDefault) {
        const next = this.db.select({ id: projectDirs.id }).from(projectDirs).where(drizzleOrm.eq(projectDirs.projectId, row.projectId)).orderBy(drizzleOrm.asc(projectDirs.createdAt)).get();
        if (next) this.db.update(projectDirs).set({ isDefault: true }).where(drizzleOrm.eq(projectDirs.id, next.id)).run();
      }
      this.bump(row.projectId);
    });
  }
  // ---- databases ----
  createDatabase(projectId, input) {
    const data = parse(databaseInputSchema, input);
    const id2 = node_crypto.randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.requireProject(projectId);
      const { password, ...fields } = data;
      if (fields.isDefault) this.clearDefaultDatabase(projectId);
      this.db.insert(projectDatabases).values({ id: id2, projectId, ...fields, aliases: JSON.stringify(fields.aliases), createdAt: ts, updatedAt: ts }).run();
      this.applySecret(secretKeys.databasePassword(id2), password);
      this.bump(projectId);
    });
    return this.toDatabaseView(this.requireDatabase(id2));
  }
  updateDatabase(id2, input) {
    const data = parse(databaseInputSchema, input);
    this.db.transaction(() => {
      const row = this.requireDatabase(id2);
      const { password, ...fields } = data;
      if (fields.isDefault) this.clearDefaultDatabase(row.projectId);
      this.db.update(projectDatabases).set({ ...fields, aliases: JSON.stringify(fields.aliases), updatedAt: this.now() }).where(drizzleOrm.eq(projectDatabases.id, id2)).run();
      this.applySecret(secretKeys.databasePassword(id2), password);
      this.bump(row.projectId);
    });
    return this.toDatabaseView(this.requireDatabase(id2));
  }
  deleteDatabase(id2, opts) {
    this.db.transaction(() => {
      const row = this.requireDatabase(id2);
      if (opts.deleteSecrets) this.secrets.deleteMany(secretKeys.database(id2));
      this.db.delete(projectDatabases).where(drizzleOrm.eq(projectDatabases.id, id2)).run();
      this.bump(row.projectId);
    });
  }
  /** Connection parameters for a test. Main process only — the password never goes to the renderer. */
  databaseTarget(input, existingId) {
    const data = parse(databaseInputSchema, input);
    return {
      vendor: data.vendor,
      host: data.host,
      port: data.port,
      database: data.database,
      schema: data.schema,
      username: data.username,
      password: this.resolveSecret(data.password, existingId ? secretKeys.databasePassword(existingId) : null)
    };
  }
  savedDatabaseInput(id2) {
    const r = this.requireDatabase(id2);
    return {
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      vendor: r.vendor,
      host: r.host,
      port: r.port,
      database: r.database,
      schema: r.schema,
      username: r.username,
      accessLevel: r.accessLevel,
      isDefault: r.isDefault,
      note: r.note
    };
  }
  recordDatabaseTest(id2, result) {
    this.db.update(projectDatabases).set(this.testColumns(result)).where(drizzleOrm.eq(projectDatabases.id, id2)).run();
    return this.toDatabaseView(this.requireDatabase(id2));
  }
  // ---- servers ----
  createServer(projectId, input) {
    const data = parse(serverInputSchema, input);
    const id2 = node_crypto.randomUUID();
    const ts = this.now();
    this.db.transaction(() => {
      this.requireProject(projectId);
      const { password, passphrase, sudoPassword, ...fields } = data;
      this.db.insert(projectServers).values({ id: id2, projectId, ...fields, aliases: JSON.stringify(fields.aliases), createdAt: ts, updatedAt: ts }).run();
      const keys = secretKeys.serverKeys(id2);
      this.applySecret(keys.password, password);
      this.applySecret(keys.passphrase, passphrase);
      this.applySecret(keys.sudo, sudoPassword);
      this.bump(projectId);
    });
    return this.toServerView(this.requireServer(id2));
  }
  updateServer(id2, input) {
    const data = parse(serverInputSchema, input);
    this.db.transaction(() => {
      const row = this.requireServer(id2);
      const { password, passphrase, sudoPassword, ...fields } = data;
      this.db.update(projectServers).set({ ...fields, aliases: JSON.stringify(fields.aliases), updatedAt: this.now() }).where(drizzleOrm.eq(projectServers.id, id2)).run();
      const keys = secretKeys.serverKeys(id2);
      this.applySecret(keys.password, password);
      this.applySecret(keys.passphrase, passphrase);
      this.applySecret(keys.sudo, sudoPassword);
      this.bump(row.projectId);
    });
    this.cleanupOwnedKeys();
    return this.toServerView(this.requireServer(id2));
  }
  deleteServer(id2, opts) {
    this.db.transaction(() => {
      const row = this.requireServer(id2);
      if (opts.deleteSecrets) this.secrets.deleteMany(secretKeys.server(id2));
      this.db.delete(projectServers).where(drizzleOrm.eq(projectServers.id, id2)).run();
      this.bump(row.projectId);
    });
    this.cleanupOwnedKeys();
  }
  cleanupOwnedKeys() {
    var _a;
    try {
      (_a = this.cleanupImportedKeys) == null ? void 0 : _a.call(this);
    } catch {
      console.warn("[project-transfer] owned key cleanup pending startup recovery");
    }
  }
  serverTarget(input, existingId) {
    const data = parse(serverInputSchema, input);
    const keys = existingId ? secretKeys.serverKeys(existingId) : null;
    return {
      host: data.host,
      port: data.port,
      username: data.username,
      authType: data.authType,
      privateKeyPath: data.privateKeyPath,
      password: this.resolveSecret(data.password, (keys == null ? void 0 : keys.password) ?? null),
      passphrase: this.resolveSecret(data.passphrase, (keys == null ? void 0 : keys.passphrase) ?? null)
    };
  }
  savedServerInput(id2) {
    const r = this.requireServer(id2);
    return {
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      privateKeyPath: r.privateKeyPath,
      defaultRoot: r.defaultRoot,
      sudoPolicy: r.sudoPolicy,
      appRoot: r.appRoot,
      logsPath: r.logsPath,
      note: r.note
    };
  }
  recordServerTest(id2, result) {
    this.db.update(projectServers).set(this.testColumns(result)).where(drizzleOrm.eq(projectServers.id, id2)).run();
    return this.toServerView(this.requireServer(id2));
  }
  // ---- internals ----
  insertDir(projectId, d, ts) {
    this.assertPathFree(d.path, projectId);
    const hasDefault = this.db.select({ id: projectDirs.id }).from(projectDirs).where(drizzleOrm.and(drizzleOrm.eq(projectDirs.projectId, projectId), drizzleOrm.eq(projectDirs.isDefault, true))).get();
    const id2 = node_crypto.randomUUID();
    this.db.insert(projectDirs).values({ id: id2, projectId, label: d.label, path: d.path, isDefault: !hasDefault, createdAt: ts, updatedAt: ts }).run();
    return id2;
  }
  /**
   * PRD F01: a path belongs to at most one active project, and appears once per project.
   * Archived projects do not hold their paths.
   */
  assertPathFree(path2, projectId, exceptDirId) {
    const identity2 = pathIdentity(path2);
    const rows = this.db.select({ dirId: projectDirs.id, path: projectDirs.path, projectId: projects.id, name: projects.name, archivedAt: projects.archivedAt }).from(projectDirs).innerJoin(projects, drizzleOrm.eq(projectDirs.projectId, projects.id)).all();
    for (const r of rows) {
      if (r.dirId === exceptDirId) continue;
      if (r.projectId !== projectId && r.archivedAt != null) continue;
      if (pathIdentity(r.path) !== identity2) continue;
      throw new Error(
        r.projectId === projectId ? `该项目已登记此目录：${r.path}` : `目录已属于项目「${r.name}」：${r.path}`
      );
    }
  }
  assertUniqueName(name2, exceptId) {
    const clash = this.db.select({ id: projects.id }).from(projects).where(
      drizzleOrm.and(
        drizzleOrm.sql`lower(${projects.name}) = lower(${name2})`,
        drizzleOrm.isNull(projects.archivedAt),
        exceptId ? drizzleOrm.ne(projects.id, exceptId) : void 0
      )
    ).get();
    if (clash) throw new Error(`已有同名项目：${name2}`);
  }
  clearDefaultDatabase(projectId) {
    this.db.update(projectDatabases).set({ isDefault: false }).where(drizzleOrm.eq(projectDatabases.projectId, projectId)).run();
  }
  /** undefined keeps, null or '' clears, anything else replaces. */
  applySecret(key, change) {
    if (change === void 0) return;
    if (change === null || change === "") this.secrets.delete(key);
    else this.secrets.set(key, change);
  }
  resolveSecret(change, savedKey) {
    if (change !== void 0) return change ?? "";
    return savedKey ? this.secrets.get(savedKey) ?? "" : "";
  }
  /** Every config change gets a new version; sessions keep the version they started with. */
  bump(projectId) {
    this.db.update(projects).set({ configVersion: drizzleOrm.sql`${projects.configVersion} + 1`, updatedAt: this.now() }).where(drizzleOrm.eq(projects.id, projectId)).run();
  }
  testColumns(r) {
    return {
      lastTestAt: this.now(),
      lastTestOk: r.ok,
      lastTestCategory: r.category,
      lastTestMessage: r.ok ? r.detail ?? "" : r.message,
      lastTestMs: r.ms
    };
  }
  requireProject(id2) {
    const row = this.db.select().from(projects).where(drizzleOrm.eq(projects.id, id2)).get();
    if (!row) throw new Error(`项目不存在：${id2}`);
    return row;
  }
  requireDir(id2) {
    const row = this.db.select().from(projectDirs).where(drizzleOrm.eq(projectDirs.id, id2)).get();
    if (!row) throw new Error(`代码目录不存在：${id2}`);
    return row;
  }
  requireDatabase(id2) {
    const row = this.db.select().from(projectDatabases).where(drizzleOrm.eq(projectDatabases.id, id2)).get();
    if (!row) throw new Error(`数据库配置不存在：${id2}`);
    return row;
  }
  requireServer(id2) {
    const row = this.db.select().from(projectServers).where(drizzleOrm.eq(projectServers.id, id2)).get();
    if (!row) throw new Error(`服务器配置不存在：${id2}`);
    return row;
  }
  toSummary(r) {
    return {
      id: r.id,
      name: r.name,
      aliases: parseAliases(r.aliases),
      description: r.description,
      rulesPath: r.rulesPath,
      configVersion: r.configVersion,
      archivedAt: r.archivedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt
    };
  }
  toDirView(r) {
    return { id: r.id, projectId: r.projectId, label: r.label, path: r.path, isDefault: r.isDefault, status: inspectDir(r.path) };
  }
  toDatabaseView(r) {
    return {
      id: r.id,
      projectId: r.projectId,
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      vendor: r.vendor,
      host: r.host,
      port: r.port,
      database: r.database,
      schema: r.schema,
      username: r.username,
      accessLevel: r.accessLevel,
      isDefault: r.isDefault,
      note: r.note,
      hasPassword: this.secrets.has(secretKeys.databasePassword(r.id)),
      lastTest: lastTestOf(r)
    };
  }
  toServerView(r) {
    const keys = secretKeys.serverKeys(r.id);
    return {
      id: r.id,
      projectId: r.projectId,
      env: r.env,
      label: r.label,
      aliases: parseAliases(r.aliases),
      host: r.host,
      port: r.port,
      username: r.username,
      authType: r.authType,
      privateKeyPath: r.privateKeyPath,
      defaultRoot: r.defaultRoot,
      sudoPolicy: r.sudoPolicy,
      appRoot: r.appRoot,
      logsPath: r.logsPath,
      note: r.note,
      hasPassword: this.secrets.has(keys.password),
      hasPassphrase: this.secrets.has(keys.passphrase),
      hasSudoPassword: this.secrets.has(keys.sudo),
      lastTest: lastTestOf(r)
    };
  }
}
function stateRootFor(runner, profileEnv, baseEnv) {
  const home = profileEnv.HOME || baseEnv.HOME || node_os.homedir();
  if (runner === "claude") return profileEnv.CLAUDE_CONFIG_DIR || baseEnv.CLAUDE_CONFIG_DIR || node_path.join(home, ".claude");
  return profileEnv.CODEX_HOME || baseEnv.CODEX_HOME || node_path.join(home, ".codex");
}
const __vite_glob_0_0 = "---\nname: smartdd-project-db-diagnostics\ndescription: 根据 WillYou 当前项目的数据库配置定位目标并执行只读诊断。支持 MySQL、PostgreSQL 协议及兼容数据库。\nmetadata:\n  version: 1.0.0\n---\n\n# 项目数据库诊断\n\n复用现有 project-db-diagnostics 查询器。`scripts/db_query.py` 相对于本 SKILL.md 所在目录；用该脚本的绝对路径调用，不以代码工作目录猜测脚本位置。\n\n1. 当前会话的 `PROJECT_DB_CONFIG` 指向 WillYou 生成的配置。先运行 `python3 <skill目录>/scripts/db_query.py --list`，确认项目、环境、库名和目标。\n2. 用 `--db <准确 key>` 或 `--target <明确别名/环境/主机片段>` 选择目标。多个匹配必须澄清，不以列表顺序猜测。生产环境必须有明确授权；未指定环境时先核对目标。\n3. 执行 `python3 <skill目录>/scripts/db_query.py --db <key> --show-selected --sql 'SELECT …' --format json`。从小范围只读查询开始，限制行数，必要时使用全限定表名。Desktop 的 schema 会设置到 PostgreSQL search_path。\n4. 报告选中的项目、资源、环境和查询结论。连接失败时报告类别，不输出密码、令牌、配置全文或环境变量值。\n\n密码只通过配置中的 `passwordEnv` 引用会话环境。不得寻找其他项目的凭据，不得创建本地 `.env` 或把配置写入代码目录。缺少配置/密码时回到 Desktop 修正并重新启动任务，不猜测连接。\n\n默认只允许查询。`readonly` 资源还会开启数据库只读事务，不能用 `--allow-write` 绕过。写操作须用户明确授权且目标为 readwrite；复杂写入沿用用户已安装的 operate-databases 的计划/审批流程。\n\n依赖：Python 3；MySQL 需要 pymysql，PostgreSQL 协议需要 psycopg2。Desktop 启动自检会提示缺失项。不得因兼容协议相同而宣称所有厂商的认证扩展都已验证。\n";
const __vite_glob_0_1 = `#!/usr/bin/env python3
"""Project-aware database query helper for Codex diagnostics."""

import argparse
import getpass
import json
import os
import re
import sys
import time
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_CONFIG = SKILL_DIR / "db_connections.json"
DEFAULT_SECRETS = SKILL_DIR / ".db_secrets.env"

READ_PREFIXES = ("select", "show", "describe", "desc", "explain", "with")
WRITE_PATTERN = re.compile(
    r"\\b(insert|update|delete|truncate|alter|drop|create|replace|grant|revoke|call|load)\\b",
    re.IGNORECASE,
)
ENVIRONMENT_ALIASES = {
    "dev": {"dev", "develop", "development", "test", "testing", "yanfa", "ceshi", "开发", "开发库", "研发", "研发库", "测试", "测试库"},
    "prod": {"prod", "production", "shengchan", "生产", "生产库", "正式", "正式库"},
}


def parse_args():
    parser = argparse.ArgumentParser(description="Run a focused project database diagnostic query.")
    parser.add_argument("--config", default=os.environ.get("PROJECT_DB_CONFIG"))
    parser.add_argument("--secrets", default=str(DEFAULT_SECRETS), help="Optional local env file with database passwords.")
    parser.add_argument("--cwd", default=os.getcwd(), help="Directory used for project auto-match.")
    parser.add_argument("--project", help="Project key or alias.")
    parser.add_argument("--db", help="Database key/name/label under the selected project.")
    parser.add_argument("--target", help="Database environment, alias, host/IP fragment, or natural target such as 开发库/生产库.")
    parser.add_argument("--type", help="Database type, for example mysql, postgres, opengauss, oracle.")
    parser.add_argument("--sql", help="SQL to run. Required unless --list is used.")
    parser.add_argument("--format", choices=("table", "json"), default="table")
    parser.add_argument("--limit", type=int, default=200, help="Maximum rows printed for result sets.")
    parser.add_argument("--connect-timeout", type=int, default=8)
    parser.add_argument("--read-timeout", type=int, default=30)
    parser.add_argument("--allow-write", action="store_true", help="Allow non-read-only SQL.")
    parser.add_argument("--list", action="store_true", help="List configured projects/databases and exit.")
    parser.add_argument("--show-selected", action="store_true", help="Print selected project/database metadata.")
    return parser.parse_args()


def load_config(path):
    config_path = Path(path).expanduser()
    if not config_path.exists():
        raise FileNotFoundError(f"Config not found: {config_path}")
    with config_path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def load_secrets(path):
    secrets_path = Path(path).expanduser()
    if not secrets_path.exists():
        return {}
    secrets = {}
    with secrets_path.open("r", encoding="utf-8") as fh:
        for line in fh:
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if key:
                secrets[key] = value
    return secrets


def normalize(value):
    return re.sub(r"\\s+", "", str(value or "").strip().lower())


def environment_tokens(environment):
    normalized = normalize(environment)
    if not normalized:
        return set()
    tokens = {normalized}
    tokens.update(ENVIRONMENT_ALIASES.get(normalized, set()))
    return {normalize(token) for token in tokens}


def is_under(path, root):
    if not root:
        return False
    try:
        path_obj = Path(path).expanduser().resolve()
        root_obj = Path(root).expanduser().resolve()
        return path_obj == root_obj or root_obj in path_obj.parents
    except Exception:
        path_norm = os.path.abspath(os.path.expanduser(path))
        root_norm = os.path.abspath(os.path.expanduser(root))
        return path_norm == root_norm or path_norm.startswith(root_norm.rstrip(os.sep) + os.sep)


def project_matches(project, query):
    q = normalize(query)
    keys = [project.get("key"), *(project.get("aliases") or [])]
    return any(normalize(key) == q for key in keys)


def select_project(config, project_query, cwd):
    projects = config.get("projects") or []
    if not projects:
        raise ValueError("No projects configured")
    if project_query:
        for project in projects:
            if project_matches(project, project_query):
                return project
        raise ValueError(f"Project not found: {project_query}")
    for project in projects:
        if any(is_under(cwd, root) for root in project.get("roots") or []):
            return project
    return projects[0]


def aliases_list(value):
    if not value:
        return []
    if isinstance(value, str):
        return [value]
    return list(value)


def db_matches(db, query):
    q = normalize(query)
    keys = [db.get("key"), db.get("name"), db.get("label"), *aliases_list(db.get("aliases"))]
    return any(normalize(key) == q for key in keys)


def db_match_tokens(db):
    tokens = {
        normalize(db.get("key")),
        normalize(db.get("name")),
        normalize(db.get("label")),
        normalize(db.get("type")),
        normalize(db.get("host")),
        normalize(db.get("database")),
    }
    tokens.update(normalize(alias) for alias in aliases_list(db.get("aliases")))
    tokens.update(environment_tokens(db.get("environment")))
    return {token for token in tokens if token}


def db_target_matches(db, target):
    raw_target = str(target or "").strip()
    normalized_target = normalize(raw_target)
    if not normalized_target:
        return False
    host = str(db.get("host") or "")
    if raw_target and raw_target in host:
        return True
    tokens = db_match_tokens(db)
    if normalized_target in normalize(host) or normalized_target in tokens:
        return True
    return any(normalized_target == token or normalized_target in token for token in tokens)


def describe_db(db):
    return (
        f"{db.get('key')}: type={db.get('type')} "
        f"env={db.get('environment') or '<empty>'} "
        f"host={db.get('host') or '<empty>'} port={db.get('port') or '<empty>'} "
        f"database={db.get('database') or db.get('serviceName') or db.get('sid') or '<empty>'}"
    )


def select_unique_database(databases, predicate, query, query_label):
    matches = [db for db in databases if predicate(db)]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    choices = "\\n".join(f"  {index}. {describe_db(db)}" for index, db in enumerate(matches, start=1))
    raise ValueError(
        f"Multiple databases matched {query_label} {query!r}. Please clarify with --db.\\n{choices}"
    )


def select_database(project, db_query=None, target_query=None, type_query=None):
    databases = project.get("databases") or []
    if not databases:
        raise ValueError(f"No databases configured for project {project.get('key')}")
    if db_query:
        db = select_unique_database(databases, lambda item: db_matches(item, db_query), db_query, "database")
        if db:
            return db
        raise ValueError(f"Database not found under project {project.get('key')}: {db_query}")
    if target_query:
        db = select_unique_database(databases, lambda item: db_target_matches(item, target_query), target_query, "target")
        if db:
            return db
        raise ValueError(f"Database target not found under project {project.get('key')}: {target_query}")
    if type_query:
        wanted = normalize(type_query)
        db = select_unique_database(
            databases,
            lambda item: normalize(item.get("type")) == wanted or wanted in [normalize(v) for v in aliases_list(item.get("aliases"))],
            type_query,
            "type",
        )
        if db:
            return db
        raise ValueError(f"Database type not found under project {project.get('key')}: {type_query}")
    default_key = project.get("defaultDatabase")
    if default_key:
        for db in databases:
            if db_matches(db, default_key):
                return db
    return databases[0]


def list_config(config):
    for project in config.get("projects") or []:
        print(f"Project {project.get('key')}")
        for db in project.get("databases") or []:
            marker = " (default)" if db_matches(db, project.get("defaultDatabase")) else ""
            print(
                f"  - {db.get('key')}{marker}: type={db.get('type')} "
                f"env={db.get('environment') or '<empty>'} "
                f"host={db.get('host') or '<empty>'} port={db.get('port') or '<empty>'} "
                f"database={db.get('database') or db.get('serviceName') or db.get('sid') or '<empty>'} "
                f"user={db.get('username') or '<empty>'} passwordEnv={db.get('passwordEnv') or '<empty>'}"
            )


def assert_safe_sql(sql, allow_write):
    stripped = (sql or "").strip().strip(";")
    lowered = stripped.lower()
    if not stripped:
        raise ValueError("SQL is empty")
    if allow_write:
        return stripped
    if WRITE_PATTERN.search(stripped) or not lowered.startswith(READ_PREFIXES):
        raise ValueError("Refusing non-read-only SQL without --allow-write")
    return stripped


def encode_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return f"<{len(value)} bytes>"
    return value


def print_json(rows):
    normalized_rows = [
        {key: encode_value(value) for key, value in row.items()}
        for row in rows
    ]
    print(json.dumps(normalized_rows, ensure_ascii=False, indent=2))


def print_table(rows, limit):
    if not rows:
        print("(0 rows)")
        return
    columns = list(rows[0].keys())
    display_rows = rows[:limit]
    rendered = []
    for row in display_rows:
        rendered.append([
            "" if row.get(col) is None else str(encode_value(row.get(col)))
            for col in columns
        ])
    widths = [
        min(max(len(str(col)), *(len(row[i]) for row in rendered)), 80)
        for i, col in enumerate(columns)
    ]
    print(" | ".join(str(col)[:widths[i]].ljust(widths[i]) for i, col in enumerate(columns)))
    print("-+-".join("-" * width for width in widths))
    for row in rendered:
        print(" | ".join(row[i][:widths[i]].ljust(widths[i]) for i in range(len(columns))))
    if len(rows) > limit:
        print(f"... truncated: showing {limit} of {len(rows)} rows")
    else:
        print(f"({len(rows)} rows)")


def get_password(db, secrets):
    env_name = db.get("passwordEnv")
    if env_name:
        password = os.environ.get(env_name)
        if password is not None:
            return password
        if env_name in secrets:
            return secrets[env_name]
        raise ValueError(
            f"Password is not set. Set environment variable {env_name} "
            f"or add it to {DEFAULT_SECRETS}"
        )
    if db.get("password") is not None:
        return str(db.get("password"))
    return getpass.getpass("Database password: ")


def connect_mysql(db, password, args):
    try:
        import pymysql
    except ImportError:
        raise RuntimeError("Missing dependency: pymysql")
    return pymysql.connect(
        host=db.get("host"),
        port=int(db.get("port") or 3306),
        user=db.get("username"),
        password=password,
        database=db.get("database"),
        charset=db.get("charset") or "utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=args.connect_timeout,
        read_timeout=args.read_timeout,
    )


def connect_postgres(db, password, args):
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError:
        raise RuntimeError("Missing dependency: psycopg2")
    return psycopg2.connect(
        host=db.get("host"),
        port=int(db.get("port") or 5432),
        user=db.get("username"),
        password=password,
        dbname=db.get("database"),
        connect_timeout=args.connect_timeout,
        cursor_factory=psycopg2.extras.RealDictCursor,
    )


def connect_oracle(db, password, args):
    try:
        import oracledb
    except ImportError:
        raise RuntimeError("Missing dependency: oracledb")
    host = db.get("host")
    port = int(db.get("port") or 1521)
    service_name = db.get("serviceName")
    sid = db.get("sid")
    if service_name:
        dsn = oracledb.makedsn(host, port, service_name=service_name)
    elif sid:
        dsn = oracledb.makedsn(host, port, sid=sid)
    else:
        dsn = db.get("dsn")
    return oracledb.connect(user=db.get("username"), password=password, dsn=dsn)


def rows_from_cursor(cursor):
    rows = cursor.fetchall()
    if rows is None:
        return []
    result = []
    for row in rows:
        if isinstance(row, dict):
            result.append(dict(row))
        else:
            columns = [desc[0] for desc in cursor.description]
            result.append(dict(zip(columns, row)))
    return result


def execute_query(db, sql, args, secrets):
    if db.get("accessLevel") == "readonly" and args.allow_write:
        raise ValueError("This resource is readonly; --allow-write is not permitted")
    db_type = normalize(db.get("type"))
    password = get_password(db, secrets)
    if db_type in ("mysql", "mariadb"):
        conn = connect_mysql(db, password, args)
    elif db_type in ("postgres", "postgresql", "pg", "opengauss"):
        conn = connect_postgres(db, password, args)
    elif db_type == "oracle":
        conn = connect_oracle(db, password, args)
    else:
        raise ValueError(f"Unsupported database type: {db.get('type')}")

    try:
        record_resource("connected", db, args)
        if db.get("accessLevel") == "readonly" and db_type in ("postgres", "postgresql", "pg", "opengauss"):
            conn.set_session(readonly=True)
        cursor = conn.cursor()
        try:
            if db.get("accessLevel") == "readonly" and db_type in ("mysql", "mariadb"):
                cursor.execute("SET TRANSACTION READ ONLY")
                conn.begin()
            if db.get("schema") and db_type in ("postgres", "postgresql", "pg", "opengauss"):
                cursor.execute("SELECT pg_catalog.set_config('search_path', %s, false)", ('"' + str(db['schema']).replace('"', '""') + '"',))
            cursor.execute(sql)
            if cursor.description:
                rows = rows_from_cursor(cursor)
                record_resource("completed", db, args)
                return rows, None
            if args.allow_write:
                conn.commit()
            record_resource("completed", db, args)
            return [], cursor.rowcount
        finally:
            cursor.close()
    finally:
        conn.close()


def redacted_selected(project, db):
    safe = {key: value for key, value in db.items() if key.lower() not in ("password", "url", "dsn")}
    return {"project": project.get("key"), "database": safe}


def record_resource(status, db, args):
    path = os.environ.get("SMARTDD_RESOURCE_AUDIT")
    if not path:
        return
    metadata = getattr(args, "projection_metadata", {})
    record = {"kind": "database", "skill": "project-db-diagnostics", "version": "1.0.0", "status": status, "at": int(time.time() * 1000)}
    record.update({key: metadata.get(key) for key in ("projectId", "configVersion", "configHash")})
    record.update({key: db.get(key) for key in ("resourceId", "host", "port", "database", "schema", "username")})
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a") as out:
        out.write(json.dumps(record, ensure_ascii=False) + "\\n")


def main():
    args = parse_args()
    if not args.config:
        raise ValueError("PROJECT_DB_CONFIG is missing. Start a WillYou task or supply --config explicitly.")
    config = load_config(args.config)
    args.projection_metadata = config
    secrets = {} if os.environ.get("PROJECT_DB_CONFIG") else load_secrets(args.secrets)
    if args.list:
        list_config(config)
        return

    project = select_project(config, args.project, args.cwd)
    db = select_database(project, args.db, args.target, args.type)
    if args.show_selected:
        print(json.dumps(redacted_selected(project, db), ensure_ascii=False, indent=2))
        if not args.sql:
            return

    sql = assert_safe_sql(args.sql, args.allow_write)
    record_resource("attempted", db, args)
    try:
        rows, affected_rows = execute_query(db, sql, args, secrets)
    except Exception:
        record_resource("failed", db, args)
        raise
    if affected_rows is not None:
        print(f"affected_rows={affected_rows}")
    elif args.format == "json":
        print_json(rows[:args.limit])
        if len(rows) > args.limit:
            sys.stderr.write(f"truncated: showing {args.limit} of {len(rows)} rows\\n")
    else:
        print_table(rows, args.limit)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        message = str(exc)
        for name, value in os.environ.items():
            if name.startswith("SMARTDD_DB_") and value:
                message = message.replace(value, "***")
        sys.stderr.write(f"db_query failed: {message}\\n")
        sys.exit(1)
`;
const __vite_glob_0_2 = '[\n  {\n    "skill": "project-db-diagnostics",\n    "upstreamFile": "project-db-diagnostics/scripts/db_query.py",\n    "sha256": "cebe52632dee2e0c7a891abc31fd664f8da3add2ed6de721fea3b6faf9c260cc",\n    "version": "1.0.0",\n    "source": "Existing local user Skill, adopted 2026-10-15"\n  },\n  {\n    "skill": "remote-password-ssh",\n    "upstreamFile": "remote-password-ssh/scripts/remote_ssh.py",\n    "sha256": "e42e71baaa2012015a02cecf44f9932c862cd59fa5031e129bddec221af4a3af",\n    "version": "1.0.0",\n    "source": "Existing local user Skill, adopted 2026-10-15"\n  }\n]\n';
const __vite_glob_0_3 = "---\nname: smartdd-remote-password-ssh\ndescription: 使用 WillYou 当前项目的服务器配置执行 SSH 排查、日志读取和明确授权的远程命令；支持密码与私钥认证。\nmetadata:\n  version: 1.0.0\n---\n\n# 项目服务器排查\n\n复用现有 remote-password-ssh 的目标匹配、sudo 和危险命令检查。`scripts/remote_ssh.py` 相对于本 SKILL.md 所在目录；用其绝对路径调用。\n\n1. `REMOTE_SERVERS_CONFIG` 指向当前项目配置。先运行 `python3 <skill目录>/scripts/remote_ssh.py --list` 核对目标，再以 `--target <准确别名/IP>` 选择。多个匹配必须请用户明确，不默认选第一台。\n2. 用 `--find` 只查看匹配结果。只读排查示例：`python3 <skill目录>/scripts/remote_ssh.py --target <别名> --no-root --command 'hostname; id'`。\n3. `--module app --show-log-path` 查看 Desktop 中登记的日志路径；需要同时指定 `--target` 以免多台服务器歧义。`--module app --tail 100` 读取配置的日志文件。\n4. `defaultRoot` 沿用项目配置；`--no-root` 取消本次提权，`--as-root` 请求 sudo。没有 sudo 凭据的配置不能自动提权。\n5. 原有危险命令拦截保留。仅在用户明确确认具体目标、命令及风险后，才能使用 `--allow-dangerous`。不得自动批准、绕开检查或扩大执行范围。\n\n密码、私钥口令、sudo 密码读取 `passwordEnv` / `passphraseEnv` / `sudoPasswordEnv`，旧配置的明文字段仍兼容。WillYou 不生成明文密码文件。不可把凭据写入 argv、日志、代码目录或回答，不寻找其他项目的资源配置。缺少注入时回 Desktop 修正并重新启动任务。\n\n依赖 Python 3 和系统 ssh。首次主机密钥采用 ssh 的 accept-new；已登记主机密钥发生变化时交由 ssh 拒绝。只读排查优先，生产操作必须明确授权。\n";
const __vite_glob_0_4 = `#!/usr/bin/env python3
import argparse
import json
import os
import pty
import re
import select
import shlex
import signal
import sys
import time
from pathlib import Path


DEFAULT_CONFIG = Path.home() / ".codex" / "remote-servers" / "servers.json"
PROJECT_CONFIG_RELATIVE_PATH = Path(".codex") / "remote-servers" / "servers.json"
PASSWORD_PROMPT = re.compile(rb"(?i)(password:|passphrase for key)")
SUDO_PROMPT = re.compile(rb"\\[sudo\\] password:")
HOSTKEY_PROMPT = re.compile(rb"(?i)are you sure you want to continue connecting")
ENVIRONMENT_ALIASES = {
    "dev": {"dev", "develop", "development", "test", "testing", "yanfa", "ceshi", "研发", "测试"},
    "prod": {"prod", "production", "shengchan", "生产"},
}
DANGEROUS_PATTERNS = [
    ("forced recursive delete", re.compile(r"\\brm\\s+[^;&|\\n]*-(?:[A-Za-z]*r[A-Za-z]*f|[A-Za-z]*f[A-Za-z]*r)\\b")),
    ("forced recursive delete", re.compile(r"\\brm\\s+[^;&|\\n]*-[A-Za-z]*r\\b[^;&|\\n]*-[A-Za-z]*f\\b")),
    ("forced recursive delete", re.compile(r"\\brm\\s+[^;&|\\n]*-[A-Za-z]*f\\b[^;&|\\n]*-[A-Za-z]*r\\b")),
    ("disk format", re.compile(r"\\bmkfs(?:\\.[A-Za-z0-9_+-]+)?\\b")),
    ("raw disk write", re.compile(r"\\bdd\\s+[^;&|\\n]*(?:\\bof=/dev/|\\bif=/dev/zero\\b|\\bif=/dev/random\\b)")),
    ("partition table change", re.compile(r"\\b(?:fdisk|parted|sfdisk)\\b")),
    ("filesystem wipe", re.compile(r"\\bwipefs\\b")),
    ("block discard", re.compile(r"\\bblkdiscard\\b")),
    ("shutdown or poweroff", re.compile(r"\\b(?:shutdown|poweroff|halt)\\b")),
    ("reboot", re.compile(r"\\breboot\\b")),
    ("firewall reset/flush", re.compile(r"\\b(?:iptables|ip6tables)\\b[^;&|\\n]*(?:\\s-F\\b|\\s-X\\b|--flush\\b)")),
    ("firewall reset", re.compile(r"\\bufw\\s+reset\\b")),
]


def find_git_root(start: Path):
    """Return the closest Git repository root containing *start*."""
    current = start.resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return None


def project_config_path():
    """Return the current repository's private server config when present."""
    git_root = find_git_root(Path.cwd())
    if not git_root:
        return None
    candidate = git_root / PROJECT_CONFIG_RELATIVE_PATH
    return candidate if candidate.exists() else None


def config_path() -> Path:
    configured_path = os.environ.get("REMOTE_SERVERS_CONFIG")
    if configured_path:
        return Path(configured_path).expanduser()

    return project_config_path() or DEFAULT_CONFIG


def load_servers(path: Path) -> list[dict]:
    if not path.exists():
        raise SystemExit(f"Config not found: {path}")

    try:
        with path.open("r", encoding="utf-8") as f:
            data = json.load(f)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"Invalid JSON in server config {path}: {exc.msg}")

    if isinstance(data, list):
        servers = data
    elif isinstance(data, dict) and isinstance(data.get("servers"), list):
        servers = data["servers"]
    else:
        raise SystemExit("Config must be a JSON array or an object with a 'servers' array.")

    for index, server in enumerate(servers, start=1):
        if isinstance(data, dict):
            server["_projection"] = {key: data.get(key) for key in ("projectId", "configVersion", "configHash")}
        missing = [key for key in ("ip", "port", "username") if key not in server]
        if server.get("authType") == "key":
            if not server.get("privateKeyPath"):
                missing.append("privateKeyPath")
        elif not server.get("passwordEnv") and "password" not in server:
            missing.append("passwordEnv/password")
        if missing:
            raise SystemExit(f"Server #{index} is missing required field(s): {', '.join(missing)}")

    return servers


def normalize(value: object) -> str:
    return re.sub(r"\\s+", "", str(value or "").lower())


def environment_tokens(environment: object) -> set[str]:
    normalized = normalize(environment)
    if not normalized:
        return set()
    tokens = {normalized}
    tokens.update(ENVIRONMENT_ALIASES.get(normalized, set()))
    return {normalize(token) for token in tokens}


def server_match_tokens(server: dict) -> set[str]:
    tokens = {normalize(server.get("ip")), normalize(server.get("alias"))}
    aliases = server.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    tokens.update(normalize(alias) for alias in aliases)
    tokens.update(environment_tokens(server.get("environment")))
    return {token for token in tokens if token}


def public_server(server: dict) -> str:
    alias = f" alias={server.get('alias')}" if server.get("alias") else ""
    aliases = server.get("aliases") or []
    aliases_text = f" aliases={','.join(map(str, aliases))}" if aliases else ""
    env = f" env={server.get('environment')}" if server.get("environment") else ""
    root = " defaultRoot=true" if server.get("defaultRoot") else ""
    note = f" note={server.get('note')}" if server.get("note") else ""
    return f"{server['username']}@{server['ip']}:{server['port']}{alias}{aliases_text}{env}{root}{note}"


def find_servers(servers: list[dict], target: str) -> list[dict]:
    raw_target = target.strip()
    normalized_target = normalize(raw_target)
    if not normalized_target:
        return []

    matches = []
    for server in servers:
        ip = str(server.get("ip", ""))
        tokens = server_match_tokens(server)
        if raw_target in ip or normalized_target in normalize(ip) or normalized_target in tokens:
            matches.append(server)
            continue
        if any(normalized_target == token or normalized_target in token for token in tokens):
            matches.append(server)
    return matches


def module_match_tokens(module_id: str, module: dict) -> set[str]:
    tokens = {normalize(module_id), normalize(module.get("applicationName"))}
    aliases = module.get("aliases") or []
    if isinstance(aliases, str):
        aliases = [aliases]
    tokens.update(normalize(alias) for alias in aliases)
    return {token for token in tokens if token}


def find_modules(servers: list[dict], target: str) -> list[tuple[dict, str, str, dict]]:
    raw_target = target.strip()
    normalized_target = normalize(raw_target)
    if not normalized_target:
        return []

    matches = []
    for server in servers:
        deployments = server.get("deployments") or {}
        if not isinstance(deployments, dict):
            continue
        for deployment_name, deployment in deployments.items():
            if not isinstance(deployment, dict):
                continue
            modules = deployment.get("modules") or {}
            if not isinstance(modules, dict):
                continue
            for module_id, module in modules.items():
                if not isinstance(module, dict):
                    continue
                tokens = module_match_tokens(str(module_id), module)
                if normalized_target in tokens or any(normalized_target in token for token in tokens):
                    matches.append((server, str(deployment_name), str(module_id), module))
    return matches


def module_log_path(module_id: str, module: dict, log_name: str) -> str:
    logs = module.get("logs") or {}
    if not isinstance(logs, dict):
        raise SystemExit(f"Module '{module_id}' has no log configuration.")
    path = logs.get(log_name)
    if not isinstance(path, str) or not path.strip():
        raise SystemExit(f"Module '{module_id}' has no '{log_name}' log path.")
    return path.strip()


def print_module_match(match: tuple[dict, str, str, dict]) -> None:
    server, deployment_name, module_id, module = match
    application_name = module.get("applicationName") or ""
    print(f"{public_server(server)} deployment={deployment_name} module={module_id} application={application_name}")


def positive_int(value: str) -> int:
    parsed = int(value)
    if parsed <= 0:
        raise argparse.ArgumentTypeError("must be a positive integer")
    return parsed


def print_servers(servers: list[dict]) -> None:
    if not servers:
        print("No servers configured.")
        return
    for index, server in enumerate(servers, start=1):
        print(f"{index}. {public_server(server)}")


def dangerous_matches(command: str) -> list[str]:
    matches = []
    for label, pattern in DANGEROUS_PATTERNS:
        if pattern.search(command):
            matches.append(label)
    return sorted(set(matches))


def should_use_root(server: dict, as_root: bool, no_root: bool) -> bool:
    if no_root:
        return False
    use_root = as_root or bool(server.get("defaultRoot"))
    if use_root and server.get("sudoPolicy") == "none":
        raise SystemExit("sudo is disabled for this server")
    return use_root


def secret_value(server: dict, field: str, optional: bool = False) -> str:
    env_name = server.get(field + "Env")
    if env_name:
        if env_name not in os.environ:
            raise SystemExit(f"Missing credential variable: {env_name}")
        return os.environ[env_name]
    value = server.get(field)
    if value is None and not optional:
        raise SystemExit(f"Missing credential: {field}")
    return str(value or "")


def sudo_password(server: dict) -> str:
    if server.get("sudoPasswordEnv"):
        return secret_value(server, "sudoPassword")
    value = server.get("sudoPassword")
    if value in (None, "", "same-as-login"):
        return secret_value(server, "password", optional=True)
    return str(value)


def command_for_execution(server: dict, command: str, use_root: bool) -> str:
    if not use_root:
        return command
    quoted_command = shlex.quote(command)
    return f"sudo -S -p '[sudo] password: ' -i -- sh -lc {quoted_command}"


def run_ssh(server: dict, command: str, use_root: bool = False) -> int:
    destination = f"{server['username']}@{server['ip']}"
    ssh_cmd = [
        "ssh",
        "-tt",
        "-o",
        "StrictHostKeyChecking=accept-new",
        "-o",
        "ConnectTimeout=10",
        "-p",
        str(server["port"]),
        destination,
        command_for_execution(server, command, use_root),
    ]

    if server.get("authType") == "key":
        ssh_cmd[1:1] = ["-i", str(Path(server["privateKeyPath"]).expanduser()), "-o", "IdentitiesOnly=yes", "-o", "PreferredAuthentications=publickey"]
    else:
        ssh_cmd[1:1] = ["-o", "PreferredAuthentications=password,keyboard-interactive", "-o", "PubkeyAuthentication=no"]

    # Resolve before forking: a missing injection must not start SSH and wait for a password.
    login_password = secret_value(server, "password", optional=server.get("authType") == "key").encode("utf-8") + b"\\n"
    key_passphrase = secret_value(server, "passphrase", optional=True).encode("utf-8") + b"\\n"
    root_password = (sudo_password(server) if use_root else "").encode("utf-8") + b"\\n"

    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("ssh", ssh_cmd)

    login_password_sent = 0
    sudo_password_sent = 0

    try:
        while True:
            ready, _, _ = select.select([fd], [], [], 0.2)
            if fd in ready:
                try:
                    chunk = os.read(fd, 4096)
                except OSError:
                    break
                if not chunk:
                    break

                os.write(sys.stdout.fileno(), chunk)

                if HOSTKEY_PROMPT.search(chunk):
                    os.write(fd, b"yes\\n")
                elif SUDO_PROMPT.search(chunk) and sudo_password_sent < 3:
                    os.write(fd, root_password)
                    sudo_password_sent += 1
                elif PASSWORD_PROMPT.search(chunk) and login_password_sent < 3:
                    os.write(fd, key_passphrase if b"passphrase for key" in chunk.lower() else login_password)
                    login_password_sent += 1

            try:
                finished_pid, status = os.waitpid(pid, os.WNOHANG)
            except ChildProcessError:
                return 0
            if finished_pid == pid:
                if os.WIFEXITED(status):
                    return os.WEXITSTATUS(status)
                if os.WIFSIGNALED(status):
                    return 128 + os.WTERMSIG(status)
                return 1
    except KeyboardInterrupt:
        os.kill(pid, signal.SIGTERM)
        raise

    _, status = os.waitpid(pid, 0)
    if os.WIFEXITED(status):
        return os.WEXITSTATUS(status)
    if os.WIFSIGNALED(status):
        return 128 + os.WTERMSIG(status)
    return 1


def record_resource(status: str, server: dict, code=None) -> None:
    path = os.environ.get("SMARTDD_RESOURCE_AUDIT")
    if not path:
        return
    record = {"kind": "ssh", "skill": "remote-password-ssh", "version": "1.0.0", "status": status, "at": int(time.time() * 1000), "exitCode": code}
    record.update(server.get("_projection", {}))
    record.update({key: server.get(key) for key in ("resourceId", "port", "username")})
    record["host"] = server.get("ip")
    fd = os.open(path, os.O_WRONLY | os.O_APPEND | os.O_CREAT | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "a") as out:
        out.write(json.dumps(record, ensure_ascii=False) + "\\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run SSH commands against configured password-based servers.")
    parser.add_argument("--config", type=Path, default=os.environ.get("REMOTE_SERVERS_CONFIG"), help="Path to servers.json")
    parser.add_argument("--target", help="Full IP, partial IP, environment name, or alias")
    parser.add_argument("--module", help="Configured deployment module ID, application name, or alias")
    parser.add_argument("--log", help="Configured module log name (default: primary; requires --module)")
    parser.add_argument("--command", help="Remote shell command to run")
    parser.add_argument("--list", action="store_true", help="List configured servers")
    parser.add_argument("--find", action="store_true", help="Find matching servers without running a command")
    log_action = parser.add_mutually_exclusive_group()
    log_action.add_argument("--show-log-path", action="store_true", help="Print the configured module log path")
    log_action.add_argument("--tail", type=positive_int, metavar="LINES", help="Print the last LINES from a configured module log")
    log_action.add_argument("--follow", action="store_true", help="Follow a configured module log")
    parser.add_argument("--as-root", action="store_true", help="Run the remote command through sudo -i")
    parser.add_argument("--no-root", action="store_true", help="Disable a server's defaultRoot behavior for this command")
    parser.add_argument(
        "--allow-dangerous",
        action="store_true",
        help="Allow commands that match the built-in dangerous command blacklist after explicit user confirmation.",
    )
    args = parser.parse_args()

    if not args.config:
        parser.error("REMOTE_SERVERS_CONFIG is missing. Start a WillYou task or supply --config explicitly.")

    servers = load_servers(args.config.expanduser())

    if args.list:
        print_servers(servers)
        return 0

    if args.log and not args.module:
        parser.error("--log requires --module")
    if (args.show_log_path or args.tail or args.follow) and not args.module:
        parser.error("log actions require --module")
    if not args.target and not args.module:
        parser.error("--target or --module is required unless --list is used")

    server_matches = find_servers(servers, args.target) if args.target else servers
    if args.target and not server_matches:
        print(f"No configured server matched target: {args.target}", file=sys.stderr)
        return 2
    if args.target and len(server_matches) > 1:
        print(f"Multiple servers matched target: {args.target}", file=sys.stderr)
        print_servers(server_matches)
        return 3

    module_match = None
    if args.module:
        module_matches = find_modules(server_matches, args.module)
        if not module_matches:
            print(f"No configured module matched: {args.module}", file=sys.stderr)
            return 2
        if len(module_matches) > 1:
            print(f"Multiple modules matched: {args.module}", file=sys.stderr)
            for match in module_matches:
                print_module_match(match)
            return 3
        module_match = module_matches[0]
        server = module_match[0]
    else:
        server = server_matches[0]

    if args.find:
        if module_match:
            print_module_match(module_match)
        else:
            print_servers([server])
        return 0

    if module_match and (args.show_log_path or args.tail or args.follow):
        _, _, module_id, module = module_match
        log_path = module_log_path(module_id, module, args.log or "primary")
        if args.show_log_path:
            print(log_path)
            return 0
        if args.tail:
            command = f"tail -n {args.tail} -- {shlex.quote(log_path)}"
        else:
            command = f"tail -f -- {shlex.quote(log_path)}"
    elif args.command:
        command = args.command
    else:
        parser.error("--command is required unless --list, --find, or a log action is used")

    risks = dangerous_matches(command)
    if risks and not args.allow_dangerous:
        print("Blocked dangerous command. Matched risk(s): " + ", ".join(risks), file=sys.stderr)
        print("Re-run with --allow-dangerous only after explicit user confirmation.", file=sys.stderr)
        return 4

    use_root = should_use_root(server, args.as_root, args.no_root)
    record_resource("attempted", server)
    try:
        code = run_ssh(server, command, use_root=use_root)
    except BaseException:
        record_resource("failed", server)
        raise
    if code == 0:
        # OpenSSH exit 0 proves authentication and execution succeeded; recorded after completion.
        record_resource("connected", server, code)
    record_resource("completed" if code == 0 else "failed", server, code)
    return code


if __name__ == "__main__":
    raise SystemExit(main())
`;
const __vite_glob_1_0 = `#!/usr/bin/env python3
"""Small read-only stdio MCP: exposes only the generated public project context."""
import json
import sys
from pathlib import Path

TOOL = {"name": "project_context", "description": "Read the current WillYou project's resource identities, configuration version and skill paths. Contains no credential values.", "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}}


def handle(request, context):
    method = request.get("method")
    if method == "initialize":
        return {"protocolVersion": request.get("params", {}).get("protocolVersion", "2024-11-05"), "capabilities": {"tools": {}}, "serverInfo": {"name": "smartdd-project", "version": "1.0.0"}}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": [TOOL]}
    if method == "tools/call" and request.get("params", {}).get("name") == TOOL["name"]:
        return {"content": [{"type": "text", "text": json.dumps(context, ensure_ascii=False)}]}
    return None


def main():
    # The file is a separate allowlisted projection, not the credential reference configs.
    context = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    for line in sys.stdin:
        try:
            request = json.loads(line)
            if "id" not in request:
                continue
            result = handle(request, context)
            response = {"jsonrpc": "2.0", "id": request["id"]}
            if result is None:
                response["error"] = {"code": -32601, "message": "Method not found"}
            else:
                response["result"] = result
            print(json.dumps(response, ensure_ascii=False), flush=True)
        except Exception:
            print(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Invalid request"}}), flush=True)


if __name__ == "__main__":
    main()
`;
const __vite_glob_1_1 = '#!/usr/bin/env python3\n"""Runs inside the actual terminal, after shell rc/env setup, before exec of the CLI."""\nimport hashlib\nimport importlib\nimport json\nimport os\nfrom pathlib import Path\nimport shutil\nimport sys\nimport time\n\n\ndef check(manifest):\n    issues = []\n    for filename, expected in manifest["files"].items():\n        try:\n            if hashlib.sha256(Path(filename).read_bytes()).hexdigest() != expected:\n                issues.append("file_hash_mismatch")\n        except OSError:\n            issues.append("file_unreadable")\n    for name in manifest["requiredEnv"]:\n        if name not in os.environ:\n            issues.append("missing_env:" + name)\n    for name, path in manifest["pathEnv"].items():\n        if os.environ.get(name) != path:\n            issues.append("wrong_path_env:" + name)\n    for name in manifest["pythonModules"]:\n        try:\n            importlib.import_module(name)\n        except Exception:\n            issues.append("missing_dependency:" + name)\n    for name in manifest["commands"]:\n        if not shutil.which(name):\n            issues.append("missing_command:" + name)\n    for filename in manifest["readablePaths"]:\n        if not Path(filename).is_file() or not os.access(filename, os.R_OK):\n            issues.append("resource_path_unreadable")\n    return sorted(set(issues))\n\n\ndef main():\n    manifest_path, expected_hash, *command = sys.argv[1:]\n    report = Path(manifest_path).parent / "self-check.json"\n    issues = []\n    try:\n        content = Path(manifest_path).read_bytes()\n        if hashlib.sha256(content).hexdigest() != expected_hash:\n            issues = ["manifest_hash_mismatch"]\n        else:\n            issues = check(json.loads(content))\n    except Exception:\n        # No parser/driver exception text: it can contain credentials or file content.\n        issues = ["manifest_invalid"]\n    if not command or not shutil.which(command[0]):\n        issues.append("runner_not_found")\n    result = {"status": "failed" if issues else "passed", "issues": issues, "at": int(time.time() * 1000)}\n    try:\n        temporary = report.with_suffix(".tmp")\n        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)\n        with os.fdopen(fd, "w") as out:\n            json.dump(result, out)\n        os.replace(temporary, report)\n    except OSError:\n        issues.append("self_check_report_failed")\n    if issues:\n        print("WillYou injection self-check failed: " + ", ".join(issues), file=sys.stderr)\n        return 78\n    os.execvpe(command[0], command, os.environ)\n\n\nif __name__ == "__main__":\n    sys.exit(main())\n';
const sources = /* @__PURE__ */ Object.assign({ "/resources/standard-skills/project-db-diagnostics/SKILL.md": __vite_glob_0_0, "/resources/standard-skills/project-db-diagnostics/scripts/db_query.py": __vite_glob_0_1, "/resources/standard-skills/provenance.json": __vite_glob_0_2, "/resources/standard-skills/remote-password-ssh/SKILL.md": __vite_glob_0_3, "/resources/standard-skills/remote-password-ssh/scripts/remote_ssh.py": __vite_glob_0_4 });
const runtime = /* @__PURE__ */ Object.assign({ "/resources/runtime/context_mcp.py": __vite_glob_1_0, "/resources/runtime/launch.py": __vite_glob_1_1 });
const sha256 = (content) => node_crypto.createHash("sha256").update(content).digest("hex");
const treeHash = (files) => sha256(JSON.stringify(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))));
const BUNDLED_SKILLS = [
  { id: "project-db-diagnostics", description: "项目数据库只读诊断", name: "smartdd-project-db-diagnostics" },
  { id: "remote-password-ssh", description: "项目 SSH 排查与日志读取", name: "smartdd-remote-password-ssh" }
].map((item) => {
  const prefix = `/standard-skills/${item.id}/`;
  const files = Object.fromEntries(Object.entries(sources).filter(([path2]) => path2.includes(prefix)).map(([path2, content]) => [path2.split(prefix)[1], content]));
  if (!files["SKILL.md"]) throw new Error(`内置 Skill 资产缺失：${item.id}`);
  return { ...item, source: `${item.id} → WillYou`, version: "1.0.0", hash: treeHash(files), files };
});
const runtimeFiles = () => Object.fromEntries(Object.entries(runtime).map(([path2, content]) => [path2.split("/").at(-1), content]));
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const object = (v) => isObject(v) ? v : {};
const strings = (v) => Array.isArray(v) ? v.filter((s) => typeof s === "string") : [];
const LIMIT = 1024 * 1024;
function textFile(path2) {
  if (node_fs.statSync(path2).size > LIMIT) throw new Error("too_large");
  return node_fs.readFileSync(path2, "utf8");
}
function executable(command, cwd, path2) {
  const candidates = node_path.isAbsolute(command) ? [command] : command.includes("/") ? [node_path.resolve(cwd, command)] : path2.split(node_path.delimiter).filter(Boolean).map((p) => node_path.join(p, command));
  return candidates.some((p) => {
    try {
      node_fs.accessSync(p, node_fs.constants.X_OK);
      return node_fs.statSync(p).isFile();
    } catch {
      return false;
    }
  });
}
function projectLayers(cwd, home) {
  const layers = [];
  for (let p = node_path.resolve(cwd); p !== node_path.dirname(p); p = node_path.dirname(p)) {
    if (p === home) break;
    layers.push(p);
    if (node_fs.existsSync(node_path.join(p, ".git")) || node_fs.existsSync(node_path.join(p, ".svn"))) break;
  }
  return layers.reverse();
}
function codexConfigurationArgs(args, issue) {
  let profile = null, profileSeen = false;
  const overrides = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--") {
      issue();
      break;
    }
    let selected, assignment;
    if (arg === "--profile" || arg === "-p") selected = args[++i] ?? "";
    else if (arg.startsWith("--profile=")) selected = arg.slice("--profile=".length);
    else if (/^-p.+/.test(arg)) {
      issue();
      continue;
    } else if (arg === "--config" || arg === "-c") assignment = args[++i] ?? "";
    else if (arg.startsWith("--config=")) assignment = arg.slice("--config=".length);
    else if (arg.startsWith("-c") && arg.length > 2) assignment = arg.slice(2).replace(/^=/, "");
    if (selected !== void 0) {
      if (profileSeen || !/^[A-Za-z0-9_-]+$/.test(selected)) {
        issue();
        profile = null;
      } else profile = selected;
      profileSeen = true;
    }
    if (assignment !== void 0) {
      const equal = assignment.indexOf("=");
      if (equal <= 0) {
        issue();
        continue;
      }
      const key = assignment.slice(0, equal), value = assignment.slice(equal + 1);
      try {
        let validToml = false;
        try {
          const parsed2 = smolToml.parse("__value__=" + value);
          validToml = Object.keys(parsed2).length === 1 && Object.hasOwn(parsed2, "__value__");
        } catch {
        }
        const parsed = smolToml.parse(key + "=" + (validToml ? value : JSON.stringify(value)));
        overrides.push(object(parsed));
      } catch {
        issue();
      }
    }
  }
  return { profile, overrides };
}
function discoverCapabilities(c) {
  var _a, _b, _c, _d, _e, _f;
  const rows = [];
  const seen = /* @__PURE__ */ new Set();
  const layers = projectLayers(c.cwd, c.home);
  const row = (kind, name2, path2, source2) => ({
    id: `${c.runner}:${kind}:${path2}:${name2}`,
    kind,
    name: name2.slice(0, 120),
    runner: c.runner,
    path: path2,
    source: source2,
    version: null,
    enabled: null,
    validity: "partial",
    issues: [],
    loaded: "unverified",
    envNames: []
  });
  const badFile = (kind, path2, source2, issue) => {
    var _a2;
    const r = row(kind, kind === "mcp" ? "MCP config" : "Skill", path2, source2);
    r.validity = "invalid";
    r.issues = [issue];
    rows.push(r);
    (_a2 = c.details) == null ? void 0 : _a2.issues.push(issue);
  };
  const scanSkill = (file, source2, command = false, enabled = null, version2 = null) => {
    if (rows.length >= 2e3) return;
    let canonical;
    try {
      canonical = node_fs.realpathSync(file);
    } catch {
      badFile("skill", file, source2, "path_unreadable");
      return;
    }
    if (seen.has(canonical)) return;
    seen.add(canonical);
    const r = row("skill", node_path.dirname(file).split("/").at(-1) ?? "Skill", file, source2);
    r.enabled = enabled;
    r.version = version2;
    try {
      const content = textFile(file);
      const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
      const meta = front ? object(yaml.parse(front[1], { maxAliasCount: 25, logLevel: "silent" })) : {};
      if (typeof meta.name === "string" && /^[\w.-]{1,100}$/.test(meta.name)) r.name = meta.name;
      if (!command && (typeof meta.name !== "string" || typeof meta.description !== "string" || !meta.description.trim())) r.issues.push("skill_metadata_missing");
      const v = object(meta.metadata).version ?? meta.version;
      if (typeof v === "string" || typeof v === "number") r.version = String(v).slice(0, 40);
      r.validity = r.issues.length ? "invalid" : node_fs.existsSync(node_path.join(node_path.dirname(file), "scripts")) ? "partial" : "valid";
      if (r.validity === "partial") r.issues.push("runtime_dependencies_unverified");
    } catch {
      r.validity = "invalid";
      r.issues.push("skill_parse_failed");
    }
    rows.push(r);
  };
  const scanDir = (dir, source2, command = false, enabled = null, version2 = null, depth = 0, visited = /* @__PURE__ */ new Set()) => {
    if (!node_fs.existsSync(dir) || depth > 5 || rows.length >= 2e3) return;
    try {
      const canonical = node_fs.realpathSync(dir);
      if (visited.has(canonical)) return;
      visited.add(canonical);
      const skill = node_path.join(dir, "SKILL.md");
      if (!command && node_fs.existsSync(skill)) {
        scanSkill(skill, source2, false, enabled, version2);
        return;
      }
      for (const name2 of node_fs.readdirSync(dir).sort()) {
        if (name2.startsWith(".") || ["node_modules", "validation", "productions", "__pycache__"].includes(name2)) continue;
        const p = node_path.join(dir, name2);
        if (node_fs.statSync(p).isDirectory()) scanDir(p, source2, command, enabled, version2, depth + 1, visited);
        else if (command && name2.endsWith(".md")) scanSkill(p, source2, true, enabled, version2);
      }
    } catch {
      badFile("skill", dir, source2, "path_unreadable");
    }
  };
  const readConfig = (path2) => {
    if (!node_fs.existsSync(path2)) return null;
    try {
      const config = path2.endsWith(".toml") ? smolToml.parse(textFile(path2)) : JSON.parse(textFile(path2));
      if (!isObject(config)) {
        badFile("mcp", path2, "configuration", "config_shape_invalid");
        return null;
      }
      return config;
    } catch {
      badFile("mcp", path2, "configuration", "config_parse_failed");
      return null;
    }
  };
  const plugin = (root) => {
    var _a2, _b2;
    const manifest = readConfig(node_path.join(root, ".claude-plugin", "plugin.json"));
    if (typeof (manifest == null ? void 0 : manifest.name) !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(manifest.name)) {
      (_a2 = c.details) == null ? void 0 : _a2.issues.push("plugin_namespace_unverified");
      return;
    }
    (_b2 = c.details) == null ? void 0 : _b2.plugins.push({ name: manifest.name, path: root });
  };
  const addMcp = (servers, path2, source2, enabled = null) => {
    if (servers === void 0) return;
    if (!isObject(servers)) {
      badFile("mcp", path2, source2, "config_shape_invalid");
      return;
    }
    for (const [name2, raw] of Object.entries(servers)) {
      if (rows.length >= 2e3) break;
      const r = row("mcp", name2, path2, source2);
      const s = object(raw);
      r.enabled = typeof s.enabled === "boolean" ? s.enabled : enabled;
      r.envNames = [...Object.keys(object(s.env)), ...strings(s.env_vars), ...typeof s.bearer_token_env_var === "string" ? [s.bearer_token_env_var] : []].filter((n) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(n));
      let invalid = false;
      if (s.url !== void 0) {
        try {
          if (typeof s.url !== "string" || !["http:", "https:"].includes(new URL(s.url).protocol)) throw new Error();
          r.issues.push("network_auth_unverified");
        } catch {
          invalid = true;
          r.issues.push("mcp_url_invalid");
        }
      } else if (typeof s.command !== "string" || !s.command.trim()) {
        invalid = true;
        r.issues.push("mcp_command_missing");
      } else {
        if (!executable(s.command, c.cwd, c.path)) r.issues.push("command_path_unverified");
        r.issues.push("runtime_dependencies_unverified");
      }
      if (s.args !== void 0 && (!Array.isArray(s.args) || s.args.some((v) => typeof v !== "string"))) {
        invalid = true;
        r.issues.push("mcp_args_invalid");
      }
      if (s.env !== void 0 && (!s.env || Array.isArray(s.env) || typeof s.env !== "object" || Object.values(object(s.env)).some((v) => typeof v !== "string"))) {
        invalid = true;
        r.issues.push("mcp_env_invalid");
      }
      if (source2.includes("project")) r.issues.push("project_trust_unverified");
      r.validity = invalid ? "invalid" : "partial";
      rows.push(r);
    }
  };
  if (c.runner === "claude") {
    scanDir(node_path.join(c.stateRoot, "skills"), "user");
    scanDir(node_path.join(c.stateRoot, "commands"), "user commands", true);
    const settings = [];
    const globalSettings = readConfig(node_path.join(c.stateRoot, "settings.json"));
    if (globalSettings) settings.push(globalSettings);
    for (const p of layers) {
      scanDir(node_path.join(p, ".claude", "skills"), "project");
      scanDir(node_path.join(p, ".claude", "commands"), "project commands", true);
      for (const file2 of ["settings.json", "settings.local.json"]) {
        const config3 = readConfig(node_path.join(p, ".claude", file2));
        if (config3) settings.push(config3);
      }
      const file = node_path.join(p, ".mcp.json");
      const config2 = readConfig(file);
      if (config2) addMcp(config2.mcpServers, file, "project");
    }
    const explicitRoot = c.claudeConfigExplicit ?? c.stateRoot !== node_path.join(c.home, ".claude");
    const mainConfigPath = explicitRoot ? node_path.join(c.stateRoot, ".claude.json") : node_path.join(c.home, ".claude.json");
    const config = readConfig(mainConfigPath);
    if (config) {
      addMcp(config.mcpServers, mainConfigPath, "user");
      let canonicalCwd = c.cwd;
      try {
        canonicalCwd = node_fs.realpathSync(c.cwd);
      } catch {
      }
      const projectConfig = object(config.projects)[canonicalCwd] ?? object(config.projects)[c.cwd];
      addMcp(object(projectConfig).mcpServers, mainConfigPath, "project local");
    }
    const enabledPlugins = Object.assign({}, ...settings.map((s) => object(s.enabledPlugins)));
    const installed = readConfig(node_path.join(c.stateRoot, "plugins", "installed_plugins.json"));
    for (const [name2, entries] of Object.entries(object(installed == null ? void 0 : installed.plugins))) {
      for (const entry of Array.isArray(entries) ? entries : [entries]) {
        const p = object(entry);
        if (typeof p.installPath !== "string" || typeof p.projectPath === "string" && !layers.includes(p.projectPath)) continue;
        plugin(p.installPath);
        const enabled = typeof enabledPlugins[name2] === "boolean" ? enabledPlugins[name2] : null;
        const version2 = typeof p.version === "string" ? p.version : null;
        scanDir(node_path.join(p.installPath, "skills"), `plugin:${name2}`, false, enabled, version2);
        scanDir(node_path.join(p.installPath, "commands"), `plugin:${name2}`, true, enabled, version2);
        const mcpPath = node_path.join(p.installPath, ".mcp.json");
        const mcp = readConfig(mcpPath);
        if (mcp) addMcp(mcp.mcpServers ?? mcp, mcpPath, `plugin:${name2}`, enabled);
      }
    }
    for (const s of settings) for (const name2 of strings(s.disabledMcpServers)) for (const r of rows) if (r.kind === "mcp" && r.name === name2) r.enabled = false;
    const args = c.args ?? [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--plugin-dir" && args[i + 1]) {
        const root = node_path.resolve(c.cwd, args[++i]);
        plugin(root);
        scanDir(node_path.join(root, "skills"), "profile plugin", false, true);
      } else if (/^--(?:settings|setting-sources|settings-sources|plugin-dir|mcp-config)=|^--(?:settings|setting-sources|settings-sources)$/.test(args[i])) (_a = c.details) == null ? void 0 : _a.issues.push("profile_configuration_unverified");
      else if (args[i] === "--mcp-config" && args[i + 1]) {
        const value = args[++i];
        if (value.trim().startsWith("{")) {
          try {
            addMcp(object(JSON.parse(value)).mcpServers, "profile arguments", "profile");
          } catch {
            badFile("mcp", "profile arguments", "profile", "config_parse_failed");
          }
        } else {
          const file = node_path.resolve(c.cwd, value);
          const cfg = readConfig(file);
          if (cfg) addMcp(cfg.mcpServers, file, "profile");
          else if (!node_fs.existsSync(file)) badFile("mcp", file, "profile", "path_unreadable");
        }
      }
    }
  } else {
    scanDir(node_path.join(c.home, ".agents", "skills"), "user");
    scanDir(node_path.join(c.stateRoot, "skills"), "user compatibility");
    scanDir("/etc/codex/skills", "system");
    const args = codexConfigurationArgs(c.args ?? [], () => {
      var _a2;
      return (_a2 = c.details) == null ? void 0 : _a2.issues.push("profile_configuration_unverified");
    });
    const configs = [{ path: node_path.join(c.stateRoot, "config.toml"), source: "user" }];
    if (args.profile !== null) {
      if (c.nativeVersion !== "0.162.1") (_b = c.details) == null ? void 0 : _b.issues.push("profile_configuration_unverified");
      else {
        const path2 = node_path.join(c.stateRoot, args.profile + ".config.toml");
        if (!node_fs.existsSync(path2)) (_c = c.details) == null ? void 0 : _c.issues.push("profile_configuration_unverified");
        else configs.push({ path: path2, source: "profile" });
      }
    }
    configs.push(...layers.map((p) => ({ path: node_path.join(p, ".codex", "config.toml"), source: "project" })));
    for (const p of layers) scanDir(node_path.join(p, ".agents", "skills"), "project");
    const overrides = [];
    for (const file of configs) {
      const config = readConfig(file.path);
      if (!config) continue;
      if (config.profile !== void 0) (_d = c.details) == null ? void 0 : _d.issues.push("profile_configuration_unverified");
      addMcp(config.mcp_servers, file.path, file.source);
      overrides.push({ config, base: node_path.dirname(file.path), configurationPath: file.path, location: "file" });
    }
    for (const config of args.overrides) {
      addMcp(config.mcp_servers, "profile arguments", "profile");
      overrides.push({ config, base: c.cwd, configurationPath: null, location: "profile-arguments" });
    }
    let finalFlags = [];
    const effective = /* @__PURE__ */ new Map(), sources2 = /* @__PURE__ */ new Map();
    for (const { config, base, configurationPath, location } of overrides) {
      if (config.skills !== void 0 && !isObject(config.skills)) (_e = c.details) == null ? void 0 : _e.issues.push("skill_configuration_unverified");
      const flags = object(config.skills).config;
      if (flags !== void 0) {
        if (!Array.isArray(flags) || flags.some((v) => !isObject(v) || typeof v.path !== "string" || typeof v.enabled !== "boolean")) (_f = c.details) == null ? void 0 : _f.issues.push("skill_configuration_unverified");
        else {
          finalFlags = structuredClone(flags);
          for (const raw of finalFlags) {
            const absolute2 = node_path.resolve(base, raw.path);
            let path2 = absolute2;
            try {
              path2 = node_fs.realpathSync(path2);
              if (node_fs.statSync(path2).isDirectory() && node_fs.existsSync(node_path.join(path2, "SKILL.md"))) path2 = node_fs.realpathSync(node_path.join(path2, "SKILL.md"));
            } catch {
            }
            effective.set(path2, { ...raw, path: absolute2 });
            sources2.set(path2, { path: absolute2, configurationPath, location });
          }
        }
      }
    }
    if (c.details) {
      c.details.userSkillConfig = finalFlags;
      c.details.effectiveSkillConfig = [...effective.values()];
      c.details.skillConfigSources = [...sources2.values()];
    }
    for (const [canonical, o] of effective) {
      for (const r of rows) if (r.kind === "skill") {
        try {
          if ([node_fs.realpathSync(r.path), node_fs.realpathSync(node_path.dirname(r.path))].includes(canonical)) r.enabled = o.enabled;
        } catch {
        }
      }
    }
  }
  return rows.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
const OWNER = ".smartdd-owned.json";
function listFiles(root, dir = root) {
  return node_fs.readdirSync(dir).flatMap((name2) => {
    const path2 = node_path.join(dir, name2);
    const stat = node_fs.lstatSync(path2);
    if (stat.isSymbolicLink()) throw new Error("投影中发现符号链接，拒绝覆盖");
    return stat.isDirectory() ? listFiles(root, path2) : [node_path.relative(root, path2)];
  });
}
function writeOwnedTree(root, files, backupRoot) {
  const owner = JSON.stringify({ owner: "SmartDD", schema: 1 });
  const expected = { ...files, [OWNER]: owner };
  for (const name2 of Object.keys(expected)) {
    if (name2.startsWith("/") || name2.split("/").includes("..")) throw new Error("无效的包文件路径");
  }
  if (node_fs.existsSync(root)) {
    if (node_fs.lstatSync(root).isSymbolicLink() || !node_fs.lstatSync(root).isDirectory()) throw new Error(`Skill 目标已存在且不属于 WillYou：${root}`);
    try {
      if (node_fs.lstatSync(node_path.join(root, OWNER)).isSymbolicLink() || node_fs.readFileSync(node_path.join(root, OWNER), "utf8") !== owner) throw new Error();
    } catch {
      throw new Error(`Skill 目标已有用户内容，保留原样：${root}`);
    }
    const names = [.../* @__PURE__ */ new Set([...listFiles(root), ...Object.keys(expected)])].sort();
    const changes = names.filter((name2) => !node_fs.existsSync(node_path.join(root, name2)) || !(name2 in expected) || node_fs.readFileSync(node_path.join(root, name2), "utf8") !== expected[name2]);
    if (!changes.length) return;
    const backup = node_path.join(backupRoot, node_crypto.randomUUID());
    node_fs.mkdirSync(backup, { recursive: true, mode: 448 });
    const diff = changes.map((name2) => {
      const path2 = node_path.join(root, name2);
      if (node_fs.existsSync(path2)) {
        const target = node_path.join(backup, name2);
        node_fs.mkdirSync(node_path.dirname(target), { recursive: true, mode: 448 });
        node_fs.copyFileSync(path2, target);
      }
      return `${name2}: ${node_fs.existsSync(path2) ? sha256(node_fs.readFileSync(path2)).slice(0, 12) : "missing"} → ${name2 in expected ? sha256(expected[name2]).slice(0, 12) : "unexpected"}`;
    });
    throw new Error(`投影内容已改变，停止启动，保留原文件。差异：${diff.join("；")}。备份：${backup}`);
  }
  const staging = `${root}.tmp-${node_crypto.randomUUID()}`;
  node_fs.mkdirSync(staging, { recursive: true, mode: 448 });
  try {
    for (const [name2, content] of Object.entries(expected)) {
      const file = node_path.join(staging, name2);
      node_fs.mkdirSync(node_path.dirname(file), { recursive: true, mode: 448 });
      node_fs.writeFileSync(file, content, { mode: 384, flag: "wx" });
    }
    node_fs.renameSync(staging, root);
  } catch (e) {
    node_fs.rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}
function readOwnedTree(root) {
  if (node_fs.lstatSync(root).isSymbolicLink() || JSON.parse(node_fs.readFileSync(node_path.join(root, OWNER), "utf8")).owner !== "SmartDD") throw new Error("Skill 版本目录不可用");
  return Object.fromEntries(listFiles(root).filter((name2) => name2 !== OWNER).map((name2) => [name2, node_fs.readFileSync(node_path.join(root, name2), "utf8")]));
}
const APP_HOST_API = 1;
const APP_DATA_API = 1;
const PACKAGE_OWNER_FILE = ".willyou-package-owner.json";
const APP_HASH_PATTERN = /^[a-f0-9]{64}$/;
const APP_ID_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;
const version$1 = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
function isPackagePath(value) {
  if (!value || value !== value.normalize("NFC") || value.length > 1024 || /[\\:\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/u.test(value)) return false;
  return value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !/[. ]$/.test(part) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}
const nativePart = (max) => zod.z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/).max(max);
const path$2 = zod.z.string().refine(isPackagePath, "应用包路径无效");
const hash$5 = zod.z.string().regex(APP_HASH_PATTERN);
const operation = zod.z.string().regex(/^[a-z][a-z0-9_.-]{0,127}$/);
const api = zod.z.number().int().positive();
const applicationManifestSchema = zod.z.object({
  schema: zod.z.literal("smartdd-app-package-v1"),
  appId: nativePart(20),
  version: zod.z.string().regex(version$1),
  displayName: zod.z.string().trim().min(1).max(120),
  description: zod.z.string().max(4e3),
  hostApi: zod.z.object({ min: api, max: api }).strict(),
  dataApi: api,
  connectionContracts: zod.z.array(zod.z.object({
    providerId: zod.z.string().regex(APP_ID_PATTERN),
    configApiMajor: api,
    inputSchemaPath: path$2,
    authModes: zod.z.array(zod.z.string().min(1).max(80)).min(1),
    identityContractMajor: api
  }).strict()).min(1),
  runtime: zod.z.object({ id: zod.z.string().regex(APP_ID_PATTERN), hash: hash$5, protocolMajor: api }).strict(),
  skills: zod.z.array(zod.z.object({ id: nativePart(16), path: path$2, entry: path$2, description: zod.z.string().max(2e3) }).strict()).min(1),
  tools: zod.z.array(zod.z.object({
    name: zod.z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9]\d*$/).max(128),
    contractMajor: api,
    inputSchemaPath: path$2,
    outputSchemaPath: path$2,
    permission: operation,
    annotations: zod.z.object({ readOnlyHint: zod.z.boolean(), destructiveHint: zod.z.boolean(), idempotentHint: zod.z.boolean(), openWorldHint: zod.z.boolean() }).strict()
  }).strict()).min(1),
  adapter: zod.z.object({ entry: path$2, format: zod.z.literal("cjs") }).strict(),
  migrations: zod.z.array(zod.z.object({ id: zod.z.string().regex(APP_ID_PATTERN), from: zod.z.number().int().nonnegative(), to: api, file: path$2, checksum: hash$5 }).strict()),
  files: zod.z.array(zod.z.object({ path: path$2, sha256: hash$5, size: zod.z.number().int().nonnegative(), executable: zod.z.boolean() }).strict()).min(1).max(4096),
  permissions: zod.z.array(operation).min(1)
}).strict().superRefine((manifest, ctx) => {
  var _a;
  const issue = (message) => ctx.addIssue({ code: "custom", message });
  if (manifest.hostApi.min > manifest.hostApi.max) issue("宿主API范围无效");
  const paths = /* @__PURE__ */ new Set(), folded = /* @__PURE__ */ new Set();
  for (const f of manifest.files) {
    if (["manifest.json", PACKAGE_OWNER_FILE].includes(f.path.split("/")[0].toLowerCase()) || paths.has(f.path) || folded.has(f.path.toLowerCase())) issue("包路径重复、大小写冲突或使用保留名称");
    paths.add(f.path);
    folded.add(f.path.toLowerCase());
  }
  const required2 = [manifest.adapter.entry, ...manifest.connectionContracts.map((c) => c.inputSchemaPath), ...manifest.tools.flatMap((t) => [t.inputSchemaPath, t.outputSchemaPath]), ...manifest.skills.map((s) => s.entry), ...manifest.migrations.map((m) => m.file)];
  if (required2.some((p) => !paths.has(p))) issue("包入口或契约未列入完整文件清单");
  for (const f of paths) for (const other of paths) if (other !== f && other.startsWith(f + "/")) issue("文件与目录路径冲突");
  if (new Set(manifest.skills.map((s) => s.id)).size !== manifest.skills.length) issue("Skill标识重复");
  if (manifest.skills.some((s) => !s.entry.startsWith(s.path + "/") || !s.entry.endsWith("/SKILL.md"))) issue("Skill入口必须是本Skill目录内的SKILL.md");
  if (new Set(manifest.tools.map((t) => t.name)).size !== manifest.tools.length) issue("工具名重复");
  if (new Set(manifest.permissions).size !== manifest.permissions.length) issue("动作权限重复");
  const prefix = "smartdd_" + manifest.appId.replaceAll("-", "_") + "_";
  for (const t of manifest.tools) {
    if (!t.name.startsWith(prefix) || !t.name.endsWith("_v" + t.contractMajor)) issue("工具名称与应用及主契约不一致");
    if (!manifest.permissions.includes(t.permission)) issue("工具权限未在包声明中提供");
    if (t.permission.endsWith(".send") && (t.annotations.readOnlyHint || t.annotations.idempotentHint)) issue("发送工具不得声明为只读或幂等");
  }
  const migrations = /* @__PURE__ */ new Set();
  for (let i = 0; i < manifest.migrations.length; i++) {
    const m = manifest.migrations[i];
    if (migrations.has(m.id) || m.to !== m.from + 1 || i && m.from !== manifest.migrations[i - 1].to) issue("应用迁移编号或版本不连续");
    migrations.add(m.id);
    if (((_a = manifest.files.find((f) => f.path === m.file)) == null ? void 0 : _a.sha256) !== m.checksum) issue("迁移checksum与文件清单不一致");
  }
});
class ApplicationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ApplicationError";
  }
}
const BRIDGE_LIMITS = { requestBytes: 256 * 1024, responseBytes: 1024 * 1024, resourceChunkBytes: 256 * 1024, maxDepth: 32, maxNodes: 2e4 };
const id$5 = zod.z.uuid(), secret = zod.z.string().regex(/^[a-f0-9]{64}$/);
const bridgeCallSchema = zod.z.object({ operation: zod.z.string().regex(/^smartdd_[a-z0-9_]+_v[1-9][0-9]*$/).max(128), contractMajor: zod.z.number().int().positive(), connectionId: zod.z.uuid().nullable(), arguments: zod.z.record(zod.z.string(), zod.z.unknown()) }).strict();
zod.z.discriminatedUnion("method", [
  zod.z.object({ schema: zod.z.literal(1), id: id$5, method: zod.z.literal("exchange"), runId: id$5, bridgeId: id$5, secret }).strict(),
  zod.z.object({ schema: zod.z.literal(1), id: id$5, method: zod.z.literal("renew"), token: secret }).strict(),
  zod.z.object({ schema: zod.z.literal(1), id: id$5, method: zod.z.literal("tools/list"), token: secret }).strict(),
  zod.z.object({ schema: zod.z.literal(1), id: id$5, method: zod.z.literal("tools/call"), token: secret, call: bridgeCallSchema }).strict(),
  zod.z.object({ schema: zod.z.literal(1), id: id$5, method: zod.z.literal("cancel"), token: secret, targetId: id$5 }).strict()
]);
zod.z.object({ schema: zod.z.literal(1), endpoint: zod.z.string().min(1).max(100), runId: id$5, bridgeId: id$5, secret, hostGeneration: id$5, expiresAt: zod.z.number().int().positive() }).strict();
function boundedJson(value) {
  const queue = [{ value, depth: 0 }];
  let nodes = 0;
  while (queue.length) {
    const current = queue.pop();
    if (++nodes > BRIDGE_LIMITS.maxNodes || current.depth > BRIDGE_LIMITS.maxDepth) return false;
    if (current.value === null || typeof current.value === "string" || typeof current.value === "boolean" || typeof current.value === "number" && Number.isFinite(current.value)) continue;
    if (typeof current.value !== "object" || !current.value || !Array.isArray(current.value) && Object.getPrototypeOf(current.value) !== Object.prototype) return false;
    if (Object.keys(current.value).some((key) => ["__proto__", "constructor", "prototype"].includes(key))) return false;
    for (const child of Object.values(current.value)) queue.push({ value: child, depth: current.depth + 1 });
  }
  return true;
}
const digest = (value) => node_crypto.createHash("sha256").update(value).digest("hex");
function compareCodePoints(a, b) {
  const aa = Array.from(a, (c) => c.codePointAt(0)), bb = Array.from(b, (c) => c.codePointAt(0));
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
  return aa.length - bb.length;
}
function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (Array.from(value).some((v) => v === void 0)) throw new ApplicationError("INVALID_PACKAGE", "数组含有非JSON值");
    return "[" + value.map(canonicalJson).join(",") + "]";
  }
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort(compareCodePoints).map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
  }
  throw new ApplicationError("INVALID_PACKAGE", "规范化摘要只接受JSON值");
}
function parseManifest(value) {
  const parsed = applicationManifestSchema.safeParse(value);
  if (!parsed.success) throw new ApplicationError("INVALID_PACKAGE", "应用包声明无效：" + parsed.error.issues.map((i) => i.message).join("；"));
  const manifest = parsed.data;
  manifest.files.sort((a, b) => compareCodePoints(a.path, b.path));
  return manifest;
}
function validateBundle(bundle) {
  const manifest = parseManifest(bundle.manifest);
  const expected = new Set(manifest.files.map((f) => f.path));
  if (Object.keys(bundle.files).length !== expected.size || Object.keys(bundle.files).some((p) => !expected.has(p))) throw new ApplicationError("INVALID_PACKAGE", "应用包文件集合与清单不一致");
  const files = /* @__PURE__ */ Object.create(null);
  let total = 0;
  for (const file of manifest.files) {
    const source2 = bundle.files[file.path];
    if (!(source2 instanceof Uint8Array)) throw new ApplicationError("INVALID_PACKAGE", "应用包缺少文件");
    const bytes = Buffer.from(source2);
    total += bytes.length;
    if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new ApplicationError("INVALID_PACKAGE", "应用包超过资源预算");
    if (bytes.length !== file.size || digest(bytes) !== file.sha256) throw new ApplicationError("HASH_MISMATCH", "应用包资源大小或摘要不一致");
    files[file.path] = bytes;
  }
  for (const path2 of /* @__PURE__ */ new Set([...manifest.connectionContracts.map((c) => c.inputSchemaPath), ...manifest.tools.flatMap((t) => [t.inputSchemaPath, t.outputSchemaPath])])) {
    try {
      if (files[path2].length > BRIDGE_LIMITS.requestBytes || !Buffer.from(files[path2].toString("utf8"), "utf8").equals(files[path2])) throw new Error();
      const schema2 = JSON.parse(files[path2].toString("utf8"));
      if (!boundedJson(schema2)) throw new Error();
      if (!schema2 || typeof schema2 !== "object" || Array.isArray(schema2)) throw new Error();
    } catch {
      throw new ApplicationError("INVALID_PACKAGE", "工具或连接JSON Schema无效");
    }
  }
  return { manifest, packageHash: digest(canonicalJson(manifest)), files };
}
function assertHostCompatible(manifest) {
  if (manifest.hostApi.min > APP_HOST_API || manifest.hostApi.max < APP_HOST_API || manifest.dataApi !== APP_DATA_API) throw new ApplicationError("HOST_INCOMPATIBLE", "当前程序不支持此应用包契约");
}
const source = zod.z.object({ resourceId: zod.z.string().min(1).max(512), sourceHash: zod.z.string().regex(/^[a-f0-9]{64}$/), nativeName: zod.z.string().min(1).max(64) }).strict();
const common = { kind: zod.z.literal("claude-session-projection"), taskId: zod.z.string().min(1).max(128), selectionHash: zod.z.string().regex(/^[a-f0-9]{64}$/), sources: zod.z.array(source).max(4096) };
zod.z.discriminatedUnion("formatVersion", [
  zod.z.object({ ...common, formatVersion: zod.z.literal(1) }).strict(),
  zod.z.object({ ...common, formatVersion: zod.z.literal(2), standardSkillScope: zod.z.array(zod.z.string().min(1).max(4096)).max(4096) }).strict()
]);
const claudeRunDeliverySchema = zod.z.object({ schema: zod.z.literal(2), taskId: zod.z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), leaseId: zod.z.uuid(), revision: zod.z.number().int().positive(), resourceId: zod.z.string().min(1).max(512), hash: zod.z.string().regex(/^[a-f0-9]{64}$/), generation: zod.z.number().int().positive(), appIds: zod.z.array(zod.z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)).min(0).max(32).refine((a) => new Set(a).size === a.length) }).strict();
const hash$4 = zod.z.string().regex(/^[a-f0-9]{64}$/);
const id$4 = zod.z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/);
const absolute = zod.z.string().min(1).max(4096).refine((s) => (s.startsWith("/") || /^[A-Za-z]:[\\/]/.test(s) || s.startsWith("\\\\")) && !/[\x00\r\n]/.test(s));
const name = zod.z.string().min(1).max(64).regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
const tool = zod.z.string().min(1).max(256).regex(/^[A-Za-z_][A-Za-z0-9_.:-]*$/).refine((s) => !["__proto__", "constructor", "prototype"].includes(s));
const version = zod.z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
const capabilitySessionSnapshotSchema = zod.z.object({
  schema: zod.z.literal(2),
  taskId: id$4,
  projectId: id$4,
  createdAt: zod.z.iso.datetime(),
  runner: zod.z.enum(["claude-code", "codex"]),
  adapterBinding: zod.z.object({ id: id$4, version, hash: hash$4, projectionFormatVersion: zod.z.number().int().positive(), nativeToolNames: zod.z.record(tool, tool) }).strict(),
  native: zod.z.object({ sessionId: zod.z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).nullable(), stateRoot: absolute, cwd: absolute }).strict(),
  agentAtCreation: zod.z.object({ version: zod.z.string().min(1).max(128), adapterRevision: zod.z.number().int().positive() }).strict(),
  catalogGeneration: zod.z.string().min(1).max(256),
  packages: zod.z.array(zod.z.object({
    appId: name.max(20),
    version,
    packageHash: hash$4,
    hashAlgorithm: zod.z.literal("app-manifest-v1"),
    hostApi: zod.z.object({ min: zod.z.number().int().positive(), max: zod.z.number().int().positive() }).strict(),
    dataApi: zod.z.number().int().positive(),
    runtimeHash: hash$4,
    toolContractMajors: zod.z.record(tool, zod.z.number().int().positive()),
    skills: zod.z.array(zod.z.object({ skillId: name.max(16), nativeName: name, contentHash: hash$4, sourceRelativePath: zod.z.string().refine(isPackagePath), projectionPath: absolute.refine((p) => p.endsWith("/SKILL.md")) }).strict()).min(1).max(64),
    bindings: zod.z.array(zod.z.object({ bindingId: zod.z.string().min(1).max(512), connectionId: zod.z.uuid(), identityRevision: zod.z.number().int().positive() }).strict()).max(16),
    allowedOperations: zod.z.array(zod.z.string().min(1).max(128).regex(/^[a-z][a-z0-9_.-]*$/)).max(256)
  }).strict()).max(32),
  standardSkills: zod.z.array(zod.z.object({ skillId: name, versionId: zod.z.string().min(1).max(512), hash: hash$4, hashAlgorithm: zod.z.literal("legacy-tree-v1"), projectionPath: absolute.refine((p) => p.endsWith("/SKILL.md")) }).strict()).max(64),
  mcp: zod.z.array(zod.z.object({ kind: zod.z.enum(["applications", "legacy-project-context"]), serverName: zod.z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), protocolMajor: zod.z.number().int().positive(), runtimeHash: hash$4 }).strict()).max(2),
  legacyBinding: zod.z.object({ sourceSnapshotHash: hash$4, sourceRecordHash: hash$4, identityHash: hash$4, manifestHash: hash$4, logicalEvidenceHash: hash$4, pluginSourceHash: hash$4.optional() }).strict().optional(),
  provenance: zod.z.enum(["created", "migrated-known-legacy"])
}).strict().superRefine((snapshot, ctx) => {
  const fail2 = (message) => ctx.addIssue({ code: "custom", message });
  if (Object.keys(snapshot.adapterBinding.nativeToolNames).length > 512 || new Set(Object.values(snapshot.adapterBinding.nativeToolNames)).size !== Object.keys(snapshot.adapterBinding.nativeToolNames).length) fail2("原生工具名称映射重复或超过预算");
  if (snapshot.provenance === "migrated-known-legacy" && snapshot.packages.length) fail2("既有M4历史不能自动增加M10应用");
  if (snapshot.legacyBinding && (snapshot.provenance !== "migrated-known-legacy" || snapshot.adapterBinding.projectionFormatVersion !== 2)) fail2("原M4来源绑定仅属于旧格式迁移");
  if (snapshot.adapterBinding.projectionFormatVersion === 2 && !snapshot.legacyBinding) fail2("旧格式迁移须固定原M4来源依据");
  if (snapshot.adapterBinding.id !== snapshot.runner) fail2("Agent适配器与原生运行器不同");
  if (new Set(snapshot.packages.map((p) => p.appId)).size !== snapshot.packages.length) fail2("同一应用不能在会话中选择两个版本");
  if (new Set(snapshot.standardSkills.map((s) => s.skillId)).size !== snapshot.standardSkills.length) fail2("同一标准Skill不能选择两个版本");
  const skills = snapshot.packages.flatMap((p) => p.skills);
  const paths = [...skills.map((s) => s.projectionPath), ...snapshot.standardSkills.map((s) => s.projectionPath)];
  if (new Set(paths).size !== paths.length || new Set(skills.map((s) => s.nativeName)).size !== skills.length) fail2("原生Skill名称或路径重复");
  if (new Set(snapshot.mcp.map((m) => m.serverName)).size !== snapshot.mcp.length || new Set(snapshot.mcp.map((m) => m.kind)).size !== snapshot.mcp.length) fail2("MCP名称或桥类别重复");
  const bridge = snapshot.mcp.find((m) => m.kind === "applications");
  if (snapshot.packages.length && (!bridge || snapshot.packages.some((p) => p.runtimeHash !== bridge.runtimeHash))) fail2("本会话应用必须使用同一固定业务桥");
  if (!snapshot.packages.length && bridge) fail2("未选应用的历史不能自动增加业务桥");
  for (const p of snapshot.packages) {
    if (new Set(p.skills.map((s) => s.skillId)).size !== p.skills.length || new Set(p.allowedOperations).size !== p.allowedOperations.length) fail2("应用Skill或动作重复");
    if (p.hostApi.min > p.hostApi.max) fail2("应用宿主契约范围无效");
    for (const s of p.skills) if (s.nativeName !== applicationNativeSkillName(p.appId, s.skillId, p.packageHash)) fail2("应用原生Skill名称未固定到包版本");
  }
});
const applicationNativeSkillName = (appId, skillId, packageHash) => `smartdd-a-${appId}-${skillId}-${packageHash.slice(0, 12)}`;
function ensureStoreDirectory(root, path2) {
  if (!isPackagePath(path2)) throw new ApplicationError("INVALID_PACKAGE", "资源目录路径无效");
  if (node_fs.lstatSync(root).isSymbolicLink() || !node_fs.lstatSync(root).isDirectory()) throw new ApplicationError("OWNERSHIP_CONFLICT", "资源根目录归属不明确");
  let dir = root;
  for (const part of path2.split("/")) {
    dir = node_path.join(dir, part);
    try {
      node_fs.mkdirSync(dir, { mode: 448 });
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
    const stat = node_fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError("OWNERSHIP_CONFLICT", "资源目录被其他文件或链接占用");
  }
  return dir;
}
function fileNames(root, dir = root) {
  if (node_fs.lstatSync(dir).isSymbolicLink() || !node_fs.lstatSync(dir).isDirectory()) throw new ApplicationError("OWNERSHIP_CONFLICT", "应用目录不属于受管文件树");
  return node_fs.readdirSync(dir).flatMap((name2) => {
    const path2 = node_path.join(dir, name2), stat = node_fs.lstatSync(path2);
    if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw new ApplicationError("OWNERSHIP_CONFLICT", "应用包包含链接或特殊文件");
    return stat.isDirectory() ? fileNames(root, path2) : [node_path.relative(root, path2).split("\\").join("/")];
  });
}
function writePackageTree(root, bundle, storeId) {
  if (node_fs.existsSync(root)) throw new ApplicationError("OWNERSHIP_CONFLICT", "应用包暂存目标已存在");
  node_fs.mkdirSync(root, { mode: 448 });
  for (const file of bundle.manifest.files) {
    if (node_path.dirname(file.path) !== ".") ensureStoreDirectory(root, node_path.dirname(file.path));
    node_fs.writeFileSync(node_path.join(root, file.path), bundle.files[file.path], { flag: "wx", mode: file.executable ? 448 : 384 });
  }
  node_fs.writeFileSync(node_path.join(root, "manifest.json"), canonicalJson(bundle.manifest) + "\n", { flag: "wx", mode: 384 });
  node_fs.writeFileSync(node_path.join(root, PACKAGE_OWNER_FILE), canonicalJson({ schema: 1, storeId, packageHash: bundle.packageHash }) + "\n", { flag: "wx", mode: 384 });
}
function verifyPackageTree(root, bundle, storeId) {
  try {
    const names = fileNames(root), expected = /* @__PURE__ */ new Set([...bundle.manifest.files.map((f) => f.path), "manifest.json", PACKAGE_OWNER_FILE]);
    if (names.length !== expected.size || names.some((p) => !expected.has(p))) throw new ApplicationError("HASH_MISMATCH", "应用包完整文件集合已改变");
    const owner = JSON.parse(node_fs.readFileSync(node_path.join(root, PACKAGE_OWNER_FILE), "utf8"));
    if (owner.schema !== 1 || owner.storeId !== storeId || owner.packageHash !== bundle.packageHash) throw new ApplicationError("OWNERSHIP_CONFLICT", "应用包目录归属不一致");
    const manifest = parseManifest(JSON.parse(node_fs.readFileSync(node_path.join(root, "manifest.json"), "utf8")));
    if (digest(canonicalJson(manifest)) !== bundle.packageHash || canonicalJson(manifest) !== canonicalJson(bundle.manifest)) throw new ApplicationError("HASH_MISMATCH", "应用包声明摘要已改变");
    for (const file of manifest.files) {
      const path2 = node_path.join(root, file.path), stat = node_fs.lstatSync(path2);
      if (stat.size !== file.size || digest(node_fs.readFileSync(path2)) !== file.sha256) throw new ApplicationError("HASH_MISMATCH", "应用包文件摘要已改变");
      if ((stat.mode & 73) !== (file.executable ? 64 : 0)) throw new ApplicationError("HASH_MISMATCH", "应用包文件执行权限已改变");
    }
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError("HASH_MISMATCH", "应用包缺失、不可读或声明损坏");
  }
}
const OWNED_BUNDLE_MARKER = ".willyou-owned-bundle.json";
const ownedManifestSchema = zod.z.object({ schema: zod.z.literal("willyou-owned-bundle-v1"), metadata: zod.z.record(zod.z.string(), zod.z.unknown()).refine(boundedJson), files: zod.z.array(zod.z.object({ path: zod.z.string().refine(isPackagePath), size: zod.z.number().int().nonnegative(), sha256: zod.z.string().regex(/^[a-f0-9]{64}$/), executable: zod.z.boolean() }).strict()).min(1).max(4096) }).strict();
function ownedBundle(metadata, input, executables = /* @__PURE__ */ new Set()) {
  const files = /* @__PURE__ */ Object.create(null);
  let total = 0;
  for (const [path2, value] of Object.entries(input)) {
    if (!(value instanceof Uint8Array) || !isPackagePath(path2) || ["bundle.json", OWNED_BUNDLE_MARKER].includes(path2.split("/")[0].toLowerCase())) throw new ApplicationError("INVALID_PACKAGE", "受管资源文件声明无效");
    const bytes = Buffer.from(value);
    total += bytes.length;
    if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new ApplicationError("TOO_LARGE", "受管资源超过预算");
    files[path2] = bytes;
  }
  const names = Object.keys(files), folded = names.map((n) => n.toLowerCase());
  if (new Set(folded).size !== folded.length || names.some((n) => names.some((other) => other.startsWith(n + "/")))) throw new ApplicationError("INVALID_PACKAGE", "受管资源路径冲突");
  const parsed = ownedManifestSchema.safeParse({ schema: "willyou-owned-bundle-v1", metadata, files: names.map((path2) => ({ path: path2, size: files[path2].length, sha256: digest(files[path2]), executable: executables.has(path2) })).sort((a, b) => compareCodePoints(a.path, b.path)) });
  if (!parsed.success) throw new ApplicationError("INVALID_PACKAGE", "受管资源元数据无效");
  const manifest = parsed.data;
  return { manifest, hash: digest(canonicalJson(manifest)), files };
}
const durableWrite = (path2, data, executable2 = false) => {
  node_fs.writeFileSync(path2, data, { flag: "wx", mode: executable2 ? 448 : 384 });
  const fd = node_fs.openSync(path2, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
  try {
    node_fs.fsyncSync(fd);
  } finally {
    node_fs.closeSync(fd);
  }
};
function writeOwnedBundle(root, bundle, storeId) {
  node_fs.mkdirSync(root, { mode: 448 });
  for (const file of bundle.manifest.files) {
    if (node_path.dirname(file.path) !== ".") ensureStoreDirectory(root, node_path.dirname(file.path));
    durableWrite(node_path.join(root, file.path), bundle.files[file.path], file.executable);
  }
  durableWrite(node_path.join(root, "bundle.json"), canonicalJson(bundle.manifest) + "\n");
  durableWrite(node_path.join(root, OWNED_BUNDLE_MARKER), canonicalJson({ schema: 1, storeId, hash: bundle.hash }) + "\n");
  const fd = node_fs.openSync(root, node_fs.constants.O_RDONLY);
  try {
    node_fs.fsyncSync(fd);
  } finally {
    node_fs.closeSync(fd);
  }
}
const hash$3 = zod.z.string().regex(/^[a-f0-9]{64}$/), id$3 = zod.z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/);
const deliveryOwner = zod.z.object({ instanceId: zod.z.uuid(), pid: zod.z.number().int().positive(), startedAt: zod.z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/) }).strict();
const appIds = zod.z.array(zod.z.string().regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)).min(0).max(32).refine((a) => new Set(a).size === a.length);
const view = zod.z.object({ resourceId: zod.z.string(), sourceId: zod.z.string(), hash: hash$3, generation: zod.z.number().int().positive(), appIds }).strict();
const participant = zod.z.object({ owner: deliveryOwner, leaseId: zod.z.uuid() }).strict();
const claudeDeliveryPendingSchema = zod.z.object({ id: zod.z.uuid(), sourceId: zod.z.string(), hash: hash$3, appIds, priorHash: hash$3.nullable(), priorResourceIds: zod.z.array(zod.z.string()).max(1024), resourceId: zod.z.string(), generation: zod.z.number().int().positive(), abandonedStages: zod.z.array(zod.z.string()).max(64), participants: zod.z.array(participant).min(1).max(64), activeOwner: deliveryOwner, stage: zod.z.string(), backup: zod.z.string() }).strict();
const preparation = zod.z.object({ id: zod.z.uuid(), leaseId: zod.z.uuid(), owner: deliveryOwner, revision: zod.z.number().int().positive() }).strict();
const consumer = zod.z.object({ runId: zod.z.uuid(), leaseId: zod.z.uuid(), owner: deliveryOwner, revision: zod.z.number().int().positive(), resourceId: zod.z.string(), hash: hash$3, generation: zod.z.number().int().positive() }).strict();
const claudeSlotSchema = zod.z.object({ schema: zod.z.union([zod.z.literal(1), zod.z.literal(2)]), storeId: zod.z.uuid(), taskId: id$3, selectionHash: hash$3, root: zod.z.string(), anchorId: zod.z.string(), revision: zod.z.number().int().positive(), current: view.nullable(), pending: claudeDeliveryPendingSchema.nullable(), preparation: preparation.nullable(), consumers: zod.z.array(consumer).max(128) }).strict().superRefine((slot, ctx) => {
  var _a, _b;
  if (slot.schema === 1 && (((_a = slot.current) == null ? void 0 : _a.appIds.length) === 0 || ((_b = slot.pending) == null ? void 0 : _b.appIds.length) === 0)) ctx.addIssue({ code: "custom", message: "旧交付记录不能声明空应用范围" });
});
claudeRunDeliverySchema.extend({ preparationId: zod.z.uuid() });
const claudeSlotId = (taskId) => "claude-delivery-slot:" + taskId;
const claudeRoot = (taskId) => `sessions/${taskId}/claude/plugin`;
const claudeAnchor = (taskId) => "claude-delivery-root:" + taskId;
const fail$3 = () => new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原Claude目录交付或占用依据待核验，保留现场");
function readClaudeSlot(store, taskId) {
  const row = store.sqlite.prepare("SELECT kind,owner_store_id,state,plan_json FROM capability_resource_operations WHERE operation_id=?").get(claudeSlotId(taskId));
  if (!row) {
    const footprint = store.sqlite.prepare("SELECT 1 FROM capability_resources WHERE owner_store_id=? AND path_scope='C' AND (resource_id=? OR kind='claude-delivery' AND scope_relative_path=?) LIMIT 1").get(store.storeId, claudeAnchor(taskId), claudeRoot(taskId));
    const intent = store.sqlite.prepare("SELECT 1 FROM capability_resource_operations WHERE owner_store_id=? AND kind='claude-delivery-install' AND CASE WHEN json_valid(plan_json) THEN json_extract(plan_json,'$.slotId') ELSE NULL END=? LIMIT 1").get(store.storeId, claudeSlotId(taskId));
    if (footprint || intent) throw fail$3();
    return null;
  }
  try {
    const raw = JSON.parse(row.plan_json), value = claudeSlotSchema.parse(raw.payload);
    if (row.kind !== "claude-delivery-slot" || row.owner_store_id !== store.storeId || row.state !== "committed" || digest(canonicalJson(value)) !== raw.evidenceHash || value.storeId !== store.storeId || value.taskId !== taskId || value.root !== claudeRoot(taskId) || value.anchorId !== claudeAnchor(taskId)) throw fail$3();
    const anchor = store.get(value.anchorId);
    if (anchor.kind !== "claude-delivery-root" || anchor.pathScope !== "C" || anchor.relativePath !== value.root || anchor.state !== "recovery-required" || anchor.integrity !== "unknown" || anchor.operationId !== claudeSlotId(taskId) || anchor.contentHash !== digest(canonicalJson({ taskId, selectionHash: value.selectionHash, root: value.root }))) throw fail$3();
    if (value.pending) {
      const p = value.pending;
      if (!p.stage.startsWith(`claude-deliveries/${taskId}/${p.id}/stages/`) || !zod.z.uuid().safeParse(p.stage.split("/").at(-1)).success || p.abandonedStages.some((v) => !v.startsWith(`claude-deliveries/${taskId}/${p.id}/stages/`) || !zod.z.uuid().safeParse(v.split("/").at(-1)).success) || p.backup !== `claude-deliveries/${taskId}/${p.id}/previous` || !p.participants.some((v) => canonicalJson(v.owner) === canonicalJson(p.activeOwner)) || new Set(p.participants.map((v) => v.leaseId)).size !== p.participants.length) throw fail$3();
    }
    return value;
  } catch {
    throw fail$3();
  }
}
function assertClaudePublication(store, path2, contentHash, reuse = false) {
  var _a;
  if (path2 !== "sessions" && !path2.startsWith("sessions/")) return;
  const tasks2 = /* @__PURE__ */ new Set();
  for (const row of store.sqlite.prepare("SELECT operation_id FROM capability_resource_operations WHERE kind='claude-delivery-slot'").all()) {
    if (!row.operation_id.startsWith("claude-delivery-slot:")) throw fail$3();
    tasks2.add(row.operation_id.slice(21));
  }
  for (const row of store.sqlite.prepare("SELECT resource_id,scope_relative_path FROM capability_resources WHERE owner_store_id=? AND path_scope='C' AND kind IN ('claude-delivery-root','claude-delivery')").all(store.storeId)) {
    const root = /^sessions\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/claude\/plugin$/.exec(row.scope_relative_path ?? "");
    if (root) tasks2.add(root[1]);
    else if (row.resource_id.startsWith("claude-delivery-root:")) tasks2.add(row.resource_id.slice(21));
    else throw fail$3();
  }
  for (const taskId of tasks2) {
    const root = claudeRoot(taskId);
    if (path2 !== root && !path2.startsWith(root + "/") && !root.startsWith(path2 + "/")) continue;
    const slot = readClaudeSlot(store, taskId);
    if (!slot) throw fail$3();
    if (reuse && path2 === slot.root && !slot.pending && ((_a = slot.current) == null ? void 0 : _a.hash) === contentHash) return;
    throw new ApplicationError("RESOURCE_BUSY", "此原Claude目录由交付协调器维护，当前占用及修复不能被独立发布覆盖");
  }
}
const identity = zod.z.object({ dev: zod.z.number().int().nonnegative(), ino: zod.z.number().int().nonnegative() }).strict();
const ownerSchema = zod.z.object({
  schema: zod.z.literal(2),
  protocol: zod.z.literal("sqlite-exclusive-v1"),
  token: zod.z.uuid(),
  kind: zod.z.enum(["resource", "catalog"]),
  root: identity.extend({ path: zod.z.string() }),
  gate: identity,
  directory: identity,
  pid: zod.z.number().int().positive(),
  startedAt: zod.z.string().optional()
}).strict();
const legacyCatalogOwner = zod.z.object({ schema: zod.z.literal(1), token: zod.z.uuid(), pid: zod.z.number().int().positive(), startedAt: zod.z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/) }).strict();
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const recovery = () => new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "协调锁归属或内核门闩身份不能核验，保留现场");
const busy = (error) => ["SQLITE_BUSY", "SQLITE_LOCKED"].includes(error.code ?? "");
const present = (path2) => {
  try {
    return node_fs.lstatSync(path2);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
};
const sync = (path2) => {
  const fd = node_fs.openSync(path2, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
  try {
    node_fs.fsyncSync(fd);
  } finally {
    node_fs.closeSync(fd);
  }
};
async function withCoordinatorLock(rootInput, kind, action, options = {}, host) {
  var _a, _b, _c, _d, _e, _f;
  if ((_a = options.signal) == null ? void 0 : _a.aborted) throw new ApplicationError("CANCELED", "已取消等待资源协调");
  const root = node_fs.realpathSync(rootInput), rootId = node_fs.lstatSync(root), path2 = node_path.join(root, kind + ".lock"), gatePath = node_path.join(root, "." + kind + ".lock.gate.sqlite"), deadline = performance.now() + (options.timeoutMs ?? 3e3);
  const assertRoot = () => {
    const current = node_fs.lstatSync(root);
    if (!current.isDirectory() || current.isSymbolicLink() || node_fs.realpathSync(root) !== root || !same(current, rootId)) throw recovery();
  };
  assertRoot();
  try {
    const fd = node_fs.openSync(gatePath, node_fs.constants.O_CREAT | node_fs.constants.O_EXCL | node_fs.constants.O_WRONLY | node_fs.constants.O_NOFOLLOW, 384);
    node_fs.closeSync(fd);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  const gateId = node_fs.lstatSync(gatePath);
  const assertGate = () => {
    assertRoot();
    const current = node_fs.lstatSync(gatePath);
    if (!current.isFile() || current.isSymbolicLink() || current.nlink !== 1 || current.size > 1024 * 1024 || !same(current, gateId)) throw recovery();
    for (const suffix of ["-journal", "-wal", "-shm"]) {
      const side = present(gatePath + suffix);
      if (side && (!side.isFile() || side.isSymbolicLink() || side.nlink !== 1)) throw recovery();
    }
  };
  assertGate();
  let gate;
  try {
    gate = new Database(gatePath, { timeout: 0, fileMustExist: true });
  } catch {
    throw recovery();
  }
  let entered = false;
  const rootIdentity = { path: root, dev: rootId.dev, ino: rootId.ino }, gateIdentity = { dev: gateId.dev, ino: gateId.ino }, binding = JSON.stringify({ schema: 1, kind, root: rootIdentity, gate: gateIdentity });
  const wait = async () => {
    var _a2;
    if ((_a2 = options.signal) == null ? void 0 : _a2.aborted) throw new ApplicationError("CANCELED", "已取消等待资源协调");
    if (performance.now() >= deadline) throw new ApplicationError("RESOURCE_BUSY", "资源仍有协调者，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, Math.min(20, Math.max(1, deadline - performance.now()))));
  };
  try {
    for (; ; ) {
      assertGate();
      if ((_b = options.signal) == null ? void 0 : _b.aborted) throw new ApplicationError("CANCELED", "已取消等待资源协调");
      try {
        gate.exec("BEGIN EXCLUSIVE");
      } catch (error) {
        if (!busy(error)) throw error;
        await wait();
        continue;
      }
      if (gate.pragma("journal_mode", { simple: true }) !== "delete") throw recovery();
      const tables = gate.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name").all();
      const application = gate.pragma("application_id", { simple: true }), version2 = gate.pragma("user_version", { simple: true });
      const schema2 = "CREATE TABLE coordinator_identity (id INTEGER PRIMARY KEY CHECK(id=1), identity TEXT NOT NULL)";
      if (!tables.length && application === 0 && version2 === 0) {
        gate.exec(schema2);
        gate.prepare("INSERT INTO coordinator_identity VALUES(1,?)").run(binding);
        gate.pragma("application_id = 1465470027");
        gate.pragma("user_version = 1");
        gate.exec("COMMIT");
        continue;
      }
      if (application !== 1465470027 || version2 !== 1 || tables.length !== 1 || tables[0].name !== "coordinator_identity" || tables[0].sql !== schema2) throw recovery();
      const rows = gate.prepare("SELECT id,identity FROM coordinator_identity").all();
      if (rows.length !== 1 || rows[0].id !== 1 || rows[0].identity !== binding) {
        let known = null;
        try {
          known = JSON.parse(((_c = rows[0]) == null ? void 0 : _c.identity) ?? "null");
        } catch {
        }
        if (root !== rootInput && ((_d = known == null ? void 0 : known.root) == null ? void 0 : _d.path) === rootInput) throw new ApplicationError("OWNERSHIP_CONFLICT", "原资源根的规范位置已被链接替换，保留原路径");
        throw recovery();
      }
      break;
    }
    const readOwner = () => {
      try {
        const directory = node_fs.lstatSync(path2), file = node_path.join(path2, "owner.json"), stat = node_fs.lstatSync(file);
        if (!directory.isDirectory() || directory.isSymbolicLink() || !stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 8192 || node_fs.readdirSync(path2).join(",") !== "owner.json") throw recovery();
        const fd = node_fs.openSync(file, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
        let value;
        try {
          value = JSON.parse(node_fs.readFileSync(fd, "utf8"));
        } catch {
          throw recovery();
        } finally {
          node_fs.closeSync(fd);
        }
        return { directory, value };
      } catch {
        throw recovery();
      }
    };
    const assertOwned = (expected) => {
      assertGate();
      const current = readOwner(), owner2 = ownerSchema.safeParse(current.value);
      if (!owner2.success || JSON.stringify(owner2.data) !== JSON.stringify(expected) || !same(current.directory, expected.directory)) throw recovery();
    };
    const remove = (owner2) => {
      assertOwned(owner2);
      node_fs.unlinkSync(node_path.join(path2, "owner.json"));
      node_fs.rmdirSync(path2);
      sync(root);
    };
    for (; ; ) {
      if (!present(path2)) {
        try {
          node_fs.mkdirSync(path2, { mode: 448 });
          break;
        } catch (error) {
          if (error.code === "EEXIST") continue;
          throw error;
        }
      }
      const current = readOwner(), parsed = ownerSchema.safeParse(current.value);
      if (parsed.success) {
        const owner2 = parsed.data;
        if (owner2.kind !== kind || owner2.root.path !== root || !same(owner2.root, rootId) || !same(owner2.gate, gateId) || !same(owner2.directory, current.directory)) throw recovery();
        remove(owner2);
        continue;
      }
      const legacy = current.value;
      if (!legacy || legacy.schema === 2 || typeof legacy.token !== "string" || !Number.isSafeInteger(legacy.pid) || legacy.pid < 1 || kind === "catalog" && typeof legacy.startedAt !== "string") throw recovery();
      const old = kind === "catalog" ? legacyCatalogOwner.safeParse(current.value) : null;
      if ((old == null ? void 0 : old.success) && ((_e = options.processes) == null ? void 0 : _e.state({ pid: old.data.pid, startedAt: old.data.startedAt })) === "stopped") ;
      await wait();
      assertGate();
    }
    assertGate();
    const dirId = node_fs.lstatSync(path2), owner = ownerSchema.parse({ schema: 2, protocol: "sqlite-exclusive-v1", token: node_crypto.randomUUID(), kind, root: rootIdentity, gate: gateIdentity, directory: { dev: dirId.dev, ino: dirId.ino }, pid: process.pid, ...host ? { startedAt: host.startedAt } : {} });
    node_fs.writeFileSync(node_path.join(path2, "owner.json"), JSON.stringify(owner), { flag: "wx", mode: 384 });
    sync(node_path.join(path2, "owner.json"));
    sync(path2);
    sync(root);
    try {
      assertOwned(owner);
      if ((_f = options.signal) == null ? void 0 : _f.aborted) throw new ApplicationError("CANCELED", "资源操作已取消");
      entered = true;
      return await action();
    } finally {
      remove(owner);
    }
  } catch (error) {
    if (entered || error instanceof ApplicationError) throw error;
    throw recovery();
  } finally {
    try {
      if (gate.inTransaction) gate.exec("ROLLBACK");
    } finally {
      gate.close();
    }
  }
}
async function withResourceLock(root, action, options = {}) {
  return withCoordinatorLock(ensureStoreDirectory(root, "locks"), "resource", () => {
    const value = action();
    if (value instanceof Promise) throw new Error("资源协调区禁止等待网络、文件复制或异步业务");
    return value;
  }, options);
}
const runtimeSchema = zod.z.object({
  schema: zod.z.literal("smartdd-app-runtime-v1"),
  id: zod.z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),
  protocolMajor: zod.z.number().int().positive(),
  bridgeEntry: zod.z.string().refine(isPackagePath),
  files: zod.z.array(zod.z.object({ path: zod.z.string().refine(isPackagePath), sha256: zod.z.string().regex(/^[a-f0-9]{64}$/), size: zod.z.number().int().nonnegative() }).strict()).min(1).max(4096)
}).strict();
function validateRuntime(bundle) {
  const files = /* @__PURE__ */ Object.create(null);
  let total = 0;
  for (const [path2, value] of Object.entries(bundle.files)) {
    if (!(value instanceof Uint8Array)) throw new ApplicationError("INVALID_PACKAGE", "运行资源缺少文件内容");
    const bytes = Buffer.from(value);
    total += bytes.length;
    if (bytes.length > 64 * 1024 * 1024 || total > 256 * 1024 * 1024) throw new ApplicationError("INVALID_PACKAGE", "运行资源超过预算");
    files[path2] = bytes;
  }
  const parsed = runtimeSchema.safeParse({
    schema: "smartdd-app-runtime-v1",
    id: bundle.id,
    protocolMajor: bundle.protocolMajor,
    bridgeEntry: bundle.bridgeEntry,
    files: Object.entries(files).map(([path2, bytes]) => ({ path: path2, sha256: digest(bytes), size: bytes.length })).sort((a, b) => compareCodePoints(a.path, b.path))
  });
  if (!parsed.success) throw new ApplicationError("INVALID_PACKAGE", "运行资源声明无效");
  const manifest = parsed.data;
  const paths = manifest.files.map((f) => f.path), folded = paths.map((p) => p.toLowerCase());
  if (!paths.includes(manifest.bridgeEntry) || !manifest.bridgeEntry.endsWith(".cjs") || new Set(folded).size !== paths.length || paths.some((p) => ["runtime.json", PACKAGE_OWNER_FILE].includes(p.split("/")[0].toLowerCase()) || paths.some((other) => other !== p && other.startsWith(p + "/")))) throw new ApplicationError("INVALID_PACKAGE", "运行资源入口或路径冲突");
  return { manifest, files, hash: digest(canonicalJson(manifest)) };
}
class RuntimeRegistry {
  constructor(store) {
    this.store = store;
  }
  specification(source2) {
    const bundle = validateRuntime(source2);
    return {
      resourceId: "runtime:" + bundle.hash,
      kind: "runtime",
      contentHash: bundle.hash,
      relativePath: "runtime/" + bundle.hash,
      dependencies: [],
      materialize: (stage) => {
        node_fs.mkdirSync(stage, { mode: 448 });
        for (const [path2, bytes] of Object.entries(bundle.files)) {
          if (node_path.dirname(path2) !== ".") ensureStoreDirectory(stage, node_path.dirname(path2));
          node_fs.writeFileSync(node_path.join(stage, path2), bytes, { mode: 384, flag: "wx" });
        }
        node_fs.writeFileSync(node_path.join(stage, "runtime.json"), canonicalJson(bundle.manifest) + "\n", { mode: 384, flag: "wx" });
        node_fs.writeFileSync(node_path.join(stage, PACKAGE_OWNER_FILE), canonicalJson({ schema: 1, storeId: this.store.storeId, packageHash: bundle.hash }) + "\n", { mode: 384, flag: "wx" });
      },
      verify: (directory) => this.verifyDirectory(directory, bundle.hash)
    };
  }
  async install(source2) {
    return this.store.publish(this.specification(source2));
  }
  async recoverInstall(source2, operationId) {
    return this.store.recover(this.specification(source2), operationId);
  }
  verify(hash2, expected) {
    const row = this.store.get("runtime:" + hash2);
    if (row.kind !== "runtime" || row.state !== "ready" || row.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "应用运行资源尚未就绪");
    this.verifyDirectory(node_path.join(this.store.root, row.relativePath), hash2, expected);
    return row;
  }
  verifyDirectory(directory, hash2, expected) {
    try {
      const manifest = runtimeSchema.parse(JSON.parse(node_fs.readFileSync(node_path.join(directory, "runtime.json"), "utf8")));
      if (digest(canonicalJson(manifest)) !== hash2 || expected && (manifest.id !== expected.id || manifest.protocolMajor !== expected.protocolMajor)) throw new ApplicationError("HASH_MISMATCH", "运行资源契约或摘要不一致");
      const owner = JSON.parse(node_fs.readFileSync(node_path.join(directory, PACKAGE_OWNER_FILE), "utf8"));
      if (owner.schema !== 1 || owner.storeId !== this.store.storeId || owner.packageHash !== hash2) throw new ApplicationError("OWNERSHIP_CONFLICT", "运行资源归属不一致");
      const names = fileNames(directory), allowed = /* @__PURE__ */ new Set([...manifest.files.map((f) => f.path), "runtime.json", PACKAGE_OWNER_FILE]);
      if (names.length !== allowed.size || names.some((p) => !allowed.has(p))) throw new ApplicationError("HASH_MISMATCH", "运行资源文件集合已改变");
      for (const file of manifest.files) {
        const path2 = node_path.join(directory, file.path), stat = node_fs.lstatSync(path2);
        if (stat.size !== file.size || (stat.mode & 73) !== 0 || digest(node_fs.readFileSync(path2)) !== file.sha256) throw new ApplicationError("HASH_MISMATCH", "运行资源文件或权限已改变");
      }
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("HASH_MISMATCH", "运行资源缺失、不可读或格式损坏");
    }
  }
}
class PackageRegistry {
  constructor(store, hostBuild, migrations = []) {
    __publicField(this, "runtimes");
    this.store = store;
    this.hostBuild = hostBuild;
    this.migrations = migrations;
    this.runtimes = new RuntimeRegistry(store);
  }
  list() {
    const rows = this.store.sqlite.prepare("SELECT package_hash AS hash FROM capability_packages ORDER BY app_id,installed_at,version").all();
    return rows.map((row) => this.get(row.hash));
  }
  get(hash2) {
    const row = this.store.sqlite.prepare(`SELECT package_hash AS packageHash,app_id AS appId,version,resource_id AS resourceId,relative_path AS relativePath,manifest_json AS manifestJson,installed_at AS installedAt FROM capability_packages WHERE package_hash=?`).get(hash2);
    if (!row) throw new ApplicationError("NOT_FOUND", "应用版本记录不存在");
    const resource = this.store.get(row.resourceId);
    const manifest = parseManifest(JSON.parse(row.manifestJson));
    if (digest(canonicalJson(manifest)) !== hash2 || manifest.appId !== row.appId || manifest.version !== row.version || resource.contentHash !== hash2 || resource.kind !== "application-package" || resource.relativePath !== row.relativePath) throw new ApplicationError("HASH_MISMATCH", "应用版本记录与内容身份不一致");
    const { manifestJson: _, ...record } = row;
    return { ...record, manifest, state: resource.state };
  }
  active(appId) {
    return this.store.sqlite.prepare("SELECT package_hash AS packageHash,activation_generation AS generation FROM capability_active_packages WHERE app_id=?").get(appId) ?? null;
  }
  storeContracts(bundle) {
    for (const tool2 of bundle.manifest.tools) {
      const input = bundle.files[tool2.inputSchemaPath].toString("utf8"), output = bundle.files[tool2.outputSchemaPath].toString("utf8");
      const old = this.store.sqlite.prepare("SELECT input_source,output_source FROM capability_package_contracts WHERE package_hash=? AND tool_name=?").get(bundle.packageHash, tool2.name);
      if (old && (old.input_source !== input || old.output_source !== output)) throw new ApplicationError("HASH_MISMATCH", "固定工具契约记录已改变，不能静默覆盖");
      if (!old) this.store.sqlite.prepare("INSERT INTO capability_package_contracts VALUES(?,?,?,?)").run(bundle.packageHash, tool2.name, input, output);
    }
  }
  /** Retained exact source text is independently bound to the original manifest file hashes. */
  toolContractSources(hash2, toolName) {
    var _a;
    const application = this.get(hash2), tool2 = application.manifest.tools.find((t) => t.name === toolName);
    const row = this.store.sqlite.prepare("SELECT input_source,output_source FROM capability_package_contracts WHERE package_hash=? AND tool_name=?").get(hash2, toolName);
    if (!tool2 || !row) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原工具契约未留存，需从相同hash的可信完整包恢复");
    for (const [path2, source2] of [[tool2.inputSchemaPath, row.input_source], [tool2.outputSchemaPath, row.output_source]]) if (digest(source2) !== ((_a = application.manifest.files.find((f) => f.path === path2)) == null ? void 0 : _a.sha256)) throw new ApplicationError("HASH_MISMATCH", "原工具契约记录摘要不符，保留现场");
    return { input: row.input_source, output: row.output_source };
  }
  specification(bundle) {
    assertHostCompatible(bundle.manifest);
    this.runtimes.verify(bundle.manifest.runtime.hash, bundle.manifest.runtime);
    const { appId, version: version2 } = bundle.manifest, relativePath = `apps/${appId}/${version2}/${bundle.packageHash}`;
    return {
      resourceId: "app:" + bundle.packageHash,
      kind: "application-package",
      contentHash: bundle.packageHash,
      relativePath,
      dependencies: ["runtime:" + bundle.manifest.runtime.hash],
      materialize: (stage) => writePackageTree(stage, bundle, this.store.storeId),
      verify: (dir) => verifyPackageTree(dir, bundle, this.store.storeId),
      register: (operationId) => {
        var _a;
        const old = this.store.sqlite.prepare("SELECT package_hash AS hash FROM capability_packages WHERE app_id=? AND version=?").get(appId, version2);
        if (old && old.hash !== bundle.packageHash) throw new ApplicationError("VERSION_CONFLICT", "同一应用版本已有其他内容，需使用新版本");
        const now = (/* @__PURE__ */ new Date()).toISOString();
        this.store.sqlite.prepare(`INSERT INTO capability_packages(package_hash,app_id,version,hash_algorithm,relative_path,manifest_json,resource_id,installed_at) VALUES(?,?,?,'app-manifest-v1',?,?,?,?)`).run(bundle.packageHash, appId, version2, relativePath, canonicalJson(bundle.manifest), "app:" + bundle.packageHash, now);
        this.storeContracts(bundle);
        this.store.sqlite.prepare(`INSERT INTO capability_install_journal(install_id,host_build,from_generation,state,plan_json,updated_at) VALUES(?,?,?,'preparing',?,?)`).run(operationId, this.hostBuild, ((_a = this.active(appId)) == null ? void 0 : _a.generation) ?? 0, canonicalJson({ appId, version: version2, packageHash: bundle.packageHash }), now);
      }
    };
  }
  async install(source2) {
    const bundle = validateBundle(source2);
    const old = this.store.sqlite.prepare("SELECT package_hash AS hash FROM capability_packages WHERE app_id=? AND version=?").get(bundle.manifest.appId, bundle.manifest.version);
    if (old && old.hash !== bundle.packageHash) throw new ApplicationError("VERSION_CONFLICT", "同一应用版本已有其他内容，需使用新版本");
    await this.store.publish(this.specification(bundle));
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => this.storeContracts(bundle)).immediate());
    return this.get(bundle.packageHash);
  }
  async recoverInstall(source2, operationId) {
    const bundle = validateBundle(source2), recorded = this.get(bundle.packageHash);
    if (recorded.resourceId !== "app:" + bundle.packageHash) throw new ApplicationError("OWNERSHIP_CONFLICT", "恢复目标与原版本不一致");
    await this.store.recover(this.specification(bundle), operationId);
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => this.storeContracts(bundle)).immediate());
    return this.get(bundle.packageHash);
  }
  async activate(hash2, expectedGeneration) {
    return (await this.activateSet([{ hash: hash2, expectedGeneration }]))[0];
  }
  /** Hold all package leases, verify every tree, then commit the complete set.
   * Migration failure rolls back every default, generation and install receipt. */
  async activateSet(requests, maintenance) {
    const state = this.store.sqlite.prepare("SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1").get();
    if (maintenance) maintenance.assert();
    else if (state && (state.store_id !== this.store.storeId || state.maintenance_state !== "ready")) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "资源库维护尚未完成，不能激活默认版本");
    const selected = requests.map((request) => ({ ...request, package: this.get(request.hash) }));
    if (new Set(selected.map((item) => item.package.appId)).size !== selected.length) throw new ApplicationError("INVALID_INPUT", "同一激活集合不能重复包含应用");
    for (const item of selected) assertHostCompatible(item.package.manifest);
    const hold = async (index) => {
      if (index === selected.length) return withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
        var _a;
        (_a = maintenance == null ? void 0 : maintenance.assertCompatibility) == null ? void 0 : _a.call(maintenance);
        const result = selected.map((item2) => this.commitActivation(item2.package, item2.expectedGeneration, maintenance));
        maintenance == null ? void 0 : maintenance.recordCommit(result);
        return result;
      }).immediate());
      const item = selected[index];
      return this.store.use(item.package.resourceId, (maintenance == null ? void 0 : maintenance.operationId) ? "application-activation" : "ui", (maintenance == null ? void 0 : maintenance.operationId) ?? node_crypto.randomUUID(), async (directory) => {
        verifyPackageTree(directory, item.package, this.store.storeId);
        this.runtimes.verify(item.package.manifest.runtime.hash, item.package.manifest.runtime);
        return hold(index + 1);
      });
    };
    return hold(0);
  }
  commitActivation(selected, expectedGeneration, maintenance) {
    const state = this.store.sqlite.prepare("SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1").get();
    if (maintenance) maintenance.assert();
    else if (state && (state.store_id !== this.store.storeId || state.maintenance_state !== "ready")) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "资源库维护状态已变化");
    const hash2 = selected.packageHash;
    if (this.get(hash2).state !== "ready") throw new ApplicationError("RESOURCE_STATE_CHANGED", "目标应用版本尚未就绪");
    const old = this.active(selected.appId), generation = (old == null ? void 0 : old.generation) ?? 0;
    if (generation !== expectedGeneration) throw new ApplicationError("RESOURCE_STATE_CHANGED", "应用默认版本已变化，请重新查看升级计划");
    for (const migration of selected.manifest.migrations) {
      const applied = this.store.sqlite.prepare("SELECT checksum,from_version,to_version FROM capability_schema_migrations WHERE app_id=? AND migration_id=?").get(selected.appId, migration.id);
      if (applied) {
        if (applied.checksum !== migration.checksum || applied.from_version !== migration.from || applied.to_version !== migration.to) throw new ApplicationError("VERSION_CONFLICT", "已执行的应用迁移checksum发生变化");
        continue;
      }
      if ((old == null ? void 0 : old.packageHash) === hash2) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "当前默认应用缺失迁移记录，不能重复执行");
      const implementation = this.migrations.find((m) => m.appId === selected.appId && m.id === migration.id && m.checksum === migration.checksum);
      if (!implementation) throw new ApplicationError("HOST_INCOMPATIBLE", "当前程序缺少此版本的数据迁移实现");
      const result = implementation.run(this.store.sqlite);
      if (result instanceof Promise) throw new ApplicationError("HOST_INCOMPATIBLE", "应用数据迁移必须在短写事务内完成");
      this.store.sqlite.prepare(`INSERT INTO capability_schema_migrations(app_id,migration_id,checksum,from_version,to_version,applied_at,host_build) VALUES(?,?,?,?,?,?,?)`).run(selected.appId, migration.id, migration.checksum, migration.from, migration.to, (/* @__PURE__ */ new Date()).toISOString(), this.hostBuild);
    }
    if ((old == null ? void 0 : old.packageHash) === hash2) return old;
    const next = generation + 1;
    this.store.sqlite.prepare(`INSERT INTO capability_active_packages(app_id,package_hash,activation_generation,activated_at) VALUES(?,?,?,?) ON CONFLICT(app_id) DO UPDATE SET package_hash=excluded.package_hash,activation_generation=excluded.activation_generation,activated_at=excluded.activated_at`).run(selected.appId, hash2, next, (/* @__PURE__ */ new Date()).toISOString());
    this.store.sqlite.prepare("UPDATE capability_install_journal SET state='activated',to_generation=?,updated_at=? WHERE install_id=?").run(next, (/* @__PURE__ */ new Date()).toISOString(), this.store.get(selected.resourceId).operationId);
    return { packageHash: hash2, generation: next };
  }
}
function readLegacyOwnedTree(root, expectedHash) {
  try {
    const files = /* @__PURE__ */ Object.create(null);
    let count = 0, total = 0, visited = 0;
    const walk = (directory, depth) => {
      const dir = node_fs.lstatSync(directory);
      if (!dir.isDirectory() || dir.isSymbolicLink() || depth > 32 || ++visited > 4096) throw Error("legacy directory");
      const names = node_fs.readdirSync(directory);
      if (!names.length) throw Error("undeclared empty directory");
      for (const name2 of names) {
        const path2 = node_path.join(directory, name2), stat = node_fs.lstatSync(path2);
        if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) throw Error("legacy file");
        if (stat.isDirectory()) {
          walk(path2, depth + 1);
          continue;
        }
        if (++count > 4096 || stat.nlink !== 1 || (stat.mode & 73) !== 0 || stat.size > 4 * 1024 * 1024 || (total += stat.size) > 32 * 1024 * 1024) throw Error("legacy budget/ownership");
        const fd = node_fs.openSync(path2, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
        try {
          const before = node_fs.fstatSync(fd);
          if (before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size || before.ctimeMs !== stat.ctimeMs) throw Error("legacy changed");
          const buffer = Buffer.alloc(stat.size + 1);
          let length = 0;
          while (length < buffer.length) {
            const n = node_fs.readSync(fd, buffer, length, buffer.length - length, null);
            if (!n) break;
            length += n;
          }
          const bytes = buffer.subarray(0, length), after = node_fs.fstatSync(fd), text = bytes.toString("utf8");
          if (length !== stat.size || after.size !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs || !Buffer.from(text).equals(bytes)) throw Error("legacy changed bytes");
          files[node_path.relative(root, path2)] = text;
        } finally {
          node_fs.closeSync(fd);
        }
      }
    };
    walk(root, 0);
    const marker = JSON.parse(files[".smartdd-owned.json"]);
    if (marker.owner !== "SmartDD" || marker.schema !== 1 || Object.keys(marker).length !== 2) throw Error("legacy marker");
    delete files[".smartdd-owned.json"];
    if (treeHash(files) !== expectedHash) throw Error("legacy hash");
    return files;
  } catch {
    throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原M4完整资源或归属无法核验，不能从当前版本猜测补齐");
  }
}
class LegacyCapabilityResourceAdopter {
  constructor(store) {
    this.store = store;
  }
  read(relative2, expectedHash) {
    ensureStoreDirectory(this.store.root, node_path.dirname(relative2));
    return this.readDirectory(node_path.join(this.store.root, relative2), expectedHash);
  }
  readDirectory(root, expectedHash) {
    return readLegacyOwnedTree(root, expectedHash);
  }
  async adoptStandard(skillId, hash2) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(skillId) || !/^[a-f0-9]{64}$/.test(hash2)) throw new ApplicationError("INVALID_INPUT", "标准Skill身份无效");
    return this.adopt("standard-skill", `standard-skill:${skillId}:${hash2}`, `packages/${skillId}/${hash2}`, hash2);
  }
  async adoptRuntime(hash2) {
    if (!/^[a-f0-9]{64}$/.test(hash2)) throw new ApplicationError("INVALID_INPUT", "历史运行资源摘要无效");
    return this.adopt("legacy-runtime", "legacy-runtime:" + hash2, "runtime/" + hash2, hash2);
  }
  async adopt(kind, resourceId, relativePath, hash2) {
    const files = this.read(relativePath, hash2);
    return this.store.publish({ resourceId, kind, contentHash: hash2, relativePath, dependencies: [], materialize: (stage) => writeOwnedTree(stage, files, node_path.join(this.store.root, "conflicts")), verify: (directory) => {
      this.readDirectory(directory, hash2);
    } });
  }
  verify(resource) {
    if (!["standard-skill", "legacy-runtime"].includes(resource.kind) || resource.ownerStoreId !== this.store.storeId || resource.state !== "ready" || resource.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4资源尚未就绪");
    if (resource.kind === "standard-skill" && resource.relativePath !== "packages/" + resource.resourceId.slice("standard-skill:".length).replace(":", "/")) throw new ApplicationError("OWNERSHIP_CONFLICT", "标准Skill原路径不同");
    if (resource.kind === "legacy-runtime" && resource.relativePath !== "runtime/" + resource.contentHash) throw new ApplicationError("OWNERSHIP_CONFLICT", "历史运行资源原路径不同");
    return this.read(resource.relativePath, resource.contentHash);
  }
}
function projectSkillName(input, name2) {
  if (!Buffer.from(input.toString("utf8"), "utf8").equals(input)) throw new ApplicationError("INVALID_PACKAGE", "Skill入口必须为完整UTF-8文本");
  const text = input.toString("utf8"), front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!front) throw new ApplicationError("INVALID_PACKAGE", "Skill入口缺少元数据");
  const doc = yaml.parseDocument(front[1], { uniqueKeys: true, logLevel: "silent" });
  if (doc.errors.length || typeof doc.get("name") !== "string" || typeof doc.get("description") !== "string") throw new ApplicationError("INVALID_PACKAGE", "Skill元数据无效");
  doc.set("name", name2);
  return Buffer.from("---\n" + doc.toString() + "---\n" + text.slice(front[0].length), "utf8");
}
const owners = /* @__PURE__ */ new Map();
function pins(snapshot) {
  const { selfCheck: _check, ...fixed } = snapshot;
  return digest(canonicalJson(fixed));
}
function registerOriginalRun(root, snapshot, cleanup) {
  const canonical = node_fs.realpathSync(root);
  if (owners.has(canonical)) throw new Error("原运行目录已有另一释放句柄");
  const owner = { pins: pins(snapshot), phase: "remove", released: false, cleanup };
  owners.set(canonical, owner);
  return () => {
    owner.released = true;
    cleanup(owner.phase);
    if (owner.phase !== "hold" && owners.get(canonical) === owner) owners.delete(canonical);
  };
}
function retainOriginalRun(root, snapshot, phase) {
  let canonical;
  try {
    canonical = node_fs.realpathSync(root);
  } catch {
    return false;
  }
  const owner = owners.get(canonical);
  if (!owner || owner.pins !== pins(snapshot)) return false;
  if (phase === "intent" && owner.phase === "remove") owner.phase = "hold";
  if (phase === "committed") owner.phase = "retain-plugin";
  if (owner.released && owner.phase === "retain-plugin") {
    owner.cleanup(owner.phase);
    if (owners.get(canonical) === owner) owners.delete(canonical);
  }
  return true;
}
const MCP_CAPABILITY = "smartdd-project-context";
const json = (value) => JSON.stringify(value, null, 2) + "\n";
const envId = (id2) => id2.replace(/[^A-Za-z0-9]/g, "_").toUpperCase();
class CapabilityService {
  constructor(d) {
    __publicField(this, "bundles");
    __publicField(this, "root");
    __publicField(this, "backupRoot");
    __publicField(this, "runtimeRoot");
    __publicField(this, "activeRuns", /* @__PURE__ */ new Set());
    __publicField(this, "managedRuns", /* @__PURE__ */ new Set());
    __publicField(this, "runCleanups", /* @__PURE__ */ new Map());
    this.d = d;
    this.bundles = d.bundles ?? BUNDLED_SKILLS;
    this.root = node_path.join(d.userData, "capabilities");
    this.backupRoot = node_path.join(this.root, "conflicts");
    const scripts = runtimeFiles();
    this.runtimeRoot = node_path.join(this.root, "runtime", treeHash(scripts));
    writeOwnedTree(this.runtimeRoot, scripts, this.backupRoot);
    for (const bundle of this.bundles) this.install(bundle);
  }
  install(bundle) {
    const id2 = `${bundle.id}:${bundle.hash}`;
    writeOwnedTree(this.packageRoot(id2), bundle.files, this.backupRoot);
    if (this.d.db.select().from(skillVersions).where(drizzleOrm.eq(skillVersions.id, id2)).get()) return;
    const active = !this.d.db.select().from(skillVersions).where(drizzleOrm.and(drizzleOrm.eq(skillVersions.skillId, bundle.id), drizzleOrm.eq(skillVersions.active, true))).get();
    this.d.db.insert(skillVersions).values({ id: id2, skillId: bundle.id, name: bundle.name, version: bundle.version, hash: bundle.hash, installedAt: Date.now(), active }).run();
  }
  packageRoot(id2) {
    if (!/^[a-z0-9-]+:[a-f0-9]{64}$/.test(id2)) throw new Error("Skill 版本标识无效");
    return node_path.join(this.root, "packages", id2.replace(":", "/"));
  }
  list(projectId) {
    if (projectId) this.d.projects.getProject(projectId);
    const installed = this.d.db.select().from(skillVersions).all();
    return this.bundles.map((bundle) => {
      const versions = installed.filter((v) => v.skillId === bundle.id);
      const current = versions.find((v) => v.active);
      if (!current) throw new Error(`Skill 没有活动版本：${bundle.id}`);
      return {
        id: bundle.id,
        name: bundle.name,
        description: bundle.description,
        source: bundle.source,
        enabled: projectId ? this.enabled(projectId, bundle.id) : true,
        current,
        versions,
        availableVersion: bundle.version,
        updateAvailable: current.hash !== bundle.hash
      };
    });
  }
  enabled(projectId, capabilityId) {
    var _a;
    return ((_a = this.d.db.select().from(projectCapabilities).where(drizzleOrm.eq(projectCapabilities.id, `${projectId}:${capabilityId}`)).get()) == null ? void 0 : _a.enabled) ?? true;
  }
  setEnabled(projectId, capabilityId, enabled) {
    this.d.projects.getProject(projectId);
    if (typeof enabled !== "boolean" || !this.bundles.some((s) => s.id === capabilityId) && capabilityId !== MCP_CAPABILITY) throw new Error("能力设置无效");
    this.d.db.transaction(() => {
      const id2 = `${projectId}:${capabilityId}`;
      this.d.db.insert(projectCapabilities).values({ id: id2, projectId, capabilityId, enabled }).onConflictDoUpdate({ target: projectCapabilities.id, set: { enabled } }).run();
      this.d.db.update(projects).set({ configVersion: drizzleOrm.sql`${projects.configVersion} + 1`, updatedAt: Date.now() }).where(drizzleOrm.eq(projects.id, projectId)).run();
    });
  }
  upgrade(skillId) {
    const bundle = this.bundles.find((s) => s.id === skillId);
    if (!bundle) throw new Error("未知标准 Skill");
    this.install(bundle);
    this.d.db.transaction(() => {
      this.d.db.update(skillVersions).set({ active: false }).where(drizzleOrm.eq(skillVersions.skillId, skillId)).run();
      this.d.db.update(skillVersions).set({ active: true }).where(drizzleOrm.eq(skillVersions.id, `${skillId}:${bundle.hash}`)).run();
    });
  }
  preview(projectId, profile, base, cwd) {
    var _a, _b;
    const project = projectId ? this.d.projects.getProject(projectId) : void 0;
    const env = { ...base, ...profile.env };
    const home = env.HOME || node_os.homedir();
    const dir = cwd ?? ((_a = project == null ? void 0 : project.dirs.find((d) => d.isDefault)) == null ? void 0 : _a.path) ?? ((_b = project == null ? void 0 : project.dirs[0]) == null ? void 0 : _b.path) ?? home;
    const skills = this.list(projectId);
    const issues = [];
    if (skills.some((s) => s.id === "project-db-diagnostics" && s.enabled)) {
      for (const db of (project == null ? void 0 : project.databases) ?? []) if (!db.hasPassword) issues.push(`数据库「${db.label || db.database}」未保存密码`);
    }
    if (skills.some((s) => s.id === "remote-password-ssh" && s.enabled)) {
      for (const server of (project == null ? void 0 : project.servers) ?? []) {
        if (server.authType === "password" && !server.hasPassword) issues.push(`服务器「${server.label || server.host}」未保存密码`);
        if (server.authType === "key" && (!server.privateKeyPath || !node_fs.existsSync(server.privateKeyPath))) issues.push(`服务器「${server.label || server.host}」私钥不可用`);
        if (server.sudoPolicy === "separate" && !server.hasSudoPassword) issues.push(`服务器「${server.label || server.host}」未保存 sudo 密码`);
      }
    }
    return {
      skills,
      mcpEnabled: projectId ? this.enabled(projectId, MCP_CAPABILITY) : true,
      issues,
      discovered: discoverCapabilities({
        runner: profile.runner,
        cwd: dir,
        home,
        stateRoot: stateRootFor(profile.runner, profile.env, base),
        claudeConfigExplicit: Boolean(env.CLAUDE_CONFIG_DIR),
        path: env.PATH ?? "",
        args: profile.args
      })
    };
  }
  selection(projectId, previous) {
    if ((previous == null ? void 0 : previous.projectId) === projectId) return previous.skills.map((s) => ({ ...s }));
    return this.list(projectId).map((s) => ({ skillId: s.id, name: s.name, versionId: s.current.id, version: s.current.version, hash: s.current.hash, path: "", enabled: s.enabled, loaded: "unverified" }));
  }
  runtimeIdentity() {
    return { hash: this.runtimeRoot.split("/").at(-1), path: node_fs.realpathSync(this.runtimeRoot) };
  }
  prepare(input) {
    var _a, _b, _c, _d, _e;
    const project = this.d.projects.getProject(input.projectId);
    if (!node_path.isAbsolute(input.home)) throw new Error("HOME 必须是绝对路径");
    if (!input.managed && input.runner === "codex" && input.profileArgs.some((a) => /^skills(?:\.|\s*=)/.test(a.trim()))) throw new Error("AI 配置包含 skills 覆盖参数，请移除后使用项目能力开关");
    const previous = ((_a = input.previous) == null ? void 0 : _a.projectId) === project.id ? input.previous : null;
    const selected = input.managed ? input.managed.skills.map((s) => ({ ...s })) : this.selection(project.id, previous);
    const capabilityRoot = input.managed ? node_fs.realpathSync(this.root) : this.root;
    if (input.managed && (!/^[a-f0-9-]{36}$/.test(input.managed.runId) || !/^[a-f0-9]{64}$/.test(input.managed.runtimeHash) || input.managed.mcpName !== null && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(input.managed.mcpName))) throw new Error("受管运行或原上下文桥身份无效");
    const runtimeRoot = input.managed ? node_path.join(capabilityRoot, "runtime", input.managed.runtimeHash) : this.runtimeRoot;
    const scriptFiles = input.managed ? readOwnedTree(runtimeRoot) : runtimeFiles();
    if (input.managed && treeHash(scriptFiles) !== input.managed.runtimeHash) throw new Error("原标准运行资源已改变，不能使用当前版本替代");
    const packages = selected.map((s) => {
      if (input.managed && !s.enabled) return { selection: s, files: {} };
      const v = this.d.db.select().from(skillVersions).where(drizzleOrm.eq(skillVersions.id, s.versionId)).get();
      if (!v || v.skillId !== s.skillId || v.hash !== s.hash) throw new Error("原任务的 Skill 版本不可用，不能静默替换");
      const files2 = readOwnedTree(this.packageRoot(v.id));
      if (treeHash(files2) !== v.hash) throw new Error(`Skill 版本内容已改变：${v.name}`);
      return { selection: s, files: files2 };
    });
    const runId = ((_b = input.managed) == null ? void 0 : _b.runId) ?? node_crypto.randomUUID();
    const runRoot = node_path.join(capabilityRoot, "runs", project.id, input.taskId, runId);
    const auditPath = node_path.join(capabilityRoot, "resource-audit", project.id, `${input.taskId}.jsonl`);
    node_fs.mkdirSync(node_path.dirname(auditPath), { recursive: true, mode: 448 });
    const hasSkill = (id2) => selected.some((s) => s.skillId === id2 && s.enabled);
    const env = {};
    const secretValues = [];
    const bindSecret = (name2, key, required2 = true) => {
      const value = this.d.secrets.get(key);
      if (value === null) {
        if (required2) throw new Error(`缺少凭据：${name2}。请在项目配置中保存后重试`);
        return void 0;
      }
      env[name2] = value;
      secretValues.push(value);
      return name2;
    };
    const databases = hasSkill("project-db-diagnostics") ? project.databases.map((db) => ({
      key: db.id,
      resourceId: db.id,
      projectId: project.id,
      name: db.label,
      label: db.label,
      aliases: db.aliases,
      environment: db.env,
      type: DB_VENDORS[db.vendor].transport,
      vendor: db.vendor,
      host: db.host,
      port: db.port,
      database: db.database,
      schema: db.schema,
      username: db.username,
      accessLevel: db.accessLevel,
      passwordEnv: bindSecret(`SMARTDD_DB_${envId(db.id)}_PASSWORD`, secretKeys.databasePassword(db.id))
    })) : [];
    const readablePaths = [];
    const servers = hasSkill("remote-password-ssh") ? project.servers.map((s) => {
      const keys = secretKeys.serverKeys(s.id);
      if (s.authType === "key") {
        if (!s.privateKeyPath || !node_path.isAbsolute(s.privateKeyPath) || !node_fs.existsSync(s.privateKeyPath) || !node_fs.statSync(s.privateKeyPath).isFile()) throw new Error(`私钥路径不可用：${s.label || s.id}`);
        readablePaths.push(s.privateKeyPath);
      }
      const prefix = `SMARTDD_SSH_${envId(s.id)}_`;
      const passwordEnv = s.authType === "password" || s.sudoPolicy === "same-as-login" ? bindSecret(prefix + "PASSWORD", keys.password) : void 0;
      return {
        resourceId: s.id,
        projectId: project.id,
        ip: s.host,
        port: s.port,
        username: s.username,
        alias: s.label || s.id,
        aliases: [s.id, ...s.aliases],
        environment: s.env,
        authType: s.authType,
        privateKeyPath: s.privateKeyPath,
        passwordEnv,
        passphraseEnv: s.authType === "key" ? bindSecret(prefix + "PASSPHRASE", keys.passphrase, false) : void 0,
        sudoPasswordEnv: s.sudoPolicy === "separate" ? bindSecret(prefix + "SUDO", keys.sudo) : s.sudoPolicy === "same-as-login" ? passwordEnv : void 0,
        defaultRoot: s.defaultRoot,
        sudoPolicy: s.sudoPolicy,
        appRoot: s.appRoot,
        logsPath: s.logsPath,
        deployments: s.logsPath ? { app: { modules: { app: { applicationName: s.label || "app", logs: { primary: s.logsPath } } } } } : {}
      };
    }) : [];
    const config = { schemaVersion: 1, projectId: project.id, configVersion: project.configVersion, databases, servers };
    const configHash = sha256(json(config));
    const metadata = { schemaVersion: 1, projectId: project.id, configVersion: project.configVersion, configHash };
    const files = {};
    const pathEnv = {};
    if (hasSkill("project-db-diagnostics")) {
      files["databases.json"] = json({ ...metadata, projects: [{ key: project.id, aliases: [project.name, ...project.aliases], roots: project.dirs.map((d) => d.path), defaultDatabase: (_c = project.databases.find((d) => d.isDefault)) == null ? void 0 : _c.id, databases }] });
      pathEnv.PROJECT_DB_CONFIG = node_path.join(runRoot, "databases.json");
    }
    if (hasSkill("remote-password-ssh")) {
      files["servers.json"] = json({ ...metadata, servers });
      pathEnv.REMOTE_SERVERS_CONFIG = node_path.join(runRoot, "servers.json");
    }
    const args = [];
    if (input.managed) {
      for (const { selection, files: source2 } of packages) if (selection.enabled) {
        const projection = input.managed.projections[selection.versionId];
        if (!projection || !node_path.isAbsolute(projection.path) || !projection.path.endsWith("/SKILL.md") || !/^[a-z][a-z0-9-]{0,63}$/.test(projection.nativeName) || Object.keys(projection.files).sort().join("\n") !== Object.keys(source2).sort().join("\n")) throw new Error("原标准Skill完整投影未准备好");
        for (const [name2, text] of Object.entries(source2)) {
          const expected = name2 === "SKILL.md" && projection.format !== "legacy-tree-v1" ? projectSkillName(Buffer.from(text), projection.nativeName) : Buffer.from(text);
          if (name2 === "SKILL.md" && projection.format === "legacy-tree-v1") {
            const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text), doc = front ? yaml.parseDocument(front[1], { uniqueKeys: true, logLevel: "silent" }) : null;
            if (!doc || doc.errors.length || doc.get("name") !== projection.nativeName || treeHash(source2) !== selection.hash) throw new Error("原标准Skill名称或完整来源不同");
          }
          if (!expected.equals(Buffer.from(projection.files[name2])) || !node_fs.readFileSync(node_path.join(node_path.dirname(projection.path), name2)).equals(expected)) throw new Error("原标准Skill投影内容不同");
        }
        selection.name = projection.nativeName;
        selection.path = projection.path;
      }
    } else if (input.runner === "claude") {
      files["plugin/.claude-plugin/plugin.json"] = json({ name: "smartdd", version: "1.0.0", description: "WillYou project capabilities" });
      for (const { selection, files: source2 } of packages) if (selection.enabled) {
        for (const [path2, content] of Object.entries(source2)) files[`plugin/skills/${selection.skillId}/${path2}`] = content;
        selection.path = node_path.join(runRoot, "plugin", "skills", selection.skillId, "SKILL.md");
      }
      if (selected.some((s) => s.enabled)) args.push("--plugin-dir", node_path.join(runRoot, "plugin"));
    } else {
      const skillsRoot = node_path.join(input.home, ".agents", "skills");
      for (const version2 of this.d.db.select().from(skillVersions).all()) {
        const source2 = readOwnedTree(this.packageRoot(version2.id));
        if (treeHash(source2) !== version2.hash) throw new Error(`Skill 版本内容已改变：${version2.name}`);
        writeOwnedTree(node_path.join(skillsRoot, `smartdd-${version2.skillId}-${version2.hash.slice(0, 16)}`), source2, this.backupRoot);
      }
      for (const { selection, files: source2 } of packages) {
        if (!selection.enabled) continue;
        const target = node_path.join(skillsRoot, `smartdd-${selection.skillId}-${selection.hash.slice(0, 16)}`);
        writeOwnedTree(target, source2, this.backupRoot);
        selection.path = node_path.join(target, "SKILL.md");
      }
      const all = node_fs.existsSync(skillsRoot) ? node_fs.readdirSync(skillsRoot).filter((n) => /^smartdd-[a-z0-9-]+-[a-f0-9]{16}$/.test(n)).flatMap((n) => {
        const path2 = node_path.join(skillsRoot, n);
        try {
          if (JSON.parse(node_fs.readFileSync(node_path.join(path2, ".smartdd-owned.json"), "utf8")).owner === "SmartDD") return [node_path.join(path2, "SKILL.md")];
        } catch {
        }
        return [];
      }) : [];
      const config2 = all.map((path2) => `{path=${JSON.stringify(path2)},enabled=${selected.some((s) => s.enabled && s.path === path2)}}`).join(",");
      if (all.length) args.push("-c", `skills.config=[${config2}]`);
    }
    const mcpEnabled = input.managed ? input.managed.mcpName !== null && this.enabled(project.id, MCP_CAPABILITY) : previous ? previous.mcp.length > 0 : this.enabled(project.id, MCP_CAPABILITY);
    const mcpName = ((_d = input.managed) == null ? void 0 : _d.mcpName) ?? ((_e = previous == null ? void 0 : previous.mcp[0]) == null ? void 0 : _e.name) ?? `smartdd_project_${runId.replaceAll("-", "").slice(0, 12)}`;
    if (mcpEnabled && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mcpName)) throw new Error("原上下文桥名称无效，不能改名重建");
    files["context.json"] = json({
      ...metadata,
      name: project.name,
      databases: databases.map(({ resourceId, environment, type, host, port: port2, database, schema: schema2, username, accessLevel }) => ({ resourceId, environment, type, host, port: port2, database, schema: schema2, username, accessLevel })),
      servers: servers.map(({ resourceId, environment, ip, port: port2, username, appRoot, logsPath }) => ({ resourceId, environment, host: ip, port: port2, username, appRoot, logsPath })),
      skills: selected.filter((s) => s.enabled).map(({ name: name2, path: path2, version: version2 }) => ({ name: name2, path: path2, version: version2 })),
      configPaths: pathEnv,
      rulesPath: project.rulesPath
    });
    pathEnv.SMARTDD_PROJECT_CONTEXT = node_path.join(runRoot, "context.json");
    pathEnv.SMARTDD_RESOURCE_AUDIT = auditPath;
    if (mcpEnabled && !input.managed) {
      const mcpArgs = [node_path.join(runtimeRoot, "context_mcp.py"), node_path.join(runRoot, "context.json")];
      if (input.runner === "claude") {
        files["mcp.json"] = json({ mcpServers: { [mcpName]: { command: "python3", args: mcpArgs } } });
        args.push("--mcp-config", node_path.join(runRoot, "mcp.json"));
      } else {
        args.push("-c", `mcp_servers.${mcpName}.command="python3"`, "-c", `mcp_servers.${mcpName}.args=${JSON.stringify(mcpArgs)}`);
      }
    }
    Object.assign(env, pathEnv, { SMARTDD_PROJECT_ID: project.id, SMARTDD_CONFIG_VERSION: String(project.configVersion) });
    const hashes = Object.fromEntries(Object.entries(files).map(([path2, content]) => [node_path.join(runRoot, path2), sha256(content)]));
    for (const [name2, content] of Object.entries(scriptFiles)) hashes[node_path.join(runtimeRoot, name2)] = sha256(content);
    if (input.managed) {
      for (const selection of selected) if (selection.enabled) {
        const p = input.managed.projections[selection.versionId];
        for (const [name2, bytes] of Object.entries(p.files)) hashes[node_path.join(node_path.dirname(p.path), name2)] = sha256(Buffer.from(bytes));
      }
    }
    for (const { selection, files: source2 } of packages) if (!input.managed && input.runner === "codex" && selection.enabled) for (const [name2, content] of Object.entries(source2)) hashes[node_path.join(node_path.dirname(selection.path), name2)] = sha256(content);
    const manifestPath = node_path.join(runRoot, "manifest.json");
    const manifest = json({
      ...metadata,
      runId,
      files: hashes,
      requiredEnv: Object.keys(env),
      pathEnv: { ...pathEnv, SMARTDD_PROJECT_ID: project.id, SMARTDD_CONFIG_VERSION: String(project.configVersion) },
      pythonModules: [...new Set(databases.map((d) => d.type === "mysql" ? "pymysql" : "psycopg2"))],
      commands: servers.length ? ["ssh"] : [],
      readablePaths
    });
    files["manifest.json"] = manifest;
    writeOwnedTree(runRoot, files, this.backupRoot);
    this.activeRuns.add(runRoot);
    if (input.managed) this.managedRuns.add(runRoot);
    const snapshot = {
      runId,
      projectId: project.id,
      configVersion: project.configVersion,
      configHash,
      manifestPath,
      auditPath,
      skills: selected,
      mcp: mcpEnabled ? [{ name: mcpName, loaded: "unverified" }] : [],
      selfCheck: { status: "pending", issues: [], at: null }
    };
    const ownedRoot = node_fs.lstatSync(runRoot);
    const cleanup = (mode) => {
      try {
        if (!node_fs.existsSync(runRoot)) return;
        const current = node_fs.lstatSync(runRoot);
        if (!current.isDirectory() || current.isSymbolicLink() || current.dev !== ownedRoot.dev || current.ino !== ownedRoot.ino) return;
        if (mode === "hold") return;
        if (mode === "retain-plugin") {
          const actual = readOwnedTree(runRoot), known = /* @__PURE__ */ new Set([...Object.keys(files), "self-check.json"]);
          if (Object.keys(actual).some((name2) => !known.has(name2)) || Object.entries(files).some(([name2, bytes]) => actual[name2] !== bytes)) return;
          const directories = /* @__PURE__ */ new Set();
          for (const name2 of Object.keys(files)) for (let parent = node_path.dirname(name2); parent !== "."; parent = node_path.dirname(parent)) directories.add(parent);
          for (const dir of ["", ...directories]) for (const name2 of node_fs.readdirSync(node_path.join(runRoot, dir))) {
            const path2 = node_path.join(dir, name2);
            if (node_fs.lstatSync(node_path.join(runRoot, path2)).isDirectory() && !directories.has(path2)) return;
          }
          const marker = ".smartdd-owned.json";
          if (node_fs.readFileSync(node_path.join(runRoot, marker), "utf8") !== JSON.stringify({ owner: "SmartDD", schema: 1 })) return;
          for (const name2 of [...Object.keys(actual), marker]) {
            const leaf = node_fs.lstatSync(node_path.join(runRoot, name2));
            if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.nlink !== 1) return;
          }
          for (const name2 of [...Object.keys(files), "self-check.json"]) {
            if (name2.startsWith("plugin/")) continue;
            if (name2.includes("/")) return;
            node_fs.rmSync(node_path.join(runRoot, name2), { force: true });
          }
        } else node_fs.rmSync(runRoot, { recursive: true, force: true });
      } catch {
      }
    };
    const releaseOwned = input.managed ? () => cleanup("remove") : registerOriginalRun(runRoot, snapshot, cleanup);
    const release = () => {
      releaseOwned();
      this.activeRuns.delete(runRoot);
      this.managedRuns.delete(runRoot);
      this.runCleanups.delete(runRoot);
    };
    this.runCleanups.set(runRoot, release);
    const allowedIssues = /* @__PURE__ */ new Set([
      "file_hash_mismatch",
      "file_unreadable",
      "resource_path_unreadable",
      "manifest_hash_mismatch",
      "manifest_invalid",
      "runner_not_found",
      "self_check_report_failed",
      ...Object.keys(env).map((n) => `missing_env:${n}`),
      ...Object.keys(pathEnv).concat(["SMARTDD_PROJECT_ID", "SMARTDD_CONFIG_VERSION"]).map((n) => `wrong_path_env:${n}`),
      "missing_dependency:pymysql",
      "missing_dependency:psycopg2",
      "missing_command:ssh"
    ]);
    return {
      args,
      env,
      secretValues,
      snapshot,
      wrap: (command, cliArgs) => ({ command: "python3", args: [node_path.join(runtimeRoot, "launch.py"), manifestPath, sha256(manifest), command, ...cliArgs] }),
      check: () => {
        const file = node_path.join(runRoot, "self-check.json");
        if (!node_fs.existsSync(file)) return null;
        try {
          const report = JSON.parse(node_fs.readFileSync(file, "utf8"));
          if (!["passed", "failed"].includes(report.status) || !Array.isArray(report.issues) || !report.issues.every((i) => typeof i === "string" && allowedIssues.has(i)) || report.status === "passed" && report.issues.length > 0) throw new Error();
          return { status: report.status, issues: report.issues, at: typeof report.at === "number" ? report.at : Date.now() };
        } catch {
          return { status: "failed", issues: ["self_check_report_invalid"], at: Date.now() };
        }
      },
      release
    };
  }
  dispose() {
    var _a;
    for (const root of [...this.activeRuns]) if (!this.managedRuns.has(root)) (_a = this.runCleanups.get(root)) == null ? void 0 : _a();
  }
}
const SELECT$1 = `SELECT resource_id AS resourceId,kind,content_hash AS contentHash,owner_store_id AS ownerStoreId,relative_path AS rawRelativePath,scope_relative_path AS physicalAliasPath,
  COALESCE(scope_relative_path,relative_path) AS relativePath,path_scope AS pathScope,CASE WHEN path_scope='C' THEN owner_store_id ELSE scope_identity END AS scopeIdentity,state,generation,integrity,operation_id AS operationId FROM capability_resources`;
class ResourceStore {
  constructor(sqlite, userData, checkpoint, options = {}) {
    __publicField(this, "root");
    __publicField(this, "storeId");
    __publicField(this, "instanceId", node_crypto.randomUUID());
    __publicField(this, "activeOperations", /* @__PURE__ */ new Set());
    __publicField(this, "host");
    var _a;
    this.sqlite = sqlite;
    this.checkpoint = checkpoint;
    this.options = options;
    const host = (_a = options.processes) == null ? void 0 : _a.read(process.pid);
    this.host = host && host.pid === process.pid && /^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(host.startedAt) ? { ...host } : null;
    node_fs.mkdirSync(userData, { recursive: true, mode: 448 });
    const parent = node_fs.realpathSync(userData);
    try {
      node_fs.mkdirSync(node_path.join(parent, "capabilities"), { mode: 448 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    this.root = node_path.join(parent, "capabilities");
    if (node_fs.lstatSync(this.root).isSymbolicLink() || !node_fs.lstatSync(this.root).isDirectory()) throw new ApplicationError("OWNERSHIP_CONFLICT", "应用资源根被其他内容占用");
    const owner = node_path.join(this.root, ".store-id.json");
    try {
      node_fs.writeFileSync(owner, canonicalJson({ schema: 1, storeId: node_crypto.randomUUID() }) + "\n", { mode: 384, flag: "wx" });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    try {
      if (node_fs.lstatSync(owner).isSymbolicLink()) throw new Error();
      const info = JSON.parse(node_fs.readFileSync(owner, "utf8"));
      if (info.schema !== 1 || !/^[a-f0-9-]{36}$/.test(info.storeId)) throw new Error();
      this.storeId = info.storeId;
    } catch {
      throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "应用资源库身份无法核验");
    }
  }
  get(id2) {
    const found = this.sqlite.prepare(SELECT$1 + " WHERE resource_id=?").get(id2);
    if (!found) throw new ApplicationError("NOT_FOUND", "应用资源记录不存在");
    const { rawRelativePath, physicalAliasPath, ...row } = found;
    if (["claude-delivery-root", "claude-delivery"].includes(row.kind) && (!physicalAliasPath || row.pathScope !== "C")) throw new ApplicationError("OWNERSHIP_CONFLICT", "Claude交付缺少显式物理位置");
    if (row.pathScope === "C" && physicalAliasPath) {
      const match = /^sessions\/([A-Za-z0-9][A-Za-z0-9_-]{0,127})\/claude\/plugin$/.exec(physicalAliasPath), taskId = match == null ? void 0 : match[1];
      if (!taskId || !(row.kind === "claude-delivery-root" && row.resourceId === "claude-delivery-root:" + taskId && rawRelativePath === `claude-deliveries/${taskId}/anchor` || row.kind === "claude-delivery" && row.resourceId === `claude-delivery:${taskId}:${row.contentHash}` && rawRelativePath === `claude-deliveries/${taskId}/records/${row.contentHash}`)) throw new ApplicationError("OWNERSHIP_CONFLICT", "C目录物理别名不属于已登记的Claude交付种类");
    }
    if (!row) throw new ApplicationError("NOT_FOUND", "应用资源记录不存在");
    if (row.ownerStoreId !== this.storeId || !isPackagePath(row.relativePath)) throw new ApplicationError("OWNERSHIP_CONFLICT", "应用资源归属不一致");
    if (!["C", "H"].includes(row.pathScope) || row.pathScope === "H" && (!APP_HASH_PATTERN.test(row.scopeIdentity) || !row.relativePath.startsWith(".agents/skills/"))) throw new ApplicationError("OWNERSHIP_CONFLICT", "资源位置范围无法核验");
    return row;
  }
  directory(resource) {
    if (resource.pathScope === "C") return node_path.join(this.root, resource.relativePath);
    const home = this.sqlite.prepare("SELECT canonical_home AS home FROM capability_discovery_roots WHERE home_id=?").get(resource.scopeIdentity);
    if (!home || digest(home.home) !== resource.scopeIdentity || node_fs.realpathSync(home.home) !== home.home || !resource.relativePath.startsWith(".agents/skills/")) throw new ApplicationError("OWNERSHIP_CONFLICT", "共享投影的实际发现根无法核验");
    return node_path.join(home.home, resource.relativePath);
  }
  checkSpec(spec) {
    if (!/^[a-z][a-z0-9:._-]{0,199}$/.test(spec.resourceId) || !isPackagePath(spec.relativePath) || !APP_HASH_PATTERN.test(spec.contentHash) || new Set(spec.dependencies).size !== spec.dependencies.length || spec.dependencies.includes(spec.resourceId)) throw new ApplicationError("INVALID_PACKAGE", "资源发布声明无效");
  }
  assertDependencies(ids) {
    for (const id2 of ids) {
      const resource = this.get(id2);
      if (resource.state !== "ready" || resource.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "应用依赖尚未就绪");
    }
  }
  assertRecordedDependencies(spec) {
    const actual = this.sqlite.prepare("SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id").all(spec.resourceId).map((r) => r.dependency_id);
    if (canonicalJson(actual) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原资源的依赖集合已经变化");
    this.assertDependencies(spec.dependencies);
  }
  assertIdentity(row, spec) {
    if (row.pathScope !== "C" || row.kind !== spec.kind || row.contentHash !== spec.contentHash || row.relativePath !== spec.relativePath) throw new ApplicationError("OWNERSHIP_CONFLICT", "资源标识与发布身份不一致");
  }
  lease(resourceId, operationId, kind = "install", identity2, leaseId = node_crypto.randomUUID()) {
    var _a;
    this.sqlite.prepare(`INSERT INTO capability_resource_leases
      (lease_id,resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state,created_at)
      VALUES(?,?,?,?,?,?,?, 'active',?)`).run(leaseId, resourceId, kind, operationId, this.instanceId, process.pid, (identity2 == null ? void 0 : identity2.startedAt) ?? ((_a = this.host) == null ? void 0 : _a.startedAt) ?? new Date(Date.now() - process.uptime() * 1e3).toISOString(), (/* @__PURE__ */ new Date()).toISOString());
    return leaseId;
  }
  publicationPlan(spec, leaseId) {
    if (this.options.processes && !this.host) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "无法核验发布宿主的内核身份，保留原资源");
    return canonicalJson({ resourceId: spec.resourceId, hash: spec.contentHash, relativePath: spec.relativePath, dependencies: [...spec.dependencies].sort(), instanceId: this.instanceId, pid: process.pid, host: this.host, leaseId });
  }
  assertOwnPublisher(resourceId, operationId, leaseId) {
    const row = this.sqlite.prepare("SELECT resource_id,owner_kind,owner_id,host_instance_id,pid,process_started_at,state FROM capability_resource_leases WHERE lease_id=?").get(leaseId);
    if (!row || row.resource_id !== resourceId || row.owner_kind !== "install" || row.owner_id !== operationId || row.host_instance_id !== this.instanceId || row.pid !== process.pid || this.host && row.process_started_at !== this.host.startedAt || row.state !== "active") throw new ApplicationError("RESOURCE_BUSY", "当前资源发布占用已经变化，保留原记录");
  }
  endLease(leaseId) {
    this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND host_instance_id=?").run((/* @__PURE__ */ new Date()).toISOString(), leaseId, this.instanceId);
  }
  phase(operationId, state, code = null) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    this.sqlite.prepare("UPDATE capability_resource_operations SET state=?,error_code=?,updated_at=? WHERE operation_id=? AND owner_store_id=?").run(state, code, now, operationId, this.storeId);
    this.sqlite.prepare("UPDATE capability_install_journal SET state=?,error_code=?,updated_at=? WHERE install_id=?").run(state, code, now, operationId);
  }
  async use(resourceId, ownerKind, ownerId, action, options = {}) {
    if (options.identity && (options.identity.pid !== process.pid || !/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(options.identity.startedAt))) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "资源活动进程身份无效");
    let leaseId = "", directory = "";
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      const rows = this.sqlite.prepare(`WITH RECURSIVE needed(id) AS (VALUES(?) UNION SELECT d.dependency_id FROM capability_resource_dependencies d JOIN needed n ON d.resource_id=n.id) SELECT id FROM needed`).all(resourceId);
      this.assertDependencies(rows.map((r) => r.id));
      const resource = this.get(resourceId);
      if (resource.pathScope !== "C") throw new ApplicationError("OWNERSHIP_CONFLICT", "共享发现资源须先取得对应H目录占用");
      directory = this.directory(resource);
      leaseId = this.lease(resourceId, ownerId, ownerKind, options.identity);
    }).immediate());
    try {
      return await action(directory);
    } finally {
      await withResourceLock(this.root, () => this.endLease(leaseId));
    }
  }
  /** Only exact activation-owned leases with a stopped kernel identity can end. */
  async recoverActivationLeases(operationId, maintenance) {
    const assertMaintenance = () => {
      maintenance.assertHeld();
      if (maintenance.mode !== "maintenance" || maintenance.root !== node_fs.realpathSync(node_path.dirname(this.root)) || maintenance.root !== node_fs.realpathSync(node_path.dirname(this.sqlite.name))) throw new ApplicationError("RESOURCE_BUSY", "恢复激活占用需要本库独占维护权");
    };
    assertMaintenance();
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      assertMaintenance();
      const rows = this.sqlite.prepare("SELECT lease_id,resource_id,pid,process_started_at FROM capability_resource_leases WHERE owner_kind='application-activation' AND owner_id=? AND state<>'released'").all(operationId);
      if (!rows.length) return;
      const operation2 = this.sqlite.prepare("SELECT state,plan_json FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=? AND kind='application-activation'").get(operationId, this.storeId);
      if (!operation2 || !["verified", "committed"].includes(operation2.state)) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "激活占用缺少原操作依据");
      const plan = JSON.parse(operation2.plan_json);
      if (plan.operationId !== operationId || plan.storeId !== this.storeId || !Array.isArray(plan.requests) || !plan.requests.every((r) => typeof r.hash === "string" && /^[a-f0-9]{64}$/.test(r.hash))) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "激活占用计划不能核验");
      const ids = new Set(plan.requests.map((r) => "app:" + r.hash));
      for (const row of rows) {
        if (!ids.has(row.resource_id) || this.get(row.resource_id).kind !== "application-package") throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "激活占用资源与计划不符");
        if (!Number.isSafeInteger(row.pid) || row.pid < 1 || typeof row.process_started_at !== "string" || !/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(row.process_started_at) || !this.options.processes || this.options.processes.state({ pid: row.pid, startedAt: row.process_started_at }) !== "stopped") throw new ApplicationError("RESOURCE_BUSY", "原激活进程仍存活或身份未知，保留占用");
      }
      for (const row of rows) this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND owner_kind='application-activation' AND owner_id=?").run((/* @__PURE__ */ new Date()).toISOString(), row.lease_id, operationId);
    }).immediate());
  }
  /** Absence is repairable; an occupied or linked path is never an empty target. */
  missingTarget(spec) {
    try {
      const root = node_fs.lstatSync(this.root), owner = node_path.join(this.root, ".store-id.json"), marker = node_fs.lstatSync(owner);
      if (!root.isDirectory() || root.isSymbolicLink() || node_fs.realpathSync(this.root) !== this.root || !marker.isFile() || marker.nlink !== 1 || marker.size > 4096) throw new Error();
      const identity2 = JSON.parse(node_fs.readFileSync(owner, "utf8"));
      if (identity2.schema !== 1 || identity2.storeId !== this.storeId) throw new Error();
    } catch {
      throw new ApplicationError("OWNERSHIP_CONFLICT", "原资源库身份已变化，保留原目录");
    }
    let directory = this.root;
    for (const part of spec.relativePath.split("/")) {
      directory = node_path.join(directory, part);
      let stat;
      try {
        stat = node_fs.lstatSync(directory);
      } catch (error) {
        if (error.code === "ENOENT") return true;
        throw error;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ApplicationError("OWNERSHIP_CONFLICT", "原资源路径被文件或链接占用，不能修复覆盖");
    }
    return false;
  }
  /** Republish missing immutable bytes under the same identity. Historical refs stay intact. */
  async restoreMissing(spec, signal) {
    var _a;
    const operationId = node_crypto.randomUUID();
    let leaseId = "", present2 = false;
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      var _a2;
      assertClaudePublication(this, spec.relativePath, spec.contentHash);
      const row = this.get(spec.resourceId);
      this.assertIdentity(row, spec);
      (_a2 = spec.assertPublish) == null ? void 0 : _a2.call(spec, operationId);
      this.assertDependencies(spec.dependencies);
      if (row.state !== "ready" || row.integrity !== "valid") throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原资源已有发布或清理操作，先恢复原操作");
      const state = this.sqlite.prepare("SELECT store_id,maintenance_state FROM capability_store_state WHERE singleton=1").get();
      if (state && (state.store_id !== this.storeId || state.maintenance_state !== "ready")) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原资源库正在维护或待恢复");
      const dependencies = this.sqlite.prepare("SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id").all(spec.resourceId).map((r) => r.dependency_id);
      if (canonicalJson(dependencies) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原资源依赖已变化，不能修复");
      if (!this.missingTarget(spec)) {
        present2 = true;
        leaseId = this.lease(spec.resourceId, operationId);
        return;
      }
      const consumers = this.sqlite.prepare(`WITH RECURSIVE consumers(id) AS (VALUES(?) UNION SELECT d.resource_id FROM capability_resource_dependencies d JOIN consumers c ON d.dependency_id=c.id JOIN capability_resources r ON r.resource_id=d.resource_id WHERE r.state<>'removed') SELECT id FROM consumers`).all(spec.resourceId);
      if (consumers.length > 1e4) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原资源依赖占用超过核查预算");
      const ids = consumers.map((r) => r.id), marks = ids.map(() => "?").join(",");
      const busy2 = this.sqlite.prepare(`SELECT 1 FROM capability_resource_leases l WHERE l.state<>'released' AND (l.resource_id IN (${marks}) OR EXISTS(SELECT 1 FROM capability_lease_resources p WHERE p.lease_id=l.lease_id AND p.resource_id IN (${marks}))) LIMIT 1`).get(...ids, ...ids);
      if (busy2) throw new ApplicationError("RESOURCE_BUSY", "原资源或依赖仍有占用，暂不修复缺失目录");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, "restore-" + spec.kind, this.storeId, this.publicationPlan(spec, leaseId = node_crypto.randomUUID()), now, now);
      this.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',generation=generation+1,operation_id=? WHERE resource_id=? AND state='ready'").run(operationId, spec.resourceId);
      leaseId = this.lease(spec.resourceId, operationId, "install", void 0, leaseId);
    }).immediate(), { signal });
    if (present2) {
      try {
        spec.verify(node_path.join(this.root, spec.relativePath));
        return this.get(spec.resourceId);
      } finally {
        await withResourceLock(this.root, () => this.endLease(leaseId));
      }
    }
    this.activeOperations.add(operationId);
    try {
      (_a = this.checkpoint) == null ? void 0 : _a.call(this, "registered");
      await this.finish(spec, operationId, leaseId, signal);
      return this.get(spec.resourceId);
    } catch (error) {
      await this.recordFailure(spec.resourceId, operationId, leaseId, error);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
  async publish(spec, signal) {
    var _a;
    this.checkSpec(spec);
    const operationId = node_crypto.randomUUID();
    let reuse = false, leaseId = "";
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      var _a2, _b;
      this.assertDependencies(spec.dependencies);
      (_a2 = spec.assertPublish) == null ? void 0 : _a2.call(spec, operationId);
      const old = this.sqlite.prepare(SELECT$1 + " WHERE resource_id=?").get(spec.resourceId);
      assertClaudePublication(this, spec.relativePath, spec.contentHash, (old == null ? void 0 : old.state) === "ready" && old.integrity === "valid");
      if (old) {
        this.assertIdentity(this.get(spec.resourceId), spec);
        if (old.state !== "removed" && (old.state !== "ready" || old.integrity !== "valid")) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "资源有未完成的发布或清理，先恢复原操作");
        const actual = this.sqlite.prepare("SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id").all(spec.resourceId).map((d) => d.dependency_id);
        if (canonicalJson(actual) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError("RESOURCE_STATE_CHANGED", "资源依赖与原发布不一致");
        if (old.state === "removed") {
          const now2 = (/* @__PURE__ */ new Date()).toISOString();
          this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at) VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, "restore-" + spec.kind, this.storeId, this.publicationPlan(spec, leaseId = node_crypto.randomUUID()), now2, now2);
          this.sqlite.prepare("UPDATE capability_resources SET state='staged',integrity='unknown',generation=generation+1,operation_id=? WHERE resource_id=? AND state='removed'").run(operationId, spec.resourceId);
          leaseId = this.lease(spec.resourceId, operationId, "install", void 0, leaseId);
          return;
        }
        reuse = true;
        leaseId = this.lease(spec.resourceId, operationId);
        return;
      }
      const now = (/* @__PURE__ */ new Date()).toISOString();
      this.sqlite.prepare(`INSERT INTO capability_resource_operations(operation_id,kind,owner_store_id,state,plan_json,created_at,updated_at)
        VALUES(?,? ,?,'preparing',?,?,?)`).run(operationId, "install-" + spec.kind, this.storeId, this.publicationPlan(spec, leaseId = node_crypto.randomUUID()), now, now);
      this.sqlite.prepare(`INSERT INTO capability_resources(resource_id,kind,content_hash,owner_store_id,path_scope,relative_path,state,generation,integrity,operation_id)
        VALUES(?,?,?,?,'C',?,'staged',1,'unknown',?)`).run(spec.resourceId, spec.kind, spec.contentHash, this.storeId, spec.relativePath, operationId);
      for (const id2 of spec.dependencies) this.sqlite.prepare("INSERT INTO capability_resource_dependencies(resource_id,dependency_id) VALUES(?,?)").run(spec.resourceId, id2);
      (_b = spec.register) == null ? void 0 : _b.call(spec, operationId);
      leaseId = this.lease(spec.resourceId, operationId, "install", void 0, leaseId);
    }).immediate(), { signal });
    if (reuse) {
      let failure, missing = false;
      try {
        spec.verify(node_path.join(this.root, spec.relativePath));
        return this.get(spec.resourceId);
      } catch (error) {
        failure = error;
        missing = this.missingTarget(spec);
      } finally {
        await withResourceLock(this.root, () => this.endLease(leaseId));
      }
      if (!missing) throw failure;
      return this.restoreMissing(spec, signal);
    }
    this.activeOperations.add(operationId);
    try {
      (_a = this.checkpoint) == null ? void 0 : _a.call(this, "registered");
      await this.finish(spec, operationId, leaseId, signal);
      return this.get(spec.resourceId);
    } catch (error) {
      await this.recordFailure(spec.resourceId, operationId, leaseId, error);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
  async finish(spec, operationId, leaseId, signal) {
    var _a, _b;
    this.assertOwnPublisher(spec.resourceId, operationId, leaseId);
    (_a = spec.assertPublish) == null ? void 0 : _a.call(spec, operationId);
    ensureStoreDirectory(this.root, "staging");
    const stage = node_path.join(this.root, "staging", operationId), target = node_path.join(this.root, spec.relativePath);
    if (this.missingTarget(spec)) {
      if (!node_fs.existsSync(stage)) spec.materialize(stage);
      spec.verify(stage);
    } else spec.verify(target);
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      var _a2;
      assertClaudePublication(this, spec.relativePath, spec.contentHash);
      this.assertOwnPublisher(spec.resourceId, operationId, leaseId);
      (_a2 = spec.assertPublish) == null ? void 0 : _a2.call(spec, operationId);
      const row = this.get(spec.resourceId);
      this.assertIdentity(row, spec);
      if (row.operationId !== operationId || row.state === "deleting" || row.state === "removed") throw new ApplicationError("RESOURCE_STATE_CHANGED", "发布资源状态已变化");
      this.assertRecordedDependencies(spec);
      this.sqlite.prepare("UPDATE capability_resources SET state='verified',integrity='valid' WHERE resource_id=?").run(spec.resourceId);
      this.phase(operationId, "verified");
    }).immediate(), { signal });
    (_b = this.checkpoint) == null ? void 0 : _b.call(this, "materialized");
    await withResourceLock(this.root, () => {
      var _a2, _b2, _c;
      assertClaudePublication(this, spec.relativePath, spec.contentHash);
      this.assertOwnPublisher(spec.resourceId, operationId, leaseId);
      (_a2 = spec.assertPublish) == null ? void 0 : _a2.call(spec, operationId);
      this.assertRecordedDependencies(spec);
      const row = this.get(spec.resourceId);
      if (row.operationId !== operationId || row.state !== "verified") throw new ApplicationError("RESOURCE_STATE_CHANGED", "发布资源状态已变化");
      if (node_path.dirname(spec.relativePath) !== ".") ensureStoreDirectory(this.root, node_path.dirname(spec.relativePath));
      if (!this.missingTarget(spec)) spec.verify(target);
      else node_fs.renameSync(stage, target);
      this.phase(operationId, "published");
      (_b2 = this.checkpoint) == null ? void 0 : _b2.call(this, "renamed");
      assertClaudePublication(this, spec.relativePath, spec.contentHash);
      this.assertOwnPublisher(spec.resourceId, operationId, leaseId);
      (_c = spec.assertPublish) == null ? void 0 : _c.call(spec, operationId);
      spec.verify(target);
      this.sqlite.transaction(() => {
        this.assertOwnPublisher(spec.resourceId, operationId, leaseId);
        this.assertRecordedDependencies(spec);
        this.sqlite.prepare("UPDATE capability_resources SET state='ready',integrity='valid' WHERE resource_id=? AND operation_id=?").run(spec.resourceId, operationId);
        this.phase(operationId, "committed");
        this.endLease(leaseId);
      }).immediate();
    }, { signal });
    if (node_fs.existsSync(stage) && !node_fs.lstatSync(stage).isSymbolicLink()) node_fs.rmSync(stage, { recursive: true });
  }
  async recordFailure(resourceId, operationId, leaseId, error) {
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      const row = this.get(resourceId);
      if (row.operationId !== operationId || row.state === "ready") return;
      this.sqlite.prepare("UPDATE capability_resources SET state='recovery-required',integrity='unknown' WHERE resource_id=?").run(resourceId);
      this.phase(operationId, "failed", error instanceof ApplicationError ? error.code : "INSTALL_FAILED");
      this.endLease(leaseId);
    }).immediate());
  }
  async recover(spec, operationId, signal) {
    this.checkSpec(spec);
    if (!/^[a-f0-9-]{36}$/.test(operationId)) throw new ApplicationError("INVALID_PACKAGE", "恢复操作标识无效");
    let leaseId = "", alreadyReady = false;
    await withResourceLock(this.root, () => this.sqlite.transaction(() => {
      var _a;
      const slotOld = this.get(spec.resourceId);
      assertClaudePublication(this, spec.relativePath, spec.contentHash, slotOld.state === "ready" && slotOld.integrity === "valid");
      const row = this.get(spec.resourceId);
      this.assertIdentity(row, spec);
      if (row.operationId !== operationId || this.activeOperations.has(operationId)) throw new ApplicationError("RESOURCE_BUSY", "原发布操作仍在执行或归属不同");
      const operation2 = this.sqlite.prepare("SELECT kind,state,plan_json AS plan FROM capability_resource_operations WHERE operation_id=? AND owner_store_id=?").get(operationId, this.storeId);
      if (operation2 && !["install-" + spec.kind, "restore-" + spec.kind].includes(operation2.kind)) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原发布操作类型不同");
      if (!operation2) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "缺少原发布日志");
      let plan;
      try {
        plan = JSON.parse(operation2.plan);
        if (!plan || !Number.isSafeInteger(plan.pid) || plan.pid < 1 || typeof plan.instanceId !== "string" || !Array.isArray(plan.dependencies)) throw Error();
      } catch {
        throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原发布身份记录不完整");
      }
      if (plan.resourceId !== spec.resourceId || plan.hash !== spec.contentHash || plan.relativePath !== spec.relativePath || canonicalJson(plan.dependencies) !== canonicalJson([...spec.dependencies].sort())) throw new ApplicationError("RESOURCE_STATE_CHANGED", "恢复输入与原发布不一致");
      const validIdentity = (v) => !!v && Number.isSafeInteger(v.pid) && v.pid > 0 && typeof v.startedAt === "string" && /^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(v.startedAt);
      if (operation2.state !== "failed" && operation2.state !== "committed") {
        if (!validIdentity(plan.host) || plan.host.pid !== plan.pid || !this.options.processes) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原发布者缺少可核验的内核启动身份");
        if (this.options.processes.state(plan.host) !== "stopped") throw new ApplicationError("RESOURCE_BUSY", "原发布者仍存活或身份未知，保留原占用");
      }
      const installs = this.sqlite.prepare("SELECT lease_id,resource_id,host_instance_id,pid,process_started_at,state FROM capability_resource_leases WHERE owner_id=? AND owner_kind='install' ORDER BY lease_id").all(operationId);
      if (!installs.length) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原发布占用凭据缺失");
      if (plan.leaseId) {
        const original = installs.find((l) => l.lease_id === plan.leaseId);
        if (!original) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原发布占用凭据缺失");
        if (original.resource_id !== spec.resourceId || original.host_instance_id !== plan.instanceId || original.pid !== plan.pid || plan.host && original.process_started_at !== plan.host.startedAt) throw new ApplicationError("RESOURCE_BUSY", "原发布占用已有不同恢复者，保留原记录");
      }
      const ended = [];
      for (const lease of installs) {
        if (lease.resource_id !== spec.resourceId || !["active", "released", "recovery-required"].includes(lease.state)) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原发布占用的资源或状态不同");
        if (lease.state === "released") continue;
        const identity2 = { pid: lease.pid, startedAt: lease.process_started_at };
        if (!validIdentity(identity2) || !this.options.processes || this.options.processes.state(identity2) !== "stopped") throw new ApplicationError("RESOURCE_BUSY", "原发布或恢复者仍存活或身份未知，保留占用");
        ended.push(lease.lease_id);
      }
      const held = this.sqlite.prepare("SELECT 1 FROM capability_resource_leases l WHERE l.state<>'released' AND NOT(l.owner_kind='install' AND l.owner_id=?) AND (l.resource_id=? OR EXISTS(SELECT 1 FROM capability_lease_resources r WHERE r.lease_id=l.lease_id AND r.resource_id=?)) LIMIT 1").get(operationId, spec.resourceId, spec.resourceId);
      if (held) throw new ApplicationError("RESOURCE_BUSY", "原资源仍有其他运行或待核查占用");
      if (row.state === "deleting" || row.state === "removed") throw new ApplicationError("RESOURCE_STATE_CHANGED", "不能从清理状态恢复发布");
      this.assertRecordedDependencies(spec);
      for (const id2 of ended) this.sqlite.prepare("UPDATE capability_resource_leases SET state='released',ended_at=? WHERE lease_id=? AND owner_id=? AND owner_kind='install' AND state<>'released'").run((/* @__PURE__ */ new Date()).toISOString(), id2, operationId);
      (_a = spec.assertPublish) == null ? void 0 : _a.call(spec, operationId);
      alreadyReady = row.state === "ready" && operation2.state === "committed";
      leaseId = this.lease(spec.resourceId, operationId);
      if (!alreadyReady) this.phase(operationId, "recovering");
    }).immediate(), { signal });
    if (alreadyReady) {
      try {
        spec.verify(node_path.join(this.root, spec.relativePath));
        return this.get(spec.resourceId);
      } finally {
        await withResourceLock(this.root, () => this.endLease(leaseId));
      }
    }
    this.activeOperations.add(operationId);
    try {
      await this.finish(spec, operationId, leaseId, signal);
      return this.get(spec.resourceId);
    } catch (error) {
      await this.recordFailure(spec.resourceId, operationId, leaseId, error);
      throw error;
    } finally {
      this.activeOperations.delete(operationId);
    }
  }
}
const legacyRuntimeMetadata = zod.z.object({ runId: zod.z.uuid(), projectId: zod.z.string().min(1).max(128), configVersion: zod.z.number().int().nonnegative(), configHash: zod.z.string().regex(/^[a-f0-9]{64}$/), manifestPath: zod.z.string().min(1).max(4096), auditPath: zod.z.string().min(1).max(4096), skills: zod.z.array(zod.z.object({ skillId: zod.z.string(), name: zod.z.string(), versionId: zod.z.string(), version: zod.z.string(), hash: zod.z.string().regex(/^[a-f0-9]{64}$/), path: zod.z.string(), enabled: zod.z.boolean(), loaded: zod.z.literal("unverified") }).strict()).max(64), mcp: zod.z.array(zod.z.object({ name: zod.z.string(), loaded: zod.z.literal("unverified") }).strict()).max(16), selfCheck: zod.z.object({ status: zod.z.enum(["pending", "passed", "failed"]), issues: zod.z.array(zod.z.string().max(256)).max(256), at: zod.z.number().nullable() }).strict() }).strict();
const hash$2 = zod.z.string().regex(/^[a-f0-9]{64}$/), id$2 = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const legacyManifestSchema = zod.z.object({ schemaVersion: zod.z.literal(1), projectId: zod.z.string(), configVersion: zod.z.number().int().nonnegative(), configHash: hash$2, runId: zod.z.uuid(), files: zod.z.record(zod.z.string(), hash$2), requiredEnv: zod.z.array(zod.z.string()).max(512), pathEnv: zod.z.record(zod.z.string(), zod.z.string()), pythonModules: zod.z.array(zod.z.string()).max(64), commands: zod.z.array(zod.z.string()).max(64), readablePaths: zod.z.array(zod.z.string()).max(256) }).strict();
const fail$2 = (message) => {
  throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", message);
};
class LegacyTaskEvidenceReader {
  constructor(root, home, version2) {
    __publicField(this, "proofs", /* @__PURE__ */ new WeakMap());
    __publicField(this, "root");
    __publicField(this, "home");
    this.version = version2;
    this.root = node_fs.realpathSync(root);
    this.home = node_fs.realpathSync(home);
  }
  inspect(identity2, value) {
    const parsed = legacyRuntimeMetadata.safeParse(value);
    if (!["claude-code", "codex"].includes(identity2.runner) || !parsed.success || !id$2.test(identity2.taskId) || !id$2.test(identity2.projectId) || parsed.data.projectId !== identity2.projectId) throw new ApplicationError("SNAPSHOT_CORRUPT", "原M4任务快照格式或归属不同");
    const snapshot = parsed.data, runRoot = node_path.join(this.root, "runs", identity2.projectId, identity2.taskId, snapshot.runId), manifestPath = node_path.join(runRoot, "manifest.json");
    if (snapshot.manifestPath !== manifestPath || snapshot.auditPath !== node_path.join(this.root, "resource-audit", identity2.projectId, identity2.taskId + ".jsonl")) fail$2("原M4快照的受管路径不同，不能沿任意路径寻找历史");
    const observations = [];
    let bytes = 0;
    let runMarker = null;
    const read = (path2, anchor = this.root) => {
      this.within(anchor, path2);
      const fd = node_fs.openSync(path2, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
      try {
        const before = node_fs.fstatSync(fd);
        if (!before.isFile() || before.nlink !== 1 || (before.mode & 73) !== 0 || before.size > 4 * 1024 * 1024 || bytes + before.size > 32 * 1024 * 1024 || observations.length >= 4096) fail$2("原M4文件类型、完整性或读取预算不符");
        const buffer = Buffer.alloc(before.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const count = node_fs.readSync(fd, buffer, length, buffer.length - length, null);
          if (!count) break;
          length += count;
        }
        const data = buffer.subarray(0, length), after = node_fs.fstatSync(fd);
        if (data.length !== before.size || after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) fail$2("原M4文件在核对中发生变化");
        bytes += data.length;
        observations.push({ path: path2, sha256: digest(data), device: before.dev, inode: before.ino, size: before.size, mode: before.mode, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs });
        return data;
      } finally {
        node_fs.closeSync(fd);
      }
    };
    const tree = (directory, anchor = this.root) => {
      this.within(anchor, node_path.join(directory, ".smartdd-owned.json"));
      const files = /* @__PURE__ */ Object.create(null);
      let visited = 0;
      const walk = (dir, depth) => {
        if (depth > 32 || ++visited > 4096) fail$2("原M4目录层级或文件数超过预算");
        for (const name2 of node_fs.readdirSync(dir)) {
          const path2 = node_path.join(dir, name2), stat = node_fs.lstatSync(path2);
          if (stat.isSymbolicLink() || !stat.isDirectory() && !stat.isFile()) fail$2("原M4目录包含链接或特殊文件");
          if (stat.isDirectory()) walk(path2, depth + 1);
          else files[node_path.relative(directory, path2)] = read(path2, anchor);
        }
      };
      walk(directory, 0);
      const marker = files[".smartdd-owned.json"];
      if (!marker) fail$2("原M4目录缺少归属标记");
      let owner;
      try {
        owner = JSON.parse(marker.toString("utf8"));
      } catch {
        fail$2("原M4归属标记损坏");
      }
      if (owner.owner !== "SmartDD" || owner.schema !== 1 || Object.keys(owner).length !== 2) fail$2("原M4目录不属于旧受管格式");
      if (directory === runRoot) runMarker = Buffer.from(marker);
      delete files[".smartdd-owned.json"];
      return files;
    };
    try {
      this.within(this.root, manifestPath);
      try {
        node_fs.lstatSync(manifestPath);
      } catch (error) {
        if (error.code === "ENOENT") return { state: "unknown", code: "LEGACY_MANIFEST_MISSING" };
        throw error;
      }
      const runFiles = tree(runRoot), raw = runFiles["manifest.json"];
      if (!raw) fail$2("原M4启动清单缺失");
      const manifest = legacyManifestSchema.parse(JSON.parse(raw.toString("utf8")));
      if (manifest.projectId !== snapshot.projectId || manifest.configVersion !== snapshot.configVersion || manifest.configHash !== snapshot.configHash || manifest.runId !== snapshot.runId) fail$2("原M4启动清单与任务快照不一致");
      const paths = Object.keys(manifest.files);
      if (!paths.length || paths.length > 4096) fail$2("原M4清单文件集合无效");
      const runtimeRoots = new Set(paths.filter((p) => p.startsWith(this.root + "/runtime/")).map((p) => node_path.join(this.root, "runtime", node_path.relative(node_path.join(this.root, "runtime"), p).split("/")[0])));
      if (runtimeRoots.size !== 1) fail$2("无法从原清单唯一确定原M4运行代码");
      const runtimePath = [...runtimeRoots][0], runtimeHash = node_path.basename(runtimePath);
      if (!hash$2.safeParse(runtimeHash).success) fail$2("原M4运行代码摘要无效");
      const strings2 = (files) => Object.fromEntries(Object.entries(files).map(([name2, data]) => {
        const text = data.toString("utf8");
        if (!Buffer.from(text).equals(data)) fail$2("原M4文本资源字节不完整");
        return [name2, text];
      }));
      const runtimeFiles2 = tree(runtimePath);
      if (treeHash(strings2(runtimeFiles2)) !== runtimeHash) fail$2("原M4运行代码完整摘要不同");
      const expected = {};
      for (const [name2, data] of Object.entries(runtimeFiles2)) expected[node_path.join(runtimePath, name2)] = data;
      const knownRun = /* @__PURE__ */ new Set(["context.json", ...identity2.runner === "claude-code" ? ["plugin/.claude-plugin/plugin.json"] : [], ...identity2.runner === "claude-code" && snapshot.mcp.length ? ["mcp.json"] : []]);
      const pathEnv = { SMARTDD_PROJECT_CONTEXT: node_path.join(runRoot, "context.json"), SMARTDD_RESOURCE_AUDIT: snapshot.auditPath, SMARTDD_PROJECT_ID: identity2.projectId, SMARTDD_CONFIG_VERSION: String(snapshot.configVersion) };
      for (const [key, name2] of [["PROJECT_DB_CONFIG", "databases.json"], ["REMOTE_SERVERS_CONFIG", "servers.json"]]) if (key in manifest.pathEnv) {
        pathEnv[key] = node_path.join(runRoot, name2);
        knownRun.add(name2);
      }
      if (canonicalJson(pathEnv) !== canonicalJson(manifest.pathEnv) || Object.keys(pathEnv).some((key) => !manifest.requiredEnv.includes(key)) || manifest.requiredEnv.some((key) => !/^SMARTDD_[A-Z0-9_]+$/.test(key) && !["PROJECT_DB_CONFIG", "REMOTE_SERVERS_CONFIG"].includes(key)) || manifest.pythonModules.some((name2) => !["pymysql", "psycopg2"].includes(name2)) || manifest.commands.some((name2) => name2 !== "ssh")) fail$2("原M4配置或依赖契约与受管入口不同");
      const seen = /* @__PURE__ */ new Set();
      const skills = [];
      for (const skill of snapshot.skills) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(skill.skillId) || seen.has(skill.skillId) || skill.versionId !== skill.skillId + ":" + skill.hash) fail$2("原M4标准Skill身份冲突");
        seen.add(skill.skillId);
        const version2 = this.version(skill.versionId);
        if (!version2 || version2.id !== skill.versionId || version2.skillId !== skill.skillId || version2.hash !== skill.hash || version2.name !== skill.name || version2.version !== skill.version) fail$2("原M4标准Skill版本记录不一致");
        const source2 = tree(node_path.join(this.root, "packages", skill.skillId, skill.hash));
        if (treeHash(strings2(source2)) !== skill.hash) fail$2("原M4标准Skill源包摘要不同");
        let nativeName = null;
        if (skill.enabled) {
          const path2 = identity2.runner === "codex" ? node_path.join(this.home, ".agents", "skills", `smartdd-${skill.skillId}-${skill.hash.slice(0, 16)}`, "SKILL.md") : node_path.join(runRoot, "plugin", "skills", skill.skillId, "SKILL.md");
          if (skill.path !== path2) fail$2("原M4标准Skill路径与原生身份不同");
          const entry = source2["SKILL.md"];
          if (!entry) fail$2("原M4标准Skill缺少入口");
          const front = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(entry.toString("utf8"));
          if (!front) return fail$2("原M4标准Skill元数据缺失");
          const document = yaml.parseDocument(front[1], { uniqueKeys: true, logLevel: "silent" }), originalName = document.get("name");
          if (document.errors.length || typeof originalName !== "string" || !/^[a-z][a-z0-9-]{0,63}$/.test(originalName)) return fail$2("原M4标准Skill原生名称无效");
          nativeName = originalName;
          const projection = identity2.runner === "codex" ? tree(node_path.dirname(path2), this.home) : Object.fromEntries(Object.entries(runFiles).filter(([p]) => p.startsWith("plugin/skills/" + skill.skillId + "/")).map(([p, b]) => [p.slice(("plugin/skills/" + skill.skillId + "/").length), b]));
          if (canonicalJson(Object.keys(projection).sort()) !== canonicalJson(Object.keys(source2).sort()) || Object.entries(source2).some(([p, b]) => {
            var _a;
            return !((_a = projection[p]) == null ? void 0 : _a.equals(b));
          })) fail$2("原M4投影完整字节与原源包不同");
          for (const [p, b] of Object.entries(source2)) {
            expected[node_path.join(node_path.dirname(path2), p)] = b;
            if (identity2.runner === "claude-code") knownRun.add("plugin/skills/" + skill.skillId + "/" + p);
          }
        } else if (skill.path !== "") fail$2("原M4禁用Skill含无法确认的投影路径");
        skills.push(Object.freeze({ skillId: skill.skillId, versionId: skill.versionId, hash: skill.hash, enabled: skill.enabled, projectionPath: skill.path, nativeName, sourceHash: skill.hash }));
      }
      if (new Set(skills.filter((s) => s.enabled).map((s) => s.nativeName)).size !== skills.filter((s) => s.enabled).length) fail$2("原M4原生Skill名称冲突");
      const pluginRoot = identity2.runner === "claude-code" && skills.some((s) => s.enabled) ? node_path.join(runRoot, "plugin") : null;
      if (pluginRoot) {
        const metadata = runFiles["plugin/.claude-plugin/plugin.json"];
        if (!metadata) fail$2("原M4插件身份缺失");
        const plugin = JSON.parse(metadata.toString("utf8"));
        if (plugin.name !== "smartdd" || plugin.version !== "1.0.0") fail$2("原M4插件命名空间不同");
      }
      if (!runFiles["context.json"]) fail$2("原M4项目上下文缺失");
      const context = JSON.parse(runFiles["context.json"].toString("utf8"));
      if (context.schemaVersion !== 1 || context.projectId !== snapshot.projectId || context.configVersion !== snapshot.configVersion || context.configHash !== snapshot.configHash || canonicalJson(context.skills) !== canonicalJson(snapshot.skills.filter((s) => s.enabled).map(({ name: name2, path: path2, version: version2 }) => ({ name: name2, path: path2, version: version2 })))) fail$2("原M4项目上下文与任务能力不同");
      const expectedRunPaths = Object.keys(runFiles).filter((p) => !["manifest.json", "self-check.json"].includes(p));
      if (expectedRunPaths.length !== knownRun.size || expectedRunPaths.some((p) => !knownRun.has(p))) fail$2("原M4运行目录出现未声明的能力或文件");
      for (const name2 of expectedRunPaths) expected[node_path.join(runRoot, name2)] = runFiles[name2];
      if (canonicalJson(paths.sort()) !== canonicalJson(Object.keys(expected).sort()) || Object.entries(expected).some(([p, b]) => manifest.files[p] !== digest(b))) fail$2("原M4清单完整文件集合或字节不符");
      if (snapshot.mcp.length > 1 || snapshot.mcp.some((m) => !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(m.name))) fail$2("原M4上下文桥身份不属于已知契约");
      if (snapshot.mcp.length && identity2.runner === "claude-code") {
        const rawMcp = runFiles["mcp.json"];
        if (!rawMcp) fail$2("原M4上下文桥注册缺失");
        const config = JSON.parse(rawMcp.toString("utf8")), expectedMcp = { mcpServers: { [snapshot.mcp[0].name]: { command: "python3", args: [node_path.join(runtimePath, "context_mcp.py"), node_path.join(runRoot, "context.json")] } } };
        if (canonicalJson(config) !== canonicalJson(expectedMcp)) fail$2("原M4上下文桥名称或执行代码不同");
      }
      const snapshotBytes = canonicalJson(snapshot), observationsHash = digest(canonicalJson(observations)), identityData = { schema: "m4-task-evidence-v1", taskId: identity2.taskId, projectId: identity2.projectId, runner: identity2.runner, snapshotHash: digest(snapshotBytes), manifestHash: digest(raw), runRoot, runtimeHash, runtimePath, pluginRoot, pluginName: pluginRoot ? "smartdd" : null, skills: Object.freeze(skills), mcp: Object.freeze(snapshot.mcp.map((m) => Object.freeze({ name: m.name, protocolMajor: 1, runtimeHash }))) };
      const evidence = Object.freeze({ ...identityData, evidenceHash: digest(canonicalJson({ identity: identityData, observationsHash })) });
      this.proofs.set(evidence, { identity: { ...identity2 }, snapshot: snapshotBytes, observationsHash, pluginSource: pluginRoot ? { manifest: Buffer.from(raw), rootMarker: Buffer.from(runMarker), files: Object.fromEntries(Object.entries(runFiles).filter(([name2]) => name2.startsWith("plugin/")).map(([name2, data]) => [name2.slice(7), Buffer.from(data)])) } : null });
      return { state: "verified", evidence };
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原M4证据缺失、损坏或无法核验，保留原记录");
    }
  }
  /** Exact original bytes from this reader's live proof; JSON clones grant no capture authority. */
  capturePlugin(evidence) {
    const proof = this.proofs.get(evidence);
    if (!proof || !this.verify(evidence)) fail$2("原M4插件来源证明已失效，不能留存");
    const source2 = proof.pluginSource;
    return source2 ? { manifest: Buffer.from(source2.manifest), rootMarker: Buffer.from(source2.rootMarker), files: Object.fromEntries(Object.entries(source2.files).map(([name2, data]) => [name2, Buffer.from(data)])) } : null;
  }
  verify(evidence) {
    const proof = this.proofs.get(evidence);
    if (!proof) return false;
    try {
      const current = this.inspect(proof.identity, JSON.parse(proof.snapshot));
      return current.state === "verified" && current.evidence.evidenceHash === evidence.evidenceHash;
    } catch {
      return false;
    }
  }
  within(anchor, path2) {
    if (!node_path.isAbsolute(path2) || !path2.startsWith(anchor + "/") || node_path.join(anchor, node_path.relative(anchor, path2)) !== path2) fail$2("原M4文件越过已确认根目录");
    const parts = node_path.relative(anchor, path2).split("/");
    let current = anchor;
    for (let i = 0; i < parts.length - 1; i++) {
      current = node_path.join(current, parts[i]);
      try {
        const stat = node_fs.lstatSync(current);
        if (!stat.isDirectory() || stat.isSymbolicLink()) fail$2("原M4父目录包含链接或非目录");
      } catch (error) {
        if (error.code === "ENOENT") return;
        throw error;
      }
    }
  }
}
const hash$1 = zod.z.string().regex(/^[a-f0-9]{64}$/), id$1 = zod.z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), path$1 = zod.z.string().min(1).max(4096).refine((p) => p.startsWith("/") && !/[\x00\r\n]/.test(p));
const metadataSchema = zod.z.object({ kind: zod.z.literal("m4-legacy-plugin-source-v1"), taskId: id$1, projectId: id$1, sourceSnapshotHash: hash$1, manifestHash: hash$1, runRoot: path$1, pluginRoot: path$1, pluginName: zod.z.literal("smartdd"), skills: zod.z.array(zod.z.object({ skillId: zod.z.string().regex(/^[a-z][a-z0-9-]{0,63}$/), hash: hash$1 }).strict()).min(1).max(64) }).strict();
const legacyPluginResourceId = (taskId, manifestHash) => `legacy-plugin-source:${id$1.parse(taskId)}:${hash$1.parse(manifestHash)}`;
const legacyStaticPluginResourceId = (taskId, manifestHash) => `legacy-static-plugin:${id$1.parse(taskId)}:${hash$1.parse(manifestHash)}`;
function legacyPluginOrigin(evidence) {
  if (evidence.runner !== "claude-code" || !evidence.pluginRoot || evidence.pluginName !== "smartdd") throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原任务没有已证明的Claude插件来源");
  return metadataSchema.parse({ kind: "m4-legacy-plugin-source-v1", taskId: evidence.taskId, projectId: evidence.projectId, sourceSnapshotHash: evidence.snapshotHash, manifestHash: evidence.manifestHash, runRoot: evidence.runRoot, pluginRoot: evidence.pluginRoot, pluginName: evidence.pluginName, skills: evidence.skills.filter((s) => s.enabled).map((s) => ({ skillId: s.skillId, hash: s.hash })) });
}
const fail$1 = (message) => {
  throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", message);
};
function readArchive(root) {
  if (node_fs.realpathSync(root) !== root) return fail$1("原插件来源目录含未登记别名");
  const files = /* @__PURE__ */ Object.create(null);
  let count = 0, total = 0, visited = 0;
  const walk = (dir, depth) => {
    const stat = node_fs.lstatSync(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || depth > 32 || ++visited > 4096) fail$1("原插件来源目录不完整");
    const names = node_fs.readdirSync(dir);
    if (!names.length) fail$1("原插件来源含未声明的空目录");
    for (const name2 of names) {
      const p = node_path.join(dir, name2), st = node_fs.lstatSync(p);
      if (st.isSymbolicLink() || !st.isFile() && !st.isDirectory()) fail$1("原插件来源含链接或特殊文件");
      if (st.isDirectory()) {
        walk(p, depth + 1);
        continue;
      }
      if (++count > 4098 || st.nlink !== 1 || (st.mode & 73) !== 0 || st.size > 4 * 1024 * 1024 || (total += st.size) > 32 * 1024 * 1024) fail$1("原插件来源超过读取预算或归属不符");
      const fd = node_fs.openSync(p, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
      try {
        const before = node_fs.fstatSync(fd);
        if (before.dev !== st.dev || before.ino !== st.ino || before.size !== st.size || before.ctimeMs !== st.ctimeMs) fail$1("原插件来源在读取前变化");
        const buffer = Buffer.alloc(st.size + 1);
        let length = 0;
        while (length < buffer.length) {
          const n = node_fs.readSync(fd, buffer, length, buffer.length - length, null);
          if (!n) break;
          length += n;
        }
        const after = node_fs.fstatSync(fd);
        if (length !== st.size || after.size !== st.size || after.dev !== st.dev || after.ino !== st.ino || after.ctimeMs !== st.ctimeMs || after.mtimeMs !== st.mtimeMs) fail$1("原插件来源在读取中变化");
        files[node_path.relative(root, p)] = buffer.subarray(0, length);
      } finally {
        node_fs.closeSync(fd);
      }
    }
  };
  walk(root, 0);
  return files;
}
function checkPayload(origin, files, storeRoot) {
  var _a;
  const manifestBytes = files["origin/manifest.json"], markerBytes = files["origin/root-marker.json"];
  if (!manifestBytes || !markerBytes || digest(manifestBytes) !== origin.manifestHash) fail$1("原插件清单依据缺失或不同");
  const manifest = legacyManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8"))), marker = JSON.parse(markerBytes.toString("utf8")), runRoot = node_path.join(storeRoot, "runs", origin.projectId, origin.taskId, manifest.runId);
  if (manifest.projectId !== origin.projectId || origin.runRoot !== runRoot || origin.pluginRoot !== node_path.join(runRoot, "plugin") || marker.owner !== "SmartDD" || marker.schema !== 1 || Object.keys(marker).sort().join(",") !== "owner,schema") fail$1("原插件路径或原根标记不同");
  const expected = Object.entries(manifest.files).filter(([p]) => p.startsWith(origin.pluginRoot + "/")).map(([p, sha2562]) => ({ path: "plugin/" + p.slice(origin.pluginRoot.length + 1), sha256: sha2562 }));
  const names = ["origin/manifest.json", "origin/root-marker.json", ...expected.map((f) => f.path)].sort();
  if (!expected.length || canonicalJson(Object.keys(files).sort()) !== canonicalJson(names) || expected.some((f) => !files[f.path] || digest(files[f.path]) !== f.sha256)) fail$1("原插件完整文件集或字节不同");
  const plugin = JSON.parse(((_a = files["plugin/.claude-plugin/plugin.json"]) == null ? void 0 : _a.toString("utf8")) ?? "null");
  if (!plugin || plugin.name !== "smartdd" || plugin.version !== "1.0.0") fail$1("原插件命名空间不同");
  return { pluginFiles: Object.fromEntries(expected.map((f) => [f.path.slice(7), Buffer.from(files[f.path])])), rootMarker: Buffer.from(markerBytes), manifest: Buffer.from(manifestBytes) };
}
class LegacyPluginSources {
  constructor(store) {
    this.store = store;
  }
  readAt(directory, expectedHash, origin) {
    var _a, _b;
    try {
      const all = readArchive(directory), record = JSON.parse(((_a = all["bundle.json"]) == null ? void 0 : _a.toString("utf8")) ?? "null"), marker = JSON.parse(((_b = all[OWNED_BUNDLE_MARKER]) == null ? void 0 : _b.toString("utf8")) ?? "null");
      if (!record || !marker || marker.schema !== 1 || marker.storeId !== this.store.storeId || marker.hash !== expectedHash || Object.keys(marker).sort().join(",") !== "hash,schema,storeId") return fail$1("原插件留存归属不同");
      const metadata = metadataSchema.parse(record.metadata);
      if (canonicalJson(metadata) !== canonicalJson(origin)) return fail$1("原插件留存绑定另一原依据");
      delete all["bundle.json"];
      delete all[OWNED_BUNDLE_MARKER];
      const rebuilt = ownedBundle(metadata, all);
      if (rebuilt.hash !== expectedHash || canonicalJson(rebuilt.manifest) !== canonicalJson(record)) return fail$1("原插件留存完整摘要不同");
      return checkPayload(metadata, all, this.store.root);
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      return fail$1("原插件留存缺失、损坏或不可核验");
    }
  }
  async retain(reader, evidence) {
    const source2 = reader.capturePlugin(evidence);
    if (!source2) return null;
    const origin = legacyPluginOrigin(evidence), files = { "origin/manifest.json": source2.manifest, "origin/root-marker.json": source2.rootMarker, ...Object.fromEntries(Object.entries(source2.files).map(([p, b]) => ["plugin/" + p, b])) };
    checkPayload(origin, files, this.store.root);
    const bundle = ownedBundle(origin, files), dependencies = evidence.skills.filter((s) => s.enabled).map((s) => "standard-skill:" + s.skillId + ":" + s.hash);
    return this.store.publish({ resourceId: legacyPluginResourceId(evidence.taskId, evidence.manifestHash), kind: "legacy-plugin-source", contentHash: bundle.hash, relativePath: "legacy/plugins/" + bundle.hash, dependencies, materialize: (dir) => writeOwnedBundle(dir, bundle, this.store.storeId), verify: (dir) => {
      this.readAt(dir, bundle.hash, origin);
    } });
  }
  /** Byte verification only. Matching original static paths do not prove that a
   * native process exited, grant ownership, repair paths or permit activation.
   */
  verifyOriginalPlugin(resource, origin) {
    this.verifyStaticProjection(resource, origin, origin.runRoot);
  }
  /** Exact source bytes for private staging; this does not authorize a target path. */
  staticProjectionFiles(resource, origin) {
    const source2 = this.verify(resource, origin);
    return { ".smartdd-owned.json": source2.rootMarker, ...Object.fromEntries(Object.entries(source2.pluginFiles).map(([p, b]) => ["plugin/" + p, b])) };
  }
  verifyStaticProjection(resource, origin, directory) {
    try {
      const expected = this.staticProjectionFiles(resource, origin), actual = readArchive(directory);
      if (canonicalJson(Object.keys(actual).sort()) !== canonicalJson(Object.keys(expected).sort()) || Object.entries(expected).some(([p, b]) => {
        var _a;
        return !((_a = actual[p]) == null ? void 0 : _a.equals(b));
      })) fail$1("原静态插件路径含不同字节、临时配置或未知内容，保留原路径");
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      return fail$1("原静态插件目录缺失、损坏或无法核验");
    }
  }
  verify(resource, origin) {
    if (resource.resourceId !== legacyPluginResourceId(origin.taskId, origin.manifestHash) || resource.kind !== "legacy-plugin-source" || resource.ownerStoreId !== this.store.storeId || resource.pathScope !== "C" || resource.relativePath !== "legacy/plugins/" + resource.contentHash || resource.state !== "ready" || resource.integrity !== "valid") return fail$1("原插件来源登记不属于此历史");
    const dependencies = this.store.sqlite.prepare("SELECT dependency_id FROM capability_resource_dependencies WHERE resource_id=? ORDER BY dependency_id").all(resource.resourceId).map((d) => d.dependency_id);
    const result = this.readAt(this.store.directory(resource), resource.contentHash, origin);
    const skills = Object.keys(result.pluginFiles).filter((p) => /^skills\/[^/]+\/SKILL\.md$/.test(p)).map((p) => p.split("/")[1]).sort(), expected = origin.skills.map((s) => "standard-skill:" + s.skillId + ":" + s.hash).sort();
    if (canonicalJson(skills) !== canonicalJson(origin.skills.map((s) => s.skillId).sort()) || canonicalJson(dependencies) !== canonicalJson(expected)) return fail$1("原插件来源依赖缺失或不同");
    return result;
  }
}
function legacyDiscoveryEntry(storeId, home, skillId, sourceHash) {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(skillId) || !/^[a-f0-9]{64}$/.test(sourceHash)) throw new ApplicationError("INVALID_INPUT", "原Skill身份或完整摘要无效");
  const nativeName = `smartdd-${skillId}-${sourceHash.slice(0, 16)}`, homeId = digest(home);
  return { resourceId: "h-projection:" + digest(canonicalJson({ homeId, storeId, nativeName, hash: sourceHash })), storeId, path: node_path.join(home, ".agents/skills", nativeName, "SKILL.md"), nativeName, sourceHash, projectionHash: sourceHash, format: "legacy-tree-v1" };
}
function originalHBinding(store, taskId, home, sourceSnapshotHash, evidence) {
  const aliases2 = evidence.skills.filter((s) => s.enabled).map((s) => {
    const entry = legacyDiscoveryEntry(store.storeId, home, s.skillId, s.hash);
    if (entry.path !== s.projectionPath) throw new ApplicationError("SNAPSHOT_CORRUPT", "原Skill路径不是最初记录的位置");
    return { resourceId: entry.resourceId, relativePath: node_path.relative(home, node_path.dirname(entry.path)), hash: s.hash, sourceResourceId: `standard-skill:${s.skillId}:${s.hash}` };
  }).sort((a, b) => a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0);
  return { schema: "m4-h-alias-binding-v1", taskId, storeId: store.storeId, homeId: digest(home), sourceSnapshotHash, aliases: aliases2 };
}
function readOriginalHBinding(store, expected, anchor) {
  const row = store.sqlite.prepare("SELECT binding_json,binding_hash FROM capability_legacy_h_bindings WHERE task_id=?").get(expected.taskId);
  const refs = store.sqlite.prepare("SELECT ref_id,ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-agent-projection' ORDER BY ref_id").all(expected.taskId);
  const fail2 = () => {
    throw new ApplicationError("SNAPSHOT_CORRUPT", "原共享Skill的长期引用或登记依据不同，保留原记录");
  };
  if (anchor === null) {
    if (row || refs.length) return fail2();
    return void 0;
  }
  const bytes = canonicalJson(expected), hash2 = digest(bytes);
  if (!row || anchor !== hash2 || row.binding_hash !== hash2 || row.binding_json !== bytes || canonicalJson(refs) !== canonicalJson(expected.aliases.map((a) => ({ ref_id: a.resourceId, ref_hash: a.hash, relative_path: a.relativePath })))) return fail2();
  return expected.aliases.map((alias) => {
    const r = store.get(alias.resourceId);
    if (r.ownerStoreId !== store.storeId || r.kind !== "legacy-agent-projection" || r.pathScope !== "H" || r.scopeIdentity !== expected.homeId || r.relativePath !== alias.relativePath || r.contentHash !== alias.hash) return fail2();
    return r;
  });
}
const hash = zod.z.string().regex(/^[a-f0-9]{64}$/), id = zod.z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), path = zod.z.string().min(1).max(4096).refine((p) => p.startsWith("/") && !/[\x00\r\n]/.test(p));
const legacyRetentionIdentitySchema = zod.z.object({ taskId: id, projectId: id, runner: zod.z.enum(["claude-code", "codex"]), stateRoot: path, cwd: path, sessionId: zod.z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).nullable(), home: path }).strict();
const evidenceSchema = zod.z.object({ schema: zod.z.literal("m4-task-evidence-v1"), taskId: id, projectId: id, runner: zod.z.enum(["claude-code", "codex"]), snapshotHash: hash, evidenceHash: hash, manifestHash: hash, runRoot: path, runtimeHash: hash, runtimePath: path, pluginRoot: path.nullable(), pluginName: zod.z.literal("smartdd").nullable(), skills: zod.z.array(zod.z.object({ skillId: zod.z.string(), versionId: zod.z.string(), hash, enabled: zod.z.boolean(), projectionPath: zod.z.string().max(4096), nativeName: zod.z.string().regex(/^[a-z][a-z0-9-]{0,63}$/).nullable(), sourceHash: hash }).strict()).max(64), mcp: zod.z.array(zod.z.object({ name: zod.z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/), protocolMajor: zod.z.literal(1), runtimeHash: hash }).strict()).max(1) }).strict();
const legacyLogicalEvidence = (value) => {
  const { evidenceHash, ...logical } = value;
  return logical;
};
const fail = () => {
  throw new ApplicationError("SNAPSHOT_CORRUPT", "原M4持久来源、原路径或固定迁移依据不一致");
};
function retainedLegacySource(store, taskId, state) {
  try {
    const row = store.sqlite.prepare("SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?").get(taskId);
    if (!row || row.state !== state || !row.evidence_json || !row.manifest_json) return fail();
    if ([row.source_snapshot_json, row.source_record_json, row.source_identity_json, row.evidence_json, row.manifest_json].some((value) => typeof value !== "string" || Buffer.byteLength(value) > 4 * 1024 * 1024)) return fail();
    const snapshot = legacyRuntimeMetadata.parse(JSON.parse(row.source_snapshot_json)), record = legacyRuntimeMetadata.parse(JSON.parse(row.source_record_json)), identity2 = legacyRetentionIdentitySchema.parse(JSON.parse(row.source_identity_json)), evidence = evidenceSchema.parse(JSON.parse(row.evidence_json));
    const runRoot = node_path.join(store.root, "runs", identity2.projectId, taskId, snapshot.runId), runtimePath = node_path.join(store.root, "runtime", evidence.runtimeHash), pluginRoot = identity2.runner === "claude-code" && snapshot.skills.some((s) => s.enabled) ? node_path.join(runRoot, "plugin") : null;
    if (canonicalJson(identity2) !== row.source_identity_json || identity2.taskId !== taskId || snapshot.projectId !== identity2.projectId || evidence.taskId !== taskId || evidence.projectId !== identity2.projectId || evidence.runner !== identity2.runner || canonicalJson(snapshot) !== row.source_snapshot_json || canonicalJson(record) !== row.source_snapshot_json || digest(row.source_snapshot_json) !== row.source_snapshot_hash || evidence.snapshotHash !== row.source_snapshot_hash || canonicalJson(evidence) !== row.evidence_json || evidence.evidenceHash !== row.evidence_hash || digest(row.manifest_json) !== row.manifest_hash || evidence.manifestHash !== row.manifest_hash || evidence.runRoot !== runRoot || snapshot.manifestPath !== node_path.join(runRoot, "manifest.json") || snapshot.auditPath !== node_path.join(store.root, "resource-audit", identity2.projectId, taskId + ".jsonl") || evidence.runtimePath !== runtimePath || evidence.pluginRoot !== pluginRoot || evidence.pluginName !== (pluginRoot ? "smartdd" : null) || identity2.sessionId !== null && row.bound_native_session_id !== identity2.sessionId) return fail();
    const expected = snapshot.skills.map((s) => ({ skillId: s.skillId, versionId: s.versionId, hash: s.hash, enabled: s.enabled, projectionPath: s.path, sourceHash: s.hash }));
    if (canonicalJson(evidence.skills.map(({ nativeName, ...s }) => s)) !== canonicalJson(expected) || canonicalJson(evidence.mcp) !== canonicalJson(snapshot.mcp.map((m) => ({ name: m.name, protocolMajor: 1, runtimeHash: evidence.runtimeHash }))) || evidence.skills.some((s) => s.enabled ? s.nativeName === null || s.projectionPath !== (identity2.runner === "codex" ? node_path.join(identity2.home, ".agents/skills", `smartdd-${s.skillId}-${s.hash.slice(0, 16)}`, "SKILL.md") : node_path.join(runRoot, "plugin/skills", s.skillId, "SKILL.md")) : s.nativeName !== null || s.projectionPath !== "")) return fail();
    const manifest = legacyManifestSchema.parse(JSON.parse(row.manifest_json)), runtimePrefix = store.root + "/runtime/", runtimeRoots = new Set(Object.keys(manifest.files).filter((p) => p.startsWith(runtimePrefix)).map((p) => node_path.join(store.root, "runtime", p.slice(runtimePrefix.length).split("/")[0])));
    if (manifest.projectId !== snapshot.projectId || manifest.runId !== snapshot.runId || manifest.configVersion !== snapshot.configVersion || manifest.configHash !== snapshot.configHash || runtimeRoots.size !== 1 || !runtimeRoots.has(evidence.runtimePath)) return fail();
    const binding = { sourceSnapshotHash: row.source_snapshot_hash, sourceRecordHash: digest(row.source_record_json), identityHash: digest(row.source_identity_json), manifestHash: evidence.manifestHash, logicalEvidenceHash: digest(canonicalJson(legacyLogicalEvidence(evidence))) };
    const standardSkills = snapshot.skills.filter((s) => s.enabled).map((s) => ({ skillId: s.skillId, versionId: s.versionId, hash: s.hash, hashAlgorithm: "legacy-tree-v1", projectionPath: s.path }));
    const mcp = evidence.mcp.map((m) => ({ kind: "legacy-project-context", serverName: m.name, protocolMajor: m.protocolMajor, runtimeHash: m.runtimeHash }));
    let pluginSource;
    if (evidence.pluginRoot) {
      const resourceId = legacyPluginResourceId(taskId, evidence.manifestHash), ref = store.sqlite.prepare("SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-plugin-source' AND ref_id=?").get(taskId, resourceId);
      if (ref) {
        const resource = store.get(resourceId);
        if (resource.kind !== "legacy-plugin-source" || resource.pathScope !== "C" || resource.ownerStoreId !== store.storeId || resource.relativePath !== "legacy/plugins/" + resource.contentHash || ref.ref_hash !== resource.contentHash || ref.relative_path !== resource.relativePath) return fail();
        pluginSource = resource;
      }
    }
    let originalProjection;
    if (evidence.pluginRoot) {
      const resourceId = legacyStaticPluginResourceId(taskId, evidence.manifestHash), ref = store.sqlite.prepare("SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-static-plugin' AND ref_id=?").get(taskId, resourceId);
      if (!ref && store.sqlite.prepare("SELECT 1 FROM capability_resources WHERE resource_id=?").get(resourceId)) return fail();
      if (ref) {
        const r = store.get(resourceId);
        if (!pluginSource || r.kind !== "legacy-static-plugin" || r.pathScope !== "C" || r.contentHash !== pluginSource.contentHash || r.relativePath !== node_path.relative(store.root, evidence.runRoot) || ref.ref_hash !== r.contentHash || ref.relative_path !== r.relativePath) return fail();
        originalProjection = r;
      }
    }
    const originalCodexProjections = identity2.runner === "codex" ? readOriginalHBinding(store, originalHBinding(store, taskId, identity2.home, row.source_snapshot_hash, evidence), row.h_binding_hash) : void 0;
    if (identity2.runner !== "codex" && (row.h_binding_hash !== null || store.sqlite.prepare("SELECT 1 FROM capability_legacy_h_bindings WHERE task_id=?").get(taskId))) return fail();
    return { row, snapshot, identity: identity2, evidence, binding, standardSkills, mcp, pluginSource, ...originalProjection ? { originalProjection } : {}, ...originalCodexProjections ? { originalCodexProjections } : {} };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    return fail();
  }
}
function assertLegacySessionSource(store, snapshot) {
  var _a;
  const source2 = retainedLegacySource(store, snapshot.taskId, "migrated"), { identity: identity2, row } = source2;
  const { pluginSourceHash, ...binding } = snapshot.legacyBinding ?? {};
  if (pluginSourceHash && ((_a = source2.pluginSource) == null ? void 0 : _a.contentHash) !== pluginSourceHash) return fail();
  if (snapshot.provenance !== "migrated-known-legacy" || snapshot.adapterBinding.projectionFormatVersion !== 2 || snapshot.projectId !== identity2.projectId || snapshot.runner !== identity2.runner || snapshot.native.stateRoot !== identity2.stateRoot || snapshot.native.cwd !== identity2.cwd || snapshot.native.sessionId !== row.bound_native_session_id || snapshot.packages.length || Object.keys(snapshot.adapterBinding.nativeToolNames).length || canonicalJson(binding) !== canonicalJson(source2.binding) || canonicalJson(snapshot.standardSkills) !== canonicalJson(source2.standardSkills) || canonicalJson(snapshot.mcp) !== canonicalJson(source2.mcp)) return fail();
  return source2;
}
const snapshotFailureMessages = { json: "固定能力快照无法解析，保留原记录，不重建选择", shape: "固定能力快照结构无效，保留原记录，不重建选择", hash: "固定能力快照摘要不符，保留原记录，不重建选择", identity: "固定能力快照身份不符，保留原记录，不重建选择" };
class SnapshotReadFailure extends Error {
  constructor(kind) {
    super(kind);
    this.kind = kind;
  }
}
const SELECT = "SELECT * FROM capability_session_snapshots WHERE task_id=?";
const selectionHash = (snapshot) => digest(canonicalJson({ ...snapshot, native: { ...snapshot.native, sessionId: null } }));
function canonicalFuturePath(path2) {
  if (!node_path.isAbsolute(path2)) throw new ApplicationError("INVALID_INPUT", "原生身份目录必须为绝对路径");
  const remainder = [];
  let parent = node_path.resolve(path2);
  while (!node_fs.existsSync(parent)) {
    const previous = node_path.dirname(parent);
    if (previous === parent) throw new ApplicationError("INVALID_INPUT", "无法解析原生身份目录");
    remainder.unshift(parent.slice(previous.length).replace(/^\/+/, ""));
    parent = previous;
  }
  return node_path.join(node_fs.realpathSync(parent), ...remainder);
}
function applicationSkillContentHash(manifest, path2) {
  const prefix = path2 + "/";
  const files = manifest.files.filter((f) => f.path.startsWith(prefix)).map((f) => ({ ...f, path: f.path.slice(prefix.length) })).sort((a, b) => compareCodePoints(a.path, b.path));
  return digest(canonicalJson(files));
}
class CapabilitySessionRegistry {
  constructor(store, deps) {
    __publicField(this, "packages");
    __publicField(this, "runtimes");
    this.store = store;
    this.deps = deps;
    this.packages = new PackageRegistry(store, "snapshot-reader");
    this.runtimes = new RuntimeRegistry(store);
  }
  expectedSources(snapshot) {
    const requested = /* @__PURE__ */ new Map();
    const add = (id2, kind, hash2) => {
      const previous = requested.get(id2);
      if (previous && (previous.kind !== kind || previous.hash !== hash2)) throw new ApplicationError("SNAPSHOT_CORRUPT", "快照资源身份冲突");
      requested.set(id2, { kind, hash: hash2 });
    };
    add(`agent-adapter:${snapshot.runner}:${snapshot.adapterBinding.hash}`, "agent-adapter", snapshot.adapterBinding.hash);
    if (snapshot.legacyBinding) {
      const original = assertLegacySessionSource(this.store, snapshot);
      for (const skill of original.snapshot.skills) add(`standard-skill:${skill.skillId}:${skill.hash}`, "standard-skill", skill.hash);
      add("legacy-runtime:" + original.evidence.runtimeHash, "legacy-runtime", original.evidence.runtimeHash);
      if (original.pluginSource) add(original.pluginSource.resourceId, "legacy-plugin-source", original.pluginSource.contentHash);
      if (original.originalProjection) add(original.originalProjection.resourceId, "legacy-static-plugin", original.originalProjection.contentHash);
      for (const r of original.originalCodexProjections ?? []) add(r.resourceId, "legacy-agent-projection", r.contentHash);
    }
    for (const p of snapshot.packages) {
      add("app:" + p.packageHash, "application-package", p.packageHash);
      add("runtime:" + p.runtimeHash, "runtime", p.runtimeHash);
    }
    for (const s of snapshot.standardSkills) add(`standard-skill:${s.skillId}:${s.hash}`, "standard-skill", s.hash);
    for (const m of snapshot.mcp) add((m.kind === "applications" ? "runtime:" : "legacy-runtime:") + m.runtimeHash, m.kind === "applications" ? "runtime" : "legacy-runtime", m.runtimeHash);
    return requested;
  }
  executionSelection(snapshot, appIds2) {
    return { ...snapshot, packages: snapshot.packages.filter((p) => appIds2.includes(p.appId)), mcp: snapshot.mcp.filter((m) => m.kind !== "applications" || appIds2.length > 0) };
  }
  sourceReferences(snapshot, initialScope) {
    if (initialScope && (snapshot.legacyBinding || new Set(initialScope).size !== initialScope.length || initialScope.some((id2) => !snapshot.packages.some((p) => p.appId === id2)))) throw new ApplicationError("INVALID_INPUT", "初始资源范围不属于原选择");
    const required2 = this.expectedSources(initialScope ? this.executionSelection(snapshot, initialScope) : snapshot);
    return [...this.expectedSources(snapshot)].map(([id2, expected]) => {
      const resource = this.store.get(id2);
      if (resource.kind !== expected.kind || resource.contentHash !== expected.hash || required2.has(id2) && (resource.state !== "ready" || resource.integrity !== "valid")) throw new ApplicationError("RESOURCE_STATE_CHANGED", "固定会话资源身份不一致或尚未就绪");
      return { refKind: expected.kind, refId: id2, refHash: expected.hash, relativePath: resource.relativePath };
    }).sort((a, b) => compareCodePoints(a.refId, b.refId));
  }
  validatePackages(snapshot) {
    for (const p of snapshot.packages) {
      const installed = this.packages.get(p.packageHash), manifest = installed.manifest;
      const contracts = Object.fromEntries(manifest.tools.map((t) => [t.name, t.contractMajor]));
      if (p.appId !== manifest.appId || p.version !== manifest.version || p.runtimeHash !== manifest.runtime.hash || p.dataApi !== manifest.dataApi || canonicalJson(p.hostApi) !== canonicalJson(manifest.hostApi) || canonicalJson(p.toolContractMajors) !== canonicalJson(contracts) || p.allowedOperations.some((op) => !manifest.permissions.includes(op)) || p.skills.length !== manifest.skills.length) throw new ApplicationError("SNAPSHOT_CORRUPT", "快照的应用版本、工具或动作与原包不同");
      for (const skill of p.skills) {
        const source2 = manifest.skills.find((s) => s.id === skill.skillId);
        if (!source2 || source2.path !== skill.sourceRelativePath || applicationSkillContentHash(manifest, source2.path) !== skill.contentHash) throw new ApplicationError("SNAPSHOT_CORRUPT", "固定Skill完整目录摘要与原包不一致");
      }
      const bridge = snapshot.mcp.find((m) => m.kind === "applications");
      if ((bridge == null ? void 0 : bridge.protocolMajor) !== manifest.runtime.protocolMajor) throw new ApplicationError("HOST_INCOMPATIBLE", "固定业务桥协议与包契约不同");
    }
  }
  read(taskId) {
    const row = this.store.sqlite.prepare(SELECT).get(taskId);
    if (!row) throw new ApplicationError("NOT_FOUND", "此任务尚无能力快照");
    if (row.schema_version === 0) {
      if (row.legacy_status === "history-unknown") throw new ApplicationError("SESSION_ON_HOLD", "历史能力未知，不能自动补入当前应用");
      throw new ApplicationError("SNAPSHOT_CORRUPT", "已记录的能力快照损坏，保留原记录，不重建选择");
    }
    if (row.schema_version !== 2) throw new ApplicationError("HOST_INCOMPATIBLE", "原能力快照格式暂不支持，请使用兼容的 WillYou 版本；原记录已保留");
    try {
      let decoded;
      try {
        decoded = JSON.parse(row.snapshot_json);
      } catch {
        throw new SnapshotReadFailure("json");
      }
      const parsed = capabilitySessionSnapshotSchema.safeParse(decoded);
      if (!parsed.success) throw new SnapshotReadFailure("shape");
      const snapshot = parsed.data, identity2 = this.store.sqlite.prepare("SELECT * FROM capability_session_identities WHERE task_id=?").get(taskId);
      if (digest(canonicalJson(snapshot)) !== row.snapshot_hash) throw new SnapshotReadFailure("hash");
      if (snapshot.taskId !== taskId || !identity2 || identity2.runner !== snapshot.runner || identity2.session_id !== snapshot.native.sessionId || identity2.cwd !== snapshot.native.cwd || identity2.selection_hash !== selectionHash(snapshot)) throw new SnapshotReadFailure("identity");
      if (snapshot.legacyBinding && identity2.discovery_home !== assertLegacySessionSource(this.store, snapshot).identity.home) throw new Error("legacy discovery identity");
      const actual = this.store.sqlite.prepare("SELECT ref_kind AS refKind,ref_id AS refId,ref_hash AS refHash,relative_path AS relativePath FROM capability_session_refs WHERE task_id=? ORDER BY ref_id").all(taskId);
      const expected = this.expectedSources(snapshot);
      if ([...expected].some(([id2, s]) => !actual.some((r) => r.refId === id2 && r.refKind === s.kind && r.refHash === s.hash)) || actual.some((r) => !isPackagePath(r.relativePath) || !expected.has(r.refId) && !["session-projection", "agent-projection", "legacy-runtime", "claude-projection-source", "claude-projection-archive", "claude-delivery"].includes(r.refKind))) throw new Error("reference integrity");
      for (const ref of actual) {
        const resource = this.store.get(ref.refId);
        if (resource.contentHash !== ref.refHash || resource.relativePath !== ref.relativePath || resource.kind !== ref.refKind) throw new Error("resource reference identity");
      }
      const names = this.store.sqlite.prepare("SELECT server_name AS serverName,kind FROM capability_session_mcp_names WHERE task_id=? ORDER BY kind").all(taskId);
      if (canonicalJson(names) !== canonicalJson(snapshot.mcp.map((m) => ({ serverName: m.serverName, kind: m.kind })).sort((a, b) => compareCodePoints(a.kind, b.kind)))) throw new Error("MCP identity integrity");
      return { snapshot, pointer: { schema: 2, taskId, snapshotHash: row.snapshot_hash }, selectionHash: identity2.selection_hash, discoveryHome: identity2.discovery_home, retention: row.retention_state, legacyStatus: row.legacy_status };
    } catch (error) {
      if (error instanceof SnapshotReadFailure) throw new ApplicationError("SNAPSHOT_CORRUPT", snapshotFailureMessages[error.kind]);
      if (error instanceof ApplicationError && ["RESOURCE_STATE_CHANGED", "OWNERSHIP_CONFLICT"].includes(error.code)) throw error;
      throw new ApplicationError("SNAPSHOT_CORRUPT", "固定能力快照、引用或原生身份损坏，保留现场不重建选择");
    }
  }
  /** Internal coordinated callers already hold C and a short SQLite transaction. */
  inspectCoordinated(taskId) {
    return this.read(taskId);
  }
  async get(taskId) {
    return withResourceLock(this.store.root, () => {
      try {
        return this.read(taskId);
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "SNAPSHOT_CORRUPT") this.quarantine(taskId, "corrupt");
        throw error;
      }
    });
  }
  async create(input, discoveryHome, initialApplicationScope) {
    const parsed = capabilitySessionSnapshotSchema.safeParse(input);
    if (!parsed.success || !node_path.isAbsolute(discoveryHome)) throw new ApplicationError("INVALID_INPUT", "会话能力或原生发现目录无效");
    const snapshot = parsed.data, bytes = canonicalJson(snapshot), hash2 = digest(bytes);
    if (Buffer.byteLength(bytes) > 4 * 1024 * 1024) throw new ApplicationError("INVALID_INPUT", "会话快照超过元数据预算");
    const nativeRoot = canonicalFuturePath(snapshot.native.stateRoot), home = canonicalFuturePath(discoveryHome);
    const saved = await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const previous = this.store.sqlite.prepare(SELECT).get(snapshot.taskId);
      if (previous) {
        if (previous.snapshot_hash !== hash2) throw new ApplicationError("SNAPSHOT_IMMUTABLE", "原任务能力已经固定，不能改成新版本或新路径");
        const known = this.read(snapshot.taskId);
        if (known.discoveryHome !== home) throw new ApplicationError("SNAPSHOT_IMMUTABLE", "原生发现目录已经固定");
        return known;
      }
      this.deps.assertInitialSelection(snapshot);
      this.validatePackages(snapshot);
      const refs = this.sourceReferences(snapshot, initialApplicationScope);
      if (snapshot.native.sessionId && this.store.sqlite.prepare("SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=?").get(snapshot.runner, nativeRoot, snapshot.native.sessionId)) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原生会话已关联另一任务，不能新增另一套能力");
      for (const mcp of snapshot.mcp) if (this.store.sqlite.prepare("SELECT 1 FROM capability_session_mcp_names WHERE server_name=?").get(mcp.serverName)) throw new ApplicationError("AGENT_CAPABILITY_NAME_CONFLICT", "已有会话使用此MCP名称，不能改名覆盖");
      this.store.sqlite.prepare("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES(?,2,?,?,?,?,'active')").run(snapshot.taskId, bytes, hash2, snapshot.createdAt, snapshot.provenance);
      this.store.sqlite.prepare("INSERT INTO capability_snapshot_versions(snapshot_hash,task_id,snapshot_json,selection_hash,created_at) VALUES(?,?,?,?,?)").run(hash2, snapshot.taskId, bytes, selectionHash(snapshot), snapshot.createdAt);
      this.store.sqlite.prepare("INSERT INTO capability_session_identities(task_id,runner,identity_root,session_id,cwd,discovery_home,selection_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").run(snapshot.taskId, snapshot.runner, nativeRoot, snapshot.native.sessionId, snapshot.native.cwd, home, selectionHash(snapshot), snapshot.createdAt, snapshot.createdAt);
      const put = this.store.sqlite.prepare("INSERT INTO capability_session_refs(task_id,ref_kind,ref_id,ref_hash,relative_path) VALUES(?,?,?,?,?)");
      for (const ref of refs) put.run(snapshot.taskId, ref.refKind, ref.refId, ref.refHash, ref.relativePath);
      for (const mcp of snapshot.mcp) this.store.sqlite.prepare("INSERT INTO capability_session_mcp_names(server_name,task_id,kind) VALUES(?,?,?)").run(mcp.serverName, snapshot.taskId, mcp.kind);
      return this.read(snapshot.taskId);
    }).immediate());
    await this.ensureMirror(snapshot.taskId);
    return saved;
  }
  async bindNativeSession(taskId, expectedHash, native) {
    const saved = await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const current = this.read(taskId), snapshot = current.snapshot, identity2 = this.store.sqlite.prepare("SELECT * FROM capability_session_identities WHERE task_id=?").get(taskId);
      if (current.retention !== "active" || native.runner !== snapshot.runner || native.stateRoot !== snapshot.native.stateRoot || native.cwd !== snapshot.native.cwd || canonicalFuturePath(native.stateRoot) !== identity2.identity_root) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原生身份、目录或保留状态不同，不能补写到此快照");
      if (snapshot.native.sessionId !== null) {
        if (snapshot.native.sessionId !== native.sessionId) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原生会话ID已固定，不能替换");
        return current;
      }
      if (current.pointer.snapshotHash !== expectedHash) throw new ApplicationError("RESOURCE_STATE_CHANGED", "快照已变化，请重新读取原身份");
      const parsed = capabilitySessionSnapshotSchema.safeParse({ ...snapshot, native: { ...snapshot.native, sessionId: native.sessionId } });
      if (!parsed.success) throw new ApplicationError("INVALID_INPUT", "原生会话ID无效");
      const next = parsed.data;
      if (this.store.sqlite.prepare("SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=? AND task_id<>?").get(native.runner, identity2.identity_root, native.sessionId, taskId)) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原生会话已属于另一任务");
      const bytes = canonicalJson(next), hash2 = digest(bytes), now = (/* @__PURE__ */ new Date()).toISOString();
      if (snapshot.legacyBinding) {
        const original = assertLegacySessionSource(this.store, snapshot);
        const result = this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET bound_native_session_id=?,updated_at=? WHERE task_id=? AND source_snapshot_hash=? AND state='migrated' AND bound_native_session_id IS NULL").run(native.sessionId, now, taskId, original.row.source_snapshot_hash);
        if (result.changes !== 1) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原M4迁移的原生身份已经绑定");
      }
      this.store.sqlite.prepare("UPDATE capability_session_snapshots SET snapshot_json=?,snapshot_hash=? WHERE task_id=? AND snapshot_hash=?").run(bytes, hash2, taskId, expectedHash);
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_snapshot_versions(snapshot_hash,task_id,snapshot_json,selection_hash,created_at) VALUES(?,?,?,?,?)").run(hash2, taskId, bytes, selectionHash(next), now);
      this.store.sqlite.prepare("UPDATE capability_session_identities SET session_id=?,updated_at=? WHERE task_id=?").run(native.sessionId, now, taskId);
      this.store.sqlite.prepare("UPDATE capability_runs SET snapshot_hash=? WHERE task_id=? AND snapshot_hash=? AND state IN ('prepared','active','stopping')").run(hash2, taskId, expectedHash);
      return this.read(taskId);
    }).immediate());
    await this.ensureMirror(taskId);
    return saved;
  }
  async verifyNativeIdentity(taskId, actual) {
    const current = await this.get(taskId), native = current.snapshot.native;
    if (current.retention !== "active") throw new ApplicationError("SESSION_ON_HOLD", "此会话处于保留状态，不能授予运行能力");
    const identity2 = this.store.sqlite.prepare("SELECT identity_root FROM capability_session_identities WHERE task_id=?").get(taskId);
    if (actual.runner !== current.snapshot.runner || actual.stateRoot !== native.stateRoot || actual.cwd !== native.cwd || actual.sessionId !== native.sessionId || canonicalFuturePath(actual.stateRoot) !== identity2.identity_root || canonicalFuturePath(actual.home) !== current.discoveryHome) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原生身份或发现目录与固定会话不同，不自动迁移或注入");
    if (native.sessionId !== null) {
      let available = false;
      try {
        available = node_fs.statSync(actual.stateRoot).isDirectory();
      } catch {
      }
      if (!available) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原生会话状态目录缺失或不可用，保留原路径，不新建空根恢复");
    }
  }
  async references(taskId) {
    await this.get(taskId);
    return this.store.sqlite.prepare("SELECT ref_kind AS refKind,ref_id AS refId,ref_hash AS refHash,relative_path AS relativePath FROM capability_session_refs WHERE task_id=? ORDER BY ref_id").all(taskId);
  }
  async verifyResources(taskId) {
    const current = await this.get(taskId);
    if (current.retention !== "active") throw new ApplicationError("SESSION_ON_HOLD", "此会话能力处于保留或待核查状态");
    this.validatePackages(current.snapshot);
    for (const ref of await this.references(taskId)) {
      const resource = this.store.get(ref.refId);
      if (resource.kind !== ref.refKind || resource.contentHash !== ref.refHash || resource.relativePath !== ref.relativePath || resource.state !== "ready" || resource.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "固定资源缺失、状态改变或引用身份不同");
      if (ref.refKind === "application-package") {
        const p = this.packages.get(ref.refHash);
        verifyPackageTree(node_path.join(this.store.root, ref.relativePath), p, this.store.storeId);
      } else if (ref.refKind === "runtime") this.runtimes.verify(ref.refHash);
      else this.deps.verifyExtraResource(resource, current.snapshot);
    }
  }
  /** Host-only active roots. Full S and its long-term refs remain untouched. */
  scopedReferencesCoordinated(taskId, appIds2, projectionIds = [], independent = false) {
    const current = this.inspectCoordinated(taskId), snapshot = current.snapshot;
    if (snapshot.legacyBinding || snapshot.provenance !== "created" || !appIds2.length && !independent || independent && appIds2.length !== 0 || appIds2.length > 32 || new Set(appIds2).size !== appIds2.length || appIds2.some((id2) => !snapshot.packages.some((p) => p.appId === id2)) || new Set(projectionIds).size !== projectionIds.length || projectionIds.length > 4096) throw new ApplicationError("INVALID_INPUT", "本轮应用范围必须来自原固定选择");
    this.validatePackages({ ...snapshot, packages: snapshot.packages.filter((p) => appIds2.includes(p.appId)) });
    const expected = this.expectedSources(this.executionSelection(snapshot, appIds2)), all = this.store.sqlite.prepare("SELECT ref_kind AS refKind,ref_id AS refId,ref_hash AS refHash,relative_path AS relativePath FROM capability_session_refs WHERE task_id=?").all(taskId), roots = [];
    for (const [id2, source2] of expected) {
      const ref = all.find((r) => r.refId === id2);
      if (!ref || ref.refKind !== source2.kind || ref.refHash !== source2.hash) throw new ApplicationError("SNAPSHOT_CORRUPT", "本轮所需原资源引用缺失或身份不同");
      roots.push(ref);
    }
    for (const ref of all.filter((r) => r.refKind === "legacy-runtime")) if (!roots.some((r) => r.refId === ref.refId)) roots.push(ref);
    for (const id2 of projectionIds) {
      const ref = all.find((r) => r.refId === id2);
      if (!ref || !["session-projection", "agent-projection", "claude-delivery"].includes(ref.refKind)) throw new ApplicationError("SCOPE_DENIED", "本轮投影须已登记到原会话");
      if (!roots.some((r) => r.refId === id2)) roots.push(ref);
    }
    return roots.sort((a, b) => compareCodePoints(a.refId, b.refId));
  }
  async verifyScopedResources(taskId, appIds2, projectionIds, independent = false) {
    const current = await this.get(taskId);
    if (current.retention !== "active") throw new ApplicationError("SESSION_ON_HOLD", "原会话能力处于保留状态");
    const roots = this.scopedReferencesCoordinated(taskId, appIds2, projectionIds, independent);
    for (const ref of roots) {
      const resource = this.store.get(ref.refId);
      if (resource.kind !== ref.refKind || resource.contentHash !== ref.refHash || resource.relativePath !== ref.relativePath || resource.state !== "ready" || resource.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "本轮固定资源身份或状态已改变");
      if (ref.refKind === "application-package") {
        const pack = this.packages.get(ref.refHash);
        verifyPackageTree(node_path.join(this.store.root, ref.relativePath), pack, this.store.storeId);
      } else if (ref.refKind === "runtime") this.runtimes.verify(ref.refHash);
      else this.deps.verifyExtraResource(resource, current.snapshot);
    }
  }
  async addProjectionReference(taskId, expectedHash, resourceId) {
    const current = await this.get(taskId), resource = this.store.get(resourceId);
    if (!["session-projection", "agent-projection", "claude-projection-source", "claude-projection-archive", "claude-delivery"].includes(resource.kind) || resource.state !== "ready" || resource.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "投影未完成发布");
    this.deps.verifyExtraResource(resource, current.snapshot);
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const known = this.read(taskId), fresh = this.store.get(resourceId);
      if (known.retention !== "active" || known.pointer.snapshotHash !== expectedHash || known.selectionHash !== current.selectionHash || fresh.state !== "ready" || fresh.generation !== resource.generation) throw new ApplicationError("RESOURCE_STATE_CHANGED", "登记投影期间快照或资源已变化");
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_session_refs(task_id,ref_kind,ref_id,ref_hash,relative_path) VALUES(?,?,?,?,?)").run(taskId, resource.kind, resourceId, resource.contentHash, resource.relativePath);
      const ref = this.store.sqlite.prepare("SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind=? AND ref_id=?").get(taskId, resource.kind, resourceId);
      if (ref.ref_hash !== resource.contentHash || ref.relative_path !== resource.relativePath) throw new ApplicationError("SNAPSHOT_CORRUPT", "已有投影引用与本次资源不同");
    }).immediate());
  }
  /** The old launcher also consumes its fixed runtime when the context MCP is disabled. */
  async addLegacyRuntimeReference(taskId, expectedHash, hash2) {
    const current = await this.get(taskId), resource = this.store.get("legacy-runtime:" + hash2);
    if (resource.kind !== "legacy-runtime" || resource.contentHash !== hash2 || resource.relativePath !== "runtime/" + hash2 || resource.state !== "ready" || resource.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "原启动资源未就绪");
    this.deps.verifyExtraResource(resource, current.snapshot);
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const known = this.read(taskId), fresh = this.store.get(resource.resourceId);
      if (known.retention !== "active" || known.pointer.snapshotHash !== expectedHash || fresh.generation !== resource.generation || fresh.state !== "ready") throw new ApplicationError("RESOURCE_STATE_CHANGED", "登记启动资源期间原快照已变化");
      const prior = this.store.sqlite.prepare("SELECT ref_hash FROM capability_session_refs WHERE task_id=? AND ref_kind='legacy-runtime'").all(taskId);
      if (prior.some((ref) => ref.ref_hash !== hash2)) throw new ApplicationError("SNAPSHOT_IMMUTABLE", "原启动资源已经固定，不能替换");
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_session_refs VALUES(?,?,?,?,?)").run(taskId, "legacy-runtime", resource.resourceId, hash2, resource.relativePath);
    }).immediate());
  }
  async tombstone(taskId) {
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      this.store.sqlite.prepare("UPDATE capability_session_holds SET previous_retention='tombstone' WHERE task_id=?").run(taskId);
      const result = this.store.sqlite.prepare("UPDATE capability_session_snapshots SET retention_state=CASE WHEN retention_state='hold' THEN 'hold' ELSE 'tombstone' END WHERE task_id=?").run(taskId);
      if (!result.changes) throw new ApplicationError("NOT_FOUND", "此任务尚无能力保留记录");
    }).immediate());
  }
  async holdUnknown(input) {
    const parsed = zod.z.object({ taskId: zod.z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/), projectId: zod.z.string().min(1).max(128).nullable(), runner: zod.z.enum(["claude-code", "codex"]), stateRoot: zod.z.string().refine((s) => node_path.isAbsolute(s) && !/[\x00\r\n]/.test(s)), cwd: zod.z.string().refine((s) => node_path.isAbsolute(s) && !/[\x00\r\n]/.test(s)), sessionId: zod.z.string().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/).nullable(), reason: zod.z.enum(["history-unknown", "snapshot-corrupt"]) }).strict().safeParse(input);
    if (!parsed.success) throw new ApplicationError("INVALID_INPUT", "历史保留身份无效或包含未允许字段");
    input = parsed.data;
    await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const existing = this.store.sqlite.prepare(SELECT).get(input.taskId);
      if (existing) {
        this.quarantine(input.taskId, input.reason);
        return;
      }
      const snapshot = { schema: 0, ...input }, bytes = canonicalJson(snapshot);
      this.store.sqlite.prepare("INSERT INTO capability_session_snapshots(task_id,schema_version,snapshot_json,snapshot_hash,created_at,legacy_status,retention_state) VALUES(?,0,?,?,?,?,'hold')").run(input.taskId, bytes, digest(bytes), (/* @__PURE__ */ new Date()).toISOString(), input.reason);
      const nativeRoot = canonicalFuturePath(input.stateRoot), now = (/* @__PURE__ */ new Date()).toISOString();
      const claimed = input.sessionId && this.store.sqlite.prepare("SELECT 1 FROM capability_session_identities WHERE runner=? AND identity_root=? AND session_id=?").get(input.runner, nativeRoot, input.sessionId);
      if (!claimed) this.store.sqlite.prepare("INSERT INTO capability_session_identities(task_id,runner,identity_root,session_id,cwd,discovery_home,selection_hash,created_at,updated_at) VALUES(?,?,?,?,?,'',?,?,?)").run(input.taskId, input.runner, nativeRoot, input.sessionId, input.cwd, digest(bytes), now, now);
    }).immediate());
  }
  quarantine(taskId, reason) {
    const row = this.store.sqlite.prepare(SELECT).get(taskId);
    if (!row) return;
    this.store.sqlite.transaction(() => {
      this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_session_holds(task_id,previous_retention,reason,created_at) VALUES(?,?,?,?)").run(taskId, row.retention_state, reason, (/* @__PURE__ */ new Date()).toISOString());
      this.store.sqlite.prepare("UPDATE capability_session_snapshots SET retention_state='hold',legacy_status=? WHERE task_id=?").run(reason, taskId);
    }).immediate();
  }
  async repairFromRecordedVersion(taskId, expectedHash) {
    const saved = await withResourceLock(this.store.root, () => this.store.sqlite.transaction(() => {
      const row = this.store.sqlite.prepare(SELECT).get(taskId);
      const history = this.store.sqlite.prepare("SELECT snapshot_json,selection_hash FROM capability_snapshot_versions WHERE snapshot_hash=? AND task_id=?").get(expectedHash, taskId);
      const hold = this.store.sqlite.prepare("SELECT previous_retention,reason FROM capability_session_holds WHERE task_id=?").get(taskId);
      if (!row || row.schema_version !== 2 || row.snapshot_hash !== expectedHash || !history || hold && !["corrupt", "snapshot-corrupt"].includes(hold.reason)) throw new ApplicationError("SESSION_ON_HOLD", "没有与原登记hash匹配的已知版本，不能猜测或按当前默认重建");
      let original;
      try {
        original = capabilitySessionSnapshotSchema.parse(JSON.parse(history.snapshot_json));
      } catch {
        throw new ApplicationError("SNAPSHOT_CORRUPT", "原登记备份也不可核验");
      }
      if (digest(canonicalJson(original)) !== expectedHash || selectionHash(original) !== history.selection_hash) throw new ApplicationError("SNAPSHOT_CORRUPT", "原登记版本摘要不匹配");
      this.store.sqlite.prepare("UPDATE capability_session_snapshots SET snapshot_json=?,retention_state=?,legacy_status=? WHERE task_id=? AND snapshot_hash=?").run(history.snapshot_json, (hold == null ? void 0 : hold.previous_retention) ?? row.retention_state, original.provenance, taskId, expectedHash);
      const verified = this.read(taskId);
      this.store.sqlite.prepare("DELETE FROM capability_session_holds WHERE task_id=?").run(taskId);
      return verified;
    }).immediate());
    await this.ensureMirror(taskId);
    return saved;
  }
  hasUnresolvedHistory() {
    return !!this.store.sqlite.prepare("SELECT 1 FROM capability_session_snapshots WHERE schema_version<>2 OR retention_state='hold' OR legacy_status IN ('corrupt','history-unknown','snapshot-corrupt') LIMIT 1").get();
  }
  async ensureMirror(taskId) {
    return withResourceLock(this.store.root, () => {
      const current = this.read(taskId), path2 = ensureStoreDirectory(this.store.root, "sessions/" + taskId), marker = node_path.join(path2, ".smartdd-owned.json");
      const owner = { owner: "SmartDD", schema: 2, storeId: this.store.storeId, kind: "session", taskId, sourceHash: current.selectionHash };
      if (!node_fs.existsSync(marker)) {
        const names = node_fs.readdirSync(path2);
        if (names.length) throw new ApplicationError("OWNERSHIP_CONFLICT", "会话目录包含未登记内容，保留原样");
        node_fs.writeFileSync(marker, canonicalJson(owner) + "\n", { flag: "wx", mode: 384 });
      }
      if (node_fs.lstatSync(marker).isSymbolicLink()) throw new ApplicationError("OWNERSHIP_CONFLICT", "会话归属标记被链接占用");
      let known;
      try {
        known = JSON.parse(node_fs.readFileSync(marker, "utf8"));
      } catch {
        throw new ApplicationError("OWNERSHIP_CONFLICT", "会话归属标记不可读");
      }
      if (canonicalJson(known) !== canonicalJson(owner)) throw new ApplicationError("OWNERSHIP_CONFLICT", "会话目录归属或固定选择不同，不能覆盖");
      const target = node_path.join(path2, "snapshot.json"), bytes = canonicalJson({ schema: 2, snapshotHash: current.pointer.snapshotHash, selectionHash: current.selectionHash, snapshot: current.snapshot }) + "\n";
      let backup = null;
      if (node_fs.existsSync(target)) {
        const stat = node_fs.lstatSync(target);
        if (stat.isSymbolicLink() || !stat.isFile()) throw new ApplicationError("OWNERSHIP_CONFLICT", "快照镜像被其他内容占用");
        if (node_fs.readFileSync(target, "utf8") === bytes) return { repaired: false, backup: null };
        backup = node_path.join(ensureStoreDirectory(this.store.root, "conflicts"), `snapshot-${taskId}-${node_crypto.randomUUID()}.json`);
        node_fs.linkSync(target, backup);
      }
      const temp = node_path.join(path2, ".snapshot-" + node_crypto.randomUUID() + ".tmp");
      try {
        node_fs.writeFileSync(temp, bytes, { flag: "wx", mode: 384 });
        const fd = node_fs.openSync(temp, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
        try {
          node_fs.fsyncSync(fd);
        } finally {
          node_fs.closeSync(fd);
        }
        node_fs.renameSync(temp, target);
        const dir = node_fs.openSync(path2, node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
        try {
          node_fs.fsyncSync(dir);
        } finally {
          node_fs.closeSync(dir);
        }
      } catch (error) {
        if (node_fs.existsSync(temp)) node_fs.unlinkSync(temp);
        throw error;
      }
      return { repaired: true, backup };
    });
  }
}
const canceled = (signal) => {
  if (signal == null ? void 0 : signal.aborted) throw new ApplicationError("CANCELED", "原M4迁移准备已取消");
};
class LegacyTaskRetention {
  constructor(store, checkpoint) {
    __publicField(this, "legacy");
    this.store = store;
    this.checkpoint = checkpoint;
    this.legacy = new LegacyCapabilityResourceAdopter(store);
  }
  source(identity2, expected) {
    const task = this.store.sqlite.prepare("SELECT project_id,runner,state_root,cwd,native_session_id,runtime_snapshot FROM tasks WHERE id=?").get(identity2.taskId);
    let current;
    try {
      current = (task == null ? void 0 : task.runtime_snapshot) ? JSON.parse(task.runtime_snapshot) : null;
    } catch {
      throw new ApplicationError("SNAPSHOT_CORRUPT", "原任务快照JSON损坏");
    }
    const parsed = legacyRuntimeMetadata.safeParse(current);
    if (!task || task.project_id !== identity2.projectId || task.runner !== (identity2.runner === "codex" ? "codex" : "claude") || task.state_root !== identity2.stateRoot || task.cwd !== identity2.cwd || task.native_session_id !== identity2.sessionId || !parsed.success || canonicalJson(parsed.data) !== expected) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4任务或原生身份已变化，保留原记录");
    const held = this.store.sqlite.prepare("SELECT schema_version,retention_state,snapshot_json FROM capability_session_snapshots WHERE task_id=?").get(identity2.taskId);
    if (!held || held.schema_version !== 0 || held.retention_state !== "hold") throw new ApplicationError("SESSION_ON_HOLD", "原M4任务须先保留原生身份再准备迁移");
    const metadata = JSON.parse(held.snapshot_json);
    if (metadata.taskId !== identity2.taskId || metadata.projectId !== identity2.projectId || metadata.runner !== identity2.runner || metadata.stateRoot !== identity2.stateRoot || metadata.cwd !== identity2.cwd || metadata.sessionId !== null && metadata.sessionId !== identity2.sessionId) throw new ApplicationError("NATIVE_IDENTITY_CONFLICT", "原历史保留身份与迁移对象不同");
    return task.runtime_snapshot;
  }
  sameIdentity(previous, identity2) {
    try {
      const original = JSON.parse(previous);
      return (original.sessionId === identity2.sessionId || original.sessionId === null && identity2.sessionId !== null) && canonicalJson({ ...original, sessionId: identity2.sessionId }) === canonicalJson(identity2);
    } catch {
      return false;
    }
  }
  read(taskId) {
    return this.store.sqlite.prepare("SELECT * FROM capability_legacy_migration_preparations WHERE task_id=?").get(taskId);
  }
  manifest(evidence) {
    const fd = node_fs.openSync(node_path.join(evidence.runRoot, "manifest.json"), node_fs.constants.O_RDONLY | node_fs.constants.O_NOFOLLOW);
    try {
      const before = node_fs.fstatSync(fd);
      if (!before.isFile() || before.nlink !== 1 || before.size > 4 * 1024 * 1024) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原M4清单不可读");
      const buffer = Buffer.alloc(before.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const count = node_fs.readSync(fd, buffer, length, buffer.length - length, null);
        if (!count) break;
        length += count;
      }
      const bytes = buffer.subarray(0, length), after = node_fs.fstatSync(fd);
      if (length !== before.size || after.ino !== before.ino || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || digest(bytes) !== evidence.manifestHash || !Buffer.from(bytes.toString("utf8")).equals(bytes)) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4清单在准备中变化");
      return bytes.toString("utf8");
    } finally {
      node_fs.closeSync(fd);
    }
  }
  absent(runRoot) {
    try {
      node_fs.lstatSync(runRoot);
      return false;
    } catch (error) {
      return error.code === "ENOENT";
    }
  }
  archivedPlugin(evidence, manifest) {
    if (!evidence.pluginRoot) return null;
    try {
      const resource = this.store.get(legacyPluginResourceId(evidence.taskId, evidence.manifestHash)), content = new LegacyPluginSources(this.store).verify(resource, legacyPluginOrigin(evidence));
      if (content.manifest.toString("utf8") !== manifest) throw Error("different original manifest");
      return resource;
    } catch {
      throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原插件留存尚未完整发布或不能按原依据核验");
    }
  }
  verifyRetainedFiles(evidence, manifest) {
    if (!this.absent(evidence.runRoot)) {
      const plugin = this.archivedPlugin(evidence, manifest);
      if (!plugin) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原临时目录在留存恢复期间重新出现，保留原路径并重新核查");
      try {
        new LegacyPluginSources(this.store).verifyOriginalPlugin(plugin, legacyPluginOrigin(evidence));
      } catch {
        throw new ApplicationError("RESOURCE_STATE_CHANGED", "原路径不是已留存的完整静态插件，保留原路径并重新核查");
      }
    }
    try {
      for (const skill of evidence.skills) this.legacy.verify(this.store.get("standard-skill:" + skill.skillId + ":" + skill.hash));
      this.legacy.verify(this.store.get("legacy-runtime:" + evidence.runtimeHash));
      this.archivedPlugin(evidence, manifest);
    } catch {
      throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "最初留存的完整来源尚未就绪，保留准备回执等待修复");
    }
  }
  async prepare(input, value, signal) {
    var _a, _b, _c, _d;
    canceled(signal);
    const parsed = legacyRuntimeMetadata.safeParse(value);
    if (!parsed.success) throw new ApplicationError("SNAPSHOT_CORRUPT", "原M4快照格式不同");
    const snapshot = canonicalJson(parsed.data), sourceSnapshotHash = digest(snapshot), identity2 = { ...input, home: node_fs.realpathSync(input.home) }, identityJson = canonicalJson(identity2);
    const reader = new LegacyTaskEvidenceReader(this.store.root, identity2.home, (id2) => this.store.sqlite.prepare("SELECT id,skill_id AS skillId,name,version,hash FROM skill_versions WHERE id=?").get(id2));
    const originalRecord = this.source(identity2, snapshot);
    try {
      const inspection = reader.inspect(identity2, parsed.data);
      let evidence, manifest, fromRetained = false;
      if (inspection.state === "verified") {
        evidence = inspection.evidence;
        manifest = this.manifest(evidence);
      } else {
        const previous = this.read(identity2.taskId), runRoot = node_path.join(this.store.root, "runs", identity2.projectId, identity2.taskId, parsed.data.runId);
        if (inspection.code !== "LEGACY_MANIFEST_MISSING" || !previous || [previous.evidence_json, previous.evidence_hash, previous.manifest_json, previous.manifest_hash].every((v) => v === null)) return { state: "unknown", sourceSnapshotHash, code: inspection.code };
        if (previous.state === "migrated") throw new ApplicationError("SNAPSHOT_IMMUTABLE", "原M4迁移依据已被后续阶段使用");
        const retained2 = retainedLegacySource(this.store, identity2.taskId, previous.state);
        if (retained2.row.source_snapshot_json !== snapshot || retained2.row.source_record_json !== originalRecord || !this.sameIdentity(retained2.row.source_identity_json, identity2) || retained2.row.bound_native_session_id !== null && retained2.row.bound_native_session_id !== identity2.sessionId) throw new ApplicationError("SNAPSHOT_IMMUTABLE", "留存恢复对象与最初任务依据或原生身份不同");
        evidence = retained2.evidence;
        manifest = retained2.row.manifest_json;
        if (!this.absent(runRoot)) {
          try {
            const plugin = this.archivedPlugin(evidence, manifest);
            if (!plugin) throw Error("no original plugin");
            new LegacyPluginSources(this.store).verifyOriginalPlugin(plugin, legacyPluginOrigin(evidence));
          } catch {
            return { state: "unknown", sourceSnapshotHash, code: inspection.code };
          }
        }
        fromRetained = true;
      }
      const evidenceJson = canonicalJson(evidence), now = (/* @__PURE__ */ new Date()).toISOString(), verifyFiles = () => {
        if (fromRetained) this.verifyRetainedFiles(evidence, manifest);
        else if (!reader.verify(evidence)) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4证据在准备中变化");
      };
      const resources = [], retainSources = async () => {
        for (const skill of parsed.data.skills) {
          canceled(signal);
          resources.push(await this.legacy.adoptStandard(skill.skillId, skill.hash));
        }
        canceled(signal);
        resources.push(await this.legacy.adoptRuntime(evidence.runtimeHash));
        canceled(signal);
        const plugin = fromRetained ? this.archivedPlugin(evidence, manifest) : await new LegacyPluginSources(this.store).retain(reader, evidence);
        if (plugin) resources.push(plugin);
      };
      if (fromRetained) {
        canceled(signal);
        this.archivedPlugin(evidence, manifest);
        await retainSources();
      }
      await withResourceLock(this.store.root, () => {
        canceled(signal);
        verifyFiles();
        this.store.sqlite.transaction(() => {
          if (this.source(identity2, snapshot) !== originalRecord) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4任务记录在准备中变化");
          const previous = this.read(identity2.taskId);
          if (previous && (previous.source_snapshot_json !== snapshot || previous.source_record_json !== originalRecord || previous.source_snapshot_hash !== sourceSnapshotHash || !this.sameIdentity(previous.source_identity_json, identity2) || previous.bound_native_session_id !== null && previous.bound_native_session_id !== identity2.sessionId || previous.state === "migrated")) throw new ApplicationError("SNAPSHOT_IMMUTABLE", "原M4迁移依据已经登记，不能覆盖成另一任务或修订");
          if (previous && [previous.evidence_json, previous.evidence_hash, previous.manifest_json, previous.manifest_hash].some((v) => v !== null) && (previous.evidence_json !== evidenceJson || previous.evidence_hash !== evidence.evidenceHash || previous.manifest_json !== manifest || previous.manifest_hash !== evidence.manifestHash)) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原M4最初持久证据不同，保留原记录核查");
          if (!previous) this.store.sqlite.prepare("INSERT INTO capability_legacy_migration_preparations(task_id,source_snapshot_json,source_record_json,source_snapshot_hash,source_identity_json,bound_native_session_id,evidence_json,evidence_hash,manifest_json,manifest_hash,state,issue_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'held','MIGRATION_PREPARING',?,?)").run(identity2.taskId, snapshot, originalRecord, sourceSnapshotHash, identityJson, identity2.sessionId, evidenceJson, evidence.evidenceHash, manifest, evidence.manifestHash, now, now);
          else if (previous.evidence_json === null) this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET evidence_json=?,evidence_hash=?,manifest_json=?,manifest_hash=? WHERE task_id=?").run(evidenceJson, evidence.evidenceHash, manifest, evidence.manifestHash, identity2.taskId);
        }).immediate();
      }, { signal });
      if (evidence.pluginRoot) retainOriginalRun(evidence.runRoot, parsed.data, "intent");
      await ((_a = this.checkpoint) == null ? void 0 : _a.call(this, "intent-recorded"));
      canceled(signal);
      if (!fromRetained) await retainSources();
      await ((_b = this.checkpoint) == null ? void 0 : _b.call(this, "sources-adopted"));
      canceled(signal);
      verifyFiles();
      await ((_c = this.checkpoint) == null ? void 0 : _c.call(this, "before-commit"));
      canceled(signal);
      verifyFiles();
      await withResourceLock(this.store.root, () => {
        canceled(signal);
        verifyFiles();
        this.store.sqlite.transaction(() => {
          if (this.source(identity2, snapshot) !== originalRecord) throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4任务记录在准备中变化");
          const previous = this.read(identity2.taskId);
          if (!previous || previous.source_snapshot_hash !== sourceSnapshotHash || previous.source_snapshot_json !== snapshot || previous.source_record_json !== originalRecord || !this.sameIdentity(previous.source_identity_json, identity2) || previous.bound_native_session_id !== null && previous.bound_native_session_id !== identity2.sessionId || previous.state === "migrated") throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4准备登记在等待中变化");
          if (previous.evidence_json !== evidenceJson || previous.evidence_hash !== evidence.evidenceHash || previous.manifest_json !== manifest || previous.manifest_hash !== evidence.manifestHash) throw new ApplicationError("RESOURCE_RECOVERY_REQUIRED", "原M4已保留证据不同，须显式核查原路径修复");
          for (const expected of resources) {
            const actual = this.store.get(expected.resourceId);
            if (actual.generation !== expected.generation || actual.contentHash !== expected.contentHash || actual.kind !== expected.kind || actual.relativePath !== expected.relativePath || actual.pathScope !== "C" || actual.state !== "ready" || actual.integrity !== "valid") throw new ApplicationError("RESOURCE_STATE_CHANGED", "原M4资源身份在登记前变化");
            const old = this.store.sqlite.prepare("SELECT ref_hash,relative_path FROM capability_session_refs WHERE task_id=? AND ref_kind=? AND ref_id=?").get(identity2.taskId, actual.kind, actual.resourceId);
            if (old && (old.ref_hash !== actual.contentHash || old.relative_path !== actual.relativePath)) throw new ApplicationError("SNAPSHOT_CORRUPT", "原M4保留引用与原资源冲突");
            this.store.sqlite.prepare("INSERT OR IGNORE INTO capability_session_refs VALUES(?,?,?,?,?)").run(identity2.taskId, actual.kind, actual.resourceId, actual.contentHash, actual.relativePath);
          }
          this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET bound_native_session_id=COALESCE(bound_native_session_id,?),state='prepared',issue_code=NULL,updated_at=? WHERE task_id=? AND source_snapshot_hash=?").run(identity2.sessionId, (/* @__PURE__ */ new Date()).toISOString(), identity2.taskId, sourceSnapshotHash);
        }).immediate();
      }, { signal });
    } catch (error) {
      await withResourceLock(this.store.root, () => {
        this.store.sqlite.prepare("UPDATE capability_legacy_migration_preparations SET state='held',issue_code=?,updated_at=? WHERE task_id=? AND source_snapshot_hash=? AND state<>'migrated'").run(error instanceof ApplicationError ? error.code : "RESOURCE_RECOVERY_REQUIRED", (/* @__PURE__ */ new Date()).toISOString(), identity2.taskId, sourceSnapshotHash);
      });
      throw error;
    }
    const retained = retainedLegacySource(this.store, identity2.taskId, "prepared");
    if (retained.evidence.pluginRoot) retainOriginalRun(retained.evidence.runRoot, parsed.data, "committed");
    await ((_d = this.checkpoint) == null ? void 0 : _d.call(this, "committed"));
    return { state: "prepared", sourceSnapshotHash, code: null };
  }
}
const response = zod.z.discriminatedUnion("state", [
  zod.z.object({ schema: zod.z.literal(1), state: zod.z.literal("running"), pid: zod.z.number().int().positive().max(2147483647), startedAt: zod.z.string().regex(/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/) }).strict(),
  zod.z.object({ schema: zod.z.literal(1), state: zod.z.enum(["stopped", "unknown"]) }).strict()
]);
class MacProcessIdentityReader {
  constructor(helper) {
    this.helper = helper;
  }
  inspect(pid) {
    if (process.platform !== "darwin" || !Number.isSafeInteger(pid) || pid < 1 || pid > 2147483647) return { schema: 1, state: "unknown" };
    try {
      return response.parse(JSON.parse(node_child_process.execFileSync(this.helper, [String(pid)], { timeout: 2e3, maxBuffer: 4096, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })));
    } catch {
      return { schema: 1, state: "unknown" };
    }
  }
  read(pid) {
    const result = this.inspect(pid);
    return result.state === "running" && result.pid === pid ? { pid: result.pid, startedAt: result.startedAt } : null;
  }
  state(identity2) {
    if (!/^darwin-proc-v1:[1-9][0-9]*:[0-9]+$/.test(identity2.startedAt)) return "unknown";
    const result = this.inspect(identity2.pid);
    if (result.state !== "running") return result.state;
    return result.pid === identity2.pid && result.startedAt === identity2.startedAt ? "running" : "stopped";
  }
}
async function main() {
  const input = JSON.parse(node_fs.readFileSync(process.argv[2], "utf8"));
  assert(input.root.startsWith("/private/tmp/willyou-m10-legacy-history-"));
  for (const path2 of [input.userData, input.home, input.state, input.cwd]) assert(path2.startsWith(input.root + "/"));
  const sqlite = new Database(node_path.join(input.userData, "smartdd.db"));
  sqlite.pragma("foreign_keys=ON");
  const db = betterSqlite3.drizzle(sqlite, { schema });
  let cipherCalls = 0;
  const forbidden = () => {
    cipherCalls++;
    throw Error("No cipher access is allowed in this credential-free fixture");
  };
  const secrets = new SecretsStore(db, { isAvailable: forbidden, encrypt: forbidden, decrypt: forbidden });
  const projects2 = new ProjectService(db, secrets), capabilities = new CapabilityService({ db, projects: projects2, secrets, userData: input.userData });
  capabilities.setEnabled(input.projectId, MCP_CAPABILITY, false);
  const runtime2 = capabilities.prepare({ projectId: input.projectId, taskId: input.taskId, runner: "codex", cwd: input.cwd, home: input.home, profileArgs: input.flags });
  const raw = JSON.stringify(runtime2.snapshot, null, 2), at = Date.now();
  sqlite.prepare("INSERT INTO tasks(id,project_id,cwd,runner,ai_profile_id,ai_profile_name,native_session_id,state_root,title,first_message,runtime_snapshot,created_at,updated_at) VALUES(?,?,?,'codex',?,'Private legacy profile',NULL,?,'Known M4 fixture',?,?,?,?)").run(input.taskId, input.projectId, input.cwd, input.profileId, input.state, input.prompt, raw, at, at);
  const oldSkills = runtime2.snapshot.skills.filter((skill) => skill.enabled).map((skill) => ({ id: skill.skillId, name: skill.name, path: skill.path, hash: skill.hash, bodySha256: digest(node_fs.readFileSync(skill.path)), body: node_fs.readFileSync(skill.path, "utf8") }));
  assert(oldSkills.length > 0);
  const launch = runtime2.wrap(input.cli, [...input.flags, ...runtime2.args, "exec", "--json", "--skip-git-repo-check", input.prompt]);
  console.log(JSON.stringify({ phase: "prepared", pid: process.pid, launch, env: runtime2.env, raw, snapshot: runtime2.snapshot, oldSkills }));
  const lines = node_readline.createInterface({ input: process.stdin });
  try {
    const line = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("Private native execution did not return identity")), 6e4);
      lines.once("line", (value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
    const message = JSON.parse(line);
    assert(typeof message.nativeId === "string" && /^[a-f0-9-]{36}$/.test(message.nativeId));
    sqlite.prepare("UPDATE tasks SET native_session_id=?,native_history_observed=1 WHERE id=?").run(message.nativeId, input.taskId);
    const store = new ResourceStore(sqlite, input.userData, void 0, { processes: new MacProcessIdentityReader(input.processHelper) });
    const sessions2 = new CapabilitySessionRegistry(store, { assertInitialSelection: () => {
      throw Error("Legacy fixture must not select modern applications");
    } });
    const identity2 = { taskId: input.taskId, projectId: input.projectId, runner: "codex", stateRoot: input.state, cwd: input.cwd, sessionId: message.nativeId, home: input.home };
    const { home: _home, ...holdIdentity } = identity2;
    await sessions2.holdUnknown({ ...holdIdentity, reason: "history-unknown" });
    const retained = await new LegacyTaskRetention(store).prepare(identity2, runtime2.snapshot);
    assert.equal(retained.state, "prepared");
    assert.equal(cipherCalls, 0);
    const manifestPath = runtime2.snapshot.manifestPath;
    runtime2.release();
    assert(!node_fs.existsSync(manifestPath), "Normal original owner cleanup must remove the transient manifest");
    const removed = oldSkills[0];
    assert(removed.path.startsWith(node_path.join(input.home, ".agents/skills") + "/"));
    assert.equal(digest(node_fs.readFileSync(removed.path)), removed.bodySha256);
    node_fs.rmSync(node_path.dirname(removed.path), { recursive: true });
    assert(!node_fs.existsSync(removed.path));
    const result = { phase: "retained-and-cleaned", pid: process.pid, identity: identity2, retained, raw, oldSkills, removedPath: removed.path, cipherCalls, manifestAbsent: true };
    node_fs.writeFileSync(node_path.join(input.root, "legacy-source-result.json"), JSON.stringify(result, null, 2) + "\n");
    console.log(JSON.stringify(result));
  } finally {
    lines.close();
    capabilities.dispose();
    sqlite.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
