CREATE TABLE `showroom_bulk_intake_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` text NOT NULL,
	`place_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`store_id` integer,
	`result_status` text,
	`error` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`store_id`) REFERENCES `showroom_stores`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `showroom_bulk_intake_batch_idx` ON `showroom_bulk_intake_items` (`batch_id`);--> statement-breakpoint
CREATE INDEX `showroom_bulk_intake_status_idx` ON `showroom_bulk_intake_items` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `showroom_bulk_intake_batch_place_uniq` ON `showroom_bulk_intake_items` (`batch_id`,`place_id`);