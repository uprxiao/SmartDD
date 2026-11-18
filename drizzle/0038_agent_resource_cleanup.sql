CREATE TABLE IF NOT EXISTS agent_pending_cleanup (
 cleanup_id TEXT PRIMARY KEY NOT NULL,
 project_id TEXT,
 task_id TEXT,
 kind TEXT NOT NULL CHECK(kind IN ('snapshot','attachment','artifact')),
 resource_json TEXT NOT NULL,
 last_error TEXT,
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS agent_pending_cleanup_due ON agent_pending_cleanup(next_attempt_at,cleanup_id);
--> statement-breakpoint
-- Retain the run and invocation history when the agent workspace that owned the run is deleted.
CREATE TABLE IF NOT EXISTS agent_retained_run_identity (
 run_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_runs(run_id) ON DELETE RESTRICT,
 binding_id TEXT NOT NULL,
 capability_session_id TEXT,
 driver_id TEXT NOT NULL,
 generation INTEGER NOT NULL
);
--> statement-breakpoint
DROP TRIGGER IF EXISTS capability_runs_owner_update;
--> statement-breakpoint
CREATE TRIGGER capability_runs_owner_update BEFORE UPDATE OF task_id,binding_id,capability_session_id,driver_id,generation ON capability_runs
WHEN NOT (
 NEW.task_id=OLD.task_id AND OLD.binding_id IS NOT NULL AND OLD.state IN ('stopped','failed','orphaned')
 AND NEW.binding_id IS NULL AND NEW.capability_session_id IS NULL AND NEW.driver_id IS NULL AND NEW.generation IS NULL
 AND EXISTS (SELECT 1 FROM agent_retained_run_identity a WHERE a.run_id=OLD.run_id AND a.binding_id=OLD.binding_id
   AND a.capability_session_id IS OLD.capability_session_id AND a.driver_id=OLD.driver_id AND a.generation=OLD.generation)
)
BEGIN
 SELECT RAISE(ABORT,'capability_runs: 运行归属不可修改');
END;
