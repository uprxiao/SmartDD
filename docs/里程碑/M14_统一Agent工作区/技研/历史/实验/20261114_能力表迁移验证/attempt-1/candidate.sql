
CREATE TABLE probe_bindings(
 binding_id TEXT PRIMARY KEY, task_id TEXT NOT NULL, runner TEXT NOT NULL,
 identity_root TEXT NOT NULL, native_id TEXT, cwd TEXT NOT NULL,
 legacy_task_id TEXT UNIQUE REFERENCES capability_session_snapshots(task_id),
 UNIQUE(binding_id,task_id), UNIQUE(runner,identity_root,native_id));
CREATE TABLE probe_cap_sessions(
 cap_id TEXT PRIMARY KEY, binding_id TEXT NOT NULL, task_id TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,snapshot_hash TEXT NOT NULL,retention_state TEXT NOT NULL,
 legacy_task_id TEXT UNIQUE REFERENCES capability_session_snapshots(task_id),
 UNIQUE(cap_id,task_id,binding_id),
 FOREIGN KEY(binding_id,task_id) REFERENCES probe_bindings(binding_id,task_id));
CREATE TABLE probe_cap_refs(
 cap_id TEXT NOT NULL REFERENCES probe_cap_sessions(cap_id),
 ref_id TEXT NOT NULL REFERENCES capability_resources(resource_id),
 ref_kind TEXT NOT NULL,ref_hash TEXT NOT NULL,relative_path TEXT NOT NULL,
 PRIMARY KEY(cap_id,ref_id,ref_kind));
CREATE TABLE probe_migration_receipt(version INTEGER PRIMARY KEY,source_schema_hash TEXT NOT NULL);
