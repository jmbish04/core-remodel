CREATE TABLE `showroom_store_hitl_queue` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`latitude` real,
	`longitude` real,
	`place_id` text,
	`store_id` integer,
	`user_decision` text DEFAULT 'TBD' NOT NULL,
	`drive_list_id` integer,
	`proximity_scan_json` text,
	`category_guess` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`drive_list_id`) REFERENCES `drive_lists`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_exclusions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`place_id` text,
	`name` text,
	`latitude` real,
	`longitude` real,
	`reason_markdown` text,
	`reason_html` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `park_sessions` ADD `hitl_queue_id` integer REFERENCES showroom_store_hitl_queue(id);--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `is_identified_by_proximity_scan` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `proximity_scan_json` text;--> statement-breakpoint
ALTER TABLE `showroom_visit_log` ADD `hitl_queue_id` integer REFERENCES showroom_store_hitl_queue(id);--> statement-breakpoint
ALTER TABLE `drive_list_stops` ADD `is_detour` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `drive_list_stops` ADD `hitl_queue_id` integer REFERENCES showroom_store_hitl_queue(id);--> statement-breakpoint
CREATE INDEX `showroom_store_hitl_queue_decision_idx` ON `showroom_store_hitl_queue` (`user_decision`);--> statement-breakpoint
CREATE INDEX `showroom_store_hitl_queue_place_idx` ON `showroom_store_hitl_queue` (`place_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_hitl_queue_drive_idx` ON `showroom_store_hitl_queue` (`drive_list_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_exclusions_place_uniq` ON `showroom_exclusions` (`place_id`) WHERE "showroom_exclusions"."place_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX `showroom_exclusions_source_idx` ON `showroom_exclusions` (`source`);--> statement-breakpoint
CREATE INDEX `showroom_visit_log_hitl_queue_idx` ON `showroom_visit_log` (`hitl_queue_id`);--> statement-breakpoint
CREATE INDEX `drive_list_stops_hitl_queue_idx` ON `drive_list_stops` (`hitl_queue_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/