CREATE TABLE `park_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_id` text NOT NULL,
	`drive_list_id` integer,
	`stop_id` integer,
	`store_id` integer,
	`latitude` real,
	`longitude` real,
	`source` text NOT NULL,
	`parked_at` integer DEFAULT (unixepoch()) NOT NULL,
	`departed_at` integer,
	`dwell_seconds` integer,
	`status` text DEFAULT 'parked' NOT NULL,
	`visit_log_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`drive_list_id`) REFERENCES `drive_lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stop_id`) REFERENCES `drive_list_stops`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`visit_log_id`) REFERENCES `showroom_visit_log`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `park_sessions_subject_idx` ON `park_sessions` (`subject_id`);--> statement-breakpoint
CREATE INDEX `park_sessions_status_idx` ON `park_sessions` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `park_sessions_one_open_uniq` ON `park_sessions` (`subject_id`) WHERE "park_sessions"."status" = 'parked';