CREATE TABLE `dashboard_analytics_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_title` text NOT NULL,
	`category` text NOT NULL,
	`region` text NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`bid_amount` real NOT NULL,
	`keywords` text NOT NULL,
	`timestamp` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_analytics_region` ON `dashboard_analytics_jobs` (`region`);--> statement-breakpoint
CREATE INDEX `idx_analytics_category` ON `dashboard_analytics_jobs` (`category`);