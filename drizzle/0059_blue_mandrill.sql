CREATE TABLE `showroom_brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo_cf_image_id` text,
	`logo_cf_delivery_url` text,
	`website_url` text,
	`description` text,
	`price_point` text,
	`avg_rating` real,
	`rating_count` integer DEFAULT 0,
	`country_of_origin` text,
	`is_active` integer DEFAULT true,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `store_brand_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`brand_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `showroom_brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `brand_id` integer REFERENCES showroom_brands(id);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_brands_slug_unique` ON `showroom_brands` (`slug`);--> statement-breakpoint
CREATE INDEX `showroom_brands_name_idx` ON `showroom_brands` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `store_brand_mapping_unique` ON `store_brand_mapping` (`store_id`,`brand_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/