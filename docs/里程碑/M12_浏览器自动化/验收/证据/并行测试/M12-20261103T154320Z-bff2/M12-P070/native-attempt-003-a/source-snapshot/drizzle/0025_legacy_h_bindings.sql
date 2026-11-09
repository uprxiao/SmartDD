ALTER TABLE `capability_legacy_migration_preparations` ADD `h_binding_hash` text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_legacy_h_bindings (
 task_id TEXT PRIMARY KEY NOT NULL REFERENCES capability_legacy_migration_preparations(task_id),
 binding_json TEXT NOT NULL,
 binding_hash TEXT NOT NULL,
 created_at TEXT NOT NULL
);

-- Original H aliases are derived without changing immutable S; retain the
-- anchor and receipt after task deletion. ALTER must stay at its statement start
-- for the runner's existing column replay guard.
