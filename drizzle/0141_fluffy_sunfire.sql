CREATE TABLE `showroom_store_type` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`key` text NOT NULL,
	`display_name` text NOT NULL,
	`description` text,
	`html_color` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `type_id` integer REFERENCES showroom_store_type(id);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_store_type_key_uniq` ON `showroom_store_type` (`key`);
