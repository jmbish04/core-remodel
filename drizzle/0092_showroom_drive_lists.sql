CREATE TABLE `drive_lists` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`notes` text,
	`status` text DEFAULT 'active' NOT NULL,
	`source_conversation` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `drive_lists_slug_uniq` ON `drive_lists` (`slug`);
--> statement-breakpoint
CREATE INDEX `drive_lists_status_idx` ON `drive_lists` (`status`);
--> statement-breakpoint
CREATE INDEX `drive_lists_created_idx` ON `drive_lists` (`created_at`);
--> statement-breakpoint
CREATE TABLE `drive_list_stops` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`drive_list_id` integer NOT NULL,
	`showroom_store_id` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`leg` text,
	`leg_window` text,
	`name` text NOT NULL,
	`city` text,
	`address` text,
	`phone` text,
	`hours` text,
	`note` text,
	`pick` text,
	`website_url` text,
	`latitude` real,
	`longitude` real,
	`is_optional` integer DEFAULT false NOT NULL,
	`visited` integer DEFAULT false NOT NULL,
	`visited_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`drive_list_id`) REFERENCES `drive_lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showroom_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `drive_list_stops_drive_idx` ON `drive_list_stops` (`drive_list_id`);
--> statement-breakpoint
CREATE INDEX `drive_list_stops_showroom_idx` ON `drive_list_stops` (`showroom_store_id`);
