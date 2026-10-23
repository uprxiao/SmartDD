-- @smartdd-foreign-key-rebuild
-- Host compiled definitions own these identities; rows alone never enable code.
CREATE TABLE IF NOT EXISTS application_host_applications (
 app_id TEXT PRIMARY KEY NOT NULL CHECK(length(app_id) BETWEEN 1 AND 64 AND app_id GLOB '[a-z]*' AND app_id NOT GLOB '*[^a-z0-9-]*')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_host_providers (
 provider_id TEXT PRIMARY KEY NOT NULL CHECK(length(provider_id) BETWEEN 1 AND 64 AND provider_id GLOB '[a-z]*' AND provider_id NOT GLOB '*[^a-z0-9-]*'),
 app_id TEXT NOT NULL REFERENCES application_host_applications(app_id) ON DELETE RESTRICT,
 config_api_major INTEGER NOT NULL CHECK(config_api_major=1),
 UNIQUE(provider_id,app_id)
);
--> statement-breakpoint
INSERT OR IGNORE INTO application_host_applications VALUES('zentao'),('mail');
--> statement-breakpoint
INSERT OR IGNORE INTO application_host_providers VALUES('zentao','zentao',1),('foxmail','mail',1),('smtp','mail',1);

--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_connections_host_next` (
  `id` text PRIMARY KEY NOT NULL,
  `app_id` text NOT NULL REFERENCES application_host_applications(app_id),
  `provider_id` text NOT NULL,
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
  FOREIGN KEY (`provider_id`,`app_id`) REFERENCES application_host_providers(provider_id,app_id)
);
--> statement-breakpoint
INSERT INTO application_connections_host_next(id,app_id,provider_id,name,config_schema_version,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,health_code,health_message,tested_at,cleanup_pending,created_at,updated_at) SELECT id,app_id,provider_id,name,config_schema_version,config_json,revision,config_revision,identity_revision,verified_identity_json,identity_hash,secret_ref,secret_revision,policy_revision,enabled,auth_state,health,health_code,health_message,tested_at,cleanup_pending,created_at,updated_at FROM application_connections;
--> statement-breakpoint
DROP TABLE application_connections;
--> statement-breakpoint
ALTER TABLE application_connections_host_next RENAME TO application_connections;
--> statement-breakpoint
CREATE INDEX application_connections_provider_idx ON application_connections(provider_id,app_id);
--> statement-breakpoint
CREATE UNIQUE INDEX application_connections_identity_key ON application_connections(id,provider_id,app_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_catalog_state_host_next` (
  `app_id` text PRIMARY KEY NOT NULL REFERENCES application_host_applications(app_id),
  `added` integer NOT NULL CHECK (`added` IN (0,1)),
  `enabled` integer NOT NULL CHECK (`enabled` IN (0,1)),
  `revision` integer NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO application_catalog_state_host_next(app_id,added,enabled,revision,updated_at) SELECT app_id,added,enabled,revision,updated_at FROM application_catalog_state;
--> statement-breakpoint
DROP TABLE application_catalog_state;
--> statement-breakpoint
ALTER TABLE application_catalog_state_host_next RENAME TO application_catalog_state;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_project_settings_host_next` (
  `project_id` text NOT NULL REFERENCES `projects` (`id`) ON DELETE CASCADE,
  `app_id` text NOT NULL REFERENCES application_host_applications(app_id),
  `enabled` integer NOT NULL CHECK (`enabled` IN (0,1)),
  `binding_revision` integer NOT NULL,
  `pending_operation_id` text,
  `updated_at` text NOT NULL,
  `policy_revision` INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (`project_id`,`app_id`)
);
--> statement-breakpoint
INSERT INTO application_project_settings_host_next(project_id,app_id,enabled,binding_revision,pending_operation_id,updated_at,policy_revision) SELECT project_id,app_id,enabled,binding_revision,pending_operation_id,updated_at,policy_revision FROM application_project_settings;
--> statement-breakpoint
DROP TABLE application_project_settings;
--> statement-breakpoint
ALTER TABLE application_project_settings_host_next RENAME TO application_project_settings;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `application_project_bindings_host_next` (
  `project_id` text NOT NULL,
  `app_id` text NOT NULL,
  `slot` text NOT NULL,
  `connection_id` text NOT NULL,
  `identity_revision` integer NOT NULL,
  PRIMARY KEY (`project_id`,`app_id`,`slot`),
  FOREIGN KEY (`connection_id`,`slot`,`app_id`) REFERENCES `application_connections` (`id`,`provider_id`,`app_id`),
  FOREIGN KEY (`project_id`,`app_id`) REFERENCES `application_project_settings` (`project_id`,`app_id`) ON DELETE CASCADE,
  FOREIGN KEY (`slot`,`app_id`) REFERENCES application_host_providers(provider_id,app_id)
);
--> statement-breakpoint
INSERT INTO application_project_bindings_host_next(project_id,app_id,slot,connection_id,identity_revision) SELECT project_id,app_id,slot,connection_id,identity_revision FROM application_project_bindings;
--> statement-breakpoint
DROP TABLE application_project_bindings;
--> statement-breakpoint
ALTER TABLE application_project_bindings_host_next RENAME TO application_project_bindings;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS application_binding_slot_revisions_host_next (
  project_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  slot TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision >= 0),
  PRIMARY KEY(project_id,app_id,slot),
  FOREIGN KEY(project_id,app_id) REFERENCES application_project_settings(project_id,app_id) ON DELETE CASCADE,
  FOREIGN KEY(slot,app_id) REFERENCES application_host_providers(provider_id,app_id)
);
--> statement-breakpoint
INSERT INTO application_binding_slot_revisions_host_next SELECT * FROM application_binding_slot_revisions;
--> statement-breakpoint
DROP TABLE application_binding_slot_revisions;
--> statement-breakpoint
ALTER TABLE application_binding_slot_revisions_host_next RENAME TO application_binding_slot_revisions;
