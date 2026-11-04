-- Host-observed business identities for the activity view. These are metadata,
-- never credentials, permissions, executable arguments or user authorizations.
CREATE TABLE IF NOT EXISTS application_activity_subjects (
 operation_id TEXT NOT NULL REFERENCES application_data_operations(operation_id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('connection','mail-send','mail-draft')),
 subject_id TEXT NOT NULL,
 PRIMARY KEY(operation_id,kind,subject_id)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS application_activity_subjects_lookup ON application_activity_subjects(kind,subject_id,operation_id);
--> statement-breakpoint
-- Only the original preparation operation has a provable old link. Do not infer
-- later executes or reads from their arguments, timestamps, or current bindings.
INSERT OR IGNORE INTO application_activity_subjects(operation_id,kind,subject_id)
 SELECT s.operation_id,'mail-send',s.id FROM mail_send_intents s
 JOIN application_data_operations o ON o.operation_id=s.operation_id AND o.project_id=s.project_id AND o.app_id='mail';

--> statement-breakpoint
CREATE INDEX IF NOT EXISTS application_data_operations_activity_time ON application_data_operations(started_at,operation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS application_invocations_activity_time ON application_invocations(started_at,operation_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mail_send_intents_activity_time ON mail_send_intents(created_at,id);
