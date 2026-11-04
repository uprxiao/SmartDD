-- Hand-edited: IF NOT EXISTS / INSERT OR IGNORE keep the migration safe to re-run (project rule: migrations must be idempotent).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `ai_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`runner` text NOT NULL,
	`executable` text,
	`env` text DEFAULT '[]' NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`color` text,
	`is_default` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`dir_id` text,
	`cwd` text NOT NULL,
	`ai_profile_id` text,
	`ai_profile_name` text,
	`runner` text NOT NULL,
	`native_session_id` text,
	`title` text NOT NULL,
	`first_message` text DEFAULT '' NOT NULL,
	`injected_env_names` text DEFAULT '[]' NOT NULL,
	`config_version` integer,
	`state_root` text,
	`archived_at` integer,
	`last_launched_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dir_id`) REFERENCES `project_dirs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`ai_profile_id`) REFERENCES `ai_profiles`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `tasks_project_idx` ON `tasks` (`project_id`);
--> statement-breakpoint
-- M0/M1 sessions become tasks without a project; the old table is kept untouched.
INSERT OR IGNORE INTO `tasks` (`id`, `cwd`, `runner`, `native_session_id`, `title`, `created_at`, `updated_at`, `last_launched_at`)
SELECT `id`, `cwd`, `runner`, `native_session_id`, `title`, `created_at`, `created_at`, `created_at` FROM `sessions`;
