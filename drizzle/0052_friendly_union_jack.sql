CREATE TABLE `material_schedule_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`title` text NOT NULL,
	`room_name` text,
	`brand` text,
	`model` text,
	`notes` text,
	`is_purchased` integer DEFAULT false,
	`purchased_showroom_product_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `material_required_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `material_id` integer REFERENCES material_schedule_items(id);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/