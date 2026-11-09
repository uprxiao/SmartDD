-- Preserve original M4 metadata before any schema2 migration or task pointer change.
-- These records and capability_session_refs survive deletion of the UI task/project.
-- prepared means verified source retention only, never native discovery or execution.
CREATE TABLE IF NOT EXISTS capability_legacy_migration_preparations (
 task_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_session_snapshots(task_id),
 source_snapshot_json TEXT NOT NULL,
 source_record_json TEXT NOT NULL,
 source_snapshot_hash TEXT NOT NULL,
 source_identity_json TEXT NOT NULL,
 bound_native_session_id TEXT,
 evidence_json TEXT,
 evidence_hash TEXT,
 manifest_json TEXT,
 manifest_hash TEXT,
 state TEXT NOT NULL CHECK(state IN ('held','prepared','migrated')),
 issue_code TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK((evidence_json IS NULL AND evidence_hash IS NULL AND manifest_json IS NULL AND manifest_hash IS NULL)
    OR (evidence_json IS NOT NULL AND evidence_hash IS NOT NULL AND manifest_json IS NOT NULL AND manifest_hash IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS capability_legacy_preparation_state ON capability_legacy_migration_preparations(state,task_id);
