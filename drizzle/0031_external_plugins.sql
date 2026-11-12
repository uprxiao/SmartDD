CREATE TABLE IF NOT EXISTS plugin_packages (
 package_hash TEXT PRIMARY KEY NOT NULL,
 bundle_hash TEXT NOT NULL,
 app_id TEXT NOT NULL,
 version TEXT NOT NULL,
 relative_path TEXT NOT NULL UNIQUE,
 manifest_json TEXT NOT NULL,
 created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_installations (
 app_id TEXT PRIMARY KEY NOT NULL,
 package_hash TEXT REFERENCES plugin_packages(package_hash) ON DELETE RESTRICT,
 installed INTEGER NOT NULL CHECK(installed IN (0,1)),
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
 revision INTEGER NOT NULL CHECK(revision > 0),
 updated_at TEXT NOT NULL,
 CHECK(installed=1 OR (enabled=0 AND package_hash IS NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_lifecycle_changes (
 change_id TEXT PRIMARY KEY NOT NULL,
 app_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('install','update','uninstall')),
 from_hash TEXT, to_hash TEXT,
 from_revision INTEGER NOT NULL,
 previous_enabled INTEGER NOT NULL CHECK(previous_enabled IN (0,1)),
 state TEXT NOT NULL CHECK(state IN ('preparing','prepared','swapping','committed','rolled-back','recovery-required')),
 payload_json TEXT NOT NULL,
 error_code TEXT,
 host_instance_id TEXT NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS plugin_lifecycle_pending ON plugin_lifecycle_changes(app_id)
 WHERE state IN ('preparing','prepared','swapping','recovery-required');
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_runtime_leases (
 lease_id TEXT PRIMARY KEY NOT NULL,
 app_id TEXT NOT NULL,
 package_hash TEXT NOT NULL REFERENCES plugin_packages(package_hash) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('invocation','activation')),
 host_instance_id TEXT NOT NULL,
 host_pid INTEGER NOT NULL,
 host_started_at TEXT NOT NULL,
 pid INTEGER,
 process_started_at TEXT,
 state TEXT NOT NULL CHECK(state IN ('reserved','launching','running','closed')),
 created_at TEXT NOT NULL, ended_at TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_runtime_health (
 app_id TEXT PRIMARY KEY NOT NULL,
 failures_json TEXT NOT NULL,
 paused INTEGER NOT NULL CHECK(paused IN (0,1)),
 error_code TEXT,
 updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_ui_reads (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES application_data_operations(operation_id) ON DELETE CASCADE,
 host_instance_id TEXT NOT NULL,
 host_pid INTEGER NOT NULL,
 host_started_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_write_approvals (
 operation_id TEXT PRIMARY KEY NOT NULL REFERENCES application_invocations(operation_id),
 approval_id TEXT NOT NULL UNIQUE,
 run_id TEXT NOT NULL,
 app_id TEXT NOT NULL,
 package_hash TEXT NOT NULL,
 capability TEXT NOT NULL,
 input_hash TEXT NOT NULL,
 review_hash TEXT NOT NULL,
 policy_hash TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','allowed','denied','cancelled','expired','invalidated')),
 host_instance_id TEXT NOT NULL,
 host_pid INTEGER NOT NULL,
 host_started_at TEXT NOT NULL,
 provenance_json TEXT,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL,
 decided_at INTEGER
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_connection_defaults (
 app_id TEXT PRIMARY KEY NOT NULL REFERENCES application_host_applications(app_id),
 connection_id TEXT REFERENCES application_connections(id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision>=0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_project_preferences (
 project_id TEXT NOT NULL,
 app_id TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('follow','individual')),
 PRIMARY KEY(project_id,app_id),
 FOREIGN KEY(project_id,app_id) REFERENCES application_project_settings(project_id,app_id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS plugin_builtin_migrations (
 app_id TEXT PRIMARY KEY NOT NULL,
 migration_version INTEGER NOT NULL CHECK(migration_version>0),
 package_hash TEXT NOT NULL,
 source_hash TEXT NOT NULL,
 tables_json TEXT NOT NULL,
 completed_at TEXT NOT NULL
);
