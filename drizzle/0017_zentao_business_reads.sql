CREATE TABLE IF NOT EXISTS application_zentao_revisions (
  object_key TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  identity_revision INTEGER NOT NULL,
  object_kind TEXT NOT NULL CHECK(object_kind IN ('bug','story')),
  native_id TEXT NOT NULL,
  content_revision TEXT NOT NULL,
  representation TEXT NOT NULL CHECK(representation IN ('summary','detail')),
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS application_zentao_revisions_identity ON application_zentao_revisions(project_id,connection_id,identity_revision,object_kind,native_id,content_revision,representation);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_zentao_files (
  object_key TEXT NOT NULL REFERENCES application_zentao_revisions(object_key),
  file_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  bytes BLOB NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size>=0),
  fetched_at TEXT NOT NULL,
  PRIMARY KEY(object_key,file_id,content_hash)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_zentao_cursors (
  cursor_id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  target_json TEXT NOT NULL,
  object_kind TEXT NOT NULL,
  page_size INTEGER NOT NULL,
  page_no INTEGER NOT NULL,
  expected_total INTEGER NOT NULL,
  seen_json TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_zentao_operation_objects (
  operation_id TEXT NOT NULL,
  object_key TEXT NOT NULL REFERENCES application_zentao_revisions(object_key),
  PRIMARY KEY(operation_id,object_key)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_read_receipt_checks (
  check_operation_id TEXT PRIMARY KEY NOT NULL,
  original_operation_id TEXT NOT NULL,
  checked_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_zentao_operation_resources (
  operation_id TEXT PRIMARY KEY NOT NULL,
  backing_json TEXT NOT NULL
);
