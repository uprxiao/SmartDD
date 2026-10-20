-- Preserve the original resource PK/FKs and legacy unique key during this additive migration.
-- H rows use an unambiguous storage key in relative_path; scope_relative_path is the actual
-- path relative to the canonical discovery HOME. Existing C rows keep their original path.
--> statement-breakpoint
ALTER TABLE capability_resources ADD scope_identity TEXT NOT NULL DEFAULT '';
--> statement-breakpoint
ALTER TABLE capability_resources ADD scope_relative_path TEXT;
--> statement-breakpoint
UPDATE capability_resources SET scope_identity=owner_store_id WHERE path_scope='C' AND scope_identity='';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS capability_resources_discovery_path
  ON capability_resources(scope_identity,scope_relative_path) WHERE path_scope='H' AND state<>'removed';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS capability_discovery_roots (
  home_id TEXT PRIMARY KEY NOT NULL,
  canonical_home TEXT NOT NULL UNIQUE
);
