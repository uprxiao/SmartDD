CREATE TABLE IF NOT EXISTS ai_tools (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  executable TEXT NOT NULL,
  custom_path TEXT,
  version TEXT,
  installed INTEGER NOT NULL DEFAULT 0,
  login TEXT NOT NULL DEFAULT 'none' CHECK (login IN ('none', 'subscription', 'api', 'local')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_providers (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  preset TEXT,
  endpoints TEXT NOT NULL,
  auth_type TEXT NOT NULL DEFAULT 'bearer' CHECK (auth_type IN ('bearer', 'api-key')),
  secret_ref TEXT,
  identity_revision INTEGER NOT NULL DEFAULT 1,
  models TEXT NOT NULL DEFAULT '[]',
  recommended TEXT NOT NULL DEFAULT '{}',
  refreshed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_run_configs (
  profile_id TEXT PRIMARY KEY NOT NULL REFERENCES ai_profiles(id) ON DELETE CASCADE,
  tool_id TEXT NOT NULL REFERENCES ai_tools(id),
  source TEXT NOT NULL CHECK (source IN ('login', 'provider', 'legacy')),
  provider_id TEXT REFERENCES ai_providers(id),
  models TEXT NOT NULL DEFAULT '[]',
  default_model TEXT,
  home_visible INTEGER NOT NULL DEFAULT 1,
  logged_out INTEGER NOT NULL DEFAULT 0,
  name_customized INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL,
  legacy_reason TEXT,
  migration_version INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ai_run_config_provider_unique ON ai_run_configs(tool_id, provider_id) WHERE source = 'provider';
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS ai_run_config_login_unique ON ai_run_configs(tool_id) WHERE source = 'login';
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS ai_task_snapshots (
  task_id TEXT PRIMARY KEY NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL
);
