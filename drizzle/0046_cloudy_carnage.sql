CREATE TABLE `product_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_page_url` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`alt_text` text,
	`image_kind` text DEFAULT 'unknown' NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`og_title` text,
	`og_description` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_specs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`spec_key` text NOT NULL,
	`spec_value` text NOT NULL,
	`unit` text,
	`source_url` text,
	`confidence` integer DEFAULT 70 NOT NULL,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`source_url` text NOT NULL,
	`source_page_url` text,
	`cf_image_id` text,
	`delivery_url` text NOT NULL,
	`alt_text` text,
	`image_kind` text DEFAULT 'unknown' NOT NULL,
	`width` integer,
	`height` integer,
	`mime_type` text,
	`og_title` text,
	`og_description` text,
	`metadata_json` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `product_images_product_source_unique` ON `product_images` (`store_product_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `product_images_store_product_idx` ON `product_images` (`store_product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_specs_product_key_source_unique` ON `product_specs` (`store_product_id`,`spec_key`,`source_url`);--> statement-breakpoint
CREATE INDEX `product_specs_store_product_idx` ON `product_specs` (`store_product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_images_store_source_unique` ON `showroom_images` (`store_id`,`source_url`);--> statement-breakpoint
CREATE INDEX `showroom_images_store_idx` ON `showroom_images` (`store_id`);