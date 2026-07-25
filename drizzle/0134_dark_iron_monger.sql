CREATE TABLE `scraping_sitemap` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scrape_job_type` text NOT NULL,
	`brand_id` integer,
	`showroom_id` integer,
	`product_id` integer,
	`website_url` text NOT NULL,
	`sitemap_url` text,
	`page_urls` text,
	`page_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `scraping_sitemap_brand_idx` ON `scraping_sitemap` (`brand_id`);--> statement-breakpoint
CREATE INDEX `scraping_sitemap_showroom_idx` ON `scraping_sitemap` (`showroom_id`);--> statement-breakpoint
CREATE INDEX `scraping_sitemap_product_idx` ON `scraping_sitemap` (`product_id`);