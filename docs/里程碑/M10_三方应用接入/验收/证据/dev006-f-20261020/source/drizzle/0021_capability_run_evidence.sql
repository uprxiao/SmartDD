-- Host observations only. Never credentials, arbitrary argv/configs, model claims,
-- user messages, or a replacement for application/send execution records.
CREATE TABLE IF NOT EXISTS capability_run_preparations (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_runs(run_id),
 evidence_json TEXT NOT NULL,
 evidence_hash TEXT NOT NULL,
 prepared_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_bridge_observations (
 run_id TEXT NOT NULL REFERENCES capability_runs(run_id),
 bridge_id TEXT NOT NULL REFERENCES capability_run_processes(process_id),
 evidence_json TEXT NOT NULL,
 evidence_hash TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 PRIMARY KEY(run_id,bridge_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS capability_run_evidence_time ON capability_run_preparations(prepared_at,run_id);
