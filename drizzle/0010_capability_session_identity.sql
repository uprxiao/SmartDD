CREATE TABLE IF NOT EXISTS capability_session_identities (
  task_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT,
  runner TEXT NOT NULL,
  identity_root TEXT NOT NULL,
  session_id TEXT,
  cwd TEXT NOT NULL,
  discovery_home TEXT NOT NULL,
  selection_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(runner,identity_root,session_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_session_mcp_names (
  server_name TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT,
  kind TEXT NOT NULL,
  UNIQUE(task_id,kind)
);
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN snapshot_hash TEXT;
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN owner_instance_id TEXT;
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN owner_pid INTEGER;
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN owner_started_at TEXT;
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN bindings_json TEXT NOT NULL DEFAULT '[]';
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN pty_id TEXT;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_snapshot_versions (
  snapshot_hash TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT,
  snapshot_json TEXT NOT NULL,
  selection_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_session_holds (
  task_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT,
  previous_retention TEXT NOT NULL CHECK(previous_retention IN ('active','tombstone','hold')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
-- @smartdd-rebuild-if-foreign-key capability_runs project_id
CREATE TABLE capability_runs_retained (
  run_id TEXT PRIMARY KEY NOT NULL,
  task_id TEXT NOT NULL REFERENCES capability_session_snapshots(task_id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL,
  runner TEXT NOT NULL,
  pid INTEGER,
  process_started_at TEXT,
  state TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  error_code TEXT,
  snapshot_hash TEXT,
  owner_instance_id TEXT,
  owner_pid INTEGER,
  owner_started_at TEXT,
  bindings_json TEXT NOT NULL DEFAULT '[]',
  pty_id TEXT
);
INSERT INTO capability_runs_retained(run_id,task_id,project_id,runner,pid,process_started_at,state,started_at,ended_at,error_code,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id)
SELECT run_id,task_id,project_id,runner,pid,process_started_at,state,started_at,ended_at,error_code,snapshot_hash,owner_instance_id,owner_pid,owner_started_at,bindings_json,pty_id FROM capability_runs;
DROP TABLE capability_runs;
ALTER TABLE capability_runs_retained RENAME TO capability_runs;
