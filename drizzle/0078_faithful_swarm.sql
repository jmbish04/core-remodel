CREATE TABLE `store_product_intel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`review_summary` text,
	`price_range_low` text,
	`price_range_high` text,
	`ai_wholesale_price` text,
	`ai_wholesale_rationale` text,
	`ai_retail_price` text,
	`ai_retail_rationale` text,
	`ai_negotiated_price` text,
	`ai_negotiated_rationale` text,
	`sales_intel` text,
	`ca_regulatory_flag` integer,
	`ca_regulatory_notes` text,
	`research_report` text,
	`research_sources` text,
	`research_status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_intel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`review_summary` text,
	`review_ai_insight` text,
	`is_bigbox_available` integer,
	`bigbox_availability` text,
	`sales_intel` text,
	`research_report` text,
	`research_sources` text,
	`research_status` text DEFAULT 'idle' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_page_url` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`alt_text` text,
	`image_kind` text DEFAULT 'unknown' NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`metadata_json` text,
	`review_status` text DEFAULT 'pending' NOT NULL,
	`review_reason` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `brand_product_lines` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`product_type` text,
	`source_url` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `brands` ADD `facebook_url` text;--> statement-breakpoint
ALTER TABLE `brands` ADD `pinterest_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `store_product_intel_product_uniq` ON `store_product_intel` (`store_product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_intel_brand_uniq` ON `brand_intel` (`brand_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_images_brand_source_unique` ON `brand_images` (`brand_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `brand_images_brand_idx` ON `brand_images` (`brand_id`);--> statement-breakpoint
CREATE INDEX `brand_product_lines_brand_idx` ON `brand_product_lines` (`brand_id`);