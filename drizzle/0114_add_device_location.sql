CREATE TABLE IF NOT EXISTS `device_location` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text DEFAULT 'browser' NOT NULL,
	`latitude` real NOT NULL,
	`longitude` real NOT NULL,
	`accuracy_meters` real,
	`address` text,
	`captured_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `device_location_source_idx` ON `device_location` (`source`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `device_location_captured_idx` ON `device_location` (`captured_at`);
