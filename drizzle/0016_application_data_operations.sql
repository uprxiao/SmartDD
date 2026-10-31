ALTER TABLE application_project_settings ADD COLUMN policy_revision INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_data_operations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  caller_kind TEXT NOT NULL CHECK(caller_kind IN ('ui','agent-run','index-job')),
  scope_kind TEXT NOT NULL CHECK(scope_kind IN ('project','connection-management','internal-index')),
  project_id TEXT,
  task_id TEXT,
  run_id TEXT,
  job_id TEXT,
  parent_operation_id TEXT,
  app_id TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  data_api INTEGER NOT NULL,
  action TEXT NOT NULL,
  semantics TEXT NOT NULL CHECK(semantics IN ('read','write')),
  scope_hash TEXT NOT NULL,
  targets_json TEXT NOT NULL DEFAULT '[]',
  attempt_count INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','unknown','cancelled')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  CHECK((caller_kind='agent-run' AND scope_kind='project' AND project_id IS NOT NULL AND task_id IS NOT NULL AND run_id IS NOT NULL AND job_id IS NULL AND parent_operation_id IS NULL)
    OR (caller_kind='ui' AND ((scope_kind='project' AND project_id IS NOT NULL) OR scope_kind='connection-management') AND task_id IS NULL AND run_id IS NULL AND job_id IS NULL AND parent_operation_id IS NULL)
    OR (caller_kind='index-job' AND scope_kind='internal-index' AND semantics='read' AND project_id IS NOT NULL AND task_id IS NULL AND run_id IS NULL AND job_id IS NOT NULL AND parent_operation_id IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS application_data_operations_project ON application_data_operations(project_id,started_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_data_resources (
  resource_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  backing_kind TEXT NOT NULL,
  object_id TEXT NOT NULL,
  object_revision TEXT NOT NULL,
  part TEXT NOT NULL,
  data_contract_major INTEGER NOT NULL,
  permission TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size>=0),
  media_type TEXT NOT NULL,
  minted_package_hash TEXT NOT NULL,
  minted_operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS application_data_resources_identity ON application_data_resources(project_id,app_id,backing_kind,object_id,object_revision,part,data_contract_major);
