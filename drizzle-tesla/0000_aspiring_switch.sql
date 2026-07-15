CREATE TABLE `tesla_telemetry_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vin` text,
	`event_ts` integer,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL,
	`latitude` real,
	`longitude` real,
	`speed` real,
	`shift_state` text,
	`battery_level` integer,
	`odometer` real,
	`data` text
);
--> statement-breakpoint
CREATE TABLE `tesla_webhook_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`vin` text,
	`event_type` text,
	`latitude` real,
	`longitude` real,
	`match_result` text,
	`data` text,
	`received_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tesla_telemetry_vin_idx` ON `tesla_telemetry_events` (`vin`);--> statement-breakpoint
CREATE INDEX `tesla_telemetry_received_idx` ON `tesla_telemetry_events` (`received_at`);--> statement-breakpoint
CREATE INDEX `tesla_webhook_vin_idx` ON `tesla_webhook_events` (`vin`);--> statement-breakpoint
CREATE INDEX `tesla_webhook_type_idx` ON `tesla_webhook_events` (`event_type`);--> statement-breakpoint
CREATE INDEX `tesla_webhook_received_idx` ON `tesla_webhook_events` (`received_at`);