CREATE TABLE `browser_run_pages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rag_uuid` text NOT NULL,
	`showroom_id` integer NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`page_url` text NOT NULL,
	`markdown_r2_url` text,
	`fullpage_screenshot_cf_images_url` text,
	`workers_ai_prompt` text,
	`workers_ai_structured_schema` text,
	`workers_ai_structured_response` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`showroom_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `rag_uuid` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `hero_image_cf_images_url` text;--> statement-breakpoint
ALTER TABLE `showroom_stores` ADD `scrape_status` text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_browser_run_pages_rag_uuid` ON `browser_run_pages` (`rag_uuid`);--> statement-breakpoint
CREATE INDEX `idx_browser_run_pages_showroom_id` ON `browser_run_pages` (`showroom_id`);