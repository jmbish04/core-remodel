CREATE TABLE `product_photo_buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_id` integer,
	`product_id` integer,
	`kind` text DEFAULT 'single' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`label` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `product_photo_buckets_showroom_idx` ON `product_photo_buckets` (`showroom_id`);
--> statement-breakpoint
ALTER TABLE `product_showroom_photos` ADD `bucket_id` integer REFERENCES product_photo_buckets(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE `product_showroom_photos` ADD `file_name` text;
--> statement-breakpoint
ALTER TABLE `product_showroom_photos` ADD `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `product_showroom_photos_bucket_idx` ON `product_showroom_photos` (`bucket_id`);
