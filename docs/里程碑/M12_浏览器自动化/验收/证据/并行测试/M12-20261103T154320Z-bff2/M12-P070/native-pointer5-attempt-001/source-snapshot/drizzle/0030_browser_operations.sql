CREATE TABLE IF NOT EXISTS browser_operations (
 run_id TEXT NOT NULL, request_id TEXT NOT NULL, task_id TEXT NOT NULL, page_id TEXT,
 command TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('accepted','running','succeeded','failed','unknown')),
 effect_state TEXT NOT NULL, progress TEXT, summary TEXT, error_code TEXT,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 PRIMARY KEY(run_id, request_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS browser_operations_created ON browser_operations(created_at);
