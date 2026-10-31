CREATE TABLE IF NOT EXISTS `capability_resources` (
  `resource_id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `content_hash` text NOT NULL,
  `owner_store_id` text NOT NULL,
  `path_scope` text NOT NULL CHECK (`path_scope` IN ('C','H')),
  `relative_path` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('staged','verified','ready','deleting','removed','recovery-required')),
  `generation` integer NOT NULL DEFAULT 1,
  `integrity` text NOT NULL CHECK (`integrity` IN ('unknown','valid','invalid')),
  `operation_id` text,
  UNIQUE (`owner_store_id`,`path_scope`,`relative_path`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_resource_dependencies` (
  `resource_id` text NOT NULL REFERENCES `capability_resources` (`resource_id`),
  `dependency_id` text NOT NULL REFERENCES `capability_resources` (`resource_id`),
  PRIMARY KEY (`resource_id`,`dependency_id`),
  CHECK (`resource_id` <> `dependency_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_resource_leases` (
  `lease_id` text PRIMARY KEY NOT NULL,
  `resource_id` text NOT NULL REFERENCES `capability_resources` (`resource_id`),
  `owner_kind` text NOT NULL,
  `owner_id` text NOT NULL,
  `host_instance_id` text NOT NULL,
  `pid` integer,
  `process_started_at` text,
  `state` text NOT NULL CHECK (`state` IN ('preparing','active','releasing','released','recovery-required')),
  `created_at` text NOT NULL,
  `ended_at` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `capability_resource_leases_resource_idx` ON `capability_resource_leases` (`resource_id`,`state`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_resource_operations` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `kind` text NOT NULL,
  `owner_store_id` text NOT NULL,
  `state` text NOT NULL,
  `plan_json` text NOT NULL,
  `error_code` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_packages` (
  `package_hash` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL,
  `version` text NOT NULL,
  `hash_algorithm` text NOT NULL CHECK (`hash_algorithm` = 'app-manifest-v1'),
  `relative_path` text NOT NULL,
  `manifest_json` text NOT NULL,
  `resource_id` text NOT NULL REFERENCES `capability_resources` (`resource_id`),
  `installed_at` text NOT NULL,
  UNIQUE (`app_id`,`version`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_active_packages` (
  `app_id` text PRIMARY KEY NOT NULL,
  `package_hash` text NOT NULL REFERENCES `capability_packages` (`package_hash`),
  `activation_generation` integer NOT NULL,
  `activated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_install_journal` (
  `install_id` text PRIMARY KEY NOT NULL REFERENCES `capability_resource_operations` (`operation_id`),
  `host_build` text NOT NULL,
  `from_generation` integer,
  `to_generation` integer,
  `state` text NOT NULL,
  `plan_json` text NOT NULL,
  `backup_path` text,
  `error_code` text,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_session_snapshots` (
  `task_id` text PRIMARY KEY NOT NULL,
  `schema_version` integer NOT NULL,
  `snapshot_json` text NOT NULL,
  `snapshot_hash` text NOT NULL,
  `created_at` text NOT NULL,
  `legacy_status` text NOT NULL,
  `retention_state` text NOT NULL CHECK (`retention_state` IN ('active','tombstone','hold'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_session_refs` (
  `task_id` text NOT NULL REFERENCES `capability_session_snapshots` (`task_id`),
  `ref_kind` text NOT NULL,
  `ref_id` text NOT NULL REFERENCES `capability_resources` (`resource_id`),
  `ref_hash` text NOT NULL,
  `relative_path` text NOT NULL,
  PRIMARY KEY (`task_id`,`ref_kind`,`ref_id`)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `capability_session_refs_resource_idx` ON `capability_session_refs` (`ref_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_runs` (
  `run_id` text PRIMARY KEY NOT NULL,
  `task_id` text NOT NULL REFERENCES `capability_session_snapshots` (`task_id`),
  `project_id` text NOT NULL REFERENCES `projects` (`id`),
  `runner` text NOT NULL,
  `pid` integer,
  `process_started_at` text,
  `state` text NOT NULL,
  `started_at` text NOT NULL,
  `ended_at` text,
  `error_code` text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `capability_schema_migrations` (
  `app_id` text NOT NULL,
  `migration_id` text NOT NULL,
  `checksum` text NOT NULL,
  `from_version` integer NOT NULL,
  `to_version` integer NOT NULL,
  `applied_at` text NOT NULL,
  `host_build` text NOT NULL,
  PRIMARY KEY (`app_id`,`migration_id`)
);
