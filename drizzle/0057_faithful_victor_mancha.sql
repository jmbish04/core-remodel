CREATE TABLE `showroom_pocs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`full_name` text,
	`title` text,
	`company` text,
	`phone` text,
	`email` text,
	`website` text,
	`address` text,
	`business_card_front_url` text,
	`business_card_back_url` text,
	`extracted_json` text,
	`is_active` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_product_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer NOT NULL,
	`product_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
/*
 SQLite does not support "Drop not null from column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html
                  https://stackoverflow.com/questions/2083543/modify-a-columns-type-in-sqlite3

 Due to that we don't generate migration automatically and it has to be done manually
*/--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `rating` integer;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `rating_context_html` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `rating_context_markdown` text;--> statement-breakpoint
ALTER TABLE `store_notes` ADD `title` text;--> statement-breakpoint
ALTER TABLE `store_notes` ADD `content_html` text;--> statement-breakpoint
ALTER TABLE `store_notes` ADD `content_markdown` text;--> statement-breakpoint
ALTER TABLE `showroom_images` ADD `note_html` text;--> statement-breakpoint
ALTER TABLE `showroom_images` ADD `note_markdown` text;--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_mappings_showroom_product_uniq` ON `showroom_product_mappings` (`showroom_id`,`product_id`);