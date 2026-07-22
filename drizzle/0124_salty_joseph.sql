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
CREATE TABLE `brand_name_variations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`brand_name` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_store_products` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `brands` ADD `is_active` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `product_ai_rating_product_idx` ON `product_ai_rating` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_documents_rag_uuid_uniq` ON `product_documents` (`rag_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `product_documents_uniq` ON `product_documents` (`product_id`,`scrape_url`);--> statement-breakpoint
CREATE INDEX `product_documents_product_idx` ON `product_documents` (`product_id`);--> statement-breakpoint
CREATE INDEX `product_ratings_product_idx` ON `product_ratings` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_links_uniq` ON `showroom_product_links` (`product_id`,`scrape_url`,`extracted_url`);--> statement-breakpoint
CREATE INDEX `showroom_product_links_product_idx` ON `showroom_product_links` (`product_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_scraped_pages_rag_uuid_uniq` ON `showroom_product_scraped_pages` (`rag_uuid`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_product_scraped_pages_uniq` ON `showroom_product_scraped_pages` (`product_id`,`scraped_url`);--> statement-breakpoint
CREATE UNIQUE INDEX `brand_name_variations_one_primary` ON `brand_name_variations` (`brand_id`) WHERE "brand_name_variations"."is_primary" = 1;--> statement-breakpoint
CREATE UNIQUE INDEX `brand_name_variations_brand_name_uniq` ON `brand_name_variations` (`brand_id`,`brand_name`);--> statement-breakpoint
CREATE INDEX `brand_name_variations_name_idx` ON `brand_name_variations` (`brand_name`);--> statement-breakpoint
CREATE INDEX `brand_name_variations_brand_idx` ON `brand_name_variations` (`brand_id`);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Triggers keeping `brands.name` equal to the is_primary row in
-- `brand_name_variations`, in BOTH directions. Hand-written because drizzle-kit
-- cannot express triggers; they must live in the SAME migration that creates
-- brand_name_variations so a fresh database applies them in a valid order.
-- SQLite runs recursive_triggers OFF, so trigger bodies cannot cascade.
-- ---------------------------------------------------------------------------
-- 1. A new primary variation renames the brand.
CREATE TRIGGER IF NOT EXISTS brand_name_sync_from_variation_insert
AFTER INSERT ON brand_name_variations
WHEN NEW.is_primary = 1
BEGIN
  UPDATE brands
     SET name = NEW.brand_name
   WHERE id = NEW.brand_id
     AND name IS NOT NEW.brand_name;
END;
--> statement-breakpoint

-- 2. Promoting/renaming an existing variation renames the brand. This is what
--    makes "fix the display name" a toggle: flip is_primary, the brand follows.
CREATE TRIGGER IF NOT EXISTS brand_name_sync_from_variation_update
AFTER UPDATE ON brand_name_variations
WHEN NEW.is_primary = 1
BEGIN
  UPDATE brands
     SET name = NEW.brand_name
   WHERE id = NEW.brand_id
     AND name IS NOT NEW.brand_name;
END;
--> statement-breakpoint

-- 3. Every brand row gets a primary variation, whatever inserted it. Covers all
--    9 existing insert paths and any future one, so a brand can never exist
--    without a resolvable name.
CREATE TRIGGER IF NOT EXISTS brand_seed_primary_variation
AFTER INSERT ON brands
WHEN trim(COALESCE(NEW.name, '')) != ''
BEGIN
  INSERT OR IGNORE INTO brand_name_variations
    (brand_id, brand_name, is_active, is_primary)
  VALUES (NEW.id, trim(NEW.name), 1, 1);
END;
--> statement-breakpoint

-- 4. The reverse direction: a legacy write straight to `brands.name` is
--    reflected back into the variations table rather than silently diverging.
--    The old primary is DEMOTED, not deleted — it stays a lookup key, which is
--    the entire point of the table.
CREATE TRIGGER IF NOT EXISTS brand_variation_sync_from_brand_update
AFTER UPDATE OF name ON brands
WHEN trim(COALESCE(NEW.name, '')) != '' AND NEW.name IS NOT OLD.name
BEGIN
  UPDATE brand_name_variations
     SET is_primary = 0
   WHERE brand_id = NEW.id
     AND is_primary = 1
     AND brand_name IS NOT NEW.name;

  INSERT INTO brand_name_variations
    (brand_id, brand_name, is_active, is_primary)
  VALUES (NEW.id, trim(NEW.name), 1, 1)
  ON CONFLICT (brand_id, brand_name)
  DO UPDATE SET is_primary = 1, is_active = 1;
END;
