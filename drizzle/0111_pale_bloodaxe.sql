CREATE TABLE `showroom_store_sales` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`store_id` integer NOT NULL,
	`clearance_website_id` integer,
	`source_url` text NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL,
	`clearance_details_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`rag_uuid` text,
	`is_current` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`clearance_website_id`) REFERENCES `showroom_store_links`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `showroom_store_sales_store_idx` ON `showroom_store_sales` (`store_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_sales_link_idx` ON `showroom_store_sales` (`clearance_website_id`);--> statement-breakpoint
CREATE INDEX `showroom_store_sales_current_idx` ON `showroom_store_sales` (`is_current`,`timestamp`);--> statement-breakpoint
CREATE INDEX `showroom_store_sales_rag_idx` ON `showroom_store_sales` (`rag_uuid`);--> statement-breakpoint
-- Strip the legacy "[gemini summarized] " marker the maps service used to
-- prepend to AI review summaries. The prefix is no longer written; this cleans
-- the rows persisted before that change so the viewport stops rendering it.
UPDATE `showroom_stores`
SET `review_summary` = TRIM(SUBSTR(`review_summary`, LENGTH('[gemini summarized]') + 1))
WHERE `review_summary` LIKE '[gemini summarized]%';