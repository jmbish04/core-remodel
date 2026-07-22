CREATE TABLE `health_email_loopback` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`token` text NOT NULL,
	`stage` text DEFAULT 'sent_g2w' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`g2w_expected` integer NOT NULL,
	`g2w_gmail_message_id` text,
	`g2w_worker_email_id` integer,
	`g2w_received` integer DEFAULT false NOT NULL,
	`g2w_extract_ok` integer DEFAULT false NOT NULL,
	`w2g_expected` integer NOT NULL,
	`w2g_gmail_message_id` text,
	`w2g_received` integer DEFAULT false NOT NULL,
	`w2g_extract_ok` integer DEFAULT false NOT NULL,
	`last_error` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `health_email_loopback_token_idx` ON `health_email_loopback` (`token`);--> statement-breakpoint
CREATE INDEX `health_email_loopback_started_idx` ON `health_email_loopback` (`started_at`);