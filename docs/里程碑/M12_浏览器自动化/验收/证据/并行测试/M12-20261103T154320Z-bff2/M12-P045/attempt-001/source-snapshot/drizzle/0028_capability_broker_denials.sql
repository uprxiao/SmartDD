-- Host-only security metadata. No request bodies, client scope, credentials or paths.
CREATE TABLE IF NOT EXISTS capability_broker_denials (
 audit_id TEXT PRIMARY KEY NOT NULL,
 host_generation TEXT NOT NULL,
 run_id TEXT,
 bridge_id TEXT,
 method TEXT NOT NULL CHECK(method IN ('unknown','exchange','renew','tools/list','tools/call','cancel')),
 error_code TEXT NOT NULL,
 observed_at TEXT NOT NULL,
 CHECK ((run_id IS NULL AND bridge_id IS NULL) OR (run_id IS NOT NULL AND bridge_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS capability_broker_denials_run ON capability_broker_denials(run_id,observed_at);
