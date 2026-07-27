CREATE TABLE `sale_cycles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`new_count` integer DEFAULT 0 NOT NULL,
	`changed_count` integer DEFAULT 0 NOT NULL,
	`gone_count` integer DEFAULT 0 NOT NULL,
	`failed_sites` integer DEFAULT 0 NOT NULL,
	`deep_runs_spent` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sale_research_clusters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`brand_id` integer,
	`category_id` integer,
	`tier` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`est_cost_cents` integer DEFAULT 0 NOT NULL,
	`summary_markdown` text,
	`summary_html` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `sale_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sale_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_snapshot_id` integer NOT NULL,
	`store_id` integer NOT NULL,
	`cycle_id` integer,
	`title` text NOT NULL,
	`brand_id` integer,
	`brand_text` text,
	`product_line` text,
	`model_name` text,
	`sku` text,
	`category_id` integer,
	`subcategory_id` integer,
	`category_text` text,
	`size_text` text,
	`original_price` text,
	`original_price_cents` integer,
	`sale_price` text,
	`sale_price_cents` integer,
	`discount_amount` text,
	`discount_amount_cents` integer,
	`discount_pct` real,
	`shipping` text,
	`shipping_cents` integer,
	`deal_terms` text,
	`condition` text DEFAULT 'new' NOT NULL,
	`has_warranty` integer,
	`warranty_text` text,
	`qty` integer,
	`damage_notes_markdown` text,
	`damage_notes_html` text,
	`source_url` text,
	`match_key` text,
	`first_seen_cycle` integer,
	`last_seen_cycle` integer,
	`is_current` integer DEFAULT true NOT NULL,
	`change_status` text DEFAULT 'new' NOT NULL,
	`prev_sale_price_cents` integer,
	`deal_score` integer,
	`deal_savings_cents` integer,
	`deal_insight_markdown` text,
	`deal_insight_html` text,
	`deal_scored_at` integer,
	`research_tier` text,
	`research_confidence` integer,
	`research_reason` text,
	`research_cluster_id` integer,
	`deep_research_ref` integer,
	`reviewed_at` integer,
	`dismissed_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sale_snapshot_id`) REFERENCES `showroom_store_sales`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cycle_id`) REFERENCES `sale_cycles`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`subcategory_id`) REFERENCES `subcategories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`research_cluster_id`) REFERENCES `sale_research_clusters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `sale_item_images` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_item_id` integer NOT NULL,
	`image_url` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`alt` text,
	`load_ok` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sale_item_colors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`color_id` integer NOT NULL,
	`sale_item_id` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`color_id`) REFERENCES `colors`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sale_watch` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sale_item_id` integer NOT NULL,
	`user_id` text,
	`last_notified_change` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`sale_item_id`) REFERENCES `sale_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `sale_scrape_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`store_id` integer,
	`clearance_link_id` integer,
	`source_url` text NOT NULL,
	`status` text NOT NULL,
	`items_found` integer DEFAULT 0 NOT NULL,
	`items_new` integer DEFAULT 0 NOT NULL,
	`error_text` text,
	`duration_ms` integer,
	`scraped_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `sale_cycles`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`clearance_link_id`) REFERENCES `showroom_store_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `weekly_sale_ad` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cycle_id` integer NOT NULL,
	`pdf_r2_key` text,
	`summary_markdown` text,
	`summary_html` text,
	`top_finds_json` text,
	`failed_sites_json` text,
	`new_count` integer DEFAULT 0 NOT NULL,
	`changed_count` integer DEFAULT 0 NOT NULL,
	`gone_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'building' NOT NULL,
	`generated_at` integer,
	`email_sent_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`cycle_id`) REFERENCES `sale_cycles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `is_online_only` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `showroom_store_sales` ADD `page_markdown` text;--> statement-breakpoint
CREATE INDEX `sale_cycles_status_idx` ON `sale_cycles` (`status`,`started_at`);--> statement-breakpoint
CREATE INDEX `sale_research_clusters_cycle_idx` ON `sale_research_clusters` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `sale_items_snapshot_idx` ON `sale_items` (`sale_snapshot_id`);--> statement-breakpoint
CREATE INDEX `sale_items_store_idx` ON `sale_items` (`store_id`);--> statement-breakpoint
CREATE INDEX `sale_items_cycle_idx` ON `sale_items` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `sale_items_brand_idx` ON `sale_items` (`brand_id`);--> statement-breakpoint
CREATE INDEX `sale_items_subcategory_idx` ON `sale_items` (`subcategory_id`);--> statement-breakpoint
CREATE INDEX `sale_items_current_idx` ON `sale_items` (`is_current`,`change_status`);--> statement-breakpoint
CREATE INDEX `sale_items_match_idx` ON `sale_items` (`store_id`,`match_key`);--> statement-breakpoint
CREATE INDEX `sale_items_review_idx` ON `sale_items` (`reviewed_at`,`deal_score`);--> statement-breakpoint
CREATE INDEX `sale_item_images_item_idx` ON `sale_item_images` (`sale_item_id`,`position`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_item_colors_uniq` ON `sale_item_colors` (`color_id`,`sale_item_id`);--> statement-breakpoint
CREATE INDEX `sale_item_colors_item_idx` ON `sale_item_colors` (`sale_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `sale_watch_uniq` ON `sale_watch` (`sale_item_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `sale_scrape_runs_cycle_idx` ON `sale_scrape_runs` (`cycle_id`);--> statement-breakpoint
CREATE INDEX `sale_scrape_runs_store_idx` ON `sale_scrape_runs` (`store_id`,`scraped_at`);--> statement-breakpoint
CREATE INDEX `sale_scrape_runs_status_idx` ON `sale_scrape_runs` (`status`);--> statement-breakpoint
CREATE INDEX `weekly_sale_ad_cycle_idx` ON `weekly_sale_ad` (`cycle_id`);