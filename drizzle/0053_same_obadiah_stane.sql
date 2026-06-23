CREATE TABLE `showroom_gaps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`context` text NOT NULL,
	`gap_key` text NOT NULL,
	`room_name` text,
	`name` text NOT NULL,
	`description` text,
	`suggested_action` text,
	`source_signal_json` text,
	`status` text DEFAULT 'open' NOT NULL,
	`material_id` integer,
	`sweep_session_id` integer,
	`identified_at` integer DEFAULT (unixepoch()) NOT NULL,
	`dismissed_at` integer,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_gaps_ctx_key_idx` ON `showroom_gaps` (`context`,`gap_key`);--> statement-breakpoint
CREATE INDEX `showroom_gaps_status_idx` ON `showroom_gaps` (`status`);