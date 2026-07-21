CREATE TABLE `product_ai_rating` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`product_id` integer NOT NULL,
	`rating` integer,
	`ai_rationale` text,
	`ai_rating_scorecard_json` text,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `product_documents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`product_id` integer NOT NULL,
	`scrape_id` integer,
	`scrape_url` text NOT NULL,
	`website_document_link_label` text,
	`title` text,
	`description` text,
	`product_doc_type` text DEFAULT 'OTHER' NOT NULL,
	`file_type` text,
	`mime_type` text,
	`source_file_r2_key` text,
	`source_file_r2_url` text,
	`extracted_content_r2_key` text,
	`extracted_content_r2_url` text,
	`metadata` text,
	`is_active` integer DEFAULT true NOT NULL,
	`visibility` text DEFAULT 'PRIVATE' NOT NULL,
	`extraction_status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`scrape_id`) REFERENCES `showroom_product_scraped_pages`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `product_ratings` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`stars_score` integer,
	`source` text DEFAULT 'OTHER' NOT NULL,
	`source_url` text,
	`rater_name` text,
	`rating_text` text,
	`ai_analysis` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_product_links` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`scrape_url` text NOT NULL,
	`extracted_url` text NOT NULL,
	`extracted_url_label` text,
	`is_scraped` integer DEFAULT true NOT NULL,
	`is_manually_added` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `showroom_product_scraped_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`product_id` integer NOT NULL,
	`scraped_url` text NOT NULL,
	`r2_html_key` text,
	`markdown_content` text,
	`full_page_screenshot_cf_image_url` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `showroom_store_products`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `source_url` text;--> statement-breakpoint
CREATE INDEX `product_ai_rating_product_idx` ON `product_ai_rating` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_documents_rag_uuid_uniq` ON `product_documents` (`rag_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_documents_uniq` ON `product_documents` (`product_id`,`scrape_url`);--> statement-breakpoint
CREATE INDEX `product_documents_product_idx` ON `product_documents` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_ratings_product_idx` ON `product_ratings` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_links_uniq` ON `showroom_product_links` (`product_id`,`scrape_url`,`extracted_url`);--> statement-breakpoint
CREATE INDEX `showroom_product_links_product_idx` ON `showroom_product_links` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_scraped_pages_rag_uuid_uniq` ON `showroom_product_scraped_pages` (`rag_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_scraped_pages_uniq` ON `showroom_product_scraped_pages` (`product_id`,`scraped_url`);