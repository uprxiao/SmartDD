/** Compiled storage contract shared only with the host's one-time legacy export bridge. */
export const ZENTAO_RESOURCE_TABLE_SQL=`CREATE TABLE IF NOT EXISTS plugin_resources (
  resource_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,connection_id TEXT NOT NULL,identity_revision INTEGER NOT NULL,
  object_key TEXT NOT NULL REFERENCES application_zentao_revisions(object_key),object_revision TEXT NOT NULL,part TEXT NOT NULL,
  content_hash TEXT NOT NULL,byte_size INTEGER NOT NULL,media_type TEXT NOT NULL,
  UNIQUE(project_id,connection_id,identity_revision,object_key,object_revision,part));`;
