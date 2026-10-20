ALTER TABLE mail_attachment_objects ADD COLUMN kind TEXT NOT NULL DEFAULT 'attachment' CHECK(kind IN ('attachment','message'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_send_intents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  source_task_id TEXT,
  source_run_id TEXT,
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  draft_content_hash TEXT NOT NULL,
  connection_id TEXT NOT NULL REFERENCES application_connections(id) ON DELETE RESTRICT,
  identity_revision INTEGER NOT NULL,
  config_revision INTEGER NOT NULL,
  policy_revision INTEGER NOT NULL,
  binding_revision INTEGER NOT NULL,
  identity_json TEXT NOT NULL,
  smtp_config_json TEXT NOT NULL,
  raw_write_id TEXT NOT NULL,
  raw_object_id TEXT REFERENCES mail_attachment_objects(id) ON DELETE RESTRICT,
  raw_hash TEXT,
  frozen_hash TEXT,
  envelope_json TEXT,
  message_id TEXT NOT NULL,
  review_json TEXT,
  review_hash TEXT,
  state TEXT NOT NULL CHECK(state IN ('preparing','awaiting-authorization','authorized','executing','server-accepted','failed','unknown','canceled','stale')),
  grant_id TEXT,
  execution_id TEXT,
  cancel_requested_at TEXT,
  owner_instance_id TEXT NOT NULL,
  owner_pid INTEGER NOT NULL,
  owner_started_at TEXT NOT NULL,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id,operation_id),
  FOREIGN KEY(draft_id,draft_revision) REFERENCES mail_draft_revisions(draft_id,revision) ON DELETE RESTRICT
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mail_send_intents_project_updated ON mail_send_intents(project_id,updated_at,id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_send_grants (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES mail_send_intents(id) ON DELETE RESTRICT,
  source TEXT NOT NULL CHECK(source IN ('renderer-confirmation','native-user-message')),
  evidence_id TEXT NOT NULL,
  evidence_hash TEXT NOT NULL,
  review_hash TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('active','used','revoked')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(source,evidence_id)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_send_executions (
  id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL UNIQUE REFERENCES mail_send_intents(id) ON DELETE RESTRICT,
  project_id TEXT NOT NULL,
  draft_id TEXT NOT NULL,
  draft_revision INTEGER NOT NULL,
  review_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('executing','server-accepted','failed','unknown')),
  result_json TEXT,
  secret_revision INTEGER NOT NULL,
  owner_instance_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(draft_id,draft_revision)
);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_binding_slot_revisions (
  project_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  PRIMARY KEY(project_id,app_id,slot),
  FOREIGN KEY(project_id,app_id) REFERENCES application_project_settings(project_id,app_id) ON DELETE CASCADE,
  CHECK((app_id='zentao' AND slot='zentao') OR (app_id='mail' AND slot IN ('foxmail','smtp')))
);
--> statement-breakpoint
INSERT OR IGNORE INTO application_binding_slot_revisions(project_id,app_id,slot,revision)
SELECT project_id,app_id,'zentao',binding_revision FROM application_project_settings WHERE app_id='zentao'
UNION ALL SELECT project_id,app_id,'foxmail',binding_revision FROM application_project_settings WHERE app_id='mail'
UNION ALL SELECT project_id,app_id,'smtp',binding_revision FROM application_project_settings WHERE app_id='mail';
