CREATE TABLE `budget_item_material_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`budget_item_track_id` text NOT NULL,
	`material_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_material_mappings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`material_id` integer NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `material_schedule_items` ADD `room_id` integer REFERENCES rooms(id);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_budget_item_material` ON `budget_item_material_mappings` (`budget_item_track_id`,`material_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `ux_product_material` ON `product_material_mappings` (`product_id`,`material_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/