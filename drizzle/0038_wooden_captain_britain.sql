CREATE TABLE `store_bayarea_cities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`bay_area_city_name` text NOT NULL,
	`distance_from_san_francisco` text,
	`hub_route` text,
	`hub_name` text
);
--> statement-breakpoint
CREATE TABLE `showroom_stores` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`price_point` text,
	`bay_area_city_id` integer,
	`location_address` text,
	`phone_number` text,
	`email_address` text,
	`website_url` text,
	`zip_code` text,
	`google_maps_link` text,
	`weekday_hours` text,
	`weekend_hours` text,
	`is_open_weekends` integer DEFAULT false,
	`is_appointment_only` integer DEFAULT false,
	`is_flagship_location` integer DEFAULT false,
	`scale` text,
	`inventory_focus` text,
	`target_demographic` text,
	`main_poc_fullname` text,
	`main_poc_phone_number` text,
	`main_poc_email_address` text,
	`distance_from_sf_time` text,
	`distance_from_sf_miles` text,
	`ai_highlights_for_user_renovation` text,
	`location_notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`bay_area_city_id`) REFERENCES `store_bayarea_cities`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `showroom_store_products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`item_name` text NOT NULL,
	`description` text,
	`colors` text,
	`preferred_color` text,
	`sku` text,
	`price` text,
	`json_details` text,
	`notes` text,
	`lead_time` text,
	`possible_discounts` text,
	`trade_discount` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_store_category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `showroom_store_category_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	`ai_rationale` text,
	`ai_rationale_confidence_score` integer,
	`is_bread_butter` integer DEFAULT false,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `showroom_store_category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_docs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`type` text NOT NULL,
	`url` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`finding` text NOT NULL,
	`finding_url` text,
	`sentiment` text,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_research` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`finding` text NOT NULL,
	`finding_url` text,
	`sentiment` text,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_pa_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`product_area_id` integer NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_area_id`) REFERENCES `store_product_area_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_area_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_name` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`is_active` integer DEFAULT true
);
--> statement-breakpoint
CREATE TABLE `store_product_pa_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`product_area_id` integer NOT NULL,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`product_area_id`) REFERENCES `store_product_area_def`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`note` text NOT NULL,
	`is_active` integer DEFAULT true,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_notes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`note` text NOT NULL,
	`is_active` integer DEFAULT true,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_similar_model_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_store_product_id` integer NOT NULL,
	`similar_store_product_id` integer NOT NULL,
	`similar_model_price` text,
	`similar_model_price_diff` text,
	`ai_analysis` text,
	`ai_similarity_review_score` integer,
	`ai_similarity_review_score_rationale` text,
	`user_feedback_notes` text,
	`is_liked_by_user` integer,
	`user_rating_on_similarity` integer,
	`is_user_interested` integer,
	`user_interest_notes` text,
	`timestamp` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`parent_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`similar_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_similar_map` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`parent_store_id` integer NOT NULL,
	`similar_store_id` integer NOT NULL,
	`similar_store_price_point` text,
	`ai_analysis` text,
	`ai_similarity_review_score` integer,
	`ai_similarity_review_score_rationale` text,
	`user_feedback_notes` text,
	`is_liked_by_user` integer,
	`user_rating_on_similarity` integer,
	`is_user_interested` integer,
	`user_interest_notes` text,
	`timestamp` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`parent_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`similar_store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_tag_def` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`color` text,
	`parent_id` integer,
	`is_active` integer DEFAULT true,
	`is_store_tag_only` integer DEFAULT false,
	`is_store_product_tag_only` integer DEFAULT false
);
--> statement-breakpoint
CREATE TABLE `store_product_tag_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`showroom_tag_id` integer NOT NULL,
	`store_product_id` integer NOT NULL,
	FOREIGN KEY (`showroom_tag_id`) REFERENCES `showroom_tag_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_tag_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()),
	`showroom_tag_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	FOREIGN KEY (`showroom_tag_id`) REFERENCES `showroom_tag_def`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_store_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`rating_created` text,
	`source` text NOT NULL,
	`comment` text,
	`rating` integer NOT NULL,
	`scraped_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_product_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_product_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`rating_notes` text,
	`is_active` integer DEFAULT true,
	`replaced_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `store_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`rating` integer NOT NULL,
	`rating_notes` text,
	`is_active` integer DEFAULT true,
	`replaced_by_id` integer,
	`created_at` integer DEFAULT (unixepoch()),
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_scan_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`is_barcode` integer DEFAULT false,
	`cf_image_url` text,
	`r2_key` text,
	`barcode_decoded_value` text,
	`price` text,
	`json_extracted_data` text,
	`ai_rationale` text,
	`ai_model_used` text,
	`extraction_status` text,
	`matched_store_product_id` integer,
	`auto_created_product_id` integer,
	`store_id` integer,
	`scanned_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`matched_store_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`auto_created_product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `shopping_journal_entries` ADD `store_id` integer REFERENCES showroom_stores(id);--> statement-breakpoint
CREATE UNIQUE INDEX `store_bayarea_cities_bay_area_city_name_unique` ON `store_bayarea_cities` (`bay_area_city_name`);--> statement-breakpoint
/*
 SQLite does not support "Creating foreign key on existing column" out of the box, we do not generate automatic migration for that, so it has to be done manually
 Please refer to: https://www.techonthenet.com/sqlite/tables/alter_table.php
                  https://www.sqlite.org/lang_altertable.html

 Due to that we don't generate migration automatically and it has to be done manually
*/