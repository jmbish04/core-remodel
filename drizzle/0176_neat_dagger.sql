CREATE TABLE `jules_clearance_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_uuid` text NOT NULL,
	`jules_session_id` text,
	`job_id` text NOT NULL,
	`status` text DEFAULT 'booting' NOT NULL,
	`links_total` integer DEFAULT 0 NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`recorded` integer DEFAULT 0 NOT NULL,
	`unchanged` integer DEFAULT 0 NOT NULL,
	`empty` integer DEFAULT 0 NOT NULL,
	`errors` integer DEFAULT 0 NOT NULL,
	`fallback` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer
);
--> statement-breakpoint
CREATE INDEX `jules_clearance_sessions_uuid_idx` ON `jules_clearance_sessions` (`session_uuid`);--> statement-breakpoint
CREATE INDEX `jules_clearance_sessions_jules_idx` ON `jules_clearance_sessions` (`jules_session_id`);--> statement-breakpoint
CREATE INDEX `jules_clearance_sessions_created_idx` ON `jules_clearance_sessions` (`created_at`);