-- Make product_showroom_photos.product_id nullable so the C2 intake wizard can
-- stage uploaded photos before a product row exists (product is only created at
-- "Process with AI"). SQLite/D1 can't ALTER COLUMN drop-NOT-NULL, so this rebuilds
-- the table. Children (photo_categories/photo_subcategories/photo_colors) FK to
-- this table with ON DELETE CASCADE and are verified empty pre-migration; any
-- pre-existing product_showroom_photos rows are preserved via the copy step.
CREATE TABLE `__new_product_showroom_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`product_id` integer,
	`showroom_id` integer,
	`bucket_id` integer,
	`file_name` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`image_url` text,
	`cf_image_id` text,
	`category` text,
	`photo_kind` text DEFAULT 'unknown' NOT NULL,
	`attributes` text,
	`status` text DEFAULT 'pending_review' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`bucket_id`) REFERENCES `product_photo_buckets`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_product_showroom_photos` (
	`id`, `rag_uuid`, `product_id`, `showroom_id`, `bucket_id`, `file_name`,
	`sort_order`, `image_url`, `cf_image_id`, `category`, `photo_kind`,
	`attributes`, `status`, `review_reason`, `reviewed_at`, `created_at`, `updated_at`
)
SELECT
	`id`, `rag_uuid`, `product_id`, `showroom_id`, `bucket_id`, `file_name`,
	`sort_order`, `image_url`, `cf_image_id`, `category`, `photo_kind`,
	`attributes`, `status`, `review_reason`, `reviewed_at`, `created_at`, `updated_at`
FROM `product_showroom_photos`;
--> statement-breakpoint
DROP TABLE `product_showroom_photos`;
--> statement-breakpoint
ALTER TABLE `__new_product_showroom_photos` RENAME TO `product_showroom_photos`;
--> statement-breakpoint
CREATE UNIQUE INDEX `product_showroom_photos_rag_uuid_uniq` ON `product_showroom_photos` (`rag_uuid`);
--> statement-breakpoint
CREATE INDEX `product_showroom_photos_product_idx` ON `product_showroom_photos` (`product_id`);
--> statement-breakpoint
CREATE INDEX `product_showroom_photos_showroom_idx` ON `product_showroom_photos` (`showroom_id`);
--> statement-breakpoint
CREATE INDEX `product_showroom_photos_bucket_idx` ON `product_showroom_photos` (`bucket_id`);
