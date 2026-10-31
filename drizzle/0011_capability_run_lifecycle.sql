ALTER TABLE capability_runs ADD COLUMN revocation_state TEXT NOT NULL DEFAULT 'open';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_lease_resources (
  lease_id TEXT NOT NULL REFERENCES capability_resource_leases(lease_id) ON DELETE RESTRICT,
  resource_id TEXT NOT NULL REFERENCES capability_resources(resource_id) ON DELETE RESTRICT,
  content_hash TEXT NOT NULL,
  generation INTEGER NOT NULL,
  PRIMARY KEY(lease_id,resource_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_run_processes (
  process_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL CHECK(kind IN ('cli','bridge')),
  launch_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('reserved','armed','active','exited','canceled','unknown')),
  pid INTEGER,
  process_started_at TEXT,
  armed_at TEXT,
  attached_at TEXT,
  ended_at TEXT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS capability_run_processes_run_idx ON capability_run_processes(run_id);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS capability_run_one_cli_idx ON capability_run_processes(run_id) WHERE kind='cli';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_run_activities (
  activity_id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
  state TEXT NOT NULL CHECK(state IN ('active','finished','owner-stopped')),
  started_at TEXT NOT NULL,
  ended_at TEXT
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_store_state (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK(singleton=1),
  store_id TEXT NOT NULL,
  resource_generation INTEGER NOT NULL DEFAULT 1,
  maintenance_state TEXT NOT NULL CHECK(maintenance_state IN ('ready','pending','recovery-required')),
  maintenance_operation_id TEXT
);
