CREATE TABLE IF NOT EXISTS `schedule_manual_requests` (
	`plan_id` text NOT NULL,
	`request_id` text NOT NULL,
	`semantic` text NOT NULL,
	`receipt` text NOT NULL,
	`run_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`plan_id`, `request_id`),
	FOREIGN KEY (`plan_id`) REFERENCES `schedule_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_notification_events` (
	`key` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`run_id` text,
	`task_id` text,
	`turn_id` text,
	`request_id` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`delivered_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`revision` integer NOT NULL,
	`occurrence_key` text NOT NULL,
	`trigger` text NOT NULL,
	`due` integer NOT NULL,
	`claimed_at` integer NOT NULL,
	`missed_from` integer,
	`status` text NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`task_id` text,
	`input_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`turn_id` text,
	`reason` text,
	`started_at` integer,
	`finished_at` integer,
	`workspace_id` text,
	`actual_config` text,
	FOREIGN KEY (`plan_id`) REFERENCES `schedule_plans`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`schedule` text NOT NULL,
	`config` text NOT NULL,
	`grace` integer NOT NULL,
	`enabled` integer NOT NULL,
	`archived` integer DEFAULT 0 NOT NULL,
	`ended` integer DEFAULT 0 NOT NULL,
	`next_due` integer,
	`zone` text NOT NULL,
	`bound_task` text,
	`repair` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `schedule_workspace_links` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_kind` text NOT NULL,
	`owner_id` text NOT NULL,
	`project_id` text,
	`repo` text,
	`path` text NOT NULL,
	`base_ref` text,
	`base_commit` text,
	`branch` text,
	`status` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scheduled_turn_origins` (
	`turn_id` text PRIMARY KEY NOT NULL,
	`occurrence_id` text NOT NULL,
	`task_id` text NOT NULL,
	`input_id` text NOT NULL,
	`root_turn_id` text NOT NULL,
	`parent_turn_id` text,
	FOREIGN KEY (`occurrence_id`) REFERENCES `schedule_occurrences`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `schedule_occurrences_input_id_unique` ON `schedule_occurrences` (`input_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `schedule_occurrence_key` ON `schedule_occurrences` (`plan_id`,`occurrence_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `schedule_active_plan` ON `schedule_occurrences` (`plan_id`) WHERE "schedule_occurrences"."status" IN ('claimed','preparing','dispatching','running','waiting','unknown');
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `schedule_active_target` ON `schedule_occurrences` (`task_id`) WHERE "schedule_occurrences"."task_id" IS NOT NULL AND "schedule_occurrences"."status" IN ('claimed','preparing','dispatching','running','waiting','unknown');
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schedule_history_idx` ON `schedule_occurrences` (`plan_id`,`claimed_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `schedule_due_idx` ON `schedule_plans` (`next_due`) WHERE "schedule_plans"."enabled"=1 AND "schedule_plans"."archived"=0 AND "schedule_plans"."ended"=0 AND "schedule_plans"."repair" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `schedule_workspace_links_path_unique` ON `schedule_workspace_links` (`path`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `schedule_workspace_owner` ON `schedule_workspace_links` (`owner_kind`,`owner_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `scheduled_origin_input` ON `scheduled_turn_origins` (`task_id`,`input_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scheduled_origin_occurrence` ON `scheduled_turn_origins` (`occurrence_id`);
--> statement-breakpoint
ALTER TABLE application_data_operations ADD COLUMN standalone_task_id TEXT;
