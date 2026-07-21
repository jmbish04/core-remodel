ALTER TABLE `brand_images` ADD `byte_size` integer;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `inactive_reason` text;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `image_group_key` text;--> statement-breakpoint
ALTER TABLE `brand_images` ADD `group_sort_order` integer;--> statement-breakpoint
CREATE INDEX `brand_images_brand_hash_idx` ON `brand_images` (`brand_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `brand_images_brand_group_idx` ON `brand_images` (`brand_id`,`image_group_key`,`group_sort_order`);