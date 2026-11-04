CREATE TABLE IF NOT EXISTS mail_blob_objects (
  content_hash TEXT PRIMARY KEY NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_attachment_objects (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  content_hash TEXT NOT NULL REFERENCES mail_blob_objects(content_hash) ON DELETE RESTRICT,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_blob_writes (
  operation_id TEXT PRIMARY KEY NOT NULL,
  attachment_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('preparing','staged','published','committed','failed')),
  error_code TEXT,
  cleanup_pending INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_pending IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  source_task_id TEXT,
  copied_from_draft_id TEXT REFERENCES mail_drafts(id) ON DELETE RESTRICT,
  subject TEXT NOT NULL,
  attachment_count INTEGER NOT NULL CHECK(attachment_count >= 0),
  current_revision INTEGER NOT NULL CHECK(current_revision >= 1),
  state TEXT NOT NULL CHECK(state IN ('draft','sending','sent','failed','unknown')),
  active_intent_id TEXT,
  last_execution_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mail_drafts_project_updated ON mail_drafts(project_id,updated_at,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_draft_revisions (
  draft_id TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE RESTRICT,
  revision INTEGER NOT NULL CHECK(revision >= 1),
  content_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  actor_task_id TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY(draft_id,revision)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_draft_mutations (
  project_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  draft_id TEXT NOT NULL REFERENCES mail_drafts(id) ON DELETE RESTRICT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(project_id,operation_id)
);
