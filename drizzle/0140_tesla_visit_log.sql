CREATE TABLE `showroom_visit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer,
	`drive_list_id` integer,
	`stop_id` integer,
	`arrival_at` integer,
	`departure_at` integer,
	`dwell_seconds` integer,
	`status` text DEFAULT 'TESLA_SOFT_ARRIVAL' NOT NULL,
	`type` text DEFAULT 'SHOWROOM_IN_PERSON' NOT NULL,
	`rating` integer,
	`notes_markdown` text,
	`notes_html` text,
	`gps_source` text,
	`latitude` real,
	`longitude` real,
	`soft_arrival_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`drive_list_id`) REFERENCES `drive_lists`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`stop_id`) REFERENCES `drive_list_stops`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`soft_arrival_id`) REFERENCES `showroom_visit_log`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `showroom_visit_log_store_idx` ON `showroom_visit_log` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_visit_log_status_idx` ON `showroom_visit_log` (`status`);--> statement-breakpoint
CREATE INDEX `showroom_visit_log_drive_idx` ON `showroom_visit_log` (`drive_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_visit_log_soft_arrival_uniq` ON `showroom_visit_log` (`soft_arrival_id`) WHERE `soft_arrival_id` IS NOT NULL;
