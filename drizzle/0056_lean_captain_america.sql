CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`website_url` text,
	`instagram_url` text,
	`icon_cf_images_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brand_types_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brand_type_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`brand_icon_cf_images_url` text,
	`type_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`type_id`) REFERENCES `brand_types_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_brand_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `instagram_url` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `icon_cf_images_url` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `overview_note_html` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `overview_note_markdown` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `brand_id` integer REFERENCES brands(id);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_type_mappings_brand_type_uniq` ON `brand_type_mappings` (`brand_id`,`type_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_brand_mappings_showroom_brand_uniq` ON `showroom_brand_mappings` (`showroom_id`,`brand_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/