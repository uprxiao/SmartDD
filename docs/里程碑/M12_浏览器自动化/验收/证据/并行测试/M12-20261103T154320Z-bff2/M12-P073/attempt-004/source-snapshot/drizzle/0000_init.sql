-- Hand-edited: IF NOT EXISTS lets this migration adopt databases created by M0 (no migration table).
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_secrets` (
	`key` text PRIMARY KEY NOT NULL,
	`secret` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`runner` text NOT NULL,
	`cwd` text NOT NULL,
	`native_session_id` text,
	`title` text NOT NULL,
	`created_at` integer NOT NULL
);
