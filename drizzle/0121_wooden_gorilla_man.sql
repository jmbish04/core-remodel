CREATE TABLE `material_categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `material_subcategories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`material_id` integer NOT NULL,
	`subcategory_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`material_id`) REFERENCES `material_schedule_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `brand_images` ADD `byte_size` integer;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `inactive_reason` text;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `image_group_key` text;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `group_sort_order` integer;--> statement-breakpoint
CREATE UNIQUE INDEX `material_categories_material_category_uniq` ON `material_categories` (`material_id`,`category_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `material_subcategories_material_subcategory_uniq` ON `material_subcategories` (`material_id`,`subcategory_id`);--> statement-breakpoint
CREATE INDEX `brand_images_brand_hash_idx` ON `brand_images` (`brand_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `brand_images_brand_group_idx` ON `brand_images` (`brand_id`,`image_group_key`,`group_sort_order`);