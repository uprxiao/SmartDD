CREATE TABLE IF NOT EXISTS capability_registry (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  runner TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_scope TEXT NOT NULL,
  project_root TEXT,
  source_label TEXT NOT NULL,
  version TEXT,
  validity TEXT NOT NULL,
  issues TEXT NOT NULL,
  managed INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  auto_approve INTEGER NOT NULL DEFAULT 0,
  present INTEGER NOT NULL DEFAULT 1,
  discovered_at INTEGER NOT NULL,
  scanned_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_registry_preferences (
  id INTEGER PRIMARY KEY NOT NULL CHECK (id = 1),
  auto_manage INTEGER NOT NULL DEFAULT 0,
  builtin_disabled TEXT NOT NULL DEFAULT '[]'
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_skill_placements (
  id TEXT PRIMARY KEY NOT NULL,
  capability_id TEXT NOT NULL REFERENCES capability_registry(id),
  target_root TEXT NOT NULL,
  name TEXT NOT NULL,
  project_root TEXT
);
