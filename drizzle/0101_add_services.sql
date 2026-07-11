CREATE TABLE `services` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`default_unit_cost` real,
	`is_archived` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_services_name` ON `services` (`name`);--> statement-breakpoint
CREATE INDEX `idx_services_is_archived` ON `services` (`is_archived`);--> statement-breakpoint
ALTER TABLE `estimate_line_items` ADD `service_id` integer REFERENCES services(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_estimate_line_items_service_id` ON `estimate_line_items` (`service_id`);
