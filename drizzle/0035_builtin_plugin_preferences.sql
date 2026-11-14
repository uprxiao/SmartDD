CREATE TABLE IF NOT EXISTS builtin_plugin_defaults (
  app_id TEXT NOT NULL CHECK(app_id IN ('mail','browser')),
  slot TEXT NOT NULL,
  connection_id TEXT REFERENCES application_connections(id),
  revision INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(app_id,slot)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS builtin_plugin_project_preferences (
  project_id TEXT NOT NULL,
  app_id TEXT NOT NULL CHECK(app_id IN ('mail','browser')),
  slot TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('follow','individual')),
  PRIMARY KEY(project_id,app_id,slot),
  FOREIGN KEY(project_id,app_id) REFERENCES application_project_settings(project_id,app_id) ON DELETE CASCADE
);
--> statement-breakpoint
ALTER TABLE capability_runs ADD COLUMN binding_mode TEXT NOT NULL DEFAULT 'current' CHECK(binding_mode IN ('current','run'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS mail_sender_confirmation_versions (
  project_id TEXT NOT NULL,
  binding_hash TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  method TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  sender_id TEXT,
  confirmed_at TEXT NOT NULL,
  record_hash TEXT NOT NULL,
  PRIMARY KEY(project_id,binding_hash,receipt_id)
);
--> statement-breakpoint
INSERT OR IGNORE INTO mail_sender_confirmation_versions SELECT project_id,binding_hash,binding_json,method,receipt_id,sender_id,confirmed_at,record_hash FROM mail_sender_confirmations;
