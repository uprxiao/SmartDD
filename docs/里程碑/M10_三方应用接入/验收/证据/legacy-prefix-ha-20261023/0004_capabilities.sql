CREATE TABLE IF NOT EXISTS `project_capabilities` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`capability_id` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `skill_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`hash` text NOT NULL,
	`installed_at` integer NOT NULL,
	`active` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `runtime_snapshot` text;
