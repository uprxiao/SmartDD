-- Offline rollback only: stop WillYou first. Preserves all original intent rows/columns.
BEGIN IMMEDIATE;
CREATE TEMP TABLE m11_rollback_guard (ok INTEGER CHECK(ok=1));
INSERT OR ROLLBACK INTO m11_rollback_guard SELECT CASE WHEN EXISTS(SELECT 1 FROM __drizzle_migrations WHERE created_at>1793507771201) THEN 0 ELSE 1 END;
DROP TABLE m11_rollback_guard;
ALTER TABLE mail_send_intents DROP COLUMN sender_identity_hash;
DROP TABLE mail_sender_confirmations;
DELETE FROM __drizzle_migrations WHERE hash='376aec9d05539593311b6c4dfd816a11b4694d9f9c92618b3eb2a7e9ba761dec';
COMMIT;
