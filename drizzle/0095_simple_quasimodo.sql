CREATE TABLE `product_showroom_photos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`product_id` integer NOT NULL,
	`showroom_id` integer,
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
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_showroom_photos_rag_uuid_uniq` ON `product_showroom_photos` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `product_showroom_photos_product_idx` ON `product_showroom_photos` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_showroom_photos_showroom_idx` ON `product_showroom_photos` (`showroom_id`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_product_price_observations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`source_type` text NOT NULL,
	`showroom_id` integer,
	`retailer_name` text,
	`retailer_url` text,
	`price` text,
	`sale_price` text,
	`discount_info` text,
	`price_cents` integer,
	`sale_price_cents` integer,
	`discount_pct` real,
	`condition` text,
	`lead_time` text,
	`notes` text,
	`observed_at` integer DEFAULT (unixepoch()) NOT NULL,
	`source_photo_id` integer,
	`confidence` integer DEFAULT 100 NOT NULL,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_photo_id`) REFERENCES `product_showroom_photos`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_product_price_observations`("id", "product_id", "source_type", "showroom_id", "retailer_name", "retailer_url", "price", "sale_price", "discount_info", "price_cents", "sale_price_cents", "discount_pct", "condition", "lead_time", "notes", "observed_at", "source_photo_id", "confidence", "review_status", "review_reason", "reviewed_at", "created_at", "updated_at") SELECT "id", "product_id", "source_type", "showroom_id", "retailer_name", "retailer_url", "price", "sale_price", "discount_info", "price_cents", "sale_price_cents", "discount_pct", "condition", "lead_time", "notes", "observed_at", "source_photo_id", "confidence", "review_status", "review_reason", "reviewed_at", "created_at", "updated_at" FROM `product_price_observations`;--> statement-breakpoint
DROP TABLE `product_price_observations`;--> statement-breakpoint
ALTER TABLE `__new_product_price_observations` RENAME TO `product_price_observations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `price_observations_product_idx` ON `product_price_observations` (`product_id`);--> statement-breakpoint
CREATE INDEX `price_observations_showroom_idx` ON `product_price_observations` (`showroom_id`);