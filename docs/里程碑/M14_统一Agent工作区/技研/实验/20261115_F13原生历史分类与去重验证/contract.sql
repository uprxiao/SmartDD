CREATE TABLE m14_history_source(
 source_id TEXT PRIMARY KEY,task_id TEXT NOT NULL,binding_id TEXT NOT NULL,
 driver TEXT NOT NULL,native_id TEXT NOT NULL,stream TEXT NOT NULL,format TEXT NOT NULL,
 identity_json TEXT NOT NULL CHECK(json_valid(identity_json)),state TEXT NOT NULL,
 current_revision TEXT,
 FOREIGN KEY(binding_id,task_id) REFERENCES m14_binding(binding_id,task_id),
 FOREIGN KEY(source_id,current_revision) REFERENCES m14_history_revision(source_id,revision_hash));
CREATE TABLE m14_history_revision(
 source_id TEXT NOT NULL REFERENCES m14_history_source(source_id),revision_hash TEXT NOT NULL,
 byte_size INTEGER NOT NULL,manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
 observation_json TEXT NOT NULL CHECK(json_valid(observation_json)),
 PRIMARY KEY(source_id,revision_hash));
CREATE TABLE m14_history_record(
 source_id TEXT NOT NULL REFERENCES m14_history_source(source_id),record_key TEXT NOT NULL,
 raw_hash TEXT NOT NULL,raw_bytes BLOB NOT NULL,normalized_json TEXT NOT NULL CHECK(json_valid(normalized_json)),
 PRIMARY KEY(source_id,record_key,raw_hash));
