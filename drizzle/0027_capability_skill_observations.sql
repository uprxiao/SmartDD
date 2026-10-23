-- Diagnostic metadata only; no Skill bodies, native messages or credentials.
CREATE TABLE IF NOT EXISTS capability_skill_observations (
 run_id TEXT NOT NULL REFERENCES capability_runs(run_id),
 app_id TEXT NOT NULL,
 skill_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('discovery','read')),
 evidence_json TEXT NOT NULL,
 evidence_hash TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 PRIMARY KEY(run_id,app_id,skill_id,kind)
);
