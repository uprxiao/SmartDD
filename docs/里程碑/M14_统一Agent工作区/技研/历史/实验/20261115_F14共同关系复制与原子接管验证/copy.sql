CREATE TABLE m14_history_copy(
 id TEXT PRIMARY KEY,task_id TEXT NOT NULL,binding_id TEXT NOT NULL,cap_id TEXT NOT NULL,
 source_snapshot_hash TEXT NOT NULL,expected_selection INTEGER NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('planned','copying','copied','committed','retained','abandoned')),
 generation INTEGER NOT NULL CHECK(generation>0),owner_pid INTEGER NOT NULL,owner_birth TEXT NOT NULL,
 descriptor_json TEXT NOT NULL CHECK(json_valid(descriptor_json)),progress_json TEXT,
 FOREIGN KEY(cap_id,task_id,binding_id,source_snapshot_hash) REFERENCES m14_revision(cap_id,task_id,binding_id,snapshot_hash));
DROP TRIGGER m14_old_identity_guard;
CREATE TRIGGER m14_old_identity_guard BEFORE UPDATE ON capability_session_identities
WHEN EXISTS(SELECT 1 FROM m14_binding b WHERE b.task_id=NEW.task_id AND b.entry_mode='programmatic')
AND m14_copy_projection_allowed(NEW.task_id,OLD.identity_root,NEW.identity_root,OLD.session_id,NEW.session_id,OLD.cwd,NEW.cwd)=0
BEGIN SELECT RAISE(ABORT,'M14_LEGACY_IDENTITY_SEALED');END;

CREATE INDEX m14_history_copy_task_phase ON m14_history_copy(task_id,phase);
CREATE TRIGGER m14_copy_run_guard BEFORE INSERT ON capability_runs
WHEN EXISTS(SELECT 1 FROM m14_history_copy WHERE task_id=NEW.task_id AND phase IN ('planned','copying','copied','retained'))
BEGIN SELECT RAISE(ABORT,'M14_HISTORY_COPY_IN_PROGRESS');END;
