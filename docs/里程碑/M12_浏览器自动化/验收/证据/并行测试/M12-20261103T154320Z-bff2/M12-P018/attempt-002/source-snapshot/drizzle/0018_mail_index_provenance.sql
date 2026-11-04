CREATE TABLE IF NOT EXISTS application_index_waiters (
  index_operation_id TEXT NOT NULL REFERENCES application_data_operations(operation_id),
  parent_operation_id TEXT NOT NULL REFERENCES application_data_operations(operation_id),
  source_key TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  ended_at TEXT,
  state TEXT NOT NULL CHECK(state IN ('waiting','completed','cancelled','failed')),
  PRIMARY KEY(index_operation_id,parent_operation_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_mail_operation_sources (
  operation_id TEXT PRIMARY KEY NOT NULL REFERENCES application_data_operations(operation_id),
  source_key TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  operation_kind TEXT NOT NULL CHECK(operation_kind IN ('query','read','resource')),
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
