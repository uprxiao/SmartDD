-- Exact app_settings fields/default from frozen src/main/db/schema.ts.
CREATE TABLE app_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL,updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
