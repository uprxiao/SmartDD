CREATE TABLE IF NOT EXISTS capability_package_contracts (
  package_hash TEXT NOT NULL REFERENCES capability_packages(package_hash) ON DELETE RESTRICT,
  tool_name TEXT NOT NULL,
  input_source TEXT NOT NULL,
  output_source TEXT NOT NULL,
  PRIMARY KEY(package_hash,tool_name)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_invocations (
  operation_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
  request_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  project_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  package_hash TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  contract_major INTEGER NOT NULL,
  connection_id TEXT,
  semantics TEXT NOT NULL CHECK(semantics IN ('read','write')),
  state TEXT NOT NULL CHECK(state IN ('running','succeeded','failed','unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  effect_state TEXT NOT NULL CHECK(effect_state IN ('not-started','read-only','completed','unknown')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(run_id,request_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS application_invocations_project_idx ON application_invocations(project_id,started_at);
