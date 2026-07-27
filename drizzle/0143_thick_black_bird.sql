CREATE TABLE `properties` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`label` text,
	`street_number` text,
	`street_name` text,
	`city` text,
	`state` text,
	`zip_code` text,
	`place_id` text,
	`google_maps_link` text,
	`latitude` real,
	`longitude` real,
	`sf_assessor_block` text,
	`sf_assessor_lot` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `properties_primary_uniq` ON `properties` (`is_primary`) WHERE "properties"."is_primary" = 1;