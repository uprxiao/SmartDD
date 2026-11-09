ALTER TABLE `ai_profiles` ADD `command_pending` integer DEFAULT false NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_import_receipts` (
  `request_id` text PRIMARY KEY NOT NULL,
  `fingerprint` text NOT NULL,
  `result` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `imported_keys` (
  `server_id` text PRIMARY KEY NOT NULL,
  `path` text NOT NULL,
  `created_at` integer NOT NULL
);
