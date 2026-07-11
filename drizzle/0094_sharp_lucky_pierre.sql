CREATE TABLE `product_price_observations` (
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
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `price_observations_product_idx` ON `product_price_observations` (`product_id`);--> statement-breakpoint
CREATE INDEX `price_observations_showroom_idx` ON `product_price_observations` (`showroom_id`);