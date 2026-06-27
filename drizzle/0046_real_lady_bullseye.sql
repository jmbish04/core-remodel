CREATE TABLE `showroom_product_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_product_id` integer NOT NULL,
	`date_scraped` integer,
	`key` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`showroom_product_id` integer NOT NULL,
	`cf_image_url` text NOT NULL,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `material_schedule_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`date_added` integer DEFAULT (unixepoch()) NOT NULL,
	`title` text NOT NULL,
	`brand` text,
	`model` text,
	`is_purchased` integer DEFAULT false,
	`purchased_showroom_product_id` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`purchased_showroom_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null
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
ALTER TABLE `showroom_store_products` ADD `date_scraped` integer;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `material_id` integer;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `brand_name` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `model_no` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `product_url` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `listed_price_per_unit` real;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `sale_price_per_unit` real;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `is_favorite` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `favorite_reason` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `is_ignored` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `ignore_reason` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `research_findings_json` text;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `ai_score` integer;--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `ai_rationale` text;