-- A host-only pre-fork narrowing receipt. Preserve the original preparation.
-- Never store argv, environment values, credentials or model claims here.
CREATE TABLE IF NOT EXISTS capability_run_restrictions (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_runs(run_id),
 evidence_json TEXT NOT NULL,
 evidence_hash TEXT NOT NULL,
 restricted_at TEXT NOT NULL
);
