CREATE TABLE IF NOT EXISTS mail_user_action_sources (
  evidence_id TEXT PRIMARY KEY NOT NULL,
  intent_id TEXT NOT NULL REFERENCES mail_send_intents(id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('renderer-confirmation','native-user-message')),
  source_hash TEXT NOT NULL,
  provenance_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
