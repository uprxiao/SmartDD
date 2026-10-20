CREATE TABLE IF NOT EXISTS `application_connections` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL CHECK (`app_id` IN ('zentao','mail')),
  `provider_id` text NOT NULL CHECK (`provider_id` IN ('zentao','foxmail','smtp')),
  `name` text NOT NULL,
  `config_schema_version` integer NOT NULL DEFAULT 1,
  `config_json` text NOT NULL,
  `revision` integer NOT NULL,
  `config_revision` integer NOT NULL,
  `identity_revision` integer NOT NULL,
  `verified_identity_json` text NOT NULL,
  `identity_hash` text NOT NULL,
  `secret_ref` text,
  `secret_revision` integer NOT NULL,
  `policy_revision` integer NOT NULL,
  `enabled` integer NOT NULL CHECK (`enabled` IN (0,1)),
  `auth_state` text NOT NULL CHECK (`auth_state` IN ('connected','disconnected')),
  `health` text NOT NULL CHECK (`health` IN ('unverified','healthy','unavailable')),
  `health_code` text,
  `health_message` text,
  `tested_at` text,
  `cleanup_pending` integer NOT NULL DEFAULT 0 CHECK (`cleanup_pending` IN (0,1)),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CHECK ((`provider_id`='zentao' AND `app_id`='zentao') OR (`provider_id` IN ('foxmail','smtp') AND `app_id`='mail'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `application_connections_provider_idx` ON `application_connections` (`provider_id`,`app_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `application_connections_identity_key` ON `application_connections` (`id`,`provider_id`,`app_id`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_secret_changes` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `connection_id` text NOT NULL,
  `expected_revision` integer NOT NULL,
  `old_secret_ref` text,
  `new_secret_ref` text,
  `candidate_hash` text NOT NULL,
  `candidate_json` text NOT NULL,
  `verified_identity_json` text,
  `compatibility_plan_json` text,
  `expires_at` text NOT NULL,
  `state` text NOT NULL CHECK (`state` IN ('preparing','validated','committed','cleanup-pending','failed','cleaned')),
  `error_code` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_catalog_state` (
  `app_id` text PRIMARY KEY NOT NULL CHECK (`app_id` IN ('zentao','mail')),
  `added` integer NOT NULL CHECK (`added` IN (0,1)),
  `enabled` integer NOT NULL CHECK (`enabled` IN (0,1)),
  `revision` integer NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_project_settings` (
  `project_id` text NOT NULL REFERENCES `projects` (`id`) ON DELETE CASCADE,
  `app_id` text NOT NULL CHECK (`app_id` IN ('zentao','mail')),
  `enabled` integer NOT NULL CHECK (`enabled` IN (0,1)),
  `binding_revision` integer NOT NULL,
  `pending_operation_id` text,
  `updated_at` text NOT NULL,
  PRIMARY KEY (`project_id`,`app_id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_project_bindings` (
  `project_id` text NOT NULL,
  `app_id` text NOT NULL,
  `slot` text NOT NULL CHECK (`slot` IN ('zentao','foxmail','smtp')),
  `connection_id` text NOT NULL,
  `identity_revision` integer NOT NULL,
  PRIMARY KEY (`project_id`,`app_id`,`slot`),
  FOREIGN KEY (`connection_id`,`slot`,`app_id`) REFERENCES `application_connections` (`id`,`provider_id`,`app_id`),
  FOREIGN KEY (`project_id`,`app_id`) REFERENCES `application_project_settings` (`project_id`,`app_id`) ON DELETE CASCADE,
  CHECK ((`app_id`='zentao' AND `slot`='zentao') OR (`app_id`='mail' AND `slot` IN ('foxmail','smtp')))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_binding_changes` (
  `operation_id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `app_id` text NOT NULL,
  `from_revision` integer NOT NULL,
  `to_revision` integer,
  `previous_json` text NOT NULL,
  `next_json` text NOT NULL,
  `state` text NOT NULL,
  `error_code` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
