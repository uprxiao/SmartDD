-- Hand-edited: IF NOT EXISTS keeps the migration safe to re-run (project rule: migrations must be idempotent).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_databases` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`env` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`vendor` text NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`database` text DEFAULT '' NOT NULL,
	`schema` text,
	`username` text DEFAULT '' NOT NULL,
	`access_level` text DEFAULT 'readonly' NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`last_test_at` integer,
	`last_test_ok` integer,
	`last_test_category` text,
	`last_test_message` text,
	`last_test_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_dirs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`path` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`env` text NOT NULL,
	`label` text DEFAULT '' NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text NOT NULL,
	`private_key_path` text,
	`default_root` integer DEFAULT false NOT NULL,
	`sudo_policy` text DEFAULT 'none' NOT NULL,
	`app_root` text,
	`logs_path` text,
	`note` text DEFAULT '' NOT NULL,
	`last_test_at` integer,
	`last_test_ok` integer,
	`last_test_category` text,
	`last_test_message` text,
	`last_test_ms` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`aliases` text DEFAULT '[]' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rules_path` text,
	`config_version` integer DEFAULT 1 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_databases_project_idx` ON `project_databases` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_dirs_project_idx` ON `project_dirs` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_servers_project_idx` ON `project_servers` (`project_id`);