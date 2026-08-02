CREATE TABLE `room_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`event_kind` text NOT NULL,
	`subject_kind` text,
	`subject_id` integer,
	`summary` text,
	`actor` text,
	`occurred_at` integer,
	`recorded_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_permit_mapping` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`permit_id` text NOT NULL,
	`scope_notes` text,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`permit_id`) REFERENCES `permits_records`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `room_trade_assignments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`room_id` integer NOT NULL,
	`company_id` integer NOT NULL,
	`trade_type_id` integer,
	`scope_notes_markdown` text,
	`scope_notes_html` text,
	`scope_notes_plaintext` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`datetime_created` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `companies`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trade_type_id`) REFERENCES `business_types`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
ALTER TABLE `floors` ADD `is_physical` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `room_events_room_occurred_idx` ON `room_events` (`room_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `room_events_subject_idx` ON `room_events` (`subject_kind`,`subject_id`);--> statement-breakpoint
CREATE INDEX `room_permit_mapping_room_idx` ON `room_permit_mapping` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_permit_mapping_permit_idx` ON `room_permit_mapping` (`permit_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_permit_mapping_room_permit_uniq` ON `room_permit_mapping` (`room_id`,`permit_id`);--> statement-breakpoint
CREATE INDEX `room_trade_assignments_room_idx` ON `room_trade_assignments` (`room_id`);--> statement-breakpoint
CREATE INDEX `room_trade_assignments_company_idx` ON `room_trade_assignments` (`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `room_trade_assignments_room_company_trade_uniq` ON `room_trade_assignments` (`room_id`,`company_id`,`trade_type_id`);