CREATE TABLE `showroom_store_locations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`place_id` text,
	`google_maps_link` text,
	`bay_area_city_id` integer,
	`latitude` real,
	`longitude` real,
	`street_number` text,
	`street_name` text,
	`city` text,
	`state` text,
	`zip_code` text,
	`notes` text,
	`notes_markdown` text,
	`notes_html` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bay_area_city_id`) REFERENCES `store_bayarea_cities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `showroom_store_locations_store_idx` ON `showroom_store_locations` (`store_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_store_locations_place_id_uniq` ON `showroom_store_locations` (`place_id`);