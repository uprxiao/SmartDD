CREATE TABLE IF NOT EXISTS `mail_sender_confirmations` (
  `project_id` text PRIMARY KEY NOT NULL,
  `binding_hash` text NOT NULL,
  `binding_json` text NOT NULL,
  `method` text NOT NULL CHECK (`method` IN ('automatic','user')),
  `receipt_id` text NOT NULL UNIQUE,
  `sender_id` text,
  `confirmed_at` text NOT NULL,
  `record_hash` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `mail_send_intents` ADD `sender_identity_hash` text;
