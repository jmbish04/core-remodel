CREATE TABLE `showroom_search` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slug` text NOT NULL,
	`title` text,
	`params_json` text,
	`status` text DEFAULT 'running' NOT NULL,
	`current_revision` integer DEFAULT 0 NOT NULL,
	`summary` text,
	`result_count` integer DEFAULT 0 NOT NULL,
	`origin` text,
	`origin_conversation` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `showroom_search_result` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`revision_id` integer NOT NULL,
	`place_id` text,
	`name` text,
	`location_street_number` text,
	`location_street_name` text,
	`location_city` text,
	`location_state` text,
	`location_zip_code` text,
	`full_address` text,
	`latitude` real,
	`longitude` real,
	`category_guess` text,
	`primary_type` text,
	`phone` text,
	`website` text,
	`google_rating` real,
	`user_rating_count` integer,
	`opening_hours_json` text,
	`source` text NOT NULL,
	`ai_relevance` real,
	`ai_reasoning` text,
	`distance_m` real,
	`in_directory` integer DEFAULT false NOT NULL,
	`existing_store_id` integer,
	`is_excluded` integer DEFAULT false NOT NULL,
	`matched_exclusion_id` integer,
	`imported_at` integer,
	`rank` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `showroom_search`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`revision_id`) REFERENCES `showroom_search_revision`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`existing_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`matched_exclusion_id`) REFERENCES `showroom_exclusions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_search_revision` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`search_id` integer NOT NULL,
	`revision_number` integer NOT NULL,
	`params_json` text,
	`source` text NOT NULL,
	`used_places` integer DEFAULT false NOT NULL,
	`change_note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`search_id`) REFERENCES `showroom_search`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_exclusions` ADD `location_street_number` text;--> statement-breakpoint
ALTER TABLE `showroom_exclusions` ADD `location_street_name` text;--> statement-breakpoint
ALTER TABLE `showroom_exclusions` ADD `location_city` text;--> statement-breakpoint
ALTER TABLE `showroom_exclusions` ADD `location_state` text;--> statement-breakpoint
ALTER TABLE `showroom_exclusions` ADD `location_zip_code` text;--> statement-breakpoint
ALTER TABLE `showroom_exclusions` ADD `category` text;--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_search_slug_uniq` ON `showroom_search` (`slug`);--> statement-breakpoint
CREATE INDEX `showroom_search_status_idx` ON `showroom_search` (`status`);--> statement-breakpoint
CREATE INDEX `showroom_search_result_search_idx` ON `showroom_search_result` (`search_id`);--> statement-breakpoint
CREATE INDEX `showroom_search_result_revision_idx` ON `showroom_search_result` (`revision_id`);--> statement-breakpoint
CREATE INDEX `showroom_search_result_place_idx` ON `showroom_search_result` (`place_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_search_revision_search_rev_uniq` ON `showroom_search_revision` (`search_id`,`revision_number`);--> statement-breakpoint
CREATE INDEX `showroom_search_revision_search_idx` ON `showroom_search_revision` (`search_id`);--> statement-breakpoint
CREATE INDEX `showroom_exclusions_zip_idx` ON `showroom_exclusions` (`location_zip_code`);